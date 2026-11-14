// Origin: original ProjectOS code
/**
 * The launch plan: the only thing a runner will start.
 *
 * A PLAN IS MINTED HERE AND NOWHERE ELSE. It is built from a prepared command that passed the ONE policy gate (an allowlist
 * hit under a class that may run unattended, or a grant for exactly that command that the same gate did not refuse), and it
 * is frozen and remembered. A runner accepts a value only if `isExecLaunchPlan` says this module made it, so JSON of the same
 * shape, a copy, or a plan from another tenant's process is not a plan. The runner launches the plan's argument list, working
 * directory, environment names and limits, and reads none of them from anywhere else.
 *
 * A PLAN GOES STALE. It carries the time it stops being good (`expiresAt`, at most a minute after it was made and never after
 * its grant) and the digest of the policy it was cleared under. The runner asks, at the moment it would start, whether the
 * time has passed, whether the policy in force is still that policy, and whether the grant was revoked, and refuses a plan
 * that is held and run later.
 *
 * `mintExecLaunchPlan` is not exported from the directory's barrel. Only the grant store and the policy planner call it.
 *
 * Pure: no I/O.
 */
import type { PreparedExec } from './execCommand.js';

/** How long a plan stays good once it is made. */
export const PLAN_TTL_MS = 60_000;

export interface ExecLaunchPlan {
  readonly tenant: string;
  readonly project: string;
  readonly agentId: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly envNames: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  /** The hash the plan was cleared under. */
  readonly hash: string;
  readonly via: 'allowlist' | 'grant';
  /** The grant that was spent for this plan, or `null` for an allowlist plan. */
  readonly grantId: string | null;
  /** Milliseconds since the epoch after which the plan is not run. */
  readonly expiresAt: number;
  /** The digest of the policy the plan was cleared under. */
  readonly policyDigest: string;
}

const MINTED = new WeakSet<object>();

/** Did this module mint the value? A structurally perfect copy did not. */
export function isExecLaunchPlan(value: unknown): value is ExecLaunchPlan {
  return typeof value === 'object' && value !== null && MINTED.has(value);
}

export function mintExecLaunchPlan(prepared: PreparedExec, via: ExecLaunchPlan['via'], grantId: string | null, expiresAt: number, policyDigest: string): ExecLaunchPlan {
  const plan: ExecLaunchPlan = Object.freeze({
    tenant: prepared.tenant,
    project: prepared.project,
    agentId: prepared.agentId,
    argv: prepared.argv,
    cwd: prepared.cwd,
    envNames: prepared.envNames,
    timeoutMs: prepared.timeoutMs,
    maxOutputBytes: prepared.maxOutputBytes,
    hash: prepared.hash,
    via,
    grantId,
    expiresAt,
    policyDigest,
  });
  MINTED.add(plan);
  return plan;
}
