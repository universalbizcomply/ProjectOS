/**
 * The gatekeeper's DECISION — the thing that was missing, and whose absence let an implementer close.
 *
 * WHAT WENT WRONG. `--delegated` was doing two jobs at once. It said "evaluate this closure under the
 * plan's delegation" AND, implicitly, "the delegate has decided to close". The runtime resolved the
 * delegate's identity from the approved plan — which correctly stopped anyone SPOOFING ChatGPT — and
 * then treated the resolved identity as though ChatGPT had spoken. It had not. Nothing in the system
 * represented a decision at all, so `G4 eligible` was silently sufficient, and an ordinary CLI
 * invocation by the implementer closed Phase 18.
 *
 * G4 ANSWERS A DIFFERENT QUESTION. It answers "are the conditions for a closure decision satisfied?"
 * — validators, reviews, evidence, provenance, a clean reconciled tree. That is eligibility. Whether
 * the authority who holds the delegation has chosen to exercise it is a separate fact, and this
 * module is where that fact is represented so it can be required.
 *
 * WHAT THIS CAN AND CANNOT PROMISE. ProjectOS is `MANUAL_GOVERNANCE_APPROVAL` with
 * `tamperProof: false` throughout: there is no signature, and anything able to write a file can write
 * this one. So the boundary is deliberately NOT "the implementer cannot produce these bytes" — that
 * would be a lie. It is:
 *
 *   - the decision must EXIST as a distinct, reviewable artefact, bound to one phase, one project and
 *     one evidence subject, naming the delegate the plan records;
 *   - it must be COMMITTED, so it passes the owner's commit/push gate and a forged decision is a
 *     visible diff rather than an invisible boolean in an argv;
 *   - and it must be presented to the authority module, which refuses a delegated closure without one
 *     however eligible the phase is.
 *
 * That converts "any caller can flip a flag" into "someone must have written, committed and pushed a
 * decision naming this exact subject" — which is the same standard every other governance fact in
 * this programme is held to, and is stated honestly rather than dressed up as cryptography.
 *
 * Created in PROJECTOS-V3-FINAL-E2E-CLOSURE1A after an implementer invocation closed Phase 18.
 */

/** The decision record's shape, as read from disk. Every field is untrusted until checked. */
export interface ClosureDecisionRecord {
  readonly schemaVersion?: unknown;
  readonly decisionId?: unknown;
  readonly phaseId?: unknown;
  readonly projectId?: unknown;
  readonly scope?: unknown;
  readonly decidedBy?: unknown;
  readonly decidedAt?: unknown;
  /** The exact commit the decision was taken against. Binds it to evidence, not to a phase in general. */
  readonly evidenceSubjectHead?: unknown;
  readonly decision?: unknown;
  readonly note?: unknown;
}

/** What the runtime knows independently, and against which the record is judged. */
export interface ClosureDecisionExpectations {
  readonly phaseId: string;
  readonly projectId: string;
  readonly scope: string;
  /**
   * The authority whose decision this must be — the plan's OWNER for an owner closure, the plan's
   * DELEGATE for a delegated one. Read from the active approved plan, never from the record and
   * never from the caller.
   */
  readonly expectedDecider: string;
  /** The subject the closure evidence is bound to. A decision about other bytes is not this decision. */
  readonly evidenceSubjectHead: string | null;
  /**
   * Is the decision present in a COMMIT, not merely on disk? Established by the caller from git.
   * `false` includes "could not be established" — an unverifiable decision is not a decision.
   */
  readonly isCommitted: boolean;
  /** Decision ids already consumed by a closure in this phase's history, so one cannot be replayed. */
  readonly alreadyConsumedDecisionIds: readonly string[];
}

export const CLOSURE_DECISION_SCHEMA_VERSION = '1.0.0';
const HEX40 = /^[0-9a-f]{40}$/;
const DECISION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * Why this record is not a usable gatekeeper decision, or `[]` when it is.
 *
 * PURE. It performs no I/O and trusts nothing in the record: every field is compared against what the
 * runtime established for itself. Returning every reason rather than the first means an operator sees
 * the whole gap in one refusal.
 */
export function checkClosureDecision(
  record: ClosureDecisionRecord | null,
  expect: ClosureDecisionExpectations,
): readonly string[] {
  if (record === null) {
    return [
      `no gatekeeper closure decision exists for '${expect.phaseId}'. G4 eligibility is not a decision: ` +
        `the delegate must record one, and it must be committed.`,
    ];
  }
  const e: string[] = [];
  if (record.schemaVersion !== CLOSURE_DECISION_SCHEMA_VERSION) {
    e.push(`decision schemaVersion is ${JSON.stringify(record.schemaVersion)}, expected "${CLOSURE_DECISION_SCHEMA_VERSION}"`);
  }
  if (typeof record.decisionId !== 'string' || !DECISION_ID.test(record.decisionId)) {
    e.push('decision has no usable decisionId');
  } else if (expect.alreadyConsumedDecisionIds.includes(record.decisionId)) {
    e.push(`decision ${record.decisionId} was already consumed by a closure of this phase and cannot be replayed`);
  }
  if (record.decision !== 'close') {
    e.push(`the record does not decide to close (decision=${JSON.stringify(record.decision)})`);
  }
  if (record.phaseId !== expect.phaseId) {
    e.push(`decision is for phase ${JSON.stringify(record.phaseId)}, not '${expect.phaseId}'`);
  }
  if (record.projectId !== expect.projectId) {
    e.push(`decision is for project ${JSON.stringify(record.projectId)}, not '${expect.projectId}'`);
  }
  if (record.scope !== expect.scope) {
    e.push(`decision scope ${JSON.stringify(record.scope)} is not '${expect.scope}'`);
  }
  // The decider is the plan's, never the record's claim about itself.
  if (record.decidedBy !== expect.expectedDecider) {
    e.push(`decision was taken by ${JSON.stringify(record.decidedBy)}, who is not the recorded authority '${expect.expectedDecider}'`);
  }
  if (typeof record.decidedAt !== 'string' || record.decidedAt.trim().length === 0) {
    e.push('decision records no decidedAt');
  }
  // Bound to the evidence. A decision taken against different bytes is not a decision about these.
  if (typeof record.evidenceSubjectHead !== 'string' || !HEX40.test(record.evidenceSubjectHead)) {
    e.push('decision names no valid evidence subject commit');
  } else if (expect.evidenceSubjectHead === null) {
    e.push('the closure evidence names no subject, so the decision cannot be bound to it');
  } else if (record.evidenceSubjectHead !== expect.evidenceSubjectHead) {
    e.push(
      `decision was taken against ${record.evidenceSubjectHead.slice(0, 7)}, but the closure evidence subject is ` +
        `${expect.evidenceSubjectHead.slice(0, 7)} — a decision about other bytes is stale`,
    );
  }
  if (!expect.isCommitted) {
    e.push(
      'the decision is not committed. An uncommitted decision has not passed the owner commit gate, which is the ' +
        'only thing that makes a forged one a visible diff under this programme\'s tamperProof:false model',
    );
  }
  return e;
}

/** The decision ids a phase's history records as already having closed it. */
export function consumedDecisionIds(history: readonly { readonly to?: unknown; readonly note?: unknown }[]): readonly string[] {
  const ids: string[] = [];
  for (const h of history) {
    if (h.to !== 'closed' || typeof h.note !== 'string') continue;
    const m = /decision ([A-Za-z0-9_.:-]{8,128})/.exec(h.note);
    const id = m === null ? undefined : m[1];
    if (id !== undefined) ids.push(id);
  }
  return ids;
}
