// Origin: original ProjectOS code
/**
 * What a search provider is, and how its answer is judged (PROJECTOS-PORT-RESEARCH1A, C16).
 *
 * A provider is a function behind an injected fetch. It declares whether it is paid and what a query costs, in whole
 * micro-USD, from its OWN configuration: the request cannot name a price. Anything that is not exactly `paid: false`
 * is treated as paid, so a provider that forgets to say is held to the budget.
 *
 * WHAT A PROVIDER ANSWERS IS DATA. Titles, addresses and snippets are cut to bounded lengths, anything that is not
 * text is dropped, and the list is held to the count that was asked for, whatever the provider sent. They reach a
 * prompt only through the wrapper in `externalContent.ts`, and an address is judged by the SSRF guard before it is ever
 * fetched.
 *
 * HOW A FAILURE IS ACCOUNTED. A provider that threw before it could have sent anything says `not_sent`, and a paid
 * query that failed that way is not charged. Any other failure may have been billed and stays counted.
 */

import { researchRefused, type ResearchRefusal } from './refusal.js';

export const MAX_SEARCH_COUNT = 10;
export const DEFAULT_SEARCH_COUNT = 5;
export const MAX_QUERY_CHARS = 400;
const MAX_TITLE_CHARS = 300;
const MAX_SNIPPET_CHARS = 1000;
const MAX_RESULT_URL_CHARS = 2048;

export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface ProviderQuery {
  readonly query: string;
  readonly count: number;
}

export interface WebSearchProvider {
  readonly id: string;
  readonly paid: boolean;
  /** Whole micro-USD one query costs. Zero for a free provider; at least one for a paid one. */
  readonly microUsdPerQuery: number;
  readonly search: (query: ProviderQuery) => Promise<readonly SearchResult[]>;
}

export type SearchFailureKind = 'not_sent' | 'maybe_sent' | 'not_configured';

export class SearchProviderError extends Error {
  readonly kind: SearchFailureKind;

  constructor(kind: SearchFailureKind, message: string) {
    super(message);
    this.name = 'SearchProviderError';
    this.kind = kind;
  }
}

export const PROVIDER_ID = /^[a-z][a-z0-9-]{1,31}$/;

/** A query the providers may be asked: text, bounded, with no control characters. */
export function queryProblem(query: unknown): string | null {
  if (typeof query !== 'string' || query.trim() === '') return 'the query is empty';
  if (query.length > MAX_QUERY_CHARS) return `the query is longer than ${MAX_QUERY_CHARS} characters`;
  return /\p{Cc}/u.test(query) ? 'the query holds a control character' : null;
}

/** The count to ask for: a whole number from 1 to the ceiling, the default when none is given, and null when it is not usable. */
export function countOf(count: unknown): number | null {
  if (count === undefined) return DEFAULT_SEARCH_COUNT;
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 1 && count <= MAX_SEARCH_COUNT ? count : null;
}

/** What a paid provider costs, or null when its declared price cannot be used. Free is exactly `paid: false` with a price of zero. */
export function priceOf(provider: WebSearchProvider): { readonly paid: boolean; readonly microUsd: number } | null {
  const price = provider.microUsdPerQuery;
  if (provider.paid === false) return price === 0 ? { paid: false, microUsd: 0 } : null;
  return typeof price === 'number' && Number.isSafeInteger(price) && price >= 1 ? { paid: true, microUsd: price } : null;
}

const cut = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value);

/** Judge what a provider returned: only whole, textual results, at most `count` of them, each bounded. */
export function resultsOf(answer: unknown, count: number): readonly SearchResult[] {
  if (!Array.isArray(answer)) return [];
  const out: SearchResult[] = [];
  for (const item of answer) {
    const row = item as Partial<SearchResult> | null;
    if (typeof row !== 'object' || row === null || typeof row.url !== 'string' || row.url === '' || typeof row.title !== 'string') continue;
    out.push({ title: cut(row.title, MAX_TITLE_CHARS), url: cut(row.url, MAX_RESULT_URL_CHARS), snippet: typeof row.snippet === 'string' ? cut(row.snippet, MAX_SNIPPET_CHARS) : '' });
    if (out.length >= count) break;
  }
  return out;
}

/** Whether a refused guarded fetch could have reached the network. A refusal before the dispatch could not. */
export function failureKindOf(refusal: ResearchRefusal): SearchFailureKind {
  return refusal.code === 'URL_REFUSED' || refusal.code === 'INVALID_REQUEST' || refusal.code === 'BAD_CLOCK' ? 'not_sent' : 'maybe_sent';
}

export function providerFailure(refusal: ResearchRefusal): SearchProviderError {
  return new SearchProviderError(failureKindOf(refusal), `the search endpoint was refused: ${refusal.code}`);
}

export const notConfigured = (id: string): ReturnType<typeof researchRefused> => researchRefused('NOT_CONFIGURED', `the search provider '${id}' has no setup on this machine`);
