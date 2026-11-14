// Origin: original ProjectOS code
/**
 * AN UNCITED RESULT IS REFUSED (PROJECTOS-PORT-SEARCH1A, C8, C10).
 *
 * A citation names the project, the file and the line range. `admitSearchResult` is the only maker of a
 * `CitedSearchHit`, so code holding a hit holds a citation. A refusal carries no text from the result: what
 * could not be cited cannot be used.
 *
 * A CITATION NAMES A FILE INSIDE THE PROJECT. Paths are an allowlist, by segment: letters, marks, numbers, spaces and
 * a few plain punctuation marks. A path is shown to people and written into prompts outside the fence, so `<`, `>`,
 * `=`, quotes, line and paragraph separators, bidi marks and zero-width characters are not citations. Nor is an
 * absolute path, a climb out of the tree or a backslash.
 *
 * THE RESULT IS HELD TO THE SCOPE IT WAS ASKED IN. A result from another project is refused even if it is
 * otherwise perfect, so a later tenant scope has one line to bind and no second route around it.
 *
 * AN ANSWER IS HELD TO WHAT WAS RETRIEVED. `admitCitedAnswer` refuses an answer that cites nothing, and one
 * citing a file or a line range the search did not return, so a citation cannot be made up.
 *
 * A CITATION CARRIES ITS FRESHNESS (PROJECTOS-MEMORY-PROVENANCE1A). An index records the commit it was built at; a hit from an
 * index built before HEAD is marked stale, as a value on the citation, and is still returned and still rendered. A hit made
 * with no freshness has none: it claims nothing, and is never read as fresh. A freshness that is not exactly a known
 * shape is refused (`bad-freshness`), not passed through.
 *
 * WHAT THIS CANNOT PROVE. That the file still says this today: an index is as fresh as its last rebuild, and the mark only
 * says whether HEAD has moved since.
 *
 * Pure. Reads no file and no clock.
 */
import { isProjectId } from '../tenant.js';
import type { HybridSearchResult } from './hybrid.js';

export const SEARCH_SOURCE_KINDS = ['documents', 'sessions', 'memory'] as const;
export type SearchSourceKind = (typeof SEARCH_SOURCE_KINDS)[number];

/**
 * A CITATION IS AS FRESH AS THE INDEX IT CAME FROM (PROJECTOS-MEMORY-PROVENANCE1A, plan 3.3).
 *
 * The search index is derived and records the commit it was built at. A citation from an index built at one commit while
 * HEAD is at another is STALE: the file may say something else now. The mark is a value on the citation, and a stale
 * citation is still returned and still rendered, with the mark, so the reader decides. It is never silently fresh:
 *
 *   fresh                          both commits are known, valid object names, and equal
 *   stale / head-moved             both known, and different
 *   stale / head-unknown           HEAD could not be read (no port, git failed, not a commit name)
 *   stale / built-commit-unknown   the index recorded no valid commit when it was built
 *
 * A commit name is 40 or 64 lower-case hex characters. `HEAD`, a branch, an upper-case spelling and a name with a trailing
 * newline are not names, so two spellings of one commit cannot be taken for it, and neither can an unread value.
 *
 * WHAT THIS CANNOT PROVE. That HEAD is the right commit to compare to (a committed read is the strong check for authority
 * files), that the working tree equals HEAD (an index built from a dirty tree at HEAD reads fresh), and that the file still
 * says this at the cited lines. It marks the one thing it can know: whether HEAD has moved since the index was built.
 */
export const STALE_REASONS = ['head-moved', 'head-unknown', 'built-commit-unknown'] as const;
export type StaleReason = (typeof STALE_REASONS)[number];

export type CitationFreshness = { readonly state: 'fresh' } | { readonly state: 'stale'; readonly reason: StaleReason };

/** A commit name: 40 or 64 lower-case hex characters. Nothing else is one, so two spellings of a commit are not one commit. */
const COMMIT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export const isCommitName = (value: unknown): value is string => typeof value === 'string' && COMMIT_NAME.test(value);

const FRESH: CitationFreshness = Object.freeze({ state: 'fresh' });
const stale = (reason: StaleReason): CitationFreshness => Object.freeze({ state: 'stale', reason });

/** Judge one citation's freshness from the commit its index was built at and the commit HEAD is at now. */
export function citationFreshnessOf(builtAtCommit: unknown, headCommit: unknown): CitationFreshness {
  if (!isCommitName(headCommit)) return stale('head-unknown');
  if (!isCommitName(builtAtCommit)) return stale('built-commit-unknown');
  return builtAtCommit === headCommit ? FRESH : stale('head-moved');
}

/** The own data fields of a plain object, read once: an accessor, a symbol key, a prototype key or a field other than `state` and `reason` yields null. */
function plainFieldsOf(value: unknown): { readonly state?: unknown; readonly reason?: unknown } | null {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const fields: { state?: unknown; reason?: unknown } = {};
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = typeof key === 'string' ? Object.getOwnPropertyDescriptor(value, key) : undefined;
      if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) return null;
      if (key !== 'state' && key !== 'reason') return null;
      fields[key] = descriptor.value;
    }
    return fields;
  } catch {
    return null;
  }
}

/** A freshness value read once into a frozen copy, or null when it is not exactly one of the known shapes. */
export function citationFreshnessOfValue(value: unknown): CitationFreshness | null {
  const fields = plainFieldsOf(value);
  if (fields === null) return null;
  const { state, reason } = fields;
  if (state === 'fresh') return reason === undefined ? FRESH : null;
  return state === 'stale' && typeof reason === 'string' && (STALE_REASONS as readonly string[]).includes(reason) ? stale(reason as StaleReason) : null;
}

