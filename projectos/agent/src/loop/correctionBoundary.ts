/**
 * What a bounded correction worker may touch — derived by ProjectOS, narrowed by the reviewer.
 *
 * THE PROBLEM THIS SOLVES, OBSERVED FOR REAL. On 2026-08-18 the live loop ran three correction
 * attempts against an unresolved HIGH. Each time the reviewer asked for a source fix; each time the
 * worker answered "BLOCKED: write permission denied", because its tool grants permit writing only
 * its own findings and effects records. The loop corrected nothing — it re-ran and re-reported. A
 * correction cycle that cannot correct is not a correction cycle.
 *
 * THE DIRECTION OF AUTHORITY IS THE WHOLE DESIGN:
 *
 *     approved phase scope  ->  ProjectOS derives the MAXIMUM writable boundary
 *                           ->  the reviewer's amendment requests a SUBSET
 *                           ->  ProjectOS validates the subset
 *                           ->  the worker receives exactly that subset
 *
 * The reviewer may NARROW. The reviewer may not EXPAND, and neither may the implementer. A path
 * named in model prose is not authorised by having been named — it is authorised only if ProjectOS
 * already permitted it. That is why the maximum comes from governed configuration and the request is
 * checked against it, rather than the request being taken as the boundary.
 *
 * COMMIT AND PUSH ARE ABSENT, NOT DISCOURAGED. The grants this produces are `Edit(...)`/`Write(...)`
 * over specific paths. No `Bash(...)` grant is ever emitted, and `toolGrantProblems` in `workers.ts`
 * refuses a write-capable grant outside the permitted set — so the correction worker has no shell at
 * all and cannot run git, however it is instructed.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 */
import type { LedgerEntry } from '@projectos/core';

/** A correction the runtime has authorised, ready to become worker tool grants. */
export interface AuthorisedCorrection {
  readonly paths: readonly string[];
  readonly grants: readonly string[];
  readonly attemptsRemaining: number;
}

export interface CorrectionRequest {
  /** Paths the amendment asks to change, as ProjectOS parsed them. Never free prose. */
  readonly requestedPaths: readonly string[];
  readonly projectId: string;
  readonly phaseId: string;
  readonly subjectCommit: string;
  /** The decision that asked for this correction. */
  readonly decisionId: string;
}

export interface CorrectionContext {
  /** The maximum ProjectOS permits for this phase. The ceiling, from governed configuration. */
  readonly maximumPaths: readonly string[];
  readonly projectId: string;
  readonly phaseId: string;
  readonly subjectCommit: string;
  /** Decisions already spent. A correction may not run twice on one decision. */
  readonly consumedDecisionIds: readonly string[];
  /** What remains of the objective's ONE correction allowance. */
  readonly attemptsRemaining: number;
}

export type CorrectionVerdict =
  | { readonly ok: true; readonly correction: AuthorisedCorrection }
  | { readonly ok: false; readonly reasons: readonly string[] };

/** Normalise for comparison without letting separators or case invent a different path. */
function norm(p: string): string {
  const parts = p.trim().split(String.fromCharCode(92)).join('/');
  return parts.replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
}

/**
 * Is `candidate` inside `boundary`?
 *
 * PREFIX MATCHING ON SEGMENTS, not on characters. A character prefix would make
 * `projectos/agent-secrets` look like it is inside `projectos/agent`, which is exactly the kind of
 * near-miss a boundary check exists to catch.
 */
export function within(candidate: string, boundary: string): boolean {
  const c = norm(candidate);
  const b = norm(boundary);
  return c === b || c.startsWith(`${b}/`);
}

/**
 * Authorise a correction, or refuse it.
 *
 * EVERY REFUSAL HAPPENS BEFORE THE WORKER STARTS. Once a worker is running with a grant, the grant is
 * the boundary; the only place to be strict is here.
 */
