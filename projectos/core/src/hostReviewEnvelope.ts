/**
 * THE OUT-OF-BAND HALVES of one Host review, as the AGENT writes and reads them: the review SUBJECT it
 * puts in the Host's request inbox, and the RESPONSE RECORD it reads back from the Host's outbox.
 *
 * The one definition of both shapes is Rust —
 * `projectos/host/gatekeeper-attestation/src/envelope.rs`. This file produces a subject that parser
 * accepts and judges a record that encoder wrote, and `host-review-path-vectors.v1.json` holds real
 * bytes from both sides so the agreement is a checked fact.
 *
 * THE RESPONSE RECORD IS UNTRUSTED INPUT, WHOLE. It is read from a file the agent did not write. Before
 * a byte of it is believed it must (1) be within the bound, (2) hash to the sixteen bytes the wire
 * completion carried, (3) parse as exactly the closed shape — no unknown field anywhere, (4) answer THIS
 * correlation and THIS ask, (5) agree with the wire about whether the review succeeded, and (6) when
 * attested, carry an attestation whose Host-resolved fact digests equal the agent's own claim. What this
 * file does NOT do is judge the decision: the project, phase, subject commit and request digest the Host
 * echoed flow into the decision record UNCHANGED, so the existing decision and attestation checks
 * (`checkGatekeeperDecision`, `checkHostAttestation`, and their closure counterparts) refuse a wrong
 * one exactly as they refuse it on every other route. There is one opinion about what a valid decision
 * is, and it is not restated here.
 *
 * WHAT NEITHER SHAPE CARRIES. No credential, no token, no raw provider body, no hidden reasoning.
 *
 * PURE. No I/O. Created in PROJECTOS-HOST-REVIEW-PATH1A.
 */
import { createHash } from 'node:crypto';
import { CLOSURE_DECISION_SCHEMA_VERSION } from './closureDecision.js';
import type { ClosureResponseRecord } from './closureTransport.js';
import { GATEKEEPER_DECISION_SCHEMA_VERSION, type GatekeeperDecisionRecord } from './gatekeeperDecision.js';
import type { HostAttestationSummary } from './gatekeeperMode.js';
import type { HostBindingSubject } from './hostReviewWire.js';

export const HOST_REVIEW_SUBJECT_SCHEMA_VERSION = 1;
export const HOST_RESPONSE_RECORD_SCHEMA_VERSION = 1;
/** `MAX_REQUEST_BODY_BYTES` and `MAX_RESPONSE_RECORD_BYTES`: 64 KiB each. */
export const HOST_MAX_SUBJECT_BYTES = 64 * 1024;
export const HOST_MAX_RESPONSE_RECORD_BYTES = 64 * 1024;
/** The fixed leaf directories beneath the Host state root, and the fixed extensions. */
export const HOST_INBOX_LEAF = 'gatekeeper-inbox';
export const HOST_OUTBOX_LEAF = 'gatekeeper-outbox';
export const HOST_REQUEST_EXTENSION = 'request';
export const HOST_RESPONSE_EXTENSION = 'response';

export const HOST_REVIEW_ASKS = ['gatekeeper', 'closure'] as const;
export type HostReviewAsk = (typeof HOST_REVIEW_ASKS)[number];

/** What the agent DECLARES the review is about. The Host verifies the first five and echoes them all. */
export interface HostReviewDeclared {
  readonly projectId: string;
  readonly repository: string;
  readonly planRef: string;
  readonly phaseId: string;
  readonly subjectCommit: string;
  readonly requestId: string;
  readonly requestDigest: string;
  /** Closure only. */
  readonly scope?: string;
  /** Closure only. */
  readonly evidenceSubjectHead?: string;
}

const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
/** Revision 2 of the Host attestation binds the approved baseline and the candidate-evidence digest. */
export const HOST_ATTESTATION_SCHEMA_VERSION = 2;

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The file name of a correlation's subject or record. DERIVED, never supplied: hex and a fixed extension. */
export function hostExchangeFileName(correlation: string, extension: typeof HOST_REQUEST_EXTENSION | typeof HOST_RESPONSE_EXTENSION): string | null {
  return HEX32.test(correlation) ? `${correlation}.${extension}` : null;
}

