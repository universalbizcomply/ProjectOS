/**
 * The owner answering an owner gate — and why a model can never produce one of these.
 *
 * THE RULING THIS IMPLEMENTS. On 2026-08-17 the owner ruled that ChatGPT must not impersonate them:
 * a delegated gatekeeper decision may carry `decidedBy: ChatGPT` under a delegation, but a genuine
 * owner decision "must require a separately verifiable, pending-gate-bound owner action/receipt", and
 * a model may "transport owner intent" without "manufactur[ing] Murad provenance".
 *
 * WHAT "SEPARATELY VERIFIABLE" MEANS IN THIS REPOSITORY, honestly. There is no cryptography here and
 * none is claimed. ProjectOS is `MANUAL_GOVERNANCE_APPROVAL`, `tamperProof: false`, and anything that
 * can write a file can write one of these. The separation is a CHANNEL separation, and it is real: a
 * receipt has no effect until it is COMMITTED, the runtime reads it from the git object store rather
 * than the working tree, and the commit gate is a place the bridge does not reach. A forged receipt
 * is therefore a visible diff in front of the owner at the moment they commit. That is the same
 * guarantee every other authority record in this project rests on, stated the same way, and this
 * contract must not be described as more.
 *
 * WHY THE FIELD IS CALLED `ownerChoice`. It is already a member of
 * `PROVENANCE_FIELDS_THE_BRIDGE_MAY_NOT_ASSERT`, so naming it that means a bridge request carrying it
 * is refused by machinery that already exists, at both the request and the argument level. Choosing a
 * new name would have quietly opened the hole this contract exists to close.
 *
 * NO DELEGATION BRANCH, DELIBERATELY. Every other authority record in ProjectOS asks "is there a
 * delegation that covers this?" — this one does not, and must never grow one. The whole point of the
 * artefact is owner provenance specifically; a delegated owner receipt is a contradiction, and the
 * gatekeeper already has its own record type for the things it may decide.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A under the owner's bridge ruling of 2026-08-17.
 */

export const OWNER_GATE_RECEIPT_SCHEMA_VERSION = '1.0.0';

/** The one scope an owner receipt may carry. Copied in spirit from `OWNER_ACCEPTANCE_SCOPE`. */
export const OWNER_GATE_SCOPE = 'owner-gate-only';

/** The answers an owner may give to a gate. Closed, for the same reason verdicts are closed. */
export const OWNER_GATE_CHOICES = ['APPROVE', 'REFUSE'] as const;
export type OwnerGateChoice = (typeof OWNER_GATE_CHOICES)[number];

/** A receipt as read from the git object store. Every field is untrusted until checked. */
export interface OwnerGateReceipt {
  readonly schemaVersion?: unknown;
  readonly decisionId?: unknown;
  readonly projectId?: unknown;
  readonly phaseId?: unknown;
  /** Must be a gate the ACTIVE APPROVED PLAN names for this phase — never free text. */
  readonly gateName?: unknown;
  /** Deterministic; recomputed by the runtime and compared, never trusted as given. */
  readonly gateInstanceId?: unknown;
  readonly evidenceSubjectHead?: unknown;
  readonly ownerChoice?: unknown;
  readonly decidedBy?: unknown;
  readonly decidedAt?: unknown;
  readonly scope?: unknown;
  readonly note?: unknown;
  /** Stamped when the runtime acts on it. A receipt carrying this is spent. */
  readonly consumedAt?: unknown;
}

export interface OwnerGateExpectations {
  readonly projectId: string;
  readonly phaseId: string;
  /** The gates the active approved plan requires for this phase. */
  readonly requiredOwnerGates: readonly string[];
  readonly evidenceSubjectHead: string;
  /** The owner named by the ACTIVE APPROVED PLAN's governance block. Never the record's claim. */
  readonly planOwner: string;
  /** True only when these bytes came from the git object store, not the working tree. */
  readonly readFromCommittedTree: boolean;
  readonly alreadyConsumedDecisionIds: readonly string[];
}

