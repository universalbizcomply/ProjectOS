import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMMITTED_SKILL_CODES, SKILL_REFUSAL_CODES, buildSkillProposal, importedSkillOrigin, type SkillActor, type SkillFile, type SkillProposal, type SkillRefusalCode, type SkillResult } from '@projectos/core';
import type { System } from '../src/system.js';
import { nodeSystem } from '../src/system.js';
import { SKILL_FIX_CODES, skillAdviceOf, skillFixOf } from '../src/context/skillContext.js';
import { importSkill, listPendingSkillProposals, proposeSkill, rejectSkillProposal, reviewAndPromoteSkill, skillsDir, type SkillPromotionPorts } from '../src/skills/index.js';
import { isSkillMinted, recordSkillMint, type SkillStatePorts } from '../src/skills/skillMint.js';
import { loadPromotedSkill } from '../src/skills/skillQueue.js';

const ROOT = '/proj';
const STATE_DIR = '/state';
const NAME = 'release-notes';
const SKILL_MD = ['---', `name: ${NAME}`, 'description: Drafts release notes from merged work.', 'version: 1.2.0', 'author: ProjectOS', 'license: MIT', 'tags: [writing]', '---', '## When to Use', '', 'When a release needs notes.', ''].join('\n');
const FILES: readonly SkillFile[] = [{ path: 'SKILL.md', text: SKILL_MD }];
const WORKER: SkillActor = { actor: 'worker-1', role: 'implementer', session: 'sess-1' };
const OWNER1: SkillActor = { actor: 'owner-1', role: 'owner', session: 'sess-a' };
const OWNER2: SkillActor = { actor: 'owner-2', role: 'owner', session: 'sess-9' };
const BINDING = { tenant: 'acme', project: 'proj-a' };
const STATE: SkillStatePorts = { checkout: () => BINDING, stateDir: STATE_DIR };
const PORTS: SkillPromotionPorts = { ...STATE, reviewVerifier: () => true };

function fakeSystem(): System & { readonly files: Map<string, string>; failCreateUnder: string | null } {
  const files = new Map<string, string>();
  let tick = 0;
  const sys = {
    files,
    failCreateUnder: null as string | null,
    cwd: () => ROOT,
    now: () => `2026-11-01T10:00:${String(tick++).padStart(2, '0')}Z`,
    readText: (path: string) => files.get(path) ?? null,
    writeText: (path: string, content: string) => void files.set(path, content),
    exists: (path: string) => files.has(path),
    listDir: (path: string) => [...files.keys()].filter((name) => name.startsWith(`${path}/`)).map((name) => name.slice(path.length + 1)),
    renameFile: (from: string, to: string) => {
      const content = files.get(from);
      if (content === undefined) return false;
      files.delete(from);
      files.set(to, content);
      return true;
    },
    createExclusive: (path: string, content: string) => {
      if (sys.failCreateUnder !== null && path.startsWith(sys.failCreateUnder)) return false;
      if (files.has(path)) return false;
      files.set(path, content);
      return true;
    },
    removeFile: (path: string) => (files.delete(path), true),
    exec: () => ({ code: 0, stdout: '', stderr: '' }),
  };
  return sys as unknown as System & { readonly files: Map<string, string>; failCreateUnder: string | null };
}

const code = (result: SkillResult<unknown>): SkillRefusalCode | 'ok' => (result.ok ? 'ok' : result.refusal.code);
const value = <T>(result: SkillResult<T>): T => {
  if (!result.ok) throw new Error(`refused: ${result.refusal.code} ${result.refusal.message}`);
  return result.value;
};
const review = (sys: System, proposal: SkillProposal, ports: SkillPromotionPorts = PORTS, caller: SkillActor = OWNER2) => reviewAndPromoteSkill(sys, ROOT, caller, { id: proposal.id, reviewedHash: proposal.proposalHash }, ports);
const proposalFile = (proposal: SkillProposal): string => `${skillsDir(ROOT)}/proposals/${proposal.id}.json`;

