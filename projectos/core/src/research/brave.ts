// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: extensions/brave/src/brave-web-search-provider.runtime.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: config, secret references, the response cache, diagnostics logging and the plugin SDK are cut; only the web mode is kept, so the llm-context mode and its date rules are cut; the credential is not read here, a header function is handed in and its answer is not stored or logged; the fetch is an injected port and never follows a redirect; the country and language code lists are kept and a code outside them is refused where upstream widened a country to ALL; the price of a query is part of the adapter's own configuration; results are bounded and wrapped later, not here
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED (review round 1): the adapter is not made without a cross-run ledger port, asks it before every query and sends nothing unless it answers exactly true; the query carries the run scope so the ledger can name it
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * The Brave Search adapter (PROJECTOS-PORT-RESEARCH1A, C16): a PAID provider behind an injected fetch.
 *
 * It declares `paid: true` and a price in whole micro-USD, so the runtime refuses it without a budget and a grant, and
 * reserves the price before it is called. It holds no credential: `headersFor` is an injected function that returns the
 * subscription header, called once per query, and its answer goes to the fetch port and nowhere else: it is not
 * stored, not logged and not part of any cache key. A missing or malformed answer is `not_configured` before
 * anything is sent, so nothing is charged for it.
 *
 * The endpoint is Brave's own address, or an operator-declared one judged by the guard in the mode declared. An API
 * call never follows a redirect, so the header cannot be carried to a host it was not configured for.
 */

import type { ResearchScope } from './ports.js';
import { fetchGuarded, headerOf, judgeUrlStatic, type GuardMode, type GuardedFetchDeps } from './ssrfGuard.js';
import { researchOk, researchRefused, type ResearchResult } from './refusal.js';
import { SearchProviderError, providerFailure, resultsOf, type ProviderQuery, type SearchResult, type WebSearchProvider } from './searchProvider.js';

export const BRAVE_BASE_URL = 'https://api.search.brave.com';
export const BRAVE_SEARCH_PATH = '/res/v1/web/search';
export const BRAVE_MAX_RESPONSE_BYTES = 1_000_000;
export const BRAVE_TIMEOUT_MS = 15_000;
const AUTH_HEADER = 'x-subscription-token';

const BRAVE_COUNTRY_CODES: ReadonlySet<string> = new Set([
  'AR', 'AU', 'AT', 'BE', 'BR', 'CA', 'CL', 'DK', 'FI', 'FR', 'DE', 'GR', 'HK', 'IN', 'ID', 'IT', 'JP', 'KR', 'MY', 'MX', 'NL', 'NZ', 'NO', 'CN', 'PL', 'PT', 'PH', 'RU', 'SA', 'ZA',
  'ES', 'SE', 'CH', 'TW', 'TR', 'GB', 'US', 'ALL',
]);

const BRAVE_SEARCH_LANG_CODES: ReadonlySet<string> = new Set([
  'ar', 'eu', 'bn', 'bg', 'ca', 'zh-hans', 'zh-hant', 'hr', 'cs', 'da', 'nl', 'en', 'en-gb', 'et', 'fi', 'fr', 'gl', 'de', 'el', 'gu', 'he', 'hi', 'hu', 'is', 'it', 'jp', 'kn', 'ko', 'lv', 'lt',
  'ms', 'ml', 'mr', 'nb', 'pl', 'pt-br', 'pt-pt', 'pa', 'ro', 'ru', 'sr', 'sk', 'sl', 'es', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'vi',
]);

const BRAVE_SEARCH_LANG_ALIASES: Readonly<Record<string, string>> = { ja: 'jp', zh: 'zh-hans', 'zh-cn': 'zh-hans', 'zh-hk': 'zh-hant', 'zh-sg': 'zh-hans', 'zh-tw': 'zh-hant' };

export interface BraveConfig {
  readonly baseUrl?: string;
  readonly mode?: GuardMode;
  /** Whole micro-USD one query costs: a committed number the operator set, never the request's. */
  readonly microUsdPerQuery: number;
  readonly country?: string;
  readonly searchLang?: string;
  /** Returns the auth header. Called once per query. The module never names, stores or logs what it returns. */
  /** Asked before every query, and the query is not sent unless it answers exactly `true`. The owner's spend across runs lives here. */
  readonly ledger: (request: { readonly scope: ResearchScope; readonly provider: 'brave'; readonly microUsd: number }) => boolean | Promise<boolean>;
  readonly headersFor: () => Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>>;
}

function normalizedLang(value: string): string | null {
  const lower = value.trim().toLowerCase();
  const canonical = BRAVE_SEARCH_LANG_ALIASES[lower] ?? lower;
  return BRAVE_SEARCH_LANG_CODES.has(canonical) ? canonical : null;
}

