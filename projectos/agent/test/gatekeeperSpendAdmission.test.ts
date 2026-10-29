/**
 * C17-F1 — the budget hard stop under concurrency.
 *
 * WHAT WENT WRONG. The ledger was crash-safe but not exclusive. Each process read it, computed the
 * remaining allowance from that read, concluded it was under the hard stop, and made a billed call.
 * The later atomic rename then replaced the earlier one, so a call that had genuinely been paid for
 * vanished from the record — and a month that reads low admits yet more spending. The code's own
 * words were "Reaching it refuses further calls; it does not merely warn", and under concurrency that
 * was not true.
 *
 * WHAT THESE TESTS PIN. Not "a lock exists" — that would pass if the lock were taken in the wrong
 * place. They pin the two things a caller can actually observe: no completed call is ever lost from
 * the ledger, and when only one call fits under the hard stop, only one is admitted. The second must
 * be refused BEFORE the provider is reached, which is why the provider here counts its own calls.
 *
 * NO REAL SPEND. The provider is a counter, not a network client.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeSystem } from '../src/system.js';
import {
  admitGatekeeperSpend,
  settleGatekeeperSpend,
  appendLedger,
  readLedger,
  GATEKEEPER_LEDGER_REL,
  GATEKEEPER_LEDGER_LOCK_REL,
} from '../src/loop/gatekeeperConfig.js';
import type { BudgetPolicy, LedgerEntry } from '@projectos/core';

const sys = nodeSystem;
let root = '';

const BUDGET: BudgetPolicy = {
  hardStopAtMicroUsd: 1_000,
  warnAtMicroUsd: 800,
  phaseHardStopAtMicroUsd: 1_000_000,
  dayHardStopAtMicroUsd: 1_000_000,
  perPhaseCeilingMicroUsd: 1_000_000,
  perProjectCeilingMicroUsd: 1_000_000,
} as unknown as BudgetPolicy;

function request(id: string, estimate: number) {
  return {
    requestId: id,
    projectId: 'projectos',
    phaseId: 'PHASE1A',
    model: 'test-model',
    estimateMicroUsd: estimate,
    at: '2026-08-22T10:00:00.000Z',
  };
}

function paid(id: string, cost: number): LedgerEntry {
  return {
    requestId: id,
    projectId: 'projectos',
    phaseId: 'PHASE1A',
    model: 'test-model',
    usage: { inputTokens: 10, outputTokens: 10 },
    costMicroUsd: cost,
    at: '2026-08-22T10:00:00.000Z',
  } as LedgerEntry;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'projectos-spend-'));
  mkdirSync(join(root, '.projectops'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('TEST A — concurrent ledger integrity', () => {
  it('keeps both completed paid calls; neither is lost to a competing write', () => {
    // The old failure was a lost update: both processes read the same ledger and the second rename
    // erased the first entry. Admission serialises them, so each settles against what the other left.
    const first = admitGatekeeperSpend(sys, root, request('req-A', 100), BUDGET);
    expect(first.allowed).toBe(true);
    settleGatekeeperSpend(sys, root, 'req-A', paid('req-A', 100));

    const second = admitGatekeeperSpend(sys, root, request('req-B', 100), BUDGET);
    expect(second.allowed).toBe(true);
    settleGatekeeperSpend(sys, root, 'req-B', paid('req-B', 120));

    const ids = readLedger(sys, root).map((e) => e.requestId).sort();
    expect(ids).toEqual(['req-A', 'req-B']);
    // Each appears exactly once, and at its TRUE cost — not the estimate admission wrote first.
    const byId = new Map(readLedger(sys, root).map((e) => [e.requestId, e.costMicroUsd]));
    expect(byId.get('req-A')).toBe(100);
    expect(byId.get('req-B')).toBe(120);
    expect(readLedger(sys, root)).toHaveLength(2);
  });

  it('settlement replaces the estimate rather than sitting behind it', () => {
    // The ledger keeps the FIRST entry per request id, so an appended truth would never be counted.
    admitGatekeeperSpend(sys, root, request('req-C', 500), BUDGET);
    expect(readLedger(sys, root)[0]?.costMicroUsd).toBe(500);
    settleGatekeeperSpend(sys, root, 'req-C', paid('req-C', 42));
    expect(readLedger(sys, root)).toHaveLength(1);
    expect(readLedger(sys, root)[0]?.costMicroUsd).toBe(42);
  });

  it('a call that never happened leaves nothing behind', () => {
    admitGatekeeperSpend(sys, root, request('req-D', 500), BUDGET);
    settleGatekeeperSpend(sys, root, 'req-D', null);
    expect(readLedger(sys, root)).toHaveLength(0);
  });
});

describe('TEST B — hard stop under concurrency', () => {
  it('admits only one call when only one fits, and the second never reaches the provider', () => {
    // Budget is 1000 and 600 is already spent, so exactly one 400 call fits. Two processes ask.
    appendLedger(sys, root, paid('already-spent', 600));

    let providerCalls = 0;
    const callProvider = (id: string): void => {
      providerCalls += 1;
      settleGatekeeperSpend(sys, root, id, paid(id, 400));
    };

    // THE ORDER HERE IS THE POINT. Both admissions are attempted before either settles, which is the
    // interleaving that used to let both through: each read a ledger showing only 600 spent.
    const a = admitGatekeeperSpend(sys, root, request('race-A', 400), BUDGET);
    const b = admitGatekeeperSpend(sys, root, request('race-B', 400), BUDGET);

    if (a.allowed) callProvider('race-A');
    if (b.allowed) callProvider('race-B');

    const admitted = [a.allowed, b.allowed].filter(Boolean).length;
    expect(admitted).toBe(1);
    expect(providerCalls).toBe(1);

    // The refusal must say the hard stop refused it, not merely that something went wrong.
    const refused = a.allowed ? b : a;
    expect(refused.reasons.join(' ')).toMatch(/hard stop/i);

    // 600 already + 400 admitted = 1000, exactly the hard stop. Nothing beyond it.
    const total = readLedger(sys, root).reduce((n, e) => n + e.costMicroUsd, 0);
    expect(total).toBe(1000);
  });

  it('refuses a request id already in the ledger, so a restart cannot pay twice', () => {
    appendLedger(sys, root, paid('req-restart', 100));
    const again = admitGatekeeperSpend(sys, root, request('req-restart', 100), BUDGET);
    expect(again.allowed).toBe(false);
    expect(again.reasons.join(' ')).toMatch(/already in the ledger/i);
  });

  it('refuses admission while another process holds the lock, and makes no call', () => {
    // A held lock must refuse rather than proceed unserialised — the whole point of the fix.
    const lock = join(root, ...GATEKEEPER_LEDGER_LOCK_REL.split('/'));
    expect(sys.createExclusive(lock, '{"heldSince":"now"}\n')).toBe(true);
    const held = admitGatekeeperSpend(sys, root, request('req-blocked', 10), BUDGET);
    expect(held.allowed).toBe(false);
    expect(held.reasons.join(' ')).toMatch(/another ProjectOS process/i);
    // Nothing was written while the lock was held by someone else.
    expect(existsSync(join(root, ...GATEKEEPER_LEDGER_REL.split('/')))).toBe(false);
  });

  it('releases the lock so ordinary sequential work still proceeds', () => {
    admitGatekeeperSpend(sys, root, request('req-1', 10), BUDGET);
    expect(existsSync(join(root, ...GATEKEEPER_LEDGER_LOCK_REL.split('/')))).toBe(false);
    const next = admitGatekeeperSpend(sys, root, request('req-2', 10), BUDGET);
    expect(next.allowed).toBe(true);
  });
});

describe('single-process behaviour is preserved', () => {
  it('still admits a call that fits well inside the budget', () => {
    const ok = admitGatekeeperSpend(sys, root, request('req-ok', 1), BUDGET);
    expect(ok.allowed).toBe(true);
  });

  it('still refuses a single call that alone would cross the hard stop', () => {
    const tooBig = admitGatekeeperSpend(sys, root, request('req-big', 5_000), BUDGET);
    expect(tooBig.allowed).toBe(false);
    // And it wrote nothing: a refused call must not leave a reservation counted against the month.
    const path = join(root, ...GATEKEEPER_LEDGER_REL.split('/'));
    if (existsSync(path)) expect(JSON.parse(readFileSync(path, 'utf8')).entries).toHaveLength(0);
  });
});
