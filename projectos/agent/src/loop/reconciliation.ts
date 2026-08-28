/**
 * Clearing degraded-mode debt — the half of the contract that was never built.
 *
 * WHAT EXISTED, AND WHAT DID NOT. `reconciliationState` has always been able to say that a degraded
 * work item is outstanding, and `gateBlockedByReconciliation` has always been able to turn that into a
 * refusal. `RECONCILIATION_ASK` was defined. But nothing in the agent ever SUBMITTED that ask, and
 * nothing ever wrote a `ReconciliationRecord` — so debt could be incurred and detected and never
 * discharged. A run that continued unreviewed on the owner's risk stayed permanently unreviewable.
 * This file is that missing half, and only that.
 *
 * WHAT THE BLOCK ACTUALLY DOES. `reconciliationDebtBlock` refuses two governed operations while a
 * degraded work item is unreviewed: a phase transition to a closure status, and an owner decision on a
 * gated or prohibited approval request. It does not gate every governed operation, and ProjectOS has
 * no governed commit or push operation to gate — raw `git commit` and `git push` are outside it and
 * are not prevented. The runner still PRINTS the block as well, which is where it used to stop.
 *
 * IT IS NOT A SECOND GOVERNANCE SYSTEM. The request identity, the transport, the decision schema, the
 * binding checks, the replay guard, the spend limit and the cost ledger are the ones the loop already
 * uses. What is new is a question the loop could not previously ask: not "may this phase proceed?",
 * but "this work already happened without you — may its debt be discharged?".
 *
 * THE SUBJECT IS THE WORK, NOT THE PHASE. A reconciliation is bound to one workId. A review that
 * blessed "the degraded period" without naming what it covered would let later unnamed work hide
 * inside an earlier blessing, which is the same skipped review in another shape — the reason
 * `reconciliationState` clears per item rather than per phase.
 *
 * WHAT BOUNDS IT IS THE COMMITTED GRANT. The use record is a runtime file, and under this project's
 * trust model (`tamperProof: false`) the implementer can write it. So the record is not trusted to say
 * how much work there was: the owner's COMMITTED grant is loaded and the record is refused unless it
 * agrees with it — same id, same project, same phase, same owner, same outage, and no more work items
 * than the owner authorised. That does not make a fabricated work item impossible; it makes the number
 * of them the owner's number, and the outage the owner's outage.
 *
 * FAIL CLOSED AT EVERY STEP. A transport failure, an unbound decision, a refused verdict or a failed
 * write all leave the debt exactly where it was. The only path that discharges anything is a real
 * decision that passed `checkGatekeeperDecision` against this exact work item, persisted and read
 * back. Nothing is discharged because this code believed it should be.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A for acceptance criterion 11.
 */
import type { System } from '../system.js';
import {
  authoriseRequestSpend,
  checkGatekeeperDecision,
  checkThreadBinding,
  estimateCostMicroUsd,
  estimateInputTokensFromText,
  gatekeeperRequestDigest,
  recordCall,
  reconciliationState,
  summariseLedger,
  RECONCILIATION_ASK,
  type BudgetPolicy,
  type GatekeeperRequest,
  type GovernanceThreadBinding,
  type LedgerEntry,
  type RateCard,
  type ReconciliationRecord,
} from '@projectos/core';
import { deriveRequestId, evidenceDigest } from './gatekeeperTurn.js';
import { submitToOpenAi } from './transports/openaiResponses.js';
import type { CredentialResolver } from './credentialResolver.js';
import type { HttpPort } from './transports/openaiResponses.js';
import type { BrokeredTransport } from './transports/brokeredHttpPort.js';
import {
  readDegradedStoreDetailed,
  degradedStorePath,
  degradedStoreIsRecordable,
  authorityWrapper,
  DEGRADED_STORE_SCHEMA_VERSION,
  type DegradedStoreRecord,
} from './degradedMode.js';
import { loadDegradedModeGrant } from './degradedModeGrants.js';
import { settleAsk, readDurableLedger, authoritativeState } from '../installation/degradedLedger.js';
import type { DurableBinding } from './degradedMode.js';

/**
 * The verdict that discharges a debt, and the only one.
 *
 * A reconciliation asks whether work that ALREADY HAPPENED may be accepted. `APPROVED_TO_PROCEED` is
 * the reviewer saying yes to exactly that. Every other verdict leaves the debt standing:
 * `AMENDMENT_REQUIRED` asks for more work rather than accepting what was done, `AWAITING_OWNER` hands
 * it back to the owner, `DO_NOT_PROCEED` refuses it outright, and the commit/push/closure approvals
 * answer a different question entirely — they would be a reviewer approving a GATE while the debt that
 * blocks that gate is still open.
 */
export const RECONCILIATION_ACCEPTED_VERDICT = 'APPROVED_TO_PROCEED';

export interface ReconciliationOutcome {
  readonly kind:
    | 'NO_SUCH_GRANT'
    | 'NOT_OUTSTANDING'
    | 'NO_SUBJECT'
    | 'NOT_RECORDABLE'
    | 'ALREADY_ASKED'
    | 'SPEND_REFUSED'
    | 'PREPARED'
    | 'UNAVAILABLE'
    | 'DECISION_REFUSED'
    | 'NOT_ACCEPTED'
    | 'PERSIST_FAILED'
    | 'RECONCILED';
  readonly reasons: readonly string[];
  readonly workId: string | null;
  readonly requestId: string | null;
  readonly decisionId: string | null;
  readonly verdict: string | null;
  /**
   * What the reviewer said, and what it asked for next.
   *
   * SURFACED BECAUSE THE FIRST REAL CALL RETURNED AMENDMENT_REQUIRED AND THE OWNER COULD NOT SEE WHY.
   * The verdict alone says the debt stands; it does not say what would discharge it. Both are the
   * reviewer's own words and are reported as such, never acted on by this route.
   */
  readonly reviewerReason: string | null;
  readonly reviewerInstruction: string | null;
  readonly ledgerEntry: LedgerEntry | null;
  readonly providerResponseId: string | null;
  /**
   * Whether the request definitely never left this machine.
   *
   * TRUE ONLY WHEN THAT IS KNOWN. A refused credential is known: nothing was sent. A transport error
   * after transmission, a non-200, or a 200 carrying an unusable body are all calls the provider may
   * well have billed — and the first version of this told the owner "nothing was spent" about all of
   * them, which is a comfortable claim the code had not checked.
   */
  readonly definitelyNotSent: boolean;
  /** Outstanding work ids after this attempt. Unchanged unless something was actually discharged. */
  readonly outstandingAfter: readonly string[];
}

