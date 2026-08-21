/**
 * Continuing without a reviewer, on the owner's committed risk — the runner half.
 *
 * WHAT ALREADY EXISTED, AND WHAT DID NOT. The contract (`gatekeeperDegradedMode.ts`) knows how to
 * refuse a grant, and the loader (`degradedModeGrants.ts`) knows how to read one from committed
 * truth. Between them there was nothing: no code derived the outage identity a grant must answer, no
 * code consumed a grant, and the loop had no degraded branch at all — `runner.ts` contained not one
 * reference to it. The contract could refuse a replay and nothing could ever perform the first use.
 * This file is that missing middle, and only that.
 *
 * THE OWNER'S CHOICE IS THE GRANT. The loop cannot ask a question and wait for an answer, so it does
 * not try: a committed grant recording `ACCEPT RISK & CONTINUE WITH CLAUDE SELF-REVIEW` IS the
 * owner having chosen it. No grant means the run stops at the three-way choice exactly as it does
 * today. There is no fourth option that quietly means "carry on".
 *
 * THE DEBT IS RECORDED BEFORE THE WORK, NOT AFTER. Consumption and the work item are persisted
 * first, and the work runs only if that write succeeded. The ordering is the whole point: a crash
 * between the two would otherwise leave work done and the grant apparently unused, so the next run
 * would spend it again. Recording first means a crash leaves an outstanding debt for work that may
 * never have happened — the safe direction, because an interrupted unreviewed change needs review
 * more than a completed one, not less.
 *
 * WHY THE STORE IS NOT COMMITTED. Consumption is a runtime FACT, not an authority: it records what
 * ProjectOS did, and nothing about it grants anything. Requiring a commit would mean degraded mode
 * needed commit authority to persist that it had used its own grant — and commit is exactly one of
 * the protected actions a grant may never carry. The authority side is unchanged: the GRANT is
 * committed, read from the git object store, and refused otherwise.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A for acceptance criteria 7 and 11.
 */
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative } from 'node:path';
import type { System } from '../system.js';
import { readLedger } from './gatekeeperConfig.js';
import {
  allocateConsumption,
  authoritativeState,
  recordConsumption,
  type DurableConsumption,
} from '../installation/degradedLedger.js';
import {
  checkDegradedModeGrant,
  degradedWorkRemaining,
  reconciliationState,
  type DegradedModeGrant,
  type DegradedWorkItem,
  type ReconciliationRecord,
  type ReconciliationState,
  type GatekeeperUnavailabilityCause,
} from '@projectos/core';
import { loadDegradedModeGrant, isSafeGrantId, degradedGrantRelPath } from './degradedModeGrants.js';

export const DEGRADED_STORE_SCHEMA_VERSION = '1.0.0';

/**
 * The identity of THIS outage.
 *
 * DERIVED, NOT ALLOCATED — the same reasoning as `deriveRequestId`. A counter or a timestamp would
 * produce a different id after a restart, so the grant the owner committed for this outage would no
 * longer answer it, and a resumed run would refuse work the owner had already accepted the risk for.
 * Hashing what the outage IS about makes its identity survive the process that observed it.
 *
 * The stop and the cause are included deliberately: a reviewer that is unreachable for a different
 * stop, or for a different cause, is a different outage, and risk accepted for one is not risk
 * accepted for the other.
 *
 * IT USED TO HASH THE REASONS, AND THE LIVE PROOF DIED ON IT. Those reasons begin with
 * `STOPPED (<code>): <detail>`, and the detail carries ordinary check and finding state. So the
 * identity moved whenever the repository did — and committing the owner's own authority wrapper was
 * enough: one test that asserted "this checkout holds no grant" began failing the moment a real
 * grant existed, `agent-tests` flipped to FAIL, the detail changed, and the outage the owner had
 * just approved a grant for no longer occurred. The grant refused itself, correctly and uselessly,
 * because no sequence of reissued grants converges on a target that moves when you aim at it.
 *
 * The fix is not to hash less of the truth; it is to hash the part that IS the truth. A material
 * cause is what an owner accepts risk against. Prose describing it is diagnostic, may be reworded,
 * and now cannot move the identity — while a genuinely different cause still yields a different
 * outage, which is the distinction the old design was reaching for and missed.
 */
export function deriveUnavailabilityId(input: {
  readonly projectId: string;
  readonly phaseId: string;
  readonly subjectCommit: string;
  readonly stopCode: string;
  /** The MATERIAL cause. Never prose: see the note above on why this changed. */
  readonly cause: GatekeeperUnavailabilityCause;
}): string {
  const canonical = JSON.stringify([
    input.projectId,
    input.phaseId,
    input.subjectCommit,
    input.stopCode,
    input.cause,
  ]);
  return `GKOUT-${createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 24)}`;
}

/** The identity of one piece of degraded work. Derived, so a resumed run does not double-count it. */
export function deriveWorkId(grantId: string, unavailabilityId: string, ordinal: number): string {
  const canonical = JSON.stringify([grantId, unavailabilityId, ordinal]);
  return `GKWORK-${createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16)}`;
}

/** What a grant's use looks like on disk. One record per grant, so consumption is per grant. */
export interface DegradedStoreRecord {
  readonly schemaVersion: string;
  readonly grantId: string;
  readonly unavailabilityId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly consumedAt: string;
  /** The grant's own ceiling, recorded so exhaustion is decidable from the store alone. */
  readonly maxWorkItems: number;
  readonly workItems: readonly DegradedWorkItem[];
  readonly reconciliations: readonly ReconciliationRecord[];
}

export function degradedStoreRelPath(grantId: string): string | null {
  if (!isSafeGrantId(grantId)) return null;
  return `.projectops/execution/degraded-use.${grantId}.json`;
}

export function degradedStorePath(root: string, grantId: string): string | null {
  const rel = degradedStoreRelPath(grantId);
  return rel === null ? null : join(root, ...rel.split('/'));
}

/**
 * ABSENT AND UNREADABLE ARE NOT THE SAME ANSWER, and conflating them was a CRITICAL defect.
 *
 * Both used to return `null`, and every count was built by dropping nulls — so a store that was
 * truncated, corrupted by a torn write, or deliberately emptied read as "this grant has never been
 * used". A one-item grant could then fund a second item, and a third, without bound, and the
 * reconciliation debt for work that genuinely happened disappeared with it. Found by an adversarial
 * review of this file; the exploitation path needed nothing but ordinary write access, which the
 * implementer has by design.
 *
 * Absent is a fact ("nothing has happened here"). Unreadable is an absence of fact, and an absence of
 * fact must never read as a favourable one.
 */
type StoreRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'corrupt'; readonly why: string }
  | { readonly kind: 'ok'; readonly record: DegradedStoreRecord };

