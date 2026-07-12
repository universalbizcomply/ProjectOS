/**
 * Owner Control Plane — pure, deterministic view model.
 *
 * The single canonical owner information architecture for a governed project: where you are, what
 * ProjectOS found and trusts, what is blocked, what decision is required, what is safe next, and which
 * actions are owner-only. Pure functions (no I/O, no clock, no randomness) so the surface is fully
 * deterministic and unit-testable. Created in PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A.
 */

export type PlanStatus =
  | 'NO PLAN'
  | 'PLAN DISCOVERED'
  | 'PLAN CONFLICT'
  | 'PLAN DRAFTED'
  | 'AWAITING OWNER APPROVAL'
  | 'PLAN READY'
  | 'PLAN STALE'
  | 'PLAN BLOCKED';

export interface OwnerDecision {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly severity: 'info' | 'warn' | 'critical';
}

export interface OwnerSafetyState {
  readonly productionFrozen: boolean;
  readonly providerContacted: boolean;
  readonly secretCapabilityUsed: boolean;
  readonly apiUsed: boolean;
}

export interface OwnerControlModel {
  readonly projectId: string;
  readonly projectName: string;
  readonly programme: string;
  readonly planStatus: PlanStatus;
  readonly activePhase: string | null;
  readonly nextRecommendedPhase: string | null;
  readonly acceptedPhaseCount: number;
  readonly totalPhaseCount: number;
  readonly risks: readonly string[];
  readonly blockers: readonly string[];
  readonly decisionsRequired: readonly OwnerDecision[];
  readonly nextSafeAction: string;
  readonly restrictedActions: readonly string[];
  readonly safety: OwnerSafetyState;
}

export interface OwnerBadge {
  readonly label: string;
  readonly tone: 'ok' | 'warn' | 'crit' | 'mut';
}

export interface OwnerControlView {
  readonly heading: string;
  /** One plain-language sentence: where the owner is right now. */
  readonly whereYouAre: string;
  readonly planStatus: PlanStatus;
  readonly statusTone: OwnerBadge['tone'];
  readonly completionPercent: number;
  readonly completionLabel: string;
  readonly decisionsRequired: readonly OwnerDecision[];
  readonly hasDecisions: boolean;
  readonly risks: readonly string[];
  readonly blockers: readonly string[];
  readonly nextSafeAction: string;
  readonly restrictedActions: readonly string[];
  readonly safetyBadges: readonly OwnerBadge[];
}

const READY_STATUSES: ReadonlySet<PlanStatus> = new Set<PlanStatus>(['PLAN READY']);
const BLOCKED_STATUSES: ReadonlySet<PlanStatus> = new Set<PlanStatus>(['PLAN CONFLICT', 'PLAN BLOCKED', 'PLAN STALE']);

/** Round accepted/total to a 1-dp percentage (deterministic, matches the ProjectOS completion method). */
export function completionPercent(accepted: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((accepted / total) * 1000) / 10;
}

function statusTone(status: PlanStatus): OwnerBadge['tone'] {
  if (READY_STATUSES.has(status)) return 'ok';
  if (BLOCKED_STATUSES.has(status)) return 'crit';
  return 'warn';
}

/** Where-you-are: a single plain-language sentence, deterministic from the model. */
export function whereYouAre(m: OwnerControlModel): string {
  const phase = m.activePhase
    ? `working phase ${m.activePhase}`
    : m.nextRecommendedPhase
      ? `between phases — next is ${m.nextRecommendedPhase}`
      : 'between phases';
  return `${m.projectName} · ${m.programme} · ${phase}.`;
}

function safetyBadges(s: OwnerSafetyState): readonly OwnerBadge[] {
  return [
    { label: s.productionFrozen ? 'Production frozen' : 'Production LIVE', tone: s.productionFrozen ? 'ok' : 'crit' },
    { label: s.providerContacted ? 'Provider contacted' : 'No provider contacted', tone: s.providerContacted ? 'warn' : 'ok' },
    { label: s.secretCapabilityUsed ? 'Secret used' : 'No secret used', tone: s.secretCapabilityUsed ? 'warn' : 'ok' },
    { label: s.apiUsed ? 'AI API used' : 'No AI API used', tone: s.apiUsed ? 'crit' : 'ok' },
  ];
}

/** Derive the full owner control view from the model. Pure and deterministic. */
export function buildOwnerControlView(m: OwnerControlModel): OwnerControlView {
  const percent = completionPercent(m.acceptedPhaseCount, m.totalPhaseCount);
  return {
    heading: 'Owner Control',
    whereYouAre: whereYouAre(m),
    planStatus: m.planStatus,
    statusTone: statusTone(m.planStatus),
    completionPercent: percent,
    completionLabel: `${m.acceptedPhaseCount} of ${m.totalPhaseCount} phases accepted · ${percent}%`,
    decisionsRequired: m.decisionsRequired,
    hasDecisions: m.decisionsRequired.length > 0,
    risks: m.risks,
    blockers: m.blockers,
    nextSafeAction: m.nextSafeAction,
    restrictedActions: m.restrictedActions,
    safetyBadges: safetyBadges(m.safety),
  };
}
