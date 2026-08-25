/**
 * Governed projection — the shape of REAL canonical ProjectOS state as the owner surface sees it.
 *
 * This is deliberately NOT the bridge daemon's model. The bridge daemon carries its own twelve-stage
 * `PhaseStage` spine persisted under `.projectops/bridge/`; `@projectos/core` carries the
 * nine-status governed lifecycle persisted to `.projectops/phases/<id>.json`. Only the second is the
 * governance authority, so the owner surface reads that one. Routing owner control through the
 * daemon's model would make it a third governance runtime, which crosswalk §5c forbids.
 *
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */

/** The nine `@projectos/core` phase statuses, plus the absence of a record. */
export type GovernedPhaseStatus =
  | 'not-started'
  | 'draft'
  | 'prompted'
  | 'implementing'
  | 'validating'
  | 'evidence'
  | 'awaiting_review'
  | 'awaiting_closure'
  | 'closed'
  | 'closed_as_blocked'
  | 'rolled_back';

export interface GovernedTransition {
  readonly from: string;
  readonly to: string;
  readonly by: string;
  readonly at: string;
  readonly note?: string;
}

export interface GovernedPhaseView {
  readonly phaseId: string;
  readonly description: string;
  readonly status: GovernedPhaseStatus;
  readonly dependsOn: readonly string[];
  /** Dependencies not yet recorded complete. Empty means the phase may be started. */
  readonly unmetDependencies: readonly string[];
  /** True when the phase is in the approved plan AND its dependencies are satisfied. */
  readonly startable: boolean;
  readonly requiredOwnerGates: readonly string[];
  readonly requiredBrowserProof: boolean;
  readonly history: readonly GovernedTransition[];
  /** Recorded complete by the programme record even though the runtime never drove it. */
  readonly closedByRecord: boolean;
}

export interface GovernedPlanView {
  readonly planId: string;
  readonly planVersion: string;
  /** The status the record CLAIMS. Never used to decide anything — shown beside `ready`. */
  readonly declaredStatus: string;
  /** Recomputed by the real engine, never read from the record. */
  readonly ready: boolean;
  readonly unmetReasons: readonly string[];
  readonly planPath: string;
  readonly supersedes: string | null;
}

export interface GovernedProgrammeView {
  readonly acceptedPhaseCount: number;
  readonly totalPhaseCount: number;
  readonly completionPercentage: number;
  readonly completedPhases: readonly string[];
  readonly pendingPhases: readonly string[];
}

export interface GovernedDelegationView {
  readonly delegatedBy: string;
  readonly delegatedTo: string;
  readonly delegatedScope: readonly string[];
  readonly projectScope: string;
  readonly excludesProtectedActions: boolean;
}

export interface GovernedAuthorityView {
  readonly owner: string;
  readonly gatekeeper: string;
  readonly implementer: string;
  readonly closureAuthority: string;
  readonly closureDelegation: GovernedDelegationView | null;
  readonly ownerOnlyActions: readonly string[];
}

/**
 * The gatekeeper's own spend, read from the SAME cost ledger `projectos run` writes to and
 * enforces against. Never inferred or estimated — every number here is a pure re-summarisation of
 * ledger entries the runtime already wrote, using the runtime's own `summariseLedger`/
 * `evaluateBudget` functions, so this can never disagree with what actually decides a call.
 */
export interface GovernedGatekeeperView {
  /** Whether `.projectops/gatekeeper.json` exists and declares `enabled: true`. */
  readonly configured: boolean;
  /** `null` when no budget is configured — never rendered as $0. */
  readonly budget: {
    readonly status: 'OK' | 'WARNING' | 'STOPPED';
    readonly spentThisMonthMicroUsd: number;
    readonly remainingMicroUsd: number;
    readonly warnAtMicroUsd: number;
    readonly hardStopAtMicroUsd: number;
  } | null;
  readonly spentThisPhaseMicroUsd: number;
  readonly spentThisProjectMicroUsd: number;
  readonly callCount: number;
  /** The most recent ledger entry, however it resolved. `null` means never contacted. */
  readonly lastCall: { readonly requestId: string; readonly model: string; readonly at: string; readonly costMicroUsd: number } | null;
}

export interface GovernedSafetyView {
  readonly productionFreeze: boolean;
  readonly forbiddenActions: readonly string[];
  readonly approvalGates: readonly string[];
}

export interface GovernedRepositoryView {
  readonly repo: string;
  readonly localPath: string;
  readonly branch: string | null;
  readonly head: string | null;
  readonly protectedBranches: readonly string[];
  readonly onProtectedBranch: boolean;
}

/** A connected projection of real governed state. */
export interface GovernedProjection {
  readonly connected: true;
  readonly projectId: string;
  readonly projectName: string;
  readonly repository: GovernedRepositoryView;
  readonly plan: GovernedPlanView;
  readonly programme: GovernedProgrammeView;
  readonly phases: readonly GovernedPhaseView[];
  readonly activePhase: GovernedPhaseView | null;
  readonly nextStartablePhase: GovernedPhaseView | null;
  readonly authority: GovernedAuthorityView;
  readonly gatekeeperStatus: GovernedGatekeeperView;
  readonly safety: GovernedSafetyView;
  readonly blockers: readonly string[];
  readonly risks: readonly string[];
  readonly nextSafeAction: string;
  /** Millisecond timestamp supplied by the producer — never generated inside the pure projection. */
  readonly observedAt: string;
}

/**
 * The honest alternative to a projection. The browser preview has no filesystem and no runtime, so
 * it renders THIS rather than a synthetic snapshot dressed up as live state.
 */
export interface GovernedUnavailable {
  readonly connected: false;
  readonly reason: GovernedUnavailableReason;
  readonly detail: string;
}

export type GovernedUnavailableReason =
  | 'NO_RUNTIME'
  | 'RUNTIME_STARTING'
  | 'RUNTIME_STOPPED'
  | 'REFUSED';

export type GovernedState = GovernedProjection | GovernedUnavailable;

/**
 * The wire discriminant. Governed state travels as an ordinary transport message on the existing
 * `daemon://message` channel rather than through a parallel protocol, so the encode/parse pair, the
 * client dispatch and the store stay single-sourced.
 */
export const GOVERNED_MESSAGE_KIND = 'governed';

export interface GovernedStateMessage {
  readonly kind: typeof GOVERNED_MESSAGE_KIND;
  readonly state: GovernedState;
}

export function isGovernedStateMessage(value: unknown): value is GovernedStateMessage {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  if (rec['kind'] !== GOVERNED_MESSAGE_KIND) return false;
  const state = rec['state'];
  return typeof state === 'object' && state !== null && 'connected' in state;
}

/**
 * ONE installed project the owner may select. Non-secret, non-authoritative: it says what a project
 * is called and where it lives, and grants nothing.
 */
export interface GovernedProjectSummary {
  readonly projectId: string;
  readonly projectName: string;
  readonly repositoryRoot: string;
  /** The repository identity from the project's own configuration (`owner/name`, or `none`). */
  readonly repository: string;
}

/**
 * The installed-project inventory as the daemon reports it.
 *
 * `registryStatus` is the closed token the Rust host produced when it read the protected registry —
 * `ok`, `missing`, `malformed`, `invalid`, `unreadable`, `anchor-unresolved` — or `null` in a
 * development run, where there is no installed host and therefore no registry to read.
 */
export interface GovernedProjectsInventory {
  readonly projects: readonly GovernedProjectSummary[];
  readonly registryStatus: string | null;
  /** How many supplied roots did not survive validation. A number, never a path. */
  readonly refusedCount: number;
  readonly selectedProjectId: string | null;
}
