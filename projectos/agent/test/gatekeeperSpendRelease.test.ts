/**
 * C11-W2-F6 — a reservation must not outlive the call it was made for.
 *
 * THE DEFECT. Admission writes a provisional ledger entry BEFORE the gatekeeper is called, so the
 * ceiling is decided against a fresh, locked read (C17-F1). Nothing closed that entry when the call
 * never produced an answer. The next run then re-derived the same request id, found it in the ledger,
 * and refused it as "already asked" — before the gatekeeper was even attempted.
 *
 * That refusal is not a safe failure. It returns no owner choices and no unavailability cause, so
 * degraded mode cannot open at all: one failed transport withdrew the owner's ACCEPT RISK option and
 * made that exact question permanently unaskable. It was found by running the C11 witness, not by
 * reading the code.
 *
 * The rule now: a call that DEFINITELY was not dispatched releases its reservation, so no phantom
 * spend remains; one that MAY have been dispatched keeps its cost — real money must never disappear
 * because a reply was lost — and is marked so the question can be asked again, with the next
 * reservation REPLACING it rather than adding a second charge.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';

import {
  admitGatekeeperSpend,
  resolveGatekeeperSpend,
  settleGatekeeperSpend,
  readLedger,
  releaseUndispatchedReservation,
  consumedDecisionIds,
  GATEKEEPER_LEDGER_REL,
} from '../src/loop/gatekeeperConfig.js';
import { readBrokerAnsweredState, BROKER_SPEND_FILE } from '../src/installation/brokerAnsweredState.js';
import type { BudgetPolicy, LedgerEntry } from '@projectos/core';
import type { System } from '../src/system.js';

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

const BUDGET: BudgetPolicy = { warnAtMicroUsd: 2_000_000, hardStopAtMicroUsd: 5_000_000, phaseHardStopAtMicroUsd: 5_000_000, dayHardStopAtMicroUsd: 5_000_000 };
const REQUEST = {
  requestId: 'GKREQ-aaaaaaaaaaaaaaaaaaaaaaaa',
  projectId: 'acme',
  phaseId: 'ACME-P1A',
  model: 'test-model',
  estimateMicroUsd: 8283,
  at: '2026-08-22T20:04:01.397Z',
};

function world(): { root: string; sys: System } {
  const root = mkdtempSync(pjoin(tmpdir(), 'projectos-spend-')).replace(/\\/g, '/');
  created.push(root);
  mkdirSync(pjoin(root, '.projectops'), { recursive: true });
  const held = new Set<string>();
  const sys: System = {
    cwd: () => root,
    now: () => REQUEST.at,
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => {
      mkdirSync(pjoin(p, '..'), { recursive: true });
      writeFileSync(p, c);
    },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    // A real lock: the second acquisition of the same path fails, as O_CREAT|O_EXCL would.
    createExclusive: (p: string, _content: string) => {
      if (held.has(p)) return false;
      held.add(p);
      return true;
    },
    removeFile: (p: string) => {
      held.delete(p);
      if (existsSync(p)) unlinkSync(p);
      return true;
    },
    // A REAL RENAME. The ledger is written crash-safely — a complete temporary file, then a rename
    // over the target — so a stub that reported success without moving anything made every write
    // vanish. The fixture has to honour the primitive the code actually depends on.
    renameFile: (from: string, to: string) => {
      renameSync(from, to);
      return true;
    },
    exec: () => ({ code: 1, stdout: '', stderr: '' }),
  };
  return { root, sys };
}

/**
 * What the installation's record says. The tests below are about questions the reviewer never
 * answered, so they say that explicitly: since C11-W2-F7 the retry gate consults this, and an
 * unstated answer is `unknown`, which refuses.
 */
const NEVER_ANSWERED = (): 'not-answered' => 'not-answered';

const monthTotal = (sys: System, root: string): number =>
  readLedger(sys, root).reduce((sum, e) => sum + e.costMicroUsd, 0);

