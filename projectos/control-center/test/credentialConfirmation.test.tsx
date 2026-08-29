// @vitest-environment jsdom
/**
 * A CREDENTIAL IS NEVER WRITTEN WITHOUT A SECOND, EXPLICIT PRESS.
 *
 * Stage 8's mandated ruling on `set_credential` found the DEVICE AUTHORITY sound and the OWNER
 * CONFIRMATION missing. Three defects, all of them reachable by an ordinary owner:
 *
 *   1. ONE CLICK OVERWROTE A STORED KEY. Both former surfaces called the native write directly from
 *      the submit button. Replacing a credential destroys the previous value irrecoverably —
 *      ProjectOS cannot read one back to restore it — so a mis-click on the wrong row was silent
 *      and permanent.
 *   2. A REPLACE LABELLED AS AN ADD. `ConnectionsTab` sent `replace: true` unconditionally from a
 *      button reading "Add connection". An owner adding what they believed was a new key silently
 *      destroyed an existing one.
 *   3. A HARD-WIRED ENVIRONMENT. That same surface built its reference with the literal
 *      `'development'` while listing rows from every environment the project has, so an owner
 *      looking at a `production` row and typing into the form below it wrote to `development`.
 *
 * These prove the corrected contract from a RENDERED tree: what the owner sees, what they must
 * press, and exactly what reaches the host. The bridge is always mocked; every value here is
 * synthetic and nothing is ever stored.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A (Stage 8).
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { Connections } from '../src/ux/Connections';
import { tauriBridge } from '../src/daemon/tauriBridge';
import type { GovernedConnectionView, GovernedProjection } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SYNTHETIC = 'synthetic-not-a-real-key-000';

function conn(over: Partial<GovernedConnectionView> = {}): GovernedConnectionView {
  return {
    provider: 'openai',
    environment: 'development',
    credential: 'api-key',
    reference: 'ProjectOS/demo/development/openai/api-key',
    risk: 'session',
    status: 'STORED',
    fingerprint: 'ab12cd34',
    expiresAt: null,
    ...over,
  } as GovernedConnectionView;
}

function projection(connections: readonly GovernedConnectionView[]): GovernedProjection {
  return {
    connected: true,
    projectId: 'demo',
    projectName: 'Demo',
    repository: { repo: 'acme/demo', localPath: 'C:/dev/demo', branch: 'main', head: 'a'.repeat(40), protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'P', planVersion: '1.0', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: 'plan.json', supersedes: null },
    programme: { acceptedPhaseCount: 0, totalPhaseCount: 1, completionPercentage: 0, completedPhases: [], pendingPhases: [] },
    phases: [],
    activePhase: null,
    nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: { configured: false, budget: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    pendingApprovals: [],
    planDrafts: [],
    sessions: [],
    connections: { available: true, detail: '', connections },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: 'Continue.',
    observedAt: '2026-08-28T08:00:00.000Z',
  } as GovernedProjection;
}

function manage(connections: readonly GovernedConnectionView[]) {
  vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
  const invoke = vi.spyOn(tauriBridge, 'invoke').mockResolvedValue('REPLACED' as never);
  render(<Connections state={projection(connections)} mode="manage" />);
  return invoke;
}

describe('no write happens before the owner is asked a second time', () => {
  test('opening the writer sends nothing', () => {
    const invoke = manage([conn()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    expect(invoke).not.toHaveBeenCalled();
  });

  test('typing a value sends nothing', () => {
    const invoke = manage([conn()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    expect(invoke).not.toHaveBeenCalled();
  });

  test('the FIRST press asks rather than writes — this is the whole defect', () => {
    const invoke = manage([conn()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));

    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  test('only the SECOND press reaches the host', async () => {
    const invoke = manage([conn()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Yes, replace$/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  });

  test('two presses inside one tick still write ONCE', async () => {
    // `disabled` only lands after a re-render, so a double-click or a held Enter got through twice.
    const invoke = manage([conn()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    const yes = screen.getByRole('button', { name: /^Yes, replace$/ });
    fireEvent.click(yes);
    fireEvent.click(yes);

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test('an empty value cannot even reach the question', () => {
    manage([conn()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    expect((screen.getByRole('button', { name: /^Replace$/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the owner can back out, and backing out leaves nothing behind', () => {
  test('Cancel at the question writes nothing and clears the value', () => {
    const invoke = manage([conn()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));

    expect(invoke).not.toHaveBeenCalled();
    expect(document.body.textContent ?? '').not.toContain(SYNTHETIC);
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  test('Escape leaves the writer, and the typed value does not survive it', () => {
    const invoke = manage([conn()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    const field = screen.getByLabelText(/key for/i);
    fireEvent.change(field, { target: { value: SYNTHETIC } });
    fireEvent.keyDown(field, { key: 'Escape' });

    expect(invoke).not.toHaveBeenCalled();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.body.textContent ?? '').not.toContain(SYNTHETIC);
  });
});

describe('the question is answerable from the keyboard', () => {
  test('focus moves INTO the confirmation, because the button that asked it is gone', () => {
    // Pressing Replace removes that button and renders the question in its place. Without this,
    // focus fell to <body>: the owner had been asked something they would have had to tab from the
    // top of the page to answer, and Escape reached nothing.
    manage([conn()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));

    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Yes, replace$/ }));
  });

  test('Escape from the confirmation cancels it, and writes nothing', () => {
    const invoke = manage([conn()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    expect(invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBe(null);
  });

  test('the question itself is what a screen reader is given, not just the dialog label', () => {
    // Focus lands on "Yes, replace"; without `aria-describedby` the only thing announced is the
    // dialog's label and that button's text — never the sentence saying a key is about to be
    // destroyed. The description must be the question.
    manage([conn()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));

    const dialog = screen.getByRole('alertdialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent ?? '').toMatch(/cannot get it back/i);
  });

  test('the masked field is reachable and named, not an unlabelled box', () => {
    manage([conn({ environment: 'production', reference: 'ProjectOS/demo/production/openai/api-key' })]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    const field = screen.getByLabelText(/replace the key for openai \(production\)/i);
    expect((field as HTMLInputElement).type).toBe('password');
  });
});

describe('the question names exactly what is about to happen', () => {
  test('a replace says the current key is overwritten and cannot be recovered', () => {
    manage([conn({ status: 'STORED' })]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));

    const ask = screen.getByRole('alertdialog').textContent ?? '';
    expect(ask).toMatch(/overwritten/i);
    expect(ask).toMatch(/cannot get it back/i);
  });

  test('a first-time store does NOT claim anything is being destroyed', () => {
    manage([conn({ status: 'MISSING' })]);
    fireEvent.click(screen.getByRole('button', { name: /^Set it up$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Store$/ }));

    const ask = screen.getByRole('alertdialog').textContent ?? '';
    expect(ask).not.toMatch(/overwritten/i);
    expect(ask).toMatch(/Windows holds it/i);
  });

  test('the provider AND the environment are both named before the write', () => {
    manage([conn({ environment: 'production', provider: 'github', reference: 'ProjectOS/demo/production/github/token' })]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));

    const ask = screen.getByRole('alertdialog').textContent ?? '';
    expect(ask).toContain('GitHub');
    expect(ask).toContain('production');
  });
});

describe('the write targets the row the owner is actually looking at', () => {
  test('a production row writes to production — not to a hard-wired development', async () => {
    // THE ORIGINAL DEFECT, pinned. The old surface rebuilt its reference with the literal
    // 'development' regardless of which row the owner had in front of them.
    const invoke = manage([
      conn({ environment: 'production', provider: 'openai', reference: 'ProjectOS/demo/production/openai/api-key' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Yes, replace$/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0]![1]).toMatchObject({
      reference: 'ProjectOS/demo/production/openai/api-key',
      replace: true,
    });
  });

  test('with several environments on file, each row keeps its own reference', async () => {
    const invoke = manage([
      conn({ environment: 'development', reference: 'ProjectOS/demo/development/openai/api-key' }),
      conn({ environment: 'production', reference: 'ProjectOS/demo/production/openai/api-key' }),
    ]);
    // The SECOND row's control, which is the production one. The other row keeps its own Replace
    // while this one is open, so the submit is addressed inside the writer rather than by name
    // alone — a test that clicked the wrong Replace would prove nothing.
    fireEvent.click(screen.getAllByRole('button', { name: /^Replace$/ })[1]!);
    const writer = within(document.querySelector('.ux-credwrite') as HTMLElement);
    fireEvent.change(writer.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(writer.getByRole('button', { name: /^Replace$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Yes, replace$/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0]![1]).toMatchObject({
      reference: 'ProjectOS/demo/production/openai/api-key',
    });
  });

  test('"Add a connection" never sends replace: true — an add is not a silent overwrite', async () => {
    const invoke = manage([]);
    fireEvent.click(screen.getByRole('button', { name: /^Add connection$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Store$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Yes, store$/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0]![1]).toMatchObject({ replace: false });
  });

  test('the environment an add will use is on screen before the owner types anything', () => {
    manage([conn({ environment: 'production', reference: 'ProjectOS/demo/production/openai/api-key' })]);
    const select = screen.getByLabelText('Environment') as HTMLSelectElement;
    // Derived from what is actually on file, never assumed. One environment means one fixed option.
    expect(select.value).toBe('production');
    expect(select.disabled).toBe(true);
  });

  test('with two environments on file the owner chooses, and the choice is what is written', async () => {
    const invoke = manage([
      conn({ environment: 'development', reference: 'ProjectOS/demo/development/openai/api-key' }),
      conn({ environment: 'production', reference: 'ProjectOS/demo/production/openai/api-key' }),
    ]);
    const select = screen.getByLabelText('Environment') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: 'production' } });

    const service = screen.getByLabelText('Service') as HTMLSelectElement;
    fireEvent.change(service, { target: { value: 'github' } });

    fireEvent.click(screen.getByRole('button', { name: /^Add connection$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Store$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Yes, store$/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0]![1]).toMatchObject({
      reference: 'ProjectOS/demo/production/github/token',
      replace: false,
    });
  });
});

describe('the secret never appears anywhere but the masked field', () => {
  test('the field is a password field, and the value is in no other node', () => {
    manage([conn()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    const field = screen.getByLabelText(/key for/i) as HTMLInputElement;
    fireEvent.change(field, { target: { value: SYNTHETIC } });

    expect(field.type).toBe('password');
    // `textContent` never includes an input's value, so a value that shows up here has been copied
    // into a node it does not belong in — a label, a confirmation, a status line.
    expect(document.body.textContent ?? '').not.toContain(SYNTHETIC);
  });

  test('the confirmation quotes the provider, never the value', () => {
    manage([conn()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    expect(screen.getByRole('alertdialog').textContent ?? '').not.toContain(SYNTHETIC);
  });

  test('the outcome message quotes the provider, never the value', async () => {
    manage([conn()]);
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.change(screen.getByLabelText(/key for/i), { target: { value: SYNTHETIC } });
    fireEvent.click(screen.getByRole('button', { name: /^Replace$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Yes, replace$/ }));

    await waitFor(() => expect(screen.getByText(/Windows is holding/i)).toBeTruthy());
    expect(document.body.textContent ?? '').not.toContain(SYNTHETIC);
  });
});

describe('removal is stated as absent rather than drawn as a control', () => {
  test('there is no remove control, and the reason is written out', () => {
    manage([conn()]);
    expect(screen.queryByRole('button', { name: /remove|delete/i })).toBe(null);
    expect(screen.getByText(/cannot remove a stored key/i)).toBeTruthy();
  });
});
