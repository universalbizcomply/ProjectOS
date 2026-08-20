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
  readonly workId: string;
  readonly grantId: string;
  readonly projectId: string;
  readonly repository: string;
  readonly decisionId: string;
  readonly ask: string;
  readonly at: string;
}

export interface DurableDegradedLedger {
  readonly schemaVersion: string;
  readonly consumptions: readonly DurableConsumption[];
  readonly reconciliations: readonly DurableReconciliation[];
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
    return {
      schemaVersion: String(parsed['schemaVersion'] ?? ''),
      consumptions: consumptions as readonly DurableConsumption[],
      reconciliations: reconciliations as readonly DurableReconciliation[],
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

/**
 * Record a spend, and prove it is really there before the work it funds is allowed to start.
 *
 * The ordering is the whole point: this must be durable BEFORE the bounded work runs, or a crash
 * between the two leaves a grant that funded work and still looks unused.
 */
export function recordConsumption(sys: System, stateDir: string, entry: DurableConsumption): LedgerWrite {
  const read = readDurableLedger(sys, stateDir);
  if (read.kind === 'corrupt') return { persisted: false, problem: read.why };
  const current: DurableDegradedLedger =
    read.kind === 'ok'
      ? read.ledger
      : { schemaVersion: DEGRADED_LEDGER_SCHEMA_VERSION, consumptions: [], reconciliations: [] };

  if (current.consumptions.some((c) => c.workId === entry.workId)) {
    return { persisted: false, problem: `work item ${entry.workId} is already recorded as spent` };
  }

  const written = write(sys, stateDir, {
    ...current,
    schemaVersion: DEGRADED_LEDGER_SCHEMA_VERSION,
    consumptions: [...current.consumptions, entry],
  });
  if (!written.persisted) return written;

  // READ BACK. `writeText` reports nothing, so a silent no-op would be indistinguishable from success
  // — and this is the record that stops a spent grant looking unused.
  const after = readDurableLedger(sys, stateDir);
  if (after.kind !== 'ok' || !after.ledger.consumptions.some((c) => c.workId === entry.workId)) {
    return { persisted: false, problem: 'the spend could not be read back after writing, so no unreviewed work may start' };
  }
  return { persisted: true, problem: null };
}

/** Record an accepted reconciliation against a spend this installation really made. */
export function recordReconciliation(sys: System, stateDir: string, entry: DurableReconciliation): LedgerWrite {
  const read = readDurableLedger(sys, stateDir);
  if (read.kind === 'corrupt') return { persisted: false, problem: read.why };
  if (read.kind === 'absent') {
    return { persisted: false, problem: 'this installation has no record of the work this reconciliation would discharge' };
  }
  const current = read.ledger;
  const spend = current.consumptions.find((c) => c.workId === entry.workId);
  if (spend === undefined) {
    return { persisted: false, problem: `this installation has no record of work item ${entry.workId}` };
  }
  if (spend.projectId !== entry.projectId || spend.repository !== entry.repository || spend.grantId !== entry.grantId) {
    return { persisted: false, problem: `the reconciliation of ${entry.workId} does not match the spend it names` };
  }
  if (current.reconciliations.some((r) => r.workId === entry.workId)) {
    return { persisted: false, problem: `work item ${entry.workId} is already reconciled in the installation ledger` };
  }

  const written = write(sys, stateDir, { ...current, reconciliations: [...current.reconciliations, entry] });
  if (!written.persisted) return written;

  const after = readDurableLedger(sys, stateDir);
  if (after.kind !== 'ok' || !after.ledger.reconciliations.some((r) => r.workId === entry.workId)) {
    return { persisted: false, problem: 'the reconciliation could not be read back after writing' };
  }
  if (after.ledger.consumptions.length !== current.consumptions.length) {
    return { persisted: false, problem: 'the record of what was spent changed while recording a reconciliation' };
  }
  return { persisted: true, problem: null };
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
}

/**
 * What this installation knows it spent on this project — the answer that survives the project.
 *
 * An unreadable ledger yields `readable: false`, and every caller must treat that as a refusal.
 */
export function authoritativeState(sys: System, stateDir: string, scope: LedgerScope): AuthoritativeState {
  const read = readDurableLedger(sys, stateDir);
  if (read.kind === 'corrupt') {
    return { readable: false, problem: read.why, consumedGrantIds: [], outstandingWorkIds: [], workItemsByGrant: {} };
  }
  const ledger: DurableDegradedLedger =
    read.kind === 'ok' ? read.ledger : { schemaVersion: DEGRADED_LEDGER_SCHEMA_VERSION, consumptions: [], reconciliations: [] };

  const mine = ledger.consumptions.filter(
    (c) => c.projectId === scope.projectId && c.repository.toLowerCase() === scope.repository.toLowerCase(),
  );
  const discharged = new Set(
    ledger.reconciliations
      .filter((r) => r.projectId === scope.projectId && r.repository.toLowerCase() === scope.repository.toLowerCase())
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
  };
}
