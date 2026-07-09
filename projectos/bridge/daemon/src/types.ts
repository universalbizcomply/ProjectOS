/**
 * ProjectOS Bridge Daemon — shared types.
 *
 * These align to the bridge JSON-Schema contracts under `projectos/schemas/bridge/`
 * (event / state / worker-status). The daemon is intentionally decoupled from
 * `@projectos/core`: it speaks the file contract, not an in-process API, so it stays
 * vendor-independent and deterministic. No type here carries a secret.
 */

/** Roles that can author a bridge event (matches event.schema.json `actor`). */
export type Actor = 'owner' | 'advisor' | 'implementer' | 'agent' | 'core';

/**
 * Canonical bridge event types — the ones persisted to `event-log.jsonl` and validated
 * by event.schema.json. The daemon MUST NOT append any other type to a phase log.
 */
export const CANONICAL_EVENT_TYPES = [
  'TASK_CREATED',
  'PHASE_CREATED',
  'PROMPT_GENERATED',
  'PROMPT_READY',
  'PROMPT_READ',
  'IMPLEMENTATION_STARTED',
  'FILES_CHANGED',
  'VALIDATION_STARTED',
  'VALIDATION_COMPLETED',
  'EVIDENCE_CREATED',
  'REPORT_CREATED',
  'REVIEW_READY',
  'CHATGPT_REVIEW_STARTED',
  'CHATGPT_REVIEW_COMPLETED',
  'OWNER_APPROVED',
  'OWNER_REJECTED',
  'CHANGES_REQUESTED',
  'COMMIT_APPROVED',
  'PUSH_APPROVED',
  'PHASE_CLOSED',
  'PHASE_BLOCKED',
  'SAFETY_VIOLATION_DETECTED',
] as const;

export type CanonicalEventType = (typeof CANONICAL_EVENT_TYPES)[number];

/**
 * Daemon-internal event types — runtime signals for health, sync and worker presence.
 * These are NEVER written to a phase `event-log.jsonl` (they are not schema-valid there);
 * they drive the dashboard cache, notifications and the daemon's own event stream only.
 */
export const INTERNAL_EVENT_TYPES = [
  'PHASE_RESUMED',
  'WORKER_ONLINE',
  'WORKER_OFFLINE',
  'SYNC_STARTED',
  'SYNC_COMPLETED',
  'DAEMON_STARTED',
  'DAEMON_STOPPED',
] as const;

export type InternalEventType = (typeof INTERNAL_EVENT_TYPES)[number];

export type BridgeEventType = CanonicalEventType | InternalEventType;

/** One event. Persisted events carry `seq`; internal events use seq -1. */
export interface BridgeEvent {
  readonly id: string;
  readonly seq: number;
  readonly type: BridgeEventType;
  readonly project: string;
  readonly phase: string;
  readonly at: string;
  readonly actor: Actor;
  readonly source: string;
  readonly worker?: string;
  readonly version?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly relatedFiles?: readonly string[];
  readonly decisionRequired: boolean;
}

/** Persisted phase status — the enum in state.schema.json (source of truth on disk). */
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
  | 'rolled_back'
  | 'blocked';

/**
 * Fine-grained lifecycle stage the daemon tracks in memory. Richer than the persisted
 * status (it distinguishes approved → ready-to-commit → committed → ready-to-push →
 * pushed), but always maps back to a schema-valid PhaseStatus for state.json.
 */
export type PhaseStage =
  | 'created'
  | 'ready'
  | 'implementing'
  | 'validating'
  | 'evidence'
  | 'awaiting_review'
  | 'approved'
  | 'ready_to_commit'
  | 'committed'
  | 'ready_to_push'
  | 'pushed'
  | 'closed'
  | 'blocked'
  | 'rolled_back';

export type ValidatorState = 'unknown' | 'running' | 'pass' | 'fail';

