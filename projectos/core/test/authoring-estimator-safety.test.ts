/**
 * THE ESTIMATE IS THE ONLY THING BETWEEN AN UNATTENDED LOOP AND THE BUDGET.
 *
 * `authoriseRequestSpend` refuses the call that WOULD cross the limit, which means it can only be as
 * good as the number it is given. An estimate that is too high wastes headroom; an estimate that is
 * too LOW lets through a call that should have been refused. So these tests are written from one
 * direction only: the reservation must never be lower than what the provider actually charged.
 *
 * THE CALIBRATION IS REAL, NOT INVENTED. ProjectOS has made exactly one paid authoring call:
 *
 *     request body   104,482 bytes
 *     billed input    34,761 tokens      -> 3.006 bytes per token
 *     billed output    1,138 tokens
 *     billed total    54,831 micro-USD
 *
 * Two independent faults both under-reserved it, and this file pins both:
 *
 *   1. FOUR BYTES PER TOKEN estimated 26,121 tokens — 8,640 short, 24.9% under.
 *   2. `String.length` is UTF-16 CODE UNITS, not bytes. Non-ASCII text — every em dash and middot
 *      in the owner's own words — counted one where the provider received two or three. ASCII hides
 *      this completely, which is why it survived.
 *
 * Nothing here contacts a provider. Every number is arithmetic over recorded evidence.
 *
 * Created in PROJECTOS-AUTHORING-ESTIMATOR-SAFETY1A.
 */
import { describe, test, expect } from 'vitest';
import {
  CALIBRATED_BYTES_PER_TOKEN,
  RESERVATION_SAFETY_MARGIN,
  estimateCostMicroUsd,
  estimateInputTokensFromBytes,
  estimateInputTokensFromText,
  utf8ByteLength,
  InvalidEstimateInputError,
  authoriseRequestSpend,
  type RateCard,
  type LedgerTotals,
  type BudgetPolicy,
} from '../src/gatekeeperCostLedger.js';

/** The historical paid call, from `.projectops/gatekeeper-ledger.json`. */
const HISTORICAL = { bytes: 104_482, inputTokens: 34_761, outputTokens: 1_138, costMicroUsd: 54_831 } as const;

/** The configured rate for the model that call used. */
const TERRA: RateCard = {
  model: 'gpt-5.6-terra',
  inputMicroUsdPerMillion: 1_250_000,
  cachedInputMicroUsdPerMillion: 125_000,
  outputMicroUsdPerMillion: 10_000_000,
};

/** What the authoring path reserves for output; unchanged by this correction. */
const AUTHORING_OUTPUT_TOKENS = 2_000;

/** The discredited estimator, kept ONLY so the regression it caused stays visible. */
const oldEstimate = (utf16Length: number): number => Math.ceil(utf16Length / 4);

describe('the recorded evidence is reproduced exactly', () => {
  test('the historical bill follows from its own usage and rate card', () => {
    expect(estimateCostMicroUsd(
      { inputTokens: HISTORICAL.inputTokens, outputTokens: HISTORICAL.outputTokens }, TERRA,
    )).toBe(HISTORICAL.costMicroUsd);
  });

  test('the measured ratio is 3.006 bytes per provider input token', () => {
    expect(HISTORICAL.bytes / HISTORICAL.inputTokens).toBeCloseTo(3.006, 3);
  });
});

describe('the old estimator under-reserved the only call there is evidence for', () => {
  test('four bytes per token estimated 26,121 tokens', () => {
    expect(oldEstimate(HISTORICAL.bytes)).toBe(26_121);
  });

  test('that is BELOW what was actually billed — the whole defect', () => {
    expect(oldEstimate(HISTORICAL.bytes)).toBeLessThan(HISTORICAL.inputTokens);
    expect(HISTORICAL.inputTokens - oldEstimate(HISTORICAL.bytes)).toBe(8_640);
  });
});

