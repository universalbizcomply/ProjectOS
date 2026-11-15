/**
 * A world for the skill loader's tests (PROJECTOS-SKILLS-ADOPT1A): an in-memory git that can list a directory as well as read one path,
 * a working tree, promoted records made through the real core rules (an origin mark, a review, a verifier, a promotion), and the
 * context manager's ports with the `skills` port joined on. It builds on `contextWorld.ts` and changes none of it.
 */
import {
  attestSkillReview,
  buildSkillProposal,
  decideSkillProposal,
  promoteSkill,
  proposedSkillOrigin,
  skillRecordPathOf,
  type PromotedSkill,
  type SkillActor,
  type SkillFile,
  type SkillReviewVerifier,
} from '@projectos/core';
import type { ContextManagerPorts } from '../../src/context/contextPorts.js';
import { blobNameOf } from '../../src/installation/projectAllowlist.js';
import type { GitRunner } from '../../src/search/ports.js';
import { HEAD, ROOT, admittedRun, memoryFs, worldPorts, type CommittedFile, type WorldOptions } from './contextWorld.js';

export const SKILL_AT = '2026-11-01T10:00:00Z';
export const SKILL_LATER = '2026-11-01T11:00:00Z';
export const AUTHOR: SkillActor = { actor: 'worker-1', role: 'implementer', session: 'sess-1' };
export const REVIEWER: SkillActor = { actor: 'reviewer-1', role: 'owner', session: 'sess-2' };

/** The tenant and project the world's checkout is governed as. */
export const identity = (): { readonly tenant: string; readonly project: string } => ({ tenant: admittedRun().tenant, project: admittedRun().project });

export const vouching: SkillReviewVerifier = () => true;

export const SKILL_MD = (name = 'release-notes', body = 'When a release needs notes.'): string =>
  ['---', `name: ${name}`, 'description: Drafts release notes from merged work.', 'version: 1.2.0', 'author: ProjectOS', 'license: MIT', 'tags: [writing]', '---', '## When to Use', '', body, ''].join('\n');

export const packageOf = (name = 'release-notes', body?: string, ...more: readonly SkillFile[]): readonly SkillFile[] => [{ path: 'SKILL.md', text: SKILL_MD(name, body) }, ...more];

/** A promoted skill, made the way the queue makes one: an origin mark, an independent review, a verifier that vouched, and a promotion. */
export function promotedOf(files: readonly SkillFile[] = packageOf()): PromotedSkill {
  const mark = proposedSkillOrigin(AUTHOR);
  if (!mark.ok) throw new Error(mark.refusal.code);
  const proposal = buildSkillProposal({ files, origin: mark.value, proposedAt: SKILL_AT }, null);
  if (!proposal.ok) throw new Error(`proposal: ${proposal.refusal.code} ${proposal.refusal.named ?? ''}`);
  const decided = decideSkillProposal(proposal.value, 'approved', REVIEWER, SKILL_LATER, proposal.value.proposalHash, null);
  if (!decided.ok) throw new Error(`decision: ${decided.refusal.code}`);
  const vouched = attestSkillReview(decided.value, REVIEWER, identity(), vouching);
  if (!vouched.ok) throw new Error(`verifier: ${vouched.refusal.code}`);
  const promoted = promoteSkill(decided.value, null);
  if (!promoted.ok) throw new Error(`promotion: ${promoted.refusal.code}`);
  return promoted.value;
}

export const recordText = (skill: PromotedSkill): string => `${JSON.stringify(skill, null, 2)}\n`;
export const recordPath = (name = 'release-notes'): string => skillRecordPathOf(name);

/**
 * A git over an in-memory committed tree that answers the four things the loader asks: HEAD, one path, a directory listing and a
 * blob. It records every call. `lie` makes `cat-file blob` return other bytes than the blob's name says.
 */
