// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: packages/llm-core/src/usage-cost.ts; packages/model-catalog-core/src/model-catalog-pricing.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: DIRECT
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: only tier selection and the upstream per-million price reader are taken; the remote catalogue sources, the OpenRouter reader, the float cost calculation and the embedding usage are cut because the cost is figured by the existing RateCard, and tiers arrive as one committed record
// Notice: full licence text in THIRD_PARTY_NOTICES

/** USD per million tokens, for the four separately billed buckets. */
export interface PricingRates {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** One whole-request tier on the cache-inclusive prompt-token axis: the half-open interval `[start, end)`. */
export interface PricingTier extends PricingRates {
  readonly range: readonly [number, number];
}

export interface ModelPricing extends PricingRates {
  readonly tieredPricing?: readonly PricingTier[];
}

type ContextPrice = { readonly size: number; readonly cost: PricingRates | undefined };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonNegativeFinite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

function normalizeTieredPricing(raw: readonly PricingTier[] | undefined): PricingTier[] | undefined {
  if (!raw || raw.length === 0) {
    return undefined;
  }
  const result: PricingTier[] = [];
  for (const tier of raw) {
    const range = tier.range;
    const start = Array.isArray(range) && typeof range[0] === 'number' ? range[0] : Number.NaN;
    if (!Number.isFinite(start)) {
      continue;
    }
    const rawEnd = range.length >= 2 ? range[1] : null;
    const end = typeof rawEnd === 'number' && Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : Infinity;
    if (![tier.input, tier.output, tier.cacheRead, tier.cacheWrite].every(Number.isFinite)) {
      continue;
    }
    result.push({ input: tier.input, output: tier.output, cacheRead: tier.cacheRead, cacheWrite: tier.cacheWrite, range: [start, end] });
  }
  return result.length > 0 ? [...result].sort((a, b) => a.range[0] - b.range[0]) : undefined;
}

/** Pick the rates for one call from its prompt-token count: a whole request is billed at one tier, never blended. */
export function selectPricingRates(cost: ModelPricing, promptTokens: number): PricingRates {
  const sorted = normalizeTieredPricing(cost.tieredPricing);
  if (!sorted) {
    return cost;
  }
  if (promptTokens <= 0) {
    return sorted[0] ?? cost;
  }
  const matched = sorted.find((tier) => promptTokens >= tier.range[0] && promptTokens < tier.range[1]);
  // Preserve whole-request pricing for gaps and overflow: nearest lower tier,
  // otherwise the first tier. Never blend the buckets across tiers.
  return matched ?? [...sorted].reverse().find((tier) => promptTokens >= tier.range[0]) ?? sorted[0] ?? cost;
}

function readPricingCost(value: unknown): PricingRates | undefined {
  const row = isRecord(value) ? value : undefined;
  const input = nonNegativeFinite(row?.['input']);
  const output = nonNegativeFinite(row?.['output']);
  // Missing cache rates mean no cache charge; required rates must distinguish unknown from free.
  const cacheRead = row?.['cache_read'] === undefined ? 0 : nonNegativeFinite(row['cache_read']);
  const cacheWrite = row?.['cache_write'] === undefined ? 0 : nonNegativeFinite(row['cache_write']);
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) {
    return undefined;
  }
  return { input, output, cacheRead, cacheWrite };
}

function withContextPrices(cost: PricingRates | undefined, tiers: ContextPrice[]): ModelPricing | undefined {
  if (!cost) {
    return undefined;
  }
  const ordered = [...tiers].sort((left, right) => left.size - right.size);
  const firstTier = ordered[0];
  if (!firstTier) {
    return cost;
  }
  const tieredPricing: PricingTier[] = [{ ...cost, range: [0, firstTier.size] }];
  for (const [index, tier] of ordered.entries()) {
    // A recognized context tier with unknown rates invalidates the price, not just that tier.
    if (!tier.cost) {
      return undefined;
    }
    const next = ordered[index + 1]?.size;
    // Conflicting thresholds cannot select one whole-request price; never publish zero-width tiers.
    if (next === tier.size) {
      return undefined;
    }
    tieredPricing.push({ ...tier.cost, range: next ? [tier.size, next] : [tier.size, Infinity] });
  }
  return { ...cost, tieredPricing };
}

/** Read upstream per-million prices, preferring modern context tiers over context_over_200k. */
export function normalizeUpstreamModelPricing(value: unknown): ModelPricing | undefined {
  const row = isRecord(value) ? value : undefined;
  const tiers: ContextPrice[] = [];
  for (const raw of Array.isArray(row?.['tiers']) ? (row['tiers'] as unknown[]) : []) {
    const price = isRecord(raw) ? raw : undefined;
    const tier = isRecord(price?.['tier']) ? (price['tier'] as Record<string, unknown>) : undefined;
    const size = tier?.['size'];
    if (tier?.['type'] === 'context' && typeof size === 'number' && Number.isSafeInteger(size) && size > 0) {
      tiers.push({ size, cost: readPricingCost(price) });
    }
  }
  if (tiers.length === 0 && isRecord(row?.['context_over_200k'])) {
    tiers.push({ size: 200_000, cost: readPricingCost(row['context_over_200k']) });
  }
  return withContextPrices(readPricingCost(value), tiers);
}
