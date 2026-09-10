/**
 * ProjectOS Core Engine — public API surface.
 *
 * Surfaces (Local Agent CLI, Control Center, Cloud Dashboard) import from here only.
 * Everything exported is pure and deterministic except EventBus (an edge helper).
 */
export * from './types.js';
export * from './phase.js';
export * from './task.js';
export * from './permissions.js';
export * from './risk.js';
export * from './approval.js';
export * from './events.js';
export * from './config.js';
export * from './closureAuthority.js';
export * from './closureDecision.js';
export * from './closureEligibility.js';
export * from './closureTransport.js';
export * from './gatekeeperDecision.js';
export * from './gatekeeperTransport.js';
export * from './gatekeeperCostLedger.js';
export * from './gatekeeperDegradedMode.js';
export * from './gatekeeperThread.js';
export * from './gatekeeperBridge.js';
export * from './gatekeeperModelPolicy.js';
export * from './gatekeeperMode.js';
export * from './ownerGateReceipt.js';
export * from './ownerOnlyActions.js';
export * from './technicalContinuation.js';
export * from './discovery.js';
export * from './plugins.js';
export * from './plugin-catalog.js';
export * from './workflow.js';
export * from './workers.js';
export * from './orchestration.js';
export * from './execution/index.js';

/** Engine version — bump on breaking changes to the public API. */
export const CORE_VERSION = '0.1.0';