/**
 * The exact subject bytes and the digest the wire will carry for them, or `null` when the subject is
 * malformed or over the Host's bound (which the Host would refuse anyway; refusing here spends nothing).
 *
 * KEYS IN THE RUST STRUCT'S DECLARATION ORDER, optional closure keys only when present. The Host parses
 * rather than re-serialises, so the order is a convention and not a requirement — it is kept so the
 * golden vectors are byte-stable.
 */
export function buildHostReviewSubject(input: {
  readonly ask: HostReviewAsk;
  readonly correlation: string;
  readonly declared: HostReviewDeclared;
  readonly providerRequest: string;
}): { readonly bytes: Buffer; readonly parameterDigest: string } | null {
  if (!HEX32.test(input.correlation)) return null;
  const d = input.declared;
  const declared: Record<string, string> = {
    projectId: d.projectId,
    repository: d.repository,
    planRef: d.planRef,
    phaseId: d.phaseId,
    subjectCommit: d.subjectCommit,
    requestId: d.requestId,
    requestDigest: d.requestDigest,
  };
  if (d.scope !== undefined) declared['scope'] = d.scope;
  if (d.evidenceSubjectHead !== undefined) declared['evidenceSubjectHead'] = d.evidenceSubjectHead;
  if (Object.values(declared).some((v) => typeof v !== 'string')) return null;
  const bytes = Buffer.from(
    JSON.stringify({
      schemaVersion: HOST_REVIEW_SUBJECT_SCHEMA_VERSION,
      ask: input.ask,
      correlation: input.correlation,
      declared,
      providerRequest: input.providerRequest,
    }),
    'utf8',
  );
  if (bytes.length === 0 || bytes.length > HOST_MAX_SUBJECT_BYTES) return null;
  return { bytes, parameterDigest: sha256Hex(bytes) };
}

/** First sixteen bytes of SHA-256 over the EXACT record bytes, as lower-case hex. Mirrors `evidence_ref_of`. */
export function hostEvidenceRefOf(record: Buffer): string {
  return sha256Hex(record).slice(0, 32);
}

// -------------------------------------------------------------------------------------------------
// THE RESPONSE RECORD
// -------------------------------------------------------------------------------------------------

export interface HostReviewedDecision {
  readonly decisionId: string;
  readonly verdict: string;
  readonly reason: string;
  readonly nextInstruction: string;
  readonly allowedActions: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly ownerApprovalRequired: boolean;
  readonly decidedBy: string;
  readonly decidedAt: string;
}

/** The attestation as the record carries it: the summary the existing check reads, plus the Host's facts. */
export interface HostRecordAttestation extends HostAttestationSummary {
  readonly project: string;
  readonly repository: string;
  readonly plan: string;
  readonly planDigest: string;
  readonly phase: string;
  readonly candidateDigest: string;
  /** The approved baseline commit the Host measured the candidate from, 40 lower-case hex. */
  readonly baselineCommit: string;
  /** The digest of the canonical candidate evidence the reviewer was shown, 64 lower-case hex. */
  readonly evidenceDigest: string;
  readonly delegationId: string;
  readonly tier: string;
}

export type HostResponseRecord =
  | {
      readonly outcome: 'attested';
      readonly ask: HostReviewAsk;
      readonly declared: HostReviewDeclared;
      readonly decision: HostReviewedDecision;
      readonly attestation: HostRecordAttestation;
      readonly usage: { readonly inputTokens: number; readonly cachedInputTokens: number; readonly outputTokens: number };
    }
  | {
      readonly outcome: 'failed';
      readonly ask: HostReviewAsk;
      readonly declared: HostReviewDeclared;
      /** THE HOST-AUTHORITATIVE DISPATCH FACT. Never inferred from the frame. */
      readonly providerDispatched: boolean;
    };

