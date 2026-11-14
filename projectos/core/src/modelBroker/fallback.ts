// Origin: original ProjectOS code
/**
 * Which route a call takes next. The chain is a request's own list of preferences, and it is only a list: every
 * entry is checked against the committed registry, the committed price table and the cooldowns before it is used.
 *
 * A FALLBACK NEVER LEAVES THE REGISTRY. An entry whose provider is not registered under exactly that name is
 * skipped and reported, never called, however it is spelled and whatever price table names it. An entry in
 * cooldown is skipped until the injected clock reaches the end of its cooldown. An unpriced model is skipped.
 */

import type { RateCard } from '../gatekeeperCostLedger.js';
import { isCoolingDown, type CooldownState } from './cooldown.js';
import { rateCardFor, type PricingTable } from './committedPricing.js';
import type { ProviderRecord, ProviderRegistry } from './providerRegistry.js';
import { routeKeyOf, type RouteEntry } from './routeTypes.js';

export type RouteSkipReason = 'not-registered' | 'cooling-down' | 'unpriced' | 'already-tried';

export interface RouteSkip extends RouteEntry {
  readonly reason: RouteSkipReason;
}

export interface ChosenRoute extends RouteEntry {
  readonly provider: string;
  readonly record: ProviderRecord;
  readonly rate: RateCard;
}

export interface ChooseRouteParams {
  readonly chain: readonly RouteEntry[];
  readonly registry: ProviderRegistry;
  readonly cooldowns: CooldownState;
  readonly pricing: PricingTable;
  readonly nowMs: number;
  /** The prompt size that picks a price tier. */
  readonly promptTokens: number;
  /** Routes already tried by this call, as `provider/model`. */
  readonly tried: ReadonlySet<string>;
}

export type RouteChoice =
  | { readonly ok: true; readonly route: ChosenRoute; readonly skipped: readonly RouteSkip[] }
  | { readonly ok: false; readonly skipped: readonly RouteSkip[] };

function skipOf(entry: RouteEntry, params: ChooseRouteParams): { reason: RouteSkipReason } | { route: ChosenRoute } {
  const record = params.registry.get(entry.provider);
  // Exactly the registered spelling: a different one is a different provider, not a way round the registry.
  if (record === undefined || record.name !== entry.provider) return { reason: 'not-registered' };
  if (params.tried.has(routeKeyOf(entry))) return { reason: 'already-tried' };
  if (isCoolingDown(params.cooldowns, record.name, params.nowMs)) return { reason: 'cooling-down' };
  const priced = rateCardFor(params.pricing, record.name, entry.model, params.promptTokens);
  if (!priced.ok) return { reason: 'unpriced' };
  return { route: { provider: record.name, model: entry.model, record, rate: priced.rate } };
}

/** The first usable entry in the chain's order, and what was skipped on the way and why. */
export function chooseRoute(params: ChooseRouteParams): RouteChoice {
  const skipped: RouteSkip[] = [];
  for (const entry of params.chain) {
    const judged = skipOf(entry, params);
    if ('route' in judged) return { ok: true, route: judged.route, skipped };
    skipped.push({ provider: entry.provider, model: entry.model, reason: judged.reason });
  }
  return { ok: false, skipped };
}
