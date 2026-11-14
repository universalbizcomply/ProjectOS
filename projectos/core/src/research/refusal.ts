// Origin: original ProjectOS code
/**
 * How the research rules say no (PROJECTOS-PORT-RESEARCH1A, C16).
 *
 * Every refusal carries a closed code, so a caller and a test can tell one rule from another without reading prose.
 * A URL refusal also carries a closed reason. A refusal never carries text from a fetched page, a URL's userinfo or a
 * query string: what could not be trusted is not repeated.
 */

export const URL_REFUSAL_REASONS = [
  'invalid-url',
  'not-http-scheme',
  'userinfo-in-url',
  'ambiguous-authority',
  'credential-in-query',
  'blocked-port',
  'invalid-host-name',
  'single-label-host',
  'blocked-host-name',
  'internal-host-name',
  'wildcard-dns-host',
  'metadata-host-name',
  'blocked-address',
  'metadata-address',
  'website-policy',
  'unknown-policy',
  'dns-failed',
  'dns-empty',
  'dns-too-many',
  'dns-unparseable',
  'dns-blocked-address',
  'dns-rebind',
] as const;
export type UrlRefusalReason = (typeof URL_REFUSAL_REASONS)[number];

export const RESEARCH_REFUSAL_CODES = [
  'INVALID_REQUEST',
  'BAD_SCOPE',
  'BAD_CLOCK',
  'DEADLINE',
  'URL_REFUSED',
  'TOO_MANY_REDIRECTS',
  'FETCH_FAILED',
  'FETCH_STATUS',
  'FETCH_TOO_LARGE',
  'CONTENT_TYPE',
  'NO_READABLE_TEXT',
  'THREAT_SCAN',
  'SLOTS_FULL',
  'NOT_CONFIGURED',
  'BUDGET_REQUIRED',
  'NO_GRANT',
  'OVER_BUDGET',
  'SEARCH_FAILED',
  'PLANNER_FAILED',
  'STEP_CAP',
] as const;
export type ResearchRefusalCode = (typeof RESEARCH_REFUSAL_CODES)[number];

export interface ResearchRefusal {
  readonly code: ResearchRefusalCode;
  readonly message: string;
  /** Set when the URL rules said no: the closed reason, and which hop of a redirect chain it was. */
  readonly reason?: UrlRefusalReason;
  readonly hop?: number;
  /** The threat patterns that fired, by id. Never the text. */
  readonly named?: readonly string[];
}

export type ResearchResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: ResearchRefusal };

export interface ResearchRefusalDetail {
  readonly reason?: UrlRefusalReason;
  readonly hop?: number;
  readonly named?: readonly string[];
}

export function researchOk<T>(value: T): ResearchResult<T> {
  return { ok: true, value };
}

export function researchRefused(code: ResearchRefusalCode, message: string, detail: ResearchRefusalDetail = {}): { readonly ok: false; readonly refusal: ResearchRefusal } {
  return {
    ok: false,
    refusal: {
      code,
      message,
      ...(detail.reason === undefined ? {} : { reason: detail.reason }),
      ...(detail.hop === undefined ? {} : { hop: detail.hop }),
      ...(detail.named === undefined ? {} : { named: detail.named }),
    },
  };
}
