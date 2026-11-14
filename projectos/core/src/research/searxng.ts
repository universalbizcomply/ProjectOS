// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: extensions/searxng/src/searxng-client.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: config, secret references, the response cache and the plugin SDK are cut; the endpoint is declared by the operator as public or self-hosted and is judged by the guard in that mode, where upstream decided by resolving DNS; the fetch is an injected port and never follows a redirect; the response is read only if it was not cut, then parsed as JSON; the general-category fallback is kept; results are bounded and wrapped later, not here
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * The SearXNG search adapter (PROJECTOS-PORT-RESEARCH1A, C16): free, self-hosted meta-search behind an injected fetch.
 *
 * The endpoint is the operator's, declared as `self-hosted` (a loopback or private SearXNG; the metadata floor still
 * holds) or `public` (https, judged like any page). An API call never follows a redirect, so an endpoint cannot send
 * the adapter somewhere it was not configured to go. Nothing here opens a socket: tests drive it with fakes.
 *
 * The instance must have the JSON format enabled (`search.formats` in its settings). A response that is not JSON, was
 * cut by the byte cap or has a bad status is a failure of the provider, not an empty answer.
 */

import { fetchGuarded, headerOf, judgeUrlStatic, type GuardMode, type GuardedFetchDeps } from './ssrfGuard.js';
import { researchOk, researchRefused, type ResearchResult } from './refusal.js';
import { SearchProviderError, providerFailure, resultsOf, type ProviderQuery, type SearchResult, type WebSearchProvider } from './searchProvider.js';

export const SEARXNG_MAX_RESPONSE_BYTES = 1_000_000;
export const SEARXNG_TIMEOUT_MS = 20_000;

export interface SearxngConfig {
  readonly baseUrl: string;
  readonly mode: GuardMode;
  readonly categories?: string;
  readonly language?: string;
}

const CATEGORIES = /^[a-z0-9_]+(?:,[a-z0-9_]+){0,7}$/i;
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?$/;

function searchUrl(base: string, query: string, categories: string | undefined, language: string | undefined): string {
  const url = new URL(base);
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/search') ? path : `${path}/search`;
  url.search = '';
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  if (categories !== undefined) url.searchParams.set('categories', categories);
  if (language !== undefined) url.searchParams.set('language', language);
  return url.href;
}

function rowsOf(text: string): readonly unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SearchProviderError('maybe_sent', 'SearXNG returned invalid JSON');
  }
  const rows = (parsed as { results?: unknown } | null)?.results;
  return Array.isArray(rows) ? rows : [];
}

const toResult = (row: unknown): SearchResult | null => {
  const item = row as { url?: unknown; title?: unknown; content?: unknown } | null;
  return typeof item === 'object' && item !== null && typeof item.url === 'string' && typeof item.title === 'string'
    ? { url: item.url, title: item.title, snippet: typeof item.content === 'string' ? item.content : '' }
    : null;
};

export function createSearxngProvider(config: SearxngConfig, deps: GuardedFetchDeps): ResearchResult<WebSearchProvider> {
  const stat = judgeUrlStatic(config.baseUrl, deps.policy, config.mode);
  if (!stat.ok) return researchRefused('URL_REFUSED', `the SearXNG address was refused: ${stat.reason}`, { reason: stat.reason });
  if (config.mode === 'public' && stat.url.scheme !== 'https') return researchRefused('INVALID_REQUEST', 'a public SearXNG address must be https');
  if (config.categories !== undefined && !CATEGORIES.test(config.categories)) return researchRefused('INVALID_REQUEST', 'the SearXNG categories are not a short comma list');
  if (config.language !== undefined && !LANGUAGE.test(config.language)) return researchRefused('INVALID_REQUEST', 'the SearXNG language is not a language code');
  const base = stat.url.canonical;

  const fetchOnce = async (query: string, categories: string | undefined): Promise<readonly SearchResult[]> => {
    const answered = await fetchGuarded(
      { url: searchUrl(base, query, categories, config.language), mode: config.mode, maxHops: 0, maxBytes: SEARXNG_MAX_RESPONSE_BYTES, timeoutMs: SEARXNG_TIMEOUT_MS, headers: { accept: 'application/json' } },
      deps,
    );
    if (!answered.ok) throw providerFailure(answered.refusal);
    const { response } = answered.value;
    if (response.status < 200 || response.status > 299) throw new SearchProviderError('maybe_sent', `SearXNG answered with status ${response.status}`);
    if (response.truncated) throw new SearchProviderError('maybe_sent', 'SearXNG response was cut by the byte cap');
    const media = (headerOf(response.headers, 'content-type') ?? '').toLowerCase();
    if (media !== '' && !media.includes('json')) throw new SearchProviderError('maybe_sent', 'SearXNG did not answer with JSON');
    return rowsOf(response.body).map(toResult).filter((row): row is SearchResult => row !== null);
  };

  return researchOk({
    id: 'searxng',
    paid: false,
    microUsdPerQuery: 0,
    search: async ({ query, count }: ProviderQuery): Promise<readonly SearchResult[]> => {
      let results = await fetchOnce(query, config.categories);
      // Upstream's fallback: nothing in the chosen categories is retried in `general`.
      if (results.length === 0 && config.categories !== undefined && !config.categories.toLowerCase().split(',').includes('general')) results = await fetchOnce(query, 'general');
      return resultsOf(results, count);
    },
  });
}
