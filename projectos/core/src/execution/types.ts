/**
 * Authoritative execution-runtime types.
 *
 * The single source of truth for execution state, identity binding, actor authority, commands and
 * records. Pure/deterministic; no I/O, clock or randomness here. Consumed later by CLI, daemon and
 * Tauri — none of which are wired in this phase. Created in PROJECTOS-EXECUTION-RUNTIME-CORE1A.
 */
import type { Role } from '../types.js';
import type { BlockReason, RecoveryStrategy } from './recovery.js';

/** Every authoritative execution state. */
export type ExecutionState =
  | 'IDLE'
  | 'READY'
  | 'STARTING'
  | 'RUNNING'
  | 'PAUSE_REQUESTED'
  | 'PAUSED'
  | 'RESUME_REQUESTED'
  | 'STOP_REQUESTED'
  | 'EMERGENCY_STOP_REQUESTED'
  | 'CANCELLING'
  | 'STOPPED'
  | 'CANCELLED'
  | 'FAILED'
  | 'RECOVERING'
  | 'BLOCKED'
  | 'UNAVAILABLE';

export const EXECUTION_STATES: readonly ExecutionState[] = [
  'IDLE', 'READY', 'STARTING', 'RUNNING', 'PAUSE_REQUESTED', 'PAUSED', 'RESUME_REQUESTED',
  'STOP_REQUESTED', 'EMERGENCY_STOP_REQUESTED', 'CANCELLING', 'STOPPED', 'CANCELLED', 'FAILED',
  'RECOVERING', 'BLOCKED', 'UNAVAILABLE',
];

/** Terminal states — immutable; a terminal record can never transition again. */
export const TERMINAL_STATES: ReadonlySet<ExecutionState> = new Set<ExecutionState>([
  'STOPPED', 'CANCELLED', 'FAILED',
]);

/**
 * Execution environment. No authoritative enum exists in core yet, so it is defined here.
 * UNKNOWN is never treated as LOCAL — it blocks any mutation (fail-closed).
 */
export type ExecutionEnvironment = 'local' | 'staging' | 'production' | 'unknown';
export const MUTABLE_ENVIRONMENTS: ReadonlySet<ExecutionEnvironment> = new Set<ExecutionEnvironment>([
  'local', 'staging', 'production',
]);

/** Provider kinds. Only `synthetic` is implemented in this phase. */
export type ExecutionProviderKind = 'synthetic' | 'governed-worker' | 'local-script';

export type ExecutionCommandName =
  | 'register' | 'start' | 'pause' | 'resume' | 'stop' | 'emergencyStop' | 'status' | 'recover' | 'list';

/**
 * Actor kinds — closed union. Only `human-owner` may satisfy an owner-only command (and only under
 * a recognised owner authority source). `synthetic-test-owner` is accepted ONLY under an explicit
 * test policy, never production.
 */
export type ExecutionActorKind =
  | 'human-owner'
  | 'advisor'
  | 'claude'
  | 'daemon'
  | 'worker'
  | 'system'
  | 'synthetic-test-owner';

/** Authority sources — closed union. Arbitrary strings are rejected. */
export type ExecutionAuthoritySource =
  | 'tauri-owner-attestation'
  | 'cli-owner-confirmation'
  | 'system-controller'
  | 'synthetic-test-fixture';

/** Which authority the controller enforces. `test` additionally permits synthetic owner authority. */
export type AuthorityPolicy = 'production' | 'test';

/**
 * A STRICT trusted-actor claims envelope. CORE does NOT authenticate users and does NOT verify
 * Supabase or Windows identity — a future trusted boundary (Tauri owner attestation / CLI owner
 * confirmation) ESTABLISHES authenticity and constructs this envelope. React must never construct
 * it directly. Core VALIDATES the claim: closed-union kind/source, mandatory reference, strict
 * RFC3339 timestamps, expiry, and the production/test authority policy. A bare role string never
 * establishes owner authority.
 */
export interface TrustedActorContext {
  readonly actorId: string;
  readonly role: Role;
  readonly actorKind: ExecutionActorKind;
  readonly authoritySource: ExecutionAuthoritySource;
  /**
   * An OPAQUE, NON-SECRET attestation identifier supplied by the trusted boundary — NOT an access
   * token / refresh token / cookie / JWT / API key / raw session payload. Only the actorId is ever
   * persisted to a record (as `actorReference`); `authorityReference` and `sessionReference` are
   * validated for presence but never persisted, so no secret-bearing data enters runtime state.
   */
  readonly authorityReference: string;
  readonly sessionReference?: string;
  readonly verifiedAt: string;
  readonly expiresAt: string;
}

/** Immutable identity every execution record binds to. */
export interface ExecutionIdentity {
  readonly projectId: string;
  readonly phaseId: string;
  readonly environment: ExecutionEnvironment;
  readonly operationId: string;
  readonly providerId: string;
  readonly providerKind: ExecutionProviderKind;
}

/** The persisted execution record. `revision` drives optimistic concurrency. */
export interface ExecutionRecord {
  readonly identity: ExecutionIdentity;
  readonly state: ExecutionState;
  readonly revision: number;
  readonly predecessorOperationId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pauseRequestedAt?: string;
  readonly stopRequestedAt?: string;
  readonly reason: string;
  readonly nextSafeAction: string;
  readonly lastEvidenceHash?: string;
  readonly recoveryStatus?: 'reconciled' | 'unresolved';
  /** Typed reason + strategy recorded whenever the record is BLOCKED or UNAVAILABLE. */
  readonly blockReason?: BlockReason;
  readonly recoveryStrategy?: RecoveryStrategy;
  readonly automaticRecheckAllowed?: boolean;
  readonly providerProbeAllowed?: boolean;
}

/** Provider capability + safety metadata. */
export interface ExecutionProviderMetadata {
  readonly providerId: string;
  readonly providerKind: ExecutionProviderKind;
  readonly capabilities: {
    readonly start: boolean;
    readonly pause: boolean;
    readonly resume: boolean;
    readonly stop: boolean;
    readonly terminate: boolean;
    readonly probe: boolean;
  };
  readonly externalNetworkAllowed: boolean;
  readonly secretAccessAllowed: boolean;
  readonly productRepositoryAccessAllowed: boolean;
  /** Human-facing label; the synthetic provider states it is not a real worker. */
  readonly label: string;
}
