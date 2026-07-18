// @vitest-environment jsdom
import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { DaemonProvider } from '../src/daemon/DaemonProvider.js';
import { OwnerControlPlane } from '../src/owner/OwnerControlPlane.js';
import { DaemonClient } from '../src/daemon/daemonClient.js';
import { createFakeScheduler, createFakeTransport } from './helpers.js';
import type { LiveLifecycle } from '../src/daemon/types.js';

afterEach(() => cleanup());

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

/**
 * The default landing surface must show the host worker lifecycle while pre-ready, so a
 * recovering/blocked worker is never masked by the seed roadmap content.
 */
describe('OwnerControlPlane · worker lifecycle banner (RECOVERY-BARRIER1D)', () => {
  function mount() {
    const transport = createFakeTransport();
    const client = new DaemonClient(transport, createFakeScheduler());
    render(
      <DaemonProvider client={client}>
        <OwnerControlPlane />
      </DaemonProvider>,
    );
    return { transport };
  }

  test('no banner before any lifecycle is known', () => {
    mount();
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('shows the Recovering message on the default surface, as a live status', () => {
    const { transport } = mount();
    act(() => transport.emit(lifecycleMsg('RECOVERING', RECOVERING_MESSAGE)));
    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain(RECOVERING_MESSAGE);
    expect(banner.getAttribute('aria-live')).toBe('polite');
  });

  test('shows the Blocked message and marks it critical', () => {
    const { transport } = mount();
    act(() => transport.emit(lifecycleMsg('BLOCKED', BLOCKED_MESSAGE)));
    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain(BLOCKED_MESSAGE);
    expect(banner.className).toContain('crit');
  });

  test('the banner disappears once the worker is ready', () => {
    const { transport } = mount();
    act(() => transport.emit(lifecycleMsg('RECOVERING', RECOVERING_MESSAGE)));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() =>
      transport.emit(lifecycleMsg('RUNNING_READ_ONLY', 'Local worker ready for read-only operation.')),
    );
    expect(screen.queryByText(RECOVERING_MESSAGE)).toBeNull();
  });

  test('never leaks an identifier through the banner', () => {
    const { transport } = mount();
    act(() => transport.emit(lifecycleMsg('BLOCKED', BLOCKED_MESSAGE)));
    const text = screen.getByRole('status').textContent ?? '';
    for (const leak of ['pid', 'S-1-5', 'C:\\', '.exe', 'mutex', 'handle', '0x']) {
      expect(text.includes(leak)).toBe(false);
    }
  });
});
