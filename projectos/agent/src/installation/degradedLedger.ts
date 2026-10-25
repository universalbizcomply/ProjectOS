/**
 * What degraded mode actually spent, kept where the governed project cannot reach it.
 *
 * THE DEFECT THIS CLOSES. Consumption and reconciliation debt lived in one place:
 * `.projectops/execution/degraded-use.<grant>.json`, inside the governed project, uncommitted by
 * design because degraded mode has no commit authority. So `rm` was a complete bypass — the spent
 * grant looked unused and could fund work again, the outstanding work item vanished, the debt with
 * it, and the next major gate proceeded. Criterion 7 asks for durable, bound, non-replayable degraded
 * mode; a file the worker can delete is none of those.
 *
 * WHERE IT LIVES, AND WHY THERE. Under the operator's own application-data directory, not in any
 * repository: `%LOCALAPPDATA%/ProjectOS/installation-state/`. A governed project's bounded worker
 * writes inside its project; this is outside every project, so deleting the project — or the whole
 * checkout — leaves the record of what was spent intact. It is deliberately NOT committed anywhere:
 * committing it would put runtime state under a commit gate that degraded mode cannot pass, which is
 * the trap the project-local record fell into.
 *
 * WHAT IT IS NOT. It is not a database and not a service. It is one JSON file per installation,
 * written atomically through the same temporary-file-and-rename the ledger uses, and read back before
 * it is believed. The Rust host owns richer durable stores, but they require the installed service to
 * be running and this must work for a bare `projectos run` on a developer machine.
 *
 * EVERY ENTRY IS BOUND. Installation, project id, canonical repository, phase, grant, subject,
 * outage and work id — so a record cannot drift onto another project that happens to share an id, and
 * two installations on one machine do not read each other's spends as their own.
 *
 * FAIL CLOSED. An unreadable ledger is a refusal, never an empty one. "I cannot tell" and "nothing
 * was spent" are different answers and only one of them may authorise work.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A under the gatekeeper ruling of 2026-08-20 (C7
 * durability).
 */
import { join } from 'node:path';
import type { System } from '../system.js';

export const DEGRADED_LEDGER_SCHEMA_VERSION = '1.0.0';
export const DEGRADED_LEDGER_FILENAME = 'degraded-consumption.json';

/** One spend of a degraded-mode grant, as it happened. */
export interface DurableConsumption {
  readonly schemaVersion: string;
  readonly installRoot: string;
  readonly projectId: string;
  /** Canonical `host/owner/name`, so a project id alone cannot impersonate another checkout. */
  readonly repository: string;
  readonly phaseId: string;
  readonly grantId: string;
  readonly subjectCommit: string;
  readonly unavailabilityId: string;
  readonly workId: string;
  readonly summary: string;
  readonly consumedAt: string;
}

/** One accepted reconciliation, recorded against the spend it discharges. */
export interface DurableReconciliation {
  /** The installation that made the spend. Written AND compared: a stored binding nobody reads is decoration. */
  readonly installRoot: string;
  readonly workId: string;
  readonly grantId: string;
  readonly projectId: string;
  readonly repository: string;
  readonly decisionId: string;
  readonly ask: string;
  readonly at: string;
}

/**
 * One question put to the gatekeeper about one work item, recorded whatever the answer was.
 *
 * ASKED ONCE MEANS ASKED ONCE, AND THE WORK ITEM IS WHAT WAS ASKED ABOUT. The guard that enforced it
 * keyed on a request id derived from a digest of the evidence TEXT, so any change to that text made
 * the same question look new. That was survivable while exactly one wording existed. It stopped being
 * survivable the moment a second wording appeared for the same work, selected by whether a DELETABLE
 * project file was present: `rm` the mirror, ask again, get a different verdict. That is verdict
 * shopping, and it was available to precisely the party the trust model says can delete that file.
 *
 * So the durable record names the WORK ITEM. The wording may change, the record the question was
 * rebuilt from may change, the digest may change — the question is still the same question, and it
 * has already been answered. Found by two independent lenses of the 2026-08-21 adversarial review.
 */
export interface DurableAsk {
  readonly installRoot: string;
  readonly projectId: string;
  readonly repository: string;
  readonly grantId: string;
  readonly workId: string;
  readonly requestId: string;
  readonly decisionId: string;
  /** What came back. Recorded even when it left the debt standing — especially then. */
  readonly verdict: string;
  readonly at: string;
}

