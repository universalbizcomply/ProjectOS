// @vitest-environment jsdom
/**
 * AN APPROVAL IS NEVER RECORDED FROM ONE CLICK.
 *
 * `approval.decide` is the verb that permits a PROTECTED action — a production change, a real send,
 * a payment, the use of a live key. The Action Inbox dispatched it straight from its Approve and
 * Reject buttons, and the record it writes is permanent: ProjectOS records that the owner said so,
 * and there is no verb that un-says it. A mis-click on the wrong row of a pending list therefore
 * authorised something irreversibly, silently, and in the owner's name.
 *
 * The inbox is REACHABLE — it is the "Needs You" panel on the project Overview — so this was the one
 * remaining hole in the accepted confirmation model, which Plans and the Control Center already
 * closed for every other verb.
 *
 * The bridge is mocked throughout and asserted on. No approval is ever really decided.
 *
 * Created in PROJECTOS-CONTROL-CENTER-INTEGRATION1A.
 */
import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { OwnerActionInbox } from '../src/owner/OwnerActionInbox';
import { tauriBridge } from '../src/daemon/tauriBridge';
import type { GovernedApprovalView, GovernedProjection } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const approval = (over: Partial<GovernedApprovalView> = {}): GovernedApprovalView =>
  ({
    id: 'APR-1',
    action: 'production.deploy',
    risk: 'protected',
    requestedBy: 'claude',
    requestedAt: '2026-08-28T09:00:00.000Z',
    gated: true,
    prohibited: false,
    ...over,
  }) as GovernedApprovalView;

function projection(pendingApprovals: readonly GovernedApprovalView[]): GovernedProjection {
  return {
    connected: true,
    projectId: 'demo',
    projectName: 'Demo',
    repository: { repo: 'acme/demo', localPath: 'C:/dev/demo', branch: 'main', head: 'a'.repeat(40), protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'P', planVersion: '1.0', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: 'plan.json', supersedes: null },
    programme: { acceptedPhaseCount: 0, totalPhaseCount: 1, completionPercentage: 0, completedPhases: [], pendingPhases: [] },
    phases: [], activePhase: null, nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: { configured: false, budget: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    pendingApprovals,
    planDrafts: [], sessions: [],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [], risks: [], nextSafeAction: 'Continue.',
    observedAt: '2026-08-28T09:00:00.000Z',
  } as GovernedProjection;
}

let invoke: ReturnType<typeof vi.spyOn>;
/**
 * The outcome channel, stubbed as well as `invoke`.
 *
 * `requestGovernedCommand` registers a listener on the BRIDGE's event channel BEFORE dispatching,
 * and the real `listen` dynamically imports `@tauri-apps/api/event`, which does not resolve under
 * jsdom. Stubbing `invoke` alone therefore made the dispatch throw before it happened, and a test
 * asserting "nothing was sent" would have passed for the wrong reason for ever.
 */
let emit: (payload: unknown) => void = () => {};
function inbox(items: readonly GovernedApprovalView[] = [approval()]) {
  render(<OwnerActionInbox state={projection(items)} />);
}

beforeEach(() => {
  vi.spyOn(tauriBridge, 'isTauri').mockReturnValue(true);
  const listeners = new Set<(payload: unknown) => void>();
  emit = (payload) => { for (const cb of listeners) cb(payload); };
  vi.spyOn(tauriBridge, 'listen').mockImplementation(async (_channel, cb) => {
    listeners.add(cb as (p: unknown) => void);
    return () => listeners.delete(cb as (p: unknown) => void);
  });
  invoke = vi.spyOn(tauriBridge, 'invoke').mockImplementation(async (command, args) => {
    if (command === 'daemon_governed_command') {
      const req = JSON.parse(String((args as Record<string, unknown>)['request'] ?? '{}')) as { correlationId?: string };
      setTimeout(() => emit({ kind: 'governed-result', correlationId: String(req.correlationId ?? ''), code: 0, lines: ['(test) accepted.'] }), 0);
    }
    return undefined;
  });
});

describe('the first press asks; only the second decides', () => {
  test('pressing Approve sends nothing', () => {
    inbox();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  test('pressing Reject sends nothing', () => {
    inbox();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  test('the second press is what reaches the runtime', async () => {
    inbox();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, approve' }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test('two presses inside one tick still decide ONCE', async () => {
    inbox();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const yes = screen.getByRole('button', { name: 'Yes, approve' });
    fireEvent.click(yes);
    fireEvent.click(yes);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('the owner can back out', () => {
  test('Cancel decides nothing and restores the choice', () => {
    inbox();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  test('Escape cancels too', () => {
    inbox();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBe(null);
  });
});

describe('the question says what is about to be recorded', () => {
  test('it names the action and says the record is permanent', () => {
    inbox([approval({ action: 'payment.capture' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const ask = screen.getByRole('alertdialog').textContent ?? '';
    expect(ask).toContain('payment.capture');
    expect(ask).toMatch(/recorded permanently/i);
    expect(ask).toMatch(/cannot be taken back/i);
  });

  test('rejecting says what rejecting means, not what approving means', () => {
    inbox();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const ask = screen.getByRole('alertdialog').textContent ?? '';
    expect(ask).toMatch(/will not be performed/i);
    expect(ask).not.toMatch(/will be permitted/i);
  });

  test('the question is what a screen reader is given, and focus moves into it', () => {
    inbox();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('alertdialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent ?? '').toMatch(/cannot be taken back/i);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Yes, approve' }));
  });
});

describe('a prohibited action is still refused outright', () => {
  test('there is no Approve control at all, and so nothing to confirm', () => {
    inbox([approval({ prohibited: true })]);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBe(null);
    expect(screen.getByText(/prohibited and cannot be approved from here/i)).toBeTruthy();
  });
});
