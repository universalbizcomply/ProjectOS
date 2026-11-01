// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: extensions/memory-core/src/memory/mmr.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: DIRECT
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: the config type stated here in place of its plugin-sdk import; toSorted replaced for the ES2022 target
// Notice: full licence text in THIRD_PARTY_NOTICES

import { prepareSimilarityText, preparedTextSimilarity, type PreparedSimilarityText } from './tokenize.js';

// Carbonell & Goldstein (1998): maximize λ * relevance - (1-λ) * similarity.

type MMRItem = {
  score: number;
  snippet: string;
};

export type MMRConfig = {
  readonly enabled: boolean;
  readonly lambda: number;
};

type PreparedMMRItem<T extends MMRItem> = {
  item: T;
  score: number;
  text: PreparedSimilarityText;
  relevance: number;
  maxSimilarity: number;
};

export function applyMMRToHybridResults<T extends MMRItem>(items: readonly T[], lambda: number): T[] {
  if (items.length <= 1) {
    return [...items];
  }
  if (lambda === 1) {
    return [...items].sort((a, b) => b.score - a.score);
  }
  const prepared: PreparedMMRItem<T>[] = items.map((item) => ({
    item,
    score: item.score,
    text: prepareSimilarityText(item.snippet),
    relevance: 0,
    maxSimilarity: 0,
  }));
  const maxScore = Math.max(...prepared.map((item) => item.score));
  const minScore = Math.min(...prepared.map((item) => item.score));
  const scoreRange = maxScore - minScore;
  for (const item of prepared) {
    item.relevance = scoreRange === 0 ? 1 : (item.score - minScore) / scoreRange;
  }
  const remaining = new Set(prepared);
  const selected: T[] = [];
  while (remaining.size > 0) {
    let bestItem: PreparedMMRItem<T> | null = null;
    let bestMMRScore = -Infinity;
    for (const candidate of remaining) {
      const mmrScore = lambda * candidate.relevance - (1 - lambda) * candidate.maxSimilarity;
      if (
        mmrScore > bestMMRScore ||
        (mmrScore === bestMMRScore && candidate.score > (bestItem?.score ?? -Infinity))
      ) {
        bestMMRScore = mmrScore;
        bestItem = candidate;
      }
    }
    if (!bestItem) {
      break;
    }
    selected.push(bestItem.item);
    remaining.delete(bestItem);
    // A selected item's contribution never changes, so update each candidate's
    // running maximum once per pair instead of rescanning selected items.
    for (const candidate of remaining) {
      const similarity = preparedTextSimilarity(candidate.text, bestItem.text);
      if (similarity > candidate.maxSimilarity) {
        candidate.maxSimilarity = similarity;
      }
    }
  }
  return selected;
}
