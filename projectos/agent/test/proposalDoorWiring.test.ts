/**
 * The proposal door is called by the loop (PROJECTOS-PROPOSAL-DOOR-WIRING1A, plan v1.38, rules DW-1 .. DW-12).
 *
 * The same in-memory world as `loopContext.test.ts` (a copy in `support/loopWorld.ts`): the real config and approved plan, a fake worker
 * that writes what a real one could, and a `git status` worked out from the files. `hidden` is what git ignores, so a test can say
 * "this directory is git-ignored" and watch the digest do the work the path check cannot. DW-7 uses a real temporary git repository.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { assembleRunContext, summariserKindOf } from '../src/context/contextManager.js';
import { beginStoreGuard, endStoreGuard, rebaseStoreGuard, type StoreGuardSystem } from '../src/context/contextStoreGuard.js';
import { PROPOSALS_BUDGET_BYTES, proposalBudgetOf, storeBytesNow, storeUsageNow } from '../src/context/proposalBudget.js';
import { afterProposalDoor, doorCreatedPaths, doorOutcomeLines } from '../src/context/proposalDoorStep.js';
import { openProposalDoor, type DoorEntryOutcome, type ProposalDoorCaller } from '../src/memory/proposalDoor.js';
import { listPendingMemoryProposals } from '../src/memory/proposalQueue.js';
import { MAX_STORE_DIGEST_FILES, MAX_STORE_DIGEST_TOTAL_BYTES, snapshotMemoryStores } from '../src/memory/storeDigest.js';
import { isSkillMinted, type SkillStatePorts } from '../src/skills/skillMint.js';
import { listPendingSkillProposals } from '../src/skills/skillQueue.js';
import { nodeSystem } from '../src/system.js';
import { nodeEntryProbe } from '../src/search/nodeHost.js';
import { documentFsOver } from '../src/search/ports.js';
import { EXECUTION, EVIDENCE_PATH, ROOT, SESSION, STATE, contextPorts, run, world, worker, type World } from './support/loopWorld.js';
import { ENVELOPE_NOW, admittedRun, memoryFs, provenanceOf, storeText, worldPorts, ROOT as CONTEXT_ROOT } from './support/contextWorld.js';

/**
 * DW-9 goes through the kernel's own compaction: every draft the context manager hands to `applyCompaction` is recorded here, then really applied,
 * so the kind is read where the compaction is made and the kernel still accepts or refuses it as it always did.
 */
const appliedDrafts = vi.hoisted(() => [] as { readonly summarisedBy: string; readonly session: string }[]);
vi.mock('@projectos/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@projectos/core')>();
  return {
    ...actual,
    applyCompaction: (...args: Parameters<typeof actual.applyCompaction>): ReturnType<typeof actual.applyCompaction> => {
      appliedDrafts.push({ summarisedBy: args[2].summarisedBy, session: args[2].session });
      return actual.applyCompaction(...args);
    },
  };
});

const FINDINGS_PATH = `${EXECUTION}/${SESSION}.findings.json`;
const MEMORY_PROPOSALS = `${ROOT}/.projectops/memory/proposals`;
const SKILL_PROPOSALS = `${ROOT}/.projectops/skills/proposals`;
const CANARY = 'CANARY-WORKER-TEXT-7f3a';

const memoryAsk = (content = 'The release is cut from main only.'): Record<string, unknown> => ({ class: 'memory', target: 'memory', op: 'add', kind: 'fact', content });
const skillAsk = (): Record<string, unknown> => ({
  class: 'skill',
  files: [{ path: 'SKILL.md', text: '---\nname: release-check\ndescription: Check a release.\n---\n\nRun the release checklist in order.\n' }],
});
const baseRecord = { reviews: ['code-review', 'security-review'], findings: [{ id: 'F1', severity: 'LOW', category: 'style', summary: 'nit', resolved: true }] };

function ask(w: World, proposals: readonly unknown[]): void {
  w.files[FINDINGS_PATH] = JSON.stringify({ ...baseRecord, proposals });
}

/** What git does with the two proposal directories once `.gitignore` names them. */
function gitIgnoresProposals(w: World): void {
  const had = w.hidden.has.bind(w.hidden);
  w.hidden.has = (path: string): boolean => had(path) || /\/\.projectops\/(?:memory|skills)\/proposals\//.test(path);
}

const filesUnder = (w: World, dir: string): string[] => Object.keys(w.files).filter((path) => path.startsWith(`${dir}/`));
const stopOf = (result: ReturnType<typeof run>) => (result.ok ? result.stop : null);

describe('DW-1: the door gives the skill queue its state ports, so a skill proposal can be reviewed', () => {
  const caller: ProposalDoorCaller = { author: 'worker-1', role: 'implementer', session: 'sess-1' };
  const state: SkillStatePorts = { checkout: () => ({ tenant: 'polygo', project: 'polygo' }), stateDir: STATE };
  const text = JSON.stringify({ ...baseRecord, proposals: [skillAsk()] });
  const hashOf = (entry: DoorEntryOutcome | undefined): string => {
    if (entry === undefined || !entry.ok) throw new Error('not accepted');
    return entry.proposalHash;
  };

  it('records the mint when it is given state, and the proposal then reads as minted for this checkout', () => {
    const w = world();
    const outcome = openProposalDoor(w.sys, ROOT, caller, text, state);
    expect(isSkillMinted(w.sys, state, hashOf(outcome.entries[0]))).toBe(true);
    expect(listPendingSkillProposals(w.sys, ROOT).pending).toHaveLength(1);
  });

  it('records no mint without state, which is how the door behaved before it was wired', () => {
    const w = world();
    const outcome = openProposalDoor(w.sys, ROOT, caller, text);
    expect(isSkillMinted(w.sys, state, hashOf(outcome.entries[0]))).toBe(false);
  });

  it('a run mints the proposal in the installation state, outside the project tree', () => {
    const w = world();
    ask(w, [skillAsk()]);
    const result = run(w, worker(w));
    expect(result.ok).toBe(true);
    const mints = Object.keys(w.files).filter((path) => path.startsWith(`${STATE}/skill-mint/`));
    expect(mints).toHaveLength(1);
    expect(Object.keys(w.files).some((path) => path.startsWith(`${ROOT}/`) && path.includes('skill-mint'))).toBe(false);
    expect(filesUnder(w, SKILL_PROPOSALS)).toHaveLength(1);
  });
});

