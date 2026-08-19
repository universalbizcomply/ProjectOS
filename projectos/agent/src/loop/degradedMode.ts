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
import { join } from 'node:path';
import type { System } from '../system.js';
import {
  checkDegradedModeGrant,
  degradedWorkRemaining,
  reconciliationState,
  type DegradedModeGrant,
  type DegradedWorkItem,
  type ReconciliationRecord,
  type ReconciliationState,
} from '@projectos/core';
import { loadDegradedModeGrant, isSafeGrantId } from './degradedModeGrants.js';

export const DEGRADED_STORE_SCHEMA_VERSION = '1.0.0';

/**
 * The identity of THIS outage.
 *
 * DERIVED, NOT ALLOCATED — the same reasoning as `deriveRequestId`. A counter or a timestamp would
 * produce a different id after a restart, so the grant the owner committed for this outage would no
 * longer answer it, and a resumed run would refuse work the owner had already accepted the risk for.
 * Hashing what the outage IS about makes its identity survive the process that observed it.
 *
 * The stop and the reasons are included deliberately: a reviewer that is unreachable for a different
 * stop, or for a different cause, is a different outage, and risk accepted for one is not risk
 * accepted for the other.
 */
export function deriveUnavailabilityId(input: {
  readonly projectId: string;
  readonly phaseId: string;
  readonly subjectCommit: string;
  readonly stopCode: string;
  readonly reasons: readonly string[];
}): string {
  const canonical = JSON.stringify([
    input.projectId,
    input.phaseId,
    input.subjectCommit,
    input.stopCode,
    [...input.reasons].sort(),
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
    const shown = sys.exec('git', ['-C', root, 'show', `HEAD:${rel}`]);
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
  return reconciliationState(
    stores.flatMap((r) => r.workItems),
    stores.flatMap((r) => r.reconciliations),
  );
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

export interface DegradedAuthorisationInput {
  readonly projectId: string;
  readonly phaseId: string;
  readonly subjectCommit: string;
  readonly unavailabilityId: string;
  readonly grantId: string;
  readonly recordedOwner: string;
  readonly ownerOnlyActions: readonly string[];
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
  const loaded = loadDegradedModeGrant(sys, root, input.phaseId, input.grantId);
  const problems = checkDegradedModeGrant(loaded.grant, {
    projectId: input.projectId,
    phaseId: input.phaseId,
    subjectCommit: input.subjectCommit,
    unavailabilityId: input.unavailabilityId,
    recordedOwner: input.recordedOwner,
    ownerOnlyActions: enforcedOwnerOnlyActions(input.ownerOnlyActions),
    alreadyConsumedGrantIds: consumedGrantIds(sys, root),
    // Established by the loader, from the read. Never asserted here.
    readFromCommittedTree: loaded.readFromCommittedTree,
  });

  const reasons = [...problems];
  // AN ABSENCE OF FACT IS NOT A FAVOURABLE FACT. If any use record cannot be read, this run cannot
  // establish how much of any grant is already spent, so it authorises nothing. Failing closed here
  // is what stops a truncated, corrupted or tampered store reading as "never used".
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
  const remaining = degradedWorkRemaining(
    { grantId: String(grant.grantId), maxWorkItems: Number(grant.maxWorkItems) },
    allDegradedWork(sys, root),
  );
  if (remaining <= 0) {
    return {
      authorised: false,
      reasons: [`grant ${String(grant.grantId)} has no work items left; its bound is already spent`],
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
  },
): ConsumptionResult {
  const grantId = String(input.grant.grantId ?? '');
  const path = degradedStorePath(root, grantId);
  if (path === null) return { persisted: false, workId: null, problem: `unsafe grant id '${grantId}'` };

  const existing = readDegradedStore(sys, root, grantId);
  const ordinal = (existing?.workItems.length ?? 0) + 1;
  const workId = deriveWorkId(grantId, input.unavailabilityId, ordinal);
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
export function committedGovernanceOwner(sys: System, root: string, planRelPath: string): string | null {
  const rel = planRelPath.split(String.fromCharCode(92)).join("/").replace(/^[.][/]/, "");
  const logged = sys.exec('git', ['-C', root, 'log', '-1', '--format=%H', '--', rel]);
  if (logged.code !== 0 || logged.stdout.trim().length === 0) return null;
  const dirty = sys.exec('git', ['-C', root, 'diff', '--name-only', 'HEAD', '--', rel]);
  if (dirty.code !== 0 || dirty.stdout.trim().length > 0) return null;
  const shown = sys.exec('git', ['-C', root, 'show', `HEAD:${rel}`]);
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
