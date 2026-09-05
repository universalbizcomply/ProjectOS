/**
 * THE BUDGET RESERVATION IS A BOUND ON WHAT THE PROVIDER CAN BILL — tested, because it was not one.
 *
 * THE DEFECT, MEASURED RATHER THAN DESCRIBED. Both paid routes reserved
 * `estimateInputTokensFromText(evidenceText)`, and the comment above the call claimed that made it
 * "a real bound rather than a nominal one". On request `GKREQ-b045e264` the evidence pack was 21,018
 * bytes — 8,408 estimated input tokens — and the provider billed **184,232**. A 21.9x
 * under-reservation on the one gate whose entire job is to refuse the call that would cross the
 * budget.
 *
 * IT WAS NEVER A CALIBRATION ERROR. The missing tokens were not in the request. The transport sends
 * `previous_response_id` with `store: true`, so the provider replays the whole stored conversation
 * server-side and bills it again as fresh input. Across one thread's fifty real calls the input grew
 * from 1,599 to 187,452 tokens — ~3,793 per call, `cachedInputTokens: 0` throughout, so nothing was
 * discounted. It grows without limit, which is why no constant multiplier could have fixed it.
 *
 * The regression at the bottom of this file is that exact shape: a SMALL evidence text and a LARGE
 * effective context. It must not be admitted on the small number.
 */
import { describe, it, expect } from 'vitest';
import {
  InvalidEstimateInputError,
  authoriseRequestSpend,
  carriedContextTokens,
  estimateCostMicroUsd,
  estimateInputTokensFromText,
  reservationInputTokens,
  utf8ByteLength,
  type BudgetPolicy,
  type LedgerEntry,
  type LedgerTotals,
  type RateCard,
} from '@projectos/core';
import { lastBilledUsage } from '../src/loop/gatekeeperTurn.js';

/** The two real models, at their real observed ratio: terra bills ~13.8x luna per input token. */
const TERRA: RateCard = { model: 'gpt-5.6-terra', inputMicroUsdPerMillion: 1_250_000, outputMicroUsdPerMillion: 10_000_000 };
const LUNA: RateCard = { model: 'gpt-5.6-luna', inputMicroUsdPerMillion: 90_000, outputMicroUsdPerMillion: 720_000 };

const POLICY: BudgetPolicy = { warnAtMicroUsd: 2_000_000, hardStopAtMicroUsd: 5_000_000 };

function totals(spentMicroUsd: number): LedgerTotals {
  return { monthMicroUsd: spentMicroUsd, projectMicroUsd: spentMicroUsd, phaseMicroUsd: spentMicroUsd, callCount: 1, duplicatesIgnored: 0 };
}

function billed(inputTokens: number, outputTokens: number): LedgerEntry {
  return {
    requestId: 'GKREQ-fixture',
    projectId: 'projectos',
    phaseId: 'fixture',
    model: 'gpt-5.6-terra',
    usage: { inputTokens, cachedInputTokens: 0, outputTokens },
    costMicroUsd: 1,
    at: '2026-09-05T00:00:00.000Z',
  } as unknown as LedgerEntry;
}