describe('M1: a file is not a mint (review round 1)', () => {
  /** What a worker with file access can write: a whole, self-consistent pending proposal that claims an import by an owner. */
  function forgedProposal(): SkillProposal {
    const mark = importedSkillOrigin(OWNER1);
    if (!mark.ok) throw new Error('mark');
    return value(buildSkillProposal({ files: FILES, origin: mark.value, proposedAt: '2026-11-01T09:00:00Z', binding: BINDING }, null));
  }

  it('a proposal file the kernel did not mint is not reviewed, the verifier is not asked, and the fix names the door', () => {
    const sys = fakeSystem();
    const forged = forgedProposal();
    sys.files.set(proposalFile(forged), JSON.stringify(forged, null, 2));
    let asked = 0;
    const result = review(sys, forged, { ...PORTS, reviewVerifier: () => (asked += 1, true) });
    expect(code(result)).toBe('SKILL_NOT_MINTED');
    expect(result.ok ? '' : result.refusal.message).toContain('Fix: the owner re-proposes it through the door');
    expect(asked).toBe(0);
    expect([...sys.files.keys()].some((path) => path.includes('/promoted/'))).toBe(false);
  });

  it('the same file is reviewed once the kernel has minted it: the positive control', () => {
    const sys = fakeSystem();
    const proposal = value(importSkill(sys, ROOT, OWNER1, { files: FILES }, STATE));
    expect(proposal.origin).toBe('imported');
    expect(code(review(sys, proposal))).toBe('ok');
  });

  it('a proposal made through a door is minted where a worker cannot write: the installation state, keyed by tenant and project, never the project tree', () => {
    const sys = fakeSystem();
    const proposal = value(proposeSkill(sys, ROOT, WORKER, { files: FILES }, STATE));
    const written = [...sys.files.keys()];
    const mints = written.filter((path) => path.startsWith(`${STATE_DIR}/skill-mint/`));
    expect(mints).toHaveLength(1);
    expect(mints[0]).toMatch(new RegExp(`^${STATE_DIR}/skill-mint/mint-[0-9a-f]{32}/${proposal.proposalHash.slice('sha256:'.length)}\\.json$`));
    expect(written.filter((path) => !path.startsWith(`${STATE_DIR}/`) && !path.startsWith(`${ROOT}/.projectops/skills/`))).toEqual([]);
    expect(mints[0]).not.toContain('acme');
    expect(mints[0]).not.toContain('proj-a');
  });

  it('a mint is for one checkout: another project\'s checkout does not find it', () => {
    const sys = fakeSystem();
    const proposal = value(proposeSkill(sys, ROOT, WORKER, { files: FILES }, STATE));
    expect(isSkillMinted(sys, STATE, proposal.proposalHash)).toBe(true);
    expect(isSkillMinted(sys, { ...STATE, checkout: () => ({ tenant: 'acme', project: 'proj-b' }) }, proposal.proposalHash)).toBe(false);
    expect(isSkillMinted(sys, { ...STATE, checkout: () => ({ tenant: 'other', project: 'proj-a' }) }, proposal.proposalHash)).toBe(false);
    expect(isSkillMinted(sys, { ...STATE, stateDir: '/other-state' }, proposal.proposalHash)).toBe(false);
    expect(isSkillMinted(sys, { ...STATE, checkout: () => null }, proposal.proposalHash)).toBe(false);
    expect(isSkillMinted(sys, { ...STATE, checkout: () => { throw new Error('x'); } }, proposal.proposalHash)).toBe(false);
    expect(code(review(sys, proposal, { ...PORTS, checkout: () => ({ tenant: 'acme', project: 'proj-b' }) }))).not.toBe('ok');
  });

  it('a mint file that is not exactly what the queue writes is not a mint: a truncated file, a planted file, another hash', () => {
    const sys = fakeSystem();
    const proposal = value(proposeSkill(sys, ROOT, WORKER, { files: FILES }, STATE));
    const path = [...sys.files.keys()].find((name) => name.startsWith(`${STATE_DIR}/skill-mint/`)) as string;
    const good = sys.files.get(path) as string;
    for (const bad of ['', good.slice(0, 20), `${good} `, good.replace('acme', 'evil'), '{}']) {
      sys.files.set(path, bad);
      expect(isSkillMinted(sys, STATE, proposal.proposalHash)).toBe(false);
    }
    sys.files.set(path, good);
    expect(isSkillMinted(sys, STATE, proposal.proposalHash)).toBe(true);
    expect(isSkillMinted(sys, STATE, `sha256:${'0'.repeat(64)}`)).toBe(false);
    expect(isSkillMinted(sys, STATE, 'not a hash')).toBe(false);
  });

  it('the mint is made before the proposal file: a mint that cannot be written leaves no proposal, and says who fixes the state directory', () => {
    const sys = fakeSystem();
    sys.failCreateUnder = STATE_DIR;
    const result = proposeSkill(sys, ROOT, WORKER, { files: FILES }, STATE);
    expect(code(result)).toBe('SKILL_WRITE_FAILED');
    expect(result.ok ? '' : result.refusal.message).toContain('Fix: the owner checks the installation state directory');
    expect(listPendingSkillProposals(sys, ROOT).pending).toEqual([]);
  });

  it('with no absolute state directory nothing is proposed, and the fix is named; a checkout with no identity is refused the same way', () => {
    for (const stateDir of [null, 'relative/state', '']) {
      const sys = fakeSystem();
      const result = proposeSkill(sys, ROOT, WORKER, { files: FILES }, { ...STATE, stateDir });
      expect(code(result)).toBe('SKILL_WRITE_FAILED');
      expect(result.ok ? '' : result.refusal.message).toContain('installation state location');
      expect(sys.files.size).toBe(0);
    }
    const none = fakeSystem();
    expect(code(proposeSkill(none, ROOT, WORKER, { files: FILES }, { ...STATE, checkout: () => null }))).toBe('SKILL_BINDING_INVALID');
    expect(none.files.size).toBe(0);
  });

  it('a proposal made through a door that was given no checkout is pending, names no project, and cannot be reviewed', () => {
    const sys = fakeSystem();
    const proposal = value(proposeSkill(sys, ROOT, WORKER, { files: FILES }));
    expect([proposal.tenant, proposal.project]).toEqual([null, null]);
    expect(listPendingSkillProposals(sys, ROOT).pending.map((one) => one.id)).toEqual([proposal.id]);
    expect(code(review(sys, proposal))).toBe('SKILL_NOT_MINTED');
    expect([...sys.files.keys()].some((path) => path.startsWith(STATE_DIR))).toBe(false);
  });

  it('a rejection needs no mint: a reviewer can always say no to a file', () => {
    const sys = fakeSystem();
    const forged = forgedProposal();
    sys.files.set(proposalFile(forged), JSON.stringify(forged, null, 2));
    expect(code(rejectSkillProposal(sys, ROOT, OWNER2, { id: forged.id, reviewedHash: forged.proposalHash }))).toBe('ok');
  });

  it('a proposal for one project is not reviewed from another project\'s checkout, even when both are minted', () => {
    const sys = fakeSystem();
    const proposal = value(proposeSkill(sys, ROOT, WORKER, { files: FILES }, STATE));
    const other: SkillPromotionPorts = { ...PORTS, checkout: () => ({ tenant: 'acme', project: 'proj-b' }) };
    value(recordSkillMint(sys, other, proposal.proposalHash));
    expect(code(review(sys, proposal, other))).toBe('SKILL_NOT_THIS_CHECKOUT');
    expect(code(review(sys, proposal))).toBe('ok');
  });

  it('a checkout with no tenant and project is refused as that, before the mint is asked', () => {
    const sys = fakeSystem();
    const proposal = value(proposeSkill(sys, ROOT, WORKER, { files: FILES }, STATE));
    expect(code(review(sys, proposal, { ...PORTS, checkout: () => null }))).toBe('SKILL_BINDING_INVALID');
  });
});

