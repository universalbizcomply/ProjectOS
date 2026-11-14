// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/url_safety.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: translated from Python to TypeScript with the network behind injected ports; the guard resolves twice and judges both answers, then hands the fetch port only the addresses it judged, which replaces the httpx connect-time hook; a redirect is read from the Location header, resolved against the hop and judged again, with a hop cap; a resolver answer that is empty, too long or unparseable is refused, and a DNS failure is refused even when a proxy might resolve it; the allow-private toggle, the proxy exception and the trusted-private-host list are cut; a refusal carries a closed reason
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * The SSRF guard (PROJECTOS-PORT-RESEARCH1A, C16). Mandatory before any page is fetched.
 *
 * A URL passes only when every one of these holds, in this order, and the first to fail is the refusal:
 *   1. it parses one way (`urlParse.ts`): http or https, no userinfo, no credential-named query, an allowed port;
 *   2. its host name is not an internal, local, wildcard-DNS or metadata name (`hostNames.ts`), or its literal
 *      address is public;
 *   3. the website policy allows its host (`websitePolicy.ts`);
 *   4. every address the resolver gives for the name is public. The resolver is asked TWICE, and both answers are
 *      judged, so a name that answers public the first time and private the second (DNS rebinding) is refused.
 *
 * THE FETCH PORT DIALS WHAT WAS JUDGED. `fetchGuarded` hands the port the addresses that passed, and nothing else to
 * dial. A redirect is never followed by the port: the guard reads the Location header, resolves it against the hop
 * and judges the new URL from step 1, up to a hop cap. A response that does not have the shape of one is refused.
 *
 * `mode: 'self-hosted'` is for a search endpoint the operator declares, such as a SearXNG on the loopback. It keeps
 * the metadata floor and the parse rules and allows every other address. It never follows a redirect.
 *
 * WHAT THIS CANNOT PROVE. That the port dials only the addresses it was given: that is its contract (`ports.ts`),
 * and the wiring phase must keep it. Pure: time, DNS and HTTP are injected.
 */

import { classifyAddress, type AddressReason } from './addressClass.js';
import { hostNameProblem, isMetadataName } from './hostNames.js';
import { createClockGuard, type HttpFetchPort, type HttpFetchResponse, type ResearchClock, type ResolverPort } from './ports.js';
import { researchOk, researchRefused, type ResearchResult, type UrlRefusalReason } from './refusal.js';
import { parseWebUrl, resolveRedirectTarget, type ParsedWebUrl } from './urlParse.js';
import { judgeWebsite, type WebsitePolicy } from './websitePolicy.js';

export const PAGE_PORTS: readonly number[] = [80, 443, 8080, 8443];
export const MAX_RESOLVED_ADDRESSES = 16;
export const MAX_PINNED_ADDRESSES = 8;
export const DEFAULT_MAX_HOPS = 5;
export const MAX_HOPS_CEILING = 5;
export const MAX_FETCH_TIMEOUT_MS = 30_000;
const REDIRECT_STATUSES: readonly number[] = [301, 302, 303, 307, 308];

export type GuardMode = 'public' | 'self-hosted';

export type UrlVerdict =
  | { readonly ok: true; readonly url: ParsedWebUrl; readonly addresses: readonly string[] }
  | { readonly ok: false; readonly reason: UrlRefusalReason; readonly detail?: string };

export interface GuardDeps {
  readonly resolver: ResolverPort;
  readonly policy: WebsitePolicy;
}

const refusal = (reason: UrlRefusalReason, detail?: string): UrlVerdict => (detail === undefined ? { ok: false, reason } : { ok: false, reason, detail });

const addressRefusal = (reason: AddressReason, resolved: boolean, rebind: boolean): UrlVerdict => {
  if (reason === 'metadata-address') return refusal('metadata-address', reason);
  return refusal(rebind ? 'dns-rebind' : resolved ? 'dns-blocked-address' : 'blocked-address', reason);
};

/** Every check that needs no network: parse, port, name or literal address, website policy. */
export function judgeUrlStatic(input: unknown, policy: WebsitePolicy, mode: GuardMode): UrlVerdict {
  const parsed = parseWebUrl(input, mode === 'public' ? PAGE_PORTS : null);
  if (!parsed.ok) return refusal(parsed.reason);
  const url = parsed.url;
  if (url.hostKind === 'name') {
    if (mode === 'self-hosted') {
      if (isMetadataName(url.host)) return refusal('metadata-host-name');
    } else {
      const problem = hostNameProblem(url.host);
      if (problem !== null) return refusal(problem);
    }
  } else {
    const verdict = classifyAddress(url.host);
    if (verdict.blocked && (mode === 'public' || verdict.reason === 'metadata-address' || verdict.reason === 'unparseable-address')) return addressRefusal(verdict.reason, false, false);
  }
  if (mode === 'public') {
    const decision = judgeWebsite(policy, url.host);
    if (!decision.allowed) return refusal(decision.reason, decision.reason === 'website-policy' ? decision.rule : undefined);
  }
  return { ok: true, url, addresses: url.hostKind === 'name' ? [] : [url.host.replace(/^\[|\]$/g, '')] };
}

type Answer = { readonly answer: readonly string[] } | { readonly verdict: UrlVerdict };

async function answerOf(resolver: ResolverPort, host: string): Promise<Answer> {
  let answer: unknown;
  try {
    answer = await resolver(host);
  } catch {
    return { verdict: refusal('dns-failed') };
  }
  if (!Array.isArray(answer)) return { verdict: refusal('dns-unparseable') };
  if (answer.length === 0) return { verdict: refusal('dns-empty') };
  if (answer.length > MAX_RESOLVED_ADDRESSES) return { verdict: refusal('dns-too-many') };
  return answer.every((item) => typeof item === 'string') ? { answer: answer as readonly string[] } : { verdict: refusal('dns-unparseable') };
}

