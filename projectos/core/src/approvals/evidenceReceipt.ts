// SPDX-License-Identifier: MIT
// Ported-From: oh-my-hermes https://github.com/rlaope/oh-my-hermes
// Source-Path: src/evidence/labels.py; src/evidence/observed_check_results.py; src/workflows/goal_ledger.py; benchmarks/cross-harness/live/lib/receipt.py
// Source-Commit: 612a1cd9c44a19ecddcd263865e40e8c3910a514
// Source-Copyright: Copyright (c) 2026 oh-my-hermes contributors
// Port-Strategy: TRANSLATED
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python; the confidence ladder cut to the three values a done claim reads; a receipt is issued by the kernel and bound to a phase and a commit; a claim with nothing required is refused rather than ready; no file or ledger access.
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * Evidence before done. A phase claiming done without its receipt is refused.
 *
 * REPORTED DONE IS NOT VERIFIED. An executor saying it finished is a claim about itself. A check counts
 * only when something that is not the claimant saw it pass. So an operator's report of a pass is
 * `reported done` and closes nothing, whatever its exit status says.
 *
 * A RECEIPT IS ISSUED, NOT WRITTEN. A worker can write the JSON of a receipt, so a full-shape object
 * proves nothing. `claimDone` counts only what `recordCheckReceipt` returned in this process.
 *
 * WHAT THIS MODULE CANNOT PROVE. The observation is handed in by kernel code, so that the check really
 * ran, and that `source` is true, is the job of the call site, and there is no call site yet. A receipt
 * is not persisted either: the phase that wires this in has to decide how one is read back.
 *
 * A RECEIPT IS FOR ONE PHASE AND ONE COMMIT. A check on an earlier commit says nothing about this one,
 * which is what freshness means here. An observed failure on the claimed commit outranks a pass on the
 * same commit, so green cannot be re-rolled.
 *
 * A CLAIM WITH NOTHING REQUIRED IS REFUSED. The upstream gate reads ready when no required criterion is
 * missing, so an empty list is ready. Here that is a refusal, because a gate that an empty list passes
 * proves nothing. `requiredChecks` must come from the plan, never from the claimant.
 *
 * This is pure and wired to nothing. It sits beside the closure path and changes none of it. Being
 * ready here is necessary for a claim and does not close anything: closure stays with the closure
 * authority. The ported rules are structural, so there is no list of words that make a summary
 * acceptable, and no such list is carried over.
 */
import { instantOf } from './instant.js';

/** Where a check ran. The same command proves different things in each. */
export const CHECK_SOURCES = ['this-checkout', 'ci-job', 'operator-report'] as const;
export type CheckSource = (typeof CHECK_SOURCES)[number];

/** What is known about a check. `reported done` names the claimant inside the word. */
export type CheckConfidence = 'verified' | 'failed' | 'reported done';

export interface CheckObservation {
  readonly phaseId: string;
  /** The name the plan requires, such as a validator. */
  readonly checkId: string;
  /** The commit the check ran on. */
  readonly subject: string;
  /** Verbatim, not a description of it. */
  readonly command: string;
  readonly source: CheckSource;
  readonly exitStatus: number;
  /** What the output said. */
  readonly summary: string;
  /** What that run covered, since a narrower run proves less. */
  readonly scope: string;
  readonly observedAt: string;
}

export interface EvidenceReceipt extends CheckObservation {
  /** Derived from the source and the exit status. There is no way to state it. */
  readonly confidence: CheckConfidence;
}

export type ReceiptResult = { readonly ok: true; readonly receipt: EvidenceReceipt } | { readonly ok: false; readonly reasons: readonly string[] };

const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Receipts `recordCheckReceipt` made. Nothing else counts toward a claim. */
const LIVE_RECEIPTS = new WeakSet<EvidenceReceipt>();

const nonBlank = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';

function confidenceOf(source: CheckSource, exitStatus: number): CheckConfidence {
  if (exitStatus !== 0) return 'failed';
  return source === 'operator-report' ? 'reported done' : 'verified';
}