describe('a reservation prices the whole request, not the evidence inside it', () => {
  it('a stateless request reserves exactly its own bytes and nothing more', () => {
    const bytes = 21_018;
    expect(reservationInputTokens({ requestBytes: bytes, carriedContextTokens: 0 })).toBe(
      estimateInputTokensFromText('x'.repeat(bytes)),
    );
  });

  it('carried context is ADDED, so a continued request cannot be priced as a fresh one', () => {
    const stateless = reservationInputTokens({ requestBytes: 30_000, carriedContextTokens: 0 });
    const continued = reservationInputTokens({ requestBytes: 30_000, carriedContextTokens: 184_232 });
    expect(continued).toBe(stateless + 184_232);
    expect(continued).toBeGreaterThan(stateless);
  });

  it('more bytes never reserve fewer tokens', () => {
    let previous = 0;
    for (const bytes of [0, 1, 1_000, 21_018, 500_000]) {
      const now = reservationInputTokens({ requestBytes: bytes, carriedContextTokens: 0 });
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
  });

  it.each([
    ['not a number', 'many'],
    ['not finite', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
    ['fractional', 1.5],
    ['negative', -1],
  ])('an unusable carried-context figure REFUSES rather than reserving zero (%s)', (_label, carried) => {
    expect(() =>
      reservationInputTokens({ requestBytes: 100, carriedContextTokens: carried as number }),
    ).toThrow(InvalidEstimateInputError);
  });
});

describe('what the provider will replay is bounded from what it billed, or not at all', () => {
  it('a stateless call carries nothing', () => {
    expect(carriedContextTokens({ continuesStoredConversation: false, lastBilledTurn: null })).toBe(0);
  });

  it('a continued call is bounded by the last turn the provider actually billed', () => {
    const bound = carriedContextTokens({
      continuesStoredConversation: true,
      lastBilledTurn: { inputTokens: 184_232, cachedInputTokens: 0, outputTokens: 432 },
    });
    expect(bound).toBe(184_664);
  });

  /**
   * THE FAIL-SAFE. A conversation ProjectOS has no billing record for is unpriceable — the replayed
   * history lives on the provider's side and nothing local reveals its size. Returning 0 here would
   * reproduce the original defect exactly.
   */
  it('a continued call with NO billing record cannot be bounded, and says so with null', () => {
    expect(carriedContextTokens({ continuesStoredConversation: true, lastBilledTurn: null })).toBeNull();
  });

  it.each([
    ['missing input', { inputTokens: undefined, outputTokens: 10 }],
    ['missing output', { inputTokens: 10, outputTokens: undefined }],
    ['negative', { inputTokens: -1, outputTokens: 10 }],
    ['not a number', { inputTokens: 'lots', outputTokens: 10 }],
  ])('an unusable billing record cannot be bounded either (%s)', (_label, usage) => {
    expect(
      carriedContextTokens({ continuesStoredConversation: true, lastBilledTurn: usage as never }),
    ).toBeNull();
  });

  it('reads the LAST billed turn, and skips entries that record no usage', () => {
    const ledger = [billed(100, 10), { requestId: 'GKREQ-unsettled' } as unknown as LedgerEntry];
    expect(lastBilledUsage(ledger)?.inputTokens).toBe(100);
    expect(lastBilledUsage([])).toBeNull();
  });
});

describe('the hard ceiling stops before dispatch, at the right rate', () => {
  it('admits a call that fits', () => {
    const estimate = estimateCostMicroUsd({ inputTokens: 10_000, outputTokens: 3_000 }, LUNA);
    expect(authoriseRequestSpend(estimate, totals(1_000_000), POLICY).allowed).toBe(true);
  });

  it('REFUSES the call that would cross the hard stop, before it is made', () => {
    const estimate = estimateCostMicroUsd({ inputTokens: 3_000_000, outputTokens: 3_000 }, TERRA);
    const verdict = authoriseRequestSpend(estimate, totals(2_000_000), POLICY);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('hard stop');
  });

  it('the expensive model is priced at the expensive rate — same tokens, different verdict', () => {
    const tokens = { inputTokens: 2_500_000, outputTokens: 3_000 };
    const onLuna = estimateCostMicroUsd(tokens, LUNA);
    const onTerra = estimateCostMicroUsd(tokens, TERRA);
    expect(onTerra).toBeGreaterThan(onLuna * 10);
    expect(authoriseRequestSpend(onLuna, totals(2_000_000), POLICY).allowed).toBe(true);
    expect(authoriseRequestSpend(onTerra, totals(2_000_000), POLICY).allowed).toBe(false);
  });

  /**
   * NO NEGATIVE HEADROOM. An actual bill larger than its reservation must reduce what the NEXT call
   * may spend — the ledger is authoritative after the fact, so once actual spend has reached the
   * ceiling nothing further is admitted, however cheap it claims to be.
   */
  it('once ACTUAL spend has reached the ceiling, even a free call is refused', () => {
    expect(authoriseRequestSpend(0, totals(5_000_000), POLICY).allowed).toBe(false);
    expect(authoriseRequestSpend(1, totals(5_000_001), POLICY).allowed).toBe(false);
  });

  it('an unknown cost is never spent', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 'free' as unknown as number]) {
      expect(authoriseRequestSpend(bad, totals(0), POLICY).allowed).toBe(false);
    }
  });
});

describe('REGRESSION — small evidence, large effective context', () => {
  /**
   * The exact shape of the defect, with the real numbers from `GKREQ-b045e264`.
   *
   * The old basis reserved from the evidence text alone. The new one prices the whole request and
   * adds what the provider will replay. The test asserts the OLD basis would have been admitted and
   * the NEW one is refused — because a regression that only checks the new number cannot tell you
   * the old one was wrong.
   */
  it('the evidence-only basis is admitted and the effective-context basis is REFUSED', () => {
    const evidenceBytes = 21_018;
    const actualCarried = 184_232 - 8_408;

    const oldBasisTokens = estimateInputTokensFromText('x'.repeat(evidenceBytes));
    const newBasisTokens = reservationInputTokens({
      requestBytes: evidenceBytes,
      carriedContextTokens: actualCarried,
    });
    expect(newBasisTokens / oldBasisTokens).toBeGreaterThan(20);

    // A month already close to the ceiling: the difference between the two bases is the difference
    // between spending and stopping. 4,800,000 is chosen because BOTH sides of the comparison have
    // to bite — the old basis must genuinely fit under the stop and the new one must genuinely cross
    // it, or the test proves nothing about either.
    const spent = 4_800_000;
    const oldEstimate = estimateCostMicroUsd({ inputTokens: oldBasisTokens, outputTokens: 3_000 }, TERRA);
    const newEstimate = estimateCostMicroUsd({ inputTokens: newBasisTokens, outputTokens: 3_000 }, TERRA);

    expect(authoriseRequestSpend(oldEstimate, totals(spent), POLICY).allowed).toBe(true);
    expect(authoriseRequestSpend(newEstimate, totals(spent), POLICY).allowed).toBe(false);
  });

  it('a large accumulated context cannot slip under the ceiling by having a small evidence pack', () => {
    // 187,452 input tokens was the real fiftieth call on one thread. Whatever the evidence says, a
    // request that replays that much is not a cheap request.
    const carried = carriedContextTokens({
      continuesStoredConversation: true,
      lastBilledTurn: { inputTokens: 187_452, cachedInputTokens: 0, outputTokens: 516 },
    });
    expect(carried).not.toBeNull();
    const tokens = reservationInputTokens({ requestBytes: 200, carriedContextTokens: carried as number });
    expect(tokens).toBeGreaterThan(187_000);
    const estimate = estimateCostMicroUsd({ inputTokens: tokens, outputTokens: 3_000 }, TERRA);
    expect(authoriseRequestSpend(estimate, totals(4_800_000), POLICY).allowed).toBe(false);
  });

  it('the wire bytes are what is counted — UTF-8, not UTF-16 code units', () => {
    const emDashes = '—'.repeat(1_000);
    expect(emDashes.length).toBe(1_000);
    expect(utf8ByteLength(emDashes)).toBe(3_000);
    expect(reservationInputTokens({ requestBytes: utf8ByteLength(emDashes), carriedContextTokens: 0 })).toBe(
      reservationInputTokens({ requestBytes: 3_000, carriedContextTokens: 0 }),
    );
  });
});
