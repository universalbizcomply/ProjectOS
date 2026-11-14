// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/web-search/runtime.ts; src/web-search/runtime-error.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: config, auth-profile and plugin discovery are cut, and the providers are a list handed in; the candidate loop is kept (an explicit provider is not replaced, an implicit one falls back, the first failure is kept); a paid candidate is asked for a budget, a grant and room before it is called, and a failure is accounted by whether anything could have been sent; the structured missing-credential result and its not-set-up wording become a refusal that carries no provider text; the OAuth refresh and HTTP-status diagnostics are cut; the query and the count are judged, and the provider's results are bounded
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED (review round 1): every search call is made through an injected timer and a hang is a TIMEOUT; results are screened for hidden characters, special tokens and instructions before they are returned, and what was dropped is reported by index and reason
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * Run a web search through the providers handed in (PROJECTOS-PORT-RESEARCH1A, C16).
 *
 * The order is the providers' order. An explicit provider id is used alone and never replaced: asking for Brave and
 * getting SearXNG would spend or reveal something the caller did not choose. Without one, a failed or unconfigured
 * provider falls through to the next, and when none answers the FIRST failure is the one reported, by code and
 * provider id only: a provider's own error text is untrusted and is not repeated.
 *
 * A paid candidate passes `reservePaidQuery` first, so a paid search without a budget is refused before the
 * provider is called. A free candidate needs none. The abort signal and `assertCurrent` are checked before each
 * candidate and after each answer, as upstream does, so a cancelled run neither calls on nor returns stale work.
 *
 * Pure: the provider holds the injected fetch.
 */

import type { ResearchScope, TimerPort } from './ports.js';
import { isResearchScope } from './pageCache.js';
import { researchOk, researchRefused, type ResearchRefusal, type ResearchResult } from './refusal.js';
import { screenSearchResults, type DroppedResult } from './resultScreen.js';
import { callWithin, timeoutOf, type ResearchTimeouts } from './timing.js';
import { reservePaidQuery, type SpendBook, type SpendGrant } from './searchBudget.js';
import { PROVIDER_ID, SearchProviderError, countOf, priceOf, queryProblem, resultsOf, type SearchResult, type WebSearchProvider } from './searchProvider.js';

export interface WebSearchRequest {
  readonly scope: ResearchScope;
  readonly query: unknown;
  readonly count?: unknown;
  /** Use this provider alone. Absent: the providers in order, with fallback. */
  readonly providerId?: unknown;
}

export interface WebSearchDeps {
  readonly providers: readonly WebSearchProvider[];
  readonly spend: SpendBook;
  readonly grant: SpendGrant;
  readonly signal?: AbortSignal;
  readonly assertCurrent?: () => void;
  readonly timer: TimerPort;
  /** Shorter waits than the defaults, never longer. */
  readonly timeouts?: Partial<ResearchTimeouts>;
}

export interface WebSearchOutcome {
  readonly provider: string;
  readonly query: string;
  readonly results: readonly SearchResult[];
  /** Results that were screened out, by index and closed reason. Never their text. */
  readonly dropped: readonly DroppedResult[];
  /** Micro-USD charged to the run so far, across every query it made. */
  readonly spentMicroUsd: number;
}

const stopped = (deps: WebSearchDeps): boolean => {
  if (deps.signal?.aborted === true) return true;
  try {
    deps.assertCurrent?.();
    return false;
  } catch {
    return true;
  }
};

const failed = (id: string, kind: 'failed' | 'unconfigured' | 'timeout'): ResearchRefusal =>
  (kind === 'unconfigured' ? researchRefused('NOT_CONFIGURED', `the search provider '${id}' has no setup on this machine`) : kind === 'timeout' ? researchRefused('TIMEOUT', `the search provider '${id}' did not answer in time`) : researchRefused('SEARCH_FAILED', `the search provider '${id}' failed`)).refusal;

