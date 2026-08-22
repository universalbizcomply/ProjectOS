/**
 * Where the live gatekeeper's configuration and its durable ledger live.
 *
 * WHY NOT IN `project-config.json`. That file is covered by the plan fingerprint: editing it makes
 * the approved plan STALE and forces a re-approval, which is exactly what happened to this
 * programme's first plan decision. Configuration that changes when a rate card changes must not be
 * able to invalidate an approved plan, so it lives in its own file. The plan governs WHAT may happen;
 * this governs WHICH endpoint and at WHAT price.
 *
 * THE LEDGER IS DURABLE ON PURPOSE. A budget that resets when the process restarts is not a budget.
 * `.projectops/gatekeeper-ledger.json` is the record of what has actually been spent, and it is what
 * makes "restart without a duplicate charge" true across processes rather than merely within one:
 * the request id is derived from the question, so a restarted run re-derives it, finds it already in
 * the ledger, and does not pay twice.
 *
 * NOTHING HERE HOLDS A SECRET. The transport names a credential; `checkTransportDescriptor` refuses a
 * descriptor containing key-shaped material at any depth, and that check runs on this file's contents
 * before the configuration is used.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 */
import { join } from 'node:path';
import {
  checkTransportDescriptor,
  checkPilotBudget,
  authoriseRequestSpend,
  summariseLedger,
  BUDGET_RAISE_SCOPE,
  type BudgetPolicy,
  type GatekeeperTransportDescriptor,
  type GovernanceThreadBinding,
  type LedgerEntry,
  type ModelPolicy,
  type RateCard,
} from '@projectos/core';
import type { System } from '../system.js';

export const GATEKEEPER_CONFIG_REL = '.projectops/gatekeeper.json';
export const GATEKEEPER_LEDGER_REL = '.projectops/gatekeeper-ledger.json';
export const GATEKEEPER_LEDGER_LOCK_REL = '.projectops/gatekeeper-ledger.lock';
export const GATEKEEPER_THREAD_REL = '.projectops/gatekeeper-thread.json';

/**
 * The decider the COMMITTED delegation names for this programme.
 *
 * READ FROM GIT, NOT FROM THE WORKING TREE, and not from `gatekeeper.json`. The transport's own
 * configuration says who it claims to be; this says who the owner delegated to. Keeping them in
 * different files - one of which only counts once committed - is what stops the identity check
 * comparing a value with itself. GK-SEC-004.
 */
export function committedDelegatedDecider(sys: System, root: string, programmeId: string): string | null {
  const rel = '.projectops/authority/closure-delegation.json';
  // `./` binds the read to the governed root; see the note in degradedMode.ts. This one had no
  // root-relative pre-check at all, so a nested checkout adopted the outer project's delegation —
  // and the delegation names who is permitted to decide.
  const shown = sys.exec('git', ['-C', root, 'show', `HEAD:./${rel}`]);
  if (shown.code !== 0 || shown.stdout.trim() === '') return null;
  try {
    const d = JSON.parse(shown.stdout) as Record<string, unknown>;
    if (d['programmeScope'] !== programmeId) return null;
    const to = d['delegatedTo'];
    return typeof to === 'string' && to.trim() !== '' ? to.trim() : null;
  } catch {
    return null;
  }
}

export interface GatekeeperConfig {
  readonly transport: GatekeeperTransportDescriptor;
  readonly modelPolicy: ModelPolicy;
  readonly rateCards: Readonly<Record<string, RateCard>>;
  readonly budget: BudgetPolicy;
  readonly threadBinding: GovernanceThreadBinding;
  /** Who may decide, per the committed delegation. */
  readonly expectedDecider: string;
  /** Who the configured transport claims to be. Checked against the above, never derived from it. */
  readonly transportDecider: string;
}

export type ConfigLoad =
  | { readonly ok: true; readonly config: GatekeeperConfig }
  | { readonly ok: false; readonly reasons: readonly string[] }
  | { readonly ok: false; readonly absent: true; readonly reasons: readonly string[] };

