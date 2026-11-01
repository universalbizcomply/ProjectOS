// Origin: original ProjectOS code
/**
 * FROM INDEX ROWS TO CITED HITS (PROJECTOS-PORT-SEARCH1A).
 *
 * Every candidate passes `admitSearchResult` BEFORE ranking, not after. A row that cannot be cited must not
 * set the keyword scale, shift a diversity pass or take a slot from a row that can.
 *
 * THE VECTOR SEAM IS `vectorCandidates`. This phase ships keyword search: no embeddings, no provider call and no
 * `sqlite-vec`, because those need a paid provider and an owner decision on the locked stack. A later phase
 * fills the seam by handing candidates in, and they meet the same door: a vector row with no citation, or from
 * another project, is refused like any other.
 *
 * Pure. The caller supplies the rows and the clock.
 */
import {
  admitSearchResult,
  type CitationRefusal,
  type CitedSearchHit,
  type SearchResultAdmission,
  type SearchSourceKind,
} from './citation.js';
import {
  mergeHybridResults,
  selectHybridSearchResults,
  type HybridKeywordResult,
  type HybridVectorResult,
} from './hybrid.js';
import type { MMRConfig } from './mmr.js';
import { sourceTimeKey, type TemporalDecayConfig } from './temporalDecay.js';

export type KeywordCandidate = HybridKeywordResult<SearchSourceKind> & { readonly mtimeMs?: number | null };
export type VectorCandidate = HybridVectorResult<SearchSourceKind> & { readonly mtimeMs?: number | null };

/** Nothing fills the seam yet. This is the name a later phase replaces. */
export const NO_VECTOR_CANDIDATES: readonly VectorCandidate[] = [];

export const DEFAULT_SEARCH_MAX_RESULTS = 10;
export const DEFAULT_SEARCH_MMR: MMRConfig = { enabled: true, lambda: 0.7 };
export const DEFAULT_SEARCH_TEMPORAL_DECAY: TemporalDecayConfig = { enabled: false, halfLifeDays: 30 };
const KEYWORD_ONLY_WEIGHTS = { vectorWeight: 0, textWeight: 1 };
const HYBRID_WEIGHTS = { vectorWeight: 0.7, textWeight: 0.3 };

/** Only rows that know their time speak. Keyword rows come last, because they are the index's own record. */
const recordedTimes = (rows: readonly (KeywordCandidate | VectorCandidate)[]): ReadonlyMap<string, number> =>
  new Map(rows.flatMap((row) => (typeof row.mtimeMs === 'number' ? [[sourceTimeKey(row.source, row.path), row.mtimeMs] as const] : [])));

export interface CitedSearchOutcome {
  readonly hits: readonly CitedSearchHit[];
  readonly refused: readonly CitationRefusal[];
}

export function rankCitedResults(params: {
  readonly project: string;
  readonly keyword: readonly KeywordCandidate[];
  readonly vectorCandidates?: readonly VectorCandidate[];
  readonly maxResults?: number;
  readonly minScore?: number;
  readonly mmr?: MMRConfig;
  readonly temporalDecay?: TemporalDecayConfig;
  readonly nowMs: number;
}): CitedSearchOutcome {
  const judge = <T extends KeywordCandidate | VectorCandidate>(rows: readonly T[]) =>
    rows.map((row) => ({ row, admission: admitSearchResult(row, params.project) }));
  const citable = <T>(judged: readonly { row: T; admission: SearchResultAdmission }[]): T[] =>
    judged.filter(({ admission }) => admission.ok).map(({ row }) => row);
  const judgedKeyword = judge(params.keyword);
  const judgedVector = judge(params.vectorCandidates ?? NO_VECTOR_CANDIDATES);
  const refused = [...judgedKeyword, ...judgedVector].flatMap(({ admission }) => (admission.ok ? [] : [admission.refusal]));
  const keyword = citable(judgedKeyword);
  const vector = citable(judgedVector);

  const merged = mergeHybridResults({
    keyword,
    vector,
    ...(vector.length > 0 ? HYBRID_WEIGHTS : KEYWORD_ONLY_WEIGHTS),
    sourceTimes: recordedTimes([...vector, ...keyword]),
    mmr: params.mmr ?? DEFAULT_SEARCH_MMR,
    temporalDecay: params.temporalDecay ?? DEFAULT_SEARCH_TEMPORAL_DECAY,
    nowMs: params.nowMs,
  });
  const selected = selectHybridSearchResults({
    merged,
    keyword,
    vectorCandidates: vector,
    maxResults: params.maxResults ?? DEFAULT_SEARCH_MAX_RESULTS,
    minScore: params.minScore ?? 0,
  });

  // Each row came through the door above, and this is the same door, so a hit has no second maker.
  const hits = selected.flatMap((result) => {
    const admission = admitSearchResult(result, params.project);
    return admission.ok ? [admission.hit] : [];
  });
  return { hits, refused };
}
