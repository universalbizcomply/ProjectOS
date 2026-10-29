/**
 * Waiting for the owner, and resuming when they answer.
 *
 * WHAT WAS ACTUALLY MISSING. The owner-receipt mechanism was already complete: a deterministic gate
 * instance bound to phase, gate and subject commit; bytes read from the git object store rather than
 * the working tree; the implementer and every model name refused as the decider; replay refused both
 * by a spent marker and by an already-consumed list. Nothing in the runtime read it. So a phase that
 * reserved an action to the owner stopped for ever — the wait was durable and the RESUME did not
 * exist, however carefully the owner recorded their decision.
 *
 * These prove the five things that contract has to be true for: a routine decision does not reach the
 * owner at all, a protected one waits durably, a valid answer resumes, no answer resumes nothing, and
 * a stale, foreign or spent answer resumes nothing either.
 *
 * REAL REPOSITORIES AND REAL GIT throughout, because "committed" and "unchanged since committed" are
 * the whole of what makes a receipt count, and neither is observable in a fixture.
 *
 * Created in PROJECTOS-OWNER-ESCALATION-WAIT1A.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { nodeSystem, resolveBoundGit, type System } from '../src/system.js';
import { normaliseRemote } from '../src/loop/observation.js';
import { runLoop } from '../src/loop/runner.js';
import type { AdapterRegistry, WorkerAdapter } from '../src/loop/workers.js';
import {
  readCommittedReceipts,
  markOwnerReceiptConsumed,
  answeredOwnerGatesFromCommittedTree,
  consumeAnsweredOwnerGates,
} from '../src/loop/ownerGateReceipts.js';
import { decideContinuation } from '../src/loop/outcome.js';
import { STOP_ROUTES } from '../src/loop/gatekeeperRouting.js';
import { writeWorkRecord, readWorkRecord, beginWork, advanceWork } from '../src/loop/workRecord.js';
import { unsatisfiedOwnerGates, gateInstanceId, type OwnerGateReceipt } from '@projectos/core';
import type { WorkerBrief } from '../src/loop/brief.js';
import { reviewing, withReviewer } from './support/fakeReviewer.js';

const GIT = resolveBoundGit(process.env) as string;
const PHASE = 'E2E-OWNER-WAIT1A';
const OWNER = 'Murad';
const NOW = '2026-09-02T13:00:00Z';

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync(GIT, ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

/** A repository with one commit, so a receipt has a subject to be bound to. */
function repo(): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'projectos-ownerwait-'));
  made.push(root);
  git(root, 'init', '--quiet', '--initial-branch=work');
  git(root, 'config', 'user.email', 'e2e@example.invalid');
  git(root, 'config', 'user.name', 'ProjectOS E2E');
  mkdirSync(join(root, '.projectops', 'gates'), { recursive: true });
  writeFileSync(join(root, 'base.txt'), 'base\n');
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'base');
  return { root, head: git(root, 'rev-parse', 'HEAD').trim() };
}

/** The owner's decision, in the shape the runtime already checks. */
function receipt(over: Partial<Record<string, unknown>> & { subject: string }): Record<string, unknown> {
  const gate = String(over['gateName'] ?? 'commit');
  const phase = String(over['phaseId'] ?? PHASE);
  const { subject, ...rest } = over;
  return {
    schemaVersion: '1.0.0',
    decisionId: `${phase}-${gate}-OWNER-DECISION1A`,
    projectId: 'e2e',
    phaseId: phase,
    gateName: gate,
    gateInstanceId: gateInstanceId(phase, gate, subject),
    evidenceSubjectHead: subject,
    ownerChoice: 'APPROVE',
    decidedBy: OWNER,
    decidedAt: '2026-09-02',
    // The literal the checker requires. A receipt whose scope says anything else is not an
    // owner-gate receipt, whatever it otherwise contains.
    scope: 'owner-gate-only',
    note: 'owner decision recorded for the e2e proof',
    ...rest,
  };
}

/** Write a receipt and COMMIT it, which is the only form in which one counts. */
function commitReceipt(root: string, gate: string, record: Record<string, unknown>, phase = PHASE): void {
  const rel = `.projectops/gates/${phase}.${gate}.json`;
  writeFileSync(join(root, rel), `${JSON.stringify(record, null, 2)}\n`);
  git(root, 'add', '--', rel);
  git(root, 'commit', '--quiet', '-m', `owner decision for ${gate}`);
}

function expectations(subject: string, gates: readonly string[], consumed: readonly string[] = []) {
  return {
    projectId: 'e2e',
    phaseId: PHASE,
    requiredOwnerGates: gates,
    evidenceSubjectHead: subject,
    planOwner: OWNER,
    readFromCommittedTree: true,
    alreadyConsumedDecisionIds: consumed,
  };
}

