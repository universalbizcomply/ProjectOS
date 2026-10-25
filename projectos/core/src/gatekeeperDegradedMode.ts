/**
 * Working without a gatekeeper — on the owner's explicit risk, and never quietly.
 *
 * THE SITUATION THIS EXISTS FOR. The gatekeeper is unreachable and there is work the owner would
 * rather not stall. The dangerous resolution is the implementer deciding that its own review will do.
 * The safe one is the owner saying, on the record, "continue anyway, I accept the risk" — and that
 * sentence being a bounded, durable, non-replayable artefact rather than a remembered conversation.
 *
 * WHAT A GRANT IS AND IS NOT. It is permission to keep IMPLEMENTING without review. It is not
 * authority: commit, push, closure, payment, credentials and every other owner-gated effect still
 * require their own grant, because "carry on working" and "carry on and ship it" are different
 * sentences and only one of them was said.
 *
 * WHY RECONCILIATION IS PART OF THIS FILE. Degraded work is unreviewed work. If the return of the
 * gatekeeper simply resumed normal service, the unreviewed stretch would be permanently skipped —
 * approved by nobody, and invisible precisely because everything after it looks normal. So the debt
 * is recorded when it is incurred, and the next major gate is blocked until it is cleared.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 */
import { GATEKEEPER_UNAVAILABLE_OWNER_CHOICES } from './gatekeeperTransport.js';

export const DEGRADED_MODE_SCHEMA_VERSION = '1.0.0';

/** The one owner choice that opens degraded mode. The other two close or pause the work. */
export const DEGRADED_MODE_CHOICE = 'ACCEPT RISK & CONTINUE WITH CLAUDE SELF-REVIEW';

/** The ask a reconciliation review is submitted under, so it cannot be satisfied by an ordinary review. */
export const RECONCILIATION_ASK = 'degraded-mode-reconciliation';

/** The owner's risk-accepting grant, as read from disk. Every field untrusted until checked. */
export interface DegradedModeGrant {
  readonly schemaVersion?: unknown;
  readonly grantId?: unknown;
  readonly projectId?: unknown;
  readonly phaseId?: unknown;
  readonly subjectCommit?: unknown;
  /** The unavailability event this answers, so a grant cannot drift onto a different outage. */
  readonly unavailabilityId?: unknown;
  /** Must be the owner's literal choice, not a paraphrase of it. */
  readonly ownerChoice?: unknown;
  readonly grantedBy?: unknown;
  readonly grantedAt?: unknown;
  readonly reason?: unknown;
  /** The bounded actions this grant covers. Owner-only actions may never appear. */
  readonly grantedScope?: unknown;
  /** How many bounded work items it covers. A grant without a bound is an open-ended one. */
  readonly maxWorkItems?: unknown;
  readonly consumedAt?: unknown;
}

