// @vitest-environment jsdom
/**
 * Connections & secrets (PROJECTOS-PRODUCT-COMPLETION1A §12–18, extended by Stage 8).
 *
 * Three properties matter more than the rendering, and all three are pinned here:
 *
 *   1. NO CREDENTIAL VALUE CAN REACH THE SURFACE. The projection is fed credential METADATA, so one
 *      test drives a row carrying a value-shaped field and proves the value appears nowhere in the
 *      rendered output — a regression that added a value field would have to defeat this.
 *   2. "COULD NOT ASK" IS NOT "NONE CONFIGURED". An installation that cannot reach the credential
 *      router has learned nothing; reporting that as "no connections" is a claim it has not earned.
 *   3. NO CREDENTIAL IS WRITTEN WITHOUT A SECOND, EXPLICIT PRESS. Stage 8's finding: both former
 *      surfaces called the native write on ONE click, one of them behind a button reading "Add
 *      connection" while sending `replace: true`. See `credentialConfirmation.test.tsx` for the
 *      confirmation contract in full; the writes asserted here go through the same gate.
 *
 * Stage 8 replaced two components with one `Connections` and three projections of it. The render
 * assertions moved to the projection that now owns each behaviour: management to `manage`
 * (Settings), technical identity to `technical` (Advanced, which `ConnectionsPanel` renders).
 *
 * EVERY SECRET IN THIS FILE IS SYNTHETIC and never leaves the process: the native bridge is mocked
 * and asserted on. Nothing is stored anywhere.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { projectGovernedState, type GovernedInputs } from '../src/governed/governedProjection';
import { ConnectionsPanel } from '../src/owner/ConnectionsPanel.js';
import { Connections } from '../src/ux/Connections';
import { tauriBridge } from '../src/daemon/tauriBridge.js';
import type { GovernedProjection } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Minimal inputs; only the credential rows vary. */
function inputs(credentialRows: GovernedInputs['credentialRows']): GovernedInputs {
  return {
    config: { projectId: 'demo', projectName: 'Demo', protectedBranches: ['main'] },
    plan: { planId: 'p', planVersion: '1.0', phases: [] },
    currentState: null,
    phaseRecords: [],
    readiness: { ready: true, reasons: [] },
    planPath: 'plan.json',
    branch: 'main',
    head: 'a'.repeat(40),
    observedAt: '2026-08-25T22:00:00.000Z',
    credentialRows,
  };
}

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reference: 'ProjectOS/demo/development/supabase/gh-token',
    project: 'demo',
    environment: 'development',
    provider: 'supabase',
    credential: 'gh-token',
    risk: 'session',
    present: true,
    managed: true,
    expired: false,
    fingerprint: 'abc123def456',
    expiresAt: null,
    ...over,
  };
}

describe('a router that could not be reached is not "no connections"', () => {
  test('null rows report unavailable, with an empty list', () => {
    const p = projectGovernedState(inputs(null));
    expect(p.connections.available).toBe(false);
    expect(p.connections.connections).toEqual([]);
    expect(p.connections.detail).not.toBe('');
  });

  test('an EMPTY array is a real answer and reports available', () => {
    const p = projectGovernedState(inputs([]));
    expect(p.connections.available).toBe(true);
    expect(p.connections.connections).toEqual([]);
  });

  test('the two render differently — one says it could not read, the other says none are set up', () => {
    const unavailable = projectGovernedState(inputs(null));
    render(<ConnectionsPanel state={unavailable} />);
    expect(screen.getByText(/could not read/i)).toBeTruthy();
    cleanup();

    const empty = projectGovernedState(inputs([]));
    render(<ConnectionsPanel state={empty} />);
    expect(screen.getByText(/nothing connected yet/i)).toBeTruthy();
  });

  test('the distinction survives in every projection, not just one', () => {
    for (const mode of ['manage', 'status', 'technical'] as const) {
      const unavailable = projectGovernedState(inputs(null));
      const { container } = render(<Connections state={unavailable} mode={mode} />);
      expect(container.textContent ?? '').toMatch(/could not read/i);
      cleanup();
    }
  });
});

describe('status is derived from what is true, never taken from a claim', () => {
  test('absent from the store is MISSING however the metadata reads', () => {
    const p = projectGovernedState(inputs([row({ present: false, managed: true })]));
    expect(p.connections.connections[0]?.status).toBe('MISSING');
  });

  test('present but expired is EXPIRED', () => {
    const p = projectGovernedState(inputs([row({ expired: true })]));
    expect(p.connections.connections[0]?.status).toBe('EXPIRED');
  });

  test('present with no ProjectOS metadata is UNMANAGED, not silently fine', () => {
    const p = projectGovernedState(inputs([row({ managed: false })]));
    expect(p.connections.connections[0]?.status).toBe('UNMANAGED');
  });

  test('present, managed and unexpired is STORED', () => {
    const p = projectGovernedState(inputs([row()]));
    expect(p.connections.connections[0]?.status).toBe('STORED');
  });

  test('a row with no reference is dropped rather than rendered as a blank connection', () => {
    const p = projectGovernedState(inputs([row({ reference: '' })]));
    expect(p.connections.connections).toEqual([]);
  });

  test('the SAME status word is printed by all three projections', () => {
    // One mapping, one component. Two surfaces that disagreed about whether a key was fine was the
    // original reason `STORED` said "Connected" in one place and "Stored" in another.
    const p = projectGovernedState(inputs([row({ expired: true })]));
    const seen = (['manage', 'status', 'technical'] as const).map((mode) => {
      const { container } = render(<Connections state={p} mode={mode} />);
      const text = container.querySelector('.used')?.textContent ?? '';
      cleanup();
      return text;
    });
    expect(seen).toEqual(['Expired', 'Expired', 'Expired']);
  });
});

