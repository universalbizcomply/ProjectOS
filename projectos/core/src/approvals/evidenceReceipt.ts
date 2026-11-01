// SPDX-License-Identifier: MIT
// Ported-From: oh-my-hermes https://github.com/rlaope/oh-my-hermes
// Source-Path: src/evidence/labels.py; src/evidence/observed_check_results.py; src/workflows/goal_ledger.py; benchmarks/cross-harness/live/lib/receipt.py
// Source-Commit: 612a1cd9c44a19ecddcd263865e40e8c3910a514
// Source-Copyright: Copyright (c) 2026 oh-my-hermes contributors
// Port-Strategy: TRANSLATED
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python; the confidence ladder cut to the three values a done claim reads; a receipt is issued by the kernel and bound to a phase and a commit; a claim with nothing required is refused rather than ready; no file or ledger access.
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: requirements come from a kernel-declared plan, not a list in the claim; a receipt must match the plan's command and scope exactly and record who observed it; an observer equal to the implementer is refused.
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
 * WHAT THIS MODULE CANNOT PROVE. The observation and the plan are handed in by kernel code, so that the
 * check really ran, that `source` and `observedBy` are true, and that the plan is the committed one, are
 * the job of the call site, and there is no call site yet. A receipt is not persisted either: the phase
 * that wires this in has to decide how one is read back, and it owes the terms in the finish record.
 *
 * A RECEIPT IS FOR ONE PHASE AND ONE COMMIT. A check on an earlier commit says nothing about this one,
 * which is what freshness means here. An observed failure on the claimed commit outranks a pass on the
 * same commit, so green cannot be re-rolled.
 *
 * THE PLAN SAYS WHAT DONE MEANS. A claim has no field for its own requirements. The kernel declares them
 * from the plan, and a receipt counts only if its command and scope equal what the plan declared, exactly,
 * because a narrower run proves less and a claimant chooses what to run. The upstream gate reads ready
 * when no required criterion is missing, so an empty list is ready. Here that is a refusal.
 *
 * NOBODY OBSERVES THEIR OWN WORK. A receipt names who observed the check, and an observer equal to the
 * implementer does not count. A failure counts from anyone: it is evidence against, not for.
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
  /** The actor that saw it happen. */
  readonly observedBy: string;
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
  const { phaseId, checkId, subject, command, source, exitStatus, summary, scope, observedBy, observedAt } = observation;
  return [
    ...(nonBlank(phaseId) ? [] : ['the observation names no phase']),
    ...(nonBlank(checkId) ? [] : ['the observation names no check']),
    ...(typeof subject === 'string' && COMMIT.test(subject) ? [] : ['the subject is not a commit']),
    ...(nonBlank(command) ? [] : ['the observation has no command']),
    ...((CHECK_SOURCES as readonly unknown[]).includes(source) ? [] : ['the source is unknown']),
    ...(Number.isInteger(exitStatus) ? [] : ['the exit status is not an integer']),
    ...(nonBlank(summary) ? [] : ['the observation has no summary']),
    ...(nonBlank(scope) ? [] : ['the observation has no scope']),
    ...(nonBlank(observedBy) ? [] : ['the observation names no observer']),
    ...(instantOf(observedAt) === null ? ['the observation has no readable time'] : []),
  ];
}

/** Record what the kernel saw. The observation is read field by field, so nothing else gets in. */
export function recordCheckReceipt(observation: CheckObservation): ReceiptResult {
  const reasons = observationProblems(observation);
  if (reasons.length > 0) return { ok: false, reasons };
  const { phaseId, checkId, subject, command, source, exitStatus, summary, scope, observedBy, observedAt } = observation;
  const receipt: EvidenceReceipt = Object.freeze({
    phaseId,
    checkId,
    subject,
    command,
    source,
    exitStatus,
    summary,
    scope,
    observedBy,
    observedAt,
    confidence: confidenceOf(source, exitStatus),
  });
  LIVE_RECEIPTS.add(receipt);
  return { ok: true, receipt };
}

/** One check the plan requires, exactly as a receipt must show it. */
export interface PlanCheck {
  readonly checkId: string;
  readonly command: string;
  readonly scope: string;
}

export interface PlanChecks {
  readonly phaseId: string;
  readonly checks: readonly PlanCheck[];
}

export type PlanChecksResult = { readonly ok: true; readonly plan: PlanChecks } | { readonly ok: false; readonly reasons: readonly string[] };

/** Plans `declarePlanChecks` made. A list a claimant wrote is not a plan. */
const LIVE_PLANS = new WeakSet<PlanChecks>();

/** Declare what the plan requires of a phase. An empty list declares, and no claim gets past it. */
export function declarePlanChecks(plan: PlanChecks): PlanChecksResult {
  const { phaseId, checks } = plan;
  const reasons = [
    ...(nonBlank(phaseId) ? [] : ['the plan names no phase']),
    ...checks
      .filter(({ checkId, command, scope }) => !nonBlank(checkId) || !nonBlank(command) || !nonBlank(scope))
      .map(({ checkId }) => `the check '${checkId}' needs an id, a command and a scope`),
  ];
  if (reasons.length > 0) return { ok: false, reasons };
  const frozenChecks = Object.freeze(checks.map(({ checkId, command, scope }) => Object.freeze({ checkId, command, scope })));
  const declared: PlanChecks = Object.freeze({ phaseId, checks: frozenChecks });
  LIVE_PLANS.add(declared);
  return { ok: true, plan: declared };
}

