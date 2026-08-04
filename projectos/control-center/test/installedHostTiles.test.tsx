// @vitest-environment jsdom
//
// PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A · amendment INSTALLED-HOST-STATUS-TILE-OVERFLOW1A.
//
// The defect was purely visual: the value `UNAVAILABLE` overflowed its installed-host tile at every
// window width, truncating to `UNAVAILABL` on six of seven tiles when maximised.
//
// LIMITATION — jsdom does not lay out CSS, so these tests CANNOT prove the geometry. They pin the
// contract the fix must not break: every tile still carries the COMPLETE value string, labels and
// accessible names are unchanged, and no shortened application text was substituted for the real
// status. Layout correctness is proven by the native three-layout window proof, not here.
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { DaemonProvider } from '../src/daemon/DaemonProvider.js';
import { DaemonClient } from '../src/daemon/daemonClient.js';
import { createFakeScheduler, createFakeTransport } from './helpers.js';

/** Controls what the (mocked) Tauri bridge answers for the installed-host read. */
const host = vi.hoisted(() => ({
  inTauri: false,
  answer: '' as unknown,
}));

vi.mock('../src/daemon/tauriBridge.js', () => ({
  tauriBridge: {
    isTauri: () => host.inTauri,
    invoke: async () => host.answer,
    listen: async () => async () => {},
  },
}));

const { LiveMissionControl } = await import('../src/daemon/LiveMissionControl.js');

/** The seven installed-host field labels, in render order. */
const LABELS = [
  'Service',
  'Installation identity',
  'Channel',
  'Build',
  'Release manifest',
  'Readiness',
  'Protected operations',
] as const;

function mount() {
  const sched = createFakeScheduler();
  const transport = createFakeTransport();
  const client = new DaemonClient(transport, sched);
  render(
    <DaemonProvider client={client}>
      <LiveMissionControl />
    </DaemonProvider>,
  );
}

/** Let the panel's status read resolve. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  host.inTauri = false;
  host.answer = '';
});

describe('installed-host tiles · value integrity', () => {
  // T1 — all seven values render the COMPLETE word, not a visually truncated stand-in.
  test('T1 renders the complete UNAVAILABLE value in all seven tiles', async () => {
    mount();
    await settle();

    const values = screen.getAllByText('UNAVAILABLE');
    expect(values).toHaveLength(LABELS.length);
    for (const v of values) expect(v.textContent).toBe('UNAVAILABLE');
  });

  // T2 — the accessible name of the region and every label survive the styling change.
  test('T2 accessible names and labels are unchanged', async () => {
    mount();
    await settle();

    expect(screen.getByRole('region', { name: 'Installed host' })).toBeTruthy();
    for (const label of LABELS) expect(screen.getByText(label)).toBeTruthy();
  });

  // T3 — no shortened application text was substituted for the real status value.
  test('T3 no truncated or abbreviated status text is rendered', async () => {
    mount();
    await settle();

    // The clipped form seen on screen before the fix, plus the usual abbreviation escapes.
    expect(screen.queryByText('UNAVAILABL')).toBeNull();
    expect(screen.queryByText('UNAVAIL')).toBeNull();
    expect(screen.queryByText('N/A')).toBeNull();
    expect(screen.queryByText(/UNAVAILABLE…|UNAVAILABLE\.\.\./)).toBeNull();
  });

  // T4 — a healthy host still renders its real values; the fix is not specific to UNAVAILABLE.
  test('T4 normal status values still render in full', async () => {
    host.inTauri = true;
    host.answer = JSON.stringify({
      serviceState: 'RUNNING',
      identityVerification: 'VERIFIED',
      channel: 'STABLE',
      buildPrefix: '93e58f48',
      manifestPrefix: 'a1b2c3d4',
      readiness: 'READY',
      protectedOperations: 'REFUSED',
      readSucceeded: true,
      nextSafeAction: 'The installed host answered this read-only status request.',
    });
    mount();
    await settle();

    for (const value of ['RUNNING', 'VERIFIED', 'STABLE', '93e58f48', 'a1b2c3d4', 'READY', 'REFUSED']) {
      expect(screen.getByText(value).textContent).toBe(value);
    }
    expect(screen.queryByText('UNAVAILABLE')).toBeNull();
  });

  // T5 — grid item semantics: one value + one label per tile, still seven tiles, order unchanged.
  test('T5 tile structure and order are unchanged', async () => {
    mount();
    await settle();

    const region = screen.getByRole('region', { name: 'Installed host' });
    const cells = region.querySelectorAll('.health-cell');
    expect(cells).toHaveLength(LABELS.length);

    LABELS.forEach((label, i) => {
      const cell = cells[i] as HTMLElement;
      expect(cell.querySelector('.hv')?.textContent).toBe('UNAVAILABLE');
      expect(cell.querySelector('.hk')?.textContent).toBe(label);
    });
  });
});