/** Derived phase snapshot (aligns to state.schema.json for persistence). */
export interface PhaseState {
  readonly project: string;
  readonly phase: string;
  readonly stage: PhaseStage;
  readonly status: PhaseStatus;
  readonly updatedAt: string;
  readonly worker: string;
  readonly source: string;
  readonly version: string;
  readonly lastSeq: number;
  readonly branch?: string;
  readonly head?: string;
  readonly changedFiles?: readonly string[];
  readonly validators: ValidatorState;
  readonly blockers?: readonly string[];
  readonly decisionRequired: boolean;
  /** Stage held before a block, so PHASE_RESUMED returns to the right place. */
  readonly resumeStage?: PhaseStage;
}

export type WorkerStatus =
  | 'idle'
  | 'reading'
  | 'implementing'
  | 'validating'
  | 'reporting'
  | 'blocked'
  | 'waiting-approval'
  | 'reviewing'
  | 'done'
  | 'offline';

/** Live status of one worker on one phase (aligns to worker-status.schema.json). */
export interface WorkerState {
  readonly id: string;
  readonly project: string;
  readonly phase: string;
  readonly worker: string;
  readonly provider: string;
  readonly status: WorkerStatus;
  readonly online: boolean;
  readonly updatedAt: string;
  readonly currentAction?: string;
}

/** A project discovered by the scanner (never a hardcoded path). */
export interface ProjectDescriptor {
  readonly name: string;
  readonly root: string;
  readonly bridgeDir: string;
  readonly hasBridge: boolean;
}

/** Kinds of change the router can classify a filesystem path into. */
export type ChangeKind =
  | 'prompt'
  | 'report'
  | 'evidence'
  | 'event'
  | 'state'
  | 'approval'
  | 'worker'
  | 'phase'
  | 'git'
  | 'unknown';

export interface FileChange {
  readonly project: string;
  readonly path: string;
  readonly kind: ChangeKind;
}

export type NotificationKind =
  | 'prompt-ready'
  | 'report-ready'
  | 'review-required'
  | 'approval-required'
  | 'validation-failed'
  | 'worker-offline'
  | 'daemon-restarted'
  | 'dashboard-synced';

export interface Notification {
  readonly kind: NotificationKind;
  readonly project: string;
  readonly phase: string;
  readonly at: string;
  readonly message: string;
}

export type LogLevel =
  | 'INFO'
  | 'WARN'
  | 'ERROR'
  | 'EVENT'
  | 'SYNC'
  | 'VALIDATION'
  | 'RECOVERY'
  | 'ROTATION';

export interface LogLine {
  readonly level: LogLevel;
  readonly at: string;
  readonly msg: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export interface GitSnapshot {
  readonly branch: string;
  readonly head: string;
  readonly dirtyCount: number;
}

export interface DaemonConfig {
  readonly watchRoots: readonly string[];
  readonly watchIntervalMs: number;
  readonly debounceMs: number;
  readonly ignoredFolders: readonly string[];
  readonly dashboardSync: boolean;
  readonly logLevel: LogLevel;
  readonly plugins: readonly string[];
}

export interface HealthSnapshot {
  readonly running: boolean;
  readonly version: string;
  readonly uptimeMs: number;
  readonly projects: number;
  readonly workers: number;
  readonly watchers: number;
  readonly pendingEvents: number;
  readonly pendingPrompts: number;
  readonly pendingReports: number;
  readonly pendingApprovals: number;
}

/** Redacted, secret-free projection pushed to the dashboard cache. */
export interface DashboardSnapshot {
  readonly generatedAt: string;
  readonly version: string;
  readonly projects: readonly DashboardProjectSummary[];
}

export interface DashboardProjectSummary {
  readonly project: string;
  readonly phase: string;
  readonly stage: PhaseStage;
  readonly status: PhaseStatus;
  readonly validators: ValidatorState;
  readonly decisionRequired: boolean;
  readonly workers: readonly {
    readonly worker: string;
    readonly status: WorkerStatus;
    readonly online: boolean;
  }[];
  readonly blockers: readonly string[];
}
