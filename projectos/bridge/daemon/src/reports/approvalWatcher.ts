/**
 * Approval watcher — pure. Interprets an owner decision file into the matching canonical
 * event. Only the OWNER authors these (the daemon never approves or closes anything); this
 * simply reflects a decision the owner already recorded on disk into the event stream.
 */
import type { CanonicalEventType } from '../types.js';

export type Decision = 'approved' | 'rejected' | 'changes' | 'commit' | 'push' | 'close';

/** Map an owner decision to its canonical event type. Unknown decisions → null. */
export function approvalEventType(decision: string): CanonicalEventType | null {
  switch (decision) {
    case 'approved':
      return 'OWNER_APPROVED';
    case 'rejected':
      return 'OWNER_REJECTED';
    case 'changes':
      return 'CHANGES_REQUESTED';
    case 'commit':
      return 'COMMIT_APPROVED';
    case 'push':
      return 'PUSH_APPROVED';
    case 'close':
      return 'PHASE_CLOSED';
    default:
      return null;
  }
}

export interface ParsedApproval {
  readonly type: CanonicalEventType;
  readonly decision: Decision;
}

/**
 * Parse an approval file `{ "decision": "...", "decidedBy": "owner" }`. Only decisions made
 * by the owner are honoured — an approval not attributed to the owner is ignored (returns
 * null), enforcing owner-only gating at the daemon boundary.
 */
export function parseApproval(rawJson: string | null): ParsedApproval | null {
  if (rawJson === null || rawJson.trim().length === 0) return null;
  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (parsed === null || typeof parsed !== 'object') return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const decidedBy = obj['decidedBy'];
  if (decidedBy !== undefined && decidedBy !== 'owner') return null;
  const decision = obj['decision'];
  if (typeof decision !== 'string') return null;
  const type = approvalEventType(decision);
  if (type === null) return null;
  return { type, decision: decision as Decision };
}
