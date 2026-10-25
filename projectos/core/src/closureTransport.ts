/**
 * Asking the delegated closure authority for a CLOSURE DECISION, and judging what comes back.
 *
 * WHY THIS IS NOT THE GATEKEEPER CONTRACT. `gatekeeperDecision.ts` carries a TECHNICAL review: does
 * this evidence support continuing, correcting, or stopping. It has a verdict vocabulary
 * (`APPROVED_TO_PROCEED`, `AMENDMENT_REQUIRED`, …) that includes `APPROVED_FOR_CLOSURE` — and that
 * verdict is deliberately owner-gated and authorises nothing, because a technical reviewer saying "I
 * would close this" is a recommendation. Closure itself is a different act with a different record:
 * `.projectops/closure/decisions/<phaseId>.json`, judged by `checkClosureDecision`, bound to a phase,
 * a project, a scope and an evidence subject, and required to be COMMITTED.
 *
 * Reusing the technical schema for it would have been the cheap move and it would have been FALSE in
 * both directions: a technical decision carries `allowedActions` (a closure decision grants no
 * actions at all) and carries no scope, no evidence subject and no owner acceptances (all of which a
 * closure decision must state). Worse, it would have made an ordinary evidence review CONVERTIBLE
 * into a closure — the exact failure this module exists to prevent. So the two vocabularies are
 * disjoint by construction: `close | do-not-close | awaiting-owner` here, and none of the seven
 * technical verdicts. A record of either kind fails the other's checker on several independent
 * grounds, not one.
 *
 * WHAT THE REVIEWER STATES, AND WHY IT IS NOT SYNTHESISED. The technical transport stamps the
 * bindings itself, on the reasoning that a model asked for them would produce a self-consistent wrong
 * answer. That reasoning does not hold here, because the closure record's authority-bearing values
 * are compared against expectations the runtime derived from the APPROVED PLAN and the CLOSURE
 * EVIDENCE — sources the reviewer cannot see or move. So the reviewer states them and every one is
 * checked against an independent source; a wrong claim is a refusal, and ProjectOS never authors a
 * sentence it then attributes to the closure authority.
 *
 * WHAT THIS CANNOT PROMISE, stated rather than implied. Nothing here is authority. A response that
 * passes every check below produces a record on disk, and a record on disk closes nothing: the
 * decision must still be COMMITTED by the owner and re-judged by `checkClosureDecision` and G4. This
 * module's whole contribution is that the closure authority's answer arrives as a checkable record
 * rather than as prose somebody retyped.
 *
 * Created in PROJECTOS-AUTONOMOUS-CLOSURE-TRANSPORT1A under the ChatGPT architecture gate of
 * 2026-09-02 (ROUTE A — owner-committed authenticity).
 */
import { createHash } from 'node:crypto';
import type { ClosureScope } from './closureAuthority.js';
import {
  CLOSURE_DECISION_SCHEMA_VERSION,
  OWNER_ACCEPTANCE_SCOPE,
  isClosureDecisionId,
  type ClosureDecisionRecord,
} from './closureDecision.js';
import type { GatekeeperUnavailabilityCause } from './gatekeeperTransport.js';
import { hostAttestationProblems, type HostAttestationSummary, type HostReviewVerdict } from './gatekeeperMode.js';

/** The request's own version. A request from another ProjectOS is refused, never guessed at. */
export const CLOSURE_REQUEST_SCHEMA_VERSION = '1.0.0';

/**
 * The ask this question is priced and authorised under.
 *
 * ALREADY IN THE MODEL POLICY, AND THAT IS NOT A COINCIDENCE. `STRONG_TIER_ASKS` has listed
 * `closure-review` since the pilot's commercial ruling — the owner classified closure as a
 * strong-tier question before anything could ask one. Reusing the existing name prices this route
 * with the number the owner already approved instead of inventing a second one nobody chose.
 */
export const CLOSURE_ASK = 'closure-review';