describe('C11-W2-F6 — closing out a reservation whose call produced no answer', () => {
  /**
   * [A] PRE-DISPATCH FAILURE. The credential could not be resolved, so nothing left this process.
   * The reservation is removed: billing the month for a call that never happened spends an owner's
   * budget on nothing, which is not a conservative error.
   */
  test('A a failure that proves nothing was dispatched leaves no phantom spend', () => {
    const w = world();
    expect(admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED).allowed).toBe(true);
    expect(monthTotal(w.sys, w.root)).toBe(8283);

    resolveGatekeeperSpend(w.sys, w.root, REQUEST.requestId, 'CREDENTIAL_UNAVAILABLE', NEVER_ANSWERED);

    expect(readLedger(w.sys, w.root)).toEqual([]);
    expect(monthTotal(w.sys, w.root)).toBe(0);
  });

  /**
   * [B] AND THE QUESTION MAY BE PUT AGAIN. This is the half that actually unblocks the owner: with
   * the reservation released, admission allows the same request, so the run reaches the gatekeeper
   * and the owner's degraded-mode choice is offered instead of being silently withdrawn.
   */
  test('B after that failure the same request is admitted again, and is not double-counted', () => {
    const w = world();
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);
    resolveGatekeeperSpend(w.sys, w.root, REQUEST.requestId, 'CREDENTIAL_UNAVAILABLE', NEVER_ANSWERED);

    const second = admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);

    expect(second.allowed, second.reasons.join(' | ')).toBe(true);
    expect(readLedger(w.sys, w.root)).toHaveLength(1);
    expect(monthTotal(w.sys, w.root)).toBe(8283);
  });

  /**
   * [C] UNCERTAIN FAILURE. The provider may have been reached and the reply lost. The cost is NOT
   * erased — that is the direction in which real spend would disappear — and the question is still
   * re-askable, with the new reservation replacing the old one so the estimate is not counted twice.
   */
  test('C an uncertain failure keeps the cost, stays re-askable, and is never double-counted', () => {
    const w = world();
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);

    resolveGatekeeperSpend(w.sys, w.root, REQUEST.requestId, 'PROVIDER_UNAVAILABLE', NEVER_ANSWERED);

    // Retained, and still marked — admission marked it at birth, so nothing had to run here.
    const after = readLedger(w.sys, w.root);
    expect(after).toHaveLength(1);
    expect(after[0]?.costMicroUsd).toBe(8283);
    expect(after[0]?.unresolved).toBe(true);
    expect(monthTotal(w.sys, w.root)).toBe(8283);

    // Re-askable, and still exactly one charge afterwards.
    const second = admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);
    expect(second.allowed, second.reasons.join(' | ')).toBe(true);
    expect(readLedger(w.sys, w.root)).toHaveLength(1);
    expect(monthTotal(w.sys, w.root)).toBe(8283);
  });

  /**
   * [C2] A CALL THAT HAPPENED IS UNTOUCHABLE. Settlement records real usage; nothing here may rewrite
   * or release it, and the double-charge guard still refuses to ask it again. Without this, the
   * re-askability added above would have reopened the very defect C17-F1 closed.
   */
  test('C2 a settled call is never released, and is never asked again', () => {
    const w = world();
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);
    const settled: LedgerEntry = {
      requestId: REQUEST.requestId,
      projectId: REQUEST.projectId,
      phaseId: REQUEST.phaseId,
      model: REQUEST.model,
      usage: { inputTokens: 1200, outputTokens: 800 },
      costMicroUsd: 9100,
      at: REQUEST.at,
    };
    settleGatekeeperSpend(w.sys, w.root, REQUEST.requestId, settled);

    // A late or spurious close-out cannot erase or alter it.
    resolveGatekeeperSpend(w.sys, w.root, REQUEST.requestId, 'CREDENTIAL_UNAVAILABLE', NEVER_ANSWERED);
    expect(readLedger(w.sys, w.root)).toEqual([settled]);

    const again = admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);
    expect(again.allowed).toBe(false);
    expect(again.reasons.join(' ')).toContain('is not asked again');
  });

  /**
   * [D] THE C17-F1 PROPERTY STILL HOLDS. The ceiling is decided inside the lock against a fresh read,
   * so two admissions attempted before either settles cannot both pass when only one call fits.
   * Re-askability must not have reopened that: this is the same interleaving, with DIFFERENT request
   * ids, which is the case the concurrency defect was actually about.
   */
  test('D two different requests cannot both be admitted past the hard stop', () => {
    const w = world();
    const budget: BudgetPolicy = { warnAtMicroUsd: 500, hardStopAtMicroUsd: 1000, phaseHardStopAtMicroUsd: 1000, dayHardStopAtMicroUsd: 1000 };
    writeFileSync(
      pjoin(w.root, ...GATEKEEPER_LEDGER_REL.split('/')),
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          entries: [
            {
              requestId: 'GKREQ-already-spent',
              projectId: 'acme',
              phaseId: 'ACME-P1A',
              model: 'test-model',
              usage: { inputTokens: 10, outputTokens: 10 },
              costMicroUsd: 600,
              at: REQUEST.at,
            },
          ],
        },
        null,
        2,
      ),
    );

    const first = admitGatekeeperSpend(w.sys, w.root, { ...REQUEST, requestId: 'GKREQ-first', estimateMicroUsd: 400 }, budget, NEVER_ANSWERED);
    const second = admitGatekeeperSpend(w.sys, w.root, { ...REQUEST, requestId: 'GKREQ-second', estimateMicroUsd: 400 }, budget, NEVER_ANSWERED);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(monthTotal(w.sys, w.root)).toBe(1000);
  });

  /** [D2] And an unresolved reservation still counts against the ceiling while it stands. */
  test('D2 a retained unresolved reservation is still counted against the hard stop', () => {
    const w = world();
    const budget: BudgetPolicy = { warnAtMicroUsd: 500, hardStopAtMicroUsd: 1000, phaseHardStopAtMicroUsd: 1000, dayHardStopAtMicroUsd: 1000 };
    admitGatekeeperSpend(w.sys, w.root, { ...REQUEST, requestId: 'GKREQ-one', estimateMicroUsd: 900 }, budget, NEVER_ANSWERED);
    resolveGatekeeperSpend(w.sys, w.root, 'GKREQ-one', 'PROVIDER_UNAVAILABLE');

    const other = admitGatekeeperSpend(w.sys, w.root, { ...REQUEST, requestId: 'GKREQ-two', estimateMicroUsd: 400 }, budget, NEVER_ANSWERED);

    expect(other.allowed).toBe(false);
    expect(monthTotal(w.sys, w.root)).toBe(900);
  });
});

