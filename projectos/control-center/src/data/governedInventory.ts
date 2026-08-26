/**
 * The projects ProjectOS can actually prove it governs.
 *
 * THE DEFECT THIS REPLACES. The Projects surface read a remote Supabase table and, when that was
 * absent, a thirteen-row static seed — and then reported the result as "13 governed by ProjectOS",
 * with a KPI counting them as governed projects and one row carrying a repository mapping that was
 * simply wrong. Neither source is ProjectOS's truth. That is three project universes in one
 * application, and the owner had no way to tell which one was real.
 *
 * WHAT IS CANONICAL. Exactly two things, and this module invents no third:
 *
 *   - the GOVERNED PROJECTION, which the runtime derives from the checkout's own canonical records —
 *     it already carries the project id, name, repository, plan status and phase counts, and it
 *     already models "there is no runtime" honestly instead of substituting a snapshot;
 *   - the owner's PROJECT REGISTRY, the out-of-checkout list that pins which roots may claim which
 *     project id. It is written only through an owner-confirmed registration, so ProjectOS cannot
 *     add to it on its own behalf — which is exactly why it can be trusted.
 *
 * THE REGISTRY IS NO LONGER EMPTY, and that premise was baked in here. This module used to derive
 * the inventory from the governed PROJECTION alone, which describes exactly one project — the
 * selected one. That was right while the registry held nothing, and it was written down as such.
 * The moment a second project was registered it became a contradiction the owner could see on two
 * screens at once: the project selector, reading the real registry inventory, offered two projects,
 * while the page literally titled "Projects" reported "1 governed by ProjectOS".
 *
 * So the inventory is now the REGISTRY's list, and the projection supplies the live detail for the
 * one project the runtime is actually reporting on. Rows for the others are honest about that: they
 * are registered and their identity is known, and no plan status, phase count or freeze state is
 * invented for a project the runtime has not read.
 *
 * Created in the post-V3 operational recovery programme (Control Centre phase); registry-aware in
 * PROJECTOS-PRODUCT-COMPLETION1A.
 */
import type { GovernedProjectsInventory, GovernedState } from '../governed/types';

/** A project ProjectOS governs, as the canonical records describe it. */
export interface GovernedProjectRow {
  readonly id: string;
  readonly name: string;
  readonly repo: string;
  /** Where this row's facts came from. Never a guess, and never blended. */
  readonly source: 'governed-projection' | 'owner-registry';
  readonly productionFreeze: boolean;
  readonly planStatus: string;
  readonly activePhase: string | null;
  readonly acceptedPhases: number;
  readonly totalPhases: number;
  /**
   * Whether the RUNTIME reported this project, or it is merely known to be registered.
   *
   * A registry row carries an id, a root and a repository identity and nothing else — no plan, no
   * phases, no freeze state. Those fields are zeroed on such a row, and this flag is what stops a
   * surface presenting a zero as a measurement.
   */
  readonly live: boolean;
}

export type InventoryState =
  | { readonly kind: 'governed'; readonly rows: readonly GovernedProjectRow[] }
  /** No runtime, so no governed truth. The honest answer, never a substituted snapshot. */
  | { readonly kind: 'unavailable'; readonly reason: string; readonly detail: string };

/** What the Projects surface may honestly put a number on. */
export interface InventoryCounts {
  readonly total: number;
  /** Rows the runtime actually reported. Only these carry measured facts. */
  readonly reported: number;
  /** Registered, but not read by the runtime. Named, never folded into a "no". */
  readonly unreported: number;
  readonly frozen: number;
  readonly notFrozen: number;
  readonly active: number;
}

/**
 * Count only what was measured.
 *
 * THE DEFECT THIS EXISTS TO PREVENT. A registry-only row carries `productionFreeze: false` and
 * `activePhase: null` because nothing measured them — that is stated a few lines above, and it is
 * correct. What was wrong was counting those rows anyway: with ten registered projects the Projects
 * page reported "Production frozen: 1", which an owner can only read as "nine are not frozen".
 * Every one of them is frozen in the protected registry. The row bodies were already honest; the
 * figures above them were not, and the figure is what gets believed.
 *
 * `frozen + notFrozen === reported`, always. The unreported remainder is returned separately so a
 * surface must decide what to say about it rather than silently absorbing it into either side.
 */
export function inventoryCounts(rows: readonly GovernedProjectRow[]): InventoryCounts {
  const reported = rows.filter((r) => r.live);
  return {
    total: rows.length,
    reported: reported.length,
    unreported: rows.length - reported.length,
    frozen: reported.filter((r) => r.productionFreeze).length,
    notFrozen: reported.filter((r) => !r.productionFreeze).length,
    active: reported.filter((r) => r.activePhase !== null).length,
  };
}

/**
 * Derive the inventory from the governed state. Pure: the caller supplies already-parsed state, so
 * the same function runs in the app and in tests.
 *
 * A disconnected runtime yields `unavailable` and NOT an empty list — "ProjectOS governs no projects"
 * and "ProjectOS cannot currently tell you" are different statements, and showing the first when the
 * second is true is the class of untruth this phase exists to remove.
 */
export function inventoryFrom(
  governed: GovernedState | null,
  registry?: GovernedProjectsInventory | null,
): InventoryState {
  if (governed === null) {
    return { kind: 'unavailable', reason: 'NO_RUNTIME', detail: 'The ProjectOS runtime has not reported yet.' };
  }
  if (!governed.connected) {
    return { kind: 'unavailable', reason: governed.reason, detail: governed.detail };
  }

  /** The live row, from the projection — the only row entitled to plan and phase facts. */
  const liveRow: GovernedProjectRow = {
    id: governed.projectId,
    name: governed.projectName,
    repo: governed.repository.repo,
    source: 'governed-projection',
    productionFreeze: governed.safety.productionFreeze,
    planStatus: governed.plan.ready ? 'PLAN READY' : governed.plan.declaredStatus,
    activePhase: governed.activePhase === null ? null : governed.activePhase.phaseId,
    acceptedPhases: governed.programme.acceptedPhaseCount,
    totalPhases: governed.programme.totalPhaseCount,
    live: true,
  };

  // No registry reported yet: the projection is all that is known, and one row is the honest answer.
  if (registry === null || registry === undefined || registry.projects.length === 0) {
    return { kind: 'governed', rows: [liveRow] };
  }

  // Registry order, with the live project's real detail substituted in place. A registered project
  // the runtime has not reported gets its IDENTITY and nothing more — every measured field stays
  // zero and `live` is false, so a surface cannot render an unmeasured zero as a measurement.
  const rows = registry.projects.map((p): GovernedProjectRow =>
    p.projectId === governed.projectId
      ? liveRow
      : {
          id: p.projectId,
          name: p.projectName,
          repo: p.repository,
          source: 'owner-registry',
          productionFreeze: false,
          planStatus: 'Not reported',
          activePhase: null,
          acceptedPhases: 0,
          totalPhases: 0,
          live: false,
        },
  );
  // The live project must appear even if the registry listing somehow omits it — the runtime
  // reporting on a project is stronger evidence than a listing that does not mention it.
  return {
    kind: 'governed',
    rows: rows.some((r) => r.id === liveRow.id) ? rows : [liveRow, ...rows],
  };
}
