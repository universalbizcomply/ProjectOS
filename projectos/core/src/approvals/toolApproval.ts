// Origin: original ProjectOS code
/**
 * An owner's approval of one exact tool call, and the check a call must pass.
 *
 * A CLEAR RESULT GRANTS NOTHING. This sits beside the kernel's gates and replaces none of them. An action
 * still goes through `admitEnvelope`, the owner floor and the closure rules. This check can only stop a
 * call: an approval is necessary where taint demands one and is never sufficient anywhere. The result
 * says `taintClear` and not "allowed" for that reason. A P5 that clears here is still refused at the door.
 *
 * ONLY A PERSON DECIDES. A decision names who decided and when it lapses, and nothing else. There is no
 * mode, no setting that skips the check, no model that clears a call, and no rule that remembers a yes:
 * `ToolApprovalDecision` has no field for any of them, and `decidedBy` must be the owner.
 *
 * WHAT THIS MODULE CANNOT PROVE. `decidedBy` is a role string handed in by kernel code. That it comes
 * from the owner's authenticated decision and never from worker text is the job of the call site, as it
 * is for `principal` on an envelope, and there is no call site yet. The phase that wires this in must
 * replace it: the binding terms are in docs/finish/PROJECTOS-PORT-APPROVALS1A.md. Provenance stops a
 * forgery in the kernel's process: a worker can write JSON, and JSON is never an issued approval. It
 * cannot stop kernel code that calls `issueToolApproval` for the wrong reason.
 *
 * AN APPROVAL IS FOR ONE EFFECT, ONCE, IN ONE LINEAGE. `effectKey` covers the run, the tool and the
 * argument hash. An approval names its lineage, it is fresh only at the taint generation it was given at,
 * and it is spent by id on the lineage, because the same arguments twice are two effects. A decision
 * cannot date itself in the future, and its lifetime is capped: it is an answer to one question now, not
 * standing permission. It does not survive a restart, because a guard is not persisted.
 *
 * P6 IS NEVER APPROVED. ADR-K1 §4: nobody may authorise it, including the owner.
 */
import { resolveAction, type ActionRegistry } from '../actionRegistry.js';
import type { Role } from '../types.js';
import { deriveToolEffect, type ToolCall } from './effectKey.js';
import { instantOf } from './instant.js';
import { freshApprovalNeeded, isLiveRunGuard, markToolCalled, type RunGuard } from './taint.js';

/** Long enough to answer a question and run the call. */
export const MAX_APPROVAL_LIFETIME_MS = 60 * 60 * 1000;

/**
 * The owner's yes to one exact call.
 *
 * AN APPROVAL CAN NEVER ANSWER THE ENVELOPE GRANT PORT. `EnvelopeGrantPort` decides whether a P3 or P5
 * envelope has a grant, and it must not read this record. This only clears a call of taint.
 */
export interface ToolApproval {
  readonly approvalId: string;
  readonly runId: string;
  readonly toolName: string;
  readonly argumentHash: string;
  readonly effectKey: string;
  /** The lineage it was given in. No other lineage's guard honours it. */
  readonly lineageToken: string;
  /** The guard's generation when the owner decided. A later one makes this approval stale. */
  readonly taintGeneration: number;
  readonly decidedBy: 'owner';
  readonly decidedAt: string;
  readonly expiry: string;
}

/** Everything a decision can say. Compare what it cannot: there is no mode here. */
export interface ToolApprovalDecision {
  readonly approvalId: string;
  readonly decidedBy: Role;
  readonly decidedAt: string;
  readonly expiry: string;
}

export type ApprovalIssueRule =
  | 'RUN_STATE_NOT_LIVE'
  | 'RUN_MISMATCH'
  | 'RESULT_PENDING'
  | 'NOT_THE_OWNER'
  | 'BAD_DECISION'
  | 'DECIDED_IN_FUTURE'
  | 'LIFETIME_TOO_LONG'
  | 'BAD_ARGUMENTS';

export type ToolApprovalResult =
  | { readonly ok: true; readonly approval: ToolApproval }
  | { readonly ok: false; readonly rule: ApprovalIssueRule; readonly reasons: readonly string[] };

/** Approvals `issueToolApproval` made. A full-shape object is not an approval. */
const LIVE_APPROVALS = new WeakSet<ToolApproval>();

const nonBlank = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';

/** Why this decision cannot stand, or `null` if it can. `now` is passed in: core has no clock. */
function decisionRefusal(decision: ToolApprovalDecision, now: string): { readonly rule: ApprovalIssueRule; readonly reason: string } | null {
  const from = instantOf(decision.decidedAt);
  const until = instantOf(decision.expiry);
  const at = instantOf(now);
  if (!nonBlank(decision.approvalId) || from === null || until === null || at === null || until <= from) {
    return { rule: 'BAD_DECISION', reason: 'a decision needs an id, a time, and an expiry after that time' };
  }
  if (from > at) return { rule: 'DECIDED_IN_FUTURE', reason: `this decision is dated ${decision.decidedAt}, after ${now}` };
  if (until - from > MAX_APPROVAL_LIFETIME_MS) return { rule: 'LIFETIME_TOO_LONG', reason: `an approval lasts at most ${MAX_APPROVAL_LIFETIME_MS} ms` };
  return null;
}

