/**
 * AUTHORING ATTEMPT EVIDENCE — what a paid provider call leaves behind when it produces nothing.
 *
 * THE INCIDENT THIS EXISTS FOR. The first live plan-authoring call was dispatched, answered and
 * settled: 34,761 input tokens, 1,138 output tokens, 54,831 micro-USD. It then failed a check AFTER
 * settlement, and `brokeredAuthorPort` returned a refusal and dropped the response body on the floor.
 * Nothing anywhere persisted the reply. The money was gone, the authored material was unrecoverable,
 * and which of the two post-settlement branches had fired was not recorded — the detail existed only
 * as one line of text in a panel that was itself destroyed before the owner could read it.
 *
 * A PAID ANSWER MUST SURVIVE ITS OWN VALIDATION FAILURE. That is the whole of this module.
 *
 * WHAT IT IS NOT. It is not a transcript store and it is not an audit log. It is written for ACTUAL
 * DISPATCHES ONLY — a refusal that never reached the provider spent nothing and needs no record here
 * — and it is bounded, redacted and inert. Nothing reads it back as authority: the material it
 * carries is a CANDIDATE, kept so a human can see what was bought, never a plan and never a source
 * the runtime will act on.
 *
 * IT CANNOT RESCUE A REFUSAL. Writing evidence never changes an outcome. A provider refusal stays a
 * refusal with its evidence beside it, and a failure to WRITE the evidence is itself reported to the
 * owner rather than swallowed — after real money has been spent, silence about the record is the one
 * thing that must not happen.
 *
 * Created in PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A (post-live-call correction).
 */
import { createHash } from 'node:crypto';

import type { System } from './system.js';
import { redact as redactNamedValues } from './loop/verification.js';

export const AUTHORING_EVIDENCE_SCHEMA_VERSION = '1.0.0';

/** Where an attempt record lives, relative to the governed project root. */
export const AUTHORING_EVIDENCE_DIR = '.projectops/evidence/authoring';

/**
 * The most redacted response text one record may carry.
 *
 * BOUNDED ON PURPOSE. The point of the excerpt is to let a human see what the provider actually
 * said; it is not to archive the reply. A failed authoring reply is a few kilobytes, so this holds
 * the whole of a typical one while refusing to write a megabyte into a governed repository.
 */
export const MAX_EVIDENCE_EXCERPT_CHARS = 8_000;

/** The most redacted structured-output candidate one record may carry. */
export const MAX_EVIDENCE_CANDIDATE_CHARS = 16_000;

/**
 * A hard ceiling on the serialized record, past which it is refused rather than silently trimmed.
 *
 * MEASURED IN REAL BYTES. `String.length` counts UTF-16 code units, and a reply dense in non-Latin
 * text is up to three times larger on disk than its length suggests — so a ceiling checked with
 * `.length` is not the ceiling it claims to be.
 */
export const MAX_EVIDENCE_BYTES = 64_000;

/**
 * Value-shape patterns, mirroring `credentials/credential-shapes.cjs` and the two daemon redactors.
 *
 * Drift between the members of this family is refused by `val-projectos-provider-key-shapes1a`,
 * which compiles this array out of this file and runs it against the same fixtures as the others.
 * A provider reply is untrusted text about to be written into a governed repository, so it is
 * scanned with the same vocabulary as every other untrusted text in this system.
 */
