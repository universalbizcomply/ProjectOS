// Origin: original ProjectOS code
/**
 * Prices, read from committed bytes only, and turned into the RateCard the cost ledger already prices with.
 *
 * NOTHING HERE FETCHES A PRICE. A table is built from text that arrives with the 40-character commit it was read
 * at, so a working-tree copy or a live catalogue has no way in: the caller cannot supply a commit it did not read.
 * An UNPRICED MODEL IS A REFUSAL, never a zero: a model absent from the table cannot be called, and a price that is
 * zero, missing or has more than six decimals voids the whole table rather than pricing one model at nothing.
 */

import { rateCardProblems, type RateCard } from '../gatekeeperCostLedger.js';
import { normalizeUpstreamModelPricing, selectPricingRates, type ModelPricing } from './pricingTiers.js';
import { routeKeyOf } from './routeTypes.js';

export interface CommittedText {
  readonly text: string;
  /** The commit the text was read at. */
  readonly commit: string;
}

export interface PricingEntry {
  readonly provider: string;
  readonly model: string;
  readonly pricing: ModelPricing;
  readonly source: string;
  readonly pricedAt: string;
}

export interface PricingTable {
  readonly commit: string;
  readonly entries: ReadonlyMap<string, PricingEntry>;
}

export type PricingParse = { readonly ok: true; readonly table: PricingTable } | { readonly ok: false; readonly problems: readonly string[] };

export const COMMIT_SHA = /^[0-9a-f]{40}$/;
const NAME = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const PRICING_SCHEMA = 1;
const ENTRY_KEYS = new Set(['provider', 'model', 'input', 'output', 'cache_read', 'cache_write', 'tiers', 'context_over_200k', 'source', 'pricedAt']);
const PRICED_ON = /^\d{4}-\d{2}-\d{2}$/;
const MICRO = 1_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** USD per million to integer micro-USD per million, or null when the price has more than six decimals. */
function microOf(usdPerMillion: number): number | null {
  const scaled = usdPerMillion * MICRO;
  const whole = Math.round(scaled);
  return Math.abs(scaled - whole) > 1e-3 || !Number.isSafeInteger(whole) ? null : whole;
}

function entryProblems(row: unknown, at: string): { entry: PricingEntry | null; problems: string[] } {
  if (!isRecord(row)) return { entry: null, problems: [`${at} is not a record`] };
  const problems = Object.keys(row).filter((key) => !ENTRY_KEYS.has(key)).map((key) => `${at} carries an unknown field ${JSON.stringify(key)}`);
  const { provider, model, source, pricedAt } = row;
  if (typeof provider !== 'string' || !NAME.test(provider)) problems.push(`${at} has no usable provider name`);
  if (typeof model !== 'string' || !MODEL_NAME.test(model)) problems.push(`${at} has no usable model name`);
  if (typeof source !== 'string' || source.trim() === '') problems.push(`${at} does not say where the price came from`);
  if (typeof pricedAt !== 'string' || !PRICED_ON.test(pricedAt)) problems.push(`${at} does not say when it was priced`);
  const pricing = normalizeUpstreamModelPricing(row);
  if (pricing === undefined) problems.push(`${at} has a price that cannot be read`);
  if (problems.length > 0 || pricing === undefined) return { entry: null, problems };
  const entry: PricingEntry = { provider: provider as string, model: model as string, pricing, source: source as string, pricedAt: pricedAt as string };
  const tierRates = pricing.tieredPricing ?? [];
  for (const rates of [pricing, ...tierRates]) {
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
      if (microOf(rates[field]) === null) problems.push(`${at} has a ${field} price with more than six decimals`);
    }
    if (!(rates.input > 0) || !(rates.output > 0)) problems.push(`${at} has an input or output price that is not above zero`);
  }
  return { entry: problems.length === 0 ? entry : null, problems };
}

export function parseCommittedPricing(committed: CommittedText): PricingParse {
  if (typeof committed?.commit !== 'string' || !COMMIT_SHA.test(committed.commit)) {
    return { ok: false, problems: ['the price text did not come with a commit, so it is not committed bytes'] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(committed.text);
  } catch {
    return { ok: false, problems: ['the price text is not JSON'] };
  }
  if (!isRecord(parsed) || parsed['schema'] !== PRICING_SCHEMA || !Array.isArray(parsed['models'])) {
    return { ok: false, problems: [`the price text is not schema ${PRICING_SCHEMA} with a models list`] };
  }
  const entries = new Map<string, PricingEntry>();
  const problems: string[] = [];
  parsed['models'].forEach((row: unknown, index: number) => {
    const made = entryProblems(row, `models[${index}]`);
    problems.push(...made.problems);
    if (made.entry === null) return;
    const key = routeKeyOf(made.entry);
    if (entries.has(key)) problems.push(`models[${index}] prices ${key} a second time`);
    entries.set(key, made.entry);
  });
  if (problems.length > 0) return { ok: false, problems };
  if (entries.size === 0) return { ok: false, problems: ['the price table holds no model'] };
  return { ok: true, table: Object.freeze({ commit: committed.commit, entries }) };
}

export type RateCardResult =
  | { readonly ok: true; readonly rate: RateCard }
  | { readonly ok: false; readonly reason: 'unpriced' | 'unusable-price'; readonly detail: string };

/**
 * The RateCard for one call. RateCard has no cache-write rate, so the card carries the larger of the input and
 * cache-write prices as its input price: a call is never under-estimated. A free cache rate is left off the card,
 * which the ledger prices as fresh input.
 */
export function rateCardFor(table: PricingTable, provider: string, model: string, promptTokens: number): RateCardResult {
  const key = routeKeyOf({ provider, model });
  const entry = table.entries.get(key);
  if (entry === undefined) return { ok: false, reason: 'unpriced', detail: `${key} is not in the committed price table` };
  const rates = selectPricingRates(entry.pricing, promptTokens);
  const input = microOf(Math.max(rates.input, rates.cacheWrite));
  const output = microOf(rates.output);
  const cached = microOf(rates.cacheRead);
  if (input === null || output === null || cached === null) return { ok: false, reason: 'unusable-price', detail: `${key} has a price that cannot be made whole` };
  const rate: RateCard = { model: key, inputMicroUsdPerMillion: input, outputMicroUsdPerMillion: output, ...(cached > 0 ? { cachedInputMicroUsdPerMillion: cached } : {}) };
  const problems = rateCardProblems(rate);
  return problems.length > 0 ? { ok: false, reason: 'unusable-price', detail: problems.join('; ') } : { ok: true, rate };
}