function judgedAnswer(answer: readonly string[], mode: GuardMode, rebind: boolean): UrlVerdict | null {
  for (const address of answer) {
    const verdict = classifyAddress(address);
    if (!verdict.blocked) continue;
    if (verdict.reason === 'unparseable-address') return refusal('dns-unparseable');
    if (mode === 'public' || verdict.reason === 'metadata-address') return addressRefusal(verdict.reason, true, rebind);
  }
  return null;
}

/** The static checks, then two resolutions of a name, both judged. The addresses returned are the ones the port may dial. */
export async function judgeUrl(input: unknown, deps: GuardDeps, mode: GuardMode): Promise<UrlVerdict> {
  const stat = judgeUrlStatic(input, deps.policy, mode);
  if (!stat.ok || stat.url.hostKind !== 'name') return stat;
  const first = await answerOf(deps.resolver, stat.url.host);
  if ('verdict' in first) return first.verdict;
  const firstProblem = judgedAnswer(first.answer, mode, false);
  if (firstProblem !== null) return firstProblem;
  const second = await answerOf(deps.resolver, stat.url.host);
  if ('verdict' in second) return second.verdict;
  const secondProblem = judgedAnswer(second.answer, mode, true);
  if (secondProblem !== null) return secondProblem;
  return { ok: true, url: stat.url, addresses: [...new Set(first.answer)].slice(0, MAX_PINNED_ADDRESSES) };
}

export interface GuardedFetchParams {
  readonly url: string;
  readonly mode: GuardMode;
  /** Redirects to follow, held to the ceiling. Zero for an API endpoint. */
  readonly maxHops: number;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly headers: Readonly<Record<string, string>>;
}

export interface GuardedFetchDeps extends GuardDeps {
  readonly fetch: HttpFetchPort;
  readonly clock: ResearchClock;
}

export interface GuardedResponse {
  readonly response: HttpFetchResponse;
  readonly finalUrl: ParsedWebUrl;
  /** Every URL judged, first to last. */
  readonly chain: readonly string[];
}

const isCount = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;

function responseProblem(response: unknown, maxBytes: number): string | null {
  const row = response as Partial<HttpFetchResponse> | null;
  if (typeof row !== 'object' || row === null) return 'the fetch port answered with something that is not a response';
  if (!isCount(row.status, 100) || row.status > 599) return 'the status is not an HTTP status';
  if (typeof row.headers !== 'object' || row.headers === null) return 'the headers are not a record';
  if (typeof row.body !== 'string') return 'the body is not text';
  if (!isCount(row.bytesRead, 0) || row.bytesRead > maxBytes) return 'the bytes read are not a count within the cap';
  if (typeof row.truncated !== 'boolean') return 'truncated is not a boolean';
  return null;
}

export const headerOf = (headers: Readonly<Record<string, string>>, name: string): string | undefined => {
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
  return key === undefined ? undefined : headers[key];
};

/**
 * Fetch one URL through the guard. Every hop is judged before the port is called for it. The timeout and the byte cap
 * are held to ceilings and are handed to the port, which enforces them; the cap is checked again on what comes back.
 */
export async function fetchGuarded(params: GuardedFetchParams, deps: GuardedFetchDeps): Promise<ResearchResult<GuardedResponse>> {
  const clock = createClockGuard(deps.clock);
  const maxHops = isCount(params.maxHops, 0) ? Math.min(params.maxHops, MAX_HOPS_CEILING) : null;
  const timeoutMs = isCount(params.timeoutMs, 1) ? Math.min(params.timeoutMs, MAX_FETCH_TIMEOUT_MS) : null;
  if (maxHops === null || timeoutMs === null || !isCount(params.maxBytes, 1)) return researchRefused('INVALID_REQUEST', 'the hop cap, the timeout and the byte cap must be whole positive numbers');
  const chain: string[] = [];
  let current: string = params.url;
  for (let hop = 0; hop <= maxHops; hop += 1) {
    if (clock.now() === null) return researchRefused('BAD_CLOCK', 'the clock did not give a usable time');
    const verdict = await judgeUrl(current, deps, params.mode);
    if (!verdict.ok) return researchRefused('URL_REFUSED', `the address was refused: ${verdict.reason}`, { reason: verdict.reason, hop });
    chain.push(verdict.url.canonical);
    let response: HttpFetchResponse;
    try {
      response = await deps.fetch({ url: verdict.url.canonical, pinnedAddresses: verdict.addresses, timeoutMs, maxBytes: params.maxBytes, headers: params.headers });
    } catch {
      return researchRefused('FETCH_FAILED', 'the fetch port failed', { hop });
    }
    const bad = responseProblem(response, params.maxBytes);
    if (bad !== null) return researchRefused('FETCH_FAILED', bad, { hop });
    if (!REDIRECT_STATUSES.includes(response.status)) return researchOk({ response, finalUrl: verdict.url, chain });
    if (hop === maxHops) return researchRefused('TOO_MANY_REDIRECTS', `more than ${maxHops} redirects`, { hop });
    const next = resolveRedirectTarget(verdict.url, headerOf(response.headers, 'location'));
    if (next === null) return researchRefused('FETCH_FAILED', 'a redirect carried no usable Location', { hop });
    current = next;
  }
  return researchRefused('TOO_MANY_REDIRECTS', 'the redirect loop ended without an answer');
}
