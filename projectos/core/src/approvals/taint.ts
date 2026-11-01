// SPDX-License-Identifier: Apache-2.0
// Ported-From: rakazo https://github.com/elie222/rakazo
// Source-Path: packages/core/src/action-approval.ts; packages/adapters/src/run-context.ts
// Source-Commit: bf78ebd7961a28a8b437c605319c47b59edadc1c
// Source-Copyright: Copyright 2026 Rakazo contributors
// Port-Strategy: ADAPTED
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: the sticky boolean became a counted generation on a frozen guard that a move retires; the fixed list of own-state tools became a list the kernel passes in, so memory and history do not launder taint; "could be steered" is answered by the action registry instead of tool-name patterns; the carve-out for reads on an already-used connector is removed. The upstream rule engine, auto-review judge and no-approval mode were not ported.
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * Taint: has outside content entered this run?
 *
 * Text a run read can carry instructions somebody else wrote. Once it has, nothing the model asks for
 * can be assumed to come from the owner, however reasonable it looks. So the question is mechanical
 * and has no model in it: did outside content enter, and could that content steer this action?
 *
 * A TOOL RESULT TAINTS UNLESS THE KERNEL SAYS OTHERWISE. A new tool taints by default. The exemption
 * list is passed in by kernel code, and is empty until a later phase names a tool. It holds only tools
 * whose results bring in nothing from outside. The upstream list exempted saved memory and history, and
 * that is not carried over: a tainted run can write a note, and a later run reading that note would
 * then be clean, so taint would pass straight through the store.
 *
 * A RUN CAN BEGIN TAINTED. A run the owner did not start, and any attempt after the first, which may
 * restore outside content the first attempt read. So a restart costs an approval and never clears a
 * run: a guard is not persisted, and none is needed to be safe.
 *
 * TAINT NEVER COMES OFF. It is a count, so an approval can say which count it was given at, and a move
 * retires the guard it moved from. A clean guard kept from before the content is dead rather than clean,
 * because the alternative is a caller holding an old value and asking again. A guard that was never
 * issued is not live either. Only this module issues one, so a spread copy or a literal is refused.
 *
 * "COULD BE STEERED" IS THE REGISTRY'S ANSWER. A caller names an action and `resolveAction` says what it
 * is, so there is no parameter through which a tool can call itself safe, and an unregistered action
 * is P5 in production (R5). Only a local read is out of reach: P1 in `local`. A read that leaves the
 * machine carries arguments the content could choose, and the arguments are the leak, so the upstream's
 * free pass for reads on a connector already used is not carried over either.
 *
 * WHAT THIS MODULE CANNOT PROVE. `ownerStarted`, `attempt` and the calls to record content are handed in
 * by kernel code. That every outside result is actually recorded is the job of the call sites, and
 * there are none yet: nothing in the run loop calls this module.
 */
import { resolveAction, type ActionRegistry } from '../actionRegistry.js';

export interface RunGuard {
  readonly runId: string;
  /** How many times outside content has entered. Only ever goes up. */
  readonly taintGeneration: number;
  /** Where it came from, in order. A record, not a rule. */
  readonly taintSources: readonly string[];
  /** Approvals already used in this run. */
  readonly spentApprovals: readonly string[];
}

export interface RunStart {
  readonly runId: string;
  /** The owner's own message started this run. Not a channel, schedule, webhook or another agent. */
  readonly ownerStarted: boolean;
  /** One for the first attempt at this run. */
  readonly attempt: number;
}

/** Guards this module issued and has not retired. Nothing else passes `checkToolCall`. */
const LIVE_GUARDS = new WeakSet<RunGuard>();

function issued(guard: RunGuard): RunGuard {
  const frozen: RunGuard = Object.freeze({
    ...guard,
    taintSources: Object.freeze([...guard.taintSources]),
    spentApprovals: Object.freeze([...guard.spentApprovals]),
  });
  LIVE_GUARDS.add(frozen);
  return frozen;
}

/**
 * Retire `from` and issue `next`, so a run has one live guard however many values a caller kept. A guard
 * that is not live comes back as it went in: a move must never turn a copy into a live guard.
 */
function moved(from: RunGuard, next: RunGuard): RunGuard {
  return LIVE_GUARDS.delete(from) ? issued(next) : from;
}

export function isLiveRunGuard(guard: RunGuard): boolean {
  return LIVE_GUARDS.has(guard);
}

/** A guard for a new run or a new attempt. Anything but the owner's own first attempt begins tainted. */
export function startRunGuard(start: RunStart): RunGuard {
  const { runId, ownerStarted, attempt } = start;
  const taintSources = [
    ...(ownerStarted === true ? [] : ['a run the owner did not start']),
    ...(attempt === 1 ? [] : ['a later attempt, which can restore outside content']),
  ];
  return issued({ runId, taintGeneration: taintSources.length, taintSources, spentApprovals: [] });
}

/** Tainted, or a guard that cannot be trusted to say it is not. */
export function isRunTainted(guard: RunGuard): boolean {
  return !isLiveRunGuard(guard) || guard.taintGeneration > 0;
}

/** Outside content entered the run. */
export function recordOutsideContent(guard: RunGuard, source: string): RunGuard {
  return moved(guard, { ...guard, taintGeneration: guard.taintGeneration + 1, taintSources: [...guard.taintSources, source] });
}

/** `ownStateTools` comes from kernel code, and the match is exact. */
export function toolResultTaintsRun(toolName: string, ownStateTools: readonly string[]): boolean {
  return !ownStateTools.includes(toolName);
}

export function recordToolResult(guard: RunGuard, toolName: string, ownStateTools: readonly string[]): RunGuard {
  return toolResultTaintsRun(toolName, ownStateTools) ? recordOutsideContent(guard, `tool result: ${toolName}`) : guard;
}

/** An approval was used. It cannot be used again, whichever guard a caller holds afterwards. */
export function spendApproval(guard: RunGuard, approvalId: string): RunGuard {
  return moved(guard, { ...guard, spentApprovals: [...guard.spentApprovals, approvalId] });
}

/** Could content that entered this run steer this action? Only a registered local read is out of reach. */
export function actionCouldBeSteered(registry: ActionRegistry, action: string): boolean {
  const { actionClass, environment } = resolveAction(registry, action);
  return actionClass !== 'P1' || environment !== 'local';
}

/** Does this action need an approval given after the latest outside content? */
export function freshApprovalNeeded(guard: RunGuard, registry: ActionRegistry, action: string): boolean {
  return isRunTainted(guard) && actionCouldBeSteered(registry, action);
}
