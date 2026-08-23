/**
 * What the gatekeeper costs, and the point at which ProjectOS stops spending.
 *
 * WHY A LEDGER AND NOT A COUNTER. An unattended reviewer is a process that can call a paid API in a
 * loop while nobody is watching. The plan's acceptance criteria ask for a per-request estimate and
 * per-phase, per-project and monthly totals, a warning threshold and a HARD STOP. A single running
 * total cannot answer "which phase spent this" after the fact, and a threshold that only warns is not
 * a stop.
 *
 * TWO DELIBERATE CHOICES.
 *
 *   MONEY IS INTEGER MICRO-USD, NEVER A FLOAT. Accumulating thousands of fractional-cent costs in
 *   binary floating point drifts, and a budget that drifts is a budget that can be crossed while
 *   reporting that it was not. One micro-USD is finer than any real rate card.
 *
 *   ENTRIES DEDUPLICATE BY REQUEST ID. The plan requires that restart mid-objective does not
 *   duplicate a decision, a run, a commit or A COST ENTRY. Deduplication lives here rather than at
 *   the call site because the call site is exactly what a restart re-runs.
 *
 * The rate card itself is CONFIGURATION, not knowledge: published prices change, and a hardcoded
 * price that silently goes stale under-reports spend. Nothing here guesses a rate.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 */

/** Published prices for one model, in integer micro-USD per million tokens. Supplied, never assumed. */
export interface RateCard {
  readonly model: string;
  readonly inputMicroUsdPerMillion: number;
  /** Cached input is materially cheaper on the Responses API; absent means "priced as fresh input". */
  readonly cachedInputMicroUsdPerMillion?: number;
  readonly outputMicroUsdPerMillion: number;
}

/** The token shape of one gatekeeper call. */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens: number;
}

/** One recorded call. `at` is supplied by the caller — this module holds no clock. */
export interface LedgerEntry {
  readonly requestId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly model: string;
  readonly usage: TokenUsage;
  readonly costMicroUsd: number;
  /** ISO-8601. Its leading `YYYY-MM` is what the monthly total groups on. */
  readonly at: string;
  /**
   * Set when a reservation was admitted but the call never produced an answer.
   *
   * An entry without this is a call that HAPPENED: asking again would double-charge, so admission
   * refuses it. An entry WITH it is a question that was started and never answered — the estimate
   * stays counted against the month, because a call that may have been dispatched must not have its
   * cost silently erased, but the question may be put again and the new reservation REPLACES this
   * one rather than adding to it. Absent the flag, one failed transport made a question permanently
   * unaskable (C11-W2-F6).
   */
  readonly unresolved?: boolean;
}

export interface BudgetPolicy {
  /** Owner-visible warning threshold for the month, in micro-USD. */
  readonly warnAtMicroUsd: number;
  /** The month's hard stop. Reaching it refuses further calls; it does not merely warn. */
  readonly hardStopAtMicroUsd: number;
}

export const BUDGET_OK = 'OK';
export const BUDGET_WARNING = 'WARNING';
export const BUDGET_STOPPED = 'STOPPED';
export type BudgetStatus = typeof BUDGET_OK | typeof BUDGET_WARNING | typeof BUDGET_STOPPED;

function nonNegative(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The cost of one call, in integer micro-USD.
 *
 * Rounds ONCE at the end rather than per token class, so the three components cannot each round up
 * and inflate a small call. Negative or non-finite token counts are treated as zero: a malformed
 * usage report must not be able to reduce a running total.
 */
export function estimateCostMicroUsd(usage: TokenUsage, rate: RateCard): number {
  const cachedRate =
    typeof rate.cachedInputMicroUsdPerMillion === 'number'
      ? rate.cachedInputMicroUsdPerMillion
      : rate.inputMicroUsdPerMillion;

  const total =
    nonNegative(usage.inputTokens) * nonNegative(rate.inputMicroUsdPerMillion) +
    nonNegative(usage.cachedInputTokens) * nonNegative(cachedRate) +
    nonNegative(usage.outputTokens) * nonNegative(rate.outputMicroUsdPerMillion);

  return Math.round(total / 1_000_000);
}

/** Build a ledger entry with its cost already computed from the supplied rate card. */
export function recordCall(input: {
  readonly requestId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly usage: TokenUsage;
  readonly rate: RateCard;
  readonly at: string;
}): LedgerEntry {
  return {
    requestId: input.requestId,
    projectId: input.projectId,
    phaseId: input.phaseId,
    model: input.rate.model,
    usage: input.usage,
    costMicroUsd: estimateCostMicroUsd(input.usage, input.rate),
    at: input.at,
  };
}

/**
 * Drop repeats of a request id, keeping the first.
 *
 * FIRST, NOT LAST, ON PURPOSE. A restart replays a call that already succeeded; the original entry is
 * the true one, and letting a replay overwrite it would let a retry quietly restate what something
 * cost.
 */
export function dedupeEntries(entries: readonly LedgerEntry[]): readonly LedgerEntry[] {
  const seen = new Set<string>();
  const out: LedgerEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.requestId)) continue;
    seen.add(entry.requestId);
    out.push(entry);
  }
  return out;
}

export interface LedgerTotals {
  readonly phaseMicroUsd: number;
  readonly projectMicroUsd: number;
  readonly monthMicroUsd: number;
  readonly callCount: number;
  readonly duplicatesIgnored: number;
}

/**
 * Totals for one phase, project and month.
 *
 * The month is matched on the entry's `YYYY-MM` prefix rather than by parsing a date, because parsing
 * would silently reinterpret a malformed timestamp into some real month and attribute spend to it.
 */
