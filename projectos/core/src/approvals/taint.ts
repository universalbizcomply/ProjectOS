// SPDX-License-Identifier: Apache-2.0
// Ported-From: rakazo https://github.com/elie222/rakazo
// Source-Path: packages/core/src/action-approval.ts; packages/adapters/src/run-context.ts
// Source-Commit: bf78ebd7961a28a8b437c605319c47b59edadc1c
// Source-Copyright: Copyright 2026 Rakazo contributors
// Port-Strategy: ADAPTED
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: the sticky boolean became a counted generation on a frozen guard that a move retires; the fixed list of own-state tools became a list the kernel passes in, so memory and history do not launder taint; "could be steered" is answered by the action registry instead of tool-name patterns; the carve-out for reads on an already-used connector is removed. The upstream rule engine, auto-review judge and no-approval mode were not ported.
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: taint count and spent approvals moved to a lineage named by a kernel token; a second guard for a run never starts clean; a write on a dead guard refuses loudly and still counts; a cleared call leaves a result pending; only named confined reads escape the steering rule; own-state entries must be registered local reads.
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: a lineage token that was replaced can never return; the own-state exemption is limited to confined reads and to a real list.
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * Taint: has outside content entered this run?
 *
 * Text a run read can carry instructions somebody else wrote. Once it has, nothing the model asks for
 * can be assumed to come from the owner, however reasonable it looks. So the question is mechanical
 * and has no model in it: did outside content enter, and could that content steer this action?
 *
 * A TOOL RESULT TAINTS UNLESS THE KERNEL SAYS OTHERWISE. A new tool taints by default. The exemption
 * list is passed in by kernel code, it must be a real list with an exact match, and an entry counts only
 * if it is a confined read, the same test the steering rule uses. It is empty until a later phase names a
 * tool. The upstream list exempted saved memory and history, and that is not carried over: a tainted run
 * can write a note, and a later run reading that note would then be clean, so taint would pass straight
 * through the store.
 *
 * A RUN CAN BEGIN TAINTED. A run the owner did not start, and any attempt after the first, which may
 * restore outside content the first attempt read. So a restart costs an approval and never clears a run.
 *
 * ONE RUN, ONE LINEAGE, ONE LIVE GUARD. This module holds the current guard of every run it has started,
 * and nothing else is live: a spread copy, a literal and every earlier guard are all refused. The state
 * lives on the lineage, which is the chain of guards a kernel-supplied token names, so a guard is only a
 * handle on it. A second guard with the same token continues the lineage: the count and the spent list
 * carry, and starting it counts as taint. A second guard with a new token is a new lineage, with an empty
 * spent list, and it still starts tainted. Approvals carry the token, so none crosses to the new lineage.
 * A token that was replaced is remembered and refused for good, because going back to it would bring its
 * approvals back with an empty spent list. This is per process, an entry lives as long as the process,
 * and a guard is not persisted: a new process has no approvals to replay, and it holds no guards, so a
 * run resumed there is tainted only if the kernel says it is a later attempt.
 *
 * TAINT NEVER COMES OFF, AND A WRITE IS NEVER DROPPED. Keeping a clean guard from before the content gets
 * a dead guard, not a clean one. A write on a dead guard throws, because a returned refusal can be
 * ignored and an ignored one is a lost taint. It counts on the lineage first: the content really entered,
 * whichever handle the caller held. That also retires the guard the caller thought was live, so the run
 * stops until a new guard is started, and that guard begins tainted.
 *
 * A CLEARED CALL LEAVES A RESULT PENDING. The next check refuses until `recordToolResult` has run, so a
 * call site that forgets to record a result stops the run instead of laundering it. Calls therefore run
 * one at a time on a run. A new attempt drops what was pending, because it begins tainted anyway.
 *
 * "COULD BE STEERED" HAS ONE ESCAPE. Being P1 `local` in the registry is not enough, because `local`
 * says where the action starts and not where its content ends up. `bridge-read` answers a conversation
 * on the far side of the tunnel. `run_validators` runs repository scripts as the owner's user, with the
 * network. The review actions hand content to a reviewer. Each can carry content off the machine, so each
 * needs a fresh approval once tainted. Only `CONFINED_READS` is out of reach, and a registry that no
 * longer calls one P1 `local` puts it back in. An unregistered action is P5 in production (R5).
 *
 * WHAT THIS MODULE CANNOT PROVE. `ownerStarted`, `attempt`, the token and the calls to record content are
 * handed in by kernel code. The pending state catches a call site that forgets a result, not a tool that
 * runs without passing `checkToolCall`, so taint is sound only under complete mediation. There are no
 * call sites yet: nothing in the run loop calls this module.
 */
