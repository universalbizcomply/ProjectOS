/**
 * The proposal door is called by the loop (PROJECTOS-PROPOSAL-DOOR-WIRING1A, plan v1.38, rules DW-1 .. DW-11).
 *
 * The same in-memory world as `loopContext.test.ts` (a copy in `support/loopWorld.ts`): the real config and approved plan, a fake worker
 * that writes what a real one could, and a `git status` worked out from the files. `hidden` is what git ignores, so a test can say
 * "this directory is git-ignored" and watch the digest do the work the path check cannot. DW-7 uses a real temporary git repository.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { summariserKindOf } from '../src/context/contextManager.js';
import { beginStoreGuard, endStoreGuard, rebaseStoreGuard, type StoreGuardSystem } from '../src/context/contextStoreGuard.js';
import { doorCreatedPaths, doorOutcomeLines } from '../src/context/proposalDoorStep.js';
import { openProposalDoor, type DoorEntryOutcome, type ProposalDoorCaller } from '../src/memory/proposalDoor.js';
import { listPendingMemoryProposals } from '../src/memory/proposalQueue.js';
import { isSkillMinted, type SkillStatePorts } from '../src/skills/skillMint.js';
import { listPendingSkillProposals } from '../src/skills/skillQueue.js';
import { nodeSystem } from '../src/system.js';
import { nodeEntryProbe } from '../src/search/nodeHost.js';
import { documentFsOver } from '../src/search/ports.js';
import { EXECUTION, EVIDENCE_PATH, ROOT, SESSION, STATE, run, world, worker, type World } from './support/loopWorld.js';
import { memoryFs } from './support/contextWorld.js';

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
  it('a worker that refused makes no proposal', () => {
    const w = world();
    ask(w, [memoryAsk()]);
    const failing = worker(w);
    const refusing = { ...failing.registry, 'claude-code-cli': { ...failing.registry['claude-code-cli']!, start: () => ({ kind: 'completed' as const, exitCode: 2, stdout: '', stderr: 'no', providerRef: null }) } };
    run(w, { ...failing, registry: refusing });
    expect(filesUnder(w, MEMORY_PROPOSALS)).toEqual([]);
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