/**
 * The three ways the first version of this correction still failed, each found by adversarial review
 * rather than by a test. All three had one root: the entry was marked from a step that ran AFTER the
 * call, so anything that stopped the process reaching that step left a bare reservation behind and
 * reproduced the original defect. Admission now marks it at birth.
 */
describe('C11-W2-F6 — the mark must survive whatever stops the run', () => {
  /**
   * [E] INTERRUPTED BEFORE ANYTHING COULD CLOSE IT. A crash, a kill, or a timeout between reserving
   * and returning: nothing calls resolve at all. The reservation must still be re-askable, or one
   * interrupted run makes that question permanently unaskable and withdraws the owner's choice.
   */
  test('E a reservation nothing ever closed is still re-askable', () => {
    const w = world();
    expect(admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED).allowed).toBe(true);

    // No resolve. This is the process simply ending.
    const next = admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);

    expect(next.allowed, next.reasons.join(' | ')).toBe(true);
    expect(readLedger(w.sys, w.root)).toHaveLength(1);
    expect(monthTotal(w.sys, w.root)).toBe(8283);
  });

  /**
   * [F] THE LEDGER LOCK COULD NOT BE TAKEN. `underCostLedgerLock` refuses silently when another
   * holder has it — which this module's own notes call an everyday occurrence on Windows. The retain
   * path must therefore need no write at all: recovery may not depend on a step that can fail.
   */
  test('F losing the lock during close-out does not strand the reservation', () => {
    const w = world();
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);

    // Hold the lock, so resolve cannot take it.
    const lock = pjoin(w.root, '.projectops/gatekeeper-ledger.lock');
    expect(w.sys.createExclusive(lock, 'held by another run')).toBe(true);
    resolveGatekeeperSpend(w.sys, w.root, REQUEST.requestId, 'PROVIDER_UNAVAILABLE', NEVER_ANSWERED);
    w.sys.removeFile(lock);

    const next = admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);
    expect(next.allowed, next.reasons.join(' | ')).toBe(true);
    expect(monthTotal(w.sys, w.root)).toBe(8283);
  });

  /**
   * [G] AND THE RETRY'S ANSWER MUST BE ACCEPTED. `consumedDecisionIds` is what refuses a reply as
   * already acted on. A reservation in that list refuses the very decision the retry was for — the
   * caller reads the ledger once at start-up, so the retained entry is still in the snapshot when the
   * fresh, paid-for answer comes back. A decision id is consumed by a decision, not by an attempt.
   */
  test('G an unanswered reservation consumes no decision id', () => {
    const w = world();
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);

    expect(consumedDecisionIds(readLedger(w.sys, w.root))).toEqual([]);

    // Once the call really is answered, its id IS consumed and cannot be replayed.
    settleGatekeeperSpend(w.sys, w.root, REQUEST.requestId, {
      requestId: REQUEST.requestId,
      projectId: REQUEST.projectId,
      phaseId: REQUEST.phaseId,
      model: REQUEST.model,
      usage: { inputTokens: 1200, outputTokens: 800 },
      costMicroUsd: 9100,
      at: REQUEST.at,
    });
    expect(consumedDecisionIds(readLedger(w.sys, w.root))).toEqual([`GKDEC-${REQUEST.requestId}`]);
  });

  /** [H] Settlement clears the mark, so a completed call is never mistaken for a reservation. */
  test('H settling a reservation leaves nothing marked unresolved', () => {
    const w = world();
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);
    expect(readLedger(w.sys, w.root)[0]?.unresolved).toBe(true);

    settleGatekeeperSpend(w.sys, w.root, REQUEST.requestId, {
      requestId: REQUEST.requestId,
      projectId: REQUEST.projectId,
      phaseId: REQUEST.phaseId,
      model: REQUEST.model,
      usage: { inputTokens: 10, outputTokens: 10 },
      costMicroUsd: 500,
      at: REQUEST.at,
    });

    expect(readLedger(w.sys, w.root)[0]?.unresolved).toBeUndefined();
    expect(admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED).allowed).toBe(false);
  });
});

