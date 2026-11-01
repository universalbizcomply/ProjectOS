// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: extensions/memory-core/src/memory/hybrid.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: DIRECT
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: imports cut to ProjectOS equivalents; project-affinity ranking, exact-path tiers, media handling and LIKE recall cut, because no ProjectOS index produces them; every candidate carries its project; a keyword row's citation wins over a vector row's; synchronous and without mutation
// Notice: full licence text in THIRD_PARTY_NOTICES

import { applyMMRToHybridResults, type MMRConfig } from './mmr.js';
import { applyTemporalDecayToHybridResults, type TemporalDecayConfig } from './temporalDecay.js';

type HybridSource = string;

export type HybridSearchResult<TSource extends HybridSource = HybridSource> = {
  readonly project: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly score: number;
  readonly vectorScore: number;
  readonly textScore: number;
  readonly snippet: string;
  readonly source: TSource;
};

export type RankedHybridResult<TSource extends HybridSource = HybridSource> = HybridSearchResult<TSource> & {
  readonly eligibilityScore: number;
};

export type HybridCandidate<TSource extends HybridSource = HybridSource> = Omit<
  HybridSearchResult<TSource>,
  'score' | 'vectorScore' | 'textScore'
> & {
  readonly id: string;
};

export type HybridVectorResult<TSource extends HybridSource = HybridSource> = HybridCandidate<TSource> & {
  readonly vectorScore: number;
};

export type HybridKeywordResult<TSource extends HybridSource = HybridSource> = HybridCandidate<TSource> & {
  readonly textScore: number;
};

// BM25 keyword scores saturate as relevance / (1 + relevance), and every chunk
// outside the keyword window scores 0, so a fixed text weight mostly rewards
// window membership. Undo the saturation and measure each keyword hit against
// the query's strongest one, which may earn up to the best vector score; no hit
// gains credit. A score of 1 has no finite relevance, so it counts as the strongest.
function createKeywordScoreScale(keywordScores: readonly number[], bestVectorScore: number) {
  if (bestVectorScore === 0) {
    return (score: number) => score;
  }
  const relevance = (score: number) => score / (1 - score);
  const strongest = Math.max(0, ...keywordScores.filter((score) => score < 1).map(relevance));
  return (score: number) => {
    if (score <= 0) {
      return score;
    }
    const share = score >= 1 ? 1 : relevance(score) / strongest;
    return Math.min(score, share * bestVectorScore);
  };
}

export function mergeHybridResults<TSource extends HybridSource>(params: {
  vector: readonly HybridVectorResult<TSource>[];
  keyword: readonly HybridKeywordResult<TSource>[];
  vectorWeight: number;
  textWeight: number;
  /** Each source's recorded time, keyed by `sourceTimeKey`. Core reads no file. */
  sourceTimes?: ReadonlyMap<string, number | undefined>;
  /** MMR configuration for diversity-aware re-ranking */
  mmr: MMRConfig;
  /** Temporal decay configuration for recency-aware scoring */
  temporalDecay: TemporalDecayConfig;
  /** The caller's clock. Core reads no clock. */
  nowMs: number;
}): RankedHybridResult<TSource>[] {
  type Entry = HybridCandidate<TSource> & { vectorScore: number; textScore: number };
  const byId = new Map<string, Entry>(
    params.vector.map((r): [string, Entry] => [r.id, { ...r, vectorScore: r.vectorScore, textScore: 0 }]),
  );
  for (const r of params.keyword) {
    // The keyword row comes from the index, so its citation stands whatever a vector row said.
    byId.set(r.id, { ...r, vectorScore: byId.get(r.id)?.vectorScore ?? 0, textScore: r.textScore });
  }

  const candidates = [...byId.values()];
  const scaleKeywordScore = createKeywordScoreScale(
    candidates.map((entry) => entry.textScore),
    params.vectorWeight > 0 ? Math.max(0, ...candidates.map((entry) => entry.vectorScore)) : 0,
  );
  const merged = candidates.map((entry) => {
    const contentScore = params.vectorWeight * entry.vectorScore + params.textWeight * scaleKeywordScore(entry.textScore);
    return {
      project: entry.project,
      path: entry.path,
      startLine: entry.startLine,
      endLine: entry.endLine,
      score: contentScore,
      vectorScore: entry.vectorScore,
      textScore: entry.textScore,
      snippet: entry.snippet,
      source: entry.source,
      // Eligibility keeps the weighted score, and never ages out.
      eligibilityScore: contentScore,
    };
  });

  const decayed = applyTemporalDecayToHybridResults({
    results: merged,
    temporalDecay: params.temporalDecay,
    sourceTimes: params.sourceTimes,
    nowMs: params.nowMs,
  });
  const sorted = [...decayed].sort(
    (a, b) =>
      b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine || a.endLine - b.endLine,
  );

  // Apply MMR re-ranking if enabled
  return params.mmr.enabled ? applyMMRToHybridResults(sorted, params.mmr.lambda) : sorted;
}

type HybridResultRange<TSource extends HybridSource = HybridSource> = Pick<
  HybridSearchResult<TSource>,
  'source' | 'path' | 'startLine' | 'endLine'
>;

function hybridResultRangeKey(entry: HybridResultRange): string {
  return `${entry.source}:${entry.path}:${entry.startLine}:${entry.endLine}`;
}

const withoutEligibility = <TSource extends HybridSource>({
  eligibilityScore: _eligibilityScore,
  ...entry
}: RankedHybridResult<TSource>): HybridSearchResult<TSource> => entry;

export function selectHybridSearchResults<TSource extends HybridSource>(params: {
  merged: readonly RankedHybridResult<TSource>[];
  keyword: readonly HybridResultRange<TSource>[];
  vectorCandidates: readonly HybridResultRange<TSource>[];
  maxResults: number;
  minScore: number;
}): HybridSearchResult<TSource>[] {
  const strict = params.merged.filter((entry) => entry.eligibilityScore >= params.minScore);
  const selected = strict.slice(0, params.maxResults);
  if (params.keyword.length === 0 || selected.length === params.maxResults) {
    return selected.map(withoutEligibility);
  }

  const keywordKeys = new Set(params.keyword.map((entry) => hybridResultRangeKey(entry)));
  const isLexicalCandidate = (entry: RankedHybridResult<TSource>) =>
    entry.eligibilityScore >= 0 && keywordKeys.has(hybridResultRangeKey(entry));
  if (strict.length === 0) {
    // Preserve the established all-lexical fallback when every weighted score
    // is below the configured threshold.
    return params.merged.filter(isLexicalCandidate).slice(0, params.maxResults).map(withoutEligibility);
  }

  // Score completion does not turn a keyword-only candidate into a vector
  // candidate. Preserve its spare-capacity eligibility after enrichment.
  const vectorKeys = new Set(params.vectorCandidates.map(hybridResultRangeKey));
  const seen = new Set(selected.map((entry) => hybridResultRangeKey(entry)));
  const spare = params.merged.filter((entry) => {
    const key = hybridResultRangeKey(entry);
    return (
      entry.eligibilityScore < params.minScore &&
      (entry.vectorScore === 0 || !vectorKeys.has(key)) &&
      isLexicalCandidate(entry) &&
      !seen.has(key)
    );
  });
  return [...selected, ...spare].slice(0, params.maxResults).map(withoutEligibility);
}