const TOP_KEYS = ['schemaVersion', 'correlation', 'ask', 'outcome', 'providerDispatched', 'declared', 'decision', 'attestation', 'usage'];
const DECLARED_KEYS = ['projectId', 'repository', 'planRef', 'phaseId', 'subjectCommit', 'requestId', 'requestDigest', 'scope', 'evidenceSubjectHead'];
const DECISION_KEYS = ['decisionId', 'verdict', 'reason', 'nextInstruction', 'allowedActions', 'forbiddenActions', 'ownerApprovalRequired', 'decidedBy', 'decidedAt'];
const ATTESTATION_KEYS = [
  'schemaVersion', 'attestationId', 'requestCorrelation', 'project', 'repository', 'plan', 'planDigest', 'phase',
  'candidateDigest', 'baselineCommit', 'evidenceDigest', 'delegationId', 'providerResponseId', 'provider', 'model', 'tier', 'verdict', 'allowedActions',
  // `admittedCostMicroUsd`, NOT `costMicroUsd`. Revision 2 states the amount the Host ADMITTED against
  // the budget. The Host has no rate card, so it states no accounted or billed cost, and the closed key
  // set means a record that carries the revision 1 field is refused as an unknown field.
  'ownerApprovalRequired', 'admittedCostMicroUsd', 'attestedAtEpochS',
];
const USAGE_KEYS = ['inputTokens', 'cachedInputTokens', 'outputTokens'];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function onlyKeys(o: Record<string, unknown>, allowed: readonly string[], where: string, e: string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) e.push(`the Host response record carries an unknown field ${where}${k}`);
}
function strings(o: Record<string, unknown>, keys: readonly string[], where: string, e: string[]): void {
  for (const k of keys) if (typeof o[k] !== 'string') e.push(`the Host response record has no usable ${where}${k}`);
}
function stringList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
function count(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** What the agent expects of the record — every value established by the agent, none by the record. */
export interface HostResponseExpectations {
  readonly correlation: string;
  readonly ask: HostReviewAsk;
  /** The wire completion's `evidenceRef`. */
  readonly evidenceRef: string;
  /** The wire completion's result class. */
  readonly wireResult: 'Succeeded' | 'Failed';
  /** The agent's own claim about the nine bound facts, and the delegation it named. */
  readonly claim: HostBindingSubject;
  readonly delegationId: string;
  /**
   * THE AGENT'S OWN READING OF THE CANDIDATE (PROJECTOS-HOST-REVIEW-PATH1B): the approved baseline it
   * measured from and the evidence digest it RECOMPUTED from the same two commits with its own
   * repository access. Established by the agent before the record is read, never taken from it.
   */
  readonly evidence: { readonly baselineCommit: string; readonly evidenceDigest: string };
}

/**
 * Judge the exact record bytes. `problems` is `[]` only when the record is bound to the wire, closed in
 * shape, answers this correlation and ask, agrees with the wire about the result and — when attested —
 * carries an attestation over the agent's own claimed facts. `record` is present only then.
 */
export function readHostResponseRecord(
  bytes: Buffer,
  expect: HostResponseExpectations,
): { readonly problems: readonly string[]; readonly record: HostResponseRecord | null } {
  const e: string[] = [];
  const fail = (): { problems: readonly string[]; record: null } => ({ problems: e, record: null });

  if (bytes.length === 0 || bytes.length > HOST_MAX_RESPONSE_RECORD_BYTES) {
    e.push(`the Host response record is ${bytes.length} bytes; the bound is 1..${HOST_MAX_RESPONSE_RECORD_BYTES}`);
    return fail();
  }
  // BOUND TO THE WIRE FIRST. A record that does not hash to what the completion carried is not the
  // record that completion is about, and nothing inside it is worth parsing.
  if (hostEvidenceRefOf(bytes) !== expect.evidenceRef) {
    e.push('the Host response record does not hash to the evidence reference the wire completion carried');
    return fail();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    e.push('the Host response record is not JSON');
    return fail();
  }
  if (!isObject(parsed)) {
    e.push('the Host response record is not an object');
    return fail();
  }
  onlyKeys(parsed, TOP_KEYS, '', e);
  if (parsed['schemaVersion'] !== HOST_RESPONSE_RECORD_SCHEMA_VERSION) e.push('the Host response record schemaVersion is not 1');
  if (parsed['correlation'] !== expect.correlation) e.push('the Host response record answers a different correlation');
  if (parsed['ask'] !== expect.ask) e.push(`the Host response record answers a different question than '${expect.ask}'`);
  const outcome = parsed['outcome'];
  if (outcome !== 'attested' && outcome !== 'failed') e.push('the Host response record carries no recognised outcome');
  if (typeof parsed['providerDispatched'] !== 'boolean') e.push('the Host response record does not state whether a provider was dispatched');
  // THE WIRE AND THE RECORD MUST TELL ONE STORY. A failure record under a succeeded completion (or the
  // reverse) is two answers to one question, and neither is believed.
  if ((outcome === 'attested') !== (expect.wireResult === 'Succeeded')) {
    e.push(`the wire completion reported ${expect.wireResult} but the Host response record says '${String(outcome)}'`);
  }

  const declared = parsed['declared'];
  if (!isObject(declared)) {
    e.push('the Host response record echoes no declared bindings');
  } else {
    onlyKeys(declared, DECLARED_KEYS, 'declared.', e);
    strings(declared, DECLARED_KEYS.slice(0, 7), 'declared.', e);
    for (const k of ['scope', 'evidenceSubjectHead']) {
      if (declared[k] !== undefined && typeof declared[k] !== 'string') e.push(`the Host response record has an unusable declared.${k}`);
    }
  }
  if (e.length > 0 || !isObject(declared)) return fail();
  const echoed = declared as unknown as HostReviewDeclared;

  if (outcome === 'failed') {
    for (const k of ['decision', 'attestation', 'usage']) {
      if (parsed[k] !== undefined) e.push(`a failed Host response record carries a ${k}`);
    }
    if (e.length > 0) return fail();
    return { problems: [], record: { outcome: 'failed', ask: expect.ask, declared: echoed, providerDispatched: parsed['providerDispatched'] as boolean } };
  }

  // ATTESTED. A provider answered, so it was dispatched; a record saying otherwise contradicts itself.
  if (parsed['providerDispatched'] !== true) e.push('an attested Host response record claims no provider was dispatched');
  const decision = parsed['decision'];
  const attestation = parsed['attestation'];
  const usage = parsed['usage'];
  if (!isObject(decision)) e.push('an attested Host response record carries no decision');
  else {
    onlyKeys(decision, DECISION_KEYS, 'decision.', e);
    strings(decision, ['decisionId', 'verdict', 'reason', 'nextInstruction', 'decidedBy', 'decidedAt'], 'decision.', e);
    if (!stringList(decision['allowedActions']) || !stringList(decision['forbiddenActions'])) e.push('the Host decision has no usable action lists');
    if (typeof decision['ownerApprovalRequired'] !== 'boolean') e.push('the Host decision does not state ownerApprovalRequired');
  }
  if (!isObject(attestation)) e.push('an attested Host response record carries no attestation');
  else {
    onlyKeys(attestation, ATTESTATION_KEYS, 'attestation.', e);
    // THE HOST'S FACTS MUST BE THE AGENT'S CLAIM. The Host refuses a request whose claim differs from
    // what it resolved, so an attestation over OTHER facts did not come from this request's review.
    const facts: readonly (readonly [string, string])[] = [
      ['project', expect.claim.project],
      ['repository', expect.claim.repository],
      ['plan', expect.claim.plan],
      ['planDigest', expect.claim.planDigest],
      ['phase', expect.claim.phase],
      ['candidateDigest', expect.claim.candidateDigest],
      ['delegationId', expect.delegationId],
    ];
    for (const [k, claimed] of facts) {
      const v = attestation[k];
      if (typeof v !== 'string' || !HEX64.test(v)) e.push(`the Host attestation carries no usable ${k}`);
      else if (v !== claimed) e.push(`the Host attestation is over a different ${k} than this request claimed`);
    }
    if (typeof attestation['tier'] !== 'string') e.push('the Host attestation names no tier');
    // THE ATTESTATION MUST BE ABOUT THE EVIDENCE OF THIS CANDIDATE. Revision 2 binds where the candidate
    // was measured from and the digest of what the reviewer was shown. The agent recomputed that digest
    // from the same baseline and candidate; an attestation over any other evidence is an attestation
    // about something the agent cannot reproduce, and is refused.
    if (attestation['schemaVersion'] !== HOST_ATTESTATION_SCHEMA_VERSION) {
      e.push(`the Host attestation schemaVersion is not ${HOST_ATTESTATION_SCHEMA_VERSION}, so it does not bind candidate evidence`);
    }
    const baseline = attestation['baselineCommit'];
    if (typeof baseline !== 'string' || !HEX40.test(baseline)) e.push('the Host attestation carries no usable baselineCommit');
    else if (baseline !== expect.evidence.baselineCommit) e.push('the Host attestation measured the candidate from a different baseline than the approved one');
    const evidenceDigest = attestation['evidenceDigest'];
    if (typeof evidenceDigest !== 'string' || !HEX64.test(evidenceDigest)) e.push('the Host attestation carries no usable evidenceDigest');
    else if (evidenceDigest !== expect.evidence.evidenceDigest) {
      e.push('the Host attestation is over evidence the agent cannot reproduce from the same baseline and candidate');
    }
    if (!count(attestation['admittedCostMicroUsd'])) e.push('the Host attestation states no usable admittedCostMicroUsd');
  }
  if (!isObject(usage)) e.push('an attested Host response record carries no usage');
  else {
    onlyKeys(usage, USAGE_KEYS, 'usage.', e);
    for (const k of USAGE_KEYS) if (!count(usage[k])) e.push(`the Host response record has no usable usage.${k}`);
  }
  if (e.length > 0) return fail();

  return {
    problems: [],
    record: {
      outcome: 'attested',
      ask: expect.ask,
      declared: echoed,
      decision: decision as unknown as HostReviewedDecision,
      attestation: attestation as unknown as HostRecordAttestation,
      usage: usage as unknown as { inputTokens: number; cachedInputTokens: number; outputTokens: number },
    },
  };
}

/**
 * The technical decision record, ASSEMBLED FROM WHAT THE HOST SAID — the binding fields from the Host's
 * echo, the choices from the reviewer. Nothing is taken from the agent's own request, so
 * `checkGatekeeperDecision` judges the Host's answer and not a copy of the question. A CANDIDATE.
 */
export function gatekeeperRecordFromHost(record: Extract<HostResponseRecord, { outcome: 'attested' }>): GatekeeperDecisionRecord {
  const { declared: d, decision: c } = record;
  return {
    schemaVersion: GATEKEEPER_DECISION_SCHEMA_VERSION,
    decisionId: c.decisionId,
    projectId: d.projectId,
    phaseId: d.phaseId,
    subjectCommit: d.subjectCommit,
    requestDigest: d.requestDigest,
    decision: c.verdict,
    allowedActions: [...c.allowedActions],
    forbiddenActions: [...c.forbiddenActions],
    ownerApprovalRequired: c.ownerApprovalRequired,
    reason: c.reason,
    nextClaudeInstruction: c.nextInstruction,
    risks: [],
    carryForward: [],
    decidedBy: c.decidedBy,
    decidedAt: c.decidedAt,
  };
}

/** The closure answer, assembled the same way. An independent provider accepts no findings for the owner. */
export function closureRecordFromHost(record: Extract<HostResponseRecord, { outcome: 'attested' }>): ClosureResponseRecord {
  const { declared: d, decision: c } = record;
  return {
    schemaVersion: CLOSURE_DECISION_SCHEMA_VERSION,
    decisionId: c.decisionId,
    decision: c.verdict,
    projectId: d.projectId,
    phaseId: d.phaseId,
    scope: d.scope ?? null,
    decidedBy: c.decidedBy,
    decidedAt: c.decidedAt,
    evidenceSubjectHead: d.evidenceSubjectHead ?? null,
    requestDigest: d.requestDigest,
    note: c.reason,
    ownerAcceptedFindings: [],
  };
}
