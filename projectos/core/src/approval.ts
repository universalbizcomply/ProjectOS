/**
 * Approval engine: request and decide approvals for actions.
 *
 * A gated or prohibited action (per the risk engine) can only be approved by the owner.
 * Prohibited actions additionally require an explicit override flag. Decisions are pure
 * transforms returning a new record; nothing here performs the underlying action.
 */
import type { GateKey, RiskLevel, Role, Result } from './types.js';
import { ok, err } from './types.js';
import { classifyAction } from './risk.js';

export type ApprovalDecision = 'approved' | 'rejected';
export type ApprovalState = 'pending' | ApprovalDecision;

export interface ApprovalRequest {
  readonly id: string;
  readonly action: string;
  readonly requestedBy: Role;
  readonly gate?: GateKey;
  readonly risk: RiskLevel;
  readonly gated: boolean;
  readonly prohibited: boolean;
  readonly state: ApprovalState;
  readonly requestedAt: string;
  readonly decidedBy?: Role;
  readonly decidedAt?: string;
  readonly note?: string;
}

/** Build a pending approval request, classifying the action for risk/gate. */
export function requestApproval(
  id: string,
  action: string,
  requestedBy: Role,
  requestedAt: string,
): ApprovalRequest {
  const c = classifyAction(action);
  const base: ApprovalRequest = {
    id,
    action,
    requestedBy,
    risk: c.risk,
    gated: c.gated,
    prohibited: c.prohibited,
    state: 'pending',
    requestedAt,
  };
  return c.gate === undefined ? base : { ...base, gate: c.gate };
}

export interface DecideOptions {
  /** Required to approve a prohibited action (e.g. force push). */
  readonly override?: boolean;
  readonly note?: string;
}

/**
 * Decide a pending approval request. Owner-only for gated/prohibited actions;
 * prohibited actions also require `override: true`.
 */
export function decide(
  request: ApprovalRequest,
  decision: ApprovalDecision,
  by: Role,
  at: string,
  opts: DecideOptions = {},
): Result<ApprovalRequest> {
  if (request.state !== 'pending') {
    return err(`Approval ${request.id} already ${request.state}`);
  }
  const needsOwner = request.gated || request.prohibited;
  if (needsOwner && by !== 'owner') {
    return err(`Deciding a gated action requires role 'owner', got '${by}'`);
  }
  if (decision === 'approved' && request.prohibited && opts.override !== true) {
    return err(
      `Action '${request.action}' is prohibited; approval requires an explicit override`,
    );
  }
  const decided: ApprovalRequest = {
    ...request,
    state: decision,
    decidedBy: by,
    decidedAt: at,
  };
  return ok(opts.note === undefined ? decided : { ...decided, note: opts.note });
}

export function isApproved(request: ApprovalRequest): boolean {
  return request.state === 'approved';
}
