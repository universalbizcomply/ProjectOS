/**
 * The Command Centre's headline answer must be DERIVED, never authored.
 *
 * "Nothing needs you" is the most dangerous sentence in this product: said over a system that is
 * actually blocked on the owner, it is worse than saying nothing at all. So these drive
 * `buildHomeModel` directly and prove that every condition which genuinely requires the owner flips
 * it — and, just as importantly, that a clean state does NOT.
 */
import { describe, test, expect } from 'vitest';
import { buildHomeModel } from '../src/owner/homeModel';
import type { GovernedProjection } from '../src/governed/types';

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'demo',
    projectName: 'Demo',
    repository: {
      repo: 'acme/demo',
      localPath: 'C:/dev/demo',
      branch: 'main',
      head: 'a'.repeat(40),
      protectedBranches: ['main'],
      onProtectedBranch: false,
    },
    plan: {
      planId: 'p',
      planVersion: '1.0',
      declaredStatus: 'PLAN READY',
      ready: true,
      unmetReasons: [],
      planPath: 'plan.json',
      supersedes: null,
    },
    programme: {
      acceptedPhaseCount: 2,
      totalPhaseCount: 4,
      completionPercentage: 50,
      completedPhases: [],
      pendingPhases: [],
    },
    phases: [],
    activePhase: { phaseId: 'PHASE1A', status: 'implementing' },
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
      budget: { status: 'OK', spentThisMonthMicroUsd: 1000, remainingMicroUsd: 9000, warnAtMicroUsd: 8000, hardStopAtMicroUsd: 10000 },
      spentThisPhaseMicroUsd: 500,
      spentThisProjectMicroUsd: 1000,
      callCount: 3,
      lastCall: null,
    },
    pendingApprovals: [],
    planDrafts: [],
    sessions: [],
    connections: { available: true, detail: '', connections: [] },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: 'Continue PHASE1A.',
    observedAt: '2026-08-25T22:00:00.000Z',
    ...over,
  } as GovernedProjection;
}

describe('a clean state says nothing needs the owner', () => {
  test('no approvals, ready plan, healthy budget, usable connections', () => {
    const home = buildHomeModel(projection());
    expect(home.ownerActionRequired).toBe(false);
    expect(home.ownerActions).toEqual([]);
  });

  test('it still reports the real facts', () => {
    const home = buildHomeModel(projection());
    expect(home.projectName).toBe('Demo');
    expect(home.phaseId).toBe('PHASE1A');
    expect(home.completionPercent).toBe(50);
    expect(home.completionLabel).toBe('2 of 4 phases accepted');
    expect(home.productionFrozen).toBe(true);
    expect(home.nextSafeAction).toBe('Continue PHASE1A.');
  });
});

