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
import { randomBytes } from 'node:crypto';
import type { System } from '../system.js';
import type { WorkerBrief } from './brief.js';
import { computeCandidateIdentity } from './candidateIdentity.js';
import {
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
  | { readonly ok: true; readonly record: ReviewerRecord }
  | { readonly ok: false; readonly problems: readonly string[] };

/** `num_turns` from the CLI's structured output, or null when it reported none. */
function reviewerTurns(stdout: string): number | null {
  try {
    const turns = (JSON.parse(stdout.trim()) as Record<string, unknown>)['num_turns'];
    return typeof turns === 'number' ? turns : null;
  } catch {
    return null;
  }
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

  const before = computeCandidateIdentity(sys, root);
  if (!before.ok) return { ok: false, problems: before.problems.map((p) => `the candidate could not be named: ${p}`) };
  const subject: ReviewSubject = {
    sessionId: input.sessionId,
    phaseId: input.brief.phase.phaseId,
    baseHead,
    candidateDigest: before.identity.digest,
    implementerWorkerId: input.implementer.workerId,
  };
  const nonce = input.nonce ?? randomBytes(16).toString('hex');
  const paths = before.identity.entries.map((e) => e.path);
  const armed = reviewerConfigPaths(paths);
  if (armed.length > 0) {
    return {
      ok: false,
      problems: [`the candidate changes files the reviewer would load as its own configuration (${armed.join(', ')}); it is not reviewed in-loop`],
    };
  }
  const outcome = adapter.review(sys, worker, input.brief, reviewInstruction(input.brief.records.briefPath, subject, paths, requested, nonce));

  const after = computeCandidateIdentity(sys, root);
  if (!after.ok || after.identity.digest !== before.identity.digest) {
    return { ok: false, problems: [`the reviewer '${worker.workerId}' changed the candidate while reviewing it; its review is discarded`] };
  }
  if (outcome.kind !== 'completed') {
    const why = outcome.kind === 'timedOut' ? `ran past its ${outcome.afterMs} ms bound` : `was refused: ${outcome.detail}`;
    return { ok: false, problems: [`the reviewer '${worker.workerId}' ${why}`] };
  }
  if (outcome.exitCode !== 0) return { ok: false, problems: [`the reviewer '${worker.workerId}' exited ${outcome.exitCode}`] };
  if (reviewerTurns(outcome.stdout) === 1) {
    return { ok: false, problems: [`the reviewer '${worker.workerId}' answered without reading anything, which is not a review`] };
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
  writeReviewerRecord(sys, root, record);
  return { ok: true, record };
}
