// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: agent/skill_utils.py; tools/skill_manager_tool.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python to TypeScript; the YAML library replaced by a small closed subset read line by line, because the locked stack has no YAML parser and aliases, tags and merge keys have no place in exchanged text; the fallback that split malformed text on colons removed, so malformed text is refused; duplicate keys refused; every value stays a string; an unclosed or absent block refused rather than read as body
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The frontmatter of a SKILL.md, the exchange format.
 *
 * Text that was malformed upstream fell back to splitting on colons, so a reviewer and a loader could read
 * one file two ways. Here there is one reading, and anything outside it is refused by a named rule.
 *
 * THE SUBSET. Mappings by two-space-or-more indent to a fixed depth, scalars plain or quoted, `[a, b]` and
 * `- a` lists of scalars, and `|` and `>` block text. Everything is a string: `version: 1.10` stays 1.10, and
 * `no` stays no. Anchors, aliases, tags, merge keys, flow maps and comments are refused, not ignored: the
 * first four can multiply text a reviewer never sees, and a comment is text no parsed view shows. Double
 * quotes know `\\`, `\"`, `\n` and `\t` and refuse every other escape, because `\e` or `\u001b` would put a
 * hidden character past the hidden-text rule, which reads the raw file.
 *
 * LINEAR ON HOSTILE INPUT. Each line is visited once and no regular expression here can backtrack over more
 * than one line's indent. Depth is capped, so recursion cannot be walked off the stack.
 *
 * WINDOWS. A leading byte-order mark and CRLF line endings are folded by `foldSkillLines` before this runs.
 * A lone carriage return is not folded: it rewrites a terminal line, and the hidden-text rule refuses it.
 */
import { foldSkillLines } from './hiddenText.js';

export const MAX_FRONTMATTER_CHARS = 8_192;
export const MAX_FRONTMATTER_DEPTH = 4;

export const FRONTMATTER_RULES = [
  'frontmatter-missing',
  'frontmatter-unclosed',
  'frontmatter-too-long',
  'frontmatter-syntax',
  'frontmatter-unsupported',
  'frontmatter-duplicate-key',
  'frontmatter-too-deep',
  'frontmatter-comment',
] as const;
export type FrontmatterRule = (typeof FRONTMATTER_RULES)[number];

export type FrontmatterValue = string | readonly string[] | FrontmatterMap;
export type FrontmatterMap = ReadonlyMap<string, FrontmatterValue>;

export interface ParsedSkillMd {
  readonly frontmatter: FrontmatterMap;
  readonly body: string;
  /** The 1-indexed line of the file the body starts on. */
  readonly bodyLine: number;
}

export type FrontmatterResult =
  | { readonly ok: true; readonly value: ParsedSkillMd }
  | { readonly ok: false; readonly rule: FrontmatterRule; readonly line: number };

type Failure = { readonly ok: false; readonly rule: FrontmatterRule; readonly line: number };
type Parsed<T> = { readonly ok: true; readonly value: T; readonly next: number } | Failure;

const fail = (rule: FrontmatterRule, line: number): Failure => ({ ok: false, rule, line });
/** A value that took one line says where the next one starts. */
const continueAt = <T>(parsed: Parsed<T>, next: number): Parsed<T> => (parsed.ok ? { ...parsed, next } : parsed);
const isFence = (line: string | undefined): boolean => line !== undefined && line.startsWith('---') && line.slice(3).trim() === '';
const KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** A value opening with one of these means something in YAML this subset does not read. */
const UNSUPPORTED_OPENERS = new Set(['{', '&', '*', '!', '%', '@', '`', '?']);
const BLOCK_SCALAR = /^[|>]-?$/;
const BLOCK_SCALAR_LOOKALIKE = /^[|>][-+0-9]/;
const DOUBLE_QUOTE_ESCAPES: Readonly<Record<string, string>> = { '\\': '\\', '"': '"', n: '\n', t: '\t' };

function indentOf(line: string): number {
  let index = 0;
  while (line[index] === ' ') index += 1;
  return index;
}

function nextContent(lines: readonly string[], from: number): number {
  let index = from;
  while (index < lines.length && (lines[index] ?? '').trim() === '') index += 1;
  return index;
}