describe('L6: a request that is not a package is a refusal, never a throw (review round 1)', () => {
  it.each([[null], [undefined], ['x'], [42], [[]], [{}], [{ files: undefined }]])('%j', (request) => {
    const sys = fakeSystem();
    for (const door of [proposeSkill, importSkill]) {
      const result = door(sys, ROOT, door === importSkill ? OWNER1 : WORKER, request as never, STATE);
      expect(code(result)).toBe('SKILL_FAILED_VALIDATION');
      expect(result.ok ? '' : result.refusal.named).toBe('not-a-package');
    }
    expect(sys.files.size).toBe(0);
  });

  it('a files property that is a getter is refused: it would answer differently the second time', () => {
    const sys = fakeSystem();
    let reads = 0;
    const request = { get files() { reads += 1; return FILES; } };
    expect(code(proposeSkill(sys, ROOT, WORKER, request as never, STATE))).toBe('SKILL_FAILED_VALIDATION');
    expect(reads).toBe(0);
  });

  it('an actor that is a getter is refused at the door, and nothing is recorded', () => {
    const sys = fakeSystem();
    let reads = 0;
    const actor = { actor: 'o', session: 's', get role() { reads += 1; return reads === 1 ? 'implementer' : 'owner'; } };
    expect(code(importSkill(sys, ROOT, actor as never, { files: FILES }, STATE))).toBe('SKILL_PROVENANCE');
    expect(sys.files.size).toBe(0);
  });
});

