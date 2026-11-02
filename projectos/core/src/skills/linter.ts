// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/skill_linter.py; tools/skill_manager_tool.py; agent/skill_utils.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python to TypeScript as pure rules over a list of paths; errors block promotion, and the hard checks of the skill manager join them, reserved device names added; the upstream author and metadata namespace rules removed; the directory-name and reference-count rules removed, because a package has no directory here and its file cap is lower than that limit; fenced code read line by line, so an unclosed fence cannot go quadratic
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The linter for a SKILL.md.
 *
 * Upstream's linter is advisory and its hard validator sits elsewhere. Here they are one pass with two weights:
 * an error stops promotion, by a named rule, and a warning is shown to the reviewer. Every message states the
 * rule, not the offending text.
 *
 * A DECLARED TOOL GRANTS NOTHING. `allowed-tools` is exchanged and shown, and nothing in ProjectOS reads it as
 * a permission: a skill is data, and a grant comes from the kernel.
 */
import { frontmatterList, frontmatterText, type ParsedSkillMd } from './frontmatter.js';
import { advisoryFinding, blockingFinding, type SkillFinding } from './refusal.js';

export const SKILL_MD = 'SKILL.md';
export const MAX_SKILL_NAME_CHARS = 64;
export const MAX_SKILL_DESCRIPTION_CHARS = 1_024;
const DESCRIPTION_BUDGET_CHARS = 60;
const BODY_SOFT_BUDGET_CHARS = 24_000;
const INCIDENT_REF_MIN = 4;
const INCIDENT_REF_PER_KCHAR = 0.5;

const NAME_FORMAT = /^[a-z0-9][a-z0-9_-]*$/;
/** A name becomes a file name, and on Windows these are devices whatever the extension. */
const DEVICE_NAMES = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
const SHELL_UTILITIES: Readonly<Record<string, string>> = {
  grep: 'the search tool',
  rg: 'the search tool',
  cat: 'the read tool',
  head: 'the read tool',
  tail: 'the read tool',
  sed: 'the edit tool',
  awk: 'the edit tool',
  find: 'the search tool',
  ls: 'the search tool',
};
const MARKETING_WORDS = ['powerful', 'comprehensive', 'seamless', 'advanced', 'cutting-edge', 'state-of-the-art', 'revolutionary', 'robust'];
const PLATFORMS = new Set(['linux', 'macos', 'windows', 'darwin']);
const POSIX_PRIMITIVES = ['fcntl', 'termios', 'os.setsid', 'signal.SIGKILL', 'osascript', '/proc/', 'apt-get', 'systemctl'];
const SCRIPT_EXTENSION = /\.(?:py|sh|bash)$/;
const WHEN_TO_USE = /^#{1,6}\s+when to use/i;
const INCIDENT_REF = /(?<![\w/])#\d{3,6}\b|\b(?:PR|issue)\s{0,4}#?\d{3,6}\b/g;
const PACKAGE_LINK = /(?:references|templates|assets)\/[\w./-]{1,512}/g;
/** CommonMark: three or more backticks or tildes, indented at most three spaces. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export interface SkillLintInput {
  readonly parsed: ParsedSkillMd;
  /** Every other path in the package, with its text. */
  readonly files: readonly { readonly path: string; readonly text: string }[];
}

const error = (rule: string, line: number, message: string): SkillFinding => blockingFinding(rule, SKILL_MD, line, message);
const warning = (rule: string, line: number, message: string): SkillFinding => advisoryFinding(rule, SKILL_MD, line, message);

/** The name a package goes by: the frontmatter's, once it has passed these rules. */
export function skillNameProblem(name: string | null): SkillFinding | null {
  if (name === null || name === '') return error('name-missing', 0, 'The frontmatter must have a name.');
  if (name.length > MAX_SKILL_NAME_CHARS) return error('name-too-long', 0, `A name holds at most ${MAX_SKILL_NAME_CHARS} characters.`);
  if (!NAME_FORMAT.test(name)) return error('name-format', 0, 'A name is lowercase letters, digits, hyphens and underscores, and starts with a letter or digit.');
  if (DEVICE_NAMES.test(name)) return error('name-reserved', 0, 'That name is a device on Windows, so it cannot be a file.');
  return null;
}