export function summariseLedger(
  entries: readonly LedgerEntry[],
  scope: { readonly projectId: string; readonly phaseId: string; readonly month: string },
): LedgerTotals {
  const unique = dedupeEntries(entries);
  let phase = 0;
  let project = 0;
  let month = 0;

  for (const entry of unique) {
    const cost = nonNegative(entry.costMicroUsd);
    const inProject = entry.projectId === scope.projectId;
    if (inProject) {
      project += cost;
      if (entry.phaseId === scope.phaseId) phase += cost;
    }
    // The monthly total is the SPEND LIMIT's total, and a spend limit is per account, not per project.
    if (typeof entry.at === 'string' && entry.at.startsWith(scope.month)) month += cost;
  }

  return {
    phaseMicroUsd: phase,
    projectMicroUsd: project,
    monthMicroUsd: month,
    callCount: unique.length,
    duplicatesIgnored: entries.length - unique.length,
  };
}

export interface BudgetVerdict {
  readonly status: BudgetStatus;
  readonly spentMicroUsd: number;
  readonly remainingMicroUsd: number;
  readonly reasons: readonly string[];
}

/**
 * Why this budget policy cannot be enforced, or `[]` when it can.
 *
 * A POLICY IS UNTRUSTED INPUT TOO. `evaluateBudget` compared spend against `policy.hardStopAtMicroUsd`
 * without ever asking whether that was a number — and both `spent >= undefined` and `spent >= NaN` are
 * `false`, so a missing or malformed limit authorised unlimited spending while reporting status OK.
 * The one input whose entire job is to stop spending must be the one input that is checked.
 */
export function policyProblems(policy: BudgetPolicy): readonly string[] {
  const e: string[] = [];
  const usable = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!usable(policy?.hardStopAtMicroUsd)) {
    e.push(`the budget policy has no usable hard stop (${JSON.stringify(policy?.hardStopAtMicroUsd)})`);
  }
  if (!usable(policy?.warnAtMicroUsd)) {
    e.push(`the budget policy has no usable warning threshold (${JSON.stringify(policy?.warnAtMicroUsd)})`);
  }
  return e;
}

/** Where the month stands against the policy, for the owner-visible status line. */
export function evaluateBudget(totals: LedgerTotals, policy: BudgetPolicy): BudgetVerdict {
  // AN UNENFORCEABLE POLICY STOPS SPENDING. Treating it as "no limit" would be the exact inversion of
  // what a limit is for.
  const broken = policyProblems(policy);
  if (broken.length > 0) {
    return {
      status: BUDGET_STOPPED,
      spentMicroUsd: nonNegative(totals?.monthMicroUsd),
      remainingMicroUsd: 0,
      reasons: [...broken, 'no gatekeeper call may be made against a budget that cannot be enforced'],
    };
  }
  const spent = totals.monthMicroUsd;
  const remaining = Math.max(0, policy.hardStopAtMicroUsd - spent);
  const reasons: string[] = [];

  if (spent >= policy.hardStopAtMicroUsd) {
    reasons.push(
      `monthly spend ${formatMicroUsd(spent)} has reached the hard stop of ` +
        `${formatMicroUsd(policy.hardStopAtMicroUsd)}; no further gatekeeper calls may be made`,
    );
    return { status: BUDGET_STOPPED, spentMicroUsd: spent, remainingMicroUsd: 0, reasons };
  }
  if (spent >= policy.warnAtMicroUsd) {
    reasons.push(
      `monthly spend ${formatMicroUsd(spent)} has passed the warning threshold of ` +
        `${formatMicroUsd(policy.warnAtMicroUsd)}; ${formatMicroUsd(remaining)} remains before the hard stop`,
    );
    return { status: BUDGET_WARNING, spentMicroUsd: spent, remainingMicroUsd: remaining, reasons };
  }
  return { status: BUDGET_OK, spentMicroUsd: spent, remainingMicroUsd: remaining, reasons };
}

export interface SpendAuthorisation {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
}

/**
 * May this specific call be made?
 *
 * CHECKED AGAINST THE ESTIMATE, NOT AGAINST SPEND SO FAR. A limit tested only after the money is gone
 * is a report, not a stop. This refuses the call that WOULD cross the line — which is also why the
 * caller must estimate before it calls, not after.
 */
export function authoriseRequestSpend(
  estimateMicroUsd: number,
  totals: LedgerTotals,
  policy: BudgetPolicy,
): SpendAuthorisation {
  const verdict = evaluateBudget(totals, policy);
  const reasons: string[] = [...verdict.reasons];

  if (verdict.status === BUDGET_STOPPED) {
    return { allowed: false, reasons };
  }
  const projected = verdict.spentMicroUsd + nonNegative(estimateMicroUsd);
  if (projected > policy.hardStopAtMicroUsd) {
    reasons.push(
      `this call is estimated at ${formatMicroUsd(estimateMicroUsd)}, which would take the month to ` +
        `${formatMicroUsd(projected)} and cross the hard stop of ${formatMicroUsd(policy.hardStopAtMicroUsd)}`,
    );
    return { allowed: false, reasons };
  }
  return { allowed: true, reasons };
}

/** Micro-USD as an owner-readable amount. */
export function formatMicroUsd(microUsd: number): string {
  const usd = nonNegative(microUsd) / 1_000_000;
  return usd < 0.01 && usd > 0 ? `$${usd.toFixed(6)}` : `$${usd.toFixed(2)}`;
}
