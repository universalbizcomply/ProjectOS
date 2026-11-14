// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/infra/exec-allowlist-pattern.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the glob model is taken, `**` for any run, `*` for one segment and `?` for one character, compiled to an anchored expression; the platform switch, the real-path lookup at match time, the home expansion, the macOS private-path rewrite, the dot-segment normalisation of a target and the module-level compile cache are cut; both the pattern and the target are made canonical by pathCanon.ts first and a path with no canonical form is never matched; a bare wildcard, a wildcard in the first segment and a recursive wildcard with fewer than two literal segments before it are refused, so no pattern can stand for every executable
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * Allowlist patterns for executable paths: EXACT, canonical and closed.
 *
 * A PATTERN THAT CANNOT BE FULLY PARSED MATCHES NOTHING. `compileExecAllowlistPattern` returns a refusal by name, never a
 * matcher that guesses. A target that has no canonical spelling is never matched either, whatever the pattern says, and a
 * pattern and a target of different path styles do not match. So an alias, a short name, a look-alike letter or a `..` can
 * only fall out of the match, never into it.
 *
 * WHAT THIS MODULE CANNOT PROVE. It judges text. That the executable at a canonical path is the file the owner meant, and
 * that no link under it was swapped, is the resolver port's job: the path matched is the real path the port reports.
 *
 * Pure: no I/O.
 */
import { canonicalPathOf, type PathRefusal, type PathStyle } from './pathCanon.js';

export type PatternRefusal = PathRefusal | 'WILDCARD_IN_FIRST_SEGMENT' | 'TOO_MANY_WILDCARDS' | 'RECURSIVE_NEEDS_PREFIX';

export interface ExecAllowlistPattern {
  /** The canonical spelling of the pattern. */
  readonly canonical: string;
  readonly style: PathStyle;
  /** True only when `target` has a canonical spelling of the same style that the pattern covers. */
  readonly matches: (target: unknown) => boolean;
}

export type ExecAllowlistPatternResult =
  | { readonly ok: true; readonly pattern: ExecAllowlistPattern }
  | { readonly ok: false; readonly refusal: PatternRefusal };

const MAX_WILDCARD_TOKENS = 8;
const MAX_RECURSIVE_TOKENS = 2;
const MIN_PREFIX_BEFORE_RECURSIVE = 2;
const TOKEN = /\*\*|[*?]|[^*?]+/g;
const escapeLiteral = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const regexOf = (canonical: string): RegExp =>
  new RegExp(
    `^${canonical.replace(TOKEN, (token) => (token === '**' ? '.*' : token === '*' ? '[^/]*' : token === '?' ? '[^/]' : escapeLiteral(token)))}$`,
  );

/** A matcher for one allowlist pattern, or the reason there is none. */
export function compileExecAllowlistPattern(pattern: unknown): ExecAllowlistPatternResult {
  const canonical = canonicalPathOf(pattern, { wildcards: true });
  if (!canonical.ok) return { ok: false, refusal: canonical.refusal };
  const parts = canonical.value.segments.slice(canonical.value.rootLength);
  if (/[*?]/.test(parts[0] as string)) return { ok: false, refusal: 'WILDCARD_IN_FIRST_SEGMENT' };
  const tokens = canonical.value.path.match(/\*\*|[*?]/g) ?? [];
  const recursive = tokens.filter((token) => token === '**').length;
  if (tokens.length > MAX_WILDCARD_TOKENS || recursive > MAX_RECURSIVE_TOKENS) return { ok: false, refusal: 'TOO_MANY_WILDCARDS' };
  const literalPrefix = parts.findIndex((part) => /[*?]/.test(part));
  if (recursive > 0 && (literalPrefix === -1 ? parts.length : literalPrefix) < MIN_PREFIX_BEFORE_RECURSIVE) {
    return { ok: false, refusal: 'RECURSIVE_NEEDS_PREFIX' };
  }
  const expression = regexOf(canonical.value.path);
  const style = canonical.value.style;
  const matches = (target: unknown): boolean => {
    const spelled = canonicalPathOf(target);
    return spelled.ok && spelled.value.style === style && expression.test(spelled.value.path);
  };
  return { ok: true, pattern: Object.freeze({ canonical: canonical.value.path, style, matches }) };
}
