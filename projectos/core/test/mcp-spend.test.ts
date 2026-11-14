/**
 * Per-tool spend: a call with no declared cost, or past a limit, is refused (PROJECTOS-PORT-MCP1A).
 * Amounts are whole micro-USD, the unit of an envelope's budget.
 *
 * REVIEW ROUND 1 (H2): the limit is bound per tenant and server, in a window. There is no caller-supplied session
 * key that can start a fresh budget, so the tests that pinned a per-session total and its rotation are replaced.
 * Every call counts toward a call cap, a zero-cost tool included.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALL_LIMIT,
  DEFAULT_SPEND_WINDOW_MS,
  EMPTY_TALLY,
  callsOf,
  parseCostPolicy,
  refundCharge,
  reserveToolSpend,
  spendOf,
  type CostPolicy,
  type SpendDecision,
  type SpendTally,
} from '../src/mcpConnectors/index.js';

const SERVER = 'agency-business/mail-reader';
const T0 = 1_000_000;

function policyOf(costs: unknown = { search_mail: 100, send_mail: [200, 400], free_read: 0 }, limit: unknown = 1_000, options: { callLimit?: number; windowMs?: number } = {}): CostPolicy {
  const parsed = parseCostPolicy(costs, limit, 'test', options);
  if (!parsed.ok) throw new Error(parsed.problems.join('; '));
  return parsed.policy;
}

function reserve(over: Partial<Parameters<typeof reserveToolSpend>[0]> = {}): SpendDecision {
  return reserveToolSpend({ policy: policyOf(), serverKey: SERVER, tool: 'search_mail', tally: EMPTY_TALLY, envelopeBudget: 500, nowMs: T0, ...over });
}

function booked(decision: SpendDecision): SpendTally {
  if (!decision.ok) throw new Error(decision.reason);
  return decision.tally;
}

describe('the cost policy', () => {
  it('reads a number, a range and a note: the positive control', () => {
    const parsed = parseCostPolicy({ a: 5, b: [2, 9], c: { microUsd: 7, note: 'about' } }, 100, 'test');
    expect(parsed).toMatchObject({ ok: true });
    expect(parsed.ok && parsed.policy.costs['b']).toEqual({ low: 2, high: 9, note: '' });
    expect(parsed.ok && parsed.policy.costs['c']).toEqual({ low: 7, high: 7, note: 'about' });
  });

  it('carries a default call cap and window when the owner names none', () => {
    const parsed = parseCostPolicy({ a: 1 }, 100, 'test');
    expect(parsed.ok && parsed.policy.callLimit).toBe(DEFAULT_CALL_LIMIT);
    expect(parsed.ok && parsed.policy.windowMs).toBe(DEFAULT_SPEND_WINDOW_MS);
  });

  it.each([
    ['a negative amount', { a: -1 }],
    ['a fraction', { a: 1.5 }],
    ['a boolean', { a: true }],
    ['a string', { a: '5' }],
    ['NaN', { a: Number.NaN }],
    ['Infinity', { a: Number.POSITIVE_INFINITY }],
    ['a range of the wrong length', { a: [1] }],
    ['a reversed range', { a: [9, 2] }],
    ['an object with an unknown key', { a: { microUsd: 1, extra: 2 } }],
    ['an empty tool name', { '': 1 }],
    ['a costs table that is a list', [1]],
    ['a table that is not there', null],
  ])('refuses %s', (_label, costs) => {
    expect(parseCostPolicy(costs, 100, 'test')).toMatchObject({ ok: false });
  });

  it.each([['zero', 0], ['negative', -5], ['a fraction', 0.5], ['missing', undefined], ['text', '100']])('refuses a limit that is %s', (_label, limit) => {
    expect(parseCostPolicy({ a: 1 }, limit, 'test')).toMatchObject({ ok: false });
  });

  it.each([['a call cap of zero', { callLimit: 0 }], ['a fractional call cap', { callLimit: 1.5 }], ['a window under a minute', { windowMs: 1_000 }], ['a window over a week', { windowMs: 8 * 86_400_000 }]])('refuses %s', (_label, options) => {
    expect(parseCostPolicy({ a: 1 }, 100, 'test', options)).toMatchObject({ ok: false });
  });
});

describe('a call is booked against its limit', () => {
  it('books the top of the range and reports what was spent before: the positive control', () => {
    const decision = reserve({ tool: 'send_mail', envelopeBudget: 500 });
    expect(decision).toMatchObject({ ok: true, spentBefore: 0 });
    expect(spendOf(booked(decision), SERVER)).toBe(400);
    expect(callsOf(booked(decision), SERVER)).toBe(1);
  });

  it('refuses a tool the policy does not declare, so a call with no budget never runs', () => {
    expect(reserve({ tool: 'delete_everything' })).toMatchObject({ ok: false, code: 'TOOL_COST_UNDECLARED' });
  });

  it('refuses a tool name that would reach a prototype', () => {
    expect(reserve({ tool: '__proto__' })).toMatchObject({ ok: false, code: 'TOOL_COST_UNDECLARED' });
    expect(reserve({ tool: 'constructor' })).toMatchObject({ ok: false, code: 'TOOL_COST_UNDECLARED' });
  });

  it('a declared cost of zero is a budget, and books no money', () => {
    const decision = reserve({ tool: 'free_read', envelopeBudget: 0 });
    expect(decision).toMatchObject({ ok: true });
    expect(spendOf(booked(decision), SERVER)).toBe(0);
  });

  it('refuses a call that costs more than the envelope allows for one call', () => {
    expect(reserve({ tool: 'send_mail', envelopeBudget: 399 })).toMatchObject({ ok: false, code: 'TOOL_OVER_ENVELOPE_BUDGET' });
    expect(reserve({ tool: 'send_mail', envelopeBudget: 400 })).toMatchObject({ ok: true });
  });

  it('refuses the call that would pass the spend limit, and books nothing for it', () => {
    let tally: SpendTally = EMPTY_TALLY;
    for (let call = 0; call < 10; call += 1) tally = booked(reserve({ tally }));
    expect(spendOf(tally, SERVER)).toBe(1_000);
    expect(reserve({ tally })).toMatchObject({ ok: false, code: 'TOOL_OVER_SPEND_LIMIT' });
    expect(spendOf(tally, SERVER)).toBe(1_000);
  });

  it('a limit is exact: a call that lands on it passes and the next fails', () => {
    const policy = policyOf({ search_mail: 100 }, 100);
    const tally = booked(reserve({ policy }));
    expect(reserve({ policy, tally })).toMatchObject({ ok: false, code: 'TOOL_OVER_SPEND_LIMIT' });
  });

  it('keeps one tally per tenant and server, and neither sees the other', () => {
    const tally = booked(reserve());
    expect(spendOf(tally, SERVER)).toBe(100);
    expect(spendOf(tally, 'owner-personal/mail-reader')).toBe(0);
  });

  it('does not change the tally it was given', () => {
    const before: SpendTally = EMPTY_TALLY;
    booked(reserve({ tally: before }));
    expect(spendOf(before, SERVER)).toBe(0);
    expect(before.size).toBe(0);
  });

  it('refuses a server key that is not tenant/server', () => {
    expect(reserve({ serverKey: 'mail-reader' })).toMatchObject({ ok: false, code: 'SPEND_KEY_INVALID' });
  });

  it('refuses an envelope budget that is not a whole non-negative number', () => {
    expect(reserve({ envelopeBudget: Number.NaN })).toMatchObject({ ok: false });
    expect(reserve({ envelopeBudget: -1 })).toMatchObject({ ok: false });
  });
});

describe('there is no key a caller can change to start a fresh budget (H2)', () => {
  it('ignores a session key handed in, so one server is one budget however the caller names its runs', () => {
    let tally: SpendTally = EMPTY_TALLY;
    for (let call = 0; call < 10; call += 1) tally = booked(reserve({ tally, ...({ sessionKey: `RUN-${call}` } as object) }));
    expect(spendOf(tally, SERVER)).toBe(1_000);
    expect(reserve({ tally, ...({ sessionKey: 'RUN-FRESH' } as object) })).toMatchObject({ ok: false, code: 'TOOL_OVER_SPEND_LIMIT' });
  });

  it('the limit holds until the window ends, and then it starts again', () => {
    let tally: SpendTally = EMPTY_TALLY;
    for (let call = 0; call < 10; call += 1) tally = booked(reserve({ tally }));
    expect(reserve({ tally, nowMs: T0 + DEFAULT_SPEND_WINDOW_MS - 1 })).toMatchObject({ ok: false, code: 'TOOL_OVER_SPEND_LIMIT' });
    const later = reserve({ tally, nowMs: T0 + DEFAULT_SPEND_WINDOW_MS });
    expect(later).toMatchObject({ ok: true, spentBefore: 0 });
    expect(spendOf(booked(later), SERVER)).toBe(100);
  });

  it('a clock that runs backwards does not open a new window', () => {
    let tally: SpendTally = EMPTY_TALLY;
    for (let call = 0; call < 10; call += 1) tally = booked(reserve({ tally }));
    expect(reserve({ tally, nowMs: T0 - 5_000 })).toMatchObject({ ok: false, code: 'TOOL_OVER_SPEND_LIMIT' });
  });

  it('refuses a clock that is not a whole non-negative number', () => {
    expect(reserve({ nowMs: Number.NaN })).toMatchObject({ ok: false, code: 'SPEND_CLOCK_INVALID' });
    expect(reserve({ nowMs: -1 })).toMatchObject({ ok: false, code: 'SPEND_CLOCK_INVALID' });
  });
});

describe('every call counts, a free one too (H2)', () => {
  it('refuses the call past the call cap, with a tool that costs nothing', () => {
    const policy = policyOf({ free_read: 0 }, 1_000, { callLimit: 3 });
    let tally: SpendTally = EMPTY_TALLY;
    for (let call = 0; call < 3; call += 1) tally = booked(reserve({ policy, tool: 'free_read', tally, envelopeBudget: 0 }));
    expect(callsOf(tally, SERVER)).toBe(3);
    expect(reserve({ policy, tool: 'free_read', tally, envelopeBudget: 0 })).toMatchObject({ ok: false, code: 'TOOL_OVER_CALL_LIMIT' });
  });

  it('the call cap starts again with the window', () => {
    const policy = policyOf({ free_read: 0 }, 1_000, { callLimit: 1 });
    const tally = booked(reserve({ policy, tool: 'free_read', envelopeBudget: 0 }));
    expect(reserve({ policy, tool: 'free_read', tally, envelopeBudget: 0, nowMs: T0 + DEFAULT_SPEND_WINDOW_MS })).toMatchObject({ ok: true });
  });
});

describe('a refund', () => {
  it('returns the money and the call a charge took, and never goes below zero', () => {
    const decision = reserve();
    if (!decision.ok) throw new Error('control');
    const back = refundCharge(decision.tally, decision.charge);
    expect(spendOf(back, SERVER)).toBe(0);
    expect(callsOf(back, SERVER)).toBe(0);
    const again = refundCharge(back, decision.charge);
    expect(spendOf(again, SERVER)).toBe(0);
    expect(callsOf(again, SERVER)).toBe(0);
  });
});
