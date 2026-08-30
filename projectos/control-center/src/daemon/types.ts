/**
 * Live view-model types for the Control Center's daemon client layer.
 *
 * These are plain DTOs redefined here (NOT imported from @projectos/bridge-daemon) so the
 * browser bundle never pulls in the Node daemon. The daemon remains the single source of
 * truth; these types only describe what the read-only UI renders.
 */

import type { GovernedState } from '../governed/types.js';
import type { GovernedProjectsInventory } from '../governed/types.js';
import type { PortfolioMessage } from '../governed/projectInventory.js';

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
  /**
   * WHICH projects this installation may govern, and which one is selected.
   *
   * Produced by the daemon from the roots the Rust host read out of the protected registry. The
   * renderer never adds to it, never reorders it and never selects from anywhere else: a project the
   * host did not supply is simply not here, so it cannot be chosen.
   */
  | { readonly kind: 'governed-projects'; readonly inventory: GovernedProjectsInventory }

  /**
   * Every registered project, reduced to a row. Emitted alongside the selected project's full
   * projection, and built the same way: the daemon's own pure governed-state builder, once per
   * registered root. No project is selected to produce it.
   */
  | { readonly kind: 'governed-portfolio'; readonly portfolio: PortfolioMessage }
  /**
   * The governed run's own lifecycle, reported directly by the sidecar about the `projectos run`
   * process it spawned and tracks — never inferred from file-watching, unlike `event`/`notification`.
   */
  | { readonly kind: 'run-started'; readonly root: string; readonly phaseId: string | null; readonly resumed: boolean }
  | {
      readonly kind: 'run-output';
      readonly root: string;
      readonly phaseId: string | null;
      readonly stream: 'stdout' | 'stderr';
      readonly line: string;
    }
  | { readonly kind: 'run-finished'; readonly root: string; readonly phaseId: string | null; readonly exitCode: number | null }
  | { readonly kind: 'closed' };

/**
 * Live view of the governed run this sidecar is tracking (or has most recently tracked) for the
 * SELECTED project. `active` is the one field the UI needs to decide what a Start/Resume/Stop
 * control should offer; `lines` is bounded so a long-running review does not grow the store
 * without limit.
 */
export interface GovernedRunState {
  /**
   * WHICH PROJECT THIS RUN BELONGS TO. The daemon has always sent the root on every run event; this
   * client stored one flat run state and threw it away. That was safe only while live state belonged
   * solely to the selected project — the moment a portfolio row shows worker state, an unrooted event
   * could paint one project's activity onto another's row.
   *
   * `null` means no run has been observed, which is not the same as a run with no project.
   */
  readonly root: string | null;
  readonly active: boolean;
  readonly phaseId: string | null;
  readonly resumed: boolean;
  readonly startedAt: string | null;
  readonly lastExitCode: number | null;
  readonly lines: readonly { readonly stream: 'stdout' | 'stderr'; readonly line: string }[];
}

export const EMPTY_GOVERNED_RUN: GovernedRunState = {
  root: null,
  active: false,
  phaseId: null,
  resumed: false,
  startedAt: null,
  lastExitCode: null,
  lines: [],
};

/** How many output lines the store retains for the live run panel. Older lines are dropped. */
export const GOVERNED_RUN_LINE_LIMIT = 500;

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
  /**
   * The installed projects and the current selection. `null` until the first inventory message —
   * absence means "not known yet", never "there are none".
   */
  readonly governedProjects: GovernedProjectsInventory | null;
  /** The governed run this sidecar is tracking for the selected project. See `EMPTY_GOVERNED_RUN`. */
  readonly governedRun: GovernedRunState;

  /**
   * Every registered project, reduced to a row. `null` until the first portfolio message — absence
   * means "not known yet", never "there are none".
   *
   * Read-only by construction: the daemon builds it by calling its own pure governed-state builder
   * once per registered root. No project is selected to produce it.
   */
  readonly portfolio: PortfolioMessage | null;
}
