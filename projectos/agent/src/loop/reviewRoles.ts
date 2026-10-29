/**
 * D11 — review separated by role. PROJECTOS-KERNEL-ROLE-REVIEW1A.
 *
 * THE HOLE THIS CLOSES. A required review was satisfied by its NAME appearing in the findings record,
 * and the findings record is written by the worker that did the work. So an implementer could write
 * `"reviews": ["ECC SECURITY review"]` and the loop credited a security review nobody independent had
 * performed. Live, an agency phase whose plan named only "Claude self-review" closed with its own
 * acceptance criteria unmet (plan v1.15, SEO-AGENCY-SITE-CHECK2A).
 *
 * THE RULES, each pinned by `val-projectos-kernel-role-review1a`:
 *   R1 a review named as a self-review is the implementer's, and is the ONLY kind the implementer's
 *      own findings record can satisfy;
 *   R2 every other required review is satisfied only by a REVIEWER RECORD the loop itself wrote from
 *      the output of a reviewer worker it dispatched — never by anything the implementer wrote;
 *   R3 the reviewer is a different authorised worker from the implementer and holds no write grant;
 *   R4 the record is bound to the candidate (base commit + content digest) and to a nonce the loop
 *      generated for that one dispatch, so a record about other bytes, or a planted one, credits nothing;
 *   R5 a phase whose required reviews contain no independent review cannot be certified, and a plan
 *      declaring one is refused at approval.
 *
 * WHAT "DIFFERENT PROVIDER OR AGENT" MEANS HERE, honestly. R3 requires a different AGENT: a separate
 * authorised worker, a separate session that never saw the implementer's context, started by the loop
 * after the implementer exited. Whether the PROVIDER also differs (a Codex reviewer for a Claude
 * implementer) is recorded as `providerDistinct` on every record and is not refused, because only one
 * worker kind is built in today. The Stage 1 exit proof requires it to be true.
 */
import type { ReviewFinding, Severity } from './outcome.js';
import type { AuthorisedWorker } from './workers.js';
import { argvGrants, grantedPaths } from './workers.js';

/** R1. How a self-review is named in a plan: "Claude self-review", "worker self review", "self-review". */
export const SELF_REVIEW = /\bself[- ]?review\b/i;

export function isSelfReview(name: string): boolean {
  return SELF_REVIEW.test(name);
}

/** The required reviews only an independent reviewer can satisfy. */
export function independentReviews(required: readonly string[]): readonly string[] {
  return required.filter((r) => !isSelfReview(r));
}

/** R5, at approval. A phase with no independent review is refused, and so is one with no review at all. */
export function planReviewProblems(phaseId: string, required: readonly string[]): readonly string[] {
  if (independentReviews(required).length > 0) return [];
  const declared = required.length === 0 ? 'declares no required review' : `declares only ${required.join(', ')}`;
  return [
    `phase ${phaseId} ${declared}; D11 requires at least one review by someone other than the implementer, ` +
      'because a self-review cannot stop its own author closing partial work',
  ];
}

/** Who the candidate is, as the loop computed it. Never taken from a record. */
export interface ReviewSubject {
  readonly sessionId: string;
  readonly phaseId: string;
  readonly baseHead: string;
  readonly candidateDigest: string;
  readonly implementerWorkerId: string;
}

