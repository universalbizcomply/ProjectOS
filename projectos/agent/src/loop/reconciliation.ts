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
import {
  readDegradedStoreDetailed,
  degradedStorePath,
  degradedStoreIsRecordable,
  authorityWrapper,
  DEGRADED_STORE_SCHEMA_VERSION,
  type DegradedStoreRecord,
} from './degradedMode.js';
import { loadDegradedModeGrant } from './degradedModeGrants.js';
import { recordReconciliation } from '../installation/degradedLedger.js';
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
function evidenceFor(store: DegradedStoreRecord, workId: string, committedRecord: boolean): string {
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
        maxWorkItems: store.maxWorkItems,
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
      recordProvenance: committedRecord
        ? 'committed'
        : 'working tree, not yet committed — written by the runtime, but writable by the implementer, ' +
          'so treat the summary as a claim rather than as proof',
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
  if (read.kind === 'absent') {
    return outcome('NO_SUCH_GRANT', [
      `no degraded-use record exists for grant '${input.grantId}', so it has no debt to discharge`,
    ]);
  }
  const store = read.record;

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
  } else if (store.maxWorkItems !== grantMax) {
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

  // NOTHING IS PAID FOR THAT CANNOT BE RECORDED. Once the owner has committed the use record, the
  // committed bytes are authoritative and any working-tree edit of them reads as tampering — so
  // appending would both fail and leave the checkout unable to read its own degraded history. Checked
  // before the call, because discovering it afterwards means a real decision was bought and discarded.
  const recordable = degradedStoreIsRecordable(sys, root, input.grantId);
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

  const evidenceText = evidenceFor(store, input.workId, false);
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

  // ASKED ONCE. The evidence here is history and does not change, so the request identity does not
  // change either — which means a second ask is the SAME question, and the answer to it has already
  // been recorded. Asking again would be shopping for a better verdict, and the guard downstream would
  // refuse the answer anyway, AFTER paying for it. Refused here instead, for free, and said plainly.
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

  // THE SPEND LIMIT APPLIES HERE TOO. A limit tested only after the money is gone is a report, not a
  // stop — and this route was the one entry point that could spend without asking.
  const estimate = estimateCostMicroUsd(
    { inputTokens: Math.ceil(evidenceText.length / 4), outputTokens: 800 },
    deps.rate,
  );
  const totals = summariseLedger(deps.ledger, {
    projectId: input.projectId,
    phaseId: input.phaseId,
    month: input.at.slice(0, 7),
  });
  const spend = authoriseRequestSpend(estimate, totals, deps.budget);
  if (!spend.allowed) {
    return outcome(
      'SPEND_REFUSED',
      ['the ProjectOS spend limit refused this call before it was made', ...spend.reasons],
      { workId: input.workId, requestId, outstandingAfter: before.outstandingWorkIds },
    );
  }

  if (input.prepareOnly === true) {
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
      ...(deps.transport.timeoutMs === undefined ? {} : { timeoutMs: deps.transport.timeoutMs }),
    },
    deps.resolver,
    deps.http,
  );

  if (sent.kind === 'unavailable') {
    return outcome('UNAVAILABLE', sent.reasons, {
      workId: input.workId,
      requestId,
      // Only a credential that never resolved proves the request never left this machine. Everything
      // else — a socket error, a non-200, a 200 with an unusable body — may have been billed.
      definitelyNotSent: sent.cause === 'CREDENTIAL_UNAVAILABLE',
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
  if (problems.length > 0) return outcome('DECISION_REFUSED', problems, shared);

  if (sent.record.decision !== RECONCILIATION_ACCEPTED_VERDICT) {
    return outcome(
      'NOT_ACCEPTED',
      [
        `the gatekeeper returned ${String(sent.record.decision)}; only ` +
          `${RECONCILIATION_ACCEPTED_VERDICT} discharges a reconciliation, so the debt stands`,
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
  // THE AUTHORITATIVE DISCHARGE FIRST, then the project evidence.
  //
  // This is the same ordering consumption uses and for the same reason: the record that outlives the
  // project is the one that decides, so it is written first and the mirror follows. A failure here
  // leaves the debt standing, which is the direction to fail in.
  const durableWritten = recordReconciliation(sys, input.durable.stateDir, {
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