describe('the new estimator reserves MORE than was actually billed', () => {
  const reserved = estimateInputTokensFromBytes(HISTORICAL.bytes);

  test('it reserves 41,794 input tokens for the historical request', () => {
    expect(reserved).toBe(41_794);
  });

  test('strictly greater than the 34,761 actually billed — not equal, not lower', () => {
    expect(reserved).toBeGreaterThan(HISTORICAL.inputTokens);
  });

  test('the headroom is a deliberate ~20%, not an accident', () => {
    const headroom = (reserved - HISTORICAL.inputTokens) / HISTORICAL.inputTokens;
    expect(headroom).toBeGreaterThan(0.19);
    expect(headroom).toBeLessThan(0.22);
  });

  test('the margin covers a punctuation-dense body at ~2.5 bytes per token', () => {
    // The reason the uplift is 20% and not a round guess: this is the pessimistic end of the
    // byte-per-token range for JSON payloads, which is what an authoring body is.
    expect(reserved).toBeGreaterThanOrEqual(Math.ceil(HISTORICAL.bytes / 2.5));
  });

  test('and it is not wildly over-reserved either', () => {
    expect(reserved).toBeLessThan(HISTORICAL.inputTokens * 1.5);
  });
});

describe('UTF-8 bytes, never UTF-16 code units', () => {
  test('ASCII is the case that hid the fault — the two agree', () => {
    expect(utf8ByteLength('hello world')).toBe('hello world'.length);
  });

  test.each([
    ['em dash', '—', 3],
    ['middot', '·', 2],
    ['accented', 'é', 2],
    ['emoji', '🙂', 4],
  ])('%s is %s UTF-8 bytes, not its UTF-16 length', (_n, ch, bytes) => {
    expect(utf8ByteLength(ch)).toBe(bytes);
    expect(utf8ByteLength(ch)).toBeGreaterThan(ch.length);
  });

  test('a body of owner prose reserves MORE than its UTF-16 length would have', () => {
    // ProjectOS's own copy is full of em dashes and middots.
    const prose = 'Step 4 of 7 — Check the wording · Working — then send'.repeat(40);
    expect(utf8ByteLength(prose)).toBeGreaterThan(prose.length);
    expect(estimateInputTokensFromText(prose)).toBeGreaterThan(estimateInputTokensFromBytes(prose.length));
  });
});

describe('request shapes behave conservatively and deterministically', () => {
  const shapes: ReadonlyArray<readonly [string, string]> = [
    ['small ordinary request', 'Please continue the booking reminder work.'],
    ['long project context', 'PolyGo booking reminder. '.repeat(2_000)],
    ['JSON / punctuation heavy', JSON.stringify({ a: [1, 2, 3], b: { c: 'd' }, e: null }).repeat(500)],
    ['path heavy', 'C:\\dev\\ProjectOS\\projectos\\control-center\\src\\ux\\ControlCenter.tsx;'.repeat(300)],
    ['escaped content', '{"s":"line\\nbreak\\t\\"quoted\\""}'.repeat(400)],
    ['unicode multibyte', 'ProjectOS — 計画 · プロジェクト 🙂 '.repeat(500)],
  ];

  test.each(shapes)('%s: reserves at least one token per 3 UTF-8 bytes', (_name, text) => {
    const bytes = utf8ByteLength(text);
    expect(estimateInputTokensFromText(text)).toBeGreaterThanOrEqual(Math.ceil(bytes / CALIBRATED_BYTES_PER_TOKEN));
  });

  test.each(shapes)('%s: is deterministic', (_name, text) => {
    expect(estimateInputTokensFromText(text)).toBe(estimateInputTokensFromText(text));
  });

  test('monotonic — more bytes can never reserve fewer tokens', () => {
    let previous = -1;
    for (const bytes of [0, 1, 2, 3, 4, 99, 100, 1_000, 104_482, 1_000_000, 50_000_000]) {
      const now = estimateInputTokensFromBytes(bytes);
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
  });
});

describe('an impossible byte count FAILS CLOSED — it never becomes a cheap call', () => {
  /*
   * The first version of this correction clamped invalid input to zero tokens. That reads like
   * caution and is its opposite: zero tokens is a FREE call, a free call is under every budget, and
   * the dispatch that should have been refused proceeds. An impossible input is not a cheap request,
   * it is an unknown one — and an unknown cost must never be spent.
   */
  test.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['negative', -1_000],
    ['minus one', -1],
    ['fractional', 1_024.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 2],
  ])('%s raises rather than returning a number', (_n, value) => {
    expect(() => estimateInputTokensFromBytes(value)).toThrow(InvalidEstimateInputError);
  });

  test.each([
    ['NaN', Number.NaN],
    ['negative', -1],
    ['fractional', 0.5],
  ])('%s never yields 0 — that was the fail-open', (_n, value) => {
    let produced: number | null = null;
    try { produced = estimateInputTokensFromBytes(value); } catch { produced = null; }
    expect(produced).toBe(null);
  });

  test('the refusal says what an owner needs to know and carries no numbers to trust', () => {
    try {
      estimateInputTokensFromBytes(Number.NaN);
      throw new Error('should have raised');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidEstimateInputError);
      expect((error as Error).message).toMatch(/could not be established/i);
      expect((error as Error).message).toMatch(/no call was made/i);
    }
  });

  test('ZERO BYTES REMAINS VALID — it is a real answer, not a malformed one', () => {
    expect(estimateInputTokensFromBytes(0)).toBe(0);
    expect(estimateInputTokensFromText('')).toBe(0);
    expect(utf8ByteLength('')).toBe(0);
  });

  test('ordinary byte counts are untouched by the guard', () => {
    expect(estimateInputTokensFromBytes(1)).toBe(2);
    expect(estimateInputTokensFromBytes(HISTORICAL.bytes)).toBe(41_794);
  });
});

