/**
 * Owner Chat action recognition — matchActionIntent.
 *
 * Pure function, tested directly: given a question and a live GovernedProjection, it must suggest a
 * governed command only when the phrase matches AND the target is unambiguous, and never guess
 * between candidates or suggest starting a run that is already active.
 */
import { describe, test, expect } from 'vitest';
import { matchActionIntent } from '../src/owner/ownerChatActions';
import type { GovernedPhaseView, GovernedPlanDraftView, GovernedProjection } from '../src/governed/types';

function phase(over: Partial<GovernedPhaseView> = {}): GovernedPhaseView {
  return {
    phaseId: 'PHASE1A',
    description: '',
    status: 'not-started',
    dependsOn: [],
    unmetDependencies: [],
    startable: true,
    requiredOwnerGates: [],
    requiredBrowserProof: false,
    history: [],
    closedByRecord: false,
    ...over,
  };
}

function draft(over: Partial<GovernedPlanDraftView> = {}): GovernedPlanDraftView {
  return { draftId: 'draft-1', planStatus: 'PLAN DRAFTED', generatedAt: '2026-08-25T08:00:00Z', decisionState: 'approved', decisionId: 'DEC-1', ...over };
}

function live(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'projectos',
    projectName: 'ProjectOS',
    repository: { repo: 'x/x', localPath: 'C:/x', branch: 'main', head: 'a'.repeat(40), protectedBranches: ['main'], onProtectedBranch: false },
    plan: { planId: 'p', planVersion: '1.0', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: 'plan.json', supersedes: null },
    programme: { acceptedPhaseCount: 0, totalPhaseCount: 1, completionPercentage: 0, completedPhases: [], pendingPhases: [] },
    phases: [],
    activePhase: null,
    nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude Code', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: { configured: false, budget: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    pendingApprovals: [],
    planDrafts: [],
    sessions: [],
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: '',
    observedAt: '2026-08-25T09:00:00Z',
    ...over,
  } as GovernedProjection;
}

describe('starting execution from chat', () => {
  test('recognises a start phrase against a startable active phase', () => {
    const action = matchActionIntent('please start the phase', live({ activePhase: phase() }), false);
    expect(action).toEqual({ verb: 'run.start', args: { phaseId: 'PHASE1A' }, label: 'Start governed execution for PHASE1A' });
  });

  test('does not suggest starting when a run is already active', () => {
    const action = matchActionIntent('start the phase', live({ activePhase: phase() }), true);
    expect(action).toBeNull();
  });

  test('does not suggest starting when the phase is not startable', () => {
    const action = matchActionIntent('start the phase', live({ activePhase: phase({ startable: false }) }), false);
    expect(action).toBeNull();
  });

  test('does not suggest starting when there is no active or startable phase', () => {
    const action = matchActionIntent('start the phase', live(), false);
    expect(action).toBeNull();
  });

  test('an unrelated question suggests nothing', () => {
    expect(matchActionIntent('what is the plan status?', live({ activePhase: phase() }), false)).toBeNull();
  });
});

describe('activating a plan from chat', () => {
  test('recognises an activate phrase against exactly one approved draft', () => {
    const action = matchActionIntent('activate the plan', live({ planDrafts: [draft()] }), false);
    expect(action).toEqual({ verb: 'plan.activate', args: { draftId: 'draft-1', decisionId: 'DEC-1' }, label: 'Activate plan draft-1' });
  });

  test('refuses to guess when more than one draft is approved', () => {
    const action = matchActionIntent(
      'activate the plan',
      live({ planDrafts: [draft(), draft({ draftId: 'draft-2', decisionId: 'DEC-2' })] }),
      false,
    );
    expect(action).toBeNull();
  });

  test('suggests nothing when no draft is approved', () => {
    const action = matchActionIntent('activate the plan', live({ planDrafts: [draft({ decisionState: 'none', decisionId: null })] }), false);
    expect(action).toBeNull();
  });
});

describe('robustness', () => {
  test('an empty question suggests nothing', () => {
    expect(matchActionIntent('   ', live({ activePhase: phase() }), false)).toBeNull();
  });
});
