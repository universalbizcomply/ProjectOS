import { describe, expect, it } from 'vitest';
import { estimateCostMicroUsd, rateCardProblems } from '../src/index.js';
import { parseCommittedPricing, rateCardFor, type PricingTable } from '../src/modelBroker/index.js';

const COMMIT = 'a'.repeat(40);
const model = (extra: Record<string, unknown> = {}) => ({
  provider: 'anthropic',
  model: 'sonnet-test',
  input: 3,
  output: 15,
  cache_read: 0.3,
  cache_write: 3.75,
  source: 'vendor price page',
  pricedAt: '2026-11-01',
  ...extra,
});
const text = (...models: unknown[]) => JSON.stringify({ schema: 1, models });
const table = (...models: unknown[]): PricingTable => {
  const parsed = parseCommittedPricing({ text: text(...models), commit: COMMIT });
  if (!parsed.ok) throw new Error(parsed.problems.join('; '));
  return parsed.table;
};

describe('pricing is read from committed bytes and feeds the existing RateCard', () => {
  it('a committed price becomes a RateCard the ledger accepts: the positive control', () => {
    const found = rateCardFor(table(model()), 'anthropic', 'sonnet-test', 1000);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.rate).toEqual({ model: 'anthropic/sonnet-test', inputMicroUsdPerMillion: 3_750_000, cachedInputMicroUsdPerMillion: 300_000, outputMicroUsdPerMillion: 15_000_000 });
    expect(rateCardProblems(found.rate)).toEqual([]);
    expect(estimateCostMicroUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, found.rate)).toBe(18_750_000);
  });

  it('text that does not carry a 40-character commit is not committed bytes', () => {
    for (const commit of ['', 'HEAD', 'a'.repeat(39), 'A'.repeat(40), `${'a'.repeat(40)}\n`]) {
      expect(parseCommittedPricing({ text: text(model()), commit }).ok).toBe(false);
    }
  });

  it('an unpriced model is refused, not priced at zero', () => {
    const t = table(model());
    for (const [provider, name] of [['anthropic', 'other'], ['elsewhere', 'sonnet-test'], ['Anthropic', 'sonnet-test']] as const) {
      const found = rateCardFor(t, provider, name, 10);
      expect(found).toMatchObject({ ok: false, reason: 'unpriced' });
    }
  });

  it('a price of zero, a missing price and a price with more than six decimals are all refused whole', () => {
    const bad: Record<string, unknown>[] = [{ input: 0 }, { output: 0 }, { input: undefined }, { output: '15' }, { input: -1 }, { input: 3.0000001 }, { input: Number.NaN }];
    for (const change of bad) expect(parseCommittedPricing({ text: text(model(change)), commit: COMMIT }).ok).toBe(false);
  });

  it('cache-write dearer than input is carried as the input rate, so a call is never under-estimated', () => {
    const found = rateCardFor(table(model({ input: 1, cache_write: 5 })), 'anthropic', 'sonnet-test', 1);
    expect(found.ok && found.rate.inputMicroUsdPerMillion).toBe(5_000_000);
  });

  it('a free cache rate is not a free cache: it is priced as fresh input', () => {
    const found = rateCardFor(table(model({ cache_read: 0 })), 'anthropic', 'sonnet-test', 1);
    expect(found.ok && 'cachedInputMicroUsdPerMillion' in found.rate).toBe(false);
  });

  it('refuses a duplicate model, an unknown schema, unknown fields and a non-array', () => {
    expect(parseCommittedPricing({ text: text(model(), model()), commit: COMMIT }).ok).toBe(false);
    expect(parseCommittedPricing({ text: JSON.stringify({ schema: 2, models: [model()] }), commit: COMMIT }).ok).toBe(false);
    expect(parseCommittedPricing({ text: text(model({ apiKey: 'x' })), commit: COMMIT }).ok).toBe(false);
    expect(parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: {} }), commit: COMMIT }).ok).toBe(false);
    expect(parseCommittedPricing({ text: '{not json', commit: COMMIT }).ok).toBe(false);
  });

  it('a larger prompt selects the dearer whole-request tier, and the nearest lower tier covers a gap', () => {
    const tiered = model({ context_over_200k: { input: 6, output: 22.5, cache_read: 0.6, cache_write: 7.5 } });
    const t = table(tiered);
    const small = rateCardFor(t, 'anthropic', 'sonnet-test', 1000);
    const large = rateCardFor(t, 'anthropic', 'sonnet-test', 250_000);
    expect(small.ok && small.rate.outputMicroUsdPerMillion).toBe(15_000_000);
    expect(large.ok && large.rate.outputMicroUsdPerMillion).toBe(22_500_000);
  });

  it('two tiers at one threshold cannot select one price, so the whole price is refused', () => {
    const clash = model({ tiers: [{ tier: { type: 'context', size: 100 }, input: 4, output: 16 }, { tier: { type: 'context', size: 100 }, input: 5, output: 17 }] });
    expect(parseCommittedPricing({ text: text(clash), commit: COMMIT }).ok).toBe(false);
  });

  it('the table remembers the commit it was read from', () => {
    expect(table(model()).commit).toBe(COMMIT);
  });
});
