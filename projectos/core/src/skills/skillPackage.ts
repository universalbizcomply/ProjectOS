// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/skills_guard.py; tools/skill_manager_tool.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python to TypeScript as a pure pass over a list of files; size findings became refusals asked before anything is read; every file must be text of a listed kind, where upstream skipped the rest unread; the ignore file removed, so no package can exclude a file from its own scan; the content digest length-delimited and hashed over the raw text; path rules added; the verdict is pass or fail, with no trust level and no force
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The validator pass over a whole skill package.
 *
 * A package is `SKILL.md` and supporting text under four folders, given as a list of paths and text. This
 * file reads no disk: the agent hands it what it holds, so symbolic links and directory walks have no place to
 * enter. `validateSkillPackage` is one function, called at proposal, at promotion and again before a prompt.
 *
 * THE ORDER IS THE POINT. Counts and sizes are asked first, from lengths alone, so a hostile package costs
 * what the caps allow and no more. Nothing looks at the text until every cap has passed. A failed cap ends the
 * pass, and the report says only that.
 *
 * NOTHING SKIPS. Upstream's `.skillignore` let a package exclude files from its own scan, and an unlisted
 * extension was skipped unread. Both are gone: every file is one of a listed kind, and every file is scanned.
 *
 * THE PIN. `skillPackageHash` covers each path and each file's raw text. It normalises nothing, so a CRLF, a
 * byte-order mark or a change of Unicode form is a new hash. Upstream's digest runs paths and bytes together
 * with one separator; here each file is hashed alone and the list of pairs is hashed, so one file's text
 * cannot be read as the start of the next.
 */
import { createHash } from 'node:crypto';
import { MAX_FRONTMATTER_CHARS, parseSkillFrontmatter } from './frontmatter.js';
import { skillThreatFindings } from './guard.js';
import { foldSkillLines, hiddenTextFindings } from './hiddenText.js';
import { MAX_SKILL_NAME_CHARS, SKILL_MD, lintSkill } from './linter.js';
import { blockingFinding, type SkillFinding } from './refusal.js';
import { auditPythonSource } from './sourceAudit.js';

export const MAX_SKILL_FILES = 50;
export const MAX_SKILL_MD_CHARS = 100_000;
export const MAX_SKILL_FILE_CHARS = 262_144;
export const MAX_SKILL_TOTAL_CHARS = 1_048_576;
/** A line past this is off the reviewer's screen, and padding is how text is pushed there. */
export const MAX_SKILL_LINE_CHARS = 4_096;
export const MAX_SKILL_PATH_CHARS = 256;
/** What one report holds. A package past this has failed already, and the rest would only bury the first. */
const MAX_REPORTED_FINDINGS = 100;

/** Bumped when a rule changes what passes, so a pin says which rules it passed. */
export const SKILL_RULES_VERSION = 'projectos.skill-rules/1';

const PACKAGE_HASH_DOMAIN = 'projectos.skill-package';
const SUPPORT_DIRS = ['references', 'templates', 'assets', 'scripts'];
const FORBIDDEN_FILES = new Set(['readme.md', 'changelog.md', 'install.sh', '.env', '.env.example', '.gitignore', '.skillignore', '.clawhubignore']);
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.py', '.sh', '.bash', '.js', '.ts', '.rb', '.yaml', '.yml', '.json', '.toml', '.cfg', '.ini', '.conf', '.html', '.css', '.xml', '.tex', '.r', '.jl', '.pl', '.php']);
const PATH_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const DEVICE_SEGMENT = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;

export interface SkillFile {
  readonly path: string;
  /** The raw text, exactly as it was proposed. */
  readonly text: string;
}

export interface SkillValidation {
  readonly passed: boolean;
  readonly rulesVersion: typeof SKILL_RULES_VERSION;
  /** Each of these stops promotion, by its rule. */
  readonly blocking: readonly SkillFinding[];
  /** The reviewer reads these. None stops anything. */
  readonly advisory: readonly SkillFinding[];
  readonly name: string | null;
  readonly description: string | null;
  readonly version: string | null;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The hash of exactly these paths and this text. Listing order does not count; one changed byte does. */
export function skillPackageHash(files: readonly SkillFile[]): string {
  const pairs = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((file) => [file.path, sha256(file.text)]);
  return `sha256:${sha256(JSON.stringify([PACKAGE_HASH_DOMAIN, pairs]))}`;
}

const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
};

function capFindings(files: readonly SkillFile[]): readonly SkillFinding[] {
  const whole = '(package)';
  const total = files.reduce((sum, file) => sum + file.text.length, 0);
  return [
    ...(files.length > MAX_SKILL_FILES ? [blockingFinding('too-many-files', whole, 0, `A package holds at most ${MAX_SKILL_FILES} files. Nothing was read.`)] : []),
    ...(total > MAX_SKILL_TOTAL_CHARS ? [blockingFinding('package-too-large', whole, 0, `A package holds at most ${MAX_SKILL_TOTAL_CHARS} characters. Nothing was read.`)] : []),
    ...files.flatMap((file, position) => {
      const limit = file.path === SKILL_MD ? MAX_SKILL_MD_CHARS : MAX_SKILL_FILE_CHARS;
      return file.text.length > limit ? [blockingFinding('file-too-large', `(file ${position + 1})`, 0, `This file is over the ${limit} characters a file may hold. Nothing was read.`)] : [];
    }),
  ];
}

