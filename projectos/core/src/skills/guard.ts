// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/skills_guard.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python to TypeScript as pure text rules; trust levels, the install policy and --force removed, so no source is exempt; the skips for docstrings, comments, denylist lines and documentation removed, because the text that earns a skip is the attacker's; one finding per pattern per file; a finding names its line and never repeats its text
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The threat scan of one file.
 *
 * Upstream scans each line and then lowers or skips what it finds by context: a triple-quoted line is not
 * scored, a comment or a line owned by a denylist name is demoted, and a `builtin` source is never scanned.
 * All of that context is text the author wrote, so here none of it counts. Every line of every file is
 * scanned, and a critical or high hit stops promotion whoever wrote it.
 *
 * THE WHOLE FILE IS THE HAYSTACK, with the `m` flag, so `^` and `$` still mean a line and `\s` crosses one. An
 * injection phrase split across two lines reads as one sentence once rendered, and it matches as one here.
 * Each pattern passes over the text once and every repeat in it is bounded, so the cost is the size cap times
 * the bound, whatever the text.
 */
import { SKILL_THREAT_PATTERNS, type SkillThreatPattern } from './guardPatterns.js';
import { advisoryFinding, blockingFinding, type SkillFinding } from './refusal.js';

const COMPILED: readonly (readonly [RegExp, SkillThreatPattern])[] = SKILL_THREAT_PATTERNS.map((pattern) => [new RegExp(pattern.source, 'imu'), pattern] as const);

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let at = text.indexOf('\n'); at >= 0 && at < index; at = text.indexOf('\n', at + 1)) line += 1;
  return line;
}

function findingFor(path: string, pattern: SkillThreatPattern, line: number): SkillFinding {
  const message = `${pattern.description} (${pattern.severity}, ${pattern.category}).`;
  return pattern.severity === 'critical' || pattern.severity === 'high' ? blockingFinding(pattern.id, path, line, message) : advisoryFinding(pattern.id, path, line, message);
}

/** Every pattern that matched this file, at its first line. Patterns run on the NFKC fold, so full-width text counts. */
export function skillThreatFindings(path: string, folded: string): readonly SkillFinding[] {
  const text = folded.normalize('NFKC');
  return COMPILED.flatMap(([regex, pattern]) => {
    const match = regex.exec(text);
    return match === null ? [] : [findingFor(path, pattern, lineOf(text, match.index))];
  });
}
