// Origin: original ProjectOS code
/**
 * Fetch one page for research (PROJECTOS-PORT-RESEARCH1A, C16).
 *
 * Everything a page must survive, in this order, and the first to fail is the refusal:
 *   1. the scope is a tenant and a project (never taken from the page or the model);
 *   2. the URL passes the static SSRF rules and the website policy, before the cache is read, so a page cached under
 *      an older, looser policy is not served;
 *   3. the cache, for this scope only;
 *   4. a fetch slot for this scope, released on every path out (success, refusal or throw);
 *   5. the guarded fetch: every hop judged, the port dialling only the addresses judged;
 *   6. a 2xx status, a content type on the list, and the size cap checked BEFORE anything is parsed;
 *   7. readable text, cut to a cap, sanitized (special tokens and spoofed boundaries) and then threat-scanned: a hit
 *      is refused here, so the text never reaches a prompt;
 *   8. a hash of exactly what a prompt would be shown.
 *
 * A page that survives is DATA with a citation path. Nothing in it is read for anything but display, and the only way
 * it reaches a prompt is `renderResearchEvidence` (`evidence.ts`).
 *
 * WHAT THIS CANNOT PROVE. That the threat scan found everything: a clean scan means no listed pattern matched. The page
 * is fenced as untrusted after it passes, and what protects ProjectOS is that a model's output reaches nothing
 * without the kernel's gates.
 */

import { sha256Hex } from '../execution/evidence.js';
import { scanForThreats } from '../memory/threatScan.js';
import { truncateUtf16Safe } from '../search/textBudget.js';
import { extractReadableContent, type WebContentExtractor } from './extractors.js';
import { detectSuspiciousPatterns, sanitizeExternalContentText } from './externalContent.js';
import { isResearchScope, type FetchSlots, type PageCache } from './pageCache.js';
import { createClockGuard, type ResearchScope } from './ports.js';
import { stripInvisibleUnicode } from './readableText.js';
import { researchOk, researchRefused, type ResearchResult } from './refusal.js';
import { fetchGuarded, headerOf, judgeUrlStatic, DEFAULT_MAX_HOPS, type GuardedFetchDeps } from './ssrfGuard.js';
import type { ParsedWebUrl } from './urlParse.js';

