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
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
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

/**
 * PROJECTOS-KERNEL-COST-CAP1A, ECC SECURITY M5 — the caps through the PRODUCTION admission, over a real
 * ledger file, not the inline fallback. `admitGatekeeperSpend` is the gate every paid path uses when a
 * durable ledger exists; refusing here is refusing before the transport is ever called.
 */
describe('KERNEL-COST-CAP1A: the serialised admission enforces the caps', () => {
  const CAPPED: BudgetPolicy = { warnAtMicroUsd: 40_000_000, hardStopAtMicroUsd: 50_000_000, phaseHardStopAtMicroUsd: 1_000, dayHardStopAtMicroUsd: 2_000 };
  const at = (r: ReturnType<typeof request>, when: string) => ({ ...r, at: when });
  const ledgerPath = () => join(root, ...GATEKEEPER_LEDGER_REL.split('/'));

  it('refuses a call that would cross the per-phase cap, naming the cap and what the phase has spent', () => {
    appendLedger(sys, root, paid('earlier', 1_000));
    const r = admitGatekeeperSpend(sys, root, request('next', 1), CAPPED);
    expect(r.allowed).toBe(false);
    expect(r.reasons.join(' ')).toContain('the per-phase cap of $0.001000');
    expect(readLedger(sys, root).map((e) => e.requestId)).toEqual(['earlier']);
  });

  it('refuses a call that would cross the per-day cap, counting an offset timestamp on the same UTC day', () => {
    // 00:30 at +01:00 on the 23rd is 23:30Z on the 22nd: the same UTC day as the request.
    appendLedger(sys, root, { ...paid('late-night', 2_000), phaseId: 'OTHER1A', at: '2026-08-23T00:30:00+01:00' } as LedgerEntry);
    const r = admitGatekeeperSpend(sys, root, at(request('next', 1), '2026-08-22T23:45:00.000Z'), CAPPED);
    expect(r.allowed).toBe(false);
    expect(r.reasons.join(' ')).toContain('the per-day cap');
  });

  it('refuses an UNREADABLE ledger and leaves it exactly as it was', () => {
    const corrupt = '{"schemaVersion":"1.0.0","entries":[\n<<<<<<< HEAD\n';
    writeFileSync(ledgerPath(), corrupt);
    const r = admitGatekeeperSpend(sys, root, request('next', 1), CAPPED);
    expect(r.allowed).toBe(false);
    expect(r.reasons.join(' ')).toContain('not valid JSON');
    expect(readFileSync(ledgerPath(), 'utf8')).toBe(corrupt);
  });

  it('refuses a ledger entry whose cost cannot be read, rather than counting it as nothing', () => {
    writeFileSync(ledgerPath(), JSON.stringify({ schemaVersion: '1.0.0', entries: [{ ...paid('x', 1), costMicroUsd: '1000000' }] }));
    const r = admitGatekeeperSpend(sys, root, request('next', 1), CAPPED);
    expect(r.allowed).toBe(false);
    expect(r.reasons.join(' ')).toContain('entry 0 is malformed');
  });

  it('refuses a request time that is not a canonical instant, so nothing can be booked outside every total', () => {
    const r = admitGatekeeperSpend(sys, root, at(request('next', 1), 'garbage'), CAPPED);
    expect(r.allowed).toBe(false);
    expect(r.reasons.join(' ')).toContain('not a canonical ISO-8601 instant');
    expect(existsSync(ledgerPath())).toBe(false);
  });
});

/** PROJECTOS-KERNEL-COST-CAP1A, ECC SECURITY recheck R1, R2 and L-c. */
describe('KERNEL-COST-CAP1A: a ledger that cannot be fully read is never treated as empty', () => {
  const CAPPED: BudgetPolicy = { warnAtMicroUsd: 40_000_000, hardStopAtMicroUsd: 50_000_000, phaseHardStopAtMicroUsd: 1_000, dayHardStopAtMicroUsd: 2_000 };
  const ledgerPath = () => join(root, ...GATEKEEPER_LEDGER_REL.split('/'));

  it('[R1] refuses when the ledger EXISTS but its read failed, and keeps the history', () => {
    appendLedger(sys, root, paid('earlier', 1_000));
    const before = readFileSync(ledgerPath(), 'utf8');
    const failingRead = { ...sys, readText: (p: string) => (p === ledgerPath() ? null : sys.readText(p)) };
    const r = admitGatekeeperSpend(failingRead, root, request('next', 1), CAPPED);
    expect(r.allowed).toBe(false);
    expect(r.reasons.join(' ')).toContain('exists but could not be read');
    expect(readFileSync(ledgerPath(), 'utf8')).toBe(before);
  });

  it('[R2] refuses an entry that cannot be attributed to a phase, day or month', () => {
    writeFileSync(ledgerPath(), JSON.stringify({ schemaVersion: '1.0.0', entries: [{ ...paid('x', 1_000), phaseId: undefined }] }));
    const r = admitGatekeeperSpend(sys, root, request('next', 1), CAPPED);
    expect(r.allowed).toBe(false);
    expect(r.reasons.join(' ')).toContain('entry 0 is malformed');
  });

  it('[L-c] settlement never writes a cost it could not compute', () => {
    admitGatekeeperSpend(sys, root, request('req-N', 5), CAPPED);
    const before = readFileSync(ledgerPath(), 'utf8');
    settleGatekeeperSpend(sys, root, 'req-N', { ...paid('req-N', 1), costMicroUsd: Number.NaN });
    expect(readFileSync(ledgerPath(), 'utf8')).toBe(before);
  });
});
