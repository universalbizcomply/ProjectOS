// @vitest-environment jsdom
import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { DaemonProvider } from '../src/daemon/DaemonProvider.js';
import { LiveMissionControl } from '../src/daemon/LiveMissionControl.js';
import { DaemonClient } from '../src/daemon/daemonClient.js';
import { createFakeScheduler, createFakeTransport, makeSnapshot } from './helpers.js';
import type { LiveLifecycle } from '../src/daemon/types.js';

afterEach(() => cleanup());

/** The exact sentences the Rust host returns (`DaemonStatus::next_safe_action`). */
const RECOVERING_MESSAGE = 'ProjectOS is finishing recovery from the previous session.';
const BLOCKED_MESSAGE =
  'ProjectOS could not safely confirm that the previous local worker has stopped. No new worker was started.';

function lifecycleMsg(state: LiveLifecycle['state'], nextSafeAction: string) {
  return {
    kind: 'lifecycle' as const,
    lifecycle: {
      state,
      readOnlyAvailable: state === 'RUNNING_READ_ONLY',
      protectedApprovalsDisabled: true,
      nextSafeAction,
    },
  };
}

/** The host's lifecycle is the pre-ready authority and reaches the owner surface verbatim. */
describe('LiveMissionControl · host lifecycle (RECOVERY-BARRIER1D)', () => {
  function mount() {
    const sched = createFakeScheduler();
    const transport = createFakeTransport();
    const client = new DaemonClient(transport, sched);
    render(
      <DaemonProvider client={client}>
        <LiveMissionControl />
      </DaemonProvider>,
    );
    return { sched, transport, client };
  }

  test('renders the Recovering message exactly, and never a connection error', () => {
    const { transport } = mount();
    act(() => transport.emit(lifecycleMsg('RECOVERING', RECOVERING_MESSAGE)));
    expect(screen.getByText(RECOVERING_MESSAGE)).toBeTruthy();
    expect(screen.queryByText('Disconnected')).toBeNull();
    expect(screen.getByText('Finishing recovery…')).toBeTruthy();
  });

  test('renders the Blocked message exactly and stays responsive', () => {
    const { transport } = mount();
    act(() => transport.emit(lifecycleMsg('BLOCKED', BLOCKED_MESSAGE)));
    expect(screen.getByText(BLOCKED_MESSAGE)).toBeTruthy();
    expect(screen.queryByText('Disconnected')).toBeNull();
    // No start / retry / force / cleanup control is offered: relaunch is the only retry.
    for (const label of [/retry/i, /force/i, /start worker/i, /delete/i, /clean/i]) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
  });

  test('the lifecycle message is announced to assistive technology', () => {
    const { transport } = mount();
    act(() => transport.emit(lifecycleMsg('RECOVERING', RECOVERING_MESSAGE)));
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(RECOVERING_MESSAGE);
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  test('no identifier ever reaches the owner surface', () => {
    const { transport } = mount();
    act(() => transport.emit(lifecycleMsg('BLOCKED', BLOCKED_MESSAGE)));
    const text = document.body.textContent ?? '';
    for (const leak of ['pid', 'PID', 'S-1-5', 'C:\\', '.exe', 'mutex', 'handle', '0x']) {
      expect(text.includes(leak)).toBe(false);
    }
  });

  test('a stale snapshot cannot overwrite the pre-ready lifecycle status', () => {
    const { transport } = mount();
    act(() => transport.emit(lifecycleMsg('RECOVERING', RECOVERING_MESSAGE)));
    // A snapshot arriving while the host says pre-ready must not present itself as current.
    act(() => transport.emit({ kind: 'snapshot', snapshot: makeSnapshot() }));
    expect(screen.getByText(RECOVERING_MESSAGE)).toBeTruthy();
  });

  test('reaching RunningReadOnly returns to the normal owner workflow', () => {
    const { transport } = mount();
    act(() => transport.emit(lifecycleMsg('RECOVERING', RECOVERING_MESSAGE)));
    expect(screen.getByText(RECOVERING_MESSAGE)).toBeTruthy();
    act(() => transport.emit(lifecycleMsg('RUNNING_READ_ONLY', 'Local worker ready for read-only operation.')));
    act(() => transport.emit({ kind: 'snapshot', snapshot: makeSnapshot() }));
    expect(screen.queryByText(RECOVERING_MESSAGE)).toBeNull();
    expect(screen.getByText('Bridge running')).toBeTruthy();
  });

  test('the heartbeat requests no snapshot while the host is pre-ready, and resumes once ready', () => {
    const { sched, transport, client } = mount();
    client.start();
    transport.snapshotRequests = 0;
    act(() => transport.emit(lifecycleMsg('RECOVERING', RECOVERING_MESSAGE)));
    // Beat while pre-ready: a snapshot request would be refused and misread as a drop.
    act(() => sched.advance(6_000));
    expect(transport.snapshotRequests).toBe(0);
    // Once ready the existing snapshot flow resumes untouched.
    act(() => transport.emit(lifecycleMsg('RUNNING_READ_ONLY', 'ready')));
    act(() => sched.advance(6_000));
    expect(transport.snapshotRequests).toBeGreaterThan(0);
    client.stop();
  });
});

describe('LiveMissionControl', () => {
  test('shows connecting first, then live data after a snapshot', () => {
    const sched = createFakeScheduler();
    const transport = createFakeTransport();
    const client = new DaemonClient(transport, sched);

    render(
      <DaemonProvider client={client}>
        <LiveMissionControl />
      </DaemonProvider>,
    );

    // Heading + initial connecting state.
    expect(screen.getByText('Mission Control')).toBeTruthy();
    expect(screen.getByText('Connecting…')).toBeTruthy();

    // Push a live snapshot from the (fake) daemon.
    act(() => {
      transport.emit({
        kind: 'snapshot',
        snapshot: makeSnapshot({
          workers: [
            { worker: 'claude-code', provider: 'claude-code', project: 'app', phase: 'X1A', status: 'implementing', online: true, updatedAt: 't' },
          ],
          phases: [
            { project: 'app', phase: 'X1A', stage: 'awaiting_review', status: 'awaiting_review', validators: 'pass', decisionRequired: true, worker: 'claude-code', blockers: [] },
          ],
          projects: [
            { project: 'app', phase: 'X1A', stage: 'awaiting_review', worker: 'claude-code', validators: 'pass', decisionRequired: true },
          ],
        }),
      });
    });

    expect(screen.getByText('Bridge running')).toBeTruthy();
    expect(screen.getByText('claude-code')).toBeTruthy();
    // Owner queue reflects the awaiting-review + decision-required phase.
    expect(screen.getByText('Pending reviews (1)')).toBeTruthy();
    expect(screen.getByText('Approvals required (1)')).toBeTruthy();
  });

  test('never renders a secret that slips through', () => {
    const sched = createFakeScheduler();
    const transport = createFakeTransport();
    const client = new DaemonClient(transport, sched);
    const { container } = render(
      <DaemonProvider client={client}>
        <LiveMissionControl />
      </DaemonProvider>,
    );
    act(() => {
      transport.emit({
        kind: 'snapshot',
        snapshot: makeSnapshot({
          workers: [
            { worker: 'claude-code', provider: 'claude-code', project: 'app', phase: 'X', status: 'idle', online: true, updatedAt: 't', currentAction: 'sbp_abcdefghijklmnopqrstuvwxyz012345' },
          ],
        }),
      });
    });
    expect(container.innerHTML).not.toContain('sbp_abcdefghijkl');
    expect(container.innerHTML).toContain('[REDACTED]');
  });
});