/** A receipt's bytes as they now stand on disk, for any phase. */
function receiptOnDiskAt(root: string, phase: string, gate = 'commit'): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, `.projectops/gates/${phase}.${gate}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
}

/** What the runtime concludes about a phase's gates, from the committed tree. */
function outstanding(root: string, subject: string, gates: readonly string[], consumed: readonly string[] = []): readonly string[] {
  const receipts = readCommittedReceipts(nodeSystem, root, PHASE, gates);
  return unsatisfiedOwnerGates(receipts as ReadonlyMap<string, OwnerGateReceipt | null>, expectations(subject, gates, consumed));
}

/* ------------------------------------------------------------------------------------------------
 * PROOF A — a routine decision never reaches the owner.
 * --------------------------------------------------------------------------------------------- */

function brief(gates: readonly string[]): WorkerBrief {
  return {
    briefId: 'b1',
    phase: {
      phaseId: PHASE,
      description: 'proof',
      scope: '',
      dependsOn: [],
      acceptanceCriteria: ['x'],
      riskLevel: 'low',
      autonomyLevel: 'gated-execution',
      requiredValidators: [],
      requiredReviews: ['independent review'],
      requiredBrowserProof: false,
      requiredOwnerGates: gates,
    },
    repository: { head: 'a'.repeat(40) },
  } as unknown as WorkerBrief;
}

const PASS = { id: 'v', kind: 'test', command: 'x', passed: true, exitCode: 0, output: '' } as never;
const ATTESTED = {
  productionTouched: false,
  deploymentOccurred: false,
  databaseMutationOccurred: false,
  externalSendOccurred: false,
  paymentOccurred: false,
  rawSecretStored: false,
};

function decide(gates: readonly string[], answered: readonly string[] = []) {
  return decideContinuation({
    brief: brief(gates),
    checks: [PASS],
    findings: [],
    effects: ATTESTED,
    reviewsRecorded: ['independent review'],
    attemptsSpent: 0,
    workerRefusal: null,
    ownerGatesSatisfied: answered,
  });
}

describe('PROOF A — routine work does not wait for the owner', () => {
  it('a phase reserving only standing protections goes to the reviewer, not to Murad', () => {
    const d = decide(['secrets-handling', 'payment-or-live-charge']);
    expect(d.kind).toBe('stop');
    if (d.kind !== 'stop') throw new Error('unreachable');
    // The reviewer's question, not the owner's. Nobody is interrupted.
    expect(d.reason.code).toBe('CONTINUATION_READY');
  });

  it('a phase reserving nothing at all also goes to the reviewer', () => {
    const d = decide([]);
    expect(d.kind).toBe('stop');
    if (d.kind !== 'stop') throw new Error('unreachable');
    expect(d.reason.code).toBe('CONTINUATION_READY');
  });
});

/* ------------------------------------------------------------------------------------------------
 * PROOF B — a genuinely protected gate waits.
 * --------------------------------------------------------------------------------------------- */

describe('PROOF B — a protected owner gate waits, and nothing protected happens', () => {
  it('stops at OWNER_GATE naming only what is pending', () => {
    const d = decide(['commit', 'secrets-handling']);
    expect(d.kind).toBe('stop');
    if (d.kind !== 'stop') throw new Error('unreachable');
    expect(d.reason.code).toBe('OWNER_GATE');
    expect(d.reason.detail).toContain('commit');
    expect(d.reason.detail).not.toContain('secrets-handling');
  });

  // THE DURABLE HALF, AT THE TABLE THAT DECIDES IT. `OWNER_GATE` carries audience 'owner' and an
  // EMPTY verdict list, so the reviewer is never even asked and no verdict it could return would
  // satisfy the gate. That audience is what routes the stop to the `WAITING_OWNER` checkpoint write
  // in runner.ts — pre-existing behaviour this phase did not change, and asserted here at the one
  // place a future edit could quietly make the gate answerable by a model.
  it('no reviewer verdict can satisfy an owner gate, so the wait belongs to Murad alone', () => {
    expect(STOP_ROUTES.OWNER_GATE.audience).toBe('owner');
    expect(STOP_ROUTES.OWNER_GATE.applicableVerdicts).toEqual([]);
  });

  // THE WAIT OUTLIVES THE PROCESS THAT DECLARED IT. The record is on disk and carries `ownerRequired`
  // and the stop it ended on, so a later invocation learns that it was MURAD the run stopped on —
  // the fact a resume needs and could not previously recover from anywhere.
  it('WAITING_OWNER is written to disk and survives the process that wrote it', () => {
    const w = repo();
    const started = beginWork({ projectId: 'e2e', phaseId: PHASE, subjectCommit: w.head, at: NOW });
    writeWorkRecord(
      nodeSystem,
      w.root,
      advanceWork(
        started,
        {
          state: 'WAITING_OWNER',
          ownerRequired: true,
          lastStopCode: 'OWNER_GATE',
          lastStopDetail: "the plan reserves 'commit' to the owner",
        },
        NOW,
      ),
    );

    // A FRESH READ, from the bytes on disk: nothing in memory is consulted.
    const reread = readWorkRecord(nodeSystem, w.root);
    expect(reread.ok).toBe(true);
    if (!reread.ok) throw new Error('unreachable');
    expect(reread.value?.state).toBe('WAITING_OWNER');
    expect(reread.value?.ownerRequired).toBe(true);
    expect(reread.value?.lastStopCode).toBe('OWNER_GATE');
    expect(reread.value?.phaseId).toBe(PHASE);
    expect(reread.value?.subjectCommit).toBe(w.head);
  });

  it('and no receipt in the checkout means the gate is outstanding', () => {
    const w = repo();
    expect(outstanding(w.root, w.head, ['commit'])).toEqual(['commit']);
  });
});

/* ------------------------------------------------------------------------------------------------
 * PROOF C — the owner answers, and the work resumes.
 * --------------------------------------------------------------------------------------------- */

describe('PROOF C — a valid committed decision resumes the work, once', () => {
  it('satisfies the gate, and the loop stops treating it as pending', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head }));
    expect(outstanding(w.root, w.head, ['commit'])).toEqual([]);

    // The resume itself: the same decision that stopped at OWNER_GATE now continues.
    const d = decide(['commit'], ['commit']);
    expect(d.kind).toBe('stop');
    if (d.kind !== 'stop') throw new Error('unreachable');
    expect(d.reason.code).toBe('CONTINUATION_READY');
  });

  // THE WAIT SURVIVES THE PROCESS, because the receipt is in git and nothing in memory is consulted.
  it('a fresh read of the same checkout reaches the same conclusion', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head }));
    expect(outstanding(w.root, w.head, ['commit'])).toEqual([]);
    expect(outstanding(w.root, w.head, ['commit'])).toEqual([]);
  });

  it('is spent when relied on, and refused afterwards', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head }));
    expect(outstanding(w.root, w.head, ['commit'])).toEqual([]);

    const said = markOwnerReceiptConsumed(nodeSystem, w.root, PHASE, 'commit', NOW);
    expect(said.ok).toBe(true);
    expect(said.detail).toContain('spent');
    // TWO INDEPENDENT REFUSALS FROM ONE WRITE. The stamp makes the file differ from HEAD, so it is no
    // longer "committed and unchanged"; and were the owner to commit the stamped form, the spent
    // marker refuses it again.
    expect(outstanding(w.root, w.head, ['commit'])).toEqual(['commit']);
    git(w.root, 'add', '--all');
    git(w.root, 'commit', '--quiet', '-m', 'record the spend');
    expect(outstanding(w.root, w.head, ['commit'])).toEqual(['commit']);
    expect(String(JSON.parse(readFileSync(join(w.root, `.projectops/gates/${PHASE}.commit.json`), 'utf8')).consumedAt)).toBe(NOW);
  });

  // READING IS PURE. The reader is what the consuming path is built on, and it must be safe to ask
  // it the same question repeatedly — a run under correction does exactly that. Spending is a
  // separate act, taken only when the owner gate is what actually stands in the way.
  it('reading the answer repeatedly never spends it', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head }));
    const read = () =>
      answeredOwnerGatesFromCommittedTree(nodeSystem, w.root, {
        projectId: 'e2e',
        phaseId: PHASE,
        requiredOwnerGates: ['commit'],
        evidenceSubjectHead: w.head,
        planOwner: OWNER,
        alreadyConsumedDecisionIds: [],
      });

    // Three attempts' worth of evaluation, as a run under correction would do.
    expect(read().map((a) => a.gate)).toEqual(['commit']);
    expect(read().map((a) => a.gate)).toEqual(['commit']);
    expect(read().map((a) => a.gate)).toEqual(['commit']);

    // Nothing was written: the receipt is still committed, still clean, still unspent.
    expect(git(w.root, 'status', '--porcelain').trim()).toBe('');
    expect(JSON.parse(readFileSync(join(w.root, `.projectops/gates/${PHASE}.commit.json`), 'utf8')).consumedAt)
      .toBeUndefined();
    expect(outstanding(w.root, w.head, ['commit'])).toEqual([]);
  });

  // A SPEND THAT CANNOT BE WRITTEN IS REPORTED, NEVER THROWN, so the caller can refuse the passage
  // rather than die holding it. `ok` is what the caller acts on; the prose only says why.
  it('an unwritable checkout is reported, not thrown', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head }));
    const refusing = {
      ...nodeSystem,
      writeText: () => {
        throw new Error('EROFS: read-only file system');
      },
    };
    const said = markOwnerReceiptConsumed(refusing, w.root, PHASE, 'commit', NOW);
    expect(said.ok).toBe(false);
    expect(said.detail).toContain('NOT spent');
    expect(said.detail).toContain('EROFS');
    // And it did not silently claim the spend: the receipt is untouched and still answers.
    expect(outstanding(w.root, w.head, ['commit'])).toEqual([]);
  });

  /* ----------------------------------------------------------------------------------------------
   * THE GATEKEEPER'S HIGH FINDING. An owner decision is single-use authority. The first wiring
   * satisfied the gate and spent the receipt afterwards, reporting a failed spend and resuming
   * anyway — so a passage could be taken that nothing durable recorded as taken, and a restart could
   * take it again. Consumption is now a PRECONDITION of satisfaction.
   * ------------------------------------------------------------------------------------------- */

  const binding = (root: string, head: string, gates: readonly string[] = ['commit'], spent: readonly string[] = []) => ({
    projectId: 'e2e',
    phaseId: PHASE,
    requiredOwnerGates: gates,
    evidenceSubjectHead: head,
    planOwner: OWNER,
    alreadyConsumedDecisionIds: spent,
  });

  // PROOF A — the spend succeeds, so the passage is granted, and only once.
  it('a provable spend grants the passage, and the receipt cannot buy a second', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head }));

    const first = consumeAnsweredOwnerGates(nodeSystem, w.root, binding(w.root, w.head), NOW);
    expect(first.satisfied.map((x) => x.gate)).toEqual(['commit']);
    expect(first.refusals).toEqual([]);
    // Durably spent: the bytes say so, and the receipt has stopped counting.
    expect(JSON.parse(readFileSync(join(w.root, `.projectops/gates/${PHASE}.commit.json`), 'utf8')).consumedAt).toBe(NOW);
    expect(outstanding(w.root, w.head, ['commit'])).toEqual(['commit']);

    // A second attempt buys nothing, in this process or any other.
    const second = consumeAnsweredOwnerGates(nodeSystem, w.root, binding(w.root, w.head), NOW);
    expect(second.satisfied).toEqual([]);
  });

  // PROOF B — the spend cannot be written, so the passage is REFUSED.
  it('a spend that cannot be written grants nothing and leaves the gate standing', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head }));
    const refusing = {
      ...nodeSystem,
      writeText: () => {
        throw new Error('EROFS: read-only file system');
      },
    };

    const out = consumeAnsweredOwnerGates(refusing, w.root, binding(w.root, w.head), NOW);
    // NO PASSAGE. This is the whole finding: the gate is not satisfied, so the loop still stops on
    // the owner and no owner-approved continuation can follow.
    expect(out.satisfied).toEqual([]);
    expect(out.refusals).toHaveLength(1);
    expect(out.refusals[0]).toContain("owner gate 'commit' NOT satisfied");
    expect(out.refusals[0]).toContain('EROFS');
    // AND THE OWNER LOSES NOTHING. The receipt is untouched, so it still answers once the checkout
    // is writable — a failed spend costs a run, never an authority.
    expect(git(w.root, 'status', '--porcelain').trim()).toBe('');
    expect(outstanding(w.root, w.head, ['commit'])).toEqual([]);
  });

  // PROOF B2 — a write that silently does nothing is refused too. `ok` is proven, not assumed.
  it('a spend that is silently dropped is refused, because the stamp is read back', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head }));
    const pretending = { ...nodeSystem, writeText: () => undefined };

    const out = consumeAnsweredOwnerGates(pretending, w.root, binding(w.root, w.head), NOW);
    expect(out.satisfied).toEqual([]);
    expect(out.refusals[0]).toContain('does not carry the spend after writing');
  });

  // PROOF C — a restart after a failed spend takes no unsafe passage either.
  it('a restart after a failed spend still grants nothing until the spend actually holds', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head }));
    const refusing = {
      ...nodeSystem,
      writeText: () => {
        throw new Error('EROFS: read-only file system');
      },
    };

    // Three separate "processes", each starting from the committed tree and nothing else.
    expect(consumeAnsweredOwnerGates(refusing, w.root, binding(w.root, w.head), NOW).satisfied).toEqual([]);
    expect(consumeAnsweredOwnerGates(refusing, w.root, binding(w.root, w.head), NOW).satisfied).toEqual([]);
    expect(consumeAnsweredOwnerGates(refusing, w.root, binding(w.root, w.head), NOW).satisfied).toEqual([]);
    expect(JSON.parse(readFileSync(join(w.root, `.projectops/gates/${PHASE}.commit.json`), 'utf8')).consumedAt)
      .toBeUndefined();

    // Then the checkout becomes writable: EXACTLY ONE passage, and never another.
    expect(consumeAnsweredOwnerGates(nodeSystem, w.root, binding(w.root, w.head), NOW).satisfied.map((x) => x.gate))
      .toEqual(['commit']);
    expect(consumeAnsweredOwnerGates(nodeSystem, w.root, binding(w.root, w.head), NOW).satisfied).toEqual([]);
  });

  /* ----------------------------------------------------------------------------------------------
   * CONCURRENCY. Proving a write happened is not the same as being the only writer: two processes
   * that each read the clean receipt before either wrote would both pass every check and both hold a
   * proven spend of one single-use decision. Raised as HIGH by the mandated security review.
   * ------------------------------------------------------------------------------------------- */

  it('refuses to spend while another process holds the lock', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head }));
    // Another process got there first and is mid-spend.
    writeFileSync(join(w.root, `.projectops/gates/${PHASE}.commit.json.lock`), 'held by someone else\n');

    const out = consumeAnsweredOwnerGates(nodeSystem, w.root, binding(w.root, w.head), NOW);
    expect(out.satisfied).toEqual([]);
    expect(out.refusals[0]).toContain('already being spent by another process');
    // Nothing was written, so the receipt survives for whoever legitimately holds the lock.
    expect(receiptOnDiskAt(w.root, PHASE)['consumedAt']).toBeUndefined();
  });

  // THE ORDER IS THE FIX. A `consumedAt` check made BEFORE the lock is a check against a file another
  // process may already have stamped, which is precisely how both racers pass. This asserts the read
  // happens after the lock is taken, which no assertion about the outcome alone can establish.
  it('takes the lock before it reads the receipt', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head }));
    const order: string[] = [];
    const watched = {
      ...nodeSystem,
      createExclusive: (p: string, c: string) => {
        if (p.endsWith('.lock')) order.push('lock');
        return nodeSystem.createExclusive(p, c);
      },
      readText: (p: string) => {
        if (p.endsWith(`${PHASE}.commit.json`)) order.push('read');
        return nodeSystem.readText(p);
      },
      removeFile: (p: string) => {
        if (p.endsWith('.lock')) order.push('unlock');
        return nodeSystem.removeFile(p);
      },
    };

    const out = consumeAnsweredOwnerGates(watched, w.root, binding(w.root, w.head), NOW);
    expect(out.satisfied.map((x) => x.gate)).toEqual(['commit']);
    expect(order[0]).toBe('lock');
    expect(order).toContain('read');
    expect(order[order.length - 1]).toBe('unlock');
    // Released even so — the next legitimate holder is not shut out by a completed spend.
    expect(existsSync(join(w.root, `.projectops/gates/${PHASE}.commit.json.lock`))).toBe(false);
  });

  it('the runner cannot satisfy a gate except through the consuming path', () => {
    const runner = readFileSync(new URL('../src/loop/runner.ts', import.meta.url), 'utf8');
    const start = runner.indexOf('const payForPendingOwnerGates =');
    expect(start).toBeGreaterThan(-1);
    const body = runner.slice(start, runner.indexOf('return satisfied.length > 0;', start));
    // ONE ROUTE, AND IT IS THE ONE THAT PAYS. The only way the loop reaches an owner receipt is
    // through `consumeAnsweredOwnerGates`, which spends before it satisfies; the pure reader is not
    // reachable from here, so no edit can satisfy a gate while skipping the spend silently.
    expect(body).toContain('consumeAnsweredOwnerGates(');
    expect(body).not.toContain('answeredOwnerGatesFromCommittedTree(');
    // AND IT IS ONLY EVER CALLED WHEN THE OWNER GATE IS THE DECISION. Evaluating it as an argument
    // to `decideContinuation` is what spent a receipt on turns that were about to retry.
    expect(runner).toContain(
      "decision.reason.code === 'OWNER_GATE' && payForPendingOwnerGates()",
    );
  });
});

/* ------------------------------------------------------------------------------------------------
 * PROOF D — no decision, no resume.
 * --------------------------------------------------------------------------------------------- */

describe('PROOF D — without a valid decision nothing protected proceeds', () => {
  it('an UNCOMMITTED receipt grants nothing, however complete it looks', () => {
    const w = repo();
    const rel = `.projectops/gates/${PHASE}.commit.json`;
    writeFileSync(join(w.root, rel), `${JSON.stringify(receipt({ subject: w.head }), null, 2)}\n`);
    // Written, never committed: it has not passed the owner's own commit gate.
    expect(outstanding(w.root, w.head, ['commit'])).toEqual(['commit']);
  });

  it('a receipt EDITED after being committed grants nothing', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head }));
    expect(outstanding(w.root, w.head, ['commit'])).toEqual([]);
    // The committed version must not be able to launder a working-tree change.
    writeFileSync(join(w.root, `.projectops/gates/${PHASE}.commit.json`), '{"ownerChoice":"APPROVE"}\n');
    expect(outstanding(w.root, w.head, ['commit'])).toEqual(['commit']);
  });

  it('a REFUSAL is not an approval', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head, ownerChoice: 'REFUSE' }));
    expect(outstanding(w.root, w.head, ['commit'])).toEqual(['commit']);
  });
});

/* ------------------------------------------------------------------------------------------------
 * PROOF E — stale, foreign and spent decisions are refused.
 * --------------------------------------------------------------------------------------------- */

describe('PROOF E — a decision that is not about THIS is refused', () => {
  it('a receipt bound to another SUBJECT cannot answer today', () => {
    const w = repo();
    const stale = 'f'.repeat(40);
    commitReceipt(w.root, 'commit', receipt({ subject: stale }));
    expect(outstanding(w.root, w.head, ['commit'])).toEqual(['commit']);
  });

  it('a receipt for another PROJECT cannot answer', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head, projectId: 'polygo' }));
    expect(outstanding(w.root, w.head, ['commit'])).toEqual(['commit']);
  });

  it('a receipt for another PHASE cannot answer', () => {
    const w = repo();
    // Committed at THIS phase's path, but claiming another phase inside.
    commitReceipt(w.root, 'commit', receipt({ subject: w.head, phaseId: 'SOME-OTHER-PHASE1A' }));
    expect(outstanding(w.root, w.head, ['commit'])).toEqual(['commit']);
  });

  it('a receipt for another GATE cannot answer this one', () => {
    const w = repo();
    commitReceipt(w.root, 'commit', receipt({ subject: w.head, gateName: 'push' }));
    expect(outstanding(w.root, w.head, ['commit'])).toEqual(['commit']);
  });

  it('an ALREADY CONSUMED decision id is refused on a later run', () => {
    const w = repo();
    const r = receipt({ subject: w.head });
    commitReceipt(w.root, 'commit', r);
    expect(outstanding(w.root, w.head, ['commit'])).toEqual([]);
    expect(outstanding(w.root, w.head, ['commit'], [String(r['decisionId'])])).toEqual(['commit']);
  });

  // NEITHER THE IMPLEMENTER NOR A MODEL IS THE OWNER. This is the line the owner's delegation of
  // routine decisions must never cross, and it is enforced on the record itself.
  it.each(['Claude', 'Claude Code', 'ChatGPT', 'the gatekeeper', 'OpenAI'])(
    'a receipt decided by %s is refused',
    (who) => {
      const w = repo();
      commitReceipt(w.root, 'commit', receipt({ subject: w.head, decidedBy: who }));
      expect(outstanding(w.root, w.head, ['commit'])).toEqual(['commit']);
    },
  );

  // ONE DECISION, ONE GATE. Both receipts are otherwise valid and each is correctly bound to its own
  // gate; they differ only in sharing a decisionId. The second is refused because the first already
  // used it in this same pass — the invariant `alreadyConsumedDecisionIds` exists for, which held
  // only by accident while the reader judged every gate against an empty list.
  it('one decision id cannot answer two gates in a single pass', () => {
    const w = repo();
    const shared = 'SHARED-OWNER-DECISION1A';
    commitReceipt(w.root, 'commit', receipt({ subject: w.head, decisionId: shared }));
    commitReceipt(w.root, 'push', receipt({ subject: w.head, gateName: 'push', decisionId: shared }));

    const answered = answeredOwnerGatesFromCommittedTree(nodeSystem, w.root, {
      projectId: 'e2e',
      phaseId: PHASE,
      requiredOwnerGates: ['commit', 'push'],
      evidenceSubjectHead: w.head,
      planOwner: OWNER,
      alreadyConsumedDecisionIds: [],
    });
    expect(answered.map((a) => a.gate)).toEqual(['commit']);

    // And with distinct ids, as a real owner would record them, both answer.
    const w2 = repo();
    commitReceipt(w2.root, 'commit', receipt({ subject: w2.head }));
    commitReceipt(w2.root, 'push', receipt({ subject: w2.head, gateName: 'push' }));
    const both = answeredOwnerGatesFromCommittedTree(nodeSystem, w2.root, {
      projectId: 'e2e',
      phaseId: PHASE,
      requiredOwnerGates: ['commit', 'push'],
      evidenceSubjectHead: w2.head,
      planOwner: OWNER,
      alreadyConsumedDecisionIds: [],
    });
    expect(both.map((a) => a.gate)).toEqual(['commit', 'push']);
  });

  it('a spent receipt cannot be revived by re-committing it without the marker', () => {
    const w = repo();
    const r = receipt({ subject: w.head, consumedAt: '2026-09-01T00:00:00Z' });
    commitReceipt(w.root, 'commit', r);
    expect(outstanding(w.root, w.head, ['commit'])).toEqual(['commit']);
  });
});

/* ================================================================================================
 * CANONICAL INTEGRATION PROOFS — through runLoop, not through helpers.
 *
 * WHY THESE HAD TO EXIST. Everything above proves the pieces, and the pieces were right while the
 * SEAM was wrong twice over. The exact-source review found both, and neither was reachable by a
 * helper test: the first because a helper is handed a subject by the test rather than deriving one,
 * the second because a helper is called directly rather than in the order the loop calls it.
 *
 *   1. A receipt binds to the subject at which OWNER_GATE was raised, and counts only once
 *      COMMITTED — but committing it MOVES HEAD. The next run compared the receipt against the new
 *      head and discarded it as stale, so recording an owner decision was what destroyed it. The
 *      helper tests missed this by capturing the head BEFORE writing the receipt and passing that
 *      value back in by hand, which is exactly the step production does not perform.
 *
 *   2. The receipt was consumed while building the ARGUMENTS to `decideContinuation`, so it was
 *      spent before that function had decided anything — including on turns that were about to
 *      retry a failing check. Single-use authority spent on a passage never taken.
 *
 * NO GATEKEEPER FIXTURE. An owner gate is routed to the owner with an empty verdict list, so the
 * reviewer is never consulted; the run simply ends on the stop. That keeps this harness small.
 * ============================================================================================= */

const INT_PHASE = 'E2E-OWNER-RESUME1A';
const BRANCH = 'work';
const WORKER_KIND = 'test-worker';

interface Governed {
  readonly root: string;
  readonly origin: string;
  readonly head: string;
}

/** A governed project whose one phase reserves `commit` to the owner. */
function governed(over: { validatorFails?: boolean } = {}): Governed {
  const origin = mkdtempSync(join(tmpdir(), 'projectos-ownerresume-origin-'));
  const root = mkdtempSync(join(tmpdir(), 'projectos-ownerresume-work-'));
  made.push(origin, root);
  execFileSync(GIT, ['init', '--quiet', '--bare', `--initial-branch=${BRANCH}`, origin], { stdio: 'pipe' });
  git(root, 'init', '--quiet', `--initial-branch=${BRANCH}`);
  git(root, 'config', 'user.email', 'e2e@example.invalid');
  git(root, 'config', 'user.name', 'ProjectOS E2E');

  const config = {
    schemaVersion: '1.0.0',
    projectId: 'e2e',
    projectName: 'E2E',
    repo: normaliseRemote(origin),
    localPath: root,
    projectType: 'tooling',
    owner: OWNER,
    protectedBranches: ['main'],
    productionFreeze: true,
    installStatus: 'not-installed',
    approvalGates: ['owner-review'],
    validators: ['validate-all'],
    evidenceRequirements: ['evidence-pack'],
    planMemory: { planPath: 'state/plan.json', currentStatePath: 'state/current.json' },
    planSources: ['state/plan.json'],
    allowedActions: ['inspect-repository', 'create-local-files', 'run-local-validation'],
    forbiddenActions: ['production-deploy'],
    secretsPolicy: { allowSecretsInRepo: false, redactionRequired: true },
    execution: withReviewer({ workers: [{ workerId: 'test', kind: WORKER_KIND, command: '/usr/local/bin/test-worker' }] }, WORKER_KIND),
  };
  // DERIVED FROM THE REAL PLAN. The readiness evaluator checks far more than the schema, and a
  // hand-built fixture would encode its rules a second time, where they rot silently.
  const realPlan = JSON.parse(
    readFileSync(new URL('../../../.projectops/plan-98675c78dc8b3175-786d909d1ccb.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const plan = {
    ...realPlan,
    projectId: 'e2e',
    projectName: 'E2E',
    programmeId: 'e2e-programme',
    planId: 'plan-e2e',
    repository: {
      ...(realPlan['repository'] as Record<string, unknown>),
      repositoryPath: root,
      expectedRemote: normaliseRemote(origin),
      protectedBranches: ['main'],
      planSourceBranch: BRANCH,
    },
    phases: [
      {
        ...((realPlan['phases'] as Record<string, unknown>[])[0] as Record<string, unknown>),
        phaseId: INT_PHASE,
        description: 'prove the owner wait resumes',
        scope: '',
        dependsOn: [],
        requiredReviews: ['independent review'],
        requiredBrowserProof: false,
        // THE POINT OF THE FIXTURE: a technical action reserved to the owner.
        requiredOwnerGates: ['commit'],
      },
    ],
    governance: {
      ...(realPlan['governance'] as Record<string, unknown>),
      owner: OWNER,
      gatekeeper: 'ChatGPT',
      closureAuthority: 'ChatGPT',
    },
  } as Record<string, unknown>;
  delete (plan as { governance?: Record<string, unknown> }).governance?.['closureDelegation'];

  mkdirSync(join(root, 'projectos', 'validators'), { recursive: true });
  // THE VALIDATOR JUDGES A FILE, it is not itself the switch: validators run from the phase's base
  // commit (FINISH-WRITEPATHS1A), so editing the validator in the working tree changes nothing.
  writeFileSync(join(root, 'projectos', 'validators', 'validate-all.cjs'), FIXTURE_VALIDATOR);
  writeFileSync(join(root, 'check-state.txt'), over.validatorFails === true ? 'FAIL\n' : 'PASS\n');
  mkdirSync(join(root, '.projectops', 'gates'), { recursive: true });
  mkdirSync(join(root, '.projectops', 'phases'), { recursive: true });
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(join(root, '.projectops', 'project-config.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, 'state', 'plan.json'), JSON.stringify(plan, null, 2));
  writeFileSync(
    join(root, 'state', 'current.json'),
    JSON.stringify({ completedPhases: [], activePhase: INT_PHASE }, null, 2),
  );
  writeFileSync(
    join(root, '.projectops', 'phases', `${INT_PHASE}.json`),
    JSON.stringify(
      { schemaVersion: '1.0.0', phaseId: INT_PHASE, status: 'implementing', objective: 'prove the resume', history: [] },
      null,
      2,
    ),
  );

  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'governed fixture');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '--quiet', 'origin', `${BRANCH}:${BRANCH}`);
  return { root, origin, head: git(root, 'rev-parse', 'HEAD').trim() };
}

/**
 * A worker that leaves a truthful attestation and no findings, and spawns nothing.
 *
 * The session id is derived by the loop, and the worker's records have to be named with it. Deriving
 * it here would duplicate the loop's own logic in a test, so the adapter is handed a late-bound
 * getter and a dry run supplies the value — the same shape the B6 end-to-end fixture uses.
 */
function adapter(root: string, sessionOf: () => string): AdapterRegistry {
  const write = () => {
    const session = sessionOf();
    const dir = join(root, '.projectops', 'execution');
    mkdirSync(dir, { recursive: true });
    if (session !== '') {
      writeFileSync(join(dir, `${session}.findings.json`), JSON.stringify({ reviews: ['independent review'], findings: [] })); // D11-C1: see continuationEndToEnd
      writeFileSync(
        join(dir, `${session}.effects.json`),
        JSON.stringify({
          productionTouched: false,
          deploymentOccurred: false,
          databaseMutationOccurred: false,
          externalSendOccurred: false,
          paymentOccurred: false,
          rawSecretStored: false,
        }),
      );
    }
    return { kind: 'completed', exitCode: 0, stdout: '', stderr: '', providerRef: 'ref-1' };
  };
  const a = { kind: WORKER_KIND, ...reviewing(), start: write, rejoin: write } as unknown as WorkerAdapter;
  return { [WORKER_KIND]: a } as unknown as AdapterRegistry;
}

const INVOCATION = { pid: 4242, ppid: 1717, argv: ['node', 'projectos.js', 'run', '--execute'], cwd: '' };

/**
 * One invocation, wired the way `run.ts` wires it: the loop REPORTS state and the caller PERSISTS
 * it. That persistence is what a later invocation recovers the waiting subject from, so leaving it
 * out would prove the resume against a record production writes and this test did not.
 */
function invoke(root: string, sysOver: Partial<System> = {}): { stop: string | null; lines: readonly string[] } {
  const sys: System = { ...nodeSystem, now: () => NOW, ...sysOver };
  let session = '';
  const adapters = adapter(root, () => session);
  // A dry run first, only to learn the session id the real run will use.
  const dry = runLoop(sys, root, { dryRun: true, adapters, invocation: { ...INVOCATION, cwd: root } });
  session = String((dry as { sessionId?: string }).sessionId ?? '');

  let work: ReturnType<typeof beginWork> | null = null;
  const result = runLoop(sys, root, {
    adapters,
    invocation: { ...INVOCATION, cwd: root },
    onWorkState: (progress) => {
      const at = sys.now();
      if (work === null || work.phaseId !== progress.phaseId) {
        work = beginWork({
          projectId: 'e2e',
          phaseId: progress.phaseId,
          subjectCommit: progress.subjectCommit ?? null,
          at,
        });
      }
      const { state, phaseId: _p, ...rest } = progress;
      work = advanceWork(work, { state, ...rest }, at);
      writeWorkRecord(sys, root, work);
    },
  });
  // `stop` lives only on the success shape. A REFUSED run flattened to `stop: null` would make the
  // three `.not.toBe('OWNER_GATE')` proofs below pass on a run that never reached the gate at all,
  // so the refusal is raised here rather than answered.
  if (!result.ok) throw new Error('the loop refused before it could reach a stop: ' + result.lines.join(' | '));
  return { stop: result.stop?.code ?? null, lines: result.lines };
}

/**
 * Make the phase's required validator fail, WITHOUT committing.
 *
 * Committing would move HEAD and supersede the recorded wait, which is a different behaviour from
 * the one under test: here the receipt must remain valid and genuinely spendable at the subject the
 * run recovers, so that not spending it is a real refusal rather than an accident of staleness.
 */
/** The committed fixture validator: it passes exactly when `check-state.txt` says PASS. */
const FIXTURE_VALIDATOR = [
  'const fs = require("fs");',
  'const path = require("path");',
  'const state = fs.readFileSync(path.join(__dirname, "..", "..", "check-state.txt"), "utf8").trim();',
  'if (state !== "PASS") { console.log("validate-all: fixture FAIL"); process.exit(1); }',
  'console.log("validate-all: fixture PASS");',
].join("\n");

/** Make the checked subject fail, without moving the repository on. */
function breakTheValidator(root: string): void {
  writeFileSync(join(root, 'check-state.txt'), 'FAIL\n');
}

/** ...and repair it, equally without moving the repository on. */
function fixTheValidator(root: string): void {
  writeFileSync(join(root, 'check-state.txt'), 'PASS\n');
}

/** The owner records their decision at the subject the run stopped on, and COMMITS it. */
function ownerAnswers(root: string, subject: string, gate = 'commit'): void {
  const rel = `.projectops/gates/${INT_PHASE}.${gate}.json`;
  writeFileSync(
    join(root, rel),
    `${JSON.stringify(receipt({ subject, phaseId: INT_PHASE, gateName: gate }), null, 2)}\n`,
  );
  git(root, 'add', '--', rel);
  git(root, 'commit', '--quiet', '-m', `owner decision for ${gate}`);
}

function receiptOnDisk(root: string, gate = 'commit'): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, `.projectops/gates/${INT_PHASE}.${gate}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
}