function doubleQuoted(raw: string, line: number): Parsed<string> {
  const out: string[] = [];
  for (let index = 1; index < raw.length; index += 1) {
    const character = raw[index] as string;
    if (character === '"') {
      return index === raw.length - 1 ? { ok: true, value: out.join(''), next: 0 } : fail('frontmatter-syntax', line);
    }
    if (character !== '\\') {
      out.push(character);
      continue;
    }
    index += 1;
    const decoded = DOUBLE_QUOTE_ESCAPES[raw[index] ?? ''];
    if (decoded === undefined) return fail('frontmatter-unsupported', line);
    out.push(decoded);
  }
  return fail('frontmatter-syntax', line);
}

function singleQuoted(raw: string, line: number): Parsed<string> {
  const out: string[] = [];
  for (let index = 1; index < raw.length; index += 1) {
    const character = raw[index] as string;
    if (character !== "'") {
      out.push(character);
      continue;
    }
    if (raw[index + 1] === "'") {
      out.push("'");
      index += 1;
      continue;
    }
    return index === raw.length - 1 ? { ok: true, value: out.join(''), next: 0 } : fail('frontmatter-syntax', line);
  }
  return fail('frontmatter-syntax', line);
}

function scalar(raw: string, line: number): Parsed<string> {
  const first = raw[0] ?? '';
  if (first === '"') return doubleQuoted(raw, line);
  if (first === "'") return singleQuoted(raw, line);
  if (UNSUPPORTED_OPENERS.has(first) || BLOCK_SCALAR_LOOKALIKE.test(raw) || raw === '|' || raw === '>') return fail('frontmatter-unsupported', line);
  if (first === '[' || first === ']') return fail('frontmatter-unsupported', line);
  return { ok: true, value: raw, next: 0 };
}

