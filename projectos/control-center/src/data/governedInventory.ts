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
 * Today the registry is EMPTY, so the honest inventory is one project: the one ProjectOS is installed
 * in. Saying "1" where the old surface said "13" is the point, not a regression.
 *
 * Created in the post-V3 operational recovery programme (Control Centre phase).
 */
import type { GovernedState } from '../governed/types';

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
}

export type InventoryState =
  | { readonly kind: 'governed'; readonly rows: readonly GovernedProjectRow[] }
  /** No runtime, so no governed truth. The honest answer, never a substituted snapshot. */
  | { readonly kind: 'unavailable'; readonly reason: string; readonly detail: string };

/**
 * Derive the inventory from the governed state. Pure: the caller supplies already-parsed state, so
 * the same function runs in the app and in tests.
 *
 * A disconnected runtime yields `unavailable` and NOT an empty list — "ProjectOS governs no projects"
 * and "ProjectOS cannot currently tell you" are different statements, and showing the first when the
 * second is true is the class of untruth this phase exists to remove.
 */
export function inventoryFrom(governed: GovernedState | null): InventoryState {
  if (governed === null) {
    return { kind: 'unavailable', reason: 'NO_RUNTIME', detail: 'The ProjectOS runtime has not reported yet.' };
  }
  if (!governed.connected) {
    return { kind: 'unavailable', reason: governed.reason, detail: governed.detail };
  }
  return {
    kind: 'governed',
    rows: [
      {
        id: governed.projectId,
        name: governed.projectName,
        repo: governed.repository.repo,
        source: 'governed-projection',
        productionFreeze: governed.safety.productionFreeze,
        planStatus: governed.plan.ready ? 'PLAN READY' : governed.plan.declaredStatus,
        activePhase: governed.activePhase === null ? null : governed.activePhase.phaseId,
        acceptedPhases: governed.programme.acceptedPhaseCount,
        totalPhases: governed.programme.totalPhaseCount,
      },
    ],
  };
}
