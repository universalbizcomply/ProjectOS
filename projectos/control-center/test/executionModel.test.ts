/**
 * THE EXECUTION WORKSPACE'S RULES, PINNED.
 *
 * This screen answers eight questions at a glance, and every one of them is a claim. The rules that
 * keep those claims honest are held here:
 *
 *  - "Working" is present tense and needs a live process; a record on disk cannot say it.
 *  - A requirement is MET only when evidence for THIS step says so. Evidence from another phase
 *    ticks nothing, and an absent record is UNKNOWN, never a pass.
 *  - An owner gate is only offered as decidable when something exists that this screen can actually
 *    answer. Otherwise it says what the owner must really do.
 */
import { describe, test, expect } from 'vitest';
import {
  buildExecutionView,
  requirementsFor,
  stateOf,
  blockingFindings,
} from '../src/ux/executionModel';
import type {
  GovernedProjection,
  GovernedPhaseView,
  GovernedEvidenceView,
} from '../src/governed/types';

const NOW = Date.parse('2026-09-04T10:00:00.000Z');

function phase(over: Partial<GovernedPhaseView> = {}): GovernedPhaseView {
  return {
    phaseId: 'validation-cache',
    description: 'Deliver safe, local repository-scoped validation caching.',
    status: 'not-started',
    dependsOn: [],
    unmetDependencies: [],
    startable: true,
    requiredOwnerGates: [],
    requiredBrowserProof: false,
    acceptanceCriteria: ['Unknown dependency coverage fails toward execution.'],
    requiredValidators: ['validate-no-secrets'],
    requiredReviews: ['Security and privacy review'],
    riskLevel: 'high',
    autonomyLevel: 'gated-execution',
    history: [],
    closedByRecord: false,
    ...over,
  };
}

function evidence(over: Partial<GovernedEvidenceView> = {}): GovernedEvidenceView {
  return {
    phaseId: 'validation-cache',
    sessionId: 's1',
    collectedAt: '2026-09-04T09:48:19.725Z',
    checks: [{ id: 'validate-no-secrets', kind: 'validator', passed: true, at: '2026-09-04T09:46:47.200Z' }],
    reviewsRecorded: ['Security and privacy review'],
    findings: [],
    changedFileCount: 3,
    ...over,
  };
}

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'projectos',
    projectName: 'ProjectOS',
    repository: { repo: 'r', localPath: 'C:/dev/ProjectOS', branch: null, head: null, protectedBranches: [], onProtectedBranch: false },
    plan: { planId: 'p', planVersion: '1.3', declaredStatus: 'PLAN READY', ready: true, unmetReasons: [], planPath: 'p.json', supersedes: null },
    programme: { acceptedPhaseCount: 0, totalPhaseCount: 4, completionPercentage: 0, completedPhases: [], pendingPhases: [] },
    phases: [phase()],
    activePhase: null,
    nextStartablePhase: null,
    authority: { owner: 'Murad', gatekeeper: 'ChatGPT', implementer: 'Claude', closureAuthority: 'ChatGPT', closureDelegation: null, ownerOnlyActions: [] },
    gatekeeperStatus: { configured: true, budget: { status: 'OK', spentThisMonthMicroUsd: 1, remainingMicroUsd: 9, warnAtMicroUsd: 8, hardStopAtMicroUsd: 10 }, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
    pendingApprovals: [],
    planDrafts: [],
    sessions: [],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: '',
    observedAt: '2026-09-04T10:00:00.000Z',
    ...over,
  } as GovernedProjection;
}

const LIVE = { active: true, phaseId: 'validation-cache', startedAt: '2026-09-04T09:58:00.000Z', lines: ['attempt 1: started claude-local'] };

