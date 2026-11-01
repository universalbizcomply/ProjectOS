// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/memory_tool_store.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python to TypeScript; the entry rules kept and separated from all I/O; the free write, batch, consolidation and patch paths not ported
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The capped, §-delimited store, as pure rules over a list of entries.
 *
 * The caps count characters, not bytes, and not model tokens. JavaScript's `length` counts UTF-16 units,
 * so one emoji would cost two here and one upstream; `memoryCharCount` counts code points, which is what
 * the upstream caps mean.
 *
 * WHAT IS NOT HERE, ON PURPOSE: any way to write. These functions take entries and return entries. What
 * lands in a store is decided in `proposal.ts`, by an approved proposal, and nowhere else.
 */
import { createHash } from 'node:crypto';

export const MEMORY_TARGETS = ['memory', 'user'] as const;
export type MemoryTarget = (typeof MEMORY_TARGETS)[number];

export const MEMORY_CHAR_LIMIT = 2200;
export const USER_CHAR_LIMIT = 1375;

export const ENTRY_DELIMITER = '\n§\n';
/** Stands for whatever is added next. A control character, so no real entry can equal it. */
const NEXT_ENTRY = '\u0000next';

export function memoryCharLimit(target: MemoryTarget): number {
  return target === 'user' ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
}

export function memoryCharCount(text: string): number {
  return [...text].length;
}

/** One line ending, as a store holds them. */
export function foldMemoryLines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function joinMemoryEntries(entries: readonly string[]): string {
  return entries.join(ENTRY_DELIMITER);
}

/** Characters the store would hold, delimiters included. */
export function memoryStoreChars(entries: readonly string[]): number {
  return memoryCharCount(joinMemoryEntries(entries));
}

/**
 * Stripped, non-empty, de-duplicated entries, first occurrence wins.
 *
 * It splits on the FULL delimiter, so a bare `§` in an entry survives. Windows line endings are folded
 * first, as Python's text mode does on read: otherwise a file touched by `core.autocrlf` would parse as
 * one long entry. `trim` also removes a leading byte-order mark, which JavaScript counts as whitespace.
 */
export function parseMemoryEntries(raw: string): readonly string[] {
  return [...new Set(foldMemoryLines(raw).split(ENTRY_DELIMITER).map((entry) => entry.trim()))].filter((entry) => entry !== '');
}

/**
 * Whether these entries survive being written and read back unchanged.
 *
 * ONE ENTRY MUST STAY ONE ENTRY. Upstream accepts a text that contains the delimiter, so a single
 * approved entry would come back as two, and the second would have no approval of its own.
 *
 * THE LAST ENTRY IS JUDGED AS IF ANOTHER FOLLOWS. An entry ending in a bare `§` line joins the next
 * delimiter and splits there, so it reads back fine while it is last and breaks the store on the next
 * add, after which every write would be refused. The sentinel makes that visible when it is proposed.
 */
export function memoryEntriesRoundTrip(entries: readonly string[]): boolean {
  const back = parseMemoryEntries(joinMemoryEntries([...entries, NEXT_ENTRY]));
  return back.length === entries.length + 1 && entries.every((entry, index) => entry === back[index]);
}

/** The pin: what an approval is bound to. */
export function memoryEntryHash(entry: string): string {
  return `sha256:${createHash('sha256').update(entry, 'utf8').digest('hex')}`;
}

const SINGLE_QUOTE_LIKE = /["`‘’‚‛“”„‟]/g;
const HYPHEN_LIKE = /[‐‑‒–—―−]/g;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;

/** Quote, dash and whitespace folded, so a model that retypes an entry can still name it. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/\\n/g, ' ')
    .replace(SINGLE_QUOTE_LIKE, "'")
    .replace(HYPHEN_LIKE, '-')
    .split(/\s+/)
    .filter((part) => part !== '')
    .join(' ');
}

function substringMatches(entries: readonly string[], oldText: string): readonly number[] {
  const indices = (keep: (entry: string) => boolean): readonly number[] =>
    entries.flatMap((entry, index) => (keep(entry) ? [index] : []));
  const exact = indices((entry) => entry.includes(oldText));
  if (exact.length > 0) return exact;
  const needle = normalizeForMatch(oldText);
  // Punctuation or space alone would select a whole entry.
  if (!ALPHANUMERIC.test(needle)) return [];
  return indices((entry) => normalizeForMatch(entry).includes(needle));
}

export type MemoryEntryMatch =
  | { readonly kind: 'found'; readonly index: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly count: number };

/**
 * The one entry `oldText` selects.
 *
 * A whole-entry match wins over a substring, so a short entry stays addressable when its text sits
 * inside a longer one. Matches that are the same text are one entry; distinct matches are ambiguous.
 */
export function findMemoryEntry(entries: readonly string[], oldText: string): MemoryEntryMatch {
  const whole = entries.flatMap((entry, index) => (entry === oldText ? [index] : []));
  const matches = whole.length > 0 ? whole : substringMatches(entries, oldText);
  const distinct = new Set(matches.map((index) => entries[index]));
  if (distinct.size > 1) return { kind: 'ambiguous', count: distinct.size };
  const first = matches[0];
  return first === undefined ? { kind: 'none' } : { kind: 'found', index: first };
}
