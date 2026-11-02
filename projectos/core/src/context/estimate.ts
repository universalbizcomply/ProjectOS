// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: agent/model_metadata.py; agent/context_compressor.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python to TypeScript; the rough text count and the per-message overhead only, without the image pricing, the provider replay fields or the cache
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * A rough count of what a text will cost, made before any provider has counted it.
 *
 * Dense scripts cost about a token a character. Everything else costs a quarter of its UTF-8 bytes,
 * rounded up, so a short text is never free. Counting bytes and not characters is what keeps Cyrillic,
 * Greek and Arabic honest: at a quarter of the characters they read at half their real cost, and a thread
 * rides the provider's limit below its trigger. Pure.
 *
 * This is an estimate, and the provider's reading is the measure. The accounts take whichever is larger.
 */

export const CHARS_PER_TOKEN = 4;
/** What a turn costs for its role and keys, whatever it holds. */
export const TURN_OVERHEAD_TOKENS = 10;

/** Hangul, CJK, Kana and full-width forms, all in the basic plane, so one match is one UTF-16 unit. */
const TOKEN_DENSE = /[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/gu;
const UTF8 = new TextEncoder();

export function estimateTextTokens(text: string): number {
  const rest = text.replace(TOKEN_DENSE, '');
  const dense = text.length - rest.length;
  return dense + Math.ceil(UTF8.encode(rest).length / CHARS_PER_TOKEN);
}

/** What the count needs of a turn. */
export interface EstimableTurn {
  readonly text: string;
  readonly toolCalls: readonly { readonly id: string; readonly name: string; readonly args: string }[];
}

/**
 * One turn, with the whole of each tool call. Upstream found that counting only the arguments under-counted
 * a turn of parallel calls by two to fifteen times.
 */
export function estimateTurnTokens(turn: EstimableTurn): number {
  const calls = turn.toolCalls.reduce((sum, call) => sum + estimateTextTokens(`${call.id}${call.name}${call.args}`), 0);
  return estimateTextTokens(turn.text) + TURN_OVERHEAD_TOKENS + calls;
}