/** The items of `[a, 'b, c', "d"]`, read one character at a time. Nothing nests. */
function inlineList(raw: string, line: number): Parsed<readonly string[]> {
  if (!raw.endsWith(']')) return fail('frontmatter-syntax', line);
  const inner = raw.slice(1, -1);
  const items: string[] = [];
  let start = 0;
  let quote = '';
  for (let index = 0; index <= inner.length; index += 1) {
    const character = inner[index];
    if (quote !== '') {
      if (character === '\\' && quote === '"') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[' || character === ']') return fail('frontmatter-unsupported', line);
    if (character !== ',' && character !== undefined) continue;
    const item = inner.slice(start, index).trim();
    start = index + 1;
    if (item === '' && character === undefined && items.length === 0) continue;
    if (item === '') return fail('frontmatter-syntax', line);
    const value = scalar(item, line);
    if (!value.ok) return value;
    items.push(value.value);
  }
  return quote === '' ? { ok: true, value: items, next: 0 } : fail('frontmatter-syntax', line);
}

function blockList(lines: readonly string[], from: number, indent: number, firstLine: number): Parsed<readonly string[]> {
  const items: string[] = [];
  let index = from;
  while (index < lines.length) {
    const text = lines[index] ?? '';
    if (text.trim() === '') {
      index += 1;
      continue;
    }
    const at = indentOf(text);
    if (at < indent) break;
    if (at > indent) return fail('frontmatter-syntax', firstLine + index);
    const rest = text.slice(at);
    if (!rest.startsWith('- ')) {
      if (rest.startsWith('#')) return fail('frontmatter-comment', firstLine + index);
      break;
    }
    const item = rest.slice(2).trim();
    if (item.startsWith('- ') || /^[A-Za-z][A-Za-z0-9_-]*:(?:\s|$)/.test(item)) return fail('frontmatter-unsupported', firstLine + index);
    const value = scalar(item, firstLine + index);
    if (!value.ok) return value;
    items.push(value.value);
    index += 1;
  }
  return { ok: true, value: items, next: index };
}

function blockScalar(lines: readonly string[], from: number, indent: number, style: string): Parsed<string> {
  const kept: string[] = [];
  let index = from;
  for (; index < lines.length; index += 1) {
    const text = lines[index] ?? '';
    if (text.trim() !== '' && indentOf(text) <= indent) break;
    kept.push(text.trim());
  }
  while (kept[kept.length - 1] === '') kept.pop();
  return { ok: true, value: kept.join(style.startsWith('|') ? '\n' : ' '), next: index };
}

function nested(lines: readonly string[], from: number, indent: number, depth: number, firstLine: number): Parsed<FrontmatterValue> {
  const at = nextContent(lines, from);
  const text = lines[at];
  if (text === undefined) return { ok: true, value: '', next: at };
  const inner = indentOf(text);
  const opensList = text.slice(inner).startsWith('- ');
  if (opensList && inner >= indent) return blockList(lines, at, inner, firstLine);
  if (inner <= indent) return { ok: true, value: '', next: at };
  if (depth + 1 >= MAX_FRONTMATTER_DEPTH) return fail('frontmatter-too-deep', firstLine + at);
  return mapping(lines, at, inner, depth + 1, firstLine);
}

function mapping(lines: readonly string[], from: number, indent: number, depth: number, firstLine: number): Parsed<FrontmatterMap> {
  const entries = new Map<string, FrontmatterValue>();
  let index = from;
  while (index < lines.length) {
    const text = lines[index] ?? '';
    const lineNumber = firstLine + index;
    if (text.trim() === '') {
      index += 1;
      continue;
    }
    if (text.startsWith('\t')) return fail('frontmatter-syntax', lineNumber);
    const at = indentOf(text);
    if (at < indent) break;
    if (at > indent) return fail('frontmatter-syntax', lineNumber);
    const rest = text.slice(at);
    if (rest.startsWith('#')) return fail('frontmatter-comment', lineNumber);
    const colon = rest.indexOf(':');
    if (colon <= 0) return fail('frontmatter-syntax', lineNumber);
    const key = rest.slice(0, colon);
    if (!KEY.test(key)) return fail(key.startsWith('<<') ? 'frontmatter-unsupported' : 'frontmatter-syntax', lineNumber);
    const after = rest[colon + 1];
    if (after !== undefined && after !== ' ' && after !== '\t') return fail('frontmatter-syntax', lineNumber);
    if (entries.has(key)) return fail('frontmatter-duplicate-key', lineNumber);
    const raw = rest.slice(colon + 1).trim();
    const value: Parsed<FrontmatterValue> =
      raw === '' ? nested(lines, index + 1, at, depth, firstLine)
        : BLOCK_SCALAR.test(raw) ? blockScalar(lines, index + 1, at, raw)
          : raw.startsWith('[') ? continueAt(inlineList(raw, lineNumber), index + 1)
            : continueAt(scalar(raw, lineNumber), index + 1);
    if (!value.ok) return value;
    entries.set(key, value.value);
    index = value.next;
  }
  return { ok: true, value: entries, next: index };
}

/** A SKILL.md split into its frontmatter and its body, or the rule it broke. */
export function parseSkillFrontmatter(content: string): FrontmatterResult {
  const lines = foldSkillLines(content).split('\n');
  if (!isFence(lines[0])) return fail('frontmatter-missing', 1);
  const close = lines.findIndex((line, index) => index > 0 && isFence(line));
  if (close < 0) return fail('frontmatter-unclosed', 1);
  const block = lines.slice(1, close);
  if (block.reduce((total, line) => total + line.length + 1, 0) > MAX_FRONTMATTER_CHARS) return fail('frontmatter-too-long', 1);
  const parsed = mapping(block, 0, 0, 0, 2);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { frontmatter: parsed.value, body: lines.slice(close + 1).join('\n'), bodyLine: close + 2 } };
}

/** A top-level or nested value as text, or null when it is absent or not text. */
export function frontmatterText(map: FrontmatterMap, key: string): string | null {
  const value = map.get(key);
  return typeof value === 'string' ? value.trim() : null;
}

/** A value as a list of text: a lone scalar counts as one item, as upstream reads `platforms`. */
export function frontmatterList(map: FrontmatterMap, key: string): readonly string[] {
  const value = map.get(key);
  if (typeof value === 'string') return value.trim() === '' ? [] : [value.trim()];
  return Array.isArray(value) ? (value as readonly string[]) : [];
}
