import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SkillActor, SkillFile, SkillProposal } from '../src/skills/index.js';
import { buildSkillProposal } from '../src/skills/index.js';

export const AT = '2026-11-01T10:00:00Z';
export const LATER = '2026-11-01T11:00:00Z';

export const GOOD_SKILL_MD = [
  '---',
  'name: release-notes',
  'description: Drafts release notes from merged work.',
  'version: 1.2.0',
  'author: ProjectOS',
  'license: MIT',
  'tags: [writing, release]',
  '---',
  '# Release notes',
  '',
  '## When to Use',
  '',
  'When a release needs notes.',
  '',
  '## Steps',
  '',
  '1. Read the merged work.',
  '2. Group it by area.',
  '',
].join('\n');

export const skillMd = (body: string): string => GOOD_SKILL_MD.replace('# Release notes', `# Release notes\n\n${body}`);
export const withFrontmatter = (extra: string): string => GOOD_SKILL_MD.replace('tags: [writing, release]', `tags: [writing, release]\n${extra}`);

export const pkg = (text: string = GOOD_SKILL_MD, ...more: readonly SkillFile[]): readonly SkillFile[] => [{ path: 'SKILL.md', text }, ...more];

export const WORKER: SkillActor = { actor: 'worker-1', role: 'implementer', session: 'sess-1' };
export const REVIEWER: SkillActor = { actor: 'reviewer-1', role: 'advisor', session: 'sess-2' };
export const OWNER: SkillActor = { actor: 'owner', role: 'owner', session: 'sess-3' };

export function proposalOf(files: readonly SkillFile[] = pkg(), active: string | null = null): SkillProposal {
  const built = buildSkillProposal({ files, author: WORKER.actor, authorRole: WORKER.role, session: WORKER.session, proposedAt: AT }, active);
  if (!built.ok) throw new Error(`could not build: ${built.refusal.code} ${built.refusal.named ?? ''}`);
  return built.value;
}

const SAMPLES_FILE = fileURLToPath(new URL('./skill-threat-samples.json', import.meta.url));

/** One sample per pattern. Credential shapes are spelled here and not on disk, so no scanner reads a fake key as real. */
export function threatSamples(): readonly (readonly [string, string])[] {
  const raw = JSON.parse(readFileSync(SAMPLES_FILE, 'utf8')) as Record<string, string>;
  const pem = `-----BEGIN ${'PRIVATE'} KEY-----`;
  return Object.entries(raw).map(([id, text]) => [id, text.replace('<pem>', pem).replace(/<(\d+)([aA])>/g, (_, count: string, letter: string) => letter.repeat(Number(count)))]);
}
