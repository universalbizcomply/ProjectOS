/**
 * THE OWNER-STATE MAPPING, PROVED ROW BY ROW.
 *
 * Eleven phase statuses, four decision states and a programme counter collapse into a handful of
 * owner words. That collapsing is where a product lies to somebody: by calling a stalled plan
 * "Working", by offering Run on something the engine will refuse, by inventing a percentage, or by
 * letting rejected material be approved after the fact.
 *
 * Every one of those is a test here.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { describe, test, expect } from 'vitest';
import { buildPlansModel } from '../src/ux/planStateModel';
import type { GovernedProjection, GovernedPlanDraftView } from '../src/governed/types';

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'polygo',
    projectName: 'PolyGo',
    repository: {
      repo: 'acme/polygo',
      localPath: 'C:/dev/polygo',
      branch: 'main',
      head: 'a'.repeat(40),
      protectedBranches: ['main'],
      onProtectedBranch: false,
    },
    plan: {
      planId: 'PLAN1',
      planVersion: '1.2',
      declaredStatus: 'PLAN READY',
      ready: true,
      unmetReasons: [],
      planPath: 'plan.json',
      supersedes: null,
    },
    programme: {
      acceptedPhaseCount: 1,
      totalPhaseCount: 3,
      completionPercentage: 33,
      completedPhases: [],
      pendingPhases: [],
    },
    phases: [
      { phaseId: 'ONE', description: 'Specification', status: 'closed' },
      { phaseId: 'TWO', description: 'Existing system', status: 'implementing' },
      { phaseId: 'THREE', description: 'Prove', status: 'not-started' },
    ],
    activePhase: { phaseId: 'TWO', description: 'Existing system', status: 'implementing' },
    nextStartablePhase: null,
    authority: {
      owner: 'Murad',
      gatekeeper: 'ChatGPT',
      implementer: 'Claude',
      closureAuthority: 'ChatGPT',
      closureDelegation: null,
      ownerOnlyActions: [],
    },
    gatekeeperStatus: {
      configured: true,
      budget: {
        status: 'OK',
        spentThisMonthMicroUsd: 1000,
        remainingMicroUsd: 9000,
        warnAtMicroUsd: 8000,
        hardStopAtMicroUsd: 10000,
      },
      spentThisPhaseMicroUsd: 0,
      spentThisProjectMicroUsd: 1000,
      callCount: 1,
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

function draft(over: Partial<GovernedPlanDraftView> = {}): GovernedPlanDraftView {
  return {
    draftId: 'D1',
    planStatus: 'PROPOSAL',
    generatedAt: '2026-08-27T18:00:00.000Z',
    decisionState: 'none',
    decisionId: null,
    origin: 'authored',
    ...over,
  } as GovernedPlanDraftView;
}

const ids = (r: { actions: readonly { id: string }[] }): string[] => r.actions.map((a) => a.id);

describe('the active plan maps to one owner word, in a defined order', () => {
  test('a finished programme is Completed whatever else is true', () => {
    const m = buildPlansModel(
      projection({
        programme: { acceptedPhaseCount: 3, totalPhaseCount: 3, completionPercentage: 100, completedPhases: [], pendingPhases: [] },
        blockers: ['something else'],
      }),
    );
    expect(m.rows[0]?.state).toBe('Completed');
    expect(m.rows[0]?.group).toBe('completed');
  });

  test('a plan that does not recompute ready is Blocked, and is offered NO run control', () => {
    const m = buildPlansModel(
      projection({
        plan: { planId: 'P', planVersion: '1.2', declaredStatus: 'PLAN DRAFTED', ready: false, unmetReasons: ['no approval decision'], planPath: 'p.json', supersedes: null },
      }),
    );
    const row = m.rows[0];
    expect(row?.state).toBe('Blocked');
    expect(row?.reasons).toContain('no approval decision');
    expect(ids(row!)).toEqual(['open']);
  });

  test('a recorded blocker blocks even when the plan is ready', () => {
    const m = buildPlansModel(projection({ blockers: ['git is unreachable'] }));
    expect(m.rows[0]?.state).toBe('Blocked');
    expect(ids(m.rows[0]!)).toEqual(['open']);
  });

  test('an implementing phase with NO session is Ready to continue, not Working', () => {
    const m = buildPlansModel(projection());
    expect(m.rows[0]?.state).toBe('Ready to continue');
  });

  test('a live session for the active phase is what makes it Working, and offers Pause', () => {
    const m = buildPlansModel(
      projection({
        sessions: [{ sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: '2026-08-27T19:00:00.000Z', state: 'started', exitCode: null }],
      }),
    );
    const row = m.rows[0];
    expect(row?.state).toBe('Working');
    expect(ids(row!)).toEqual(['open', 'pause']);
    expect(row?.actions.find((a) => a.id === 'pause')?.verb).toBe('run.stop');
  });

  test('an exited session is not work in flight', () => {
    const m = buildPlansModel(
      projection({
        sessions: [{ sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: '2026-08-27T19:00:00.000Z', state: 'exited', exitCode: 0 }],
      }),
    );
    expect(m.rows[0]?.state).toBe('Ready to continue');
    // It has a session on record, so continuing is a resume rather than a fresh start.
    expect(m.rows[0]?.actions.find((a) => a.id === 'resume')?.verb).toBe('run.resume');
  });
});

describe('no action is offered that the engine would refuse', () => {
  test('a stopped budget disables the run control and says why', () => {
    const m = buildPlansModel(
      projection({
        gatekeeperStatus: {
          configured: true,
          budget: { status: 'STOPPED', spentThisMonthMicroUsd: 10000, remainingMicroUsd: 0, warnAtMicroUsd: 8000, hardStopAtMicroUsd: 10000 },
          spentThisPhaseMicroUsd: 0,
          spentThisProjectMicroUsd: 10000,
          callCount: 9,
          lastCall: null,
        },
      }),
    );
    const start = m.rows[0]?.actions.find((a) => a.id === 'pause');
    expect(start?.enabled).toBe(false);
    expect(start?.disabledReason).toContain('spending limit');
  });

  test('every action that acts names a governed verb; only navigation has none', () => {
    const m = buildPlansModel(projection({ planDrafts: [draft(), draft({ draftId: 'D2', decisionState: 'approved', decisionId: 'X1' })] }));
    for (const row of m.rows) {
      for (const a of row.actions) {
        if (a.id === 'open' || a.id === 'evidence') expect(a.verb).toBe(null);
        else expect(a.verb).not.toBe(null);
      }
    }
  });
});

describe('every action carries the arguments its verb requires', () => {
  test('Resume names the session it would rejoin — the channel REQUIRES one', () => {
    const m = buildPlansModel(
      projection({
        sessions: [
          { sessionId: 'S-OLD', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: '2026-08-27T17:00:00.000Z', state: 'exited', exitCode: 1 },
          { sessionId: 'S-NEW', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: '2026-08-27T19:00:00.000Z', state: 'exited', exitCode: 1 },
        ],
      }),
    );
    const resume = m.rows[0]?.actions.find((a) => a.id === 'resume');
    expect(resume?.verb).toBe('run.resume');
    // The most recent session for the phase in play, and the phase with it.
    expect(resume?.args).toEqual({ phaseId: 'TWO', sessionId: 'S-NEW' });
  });

  test('Start and Pause carry the phase, and never a session they do not have', () => {
    const start = buildPlansModel(projection()).rows[0]?.actions.find((a) => a.id === 'pause');
    expect(start?.verb).toBe('run.start');
    expect(start?.args).toEqual({ phaseId: 'TWO' });

    const working = buildPlansModel(
      projection({
        sessions: [{ sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: '2026-08-27T19:00:00.000Z', state: 'started', exitCode: null }],
      }),
    ).rows[0]?.actions.find((a) => a.id === 'pause');
    expect(working?.verb).toBe('run.stop');
    expect(working?.args).toEqual({ phaseId: 'TWO' });
  });

  test('a decision action carries the draft and the verdict', () => {
    const m = buildPlansModel(projection({ planDrafts: [draft()] }));
    const row = m.rows.find((r) => r.kind === 'draft');
    expect(row?.actions.find((a) => a.id === 'approve')?.args).toEqual({ draftId: 'D1', decision: 'approve' });
    expect(row?.actions.find((a) => a.id === 'reject')?.args).toEqual({ draftId: 'D1', decision: 'reject' });
  });
});

describe('proposals carry the decision the frozen core added', () => {
  test('an undecided proposal offers Approve and Reject, both through plan.decide', () => {
    const m = buildPlansModel(projection({ planDrafts: [draft()] }));
    const row = m.rows.find((r) => r.kind === 'draft');
    expect(row?.state).toBe('Needs your decision');
    expect(row?.needsOwnerDecision).toBe(true);
    expect(ids(row!)).toEqual(['open', 'approve', 'reject']);
    expect(row?.actions.find((a) => a.id === 'approve')?.verb).toBe('plan.decide');
    expect(row?.actions.find((a) => a.id === 'reject')?.verb).toBe('plan.decide');
  });

  test('an APPROVED proposal is not offered Approve again, and activates instead', () => {
    const m = buildPlansModel(projection({ planDrafts: [draft({ decisionState: 'approved', decisionId: 'DEC1' })] }));
    const row = m.rows.find((r) => r.kind === 'draft');
    expect(row?.state).toBe('Approved — not started');
    expect(ids(row!)).toEqual(['open', 'activate']);
    expect(row?.actions.find((a) => a.id === 'activate')?.verb).toBe('plan.activate');
    expect(row?.decisionId).toBe('DEC1');
  });

  test('approved but with no decision id cannot be activated, and says so', () => {
    const m = buildPlansModel(projection({ planDrafts: [draft({ decisionState: 'approved', decisionId: null })] }));
    const act = m.rows.find((r) => r.kind === 'draft')?.actions.find((a) => a.id === 'activate');
    expect(act?.enabled).toBe(false);
    expect(act?.disabledReason).toContain('cannot find the decision');
  });

  test('a REJECTED proposal can never be re-approved from the list', () => {
    const m = buildPlansModel(projection({ planDrafts: [draft({ decisionState: 'refused' })] }));
    const row = m.rows.find((r) => r.kind === 'draft');
    expect(row?.state).toBe('Rejected');
    expect(ids(row!)).toEqual(['open']);
    expect(ids(row!)).not.toContain('approve');
  });

  test('a consumed proposal is not shown twice — it IS the active plan now', () => {
    const m = buildPlansModel(projection({ planDrafts: [draft({ decisionState: 'consumed' })] }));
    expect(m.rows.filter((r) => r.kind === 'draft')).toEqual([]);
  });

  test('origin is reported as the record states it', () => {
    const m = buildPlansModel(projection({ planDrafts: [draft({ origin: 'import' })] }));
    expect(m.rows.find((r) => r.kind === 'draft')?.origin).toBe('import');
  });
});

describe('no percentage without a denominator', () => {
  test('the active plan reports real counts', () => {
    const m = buildPlansModel(projection());
    expect(m.rows[0]?.progress).toEqual({ done: 1, total: 3 });
  });

  test('a programme with no phases reports no progress at all', () => {
    const m = buildPlansModel(
      projection({ programme: { acceptedPhaseCount: 0, totalPhaseCount: 0, completionPercentage: 0, completedPhases: [], pendingPhases: [] } }),
    );
    expect(m.rows[0]?.progress).toBe(null);
  });

  test('a proposal has no phases, so it has no progress', () => {
    const m = buildPlansModel(projection({ planDrafts: [draft()] }));
    expect(m.rows.find((r) => r.kind === 'draft')?.progress).toBe(null);
  });
});

describe('a project with nothing recorded says so', () => {
  test('no plan version and no drafts is empty', () => {
    const m = buildPlansModel(
      projection({
        plan: { planId: '', planVersion: '', declaredStatus: '', ready: false, unmetReasons: [], planPath: '', supersedes: null },
      }),
    );
    expect(m.empty).toBe(true);
    expect(m.rows).toEqual([]);
  });
});