function readJson(sys: System, path: string): Record<string, unknown> | null {
  const text = sys.readText(path);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Load and CHECK the gatekeeper configuration.
 *
 * ABSENT IS NOT AN ERROR. With no configuration there is no reviewer and the loop behaves exactly as
 * it did before one existed — stopping for the owner. That is the correct behaviour for every project
 * that has not opted in, and it is why this returns a distinguishable `absent` rather than a refusal.
 */
export function loadGatekeeperConfig(sys: System, root: string): ConfigLoad {
  const path = join(root, ...GATEKEEPER_CONFIG_REL.split('/'));
  const raw = readJson(sys, path);
  if (raw === null) {
    return {
      ok: false,
      absent: true,
      reasons: [`no gatekeeper is configured for this project (${GATEKEEPER_CONFIG_REL} is absent or unreadable)`],
    };
  }

  const reasons: string[] = [];
  if (raw['schemaVersion'] !== '1.0.0') {
    reasons.push(`gatekeeper config schemaVersion is ${JSON.stringify(raw['schemaVersion'])}, expected "1.0.0"`);
  }
  if (raw['enabled'] !== true) {
    reasons.push('the gatekeeper is configured but not enabled; set enabled to true to use it');
  }

  const transport = raw['transport'] as GatekeeperTransportDescriptor | undefined;
  if (transport === undefined) reasons.push('gatekeeper config declares no transport');
  else reasons.push(...checkTransportDescriptor(transport));

  const modelPolicy = raw['modelPolicy'] as ModelPolicy | undefined;
  if (
    modelPolicy === undefined ||
    typeof modelPolicy.routineModel !== 'string' ||
    typeof modelPolicy.strongModel !== 'string'
  ) {
    reasons.push('gatekeeper config declares no usable modelPolicy (routineModel and strongModel)');
  }

  const rateCards = (raw['rateCards'] ?? {}) as Record<string, RateCard>;
  if (modelPolicy !== undefined) {
    for (const model of [modelPolicy.routineModel, modelPolicy.strongModel]) {
      if (typeof model === 'string' && rateCards[model] === undefined) {
        reasons.push(`no rate card is configured for model '${model}', so a call to it could not be priced`);
      }
    }
  }

  // THE OWNER'S CEILING IS CHECKED HERE, not only at call time: a configuration above the approved
  // pilot is refused before anything reads it, and a budget raise must name a decision scoped to it.
  const budgetRaw = (raw['budget'] ?? {}) as Record<string, unknown>;
  const authorities = Array.isArray(raw['budgetRaiseAuthorities'])
    ? (raw['budgetRaiseAuthorities'] as { decisionId: string; scope: string }[])
    : [];
  reasons.push(
    ...checkPilotBudget(
      {
        initialCreditMicroUsd: budgetRaw['initialCreditMicroUsd'],
        warnAtMicroUsd: budgetRaw['warnAtMicroUsd'],
        hardStopAtMicroUsd: budgetRaw['hardStopAtMicroUsd'],
        autoRecharge: budgetRaw['autoRecharge'],
        raisedByOwnerDecisionId: budgetRaw['raisedByOwnerDecisionId'],
      },
      authorities.filter((a) => a && typeof a.decisionId === 'string' && a.scope === BUDGET_RAISE_SCOPE),
    ),
  );

  const transportRaw = (raw['transport'] ?? {}) as Record<string, unknown>;
  const transportDecider =
    typeof transportRaw['decidedBy'] === 'string' ? transportRaw['decidedBy'].trim() : '';
  if (transportDecider === '') reasons.push('gatekeeper config transport names no decidedBy');

  // The authority comes from the COMMITTED delegation, never from this file.
  const programmeId = typeof raw['programmeId'] === 'string' ? raw['programmeId'].trim() : '';
  const expectedDecider = programmeId === '' ? null : committedDelegatedDecider(sys, root, programmeId);
  if (programmeId === '') reasons.push('gatekeeper config names no programmeId, so no delegation can be resolved');
  else if (expectedDecider === null) {
    reasons.push(
      `no committed delegation for programme '${programmeId}' names a decider; a review decision has no ` +
        'authority behind it until the owner has committed one',
    );
  }

  const threadBinding = raw['threadBinding'] as GovernanceThreadBinding | undefined;
  if (threadBinding === undefined) reasons.push('gatekeeper config declares no threadBinding');

  if (reasons.length > 0) return { ok: false, reasons };

  return {
    ok: true,
    config: {
      transport: transport as GatekeeperTransportDescriptor,
      modelPolicy: modelPolicy as ModelPolicy,
      rateCards,
      budget: {
        warnAtMicroUsd: Number(budgetRaw['warnAtMicroUsd']),
        hardStopAtMicroUsd: Number(budgetRaw['hardStopAtMicroUsd']),
      },
      threadBinding: threadBinding as GovernanceThreadBinding,
      expectedDecider: expectedDecider as string,
      transportDecider,
    },
  };
}

/** Everything spent so far, as recorded on disk. An unreadable ledger reads as empty. */
/**
 * THE BUDGET DECISION AND THE RECORD OF IT ARE ONE ACT, OR THEY ARE NOTHING.
 *
 * `appendLedger` below is crash-safe: a complete temporary file is renamed over the target, so no
 * reader ever sees half a ledger. That closed a real defect (GK-SEC-001) and it is still right. What
 * it never gave was mutual exclusion, and a crash-safe read-modify-write is still a read-modify-write:
 * two processes that read the same ledger both compute the same "remaining budget", both conclude
 * they are under the hard stop, and both make a billed call. The later rename then overwrites the
 * earlier one and the first paid call disappears from the record entirely — so the month's total is
 * not merely wrong, it is wrong in the direction that admits yet more spending.
 *
 * The hard stop is documented as a refusal, not a warning: "Reaching it refuses further calls; it does
 * not merely warn." Under concurrency that was untrue, which is what C17-F1 found.
 *
 * SO ADMISSION IS SERIALISED, NOT JUST THE WRITE. Inside one lock acquisition this reads the ledger
 * FRESH — never a snapshot taken when the process started — totals it, asks `authoriseRequestSpend`,
 * and, if the answer is yes, writes a provisional entry carrying the ESTIMATE before releasing the
 * lock. A second process entering afterwards therefore sees the first call's cost already counted and
 * is refused by the same hard stop. Locking only the final append would leave both processes passing
 * the check and both paying.
 *
 * THE PROVISIONAL ENTRY IS THE RESERVATION. It carries the same `requestId` the real entry will carry,
 * so there is no separate reservation table to reconcile, and `settleGatekeeperSpend` REPLACES it once
 * the true cost is known. Replacement matters: `dedupeEntries` keeps the FIRST entry it sees for a
 * request id, so appending the real entry alongside the provisional one would leave the estimate
 * standing and silently discard the truth.
 *
 * A CRASH LEAVES THE ESTIMATE BEHIND, AND THAT IS THE SAFE DIRECTION. A process killed between
 * admission and settlement leaves a provisional entry counted at its estimate: the month reads
 * slightly high, and the next call is refused slightly early. The opposite failure — losing a call
 * that was actually paid for — is the one that lets spending run away.
 *
 * Added for C17-F1, reusing the lock discipline the installation degraded ledger already proved.
 */
function underCostLedgerLock<T>(sys: System, root: string, body: () => T, refused: (why: string) => T): T {
  const lock = join(root, ...GATEKEEPER_LEDGER_LOCK_REL.split('/'));
  if (!sys.createExclusive(lock, `{"heldSince":"${sys.now()}"}\n`)) {
    // "Held" and "this directory cannot be written at all" arrive identically from `createExclusive`,
    // and they need different answers from an operator, so they are distinguished here.
    if (!sys.exists(lock)) {
      return refused(
        `the gatekeeper ledger directory could not be written (${GATEKEEPER_LEDGER_REL}), so no spend ` +
          'could be admitted and no call was made',
      );
    }
    return refused(
      'another ProjectOS process is deciding gatekeeper spend; nothing was admitted and no call was ' +
        `made. If no other run is in progress, ${GATEKEEPER_LEDGER_LOCK_REL} was left behind by one ` +
        'that died and must be removed.',
    );
  }
  try {
    return body();
  } finally {
    // A lock the OS refuses to delete is the everyday Windows case (an indexer holding a handle), and
    // silently treating it as released would make every later admission refuse with no explanation.
    if (!sys.removeFile(lock)) {
      sys.writeText(
        join(root, ...`${GATEKEEPER_LEDGER_LOCK_REL}.leaked`.split('/')),
        `the gatekeeper ledger lock could not be released at ${sys.now()}\n`,
      );
    }
  }
}

export interface SpendAdmission {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
}

/**
 * Decide whether this call may be made, and record its estimate, without letting go of the lock in
 * between. Returns `allowed: false` when the hard stop refuses it, when another process holds the
 * lock, or when the ledger cannot be written — all three mean no call.
 */
export function admitGatekeeperSpend(
  sys: System,
  root: string,
  request: {
    readonly requestId: string;
    readonly projectId: string;
    readonly phaseId: string;
    readonly model: string;
    readonly estimateMicroUsd: number;
    readonly at: string;
  },
  budget: BudgetPolicy,
): SpendAdmission {
  return underCostLedgerLock<SpendAdmission>(
    sys,
    root,
    () => {
      const fresh = readLedger(sys, root);
      // ALREADY PAID FOR IS NOT PAID FOR TWICE. A restarted run re-derives the same request id; if it
      // is already in the ledger the call was made, and admitting it again would both double-charge
      // and double-count.
      if (fresh.some((e) => e.requestId === request.requestId)) {
        return { allowed: false, reasons: [`request ${request.requestId} is already in the ledger; it is not asked again`] };
      }
      const totals = summariseLedger(fresh, {
        projectId: request.projectId,
        phaseId: request.phaseId,
        month: request.at.slice(0, 7),
      });
      const spend = authoriseRequestSpend(request.estimateMicroUsd, totals, budget);
      if (!spend.allowed) return { allowed: false, reasons: spend.reasons };

      writeLedger(sys, root, [
        ...fresh,
        {
          requestId: request.requestId,
          projectId: request.projectId,
          phaseId: request.phaseId,
          model: request.model,
          usage: { inputTokens: 0, outputTokens: 0 },
          costMicroUsd: request.estimateMicroUsd,
          at: request.at,
        },
      ]);
      return { allowed: true, reasons: spend.reasons };
    },
    (why) => ({ allowed: false, reasons: [why] }),
  );
}

/**
 * Replace the provisional entry with what the call actually cost, or remove it if no call was made.
 *
 * Replacement, never append: `dedupeEntries` keeps the first entry per request id, so an appended
 * truth would sit behind the estimate and never be counted.
 */
export function settleGatekeeperSpend(
  sys: System,
  root: string,
  requestId: string,
  entry: LedgerEntry | null,
): void {
  underCostLedgerLock<void>(
    sys,
    root,
    () => {
      const fresh = readLedger(sys, root);
      const without = fresh.filter((e) => e.requestId !== requestId);
      writeLedger(sys, root, entry === null ? without : [...without, entry]);
    },
    () => undefined,
  );
}

export function readLedger(sys: System, root: string): readonly LedgerEntry[] {
  const raw = readJson(sys, join(root, ...GATEKEEPER_LEDGER_REL.split('/')));
  const entries = raw?.['entries'];
  return Array.isArray(entries) ? (entries as LedgerEntry[]) : [];
}

/**
 * Append one entry, keeping the file the durable record of spend.
 *
 * APPENDS RATHER THAN REWRITES, and never deduplicates on write. Deduplication is `summariseLedger`'s
 * job at read time, deliberately: a ledger that silently dropped a repeat would lose the evidence
 * that a repeat happened, which is exactly what a restart proof needs to show.
 */
export function appendLedger(sys: System, root: string, entry: LedgerEntry): void {
  writeLedger(sys, root, [...readLedger(sys, root), entry]);
}

/**
 * Write the whole ledger atomically. Extracted from `appendLedger` so the locked admission and
 * settlement paths reuse exactly the same crash-safe write rather than a second copy of it.
 */
function writeLedger(sys: System, root: string, entries: readonly LedgerEntry[]): void {
  const path = join(root, ...GATEKEEPER_LEDGER_REL.split('/'));
  const next = `${JSON.stringify({ schemaVersion: '1.0.0', entries }, null, 2)}\n`;

  // CRASH-SAFE, AND THE LOOP ITSELF FOUND THIS. The first version read the whole ledger and wrote it
  // back over the same path. A crash, a full disk or a killed process between the two left the file
  // truncated or half-written, and the record of what had already been spent was gone - which does
  // not merely lose an audit line, it re-opens the budget and lets a restart pay for a call already
  // made. Reported live by the gatekeeper as GK-SEC-001, HIGH, during the first real loop run.
  //
  // A complete temporary file in the SAME DIRECTORY is written first, then renamed over the target.
  // Rename within one filesystem is atomic: a reader sees either the old complete ledger or the new
  // complete ledger, never a partial one. Same directory matters - a rename across volumes is a copy,
  // and a copy is the non-atomic write this is replacing.
  const temporary = `${path}.tmp`;
  sys.writeText(temporary, next);
  const moved = sys.renameFile(temporary, path);
  if (!moved) {
    // The rename failed, so the temporary file is the only complete copy and the original is intact.
    // Falling back to a direct overwrite here would reintroduce exactly the window being closed.
    throw new Error(
      'the gatekeeper ledger could not be updated atomically; the previous ledger is unchanged and the ' +
        `pending entry is in ${GATEKEEPER_LEDGER_REL}.tmp`,
    );
  }
}

/** The provider's id for the last turn, so the next one continues the same conversation. */
export function readPreviousResponseId(sys: System, root: string): string | null {
  const raw = readJson(sys, join(root, ...GATEKEEPER_THREAD_REL.split('/')));
  const id = raw?.['previousResponseId'];
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

export function writePreviousResponseId(sys: System, root: string, id: string | null): void {
  if (id === null || id.trim() === '') return;
  const path = join(root, ...GATEKEEPER_THREAD_REL.split('/'));
  sys.writeText(path, JSON.stringify({ schemaVersion: '1.0.0', previousResponseId: id.trim() }, null, 2) + '\n');
}

/** Decision ids already acted on, derived from the ledger. A spent request is a spent decision. */
export function consumedDecisionIds(ledger: readonly LedgerEntry[]): readonly string[] {
  return ledger.map((e) => `GKDEC-${e.requestId}`);
}
