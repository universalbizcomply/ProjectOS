/**
 * What the gatekeeper costs, and the line it cannot cross.
 *
 * The rates below are the MEASURED ProjectOS artefact sizes and a plausible two-tier rate card, used
 * as fixtures. Nothing in the module knows a real price — a hardcoded price silently goes stale and
 * then under-reports spend, so the card is always supplied.
 */
import { describe, it, expect } from 'vitest';
import {
  estimateCostMicroUsd,
  recordCall,
  dedupeEntries,
  summariseLedger,
  evaluateBudget,
  authoriseRequestSpend,
  formatMicroUsd,
  capProblems,
  ledgerPeriod,
  policyProblems,
  rateCardProblems,
  BUDGET_OK,
  BUDGET_WARNING,
  BUDGET_STOPPED,
  type RateCard,
  type LedgerEntry,
  type BudgetPolicy,
} from '../src/gatekeeperCostLedger.js';

/** $1.25 / M input, $0.125 / M cached, $10 / M output. */
const STRONG: RateCard = {
  model: 'gpt-5.6-terra',
  inputMicroUsdPerMillion: 1_250_000,
  cachedInputMicroUsdPerMillion: 125_000,
  outputMicroUsdPerMillion: 10_000_000,
};

/** A card with no cached rate at all — cached tokens must then be priced as fresh input. */
const NO_CACHE_RATE: RateCard = {
  model: 'gpt-5.6-luna',
  inputMicroUsdPerMillion: 1_000_000,
  outputMicroUsdPerMillion: 4_000_000,
};

const POLICY: BudgetPolicy = { warnAtMicroUsd: 5_000_000, hardStopAtMicroUsd: 10_000_000, phaseHardStopAtMicroUsd: 10_000_000, dayHardStopAtMicroUsd: 10_000_000 };

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    requestId: 'GKREQ-0001',
    projectId: 'projectos',
    phaseId: 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A',
    model: STRONG.model,
    usage: { inputTokens: 1000, outputTokens: 100 },
    costMicroUsd: 1_000_000,
    at: '2026-08-17T16:00:00+01:00',
    ...over,
  };
}

const SCOPE = {
  projectId: 'projectos',
  phaseId: 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A',
  month: '2026-08',
};

describe('estimating one call', () => {
  it('prices input, cached input and output at their own rates', () => {
    // 10,000 fresh @1.25/M = 12,500µ¢ ... 7,088 cached @0.125/M = 886 ... 500 out @10/M = 5,000
    const cost = estimateCostMicroUsd({ inputTokens: 10_000, cachedInputTokens: 7_088, outputTokens: 500 }, STRONG);
    expect(cost).toBe(Math.round((10_000 * 1_250_000 + 7_088 * 125_000 + 500 * 10_000_000) / 1_000_000));
  });

  it('prices cached tokens as fresh input when the card has no cached rate', () => {
    const cached = estimateCostMicroUsd({ inputTokens: 0, cachedInputTokens: 1_000, outputTokens: 0 }, NO_CACHE_RATE);
    const fresh = estimateCostMicroUsd({ inputTokens: 1_000, outputTokens: 0 }, NO_CACHE_RATE);
    expect(cached).toBe(fresh);
  });

  it('treats a malformed usage report as zero rather than letting it reduce a total', () => {
    const cost = estimateCostMicroUsd(
      { inputTokens: -5_000, cachedInputTokens: Number.NaN, outputTokens: 100 } as never,
      STRONG,
    );
    expect(cost).toBe(Math.round((100 * 10_000_000) / 1_000_000));
    expect(cost).toBeGreaterThan(0);
  });

  it('records the model that was actually billed', () => {
    const recorded = recordCall({
      requestId: 'GKREQ-0002',
      projectId: 'projectos',
      phaseId: SCOPE.phaseId,
      usage: { inputTokens: 17_088, outputTokens: 800 },
      rate: STRONG,
      at: '2026-08-17T16:05:00+01:00',
    });
    expect(recorded.model).toBe('gpt-5.6-terra');
    expect(recorded.costMicroUsd).toBe(estimateCostMicroUsd({ inputTokens: 17_088, outputTokens: 800 }, STRONG));
  });
});