function outcome(
  kind: ReconciliationOutcome['kind'],
  reasons: readonly string[],
  over: Partial<ReconciliationOutcome> = {},
): ReconciliationOutcome {
  return {
    kind,
    reasons,
    workId: null,
    requestId: null,
    decisionId: null,
    verdict: null,
    reviewerReason: null,
    reviewerInstruction: null,
    ledgerEntry: null,
    providerResponseId: null,
    definitelyNotSent: true,
    outstandingAfter: [],
    ...over,
  };
}

export interface ReconciliationInput {
  readonly projectId: string;
  readonly phaseId: string;
  readonly grantId: string;
  /** Which debt to discharge. Named explicitly: one review clears one item, never "the period". */
  readonly workId: string;
  readonly expectedDecider: string;
  readonly ownerOnlyActions: readonly string[];
  readonly at: string;
  /** The owner the plan names, so the grant's `grantedBy` is checked rather than believed. */
  readonly recordedOwner: string;
  /** Run every check and stop before the call. Nothing is sent, spent, or written. */
  readonly prepareOnly?: boolean;
  /**
   * The installation's durable record — the one a discharge must actually update.
   *
   * The project-local record is evidence. Clearing a debt there and nowhere else would leave the
   * debt standing everywhere that matters, and the gate would go on refusing.
   */
  readonly durable: DurableBinding;
}

export interface ReconciliationDeps {
  readonly transport: {
    readonly model: string;
    readonly credentialRef: string;
    readonly transportId: string;
    readonly timeoutMs?: number;
  };
  readonly resolver: CredentialResolver;
  readonly http: HttpPort;
  /**
   * The trusted installation-side transport, when composed.
   *
   * With it, the credential is never resolved in this process — the broker decides, resolves and
   * calls, and the resolver above is the refusing one.
   */
  readonly broker?: {
    readonly transport: BrokeredTransport;
    readonly governedRoot: string;
    /** The installation's committed policy on spending for this project. Asked before the broker
     *  is invoked, so a refusal is knowably a call that was never made. */
    readonly installationAllows?: () => { readonly allowed: boolean; readonly reasons: readonly string[] };
  };
  readonly rate: RateCard;
  readonly budget: BudgetPolicy;
  readonly ledger: readonly LedgerEntry[];
  readonly threadBinding: GovernanceThreadBinding | null;
  readonly repositoryRoot: string;
  readonly decidedBy: string;
  readonly consumedDecisionIds: readonly string[];
  /**
   * Record the cost the moment the call returns, before anything durable is written.
   *
   * THE CALL IS THE SPEND, and the spend must be recorded even if everything after it fails. When the
   * caller appended the entry from the returned outcome instead, a throw between the two lost the
   * ledger line — and with it the replay guard for that decision, which is derived from the ledger.
   */
  readonly recordSpend: (entry: LedgerEntry) => void;
  /**
   * Close out the reservation admission made, when the call produced no answer (C11-W2-F6/F8).
   *
   * This route reserves before it asks, exactly as the loop does, so it needs the same close-out or a
   * failed attempt leaves a charge standing for a call that never happened — and, once the retry gate
   * consults the installation record, a question that can never be put again.
   */
  /** Release a reservation for a call this attempt is refusing before any dispatch is possible. */
  readonly releaseUndispatched?: (requestId: string) => void;
  readonly resolveSpend?: (
    request: { readonly requestId: string; readonly projectId: string; readonly phaseId: string },
    cause: string,
  ) => void;
  /** Serialised budget admission; see the note in gatekeeperTurn.ts. */
  readonly admitSpend?: (request: {
    readonly requestId: string;
    readonly projectId: string;
    readonly phaseId: string;
    readonly model: string;
    readonly estimateMicroUsd: number;
    readonly at: string;
  }) => { readonly allowed: boolean; readonly reasons: readonly string[] };
}

/**
 * What the reviewer is shown: the work item as recorded, plus an honest account of what that record is.
 *
 * NO FREE-TEXT PARAMETER, WHICH IS NOT THE SAME AS TRUSTED INPUT. There is no way for a caller to
 * describe the work in its own words — every field is read from the durable store the runtime wrote.
 * But that store is a working-tree file until the owner commits it, and under `tamperProof: false` the
 * implementer can write it, so the summary the reviewer reads is a claim rather than proof. The
 * evidence says so in as many words rather than presenting itself as verified.
 *
 * ENCODED FIELD BY FIELD, not by spreading the parsed object. `JSON.stringify` preserves key order, so
 * a record whose keys were reordered would hash differently and become a different question about the
 * same work — the same reasoning `gatekeeperRequestDigest` gives for not hashing a raw object.
 */
