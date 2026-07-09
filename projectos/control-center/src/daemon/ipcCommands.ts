/**
 * IPCCommandRegistry — the fixed, read-only surface exposed over Tauri IPC. The transport uses
 * only these; there is no write/exec command by design (governance stays in the daemon/CLI).
 *
 * Per-concern reads (health/workers/phases/…) are NOT separate IPC commands: one snapshot
 * carries them all, and the existing providers (DaemonHealthProvider / WorkerStatusProvider /
 * PhaseStatusProvider / NotificationProvider) slice it. That mapping is the "IPC*Provider" layer
 * — reused, not duplicated.
 */
export const IPC_EVENT_CHANNEL = 'daemon://message';

export const IPC_COMMANDS = {
  /** Ask the sidecar/daemon to re-emit a full snapshot over the event channel. */
  requestSnapshot: 'daemon_request_snapshot',
  /** Read the last cached snapshot synchronously (initial paint / recovery). */
  snapshot: 'daemon_snapshot',
  /** Read whether the sidecar/daemon is alive. */
  status: 'daemon_status',
} as const;

export type IpcCommand = (typeof IPC_COMMANDS)[keyof typeof IPC_COMMANDS];

/**
 * Logical read-only views the IPC layer serves (spec's command list). Each resolves against the
 * single snapshot via the named provider selector — documented here so the mapping is explicit.
 */
export const IPC_READS: Readonly<Record<string, string>> = {
  health: 'snapshot.health (DaemonHealthProvider)',
  workerStatus: 'snapshot.workers (WorkerStatusProvider)',
  phaseStatus: 'snapshot.phases (PhaseStatusProvider)',
  projectStatus: 'snapshot.projects',
  eventStream: 'event channel (EventStream)',
  notifications: 'snapshot.notifications (NotificationProvider)',
  reports: 'snapshot.phases[stage=evidence|awaiting_review]',
  approvals: 'snapshot.phases[decisionRequired] (selectApprovals)',
  pendingReviews: 'snapshot.phases[stage=awaiting_review] (selectPendingReviews)',
  syncStatus: 'health.pendingEvents + SYNC_COMPLETED events',
};
