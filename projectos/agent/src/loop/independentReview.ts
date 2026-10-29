/**
 * D11 — the loop dispatches the independent reviewer and writes its record. PROJECTOS-KERNEL-ROLE-REVIEW1A.
 *
 * WHO AUTHORS WHAT. The reviewer worker is started by the loop AFTER the implementer exited, with a
 * nonce the implementer never saw. Its reply is read from its stdout and nothing it writes to disk is
 * trusted. The record is written by THIS module, and the caller credits reviews from the returned
 * object — never from the file — so a record planted or edited on disk credits nothing.
 *
 * THE REVIEWER MAY NOT MOVE THE CANDIDATE. The candidate identity is computed before and after the
 * reviewer runs; any difference discards the review. The record is bound to the BEFORE identity, which
 * is the identity of the bytes the reviewer was asked about. (Writing the record itself changes the
 * working tree, because `.projectops/execution/` is not ignored, so the gatekeeper later seals a
 * candidate that INCLUDES the record — which is what it should be shown.)
 */
import { createHash, randomBytes } from 'node:crypto';
import type { System } from '../system.js';
import type { WorkerBrief } from './brief.js';
import { candidateDigest, computeCandidateIdentity } from './candidateIdentity.js';
import type { CandidateEntry } from '@projectos/core';
import {
  REVIEW_PATHS_SHOWN,
  parseReviewerVerdict,
  reviewerConfigPaths,
  reviewInstruction,
  reviewerRecordProblems,
  reviewerText,
  roleBindingProblems,
  workerReviewable,
  type ReviewSubject,
  type ReviewerRecord,
} from './reviewRoles.js';
import { writeReviewerRecord } from './session.js';
import type { AuthorisedWorker, WorkerAdapter } from './workers.js';

export interface IndependentReviewInput {
  readonly sessionId: string;
  readonly brief: WorkerBrief;
  readonly implementer: AuthorisedWorker;
  /** `resolveReviewer`'s answer; null when no reviewer is configured. */
  readonly reviewer: { readonly worker: AuthorisedWorker; readonly adapter: WorkerAdapter } | null;
  /** The independent reviews still outstanding. Only these are requested. */
  readonly outstanding: readonly string[];
  readonly now: string;
  /** Injected so a test can pin the nonce; production uses 16 random bytes. */
  readonly nonce?: string;
}

export type IndependentReviewResult =
  | { readonly ok: true; readonly record: ReviewerRecord; readonly recordSha256: string }
  | { readonly ok: false; readonly problems: readonly string[] };

/** A field of the CLI's structured output, or undefined when the output is not structured. */
function structuredField(stdout: string, field: string): unknown {
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>)[field] : undefined;
  } catch {
    return undefined;
  }
}

/** `num_turns`, or null when the CLI reported none — which is not evidence of reading anything. */
function reviewerTurns(stdout: string): number | null {
  const turns = structuredField(stdout, 'num_turns');
  return typeof turns === 'number' ? turns : null;
}

/** How many tool uses the CLI denied the reviewer. A CLI that reports no list denied none. */
function reviewerDenials(stdout: string): number {
  const denials = structuredField(stdout, 'permission_denials');
  return Array.isArray(denials) ? denials.length : 0;
}

/**
 * The digest of the reviewed bytes: the candidate WITHOUT the two records the loop writes after the
 * review (this session's evidence and reviewer record). Excluding them is what lets the same digest be
 * recomputed at the seal, after both exist (ECC CODE M1).
 */
export function reviewedDigest(entries: readonly CandidateEntry[], sessionId: string): string {
  const own = new Set([`.projectops/execution/${sessionId}.evidence.json`, `.projectops/execution/${sessionId}.reviewer.json`]);
  return candidateDigest(entries.filter((e) => !own.has(e.path)));
}

/** Are the bytes about to be sealed for the gatekeeper still the bytes the reviewer reviewed? */
export function candidateStillReviewed(sys: System, root: string, record: ReviewerRecord): boolean {
  const now = computeCandidateIdentity(sys, root);
  return now.ok && reviewedDigest(now.identity.entries, record.sessionId) === record.candidateDigest;
}

