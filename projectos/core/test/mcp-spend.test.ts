/**
 * Per-tool spend: a call with no declared cost, or past a limit, is refused (PROJECTOS-PORT-MCP1A).
 * Amounts are whole micro-USD, the unit of an envelope's budget.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_TALLY,
  parseCostPolicy,
  refundCharge,
  reserveToolSpend,
  spendOf,
  transferSession,
  type CostPolicy,
  type SpendDecision,
  type SpendTally,
} from '../src/mcpConnectors/index.js';

const SERVER = 'agency-business/mail-reader';

function policyOf(costs: unknown = { search_mail: 100, send_mail: [200, 400], free_read: 0 }, limit: unknown = 1_000): CostPolicy {
  const parsed = parseCostPolicy(costs, limit, 'test');
  if (!parsed.ok) throw new Error(parsed.problems.join('; '));
  return parsed.policy;
}

function reserve(over: Partial<Parameters<typeof reserveToolSpend>[0]> = {}): SpendDecision {
  return reserveToolSpend({ policy: policyOf(), serverKey: SERVER, tool: 'search_mail', sessionKey: 'RUN-1', tally: EMPTY_TALLY, envelopeBudget: 500, ...over });
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
});

describe('a call is booked against its limit', () => {
  it('books the top of the range and reports what was spent before: the positive control', () => {
    const decision = reserve({ tool: 'send_mail', envelopeBudget: 500 });
    expect(decision).toMatchObject({ ok: true, spentBefore: 0 });
    expect(spendOf(booked(decision), SERVER, 'RUN-1')).toBe(400);
  });

  it('refuses a tool the policy does not declare, so a call with no budget never runs', () => {
    expect(reserve({ tool: 'delete_everything' })).toMatchObject({ ok: false, code: 'TOOL_COST_UNDECLARED' });
  });

  it('refuses a tool name that would reach a prototype', () => {
    expect(reserve({ tool: '__proto__' })).toMatchObject({ ok: false, code: 'TOOL_COST_UNDECLARED' });
    expect(reserve({ tool: 'constructor' })).toMatchObject({ ok: false, code: 'TOOL_COST_UNDECLARED' });
  });

  it('a declared cost of zero is a budget, and books nothing', () => {
    const decision = reserve({ tool: 'free_read', envelopeBudget: 0 });
    expect(decision).toMatchObject({ ok: true });
    expect(spendOf(booked(decision), SERVER, 'RUN-1')).toBe(0);
  });

  it('refuses a call that costs more than the envelope allows for one call', () => {
    expect(reserve({ tool: 'send_mail', envelopeBudget: 399 })).toMatchObject({ ok: false, code: 'TOOL_OVER_ENVELOPE_BUDGET' });
    expect(reserve({ tool: 'send_mail', envelopeBudget: 400 })).toMatchObject({ ok: true });
  });

  it('refuses the call that would pass the spend limit, and books nothing for it', () => {
    let tally: SpendTally = EMPTY_TALLY;
    for (let call = 0; call < 10; call += 1) tally = booked(reserve({ tally }));
    expect(spendOf(tally, SERVER, 'RUN-1')).toBe(1_000);
    const over = reserve({ tally });
    expect(over).toMatchObject({ ok: false, code: 'TOOL_OVER_SPEND_LIMIT' });
    expect(spendOf(tally, SERVER, 'RUN-1')).toBe(1_000);
  });

  it('a limit is exact: a call that lands on it passes and the next fails', () => {
    const tally = booked(reserve({ policy: policyOf({ search_mail: 100 }, 100) }));
    expect(reserve({ policy: policyOf({ search_mail: 100 }, 100), tally })).toMatchObject({ ok: false, code: 'TOOL_OVER_SPEND_LIMIT' });
  });

  it('keeps one tally per server and per session', () => {
    const tally = booked(reserve());
    expect(spendOf(tally, SERVER, 'RUN-1')).toBe(100);
    expect(spendOf(tally, SERVER, 'RUN-2')).toBe(0);
    expect(spendOf(tally, 'owner-personal/mail-reader', 'RUN-1')).toBe(0);
  });

  it('does not change the tally it was given', () => {
    const before: SpendTally = EMPTY_TALLY;
    booked(reserve({ tally: before }));
    expect(spendOf(before, SERVER, 'RUN-1')).toBe(0);
  });

  it.each([['an empty session', ''], ['a session with a space', 'RUN 1'], ['a long session', 'R'.repeat(200)]])('refuses %s', (_label, sessionKey) => {
    expect(reserve({ sessionKey })).toMatchObject({ ok: false, code: 'SPEND_KEY_INVALID' });
  });

  it('refuses a server key that is not tenant/server', () => {
    expect(reserve({ serverKey: 'mail-reader' })).toMatchObject({ ok: false, code: 'SPEND_KEY_INVALID' });
  });

  it('refuses an envelope budget that is not a whole non-negative number', () => {
    expect(reserve({ envelopeBudget: Number.NaN })).toMatchObject({ ok: false });
    expect(reserve({ envelopeBudget: -1 })).toMatchObject({ ok: false });
  });
});

describe('a refund and a rotated session', () => {
  it('a refund returns what a charge took, and never goes below zero', () => {
    const decision = reserve();
    if (!decision.ok) throw new Error('control');
    const back = refundCharge(decision.tally, decision.charge);
    expect(spendOf(back, SERVER, 'RUN-1')).toBe(0);
    expect(spendOf(refundCharge(back, decision.charge), SERVER, 'RUN-1')).toBe(0);
  });

  it('a session that continues under a new id keeps what it spent, so rotation is no fresh budget', () => {
    let tally: SpendTally = EMPTY_TALLY;
    for (let call = 0; call < 10; call += 1) tally = booked(reserve({ tally }));
    const moved = transferSession(tally, 'RUN-1', 'RUN-2');
    expect(spendOf(moved, SERVER, 'RUN-2')).toBe(1_000);
    expect(spendOf(moved, SERVER, 'RUN-1')).toBe(0);
    expect(reserve({ tally: moved, sessionKey: 'RUN-2' })).toMatchObject({ ok: false, code: 'TOOL_OVER_SPEND_LIMIT' });
  });

  it('a transfer onto a session that already spent adds to it', () => {
    const a = booked(reserve({ sessionKey: 'RUN-1' }));
    const both = booked(reserve({ sessionKey: 'RUN-2', tally: a }));
    expect(spendOf(transferSession(both, 'RUN-1', 'RUN-2'), SERVER, 'RUN-2')).toBe(200);
  });

  it('a transfer to the same id, or from or to nothing, changes nothing', () => {
    const tally = booked(reserve());
    expect(spendOf(transferSession(tally, 'RUN-1', 'RUN-1'), SERVER, 'RUN-1')).toBe(100);
    expect(spendOf(transferSession(tally, '', 'RUN-9'), SERVER, 'RUN-9')).toBe(0);
  });
});
