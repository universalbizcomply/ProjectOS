/**
 * ProjectOS Bridge Daemon — public API surface.
 *
 * The always-running local runtime that watches `.projectops` bridge folders, synchronises
 * derived state, manages worker presence, packages evidence signals and maintains the event
 * log. Vendor-independent (no AI/API/browser dependence); never edits business code, never
 * commits/pushes/deploys, never bypasses owner governance.
 */
export * from './types.js';
export * from './constants.js';

export { BridgeDaemon } from './daemon/bridgeDaemon.js';
export { nodeSystem, isWritableTarget } from './system.js';
export type { DaemonSystem } from './system.js';

export { loadConfig } from './config/configLoader.js';
export type { ConfigResult } from './config/configLoader.js';

export { EventBus } from './events/eventBus.js';
export { makeEvent, validateEvent, isCanonicalType, isInternalType } from './events/eventTypes.js';
export { parseEventLog, nextSeq, appendEvent, eventsForPhase } from './events/eventLog.js';

export { applyEvent, applyGitCommit, applyGitPush, initialState } from './state/stateManager.js';
export { isAllowedTransition, stageForEvent, stageToStatus } from './state/stateMachine.js';
export { toStateJson, writeState } from './state/stateStore.js';

export { applyWorkerEvent, onlineWorkers, workersForPhase, workerKey } from './workers/workerManager.js';
export type { WorkerMap } from './workers/workerManager.js';

export { scanProjects } from './watchers/projectScanner.js';
export { classifyChange, kindForPath } from './watchers/watchRouter.js';
export { FileWatcher } from './watchers/fileWatcher.js';

export { diffGit } from './git/gitWatcher.js';
export { readValidatorMarker } from './validators/validatorWatcher.js';
export { reportSignals, newEntries } from './reports/reportWatcher.js';
export { parseApproval, approvalEventType } from './reports/approvalWatcher.js';

export { buildDashboardSnapshot } from './sync/dashboardSync.js';
export { notificationsForEvent } from './notifications/notificationService.js';
export { rebuildFromEvents, pendingDecisions, pendingReviews } from './recovery/recoveryManager.js';
export { computeHealth } from './health/healthMonitor.js';
export { Logger, shouldLog, formatLine } from './logging/logger.js';

export { redact, redactValue, containsSecret } from './utils/redact.js';
export { Debouncer } from './utils/debounce.js';
export { uptimeMs } from './utils/clock.js';
export { parseJsonl, toJsonl, toJsonlLine } from './utils/jsonl.js';