describe('restart safety', () => {
  it('counts a replayed request once', () => {
    const entries = [entry(), entry({ costMicroUsd: 9_999_999 })];
    expect(dedupeEntries(entries)).toHaveLength(1);
  });

  it('keeps the first entry, so a replay cannot restate what something cost', () => {
    const kept = dedupeEntries([entry({ costMicroUsd: 1_000_000 }), entry({ costMicroUsd: 5_000_000 })]);
    expect(kept[0]?.costMicroUsd).toBe(1_000_000);
  });

  it('reports how many duplicates it ignored rather than hiding them', () => {
    const totals = summariseLedger([entry(), entry(), entry({ requestId: 'GKREQ-0002' })], SCOPE);
    expect(totals.duplicatesIgnored).toBe(1);
    expect(totals.callCount).toBe(2);
  });
});

describe('totals', () => {
  it('separates phase, project and month', () => {
    const totals = summariseLedger(
      [
        entry({ requestId: 'a', costMicroUsd: 1_000_000 }),
        entry({ requestId: 'b', phaseId: 'OTHER-PHASE1A', costMicroUsd: 2_000_000 }),
        entry({ requestId: 'c', projectId: 'polygo', phaseId: 'X', costMicroUsd: 4_000_000 }),
      ],
      SCOPE,
    );
    expect(totals.phaseMicroUsd).toBe(1_000_000);
    expect(totals.projectMicroUsd).toBe(3_000_000);
    // Monthly is the SPEND LIMIT's total and a spend limit is per account, so it spans projects.
    expect(totals.monthMicroUsd).toBe(7_000_000);
  });

  it('excludes another month', () => {
    const totals = summariseLedger([entry({ at: '2026-07-31T23:59:00+01:00', costMicroUsd: 8_000_000 })], SCOPE);
    expect(totals.monthMicroUsd).toBe(0);
  });

  it('does not attribute a malformed timestamp to some real month', () => {
    // Nor does it silently drop it (PROJECTOS-KERNEL-COST-CAP1A, ECC SECURITY R2): a spend that belongs to
    // no month would escape every cap, so the totals become unreadable and the gate refuses.
    const totals = summariseLedger([entry({ at: 'yesterday', costMicroUsd: 8_000_000 })], SCOPE);
    expect(totals.monthMicroUsd).not.toBe(8_000_000);
    expect(Number.isNaN(totals.monthMicroUsd)).toBe(true);
  });
});

describe('the budget', () => {
  it('is OK below the warning threshold', () => {
    const verdict = evaluateBudget(summariseLedger([entry({ costMicroUsd: 1_000_000 })], SCOPE), POLICY);
    expect(verdict.status).toBe(BUDGET_OK);
    expect(verdict.remainingMicroUsd).toBe(9_000_000);
  });

  it('warns at the threshold without stopping', () => {
    const verdict = evaluateBudget(summariseLedger([entry({ costMicroUsd: 5_000_000 })], SCOPE), POLICY);
    expect(verdict.status).toBe(BUDGET_WARNING);
    expect(verdict.reasons.some((r) => r.includes('warning threshold'))).toBe(true);
  });

  it('stops at the hard limit', () => {
    const verdict = evaluateBudget(summariseLedger([entry({ costMicroUsd: 10_000_000 })], SCOPE), POLICY);
    expect(verdict.status).toBe(BUDGET_STOPPED);
    expect(verdict.remainingMicroUsd).toBe(0);
  });
});

