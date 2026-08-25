/**
 * The Command Centre home model — pure, and deliberately separate from the component.
 *
 * ONE QUESTION DOMINATES THIS SCREEN: does the owner need to do anything right now? That answer must
 * be DERIVED from canonical state, never authored, or it becomes the most dangerous line in the
 * product — a confident "no action needed" over a system that is in fact blocked on the owner.
 *
 * So this file computes it from the governed projection and nothing else, returns the REASONS it
 * concluded what it did, and is unit-testable without a DOM. Every reason names a real record: a
 * pending approval, a plan that does not recompute ready, a budget that has actually stopped.
 *
 * Created in PROJECTOS-PRODUCT-COMPLETION1A §8.
 */
import type { GovernedProjection } from '../governed/types';

/** One thing waiting on the owner, in plain language. */
export interface OwnerActionItem {
  /** Stable key for rendering. */
  readonly id: string;
  /** What is being asked, in the owner's words. */
  readonly title: string;
  /** Why it is being asked. */
  readonly detail: string;
  /** How much it matters. `blocking` means nothing proceeds until it is answered. */
  readonly severity: 'blocking' | 'attention';
}

export interface HomeModel {
  readonly projectName: string;
  readonly repository: string;
  /** The phase actually running, or the next one that could start, or null. */
  readonly phaseId: string | null;
  readonly phaseStatus: string | null;
  readonly planStatus: string;
  readonly planReady: boolean;
  readonly completionLabel: string;
  readonly completionPercent: number;
  readonly productionFrozen: boolean;
  /** True when ANY item is waiting on the owner. The headline answer. */
  readonly ownerActionRequired: boolean;
  readonly ownerActions: readonly OwnerActionItem[];
  /** The runtime's own next safe action, verbatim. */
  readonly nextSafeAction: string;
  readonly blockers: readonly string[];
  /** Gatekeeper spend for this project, already formatted. Null when not configured. */
  readonly spendLabel: string | null;
  readonly budgetStatus: 'OK' | 'WARNING' | 'STOPPED' | null;
  /** Connections that are not usable and would stop work that needs them. */
  readonly connectionProblems: readonly string[];
}

/** Micro-USD as an owner-readable amount. Mirrors the core cost ledger's own formatting. */
function formatSpend(microUsd: number): string {
  const usd = Math.max(0, microUsd) / 1_000_000;
  return usd < 0.01 && usd > 0 ? `$${usd.toFixed(6)}` : `$${usd.toFixed(2)}`;
}

/**
 * Everything the home screen states, derived from one projection.
 *
 * Pure: same projection in, same model out. No clock, no I/O, no randomness.
 */
export function buildHomeModel(state: GovernedProjection): HomeModel {
  const phase = state.activePhase ?? state.nextStartablePhase;
  const actions: OwnerActionItem[] = [];

  // 1. APPROVALS ACTUALLY WAITING. The strongest signal, and a real record each time.
  for (const approval of state.pendingApprovals) {
    actions.push({
      id: `approval:${approval.id}`,
      title: approval.prohibited
        ? `${approval.action} — cannot be approved here`
        : `Approve or reject: ${approval.action}`,
      detail: approval.prohibited
        ? 'This action is prohibited and needs you to act outside ProjectOS.'
        : `Requested by ${approval.requestedBy || 'ProjectOS'}. Risk: ${approval.risk || 'unrecorded'}.`,
      severity: 'blocking',
    });
  }

  // 2. A PLAN THAT DOES NOT RECOMPUTE READY. Nothing governed can proceed under one.
  if (!state.plan.ready) {
    const approved = state.planDrafts.filter((d) => d.decisionState === 'approved');
    actions.push({
      id: 'plan:not-ready',
      title:
        approved.length > 0
          ? 'Activate the approved plan'
          : 'A plan needs to be agreed before work can start',
      detail:
        approved.length > 0
          ? `${approved.length} approved plan${approved.length === 1 ? '' : 's'} can be activated.`
          : state.plan.unmetReasons[0] ?? 'The current plan does not pass its evidence gate.',
      severity: 'blocking',
    });
  }

  // 3. A BUDGET THAT HAS ACTUALLY STOPPED. Reported only when the runtime's own evaluation says so.
  const budget = state.gatekeeperStatus.budget;
  if (budget !== null && budget.status === 'STOPPED') {
    actions.push({
      id: 'budget:stopped',
      title: 'Reviewer budget reached',
      detail: 'ProjectOS has stopped asking the reviewer until you raise the limit.',
      severity: 'blocking',
    });
  }

  // 4. CONNECTIONS THAT CANNOT BE USED. Attention rather than blocking: it only stops the work that
  //    actually needs them, and ProjectOS cannot know which that is until it tries.
  const connectionProblems = state.connections.available
    ? state.connections.connections
        .filter((c) => c.status === 'MISSING' || c.status === 'EXPIRED')
        .map((c) => `${c.provider} (${c.environment}) — ${c.status === 'MISSING' ? 'not set up' : 'expired'}`)
    : [];
  if (connectionProblems.length > 0) {
    actions.push({
      id: 'connections:unusable',
      title: 'Some connections are not ready',
      detail: connectionProblems.join('; '),
      severity: 'attention',
    });
  }

  return {
    projectName: state.projectName,
    repository: state.repository.repo,
    phaseId: phase?.phaseId ?? null,
    phaseStatus: phase?.status ?? null,
    planStatus: state.plan.declaredStatus,
    planReady: state.plan.ready,
    completionLabel: `${state.programme.acceptedPhaseCount} of ${state.programme.totalPhaseCount} phases accepted`,
    completionPercent: state.programme.completionPercentage,
    productionFrozen: state.safety.productionFreeze,
    ownerActionRequired: actions.length > 0,
    ownerActions: actions,
    nextSafeAction: state.nextSafeAction,
    blockers: state.blockers,
    spendLabel: state.gatekeeperStatus.configured
      ? `${formatSpend(state.gatekeeperStatus.spentThisProjectMicroUsd)} on this project`
      : null,
    budgetStatus: budget === null ? null : budget.status,
    connectionProblems,
  };
}