export function listingGit(tree: Readonly<Record<string, CommittedFile>>, head: string | null = HEAD, options: { readonly lie?: boolean } = {}) {
  const calls: string[] = [];
  const objects = new Map<string, string>();
  const entryOf = (path: string, held: CommittedFile) => {
    const object = blobNameOf(held.text, 'x'.repeat(40));
    objects.set(object, held.text);
    return { mode: held.mode ?? '100644', type: held.type ?? 'blob', object, path };
  };
  const line = (entry: { mode: string; type: string; object: string; path: string }): string => `${entry.mode} ${entry.type} ${entry.object}\t${entry.path}\0`;
  const git: GitRunner = (args) => {
    calls.push(args.join(' '));
    const [verb, ...rest] = args;
    if (verb === 'rev-parse') return head === null ? { code: 128, stdout: '' } : { code: 0, stdout: `${head}\n` };
    if (verb === 'ls-tree' && rest[0] === '-z') {
      const path = rest[rest.length - 1] ?? '';
      if (path.endsWith('/')) {
        const inside = Object.entries(tree).filter(([name]) => name.startsWith(path) && !name.slice(path.length).includes('/'));
        const dirs = [...new Set(Object.keys(tree).filter((name) => name.startsWith(path) && name.slice(path.length).includes('/')).map((name) => `${path}${name.slice(path.length).split('/')[0]}`))];
        return { code: 0, stdout: [...inside.map(([name, held]) => line(entryOf(name, held))), ...dirs.map((dir) => line({ mode: '040000', type: 'tree', object: 'd'.repeat(40), path: dir }))].join('') };
      }
      const held = tree[path];
      return { code: 0, stdout: held === undefined ? '' : line(entryOf(path, held)) };
    }
    if (verb === 'cat-file' && rest[0] === '-s') return objects.has(rest[1] ?? '') ? { code: 0, stdout: `${new TextEncoder().encode(objects.get(rest[1] ?? '') ?? '').length}\n` } : { code: 128, stdout: '' };
    if (verb === 'cat-file' && rest[0] === 'blob') {
      const text = objects.get(rest[1] ?? '');
      return text === undefined ? { code: 128, stdout: '' } : { code: 0, stdout: options.lie === true ? `${text} ` : text };
    }
    return { code: 1, stdout: '' };
  };
  return { git, calls };
}

export interface SkillWorldOptions extends WorldOptions {
  /** Committed skill records by name. The working tree holds the same bytes unless `workingTree` says otherwise. */
  readonly skills?: Readonly<Record<string, string>>;
  /** Working-tree text by record path, where it differs from what was committed. A null removes the file. */
  readonly workingTree?: Readonly<Record<string, string | null>>;
  readonly committed?: Readonly<Record<string, CommittedFile>>;
  readonly reviewVerifier?: SkillReviewVerifier | null;
  /** No `skills` port at all: the manager must not look. */
  readonly noSkillsPort?: boolean;
  readonly lie?: boolean;
}

/** The context manager's ports, joined with a listing git, a working tree and the skills port. */
export function skillWorldPorts(options: SkillWorldOptions = {}) {
  const tree: Record<string, CommittedFile> = { ...(options.committed ?? {}) };
  for (const [path, text] of Object.entries(options.tree ?? {})) tree[path] = { text };
  for (const [name, text] of Object.entries(options.skills ?? {})) tree[recordPath(name)] = { text };
  const { git, calls } = listingGit(tree, options.head === undefined ? HEAD : options.head, options.lie === true ? { lie: true } : {});
  const files: Record<string, string> = Object.fromEntries(Object.entries(tree).filter(([, held]) => (held.type ?? 'blob') === 'blob' && held.mode !== '120000').map(([path, held]) => [`${ROOT}/${path}`, held.text]));
  for (const [path, text] of Object.entries(options.workingTree ?? {})) {
    if (text === null) delete files[`${ROOT}/${path}`];
    else files[`${ROOT}/${path}`] = text;
  }
  const reads: string[] = [];
  const base = memoryFs(files);
  const fs = { ...base, readText: (path: string) => (reads.push(path), base.readText(path)) };
  const { ports } = worldPorts({ ...options, tree: {} });
  const merged: ContextManagerPorts = {
    ...ports,
    git,
    fs,
    ...(options.noSkillsPort === true ? {} : { skills: options.reviewVerifier === null ? {} : { reviewVerifier: options.reviewVerifier ?? vouching } }),
  };
  return { ports: merged, calls, reads };
}
