// Origin: original ProjectOS code
/**
 * AN UNCITED RESULT IS REFUSED (PROJECTOS-PORT-SEARCH1A, C8, C10).
 *
 * A citation names the project, the file and the line range. `admitSearchResult` is the only maker of a
 * `CitedSearchHit`, so code holding a hit holds a citation. A refusal carries no text from the result: what
 * could not be cited cannot be used.
 *
 * A CITATION NAMES A FILE INSIDE THE PROJECT. An absolute path, a climb out of the tree, a backslash or a
 * control character is not a citation, because the path is shown to people and written into prompts.
 *
 * THE RESULT IS HELD TO THE SCOPE IT WAS ASKED IN. A result from another project is refused even if it is
 * otherwise perfect, so a later tenant scope has one line to bind and no second route around it.
 *
 * AN ANSWER IS HELD TO WHAT WAS RETRIEVED. `admitCitedAnswer` refuses an answer that cites nothing, and one
 * citing a file or a line range the search did not return, so a citation cannot be made up.
 *
 * WHAT THIS CANNOT PROVE. That the file still says this today: an index is as fresh as its last rebuild.
 *
 * Pure. Reads no file and no clock.
 */
import { isProjectId } from '../tenant.js';
import type { HybridSearchResult } from './hybrid.js';

export const SEARCH_SOURCE_KINDS = ['documents', 'sessions', 'memory'] as const;
export type SearchSourceKind = (typeof SEARCH_SOURCE_KINDS)[number];

export interface SearchCitation {
  readonly project: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
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
  | 'unknown-source';

export interface CitationRefusal {
  readonly reason: CitationRefusalReason;
}

export type SearchResultAdmission = { readonly ok: true; readonly hit: CitedSearchHit } | { readonly ok: false; readonly refusal: CitationRefusal };

const CONTROL_CHARACTER = /\p{Cc}/u;
const DRIVE_OR_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** Why this path is not a citation, or null. A relative path with `/` separators, inside the project. */
export function citationPathProblem(path: unknown): 'no-path' | 'unsafe-path' | null {
  if (typeof path !== 'string' || path.trim() === '') return 'no-path';
  if (path.startsWith('/') || path.includes('\\') || DRIVE_OR_SCHEME.test(path) || CONTROL_CHARACTER.test(path)) {
    return 'unsafe-path';
  }
  return path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ? 'unsafe-path' : null;
}

function lineRangeIsCitable(startLine: unknown, endLine: unknown): boolean {
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
export function admitSearchResult(result: Partial<HybridSearchResult>, scopeProject: string): SearchResultAdmission {
  const problem = citationProblem(result, scopeProject);
  if (problem !== null) return { ok: false, refusal: { reason: problem } };
  return {
    ok: true,
    hit: {
      citation: {
        project: result.project as string,
        path: result.path as string,
        startLine: result.startLine as number,
        endLine: result.endLine as number,
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
