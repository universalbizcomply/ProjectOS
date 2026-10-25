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
  /**
   * Residual HIGH findings the OWNER has explicitly accepted for this closure.
   *
   * G4-10 requires zero unresolved CRITICAL/HIGH. That is right for a CRITICAL and right for a HIGH
   * nobody has looked at, but the governance model gives the owner final authority to accept a
   * residual HIGH, and the gate had no way to represent that — so a truthfully recorded, explicitly
   * accepted HIGH was indistinguishable from an ignored one. The count-only fact could express
   * "one HIGH remains" and nothing about who decided what.
   *
   * It lives HERE rather than in a new waiver file because this record is already the durable
   * closure authority: bound to the phase, bound to the evidence subject, checked against the plan's
   * decider, and required to be COMMITTED. A separate acceptance file would have to re-earn all four
   * and would be a second place to look for the same kind of fact.
   *
   * Each entry is judged by `validateOwnerAcceptedHighFindings`. Nothing here downgrades a severity
   * or removes a finding: an accepted HIGH stays a HIGH, stays unresolved, and stays visible.
   */
  readonly ownerAcceptedFindings?: unknown;
  /**
   * Written back when this decision is CONSUMED by a closure.
   *
   * Replay tracking used to live only in the phase's own history, which `phase new --force` erases:
   * reset the record, walk the lifecycle again, and the same decision closed the phase a second
   * time. Consumption is therefore recorded HERE, in the decision, which a phase reset does not
   * touch. A decision that already carries this is spent.
   */
  readonly consumedAt?: unknown;
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

/**
 * The ONLY scope an owner acceptance may carry.
 *
 * Scope was free text, and free text is not a contract: "*", "all projects forever" and "production
 * and external distribution" all satisfied "non-empty" while saying the opposite of what this
 * mechanism permits. A machine-enforced scope has to be a value the machine can actually compare, so
 * there is exactly one, and anything else is refused.
 *
 * It carries no phase or commit information deliberately — the entry's `phaseId` and
 * `evidenceSubjectHead` already bind those, and duplicating them into a free-form string would give
 * two places to disagree. Human limitations (no production approval, no external distribution, the
 * finding remains carried) belong in the decision's `note`, which is read by people, not by this.
 */
export const OWNER_ACCEPTANCE_SCOPE = 'phase-closure-only';
const HEX40 = /^[0-9a-f]{40}$/;
const DECISION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * Is this a usable closure decision id?
 *
 * EXPORTED SO THE TRANSPORT ASKS THIS EXACT QUESTION. `closureTransport.ts` judges an id the moment
 * an answer arrives, and this module judges the same id again when the record is read back from a
 * commit. Two hand-copied regexes would let a response be accepted whose id the gate then refuses —
 * a decision written, presented to the owner, committed, and rejected at the last step for a reason
 * nobody could have seen coming. One predicate, both callers.
 */
