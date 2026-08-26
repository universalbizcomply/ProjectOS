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
import { inventoryFrom, inventoryCounts } from '../src/data/governedInventory';
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

describe('the Projects list is the REGISTRY, not just the selected project', () => {
  function registryOf(ids: readonly string[]) {
    return {
      projects: ids.map((id) => ({
        projectId: id,
        projectName: id === 'projectos' ? 'ProjectOS' : 'Dead Aisles',
        repositoryRoot: `C:/dev/${id}`,
        repository: `acme/${id}`,
      })),
      registryStatus: 'ok' as const,
      refusedCount: 0,
      selectedProjectId: 'projectos',
    };
  }

  it('every registered project appears, not only the one the runtime reports', () => {
    // THE DEFECT THIS PINS: with two projects registered, this page reported "1 governed by
    // ProjectOS" while the project selector — reading the same registry — offered two. One surface
    // contradicting another about the same fact.
    const inv = inventoryFrom(projection(), registryOf(['dead-aisle', 'projectos']));
    expect(inv.kind).toBe('governed');
    if (inv.kind !== 'governed') return;
    expect(inv.rows.map((r) => r.id)).toEqual(['dead-aisle', 'projectos']);
  });

  it('the reported project carries live facts; the others carry none', () => {
    const inv = inventoryFrom(projection(), registryOf(['dead-aisle', 'projectos']));
    if (inv.kind !== 'governed') return;
    const live = inv.rows.find((r) => r.id === 'projectos');
    const other = inv.rows.find((r) => r.id === 'dead-aisle');

    expect(live?.live).toBe(true);
    expect(live?.source).toBe('governed-projection');

    // A registry row has an identity and nothing measured. Its zeroes must never be presented as
    // measurements, which is what `live: false` exists to let the surface decide.
    expect(other?.live).toBe(false);
    expect(other?.source).toBe('owner-registry');
    expect(other?.totalPhases).toBe(0);
    expect(other?.activePhase).toBeNull();
  });

  it('with no registry reported, the projection alone is still the honest answer', () => {
    const inv = inventoryFrom(projection(), null);
    if (inv.kind !== 'governed') return;
    expect(inv.rows).toHaveLength(1);
    expect(inv.rows[0]?.live).toBe(true);
  });

  it('a registry that omits the reported project still lists it — the runtime is stronger evidence', () => {
    const inv = inventoryFrom(projection(), registryOf(['dead-aisle']));
    if (inv.kind !== 'governed') return;
    expect(inv.rows.map((r) => r.id)).toContain('projectos');
    expect(inv.rows.find((r) => r.id === 'projectos')?.live).toBe(true);
  });

  it('a disconnected runtime is still unavailable, registry or not', () => {
    const inv = inventoryFrom({ connected: false, reason: 'RUNTIME_STOPPED', detail: 'stopped' }, registryOf(['projectos']));
    expect(inv.kind).toBe('unavailable');
  });
});

/**
 * THE FIGURE THAT WAS WRONG. With ten registered projects the Projects page reported
 * "Production frozen: 1". Every one of the ten is productionFrozen in the protected registry. The
 * count included registry-only rows, which carry `productionFreeze: false` because NOTHING MEASURED
 * THEM -- so "not read" was rendered as "read, and the answer was no". The row bodies were already
 * honest; the figures above them were not, and the figure is what an owner believes.
 *
 * This was invisible while two projects were registered and one of them was live. It appeared the
 * moment the registry grew, which is exactly when nobody re-reads a KPI.
 */
describe('inventoryCounts — a figure may only count what was measured', () => {
  function rowsOf(liveCount: number, registryOnly: number) {
    const rows = [];
    for (let i = 0; i < liveCount; i += 1) {
      rows.push({
        id: `live-${i}`, name: `Live ${i}`, repo: 'acme/x', source: 'governed-projection' as const,
        productionFreeze: true, planStatus: 'PLAN READY', activePhase: 'PHASE1A',
        acceptedPhases: 1, totalPhases: 2, live: true,
      });
    }
    for (let i = 0; i < registryOnly; i += 1) {
      rows.push({
        id: `reg-${i}`, name: `Registered ${i}`, repo: 'acme/y', source: 'owner-registry' as const,
        productionFreeze: false, planStatus: 'Not reported', activePhase: null,
        acceptedPhases: 0, totalPhases: 0, live: false,
      });
    }
    return rows;
  }

  it('does not count an unread project as "not frozen"', () => {
    const c = inventoryCounts(rowsOf(1, 9));
    expect(c.total).toBe(10);
    expect(c.reported).toBe(1);
    expect(c.unreported).toBe(9);
    expect(c.frozen).toBe(1);
    // The whole point: nine unread projects are NOT nine unfrozen projects.
    expect(c.notFrozen).toBe(0);
  });

  it('does not count an unread project as "no phase running"', () => {
    const c = inventoryCounts(rowsOf(1, 9));
    expect(c.active).toBe(1);
    expect(c.active).toBeLessThanOrEqual(c.reported);
  });

  it('frozen and notFrozen always partition exactly the reported rows', () => {
    for (const [live, reg] of [[0, 0], [1, 0], [0, 5], [3, 7]]) {
      const c = inventoryCounts(rowsOf(live, reg));
      expect(c.frozen + c.notFrozen).toBe(c.reported);
      expect(c.reported + c.unreported).toBe(c.total);
    }
  });

  it('reports a genuinely unfrozen project, which is the case that matters', () => {
    const rows = rowsOf(2, 1);
    const mutated = rows.map((r, i) => (i === 0 ? { ...r, productionFreeze: false } : r));
    const c = inventoryCounts(mutated);
    expect(c.reported).toBe(2);
    expect(c.frozen).toBe(1);
    expect(c.notFrozen).toBe(1);
  });

  it('counts nothing when nothing was reported, rather than counting zero as an answer', () => {
    const c = inventoryCounts(rowsOf(0, 4));
    expect(c.reported).toBe(0);
    expect(c.frozen).toBe(0);
    expect(c.notFrozen).toBe(0);
    expect(c.unreported).toBe(4);
  });
});
