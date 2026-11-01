// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: extensions/memory-core/src/memory/temporal-decay.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: DIRECT
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: all file-system reads removed, so core stays pure and the caller hands in each source's recorded time; extra-path policy cut; synchronous
// Notice: full licence text in THIRD_PARTY_NOTICES

export type TemporalDecayConfig = {
  readonly enabled: boolean;
  readonly halfLifeDays: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DATED_MEMORY_PATH_RE = /(?:^|\/)memory\/(?:[^/]+\/)*(\d{4})-(\d{2})-(\d{2})(?:-[^/]+)?\.md$/;

/** Key into a recorded-time map. The same path under two sources is two sources. */
export const sourceTimeKey = (source: string, path: string): string => `${source}:${path}`;

function applyTemporalDecayToScore(params: { score: number; ageInDays: number; halfLifeDays: number }): number {
  const { halfLifeDays } = params;
  const clampedAge = Math.max(0, params.ageInDays);
  if (!Number.isFinite(clampedAge)) {
    return params.score;
  }
  return params.score * Math.exp(-(Math.LN2 / halfLifeDays) * clampedAge);
}

function extractTimestamp(params: {
  filePath: string;
  source: string;
  sourceTimes?: ReadonlyMap<string, number | undefined> | undefined;
}): Date | null {
  const recorded = (): Date | null => {
    const mtime = params.sourceTimes?.get(sourceTimeKey(params.source, params.filePath));
    return mtime !== undefined && Number.isFinite(mtime) ? new Date(mtime) : null;
  };
  if (params.source === 'sessions') {
    // Session paths are logical identities, not workspace files. Ranking uses the
    // indexed source activity, never a same-named filesystem artifact.
    return recorded();
  }

  const normalized = params.filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  const match = DATED_MEMORY_PATH_RE.exec(normalized);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) {
      return parsed;
    }
  }

  // Memory root/topic files are evergreen knowledge and should not decay.
  if (
    params.source === 'memory' &&
    (normalized === 'MEMORY.md' || normalized === 'USER.md' || (normalized.startsWith('memory/') && !match))
  ) {
    return null;
  }

  return recorded();
}

export function applyTemporalDecayToHybridResults<T extends { path: string; score: number; source: string }>(params: {
  results: readonly T[];
  temporalDecay: TemporalDecayConfig;
  sourceTimes?: ReadonlyMap<string, number | undefined> | undefined;
  nowMs: number;
}): T[] {
  const config = params.temporalDecay;
  if (!config.enabled) {
    return [...params.results];
  }

  return params.results.map((entry) => {
    const timestamp = extractTimestamp({
      filePath: entry.path,
      source: entry.source,
      sourceTimes: params.sourceTimes,
    });
    if (!timestamp) {
      return entry;
    }
    const decayedScore = applyTemporalDecayToScore({
      score: entry.score,
      ageInDays: (params.nowMs - timestamp.getTime()) / DAY_MS,
      halfLifeDays: config.halfLifeDays,
    });
    return { ...entry, score: decayedScore };
  });
}