describe('a budget that cannot be enforced', () => {
  // `spent >= undefined` and `spent >= NaN` are both false, so a malformed limit used to authorise
  // unlimited spending while reporting status OK. The one input whose job is to stop spending has to
  // be the one input that is checked.
  it.each([undefined, null, Number.NaN, 'five', -1])('stops when the hard limit is %s', (value) => {
    const totals = summariseLedger([entry({ costMicroUsd: 1_000_000 })], SCOPE);
    const verdict = evaluateBudget(totals, { warnAtMicroUsd: 2_000_000, hardStopAtMicroUsd: value } as never);
    expect(verdict.status).toBe(BUDGET_STOPPED);
    expect(verdict.reasons.some((r) => r.includes('no usable hard stop'))).toBe(true);
  });

  it('stops when the warning threshold is unusable', () => {
    const totals = summariseLedger([], SCOPE);
    const verdict = evaluateBudget(totals, { warnAtMicroUsd: Number.NaN, hardStopAtMicroUsd: 5_000_000 } as never);
    expect(verdict.status).toBe(BUDGET_STOPPED);
  });

  it('refuses the call rather than letting a broken policy authorise it', () => {
    const totals = summariseLedger([], SCOPE);
    const decision = authoriseRequestSpend(1, totals, {} as never);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes('cannot be enforced'))).toBe(true);
  });

  it('reports no remaining budget rather than a negative or nonsense figure', () => {
    const verdict = evaluateBudget(summariseLedger([], SCOPE), {} as never);
    expect(verdict.remainingMicroUsd).toBe(0);
  });
});

describe('authorising the next call', () => {
  it('refuses the call that WOULD cross the stop, not merely the one after it', () => {
    const totals = summariseLedger([entry({ costMicroUsd: 9_500_000 })], SCOPE);
    const decision = authoriseRequestSpend(1_000_000, totals, POLICY);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => r.includes('cross the hard stop'))).toBe(true);
  });

  it('allows a call that fits inside the remaining budget', () => {
    const totals = summariseLedger([entry({ costMicroUsd: 9_500_000 })], SCOPE);
    expect(authoriseRequestSpend(400_000, totals, POLICY).allowed).toBe(true);
  });

  it('carries the warning through while still allowing the call', () => {
    const totals = summariseLedger([entry({ costMicroUsd: 6_000_000 })], SCOPE);
    const decision = authoriseRequestSpend(100_000, totals, POLICY);
    expect(decision.allowed).toBe(true);
    expect(decision.reasons.some((r) => r.includes('warning threshold'))).toBe(true);
  });

  it('refuses everything once stopped, whatever the estimate claims', () => {
    const totals = summariseLedger([entry({ costMicroUsd: 10_000_000 })], SCOPE);
    expect(authoriseRequestSpend(0, totals, POLICY).allowed).toBe(false);
    expect(authoriseRequestSpend(-1_000_000, totals, POLICY).allowed).toBe(false);
  });
});

describe('owner-visible amounts', () => {
  it('shows ordinary sums in cents', () => {
    expect(formatMicroUsd(6_210_000)).toBe('$6.21');
  });

  it('does not round a real per-call cost away to $0.00', () => {
    expect(formatMicroUsd(6_200)).toBe('$0.006200');
  });

  it('shows nothing spent as nothing', () => {
    expect(formatMicroUsd(0)).toBe('$0.00');
  });
});

/** PROJECTOS-KERNEL-COST-CAP1A — the day total, and totals the gate cannot read. */
describe('KERNEL-COST-CAP1A: day totals and unreadable totals', () => {
  const CAPPED: BudgetPolicy = { warnAtMicroUsd: 40_000_000, hardStopAtMicroUsd: 50_000_000, phaseHardStopAtMicroUsd: 2_000_000, dayHardStopAtMicroUsd: 3_000_000 };

  it("counts only the named day's spend, across every phase and project", () => {
    const entries = [
      entry({ requestId: 'a', at: '2026-08-17T01:00:00Z', costMicroUsd: 1_000_000 }),
      entry({ requestId: 'b', at: '2026-08-17T23:00:00Z', phaseId: 'OTHER1A', projectId: 'polygo', costMicroUsd: 500_000 }),
      entry({ requestId: 'c', at: '2026-08-16T23:59:59Z', costMicroUsd: 7_000_000 }),
    ];
    expect(summariseLedger(entries, { ...SCOPE, day: '2026-08-17' }).dayMicroUsd).toBe(1_500_000);
  });

  it('counts the whole month as the day when no day is named, so it can only refuse more', () => {
    const entries = [entry({ requestId: 'a', at: '2026-08-01T00:00:00Z' }), entry({ requestId: 'b', at: '2026-08-20T00:00:00Z' })];
    const t = summariseLedger(entries, SCOPE);
    expect(t.dayMicroUsd).toBe(t.monthMicroUsd);
  });

  it('refuses a total it cannot read rather than reading it as nothing spent', () => {
    const totals = { phaseMicroUsd: 0, projectMicroUsd: 0, monthMicroUsd: 0, callCount: 0, duplicatesIgnored: 0 } as never;
    const decision = authoriseRequestSpend(1, totals, CAPPED);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toContain('what the day has spent could not be established');
  });

  it('names every cap a call would cross, not only the first', () => {
    const totals = { phaseMicroUsd: 2_000_000, projectMicroUsd: 2_000_000, monthMicroUsd: 3_000_000, dayMicroUsd: 3_000_000, callCount: 2, duplicatesIgnored: 0 };
    const said = authoriseRequestSpend(1, totals, CAPPED).reasons.join(' ');
    expect(said).toContain('the per-phase cap of $2.00');
    expect(said).toContain('the per-day cap of $3.00');
  });
});