function parseStore(raw: string | null): DegradedStoreRecord | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    if (typeof rec['grantId'] !== 'string' || typeof rec['consumedAt'] !== 'string') return null;
    return {
      schemaVersion: String(rec['schemaVersion'] ?? ''),
      grantId: rec['grantId'],
      unavailabilityId: String(rec['unavailabilityId'] ?? ''),
      projectId: String(rec['projectId'] ?? ''),
      phaseId: String(rec['phaseId'] ?? ''),
      consumedAt: rec['consumedAt'],
      maxWorkItems: typeof rec['maxWorkItems'] === 'number' ? rec['maxWorkItems'] : 1,
      workItems: Array.isArray(rec['workItems']) ? (rec['workItems'] as DegradedWorkItem[]) : [],
      reconciliations: Array.isArray(rec['reconciliations'])
        ? (rec['reconciliations'] as ReconciliationRecord[])
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * One store, with the difference between "nothing here" and "cannot tell" preserved.
 *
 * COMMITTED BYTES WIN WHERE THEY EXIST. The store is a runtime fact and is not committed by degraded
 * mode — that would need the commit authority a grant may never carry. But once the owner HAS
 * committed it, as reconciliation evidence, the committed copy is the one that counts, and a local
 * deletion or edit of a committed record is then a refusal rather than a reset. Before that first
 * commit the record is local only, and this is honest about the limit: see the header.
 */
export function readDegradedStoreDetailed(sys: System, root: string, grantId: string): StoreRead {
  const rel = degradedStoreRelPath(grantId);
  const path = degradedStorePath(root, grantId);
  if (rel === null || path === null) return { kind: 'corrupt', why: `unsafe grant id '${grantId}'` };

  const logged = sys.exec('git', ['-C', root, 'log', '-1', '--format=%H', '--', rel]);
  const everCommitted = logged.code === 0 && logged.stdout.trim().length > 0;
  if (everCommitted) {
    const dirty = sys.exec('git', ['-C', root, 'diff', '--name-only', 'HEAD', '--', rel]);
    if (dirty.code !== 0 || dirty.stdout.trim().length > 0) {
      // A COMMITTED USE RECORD THAT HAS SINCE BEEN CHANGED OR REMOVED. Nothing about that can be
      // read as "unused": it is the one shape that means someone edited the evidence.
      return {
        kind: 'corrupt',
        why: `the committed degraded-use record for ${grantId} has been modified or removed in the working tree`,
      };
    }
      // `./` MATTERS. A pathspec after `--` resolves against `-C root`, but `<rev>:<path>` resolves
      // against the TOP of the working tree, so in a checkout nested inside a larger repository the
      // committedness proof above and the bytes read below would be DIFFERENT FILES. Verified on this
      // repository's own nested fixture, where the outer project's record was returned in place of the
      // inner one's. Documented at length by `committedGovernanceOwner` in this file; propagated here
      // after an adversarial review found the same shape unfixed at four sites.
    const shown = sys.exec('git', ['-C', root, 'show', `HEAD:./${rel}`]);
    const fromGit = shown.code === 0 ? parseStore(shown.stdout) : null;
    return fromGit === null
      ? { kind: 'corrupt', why: `the committed degraded-use record for ${grantId} is unreadable` }
      : { kind: 'ok', record: fromGit };
  }

  if (!sys.exists(path)) return { kind: 'absent' };
  const parsed = parseStore(sys.readText(path));
  return parsed === null
    ? { kind: 'corrupt', why: `the degraded-use record for ${grantId} exists but cannot be read` }
    : { kind: 'ok', record: parsed };
}

/**
 * Whether the use record can be written at all. `null` means yes; a string says why not.
 *
 * A COMMITTED USE RECORD IS THE OWNER'S EVIDENCE, NOT A RUNTIME SCRATCHPAD. Once it is committed, any
 * working-tree edit makes the tree and the committed bytes disagree, and `readDegradedStoreDetailed`
 * reads that — correctly — as tampering, for this grant and for every later read of it. So a writer
 * that appended anyway would not merely fail: it would leave the record permanently unreadable, and an
 * unreadable record drops out of `readAllDegradedStores`, taking the outstanding debt with it.
 *
 * Checked BEFORE writing, by both writers. Amending a committed record needs a commit, which is the
 * owner's act and not one this process may simulate.
 */
export function degradedStoreIsRecordable(sys: System, root: string, grantId: string): string | null {
  const rel = degradedStoreRelPath(grantId);
  if (rel === null || degradedStorePath(root, grantId) === null) return `unsafe grant id '${grantId}'`;
  const logged = sys.exec('git', ['-C', root, 'log', '-1', '--format=%H', '--', rel]);
  const committed = logged.code === 0 && logged.stdout.trim().length > 0;
  return committed
    ? `the use record ${rel} is committed; changing it in the working tree would put the tree at odds ` +
        "with the owner's committed evidence, and committing an amended record is the owner's act"
    : null;
}

/** This grant's use, as recorded. `null` when it has never been consumed OR cannot be read. */
export function readDegradedStore(sys: System, root: string, grantId: string): DegradedStoreRecord | null {
  const read = readDegradedStoreDetailed(sys, root, grantId);
  return read.kind === 'ok' ? read.record : null;
}

/** Every store this checkout cannot read. A non-empty list is a refusal, never a zero. */
export function unreadableDegradedStores(sys: System, root: string): readonly string[] {
  const dir = join(root, '.projectops', 'execution');
  const why: string[] = [];
  if (sys.exists(dir)) {
    for (const name of sys.listDir(dir)) {
      if (!name.startsWith('degraded-use.') || !name.endsWith('.json')) continue;
      if (parseStore(sys.readText(join(dir, name))) === null) {
        why.push(`the degraded-use record ${name} exists but cannot be read`);
      }
    }
  }
  return why;
}

/**
 * Every recorded grant use in this checkout.
 *
 * READ FROM DISK EVERY TIME, never cached in memory: surviving a restart is the requirement, and a
 * cache would be exactly the thing that does not.
 */
export function readAllDegradedStores(sys: System, root: string): readonly DegradedStoreRecord[] {
  const dir = join(root, '.projectops', 'execution');
  if (!sys.exists(dir)) return [];
  const out: DegradedStoreRecord[] = [];
  for (const name of sys.listDir(dir)) {
    if (!name.startsWith('degraded-use.') || !name.endsWith('.json')) continue;
    const grantId = name.slice('degraded-use.'.length, -'.json'.length);
    // Through the detailed reader, so a committed record is read from git rather than from disk.
    const read = readDegradedStoreDetailed(sys, root, grantId);
    if (read.kind === 'ok') out.push(read.record);
  }
  return out.slice().sort((a, b) => (a.grantId < b.grantId ? -1 : a.grantId > b.grantId ? 1 : 0));
}

/**
 * Grant ids that are SPENT, in the shape the contract's expectations take.
 *
 * SPENT MEANS EXHAUSTED, NOT "USED ONCE" — and the difference is not academic. Returning every grant
 * that had ever been used made `maxWorkItems` unreachable above 1: the contract refuses any id in
 * this list, so a grant for three items was refused after its first. The ceiling the owner wrote
 * would have been silently capped at one, which is a promise the record does not make. Found by
 * mutation testing, which showed that emptying this list failed nothing — the bound was doing all
 * the work and the replay guard none of it.
 *
 * The two guards are independent on purpose: this one refuses a grant that is finished, and
 * `degradedWorkRemaining` refuses one more item than a live grant covers.
 */
export function consumedGrantIds(sys: System, root: string): readonly string[] {
  return readAllDegradedStores(sys, root)
    .filter((r) => r.workItems.length >= Math.max(1, r.maxWorkItems))
    .map((r) => r.grantId);
}

/** Every degraded work item ever recorded here, for the reconciliation debt. */
export function allDegradedWork(sys: System, root: string): readonly DegradedWorkItem[] {
  return readAllDegradedStores(sys, root).flatMap((r) => r.workItems);
}

/**
 * What still has to be reviewed before a major gate may proceed as normal.
 *
 * Reuses criterion 8's machinery untouched; this only supplies it the durable state, so the debt
 * survives a restart rather than living in the memory of the process that incurred it.
 */
export function degradedReconciliationState(sys: System, root: string): ReconciliationState {
  const stores = readAllDegradedStores(sys, root);
  // PER RECORD, NOT ACROSS THEM. Flattening every store's work items and every store's
  // reconciliations into one pair let a reconciliation in ONE file clear a work item in ANOTHER — so a
  // brand-new `degraded-use.ANYTHING.json` carrying no work of its own and one hand-written
  // reconciliation cleared a debt recorded in a committed, pristine, tamper-evident record. Matching
  // within the record keeps the discharge next to the thing it discharges.
  const states = stores.map((r) => reconciliationState(r.workItems, r.reconciliations));
  const outstandingWorkIds = states.flatMap((s) => s.outstandingWorkIds);
  const reasons = states.flatMap((s) => s.reasons);
  return {
    required: states.some((s) => s.required),
    outstandingWorkIds,
    reasons,
  };
}

/**
 * The refusal a governed major gate must make while degraded-mode work is unreconciled.
 *
 * EMPTY MEANS CLEAR. Anything else is a refusal, and the caller must not proceed.
 *
 * TWO SOURCES, AND THE AUTHORITATIVE ONE IS THE INSTALLATION'S. The installation ledger lives
 * outside every repository and decides whether work is outstanding; the project-local record is kept
 * as corroborating evidence and can still raise a refusal of its own, but it can no longer CLEAR one
 * by being deleted.
 *
 * WHAT IT ADDS OVER `degradedReconciliationState`. That function is built on
 * `readAllDegradedStores`, which DROPS a store it cannot read — so truncating or editing a use record
 * makes its outstanding work disappear from the debt state rather than raising it. That is acceptable
 * for a status line and unacceptable for a gate, so every use record in the execution directory is
 * read through the detailed reader here and an unreadable one is a refusal in its own right. "I
 * cannot tell" and "there is none" are different answers, and only one of them may open a gate.
 *
 * WHAT IT DOES NOT CLAIM, STATED PRECISELY.
 *
 * It refuses two things: a phase transition to a closure status, and an owner decision on a gated or
 * prohibited approval request. It is not a general block on every governed operation, and it does not
 * and cannot prevent someone running `git commit` or `git push` themselves — ProjectOS exposes no
 * governed commit or push operation to gate.
 *
 * DELETING THE PROJECT EVIDENCE NO LONGER CLEARS ANYTHING. The use record under
 * `.projectops/execution` is a runtime file the worker can remove; the installation ledger is not,
 * and it is what this consults first. The remaining ceiling is stated plainly: a process running as
 * the operator with access outside the project can still reach the installation's own state, which is
 * the declared trusted computing base rather than something this function can defend.
 *
 * Added under the delegated continuation of 2026-08-20, which required the standing sentence "the
 * next major gate cannot proceed as normal while degraded-mode work is unreconciled" to become an
 * enforced invariant rather than a printed one.
 */
export function reconciliationDebtBlock(
  sys: System,
  root: string,
  scope: { readonly projectId: string; readonly durable: DurableBinding },
): readonly string[] {
  // THE AUTHORITATIVE RECORD FIRST. The project mirror is evidence; this is the fact. Deleting the
  // mirror removes the evidence and changes nothing here, which is the whole point of C7 durability.
  const durable = authoritativeState(sys, scope.durable.stateDir, {
    installRoot: scope.durable.installRoot,
    projectId: scope.projectId,
    repository: scope.durable.repository,
  });
  if (!durable.readable) {
    return [
      'REFUSED (DEGRADED_DEBT_UNREADABLE): the installation record of degraded spending could not be read,',
      '  so whether unreviewed work is outstanding cannot be established.',
      `  - ${durable.problem ?? 'the installation degraded ledger is unreadable'}`,
      '  An unreadable record is refused, never read as "no debt".',
    ];
  }
  if (durable.outstandingWorkIds.length > 0) {
    return [
      'REFUSED (DEGRADED_DEBT_OUTSTANDING): degraded-mode work has not been reviewed, so this governed ' +
        'gate does not proceed as normal.',
      ...durable.outstandingWorkIds.map((id) => `  - outstanding work item: ${id}`),
      '  Recorded by the installation, outside this project: deleting the project evidence does not ' +
        'clear it.',
      '  Required next action: projectos reconcile --grant <GRANT-ID> --work <WORK-ID> --execute',
      '  The debt is discharged only by an accepted gatekeeper decision. It is never cleared by hand.',
    ];
  }

  const dir = join(root, '.projectops', 'execution');
  const unreadable: string[] = [];
  if (sys.exists(dir)) {
    for (const name of sys.listDir(dir)) {
      if (!name.startsWith('degraded-use.') || !name.endsWith('.json')) continue;
      const grantId = name.slice('degraded-use.'.length, -'.json'.length);
      const read = readDegradedStoreDetailed(sys, root, grantId);
      if (read.kind === 'corrupt') unreadable.push(read.why);
    }
  }
  if (unreadable.length > 0) {
    return [
      'REFUSED (DEGRADED_DEBT_UNREADABLE): a degraded-mode use record cannot be read, so whether ' +
        'unreviewed work is outstanding cannot be established.',
      ...unreadable.map((w) => `  - ${w}`),
      '  An unreadable record is refused, never read as "no debt".',
      '  Required next action: restore the record from its committed form, or have the owner rule on it.',
    ];
  }

  // A DISCHARGE MUST NAME A CALL THAT HAPPENED. `reconciliationState` accepts any non-empty
  // `decisionId` string, so a hand-written record cleared a debt with no call, no decision and no
  // cost. The gatekeeper ledger is the durable record of what was actually asked, and every decision
  // this runtime can produce is `GKDEC-<requestId>` — so a reconciliation whose decision does not
  // correspond to a ledger entry is an assertion, not a review, and is refused here.
  //
  // IT ALSO MAKES LOSING THE LEDGER FAIL CLOSED: without it, no reconciliation can be corroborated,
  // so the debt returns rather than the gate opening.
  const paidDecisionIds = new Set(readLedger(sys, root).map((e) => `GKDEC-${e.requestId}`));
  const uncorroborated: string[] = [];
  for (const store of readAllDegradedStores(sys, root)) {
    for (const r of store.reconciliations) {
      if (r.decisionAccepted !== true) continue;
      const id = typeof r.decisionId === 'string' ? r.decisionId : '';
      if (!paidDecisionIds.has(id)) {
        uncorroborated.push(
          `the reconciliation of ${String(r.workId)} names decision ${id === '' ? '(none)' : id}, ` +
            'which no gatekeeper call in this project\'s ledger produced',
        );
      }
    }
  }
  if (uncorroborated.length > 0) {
    return [
      'REFUSED (DEGRADED_DEBT_UNCORROBORATED): a recorded reconciliation does not correspond to any ' +
        'gatekeeper call this project actually made.',
      ...uncorroborated.map((w) => `  - ${w}`),
      '  A discharge is a decision that was asked for and paid for, never a field somebody wrote.',
      '  Required next action: run the reconciliation for real, or restore the gatekeeper ledger.',
    ];
  }

  const state = degradedReconciliationState(sys, root);
  // THE MIRROR MAY LAG THE RECORD THAT DECIDES.
  //
  // A discharge made while the mirror was absent is recorded only in the installation ledger, by
  // design. If that mirror later comes back — restored from a backup, or recreated by a later spend
  // under the same grant — its work item still reads as outstanding, and the gate would refuse
  // forever on a debt the installation knows is settled. Worse, the remedy it prints would pay for a
  // real gatekeeper call and then fail, because the durable ledger already holds the discharge. So
  // what the installation has discharged is subtracted before the mirror gets to raise a refusal.
  const settled = new Set(durable.dischargedWorkIds);
  const stillOwing = state.outstandingWorkIds.filter((id) => !settled.has(id));
  // AND NOT A REFUSAL THAT NAMES NO WORK ITEM. `reconciliationState` can require a refusal with an
  // EMPTY outstanding list — its one such case is duplicate work ids where the duplicate has been
  // cleared, which is a tamper signal and not a clean slate. Gating the whole refusal on `stillOwing`
  // would have silently dropped it, so the subtraction only clears a refusal it can actually account
  // for: one that named work items, all of which the installation has since discharged.
  if (!state.required) return [];
  if (state.outstandingWorkIds.length > 0 && stillOwing.length === 0) return [];
  return [
    'REFUSED (DEGRADED_DEBT_OUTSTANDING): degraded-mode work has not been reviewed, so this governed ' +
      'gate does not proceed as normal.',
    ...state.reasons.map((r) => `  - ${r}`),
    ...stillOwing.map((id) => `  - outstanding work item: ${id}`),
    '  Required next action: projectos reconcile --grant <GRANT-ID> --work <WORK-ID> --execute',
    '  The debt is discharged only by an accepted gatekeeper decision. It is never cleared by hand.',
  ];
}

export interface DegradedAuthorisation {
  readonly authorised: boolean;
  readonly reasons: readonly string[];
  readonly grant: DegradedModeGrant | null;
  readonly unavailabilityId: string;
  /** How many further work items this grant still covers. */
  readonly remaining: number;
}

/**
 * Actions degraded mode may never carry, whatever any list says.
 *
 * A FLOOR, NOT THE LIST. The owner-only set is otherwise plan-derived (`requiredOwnerGates`) or
 * caller-supplied, and both can legitimately be empty — an authoring omission, or a caller passing
 * `[]` explicitly, which `??` does not treat as absent because an empty array is not nullish. Either
 * would have made "a grant may never authorise a protected action" vacuously true for that phase.
 * These five are the ones whose whole purpose is that a human decided, so they are refused here
 * regardless of what the phase remembered to declare. Raised as MEDIUM by adversarial review.
 */
export const ALWAYS_OWNER_ONLY = [
  'commit',
  'push',
  'phase-closure',
  'secrets-handling',
  'payment-or-live-charge',
] as const;

/** The owner-only set actually enforced: whatever was declared, plus the floor that never moves. */
export function enforcedOwnerOnlyActions(declared: readonly string[]): readonly string[] {
  return [...new Set([...ALWAYS_OWNER_ONLY, ...declared])];
}

/**
 * Where the AUTHORITATIVE record of degraded spending lives, and whose it is.
 *
 * REQUIRED, NEVER DEFAULTED. Every caller supplies it or nothing runs: a state directory guessed
 * from the ambient environment — or worse, from the governed project — would be the defect this
 * exists to close. The repository is the canonical `host/owner/name`, so two checkouts that claim the
 * same project id do not read each other's spends as their own.
 */
export interface DurableBinding {
  readonly stateDir: string;
  readonly installRoot: string;
  readonly repository: string;
}

export interface DegradedAuthorisationInput {
  readonly projectId: string;
  readonly phaseId: string;
  readonly subjectCommit: string;
  readonly unavailabilityId: string;
  readonly grantId: string;
  readonly recordedOwner: string;
  readonly ownerOnlyActions: readonly string[];
  /** The installation's durable record. Authority to spend is decided against this, not the project. */
  readonly durable: DurableBinding;
}

/**
 * May this run continue unreviewed, and how far?
 *
 * THE ONLY ROUTE PRODUCTION MAY TAKE. The grant arrives through `loadDegradedModeGrant`, which
 * derives `readFromCommittedTree` from the same read that produced the bytes. This function does not
 * accept that flag from its caller and there is no parameter through which a caller could supply it,
 * so the runner cannot assert committed provenance it has not established. The pure checker still
 * takes the flag, and still should: it is pure, and that is what makes it testable without a
 * repository. It is simply not where authority is decided.
 */
export function authoriseDegradedContinuation(
  sys: System,
  root: string,
  input: DegradedAuthorisationInput,
): DegradedAuthorisation {
  // THE AUTHORITY WRAPPER IS CHECKED HERE, NOT ONLY BY THE RUNNER. Leaving it to the caller would be
  // the same mistake as leaving `readFromCommittedTree` to the caller: a direct caller would get an
  // authorisation that never asked whether the grant commit was a clean wrapper over the approved
  // work. The subject is DERIVED from it too, so a caller cannot name one.
  const wrapper = authorityWrapper(sys, root, input.phaseId, input.grantId);
  const derived = degradedWorkSubject(sys, root, wrapper);
  if (derived.subjectCommit === null) {
    return { authorised: false, reasons: derived.problems, grant: null, unavailabilityId: input.unavailabilityId, remaining: 0 };
  }
  const effectiveSubject = derived.subjectCommit;

  // THE AUTHORITATIVE RECORD DECIDES WHETHER THIS GRANT IS ALREADY SPENT.
  //
  // The project-local record used to be the only answer, and deleting it made a spent grant look
  // unused — the same one-item grant could fund item after item. The installation's ledger lives
  // outside every repository, so a worker bounded to its project cannot reach it, and an unreadable
  // one refuses rather than reading as "nothing spent".
  const durableState = authoritativeState(sys, input.durable.stateDir, {
    installRoot: input.durable.installRoot,
    projectId: input.projectId,
    repository: input.durable.repository,
  });
  if (!durableState.readable) {
    return {
      authorised: false,
      reasons: [
        durableState.problem ?? 'the installation degraded ledger could not be read',
        'degraded-mode use cannot be established, so no further unreviewed work may be authorised',
      ],
      grant: null,
      unavailabilityId: input.unavailabilityId,
      remaining: 0,
    };
  }

  const loaded = loadDegradedModeGrant(sys, root, input.phaseId, input.grantId);
  const problems = checkDegradedModeGrant(loaded.grant, {
    projectId: input.projectId,
    phaseId: input.phaseId,
    subjectCommit: effectiveSubject,
    unavailabilityId: input.unavailabilityId,
    recordedOwner: input.recordedOwner,
    ownerOnlyActions: enforcedOwnerOnlyActions(input.ownerOnlyActions),
    // EXHAUSTION IS NOT USE. `consumedGrantIds` lists grants whose bound is fully spent, not grants
    // that have been touched — a two-item grant is still live after its first item. The installation
    // ledger records individual spends and knows nothing of any grant's ceiling, so it is compared
    // against the ceiling separately below rather than folded in here, where it would have capped
    // every multi-item grant at one.
    alreadyConsumedGrantIds: consumedGrantIds(sys, root),
    // Established by the loader, from the read. Never asserted here.
    readFromCommittedTree: loaded.readFromCommittedTree,
  });

  const reasons = [...problems];
  // AN ABSENCE OF FACT IS NOT A FAVOURABLE FACT. The project mirror is checked too: a record it
  // holds and the ledger does not is still a spend that happened, and one that cannot be read leaves
  // this run unable to say how much of a grant is gone.
  const unreadable = unreadableDegradedStores(sys, root);
  if (unreadable.length > 0) {
    return {
      authorised: false,
      reasons: [
        ...unreadable,
        'degraded-mode use cannot be established, so no further unreviewed work may be authorised',
      ],
      grant: null,
      unavailabilityId: input.unavailabilityId,
      remaining: 0,
    };
  }
  const ownStore = readDegradedStoreDetailed(sys, root, input.grantId);
  if (ownStore.kind === 'corrupt') {
    return {
      authorised: false,
      reasons: [ownStore.why, `that grant's own use record cannot be read, so it authorises nothing`],
      grant: null,
      unavailabilityId: input.unavailabilityId,
      remaining: 0,
    };
  }
  // A refusal an owner can act on. Without this, "no risk acceptance exists" is what an owner sees
  // when they are looking straight at the file they wrote but did not commit — or at one git is
  // configured to ignore, which they cannot commit at all.
  if (loaded.grant === null && loaded.uncommittedGrantOnDisk !== null) {
    reasons.push(
      `a grant for ${input.grantId} exists in the working tree but is not committed; ` +
        'committing it is the owner action that makes it authority',
    );
  }
  if (loaded.pathIsGitIgnored) {
    reasons.push(
      `git is configured to ignore ${degradedStoreRelPath(input.grantId) === null ? 'that path' : `.projectops/authority/${input.phaseId}.degraded-grant.${input.grantId}.json`}, ` +
        'so it cannot be committed and can never become authority under this id',
    );
  }

  if (reasons.length > 0) {
    return { authorised: false, reasons, grant: null, unavailabilityId: input.unavailabilityId, remaining: 0 };
  }

  const grant = loaded.grant as DegradedModeGrant;
  const ceiling = Number(grant.maxWorkItems);
  // WHICHEVER RECORD SAYS MORE WAS SPENT, WINS.
  //
  // The project mirror can be deleted; the installation ledger cannot be reached from inside the
  // project. Taking the larger count means deleting the mirror cannot refund a grant, and a mirror
  // that somehow knows about work the installation does not is still counted.
  const durableUsed = durableState.workItemsByGrant[String(grant.grantId)] ?? 0;
  const mirrorUsed = Math.max(0, ceiling - degradedWorkRemaining(
    { grantId: String(grant.grantId), maxWorkItems: ceiling },
    allDegradedWork(sys, root),
  ));
  const remaining = Math.max(0, ceiling - Math.max(durableUsed, mirrorUsed));
  if (remaining <= 0) {
    return {
      authorised: false,
      reasons: [
        `grant ${String(grant.grantId)} has no work items left; its bound is already spent`,
        `  the installation records ${durableUsed} spend(s) under it, and this project ${mirrorUsed}`,
      ],
      grant: null,
      unavailabilityId: input.unavailabilityId,
      remaining: 0,
    };
  }
  return { authorised: true, reasons: [], grant, unavailabilityId: input.unavailabilityId, remaining };
}

/**
 * Is this operation inside what the owner granted?
 *
 * Two independent questions, and the second is not implied by the first. An operation must be named
 * by `grantedScope`, AND must not be owner-only — because a grant that names a protected action is
 * refused outright by the contract, but a grant that names something innocuous must still not become
 * a route to one by the runner asking loosely.
 */
export function degradedOperationProblems(
  grant: DegradedModeGrant,
  operation: string,
  ownerOnlyActions: readonly string[],
): readonly string[] {
  const problems: string[] = [];
  if (enforcedOwnerOnlyActions(ownerOnlyActions).includes(operation)) {
    problems.push(
      `'${operation}' is an owner-only action; continuing without review is not authority to take a ` +
        'protected action, which needs its own explicit grant',
    );
  }
  const scope = Array.isArray(grant.grantedScope) ? grant.grantedScope.map(String) : [];
  if (!scope.includes(operation)) {
    problems.push(`'${operation}' is outside the granted scope (${scope.join(', ') || 'none'})`);
  }
  return problems;
}

export interface ConsumptionResult {
  readonly persisted: boolean;
  readonly workId: string | null;
  readonly problem: string | null;
}

/**
 * Spend the grant, and record the debt — BEFORE the work runs.
 *
 * If this returns anything but `persisted: true`, the caller must not proceed. That is not a
 * convention: it is the only thing standing between a crash and a grant that funded work while still
 * looking unused.
 *
 * THE WRITE IS VERIFIED BY READING IT BACK. `writeText` reports nothing, and a silent failure here is
 * the exact failure this ordering exists to prevent — so the record is read again and parsed, and
 * anything short of a parseable record with this grant's id is a refusal.
 */
export function consumeDegradedGrant(
  sys: System,
  root: string,
  input: {
    readonly grant: DegradedModeGrant;
    readonly unavailabilityId: string;
    readonly projectId: string;
    readonly phaseId: string;
    readonly summary: string;
    readonly at: string;
    readonly subjectCommit: string;
    readonly durable: DurableBinding;
  },
): ConsumptionResult {
  const grantId = String(input.grant.grantId ?? '');
  const path = degradedStorePath(root, grantId);
  if (path === null) return { persisted: false, workId: null, problem: `unsafe grant id '${grantId}'` };

  // THE AUTHORITATIVE SPEND IS RECORDED FIRST, OUTSIDE THE PROJECT.
  //
  // The project mirror is written after, and is evidence rather than authority. If this fails,
  // nothing has been spent and no work may start — which is the direction to fail in.
  // THE ORDINAL COMES FROM THE AUTHORITATIVE RECORD, AND IS DECIDED INSIDE ITS LOCK.
  //
  // Counting the project's own file meant the identity of a durable entry depended on a file the
  // design says may be deleted: delete it after the first spend and the ordinal resets, so the next
  // work id collides with one already recorded and the grant becomes unusable while still claiming
  // budget. Counting the installation's rows fixed that, but reading them BEFORE taking the lock left
  // a second, quieter version of the same fault: two concurrent runs read the same count, derived the
  // same id, and the loser was told its work item "is already recorded as spent" — a true sentence
  // about an event that never happened. The count and the write now happen under one lock.
  const allocation = allocateConsumption(
    sys,
    input.durable.stateDir,
    {
      installRoot: input.durable.installRoot,
      projectId: input.projectId,
      repository: input.durable.repository,
      grantId,
      // THE OWNER'S BOUND, CARRIED IN SO IT CAN BE ENFORCED UNDER THE LOCK RATHER THAN BEFORE IT.
      ceiling: Number(input.grant.maxWorkItems),
    },
    (alreadyFunded) => ({
      schemaVersion: '1.0.0',
      installRoot: input.durable.installRoot,
      projectId: input.projectId,
      repository: input.durable.repository,
      phaseId: input.phaseId,
      grantId,
      subjectCommit: input.subjectCommit,
      unavailabilityId: input.unavailabilityId,
      workId: deriveWorkId(grantId, input.unavailabilityId, alreadyFunded + 1),
      summary: input.summary,
      consumedAt: input.at,
    }),
  );
  if (!allocation.persisted || allocation.entry === null) {
    return {
      persisted: false,
      workId: null,
      problem: allocation.problem ?? 'the spend could not be recorded durably, so no unreviewed work may start',
    };
  }
  const durableEntry = allocation.entry;

  // A COMMITTED RECORD CANNOT BE APPENDED TO. Without this the second spend of a multi-item grant
  // wrote over the owner's committed evidence, failed its own read-back, and left the record corrupt —
  // which silently erased the FIRST item's outstanding debt as well. Found by adversarial review.
  const recordable = degradedStoreIsRecordable(sys, root, grantId);
  if (recordable !== null) return { persisted: false, workId: null, problem: recordable };

  const existing = readDegradedStore(sys, root, grantId);
  // THE SAME ID THE INSTALLATION ALLOCATED. The mirror mirrors; it does not name.
  const workId = durableEntry.workId;
  const item: DegradedWorkItem = {
    workId,
    grantId,
    phaseId: input.phaseId,
    summary: input.summary,
    at: input.at,
  };
  const record: DegradedStoreRecord = {
    schemaVersion: DEGRADED_STORE_SCHEMA_VERSION,
    grantId,
    unavailabilityId: input.unavailabilityId,
    projectId: input.projectId,
    phaseId: input.phaseId,
    consumedAt: existing?.consumedAt ?? input.at,
    maxWorkItems: Number(input.grant.maxWorkItems),
    workItems: [...(existing?.workItems ?? []), item],
    reconciliations: existing?.reconciliations ?? [],
  };

  // A TORN WRITE IS HANDLED BY REFUSING TO READ IT, NOT BY PREVENTING IT. `writeText` is a plain
  // truncate-then-write, so a crash here can leave a partial file. Making the write atomic would mean
  // adding `rename` to the System interface and to every fake that implements it — wider than this
  // step, and unnecessary for SAFETY: a partial record is unreadable, and an unreadable record now
  // refuses authorisation rather than reading as "never used". What is lost is availability, not
  // safety — the owner must repair or re-grant, which is the correct direction to fail in.
  try {
    sys.writeText(path, `${JSON.stringify(record, null, 2)}\n`);
  } catch (error: unknown) {
    return {
      persisted: false,
      workId: null,
      problem: `could not record the grant as spent: ${error instanceof Error ? error.message : 'write failed'}`,
    };
  }

  const readBack = readDegradedStore(sys, root, grantId);
  if (readBack === null || readBack.grantId !== grantId || !readBack.workItems.some((w) => w.workId === workId)) {
    return {
      persisted: false,
      workId: null,
      problem: 'the grant was not recorded as spent, so no unreviewed work may start',
    };
  }
  return { persisted: true, workId, problem: null };
}

/**
 * What degraded mode may be asked to do. A CLOSED vocabulary, deliberately.
 *
 * The alternative — a caller-supplied command, script or callback reaching the CLI — would make
 * degraded mode a general execution surface that happens to check a grant first, which is the
 * opposite of a bounded authority. Only names in this list can be requested, and each maps to work
 * ProjectOS already knows how to do under its ordinary governance.
 *
 * `implement` is one further governed worker attempt: the same authorised worker, with the same
 * grants it already had, run once more without a review in front of it. That is exactly what
 * "continue implementing on the owner's risk" means, and it reuses the loop's existing execution
 * path rather than inventing a second one.
 */
/**
 * The recorded owner, from the plan AS COMMITTED — not from the plan on disk.
 *
 * FOUND BY ADVERSARIAL REVIEW, AND THE COMMENT WAS THE WORSE HALF OF THE BUG. The runner read
 * `context.plan.governance.owner`, and `loadGovernedContext` reads `plan.json` with an ordinary file
 * read — so the value the grant was checked against came from a file the implementer can rewrite,
 * while the code claimed it was "digest-bound and owner-approved... the one statement a caller
 * cannot author". Every other owner-authority input on this path is already read from git: the
 * grant, and the secrets-handling receipt. This makes the owner match them.
 *
 * The same two questions as everywhere else — committed at all, and unmodified since — and the same
 * fail-closed answer: no owner means no risk acceptance can be checked against one, so nothing is
 * authorised. Reading the object rather than the file is what makes the bytes checked and the bytes
 * committed the same bytes.
 */
export function committedGovernanceOwner(sys: System, root: string, planPath: string): string | null {
  const rel = repoRelativeGitPath(root, planPath);
  if (rel === null) return null;
  const logged = sys.exec('git', ['-C', root, 'log', '-1', '--format=%H', '--', rel]);
  if (logged.code !== 0 || logged.stdout.trim().length === 0) return null;
  const dirty = sys.exec('git', ['-C', root, 'diff', '--name-only', 'HEAD', '--', rel]);
  if (dirty.code !== 0 || dirty.stdout.trim().length > 0) return null;
  // `HEAD:./<rel>` AND NOT `HEAD:<rel>` — THE TWO FORMS ADDRESS DIFFERENT FILES.
  //
  // A pathspec after `--` resolves against the current directory, which `-C root` makes the root.
  // `<rev>:<path>` does NOT: per gitrevisions it resolves against the TOP OF THE WORKING TREE unless
  // it begins with `./` or `../`. So for any root that is a subdirectory of its repository — a
  // project checked out inside a larger one, which this repository's own example fixtures are — the
  // first two calls would establish "committed and unmodified" about the root's plan while this one
  // read the plan at the repository top. Verified rather than reasoned: from proj-clean,
  // `HEAD:.projectops/plan.json` returns ProjectOS's own plan with owner Murad, while that project's
  // committed plan is projectId `acme-app` and records no owner at all — a refusal silently turned
  // into an acceptance, and the whole point of reading the object is that the bytes checked and the
  // bytes read are the same bytes. `./` costs nothing at the top level, where both forms agree.
  const shown = sys.exec('git', ['-C', root, 'show', `HEAD:./${rel}`]);
  if (shown.code !== 0) return null;
  try {
    const plan = JSON.parse(shown.stdout) as Record<string, unknown>;
    const gov = (plan['governance'] as Record<string, unknown> | undefined) ?? {};
    const owner = typeof gov['owner'] === 'string' ? gov['owner'].trim() : '';
    return owner === '' ? null : owner;
  } catch {
    return null;
  }
}

/**
 * The repository-relative git path for a plan the CALLER names however it names it.
 *
 * FOUND BY THE FIRST LIVE EXERCISE, NOT BY ANY TEST. `committedGovernanceOwner` took its argument
 * to be repo-relative and merely normalised separators. The real caller is `runner.ts`, which passes
 * `context.planPath`, and `loadGovernedContext` builds that as `join(root, rel)` — ABSOLUTE. So
 * every git call became `git show HEAD:C:/dev/ProjectOS/.projectops/plan-….json`, which git rejects
 * with "exists on disk, but not in 'HEAD'", the owner resolved to null, and degraded mode refused
 * with "no committed approved plan records an owner" while a committed plan recorded one. It failed
 * CLOSED, which is why it was safe — and it made the path unreachable for the owner too.
 *
 * Every existing test for this function constructed a relative path by hand, so all of them agreed
 * with the function instead of with its caller. A boundary proven only against inputs of its own
 * choosing is not proven; the regression tests for this go through the real governed context.
 *
 * WHAT IS ACCEPTED, AND WHAT IS REFUSED. An absolute path inside the root is reduced to the path git
 * knows. A repo-relative path still works, because nothing says the only caller must stay the only
 * caller. Everything else is null — a different drive, a UNC share, a drive-RELATIVE `C:plan.json`,
 * anything above the root, any `..` segment, a path that reduces to nothing, a non-absolute root
 * that could not anchor an absolute path, and a leading `:`, which would be git PATHSPEC MAGIC
 * rather than a filename: `:(glob)…` as the dirty-check pathspec could match nothing and make
 * "unmodified since HEAD" vacuously true. Refusing costs a caller nothing — it is the same
 * fail-closed answer as an absent plan — and the alternative is authority derived from a path that
 * does not mean what it appears to mean.
 *
 * WHAT IS NOT REFUSED, STATED SO NO LATER READER OVERTRUSTS THIS. Ordinary fnmatch metacharacters
 * (`*`, `?`, `[`) are left alone. A pathspec globs and `<rev>:<path>` does not, so a path carrying
 * them can in principle have its dirty check answered about a different file from the one read —
 * but only if a filename containing them is COMMITTED and holds a valid plan, and the implementer
 * cannot commit. Where no such file exists, `show` prints something that is not plan JSON and the
 * parse refuses. Raised by review and left deliberately: refusing them here would be hardening
 * beyond the defect, not closing a reachable hole.
 */
function repoRelativeGitPath(root: string, planPath: string): string | null {
  if (typeof planPath !== 'string' || planPath.length === 0) return null;
  if (planPath.includes('\0') || root.includes('\0')) return null;

  const drivePrefixed = /^[a-zA-Z]:/;
  // `C:plan.json` is DRIVE-RELATIVE, not absolute: Windows resolves it against that drive's own
  // current directory, so the same argument names different files from different working
  // directories — the very ambiguity the root guard below exists to refuse, arriving through the
  // other parameter. No caller produces one (`join` never does, and the config route is already
  // filtered), and no plan is ever legitimately named this way, so it is refused rather than
  // resolved. The governance engine's own path predicate refuses the same shape.
  if (drivePrefixed.test(planPath) && !isAbsolute(planPath)) return null;

  let rel = planPath;
  if (isAbsolute(planPath)) {
    // An absolute path can only be reduced against an absolute root. A relative root would be
    // resolved against the process cwd, and a cwd that is not the root is exactly the ambiguity
    // that must not decide whose plan grants authority.
    if (!isAbsolute(root)) return null;
    rel = relative(root, planPath);
  }

  const posix = rel.split(String.fromCharCode(92)).join('/');
  // A different drive or a UNC share survives `relative` unchanged and is still rooted here.
  if (isAbsolute(posix) || drivePrefixed.test(posix) || posix.startsWith('/')) return null;
  if (posix.startsWith(':')) return null;

  // An empty segment is a doubled or trailing slash — and, when the whole string is empty, a path
  // that reduced to the root itself. Neither names a plan record.
  const segments: string[] = [];
  for (const seg of posix.split('/')) {
    if (seg === '.') continue;
    if (seg === '..' || seg === '') return null;
    segments.push(seg);
  }
  return segments.length === 0 ? null : segments.join('/');
}

export const DEGRADED_OPERATIONS = ['implement'] as const;
export type DegradedOperation = (typeof DEGRADED_OPERATIONS)[number];

export function isDegradedOperation(value: string): value is DegradedOperation {
  return (DEGRADED_OPERATIONS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------------------------------------
 * The end-to-end sequence, so the ordering is a property of the code rather than of the caller.
 * --------------------------------------------------------------------------------------------- */

/**
 * Proof that a grant was spent for exactly this work item.
 *
 * NOT CONSTRUCTIBLE OUTSIDE THIS MODULE. The brand is a `unique symbol` that is never exported, so
 * no caller can name the key and therefore no caller can build one of these. That matters because
 * the alternative — a boolean saying "yes, I consumed it" — is precisely the shape a caller can get
 * wrong or skip, and the whole point of this step is that the ordering stops depending on a caller
 * remembering anything.
 */
declare const consumedAuthorityBrand: unique symbol;
export interface ConsumedAuthority {
  readonly [consumedAuthorityBrand]: true;
  readonly workId: string;
  readonly grantId: string;
  readonly unavailabilityId: string;
  /** Work items this grant still covers AFTER this one. */
  readonly remainingAfter: number;
}

/**
 * What happened, in enough detail for a caller to tell the six cases apart.
 *
 * A `void` return said only "something was tried". A caller could not distinguish "no grant" from
 * "refused" from "the write failed" from "work ran and incurred a debt" — which is why the ordering
 * could not be relied on beyond this file.
 */
export type DegradedOutcome =
  | { readonly kind: 'NOT_CONFIGURED' }
  | { readonly kind: 'REFUSED'; readonly reasons: readonly string[] }
  | { readonly kind: 'CONSUMPTION_FAILED'; readonly problem: string }
  | {
      readonly kind: 'WORK_DONE';
      readonly workId: string;
      readonly remainingAfter: number;
      readonly reconciliationRequired: boolean;
      readonly outstandingWorkIds: readonly string[];
      /** Set when the bounded work itself threw. The debt stands regardless — see below. */
      readonly workError: string | null;
    };

export interface DegradedRunInput extends DegradedAuthorisationInput {
  /** The one non-protected thing this run would do, checked against the grant's scope. */
  readonly operation: string;
  readonly at: string;
}

/**
 * Authorise, spend, and only then do the work — as one operation that cannot be performed out of
 * order, because the work is an argument rather than something the caller does afterwards.
 *
 * THIS IS THE STRUCTURAL FIX. Before it, `authoriseDegradedContinuation` and `consumeDegradedGrant`
 * were two calls a caller made in sequence, and nothing but that caller's care stopped the work
 * happening first, or happening after a failed write. Passing the work IN removes the opportunity:
 * there is no path through this function that reaches `work` without a persisted, read-back-verified
 * consumption record, and a caller holding only this module's exports has no other way to spend a
 * grant.
 *
 * A THROWN WORK CALLBACK DOES NOT UNDO THE SPEND. The grant is gone and the debt stands, because the
 * work may have half-happened and half-done unreviewed work needs review more than finished work
 * does, not less. The error is reported, never swallowed.
 */
export function runDegradedWork(
  sys: System,
  root: string,
  input: DegradedRunInput,
  work: (authority: ConsumedAuthority) => void,
): DegradedOutcome {
  const authorisation = authoriseDegradedContinuation(sys, root, input);
  if (!authorisation.authorised || authorisation.grant === null) {
    return { kind: 'REFUSED', reasons: authorisation.reasons };
  }

  // SCOPE BEFORE SPEND. Refusing after consuming would burn a grant on work never done.
  const scopeProblems = degradedOperationProblems(authorisation.grant, input.operation, input.ownerOnlyActions);
  if (scopeProblems.length > 0) return { kind: 'REFUSED', reasons: scopeProblems };

  const consumption = consumeDegradedGrant(sys, root, {
    subjectCommit: input.subjectCommit,
    durable: input.durable,
    grant: authorisation.grant,
    unavailabilityId: input.unavailabilityId,
    projectId: input.projectId,
    phaseId: input.phaseId,
    summary: `${input.operation} while the gatekeeper was unreachable`,
    at: input.at,
  });
  if (!consumption.persisted || consumption.workId === null) {
    return {
      kind: 'CONSUMPTION_FAILED',
      problem: consumption.problem ?? 'the grant could not be recorded as spent',
    };
  }

  const authority = {
    workId: consumption.workId,
    grantId: String(authorisation.grant.grantId),
    unavailabilityId: input.unavailabilityId,
    remainingAfter: authorisation.remaining - 1,
  } as unknown as ConsumedAuthority;

  let workError: string | null = null;
  try {
    work(authority);
  } catch (error: unknown) {
    workError = error instanceof Error ? error.message : 'the bounded work failed';
  }

  const debt = degradedReconciliationState(sys, root);
  return {
    kind: 'WORK_DONE',
    workId: consumption.workId,
    remainingAfter: authorisation.remaining - 1,
    reconciliationRequired: debt.required,
    outstandingWorkIds: debt.outstandingWorkIds,
    workError,
  };
}

/* ------------------------------------------------------------------------------------------------
 * The authority wrapper: a grant commit must not invalidate the binding it carries.
 * --------------------------------------------------------------------------------------------- */

/**
 * What the grant commit says about the work it authorises.
 *
 * THE PARADOX THIS SOLVES. A grant has authority only once committed, and it binds a subject commit.
 * The owner reviews the work at H0 and writes `subjectCommit: H0` — but committing that record
 * CREATES H1, so by the time the grant has authority, HEAD is no longer the commit it names. Bind the
 * run to HEAD and the grant refuses itself; the proof sequence is impossible, not merely awkward.
 * I proposed exactly that sequence and it could never have run.
 *
 * THE FIX IS TO READ THE COMMIT FOR WHAT IT IS: an authority WRAPPER around a work baseline. The
 * grant commit changes one thing — the grant — so its parent is still the work the owner reviewed.
 * The subject is therefore `parent(grantCommit)`, established from git rather than from anything the
 * grant or a caller says about itself.
 *
 * NOTHING IS WEAKENED TO ACHIEVE THAT, and the checks are the point:
 *   - HEAD must BE the grant commit. If history moved on, the work is no longer what was approved.
 *   - the grant commit must change the grant record and NOTHING else, so approval of H0 cannot
 *     silently carry code, config or governance smuggled into the same commit.
 *   - the grant's own `subjectCommit` must still equal the derived parent — that binding is untouched
 *     and is still checked by `checkDegradedModeGrant`.
 */
export type AuthorityWrapper =
  | { readonly kind: 'none'; readonly reason: string }
  | { readonly kind: 'invalid'; readonly problems: readonly string[] }
  | { readonly kind: 'wrapper'; readonly grantCommit: string; readonly subjectCommit: string };

const HEX40_SHA = /^[0-9a-f]{40}$/;

export interface AuthorityWrapperOptions {
  /**
   * Must HEAD still BE the authority commit?
   *
   * TRUE FOR DOING THE WORK, FALSE FOR REVIEWING IT AFTERWARDS. The run must happen at the baseline the
   * owner approved, so if history has moved the work is no longer the work that was approved. A
   * reconciliation asks about work that ALREADY happened, necessarily later, and by then HEAD has moved
   * on — often because the owner committed the very record being reconciled. Requiring HEAD there made
   * the documented remedy unreachable and the debt permanently undischargeable. The binding that
   * matters in both cases is the same and is unaffected: the grant commit and its parent.
   */
  readonly requireHeadAtGrant?: boolean;
}

export function authorityWrapper(
  sys: System,
  root: string,
  phaseId: string,
  grantId: string,
  options: AuthorityWrapperOptions = {},
): AuthorityWrapper {
  const rel = degradedGrantRelPath(phaseId, grantId);
  if (rel === null) return { kind: 'none', reason: `unsafe grant id '${grantId}'` };

  const logged = sys.exec('git', ['-C', root, 'log', '-1', '--format=%H', '--', rel]);
  const grantCommit = logged.code === 0 ? logged.stdout.trim() : '';
  // NOT AN ERROR. Before the owner commits anything there is no wrapper, and the run's own head is
  // the work subject — which is exactly the discovery run that tells the owner which outage to bind.
  if (!HEX40_SHA.test(grantCommit)) {
    return { kind: 'none', reason: `no committed grant '${grantId}' for phase ${phaseId}` };
  }

  const problems: string[] = [];

  // A MERGE CAN NEVER BE AN AUTHORITY WRAPPER, and this is checked first because every other check
  // below is unreliable on one. `git show --name-only` on a merge shows the DENSE COMBINED diff:
  // any path whose merged content matches one parent is suppressed entirely. So a merge whose only
  // conflicted path is the grant reports exactly one changed path — the grant — while arbitrary code
  // brought in cleanly from the second parent is invisible both to that check and to an owner
  // running `git show` on the same commit. `^` would then silently take parent 1 as a clean
  // baseline while the worker runs against a HEAD carrying the smuggled files. Found by adversarial
  // review; the count is read from `rev-list --parents`, which states the shape rather than
  // inferring it.
  const parents = sys.exec('git', ['-C', root, 'rev-list', '--parents', '-n', '1', grantCommit]);
  const parentCount = parents.code === 0 ? Math.max(0, parents.stdout.trim().split(/\s+/).filter((x) => x !== '').length - 1) : -1;
  if (parentCount !== 1) {
    problems.push(
      `the authority commit ${grantCommit.slice(0, 7)} has ${parentCount < 0 ? 'an unreadable number of' : parentCount} parent(s); ` +
        'an authority commit must be an ordinary single-parent commit, because a merge can hide ' +
        'changes from both this check and the owner reviewing it',
    );
  }

  const head = sys.exec('git', ['-C', root, 'rev-parse', 'HEAD']);
  const headSha = head.code === 0 ? head.stdout.trim() : '';
  if (options.requireHeadAtGrant !== false && headSha !== grantCommit) {
    problems.push(
      `the grant was committed as ${grantCommit.slice(0, 7)} but HEAD is ${headSha.slice(0, 7) || 'unreadable'}; ` +
        'history has moved past the authority commit, so the work is no longer the work that was approved',
    );
  }

  // ONE COMMIT, ONE RECORD. `--name-only` over the commit itself; anything beyond the grant means the
  // owner's approval of a baseline would also be carrying whatever else rode along with it.
  // `--no-renames`, so an ambient `diff.renames` cannot report a rename as a single path.
  const changed = sys.exec('git', ['-C', root, 'show', '--name-only', '--no-renames', '--format=', grantCommit]);
  const paths = changed.code === 0 ? changed.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '') : [];
  if (changed.code !== 0) {
    problems.push(`the paths changed by ${grantCommit.slice(0, 7)} could not be read, so it cannot be accepted as an authority commit`);
  } else if (paths.length !== 1 || paths[0] !== rel) {
    problems.push(
      `the authority commit ${grantCommit.slice(0, 7)} changes ${paths.length} path(s) (${paths.join(', ') || 'none'}); ` +
        `it must change exactly ${rel} and nothing else, or approval of the baseline would also authorise what rode with it`,
    );
  }

  const parent = sys.exec('git', ['-C', root, 'rev-parse', `${grantCommit}^`]);
  const subjectCommit = parent.code === 0 ? parent.stdout.trim() : '';
  if (!HEX40_SHA.test(subjectCommit)) {
    problems.push(`the authority commit ${grantCommit.slice(0, 7)} has no readable parent, so no work baseline can be established`);
  }

  if (problems.length > 0) return { kind: 'invalid', problems };
  return { kind: 'wrapper', grantCommit, subjectCommit };
}

/**
 * The commit the degraded work is judged against.
 *
 * `observedHead` when nothing has been committed yet — the discovery run — and the wrapper's parent
 * once the owner has committed the grant, so the same work has the same identity before and after
 * the authority commit. An INVALID wrapper resolves to null: it must refuse, never quietly fall back
 * to HEAD, because falling back is how a bundled code change or a moved HEAD would be waved through.
 */
export function degradedWorkSubject(
  sys: System,
  root: string,
  wrapper: AuthorityWrapper,
): { readonly subjectCommit: string | null; readonly problems: readonly string[] } {
  if (wrapper.kind === 'wrapper') return { subjectCommit: wrapper.subjectCommit, problems: [] };
  if (wrapper.kind === 'invalid') return { subjectCommit: null, problems: wrapper.problems };
  // NO WRAPPER YET — the discovery run. The subject is HEAD, read from git HERE rather than accepted
  // from a caller: the guarantee that a caller cannot name a subject should hold in both cases, not
  // only once a grant has been committed. Raised as an API-contract gap by adversarial review; it
  // was not reachable, because the one production caller passed an observed head, but a guarantee
  // that depends on a caller's discipline is a convention rather than a guarantee.
  const head = sys.exec('git', ['-C', root, 'rev-parse', 'HEAD']);
  const sha = head.code === 0 ? head.stdout.trim() : '';
  if (!HEX40_SHA.test(sha)) {
    return { subjectCommit: null, problems: ['the current HEAD could not be read, so no work subject can be established'] };
  }
  return { subjectCommit: sha, problems: [] };
}