import { resolveAction, type ActionRegistry } from '../actionRegistry.js';

export interface RunGuard {
  readonly runId: string;
  /** Names the lineage this guard belongs to. Supplied by the kernel, unique to a chain of guards. */
  readonly lineageToken: string;
  /** Every token this run has replaced. None of them can return. */
  readonly retiredLineages: readonly string[];
  /** How many times outside content has entered this lineage. Only ever goes up. */
  readonly taintGeneration: number;
  /** Where it came from, in order. A record, not a rule. */
  readonly taintSources: readonly string[];
  /** Approvals already used in this lineage. */
  readonly spentApprovals: readonly string[];
  /** The tool that cleared the last check and has not had its result recorded. */
  readonly pendingResult: string | null;
}

export interface RunStart {
  readonly runId: string;
  readonly lineageToken: string;
  /** The owner's own message started this run. Not a channel, schedule, webhook or another agent. */
  readonly ownerStarted: boolean;
  /** One for the first attempt at this run. */
  readonly attempt: number;
}

export type RunGuardRule = 'BAD_RUN_START' | 'LINEAGE_REUSED' | 'DEAD_GUARD' | 'WRONG_RESULT';

/** Thrown, not returned: a write that went wrong must not be something a caller can ignore. */
export class RunGuardRefused extends Error {
  constructor(
    readonly rule: RunGuardRule,
    message: string,
  ) {
    super(`${rule}: ${message}`);
    this.name = 'RunGuardRefused';
  }
}

/** The one current guard of each run. A guard not held here is not live. */
const CURRENT_GUARDS = new Map<string, RunGuard>();

/** Named by hand. A new P1 local action is steerable until someone shows it cannot leave the machine. */
const CONFINED_READS: readonly string[] = ['project-selection'];

const nonBlank = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';

/** Make this the run's one live guard. Whatever was live before is retired by being replaced. */
function issued(guard: RunGuard): RunGuard {
  const frozen: RunGuard = Object.freeze({
    ...guard,
    retiredLineages: Object.freeze([...guard.retiredLineages]),
    taintSources: Object.freeze([...guard.taintSources]),
    spentApprovals: Object.freeze([...guard.spentApprovals]),
  });
  CURRENT_GUARDS.set(frozen.runId, frozen);
  return frozen;
}

function withTaint(guard: RunGuard, source: string): RunGuard {
  return { ...guard, taintGeneration: guard.taintGeneration + 1, taintSources: [...guard.taintSources, source] };
}

export function isLiveRunGuard(guard: RunGuard): boolean {
  return CURRENT_GUARDS.get(guard.runId) === guard;
}

/** The content entered whichever handle reported it, so it counts on the lineage, and then the write refuses. */
function refuseDeadWrite(guard: RunGuard, source: string): never {
  const current = CURRENT_GUARDS.get(guard.runId);
  if (current !== undefined) issued(withTaint(current, source));
  throw new RunGuardRefused('DEAD_GUARD', `this guard for ${guard.runId} is not live, so this run has to start a new one`);
}

/**
 * A guard for a new run or a new attempt. Anything but the owner's own first start of a run begins
 * tainted, and the same token continues the lineage it names.
 */
