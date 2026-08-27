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
import { buildPlansModel } from '../src/ux/planStateModel';
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

  test('pause with nothing running refuses, and calls it stopping', () => {
    const i = resolveIntent('pause this plan', projection());
    expect(i.kind).toBe('refusal');
    if (i.kind !== 'refusal') return;
    expect(i.lines.join(' ')).toContain('nothing to stop');
  });

  test('saying "pause" is answered truthfully: it STOPS the run, and says so', () => {
    // The owner's word is accepted; the promise is not. `run.stop` force-kills the run's process
    // tree, so the reply must not tell them work is being held for later.
    const i = resolveIntent('pause this plan', projection({
      sessions: [{ sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: '2026-08-27T19:00:00.000Z', state: 'started', exitCode: null }],
    }));
    expect(i.kind).toBe('command');
    if (i.kind !== 'command') return;
    expect(i.verb).toBe('run.stop');
    // The honest wording moved into the question the owner must answer before it is sent.
    expect(i.confirm).toContain('ends it rather than holding it');
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

describe('review findings — each one has a test so it cannot come back', () => {
  test('HIGH: an action word beats a navigation phrase ("approve the active plan")', () => {
    // Was resolved as "open the plan": the approval was never dispatched, no confirmation appeared,
    // and the transcript said "Opening the plan." as though it had worked.
    const i = resolveIntent('approve the active plan', projection({ planDrafts: [undecided] }));
    expect(i.kind).toBe('command');
    if (i.kind !== 'command') return;
    expect(i.verb).toBe('plan.decide');
    expect(i.args).toEqual({ draftId: 'D1', decision: 'approve' });
  });

  test('HIGH: the same collision for reject, stop and continue', () => {
    const withRun = projection({
      planDrafts: [undecided],
      sessions: [{ sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: '2026-08-27T19:00:00.000Z', state: 'started', exitCode: null }],
    });
    expect(resolveIntent('reject the active plan', withRun).kind).toBe('command');
    expect(resolveIntent('stop the active plan', withRun).kind).toBe('command');
    // "Continue" needs something continuable: a plan already RUNNING is correctly refused, so the
    // collision is proven against a stopped session instead.
    const stopped = projection({
      planDrafts: [undecided],
      sessions: [{ sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: '2026-08-27T19:00:00.000Z', state: 'exited', exitCode: 0 }],
    });
    expect(resolveIntent('continue the active plan', stopped).kind).toBe('command');
  });

  test('HIGH: a word inside another word is NOT a command', () => {
    // "running", "restart", "nonstop" all matched by substring, and two of them spend real money.
    for (const said of ["i'm running late", "let's restart the conversation tomorrow", 'we went nonstop']) {
      const i = resolveIntent(said, projection({
        sessions: [{ sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: '2026-08-27T19:00:00.000Z', state: 'exited', exitCode: 0 }],
      }));
      expect(i.kind).not.toBe('command');
    }
  });

  test('MEDIUM: a negated approval is not an approval', () => {
    for (const said of ['do not approve this plan', "don't approve it", 'never approve this']) {
      const i = resolveIntent(said, projection({ planDrafts: [undecided] }));
      expect(i.kind).toBe('command');
      if (i.kind !== 'command') continue;
      expect(i.args['decision']).toBe('reject');
    }
  });

  test('every governed command carries the question it must ask first', () => {
    const withRun = projection({
      planDrafts: [undecided],
      sessions: [{ sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: '2026-08-27T19:00:00.000Z', state: 'started', exitCode: null }],
    });
    for (const said of ['approve this plan', 'reject this plan', 'stop the run', 'continue']) {
      const i = resolveIntent(said, withRun);
      if (i.kind !== 'command') continue;
      expect(i.confirm).toBeTruthy();
    }
  });
});

describe('the Stop question promises only what is always true', () => {
  const running = projection({
    sessions: [{ sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: '2026-08-27T19:00:00.000Z', state: 'started', exitCode: null }],
  });

  test('it does NOT promise the session can be resumed', () => {
    /*
     * PROVEN AGAINST THE ENGINE, NOT ASSUMED. `run.stop` force-kills the process tree, and the loop
     * persists a session record at exactly one point — AFTER a worker attempt returns
     * (`agent/src/loop/runner.ts:849`). A run stopped during its first attempt never writes one, and
     * `--resume --session` refuses an id with no record (`NO_SUCH_SESSION`, runner.ts:375). So a
     * resume is available SOMETIMES, and a promise of it would be false exactly when the owner most
     * needs the truth.
     */
    const i = resolveIntent('stop the run', running);
    expect(i.kind).toBe('command');
    if (i.kind !== 'command') return;
    expect(i.confirm).toBeTruthy();
    expect(i.confirm).not.toContain('resume');
    expect(i.confirm).toContain('start the work again');
    expect(i.confirm).toContain('already recorded is kept');
  });

  test('Resume is offered ONLY where a session record actually exists', () => {
    // With a record on file, resume is the honest continuation and is offered by name.
    const withRecord = buildPlansModel(projection({
      sessions: [{ sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: '2026-08-27T19:00:00.000Z', state: 'exited', exitCode: 0 }],
    }));
    expect(withRecord.rows[0]?.actions.find((a) => a.id === 'resume')?.verb).toBe('run.resume');

    // With none, continuing is a fresh start — never a resume against an id that does not exist.
    const withoutRecord = buildPlansModel(projection());
    expect(withoutRecord.rows[0]?.actions.find((a) => a.id === 'resume')).toBeUndefined();
    expect(withoutRecord.rows[0]?.actions.find((a) => a.id === 'start')?.verb).toBe('run.start');
  });
});