/** PROJECTOS-KERNEL-COST-CAP1A, ECC SECURITY H1/H2/M1/M3 — prices, unreadable costs, UTC, display. */
describe('KERNEL-COST-CAP1A: what the caps are judged against', () => {
  const CAPPED: BudgetPolicy = { warnAtMicroUsd: 40_000_000, hardStopAtMicroUsd: 50_000_000, phaseHardStopAtMicroUsd: 2_000_000, dayHardStopAtMicroUsd: 3_000_000 };

  it('prices a call with an unusable rate card as NaN, never as free (H1)', () => {
    for (const bad of [{ ...STRONG, inputMicroUsdPerMillion: 0 }, { ...STRONG, outputMicroUsdPerMillion: -1 }, { ...STRONG, inputMicroUsdPerMillion: '5' as never }]) {
      expect(rateCardProblems(bad).length).toBeGreaterThan(0);
      expect(Number.isNaN(estimateCostMicroUsd({ inputTokens: 1000, outputTokens: 10 }, bad))).toBe(true);
    }
    expect(rateCardProblems(STRONG)).toEqual([]);
  });

  it('makes every total unreadable when one entry cost is unreadable, and the gate refuses (H2)', () => {
    const t = summariseLedger([entry({ requestId: 'a' }), entry({ requestId: 'b', costMicroUsd: '1' as never })], { ...SCOPE, day: '2026-08-17' });
    expect(Number.isNaN(t.monthMicroUsd)).toBe(true);
    expect(evaluateBudget(t, CAPPED).status).toBe('STOPPED');
    expect(authoriseRequestSpend(1, t, CAPPED).allowed).toBe(false);
  });

  it('groups days and months by the UTC instant, not the written prefix (M1)', () => {
    const entries = [entry({ requestId: 'a', at: '2026-08-01T00:30:00+01:00', costMicroUsd: 5 })];
    expect(summariseLedger(entries, { ...SCOPE, month: '2026-07', day: '2026-07-31' }).dayMicroUsd).toBe(5);
    expect(summariseLedger(entries, { ...SCOPE, month: '2026-08', day: '2026-08-01' }).dayMicroUsd).toBe(0);
    expect(ledgerPeriod('2026-08-01T00:30:00+01:00')).toEqual({ month: '2026-07', day: '2026-07-31' });
    expect(ledgerPeriod('garbage')).toBeNull();
  });

  it('keeps a month-only display policy usable, while spend still refuses without the caps (M3)', () => {
    const display: BudgetPolicy = { warnAtMicroUsd: 2_000_000, hardStopAtMicroUsd: 5_000_000 };
    expect(policyProblems(display)).toEqual([]);
    expect(capProblems(display).length).toBe(2);
    const zero = summariseLedger([], { ...SCOPE, day: '2026-08-17' });
    expect(authoriseRequestSpend(1, zero, display).allowed).toBe(false);
  });
});