/** The text a header shows: `fresh` or `stale:<reason>`. Nothing in it comes from an indexed file. */
export const citationFreshnessMarkOf = (freshness: CitationFreshness): string => (freshness.state === 'fresh' ? 'fresh' : `stale:${freshness.reason}`);

export interface SearchCitation {
  readonly project: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** Set by the index that made the hit. Absent on a hit nobody judged, which is never read as fresh. */
  readonly freshness?: CitationFreshness;
}

/** The only way indexed text leaves a search. Its name says what it is; see `renderUntrustedExcerpt`. */
export interface CitedSearchHit {
  readonly citation: SearchCitation;
  readonly source: SearchSourceKind;
  readonly score: number;
  readonly vectorScore: number;
  readonly textScore: number;
  readonly trust: 'untrusted-data';
  readonly untrustedText: string;
}

export type CitationRefusalReason =
  | 'wrong-project'
  | 'no-project'
  | 'no-path'
  | 'unsafe-path'
  | 'no-line-range'
  | 'unknown-source'
  | 'bad-freshness';

export interface CitationRefusal {
  readonly reason: CitationRefusalReason;
}

export type SearchResultAdmission = { readonly ok: true; readonly hit: CitedSearchHit } | { readonly ok: false; readonly refusal: CitationRefusal };

const CITABLE_SEGMENT = /^[\p{L}\p{M}\p{N} ._()\[\]+,@~#&-]+$/u;

/** Why this path is not a citation, or null. A relative path with `/` separators, inside the project. */
export function citationPathProblem(path: unknown): 'no-path' | 'unsafe-path' | null {
  if (typeof path !== 'string' || path.trim() === '') return 'no-path';
  const segments = path.split('/');
  return segments.every((segment) => CITABLE_SEGMENT.test(segment) && segment.trim() !== '' && segment !== '.' && segment !== '..') ? null : 'unsafe-path';
}

export function lineRangeIsCitable(startLine: unknown, endLine: unknown): boolean {
  return Number.isSafeInteger(startLine) && Number.isSafeInteger(endLine) && (startLine as number) >= 1 && (endLine as number) >= (startLine as number);
}

const isSourceKind = (value: unknown): value is SearchSourceKind => (SEARCH_SOURCE_KINDS as readonly unknown[]).includes(value);

function citationProblem(result: Partial<HybridSearchResult>, scopeProject: string): CitationRefusalReason | null {
  if (!isProjectId(result.project)) return 'no-project';
  if (result.project !== scopeProject) return 'wrong-project';
  const pathProblem = citationPathProblem(result.path);
  if (pathProblem !== null) return pathProblem;
  if (!lineRangeIsCitable(result.startLine, result.endLine)) return 'no-line-range';
  return isSourceKind(result.source) ? null : 'unknown-source';
}

/** The door. Anything that reaches a caller came through here, inside `scopeProject`, with its citation whole. */
export function admitSearchResult(result: Partial<HybridSearchResult>, scopeProject: string, freshness?: unknown): SearchResultAdmission {
  const problem = citationProblem(result, scopeProject);
  if (problem !== null) return { ok: false, refusal: { reason: problem } };
  const judged = freshness === undefined ? undefined : citationFreshnessOfValue(freshness);
  if (judged === null) return { ok: false, refusal: { reason: 'bad-freshness' } };
  return {
    ok: true,
    hit: {
      citation: {
        project: result.project as string,
        path: result.path as string,
        startLine: result.startLine as number,
        endLine: result.endLine as number,
        ...(judged === undefined ? {} : { freshness: judged }),
      },
      source: result.source as SearchSourceKind,
      score: result.score ?? 0,
      vectorScore: result.vectorScore ?? 0,
      textScore: result.textScore ?? 0,
      trust: 'untrusted-data',
      untrustedText: result.snippet ?? '',
    },
  };
}

export interface CitedAnswer {
  readonly text: string;
  readonly citations: readonly SearchCitation[];
}

export type AnswerRefusalReason = 'empty-answer' | 'uncited-answer' | 'citation-not-retrieved';

export type AnswerAdmission = { readonly ok: true; readonly answer: CitedAnswer } | { readonly ok: false; readonly reason: AnswerRefusalReason };

const withinRetrieved = (citation: SearchCitation, hit: CitedSearchHit): boolean =>
  citation.project === hit.citation.project &&
  citation.path === hit.citation.path &&
  lineRangeIsCitable(citation.startLine, citation.endLine) &&
  citation.startLine >= hit.citation.startLine &&
  citation.endLine <= hit.citation.endLine;

/** Every citation must sit inside something the search returned. An answer that cites nothing is not an answer. */
export function admitCitedAnswer(answer: { readonly text?: string; readonly citations?: readonly SearchCitation[] }, hits: readonly CitedSearchHit[]): AnswerAdmission {
  const citations = answer.citations ?? [];
  if (typeof answer.text !== 'string' || answer.text.trim() === '') return { ok: false, reason: 'empty-answer' };
  if (citations.length === 0) return { ok: false, reason: 'uncited-answer' };
  if (!citations.every((citation) => hits.some((hit) => withinRetrieved(citation, hit)))) {
    return { ok: false, reason: 'citation-not-retrieved' };
  }
  return { ok: true, answer: { text: answer.text, citations } };
}