describe('a requirement is met only when evidence for THIS step says so', () => {
  test('a passing check for this phase is MET; a failing one is FAILED', () => {
    const met = requirementsFor(phase(), evidence(), new Set());
    expect(met.find((r) => r.kind === 'check')?.state).toBe('MET');

    const failed = requirementsFor(
      phase(),
      evidence({ checks: [{ id: 'validate-no-secrets', kind: 'validator', passed: false, at: 't' }] }),
      new Set(),
    );
    expect(failed.find((r) => r.kind === 'check')?.state).toBe('FAILED');
  });

  test('evidence from ANOTHER phase ticks nothing here', () => {
    const reqs = requirementsFor(phase(), evidence({ phaseId: 'doctor-preflight' }), new Set());
    expect(reqs.find((r) => r.kind === 'check')?.state).toBe('UNKNOWN');
    expect(reqs.find((r) => r.kind === 'review')?.state).toBe('UNKNOWN');
  });

  test('no evidence at all is UNKNOWN, never a pass', () => {
    const reqs = requirementsFor(phase(), null, new Set());
    for (const r of reqs.filter((x) => x.kind === 'check' || x.kind === 'review')) {
      expect(r.state).toBe('UNKNOWN');
    }
  });

  test('a check that did not run for this step is UNKNOWN and says so', () => {
    const reqs = requirementsFor(phase({ requiredValidators: ['validate-all'] }), evidence(), new Set());
    const check = reqs.find((r) => r.kind === 'check')!;
    expect(check.state).toBe('UNKNOWN');
    expect(check.detail).toContain('has not run');
  });

  test('a passed flag that is not exactly true is not a pass', () => {
    const reqs = requirementsFor(
      phase(),
      evidence({ checks: [{ id: 'validate-no-secrets', kind: 'validator', passed: undefined as never, at: 't' }] }),
      new Set(),
    );
    expect(reqs.find((r) => r.kind === 'check')?.state).toBe('FAILED');
  });

  test('acceptance criteria are shown but never claimed as met by machine', () => {
    const reqs = requirementsFor(phase(), evidence(), new Set());
    const criteria = reqs.filter((r) => r.kind === 'criterion');
    expect(criteria).toHaveLength(1);
    expect(criteria[0]!.state).toBe('OPEN');
  });

  test('browser proof is UNKNOWN rather than pretended', () => {
    const reqs = requirementsFor(phase({ requiredBrowserProof: true }), evidence(), new Set());
    const proof = reqs.find((r) => r.kind === 'proof')!;
    expect(proof.state).toBe('UNKNOWN');
    expect(proof.detail).toContain('does not yet record browser proof');
  });
});

describe('a step state is decided in one place, in a fixed order', () => {
  const base = { live: false, liveKind: 'working' as const, held: false, blockedReason: null };

  test('complete outranks everything', () => {
    expect(stateOf(phase({ status: 'closed' }), { ...base, live: true, held: true })).toBe('COMPLETE');
    expect(stateOf(phase({ closedByRecord: true }), base)).toBe('COMPLETE');
  });

  test('an owner hold outranks activity — nothing proceeds through a gate', () => {
    expect(stateOf(phase(), { ...base, live: true, held: true })).toBe('HELD');
  });

  test('only a live process may claim the present tense', () => {
    expect(stateOf(phase(), { ...base, live: true })).toBe('WORKING');
    expect(stateOf(phase(), { ...base, live: true, liveKind: 'checking' })).toBe('CHECKING');
    expect(stateOf(phase(), { ...base, live: true, liveKind: 'reviewing' })).toBe('REVIEWING');
    expect(stateOf(phase(), base)).toBe('QUEUED');
  });

  test('unmet dependencies read as blocked, not queued', () => {
    expect(stateOf(phase(), { ...base, blockedReason: 'waiting for x' })).toBe('BLOCKED');
  });
});