/**
 * The only scope this route's decisions may carry.
 *
 * TYPED AS THE EXISTING `ClosureScope`, not as a new literal. `closureAuthority.ts` already owns the
 * closure vocabulary and `closureDecisionProblems` already compares against `'phase-closure'`; a
 * second, unrelated string here would be a second answer to "which scope is this" that nothing would
 * keep in step. `programme-closure` is deliberately NOT reachable from this route: it closes a
 * programme, and this asks about one phase.
 */
export const PHASE_CLOSURE_SCOPE: ClosureScope = 'phase-closure';

/**
 * The question put to the closure authority.
 *
 * A CLOSED SHAPE. There is no `ask` the caller composes, no `model`, no `url`, no prompt, no
 * `allowedActions`, and no field naming who may decide other than `expectedDecider` — which the
 * runtime reads off the approved plan's `closureDelegation` and never off a caller.
 */
export interface ClosureRequest {
  readonly schemaVersion: string;
  readonly requestId: string;
  readonly projectId: string;
  readonly phaseId: string;
  /** The exact POST-PUSH subject commit the closure evidence was established at. */
  readonly subjectHead: string;
  /** The digest of the canonical closure evidence, so a changed pack is a different question. */
  readonly evidenceDigest: string;
  /** Who the ACTIVE APPROVED PLAN says may decide closure. Never a caller's claim. */
  readonly expectedDecider: string;
  readonly scope: string;
}

const HEX40 = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * A domain tag inside the hashed form.
 *
 * WITHOUT IT, TWO DIGEST FUNCTIONS OVER SIMILAR TUPLES COULD COLLIDE IN PRINCIPLE — and "in
 * principle" is the standard the rest of this programme is held to. The tag makes a closure digest
 * and a gatekeeper digest structurally incapable of being the same value even if the two field lists
 * ever converged.
 */
const CLOSURE_REQUEST_DOMAIN = 'projectos.closure-request.v1';

/**
 * The canonical digest of a closure request.
 *
 * FIELD-WISE AND JSON-ENCODED, for the two reasons `gatekeeperRequestDigest` records: key insertion
 * order must not change the digest, and a separator-joined form lets a value containing the separator
 * move a field boundary so two different questions hash alike. A NUL separator was tried in that
 * module and made the source file binary to git, which destroys the reviewable diff this project's
 * whole trust model rests on.
 */
