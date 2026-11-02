// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: agent/context_compressor.py; agent/context_compressor_tail.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python to TypeScript; the tail budget and the backward walk only; tool pairing is judged by call id, so a request that arrived between a call and its result cannot split them; the protected first turns, soft ceiling, anchors and oversized-turn exception were replaced by keeping the latest request verbatim, in compaction.ts; each turn is charged what it costs in its fence
// Modified-By: ProjectOS 2026-11-02: modified for ProjectOS. CHANGED: the walk reads each turn directly, with no cast
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * Where a thread divides: a head that stays, a middle to summarise, and a tail of recent turns that stays.
 *
 * The tail is measured in tokens, walking back from the newest turn. The newest turn always stays,
 * whatever it weighs, because it is the one the agent has not acted on yet. A tool result never crosses
 * the cut away from its call: a provider refuses a thread with an orphaned result, and half of an
 * exchange is worse than none in a summary. Pure.
 */
import { compactionTriggerTokens, type ContextWindow } from './accounting.js';
import { turnCostTokens } from './fence.js';
import type { ContextTurn } from './turn.js';

const TAIL_FLOOR_TOKENS = 10_000;
const TAIL_CAP_TOKENS = 25_000;
const TAIL_WINDOW_SHARE = 0.025;
const TAIL_MAX_TRIGGER_SHARE = 0.5;
const TAIL_MAX_WINDOW_SHARE = 0.2;

/** A small recent window. It may not take more than half the trigger, or a fifth of the whole window. */
export function tailBudgetTokens(window: ContextWindow): number {
  const share = Math.floor(compactionTriggerTokens(window) * TAIL_MAX_TRIGGER_SHARE);
  const floor = Math.min(TAIL_FLOOR_TOKENS, share);
  const scaled = Math.min(TAIL_CAP_TOKENS, share, Math.floor(window.limitTokens * TAIL_WINDOW_SHARE));
  return Math.min(Math.max(floor, scaled), Math.floor(window.limitTokens * TAIL_MAX_WINDOW_SHARE));
}

/** The leading system turns. They stay, and everything after them can be summarised. */
export function headEndOf(turns: readonly ContextTurn[]): number {
  const first = turns.findIndex((turn) => turn.role !== 'system');
  return first < 0 ? turns.length : first;
}

/** The newest user turn, or -1. It is what the agent is working on. */
export function latestRequestIndex(turns: readonly ContextTurn[]): number {
  return turns.map((turn) => turn.role).lastIndexOf('user');
}

/** Pulls the cut back until no result in the tail has lost its call. */
function keepToolPairsWhole(turns: readonly ContextTurn[], cut: number): number {
  const callAt = new Map(turns.flatMap((turn, index) => turn.toolCalls.map((call) => [call.id, index] as const)));
  let start = cut;
  for (let index = turns.length - 1; index >= start; index -= 1) {
    start = Math.min(start, callAt.get(turns[index]?.toolCallId ?? '') ?? start);
  }
  return start;
}

/** Where the tail starts: the newest turns that fit the budget, whole tool exchanges only. */
export function findTailStart(turns: readonly ContextTurn[], headEnd: number, budgetTokens: number): number {
  let used = 0;
  let cut = turns.length;
  for (const [index, turn] of [...turns.entries()].reverse()) {
    if (index < headEnd) break;
    const cost = turnCostTokens(turn);
    if (cut < turns.length && used + cost > budgetTokens) break;
    used += cost;
    cut = index;
  }
  return keepToolPairsWhole(turns, cut);
}