describe('the whole view', () => {
  test('with a live run the current step is working and no action is asked of the owner', () => {
    const v = buildExecutionView(projection(), LIVE, NOW);
    expect(v.working).toBe(true);
    expect(v.currentStep?.state).toBe('WORKING');
    expect(v.ownerGate).toBeNull();
    expect(v.ownerAction).toContain('NONE');
    expect(v.elapsedMs).toBe(120_000);
  });

  test('without a live run nothing claims to be working', () => {
    const v = buildExecutionView(projection(), null, NOW);
    expect(v.working).toBe(false);
    expect(v.currentStep?.state).not.toBe('WORKING');
    expect(v.elapsedMs).toBeNull();
  });

  test('a held checkpoint becomes the owner gate, in plain words', () => {
    const v = buildExecutionView(
      projection({
        work: {
          phaseId: 'validation-cache',
          state: 'BLOCKED',
          stopCode: 'CONTINUATION_READY',
          stopDetail: 'every required check passed',
          ownerRequired: true,
          sessionId: 's1',
          updatedAt: 't',
        },
      }),
      null,
      NOW,
    );
    expect(v.ownerGate).not.toBeNull();
    expect(v.ownerGate!.wants).toContain('Commit the finished work');
    expect(v.ownerGate!.why).toContain('independent reviewer');
    expect(v.ownerAction).toBe('YOUR DECISION IS NEEDED');
    expect(v.currentStep?.state).toBe('HELD');
  });

  /**
   * THE GATE NEVER NOMINATES AN APPROVAL.
   *
   * An approval record carries an action, a risk and a requester — and nothing tying it to a phase.
   * The first version of this screen showed one held step and then decided `pendingApprovals[0]`,
   * which could permanently answer a different request than the one the owner was reading, from a
   * single unconfirmed click. The gate now reports only THAT decisions are waiting.
   */
  test('a held gate with no pending approvals says so and offers nothing', () => {
    const v = buildExecutionView(
      projection({
        work: { phaseId: 'validation-cache', state: 'BLOCKED', stopCode: 'CONTINUATION_READY', stopDetail: 'x', ownerRequired: true, sessionId: null, updatedAt: 't' },
        pendingApprovals: [],
      }),
      null,
      NOW,
    );
    expect(v.ownerGate!.hasPendingApprovals).toBe(false);
    expect(v.ownerGate!.ownerMustDo).toContain('no request for this screen to answer');
    expect(v.ownerGate as unknown as Record<string, unknown>).not.toHaveProperty('approvalId');
  });

  test('with approvals waiting it counts them and never names one', () => {
    const two = [
      { id: 'APR-1', action: 'commit', gated: true, prohibited: false, risk: 'low', requestedBy: 'loop', requestedAt: 't' },
      { id: 'APR-2', action: 'production-deploy', gated: true, prohibited: false, risk: 'high', requestedBy: 'loop', requestedAt: 't' },
    ];
    const v = buildExecutionView(
      projection({
        work: { phaseId: 'validation-cache', state: 'BLOCKED', stopCode: 'OWNER_GATE', stopDetail: 'x', ownerRequired: true, sessionId: null, updatedAt: 't' },
        pendingApprovals: two,
      }),
      null,
      NOW,
    );
    expect(v.ownerGate!.hasPendingApprovals).toBe(true);
    expect(v.ownerGate!.ownerMustDo).toContain('2 requests are');
    // Nothing in the gate may carry a specific approval id.
    expect(JSON.stringify(v.ownerGate)).not.toContain('APR-1');
    expect(JSON.stringify(v.ownerGate)).not.toContain('APR-2');
  });

  test('unresolved high findings ride on the step they belong to, and no other', () => {
    const ev = evidence({
      findings: [
        { id: 'SEC-9', severity: 'HIGH', summary: 'open thing', resolved: false },
        { id: 'SEC-8', severity: 'LOW', summary: 'minor', resolved: false },
      ],
    });
    const mine = buildExecutionView(projection({ evidence: ev }), null, NOW);
    expect(mine.steps[0]!.findings.map((f) => f.id)).toEqual(['SEC-9']);

    const other = buildExecutionView(projection({ evidence: { ...ev, phaseId: 'doctor-preflight' } }), null, NOW);
    expect(other.steps[0]!.findings).toEqual([]);
  });

  test('progress counts steps a record calls complete, and nothing else', () => {
    const v = buildExecutionView(
      projection({
        phases: [
          phase({ phaseId: 'a', status: 'closed' }),
          phase({ phaseId: 'b' }),
          phase({ phaseId: 'c' }),
          phase({ phaseId: 'd' }),
        ],
      }),
      null,
      NOW,
    );
    expect(v.stepsAccepted).toBe(1);
    expect(v.stepsTotal).toBe(4);
    expect(v.percentComplete).toBe(25);
  });

  test('a step whose dependencies are unmet is blocked and says what it waits for', () => {
    const v = buildExecutionView(
      projection({ phases: [phase({ phaseId: 'b', unmetDependencies: ['validation-cache'] })] }),
      null,
      NOW,
    );
    expect(v.steps[0]!.state).toBe('BLOCKED');
    expect(v.steps[0]!.blockedReason).toContain('validation-cache');
  });

  test('who does the work is derived, not asserted', () => {
    const owner = buildExecutionView(projection({ phases: [phase({ autonomyLevel: 'owner-only' })] }), null, NOW);
    expect(owner.steps[0]!.performedBy).toBe('Owner');
    const mixed = buildExecutionView(projection({ phases: [phase({ requiredOwnerGates: ['commit'] })] }), null, NOW);
    expect(mixed.steps[0]!.performedBy).toBe('Mixed');
  });

  test('unresolved high findings are surfaced; resolved and low ones are not', () => {
    const ev = evidence({
      findings: [
        { id: 'A', severity: 'HIGH', summary: 'open', resolved: false },
        { id: 'B', severity: 'HIGH', summary: 'done', resolved: true },
        { id: 'C', severity: 'LOW', summary: 'minor', resolved: false },
      ],
    });
    expect(blockingFindings(ev).map((f) => f.id)).toEqual(['A']);
    expect(blockingFindings(null)).toEqual([]);
  });

  test('the completed feed is newest first and names who did each thing', () => {
    const v = buildExecutionView(projection({ evidence: evidence() }), null, NOW);
    expect(v.completed.length).toBeGreaterThan(0);
    for (let i = 1; i < v.completed.length; i += 1) {
      expect(v.completed[i - 1]!.at >= v.completed[i]!.at).toBe(true);
    }
    expect(v.completed.every((c) => c.who !== '')).toBe(true);
  });

  test('with no plan there is nothing to show and nothing is invented', () => {
    const v = buildExecutionView(projection({ phases: [] }), null, NOW);
    expect(v.steps).toEqual([]);
    expect(v.currentStep).toBeNull();
    expect(v.percentComplete).toBe(0);
    expect(v.ownerGate).toBeNull();
  });
});
