/**
 * Live view-model types for the Control Center's daemon client layer.
 *
 * These are plain DTOs redefined here (NOT imported from @projectos/bridge-daemon) so the
 * browser bundle never pulls in the Node daemon. The daemon remains the single source of
 * truth; these types only describe what the read-only UI renders.
 */

import type { GovernedState } from '../governed/types.js';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

export type LiveWorkerStatus =
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

export interface LiveWorker {
  readonly worker: string;
  readonly provider: string;
  readonly project: string;
  readonly phase: string;
  readonly status: LiveWorkerStatus;
  readonly online: boolean;
  readonly currentAction?: string;
  readonly updatedAt: string;
}

export type LivePhaseStage =
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

export type LiveValidatorState = 'unknown' | 'running' | 'pass' | 'fail';

export interface LivePhase {
  readonly project: string;
  readonly phase: string;
  readonly stage: LivePhaseStage;
  readonly status: string;
  readonly validators: LiveValidatorState;
  readonly decisionRequired: boolean;
  readonly worker: string;
  readonly branch?: string;
  readonly blockers: readonly string[];
}

export interface LiveHealth {
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
  readonly recovered: boolean;
}

export interface LiveEvent {
  readonly id: string;
  readonly at: string;
  readonly type: string;
  readonly project: string;
  readonly phase: string;
  readonly actor: string;
  readonly worker?: string;
}

export type LiveNotificationKind =
  | 'prompt-ready'
  | 'report-ready'
  | 'review-required'
  | 'approval-required'
  | 'validation-failed'
  | 'worker-offline'
  | 'daemon-restarted'
  | 'dashboard-synced';

export interface LiveNotification {
  readonly kind: LiveNotificationKind;
  readonly project: string;
  readonly phase: string;
  readonly at: string;
  readonly message: string;
}

export interface LiveProjectSummary {
  readonly project: string;
  readonly phase: string;
  readonly stage: LivePhaseStage;
  readonly worker: string;
  readonly validators: LiveValidatorState;
  readonly decisionRequired: boolean;
  readonly branch?: string;
}

/** A full point-in-time projection pushed by the transport on connect / request. */
export interface DaemonSnapshot {
  readonly health: LiveHealth;
  readonly workers: readonly LiveWorker[];
  readonly phases: readonly LivePhase[];
  readonly projects: readonly LiveProjectSummary[];
  readonly notifications: readonly LiveNotification[];
}

/**
 * The host's authoritative worker-lifecycle states (Rust `DaemonStatus`). This is a DIFFERENT
 * concern from `ConnectionState`: connection describes the transport, lifecycle describes the
 * local worker the host owns. Before readiness the lifecycle is the authority — a snapshot only
 * ever carries project data.
 */
export type DaemonLifecycleState =
  | 'NOT_STARTED'
  | 'RECOVERING'
  | 'STARTING'
  | 'RUNNING_READ_ONLY'
  | 'STOPPING'
  | 'STOPPED'
  | 'CRASHED'
  | 'BLOCKED';

/**
 * The host's redacted lifecycle projection (Rust `SafeDaemonStatus`). It carries no PID, path,
 * SID, handle, hash or native error code — `nextSafeAction` is the host's own owner-facing
 * sentence and is rendered verbatim, never rewritten here.
 */
export interface LiveLifecycle {
  readonly state: DaemonLifecycleState;
  readonly readOnlyAvailable: boolean;
  readonly protectedApprovalsDisabled: boolean;
  readonly nextSafeAction: string;
}

/**
 * Messages a transport relays to the client.
 *
 * `lifecycle` is host-authoritative and synthesised ONLY by the desktop transport from the
 * `daemon_status` command — it is deliberately absent from the wire protocol's accepted kinds
 * (`ipcProtocol.MESSAGE_KINDS`), so the daemon can never assert its own lifecycle over the event
 * channel.
 */
export type TransportMessage =
  | { readonly kind: 'snapshot'; readonly snapshot: DaemonSnapshot }
  | { readonly kind: 'event'; readonly event: LiveEvent }
  | { readonly kind: 'notification'; readonly notification: LiveNotification }
  | { readonly kind: 'health'; readonly health: LiveHealth }
  | { readonly kind: 'lifecycle'; readonly lifecycle: LiveLifecycle }
  /** Canonical governed state, read from `@projectos/core` records — NOT the daemon's own model. */
  | { readonly kind: 'governed'; readonly state: GovernedState }
  | { readonly kind: 'closed' };

/** The complete observable UI state the store holds. */
export interface LiveState {
  readonly connection: ConnectionState;
  readonly reconnectAttempt: number;
  /** The host's worker lifecycle; `null` until the first `daemon_status` reply (or in a browser). */
  readonly lifecycle: LiveLifecycle | null;
  readonly health: LiveHealth | null;
  readonly workers: readonly LiveWorker[];
  readonly phases: readonly LivePhase[];
  readonly projects: readonly LiveProjectSummary[];
  readonly events: readonly LiveEvent[];
  readonly notifications: readonly LiveNotification[];
  /**
   * Canonical governed state from the ProjectOS runtime. `null` until the first governed message —
   * in a plain browser build that is forever, and the surface says so rather than inventing a seed.
   */
  readonly governed: GovernedState | null;
}