export function authoriseCorrection(request: CorrectionRequest, context: CorrectionContext): CorrectionVerdict {
  const reasons: string[] = [];

  if (request.projectId !== context.projectId) {
    reasons.push(`the correction is for project '${request.projectId}', not '${context.projectId}'`);
  }
  if (request.phaseId !== context.phaseId) {
    reasons.push(`the correction is for phase '${request.phaseId}', not '${context.phaseId}'`);
  }
  // AN UNBOUND CORRECTION IS NOT A BOUND ONE. Both sides derive from `verification.observed.head ??
  // ''`, so a run whose HEAD could not be read produced '' on both sides and compared EQUAL - the
  // subject binding passed by being absent. Raised as SEC-EMPTY-SUBJECT-COMMIT by the live reviewer
  // against this file's own caller. Same for the decision id: '' deduplicates against '' in
  // `consumedDecisionIds`, so an unnamed decision could drive a second correction.
  if (request.subjectCommit.trim() === '' || context.subjectCommit.trim() === '') {
    reasons.push('the correction names no subject commit, so it is bound to nothing and cannot be authorised');
  }
  if (request.decisionId.trim() === '') {
    reasons.push('the correction names no decision, so nothing authorised it');
  }
  if (request.subjectCommit !== context.subjectCommit) {
    reasons.push(
      `the correction was authorised against ${request.subjectCommit.slice(0, 7)}, but this run's subject ` +
        `is ${context.subjectCommit.slice(0, 7)}; a correction for other bytes is stale`,
    );
  }
  if (context.consumedDecisionIds.includes(request.decisionId)) {
    reasons.push(`decision ${request.decisionId} has already driven a correction and cannot drive another`);
  }

  // THE BUDGET IS THE OBJECTIVE'S, NOT THE CORRECTION'S. Nothing here can add to it: not the
  // reviewer, not the worker, not a restart.
  if (context.attemptsRemaining <= 0) {
    reasons.push('the correction allowance for this objective is exhausted; the loop stops rather than retrying');
  }

  if (request.requestedPaths.length === 0) {
    reasons.push('the amendment named no path to correct, so there is nothing to authorise');
  }

  // THE SUBSET RULE. A path the reviewer asked for is authorised only if ProjectOS already permitted
  // it. Naming it is not authorising it.
  const approved: string[] = [];
  for (const requested of request.requestedPaths) {
    const clean = requested.trim();
    if (clean === '' || clean.includes('..') || clean.startsWith('/') || /^[A-Za-z]:/.test(clean)) {
      reasons.push(`requested path ${JSON.stringify(requested)} is not a repository-relative path`);
      continue;
    }
    if (!context.maximumPaths.some((max) => within(clean, max))) {
      reasons.push(
        `requested path '${clean}' is outside the boundary this phase permits ` +
          `(${context.maximumPaths.join(', ') || 'none'}); the reviewer may narrow the boundary and may never widen it`,
      );
      continue;
    }
    approved.push(clean);
  }

  if (reasons.length > 0) return { ok: false, reasons };

  return {
    ok: true,
    correction: {
      paths: approved,
      // Edit and Write only. No Bash, so no git, so no commit and no push - structurally, not by rule.
      grants: approved.flatMap((p) => [`Edit(${p})`, `Write(${p})`]),
      attemptsRemaining: context.attemptsRemaining,
    },
  };
}

/**
 * The paths an amendment instruction refers to, as ProjectOS reads them.
 *
 * DELIBERATELY LITERAL. It extracts repository-relative path-shaped tokens and nothing else; it does
 * not interpret the sentence around them. Whatever it finds is then checked against the maximum, so
 * a wrong extraction can only ever produce a refusal, never an authorisation.
 *
 * IT ONLY RECOGNISES THESE EXTENSIONS: .ts .tsx .js .cjs .mjs .json .md. A correction aimed at any
 * other kind of file - a .yml, a .sql, a .css - is not extracted, so it is not requested, so it is
 * refused for naming nothing. That is the safe direction and it is also a real limitation, stated
 * here because it was invisible to callers: raised as CORR-EXTENSION-WHITELIST-INVISIBLE by the live
 * reviewer. Widening it is a governed decision, not a convenience.
 */
export function pathsNamedIn(instruction: string): readonly string[] {
  const found = instruction.match(/[A-Za-z0-9_.\-/]+\.(ts|tsx|js|cjs|mjs|json|md)\b/g) ?? [];
  return [...new Set(found.map((p) => p.replace(/^\.\//, '')))];
}

/** Correction attempts left, given the bound and what has been spent. */
export function attemptsRemaining(maxAttempts: number, spent: number): number {
  return Math.max(0, maxAttempts - spent);
}

/** Unused import guard: keeps the ledger type referenced for future spend binding. */
export type CorrectionLedgerEntry = LedgerEntry;