function frontmatterFindings(parsed: ParsedSkillMd): readonly SkillFinding[] {
  const { frontmatter } = parsed;
  const description = frontmatterText(frontmatter, 'description');
  const name = skillNameProblem(frontmatterText(frontmatter, 'name'));
  const missing = ['version', 'author', 'license'].filter((key) => !frontmatter.has(key));
  const metadata = frontmatter.get('metadata');
  const tagged = frontmatter.has('tags') || (metadata instanceof Map && metadata.has('tags'));
  const words = (description ?? '').toLowerCase();
  const marketing = MARKETING_WORDS.filter((word) => new RegExp(`\\b${word}\\b`).test(words));
  const platforms = frontmatterList(frontmatter, 'platforms').filter((platform) => !PLATFORMS.has(platform.toLowerCase()));
  return [
    ...(name === null ? [] : [name]),
    ...(description === null || description === '' ? [error('description-missing', 0, 'The frontmatter must have a description.')] : []),
    ...((description?.length ?? 0) > MAX_SKILL_DESCRIPTION_CHARS ? [error('description-too-long', 0, `A description holds at most ${MAX_SKILL_DESCRIPTION_CHARS} characters.`)] : []),
    ...((description?.length ?? 0) > DESCRIPTION_BUDGET_CHARS ? [warning('description-length', 0, `An index shows about ${DESCRIPTION_BUDGET_CHARS} characters. Keep it to one sentence.`)] : []),
    ...(marketing.length > 0 ? [warning('description-marketing', 0, 'State the capability, not adjectives.')] : []),
    ...missing.map((key) => warning('missing-metadata', 0, `The frontmatter has no '${key}'.`)),
    ...(tagged ? [] : [warning('missing-metadata', 0, "The frontmatter has no 'tags'.")]),
    ...(platforms.length > 0 ? [warning('platforms-value', 0, 'platforms holds a value that is not linux, macos, windows or darwin.')] : []),
    ...(frontmatter.has('allowed-tools') ? [warning('declares-tools', 0, 'allowed-tools is shown to the reviewer and grants nothing.')] : []),
  ];
}

/** The body with fenced code removed, read line by line. An unclosed fence stays code to the end. */
function proseOf(body: string): string {
  const kept: string[] = [];
  let open: { readonly marker: string; readonly length: number } | null = null;
  for (const line of body.split('\n')) {
    const match = FENCE.exec(line);
    const marker = match?.[1] ?? '';
    if (open !== null) {
      if (marker.startsWith(open.marker) && marker.length >= open.length && (match?.[2] ?? '').trim() === '') open = null;
    } else if (match !== null && !(marker.startsWith('`') && (match[2] ?? '').includes('`'))) {
      open = { marker: marker.slice(0, 1), length: marker.length };
    } else {
      kept.push(line);
    }
  }
  return kept.join('\n');
}

function bodyFindings(input: SkillLintInput): readonly SkillFinding[] {
  const { body, bodyLine } = input.parsed;
  const prose = proseOf(body);
  const references = (prose.match(INCIDENT_REF) ?? []).length;
  const present = new Set(input.files.map((file) => file.path));
  const mentioned = (body.match(PACKAGE_LINK) ?? []).map((link) => link.replace(/\.+$/, ''));
  const links = [...new Set(mentioned)].filter((link) => !link.includes('*') && !link.endsWith('/') && !present.has(link));
  return [
    ...(body.trim() === '' ? [error('body-empty', bodyLine, 'A skill must have content after the frontmatter.')] : []),
    ...(body.length > BODY_SOFT_BUDGET_CHARS ? [warning('oversized-body', bodyLine, 'A body this long is paid for on every turn. Move depth into references/.')] : []),
    ...Object.entries(SHELL_UTILITIES)
      .filter(([utility]) => prose.includes(`\`${utility}\``))
      .map(([utility, tool]) => warning('shell-utility-reference', bodyLine, `The prose names \`${utility}\`. Name ${tool} instead.`)),
    ...(body.split('\n').some((line) => WHEN_TO_USE.test(line)) ? [] : [warning('missing-section', bodyLine, "There is no 'When to Use' section.")]),
    ...(references >= INCIDENT_REF_MIN && (references / Math.max(prose.length, 1)) * 1000 >= INCIDENT_REF_PER_KCHAR
      ? [warning('incident-log-shape', bodyLine, 'This reads as a list of incidents. State the rule, and why.')]
      : []),
    ...links.map((link) => warning('dangling-reference', bodyLine, `The body links to ${link}, and the package does not hold it.`)),
  ];
}

function scriptFindings(input: SkillLintInput): readonly SkillFinding[] {
  if (input.parsed.frontmatter.has('platforms')) return [];
  const gated = input.files.filter(({ path, text }) => path.startsWith('scripts/') && SCRIPT_EXTENSION.test(path) && POSIX_PRIMITIVES.some((primitive) => text.includes(primitive)));
  return gated.map(({ path }) => advisoryFinding('platforms-gating', path, 0, "This script uses POSIX-only primitives and the frontmatter declares no 'platforms'."));
}

/** Every lint finding for one parsed SKILL.md and the package around it. */
export function lintSkill(input: SkillLintInput): readonly SkillFinding[] {
  return [...frontmatterFindings(input.parsed), ...bodyFindings(input), ...scriptFindings(input)];
}