export function startRunGuard(start: RunStart): RunGuard {
  const { runId, lineageToken, ownerStarted, attempt } = start;
  if (!nonBlank(runId) || !nonBlank(lineageToken)) throw new RunGuardRefused('BAD_RUN_START', 'a run needs an id and a lineage token');
  const earlier = CURRENT_GUARDS.get(runId);
  if (earlier?.retiredLineages.includes(lineageToken) === true) throw new RunGuardRefused('LINEAGE_REUSED', `this run has already replaced the lineage '${lineageToken}'`);
  const continued = earlier?.lineageToken === lineageToken ? earlier : undefined;
  const sources = [
    ...(ownerStarted === true ? [] : ['a run the owner did not start']),
    ...(attempt === 1 ? [] : ['a later attempt, which can restore outside content']),
    ...(earlier === undefined ? [] : ['a second guard for a run already started']),
  ];
  return issued({
    runId,
    lineageToken,
    retiredLineages: [...(earlier?.retiredLineages ?? []), ...(earlier !== undefined && continued === undefined ? [earlier.lineageToken] : [])],
    taintGeneration: (continued?.taintGeneration ?? 0) + sources.length,
    taintSources: [...(continued?.taintSources ?? []), ...sources],
    spentApprovals: continued?.spentApprovals ?? [],
    pendingResult: null,
  });
}

/** Tainted, or a guard that cannot be trusted to say it is not. */
export function isRunTainted(guard: RunGuard): boolean {
  return !isLiveRunGuard(guard) || guard.taintGeneration > 0;
}

/** Outside content entered the run. */
export function recordOutsideContent(guard: RunGuard, source: string): RunGuard {
  if (!isLiveRunGuard(guard)) refuseDeadWrite(guard, source);
  return issued(withTaint(guard, source));
}

/** A P1 action in `local`, by the registry's word. Anything unregistered is P5 (R5), so it is not one. */
function isLocalRead(registry: ActionRegistry, action: string): boolean {
  const { actionClass, environment } = resolveAction(registry, action);
  return actionClass === 'P1' && environment === 'local';
}

/**
 * `ownStateTools` comes from kernel code. It must be a list, because `includes` on a string would match
 * any substring. An exempt tool is one the steering rule also calls confined, so the two cannot disagree.
 */
export function toolResultTaintsRun(registry: ActionRegistry, toolName: string, ownStateTools: readonly string[]): boolean {
  return !(Array.isArray(ownStateTools) && ownStateTools.includes(toolName) && !actionCouldBeSteered(registry, toolName));
}

/** The result of the call that cleared, which settles what was pending. Another tool's result refuses. */
export function recordToolResult(guard: RunGuard, toolName: string, registry: ActionRegistry, ownStateTools: readonly string[]): RunGuard {
  const source = `tool result: ${toolName}`;
  if (!isLiveRunGuard(guard)) refuseDeadWrite(guard, source);
  if (guard.pendingResult !== null && guard.pendingResult !== toolName) {
    issued(withTaint(guard, source));
    throw new RunGuardRefused('WRONG_RESULT', `this run is waiting for the result of '${guard.pendingResult}'`);
  }
  const settled: RunGuard = { ...guard, pendingResult: null };
  return issued(toolResultTaintsRun(registry, toolName, ownStateTools) ? withTaint(settled, source) : settled);
}

/** A call cleared. Its approval is spent, and the run waits for its result. Called only on a live guard. */
export function markToolCalled(guard: RunGuard, toolName: string, approvalId: string | null): RunGuard {
  return issued({
    ...guard,
    pendingResult: toolName,
    spentApprovals: approvalId === null ? guard.spentApprovals : [...guard.spentApprovals, approvalId],
  });
}

/** Could content that entered this run steer this action? Only a named confined read is out of reach. */
export function actionCouldBeSteered(registry: ActionRegistry, action: string): boolean {
  return !(CONFINED_READS.includes(action) && isLocalRead(registry, action));
}

/** Does this action need an approval given after the latest outside content? */
export function freshApprovalNeeded(guard: RunGuard, registry: ActionRegistry, action: string): boolean {
  return isRunTainted(guard) && actionCouldBeSteered(registry, action);
}