function recordedSubject(root: string): string {
  const read = readWorkRecord(nodeSystem, root);
  if (!read.ok) throw new Error('the work record was not readable');
  return read.value?.subjectCommit ?? '';
}

describe('INTEGRATION — the owner wait resumes through the real loop', () => {
  // HIGH 1. The receipt's own commit moves HEAD, and the resume must survive that.
  it('resumes against the subject the wait was recorded at, though the receipt commit moved HEAD', () => {
    const w = governed();

    // RUN 1 — reaches the owner gate at subject A and records the wait durably.
    const first = invoke(w.root);
    expect(first.stop).toBe('OWNER_GATE');
    const read = readWorkRecord(nodeSystem, w.root);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error('unreachable');
    // THE WAIT, DURABLY RECORDED. `state` is `WAITING_OWNER` when a reviewer is configured and
    // `BLOCKED` when none is; both carry the stop that names the wait and the subject it waits at,
    // which is what the resume recovers.
    expect(read.value?.lastStopCode).toBe('OWNER_GATE');
    expect(read.value?.ownerRequired).toBe(true);
    const subjectA = recordedSubject(w.root);
    expect(subjectA).not.toBe('');

    // THE OWNER ANSWERS, and the act of committing the answer moves the repository on.
    ownerAnswers(w.root, subjectA);
    const headB = git(w.root, 'rev-parse', 'HEAD').trim();
    expect(headB).not.toBe(subjectA);

    // RUN 2 — a fresh invocation, reading only what is on disk. The gate lifts.
    const second = invoke(w.root);
    expect(second.stop).not.toBe('OWNER_GATE');
    expect(second.lines.join('\n')).toContain(`resuming the owner wait recorded at ${subjectA}`);
    // And the decision was spent exactly once, provably.
    expect(receiptOnDisk(w.root)['consumedAt']).toBe(NOW);
  });

  // HIGH 2. A turn that is going to stop for something else must not spend the owner's decision.
  //
  // THE RECEIPT HERE IS GENUINELY SPENDABLE. An earlier version of this proof passed against the
  // broken code too, because the receipt it wrote was bound to a subject the run never used — so
  // nothing was consumed for a reason that had nothing to do with the finding. The owner gate is
  // reached and answered FIRST, so the receipt is valid, unspent and consumable at the subject the
  // run recovers; only then is a failing check introduced.
  it('does not spend a spendable receipt on a turn whose checks are failing', () => {
    const w = governed();
    expect(invoke(w.root).stop).toBe('OWNER_GATE');
    const subjectA = recordedSubject(w.root);
    ownerAnswers(w.root, subjectA);

    // The receipt is now valid, unspent, and SPENDABLE at the subject this run recovers — proven by
    // the fact that the very next green run spends it, below. Only then is a check made to fail.
    breakTheValidator(w.root);
    const failing = invoke(w.root);
    expect(failing.stop).toBe('CORRECTION_EXHAUSTED');
    // THE WHOLE FINDING: single-use authority survives a turn that took no passage. Before the fix,
    // the receipt was consumed while building the arguments to `decideContinuation`, so this turn —
    // which never reached the owner gate at all — spent Murad's decision on nothing.
    expect(receiptOnDisk(w.root)['consumedAt']).toBeUndefined();
    expect(git(w.root, 'diff', '--name-only', 'HEAD', '--', `.projectops/gates/${INT_PHASE}.commit.json`).trim()).toBe('');

    // AND THE OWNER LOSES NOTHING. The failing turn superseded the recorded wait, so the loop asks
    // again at the subject it is now at — and the moment the owner gate is genuinely what stands in
    // the way, a receipt is spent exactly once.
    fixTheValidator(w.root);
    expect(invoke(w.root).stop).toBe('OWNER_GATE');
    ownerAnswers(w.root, recordedSubject(w.root), 'commit');
    expect(invoke(w.root).stop).not.toBe('OWNER_GATE');
    expect(receiptOnDisk(w.root)['consumedAt']).toBe(NOW);
  });

  /* ----------------------------------------------------------------------------------------------
   * STALE OWNER AUTHORITY. Requiring only that the recorded subject be an ANCESTOR of the live head
   * was too permissive: after the receipt commit B, any unrelated later commit C still has A as an
   * ancestor and the receipt is still committed and unchanged — so an approval of A could be spent
   * on work that had moved on without the owner ever seeing it. The relationship is now exact.
   * ------------------------------------------------------------------------------------------- */

  // PROOF 2 — an unrelated commit after the owner's answer voids the resume.
  it('refuses a receipt once HEAD has advanced past the commit that carried it', () => {
    const w = governed();
    expect(invoke(w.root).stop).toBe('OWNER_GATE');
    const subjectA = recordedSubject(w.root);
    ownerAnswers(w.root, subjectA);
    const commitB = git(w.root, 'rev-parse', 'HEAD').trim();

    // C — unrelated work, committed on top of the owner's answer.
    writeFileSync(join(w.root, 'unrelated.txt'), 'work the owner never saw\n');
    git(w.root, 'add', '--all');
    git(w.root, 'commit', '--quiet', '-m', 'unrelated later work');
    const commitC = git(w.root, 'rev-parse', 'HEAD').trim();
    expect(commitC).not.toBe(commitB);
    // A IS STILL AN ANCESTOR OF C, which is exactly why ancestry was not enough.
    expect(() => git(w.root, 'merge-base', '--is-ancestor', subjectA, commitC)).not.toThrow();

    const after = invoke(w.root);
    expect(after.stop).toBe('OWNER_GATE');
    expect(receiptOnDisk(w.root)['consumedAt']).toBeUndefined();
    expect(after.lines.join('\n')).not.toContain('resuming the owner wait recorded at');
  });

  // PROOF 3 — the head carries the receipt, but its parent is NOT the subject the wait recorded.
  //
  // This is the case ancestry cannot catch and the parent check exists for. The receipt is still
  // committed, still unchanged, still bound to A, and the live head is still the commit that most
  // recently touched it — yet unrelated work sits between A and that commit, so the owner approved
  // evidence the repository has since moved past.
  it('refuses when the head carrying the receipt is not a child of the recorded subject', () => {
    const w = governed();
    expect(invoke(w.root).stop).toBe('OWNER_GATE');
    const subjectA = recordedSubject(w.root);
    ownerAnswers(w.root, subjectA);

    // Unrelated work on top of the owner's answer...
    writeFileSync(join(w.root, 'unrelated.txt'), 'work the owner never saw\n');
    git(w.root, 'add', '--all');
    git(w.root, 'commit', '--quiet', '-m', 'unrelated later work');

    // ...and then the receipt path is touched again, so the head DOES carry it.
    const rel = `.projectops/gates/${INT_PHASE}.commit.json`;
    const again = { ...receiptOnDisk(w.root), note: 'restated by the owner' };
    writeFileSync(join(w.root, rel), `${JSON.stringify(again, null, 2)}\n`);
    git(w.root, 'add', '--', rel);
    git(w.root, 'commit', '--quiet', '-m', 'restate the decision');

    const live = git(w.root, 'rev-parse', 'HEAD').trim();
    // The receipt is genuinely valid at A and the head genuinely carries it — only the SHAPE is wrong.
    expect(git(w.root, 'log', '-1', '--format=%H', '--', rel).trim()).toBe(live);
    expect(git(w.root, 'rev-parse', `${live}^1`).trim()).not.toBe(subjectA);
    expect(receiptOnDisk(w.root)['evidenceSubjectHead']).toBe(subjectA);

    const after = invoke(w.root);
    expect(after.stop).toBe('OWNER_GATE');
    expect(receiptOnDisk(w.root)['consumedAt']).toBeUndefined();
    expect(after.lines.join('\n')).not.toContain('resuming the owner wait recorded at');
  });

  // PROOF 3b — the head is a child of the recorded subject but carries NO owner decision.
  //
  // The parent check alone would accept this shape, and the run would announce that it was resuming
  // a wait for which the owner has committed nothing. Nothing could be spent either way, but a loop
  // that says it is resuming an owner decision that does not exist is lying in its own evidence.
  it('does not claim to resume a wait when the head carries no owner decision at all', () => {
    const w = governed();
    expect(invoke(w.root).stop).toBe('OWNER_GATE');
    const subjectA = recordedSubject(w.root);

    // A child of A, but it is ordinary work — the owner answered nothing.
    writeFileSync(join(w.root, 'unrelated.txt'), 'not an owner decision\n');
    git(w.root, 'add', '--all');
    git(w.root, 'commit', '--quiet', '-m', 'ordinary work on top of the subject');
    const live = git(w.root, 'rev-parse', 'HEAD').trim();
    expect(git(w.root, 'rev-parse', `${live}^1`).trim()).toBe(subjectA);

    const after = invoke(w.root);
    expect(after.stop).toBe('OWNER_GATE');
    expect(after.lines.join('\n')).not.toContain('resuming the owner wait recorded at');
  });

  // ...and once the owner gate IS what stands in the way, the receipt is spent exactly once.
  it('spends the receipt once, and a later invocation cannot buy the same passage again', () => {
    const w = governed();
    expect(invoke(w.root).stop).toBe('OWNER_GATE');
    ownerAnswers(w.root, recordedSubject(w.root));

    expect(invoke(w.root).stop).not.toBe('OWNER_GATE');
    expect(receiptOnDisk(w.root)['consumedAt']).toBe(NOW);

    // A third invocation: the receipt is spent, so the gate is standing again.
    expect(invoke(w.root).stop).toBe('OWNER_GATE');
  });

  // A spend that cannot be written leaves the gate standing, through the real loop.
  it('leaves the owner gate standing when the spend cannot be written', () => {
    const w = governed();
    expect(invoke(w.root).stop).toBe('OWNER_GATE');
    ownerAnswers(w.root, recordedSubject(w.root));

    // The receipt path becomes unwritable for this invocation only.
    const blocked = invoke(w.root, {
      writeText: (path: string, text: string) => {
        if (path.includes(`${INT_PHASE}.commit.json`)) throw new Error('EROFS: read-only file system');
        nodeSystem.writeText(path, text);
      },
    });
    expect(blocked.stop).toBe('OWNER_GATE');
    expect(blocked.lines.join('\n')).toContain("owner gate 'commit' NOT satisfied");
    // The authority survives: unspent, and still able to answer once the checkout is writable.
    expect(receiptOnDisk(w.root)['consumedAt']).toBeUndefined();
  });
});