describe('DW-2: the door runs once per attempt, after the post-checks store judgement and before the evidence is written', () => {
  it('writes the proposal after the checks ran and before the evidence record', () => {
    const w = world();
    ask(w, [memoryAsk()]);
    const result = run(w, worker(w));
    expect(result.ok).toBe(true);
    const wrote = w.sys.writes;
    const proposalAt = wrote.findIndex((path) => path.startsWith(`${MEMORY_PROPOSALS}/`));
    const evidenceAt = wrote.findIndex((path) => path === EVIDENCE_PATH);
    expect(proposalAt).toBeGreaterThan(-1);
    expect(evidenceAt).toBeGreaterThan(proposalAt);
    expect(w.commands.findIndex((command) => !command.startsWith('git'))).toBeGreaterThan(-1);
  });

  it('is not reached when check code wrote a store: nothing is proposed for a run the judgement stopped', () => {
    const w = world({ onValidator: (files) => void (files[`${ROOT}/.projectops/skills/promoted/x/SKILL.md`] = 'written by a check') });
    ask(w, [memoryAsk()]);
    const result = run(w, worker(w));
    expect(stopOf(result)?.code).toBe('SCOPE_DECISION');
    expect(filesUnder(w, MEMORY_PROPOSALS)).toEqual([]);
  });

  it('turns a memory entry and a skill entry of one record into one pending proposal each', () => {
    const w = world();
    ask(w, [memoryAsk(), skillAsk()]);
    run(w, worker(w));
    expect(listPendingMemoryProposals(w.sys, ROOT).pending).toHaveLength(1);
    expect(listPendingSkillProposals(w.sys, ROOT).pending).toHaveLength(1);
  });
});

describe('DW-3: one entry is exactly one pending proposal, pinned by hash; the same entry again is a duplicate', () => {
  it('across correction attempts the same record stays one proposal and every attempt reaches the end of the loop', () => {
    const w = world({ validatorExit: 1 });
    ask(w, [memoryAsk()]);
    const wk = worker(w);
    const result = run(w, wk);
    expect(wk.calls.length).toBeGreaterThan(1);
    expect(stopOf(result)?.code).not.toBe('SCOPE_DECISION');
    expect(filesUnder(w, MEMORY_PROPOSALS)).toHaveLength(1);
    const pending = listPendingMemoryProposals(w.sys, ROOT).pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.proposalHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(pending[0]).toMatchObject({ state: 'pending', decision: null });
  });

  it('says so on the second attempt: a duplicate, with the id and hash of the first', () => {
    const w = world({ validatorExit: 1 });
    ask(w, [memoryAsk()]);
    const result = run(w, worker(w));
    const door = result.lines.filter((line) => line.includes('proposal door'));
    expect(door.length).toBeGreaterThan(1);
    const hash = listPendingMemoryProposals(w.sys, ROOT).pending[0]?.proposalHash ?? 'missing';
    expect(result.lines.filter((line) => line.includes(hash) && line.includes('already pending')).length).toBeGreaterThan(0);
  });
});

describe('DW-3, the duplicate key: the target an entry acts on is part of what makes it the same entry', () => {
  const caller: ProposalDoorCaller = { author: 'worker-1', role: 'implementer', session: 'sess-1' };
  const SECOND = 'The database is Postgres 16.';
  const replace = (oldText: string, content = 'Replaced entry text.'): Record<string, unknown> => ({ class: 'memory', target: 'memory', op: 'replace', kind: 'fact', oldText, content });
  const door = (w: World, proposals: readonly unknown[]) => openProposalDoor(w.sys, ROOT, caller, JSON.stringify({ ...baseRecord, proposals }));
  const withTwoFacts = (): World => {
    const w = world();
    const entries = ['The build uses Node 24.', SECOND];
    w.files[`${ROOT}/.projectops/memory/MEMORY.md`] = storeText(entries);
    w.files[`${ROOT}/.projectops/memory/MEMORY.provenance.json`] = JSON.stringify({ entries: Object.fromEntries(entries.map((entry) => [provenanceOf(entry).entryHash, provenanceOf(entry)])) });
    return w;
  };

  it('two replaces with the same new content but different targets are two proposals', () => {
    const w = withTwoFacts();
    const outcome = door(w, [replace('Node 24'), replace('Postgres 16')]);
    expect(outcome.entries.map((entry) => entry.ok && entry.duplicate)).toEqual([false, false]);
    expect(listPendingMemoryProposals(w.sys, ROOT).pending).toHaveLength(2);
  });

  it('the same replace of the same target twice is still one proposal and a duplicate', () => {
    const w = withTwoFacts();
    const outcome = door(w, [replace('Node 24'), replace('Node 24')]);
    expect(outcome.entries.map((entry) => entry.ok && entry.duplicate)).toEqual([false, true]);
    expect(listPendingMemoryProposals(w.sys, ROOT).pending).toHaveLength(1);
  });

  it('two adds with the same content and different ledger references are two proposals', () => {
    const w = world();
    const cited = (ledgerRef: string): Record<string, unknown> => ({ class: 'memory', target: 'memory', op: 'add', kind: 'fact', content: 'Bookings are never hard deleted.', ledgerRef });
    const outcome = door(w, [cited('docs/changes/delta_spec_a.md'), cited('docs/changes/delta_spec_b.md')]);
    expect(outcome.entries.map((entry) => entry.ok && entry.duplicate)).toEqual([false, false]);
    expect(listPendingMemoryProposals(w.sys, ROOT).pending).toHaveLength(2);
  });
});

describe('DW-4: who proposed is the kernel\'s to say', () => {
  it('records the worker the loop ran, the implementer role and this session, whatever the entry claims', () => {
    const w = world();
    ask(w, [memoryAsk(), { ...memoryAsk('Another fact the worker wants kept.'), author: 'owner', authorRole: 'owner', role: 'owner' }]);
    const result = run(w, worker(w));
    const pending = listPendingMemoryProposals(w.sys, ROOT).pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.provenance).toMatchObject({ author: 'test', authorRole: 'implementer', session: SESSION });
    expect(result.lines.join('\n')).toMatch(/REFUSED \(/);
  });
});