export function isClosureDecisionId(value: string): boolean {
  return DECISION_ID.test(value);
}

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
  // The consumption marker lives in the decision, so resetting the phase record cannot un-spend it.
  if (record.consumedAt !== undefined && record.consumedAt !== null) {
    e.push(`decision was already consumed at ${String(record.consumedAt)} and cannot be replayed`);
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

/** What an owner acceptance must be judged against. Every field is established by the runtime. */
export interface OwnerAcceptanceExpectations {
  readonly phaseId: string;
  /** The subject the closure evidence is bound to. An acceptance of other bytes is not this one. */
  readonly evidenceSubjectHead: string | null;
  /** The governed project's OWNER, read from the project config — never from the record. */
  readonly owner: string;
  /** Ids of the findings actually recorded as unresolved HIGH at that subject. */
  readonly unresolvedHighIds: readonly string[];
}

/** The outcome of judging the acceptances: which HIGH ids are validly accepted, and every reason
 *  a claimed acceptance was refused. */
export interface OwnerAcceptanceVerdict {
  readonly acceptedHighIds: readonly string[];
  readonly problems: readonly string[];
}

/**
 * Which owner acceptances in a decision are usable, and why any are not.
 *
 * PURE, and fail-closed in every direction. An acceptance is authority, so it is judged the way the
 * decision itself is judged: nothing in the entry is believed about the world. The phase, the subject
 * commit and the accepting identity are compared against what the runtime established, and the
 * finding id must name a finding the evidence ALREADY records as an unresolved HIGH — so an
 * acceptance cannot invent the finding it forgives, nor reach a finding of another phase or another
 * commit.
 *
 * CRITICAL is refused explicitly rather than by omission. "Only HIGH is listed" would make an
 * accepted CRITICAL a silent no-op that still read as accepted somewhere; it must be a loud refusal.
 *
 * WHAT THIS IS NOT. It is not tamper-proofing and does not become it. This programme is
 * `tamperProof: false`: anything able to write the decision file can write an acceptance into it.
 * The boundary is the same one every other governed record relies on — the owner's commit gate,
 * where a forged acceptance is a visible diff in a file the gate already refuses to read uncommitted.
 */
export function validateOwnerAcceptedHighFindings(
  record: ClosureDecisionRecord | null,
  expect: OwnerAcceptanceExpectations,
): OwnerAcceptanceVerdict {
  const raw = record?.ownerAcceptedFindings;
  // Absent is not an error: a phase with nothing to accept says nothing, exactly as before.
  if (raw === undefined || raw === null) return { acceptedHighIds: [], problems: [] };
  if (!Array.isArray(raw)) {
    return { acceptedHighIds: [], problems: ['ownerAcceptedFindings is present but is not an array'] };
  }

  // A plan with no recorded owner cannot authorise anything. Without this, `expect.owner` of '' and
  // an entry's `acceptedBy` of '' compare EQUAL, and an acceptance with no identity behind it passes
  // the authority check. `isGenuineClosure` already refuses a blank expected decider for exactly this
  // reason; this is the same rule in the same file. Found by ECC review.
  if (expect.owner.trim().length === 0) {
    return {
      acceptedHighIds: [],
      problems: ['the active plan records no owner, so no HIGH acceptance can be authorised'],
    };
  }

  const problems: string[] = [];
  const accepted: string[] = [];
  const seen = new Set<string>();

  raw.forEach((entry: unknown, i: number) => {
    const at = `ownerAcceptedFindings[${i}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${at} is not an object`);
      return;
    }
    const a = entry as Record<string, unknown>;
    const id = typeof a['findingId'] === 'string' ? a['findingId'].trim() : '';

    // Severity first: a CRITICAL must be refused by name, whatever else the entry gets right.
    if (a['severity'] === 'CRITICAL') {
      problems.push(`${at} attempts to accept a CRITICAL finding${id === '' ? '' : ` (${id})`}; a CRITICAL can never be owner-accepted`);
      return;
    }
    if (a['severity'] !== 'HIGH') {
      problems.push(`${at} has severity ${JSON.stringify(a['severity'])}, expected "HIGH"`);
      return;
    }
    if (id === '') {
      problems.push(`${at} names no findingId`);
      return;
    }
    if (seen.has(id)) {
      problems.push(`${at} repeats findingId '${id}'; one acceptance covers one finding`);
      return;
    }
    seen.add(id);

    // Authority. The owner is the config's, never the record's claim about itself.
    if (a['acceptedBy'] !== expect.owner) {
      problems.push(`${at} was accepted by ${JSON.stringify(a['acceptedBy'])}, who is not the owner '${expect.owner}'`);
      return;
    }
    // Binding. Wrong phase or wrong bytes is not this acceptance.
    if (a['phaseId'] !== expect.phaseId) {
      problems.push(`${at} is bound to phase ${JSON.stringify(a['phaseId'])}, not '${expect.phaseId}'`);
      return;
    }
    if (expect.evidenceSubjectHead === null || !HEX40.test(expect.evidenceSubjectHead)) {
      problems.push(`${at} cannot be bound: the closure evidence names no valid subject commit`);
      return;
    }
    // The entry's own subject must LOOK like a commit before it is compared. Equality alone would
    // let '' match a '' subject read off a malformed evidence record — the same shape check
    // `checkClosureDecision` already applies to the decision's own subject. Found by ECC review.
    if (typeof a['evidenceSubjectHead'] !== 'string' || !HEX40.test(a['evidenceSubjectHead'])) {
      problems.push(`${at} names no valid evidence subject commit`);
      return;
    }
    if (a['evidenceSubjectHead'] !== expect.evidenceSubjectHead) {
      problems.push(
        `${at} was accepted against ${JSON.stringify(a['evidenceSubjectHead'])}, but the closure evidence subject is ` +
          `${expect.evidenceSubjectHead.slice(0, 7)} — an acceptance of other bytes is stale`,
      );
      return;
    }
    // Scope must be the one canonical literal. "Non-empty" let '*' and 'all projects forever'
    // through, which is a blanket waiver wearing a field name. Exact equality, or refuse.
    if (a['scope'] !== OWNER_ACCEPTANCE_SCOPE) {
      problems.push(
        `${at} records scope ${JSON.stringify(a['scope'])}, not the only permitted acceptance scope ` +
          `'${OWNER_ACCEPTANCE_SCOPE}'`,
      );
      return;
    }
    // The finding must already be recorded as an unresolved HIGH. Acceptance forgives a finding the
    // evidence knows about; it cannot conjure one, and it cannot reach a finding that is not HIGH.
    if (!expect.unresolvedHighIds.includes(id)) {
      problems.push(
        `${at} accepts '${id}', which the closure evidence does not record as an unresolved HIGH finding at this subject`,
      );
      return;
    }
    accepted.push(id);
  });

  return { acceptedHighIds: accepted, problems };
}