export function runIndependentReview(sys: System, root: string, input: IndependentReviewInput): IndependentReviewResult {
  const requested = workerReviewable(input.outstanding);
  if (requested.length === 0) {
    return { ok: false, problems: ['no outstanding review is one a reviewer worker may give; the rest are the owner\'s or the gatekeeper\'s'] };
  }
  const binding = roleBindingProblems(input.implementer, input.reviewer?.worker ?? null);
  if (binding.length > 0 || input.reviewer === null) return { ok: false, problems: binding };
  const { worker, adapter } = input.reviewer;
  if (adapter.review === undefined) {
    return { ok: false, problems: [`the reviewer '${worker.workerId}' is of kind '${worker.kind}', which cannot run a review`] };
  }
  const baseHead = input.brief.repository.head;
  if (baseHead === null) return { ok: false, problems: ['the brief is not bound to a commit, so there is no base to review against'] };

  // THE BRIEF ON DISK MUST STILL BE THE ONE THE LOOP WROTE. The checks ran candidate code since, and the
  // reviewer reads its acceptance criteria from this file (ECC SECURITY N4). Same encoding as `writeBrief`.
  if (sys.readText(input.brief.records.briefPath) !== `${JSON.stringify(input.brief, null, 2)}\n`) {
    return { ok: false, problems: ['the brief on disk is not the one the loop wrote for this run, so the reviewer would judge against other criteria'] };
  }
  const before = computeCandidateIdentity(sys, root);
  if (!before.ok) return { ok: false, problems: before.problems.map((p) => `the candidate could not be named: ${p}`) };
  const subject: ReviewSubject = {
    sessionId: input.sessionId,
    phaseId: input.brief.phase.phaseId,
    baseHead,
    candidateDigest: reviewedDigest(before.identity.entries, input.sessionId),
    implementerWorkerId: input.implementer.workerId,
  };
  const nonce = input.nonce ?? randomBytes(16).toString('hex');
  const paths = before.identity.entries.map((e) => e.path);
  if (paths.length > REVIEW_PATHS_SHOWN) {
    return {
      ok: false,
      problems: [`the candidate changes ${paths.length} paths, more than the ${REVIEW_PATHS_SHOWN} one review is shown; a partly seen change is not reviewed`],
    };
  }
  const armed = reviewerConfigPaths(paths);
  if (armed.length > 0) {
    return {
      ok: false,
      problems: [`the candidate changes files the reviewer would load as its own configuration (${armed.join(', ')}); it is not reviewed in-loop`],
    };
  }
  const outcome = adapter.review(sys, worker, input.brief, reviewInstruction(input.brief.records.briefPath, subject, paths, requested, nonce));

  const after = computeCandidateIdentity(sys, root);
  if (!after.ok || reviewedDigest(after.identity.entries, input.sessionId) !== subject.candidateDigest) {
    return { ok: false, problems: [`the reviewer '${worker.workerId}' changed the candidate while reviewing it; its review is discarded`] };
  }
  if (outcome.kind !== 'completed') {
    const why = outcome.kind === 'timedOut' ? `ran past its ${outcome.afterMs} ms bound` : `was refused: ${outcome.detail}`;
    return { ok: false, problems: [`the reviewer '${worker.workerId}' ${why}`] };
  }
  if (outcome.exitCode !== 0) return { ok: false, problems: [`the reviewer '${worker.workerId}' exited ${outcome.exitCode}`] };
  const turns = reviewerTurns(outcome.stdout);
  if (turns === null || turns < 2) {
    return { ok: false, problems: [`the reviewer '${worker.workerId}' did not show that it read anything, which is not a review`] };
  }
  if (reviewerDenials(outcome.stdout) > 0) {
    return { ok: false, problems: [`the reviewer '${worker.workerId}' attempted tools it was denied, so it may have been steered by the candidate`] };
  }
  const parsed = parseReviewerVerdict(reviewerText(outcome.stdout), nonce);
  if (!parsed.ok) return { ok: false, problems: [parsed.problem] };

  const record: ReviewerRecord = {
    schemaVersion: '1',
    sessionId: subject.sessionId,
    phaseId: subject.phaseId,
    implementerWorkerId: input.implementer.workerId,
    implementerKind: input.implementer.kind,
    reviewerWorkerId: worker.workerId,
    reviewerKind: worker.kind,
    providerDistinct: worker.kind !== input.implementer.kind,
    baseHead: subject.baseHead,
    candidateDigest: subject.candidateDigest,
    nonce,
    reviewsRequested: requested,
    reviewsPerformed: parsed.reviews,
    verdict: parsed.verdict,
    findings: parsed.findings,
    recordedAt: input.now,
  };
  const problems = reviewerRecordProblems(record, subject, nonce);
  if (problems.length > 0) return { ok: false, problems };
  const written = writeReviewerRecord(sys, root, record);
  return { ok: true, record, recordSha256: createHash('sha256').update(written, 'utf8').digest('hex') };
}