function evidenceFor(
  store: DegradedStoreRecord,
  workId: string,
  provenance: string,
  /** The owner's committed ceiling. NOT the record's claim about it: a rebuilt record has none. */
  maxWorkItems: number,
): string {
  const item = store.workItems.find((w) => w.workId === workId) ?? null;
  return JSON.stringify(
    {
      question:
        'This degraded-mode work item already executed while you were unreachable, under an owner ' +
        'risk acceptance. Review it now and decide whether its reconciliation may be accepted.',
      grant: {
        grantId: store.grantId,
        unavailabilityId: store.unavailabilityId,
        projectId: store.projectId,
        phaseId: store.phaseId,
        maxWorkItems,
        consumedAt: store.consumedAt,
      },
      workItem:
        item === null
          ? null
          : {
              workId: item.workId,
              grantId: item.grantId,
              phaseId: item.phaseId,
              summary: item.summary,
              at: item.at,
            },
      allWorkItemsUnderThisGrant: store.workItems.map((w) => w.workId),
      alreadyReconciled: store.reconciliations.map((r) => ({
        workId: r.workId,
        decisionId: r.decisionId,
        accepted: r.decisionAccepted,
      })),
      recordProvenance: provenance,
      note:
        'The work is done and cannot be undone by this decision. Accepting discharges the review ' +
        'debt it incurred; refusing leaves the debt outstanding. ' +
        'If you accept, nextClaudeInstruction must say what happens next — an accepting verdict with ' +
        'no instruction is refused by the runtime and the debt stands.',
    },
    null,
    1,
  );
}

/**
 * Append one accepted reconciliation, then prove it is really there.
 *
 * RE-READ, NEVER REWRITE A SNAPSHOT. The store read before the call is old by the time a decision comes
 * back, and a degraded run in another process may have appended a work item in between. Writing the old
 * snapshot back would delete that item — and with it the record of unreviewed work — while the
 * read-back happily compared the file against the snapshot it had just written. So the record is read
 * again here, the append is made to THOSE bytes, and the verification compares against the freshly read
 * state rather than against the caller's memory of it.
 *
 * WRITTEN ATOMICALLY. A torn write leaves a record that cannot be parsed, and an unparseable record
 * drops out of `readAllDegradedStores` — taking the outstanding debt with it. The temporary-file and
 * rename pattern is the one `appendLedger` adopted after the loop reported the same hazard as GK-SEC-001.
 */
function persistReconciliation(
  sys: System,
  root: string,
  grantId: string,
  record: ReconciliationRecord,
): { readonly persisted: boolean; readonly problem: string | null } {
  const path = degradedStorePath(root, grantId);
  if (path === null) return { persisted: false, problem: `unsafe grant id '${grantId}'` };

  // RE-CHECKED HERE, not only before the call. The owner may have committed the record while the
  // reviewer was thinking, and writing over committed evidence corrupts it permanently.
  const recordable = degradedStoreIsRecordable(sys, root, grantId);
  if (recordable !== null) return { persisted: false, problem: recordable };

  const fresh = readDegradedStoreDetailed(sys, root, grantId);
  if (fresh.kind !== 'ok') {
    return { persisted: false, problem: 'the degraded-use record could not be re-read before writing' };
  }
  const current = fresh.record;
  if (current.reconciliations.some((r) => r.workId === record.workId)) {
    return { persisted: false, problem: `work item ${record.workId} was reconciled by another process` };
  }

  const next: DegradedStoreRecord = {
    ...current,
    schemaVersion: current.schemaVersion === '' ? DEGRADED_STORE_SCHEMA_VERSION : current.schemaVersion,
    reconciliations: [...current.reconciliations, record],
  };
  const temporary = `${path}.tmp`;
  try {
    sys.writeText(temporary, `${JSON.stringify(next, null, 2)}\n`);
  } catch (error: unknown) {
    return {
      persisted: false,
      problem: `the reconciliation could not be written: ${error instanceof Error ? error.message : 'write failed'}`,
    };
  }
  const moved = sys.renameFile(temporary, path);
  if (!moved) {
    return {
      persisted: false,
      problem: 'the reconciliation could not be recorded atomically; the previous record is unchanged',
    };
  }

  // `writeText` reports nothing, so a silent no-op would be indistinguishable from success.
  const readBack = readDegradedStoreDetailed(sys, root, grantId);
  if (readBack.kind !== 'ok') {
    return { persisted: false, problem: 'the degraded-use record could not be read back after writing' };
  }
  const after = readBack.record;
  const found = after.reconciliations.some(
    (r) => r.workId === record.workId && r.decisionId === record.decisionId && r.decisionAccepted === true,
  );
  if (!found) {
    return { persisted: false, problem: 'the accepted reconciliation is absent from the record after writing' };
  }

  // THE HISTORY IS COMPARED FIELD BY FIELD against what was on disk a moment ago. An earlier version
  // compared only the NUMBER of work items, and against the stale snapshot it had just written back —
  // a check that could not fail for the case it named.
  const sameWork =
    after.workItems.length === current.workItems.length &&
    after.workItems.every((w, i) => w.workId === current.workItems[i]?.workId);
  const sameGrant =
    after.grantId === current.grantId &&
    after.unavailabilityId === current.unavailabilityId &&
    after.projectId === current.projectId &&
    after.phaseId === current.phaseId &&
    after.consumedAt === current.consumedAt &&
    after.maxWorkItems === current.maxWorkItems;
  if (!sameWork || !sameGrant) {
    return { persisted: false, problem: 'the record of what happened changed while recording a reconciliation' };
  }
  const keptEarlier = current.reconciliations.every((r) =>
    after.reconciliations.some((x) => x.workId === r.workId && x.decisionId === r.decisionId),
  );
  if (!keptEarlier) {
    return { persisted: false, problem: 'an earlier reconciliation was lost while recording this one' };
  }
  return { persisted: true, problem: null };
}

/** What the reviewer is told about where the record came from. Fixed strings: they are hashed. */
const MIRROR_PROVENANCE =
  'working tree, not yet committed — written by the runtime, but writable by the implementer, ' +
  'so treat the summary as a claim rather than as proof';
const LEDGER_PROVENANCE =
  "the installation's own durable ledger, outside this repository and outside the implementer's reach; " +
  'the project-local mirror of this work is absent';