describe('THE GATE ITSELF refuses an estimate it cannot trust', () => {
  /*
   * The deeper fault, and the one that mattered most: `authoriseRequestSpend` ran the estimate
   * through a non-negative clamp, so NaN, Infinity and negatives all became 0 — under every budget,
   * always allowed. Every caller reaches the provider through this function, so the guarantee has to
   * hold HERE, whatever any individual estimator does or is later changed to do.
   */
  const POLICY: BudgetPolicy = { warnAtMicroUsd: 4_000_000, hardStopAtMicroUsd: 5_000_000 };
  const totals = (month: number): LedgerTotals => ({
    phaseMicroUsd: month, projectMicroUsd: month, monthMicroUsd: month,
    callCount: 1, duplicatesIgnored: 0,
  });

  test.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['negative', -1_000_000],
  ])('%s is REFUSED, where it used to be clamped to a free call', (_n, estimate) => {
    const decision = authoriseRequestSpend(estimate as number, totals(0), POLICY);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toMatch(/could not be established/i);
  });

  test('a non-number estimate is refused too', () => {
    expect(authoriseRequestSpend(undefined as unknown as number, totals(0), POLICY).allowed).toBe(false);
    expect(authoriseRequestSpend('12' as unknown as number, totals(0), POLICY).allowed).toBe(false);
  });

  test('a valid zero estimate is still allowed — zero is a real number, not a broken one', () => {
    expect(authoriseRequestSpend(0, totals(0), POLICY).allowed).toBe(true);
  });

  test('the clamp that caused this is gone: a huge estimate is no longer softened', () => {
    expect(authoriseRequestSpend(POLICY.hardStopAtMicroUsd + 1, totals(0), POLICY).allowed).toBe(false);
  });
});