function observationProblems(observation: CheckObservation): readonly string[] {
  const { phaseId, checkId, subject, command, source, exitStatus, summary, scope, observedAt } = observation;
  return [
    ...(nonBlank(phaseId) ? [] : ['the observation names no phase']),
    ...(nonBlank(checkId) ? [] : ['the observation names no check']),
    ...(typeof subject === 'string' && COMMIT.test(subject) ? [] : ['the subject is not a commit']),
    ...(nonBlank(command) ? [] : ['the observation has no command']),
    ...((CHECK_SOURCES as readonly unknown[]).includes(source) ? [] : ['the source is unknown']),
    ...(Number.isInteger(exitStatus) ? [] : ['the exit status is not an integer']),
    ...(nonBlank(summary) ? [] : ['the observation has no summary']),
    ...(nonBlank(scope) ? [] : ['the observation has no scope']),
    ...(instantOf(observedAt) === null ? ['the observation has no readable time'] : []),
  ];
}

/** Record what the kernel saw. The observation is read field by field, so nothing else gets in. */
export function recordCheckReceipt(observation: CheckObservation): ReceiptResult {
  const reasons = observationProblems(observation);
  if (reasons.length > 0) return { ok: false, reasons };
  const { phaseId, checkId, subject, command, source, exitStatus, summary, scope, observedAt } = observation;
  const receipt: EvidenceReceipt = Object.freeze({
    phaseId,
    checkId,
    subject,
    command,
    source,
    exitStatus,
    summary,
    scope,
    observedAt,
    confidence: confidenceOf(source, exitStatus),
  });
  LIVE_RECEIPTS.add(receipt);
  return { ok: true, receipt };
}

export interface DoneClaim {
  readonly phaseId: string;
  /** The commit claimed done. */
  readonly subject: string;
  /** From the plan, never from the claimant. Empty is a refusal. */
  readonly requiredChecks: readonly string[];
  /** Anything still recorded as in the way. */
  readonly openBlockers: readonly string[];
}

export type DoneRule =
  | 'NO_REQUIRED_CHECKS'
  | 'OPEN_BLOCKER'
  | 'NO_RECEIPT'
  | 'RECEIPT_FORGED'
  | 'RECEIPT_OTHER_PHASE'
  | 'RECEIPT_STALE'
  | 'CHECK_FAILED'
  | 'NOT_VERIFIED';

export interface DoneGap {
  readonly rule: DoneRule;
  readonly checkId: string | null;
  readonly reason: string;
}

export type DoneVerdict = { readonly ready: true } | { readonly ready: false; readonly gaps: readonly DoneGap[] };

/** Why this required check is not met, or `null` if it is. Each step narrows what the next one may count. */
function checkGap(claim: DoneClaim, checkId: string, receipts: readonly EvidenceReceipt[]): DoneGap | null {
  const gap = (rule: DoneRule, reason: string): DoneGap => ({ rule, checkId, reason });
  const named = receipts.filter((receipt) => receipt.checkId === checkId);
  if (named.length === 0) return gap('NO_RECEIPT', `there is no receipt for '${checkId}'`);
  const genuine = named.filter((receipt) => LIVE_RECEIPTS.has(receipt));
  if (genuine.length === 0) return gap('RECEIPT_FORGED', `no receipt for '${checkId}' was recorded by the kernel`);
  const inPhase = genuine.filter((receipt) => receipt.phaseId === claim.phaseId);
  if (inPhase.length === 0) return gap('RECEIPT_OTHER_PHASE', `every receipt for '${checkId}' belongs to another phase`);
  const current = inPhase.filter((receipt) => receipt.subject === claim.subject);
  if (current.length === 0) return gap('RECEIPT_STALE', `'${checkId}' was not run on ${claim.subject}`);
  if (current.some((receipt) => receipt.confidence === 'failed')) return gap('CHECK_FAILED', `'${checkId}' failed on ${claim.subject}`);
  if (!current.some((receipt) => receipt.confidence === 'verified')) return gap('NOT_VERIFIED', `'${checkId}' is reported done, and nobody saw it pass`);
  return null;
}

/**
 * Is this claim backed? Every gap is reported, not the first, so one answer shows all that is missing.
 * The receipts are handed in by kernel code, and a claimant cannot add to them.
 */
export function claimDone(claim: DoneClaim, receipts: readonly EvidenceReceipt[]): DoneVerdict {
  const gaps: readonly DoneGap[] = [
    ...(claim.requiredChecks.length === 0 ? [{ rule: 'NO_REQUIRED_CHECKS' as const, checkId: null, reason: 'nothing is required, so nothing would be proved' }] : []),
    ...claim.openBlockers.map((blocker) => ({ rule: 'OPEN_BLOCKER' as const, checkId: null, reason: blocker })),
    ...claim.requiredChecks.flatMap((checkId) => checkGap(claim, checkId, receipts) ?? []),
  ];
  return gaps.length === 0 ? { ready: true } : { ready: false, gaps };
}
