// @vitest-environment jsdom
import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { DaemonProvider } from '../src/daemon/DaemonProvider.js';
import { LiveMissionControl } from '../src/daemon/LiveMissionControl.js';
import { DaemonClient } from '../src/daemon/daemonClient.js';
import { createFakeScheduler, createFakeTransport, makeSnapshot } from './helpers.js';

afterEach(() => cleanup());

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