describe('L5: the way to a prompt is the committed loader (review round 1)', () => {
  it('the agent skills barrel offers no loader of a record', async () => {
    const barrel = (await import('../src/skills/index.js')) as Record<string, unknown>;
    expect('loadPromotedSkill' in barrel).toBe(false);
    expect('loadSkillBlock' in barrel).toBe(false);
    expect(typeof loadPromotedSkill).toBe('function');
  });
});

describe('L1: every code a skill can be withheld with has a fix that says who does what (review round 1)', () => {
  const GATE_CODES = ['CONTEXT_ITEM_NOT_TEXT', 'CONTEXT_ITEM_EMPTY', 'CONTEXT_ITEM_TOO_LARGE', 'CONTEXT_ITEM_HIDDEN_TEXT', 'CONTEXT_ITEM_THREAT', 'CONTEXT_ITEM_CREDENTIAL', 'CONTEXT_ITEM_SCREEN_MISSING'];
  const LOADER_CODES = ['SKILL_LISTING_UNAVAILABLE', 'SKILL_TOO_LARGE_FOR_CONTEXT', 'SKILL_CONTEXT_OVER_BUDGET', 'SKILL_RECORD_NOT_A_RECORD', 'SKILL_RECORD_UNLISTABLE', 'SKILL_RECORD_OVER_LIMIT', 'SKILL_NOT_THIS_CHECKOUT', 'SKILL_STALE'];
  /** The refusal codes that only the queue gives; the loader cannot, so they need no sentence about a run. */
  const QUEUE_ONLY: readonly string[] = ['SKILL_CREDENTIAL', 'SKILL_PROVENANCE', 'SKILL_NOT_OWNER', 'SKILL_NOT_APPROVED', 'SKILL_ALREADY_DECIDED', 'SKILL_LOCKED', 'SKILL_WRITE_FAILED', 'SKILL_LANDED_INCOMPLETE', 'SKILL_QUEUE_FULL', 'SKILL_ORIGIN_NOT_KERNEL'];

  it('walks the committed reader\'s codes, the gate\'s, the listing\'s and every refusal the loader can give', () => {
    const wanted = [...COMMITTED_SKILL_CODES, ...GATE_CODES, ...LOADER_CODES, ...SKILL_REFUSAL_CODES.filter((one) => !QUEUE_ONLY.includes(one))];
    for (const one of new Set(wanted)) {
      const fix = skillFixOf(one);
      expect([one, typeof fix === 'string' && fix.startsWith('Fix: ') && fix.length > 20]).toEqual([one, true]);
    }
    expect(SKILL_FIX_CODES.length).toBeGreaterThanOrEqual(new Set(wanted).size);
  });

  it('every sentence names who acts, and no sentence is a bare code', () => {
    for (const one of SKILL_FIX_CODES) {
      const fix = skillFixOf(one) as string;
      expect(fix).toMatch(/the owner|propose|shorten|this is a defect/i);
    }
  });

  it('a withheld skill is advised by code, with the count, the reason and the fix; other stored items are not its business', () => {
    const advice = skillAdviceOf([
      { id: '.projectops/skills/promoted/a.json', code: 'COMMITTED_WORKING_TREE_DIFFERS' },
      { id: '.projectops/skills/promoted/b.json', code: 'COMMITTED_WORKING_TREE_DIFFERS' },
      { id: 'skills', code: 'SKILL_NOT_THIS_CHECKOUT' },
      { id: '.projectops/skills/promoted/c.json', code: 'SKILL_TOO_LARGE_FOR_CONTEXT' },
      { id: '.projectops/memory/MEMORY.md', code: 'COMMITTED_WORKING_TREE_DIFFERS' },
      { id: 'index', code: 'CONTEXT_INDEX_UNAVAILABLE' },
    ]);
    expect(advice).toHaveLength(3);
    expect(advice[0]).toContain('2 committed skill records were not loaded');
    expect(advice[0]).toContain('COMMITTED_WORKING_TREE_DIFFERS');
    expect(advice[0]).toContain('Fix: the owner compares it with HEAD');
    expect(advice.join(' ')).not.toContain('MEMORY.md');
  });

  it('a code that is not a skill\'s has no fix of its own', () => {
    expect(skillFixOf('CONTEXT_INDEX_UNAVAILABLE')).toBeNull();
    expect(skillFixOf('')).toBeNull();
  });
});

