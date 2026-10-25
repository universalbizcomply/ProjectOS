/**
 * The unattended gatekeeper's DECISION, and the request it answers.
 *
 * WHY THIS EXISTS. Until now the governance turn was a human one: Claude produced a report, the owner
 * carried it to ChatGPT, ChatGPT replied in prose, and the owner carried the prose back. Prose is not
 * an authority record. Once the gatekeeper answers a machine rather than a person, "it said proceed"
 * has to become a thing ProjectOS can check, refuse and consume — otherwise the loop closes by
 * believing a model's paragraph, which is exactly the failure this programme exists to prevent.
 *
 * THE SHAPE OF THE PROBLEM. A decision is only meaningful about SOMETHING. A verdict that says
 * "APPROVED_TO_PROCEED" and nothing else can be replayed against a different phase, a different
 * commit, or a request that asked something else entirely — and it would look identical. So every
 * decision here is bound to four independent facts, and a mismatch in any one of them is a refusal:
 *
 *   projectId      which project asked
 *   phaseId        which phase of it
 *   subjectCommit  the exact bytes the answer was given about
 *   requestDigest  the exact question, hashed, so an answer cannot migrate to another question
 *
 * WHAT THIS CANNOT PROMISE. ProjectOS remains `MANUAL_GOVERNANCE_APPROVAL` with `tamperProof: false`.
 * There is no signature and none is claimed: anything able to write a file can write one of these.
 * The boundary is the same one every other governance record in this programme is held to — the
 * decision must EXIST as a distinct, reviewable artefact bound to a subject, and it must be checked
 * rather than believed. What this module adds is that a gatekeeper's answer can no longer be a
 * sentence somebody retyped.
 *
 * THE VERDICT VOCABULARY IS CLOSED. An unknown verdict is refused rather than treated as permission,
 * because the failure mode of an open vocabulary is that a model invents an encouraging-sounding word
 * and the runtime reads it as approval. Every verdict is also either advisory or owner-gated: the
 * gatekeeper may recommend a protected action, and may never authorise one.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 */
import { createHash } from 'node:crypto';

export const GATEKEEPER_DECISION_SCHEMA_VERSION = '1.0.0';
export const GATEKEEPER_REQUEST_SCHEMA_VERSION = '1.0.0';

/**
 * Every verdict the gatekeeper may return. CLOSED on purpose.
 *
 * `DO_NOT_PROCEED` and `AMENDMENT_REQUIRED` both stop the work; they differ in whether there is a way
 * forward. `AWAITING_OWNER` is the gatekeeper saying the next step is not its to authorise, which is
 * how a protected action is surfaced rather than granted.
 */
export const GATEKEEPER_VERDICTS = [
  'APPROVED_TO_PROCEED',
  'AMENDMENT_REQUIRED',
  'APPROVED_TO_COMMIT',
  'APPROVED_TO_PUSH',
  'AWAITING_OWNER',
  'APPROVED_FOR_CLOSURE',
  'DO_NOT_PROCEED',
] as const;

export type GatekeeperVerdict = (typeof GATEKEEPER_VERDICTS)[number];

/**
 * Verdicts that authorise nothing until the owner has separately said so.
 *
 * A gatekeeper decision carrying one of these is still a valid decision — it records a recommendation
 * — but the runtime must not treat it as permission. Commit and push are the owner's gates in every
 * ProjectOS plan, and closure is the owner's or a delegate's under a closure delegation that this
 * record is not. Keeping them in the vocabulary lets the gatekeeper say "I would commit this now"
 * without that sentence becoming the commit.
 */
export const OWNER_GATED_VERDICTS: readonly GatekeeperVerdict[] = [
  'APPROVED_TO_COMMIT',
  'APPROVED_TO_PUSH',
  'APPROVED_FOR_CLOSURE',
];

/** Does acting on this verdict require an owner gate the gatekeeper cannot supply? */
export function verdictRequiresOwner(verdict: GatekeeperVerdict): boolean {
  return OWNER_GATED_VERDICTS.includes(verdict);
}

/** Verdicts after which bounded implementation may continue without a further gate. */
export function verdictAllowsContinuation(verdict: GatekeeperVerdict): boolean {
  return verdict === 'APPROVED_TO_PROCEED' || verdict === 'AMENDMENT_REQUIRED';
}

/**
 * The question put to the gatekeeper.
 *
 * This is the canonical, hashable form — not the prose prompt. The prompt may be phrased however the
 * transport likes; the DIGEST is taken over these fields, so what the decision binds to is the
 * governance question rather than the wording around it.
 */
