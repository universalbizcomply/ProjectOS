// @vitest-environment jsdom
/**
 * THE OWNER'S DECISION IS COMMITTED. IT MUST HAPPEN ONCE, AND ONLY WHEN MEANT.
 *
 * `plan.decide` records an authority and commits it. That makes a double dispatch materially
 * different from a double read: two presses would ask the runtime to decide something already
 * decided, and an accidental press records a decision nobody took. So the surface asks a second
 * question, dispatches exactly once, and lets Escape take it all back.
 *
 * These drive the real screen against a spied client. NO PROVIDER CALL IS MADE — `plan.decide`
 * records a decision and spends nothing, and every dispatch here is intercepted anyway.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PlansScreen } from '../src/ux/PlansScreen';
import * as governedClient from '../src/governed/governedClient';
import type { GovernedProjection, GovernedPlanDraftView } from '../src/governed/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function projection(drafts: readonly GovernedPlanDraftView[], over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'polygo',
    projectName: 'PolyGo',
    repository: { repo: 'acme/polygo', localPath: 'C:/dev/polygo', branch: 'main', head: 'a'.repeat(40), protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'P', planVersion: '', declaredStatus: '', ready: false, unmetReasons: [], planPath: '', supersedes: null },
    programme: { acceptedPhaseCount: 0, totalPhaseCount: 0, completionPercentage: 0, completedPhases: [], pendingPhases: [] },
    phases: [],
    activePhase: null,
    nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: { configured: false, budget: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    pendingApprovals: [],
    planDrafts: drafts,
    sessions: [],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: '',
    observedAt: '2026-08-27T19:59:00.000Z',
    ...over,
  } as GovernedProjection;
}

const undecided: GovernedPlanDraftView = {
  draftId: 'D1',
  planStatus: 'PROPOSAL',
  generatedAt: '2026-08-27T18:00:00.000Z',
  decisionState: 'none',
  decisionId: null,
  origin: 'authored',
} as GovernedPlanDraftView;

function renderPlans(state: GovernedProjection) {
  return render(<PlansScreen state={state} onOpenPlan={() => {}} onRequestChange={() => {}} />);
}

describe('approving asks first, then commits exactly once', () => {
  test('pressing Approve dispatches NOTHING until the second question is answered', () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: ['recorded'] });
    renderPlans(projection([undecided]));
    fireEvent.click(screen.getByRole('button', { name: 'Approve only' }));
    expect(screen.getByText('Approve this plan?')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  test('confirming dispatches plan.decide with the draft id and approve, and nothing else', async () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: ['recorded'] });
    renderPlans(projection([undecided]));
    fireEvent.click(screen.getByRole('button', { name: 'Approve only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Approve' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [, verb, args] = spy.mock.calls[0]!;
    expect(verb).toBe('plan.decide');
    // No decider, no project, no digest, no path — the runtime derives every one of those.
    expect(args).toEqual({ draftId: 'D1', decision: 'approve' });
  });

  test('rejecting dispatches reject, once', async () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: ['recorded'] });
    renderPlans(projection([undecided]));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reject' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![2]).toEqual({ draftId: 'D1', decision: 'reject' });
  });

  test('a second confirm while the first is in flight dispatches nothing more', async () => {
    // The guard is a ref, so it is set in the same turn as the press — before React re-renders.
    let release: ((v: { ok: boolean; lines: string[] }) => void) | null = null;
    const spy = vi
      .spyOn(governedClient, 'requestGovernedCommand')
      .mockImplementation(() => new Promise((res) => { release = res; }) as ReturnType<typeof governedClient.requestGovernedCommand>);
    renderPlans(projection([undecided]));
    fireEvent.click(screen.getByRole('button', { name: 'Approve only' }));
    const confirm = screen.getByRole('button', { name: 'Confirm Approve' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledTimes(1);
    release?.({ ok: true, lines: ['recorded'] });
  });
});

describe('the question can always be taken back', () => {
  test('Cancel closes it and dispatches nothing', () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: [] });
    renderPlans(projection([undecided]));
    fireEvent.click(screen.getByRole('button', { name: 'Approve only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Approve this plan?')).toBe(null);
    expect(spy).not.toHaveBeenCalled();
  });

  test('Escape closes it and dispatches nothing', () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: [] });
    renderPlans(projection([undecided]));
    fireEvent.click(screen.getByRole('button', { name: 'Approve only' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Approve this plan?')).toBe(null);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('state decides what may be pressed', () => {
  test('an approved proposal offers no Approve at all', () => {
    renderPlans(projection([{ ...undecided, decisionState: 'approved', decisionId: 'DEC1' } as GovernedPlanDraftView]));
    expect(screen.queryByRole('button', { name: 'Approve only' })).toBe(null);
    expect(screen.getByRole('button', { name: 'Start this plan' })).toBeTruthy();
  });

  test('activating dispatches plan.activate with both identifiers', async () => {
    const spy = vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: true, lines: ['activated'] });
    renderPlans(projection([{ ...undecided, decisionState: 'approved', decisionId: 'DEC1' } as GovernedPlanDraftView]));
    fireEvent.click(screen.getByRole('button', { name: 'Start this plan' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![1]).toBe('plan.activate');
    expect(spy.mock.calls[0]![2]).toEqual({ draftId: 'D1', decisionId: 'DEC1' });
  });

  test('a rejected proposal can never be approved from this screen', () => {
    renderPlans(projection([{ ...undecided, decisionState: 'refused' } as GovernedPlanDraftView]));
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve only' })).toBe(null);
    expect(screen.queryByRole('button', { name: 'Start this plan' })).toBe(null);
  });

  test('a refusal from the runtime is shown as an alert, in its own words', async () => {
    vi.spyOn(governedClient, 'requestGovernedCommand').mockResolvedValue({ ok: false, lines: ['REFUSED: no committed decision'] });
    renderPlans(projection([undecided]));
    fireEvent.click(screen.getByRole('button', { name: 'Approve only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Approve' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('REFUSED: no committed decision');
  });
});

describe('an empty project says so', () => {
  test('no plan and no proposals renders the empty state, not a blank screen', () => {
    renderPlans(projection([]));
    expect(screen.getByText('No plans yet')).toBeTruthy();
  });
});