/**
 * Rebuild one grant's degraded work from the installation ledger.
 *
 * The ledger holds every field the review needs — phase, outage, work id, summary, time — because each
 * spend was bound to all of them when it was made. What it does not hold is the mirror's own claimed
 * ceiling, and it does not need to: the owner's committed grant states that, and the grant is the
 * authority the mirror was checked against anyway.
 *
 * ONE OUTAGE, ONE PHASE. Entries for a single grant that disagree about either are not a set this
 * function may summarise into one question, so it refuses rather than picking one.
 */
function storeFromInstallationLedger(
  sys: System,
  input: ReconciliationInput,
): { readonly record: DegradedStoreRecord | null; readonly problem: string | null; readonly refuse: boolean } {
  const led = readDurableLedger(sys, input.durable.stateDir);
  if (led.kind === 'corrupt') {
    return {
      record: null,
      refuse: true,
      problem:
        `${led.why}; with no project mirror and an unreadable installation ledger there is no record ` +
        'of this work to review',
    };
  }
  const none = {
    record: null,
    refuse: false,
    problem:
      `no degraded-use record exists for grant '${input.grantId}' in this project, and this ` +
      'installation has recorded no spend under it either, so it has no debt to discharge',
  };
  if (led.kind === 'absent') return none;

  // A ROW THAT NAMES THIS PROJECT AND DISAGREES IS A REFUSAL, NOT A MISS.
  //
  // Filtering it out and then reporting "no debt to discharge" is the shape both earlier bypasses
  // had: `git remote set-url` to rename the project out of its own debt, or `cp -r` the installation
  // so its rows no longer match. `authoritativeState` refuses on exactly this and says so; this path
  // must not answer the same question differently, least of all with an authoritative-sounding "no".
  //
  // The reads are guarded because `parse` validates no field: a row written by an earlier build
  // carries no `installRoot`, and dereferencing it turned a refusal into a crash out of the gate.
  const claiming = led.ledger.consumptions.filter(
    (c) => c.projectId === input.projectId && c.grantId === input.grantId,
  );
  const disagreeing = claiming.filter(
    (c) =>
      String(c.installRoot ?? '').toLowerCase() !== input.durable.installRoot.toLowerCase() ||
      String(c.repository ?? '').toLowerCase() !== input.durable.repository.toLowerCase(),
  );
  if (disagreeing.length > 0) {
    const first = disagreeing[0];
    return {
      record: null,
      refuse: true,
      problem:
        `this machine records grant '${input.grantId}' for project '${input.projectId}' at ` +
        `${String(first?.repository ?? 'another repository')} under installation ` +
        `${String(first?.installRoot ?? 'unknown')}, but this run reports ` +
        `${input.durable.repository} under ${input.durable.installRoot}; whether that work is this ` +
        'run\'s to discharge is not something the project or a second copy of the installation decides',
    };
  }
  const mine = claiming;
  if (mine.length === 0) return none;

  const outages = new Set(mine.map((c) => c.unavailabilityId));
  const phases = new Set(mine.map((c) => c.phaseId));
  if (outages.size !== 1 || phases.size !== 1) {
    return {
      record: null,
      refuse: true,
      problem:
        `the installation ledger records grant '${input.grantId}' against more than one outage or ` +
        'phase, which is not a coherent set of work to put to a reviewer',
    };
  }
  const discharged = led.ledger.reconciliations.filter(
    (r) =>
      String(r.installRoot ?? '').toLowerCase() === input.durable.installRoot.toLowerCase() &&
      r.projectId === input.projectId &&
      String(r.repository ?? '').toLowerCase() === input.durable.repository.toLowerCase() &&
      r.grantId === input.grantId,
  );
  const first = mine[0] as (typeof mine)[number];
  return {
    record: {
      schemaVersion: DEGRADED_STORE_SCHEMA_VERSION,
      grantId: input.grantId,
      unavailabilityId: first.unavailabilityId,
      projectId: input.projectId,
      phaseId: first.phaseId,
      consumedAt: first.consumedAt,
      // NO CLAIMED CEILING. The committed grant states it; see the caller.
      maxWorkItems: -1,
      workItems: mine.map((c) => ({
        workId: c.workId,
        grantId: c.grantId,
        phaseId: c.phaseId,
        summary: c.summary,
        at: c.consumedAt,
      })),
      reconciliations: discharged.map((r) => ({
        workId: r.workId,
        decisionId: r.decisionId,
        ask: r.ask,
        decisionAccepted: true,
      })),
    },
    problem: null,
    refuse: false,
  };
}

/**
 * Ask the reviewer to discharge one degraded work item, and record the answer if it says yes.
 *
 * The ordering is the safety property: the debt is only ever cleared by a decision that already exists,
 * is already bound to this work, and is already persisted. There is no path from this function to a
 * discharged debt that skips any of those.
 */