describe('against a real file system: the mint is outside the project tree', () => {
  let state: string;
  let repo: string;
  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'projectos-skill-state-')).replace(/\\/g, '/');
    repo = mkdtempSync(join(tmpdir(), 'projectos-skill-repo-')).replace(/\\/g, '/');
    spawnSync('git', ['-C', repo, 'init', '-q']);
  });
  afterEach(() => {
    rmSync(state, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it('the kernel records a mint in the state directory and leaves the project tree as the queue leaves it; a second proposal of the same text mints once', () => {
    const ports: SkillStatePorts = { checkout: () => BINDING, stateDir: state };
    const proposal = value(proposeSkill(nodeSystem, repo, WORKER, { files: FILES }, ports));
    expect(isSkillMinted(nodeSystem, ports, proposal.proposalHash)).toBe(true);
    const mintDirs = readdirSync(join(state, 'skill-mint'));
    expect(mintDirs).toHaveLength(1);
    expect(readdirSync(join(state, 'skill-mint', mintDirs[0] as string))).toEqual([`${proposal.proposalHash.slice('sha256:'.length)}.json`]);
    const status = spawnSync('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).stdout.split('\n').filter((line) => line !== '');
    // The proposal file is the queue's own and is the PRE-EXISTING record in the project tree (named residual, L9); the mint adds nothing beside it.
    expect(status.map((line) => line.slice(3))).toEqual([`.projectops/skills/proposals/${proposal.id}.json`]);
    expect(code(recordSkillMint(nodeSystem, ports, proposal.proposalHash))).toBe('ok');
    expect(readdirSync(join(state, 'skill-mint', mintDirs[0] as string))).toHaveLength(1);
  });
});
