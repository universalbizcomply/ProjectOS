// @vitest-environment jsdom
/**
 * Connections & secrets (PROJECTOS-PRODUCT-COMPLETION1A §12–18).
 *
 * Two properties matter more than the rendering, and both are pinned here:
 *
 *   1. NO CREDENTIAL VALUE CAN REACH THE SURFACE. The projection is fed credential METADATA, so the
 *      last test drives a row carrying a value-shaped field and proves the value appears nowhere in
 *      the rendered output — a regression that added a value field would have to defeat this.
 *   2. "COULD NOT ASK" IS NOT "NONE CONFIGURED". An installation that cannot reach the credential
 *      router has learned nothing; reporting that as "no connections" is a claim it has not earned.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { projectGovernedState, type GovernedInputs } from '../src/governed/governedProjection';
import { ConnectionsPanel } from '../src/owner/ConnectionsPanel.js';
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
    expect(screen.getByText(/no external connections set up/i)).toBeTruthy();
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

  function openStoreForm() {
    const p = projectGovernedState(inputs([row({ present: false, managed: false })]));
    render(<ConnectionsPanel state={p} />);
    fireEvent.click(screen.getByText('Set it up'));
    return screen.getByLabelText('Value') as HTMLInputElement;
  }

  test('the value goes to the native command, not the governed command channel', async () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
    const invoke = vi.spyOn(tauriBridge, 'invoke').mockResolvedValue('STORED');
    const field = openStoreForm();

    fireEvent.change(field, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: 'Store' }));

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
    const field = openStoreForm();

    fireEvent.change(field, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: 'Store' }));

    await waitFor(() => expect(field.value).toBe(''));
    expect(document.body.textContent ?? '').not.toContain(SECRET);
  });

  test('the field is cleared after a FAILED store too — a value that did not store is still a secret', async () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
    vi.spyOn(tauriBridge, 'invoke').mockRejectedValue('Nothing was stored.');
    const field = openStoreForm();

    fireEvent.change(field, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: 'Store' }));

    await waitFor(() => expect(field.value).toBe(''));
    expect(document.body.textContent ?? '').not.toContain(SECRET);
    expect(screen.getByText('Nothing was stored.')).toBeTruthy();
  });

  test('the input is masked', () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
    const field = openStoreForm();
    expect(field.type).toBe('password');
  });

  test('an already-stored credential offers Replace and sends replace: true', async () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
    const invoke = vi.spyOn(tauriBridge, 'invoke').mockResolvedValue('REPLACED');
    const p = projectGovernedState(inputs([row()]));
    render(<ConnectionsPanel state={p} />);
    // The <summary> and the submit button share the word "Replace"; target them by role so the
    // test cannot silently click the wrong one.
    fireEvent.click(screen.getByText('Replace', { selector: 'summary' }));

    fireEvent.change(screen.getByLabelText('New value'), { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0]![1]).toMatchObject({ replace: true });
  });

  test('with no native host there is no route to submit a secret at all', () => {
    vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(false);
    const invoke = vi.spyOn(tauriBridge, 'invoke');
    const p = projectGovernedState(inputs([row()]));
    render(<ConnectionsPanel state={p} />);
    fireEvent.click(screen.getByText('Replace', { selector: 'summary' }));

    expect(screen.queryByLabelText('New value')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