/** Record the owner's decision on this exact call, at this guard's generation and lineage. */
export function issueToolApproval(decision: ToolApprovalDecision, call: ToolCall, guard: RunGuard, now: string): ToolApprovalResult {
  const { approvalId, decidedBy, decidedAt, expiry } = decision;
  if (!isLiveRunGuard(guard)) return { ok: false, rule: 'RUN_STATE_NOT_LIVE', reasons: ['this guard was not issued, or a later one replaced it'] };
  if (guard.runId !== call.runId) return { ok: false, rule: 'RUN_MISMATCH', reasons: [`this guard is for ${guard.runId}, not ${call.runId}`] };
  if (guard.pendingResult !== null) return { ok: false, rule: 'RESULT_PENDING', reasons: [`the result of '${guard.pendingResult}' has not been recorded, so the owner has not seen what the run has`] };
  if (decidedBy !== 'owner') return { ok: false, rule: 'NOT_THE_OWNER', reasons: [`only the owner approves, not the ${String(decidedBy)}`] };
  const refusal = decisionRefusal(decision, now);
  if (refusal !== null) return { ok: false, rule: refusal.rule, reasons: [refusal.reason] };
  const effect = deriveToolEffect(call);
  if (!effect.ok) return { ok: false, rule: 'BAD_ARGUMENTS', reasons: effect.reasons };
  const { runId, toolName, argumentHash, effectKey } = effect.effect;
  const { lineageToken, taintGeneration } = guard;
  const approval: ToolApproval = Object.freeze({ approvalId, runId, toolName, argumentHash, effectKey, lineageToken, taintGeneration, decidedBy, decidedAt, expiry });
  LIVE_APPROVALS.add(approval);
  return { ok: true, approval };
}

export type ToolCheckRule =
  | 'RUN_STATE_NOT_LIVE'
  | 'RUN_MISMATCH'
  | 'RESULT_PENDING'
  | 'BAD_ARGUMENTS'
  | 'P6_PROHIBITED'
  | 'FRESH_APPROVAL_REQUIRED'
  | 'APPROVAL_FORGED'
  | 'APPROVAL_EFFECT_MISMATCH'
  | 'APPROVAL_LINEAGE_MISMATCH'
  | 'APPROVAL_NOT_FRESH'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_SPENT';

/** `taintClear` means this check has no objection. It is not permission, and the door still decides. */
export type ToolCheckResult =
  | {
      readonly taintClear: true;
      /** The guard to use next. The one passed in is retired, and its result is now pending. */
      readonly guard: RunGuard;
      /** The exact bytes the check covered. The tool runs these, not the object it was handed. */
      readonly canonicalArguments: string;
      readonly approvalSpent: string | null;
    }
  | { readonly taintClear: false; readonly guard: RunGuard; readonly rule: ToolCheckRule; readonly reasons: readonly string[] };

interface ApprovalRefusal {
  readonly rule: ToolCheckRule;
  readonly reason: string;
}

/** Why this approval does not cover this effect, or `null` if it does. */
function approvalRefusal(approval: ToolApproval, effectKey: string, guard: RunGuard, now: string): ApprovalRefusal | null {
  if (!LIVE_APPROVALS.has(approval)) return { rule: 'APPROVAL_FORGED', reason: 'this approval was not issued by the kernel' };
  if (approval.effectKey !== effectKey) return { rule: 'APPROVAL_EFFECT_MISMATCH', reason: 'this approval is for a different run, tool or arguments' };
  if (approval.lineageToken !== guard.lineageToken) return { rule: 'APPROVAL_LINEAGE_MISMATCH', reason: 'this approval was given in another lineage of this run' };
  if (approval.taintGeneration !== guard.taintGeneration) return { rule: 'APPROVAL_NOT_FRESH', reason: 'outside content entered this run after the approval was given' };
  const at = instantOf(now);
  if (at === null || at >= (instantOf(approval.expiry) as number)) return { rule: 'APPROVAL_EXPIRED', reason: `this approval lapsed at ${approval.expiry}` };
  if (guard.spentApprovals.includes(approval.approvalId)) return { rule: 'APPROVAL_SPENT', reason: 'this approval has already been used' };
  return null;
}

/**
 * Has this call anything to fear from taint or from its approval?
 *
 * Pass `null` when the owner has not approved it. An approval that is supplied must hold, even where
 * none was needed. Nothing here runs anything, and a clear result is not permission to run it.
 */
export function checkToolCall(guard: RunGuard, call: ToolCall, registry: ActionRegistry, approval: ToolApproval | null, now: string): ToolCheckResult {
  const refuse = (rule: ToolCheckRule, reasons: readonly string[]): ToolCheckResult => ({ taintClear: false, guard, rule, reasons });
  if (!isLiveRunGuard(guard)) return refuse('RUN_STATE_NOT_LIVE', ['this guard was not issued, or a later one replaced it']);
  if (guard.runId !== call.runId) return refuse('RUN_MISMATCH', [`this guard is for ${guard.runId}, not ${call.runId}`]);
  if (guard.pendingResult !== null) return refuse('RESULT_PENDING', [`the result of '${guard.pendingResult}' has not been recorded`]);
  const effect = deriveToolEffect(call);
  if (!effect.ok) return refuse('BAD_ARGUMENTS', effect.reasons);
  const { canonicalArguments, effectKey, toolName } = effect.effect;
  if (resolveAction(registry, toolName).actionClass === 'P6') return refuse('P6_PROHIBITED', [`'${toolName}' is P6: nobody may authorise it, ever`]);
  if (approval === null) {
    return freshApprovalNeeded(guard, registry, toolName)
      ? refuse('FRESH_APPROVAL_REQUIRED', [`outside content entered this run, and it could steer '${toolName}'`])
      : { taintClear: true, guard: markToolCalled(guard, toolName, null), canonicalArguments, approvalSpent: null };
  }
  const refusal = approvalRefusal(approval, effectKey, guard, now);
  if (refusal !== null) return refuse(refusal.rule, [refusal.reason]);
  return { taintClear: true, guard: markToolCalled(guard, toolName, approval.approvalId), canonicalArguments, approvalSpent: approval.approvalId };
}