const HEX40 = /^[0-9a-f]{40}$/;
const ID_SHAPE = /^[A-Za-z0-9_.:-]{8,128}$/;

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function isImplementerName(name: string): boolean {
  return /\bclaude\b|\bimplementer\b|\bworker\b/i.test(name);
}

/** A model that may be transporting intent, but can never be the owner. */
function isModelName(name: string): boolean {
  return /\bchatgpt\b|\bopenai\b|\bgpt\b|\bcodex\b|\bgatekeeper\b/i.test(name);
}

/**
 * The gate instance this receipt would answer.
 *
 * DETERMINISTIC, AND THAT IS THE FRESHNESS DEVICE. There is no allocator and no clock: the id is the
 * phase, the gate and the subject commit. Re-derive it at a later commit and you get a different id,
 * so a receipt for yesterday's evidence cannot answer today's gate — the same staleness property the
 * repository's validator records already rely on.
 */
export function gateInstanceId(phaseId: string, gateName: string, evidenceSubjectHead: string): string {
  return `${phaseId}:${gateName}@${evidenceSubjectHead}`;
}

/** Why this receipt does not answer this gate, or `[]` when it does. Pure — no I/O. */
export function checkOwnerGateReceipt(
  receipt: OwnerGateReceipt | null,
  expect: OwnerGateExpectations,
): readonly string[] {
  if (receipt === null) {
    return [
      `no owner receipt exists for this gate; an owner gate is not answered by the absence of an objection`,
    ];
  }
  const e: string[] = [];

  // THE CHANNEL SEPARATION. Everything else here is shape; this is the part that makes the record
  // mean anything, because the working tree is writable by the very processes this guards against.
  if (expect.readFromCommittedTree !== true) {
    e.push(
      'this receipt was not read from the committed tree; an owner gate is answered by a committed ' +
        'record, because the commit is the owner action a model cannot perform',
    );
  }

  if (receipt.schemaVersion !== OWNER_GATE_RECEIPT_SCHEMA_VERSION) {
    e.push(
      `receipt schemaVersion is ${JSON.stringify(receipt.schemaVersion)}, expected ` +
        `"${OWNER_GATE_RECEIPT_SCHEMA_VERSION}"`,
    );
  }
  if (receipt.scope !== OWNER_GATE_SCOPE) {
    e.push(`receipt scope is ${JSON.stringify(receipt.scope)}, expected "${OWNER_GATE_SCOPE}"`);
  }

  const id = text(receipt.decisionId);
  if (id === null || !ID_SHAPE.test(id)) {
    e.push('receipt has no usable decisionId');
  } else if (expect.alreadyConsumedDecisionIds.includes(id)) {
    e.push(`receipt ${id} was already acted on and cannot answer a second gate`);
  }
  if (receipt.consumedAt !== undefined && receipt.consumedAt !== null) {
    e.push(`receipt was already consumed at ${String(receipt.consumedAt)} and cannot be replayed`);
  }

  if (receipt.projectId !== expect.projectId) {
    e.push(`receipt is for project ${JSON.stringify(receipt.projectId)}, not '${expect.projectId}'`);
  }
  if (receipt.phaseId !== expect.phaseId) {
    e.push(`receipt is for phase ${JSON.stringify(receipt.phaseId)}, not '${expect.phaseId}'`);
  }

  // THE GATE MUST BE ONE THE PLAN ASKS FOR. A receipt naming a gate the plan never required would
  // answer nothing while looking like an approval.
  const gateName = text(receipt.gateName);
  if (gateName === null) {
    e.push('receipt names no gate');
  } else if (!expect.requiredOwnerGates.includes(gateName)) {
    e.push(
      `receipt answers gate '${gateName}', which the approved plan does not require for this phase ` +
        `(it requires: ${expect.requiredOwnerGates.join(', ') || 'none'})`,
    );
  }

  const head = text(receipt.evidenceSubjectHead);
  if (head === null || !HEX40.test(head)) {
    e.push('receipt names no valid evidence subject commit');
  } else if (head !== expect.evidenceSubjectHead) {
    e.push(
      `receipt was given against ${head.slice(0, 7)}, but this gate's evidence subject is ` +
        `${expect.evidenceSubjectHead.slice(0, 7)}; approval of other evidence is not approval of this`,
    );
  }

  // RECOMPUTED, NEVER TRUSTED. The record carries the id so a reader can see it; the runtime derives
  // it independently and compares.
  if (gateName !== null && head !== null) {
    const derived = gateInstanceId(expect.phaseId, gateName, expect.evidenceSubjectHead);
    if (receipt.gateInstanceId !== derived) {
      e.push(
        `receipt gateInstanceId ${JSON.stringify(receipt.gateInstanceId)} does not match the gate it ` +
          `would answer (${derived})`,
      );
    }
  }

  // THE CHOICE IS THE OWNER'S WORD, FROM A CLOSED SET.
  const choice = receipt.ownerChoice;
  if (typeof choice !== 'string' || !(OWNER_GATE_CHOICES as readonly string[]).includes(choice)) {
    e.push(
      `receipt records owner choice ${JSON.stringify(choice)}; a gate is answered with one of: ` +
        OWNER_GATE_CHOICES.join(', '),
    );
  }

  // PROVENANCE. The owner is whoever the ACTIVE APPROVED PLAN says, and no delegation applies here.
  const by = text(receipt.decidedBy);
  if (by === null) {
    e.push('receipt records no decidedBy');
  } else if (by !== expect.planOwner) {
    e.push(
      `receipt claims to be from ${JSON.stringify(by)}, who is not the owner named by the approved plan ` +
        `('${expect.planOwner}'); an owner gate has no delegated form`,
    );
  } else if (isImplementerName(by)) {
    e.push('receipt is attributed to the implementer, which can never hold owner authority');
  } else if (isModelName(by)) {
    e.push(
      'receipt is attributed to a model; a model may transport what the owner says but may never be ' +
        'recorded as having said it',
    );
  }

  if (text(receipt.decidedAt) === null) e.push('receipt records no decidedAt');

  return e;
}