/**
 * C11-W2-F7 — the mark is not proof the question went unanswered.
 *
 * A reservation is marked when admission writes it and unmarked by settlement replacing it. But
 * settlement can silently fail to take the ledger lock — an everyday occurrence by this codebase's own
 * account — so an entry still marked unresolved may be a call the reviewer ANSWERED. Retrying it
 * would pay a second time for a decided question and could apply a second, contradicting verdict over
 * one the loop already acted on.
 *
 * The project ledger cannot tell those apart. The broker can: it reserves a row in the installation's
 * own spend record before dispatching and marks it answered before handing the reply back. That
 * record is written outside every governed project, by the party that actually knows.
 */
describe('C11-W2-F7 — the installation record decides whether a question may be re-asked', () => {
  function brokerRecord(w: { root: string; sys: System }, calls: readonly Record<string, unknown>[]): string {
    const dir = pjoin(w.root, 'installation-state');
    mkdirSync(dir, { recursive: true });
    writeFileSync(pjoin(dir, BROKER_SPEND_FILE), JSON.stringify({ calls }, null, 2));
    return dir;
  }
  const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    requestId: REQUEST.requestId,
    projectId: REQUEST.projectId,
    phaseId: REQUEST.phaseId,
    ...over,
  });

  /**
   * [A] ANSWERED, AND THE SETTLEMENT WAS LOST. The exact composition the review reproduced: the
   * reviewer answered, settlement could not take the lock, so the ledger still shows a reservation.
   * The provider must not be asked again — the decision stands and it is the accounting that needs
   * repair, not the question that needs re-putting.
   */
  test('A an answered call whose settlement was lost is never asked again', () => {
    const w = world();
    const dir = brokerRecord(w, [row({ outcome: 'answered' })]);
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);

    // Settlement loses the lock: nothing is written, so the entry still reads as a reservation.
    const lock = pjoin(w.root, '.projectops/gatekeeper-ledger.lock');
    expect(w.sys.createExclusive(lock, 'held by another run')).toBe(true);
    settleGatekeeperSpend(w.sys, w.root, REQUEST.requestId, {
      requestId: REQUEST.requestId,
      projectId: REQUEST.projectId,
      phaseId: REQUEST.phaseId,
      model: REQUEST.model,
      usage: { inputTokens: 1200, outputTokens: 800 },
      costMicroUsd: 9100,
      at: REQUEST.at,
    });
    w.sys.removeFile(lock);
    expect(readLedger(w.sys, w.root)[0]?.unresolved).toBe(true);

    const retry = admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, () =>
      readBrokerAnsweredState(w.sys, dir, REQUEST),
    );

    expect(retry.allowed).toBe(false);
    expect(retry.reasons.join(' ')).toContain('already ANSWERED');
    expect(retry.reasons.join(' ')).toContain('settlement was lost');
  });

  /** [B] GENUINELY NEVER DISPATCHED. The broker reserved nothing, so the retry proceeds as before. */
  test('B a call the broker never reserved may still be retried', () => {
    const w = world();
    const dir = brokerRecord(w, []);
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);

    const retry = admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, () =>
      readBrokerAnsweredState(w.sys, dir, REQUEST),
    );

    expect(retry.allowed, retry.reasons.join(' | ')).toBe(true);
    expect(readLedger(w.sys, w.root)).toHaveLength(1);
    expect(monthTotal(w.sys, w.root)).toBe(8283);
  });

  /** [B2] Reserved but not answered is also a retry: the broker marks the row only on a reply. */
  test('B2 a reserved but unanswered row may be retried', () => {
    const w = world();
    const dir = brokerRecord(w, [row()]);
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);

    expect(readBrokerAnsweredState(w.sys, dir, REQUEST)).toBe('not-answered');
    expect(
      admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, () => readBrokerAnsweredState(w.sys, dir, REQUEST)).allowed,
    ).toBe(true);
  });

  /**
   * [C] THE RECORD CANNOT BE CONSULTED. Absent, unreadable, malformed, or no state directory at all.
   * Not knowing whether a reviewer has answered is exactly the state in which asking again is unsafe,
   * so every one of these refuses rather than assuming the convenient answer.
   */
  test('C an unreadable or absent installation record refuses the retry', () => {
    for (const [label, dir] of [
      ['no state directory', null],
      ['record absent', 'C:/nowhere-at-all'],
    ] as const) {
      const w = world();
      admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);
      const retry = admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, () =>
        readBrokerAnsweredState(w.sys, dir, REQUEST),
      );
      expect(retry.allowed, label).toBe(false);
      expect(retry.reasons.join(' '), label).toContain('could not be determined');
    }

    // Malformed, and shaped-but-wrong, are equally unknown.
    for (const bad of ['{not json', 'null', '[]', '{"calls":"nope"}']) {
      const w = world();
      const dir = pjoin(w.root, 'installation-state');
      mkdirSync(dir, { recursive: true });
      writeFileSync(pjoin(dir, BROKER_SPEND_FILE), bad);
      admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);
      expect(readBrokerAnsweredState(w.sys, dir, REQUEST), bad).toBe('unknown');
      expect(
        admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, () => readBrokerAnsweredState(w.sys, dir, REQUEST)).allowed,
        bad,
      ).toBe(false);
    }
  });

  /** [C2] Omitting the probe entirely is `unknown` too — the default may not be the convenient one. */
  test('C2 a caller that cannot consult the record is refused by default', () => {
    const w = world();
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);

    expect(admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET).allowed).toBe(false);
  });

  /** [C3] The row must match this request exactly; another project's answer is not this one's. */
  test('C3 an answered row for a different project or phase does not answer this request', () => {
    const w = world();
    const dir = brokerRecord(w, [
      row({ projectId: 'someone-else', outcome: 'answered' }),
      row({ phaseId: 'ANOTHER-PHASE1A', outcome: 'answered' }),
      row({ requestId: 'GKREQ-different', outcome: 'answered' }),
    ]);

    expect(readBrokerAnsweredState(w.sys, dir, REQUEST)).toBe('not-answered');
  });
  /**
   * [D] AN ENTRY WRITTEN BEFORE THIS CORRECTION EXISTED. It carries no mark, because nothing wrote
   * one then. It must not be mistaken for a completed call — that would bar its question for ever
   * with no way back except editing the ledger by hand. Recorded usage is what a real answer leaves
   * behind, and the broker still decides whether a reviewer answered.
   */
  test('D a pre-correction reservation is recognised as a reservation, not a completed call', () => {
    const w = world();
    const dir = brokerRecord(w, []);
    // Exactly what admission wrote before the mark existed: an estimate, and no usage.
    writeFileSync(
      pjoin(w.root, ...GATEKEEPER_LEDGER_REL.split('/')),
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          entries: [
            {
              requestId: REQUEST.requestId,
              projectId: REQUEST.projectId,
              phaseId: REQUEST.phaseId,
              model: REQUEST.model,
              usage: { inputTokens: 0, outputTokens: 0 },
              costMicroUsd: 8283,
              at: REQUEST.at,
            },
          ],
        },
        null,
        2,
      ),
    );

    const retry = admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, () =>
      readBrokerAnsweredState(w.sys, dir, REQUEST),
    );

    expect(retry.allowed, retry.reasons.join(' | ')).toBe(true);
    // And it is replaced by a properly marked one, so it self-heals rather than needing an edit.
    expect(readLedger(w.sys, w.root)).toHaveLength(1);
    expect(readLedger(w.sys, w.root)[0]?.unresolved).toBe(true);
    expect(monthTotal(w.sys, w.root)).toBe(8283);
  });

  /**
   * [D3] AND A PRE-CORRECTION RESERVATION CAN BE RELEASED. Without this the only way to clear a
   * charge for a call that provably never happened would be to edit the ledger by hand.
   */
  test('D3 a pre-correction reservation is released by a cause that proves nothing was sent', () => {
    const w = world();
    writeFileSync(
      pjoin(w.root, ...GATEKEEPER_LEDGER_REL.split('/')),
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          entries: [
            {
              requestId: REQUEST.requestId,
              projectId: REQUEST.projectId,
              phaseId: REQUEST.phaseId,
              model: REQUEST.model,
              usage: { inputTokens: 0, outputTokens: 0 },
              costMicroUsd: 8283,
              at: REQUEST.at,
            },
          ],
        },
        null,
        2,
      ),
    );

    resolveGatekeeperSpend(w.sys, w.root, REQUEST.requestId, 'TRANSPORT_NOT_APPROVED', NEVER_ANSWERED);

    expect(readLedger(w.sys, w.root)).toEqual([]);
    expect(monthTotal(w.sys, w.root)).toBe(0);
  });

  /** [D2] But an unmarked entry the broker says WAS answered is still refused. */
  test('D2 an unmarked entry the broker says was answered is still refused', () => {
    const w = world();
    const dir = brokerRecord(w, [row({ outcome: 'answered' })]);
    writeFileSync(
      pjoin(w.root, ...GATEKEEPER_LEDGER_REL.split('/')),
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          entries: [
            {
              requestId: REQUEST.requestId,
              projectId: REQUEST.projectId,
              phaseId: REQUEST.phaseId,
              model: REQUEST.model,
              usage: { inputTokens: 0, outputTokens: 0 },
              costMicroUsd: 8283,
              at: REQUEST.at,
            },
          ],
        },
        null,
        2,
      ),
    );

    const retry = admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, () =>
      readBrokerAnsweredState(w.sys, dir, REQUEST),
    );

    expect(retry.allowed).toBe(false);
    expect(retry.reasons.join(' ')).toContain('already ANSWERED');
  });
  /**
   * [D4] THE CAUSE DESCRIBES THIS ATTEMPT, NOT THE ENTRY. A reservation can outlive the attempt that
   * made it: an earlier call may have been dispatched and failed uncertainly, its cost retained, and
   * only then the project removed from the allowlist. The next attempt's cause is then a definite
   * no-dispatch one — and releasing on that alone would erase spend that may really have been
   * incurred. The installation's record has to agree that nothing was answered.
   */
  test('D4 a no-dispatch cause does not release an entry the installation says was answered', () => {
    const w = world();
    const dir = brokerRecord(w, [row({ outcome: 'answered' })]);
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);

    resolveGatekeeperSpend(w.sys, w.root, REQUEST.requestId, 'TRANSPORT_NOT_APPROVED', () =>
      readBrokerAnsweredState(w.sys, dir, REQUEST),
    );

    expect(readLedger(w.sys, w.root)).toHaveLength(1);
    expect(monthTotal(w.sys, w.root)).toBe(8283);
  });

  /** [D5] And an unreadable record retains too: losing a real charge is not the recoverable error. */
  test('D5 a no-dispatch cause does not release when the record cannot be read', () => {
    const w = world();
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);

    resolveGatekeeperSpend(w.sys, w.root, REQUEST.requestId, 'TRANSPORT_NOT_APPROVED');

    expect(readLedger(w.sys, w.root)).toHaveLength(1);
    expect(monthTotal(w.sys, w.root)).toBe(8283);
  });
});

