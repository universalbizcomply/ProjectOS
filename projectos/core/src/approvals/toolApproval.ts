// Origin: original ProjectOS code
/**
 * An owner's approval of one exact tool call, and the check a call must pass.
 *
 * A PASS HERE GRANTS NOTHING. This sits beside the kernel's gates and replaces none of them. An action
 * still goes through `admitEnvelope`, the owner floor and the closure rules. This check can only stop a
 * call: an approval is necessary where taint demands one and is never sufficient anywhere. A P3 action
 * that passes here on an untainted run has passed only this check.
 *
 * ONLY A PERSON DECIDES. A decision names who decided and when it lapses, and nothing else. There is no
 * mode, no setting that skips the check, no model that passes a call, and no rule that remembers a yes:
 * `ToolApprovalDecision` has no field for any of them, and `decidedBy` must be the owner.
 *
 * WHAT THIS MODULE CANNOT PROVE. `decidedBy` is handed in by kernel code. That it comes from the owner's
 * authenticated decision and never from worker text is the job of the call site, as it is for
 * `principal` on an envelope, and there is no call site yet. Provenance stops a forgery in the kernel's
 * process: a worker can write JSON, and JSON is never an issued approval. It cannot stop kernel code
 * that calls `issueToolApproval` for the wrong reason.
 *
 * AN APPROVAL IS FOR ONE EFFECT, ONCE. `effectKey` covers the run, the tool and the argument hash. An
 * approval is also fresh only at the taint generation it was given at, and it is spent by id, because
 * the same arguments twice are two effects. It does not survive a restart: a restart is a later attempt,
 * which begins tainted, and a guard is not persisted.
 *
 * P6 IS NEVER APPROVED. ADR-K1 §4: nobody may authorise it, including the owner.
 */
import { resolveAction, type ActionRegistry } from '../actionRegistry.js';
import type { Role } from '../types.js';
import { deriveToolEffect, type ToolCall } from './effectKey.js';
import { instantOf } from './instant.js';
import { freshApprovalNeeded, isLiveRunGuard, spendApproval, type RunGuard } from './taint.js';

