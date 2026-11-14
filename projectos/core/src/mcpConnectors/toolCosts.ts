// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/mcp_tool_costs.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: translated from Python to TypeScript; amounts are whole micro-USD, the unit of an envelope's budget, where upstream counts floating "credits"; a tool the table does not declare is refused, where upstream lets it run with no cost and no budget; a limit is required, where upstream reads zero as no limit; the table is the owner's allowlist row, where upstream trusts the server's own declared figures; one call may not cost more than its envelope allows; the process-wide mutable tally, its locks and context variables became an immutable value the caller holds, so the durable ledger of Stages 4 and 5 can own it; the approval prompt text removed, because a refused call is not an approval; the total is held per tenant and server in a window, with a call cap that counts free calls too, and there is no session key: upstream keys by chat, which a caller names, and a name a caller chooses is a fresh budget on demand, so upstream's session transfer is gone with the thing it protected
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * Per-tool spend: what a tool declares it costs, and what has been spent on a server.
 *
 * THE FIGURE COUNTED IS THE TOP OF THE RANGE, for every call dispatched, as upstream counts it. It is a ceiling
 * the owner approved, never a vendor's bill. A call with no declared cost, or one that would take the server past
 * its limit, is refused here and nothing runs. A zero is a declared cost, and books no money.
 *
 * THE BUDGET BELONGS TO THE TENANT AND THE SERVER, IN A WINDOW. Nothing a caller chooses, no run name and no session
 * key, can start a fresh one. The window is the only thing that does: once `windowMs` has passed since the first
 * call of a window, spend and calls count from zero. Every call counts toward a call cap, a free one too, so a
 * zero-cost tool cannot be called without end. A clock that runs backwards does not open a window.
 *
 * THE TALLY IS A VALUE. `reserveToolSpend` returns a new tally and never changes the one it was given, so a caller
 * that does not keep the result has booked nothing. Persisting it is the Stage 4 and 5 ledger's duty, and until
 * then a process that restarts forgets what it spent. Pure.
 */
import { isToolName, splitServerKey } from './serverKeys.js';

export interface ToolCost {
  readonly low: number;
  readonly high: number;
  readonly note: string;
}

export interface CostPolicy {
  readonly costs: Readonly<Record<string, ToolCost>>;
  /** Whole micro-USD, at least 1, in one window. */
  readonly limit: number;
  /** Calls allowed in one window, a free one included. */
  readonly callLimit: number;
  readonly windowMs: number;
}

export type CostPolicyResult = { readonly ok: true; readonly policy: CostPolicy } | { readonly ok: false; readonly problems: readonly string[] };

export const DEFAULT_CALL_LIMIT = 100;
export const DEFAULT_SPEND_WINDOW_MS = 86_400_000;
const MIN_SPEND_WINDOW_MS = 60_000;
const MAX_SPEND_WINDOW_MS = 7 * 86_400_000;
const MAX_NOTE_CHARS = 200;
const COST_KEYS = ['microUsd', 'note'] as const;

function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function costOf(value: unknown, where: string): { readonly cost: ToolCost } | { readonly problem: string } {
  let note = '';
  let figure = value;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Readonly<Record<string, unknown>>;
    const unknownKey = Object.keys(record).find((key) => !(COST_KEYS as readonly string[]).includes(key));
    if (!Object.hasOwn(record, 'microUsd') || unknownKey !== undefined) return { problem: `${where} must be a number, [min, max], or { microUsd, note }` };
    if (typeof record['note'] !== 'string' && record['note'] !== undefined) return { problem: `${where} note must be text` };
    note = ((record['note'] as string | undefined) ?? '').trim();
    if (note.length > MAX_NOTE_CHARS) return { problem: `${where} note is longer than ${MAX_NOTE_CHARS} characters` };
    figure = record['microUsd'];
  }
  if (Array.isArray(figure)) {
    const [low, high] = [amount(figure[0]), amount(figure[1])];
    if (figure.length !== 2 || low === null || high === null) return { problem: `${where} range must be [min, max], two whole non-negative numbers` };
    return low > high ? { problem: `${where} range must have min <= max` } : { cost: { low, high, note } };
  }
  const single = amount(figure);
  return single === null ? { problem: `${where} must be a whole non-negative number of micro-USD` } : { cost: { low: single, high: single, note } };
}

export interface CostPolicyOptions {
  readonly callLimit?: unknown;
  readonly windowMs?: unknown;
}

/** One server's table and limits. Every problem is named, and one is enough to refuse the whole table. */
export function parseCostPolicy(costs: unknown, spendLimit: unknown, where: string, options: CostPolicyOptions = {}): CostPolicyResult {
  if (typeof costs !== 'object' || costs === null || Array.isArray(costs)) return { ok: false, problems: [`${where} costs must be an object mapping MCP tool names to costs`] };
  const problems: string[] = [];
  const table: Record<string, ToolCost> = Object.create(null) as Record<string, ToolCost>;
  for (const [tool, value] of Object.entries(costs as Readonly<Record<string, unknown>>)) {
    if (!isToolName(tool)) {
      problems.push(`${where} costs keys must be MCP tool names`);
      continue;
    }
    const read = costOf(value, `${where} cost of a tool`);
    if ('problem' in read) problems.push(read.problem);
    else table[tool] = Object.freeze(read.cost);
  }
  const limit = amount(spendLimit);
  if (limit === null || limit < 1) problems.push(`${where} needs a spend limit of at least 1 micro-USD; zero is not "no limit"`);
  const callLimit = options.callLimit === undefined ? DEFAULT_CALL_LIMIT : amount(options.callLimit);
  if (callLimit === null || callLimit < 1) problems.push(`${where} needs a call cap of at least 1`);
  const windowMs = options.windowMs === undefined ? DEFAULT_SPEND_WINDOW_MS : amount(options.windowMs);
  if (windowMs === null || windowMs < MIN_SPEND_WINDOW_MS || windowMs > MAX_SPEND_WINDOW_MS) problems.push(`${where} needs a spend window between a minute and a week`);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, policy: Object.freeze({ costs: Object.freeze(table), limit: limit as number, callLimit: callLimit as number, windowMs: windowMs as number }) };
}