export interface DurableDegradedLedger {
  readonly schemaVersion: string;
  readonly consumptions: readonly DurableConsumption[];
  readonly reconciliations: readonly DurableReconciliation[];
  /** Absent in ledgers written before this record existed, which reads as "nothing asked yet". */
  readonly asks: readonly DurableAsk[];
}

export type LedgerRead =
  | { readonly kind: 'ok'; readonly ledger: DurableDegradedLedger }
  /** Nothing has ever been spent by this installation. Distinct from "cannot tell". */
  | { readonly kind: 'absent' }
  | { readonly kind: 'corrupt'; readonly why: string };

export interface LedgerWrite {
  readonly persisted: boolean;
  readonly problem: string | null;
}

/** The scope a caller is asking about. Every read and write is bound to one. */
export interface LedgerScope {
  readonly installRoot: string;
  readonly projectId: string;
  readonly repository: string;
}

function ledgerPath(stateDir: string): string {
  return join(stateDir, DEGRADED_LEDGER_FILENAME);
}

function parse(raw: string): DurableDegradedLedger | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const consumptions = parsed['consumptions'];
    const reconciliations = parsed['reconciliations'];
    if (!Array.isArray(consumptions) || !Array.isArray(reconciliations)) return null;
    // ABSENT IS FINE; MALFORMED IS NOT. A ledger written before asks existed simply has none. A file
    // whose `asks` is present but not an array is damaged, and defaulting it to empty would silently
    // disable the one guard that refuses a second ask.
    const asks = parsed['asks'];
    if (asks !== undefined && !Array.isArray(asks)) return null;
    // EVERY ELEMENT MUST BE AN OBJECT. `String(row.installRoot ?? '')` guards a MISSING field; it does
    // not guard a row that is `null`, which throws out of the gate instead of refusing there.
    for (const row of [...consumptions, ...reconciliations, ...((asks ?? []) as unknown[])]) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
    }
    return {
      schemaVersion: String(parsed['schemaVersion'] ?? ''),
      consumptions: consumptions as readonly DurableConsumption[],
      reconciliations: reconciliations as readonly DurableReconciliation[],
      asks: (asks ?? []) as readonly DurableAsk[],
    };
  } catch {
    return null;
  }
}

/**
 * The authoritative ledger, with "never written" kept distinct from "cannot be read".
 *
 * A machine that has never run degraded mode legitimately has no file. A file that exists and will
 * not parse is the shape that means something went wrong or somebody edited it, and it refuses.
 */
export function readDurableLedger(sys: System, stateDir: string): LedgerRead {
  const path = ledgerPath(stateDir);
  if (!sys.exists(path)) return { kind: 'absent' };
  const raw = sys.readText(path);
  if (raw === null) return { kind: 'corrupt', why: `the installation degraded ledger at ${path} could not be read` };
  const parsed = parse(raw);
  if (parsed === null) {
    return { kind: 'corrupt', why: `the installation degraded ledger at ${path} exists but is not readable JSON` };
  }
  if (parsed.schemaVersion !== DEGRADED_LEDGER_SCHEMA_VERSION) {
    return {
      kind: 'corrupt',
      why:
        `the installation degraded ledger has schemaVersion ${JSON.stringify(parsed.schemaVersion)}, ` +
        `expected "${DEGRADED_LEDGER_SCHEMA_VERSION}"`,
    };
  }
  return { kind: 'ok', ledger: parsed };
}

/** Replace the ledger. Callers hold the lock; this is the write itself, nothing more. */
function write(sys: System, stateDir: string, next: DurableDegradedLedger): LedgerWrite {
  const path = ledgerPath(stateDir);
  const temporary = `${path}.tmp`;
  try {
    sys.writeText(temporary, `${JSON.stringify(next, null, 2)}\n`);
  } catch (error: unknown) {
    return {
      persisted: false,
      problem: `the installation degraded ledger could not be written: ${error instanceof Error ? error.message : 'write failed'}`,
    };
  }
  if (!sys.renameFile(temporary, path)) {
    return { persisted: false, problem: 'the installation degraded ledger could not be replaced atomically' };
  }
  return { persisted: true, problem: null };
}

export const DEGRADED_LEDGER_LOCK_FILENAME = 'degraded-consumption.lock';

