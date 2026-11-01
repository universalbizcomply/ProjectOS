// Origin: original ProjectOS code
/**
 * Approval binding, taint tracking and evidence receipts (ADR-P1, plan v1.31).
 *
 * Pure rules beside the kernel's gates. Nothing in the run loop calls these yet.
 */
export * from './effectKey.js';
export * from './taint.js';
export * from './toolApproval.js';
export * from './evidenceReceipt.js';