/** What one tenant's server has spent, and been called, in the window now open. */
export interface SpendWindow {
  readonly windowStart: number;
  readonly spent: number;
  readonly calls: number;
}

/** By `tenant/server`. Never changed in place. */
export type SpendTally = ReadonlyMap<string, SpendWindow>;

export const EMPTY_TALLY: SpendTally = new Map<string, SpendWindow>();

export function spendOf(tally: SpendTally, serverKey: string): number {
  return tally.get(serverKey)?.spent ?? 0;
}

export function callsOf(tally: SpendTally, serverKey: string): number {
  return tally.get(serverKey)?.calls ?? 0;
}

/** One costed call about to be admitted: what it costs and whose tally it lands on. */
export interface Charge {
  readonly serverKey: string;
  readonly tool: string;
  readonly cost: ToolCost;
  readonly limit: number;
}

export type SpendRefusalCode = 'SPEND_KEY_INVALID' | 'SPEND_CLOCK_INVALID' | 'TOOL_COST_UNDECLARED' | 'TOOL_OVER_ENVELOPE_BUDGET' | 'TOOL_OVER_SPEND_LIMIT' | 'TOOL_OVER_CALL_LIMIT';

export type SpendDecision =
  | { readonly ok: true; readonly charge: Charge; readonly tally: SpendTally; readonly spentBefore: number }
  | { readonly ok: false; readonly code: SpendRefusalCode; readonly reason: string };

function refused(code: SpendRefusalCode, reason: string): SpendDecision {
  return { ok: false, code, reason };
}

export interface SpendRequest {
  readonly policy: CostPolicy;
  readonly serverKey: string;
  readonly tool: string;
  readonly tally: SpendTally;
  /** The envelope's own ceiling for one call, in micro-USD. */
  readonly envelopeBudget: number;
  /** The time of this call, in ms. Where a window starts and ends. */
  readonly nowMs: number;
}

/** The window this call falls in: the one already open, or a new one. A clock that went backwards stays in the open one. */
function windowAt(tally: SpendTally, serverKey: string, nowMs: number, windowMs: number): SpendWindow {
  const open = tally.get(serverKey);
  return open !== undefined && nowMs - open.windowStart < windowMs ? open : { windowStart: nowMs, spent: 0, calls: 0 };
}

/** Check and book in one step, so two calls cannot both be judged against the same total. */
export function reserveToolSpend(request: SpendRequest): SpendDecision {
  const { policy, serverKey, tool, tally, envelopeBudget, nowMs } = request;
  if (splitServerKey(serverKey) === null) return refused('SPEND_KEY_INVALID', 'the server key is not one a tally can hold');
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return refused('SPEND_CLOCK_INVALID', 'the time of the call is not a whole non-negative number');
  const cost = typeof tool === 'string' && Object.hasOwn(policy.costs, tool) ? policy.costs[tool] : undefined;
  if (cost === undefined) return refused('TOOL_COST_UNDECLARED', 'this tool has no declared cost, so it has no budget and does not run');
  if (!Number.isSafeInteger(envelopeBudget) || envelopeBudget < 0 || cost.high > envelopeBudget) {
    return refused('TOOL_OVER_ENVELOPE_BUDGET', `this call costs up to ${cost.high} micro-USD, and its envelope allows ${Number.isSafeInteger(envelopeBudget) ? envelopeBudget : 0}`);
  }
  const open = windowAt(tally, serverKey, nowMs, policy.windowMs);
  if (open.calls + 1 > policy.callLimit) return refused('TOOL_OVER_CALL_LIMIT', `this server has been called ${open.calls} of ${policy.callLimit} times in this window`);
  if (open.spent + cost.high > policy.limit) {
    return refused('TOOL_OVER_SPEND_LIMIT', `this server has used ${open.spent} of ${policy.limit} micro-USD in this window, and this call costs up to ${cost.high}`);
  }
  const next = new Map(tally);
  next.set(serverKey, { windowStart: open.windowStart, spent: open.spent + cost.high, calls: open.calls + 1 });
  return { ok: true, charge: Object.freeze({ serverKey, tool, cost, limit: policy.limit }), tally: next, spentBefore: open.spent };
}

/** Give back what a charge took, for a call that never ran. Neither the money nor the count goes below zero. */
export function refundCharge(tally: SpendTally, charge: Charge): SpendTally {
  const open = tally.get(charge.serverKey);
  if (open === undefined) return tally;
  const next = new Map(tally);
  next.set(charge.serverKey, { windowStart: open.windowStart, spent: Math.max(0, open.spent - charge.cost.high), calls: Math.max(0, open.calls - 1) });
  return next;
}