/**
 * Do one read-modify-write with nobody else inside.
 *
 * TWO WRITERS USED TO LOSE ONE ANOTHER SILENTLY. Both read the whole file, both add a row, both write
 * it back — so whoever renamed second erased the other's row, and each verified only its OWN row
 * afterwards and reported success. The erased spend then looked unused: its grant refundable, its
 * review debt gone. The ledger is a single file precisely so that it needs no database, and a single
 * file needs exactly one thing to be safe under concurrency, which is that only one process is inside
 * the read-modify-write at a time.
 *
 * THE LOCK IS A FILE THAT CANNOT BE CREATED TWICE. `createExclusive` is decided by the filesystem, so
 * the second caller loses rather than both proceeding — which is what an `exists()` check would do.
 *
 * NO WAITING, NO RETRY LOOP. A refusal is correct here: degraded spends are rare and operator-driven,
 * and "try again" is a better answer than a runtime that sleeps inside a governance decision. A lock
 * left behind by a killed process blocks until removed, and the message says exactly which file that
 * is — a refusal an operator can clear beats a stale-timeout rule that can clear itself at the wrong
 * moment.
 */
function underLedgerLock(sys: System, stateDir: string, body: () => LedgerWrite): LedgerWrite {
  const lock = join(stateDir, DEGRADED_LEDGER_LOCK_FILENAME);
  if (!sys.createExclusive(lock, `{"heldSince":"${sys.now()}"}\n`)) {
    // WHICH FAILURE IT WAS DECIDES WHAT THE OPERATOR SHOULD DO. `createExclusive` answers only
    // true or false, so "the lock is held" and "this directory cannot be written at all" arrive
    // identically — and the contention message would send someone to delete a file that does not
    // exist, on a machine whose actual problem is a permission, a full disk or a missing profile.
    if (!sys.exists(lock)) {
      return {
        persisted: false,
        problem:
          `the installation state directory could not be written (${stateDir}), so nothing was ` +
          'recorded and no unreviewed work may start; check that it exists and is writable',
      };
    }
    return {
      persisted: false,
      problem:
        'another ProjectOS process is writing the installation degraded ledger; nothing was recorded. ' +
        `If no other run is in progress, ${lock} was left behind by one that died and must be removed.`,
    };
  }
  let result: LedgerWrite = { persisted: false, problem: 'the ledger write did not run' };
  try {
    result = body();
  } finally {
    // `removeFile` verifies the file is gone; the boolean was being discarded, so a lock the OS
    // refused to delete — an antivirus or indexer holding a handle is the everyday Windows case —
    // was silently treated as released, and every later write on the machine refused with no clue
    // why. It cannot be undone here, so it is REPORTED here.
    if (!sys.removeFile(lock)) {
      const leaked =
        `the installation degraded ledger lock ${lock} could not be released; every later write will ` +
        'refuse until it is removed';
      // eslint-disable-next-line no-unsafe-finally
      return { persisted: result.persisted, problem: result.problem === null ? leaked : `${result.problem}; ${leaked}` };
    }
  }
  return result;
}

/**
 * Record a spend, and prove it is really there before the work it funds is allowed to start.
 *
 * The ordering is the whole point: this must be durable BEFORE the bounded work runs, or a crash
 * between the two leaves a grant that funded work and still looks unused.
 */
/**
 * Record a spend whose IDENTITY is decided inside the lock.
 *
 * THE READ THAT NAMED THE ENTRY USED TO SIT OUTSIDE IT. The caller counted the grant's existing items,
 * derived a work id from that count, and only then took the lock — so two concurrent runs read the
 * same count, derived the SAME id, and the loser was told "work item X is already recorded as spent".
 * That is a true sentence about the wrong event: nothing of the loser's was spent, and the message
 * describes a replay that never happened. Deciding the ordinal under the lock makes the two runs
 * allocate different items, which is what actually occurred.
 *
 * `makeEntry` is told how many items this grant has already funded and returns the entry to write.
 */