describe('DW-5: a worker write to a proposals path is still refused, although git ignores the directory', () => {
  it.each([
    ['memory', `${MEMORY_PROPOSALS}/mem-000000000000000000000001.json`],
    ['skill', `${SKILL_PROPOSALS}/skl-000000000000000000000001.json`],
  ])('refuses a %s proposal the worker wrote itself, by the digest', (_name, path) => {
    const w = world();
    gitIgnoresProposals(w);
    const wk = worker(w, () => {
      w.files[path] = '{"approved":true}';
    });
    const result = run(w, wk);
    expect(stopOf(result)?.code).toBe('SCOPE_DECISION');
    expect(stopOf(result)?.detail).toContain('MEMORY_STORE_CHANGED');
  });

  it('refuses it when git does show it, by the path rule', () => {
    const w = world();
    const wk = worker(w, () => {
      w.files[`${MEMORY_PROPOSALS}/p.json`] = '{"approved":true}';
    });
    expect(stopOf(run(w, wk))?.detail).toContain('MEMORY_DIRECT_WRITE');
  });
});

describe('DW-6: after the door the guard is re-baselined for exactly the files the door made', () => {
  it.each([
    ['git shows the new proposal', false],
    ['git ignores the proposals directories', true],
  ])('the next attempt is not refused for the kernel\'s own proposal (%s)', (_name, ignored) => {
    const w = world({ validatorExit: 1 });
    if (ignored) gitIgnoresProposals(w);
    ask(w, [memoryAsk(), skillAsk()]);
    const wk = worker(w);
    const result = run(w, wk);
    expect(wk.calls.length).toBeGreaterThan(1);
    expect(stopOf(result)?.code).not.toBe('SCOPE_DECISION');
    expect(result.lines.join('\n')).not.toContain('MEMORY_DIRECT_WRITE');
    expect(result.lines.join('\n')).not.toContain('MEMORY_STORE_CHANGED');
  });

  it.each([
    ['visible to git', false, 'MEMORY_DIRECT_WRITE'],
    ['git-ignored', true, 'MEMORY_STORE_CHANGED'],
  ])('a worker file placed beside the door\'s file in the next attempt is still refused (%s)', (_name, ignored, code) => {
    const w = world({ validatorExit: 1 });
    if (ignored) gitIgnoresProposals(w);
    ask(w, [memoryAsk()]);
    const wk = worker(w, (attempt) => {
      if (attempt === 2) w.files[`${MEMORY_PROPOSALS}/mem-0000000000000000000000ff.json`] = '{"approved":true}';
    });
    const result = run(w, wk);
    expect(wk.calls).toHaveLength(2);
    expect(stopOf(result)?.code).toBe('SCOPE_DECISION');
    expect(stopOf(result)?.detail).toContain(code);
  });

  it('a worker file in a skills directory beside the door\'s is refused too', () => {
    const w = world({ validatorExit: 1 });
    gitIgnoresProposals(w);
    ask(w, [skillAsk()]);
    const wk = worker(w, (attempt) => {
      if (attempt === 2) w.files[`${SKILL_PROPOSALS}/skl-0000000000000000000000ff.json`] = '{"approved":true}';
    });
    expect(stopOf(run(w, wk))?.detail).toContain('MEMORY_STORE_CHANGED');
  });
});

describe('DW-6, the guard itself: rebaseStoreGuard absorbs only what it is told the door made', () => {
  const MEM = '.projectops/memory/proposals/mem-aaaaaaaaaaaaaaaaaaaaaaaa.json';
  const OTHER = '.projectops/memory/proposals/mem-bbbbbbbbbbbbbbbbbbbbbbbb.json';

  function guarded(files: Record<string, string>) {
    const state = { files: { ...files }, status: '' };
    const sys: StoreGuardSystem = { exec: () => ({ code: 0, stdout: state.status }) };
    const fs = { stat: (p: string) => memoryFs(state.files).stat(p), readText: (p: string) => memoryFs(state.files).readText(p), listDir: (p: string) => memoryFs(state.files).listDir(p) };
    return { state, sys, fs };
  }

  it('absorbs the file and its new parent directories, and then judges the next worker against that', () => {
    const g = guarded({ [`${ROOT}/.projectops/memory/MEMORY.md`]: 'one' });
    const before = beginStoreGuard(g.sys, ROOT, g.fs);
    g.state.files[`${ROOT}/${MEM}`] = '{"id":"a"}';
    g.state.status = `?? ${MEM}\0`;
    const rebased = rebaseStoreGuard(g.sys, ROOT, g.fs, before, [MEM]);
    expect(rebased.absorbed).toBe(true);
    expect(endStoreGuard(g.sys, ROOT, g.fs, rebased.baseline)).toEqual({ ok: true });
    g.state.files[`${ROOT}/${OTHER}`] = '{"approved":true}';
    g.state.status = `?? ${MEM}\0?? ${OTHER}\0`;
    expect(endStoreGuard(g.sys, ROOT, g.fs, rebased.baseline)).toMatchObject({ ok: false, code: 'MEMORY_DIRECT_WRITE' });
  });

  it('keeps the old baseline when something else changed beside the door\'s file, so the next judgement refuses it', () => {
    const g = guarded({});
    const before = beginStoreGuard(g.sys, ROOT, g.fs);
    g.state.files[`${ROOT}/${MEM}`] = '{"id":"a"}';
    g.state.files[`${ROOT}/${OTHER}`] = '{"approved":true}';
    const rebased = rebaseStoreGuard(g.sys, ROOT, g.fs, before, [MEM]);
    expect(rebased.absorbed).toBe(false);
    expect(rebased.baseline).toBe(before);
    expect(endStoreGuard(g.sys, ROOT, g.fs, rebased.baseline)).toMatchObject({ ok: false, code: 'MEMORY_STORE_CHANGED' });
  });

  it('refuses to absorb a change to a file that was already there, and a removal', () => {
    const g = guarded({ [`${ROOT}/${MEM}`]: 'old', [`${ROOT}/.projectops/memory/MEMORY.md`]: 'one' });
    const before = beginStoreGuard(g.sys, ROOT, g.fs);
    g.state.files[`${ROOT}/${MEM}`] = 'rewritten';
    expect(rebaseStoreGuard(g.sys, ROOT, g.fs, before, [MEM]).absorbed).toBe(false);
    g.state.files[`${ROOT}/${MEM}`] = 'old';
    delete g.state.files[`${ROOT}/.projectops/memory/MEMORY.md`];
    expect(rebaseStoreGuard(g.sys, ROOT, g.fs, before, [MEM]).absorbed).toBe(false);
  });

  it.each([
    ['a path outside the proposals directories', '.projectops/memory/MEMORY.md'],
    ['a path that climbs', '.projectops/memory/proposals/../MEMORY.md'],
    ['a skill outside proposals', '.projectops/skills/promoted/x.json'],
    ['a path that is not under a store', 'src/a.ts'],
  ])('is never told to absorb %s', (_name, path) => {
    const g = guarded({});
    const before = beginStoreGuard(g.sys, ROOT, g.fs);
    g.state.files[`${ROOT}/${path}`] = 'x';
    expect(rebaseStoreGuard(g.sys, ROOT, g.fs, before, [path]).absorbed).toBe(false);
  });

  it('keeps the old baseline when the baseline could not be taken, or git cannot say', () => {
    const g = guarded({});
    const before = beginStoreGuard(g.sys, ROOT, g.fs);
    const blind: StoreGuardSystem = { exec: () => ({ code: 128, stdout: '' }) };
    g.state.files[`${ROOT}/${MEM}`] = '{}';
    const rebased = rebaseStoreGuard(blind, ROOT, g.fs, before, [MEM]);
    expect(rebased.absorbed).toBe(false);
    expect(rebased.baseline).toBe(before);
  });

  it('with nothing made, there is nothing to absorb and the baseline is the one it was', () => {
    const g = guarded({});
    const before = beginStoreGuard(g.sys, ROOT, g.fs);
    const rebased = rebaseStoreGuard(g.sys, ROOT, g.fs, before, []);
    expect(rebased).toEqual({ baseline: before, absorbed: true });
  });
});

