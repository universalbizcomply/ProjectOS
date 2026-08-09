/**
 * Adapter: canonical governed state -> the existing owner view model.
 *
 * REUSE, NOT REPLACEMENT. `buildOwnerControlView` is the tested owner information architecture from
 * PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A; the only thing wrong with it was that its INPUT was a
 * hand-maintained literal. This maps the runtime's real projection onto that same model, so the
 * surface gains live truth without a second view model to keep in step.
 *
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */
import type { GovernedProjection } from '../governed/types';
import type { OwnerControlModel, OwnerDecision, PlanStatus } from './ownerModel';

/**
 * The plan status to show. A plan that fails the evidence gate is never shown as READY, whatever the
 * record says — the same rule the runtime applies before it will govern anything.
 */
function planStatusOf(p: GovernedProjection): PlanStatus {
  if (!p.plan.ready) return 'PLAN BLOCKED';
  return p.activePhase === null ? 'PLAN READY' : 'IN EXECUTION';
}

/**
 * Decisions the OWNER must take, derived from real state — never authored. Only two things can
 * genuinely be waiting on the owner here: a plan that no longer passes its gate, and a phase sitting
 * at awaiting_closure, which the implementer is structurally unable to move.
 */
function decisionsOf(p: GovernedProjection): readonly OwnerDecision[] {
  const out: OwnerDecision[] = [];
  if (!p.plan.ready) {
    out.push({
      id: 'plan-not-ready',
      title: 'The approved plan does not pass its evidence gate',
      detail: `Recomputed by the plan-governance engine: ${p.plan.unmetReasons.slice(0, 3).join('; ')}`,
      severity: 'critical',
    });
  }
  if (p.activePhase !== null && p.activePhase.status === 'awaiting_closure') {
    const who = p.authority.closureAuthority;
    out.push({
      id: `close-${p.activePhase.phaseId}`,
      title: `${p.activePhase.phaseId} is awaiting closure`,
      detail: `Closure authority is ${who}. The implementer (${p.authority.implementer}) cannot close a phase.`,
      severity: 'warn',
    });
  }
  return out;
}

/**
 * Owner-only actions, taken from the approved plan rather than a UI constant — if the plan's
 * `ownerOnlyActions` change, the surface changes with them instead of drifting.
 */
function restrictedActionsOf(p: GovernedProjection): readonly string[] {
  return p.authority.ownerOnlyActions;
}

export function ownerModelFromGoverned(p: GovernedProjection): OwnerControlModel {
  return {
    projectId: p.projectId,
    projectName: p.projectName,
    programme: p.plan.planId,
    planStatus: planStatusOf(p),
    activePhase: p.activePhase?.phaseId ?? null,
    nextRecommendedPhase: p.nextStartablePhase?.phaseId ?? null,
    acceptedPhaseCount: p.programme.acceptedPhaseCount,
    totalPhaseCount: p.programme.totalPhaseCount,
    risks: p.risks,
    blockers: p.blockers,
    decisionsRequired: decisionsOf(p),
    nextSafeAction: p.nextSafeAction,
    restrictedActions: restrictedActionsOf(p),
    safety: {
      productionFrozen: p.safety.productionFreeze,
      // These three are claims about what the RUNTIME has done. The governed read path performs no
      // provider call, reads no secret and calls no AI API, so reporting anything but false here
      // would be an invention. When a real effect channel exists it must set them from evidence.
      providerContacted: false,
      secretCapabilityUsed: false,
      apiUsed: false,
    },
  };
}