export function allocateConsumption(
  sys: System,
  stateDir: string,
  scope: LedgerScope & { readonly grantId: string; readonly ceiling: number },
  makeEntry: (alreadyFunded: number) => DurableConsumption,
): LedgerWrite & { readonly entry: DurableConsumption | null } {
  let allocated: DurableConsumption | null = null;
  const written = underLedgerLock(sys, stateDir, () => {
    const state = authoritativeState(sys, stateDir, scope);
    if (!state.readable) {
      return {
        persisted: false,
        problem: state.problem ?? 'the installation degraded ledger could not be read',
      };
    }
    const alreadyFunded = state.workItemsByGrant[scope.grantId] ?? 0;

    // THE CEILING IS DECIDED BY THE SAME READ THAT NAMES THE ENTRY.
    //
    // It used to be decided by the caller, before the lock: two concurrent runs both read "0 spent, 1
    // allowed" and both spent the last item of a one-item grant. The owner authorised one piece of
    // unreviewed work; two ran; and the authoritative record then held two rows under a grant bounded
    // at one — which `reconcileDegradedWork` refuses to review at all, so BOTH became permanently
    // undischargeable and every major gate stayed shut with no remedy. Two independent lenses of the
    // 2026-08-21 review found this, and both noted it was made reachable by moving the ordinal inside
    // the lock: the old colliding id had been bounding the second writer by accident.
    if (!Number.isInteger(scope.ceiling) || scope.ceiling < 0) {
      return { persisted: false, problem: 'the grant states no usable work-item ceiling' };
    }
    if (alreadyFunded >= scope.ceiling) {
      return {
        persisted: false,
        problem:
          `grant '${scope.grantId}' is bounded at ${scope.ceiling} work item(s) and this installation ` +
          `has already funded ${alreadyFunded}; nothing further is spent`,
      };
    }

    const entry = makeEntry(alreadyFunded);
    allocated = entry;
    return appendConsumption(sys, stateDir, entry);
  });
  return { ...written, entry: written.persisted ? allocated : null };
}

export function recordConsumption(sys: System, stateDir: string, entry: DurableConsumption): LedgerWrite {
  return underLedgerLock(sys, stateDir, () => appendConsumption(sys, stateDir, entry));
}

/** The body of a consumption write. The caller holds the lock. */
function appendConsumption(sys: System, stateDir: string, entry: DurableConsumption): LedgerWrite {
  {
    const read = readDurableLedger(sys, stateDir);
    if (read.kind === 'corrupt') return { persisted: false, problem: read.why };
    const current: DurableDegradedLedger =
      read.kind === 'ok'
        ? read.ledger
        : { schemaVersion: DEGRADED_LEDGER_SCHEMA_VERSION, consumptions: [], reconciliations: [], asks: [] };

    if (current.consumptions.some((c) => c.workId === entry.workId)) {
      return { persisted: false, problem: `work item ${entry.workId} is already recorded as spent` };
    }

    const written = write(sys, stateDir, {
      ...current,
      schemaVersion: DEGRADED_LEDGER_SCHEMA_VERSION,
      consumptions: [...current.consumptions, entry],
    });
    if (!written.persisted) return written;

    // READ BACK. `writeText` reports nothing, so a silent no-op would be indistinguishable from
    // success — and this is the record that stops a spent grant looking unused.
    const after = readDurableLedger(sys, stateDir);
    if (after.kind !== 'ok' || !after.ledger.consumptions.some((c) => c.workId === entry.workId)) {
      return {
        persisted: false,
        problem: 'the spend could not be read back after writing, so no unreviewed work may start',
      };
    }
    return { persisted: true, problem: null };
  }
}

/**
 * Record that a question was PUT and, in the same breath, what it settled.
 *
 * ONE LOCK, OR A DEBT THAT CANNOT BE DISCHARGED. These were two separate acquisitions: the ask was
 * written, the lock released, and the discharge attempted afterwards. Between them any other ProjectOS
 * process could take the lock — and `underLedgerLock` refuses rather than waiting, by design. The
 * discharge then failed, the accepted decision was thrown away, and the retry hit `ALREADY_ASKED`,
 * which is permanent. The work was paid for, approved, and left owing forever with no override. Found
 * by the second adversarial review, 2026-08-21.
 *
 * NO SECOND ASK FOR THE SAME WORK. `recordAsk` had no duplicate check at all — every other writer in
 * this file has one — so the "asked once" guarantee rested entirely on a read taken before a network
 * round trip. Two concurrent reconciliations both passed that read, both paid, and the accepted
 * verdict won. That is verdict shopping reached through concurrency instead of `rm`.
 *
 * AND THE WORK MUST BE WORK THIS INSTALLATION FUNDED, so an ask cannot be recorded — permanently
 * blocking a work item — for something it never spent on.
 */