export interface DegradedModeExpectations {
  readonly projectId: string;
  readonly phaseId: string;
  readonly subjectCommit: string;
  readonly unavailabilityId: string;
  /** The recorded owner. Never the record's claim about who granted it. */
  readonly recordedOwner: string;
  readonly ownerOnlyActions: readonly string[];
  readonly alreadyConsumedGrantIds: readonly string[];
  /**
   * True only when these bytes came from the git object store rather than the working tree.
   *
   * THE SAME SEPARATION THE OWNER GATE RECEIPT REQUIRES, and for the same reason. This grant is an
   * OWNER authority record — the owner accepting risk — and it was originally checked without it,
   * which meant the one artefact that lets work proceed unreviewed was the one artefact any process
   * could write and have honoured immediately. The commit is the owner action a model cannot perform.
   */
  readonly readFromCommittedTree: boolean;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function isImplementerName(name: string): boolean {
  return /\bclaude\b|\bimplementer\b|\bworker\b/i.test(name);
}

function isModelName(name: string): boolean {
  return /\bchatgpt\b|\bopenai\b|\bgpt\b|\bcodex\b|\bgatekeeper\b/i.test(name);
}

const HEX40 = /^[0-9a-f]{40}$/;

/** Why this grant does not permit degraded-mode work, or `[]` when it does. Pure — no I/O. */
export function checkDegradedModeGrant(
  grant: DegradedModeGrant | null,
  expect: DegradedModeExpectations,
): readonly string[] {
  if (grant === null) {
    return [
      'no owner risk-acceptance exists, so work cannot continue without the gatekeeper; ' +
        'the absence of an objection is not an acceptance of risk',
    ];
  }
  const e: string[] = [];

  if (expect.readFromCommittedTree !== true) {
    e.push(
      'this risk acceptance was not read from the committed tree; work may only continue unreviewed on ' +
        'a committed grant, because the commit is the owner action a model cannot perform',
    );
  }

  if (grant.schemaVersion !== DEGRADED_MODE_SCHEMA_VERSION) {
    e.push(`grant schemaVersion is ${JSON.stringify(grant.schemaVersion)}, expected "${DEGRADED_MODE_SCHEMA_VERSION}"`);
  }

  const id = text(grant.grantId);
  if (id === null) {
    e.push('grant has no usable grantId');
  } else if (expect.alreadyConsumedGrantIds.includes(id)) {
    e.push(`grant ${id} was already used and cannot be replayed onto further work`);
  }
  if (grant.consumedAt !== undefined && grant.consumedAt !== null) {
    e.push(`grant was already consumed at ${String(grant.consumedAt)} and cannot be replayed`);
  }

  // THE OWNER'S WORDS, NOT A PARAPHRASE. A grant recording some other sentence is not this choice.
  if (grant.ownerChoice !== DEGRADED_MODE_CHOICE) {
    e.push(
      `grant records owner choice ${JSON.stringify(grant.ownerChoice)}; degraded mode opens only on ` +
        `"${DEGRADED_MODE_CHOICE}" (the alternatives are: ${GATEKEEPER_UNAVAILABLE_OWNER_CHOICES.join(' / ')})`,
    );
  }

  // ONLY THE OWNER MAY ACCEPT RISK ON THE OWNER'S BEHALF.
  const by = text(grant.grantedBy);
  if (by === null) {
    e.push('grant records no grantedBy');
  } else if (by !== expect.recordedOwner) {
    e.push(
      `grant was made by ${JSON.stringify(by)}, who is not the recorded owner '${expect.recordedOwner}'; ` +
        'nobody may accept risk on behalf of the owner',
    );
  } else if (isImplementerName(by)) {
    // A LAST-RESORT BACKSTOP, reached only when `recordedOwner` ITSELF resolves to the implementer.
    // The comparison above cannot catch that case, because the two sides agree — which is precisely
    // the configuration mistake worth surviving.
    e.push('grant is attributed to the implementer, which can never accept risk on behalf of the owner');
  } else if (isModelName(by)) {
    e.push('grant is attributed to a model; a model may relay what the owner decided but never make the decision');
  }
  if (text(grant.grantedAt) === null) e.push('grant records no grantedAt');
  if (text(grant.reason) === null) e.push('grant records no reason, so the accepted risk is not stated');

  // BOUND TO THIS PROJECT, PHASE, SUBJECT AND OUTAGE.
  if (grant.projectId !== expect.projectId) {
    e.push(`grant is for project ${JSON.stringify(grant.projectId)}, not '${expect.projectId}'`);
  }
  if (grant.phaseId !== expect.phaseId) {
    e.push(`grant is for phase ${JSON.stringify(grant.phaseId)}, not '${expect.phaseId}'`);
  }
  const subject = text(grant.subjectCommit);
  if (subject === null || !HEX40.test(subject)) {
    e.push('grant names no valid subject commit');
  } else if (subject !== expect.subjectCommit) {
    e.push(
      `grant was given against ${subject.slice(0, 7)}, but this run's subject is ` +
        `${expect.subjectCommit.slice(0, 7)}; risk accepted for other work is not risk accepted for this`,
    );
  }
  if (grant.unavailabilityId !== expect.unavailabilityId) {
    e.push(
      `grant answers outage ${JSON.stringify(grant.unavailabilityId)}, not '${expect.unavailabilityId}'; ` +
        'a grant cannot carry over to a later outage',
    );
  }

  // SCOPE: BOUNDED, AND NEVER OWNER-ONLY.
  const scope = Array.isArray(grant.grantedScope) ? grant.grantedScope : null;
  if (scope === null || scope.length === 0) {
    e.push('grant declares no grantedScope, so what it permits is unbounded');
  } else {
    for (const action of scope) {
      const name = text(action);
      if (name === null) {
        e.push('grantedScope contains an entry that is not a usable action name');
        continue;
      }
      if (expect.ownerOnlyActions.includes(name)) {
        e.push(
          `grant includes owner-only action '${name}'; continuing without review is not authority to ` +
            'take a protected action, which needs its own explicit grant',
        );
      }
    }
  }
  const max = grant.maxWorkItems;
  if (typeof max !== 'number' || !Number.isInteger(max) || max <= 0) {
    e.push('grant sets no positive maxWorkItems, so it would not expire');
  }

  return e;
}

/** One piece of work done while unreviewed. Its existence is the debt reconciliation must clear. */
export interface DegradedWorkItem {
  readonly workId: string;
  readonly grantId: string;
  readonly phaseId: string;
  readonly summary: string;
  readonly at: string;
}

/** Is this grant exhausted by the work already done under it? */
export function degradedWorkRemaining(
  grant: { readonly grantId: string; readonly maxWorkItems: number },
  done: readonly DegradedWorkItem[],
): number {
  const used = done.filter((w) => w.grantId === grant.grantId).length;
  return Math.max(0, grant.maxWorkItems - used);
}

export interface ReconciliationState {
  readonly required: boolean;
  readonly outstandingWorkIds: readonly string[];
  readonly reasons: readonly string[];
}

/**
 * One degraded-mode work item, reviewed by the returned gatekeeper.
 *
 * THE DECISION ID IS THE POINT. Reconciliation used to take a bare list of work ids, which meant the
 * caller could clear its own debt by naming its own work: no decision, no reviewer, no binding, no
 * ask. The module header says this file exists because otherwise the unreviewed stretch would be
 * "approved by nobody" — and a list of strings the loop supplies to itself IS nobody.
 */
export interface ReconciliationRecord {
  readonly workId: string;
  /** The gatekeeper decision that reviewed it. The caller must have checked it already. */
  readonly decisionId: string;
  /** The ask the decision was submitted under; only RECONCILIATION_ASK counts. */
  readonly ask: string;
  /** Whether that decision actually passed `checkGatekeeperDecision` against this run. */
  readonly decisionAccepted: boolean;
}

/**
 * What still has to be reviewed before normal service resumes.
 *
 * Reconciliation is satisfied per WORK ITEM, not per phase. One review that says "the degraded period
 * looks fine" without naming what it covers would let later, unnamed work hide inside an earlier
 * blessing — which is the same skipped-review failure in a different shape.
 *
 * DUPLICATE WORK IDS ARE A DEFECT, NOT A SHORTCUT. Two items sharing an id would let one review clear
 * both, so the duplication is reported rather than silently collapsed.
 */
export function reconciliationState(
  degradedWork: readonly DegradedWorkItem[],
  reconciliations: readonly ReconciliationRecord[],
): ReconciliationState {
  if (degradedWork.length === 0) {
    return { required: false, outstandingWorkIds: [], reasons: [] };
  }

  const duplicates = degradedWork
    .map((w) => w.workId)
    .filter((id, i, all) => all.indexOf(id) !== i)
    .filter((id, i, dupes) => dupes.indexOf(id) === i);

  // Only a reconciliation backed by an ACCEPTED decision, submitted under the reconciliation ask,
  // counts. Everything else is an assertion that a review happened.
  const cleared = new Set(
    reconciliations
      .filter((r) => r.decisionAccepted === true && r.ask === RECONCILIATION_ASK && text(r.decisionId) !== null)
      .map((r) => r.workId),
  );
  const outstanding = degradedWork
    .map((w) => w.workId)
    .filter((id, i, all) => all.indexOf(id) === i)
    .filter((id) => !cleared.has(id));

  const reasons: string[] = [];
  if (duplicates.length > 0) {
    reasons.push(
      `degraded work items share ids (${duplicates.join(', ')}); one review would clear several unreviewed items`,
    );
  }
  if (outstanding.length > 0) {
    reasons.push(
      `${outstanding.length} of ${degradedWork.length} degraded-mode work items have no accepted ` +
        `${RECONCILIATION_ASK} decision since the gatekeeper returned: ${outstanding.join(', ')}`,
    );
  }
  if (reasons.length === 0) {
    return { required: false, outstandingWorkIds: [], reasons: [] };
  }
  return { required: true, outstandingWorkIds: outstanding, reasons };
}

/**
 * May a major gate proceed, given outstanding reconciliation?
 *
 * A major gate is one whose whole purpose is that something was reviewed — commit, push, closure. If
 * unreviewed work is still outstanding, letting one through would launder it.
 */
export function gateBlockedByReconciliation(state: ReconciliationState): readonly string[] {
  if (!state.required) return [];
  return [
    'the next major gate cannot proceed as normal while degraded-mode work is unreconciled',
    ...state.reasons,
  ];
}
