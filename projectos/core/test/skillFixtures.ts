import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PromotedSkill, SkillActor, SkillFile, SkillOriginMark, SkillProposal, SkillResult, SkillReviewVerifier } from '../src/skills/index.js';
import { attestSkillReview, buildSkillProposal, decideSkillProposal, importedSkillOrigin, promoteSkill, proposedSkillOrigin } from '../src/skills/index.js';

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
export const REVIEWER: SkillActor = { actor: 'reviewer-1', role: 'owner', session: 'sess-2' };
export const OWNER: SkillActor = { actor: 'owner', role: 'owner', session: 'sess-3' };

/** The tenant and project of the checkout a promotion or a load is for. */
export const BINDING = { tenant: 'acme', project: 'proj-a' };
/** A verifier that vouches for everything: the fake the port is tested with. There is no production one. */
export const vouching: SkillReviewVerifier = () => true;

/** What a test says about who proposes. The origin is minted by the kernel's doors, never read from a request. */
export interface ProposalOver {
  readonly imported?: boolean;
  readonly author?: string;
  readonly authorRole?: string;
  readonly session?: string;
  readonly proposedAt?: string;
}

/** The door a proposal comes through, then the proposal, as a result. */
export function buildWith(files: readonly SkillFile[] = pkg(), over: ProposalOver = {}, active: string | null = null): SkillResult<SkillProposal> {
  const actor = { actor: over.author ?? WORKER.actor, role: (over.authorRole ?? WORKER.role) as SkillActor['role'], session: over.session ?? WORKER.session };
  const mark = over.imported === true ? importedSkillOrigin(actor) : proposedSkillOrigin(actor);
  return mark.ok ? buildSkillProposal({ files, origin: mark.value, proposedAt: over.proposedAt ?? AT }, active) : mark;
}

export const markOf = (actor: SkillActor = WORKER): SkillOriginMark => {
  const mark = proposedSkillOrigin(actor);
  if (!mark.ok) throw new Error(mark.refusal.code);
  return mark.value;
};

export function proposalOf(files: readonly SkillFile[] = pkg(), active: string | null = null): SkillProposal {
  const built = buildWith(files, {}, active);
  if (!built.ok) throw new Error(`could not build: ${built.refusal.code} ${built.refusal.named ?? ''}`);
  return built.value;
}

/** Approved by an independent reviewer AND vouched for by the verifier: what a promotion needs. */
export function approvedAndVouched(proposal: SkillProposal = proposalOf(), reviewer: SkillActor = REVIEWER, verifier: SkillReviewVerifier = vouching, binding: unknown = BINDING): SkillProposal {
  const decided = decideSkillProposal(proposal, 'approved', reviewer, LATER, proposal.proposalHash, proposal.supersedes);
  if (!decided.ok) throw new Error(decided.refusal.code);
  const vouched = attestSkillReview(decided.value, reviewer, binding, verifier);
  if (!vouched.ok) throw new Error(vouched.refusal.code);
  return decided.value;
}

export function promotedOf(proposal: SkillProposal = proposalOf()): PromotedSkill {
  const result = promoteSkill(approvedAndVouched(proposal), proposal.supersedes);
  if (!result.ok) throw new Error(result.refusal.code);
  return result.value;
}

const SAMPLES_FILE = fileURLToPath(new URL('./skill-threat-samples.json', import.meta.url));

/** One sample per pattern. Credential shapes are spelled here and not on disk, so no scanner reads a fake key as real. */
export function threatSamples(): readonly (readonly [string, string])[] {
  const raw = JSON.parse(readFileSync(SAMPLES_FILE, 'utf8')) as Record<string, string>;
  const pem = `-----BEGIN ${'PRIVATE'} KEY-----`;
  return Object.entries(raw).map(([id, text]) => [id, text.replace('<pem>', pem).replace(/<(\d+)([aA])>/g, (_, count: string, letter: string) => letter.repeat(Number(count)))]);
}

export const file = (path: string, text: string = 'x'): SkillFile => ({ path, text });
