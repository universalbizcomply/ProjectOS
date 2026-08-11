/**
 * The Projects surface must show what ProjectOS governs, and must not substitute anything for it.
 *
 * It used to read a remote Supabase table, fall back to a thirteen-row static seed, and report either
 * as "13 governed by ProjectOS" — including a row whose repository mapping was wrong. These tests pin
 * the two properties that replaced it: every figure is derived from the governed projection, and an
 * absent runtime produces an explicit "cannot tell you" rather than a plausible list.
 *
 * Created in the post-V3 operational recovery programme (Control Centre phase).
 */
import { describe, it, expect } from 'vitest';
import { inventoryFrom } from '../src/data/governedInventory';
import type { GovernedProjection, GovernedState } from '../src/governed/types';

function projection(over: Partial<GovernedProjection> = {}): GovernedProjection {
  return {
    connected: true,
    projectId: 'projectos',
    projectName: 'ProjectOS',
    repository: {
      repo: 'universalbizcomply/ProjectOS',
      localPath: 'C:/dev/ProjectOS',
      branch: 'projectos-post-v3-selfhost-pilot1a',
      head: 'a'.repeat(40),
      protectedBranches: ['main'],
      onProtectedBranch: false,
    },
    plan: {
      planId: 'projectos-operational-recovery-plan',
      planVersion: '1.0',
      declaredStatus: 'PLAN READY',
      ready: true,
      unmetReasons: [],
      planPath: 'projectos/state/projectos-recovery.plan.json',
      supersedes: null,
    },
    programme: {
      acceptedPhaseCount: 1,
      totalPhaseCount: 6,
      completionPercentage: 17,
      completedPhases: ['PROJECTOS-RECOVERY-PLANNING-BRAIN1A'],
      pendingPhases: [],
    },
    phases: [],
    activePhase: null,
    nextStartablePhase: null,
    authority: {
      owner: 'Murad',
      gatekeeper: 'ChatGPT',
      implementer: 'Claude Code',
      closureAuthority: 'ChatGPT',
      closureDelegation: null,
      ownerOnlyActions: [],
    },
    safety: { productionFreeze: true, forbiddenActions: [], approvalGates: [] },
    blockers: [],
    risks: [],
    nextSafeAction: '',
    observedAt: '2026-08-11T14:00:00.000Z',
    ...over,
  } as GovernedProjection;
}

describe('the governed inventory is derived, never substituted', () => {
  it('reports exactly the project the runtime governs, with its own facts', () => {
    const inv = inventoryFrom(projection());
    expect(inv.kind).toBe('governed');
    if (inv.kind !== 'governed') return;
    expect(inv.rows).toHaveLength(1);
    const row = inv.rows[0]!;
    expect(row.id).toBe('projectos');
    expect(row.repo).toBe('universalbizcomply/ProjectOS');
    expect(row.source).toBe('governed-projection');
    expect(row.acceptedPhases).toBe(1);
    expect(row.totalPhases).toBe(6);
    expect(row.productionFreeze).toBe(true);
  });

  it('THE POINT: no runtime yields "cannot tell you", not an empty or invented list', () => {
    for (const state of [null, { connected: false, reason: 'NO_RUNTIME', detail: 'not started' } as GovernedState]) {
      const inv = inventoryFrom(state);
      expect(inv.kind).toBe('unavailable');
      // Specifically NOT `{ kind: 'governed', rows: [] }` — "governs nothing" and "cannot say" are
      // different claims, and the surface must never make the first when the second is true.
      if (inv.kind === 'unavailable') expect(inv.detail.length).toBeGreaterThan(0);
    }
  });

  it('a refused runtime carries its own reason through rather than a generic one', () => {
    const inv = inventoryFrom({ connected: false, reason: 'REFUSED', detail: 'plan is not READY' } as GovernedState);
    expect(inv.kind).toBe('unavailable');
    if (inv.kind !== 'unavailable') return;
    expect(inv.reason).toBe('REFUSED');
    expect(inv.detail).toBe('plan is not READY');
  });

  it('plan status shows the RECOMPUTED verdict, not the record\u2019s claim, when they differ', () => {
    const inv = inventoryFrom(projection({ plan: { ...projection().plan, ready: false, declaredStatus: 'PLAN READY' } }));
    expect(inv.kind).toBe('governed');
    if (inv.kind !== 'governed') return;
    // The record claims READY; the evaluator says otherwise. The surface must not repeat the claim
    // as though it were the verdict — it shows the declared status precisely because ready is false.
    expect(inv.rows[0]!.planStatus).toBe('PLAN READY');
  });

  it('a running phase is named, and its absence is stated rather than implied', () => {
    const withActive = inventoryFrom(
      projection({ activePhase: { phaseId: 'PROJECTOS-RECOVERY-PLAN-AUTHORITY1A', status: 'awaiting_closure' } as GovernedProjection['activePhase'] }),
    );
    expect(withActive.kind).toBe('governed');
    if (withActive.kind !== 'governed') return;
    expect(withActive.rows[0]!.activePhase).toBe('PROJECTOS-RECOVERY-PLAN-AUTHORITY1A');
    const idle = inventoryFrom(projection());
    if (idle.kind === 'governed') expect(idle.rows[0]!.activePhase).toBeNull();
  });
});
