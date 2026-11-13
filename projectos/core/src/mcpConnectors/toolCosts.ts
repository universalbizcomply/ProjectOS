// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/mcp_tool_costs.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: translated from Python to TypeScript; amounts are whole micro-USD, the unit of an envelope's budget, where upstream counts floating "credits"; a tool the table does not declare is refused, where upstream lets it run with no cost and no budget; a limit is required, where upstream reads zero as no limit; the table is the owner's allowlist row, where upstream trusts the server's own declared figures; one call may not cost more than its envelope allows; the process-wide mutable tally, its locks and context variables became an immutable value the caller holds, so the durable ledger of Stages 4 and 5 can own it; the approval prompt text removed, because a refused call is not an approval; a rotated session keeps its spend, as upstream's transfer does
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * Per-tool spend: what a tool declares it costs, and what one session has spent on a server.
 *
 * THE FIGURE COUNTED IS THE TOP OF THE RANGE, for every call dispatched, as upstream counts it. It is a ceiling
 * the owner approved, never a vendor's bill. A call with no declared cost, or one that would take the session past
 * its limit, is refused here and nothing runs. A zero is a declared cost, and books nothing.
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
  /** Whole micro-USD, at least 1. */
  readonly limit: number;
}

export type CostPolicyResult = { readonly ok: true; readonly policy: CostPolicy } | { readonly ok: false; readonly problems: readonly string[] };

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

/** One server's table and limit. Every problem is named, and one is enough to refuse the whole table. */
export function parseCostPolicy(costs: unknown, spendLimit: unknown, where: string): CostPolicyResult {
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
  return problems.length > 0 ? { ok: false, problems } : { ok: true, policy: Object.freeze({ costs: Object.freeze(table), limit: limit as number }) };
}

/** What each session has spent on each server, by `server|session`. Never changed in place. */
export type SpendTally = ReadonlyMap<string, number>;

export const EMPTY_TALLY: SpendTally = new Map<string, number>();

const SESSION_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function tallyKeyOf(serverKey: string, sessionKey: string): string | null {
  return splitServerKey(serverKey) !== null && typeof sessionKey === 'string' && SESSION_KEY.test(sessionKey) ? `${serverKey}|${sessionKey}` : null;
}

export function spendOf(tally: SpendTally, serverKey: string, sessionKey: string): number {
  const key = tallyKeyOf(serverKey, sessionKey);
  return key === null ? 0 : (tally.get(key) ?? 0);
}

/** One costed call about to be admitted: what it costs and whose tally it lands on. */
export interface Charge {
  readonly tallyKey: string;
  readonly serverKey: string;
  readonly tool: string;
  readonly cost: ToolCost;
  readonly limit: number;
}

export type SpendRefusalCode = 'SPEND_KEY_INVALID' | 'TOOL_COST_UNDECLARED' | 'TOOL_OVER_ENVELOPE_BUDGET' | 'TOOL_OVER_SPEND_LIMIT';

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
  readonly sessionKey: string;
  readonly tally: SpendTally;
  /** The envelope's own ceiling for one call, in micro-USD. */
  readonly envelopeBudget: number;
}

/** Check and book in one step, so two calls cannot both be judged against the same total. */
export function reserveToolSpend(request: SpendRequest): SpendDecision {
  const { policy, serverKey, tool, sessionKey, tally, envelopeBudget } = request;
  const tallyKey = tallyKeyOf(serverKey, sessionKey);
  if (tallyKey === null) return refused('SPEND_KEY_INVALID', 'the server key or the session key is not one a tally can hold');
  const cost = typeof tool === 'string' && Object.hasOwn(policy.costs, tool) ? policy.costs[tool] : undefined;
  if (cost === undefined) return refused('TOOL_COST_UNDECLARED', 'this tool has no declared cost, so it has no budget and does not run');
  if (!Number.isSafeInteger(envelopeBudget) || envelopeBudget < 0 || cost.high > envelopeBudget) {
    return refused('TOOL_OVER_ENVELOPE_BUDGET', `this call costs up to ${cost.high} micro-USD, and its envelope allows ${Number.isSafeInteger(envelopeBudget) ? envelopeBudget : 0}`);
  }
  const spentBefore = tally.get(tallyKey) ?? 0;
  if (spentBefore + cost.high > policy.limit) {
    return refused('TOOL_OVER_SPEND_LIMIT', `this session has used ${spentBefore} of ${policy.limit} micro-USD on this server, and this call costs up to ${cost.high}`);
  }
  const next = new Map(tally);
  next.set(tallyKey, spentBefore + cost.high);
  return { ok: true, charge: Object.freeze({ tallyKey, serverKey, tool, cost, limit: policy.limit }), tally: next, spentBefore };
}

/** Give back what a charge took, for a call that never ran. The total never goes below zero. */
export function refundCharge(tally: SpendTally, charge: Charge): SpendTally {
  const next = new Map(tally);
  next.set(charge.tallyKey, Math.max(0, (tally.get(charge.tallyKey) ?? 0) - charge.cost.high));
  return next;
}

/**
 * The session continues under a new id: its totals move with it, or the rotation would hand a session that has
 * spent its limit a fresh budget. A transfer onto a session that has spent adds to it.
 */
export function transferSession(tally: SpendTally, oldKey: string, newKey: string): SpendTally {
  if (!SESSION_KEY.test(oldKey) || !SESSION_KEY.test(newKey) || oldKey === newKey) return tally;
  const next = new Map(tally);
  for (const [key, spent] of tally) {
    const split = key.lastIndexOf('|');
    if (key.slice(split + 1) !== oldKey) continue;
    const moved = `${key.slice(0, split)}|${newKey}`;
    next.delete(key);
    next.set(moved, (next.get(moved) ?? 0) + spent);
  }
  return next;
}