/** Did the owner approve, refuse, or has the gate not been answered? */
export type OwnerGateState = 'APPROVED' | 'REFUSED' | 'UNANSWERED';

/**
 * The state of one gate, given a receipt that has already been checked.
 *
 * A receipt with ANY problem leaves the gate UNANSWERED rather than refused — the two are different
 * facts, and reporting a malformed approval as a refusal would tell the owner they said no when they
 * said something unreadable.
 */
export function ownerGateState(
  receipt: OwnerGateReceipt | null,
  expect: OwnerGateExpectations,
): { readonly state: OwnerGateState; readonly problems: readonly string[] } {
  const problems = checkOwnerGateReceipt(receipt, expect);
  if (problems.length > 0) return { state: 'UNANSWERED', problems };
  return { state: receipt?.ownerChoice === 'APPROVE' ? 'APPROVED' : 'REFUSED', problems: [] };
}

/**
 * Gates the plan requires that no valid receipt answers.
 *
 * `receipts` is keyed by gate name. A gate with no entry and a gate with an unusable entry both come
 * back outstanding, because from the point of view of "may this proceed" they are the same.
 */
export function unsatisfiedOwnerGates(
  receipts: ReadonlyMap<string, OwnerGateReceipt | null>,
  expect: OwnerGateExpectations,
): readonly string[] {
  const outstanding: string[] = [];
  for (const gate of expect.requiredOwnerGates) {
    const { state } = ownerGateState(receipts.get(gate) ?? null, { ...expect, requiredOwnerGates: [gate] });
    if (state !== 'APPROVED') outstanding.push(gate);
  }
  return outstanding;
}