const PATTERNS: readonly RegExp[] = [
/\bsbp_[A-Za-z0-9]{20,}\b/g,
/\bsb_secret_[A-Za-z0-9_-]{15,}\b/g,
/\bsb_publishable_[A-Za-z0-9_-]{15,}\b/g,
/\bvcp_[A-Za-z0-9]{20,}\b/g,
/\bgh[posru]_[A-Za-z0-9]{20,}\b/g,
/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
/\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
/\bre_[A-Za-z0-9]{20,}\b/g,
/\bAKIA[0-9A-Z]{16}\b/g,
/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
/\bsk-proj-[A-Za-z0-9_-]{20,}\b/g,
/\bsk-svcacct-[A-Za-z0-9_-]{20,}\b/g,
/\bsk-admin-[A-Za-z0-9_-]{20,}\b/g,
/\bsk-[A-Za-z0-9]{40,}\b/g,
/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

const REDACTED = '[REDACTED]';

/** How many times an escaped-escape may be unwrapped before the text is treated as settled. */
const MAX_UNESCAPE_PASSES = 3;

/**
 * Undo JSON's `\uXXXX` escaping before anything scans the text for secrets.
 *
 * THE BYPASS THIS CLOSES, FOUND BY ADVERSARIAL REVIEW AND REPRODUCED. Every pattern below matches
 * literal ASCII, and a provider reply is raw JSON TEXT: a reply may write any character of any string
 * as `\u0073\u006b…`, so a live `sk-ant-…` key never appears as itself in the bytes the scan sees.
 * `redactSecrets` left it untouched, `containsSecret` returned false, and the record — including the
 * key, recoverable with one more `JSON.parse` — was written into a governed repository. The
 * "refuse rather than write a secret" backstop was defeated by the reply's own encoding.
 *
 * NORMALISE, THEN SCAN. Applied repeatedly because an escaped backslash can hide another escape, and
 * bounded because a text designed to expand forever is a denial of service rather than a secret. The
 * excerpt stored is the NORMALISED text, which is what a human reading the record wants anyway; the
 * `responseSha256` alongside it still identifies the exact bytes the provider actually sent.
 */
export function normaliseEscapes(input: string): string {
  let text = input;
  for (let pass = 0; pass < MAX_UNESCAPE_PASSES; pass += 1) {
    const next = text.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    if (next === text) return text;
    text = next;
  }
  return text;
}

/**
 * Scrub credential-shaped values AND credential-named assignments from untrusted text.
 *
 * TWO VOCABULARIES, BOTH APPLIED. The named-assignment scan (`API_KEY: …`) catches a secret whose
 * VALUE has no recognisable shape; the shape scan catches a bare token nobody labelled. Neither is
 * sufficient alone and neither is a boundary — a hit means "definitely refuse", a miss never means
 * "definitely safe". The boundary is that the credential never leaves the trusted broker at all.
 */
export function redactSecrets(input: string): string {
  // NORMALISED FIRST. A secret spelled in `\uXXXX` escapes is the same secret, and scanning the
  // un-normalised text is how one got written into a governed repository during review.
  let out = redactNamedValues(normaliseEscapes(input));
  for (const pattern of PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

/** True if recognisable secret material survives redaction. Used to refuse, never to reassure. */
export function containsSecret(input: string): boolean {
  // BOTH FORMS ARE ASKED. The literal text catches a plain key; the normalised text catches one the
  // reply escaped. A backstop that can be stepped around by an encoding is not a backstop.
  const normalised = normaliseEscapes(input);
  return PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    if (pattern.test(input)) return true;
    pattern.lastIndex = 0;
    return pattern.test(normalised);
  });
}

/** How far the reply got. Each value is a fact about the attempt, never a judgement about the model. */
export type ParseOutcome = 'parsed' | 'not-json';
export type StructuredOutcome = 'extracted' | 'absent-or-refusal' | 'not-reached';
export type ValidationOutcome = 'valid' | 'invalid' | 'not-reached';

export interface AuthoringAttemptEvidence {
  readonly requestId: string;
  readonly projectId: string;
  readonly objectiveDigest: string;
  readonly model: string;
  readonly dispatchedAt: string;
  readonly settledAt: string | null;
  /** The provider's own id for the response, when it gave one. Never invented. */
  readonly providerResponseId: string | null;
  readonly httpStatus: number | null;
  readonly usage: {
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly outputTokens: number;
  };
  readonly settledCostMicroUsd: number | null;
  readonly parseOutcome: ParseOutcome;
  readonly structuredOutcome: StructuredOutcome;
  readonly validationOutcome: ValidationOutcome;
  readonly validationProblems: readonly string[];
  readonly finalOutcome: 'ok' | 'refused';
  readonly refusalCode: string | null;
  readonly refusalDetail: string | null;
  /** sha256 of the COMPLETE unredacted body — the excerpt is a sample, this identifies the whole. */
  readonly responseSha256: string;
  readonly responseBytes: number;
  /** Bounded, redacted sample of the response body. */
  readonly responseExcerpt: string;
  /** Bounded, redacted structured-output candidate, when one was extracted. */
  readonly structuredCandidate: string | null;
}

/** A request id may become a FILENAME, so it is held to its own grammar before it does. */
const REQUEST_ID = /^PAREQ-[0-9a-f]{24}$/;

export function authoringEvidenceRelPath(requestId: string): string | null {
  return REQUEST_ID.test(requestId) ? AUTHORING_EVIDENCE_DIR + '/' + requestId + '.json' : null;
}

/**
 * Cut to the bound, and cut BEFORE anything scans the text.
 *
 * ORDER IS A PERFORMANCE PROPERTY HERE, not a stylistic one. The named-assignment redactor's pattern
 * begins with an unanchored `[A-Za-z0-9_-]*`, which backtracks quadratically across a long run of
 * word characters: redacting a 400 KB reply first and trimming afterwards took TWO MINUTES in test,
 * inside a command whose own backstop is five. Only the excerpt is ever kept, so only the excerpt is
 * ever scanned; `responseSha256` is computed over the whole body separately and cheaply.
 */
function bounded(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '\n… truncated at ' + max + ' characters';
}

/** sha256 of the complete body, computed BEFORE redaction so it identifies what the provider sent. */
export function responseDigest(body: string): string {
  return 'sha256:' + createHash('sha256').update(body, 'utf8').digest('hex');
}

export interface EvidenceInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly objectiveDigest: string;
  readonly model: string;
  readonly dispatchedAt: string;
  readonly settledAt: string | null;
  readonly providerResponseId: string | null;
  readonly httpStatus: number | null;
  readonly usage: {
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly outputTokens: number;
  };
  readonly settledCostMicroUsd: number | null;
  readonly parseOutcome: ParseOutcome;
  readonly structuredOutcome: StructuredOutcome;
  readonly validationOutcome: ValidationOutcome;
  readonly validationProblems: readonly string[];
  readonly finalOutcome: 'ok' | 'refused';
  readonly refusalCode: string | null;
  readonly refusalDetail: string | null;
  /** The complete response body as received. Redacted and bounded here, never stored raw. */
  readonly responseBody: string;
  /** The extracted structured output, when there was one. Redacted and bounded here. */
  readonly structuredCandidate: unknown;
}