async function authHeaders(config: BraveConfig): Promise<Readonly<Record<string, string>>> {
  let given: unknown;
  try {
    given = await config.headersFor();
  } catch {
    throw new SearchProviderError('not_configured', 'the search credential was not available');
  }
  const row = given as Record<string, unknown> | null;
  const names = typeof row === 'object' && row !== null ? Object.keys(row) : [];
  const value = names.length === 1 && names[0]?.toLowerCase() === AUTH_HEADER ? row?.[names[0] as string] : undefined;
  if (typeof value !== 'string' || value === '' || /[\r\n]/.test(value)) throw new SearchProviderError('not_configured', 'the search credential was not available');
  return { [AUTH_HEADER]: value };
}

function toResult(row: unknown): SearchResult | null {
  const item = row as { title?: unknown; url?: unknown; description?: unknown } | null;
  return typeof item === 'object' && item !== null && typeof item.url === 'string' && typeof item.title === 'string'
    ? { url: item.url, title: item.title, snippet: typeof item.description === 'string' ? item.description : '' }
    : null;
}

export function createBraveProvider(config: BraveConfig, deps: GuardedFetchDeps): ResearchResult<WebSearchProvider> {
  const mode: GuardMode = config.mode ?? 'public';
  const stat = judgeUrlStatic(config.baseUrl ?? BRAVE_BASE_URL, deps.policy, mode);
  if (!stat.ok) return researchRefused('URL_REFUSED', `the Brave address was refused: ${stat.reason}`, { reason: stat.reason });
  if (mode === 'public' && stat.url.scheme !== 'https') return researchRefused('INVALID_REQUEST', 'a public Brave address must be https');
  const price = config.microUsdPerQuery;
  if (typeof price !== 'number' || !Number.isSafeInteger(price) || price < 1) return researchRefused('INVALID_REQUEST', 'Brave is paid: its price per query must be a whole number of micro-USD, at least 1');
  if (typeof config.headersFor !== 'function') return researchRefused('INVALID_REQUEST', 'a function that supplies the auth header is required');
  if (typeof config.ledger !== 'function') return researchRefused('INVALID_REQUEST', 'Brave is paid and is not enabled without a cross-run ledger that answers exactly true');
  const country = config.country === undefined ? undefined : config.country.toUpperCase();
  if (country !== undefined && !BRAVE_COUNTRY_CODES.has(country)) return researchRefused('INVALID_REQUEST', 'the Brave country is not one of its supported codes');
  const lang = config.searchLang === undefined ? undefined : normalizedLang(config.searchLang);
  if (config.searchLang !== undefined && lang === null) return researchRefused('INVALID_REQUEST', 'the Brave search language is not one of its supported codes');
  const base = stat.url.canonical.replace(/\/+$/, '');

  return researchOk({
    id: 'brave',
    paid: true,
    microUsdPerQuery: price,
    search: async ({ query, count, scope }: ProviderQuery, signal?: AbortSignal): Promise<readonly SearchResult[]> => {
      void signal;
      // The cross-run ledger is asked first: without its yes, nothing is read and nothing is sent.
      let approved = false;
      try {
        approved = (await config.ledger({ scope, provider: 'brave', microUsd: price })) === true;
      } catch {
        approved = false;
      }
      if (!approved) throw new SearchProviderError('not_sent', 'the cross-run ledger did not confirm this query');
      // The credential is asked for first: with none there is nothing to send, so nothing is charged.
      const headers = await authHeaders(config);
      const url = new URL(`${base}${BRAVE_SEARCH_PATH}`);
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(count));
      if (country !== undefined) url.searchParams.set('country', country);
      if (lang !== undefined && lang !== null) url.searchParams.set('search_lang', lang);
      const answered = await fetchGuarded(
        { url: url.href, mode, maxHops: 0, maxBytes: BRAVE_MAX_RESPONSE_BYTES, timeoutMs: BRAVE_TIMEOUT_MS, headers: { accept: 'application/json', ...headers } },
        deps,
      );
      if (!answered.ok) throw providerFailure(answered.refusal);
      const { response } = answered.value;
      if (response.status < 200 || response.status > 299) throw new SearchProviderError('maybe_sent', `Brave answered with status ${response.status}`);
      if (response.truncated) throw new SearchProviderError('maybe_sent', 'the Brave response was cut by the byte cap');
      const media = (headerOf(response.headers, 'content-type') ?? '').toLowerCase();
      if (media !== '' && !media.includes('json')) throw new SearchProviderError('maybe_sent', 'Brave did not answer with JSON');
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.body);
      } catch {
        throw new SearchProviderError('maybe_sent', 'Brave returned invalid JSON');
      }
      const rows = (parsed as { web?: { results?: unknown } } | null)?.web?.results;
      return resultsOf(Array.isArray(rows) ? rows.map(toResult).filter((row): row is SearchResult => row !== null) : [], count);
    },
  });
}