/**
 * Is this closed phase record backed by the DECISION that authorised it?
 *
 * THE DEFECT THIS EXISTS FOR. Completion evidence read the closing history entry's ROLE — `owner`,
 * or `advisor` for a delegated closure — and treated it as proof that the closure happened. A role
 * is a string. This programme is `tamperProof: false` and says so everywhere, so anything able to
 * write a phase record can write `by: advisor`, and a hand-written history would then satisfy the
 * next phase's dependency with no committed decision behind it at all. Proving the IMPLEMENTER is
 * rejected proves nothing about that, because the forger simply would not write `implementer`.
 *
 * WHAT IS CHECKED INSTEAD. The closing entry names the decision that authorised it — the runtime
 * appends `, decision <id>` as the authority basis — and that decision must exist, be for this phase
 * and this project, decide to close, name the authority the ACTIVE PLAN records, and carry the
 * `consumedAt` marker the closure itself wrote. A forgery must now also produce a matching decision
 * file, which is a committed, reviewable diff rather than one line inside a record nobody reads.
 *
 * WHAT IT STILL CANNOT PROMISE, stated rather than implied: this is not tamper-proofing and does not
 * become it. Someone able to write both files can still write both. The boundary is unchanged — the
 * owner's commit gate — and what changes is that a closure can no longer be manufactured from the
 * phase record ALONE, which is the bypass that existed.
 *
 * Pure: the caller supplies the already-read decision, so the same rule runs in the runtime (which
 * reads the file) and in the owner-facing projection (which cannot).
 */
export interface ClosureAuthorityExpectations {
  readonly phaseId: string;
  readonly projectId: string;
  /** The plan's owner. An owner closure must name this identity. */
  readonly owner: string;
  /** The plan's closure delegate, when it records one. A delegated closure must name this identity. */
  readonly delegate: string | null;
}

export function isGenuineClosure(
  phase: { readonly status?: unknown; readonly history?: readonly { readonly to?: unknown; readonly by?: unknown; readonly note?: unknown }[] } | null,
  decision: ClosureDecisionRecord | null,
  expect: ClosureAuthorityExpectations,
): boolean {
  if (phase === null || phase.status !== 'closed') return false;
  const history = Array.isArray(phase.history) ? phase.history : [];
  const last = history[history.length - 1];
  if (last === undefined || last.to !== 'closed') return false;

  // The role still has to be a closing role — the implementer can never close, by any route.
  const by = last.by;
  const roleOk = by === 'owner' || by === 'advisor';
  if (!roleOk) return false;

  // …and the closing entry must NAME the decision that authorised it.
  const named = consumedDecisionIds(history);
  const decisionId = named[named.length - 1];
  if (decisionId === undefined) return false;

  if (decision === null) return false;
  if (decision.decisionId !== decisionId) return false;
  if (decision.phaseId !== expect.phaseId) return false;
  if (decision.projectId !== expect.projectId) return false;
  if (decision.decision !== 'close') return false;
  // Spent BY that closure. An unconsumed decision describes an authorisation that was never used.
  if (typeof decision.consumedAt !== 'string' || decision.consumedAt.trim() === '') return false;

  // The decider is the plan's, never the record's claim about itself. An owner closure must be the
  // owner's; a delegated one must be the delegate the plan names. The `by: owner` case is held to
  // exactly the same standard — leaving it unchecked would be an obvious sibling bypass.
  const expectedDecider = by === 'advisor' ? expect.delegate : expect.owner;
  if (expectedDecider === null || expectedDecider === '') return false;
  if (decision.decidedBy !== expectedDecider) return false;
  if (isImplementerName(String(decision.decidedBy))) return false;
  return true;
}

/** Minimal implementer check, kept here so the pure rule needs no other module. */
function isImplementerName(name: string): boolean {
  const stripped = name.toLowerCase().replace(/[^a-z]/g, '');
  for (const s of ['claude', 'anthropic', 'implementer', 'assistant', 'copilot']) {
    if (stripped.includes(s)) return true;
  }
  return ['ai', 'bot', 'agent', 'llm', 'model'].includes(name.trim().toLowerCase());
}

/**
 * The decision ids a phase's history records as already having closed it.
 *
 * The id is read from the END of the note, because the note is `<caller text> — <authority basis>`
 * and the authority basis is appended last. An unanchored search took the FIRST match, so a caller
 * passing `--note "decision 00000000"` made every closure record a decoy id and the real one was
 * never seen as consumed — replay tracking defeated from the first legitimate closure, with no
 * `--force` needed.
 *
 * This is a secondary check. The primary one is the `consumedAt` marker written into the decision
 * itself, which survives a phase-record reset that this cannot.
 */
export function consumedDecisionIds(history: readonly { readonly to?: unknown; readonly note?: unknown }[]): readonly string[] {
  const ids: string[] = [];
  for (const h of history) {
    if (h.to !== 'closed' || typeof h.note !== 'string') continue;
    const m = /, decision ([A-Za-z0-9_.:-]{8,128})$/.exec(h.note.trim());
    const id = m === null ? undefined : m[1];
    if (id !== undefined) ids.push(id);
  }
  return ids;
}
