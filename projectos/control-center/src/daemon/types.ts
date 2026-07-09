/**
 * Live view-model types for the Control Center's daemon client layer.
 *
 * These are plain DTOs redefined here (NOT imported from @projectos/bridge-daemon) so the
 * browser bundle never pulls in the Node daemon. The daemon remains the single source of
 * truth; these types only describe what the read-only UI renders.
 */

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

/** Messages a transport relays from the daemon to the client. */
export type TransportMessage =
  | { readonly kind: 'snapshot'; readonly snapshot: DaemonSnapshot }
  | { readonly kind: 'event'; readonly event: LiveEvent }
  | { readonly kind: 'notification'; readonly notification: LiveNotification }
  | { readonly kind: 'health'; readonly health: LiveHealth }
  | { readonly kind: 'closed' };

/** The complete observable UI state the store holds. */
export interface LiveState {
  readonly connection: ConnectionState;
  readonly reconnectAttempt: number;
  readonly health: LiveHealth | null;
  readonly workers: readonly LiveWorker[];
  readonly phases: readonly LivePhase[];
  readonly projects: readonly LiveProjectSummary[];
  readonly events: readonly LiveEvent[];
  readonly notifications: readonly LiveNotification[];
}
