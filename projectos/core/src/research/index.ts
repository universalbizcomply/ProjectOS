// Origin: original ProjectOS code
/**
 * Cited research, pure (PROJECTOS-PORT-RESEARCH1A, C16). Ported files carry their own credit, and `THIRD_PARTY_NOTICES`
 * holds the licences. No file here opens a socket, resolves a name, reads a file or reads a clock: time, DNS and HTTP
 * are injected ports. Nothing outside this module imports it except the core barrel's one export line.
 */
export * from './refusal.js';
export { createClockGuard, type ClockGuard, type HttpFetchPort, type HttpFetchRequest, type HttpFetchResponse, type ResearchClock, type ResearchScope, type ResolverPort, type TimedResult, type TimerPort } from './ports.js';
export { DEFAULT_TIMEOUTS, callWithin, timeoutOf, type ResearchTimeouts, type Timed } from './timing.js';
export { classifyAddress, normalizeAddress, parseIpv4, parseIpv6, type AddressClass, type AddressReason } from './addressClass.js';
export { hostNameProblem, isMetadataName, normalizeHostName, type HostNameReason } from './hostNames.js';
export { MAX_URL_CHARS, parseWebUrl, resolveRedirectTarget, type ParsedWebUrl, type UrlParse } from './urlParse.js';
export { MAX_WEBSITE_RULES, createWebsitePolicy, judgeWebsite, type WebsiteDecision, type WebsiteMode, type WebsitePolicy, type WebsitePolicyResult, type WebsiteRule } from './websitePolicy.js';
export {
  DEFAULT_MAX_HOPS,
  FETCH_GRACE_MS,
  MAX_FETCH_TIMEOUT_MS,
  MAX_HOPS_CEILING,
  MAX_PINNED_ADDRESSES,
  MAX_RESOLVED_ADDRESSES,
  PAGE_PORTS,
  fetchGuarded,
  headerOf,
  judgeUrl,
  judgeUrlStatic,
  type GuardMode,
  type GuardedFetchDeps,
  type GuardedFetchParams,
  type GuardedResponse,
  type UrlVerdict,
} from './ssrfGuard.js';
export {
  EXTERNAL_CONTENT_WARNING,
  detectSuspiciousPatterns,
  neutralizeMarkers,
  sanitizeExternalContentText,
  sanitizeModelSpecialTokens,
  wrapExternalContent,
  type ExternalContentSource,
  type WrapExternalContentOptions,
} from './externalContent.js';
export { READABILITY_MAX_ESTIMATED_NESTING_DEPTH, READABILITY_MAX_HTML_CHARS, WORK_FACTOR, createFinder, exceedsEstimatedHtmlNestingDepth, extractReadableText, stripInvisibleUnicode, type Finder, type ReadableContent } from './readableText.js';
export { MAX_EXTRACTED_CHARS, READABLE_TEXT_EXTRACTOR, extractReadableContent, type ExtractionOutcome, type WebContentExtractor } from './extractors.js';
export { DEFAULT_PAGE_CACHE, createFetchSlots, createPageCache, isResearchScope, scopeKeyOf, type FetchSlots, type PageCache, type PageCacheOptions } from './pageCache.js';
export { MAX_PAGE_BYTES, MAX_PAGE_TEXT_CHARS, PAGE_TIMEOUT_MS, fetchPage, sourcePathOf, type FetchPageDeps, type FetchPageOutcome, type FetchedPage } from './webFetch.js';
export { hitOfPage, renderResearchEvidence, renderSearchResults } from './evidence.js';
export { screenSearchResults, type DropReason, type DroppedResult, type ScreenedResults } from './resultScreen.js';
export { LINK_REMOVED, filterAnswerText, type FilteredAnswer } from './answerFilter.js';
export { MAX_FETCH_URL_CHARS, MAX_HOSTS_PER_RUN, canonicalOf, listedUrlsOf, urlProvenanceProblem } from './urlProvenance.js';
export { MAX_RUN_BUDGET_MICRO_USD, createSpendBook, reservePaidQuery, type SpendBook, type SpendGrant, type SpendRequest } from './searchBudget.js';
export {
  DEFAULT_SEARCH_COUNT,
  MAX_QUERY_CHARS,
  MAX_SEARCH_COUNT,
  PROVIDER_ID,
  SearchProviderError,
  countOf,
  priceOf,
  queryProblem,
  resultsOf,
  type ProviderQuery,
  type SearchFailureKind,
  type SearchResult,
  type WebSearchProvider,
} from './searchProvider.js';
export { runWebSearch, type WebSearchDeps, type WebSearchOutcome, type WebSearchRequest } from './searchRuntime.js';
export { SEARXNG_MAX_RESPONSE_BYTES, SEARXNG_TIMEOUT_MS, createSearxngProvider, type SearxngConfig } from './searxng.js';
export { BRAVE_BASE_URL, BRAVE_SEARCH_PATH, createBraveProvider, type BraveConfig } from './brave.js';
export {
  DEFAULT_MAX_STEPS,
  MAX_ANSWER_CHARS,
  MAX_CITATIONS,
  MAX_SOURCES,
  MAX_STEPS_CEILING,
  runResearch,
  type CitedSource,
  type PlannerPort,
  type PlannerView,
  type AuditEntry,
  type PlannerPrice,
  type ResearchDeps,
  type ResearchOutcome,
  type ResearchRequest,
  type ResearchRun,
} from './researchLoop.js';