describe('no credential value can reach the surface', () => {
  test('a value-shaped field on the input row appears nowhere in the projection or the render', () => {
    const SECRET = 'sk-live-THIS-MUST-NEVER-RENDER-0123456789';
    // The real router cannot emit this; the point is that even if a row carried one, the projection
    // maps a fixed set of metadata fields and the component reads only those.
    const p = projectGovernedState(inputs([row({ value: SECRET, secret: SECRET, token: SECRET })]));

    expect(JSON.stringify(p.connections)).not.toContain(SECRET);

    const { container } = render(<ConnectionsPanel state={p} />);
    expect(container.textContent ?? '').not.toContain(SECRET);
    // The non-reversible fingerprint IS shown — that is the whole point of having one.
    expect(container.textContent ?? '').toContain('abc123def456');
  });

  test('the panel states plainly that a stored secret is never shown', () => {
    const p = projectGovernedState(inputs([row()]));
    render(<ConnectionsPanel state={p} />);
    expect(screen.getByText(/never shows a stored secret/i)).toBeTruthy();
  });

  test('an operation-class credential is flagged as needing approval per use', () => {
    const p = projectGovernedState(inputs([row({ risk: 'operation', credential: 'db-password' })]));
    render(<ConnectionsPanel state={p as GovernedProjection} />);
    expect(screen.getByText(/needs your approval each time/i)).toBeTruthy();
  });
});

describe('storing a credential keeps the value off every shared channel', () => {
  const SECRET = 'sk-live-must-not-persist-or-echo-42';

  /** Open the writer on the one row, then arm the confirmation. Returns the masked field. */
  function openWriter(control: RegExp): HTMLInputElement {
    fireEvent.click(screen.getByRole('button', { name: control }));
    return screen.getByLabelText(/key for/i) as HTMLInputElement;
  }

  function manage(rows: GovernedInputs['credentialRows']) {
    const p = projectGovernedState(inputs(rows));
    render(<Connections state={p} mode="manage" />);
  }

  test('the value goes to the native command, not the governed command channel', async () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
    const invoke = vi.spyOn(tauriBridge, 'invoke').mockResolvedValue('STORED');
    manage([row({ present: false, managed: false })]);

    const field = openWriter(/^Set it up$/);
    fireEvent.change(field, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: /^Store$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Yes, store$/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    const [command, args] = invoke.mock.calls[0]!;
    // `set_credential` is a native Tauri command. The governed channel's verb list is a closed
    // vocabulary of non-secret arguments and must never carry this.
    expect(command).toBe('set_credential');
    expect(args).toMatchObject({
      reference: 'ProjectOS/demo/development/supabase/gh-token',
      value: SECRET,
      replace: false,
    });
  });

  test('the field is cleared after a SUCCESSFUL store, so nothing is left in the DOM', async () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
    vi.spyOn(tauriBridge, 'invoke').mockResolvedValue('STORED');
    manage([row({ present: false, managed: false })]);

    const field = openWriter(/^Set it up$/);
    fireEvent.change(field, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: /^Store$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Yes, store$/ }));

    await waitFor(() => expect(document.body.textContent ?? '').toMatch(/Windows is holding/i));
    expect(document.body.textContent ?? '').not.toContain(SECRET);
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  test('the field is cleared after a FAILED store too — a value that did not store is still a secret', async () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
    vi.spyOn(tauriBridge, 'invoke').mockRejectedValue('Nothing was stored.');
    manage([row({ present: false, managed: false })]);

    const field = openWriter(/^Set it up$/);
    fireEvent.change(field, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: /^Store$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Yes, store$/ }));

    await waitFor(() => expect(screen.getByText('Nothing was stored.')).toBeTruthy());
    expect(document.body.textContent ?? '').not.toContain(SECRET);
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  test('the input is masked', () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
    manage([row({ present: false, managed: false })]);
    expect(openWriter(/^Set it up$/).type).toBe('password');
  });

  test('an already-stored credential offers Replace and sends replace: true', async () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
    const invoke = vi.spyOn(tauriBridge, 'invoke').mockResolvedValue('REPLACED');
    manage([row()]);

    const field = openWriter(/^Replace$/);
    fireEvent.change(field, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Yes, replace$/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0]![1]).toMatchObject({ replace: true });
  });

  test('with no native host there is no route to submit a secret at all', () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(false);
    const invoke = vi.spyOn(tauriBridge, 'invoke');
    manage([row()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));

    expect(document.querySelector('input[type="password"]')).toBeNull();
    // Said in the row the owner opened AND on the add form — both routes are closed, not one.
    expect(screen.getAllByText(/needs the installed ProjectOS desktop application/i).length).toBe(2);
    expect(invoke).not.toHaveBeenCalled();
  });
});