function candidatesOf(providers: readonly WebSearchProvider[], providerId: unknown): readonly WebSearchProvider[] | ResearchRefusal {
  const usable = providers.filter((provider) => typeof provider === 'object' && provider !== null && PROVIDER_ID.test(provider.id));
  if (providerId === undefined) return usable;
  const chosen = usable.find((provider) => provider.id === providerId);
  return chosen === undefined ? researchRefused('INVALID_REQUEST', 'that search provider is not one of the providers').refusal : [chosen];
}

/** Ask one candidate. Returns its results, or the refusal that made it unavailable, so the next candidate can be tried. */
async function askOne(
  provider: WebSearchProvider,
  request: { readonly scope: ResearchScope; readonly query: string; readonly count: number },
  deps: WebSearchDeps,
): Promise<{ readonly results: readonly SearchResult[]; readonly dropped: readonly DroppedResult[] } | { readonly refusal: ResearchRefusal }> {
  const price = priceOf(provider);
  if (price === null) return { refusal: researchRefused('INVALID_REQUEST', `the search provider '${provider.id}' declares a price that cannot be used`).refusal };
  if (price.paid) {
    const reserved = await reservePaidQuery(deps.spend, deps.grant, { scope: request.scope, provider: provider.id, microUsd: price.microUsd });
    // A refusal for money asks nothing of the provider. A later free provider may still answer, and a later paid one is refused the same way.
    if (reserved !== null) return { refusal: reserved.refusal };
  }
  let thrown: unknown;
  const timed = await callWithin(deps.timer, timeoutOf(deps.timeouts, 'searchMs'), async (signal) => {
    try {
      return { answer: await provider.search({ query: request.query, count: request.count, scope: request.scope }, signal) };
    } catch (error) {
      thrown = error;
      return null;
    }
  });
  // A call that timed out may have been sent, so its price stays charged.
  if (timed.kind === 'timeout') return { refusal: failed(provider.id, 'timeout') };
  if (timed.kind === 'value' && timed.value !== null) {
    const screened = screenSearchResults(resultsOf(timed.value.answer, request.count));
    return { results: screened.kept, dropped: screened.dropped };
  }
  const kind = thrown instanceof SearchProviderError ? thrown.kind : 'maybe_sent';
  // Only a failure before anything could have been sent gives the money back.
  if (price.paid && (kind === 'not_sent' || kind === 'not_configured')) deps.spend.release(price.microUsd);
  return { refusal: failed(provider.id, kind === 'not_configured' ? 'unconfigured' : 'failed') };
}

export async function runWebSearch(request: WebSearchRequest, deps: WebSearchDeps): Promise<ResearchResult<WebSearchOutcome>> {
  if (!isResearchScope(request.scope)) return researchRefused('BAD_SCOPE', 'a research request needs a tenant and a project');
  const problem = queryProblem(request.query);
  const count = countOf(request.count);
  if (problem !== null || count === null) return researchRefused('INVALID_REQUEST', problem ?? 'the count must be a whole number from 1 to 10');
  const candidates = candidatesOf(deps.providers, request.providerId);
  if (!Array.isArray(candidates)) return { ok: false, refusal: candidates as ResearchRefusal };
  if (candidates.length === 0) return researchRefused('NOT_CONFIGURED', 'no search provider is available');
  let first: ResearchRefusal | null = null;
  for (const provider of candidates as readonly WebSearchProvider[]) {
    if (stopped(deps)) return researchRefused('SEARCH_FAILED', 'the search was cancelled');
    const asked = await askOne(provider, { scope: request.scope, query: request.query as string, count }, deps);
    if (stopped(deps)) return researchRefused('SEARCH_FAILED', 'the search was cancelled');
    if ('results' in asked) return researchOk({ provider: provider.id, query: request.query as string, results: asked.results, dropped: asked.dropped, spentMicroUsd: deps.spend.spent() });
    first ??= asked.refusal;
  }
  return { ok: false, refusal: first ?? researchRefused('SEARCH_FAILED', 'no search provider answered').refusal };
}