export function settleAsk(
  sys: System,
  stateDir: string,
  entry: DurableAsk,
  discharge: DurableReconciliation | null,
): LedgerWrite {
  return underLedgerLock(sys, stateDir, () => {
    const read = readDurableLedger(sys, stateDir);
    if (read.kind === 'corrupt') return { persisted: false, problem: read.why };
    if (read.kind === 'absent') {
      return { persisted: false, problem: 'this installation has no record of the work this question is about' };
    }
    const current = read.ledger;

    const spend = current.consumptions.find((c) => rowMatches(c, entry) && c.workId === entry.workId);
    if (spend === undefined) {
      return { persisted: false, problem: `this installation has no record of work item ${entry.workId}` };
    }
    if (current.asks.some((a) => rowMatches(a, entry) && a.workId === entry.workId)) {
      return { persisted: false, problem: `work item ${entry.workId} has already been put to the gatekeeper` };
    }
    if (discharge !== null) {
      const problem = dischargeProblem(current, discharge, entry);
      if (problem !== null) return { persisted: false, problem };
    }

    const next: DurableDegradedLedger = {
      ...current,
      asks: [...current.asks, entry],
      reconciliations: discharge === null ? current.reconciliations : [...current.reconciliations, discharge],
    };
    const written = write(sys, stateDir, next);
    if (!written.persisted) return written;

    const after = readDurableLedger(sys, stateDir);
    if (
      after.kind !== 'ok' ||
      !after.ledger.asks.some((a) => a.workId === entry.workId && a.requestId === entry.requestId)
    ) {
      return { persisted: false, problem: 'the record of the question could not be read back after writing' };
    }
    if (discharge !== null && !after.ledger.reconciliations.some((r) => r.workId === discharge.workId)) {
      return { persisted: false, problem: 'the reconciliation could not be read back after writing' };
    }
    if (after.ledger.consumptions.length !== current.consumptions.length) {
      return { persisted: false, problem: 'the record of what was spent changed while settling a question' };
    }
    return { persisted: true, problem: null };
  });
}

/** Same installation, same project, same repository, same grant. Every lookup here is bound this way. */
function rowMatches(
  row: { readonly installRoot?: unknown; readonly projectId?: unknown; readonly repository?: unknown; readonly grantId?: unknown },
  scope: { readonly installRoot: string; readonly projectId: string; readonly repository: string; readonly grantId: string },
): boolean {
  return (
    String(row?.installRoot ?? '').toLowerCase() === scope.installRoot.toLowerCase() &&
    row?.projectId === scope.projectId &&
    String(row?.repository ?? '').toLowerCase() === scope.repository.toLowerCase() &&
    row?.grantId === scope.grantId
  );
}

/** Why this discharge may not be written, or `null`. */
function dischargeProblem(
  current: DurableDegradedLedger,
  entry: DurableReconciliation,
  ask: DurableAsk,
): string | null {
  if (current.reconciliations.some((r) => r.workId === entry.workId)) {
    return `work item ${entry.workId} is already reconciled in the installation ledger`;
  }
  if (entry.decisionId === '' || entry.decisionId !== ask.decisionId) {
    return `the reconciliation of ${entry.workId} does not name the decision the question returned`;
  }
  return null;
}

export interface AuthoritativeState {
  readonly readable: boolean;
  readonly problem: string | null;
  /** Grants this installation has already spent for this project. */
  readonly consumedGrantIds: readonly string[];
  /** Work this installation funded and no accepted decision has discharged. */
  readonly outstandingWorkIds: readonly string[];
  /** How many items each grant has funded, so exhaustion is decidable without the project mirror. */
  readonly workItemsByGrant: Readonly<Record<string, number>>;
  /** Work items this installation has already put to the gatekeeper, whatever the answer was. */
  readonly askedWorkIds: readonly string[];
  /** Work this installation funded and an accepted decision HAS discharged. */
  readonly dischargedWorkIds: readonly string[];
}

/**
 * What this installation knows it spent on this project — the answer that survives the project.
 *
 * An unreadable ledger yields `readable: false`, and every caller must treat that as a refusal.
 */