describe('the margin is applied to TOKENS, before any currency rounding', () => {
  test('the constants are the documented ones', () => {
    expect(CALIBRATED_BYTES_PER_TOKEN).toBe(3);
    expect(RESERVATION_SAFETY_MARGIN).toBe(1.2);
  });

  test('reserving twice does not compound the margin', () => {
    // A second application would be 1.44x, not 1.2x — the classic double-margin bug.
    const once = estimateInputTokensFromBytes(HISTORICAL.bytes);
    expect(once).toBe(Math.ceil(Math.ceil(HISTORICAL.bytes / 3) * 1.2));
    expect(once).toBeLessThan(Math.ceil(Math.ceil(HISTORICAL.bytes / 3) * 1.44));
  });

  test('the reserved cost exceeds what the call actually cost', () => {
    const reservedCost = estimateCostMicroUsd(
      { inputTokens: estimateInputTokensFromBytes(HISTORICAL.bytes), outputTokens: AUTHORING_OUTPUT_TOKENS }, TERRA,
    );
    expect(reservedCost).toBe(72_243);
    expect(reservedCost).toBeGreaterThan(HISTORICAL.costMicroUsd);
  });

  test('the OLD reserved cost also exceeded it — which is why cost alone never caught the fault', () => {
    // The output over-estimate (2,000 vs 1,138 billed) masked a 24.9% input under-reservation.
    // Cost is not a safe proxy for token safety, and that is why these tests assert on TOKENS.
    const oldCost = estimateCostMicroUsd(
      { inputTokens: oldEstimate(HISTORICAL.bytes), outputTokens: AUTHORING_OUTPUT_TOKENS }, TERRA,
    );
    expect(oldCost).toBe(52_651);
    expect(oldEstimate(HISTORICAL.bytes)).toBeLessThan(HISTORICAL.inputTokens);
  });
});

describe('the corrected estimate reaches the real pre-dispatch gate', () => {
  const POLICY: BudgetPolicy = { warnAtMicroUsd: 4_000_000, hardStopAtMicroUsd: 5_000_000 };
  // The REAL shape: the monthly figure the gate reads is `monthMicroUsd`. A fixture with the wrong
  // field name left it undefined, every comparison went false, and the gate allowed everything —
  // which is precisely how a budget test can pass while proving nothing.
  const totals = (month: number): LedgerTotals => ({
    phaseMicroUsd: month, projectMicroUsd: month, monthMicroUsd: month,
    callCount: 1, duplicatesIgnored: 0,
  });
  const reservedCost = estimateCostMicroUsd(
    { inputTokens: estimateInputTokensFromBytes(HISTORICAL.bytes), outputTokens: AUTHORING_OUTPUT_TOKENS }, TERRA,
  );

  test('A. safely inside budget — the reservation is accepted', () => {
    expect(authoriseRequestSpend(reservedCost, totals(100_000), POLICY).allowed).toBe(true);
  });

  test('B. the larger estimate crosses the hard stop and is REFUSED before dispatch', () => {
    // Spend that the OLD, smaller estimate would have squeezed under.
    const spent = POLICY.hardStopAtMicroUsd - 60_000;
    const oldCost = estimateCostMicroUsd(
      { inputTokens: oldEstimate(HISTORICAL.bytes), outputTokens: AUTHORING_OUTPUT_TOKENS }, TERRA,
    );
    expect(authoriseRequestSpend(oldCost, totals(spent), POLICY).allowed).toBe(true);
    const decision = authoriseRequestSpend(reservedCost, totals(spent), POLICY);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toMatch(/hard stop/i);
  });

  test('C. an already-stopped month refuses regardless of the estimate', () => {
    expect(authoriseRequestSpend(reservedCost, totals(POLICY.hardStopAtMicroUsd + 1), POLICY).allowed).toBe(false);
  });

  test('D. the output reservation is still included', () => {
    const withoutOutput = estimateCostMicroUsd(
      { inputTokens: estimateInputTokensFromBytes(HISTORICAL.bytes), outputTokens: 0 }, TERRA,
    );
    expect(reservedCost - withoutOutput).toBe(AUTHORING_OUTPUT_TOKENS * TERRA.outputMicroUsdPerMillion / 1_000_000);
  });

  test('E. rate arithmetic is unchanged — only the input estimate moved', () => {
    expect(estimateCostMicroUsd({ inputTokens: 1_000_000, outputTokens: 0 }, TERRA)).toBe(1_250_000);
    expect(estimateCostMicroUsd({ inputTokens: 0, outputTokens: 1_000_000 }, TERRA)).toBe(10_000_000);
  });
});
