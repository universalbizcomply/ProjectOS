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
  const shown = sys.exec('git', ['-C', root, 'show', `HEAD:${rel}`]);
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
  const existing = readLedger(sys, root);
  const path = join(root, ...GATEKEEPER_LEDGER_REL.split('/'));
  const next = `${JSON.stringify({ schemaVersion: '1.0.0', entries: [...existing, entry] }, null, 2)}\n`;

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
  const moved = sys.exec('cmd', ['/c', 'move', '/y', temporary, path], { cwd: root });
  if (moved.code !== 0) {
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
