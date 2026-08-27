/**
 * THE COMMAND SURFACE MUST NOT INVENT AUTHORITY.
 *
 * A box that takes a sentence is the easiest place in a product to promise something the engine
 * cannot do. These prove the resolver only ever produces one of the sixteen governed verbs, a piece
 * of navigation, an answer read from state, or a refusal that says what would have to change — and
 * that the three capabilities ProjectOS genuinely lacks are refused by name rather than guessed at.
 *
 * NO PROVIDER CALL IS POSSIBLE FROM HERE: nothing in this file resolves to `plan.draft`, and the
 * paid `authored` route is never constructed by the Control Center at all.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { describe, test, expect } from 'vitest';
import { resolveIntent } from '../src/ux/controlCenterModel';
import type { GovernedProjection, GovernedPlanDraftView } from '../src/governed/types';

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'polygo',
    projectName: 'PolyGo',
    repository: { repo: 'acme/polygo', localPath: 'C:/dev/polygo', branch: 'main', head: 'a'.repeat(40), protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'P', planVersion: '1.2', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: 'plan.json', supersedes: null },
    programme: { acceptedPhaseCount: 1, totalPhaseCount: 3, completionPercentage: 33, completedPhases: [], pendingPhases: [] },
    phases: [
      { phaseId: 'ONE', description: 'Specification', status: 'closed' },
      { phaseId: 'TWO', description: 'Existing system', status: 'implementing' },
    ],
    activePhase: { phaseId: 'TWO', description: 'Existing system', status: 'implementing' },
    nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: {
      configured: true,
      budget: { status: 'OK', spentThisMonthMicroUsd: 1, remainingMicroUsd: 9, warnAtMicroUsd: 8, hardStopAtMicroUsd: 10 },
      spentThisPhaseMicroUsd: 0,
      spentThisProjectMicroUsd: 0,
      callCount: 0,
      lastCall: null,
    },
    pendingApprovals: [],
    planDrafts: [],
    sessions: [],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: 'Continue TWO.',
    observedAt: '2026-08-27T19:59:00.000Z',
    ...over,
  } as GovernedProjection;
}

const undecided = {
  draftId: 'D1',
  planStatus: 'PROPOSAL',
  generatedAt: '2026-08-27T18:00:00.000Z',
  decisionState: 'none',
  decisionId: null,
  origin: 'authored',
} as GovernedPlanDraftView;

describe('capabilities ProjectOS does not have are refused by name', () => {
  test('upload is refused, and says why', () => {
    const i = resolveIntent('use this uploaded document', projection());
    expect(i.kind).toBe('refusal');
    if (i.kind !== 'refusal') return;
    expect(i.lines.join(' ')).toContain('cannot take files');
  });

  test('revising an approved plan is refused, and names the honest route', () => {
    const i = resolveIntent('modify step 4', projection());
    expect(i.kind).toBe('refusal');
    if (i.kind !== 'refusal') return;
    expect(i.lines.join(' ')).toContain('no governed command that revises a plan');
  });

  test('closing a phase is refused, because closure is not the product\u2019s to give', () => {
    const i = resolveIntent('close this phase', projection());
    expect(i.kind).toBe('refusal');
    if (i.kind !== 'refusal') return;
    expect(i.lines.join(' ')).toContain('yours alone');
  });
});

describe('every command resolves to a real verb with real arguments', () => {
  test('approve resolves to plan.decide for the proposal actually waiting', () => {
    const i = resolveIntent('approve this plan', projection({ planDrafts: [undecided] }));
    expect(i.kind).toBe('command');
    if (i.kind !== 'command') return;
    expect(i.verb).toBe('plan.decide');
    expect(i.args).toEqual({ draftId: 'D1', decision: 'approve' });
  });

  test('approve with nothing waiting refuses rather than guessing a draft', () => {
    const i = resolveIntent('approve this plan', projection());
    expect(i.kind).toBe('refusal');
  });

  test('continue resolves to a run verb carrying the arguments the channel requires', () => {
    const i = resolveIntent('continue this plan', projection({
      sessions: [{ sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: '2026-08-27T19:00:00.000Z', state: 'exited', exitCode: 1 }],
    }));
    expect(i.kind).toBe('command');
    if (i.kind !== 'command') return;
    expect(i.verb).toBe('run.resume');
    expect(i.args).toEqual({ phaseId: 'TWO', sessionId: 'S1' });
  });

  test('pause with nothing running refuses', () => {
    const i = resolveIntent('pause this plan', projection());
    expect(i.kind).toBe('refusal');
  });

  test('a stopped budget refuses with the budget reason, not a generic one', () => {
    const i = resolveIntent('continue', projection({
      gatekeeperStatus: {
        configured: true,
        budget: { status: 'STOPPED', spentThisMonthMicroUsd: 10, remainingMicroUsd: 0, warnAtMicroUsd: 8, hardStopAtMicroUsd: 10 },
        spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 10, callCount: 1, lastCall: null,
      },
    }));
    expect(i.kind).toBe('refusal');
    if (i.kind !== 'refusal') return;
    expect(i.lines.join(' ')).toContain('spending limit');
  });

  test('NOTHING resolves to plan.draft — the paid route is never built here', () => {
    for (const said of ['start something new', 'i want to build a booking panel', 'new plan', 'continue', 'approve']) {
      const i = resolveIntent(said, projection({ planDrafts: [undecided] }));
      if (i.kind === 'command') expect(i.verb).not.toBe('plan.draft');
    }
  });
});

describe('questions are answered from what is already known', () => {
  test('why is this blocked reports the real reasons', () => {
    const i = resolveIntent('why is this blocked?', projection({ blockers: ['git is unreachable'] }));
    expect(i.kind).toBe('answer');
    if (i.kind !== 'answer') return;
    expect(i.lines).toContain('git is unreachable');
  });

  test('with nothing blocked it says so, and gives the runtime\u2019s own next action', () => {
    const i = resolveIntent('why is this blocked?', projection());
    expect(i.kind).toBe('answer');
    if (i.kind !== 'answer') return;
    expect(i.lines.join(' ')).toContain('Continue TWO.');
  });

  test('show me what happened navigates rather than dispatching', () => {
    const i = resolveIntent('show me what happened', projection());
    expect(i.kind).toBe('navigate');
  });

  test('spending is ANSWERED with the ledger figures, not sent to a screen that does not exist', () => {
    const i = resolveIntent('what am I spending?', projection());
    expect(i.kind).toBe('answer');
    if (i.kind !== 'answer') return;
    expect(i.lines[0]).toContain('Spent this month');
  });

  test('with no budget configured it says so rather than printing zero', () => {
    const i = resolveIntent('what is my budget?', projection({
      gatekeeperStatus: { configured: false, budget: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    }));
    expect(i.kind).toBe('answer');
    if (i.kind !== 'answer') return;
    expect(i.lines.join(' ')).toContain('No spending limit is configured');
  });
});

describe('without a projection nothing is dispatched', () => {
  test('any command refuses, because there is nothing to act on', () => {
    const i = resolveIntent('continue this plan', null);
    expect(i.kind).toBe('refusal');
    if (i.kind !== 'refusal') return;
    expect(i.lines.join(' ')).toContain('has not reported');
  });

  test('empty input asks for input rather than dispatching', () => {
    expect(resolveIntent('   ', projection()).kind).toBe('refusal');
  });

  test('an unrecognised sentence suggests what does work', () => {
    const i = resolveIntent('make me a sandwich', projection());
    expect(i.kind).toBe('refusal');
    if (i.kind !== 'refusal') return;
    expect(i.lines.join(' ')).toContain('continue this plan');
  });
});
