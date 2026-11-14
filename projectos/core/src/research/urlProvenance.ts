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
const MAX_LISTED_URLS = 200;

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]}]{1,2048}/gi;

/** The canonical form of an address, or null when it does not parse as a page address. */
export function canonicalOf(url: string): string | null {
  const parsed = parseWebUrl(url, PAGE_PORTS);
  return parsed.ok ? parsed.url.canonical : null;
}

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
    if (!named || url.includes('?') || url.includes('#')) return 'not-listed';
  }
  return hosts.has(host) || hosts.size < MAX_HOSTS_PER_RUN ? null : 'too-many-hosts';
}