export function closureRequestDigest(request: ClosureRequest): string {
  const canonical = JSON.stringify([
    CLOSURE_REQUEST_DOMAIN,
    request.schemaVersion,
    request.requestId,
    request.projectId,
    request.phaseId,
    request.subjectHead,
    request.evidenceDigest,
    request.expectedDecider,
    request.scope,
  ]);
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

/**
 * The request id for this exact closure question.
 *
 * DERIVED, NOT ALLOCATED, exactly as `deriveRequestId` is: a restart must re-derive the SAME id, or
 * the same question is asked — and paid for — twice, with two answers that each look fresh. The
 * trusted broker's replay guard and the cost ledger both key on this, so determinism here is what
 * makes a second call impossible rather than merely unlikely.
 */
export function deriveClosureRequestId(input: {
  readonly projectId: string;
  readonly phaseId: string;
  readonly subjectHead: string;
  readonly evidenceDigest: string;
}): string {
  const canonical = JSON.stringify([
    CLOSURE_REQUEST_DOMAIN,
    input.projectId,
    input.phaseId,
    input.subjectHead,
    input.evidenceDigest,
  ]);
  return `CLREQ-${createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 24)}`;
}

/** The digest of the evidence as presented. Binds the request to what the authority actually read. */
export function closureEvidenceDigest(evidenceText: string): string {
  return `sha256:${createHash('sha256').update(evidenceText, 'utf8').digest('hex')}`;
}

/**
 * Every answer the closure authority may return. CLOSED, and disjoint from `GATEKEEPER_VERDICTS`.
 *
 * `awaiting-owner` is the authority declining to decide; `do-not-close` is it deciding not to. Only
 * `close` produces a decision record at all — the other two are recorded in the run's own lines and
 * write nothing, because a record that says "not closed" would be a closure decision file whose
 * existence a later reader has to interpret.
 */
export const CLOSURE_RESPONSE_DECISIONS = ['close', 'do-not-close', 'awaiting-owner'] as const;
export type ClosureResponseDecision = (typeof CLOSURE_RESPONSE_DECISIONS)[number];

/** The response as it arrives. Every field is untrusted until checked. */
export interface ClosureResponseRecord {
  readonly schemaVersion?: unknown;
  readonly decisionId?: unknown;
  readonly decision?: unknown;
  readonly projectId?: unknown;
  readonly phaseId?: unknown;
  readonly scope?: unknown;
  readonly decidedBy?: unknown;
  readonly decidedAt?: unknown;
  readonly evidenceSubjectHead?: unknown;
  /** The digest of the request being answered. An answer to another question is not an answer here. */
  readonly requestDigest?: unknown;
  readonly note?: unknown;
  readonly ownerAcceptedFindings?: unknown;
}

/** What a closure response is judged against. Every field is established by the runtime. */
export interface ClosureResponseExpectations {
  readonly projectId: string;
  readonly phaseId: string;
  readonly scope: string;
  /** The plan's closure delegate. Never the record's claim about itself. */
  readonly expectedDecider: string;
  /** The subject the closure evidence is bound to. An answer about other bytes is not this one. */
  readonly evidenceSubjectHead: string | null;
  /** The digest of the request that was actually sent. */
  readonly requestDigest: string;
  /** Decision ids already spent for this phase, so a replayed answer is refused. */
  readonly alreadyConsumedDecisionIds: readonly string[];
  /** The governed project's OWNER, for judging any acceptance the response carries. */
  readonly owner: string;
  /** Ids the closure evidence records as unresolved HIGH at this subject. */
  readonly unresolvedHighIds: readonly string[];
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Characters that are printable but reorder, hide or corrupt what a reader sees.
 *
 * SEC-001, APPLIED WHERE IT MATTERS MOST. `safeExcerpt` already strips these from provider error text
 * quoted into records, on the reasoning that a bidirectional override makes text READ as the opposite
 * of what its bytes say. Route A's entire authenticity argument is that MURAD READS THE DECISION AND
 * COMMITS IT — so the one artefact in this programme a human is explicitly asked to read before
 * blessing is the one place that defence was missing. `decision`, `projectId`, `phaseId`, `scope`,
 * `decidedBy`, `evidenceSubjectHead` and `requestDigest` are each compared against a runtime-derived
 * value and so cannot carry this; `note` and `decidedAt` are free text and could.
 */
const REORDERING = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u200B-\u200D\uFEFF]/;

/**
 * Control characters, which do not belong in a governance record's prose either.
 *
 * WRITTEN AS `\uXXXX` ESCAPES, AND THAT IS NOT A STYLE PREFERENCE — it is the lesson
 * `gatekeeperRequestDigest` records, learned again here the hard way. The first version of this line
 * used the literal characters, which put a NUL and four other C0 bytes into this source file. Git
 * then classifies the file as BINARY: `grep` answers "Binary file matches" and a diff shows
 * `Bin 0 -> 14264 bytes` instead of the code. A diff nobody can read is the one thing this project's
 * entire trust model rests on — and this file's whole subject is protecting a human's ability to read
 * what they are committing, so shipping it as an unreadable blob would have been an unusually
 * complete self-contradiction. Caught by `grep` reporting this file as binary, and now pinned by
 * `val-projectos-closure-transport1a`, which refuses a control byte in any closure source file.
 *
 * `REORDERING` above is escaped for the same reason, even though its characters are not C0 and would
 * not have made the file binary: two character classes written two ways is how one of them drifts.
 */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/**
 * The most characters a closure note may carry.
 *
 * BOUNDED, AND REFUSED RATHER THAN TRUNCATED. The technical route truncates a model's instruction
 * because that string is consumed by machinery. This one is copied VERBATIM into the record the owner
 * commits, so truncating it would make the committed bytes something the authority did not say —
 * which is the one thing `closureDecisionRecordFrom` exists to prevent. An over-long note is
 * therefore refused, and the authority asked again.
 */
export const CLOSURE_NOTE_MAX_CHARS = 4000;

/**
 * Why this free-text field may not enter a record a human is asked to bless, or `null`.
 *
 * REFUSED, NOT SANITISED. Stripping would change the bytes, and the whole of Route A rests on the
 * committed bytes being the authority's own statement — so the choice is between a clean answer and
 * no answer, which is the same choice the strict schema already imposes on shape.
 */
function unreadableTextProblem(field: string, value: string): string | null {
  if (REORDERING.test(value)) {
    return (
      `closure response ${field} contains a Unicode bidirectional or invisible formatting character. ` +
      'The owner is asked to READ this record and commit it, and such a character makes text render ' +
      'differently from its bytes — so it is refused rather than stripped, because stripping would ' +
      'make the committed record something the closure authority did not write.'
    );
  }
  if (CONTROL.test(value)) {
    return `closure response ${field} contains a control character, which does not belong in a governance record`;
  }
  if (Array.from(value).length > CLOSURE_NOTE_MAX_CHARS) {
    return (
      `closure response ${field} is longer than ${CLOSURE_NOTE_MAX_CHARS} characters. It is copied ` +
      'verbatim into the record the owner commits, so it is refused rather than truncated.'
    );
  }
  return null;
}

/**
 * Names that must never appear as the closure decider.
 *
 * A DUPLICATE OF THE RULE IN `closureDecision.ts`, AND THAT IS A REAL COST, recorded rather than
 * dressed up: two lists can drift. It is duplicated because that one is private to a module whose
 * only job is judging a record already on disk, and importing across for a five-line predicate would
 * couple the response contract to the record contract for nothing else. The list is asserted equal in
 * the tests, which is where the drift is caught.
 */
function isImplementerName(name: string): boolean {
  const stripped = name.toLowerCase().replace(/[^a-z]/g, '');
  for (const s of ['claude', 'anthropic', 'implementer', 'assistant', 'copilot']) {
    if (stripped.includes(s)) return true;
  }
  return ['ai', 'bot', 'agent', 'llm', 'model'].includes(name.trim().toLowerCase());
}

/**
 * Why this response is not a usable closure answer, or `[]` when it is. Pure — no I/O.
 *
 * EVERY AUTHORITY-BEARING VALUE IS THE RESPONSE'S OWN AND EVERY EXPECTATION IS THE RUNTIME'S. The
 * reviewer says which project, phase, scope, subject and decider its decision is about; this compares
 * each against a source the reviewer never saw. That is what makes a wrong answer refusable rather
 * than self-consistent.
 *
 * Returns every reason rather than the first, so one refusal shows the whole gap.
 */
export function checkClosureResponse(
  record: ClosureResponseRecord | null,
  expect: ClosureResponseExpectations,
): readonly string[] {
  if (record === null) {
    return [
      `no closure response was received for '${expect.phaseId}'. An absent answer is not a decision to close.`,
    ];
  }
  const e: string[] = [];

  if (record.schemaVersion !== CLOSURE_DECISION_SCHEMA_VERSION) {
    e.push(
      `closure response schemaVersion is ${JSON.stringify(record.schemaVersion)}, expected ` +
        `"${CLOSURE_DECISION_SCHEMA_VERSION}"`,
    );
  }

  const id = text(record.decisionId);
  if (id === null || !isClosureDecisionId(id)) {
    e.push('closure response has no usable decisionId');
  } else if (expect.alreadyConsumedDecisionIds.includes(id)) {
    e.push(`closure decision ${id} was already consumed for this phase and cannot be replayed`);
  }

  // A FRESH ANSWER THAT ARRIVES ALREADY SPENT IS NOT AN ANSWER. `consumedAt` is written by the
  // closure that spends a decision; a response carrying one is either a replay of a spent decision
  // or a record that was never a response at all.
  if ((record as { consumedAt?: unknown }).consumedAt !== undefined) {
    e.push('closure response carries a consumedAt marker, so it is a spent decision rather than an answer');
  }

  // A CLOSED VOCABULARY, DISJOINT FROM THE TECHNICAL VERDICTS. A model that returns an encouraging
  // technical word — `APPROVED_FOR_CLOSURE` above all — must not be read as a decision to close.
  const decision = record.decision;
  if (typeof decision !== 'string' || !(CLOSURE_RESPONSE_DECISIONS as readonly string[]).includes(decision)) {
    e.push(
      `closure response decision ${JSON.stringify(decision)} is not one of: ` +
        CLOSURE_RESPONSE_DECISIONS.join(', '),
    );
  }

  // THE BINDINGS. Each answers a different way an answer could belong to something else.
  if (record.projectId !== expect.projectId) {
    e.push(`closure response is for project ${JSON.stringify(record.projectId)}, not '${expect.projectId}'`);
  }
  if (record.phaseId !== expect.phaseId) {
    e.push(`closure response is for phase ${JSON.stringify(record.phaseId)}, not '${expect.phaseId}'`);
  }
  if (record.scope !== expect.scope) {
    e.push(`closure response scope ${JSON.stringify(record.scope)} is not '${expect.scope}'`);
  }

  const subject = text(record.evidenceSubjectHead);
  if (subject === null || !HEX40.test(subject)) {
    e.push('closure response names no valid evidence subject commit');
  } else if (expect.evidenceSubjectHead === null) {
    e.push('the closure evidence names no subject, so the response cannot be bound to it');
  } else if (subject !== expect.evidenceSubjectHead) {
    e.push(
      `closure response was given against ${subject.slice(0, 7)}, but the closure evidence subject is ` +
        `${expect.evidenceSubjectHead.slice(0, 7)} — an answer about other bytes is stale`,
    );
  }

  const rd = text(record.requestDigest);
  if (rd === null || !DIGEST.test(rd)) {
    e.push('closure response names no valid request digest');
  } else if (rd !== expect.requestDigest) {
    e.push(
      `closure response answers request ${rd.slice(7, 19)}, but this run asked ` +
        `${expect.requestDigest.slice(7, 19)} — an answer to a different question is not an answer to this one`,
    );
  }

  // The decider is the plan's, never the record's claim about itself.
  const by = text(record.decidedBy);
  if (by === null) {
    e.push('closure response records no decidedBy');
  } else if (expect.expectedDecider.trim() === '') {
    e.push('the active plan records no closure delegate, so no delegated closure decision can be accepted');
  } else if (by !== expect.expectedDecider) {
    e.push(
      `closure response was decided by ${JSON.stringify(by)}, who is not the plan's closure authority ` +
        `'${expect.expectedDecider}'`,
    );
  } else if (isImplementerName(by)) {
    e.push('closure response was decided by the implementer — the implementer can never close its own work');
  }

  if (text(record.decidedAt) === null) e.push('closure response records no decidedAt');
  if (text(record.note) === null) {
    e.push('closure response records no note — an unexplained closure decision is not reviewable');
  }

  // THE FREE-TEXT FIELDS, HELD TO WHAT A HUMAN CAN SAFELY READ.
  //
  // Every other field above is compared against a runtime-derived value, so a wrong one is refused
  // for being wrong. `note` and `decidedAt` are the two the authority writes freely, and `note` is the
  // justification the OWNER is asked to read before committing — which is the whole authenticity
  // argument of this route. A bidirectional override there makes the rendered text say something the
  // bytes do not, so a matching digest would be a match on bytes nobody actually read.
  //
  // Raised by the ECC security review against this correction (Trojan-Source, CVE-2021-42574), and by
  // the ECC code review as the same finding: the codebase already treats this as SEC-001 for quoted
  // provider errors and had not applied it to the one artefact a person is told to review.
  for (const field of ['note', 'decidedAt', 'decisionId'] as const) {
    const value = record[field];
    if (typeof value !== 'string') continue;
    const problem = unreadableTextProblem(field, value);
    if (problem !== null) e.push(problem);
  }

  // OWNER ACCEPTANCES ARE THE OWNER'S, AND THIS ROUTE MAY NOT AUTHOR ONE.
  //
  // `ownerAcceptedFindings` entries carry `acceptedBy: <the plan's owner>`. A closure authority
  // filling that in is a reviewer writing a sentence in Murad's name, and Route A's authenticity
  // anchor is the owner committing the REVIEWER's decision — not the owner committing the reviewer's
  // claim about the owner. Those are different things, and the second is the one that turns a commit
  // gate into a rubber stamp.
  //
  // THE FIELD IS STILL REQUIRED, AND MUST BE EMPTY. An absent field is indistinguishable in the
  // written record from a deliberate empty list, and the owner is entitled to see the authority say
  // "nothing is carried" rather than to infer it from silence. A phase that genuinely carries an
  // owner-accepted residual HIGH closes through the owner's own decision record, exactly as it does
  // today — this route narrows, and says so, rather than quietly acquiring the owner's authority.
  //
  // `expect.owner` and `expect.unresolvedHighIds` are carried on the expectations for the same
  // reason: so the refusal below can be lifted only by a deliberate change that has somewhere to get
  // the owner's identity from, rather than by a change that merely deletes a check.
  const accepted = record.ownerAcceptedFindings;
  if (accepted === undefined || accepted === null) {
    e.push('closure response does not state ownerAcceptedFindings; an empty list is how "nothing carried" is said');
  } else if (!Array.isArray(accepted)) {
    e.push('closure response ownerAcceptedFindings is present but is not an array');
  } else if (accepted.length > 0) {
    e.push(
      `closure response carries ${accepted.length} ownerAcceptedFindings entr(y/ies). An acceptance of a ` +
        `residual HIGH is owner '${expect.owner || '<none recorded>'}'s authority with scope ` +
        `'${OWNER_ACCEPTANCE_SCOPE}', and the closure authority may not author one on the owner's behalf. ` +
        (expect.unresolvedHighIds.length === 0
          ? 'The closure evidence records no unresolved HIGH finding at this subject, so there is nothing to accept. '
          : `The closure evidence records ${expect.unresolvedHighIds.length} unresolved HIGH finding(s) at this ` +
            'subject. ') +
        'Close this phase through the owner\'s own committed decision record instead.',
    );
  }

  return e;
}

/**
 * The decision record to write, built from the response's OWN stated values.
 *
 * NOTHING IS SYNTHESISED AND NOTHING IS SUBSTITUTED. Every authority-bearing field is copied
 * verbatim from the answer that `checkClosureResponse` accepted, so the bytes the owner is asked to
 * commit are the closure authority's statement and not ProjectOS's paraphrase of it. The key ORDER is
 * fixed here so that the same response always serialises to the same bytes — which is what makes the
 * hash presented to the owner comparable with the hash of what they committed.
 *
 * CALL ONLY AFTER THE CHECK PASSED, and only for `decision === 'close'`. It is not a decision
 * function: it copies. The caller's `problems.length === 0` is the whole precondition.
 */
export function closureDecisionRecordFrom(response: ClosureResponseRecord): ClosureDecisionRecord {
  return {
    schemaVersion: response.schemaVersion,
    decisionId: response.decisionId,
    phaseId: response.phaseId,
    projectId: response.projectId,
    scope: response.scope,
    decidedBy: response.decidedBy,
    decidedAt: response.decidedAt,
    evidenceSubjectHead: response.evidenceSubjectHead,
    decision: response.decision,
    note: response.note,
    ownerAcceptedFindings: response.ownerAcceptedFindings,
    // PROVENANCE, NOT AUTHORITY. `checkClosureDecision` does not read this field and never will —
    // it says which question this answer was given to, so a reader of the committed diff can tell.
    requestDigest: response.requestDigest,
  } as ClosureDecisionRecord;
}

// -------------------------------------------------------------------------------------------------
// THE CLOSURE QUESTION, ASKED THROUGH PROJECTOSHOST (unattended mode, hybrid routing)
// -------------------------------------------------------------------------------------------------

/** The closure question on its way to the Host. Its own shape, because the closure contract is its own. */
export interface HostClosureReviewCall {
  readonly request: ClosureRequest;
  readonly requestDigest: string;
  /** The Host authority wire's correlation for this request — `hostCorrelationFor(request.requestId)`. */
  readonly correlation: string;
  /** The exact provider request the Host will send. */
  readonly body: string;
}

export type HostClosureReviewOutcome =
  | {
      readonly kind: 'attested';
      /** The provider's closure answer as the Host received it. A CANDIDATE until checked. */
      readonly record: ClosureResponseRecord;
      readonly attestation: HostAttestationSummary;
      readonly usage: { readonly inputTokens: number; readonly cachedInputTokens: number; readonly outputTokens: number };
    }
  | {
      readonly kind: 'unavailable';
      readonly cause: GatekeeperUnavailabilityCause;
      readonly reasons: readonly string[];
      /** The Host-authoritative dispatch fact; see `HostReviewOutcome`. Absent reads as possibly dispatched. */
      readonly providerDispatched?: boolean;
    };

/**
 * The route to ProjectOSHost's independent review, asked the CLOSURE question. A PORT, as
 * `HostReviewPort` is: with none composed, an unattended closure waits — it never calls a provider itself.
 */
export interface HostClosureReviewPort {
  reviewClosure(call: HostClosureReviewCall): HostClosureReviewOutcome;
}

/**
 * Which Host verdict a CLOSURE answer must travel with.
 *
 * Its own mapping, because the closure vocabulary is disjoint from the technical one. `close` is
 * `OwnerApprovalRequired` because a closure decision is inert until the OWNER commits it: an attestation
 * vouches that the independent provider said "close", never that the phase is closed. Exhaustive by type.
 */
export const HOST_VERDICT_FOR_CLOSURE: { readonly [D in ClosureResponseDecision]: HostReviewVerdict } = {
  close: 'OwnerApprovalRequired',
  'do-not-close': 'ChangesRequired',
  'awaiting-owner': 'OwnerApprovalRequired',
};

/**
 * Why this attestation does not vouch for this CLOSURE answer, or `[]` when it does. Pure — no I/O.
 *
 * The same binding checks every Host attestation gets (`hostAttestationProblems`); only the verdict
 * mapping differs. A closure answer grants no actions and always leaves the owner's commit to come, so
 * the attestation must say exactly that: no permitted actions, and owner approval still required.
 */
export function checkHostClosureAttestation(
  attestation: HostAttestationSummary | null,
  expect: { readonly requestId: string; readonly record: ClosureResponseRecord },
): readonly string[] {
  const decision = expect.record.decision;
  const expected =
    typeof decision === 'string' && (CLOSURE_RESPONSE_DECISIONS as readonly string[]).includes(decision)
      ? HOST_VERDICT_FOR_CLOSURE[decision as ClosureResponseDecision]
      : null;
  return hostAttestationProblems(attestation, expect.requestId, {
    verdict: decision,
    expectedHostVerdict: expected,
    allowedActions: [],
    ownerApprovalRequired: true,
  });
}