export function reconcileDegradedWork(
  sys: System,
  root: string,
  input: ReconciliationInput,
  deps: ReconciliationDeps,
): ReconciliationOutcome {
  const read = readDegradedStoreDetailed(sys, root, input.grantId);
  if (read.kind === 'corrupt') {
    return outcome('NO_SUCH_GRANT', [
      read.why,
      'an unreadable use record cannot be reconciled, and its outstanding debt cannot be read either — ' +
        'that is not evidence there is none',
    ]);
  }
  // THE MIRROR IS OPTIONAL; THE INSTALLATION LEDGER IS NOT.
  //
  // The project-local record is a mirror by design — deletable, and deleted by the very act the durable
  // ledger exists to survive. Refusing to reconcile without it made the debt UNDISCHARGEABLE after a
  // `rm`: the ledger still blocked every gate, and the only mechanism that could clear it insisted on
  // the file that was gone. So when the mirror is absent the work is rebuilt from the ledger, which is
  // the authority in either case. An UNREADABLE mirror still refuses, above: absent is a fact, corrupt
  // is a question.
  //
  // AND NOT ONLY WHEN IT IS ABSENT. The rebuild used to be all-or-nothing, which left a worse state
  // reachable than the one it fixed: delete the mirror, spend again, and the mirror comes back holding
  // ONLY the second item. The first is then durable-only, the gate blocks on it forever, and this
  // command — seeing a mirror that exists — reports "grant records no work item", which is a flat
  // contradiction of the refusal the operator is staring at. So the mirror is used when it actually
  // records the work being asked about, and the ledger is used when it does not.
  const mirrorRecord = read.kind === 'ok' ? read.record : null;
  const mirrorHasWork =
    mirrorRecord !== null && mirrorRecord.workItems.some((w) => w.workId === input.workId);
  const rebuilt = mirrorHasWork ? null : storeFromInstallationLedger(sys, input);
  // A LEDGER THAT REFUSES OVERRULES BOTH RECORDS; a ledger that simply has nothing does not. When the
  // ledger holds no such spend and a mirror exists, the mirror still gets to answer — and it answers
  // `NOT_OUTSTANDING` naming the work item, which is more use to a reader than "no such grant".
  if (rebuilt !== null && rebuilt.refuse) {
    return outcome('NO_SUCH_GRANT', [rebuilt.problem ?? 'the installation ledger cannot be read for this grant'], {
      workId: input.workId,
    });
  }
  if (rebuilt !== null && rebuilt.record === null && mirrorRecord === null) {
    return outcome('NO_SUCH_GRANT', [rebuilt.problem ?? 'the installation ledger records no such spend'], {
      workId: input.workId,
    });
  }
  const fromLedger = rebuilt !== null && rebuilt.record !== null;
  const store = fromLedger ? (rebuilt?.record as DegradedStoreRecord) : (mirrorRecord as DegradedStoreRecord);

  // THE RECORD MUST BE THE ONE ASKED ABOUT. A record for another project, phase or grant describes
  // other work, and clearing it here would discharge a debt nobody reviewed.
  const bindingProblems: string[] = [];
  if (store.grantId !== input.grantId) {
    bindingProblems.push(`the use record names grant '${store.grantId}', not '${input.grantId}'`);
  }
  if (store.projectId !== input.projectId) {
    bindingProblems.push(`the use record is for project '${store.projectId}', not '${input.projectId}'`);
  }
  if (store.phaseId !== input.phaseId) {
    bindingProblems.push(`the use record is for phase '${store.phaseId}', not '${input.phaseId}'`);
  }
  if (bindingProblems.length > 0) return outcome('NO_SUCH_GRANT', bindingProblems, { workId: input.workId });

  // THE OWNER'S COMMITTED GRANT BOUNDS WHAT MAY BE RECONCILED.
  //
  // Without this the reconcilable set was whatever the use record said, and the use record is a
  // working-tree file: an implementer could invent work items and buy each of them a real review. The
  // grant is read from the git object store, and the record is refused unless it agrees with it. The
  // full run-path check is deliberately NOT reused — it refuses a grant that has already been consumed,
  // which every reconcilable grant has been, by definition.
  const loaded = loadDegradedModeGrant(sys, root, input.phaseId, input.grantId);
  const grant = loaded.grant;
  if (grant === null || loaded.readFromCommittedTree !== true) {
    return outcome(
      'NO_SUCH_GRANT',
      [
        `no COMMITTED owner grant '${input.grantId}' exists for phase ${input.phaseId}, so nothing ` +
          'bounds what may be reconciled under it',
        ...(loaded.uncommittedGrantOnDisk === null
          ? []
          : ['a grant exists in the working tree, and an uncommitted grant is not an owner decision']),
      ],
      { workId: input.workId },
    );
  }
  const grantMax = typeof grant.maxWorkItems === 'number' ? grant.maxWorkItems : -1;
  const grantProblems: string[] = [];
  if (String(grant.grantId ?? '') !== input.grantId) {
    grantProblems.push(`the committed grant names itself '${String(grant.grantId ?? '')}', not '${input.grantId}'`);
  }
  if (String(grant.projectId ?? '') !== input.projectId) {
    grantProblems.push(`the committed grant is for project '${String(grant.projectId ?? '')}'`);
  }
  if (String(grant.phaseId ?? '') !== input.phaseId) {
    grantProblems.push(`the committed grant is for phase '${String(grant.phaseId ?? '')}'`);
  }
  if (String(grant.grantedBy ?? '') !== input.recordedOwner) {
    grantProblems.push(
      `the committed grant was granted by '${String(grant.grantedBy ?? '')}', who is not the recorded owner ` +
        `'${input.recordedOwner}'`,
    );
  }
  if (String(grant.unavailabilityId ?? '') !== store.unavailabilityId) {
    grantProblems.push(
      `the use record answers outage '${store.unavailabilityId}', but the grant was given for ` +
        `'${String(grant.unavailabilityId ?? '')}' — risk accepted for one outage is not risk accepted for another`,
    );
  }
  if (grantMax < 0) {
    grantProblems.push('the committed grant states no numeric work-item ceiling');
  } else if (store.workItems.length > grantMax) {
    grantProblems.push(
      `the use record lists ${store.workItems.length} work item(s) under a grant the owner bounded at ` +
        `${grantMax}; the excess was never authorised and cannot be reviewed as though it had been`,
    );
  } else if (!fromLedger && store.maxWorkItems !== grantMax) {
    // Only when there IS a mirror. Rebuilt-from-ledger work carries no claimed ceiling of its own, so
    // there is nothing to disagree with the grant — the count check above still bounds it.
    grantProblems.push(
      `the use record claims a ceiling of ${store.maxWorkItems} where the owner's grant says ${grantMax}`,
    );
  }
  if (grantProblems.length > 0) return outcome('NO_SUCH_GRANT', grantProblems, { workId: input.workId });

  const before = reconciliationState(store.workItems, store.reconciliations);
  if (!before.outstandingWorkIds.includes(input.workId)) {
    const known = store.workItems.some((w) => w.workId === input.workId);
    return outcome(
      'NOT_OUTSTANDING',
      [
        known
          ? `work item '${input.workId}' has no outstanding reconciliation debt; it is already reconciled`
          : `grant '${input.grantId}' records no work item '${input.workId}'`,
      ],
      { workId: input.workId, outstandingAfter: before.outstandingWorkIds },
    );
  }

  // WHAT THIS INSTALLATION HAS ALREADY ASKED. Read before anything is spent, and an unreadable
  // ledger refuses rather than reading as "never asked".
  const durableView = authoritativeState(sys, input.durable.stateDir, {
    installRoot: input.durable.installRoot,
    projectId: input.projectId,
    repository: input.durable.repository,
  });
  if (!durableView.readable) {
    return outcome(
      'NO_SUCH_GRANT',
      [
        durableView.problem ?? 'the installation degraded ledger could not be read',
        'whether this question has already been put cannot be established, and an unreadable record ' +
          'is never read as "never asked"',
      ],
      { workId: input.workId, outstandingAfter: before.outstandingWorkIds },
    );
  }
  const asked = durableView.askedWorkIds;

  // NOTHING IS PAID FOR THAT CANNOT BE RECORDED. Once the owner has committed the use record, the
  // committed bytes are authoritative and any working-tree edit of them reads as tampering — so
  // appending would both fail and leave the checkout unable to read its own degraded history. Checked
  // before the call, because discovering it afterwards means a real decision was bought and discarded.
  // ONLY WHEN A MIRROR WRITE IS ACTUALLY COMING. A ledger-backed discharge appends to nothing in the
  // project, so a committed mirror is no obstacle to it — refusing there would strand a debt behind a
  // file this path never touches.
  const recordable = fromLedger ? null : degradedStoreIsRecordable(sys, root, input.grantId);
  if (recordable !== null) {
    return outcome('NOT_RECORDABLE', [recordable], {
      workId: input.workId,
      outstandingAfter: before.outstandingWorkIds,
    });
  }

  // THE SUBJECT IS THE WORK'S OWN BASELINE, AND IT IS A COMMIT.
  //
  // The outage id names WHY the reviewer was absent; it names no bytes, and `checkGatekeeperDecision`
  // requires a 40-hex subject precisely so a decision can never be bound to something unversioned. The
  // bytes this work was done over are the authority wrapper's parent — the reviewed baseline the owner
  // committed the grant on top of — so the wrapper is recomputed from git rather than remembered.
  // `requireHeadAtGrant: false` because a reconciliation happens AFTER the work, when HEAD has
  // necessarily moved on; the grant commit and its parent are unaffected by that.
  const wrapper = authorityWrapper(sys, root, input.phaseId, input.grantId, { requireHeadAtGrant: false });
  if (wrapper.kind !== 'wrapper') {
    return outcome(
      'NO_SUBJECT',
      [
        'the committed authority wrapper for this grant could not be established, so the bytes this ' +
          'work was reviewed against cannot be named',
        ...(wrapper.kind === 'none' ? [wrapper.reason] : wrapper.problems),
      ],
      { workId: input.workId, outstandingAfter: before.outstandingWorkIds },
    );
  }

  // THE EXISTING WORDING IS LOAD-BEARING. The request id is derived from a digest of this text, and
  // `ALREADY_ASKED` refuses a repeat by that id — so changing the words a mirror-backed question uses
  // would make an already-answered question look new and reopen it to a second, better-liked answer.
  const evidenceText = evidenceFor(
    store,
    input.workId,
    fromLedger ? LEDGER_PROVENANCE : MIRROR_PROVENANCE,
    grantMax,
  );
  const digest = evidenceDigest(evidenceText);
  const subjectCommit = wrapper.subjectCommit;

  const requestId = deriveRequestId({
    projectId: input.projectId,
    phaseId: input.phaseId,
    subjectCommit,
    ask: RECONCILIATION_ASK,
    evidenceDigest: digest,
  });
  const request: GatekeeperRequest = {
    schemaVersion: '1.0.0',
    requestId,
    projectId: input.projectId,
    phaseId: input.phaseId,
    subjectCommit,
    ask: RECONCILIATION_ASK,
    evidenceDigests: [digest],
    ownerOnlyActions: input.ownerOnlyActions,
  };

  // ASKED ONCE, AND THE WORK ITEM IS WHAT WAS ASKED ABOUT.
  //
  // This guard used to key ONLY on the request id below, which is derived from a digest of the
  // evidence text — so any change to that text made the same question look new. Two lenses of the
  // 2026-08-21 review found the same working exploit: the ledger-backed and mirror-backed wordings
  // differ, the record they are built from is chosen by whether a DELETABLE project file exists, so
  // `rm` the mirror after an unwelcome verdict and the identical question could be put again. The
  // durable record now names the work item, and the wording cannot argue with it.
  if (asked.includes(input.workId)) {
    return outcome(
      'ALREADY_ASKED',
      [
        `this installation has already put work item '${input.workId}' to the gatekeeper and recorded ` +
          'the answer',
        'the work is history and cannot change, so asking again would be the same question in the hope ' +
          'of a different answer — including after deleting the project record of it',
        "if that answer left the debt outstanding, resolving it is the owner's decision, not a retry",
      ],
      { workId: input.workId, requestId, outstandingAfter: before.outstandingWorkIds },
    );
  }
  if (deps.consumedDecisionIds.includes(`GKDEC-${requestId}`)) {
    return outcome(
      'ALREADY_ASKED',
      [
        `this exact question has already been put to the gatekeeper (request ${requestId}) and answered`,
        'the evidence is history and cannot change, so asking again would be the same question in the ' +
          'hope of a different answer; the recorded answer stands',
        "if that answer left the debt outstanding, resolving it is the owner's decision, not a retry",
      ],
      { workId: input.workId, requestId, outstandingAfter: before.outstandingWorkIds },
    );
  }

  // THE CONVERSATION MUST BE THIS PROJECT'S. The loop refuses to speak to a reviewer bound to another
  // project or another checkout before it opens a socket; so does this.
  const threadProblems = checkThreadBinding(deps.threadBinding, {
    projectId: input.projectId,
    repositoryRoot: deps.repositoryRoot,
    transportId: deps.transport.transportId,
  });
  if (threadProblems.length > 0) {
    return outcome('NO_SUCH_GRANT', ['the governance thread binding does not cover this call', ...threadProblems], {
      workId: input.workId,
      requestId,
      outstandingAfter: before.outstandingWorkIds,
    });
  }

  // A CALL THAT CANNOT HAPPEN IS NOT PAID FOR, AND ITS RESERVATION IS RELEASED (C11-W2-F8).
  //
  // Asked before admission for the same reason the loop asks it there: no estimate is reserved for a
  // call the installation will not permit, and it is the only moment at which a reservation left by an
  // earlier attempt can be released — admission would otherwise refuse this request first, and the
  // transport, where the refusal is classified, would never be reached.
  const policy = deps.broker?.installationAllows?.();
  if (policy !== undefined && !policy.allowed) {
    // The narrow release: refused before anything could be dispatched, so the reservation for the
    // identical question is a charge for a call nobody made.
    deps.releaseUndispatched?.(requestId);
    return outcome(
      'UNAVAILABLE',
      [
        'this installation does not authorise the governed project to spend its credential, so no ' +
          'request was made',
        ...policy.reasons,
      ],
      {
        workId: input.workId,
        requestId,
        definitelyNotSent: true,
        outstandingAfter: before.outstandingWorkIds,
      },
    );
  }

  // THE SPEND LIMIT APPLIES HERE TOO. A limit tested only after the money is gone is a report, not a
  // stop — and this route was the one entry point that could spend without asking.
  const estimate = estimateCostMicroUsd(
    // UTF-8 bytes through the one conservative estimator — not UTF-16 length divided by four.
    { inputTokens: estimateInputTokensFromText(evidenceText), outputTokens: 800 },
    deps.rate,
  );
  const totals = summariseLedger(deps.ledger, {
    projectId: input.projectId,
    phaseId: input.phaseId,
    month: input.at.slice(0, 7),
  });
  // Same admission rule as the ordinary turn: reconciliation makes a billable call too, and a run
  // alongside a reconcile is exactly one of the concurrent pairs C17-F1 described.
  const spend =
    deps.admitSpend === undefined
      ? authoriseRequestSpend(estimate, totals, deps.budget)
      : deps.admitSpend({
          requestId,
          projectId: input.projectId,
          phaseId: input.phaseId,
          model: deps.rate.model,
          estimateMicroUsd: estimate,
          at: input.at,
        });
  if (!spend.allowed) {
    return outcome(
      'SPEND_REFUSED',
      ['the ProjectOS spend limit refused this call before it was made', ...spend.reasons],
      { workId: input.workId, requestId, outstandingAfter: before.outstandingWorkIds },
    );
  }

  if (input.prepareOnly === true) {
    // A REHEARSAL MUST NOT LEAVE A CHARGE BEHIND. Admission has just reserved the estimate — it runs
    // before this branch precisely so a rehearsal is judged under the same ceiling as a real call —
    // and this attempt is about to end without dispatching anything. Releasing it here is the same
    // attempt releasing what it created, with no dispatch possible in between. Without this a dry run
    // left a reservation that the next real attempt then refused as unaskable, which is exactly how
    // the C11 witness lost its first one-call authorisation.
    deps.releaseUndispatched?.(requestId);
    return outcome(
      'PREPARED',
      [
        `every check passed; asking would send request ${requestId} about ${subjectCommit.slice(0, 7)}`,
        `estimated cost ~${estimate} micro-USD at ${deps.rate.model}`,
        'nothing was sent, nothing was spent and nothing was written',
      ],
      { workId: input.workId, requestId, outstandingAfter: before.outstandingWorkIds },
    );
  }

  const sent = submitToOpenAi(
    request,
    evidenceText,
    {
      model: deps.transport.model,
      decidedBy: deps.decidedBy,
      credentialRef: deps.transport.credentialRef,
      previousResponseId: null,
      ...(deps.broker === undefined
        ? {}
        : {
            broker: {
              transport: deps.broker.transport,
              governedRoot: deps.broker.governedRoot,
              projectId: input.projectId,
              phaseId: input.phaseId,
              // FORWARDED, so this route classifies a pre-dispatch refusal the same way the loop does
              // (C11-W2-F8). Without it the installation's own refusal to spend on this project came
              // back as PROVIDER_UNAVAILABLE — a cause that may have been dispatched — and the
              // reservation was retained for a call that provably never happened.
              ...(deps.broker.installationAllows === undefined
                ? {}
                : { installationAllows: deps.broker.installationAllows }),
            },
          }),
      ...(deps.transport.timeoutMs === undefined ? {} : { timeoutMs: deps.transport.timeoutMs }),
    },
    deps.resolver,
    deps.http,
  );

  if (sent.kind === 'unavailable') {
    deps.resolveSpend?.({ requestId, projectId: input.projectId, phaseId: input.phaseId }, sent.cause);
    return outcome('UNAVAILABLE', sent.reasons, {
      workId: input.workId,
      requestId,
      // Only a cause that proves the request never left this machine may be treated as unbilled.
      // A credential that never resolved is one; so is the installation refusing to spend on this
      // project at all, which is decided before anything is sent. Everything else — a socket error, a
      // non-200, a 200 with an unusable body — may have been billed.
      definitelyNotSent: sent.cause === 'CREDENTIAL_UNAVAILABLE' || sent.cause === 'TRANSPORT_NOT_APPROVED',
      outstandingAfter: before.outstandingWorkIds,
    });
  }

  // The call happened, so it is paid for whether or not the answer is usable — and it is recorded
  // before anything else can fail.
  const ledgerEntry = recordCall({
    requestId,
    projectId: input.projectId,
    phaseId: input.phaseId,
    usage: sent.usage,
    rate: deps.rate,
    at: input.at,
  });
  deps.recordSpend(ledgerEntry);

  // THE QUESTION THAT WAS PUT, ready to be written down with whatever it settled.
  //
  // A call that happened and was not recorded is a call that can be made again, so this is written
  // whatever the verdict turns out to be — but it is written in the SAME lock acquisition as the
  // discharge it may authorise. Two acquisitions meant the ask could land and the discharge then be
  // refused for lock contention, leaving an accepted, paid-for decision discarded and its work item
  // permanently unaskable. Found by the second adversarial review, 2026-08-21.
  const ask = {
    installRoot: input.durable.installRoot,
    projectId: input.projectId,
    repository: input.durable.repository,
    grantId: input.grantId,
    workId: input.workId,
    requestId,
    decisionId: String(sent.record.decisionId ?? ''),
    verdict: String(sent.record.decision ?? ''),
    at: input.at,
  };

  const shared = {
    workId: input.workId,
    requestId,
    decisionId: String(sent.record.decisionId),
    verdict: String(sent.record.decision),
    reviewerReason: typeof sent.record.reason === 'string' ? sent.record.reason : null,
    reviewerInstruction:
      typeof sent.record.nextClaudeInstruction === 'string' ? sent.record.nextClaudeInstruction : null,
    ledgerEntry,
    providerResponseId: sent.providerResponseId,
    definitelyNotSent: false,
    outstandingAfter: before.outstandingWorkIds,
  };

  const problems = checkGatekeeperDecision(sent.record, {
    projectId: input.projectId,
    phaseId: input.phaseId,
    subjectCommit,
    requestDigest: gatekeeperRequestDigest(request),
    expectedDecider: input.expectedDecider,
    alreadyConsumedDecisionIds: deps.consumedDecisionIds,
    ownerOnlyActions: input.ownerOnlyActions,
  });
  if (problems.length > 0) {
    const settled = settleAsk(sys, input.durable.stateDir, ask, null);
    return outcome(
      'DECISION_REFUSED',
      [
        ...problems,
        ...(settled.persisted
          ? []
          : [`the question could not be recorded either: ${settled.problem ?? 'unknown'}`]),
      ],
      shared,
    );
  }

  if (sent.record.decision !== RECONCILIATION_ACCEPTED_VERDICT) {
    const settled = settleAsk(sys, input.durable.stateDir, ask, null);
    return outcome(
      'NOT_ACCEPTED',
      [
        `the gatekeeper returned ${String(sent.record.decision)}; only ` +
          `${RECONCILIATION_ACCEPTED_VERDICT} discharges a reconciliation, so the debt stands`,
        ...(settled.persisted
          ? []
          : [`the question could not be recorded either: ${settled.problem ?? 'unknown'}`]),
      ],
      shared,
    );
  }

  const record: ReconciliationRecord = {
    workId: input.workId,
    decisionId: String(sent.record.decisionId),
    ask: RECONCILIATION_ASK,
    decisionAccepted: true,
  };
  // THE AUTHORITATIVE DISCHARGE, WRITTEN WITH THE QUESTION IT ANSWERS.
  //
  // The record that outlives the project is the one that decides, so it lands before the mirror; and
  // it lands in the same lock acquisition as the ask, so there is no state in which the question is
  // recorded as asked while the discharge it authorised is not. A failure here leaves the debt
  // standing AND the question unasked, which is the pair of facts a retry needs to be safe.
  const durableWritten = settleAsk(sys, input.durable.stateDir, ask, {
    installRoot: input.durable.installRoot,
    workId: input.workId,
    grantId: input.grantId,
    projectId: input.projectId,
    repository: input.durable.repository,
    decisionId: String(sent.record.decisionId),
    ask: RECONCILIATION_ASK,
    at: input.at,
  });
  if (!durableWritten.persisted) {
    return outcome(
      'PERSIST_FAILED',
      [durableWritten.problem ?? 'the reconciliation could not be recorded in the installation ledger'],
      shared,
    );
  }

  if (fromLedger) {
    // NOTHING TO APPEND TO. Recreating the mirror here would manufacture a project-local record of work
    // this checkout has no other trace of, and the discharge is already durable. The debt is cleared;
    // the absence is reported rather than papered over.
    const state = reconciliationState(store.workItems, [...store.reconciliations, record]);
    return outcome(
      'RECONCILED',
      [
        mirrorRecord === null
          ? `the project's evidence mirror for grant '${input.grantId}' is absent, so this discharge ` +
            'is recorded only in the installation ledger, which is the record that decides'
          : `the project's evidence mirror for grant '${input.grantId}' does not record work item ` +
            `'${input.workId}', so this discharge is recorded only in the installation ledger, which ` +
            'is the record that decides',
      ],
      { ...shared, outstandingAfter: state.outstandingWorkIds },
    );
  }

  const written = persistReconciliation(sys, root, input.grantId, record);
  if (!written.persisted) {
    return outcome(
      'PERSIST_FAILED',
      [
        written.problem ?? 'the reconciliation could not be recorded',
        'the installation ledger records the discharge; the project evidence mirror does not, and ' +
          'should be repaired',
      ],
      shared,
    );
  }

  const after = readDegradedStoreDetailed(sys, root, input.grantId);
  const state =
    after.kind === 'ok' ? reconciliationState(after.record.workItems, after.record.reconciliations) : before;

  return outcome('RECONCILED', [], { ...shared, outstandingAfter: state.outstandingWorkIds });
}
