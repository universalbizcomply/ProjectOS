/**
 * Daemon client layer — browser-safe barrel.
 *
 * Deliberately does NOT re-export inProcessTransport: that module type-imports the Node daemon
 * and is only pulled in by a Node/Tauri host or the tests (imported from its own path). Keeping
 * it out of this barrel guarantees the browser bundle stays free of node:fs.
 */
export * from './types.js';
export * from './ports.js';
export { LiveStore, INITIAL_STATE } from './store.js';
export { StatusSynchroniser } from './synchroniser.js';
export { EventStream, HealthStream, matchEvent, filterEvents } from './eventStream.js';
export type { EventFilter } from './eventStream.js';
export {
  ConnectionManager,
  ReconnectManager,
  Heartbeat,
  DaemonConnection,
  backoffDelay,
} from './connection.js';
export {
  DaemonHealthProvider,
  WorkerStatusProvider,
  PhaseStatusProvider,
  NotificationProvider,
  selectHealth,
  selectWorkers,
  selectPhases,
  selectProjects,
  selectNotifications,
  selectPendingReviews,
  selectApprovals,
  selectOnlineWorkers,
} from './providers.js';
export { DaemonClient } from './daemonClient.js';
export type { DaemonClientOptions } from './daemonClient.js';
export { NullTransport } from './nullTransport.js';
export { TauriIPCTransport } from './tauriIpcTransport.js';
export { createDesktopTransport } from './selectTransport.js';
export { tauriBridge } from './tauriBridge.js';
export type { IpcBridge } from './ipcBridge.js';
export { IPC_COMMANDS, IPC_EVENT_CHANNEL, IPC_READS } from './ipcCommands.js';
export { encodeMessageLine, parseMessageLine, encodeCommand, parseCommandLine } from './ipcProtocol.js';
export { realScheduler } from './realScheduler.js';
export { redact, containsSecret } from './redact.js';