/**
 * C11-W2-F9 — a reservation may be released by the attempt refusing it, before any dispatch.
 *
 * THE F7 RULE EXISTS FOR A CROSS-ATTEMPT AMBIGUITY: an entry still marked unresolved may be a call
 * that was answered and whose settlement was lost, so a RETRY defers to the installation's record.
 * That ambiguity does not exist at the moment an attempt is refused before anything can be sent —
 * and requiring the record there achieved nothing except stranding the charge for a call nobody made,
 * with no route to clear it that was not a hand-edit.
 */
describe('C11-W2-F9 — the same attempt may release what it is refusing pre-dispatch', () => {
  /** [1] The release itself: a bare reservation goes, with no broker record anywhere. */
  test('1 a pre-dispatch refusal releases its own zero-usage reservation without a broker record', () => {
    const w = world();
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);
    expect(monthTotal(w.sys, w.root)).toBe(8283);

    releaseUndispatchedReservation(w.sys, w.root, REQUEST.requestId);

    expect(readLedger(w.sys, w.root)).toEqual([]);
    expect(monthTotal(w.sys, w.root)).toBe(0);
  });

  /** [2] The cross-attempt rule is untouched: UNKNOWN still refuses a retry. */
  test('2 an unknown answered-state still refuses a retry', () => {
    const w = world();
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);

    const retry = admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET);

    expect(retry.allowed).toBe(false);
    expect(retry.reasons.join(' ')).toContain('could not be determined');
  });

  /** [3] And an answered call is still never re-asked. */
  test('3 an answered call is still refused', () => {
    const w = world();
    const dir = pjoin(w.root, 'installation-state');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      pjoin(dir, BROKER_SPEND_FILE),
      JSON.stringify(
        {
          calls: [
            { requestId: REQUEST.requestId, projectId: REQUEST.projectId, phaseId: REQUEST.phaseId, outcome: 'answered' },
          ],
        },
        null,
        2,
      ),
    );
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);

    const retry = admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, () =>
      readBrokerAnsweredState(w.sys, dir, REQUEST),
    );

    expect(retry.allowed).toBe(false);
    expect(retry.reasons.join(' ')).toContain('already ANSWERED');
  });

  /** [4] REAL SPEND IS UNTOUCHABLE. A call that happened is not this function's to erase, ever. */
  test('4 a settled call carrying real usage is never released', () => {
    const w = world();
    const settled: LedgerEntry = {
      requestId: REQUEST.requestId,
      projectId: REQUEST.projectId,
      phaseId: REQUEST.phaseId,
      model: REQUEST.model,
      usage: { inputTokens: 1200, outputTokens: 800 },
      costMicroUsd: 9100,
      at: REQUEST.at,
    };
    admitGatekeeperSpend(w.sys, w.root, REQUEST, BUDGET, NEVER_ANSWERED);
    settleGatekeeperSpend(w.sys, w.root, REQUEST.requestId, settled);

    releaseUndispatchedReservation(w.sys, w.root, REQUEST.requestId);

    expect(readLedger(w.sys, w.root)).toEqual([settled]);
    expect(monthTotal(w.sys, w.root)).toBe(9100);
  });
});
