// Origin: original ProjectOS code
/**
 * Approval binding, taint tracking and evidence receipts (ADR-P1, plan v1.31).
 *
 * Pure rules beside the kernel's gates. Nothing in the run loop calls these yet.
 *
 * ONLY THE CHECKS ARE PUBLIC. What issues a guard, an approval, a receipt or a plan is not exported here,
 * so nothing that imports core can mint one. The phase that wires this in adds what its kernel code needs,
 * deliberately, and moves AP-29 and AP-32 with it.
 */
export { canonicalArguments, deriveToolEffect, type CanonicalArguments, type ToolCall, type ToolEffect, type ToolEffectResult } from './effectKey.js';
export { actionCouldBeSteered, freshApprovalNeeded, isRunTainted, RunGuardRefused, toolResultTaintsRun, type RunGuard, type RunGuardRule, type RunStart } from './taint.js';
export {
  checkToolCall,
  MAX_APPROVAL_LIFETIME_MS,
  type ApprovalIssueRule,
  type ToolApproval,
  type ToolApprovalDecision,
  type ToolApprovalResult,
  type ToolCheckResult,
  type ToolCheckRule,
} from './toolApproval.js';
export {
  CHECK_SOURCES,
  claimDone,
  type CheckConfidence,
  type CheckObservation,
  type CheckSource,
  type DoneClaim,
  type DoneGap,
  type DoneRule,
  type DoneVerdict,
  type EvidenceReceipt,
  type PlanCheck,
  type PlanChecks,
  type PlanChecksResult,
  type ReceiptResult,
} from './evidenceReceipt.js';