export interface ToolApproval {
  readonly approvalId: string;
  readonly runId: string;
  readonly toolName: string;
  readonly argumentHash: string;
  readonly effectKey: string;
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

export type ApprovalIssueRule = 'RUN_STATE_NOT_LIVE' | 'RUN_MISMATCH' | 'NOT_THE_OWNER' | 'BAD_DECISION' | 'BAD_ARGUMENTS';

export type ToolApprovalResult =
  | { readonly ok: true; readonly approval: ToolApproval }
  | { readonly ok: false; readonly rule: ApprovalIssueRule; readonly reasons: readonly string[] };

/** Approvals `issueToolApproval` made. A full-shape object is not an approval. */
const LIVE_APPROVALS = new WeakSet<ToolApproval>();

const nonBlank = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';

/** Record the owner's decision on this exact call, at this guard's generation. */
export function issueToolApproval(decision: ToolApprovalDecision, call: ToolCall, guard: RunGuard): ToolApprovalResult {
  const { approvalId, decidedBy, decidedAt, expiry } = decision;
  if (!isLiveRunGuard(guard)) return { ok: false, rule: 'RUN_STATE_NOT_LIVE', reasons: ['this guard was not issued, or a later one replaced it'] };
  if (guard.runId !== call.runId) return { ok: false, rule: 'RUN_MISMATCH', reasons: [`this guard is for ${guard.runId}, not ${call.runId}`] };
  if (decidedBy !== 'owner') return { ok: false, rule: 'NOT_THE_OWNER', reasons: [`only the owner approves, not the ${String(decidedBy)}`] };
  const from = instantOf(decidedAt);
  const until = instantOf(expiry);
  if (!nonBlank(approvalId) || from === null || until === null || until <= from) {
    return { ok: false, rule: 'BAD_DECISION', reasons: ['a decision needs an id, a time, and an expiry after that time'] };
  }
  const effect = deriveToolEffect(call);
  if (!effect.ok) return { ok: false, rule: 'BAD_ARGUMENTS', reasons: effect.reasons };
  const { runId, toolName, argumentHash, effectKey } = effect.effect;
  const approval: ToolApproval = Object.freeze({ approvalId, runId, toolName, argumentHash, effectKey, taintGeneration: guard.taintGeneration, decidedBy, decidedAt, expiry });
  LIVE_APPROVALS.add(approval);
  return { ok: true, approval };
}

export type ToolCheckRule =
  | 'RUN_STATE_NOT_LIVE'
  | 'RUN_MISMATCH'
  | 'BAD_ARGUMENTS'
  | 'P6_PROHIBITED'
  | 'FRESH_APPROVAL_REQUIRED'
  | 'APPROVAL_FORGED'
  | 'APPROVAL_EFFECT_MISMATCH'
  | 'APPROVAL_NOT_FRESH'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_SPENT';

export type ToolCheckResult =
  | {
      readonly passed: true;
      /** The guard to use next. If an approval was spent, the one passed in is retired. */
      readonly guard: RunGuard;
      /** The exact bytes the check covered. The tool runs these, not the object it was handed. */
      readonly canonicalArguments: string;
      readonly approvalSpent: string | null;
    }
  | { readonly passed: false; readonly guard: RunGuard; readonly rule: ToolCheckRule; readonly reasons: readonly string[] };

interface ApprovalRefusal {
  readonly rule: ToolCheckRule;
  readonly reason: string;
}

/** Why this approval does not cover this effect, or `null` if it does. `now` is passed in: core has no clock. */
function approvalRefusal(approval: ToolApproval, effectKey: string, guard: RunGuard, now: string): ApprovalRefusal | null {
  if (!LIVE_APPROVALS.has(approval)) return { rule: 'APPROVAL_FORGED', reason: 'this approval was not issued by the kernel' };
  if (approval.effectKey !== effectKey) return { rule: 'APPROVAL_EFFECT_MISMATCH', reason: 'this approval is for a different run, tool or arguments' };
  if (approval.taintGeneration !== guard.taintGeneration) return { rule: 'APPROVAL_NOT_FRESH', reason: 'outside content entered this run after the approval was given' };
  const at = instantOf(now);
  if (at === null || at >= (instantOf(approval.expiry) as number)) return { rule: 'APPROVAL_EXPIRED', reason: `this approval lapsed at ${approval.expiry}` };
  if (guard.spentApprovals.includes(approval.approvalId)) return { rule: 'APPROVAL_SPENT', reason: 'this approval has already been used' };
  return null;
}

/**
 * May this call go on, as far as taint and its approval are concerned?
 *
 * Pass `null` when the owner has not approved it. An approval that is supplied must hold, even where
 * none was needed. Nothing here runs anything.
 */
export function checkToolCall(guard: RunGuard, call: ToolCall, registry: ActionRegistry, approval: ToolApproval | null, now: string): ToolCheckResult {
  const refuse = (rule: ToolCheckRule, reasons: readonly string[]): ToolCheckResult => ({ passed: false, guard, rule, reasons });
  if (!isLiveRunGuard(guard)) return refuse('RUN_STATE_NOT_LIVE', ['this guard was not issued, or a later one replaced it']);
  if (guard.runId !== call.runId) return refuse('RUN_MISMATCH', [`this guard is for ${guard.runId}, not ${call.runId}`]);
  const effect = deriveToolEffect(call);
  if (!effect.ok) return refuse('BAD_ARGUMENTS', effect.reasons);
  const { canonicalArguments, effectKey, toolName } = effect.effect;
  if (resolveAction(registry, toolName).actionClass === 'P6') return refuse('P6_PROHIBITED', [`'${toolName}' is P6: nobody may authorise it, ever`]);
  if (approval === null) {
    return freshApprovalNeeded(guard, registry, toolName)
      ? refuse('FRESH_APPROVAL_REQUIRED', [`outside content entered this run, and it could steer '${toolName}'`])
      : { passed: true, guard, canonicalArguments, approvalSpent: null };
  }
  const refusal = approvalRefusal(approval, effectKey, guard, now);
  if (refusal !== null) return refuse(refusal.rule, [refusal.reason]);
  return { passed: true, guard: spendApproval(guard, approval.approvalId), canonicalArguments, approvalSpent: approval.approvalId };
}