export function authoritativeState(sys: System, stateDir: string, scope: LedgerScope): AuthoritativeState {
  const read = readDurableLedger(sys, stateDir);
  if (read.kind === 'corrupt') {
    return {
      readable: false,
      problem: read.why,
      consumedGrantIds: [],
      outstandingWorkIds: [],
      workItemsByGrant: {},
      askedWorkIds: [],
      dischargedWorkIds: [],
    };
  }
  const ledger: DurableDegradedLedger =
    read.kind === 'ok' ? read.ledger : { schemaVersion: DEGRADED_LEDGER_SCHEMA_VERSION, consumptions: [], reconciliations: [], asks: [] };

  // BOUND TO THE PROJECT, AND ANY DISAGREEMENT IS A REFUSAL — NEVER A SKIP.
  //
  // Two bindings, and both had to be got right the hard way. The repository comes from the governed
  // checkout's `origin`, which lives in `.git/config` — inside the project and rewritable with
  // `git remote set-url` — so filtering on it let a project rename itself out of its own debt. The
  // first repair filtered on `installRoot` as well, which was worse: a second COPY of the ProjectOS
  // tree computes a different install root, reads the same shared ledger, matches nothing, and
  // reports a clean slate. `cp -r` became a way to refund every grant.
  //
  // So selection is by project identity, and a row that names this project under a different
  // repository OR a different installation REFUSES. An entry that does not apply is never silently
  // dropped: that is how both bypasses worked.
  const named = ledger.consumptions.filter(
    (c) =>
      c.projectId === scope.projectId &&
      String(c.repository ?? '').toLowerCase() === scope.repository.toLowerCase(),
  );
  const claimingThisProject = ledger.consumptions.filter((c) => c.projectId === scope.projectId);
  const disagreeing = claimingThisProject.filter(
    (c) =>
      String(c.repository ?? '').toLowerCase() !== scope.repository.toLowerCase() ||
      String(c.installRoot ?? '').toLowerCase() !== scope.installRoot.toLowerCase(),
  );
  if (disagreeing.length > 0) {
    const first = disagreeing[0];
    return {
      readable: false,
      problem:
        `this machine records degraded work for project '${scope.projectId}' at ` +
        `${first?.repository ?? 'another repository'} under installation ` +
        `${String(first?.installRoot ?? 'unknown')}, but this run reports ${scope.repository} under ` +
        `${scope.installRoot}; which of a project's debts count is not something the project or a ` +
        'second copy of the installation may decide',
      consumedGrantIds: [],
      outstandingWorkIds: [],
      workItemsByGrant: {},
      askedWorkIds: [],
      dischargedWorkIds: [],
    };
  }
  const mine = named;
  // A ROW WITHOUT ITS BINDINGS DISCHARGES NOTHING, and reading one must not throw. A ledger written
  // by an earlier build carries no `installRoot`; treating that as a match would let an older format
  // clear a debt, and dereferencing it blindly turned a refusal into a crash out of the gate.
  const discharged = new Set(
    ledger.reconciliations
      .filter(
        (r) =>
          String(r.installRoot ?? '').toLowerCase() === scope.installRoot.toLowerCase() &&
          r.projectId === scope.projectId &&
          String(r.repository ?? '').toLowerCase() === scope.repository.toLowerCase(),
      )
      .map((r) => r.workId),
  );
  const byGrant: Record<string, number> = {};
  for (const c of mine) byGrant[c.grantId] = (byGrant[c.grantId] ?? 0) + 1;

  return {
    readable: true,
    problem: null,
    consumedGrantIds: [...new Set(mine.map((c) => c.grantId))],
    outstandingWorkIds: mine.filter((c) => !discharged.has(c.workId)).map((c) => c.workId),
    workItemsByGrant: byGrant,
    // ASKED, BY THIS INSTALLATION, FOR THIS PROJECT. Bound exactly as the spends are: an ask recorded
    // by another installation or under another repository is not evidence about this one.
    askedWorkIds: ledger.asks
      .filter(
        (a) =>
          String(a.installRoot ?? '').toLowerCase() === scope.installRoot.toLowerCase() &&
          a.projectId === scope.projectId &&
          String(a.repository ?? '').toLowerCase() === scope.repository.toLowerCase(),
      )
      .map((a) => String(a.workId ?? '')),
    dischargedWorkIds: mine.filter((c) => discharged.has(c.workId)).map((c) => c.workId),
  };
}
