/**
 * Shared domain types for the ProjectOS core engine.
 *
 * These mirror the framework JSON schemas (schemas/*.schema.json) so surfaces can
 * round-trip manifests/configs without translation. Everything here is data-only:
 * no behaviour, no I/O.
 */

/** Governance roles. Owner = Murad, Advisor = ChatGPT, Implementer = Claude. */
export type Role = 'owner' | 'advisor' | 'implementer';

export const ROLES: readonly Role[] = ['owner', 'advisor', 'implementer'];

/**
 * Phase lifecycle status.
 * prompt -> implement -> validate -> evidence -> review -> closure, plus
 * rollback and the two terminal closed states seen in the reports index.
 */
export type PhaseStatus =
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

/** Task lifecycle status. */
export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'cancelled';

/** Coarse risk classification for an action. */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Canonical safety-gate keys (see schemas/safety-gates.schema.json). */
export type GateKey =
  | 'productionDeployGate'
  | 'productionDbMutationGate'
  | 'realMessagingGate'
  | 'paymentGate'
  | 'secretsHandlingGate'
  | 'forcePushProhibition'
  | 'externalServiceGate'
  | 'closureAuthorityGate';

export const GATE_KEYS: readonly GateKey[] = [
  'productionDeployGate',
  'productionDbMutationGate',
  'realMessagingGate',
  'paymentGate',
  'secretsHandlingGate',
  'forcePushProhibition',
  'externalServiceGate',
  'closureAuthorityGate',
];

export type GateStatus = 'gated' | 'prohibited';

export interface SafetyGate {
  readonly status: GateStatus;
  readonly requiresOwnerApproval: boolean;
  readonly description: string;
}

/** Generic success/failure result used across the engine for expected failures. */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: string): Result<T> {
  return { ok: false, error };
}