export interface DoneClaim {
  readonly phaseId: string;
  /** The commit claimed done. */
  readonly subject: string;
  /** The actor that did the work, from the loop's own invocation record. It cannot observe itself. */
  readonly implementer: string;
  /** Anything still recorded as in the way. */
  readonly openBlockers: readonly string[];
}

export type DoneRule =
  | 'PLAN_NOT_DECLARED'
  | 'PLAN_OTHER_PHASE'
  | 'NO_REQUIRED_CHECKS'
  | 'NO_IMPLEMENTER'
  | 'OPEN_BLOCKER'
  | 'NO_RECEIPT'
  | 'RECEIPT_FORGED'
  | 'RECEIPT_OTHER_PHASE'
  | 'RECEIPT_STALE'
  | 'RECEIPT_WRONG_COMMAND'
  | 'RECEIPT_WRONG_SCOPE'
  | 'CHECK_FAILED'
  | 'OBSERVER_IS_IMPLEMENTER'
  | 'NOT_VERIFIED';

export interface DoneGap {
  readonly rule: DoneRule;
  readonly checkId: string | null;
  readonly reason: string;
}

export type DoneVerdict = { readonly ready: true } | { readonly ready: false; readonly gaps: readonly DoneGap[] };

/** Why this planned check is not met, or `null` if it is. Each step narrows what the next one may count. */
function checkGap(claim: DoneClaim, check: PlanCheck, receipts: readonly EvidenceReceipt[]): DoneGap | null {
  const { checkId, command, scope } = check;
  const gap = (rule: DoneRule, reason: string): DoneGap => ({ rule, checkId, reason });
  const named = receipts.filter((receipt) => receipt.checkId === checkId);
  if (named.length === 0) return gap('NO_RECEIPT', `there is no receipt for '${checkId}'`);
  const genuine = named.filter((receipt) => LIVE_RECEIPTS.has(receipt));
  if (genuine.length === 0) return gap('RECEIPT_FORGED', `no receipt for '${checkId}' was recorded by the kernel`);
  const inPhase = genuine.filter((receipt) => receipt.phaseId === claim.phaseId);
  if (inPhase.length === 0) return gap('RECEIPT_OTHER_PHASE', `every receipt for '${checkId}' belongs to another phase`);
  const current = inPhase.filter((receipt) => receipt.subject === claim.subject);
  if (current.length === 0) return gap('RECEIPT_STALE', `'${checkId}' was not run on ${claim.subject}`);
  const asCommanded = current.filter((receipt) => receipt.command === command);
  if (asCommanded.length === 0) return gap('RECEIPT_WRONG_COMMAND', `'${checkId}' was not run as the plan declares it`);
  const inScope = asCommanded.filter((receipt) => receipt.scope === scope);
  if (inScope.length === 0) return gap('RECEIPT_WRONG_SCOPE', `'${checkId}' did not cover what the plan declares`);
  if (inScope.some((receipt) => receipt.confidence === 'failed')) return gap('CHECK_FAILED', `'${checkId}' failed on ${claim.subject}`);
  const independent = inScope.filter((receipt) => receipt.observedBy !== claim.implementer);
  if (independent.length === 0) return gap('OBSERVER_IS_IMPLEMENTER', `only the implementer observed '${checkId}'`);
  if (!independent.some((receipt) => receipt.confidence === 'verified')) return gap('NOT_VERIFIED', `'${checkId}' is reported done, and nobody saw it pass`);
  return null;
}

/**
 * Is this claim backed? Every gap is reported, not the first, so one answer shows all that is missing.
 * The plan and the receipts are handed in by kernel code, and a claimant can add to neither.
 */
export function claimDone(claim: DoneClaim, plan: PlanChecks, receipts: readonly EvidenceReceipt[]): DoneVerdict {
  if (!LIVE_PLANS.has(plan)) return { ready: false, gaps: [{ rule: 'PLAN_NOT_DECLARED', checkId: null, reason: 'these requirements did not come from a declared plan' }] };
  const gaps: readonly DoneGap[] = [
    ...(plan.phaseId === claim.phaseId ? [] : [{ rule: 'PLAN_OTHER_PHASE' as const, checkId: null, reason: `this plan is for ${plan.phaseId}` }]),
    ...(plan.checks.length === 0 ? [{ rule: 'NO_REQUIRED_CHECKS' as const, checkId: null, reason: 'nothing is required, so nothing would be proved' }] : []),
    ...(nonBlank(claim.implementer) ? [] : [{ rule: 'NO_IMPLEMENTER' as const, checkId: null, reason: 'a claim must name who did the work' }]),
    ...claim.openBlockers.map((blocker) => ({ rule: 'OPEN_BLOCKER' as const, checkId: null, reason: blocker })),
    ...plan.checks.flatMap((check) => checkGap(claim, check, receipts) ?? []),
  ];
  return gaps.length === 0 ? { ready: true } : { ready: false, gaps };
}