describe('DW-7: the two proposals directories are git-ignored, and nothing else of the stores is', () => {
  const GITIGNORE = readFileSync(resolve(__dirname, '../../../.gitignore'), 'utf8');

  it('holds exactly the two lines', () => {
    const lines = GITIGNORE.split(/\r?\n/);
    expect(lines.filter((line) => line === '.projectops/memory/proposals/')).toHaveLength(1);
    expect(lines.filter((line) => line === '.projectops/skills/proposals/')).toHaveLength(1);
    expect(lines.filter((line) => /MEMORY\.md|USER\.md|promoted/.test(line) && !line.startsWith('#'))).toEqual([]);
  });

  it('git status is clean after a real door on a real repository, and MEMORY.md and promoted skills still show', () => {
    const dir = mkdtempSync(join(tmpdir(), 'projectos-door-'));
    try {
      const git = (...args: string[]): string => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
      git('init', '-q');
      writeFileSync(join(dir, '.gitignore'), GITIGNORE);
      git('add', '.gitignore');
      git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'ignore');
      const text = JSON.stringify({ ...baseRecord, proposals: [memoryAsk(), skillAsk()] });
      const state: SkillStatePorts = { checkout: () => ({ tenant: 'polygo', project: 'polygo' }), stateDir: join(dir, 'state').replace(/\\/g, '/') };
      const outcome = openProposalDoor(nodeSystem, dir.replace(/\\/g, '/'), { author: 'worker-1', role: 'implementer', session: 'sess-1' }, text, state);
      expect(outcome.entries.filter((entry) => entry.ok)).toHaveLength(2);
      expect(readdirSync(join(dir, '.projectops/memory/proposals'))).toHaveLength(1);
      expect(readdirSync(join(dir, '.projectops/skills/proposals'))).toHaveLength(1);
      expect(git('status', '--porcelain', '--untracked-files=all', '--', '.projectops')).toBe('');
      mkdirSync(join(dir, '.projectops/skills/promoted'), { recursive: true });
      writeFileSync(join(dir, '.projectops/skills/promoted/x.json'), '{}');
      writeFileSync(join(dir, '.projectops/memory/MEMORY.md'), 'a fact');
      const shown = git('status', '--porcelain', '--untracked-files=all', '--', '.projectops');
      expect(shown).toContain('.projectops/skills/promoted/x.json');
      expect(shown).toContain('.projectops/memory/MEMORY.md');
      expect(shown).not.toContain('proposals');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the digest guard watches the ignored directories: a worker file there is refused on a real repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'projectos-door-'));
    try {
      const root = dir.replace(/\\/g, '/');
      const git = (...args: string[]): string => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
      git('init', '-q');
      writeFileSync(join(dir, '.gitignore'), GITIGNORE);
      const fs = documentFsOver(nodeSystem, nodeEntryProbe);
      const before = beginStoreGuard(nodeSystem, root, fs);
      mkdirSync(join(dir, '.projectops/memory/proposals'), { recursive: true });
      writeFileSync(join(dir, '.projectops/memory/proposals/mem-cccccccccccccccccccccccc.json'), '{"approved":true}');
      expect(endStoreGuard(nodeSystem, root, fs, before)).toMatchObject({ ok: false, code: 'MEMORY_STORE_CHANGED' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('DW-8: no door call on a refused worker, a dry run, or an unreadable findings record', () => {
  it.each([
    ['exited non-zero', { kind: 'completed' as const, exitCode: 2, stdout: '', stderr: 'no', providerRef: null }, 'the worker exited 2 - no'],
    ['said it refused', { kind: 'refused' as const, detail: 'the task is outside what this worker will do' }, 'the task is outside what this worker will do'],
  ])('a worker that %s ends the run at WORKER_REFUSED and makes no proposal', (_name, outcome, detail) => {
    const w = world();
    ask(w, [memoryAsk(), skillAsk()]);
    const failing = worker(w);
    let starts = 0;
    const refusing = { ...failing.registry, 'claude-code-cli': { ...failing.registry['claude-code-cli']!, start: () => (starts += 1, outcome) } };
    const result = run(w, { ...failing, registry: refusing });
    // The run stopped at the refusal itself: the stop is the worker's, it is the only attempt, and the loop never got as far as the door.
    expect(result.ok).toBe(true);
    expect(stopOf(result)?.code).toBe('WORKER_REFUSED');
    expect(stopOf(result)?.detail).toContain(detail.replace(' - ', ' \u2014 '));
    expect(starts).toBe(1);
    expect(result.ok ? result.attempts : null).toBe(0);
    expect(result.lines.some((line) => line.startsWith('attempt 1:'))).toBe(true);
    expect(result.lines.some((line) => /proposal/i.test(line))).toBe(false);
    expect(filesUnder(w, MEMORY_PROPOSALS)).toEqual([]);
    expect(filesUnder(w, SKILL_PROPOSALS)).toEqual([]);
  });

  it('a dry run makes no proposal and writes nothing', () => {
    const w = world();
    ask(w, [memoryAsk()]);
    const result = run(w, worker(w), { dryRun: true });
    expect(result.ok).toBe(true);
    expect(w.sys.writes).toEqual([]);
    expect(filesUnder(w, MEMORY_PROPOSALS)).toEqual([]);
  });

  it.each([
    ['not JSON', 'this is not json'],
    ['a record whose findings the loop itself refuses', JSON.stringify({ reviews: [], findings: [{ severity: 'SEVERE' }], proposals: [memoryAsk()] })],
  ])('an unreadable findings record (%s) makes no proposal', (_name, text) => {
    const w = world();
    w.files[FINDINGS_PATH] = text;
    run(w, worker(w));
    expect(filesUnder(w, MEMORY_PROPOSALS)).toEqual([]);
  });

  it('an absent findings record makes no proposal and no directory', () => {
    const w = world();
    delete w.files[FINDINGS_PATH];
    run(w, worker(w));
    expect(filesUnder(w, MEMORY_PROPOSALS)).toEqual([]);
    expect(filesUnder(w, SKILL_PROPOSALS)).toEqual([]);
  });
});

describe('DW-9: a deterministic compaction is recorded under a deterministic kind', () => {
  it('is the deterministic kind when no drafter port exists, and the agent-model kind when one does', () => {
    expect(summariserKindOf(undefined)).toBe('deterministic-selection');
    expect(summariserKindOf((): never => { throw new Error('not called'); })).toBe('agent-model');
  });

  /** Twelve committed decisions of about 5000 characters each: more than the context window holds, so the manager has to compact. */
  const decisionIds = Array.from({ length: 12 }, (_, index) => `PHASE-${String(index).padStart(2, '0')}`);
  const decisionTree = (): Record<string, string> =>
    Object.fromEntries(decisionIds.map((id) => [`.projectops/closure/decisions/${id}.json`, `{"note":"${`BODY-${id} closed after review. `.repeat(167).slice(0, 5000)}"}`]));
  const compactionRequest = {
    envelope: admittedRun(),
    sessionId: 'PHASE-abcdef012345-1a2b3c4d',
    root: CONTEXT_ROOT,
    query: 'booking panel',
    dependsOn: decisionIds,
    planMemoryPaths: [],
    nowIso: ENVELOPE_NOW,
  };

  it('the context manager applies the compaction it made itself under deterministic-selection, and the kernel accepts it', () => {
    appliedDrafts.length = 0;
    const result = assembleRunContext(worldPorts({ tree: decisionTree() }).ports, compactionRequest);
    expect(result.kind).toBe('ready');
    expect(result.kind === 'ready' ? result.compactor : null).toBe('deterministic-selection');
    expect(result.kind === 'ready' ? result.compactionId : null).toMatch(/^ctx-[0-9a-f]{24}$/);
    expect(appliedDrafts).toEqual([{ summarisedBy: 'deterministic-selection', session: compactionRequest.sessionId }]);
  });

  it('records the agent-model kind for the same compaction when a drafter port wrote it', () => {
    appliedDrafts.length = 0;
    const drafter = (plan: { readonly summarise: readonly unknown[] }): { readonly text: string; readonly complete: true } => ({ text: `Summary of ${plan.summarise.length} earlier turns, by a model.`, complete: true });
    const result = assembleRunContext({ ...worldPorts({ tree: decisionTree() }).ports, drafter: drafter as never }, compactionRequest);
    expect(result.kind).toBe('ready');
    expect(appliedDrafts.map((draft) => draft.summarisedBy)).toEqual(['agent-model']);
  });

  it('makes no draft at all when everything fits, so no kind is recorded for a compaction that did not happen', () => {
    appliedDrafts.length = 0;
    const result = assembleRunContext(worldPorts({ tree: {} }).ports, { ...compactionRequest, dependsOn: [] });
    expect(result.kind === 'ready' ? result.compactor : null).toBe('none');
    expect(appliedDrafts).toEqual([]);
  });
});

describe('DW-10: runner.ts is the only caller of the door, and imports no propose or write entry point', () => {
  const sourceDir = resolve(__dirname, '../src');
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []));

  it('calls openProposalDoor from one file in src, and that file is the runner', () => {
    const callers = walk(sourceDir).filter((file) => /(?<![.\w])openProposalDoor\(/.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')) && !file.endsWith('proposalDoor.ts'));
    expect(callers.map((file) => file.replace(/\\/g, '/').split('/src/')[1])).toEqual(['loop/runner.ts']);
  });

  it('the runner imports the door and nothing that proposes, approves or promotes', () => {
    const runner = readFileSync(join(sourceDir, 'loop/runner.ts'), 'utf8');
    expect(runner).toMatch(/import \{ openProposalDoor \} from '\.\.\/memory\/proposalDoor\.js';/);
    expect(runner).not.toMatch(/\b(?:proposeMemoryWrite|proposeSkill|importSkill|approveMemoryProposal|reviewAndPromoteSkill|rejectSkillProposal|writeMemoryEntries)\b/);
  });
});

describe('DW-11: outcome lines carry codes, ids and hashes, never worker text', () => {
  it('quotes none of the entry, accepted or refused, in the run output', () => {
    const w = world();
    ask(w, [
      memoryAsk(`${CANARY} accepted memory`),
      { class: 'memory', target: 'memory', op: 'add', kind: 'fact', content: `${CANARY} sk-ant-api03-${'a'.repeat(40)}` },
      { class: 'nonsense', note: CANARY },
      { ...skillAsk(), note: CANARY },
    ]);
    const result = run(w, worker(w));
    const door = result.lines.filter((line) => line.includes('proposal'));
    expect(door.length).toBeGreaterThan(0);
    expect(result.lines.join('\n')).not.toContain(CANARY);
    expect(door.join('\n')).toMatch(/sha256:[0-9a-f]{64}/);
    expect(door.join('\n')).toMatch(/REFUSED \([A-Z_]+\)/);
  });

  it('the line builder says nothing but a code, an index, a class, an id and a hash', () => {
    const lines = doorOutcomeLines({
      findings: 'read',
      entries: [
        { ok: true, index: 0, class: 'memory', id: 'mem-aaaaaaaaaaaaaaaaaaaaaaaa', proposalHash: `sha256:${'a'.repeat(64)}`, state: 'pending', duplicate: false },
        { ok: false, index: 1, class: 'skill', code: 'SKILL_BAD', message: CANARY },
        { ok: false, index: null, class: null, code: 'PROPOSAL_DOOR_UNREADABLE', message: CANARY },
      ],
    });
    expect(lines.join('\n')).not.toContain(CANARY);
    expect(lines.join('\n')).toContain('SKILL_BAD');
    expect(lines.join('\n')).toContain('PROPOSAL_DOOR_UNREADABLE');
  });

  it('is bounded: a record with many refused entries prints a few lines and says how many more', () => {
    const entries = Array.from({ length: 200 }, (_, index) => ({ ok: false as const, index, class: null, code: 'PROPOSAL_ENTRY_INVALID', message: CANARY }));
    const lines = doorOutcomeLines({ findings: 'read', entries });
    expect(lines.length).toBeLessThan(40);
    expect(lines.join('\n')).toMatch(/and \d+ more/);
  });

  it('names the files the door made, and only for an accepted, new proposal', () => {
    const paths = doorCreatedPaths({
      findings: 'read',
      entries: [
        { ok: true, index: 0, class: 'memory', id: 'mem-aaaaaaaaaaaaaaaaaaaaaaaa', proposalHash: `sha256:${'a'.repeat(64)}`, state: 'pending', duplicate: false },
        { ok: true, index: 1, class: 'skill', id: 'skl-bbbbbbbbbbbbbbbbbbbbbbbb', proposalHash: `sha256:${'b'.repeat(64)}`, state: 'pending', duplicate: false },
        { ok: true, index: 2, class: 'memory', id: 'mem-cccccccccccccccccccccccc', proposalHash: `sha256:${'c'.repeat(64)}`, state: 'pending', duplicate: true },
        { ok: false, index: 3, class: 'memory', code: 'X', message: 'y' },
      ],
    });
    expect(paths).toEqual(['.projectops/memory/proposals/mem-aaaaaaaaaaaaaaaaaaaaaaaa.json', '.projectops/skills/proposals/skl-bbbbbbbbbbbbbbbbbbbbbbbb.json']);
  });
});

describe('DW-12: the proposals the door has made cannot grow the stores past what the guard can digest', () => {
  const caller: ProposalDoorCaller = { author: 'worker-1', role: 'implementer', session: 'sess-1' };
  const state: SkillStatePorts = { checkout: () => ({ tenant: 'polygo', project: 'polygo' }), stateDir: STATE };
  const LINE = ' lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor';

  /** About a megabyte of skill, distinct per `seed`: three reference files of ~250 thousand characters and a fourth of ~250 thousand, lines under the 4096 a line may hold. */
  function bigSkill(seed: number): Record<string, unknown> {
    const file = (salt: number): string => Array.from({ length: 250 }, (_, line) => `${seed}-${salt}-${line}${LINE.repeat(13)}`.slice(0, 1000)).join('\n');
    const name = `big-${String.fromCharCode(97 + seed)}`;
    return {
      class: 'skill',
      files: [
        { path: 'SKILL.md', text: `---\nname: ${name}\ndescription: A large skill number ${seed}.\n---\n\nRun it.\n` },
        { path: 'references/a.md', text: file(1) },
        { path: 'references/b.md', text: file(2) },
        { path: 'references/c.md', text: file(3) },
        { path: 'references/d.md', text: file(4) },
      ],
    };
  }
  const recordOf = (...proposals: unknown[]): string => JSON.stringify({ ...baseRecord, proposals });
  const gitIgnored = (w: World): void => gitIgnoresProposals(w);
  const FILLER = `${ROOT}/.projectops/memory/filler.txt`;

  it('the lock-out this prevents: ten large proposals through the door with no budget leave a store the digest refuses, so every later run would be', () => {
    const w = world();
    const fs = contextPorts(w).fs;
    for (let seed = 0; seed < 10; seed += 1) {
      const outcome = openProposalDoor(w.sys, ROOT, caller, recordOf(bigSkill(seed)), state);
      expect(outcome.entries[0]?.ok).toBe(true);
    }
    const snapshot = snapshotMemoryStores(ROOT, fs);
    expect(snapshot.ok).toBe(false);
    expect(snapshot.ok ? '' : snapshot.code).toBe('MEMORY_STORE_TOO_LARGE');
  }, 120_000);

  it('with the budget the first are accepted and the rest refused with a code, nothing is written for a refused one, and the guard still clears', () => {
    const w = world();
    gitIgnored(w);
    const fs = contextPorts(w).fs;
    let baseline = beginStoreGuard(w.sys, ROOT, fs);
    const answers: DoorEntryOutcome[] = [];
    for (let seed = 0; seed < 10; seed += 1) {
      const outcome = openProposalDoor(w.sys, ROOT, caller, recordOf(bigSkill(seed)), state, proposalBudgetOf(fs, ROOT));
      baseline = afterProposalDoor(w.sys, ROOT, fs, baseline, outcome).baseline;
      answers.push(...outcome.entries);
    }
    const accepted = answers.filter((answer) => answer.ok);
    const refused = answers.filter((answer) => !answer.ok);
    expect(accepted.length).toBeGreaterThan(0);
    expect(refused.length).toBeGreaterThan(0);
    // The first N are accepted and everything after is refused: the budget is a line, and nothing past it is let in.
    expect(answers.map((answer) => answer.ok)).toEqual([...accepted.map(() => true), ...refused.map(() => false)]);
    expect(refused.every((answer) => !answer.ok && answer.code === 'PROPOSAL_DOOR_BUDGET')).toBe(true);
    expect(refused.map((answer) => (answer.ok ? '' : answer.message)).join(' ')).not.toContain('lorem');
    // The message is fixed text: it says that a decided proposal still counts (nothing prunes it), and it carries none of the worker's text.
    expect(refused.every((answer) => !answer.ok && answer.message.includes('stay on disk and still count') && !answer.message.includes('asked again'))).toBe(true);
    expect(filesUnder(w, SKILL_PROPOSALS)).toHaveLength(accepted.length);
    // The stores are under the budget, which is under what the digest bound refuses.
    const used = storeBytesNow(fs, ROOT);
    expect(used).not.toBeNull();
    expect(used ?? Infinity).toBeLessThanOrEqual(PROPOSALS_BUDGET_BYTES);
    expect(PROPOSALS_BUDGET_BYTES).toBeLessThan(MAX_STORE_DIGEST_TOTAL_BYTES);
    expect(snapshotMemoryStores(ROOT, fs).ok).toBe(true);
    // THE PIN: the next judgement of the guard, against the baseline the loop now holds, is not a refusal.
    expect(endStoreGuard(w.sys, ROOT, fs, baseline)).toEqual({ ok: true });
  }, 120_000);

  it('a refused entry does not stop an accepted one beside it from being absorbed, and the next attempt of the run is not refused by the guard', () => {
    const w = world({ validatorExit: 1 });
    gitIgnored(w);
    // The stores already hold almost everything the budget allows: room for a small entry, none for a large one.
    w.files[FILLER] = 'f'.repeat(PROPOSALS_BUDGET_BYTES - 400_000);
    w.hidden.add(FILLER);
    ask(w, [memoryAsk(), bigSkill(0)]);
    const wk = worker(w);
    const result = run(w, wk);
    expect(wk.calls.length).toBeGreaterThan(1);
    expect(stopOf(result)?.code).not.toBe('SCOPE_DECISION');
    expect(filesUnder(w, MEMORY_PROPOSALS)).toHaveLength(1);
    expect(filesUnder(w, SKILL_PROPOSALS)).toEqual([]);
    const door = result.lines.filter((line) => line.startsWith('  proposal'));
    expect(door.some((line) => line.includes('REFUSED (PROPOSAL_DOOR_BUDGET)'))).toBe(true);
    expect(door.some((line) => line.includes('already pending'))).toBe(true);
    expect(result.lines.join('\n')).not.toContain('lorem ipsum');
  }, 120_000);

  it('applies to a memory entry too, and refuses when the stores cannot be measured', () => {
    const w = world();
    w.files[FILLER] = 'f'.repeat(PROPOSALS_BUDGET_BYTES - 10_000);
    const fs = contextPorts(w).fs;
    const outcome = openProposalDoor(w.sys, ROOT, caller, recordOf(memoryAsk()), state, proposalBudgetOf(fs, ROOT));
    expect(outcome.entries[0]).toMatchObject({ ok: false, class: 'memory', code: 'PROPOSAL_DOOR_BUDGET' });
    expect(filesUnder(w, MEMORY_PROPOSALS)).toEqual([]);
    const blind = { ...fs, stat: (path: string) => (path.endsWith('/.projectops/memory') ? { kind: 'link' as const, size: 0, mtimeMs: 1 } : fs.stat(path)) };
    expect(storeBytesNow(blind, ROOT)).toBeNull();
    const refused = openProposalDoor(w.sys, ROOT, caller, recordOf(memoryAsk('Another fact.')), state, proposalBudgetOf(blind, ROOT));
    expect(refused.entries[0]).toMatchObject({ ok: false, code: 'PROPOSAL_DOOR_BUDGET' });
  });

  it('measures what the digest measures: the size of every file under both store roots, and nothing outside them', () => {
    const w = world();
    const fs = contextPorts(w).fs;
    const before = storeBytesNow(fs, ROOT) ?? -1;
    w.files[`${ROOT}/.projectops/skills/promoted/x.json`] = 'y'.repeat(1000);
    w.files[`${ROOT}/.projectops/execution/elsewhere.json`] = 'z'.repeat(5000);
    expect(storeBytesNow(fs, ROOT)).toBe(before + 1000);
  });

  it('an entry that is already pending is a duplicate and costs the budget nothing', () => {
    const w = world();
    const fs = contextPorts(w).fs;
    const budget = proposalBudgetOf(fs, ROOT);
    const first = openProposalDoor(w.sys, ROOT, caller, recordOf(memoryAsk()), state, budget);
    w.files[FILLER] = 'f'.repeat(PROPOSALS_BUDGET_BYTES);
    const second = openProposalDoor(w.sys, ROOT, caller, recordOf(memoryAsk()), state, budget);
    expect(first.entries[0]).toMatchObject({ ok: true, duplicate: false });
    expect(second.entries[0]).toMatchObject({ ok: true, duplicate: true });
  });
});

describe('DW-12, the entry-count bound: the digest refuses a store tree of more than MAX_STORE_DIGEST_FILES entries, roots and directories included', () => {
  const caller: ProposalDoorCaller = { author: 'worker-1', role: 'implementer', session: 'sess-1' };
  const state: SkillStatePorts = { checkout: () => ({ tenant: 'polygo', project: 'polygo' }), stateDir: STATE };
  const recordOf = (...proposals: unknown[]): string => JSON.stringify({ ...baseRecord, proposals });
  const FILLER_DIR = `${ROOT}/.projectops/memory/filler`;

  /** Pad the stores with tiny files until the digest would count exactly `entries` entries (the roots and every directory counted, as the digest counts them). */
  function holdEntries(w: World, entries: number): void {
    const fs = contextPorts(w).fs;
    w.files[`${FILLER_DIR}/first.txt`] = 'x';
    const have = storeUsageNow(fs, ROOT)?.entries ?? 0;
    expect(entries).toBeGreaterThanOrEqual(have);
    for (let index = 0; index < entries - have; index += 1) w.files[`${FILLER_DIR}/f${index}.txt`] = 'x';
    // Past the bound the digest cannot read the stores at all, and neither can the measure: that is `null`, never a count.
    if (entries > MAX_STORE_DIGEST_FILES) expect(storeUsageNow(fs, ROOT)).toBeNull();
    else expect(storeUsageNow(fs, ROOT)?.entries).toBe(entries);
  }

  it('counts the way the digest counts: both roots, every directory and every file, and the digest reads exactly that many', () => {
    const w = world();
    const fs = contextPorts(w).fs;
    holdEntries(w, 40);
    const snapshot = snapshotMemoryStores(ROOT, fs);
    expect(snapshot.ok ? snapshot.snapshot.files.length : -1).toBe(40);
    expect(storeUsageNow(fs, ROOT)?.entries).toBe(40);
  });

  it.each([
    ['one under the bound', MAX_STORE_DIGEST_FILES - 1],
    ['at the bound', MAX_STORE_DIGEST_FILES],
    ['three over it, where the digest itself can no longer read the stores', MAX_STORE_DIGEST_FILES + 3],
  ])('refuses a memory entry with the stores %s', (_name, entries) => {
    const w = world();
    holdEntries(w, entries);
    const outcome = openProposalDoor(w.sys, ROOT, caller, recordOf(memoryAsk()), state, proposalBudgetOf(contextPorts(w).fs, ROOT));
    expect(outcome.entries[0]).toMatchObject({ ok: false, class: 'memory', code: 'PROPOSAL_DOOR_BUDGET' });
    expect(filesUnder(w, MEMORY_PROPOSALS)).toEqual([]);
  });

  it('counts the directories the entry would create: a proposals directory that is not there yet is one more entry', () => {
    const fresh = world();
    holdEntries(fresh, MAX_STORE_DIGEST_FILES - 3);
    // The file and the proposals directory would make two: 1997 + 2 stays under the bound, so it is accepted ...
    expect(openProposalDoor(fresh.sys, ROOT, caller, recordOf(memoryAsk()), state, proposalBudgetOf(contextPorts(fresh).fs, ROOT)).entries[0]).toMatchObject({ ok: true, duplicate: false });
    const full = world();
    holdEntries(full, MAX_STORE_DIGEST_FILES - 2);
    // ... and 1998 + 2 reaches the bound, so it is not.
    expect(openProposalDoor(full.sys, ROOT, caller, recordOf(memoryAsk()), state, proposalBudgetOf(contextPorts(full).fs, ROOT)).entries[0]).toMatchObject({ ok: false, code: 'PROPOSAL_DOOR_BUDGET' });
  });

  it('with the proposals directory already there only the file is new, and a skill counts its own store roots', () => {
    const w = world();
    w.files[`${MEMORY_PROPOSALS}/mem-aaaaaaaaaaaaaaaaaaaaaaaa.json`] = '{}';
    holdEntries(w, MAX_STORE_DIGEST_FILES - 2);
    expect(openProposalDoor(w.sys, ROOT, caller, recordOf(memoryAsk()), state, proposalBudgetOf(contextPorts(w).fs, ROOT)).entries[0]).toMatchObject({ ok: true, duplicate: false });
    const next = world();
    next.files[`${MEMORY_PROPOSALS}/mem-aaaaaaaaaaaaaaaaaaaaaaaa.json`] = '{}';
    holdEntries(next, MAX_STORE_DIGEST_FILES - 1);
    expect(openProposalDoor(next.sys, ROOT, caller, recordOf(memoryAsk()), state, proposalBudgetOf(contextPorts(next).fs, ROOT)).entries[0]).toMatchObject({ ok: false, code: 'PROPOSAL_DOOR_BUDGET' });
    // A skill needs `.projectops/skills` and its proposals directory, neither of which exists in this world: two directories and the file.
    const skills = world();
    holdEntries(skills, MAX_STORE_DIGEST_FILES - 3);
    expect(openProposalDoor(skills.sys, ROOT, caller, recordOf(skillAsk()), state, proposalBudgetOf(contextPorts(skills).fs, ROOT)).entries[0]).toMatchObject({ ok: false, code: 'PROPOSAL_DOOR_BUDGET' });
    const roomy = world();
    holdEntries(roomy, MAX_STORE_DIGEST_FILES - 4);
    expect(openProposalDoor(roomy.sys, ROOT, caller, recordOf(skillAsk()), state, proposalBudgetOf(contextPorts(roomy).fs, ROOT)).entries[0]).toMatchObject({ ok: true, duplicate: false });
  });

  it('what the door accepts at the edge still digests, and the guard clears it', () => {
    const w = world();
    gitIgnoresProposals(w);
    holdEntries(w, MAX_STORE_DIGEST_FILES - 3);
    const fs = contextPorts(w).fs;
    const baseline = beginStoreGuard(w.sys, ROOT, fs);
    const outcome = openProposalDoor(w.sys, ROOT, caller, recordOf(memoryAsk()), state, proposalBudgetOf(fs, ROOT));
    const after = afterProposalDoor(w.sys, ROOT, fs, baseline, outcome);
    expect(outcome.entries[0]).toMatchObject({ ok: true });
    expect(snapshotMemoryStores(ROOT, fs).ok).toBe(true);
    expect(endStoreGuard(w.sys, ROOT, fs, after.baseline)).toEqual({ ok: true });
  }, 60_000);

  it('a run with the stores one entry under the bound refuses the entry, writes nothing, and the next attempt is not stopped by the guard', () => {
    const w = world({ validatorExit: 1 });
    gitIgnoresProposals(w);
    holdEntries(w, MAX_STORE_DIGEST_FILES - 1);
    for (const path of Object.keys(w.files)) if (path.startsWith(`${FILLER_DIR}/`)) w.hidden.add(path);
    ask(w, [memoryAsk()]);
    const wk = worker(w);
    const result = run(w, wk);
    expect(wk.calls.length).toBeGreaterThan(1);
    expect(stopOf(result)?.code).not.toBe('SCOPE_DECISION');
    expect(filesUnder(w, MEMORY_PROPOSALS)).toEqual([]);
    expect(result.lines.some((line) => line.includes('REFUSED (PROPOSAL_DOOR_BUDGET)'))).toBe(true);
  }, 120_000);
});