export function buildAuthoringAttemptEvidence(input: EvidenceInput): AuthoringAttemptEvidence {
  const candidate =
    input.structuredCandidate === undefined || input.structuredCandidate === null
      ? null
      : redactSecrets(bounded(JSON.stringify(input.structuredCandidate), MAX_EVIDENCE_CANDIDATE_CHARS));
  return {
    requestId: input.requestId,
    projectId: input.projectId,
    objectiveDigest: input.objectiveDigest,
    model: input.model,
    dispatchedAt: input.dispatchedAt,
    settledAt: input.settledAt,
    providerResponseId: input.providerResponseId,
    httpStatus: input.httpStatus,
    usage: input.usage,
    settledCostMicroUsd: input.settledCostMicroUsd,
    parseOutcome: input.parseOutcome,
    structuredOutcome: input.structuredOutcome,
    validationOutcome: input.validationOutcome,
    validationProblems: input.validationProblems,
    finalOutcome: input.finalOutcome,
    refusalCode: input.refusalCode,
    refusalDetail:
      input.refusalDetail === null ? null : bounded(redactSecrets(input.refusalDetail), 2_000),
    responseSha256: responseDigest(input.responseBody),
    responseBytes: Buffer.byteLength(input.responseBody, 'utf8'),
    responseExcerpt: redactSecrets(bounded(input.responseBody, MAX_EVIDENCE_EXCERPT_CHARS)),
    structuredCandidate: candidate,
  };
}

export type EvidenceWrite =
  | { readonly ok: true; readonly relPath: string }
  | { readonly ok: false; readonly problem: string };

/**
 * Write one attempt record. Never throws, and never reports success it did not achieve.
 *
 * REFUSES RATHER THAN WRITE A SECRET. If recognisable credential material survives redaction the
 * record is NOT written: an absent record is a smaller failure than a governed repository with a
 * live key committed into it, and the caller is told which of the two happened.
 */
export function writeAuthoringAttemptEvidence(
  sys: System,
  root: string,
  record: AuthoringAttemptEvidence,
): EvidenceWrite {
  const rel = authoringEvidenceRelPath(record.requestId);
  if (rel === null) {
    return {
      ok: false,
      problem:
        "'" + record.requestId + "' is not a plan-authoring request id, so no evidence path exists for it",
    };
  }
  const serialized =
    JSON.stringify({ schemaVersion: AUTHORING_EVIDENCE_SCHEMA_VERSION, ...record }, null, 2) + '\n';
  const size = Buffer.byteLength(serialized, 'utf8');
  if (size > MAX_EVIDENCE_BYTES) {
    return {
      ok: false,
      problem: 'the attempt record is ' + size + ' bytes, past the ' + MAX_EVIDENCE_BYTES + '-byte bound',
    };
  }
  if (containsSecret(serialized)) {
    return {
      ok: false,
      problem: 'the attempt record still carries credential-shaped text after redaction, so it was not written',
    };
  }
  try {
    sys.writeText(root + '/' + rel, serialized);
  } catch {
    return { ok: false, problem: 'the attempt record could not be written to ' + rel };
  }
  return sys.exists(root + '/' + rel)
    ? { ok: true, relPath: rel }
    : { ok: false, problem: 'the attempt record did not appear at ' + rel + ' after writing' };
}
