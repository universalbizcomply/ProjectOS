/**
 * Phase state machine — pure. Encodes the ONLY legal transitions. The daemon consults this
 * before every stage change; an event implying an illegal transition is refused (the caller
 * logs an anomaly) rather than silently corrupting state. It never invents a transition.
 */
import type { BridgeEventType, PhaseStage, PhaseStatus } from '../types.js';

/** Explicit adjacency: from-stage → set of stages it may legally move to. */
const ALLOWED: Readonly<Record<PhaseStage, readonly PhaseStage[]>> = {
  created: ['ready', 'blocked', 'rolled_back'],
  ready: ['implementing', 'blocked', 'rolled_back'],
  implementing: ['implementing', 'validating', 'blocked', 'rolled_back'],
  validating: ['validating', 'evidence', 'implementing', 'blocked', 'rolled_back'],
  evidence: ['awaiting_review', 'implementing', 'blocked', 'rolled_back'],
  awaiting_review: ['awaiting_review', 'approved', 'implementing', 'blocked', 'rolled_back'],
  approved: ['ready_to_commit', 'implementing', 'blocked', 'rolled_back'],
  ready_to_commit: ['committed', 'blocked', 'rolled_back'],
  committed: ['ready_to_push', 'blocked', 'rolled_back'],
  // push is not always observable locally, so a closed-from-ready_to_push edge is allowed too.
  ready_to_push: ['pushed', 'closed', 'blocked', 'rolled_back'],
  pushed: ['closed', 'blocked', 'rolled_back'],
  closed: [],
  blocked: [], // resume is handled explicitly by the reducer (target = resumeStage)
  rolled_back: ['closed'],
};

/** True if `to` is a legal next stage from `from`. */
export function isAllowedTransition(from: PhaseStage, to: PhaseStage): boolean {
  if (from === to) return (ALLOWED[from] ?? []).includes(to);
  return (ALLOWED[from] ?? []).includes(to);
}

/**
 * Target stage implied by a canonical event, or null when the event does not move the stage
 * (e.g. VALIDATION_COMPLETED updates the validator flag but not the lifecycle stage).
 */
export function stageForEvent(type: BridgeEventType): PhaseStage | null {
  switch (type) {
    case 'TASK_CREATED':
    case 'PHASE_CREATED':
      return 'created';
    case 'PROMPT_GENERATED':
    case 'PROMPT_READY':
      return 'ready';
    case 'PROMPT_READ':
    case 'IMPLEMENTATION_STARTED':
    case 'FILES_CHANGED':
      return 'implementing';
    case 'VALIDATION_STARTED':
      return 'validating';
    case 'EVIDENCE_CREATED':
    case 'REPORT_CREATED':
      return 'evidence';
    case 'REVIEW_READY':
    case 'CHATGPT_REVIEW_STARTED':
    case 'CHATGPT_REVIEW_COMPLETED':
      return 'awaiting_review';
    case 'OWNER_APPROVED':
      return 'approved';
    case 'COMMIT_APPROVED':
      return 'ready_to_commit';
    case 'PUSH_APPROVED':
      return 'ready_to_push';
    case 'PHASE_CLOSED':
      return 'closed';
    case 'OWNER_REJECTED':
    case 'CHANGES_REQUESTED':
      return 'implementing';
    case 'PHASE_BLOCKED':
    case 'SAFETY_VIOLATION_DETECTED':
      return 'blocked';
    default:
      // VALIDATION_COMPLETED + all internal events do not move the stage.
      return null;
  }
}

/** Map a fine-grained stage to the schema-valid persisted status. */
export function stageToStatus(stage: PhaseStage): PhaseStatus {
  switch (stage) {
    case 'created':
      return 'draft';
    case 'ready':
      return 'prompted';
    case 'implementing':
      return 'implementing';
    case 'validating':
      return 'validating';
    case 'evidence':
      return 'evidence';
    case 'awaiting_review':
      return 'awaiting_review';
    case 'approved':
    case 'ready_to_commit':
    case 'committed':
    case 'ready_to_push':
    case 'pushed':
      return 'awaiting_closure';
    case 'closed':
      return 'closed';
    case 'blocked':
      return 'blocked';
    case 'rolled_back':
      return 'rolled_back';
  }
}