describe('every condition that genuinely needs the owner flips the headline', () => {
  test('a pending approval blocks', () => {
    const home = buildHomeModel(
      projection({
        pendingApprovals: [
          { id: 'A1', action: 'deploy to production', gated: true, prohibited: false, risk: 'high', requestedBy: 'implementer', requestedAt: 't' },
        ],
      }),
    );
    expect(home.ownerActionRequired).toBe(true);
    expect(home.ownerActions[0]?.severity).toBe('blocking');
    expect(home.ownerActions[0]?.title).toContain('deploy to production');
  });

  test('a PROHIBITED approval says it cannot be approved here rather than offering to', () => {
    const home = buildHomeModel(
      projection({
        pendingApprovals: [
          { id: 'A2', action: 'force push', gated: true, prohibited: true, risk: 'critical', requestedBy: 'implementer', requestedAt: 't' },
        ],
      }),
    );
    expect(home.ownerActions[0]?.title).toContain('cannot be approved here');
  });

  test('a plan that does not recompute ready blocks', () => {
    const home = buildHomeModel(
      projection({
        plan: { planId: 'p', planVersion: '1.0', declaredStatus: 'PLAN DRAFTED', ready: false, unmetReasons: ['no approval decision'], planPath: 'p.json', supersedes: null },
      }),
    );
    expect(home.ownerActionRequired).toBe(true);
    expect(home.ownerActions.some((a) => a.id === 'plan:not-ready')).toBe(true);
  });

  test('an approved draft turns the plan item into "activate", not "agree a plan"', () => {
    const home = buildHomeModel(
      projection({
        plan: { planId: 'p', planVersion: '1.0', declaredStatus: 'PLAN DRAFTED', ready: false, unmetReasons: [], planPath: 'p.json', supersedes: null },
        planDrafts: [{ draftId: 'd1', planStatus: 'DRAFTED', generatedAt: 't', decisionState: 'approved', decisionId: 'DEC1' }],
      }),
    );
    expect(home.ownerActions.find((a) => a.id === 'plan:not-ready')?.title).toContain('Activate');
  });

  test('a STOPPED budget blocks — and only when the runtime says stopped', () => {
    const stopped = buildHomeModel(
      projection({
        gatekeeperStatus: {
          configured: true,
          budget: { status: 'STOPPED', spentThisMonthMicroUsd: 10000, remainingMicroUsd: 0, warnAtMicroUsd: 8000, hardStopAtMicroUsd: 10000 },
          spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 10000, callCount: 9, lastCall: null,
        },
      }),
    );
    expect(stopped.ownerActions.some((a) => a.id === 'budget:stopped')).toBe(true);

    const warning = buildHomeModel(
      projection({
        gatekeeperStatus: {
          configured: true,
          budget: { status: 'WARNING', spentThisMonthMicroUsd: 8500, remainingMicroUsd: 1500, warnAtMicroUsd: 8000, hardStopAtMicroUsd: 10000 },
          spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 8500, callCount: 9, lastCall: null,
        },
      }),
    );
    // A warning is not a stop. Claiming the owner must act on one would train them to ignore the line.
    expect(warning.ownerActions.some((a) => a.id === 'budget:stopped')).toBe(false);
    expect(warning.ownerActionRequired).toBe(false);
  });

  test('missing or expired connections raise attention, not a block', () => {
    const home = buildHomeModel(
      projection({
        connections: {
          available: true,
          detail: '',
          connections: [
            { provider: 'supabase', environment: 'development', credential: 'gh-token', reference: 'r1', risk: 'session', status: 'MISSING', fingerprint: null, expiresAt: null },
            { provider: 'vercel', environment: 'development', credential: 'vercel-token', reference: 'r2', risk: 'session', status: 'EXPIRED', fingerprint: 'f', expiresAt: 't' },
          ],
        },
      }),
    );
    expect(home.ownerActionRequired).toBe(true);
    const item = home.ownerActions.find((a) => a.id === 'connections:unusable');
    expect(item?.severity).toBe('attention');
    expect(home.connectionProblems).toHaveLength(2);
  });

  test('connections that could not be read raise nothing — an unknown is not a problem to report', () => {
    const home = buildHomeModel(
      projection({ connections: { available: false, detail: 'could not read', connections: [] } }),
    );
    expect(home.connectionProblems).toEqual([]);
    expect(home.ownerActionRequired).toBe(false);
  });

  test('several conditions at once are all listed, not collapsed to one', () => {
    const home = buildHomeModel(
      projection({
        pendingApprovals: [
          { id: 'A1', action: 'x', gated: true, prohibited: false, risk: 'high', requestedBy: 'implementer', requestedAt: 't' },
        ],
        plan: { planId: 'p', planVersion: '1.0', declaredStatus: 'DRAFTED', ready: false, unmetReasons: ['r'], planPath: 'p.json', supersedes: null },
      }),
    );
    expect(home.ownerActions.length).toBeGreaterThanOrEqual(2);
  });
});

describe('cost is reported only when it is real', () => {
  test('an unconfigured gatekeeper reports no spend rather than $0.00', () => {
    const home = buildHomeModel(
      projection({
        gatekeeperStatus: { configured: false, budget: null, spentThisPhaseMicroUsd: 0, spentThisProjectMicroUsd: 0, callCount: 0, lastCall: null },
      }),
    );
    expect(home.spendLabel).toBeNull();
    expect(home.budgetStatus).toBeNull();
  });

  test('a configured one reports the project total', () => {
    // 1000 micro-USD is $0.001. Sub-cent spend keeps six decimals ON PURPOSE: rounding a real
    // gatekeeper call down to "$0.00" would report a charge that happened as no charge at all.
    expect(buildHomeModel(projection()).spendLabel).toBe('$0.001000 on this project');
  });

  test('a whole-cent amount is reported in ordinary money, not six decimals', () => {
    const home = buildHomeModel(
      projection({
        gatekeeperStatus: {
          configured: true,
          budget: null,
          spentThisPhaseMicroUsd: 0,
          spentThisProjectMicroUsd: 2_500_000,
          callCount: 1,
          lastCall: null,
        },
      }),
    );
    expect(home.spendLabel).toBe('$2.50 on this project');
  });
});