/** What is wrong with one path. The path is not repeated unless it passed, because it is untrusted text. */
function pathFinding(path: string, position: number): SkillFinding | null {
  const at = `(file ${position + 1})`;
  if (path.length > MAX_SKILL_PATH_CHARS) return blockingFinding('bad-path', at, 0, `A path holds at most ${MAX_SKILL_PATH_CHARS} characters.`);
  if (path === SKILL_MD) return null;
  const segments = path.split('/');
  const file = segments[segments.length - 1] ?? '';
  if (FORBIDDEN_FILES.has(file.toLowerCase())) return blockingFinding('forbidden-file', at, 0, 'A skill does not ship scaffolding, ignore files or environment files.');
  if (!segments.every((segment) => PATH_SEGMENT.test(segment) && !segment.endsWith('.') && !DEVICE_SEGMENT.test(segment))) {
    return blockingFinding('bad-path', at, 0, 'A path is relative, uses forward slashes, and each part is letters, digits, dots, hyphens and underscores.');
  }
  if (segments.length < 2 || !SUPPORT_DIRS.includes(segments[0] ?? '')) {
    return blockingFinding('file-outside-package', at, 0, `A file sits at ${SKILL_MD}, or under ${SUPPORT_DIRS.join(', ')}.`);
  }
  if (!TEXT_EXTENSIONS.has(extensionOf(path))) return blockingFinding('file-kind', path, 0, 'This kind of file is not text a reviewer can read.');
  return null;
}

function shapeFindings(files: readonly SkillFile[]): readonly SkillFinding[] {
  const seen = new Set<string>();
  const duplicates = files.flatMap((file, position) => {
    const key = file.path.toLowerCase();
    const repeated = seen.has(key);
    seen.add(key);
    return repeated ? [blockingFinding('duplicate-path', `(file ${position + 1})`, 0, 'Two files have this path, compared without case, as Windows compares it.')] : [];
  });
  const paths = files.flatMap((file, position) => {
    const problem = pathFinding(file.path, position);
    return problem === null ? [] : [problem];
  });
  const hasSkillMd = files.some((file) => file.path === SKILL_MD);
  return [...(hasSkillMd ? [] : [blockingFinding('no-skill-md', '(package)', 0, `A package has one ${SKILL_MD}, at its root.`)]), ...duplicates, ...paths];
}

function lineLengthFinding(path: string, folded: string): SkillFinding | null {
  let start = 0;
  for (let line = 1; start <= folded.length; line += 1) {
    const end = folded.indexOf('\n', start);
    const stop = end < 0 ? folded.length : end;
    if (stop - start > MAX_SKILL_LINE_CHARS) return blockingFinding('line-too-long', path, line, `Line ${line} is over ${MAX_SKILL_LINE_CHARS} characters. Nothing in this file was read.`);
    if (end < 0) return null;
    start = end + 1;
  }
  return null;
}

/** Hidden text, the threat scan and, for Python, the audit. Every file, with no exception. */
function textFindings(path: string, folded: string): readonly SkillFinding[] {
  return [...hiddenTextFindings(path, folded), ...skillThreatFindings(path, folded), ...(extensionOf(path) === '.py' ? auditPythonSource(path, folded) : [])];
}

const failed = (blocking: readonly SkillFinding[]): SkillValidation => ({
  passed: false,
  rulesVersion: SKILL_RULES_VERSION,
  blocking,
  advisory: [],
  name: null,
  description: null,
  version: null,
});

/**
 * The validator pass. A package passes when no finding blocks it, and a pass grants nothing: promotion also
 * needs an independent review over this exact hash.
 */
export function validateSkillPackage(files: readonly SkillFile[]): SkillValidation {
  const caps = capFindings(files);
  if (caps.length > 0) return failed(caps);
  const shape = shapeFindings(files);
  if (shape.length > 0) return failed(shape);
  const folded = files.map((file) => ({ path: file.path, text: foldSkillLines(file.text) }));
  const longLines = folded.flatMap(({ path, text }) => {
    const finding = lineLengthFinding(path, text);
    return finding === null ? [] : [finding];
  });
  if (longLines.length > 0) return failed(longLines);

  const skillMd = folded.find((file) => file.path === SKILL_MD);
  const parsed = parseSkillFrontmatter(skillMd?.text ?? '');
  const lint = parsed.ok
    ? lintSkill({ parsed: parsed.value, files: folded.filter((file) => file.path !== SKILL_MD) })
    : [blockingFinding(parsed.rule, SKILL_MD, parsed.line, `The frontmatter breaks ${parsed.rule}. It must be a closed block of the subset this reads, under ${MAX_FRONTMATTER_CHARS} characters.`)];
  const findings = [...lint, ...folded.flatMap(({ path, text }) => textFindings(path, text))];
  const frontmatter = parsed.ok ? parsed.value.frontmatter : null;
  const text = (key: string): string | null => {
    const value = frontmatter?.get(key);
    return typeof value === 'string' ? value.trim() : null;
  };
  const blocking = findings.filter((finding) => finding.weight === 'blocking');
  return {
    passed: blocking.length === 0,
    rulesVersion: SKILL_RULES_VERSION,
    blocking: blocking.slice(0, MAX_REPORTED_FINDINGS),
    advisory: findings.filter((finding) => finding.weight === 'advisory').slice(0, MAX_REPORTED_FINDINGS),
    name: text('name')?.slice(0, MAX_SKILL_NAME_CHARS) ?? null,
    description: text('description'),
    version: text('version'),
  };
}