export interface GatekeeperRequest {
  readonly schemaVersion: string;
  readonly requestId: string;
  readonly projectId: string;
  readonly phaseId: string;
  /** The commit the evidence describes. A decision about other bytes is about another thing. */
  readonly subjectCommit: string;
  /** What is being asked, from a closed set the caller controls (e.g. 'evidence-review'). */
  readonly ask: string;
  /** Stable digests of the evidence presented, so a changed pack changes the question. */
  readonly evidenceDigests: readonly string[];
  /** Protected actions the runtime already knows are owner-only, restated so the answer is informed. */
  readonly ownerOnlyActions: readonly string[];
}

const HEX40 = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID_SHAPE = /^[A-Za-z0-9_.:-]{4,128}$/;

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * The canonical digest of a request.
 *
 * FIELD-WISE AND ORDER-INDEPENDENT, deliberately. `JSON.stringify` over the whole object would make
 * the digest depend on key insertion order, so the same question serialised by two code paths would
 * hash differently and every decision would look stale. Arrays ARE order-sensitive after sorting,
 * because "these three evidence packs" is the same question however they were listed.
 */
export function gatekeeperRequestDigest(request: GatekeeperRequest): string {
  // ENCODED AS JSON, NOT JOINED WITH A SEPARATOR. Two earlier attempts were both wrong. Joining with
  // a space lets a value containing a space move a field boundary, so two different questions hash
  // alike — `ask: "a b"` with one evidence digest is indistinguishable from `ask: "a"` with a
  // different one. Joining with NUL fixed that and created a worse problem: a raw NUL byte makes the
  // whole source file BINARY to git, so the owner's commit-gate diff shows `Bin 0 -> 14264 bytes`
  // instead of the code — and a diff nobody can read is the one thing this project's entire trust
  // model rests on. `JSON.stringify` of a fixed-order array escapes quotes, delimits array elements
  // unambiguously, and contains no control characters.
  const canonical = JSON.stringify([
    request.schemaVersion,
    request.requestId,
    request.projectId,
    request.phaseId,
    request.subjectCommit,
    request.ask,
    [...request.evidenceDigests].sort(),
    [...request.ownerOnlyActions].sort(),
  ]);
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

/** The decision record as read from disk. Every field is untrusted until checked. */
export interface GatekeeperDecisionRecord {
  readonly schemaVersion?: unknown;
  readonly decisionId?: unknown;
  readonly projectId?: unknown;
  readonly phaseId?: unknown;
  readonly subjectCommit?: unknown;
  readonly requestDigest?: unknown;
  readonly decision?: unknown;
  readonly allowedActions?: unknown;
  readonly forbiddenActions?: unknown;
  readonly ownerApprovalRequired?: unknown;
  readonly reason?: unknown;
  readonly nextClaudeInstruction?: unknown;
  readonly risks?: unknown;
  readonly carryForward?: unknown;
  readonly decidedBy?: unknown;
  readonly decidedAt?: unknown;
  /** Stamped when the runtime acts on it. A decision carrying this is spent. */
  readonly consumedAt?: unknown;
}

/** What a decision is judged against. Every field is established by the runtime, never by the record. */
export interface GatekeeperExpectations {
  readonly projectId: string;
  readonly phaseId: string;
  readonly subjectCommit: string;
  readonly requestDigest: string;
  /** Who the plan says reviews. Never the record's claim about itself. */
  readonly expectedDecider: string;
  /** Decision ids already spent for this phase, so a replay is visible even if `consumedAt` is absent. */
  readonly alreadyConsumedDecisionIds: readonly string[];
  /** Protected actions the gatekeeper may never grant. */
  readonly ownerOnlyActions: readonly string[];
}

function isImplementerName(name: string): boolean {
  return /\bclaude\b|\bimplementer\b|\bworker\b/i.test(name);
}

/**
 * Why this record is not a usable gatekeeper decision, or `[]` when it is. Pure — no I/O.
 *
 * Returns every reason rather than the first, so one refusal shows the whole gap instead of sending
 * an operator round the loop once per field.
 */
export function checkGatekeeperDecision(
  record: GatekeeperDecisionRecord | null,
  expect: GatekeeperExpectations,
): readonly string[] {
  if (record === null) {
    return [
      `no gatekeeper decision exists for phase '${expect.phaseId}' at subject ` +
        `${expect.subjectCommit.slice(0, 7)}. An absent decision is not an approval.`,
    ];
  }
  const e: string[] = [];

  if (record.schemaVersion !== GATEKEEPER_DECISION_SCHEMA_VERSION) {
    e.push(
      `decision schemaVersion is ${JSON.stringify(record.schemaVersion)}, expected ` +
        `"${GATEKEEPER_DECISION_SCHEMA_VERSION}"`,
    );
  }

  const id = text(record.decisionId);
  if (id === null || !ID_SHAPE.test(id)) {
    e.push('decision has no usable decisionId');
  } else if (expect.alreadyConsumedDecisionIds.includes(id)) {
    e.push(`decision ${id} was already acted on for this phase and cannot be replayed`);
  }

  // The consumption marker lives in the record, so resetting the runtime cannot un-spend it.
  if (record.consumedAt !== undefined && record.consumedAt !== null) {
    e.push(`decision was already consumed at ${String(record.consumedAt)} and cannot be replayed`);
  }

  // AN UNKNOWN VERDICT IS NOT A PERMISSIVE ONE. A model that invents an encouraging word must not be
  // read as approval, so the vocabulary is closed and anything outside it refuses.
  const verdict = record.decision;
  if (typeof verdict !== 'string' || !(GATEKEEPER_VERDICTS as readonly string[]).includes(verdict)) {
    e.push(
      `decision ${JSON.stringify(verdict)} is not one of the recognised verdicts: ` +
        GATEKEEPER_VERDICTS.join(', '),
    );
  }

  // THE FOUR BINDINGS. Each answers a different way an answer could belong to something else.
  if (record.projectId !== expect.projectId) {
    e.push(`decision is for project ${JSON.stringify(record.projectId)}, not '${expect.projectId}'`);
  }
  if (record.phaseId !== expect.phaseId) {
    e.push(`decision is for phase ${JSON.stringify(record.phaseId)}, not '${expect.phaseId}'`);
  }
  const subject = text(record.subjectCommit);
  if (subject === null || !HEX40.test(subject)) {
    e.push('decision names no valid subject commit');
  } else if (subject !== expect.subjectCommit) {
    e.push(
      `decision was taken against ${subject.slice(0, 7)}, but this run's subject is ` +
        `${expect.subjectCommit.slice(0, 7)} — a decision about other bytes is stale`,
    );
  }
  const rd = text(record.requestDigest);
  if (rd === null || !DIGEST.test(rd)) {
    e.push('decision names no valid request digest');
  } else if (rd !== expect.requestDigest) {
    e.push(
      `decision answers request ${rd.slice(7, 19)}, but this run asked ${expect.requestDigest.slice(7, 19)} — ` +
        'an answer to a different question is not an answer to this one',
    );
  }

  // The decider is the plan's, never the record's claim about itself.
  const by = text(record.decidedBy);
  if (by === null) {
    e.push('decision records no decidedBy');
  } else if (by !== expect.expectedDecider) {
    e.push(`decision was taken by ${JSON.stringify(by)}, who is not the recorded gatekeeper '${expect.expectedDecider}'`);
  } else if (isImplementerName(by)) {
    e.push('decision was taken by the implementer — the implementer can never act as its own gatekeeper');
  }

  if (text(record.decidedAt) === null) e.push('decision records no decidedAt');
  if (text(record.reason) === null) {
    e.push('decision records no reason — an unexplained verdict is not reviewable');
  }

  // THE GATEKEEPER MAY RECOMMEND A PROTECTED ACTION AND MAY NEVER GRANT ONE. Anything owner-only that
  // appears in `allowedActions` is an attempt to hold authority this record cannot carry, and is
  // refused outright rather than quietly filtered — a silently narrowed grant would leave the runtime
  // and the record disagreeing about what was authorised.
  const allowed = Array.isArray(record.allowedActions) ? record.allowedActions : null;
  if (allowed === null) {
    e.push('decision declares no allowedActions list');
  } else {
    for (const action of allowed) {
      const name = text(action);
      if (name === null) {
        e.push('allowedActions contains an entry that is not a usable action name');
        continue;
      }
      if (expect.ownerOnlyActions.includes(name)) {
        e.push(
          `decision grants '${name}', which is an owner-only action — the gatekeeper may recommend it ` +
            'but can never authorise it',
        );
      }
    }
  }
  if (!Array.isArray(record.forbiddenActions)) {
    e.push('decision declares no forbiddenActions list');
  }

  // An owner-gated verdict must SAY it needs the owner. A record that approves a push while claiming
  // no owner approval is required is internally inconsistent, and the inconsistency is the dangerous
  // half: the runtime would read the verdict and skip the gate.
  if (typeof verdict === 'string' && (GATEKEEPER_VERDICTS as readonly string[]).includes(verdict)) {
    const needsOwner = verdictRequiresOwner(verdict as GatekeeperVerdict);
    if (needsOwner && record.ownerApprovalRequired !== true) {
      e.push(
        `verdict ${verdict} is owner-gated, so ownerApprovalRequired must be true; ` +
          `the record says ${JSON.stringify(record.ownerApprovalRequired)}`,
      );
    }
    if (typeof record.ownerApprovalRequired !== 'boolean') {
      e.push('decision does not state ownerApprovalRequired as a boolean');
    }
    // A verdict that permits continuation must say what to do next, or the loop has approval and no
    // instruction and will either stall or improvise.
    if (verdictAllowsContinuation(verdict as GatekeeperVerdict) && text(record.nextClaudeInstruction) === null) {
      e.push(`verdict ${verdict} continues the work but records no nextClaudeInstruction`);
    }
  }

  return e;
}