export type ReviewVerdict = 'APPROVE' | 'CONCERNS' | 'REJECT';
const VERDICTS: ReadonlySet<string> = new Set<ReviewVerdict>(['APPROVE', 'CONCERNS', 'REJECT']);
const SEVERITIES: ReadonlySet<string> = new Set<Severity>(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

/** Written by the LOOP, from the reviewer's output. The reviewer never writes this file. */
export interface ReviewerRecord {
  readonly schemaVersion: '1';
  readonly sessionId: string;
  readonly phaseId: string;
  readonly implementerWorkerId: string;
  readonly implementerKind: string;
  readonly reviewerWorkerId: string;
  readonly reviewerKind: string;
  readonly providerDistinct: boolean;
  readonly baseHead: string;
  readonly candidateDigest: string;
  readonly nonce: string;
  readonly reviewsRequested: readonly string[];
  readonly reviewsPerformed: readonly string[];
  readonly verdict: ReviewVerdict;
  readonly findings: readonly ReviewFinding[];
  readonly recordedAt: string;
}

/** R3. Why this reviewer may not review this implementer's work, or nothing. */
export function roleBindingProblems(implementer: AuthorisedWorker, reviewer: AuthorisedWorker | null): readonly string[] {
  if (reviewer === null) {
    return [
      'no reviewer worker is configured (`execution.reviewerWorkerId` in the committed project config), ' +
        'so no independent review can happen inside the loop',
    ];
  }
  const problems: string[] = [];
  if (reviewer.workerId === implementer.workerId) {
    problems.push(`the reviewer '${reviewer.workerId}' is the implementer; a worker never reviews its own work`);
  }
  // Any Write/Edit grant, including the implementer's own record grants: a reviewer that could write
  // the findings record could rewrite the implementer's account of itself.
  const grants = grantedPaths(argvGrants(reviewer.args));
  if (grants.length > 0) {
    problems.push(`the reviewer '${reviewer.workerId}' holds write grants (${grants.join(', ')}); a reviewer only reads`);
  }
  return problems;
}

/** The line the reviewer is asked to end with. The nonce ties it to one dispatch. */
export function verdictMarker(nonce: string): string {
  return `PROJECTOS-REVIEW ${nonce} `;
}

export type VerdictParse =
  | { readonly ok: true; readonly verdict: ReviewVerdict; readonly reviews: readonly string[]; readonly findings: readonly ReviewFinding[] }
  | { readonly ok: false; readonly problem: string };

/**
 * Read the reviewer's verdict from the text it returned.
 *
 * The LAST line carrying this dispatch's marker is used, so a reviewer quoting the instruction back
 * does not count as answering it. Anything unparseable is a problem, never an approval.
 */
export function parseReviewerVerdict(text: string, nonce: string): VerdictParse {
  const marker = verdictMarker(nonce);
  const line = text.split(/\r?\n/).filter((l) => l.trimStart().startsWith(marker)).pop();
  if (line === undefined) return { ok: false, problem: `the reviewer returned no verdict line for nonce ${nonce}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.trimStart().slice(marker.length));
  } catch {
    return { ok: false, problem: 'the reviewer verdict line is not valid JSON' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, problem: 'the reviewer verdict is not an object' };
  }
  const obj = parsed as Record<string, unknown>;
  const verdict = String(obj['verdict']);
  if (!VERDICTS.has(verdict)) return { ok: false, problem: `the reviewer verdict '${verdict}' is not APPROVE, CONCERNS or REJECT` };
  const reviews = Array.isArray(obj['reviews']) ? obj['reviews'].filter((r): r is string => typeof r === 'string') : [];
  const rawFindings = Array.isArray(obj['findings']) ? obj['findings'] : [];
  const findings: ReviewFinding[] = [];
  for (const [i, f] of rawFindings.entries()) {
    if (f === null || typeof f !== 'object' || Array.isArray(f)) return { ok: false, problem: `reviewer findings[${i}] is not an object` };
    const rec = f as Record<string, unknown>;
    const severity = String(rec['severity']);
    if (!SEVERITIES.has(severity)) return { ok: false, problem: `reviewer findings[${i}] has severity '${severity}'` };
    findings.push({
      id: `reviewer:${typeof rec['id'] === 'string' ? rec['id'] : `findings[${i}]`}`,
      severity: severity as Severity,
      category: typeof rec['category'] === 'string' ? rec['category'] : 'unspecified',
      summary: typeof rec['summary'] === 'string' ? rec['summary'] : '',
      // A reviewer reports what it found; it does not get to mark its own finding resolved.
      resolved: false,
    });
  }
  return { ok: true, verdict: verdict as ReviewVerdict, reviews, findings };
}

/** The reviewer's reply text: the CLI's structured `result` when it printed one, else the raw output. */
export function reviewerText(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result = (parsed as Record<string, unknown>)['result'];
      if (typeof result === 'string') return result;
    }
  } catch {
    // Not structured output; the raw text is what the reviewer said.
  }
  return stdout;
}

/** R4. Why a record does not describe this candidate, or nothing. */
export function reviewerRecordProblems(record: ReviewerRecord, subject: ReviewSubject, nonce: string): readonly string[] {
  const problems: string[] = [];
  if (record.sessionId !== subject.sessionId) problems.push('the reviewer record belongs to another session');
  if (record.phaseId !== subject.phaseId) problems.push('the reviewer record belongs to another phase');
  if (record.baseHead !== subject.baseHead) problems.push('the reviewer record reviewed a different base commit');
  if (record.candidateDigest !== subject.candidateDigest) problems.push('the reviewer record reviewed different candidate bytes');
  if (record.nonce !== nonce) problems.push('the reviewer record carries a nonce the loop did not issue for this dispatch');
  if (record.implementerWorkerId !== subject.implementerWorkerId) problems.push('the reviewer record names a different implementer');
  if (record.reviewerWorkerId === subject.implementerWorkerId) problems.push('the reviewer record was produced by the implementer');
  return problems;
}

/**
 * R1 + R2. Which required reviews this run has actually satisfied.
 *
 * The implementer's claims count ONLY for self-reviews. An independent review counts only when a
 * reviewer record, already judged by `reviewerRecordProblems`, says the reviewer performed it.
 * A REJECT verdict still records the reviews as performed; the rejection reaches the decision as a
 * blocking finding (see `reviewerFindings`), which is where a stop belongs.
 */
export function creditedReviews(
  required: readonly string[],
  implementerClaims: readonly string[],
  record: ReviewerRecord | null,
): readonly string[] {
  const performed = record === null ? [] : record.reviewsPerformed.filter((r) => record.reviewsRequested.includes(r));
  return required.filter((r) => (isSelfReview(r) ? implementerClaims.includes(r) : performed.includes(r)));
}

/** The reviewer's findings as the decision reads them. A REJECT with no blocking finding becomes one. */
export function reviewerFindings(record: ReviewerRecord | null): readonly ReviewFinding[] {
  if (record === null) return [];
  const blocking = record.findings.some((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  if (record.verdict !== 'REJECT' || blocking) return record.findings;
  return [
    ...record.findings,
    {
      id: 'reviewer:REJECT',
      severity: 'HIGH',
      category: 'independent-review',
      summary: `the independent reviewer '${record.reviewerWorkerId}' rejected the candidate`,
      resolved: false,
    },
  ];
}

/** The fixed sentence the reviewer is started with. It points at governed records and names no task. */
export function reviewInstruction(
  briefPath: string,
  subject: ReviewSubject,
  changedPaths: readonly string[],
  reviews: readonly string[],
  nonce: string,
): string {
  return (
    `You are the independent REVIEWER, not the implementer. Read the ProjectOS worker brief at ${briefPath} ` +
    `and review the uncommitted change in this repository on base commit ${subject.baseHead} ` +
    `(candidate digest ${subject.candidateDigest}). The changed paths are ${JSON.stringify(changedPaths)}; ` +
    'read them. You hold no write or shell grant; change nothing. ' +
    `Perform these reviews the approved plan requires: ${JSON.stringify(reviews)}. ` +
    'Judge the change against the phase acceptance criteria in the brief; partial work is a REJECT. ' +
    'End your reply with exactly one line: ' +
    `${verdictMarker(nonce)}{"verdict": "APPROVE"|"CONCERNS"|"REJECT", "reviews": [the reviews you performed], ` +
    '"findings": [{"id", "severity" of CRITICAL|HIGH|MEDIUM|LOW, "category", "summary"}]}'
  );
}