export const MAX_PAGE_BYTES = 1_000_000;
export const MAX_PAGE_TEXT_CHARS = 50_000;
export const PAGE_TIMEOUT_MS = 15_000;
const HTML_TYPES: readonly string[] = ['text/html', 'application/xhtml+xml'];
const TEXT_TYPES: readonly string[] = ['text/plain', 'text/markdown'];
const PAGE_HEADERS: Readonly<Record<string, string>> = { accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,text/markdown;q=0.8' };

export interface FetchedPage {
  readonly scope: ResearchScope;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  /** The path a citation names: `web/<host>/<16 hex of the final URL>`. It satisfies the search module's path rules. */
  readonly sourcePath: string;
  readonly title?: string;
  /** Sanitized, scanned, and exactly what a prompt is shown. Cut at the cap. */
  readonly text: string;
  readonly lineCount: number;
  readonly contentSha256: string;
  readonly fetchedAtMs: number;
  readonly truncated: boolean;
  /** Patterns that look like instructions. A flag for a reader, never a pass or a fail. */
  readonly suspicious: readonly string[];
  readonly policyDigest: string;
  readonly extractor: string;
}

export interface FetchPageDeps extends GuardedFetchDeps {
  readonly extractors: readonly WebContentExtractor[];
  readonly cache: PageCache | null;
  readonly slots: FetchSlots | null;
}

export interface FetchPageOutcome {
  readonly page: FetchedPage;
  readonly cached: boolean;
}

const mediaTypeOf = (headers: Readonly<Record<string, string>>): string | null => {
  const raw = headerOf(headers, 'content-type');
  return typeof raw === 'string' ? (raw.split(';')[0] as string).trim().toLowerCase() : null;
};

export function sourcePathOf(url: ParsedWebUrl): string {
  return `web/${url.host}/${sha256Hex(url.canonical).slice(0, 16)}`;
}

const lineCountOf = (text: string): number => text.split('\n').length;

async function pageFrom(request: { readonly scope: ResearchScope; readonly url: string }, deps: FetchPageDeps, fetchedAtMs: number, policyDigest: string): Promise<ResearchResult<FetchedPage>> {
  const fetched = await fetchGuarded(
    { url: request.url, mode: 'public', maxHops: DEFAULT_MAX_HOPS, maxBytes: MAX_PAGE_BYTES, timeoutMs: PAGE_TIMEOUT_MS, headers: PAGE_HEADERS },
    deps,
  );
  if (!fetched.ok) return fetched;
  const { response, finalUrl } = fetched.value;
  if (response.status < 200 || response.status > 299) return researchRefused('FETCH_STATUS', `the page answered with status ${response.status}`);
  // The size cap is judged before any parsing: a body the port cut, or one longer than the cap, is not read.
  if (response.truncated || response.body.length > MAX_PAGE_BYTES) return researchRefused('FETCH_TOO_LARGE', `the page is longer than ${MAX_PAGE_BYTES} bytes`);
  const media = mediaTypeOf(response.headers);
  const isHtml = media !== null && HTML_TYPES.includes(media);
  if (!isHtml && !(media !== null && TEXT_TYPES.includes(media))) return researchRefused('CONTENT_TYPE', 'the page is not HTML or plain text');
  let readable: { readonly text: string; readonly title?: string; readonly extractor: string } | null;
  if (isHtml) {
    readable = (await extractReadableContent(deps.extractors, { html: response.body, url: finalUrl.canonical })).content;
  } else {
    readable = { text: stripInvisibleUnicode(response.body).trim(), extractor: 'plain-text' };
  }
  if (readable === null || readable.text.trim() === '') return researchRefused('NO_READABLE_TEXT', 'no readable text was found on the page');
  const cut = truncateUtf16Safe(readable.text, MAX_PAGE_TEXT_CHARS);
  const text = sanitizeExternalContentText(cut);
  const title = readable.title === undefined ? undefined : sanitizeExternalContentText(readable.title);
  // A hit is refused here, before the text can reach a prompt. Past the scan's limit is a refusal too, never a pass.
  const found = scanForThreats(title === undefined ? text : `${title}\n${text}`, 'context');
  if (found.length > 0) return researchRefused('THREAT_SCAN', 'the page matched the threat scan and is not used', { named: found });
  return researchOk({
    scope: request.scope,
    requestedUrl: request.url,
    finalUrl: finalUrl.canonical,
    sourcePath: sourcePathOf(finalUrl),
    ...(title === undefined || title === '' ? {} : { title }),
    text,
    lineCount: lineCountOf(text),
    contentSha256: sha256Hex(text),
    fetchedAtMs,
    truncated: cut.length < readable.text.length,
    suspicious: detectSuspiciousPatterns(text),
    policyDigest,
    extractor: readable.extractor,
  });
}

/** Fetch, extract, sanitize and scan one page for one scope. */
export async function fetchPage(request: { readonly scope: ResearchScope; readonly url: unknown }, deps: FetchPageDeps): Promise<ResearchResult<FetchPageOutcome>> {
  if (!isResearchScope(request.scope)) return researchRefused('BAD_SCOPE', 'a research request needs a tenant and a project');
  const clock = createClockGuard(deps.clock);
  const fetchedAtMs = clock.now();
  if (fetchedAtMs === null) return researchRefused('BAD_CLOCK', 'the clock did not give a usable time');
  const stat = judgeUrlStatic(request.url, deps.policy, 'public');
  if (!stat.ok) return researchRefused('URL_REFUSED', `the address was refused: ${stat.reason}`, { reason: stat.reason, hop: 0 });
  const key = stat.url.canonical;
  const held = deps.cache?.get(request.scope, key, deps.policy.digest, fetchedAtMs) ?? null;
  if (held !== null) return researchOk({ page: held, cached: true });
  const release = deps.slots === null ? (): void => undefined : deps.slots.acquire(request.scope);
  if (release === null) return researchRefused('SLOTS_FULL', 'this project has the most fetches in flight it may have');
  try {
    const made = await pageFrom({ scope: request.scope, url: key }, deps, fetchedAtMs, deps.policy.digest);
    if (!made.ok) return made;
    deps.cache?.put(request.scope, key, made.value, fetchedAtMs);
    return researchOk({ page: made.value, cached: false });
  } finally {
    release();
  }
}
