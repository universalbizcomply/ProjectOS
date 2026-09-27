/**
 * PROJECTOS-AGENT-WORKFORCE1A — objective-driven operation through the existing command surface
 * (criterion 33): `projectos run` selects the team automatically, nobody names an agent, and the
 * governance it runs under is read from the owner-accepted commit.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runLoop } from '../src/loop/runner.js';
import type { AdapterRegistry, WorkerAdapter } from '../src/loop/workers.js';
import { run as cli } from '../src/cli.js';
import { nodeSystem, type ExecResult, type System } from '../src/system.js';
import { GOVERNANCE_FILES } from '../src/workforce/governance.js';
import { workforceForRun } from '../src/workforce/orchestrator.js';
import { projectLedger } from '../src/workforce/projection.js';
import { WorkforceStore } from '../src/workforce/eventStore.js';
import { REPO_ROOT } from './support/workforceWorld.js';

const ROOT = '/proj';
const HEAD = 'f'.repeat(40);
const ACCEPTED = 'a'.repeat(40);
const committed = (f: string): string => readFileSync(join(REPO_ROOT, f), 'utf8');

/** The loop's own fake world (see loopRunner.test.ts), plus an owner-accepted upstream carrying the workforce governance. */
function fakeWorld(withUpstream: boolean): System & { writes: string[] } {
  const realPlan = JSON.parse(readFileSync(resolve(__dirname, '../../state/projectos-recovery.plan.json'), 'utf8'));
  const realConfig = JSON.parse(readFileSync(resolve(__dirname, '../../../.projectops/project-config.json'), 'utf8'));
  const config = {
    ...realConfig,
    localPath: ROOT,
    planMemory: { planPath: 'state/plan.json', currentStatePath: 'state/current.json' },
    execution: { workers: [{ workerId: 'test', kind: 'test-worker', command: '/usr/local/bin/test-worker' }] },
  };
  const files: Record<string, string> = {
    [`${ROOT}/.projectops/project-config.json`]: JSON.stringify(config),
    [`${ROOT}/state/plan.json`]: JSON.stringify(realPlan),
    [`${ROOT}/state/current.json`]: JSON.stringify({ completedPhases: [] }),
    [`${ROOT}/projectos/validators/validate-plan-discovery-import.cjs`]: '// present',
  };
  const writes: string[] = [];
  return {
    writes,
    cwd: () => ROOT,
    now: () => '2026-09-27T12:00:00Z',
    readText: (p) => files[p] ?? null,
    writeText: (p, c) => {
      writes.push(p);
      files[p] = c;
    },
    exists: (p) => p in files,
    listDir: () => [],
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: (cmd, args): ExecResult => {
      if (cmd !== 'git') return { code: 0, stdout: 'validator ran', stderr: '' };
      const key = args.join(' ');
      if (key.includes('--symbolic-full-name @{upstream}')) return withUpstream ? { code: 0, stdout: 'refs/remotes/origin/main\n', stderr: '' } : { code: 128, stdout: '', stderr: 'no upstream' };
      if (key.includes(`show ${ACCEPTED}:./.projectops/project-config.json`)) return { code: 0, stdout: JSON.stringify(config), stderr: '' };
      if (key.includes('@{upstream}')) return withUpstream ? { code: 0, stdout: `${ACCEPTED}\n`, stderr: '' } : { code: 128, stdout: '', stderr: 'no upstream' };
      if (key.includes(`log -1 --format=%B ${ACCEPTED}`)) return { code: 0, stdout: 'accepted governance\n', stderr: '' };
      for (const f of Object.values(GOVERNANCE_FILES)) if (key.includes(`show ${ACCEPTED}:./${f}`)) return { code: 0, stdout: committed(f), stderr: '' };
      if (key.includes('rev-parse --abbrev-ref HEAD')) return { code: 0, stdout: 'projectos-recovery-phase4-prep\n', stderr: '' };
      if (key.includes('--is-inside-work-tree')) return { code: 0, stdout: 'true', stderr: '' };
      if (key.includes('rev-parse HEAD')) return { code: 0, stdout: `${HEAD}\n`, stderr: '' };
      if (key.includes('remote get-url origin')) return { code: 0, stdout: `https://github.com/${String(realConfig['repo'])}.git\n`, stderr: '' };
      if (key.includes('status --porcelain')) return { code: 0, stdout: '', stderr: '' };
      if (key.includes(`diff --name-only --no-renames --no-ext-diff ${ACCEPTED} HEAD`)) return { code: 0, stdout: 'db/migrations/0042.sql\n', stderr: '' };
      if (key.includes('show HEAD:./.projectops/project-config.json')) return { code: 0, stdout: JSON.stringify(config), stderr: '' };
      return { code: 1, stdout: '', stderr: `unexpected: ${key}` };
    },
  };
}

function adapter(): AdapterRegistry {
  const never = (): never => {
    throw new Error('a dry run starts no worker');
  };
  const a: WorkerAdapter = { kind: 'test-worker', start: never, rejoin: never };
  return { 'test-worker': a };
}

describe('projectos run selects the team automatically', () => {
  it('a dry run previews the team for the approved phase, names no agent the user chose, and records nothing', () => {
    const sys = fakeWorld(true);
    const r = runLoop(sys, ROOT, { dryRun: true, workforce: true, adapters: adapter() });
    expect(r.ok).toBe(true);
    const text = r.lines.join('\n');
    expect(text).toMatch(/Workforce \(preview, not recorded\): \d specialist\(s\)/);
    // The candidate's changed paths reach the facts through `run` (the fake diff names a migration).
    expect(text).toMatch(/database-reliability-engineer \(contribute/);
    expect(text).toMatch(/specialist execution is NOT activated/);
    expect(sys.writes.some((p) => p.includes('workforce-state'))).toBe(false);
  });

  it('reports — and does nothing — while the workforce governance is not owner-accepted', () => {
    const r = runLoop(fakeWorld(false), ROOT, { dryRun: true, workforce: true, adapters: adapter() });
    expect(r.lines.join('\n')).toMatch(/Workforce: not active — the branch has no remote-tracking upstream/);
  });

  it('leaves every other caller’s output unchanged', () => {
    const r = runLoop(fakeWorld(true), ROOT, { dryRun: true, adapters: adapter() });
    expect(r.lines.join('\n')).not.toMatch(/Workforce/);
  });
});

describe('the recording path, on a real repository with an owner-accepted upstream', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'core.hooksPath=NUL', '-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

  /** A checkout whose workforce governance is pushed to `origin`, so it is owner-accepted. */
  function acceptedRepo(): { work: string; stateRoot: string } {
    const base = mkdtempSync(join(tmpdir(), 'projectos-wfrun-'));
    dirs.push(base);
    const work = join(base, 'work');
    git(base, 'init', '--bare', '-q', join(base, 'remote.git'));
    git(base, 'init', '-q', '-b', 'main', work);
    mkdirSync(join(work, '.projectops', 'workforce'), { recursive: true });
    for (const f of Object.values(GOVERNANCE_FILES)) writeFileSync(join(work, f), committed(f));
    writeFileSync(join(work, '.projectops', 'project-config.json'), JSON.stringify({ projectId: 'demo' }));
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'workforce governance');
    git(work, 'remote', 'add', 'origin', join(base, 'remote.git'));
    git(work, 'push', '-q', '-u', 'origin', 'main');
    return { work, stateRoot: join(base, 'installation-state') };
  }

  it('N1: facts come from EVERY path the scope names and the candidate changed — not only source files', () => {
    const { work, stateRoot } = acceptedRepo();
    // An unpushed candidate commit that touches a payment module.
    mkdirSync(join(work, 'payments'));
    writeFileSync(join(work, 'payments', 'charge.ts'), 'export {};\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'candidate');
    const phase = { phaseId: 'OPS-1', riskLevel: 'medium', requiredReviews: [], requiredBrowserProof: false };
    const scopeText = 'Add db/migrations/0042.sql, update .github/workflows/ci.yml and the root Dockerfile.';
    workforceForRun(nodeSystem, work, { phase, scopeText, objective: 'ship the migration', candidate: git(work, 'rev-parse', 'HEAD'), dryRun: false, stateRoot });
    const derived = new WorkforceStore(nodeSystem, stateRoot, 'demo', 5000).readVerified().find((e) => e.type === 'facts-derived')?.payload['record'] as { riskFacts: string[] };
    // data (.sql), production (.yml workflow, root Dockerfile), payment (the candidate's changed path).
    expect(derived.riskFacts).toEqual(expect.arrayContaining(['data', 'production', 'payment']));
  });

  it('refuses — never crashes the run — when governance names an unsafe project id', () => {
    const { work, stateRoot } = acceptedRepo();
    writeFileSync(join(work, '.projectops', 'project-config.json'), JSON.stringify({ projectId: 'demo/../x' }));
    git(work, 'commit', '-q', '-am', 'unsafe id');
    git(work, 'push', '-q');
    const phase = { phaseId: 'SEC-1', riskLevel: 'high', requiredReviews: [], requiredBrowserProof: false };
    const lines = workforceForRun(nodeSystem, work, { phase, objective: 'x', candidate: null, dryRun: false, stateRoot });
    expect(lines.join('\n')).toMatch(/Workforce: not active — the projectId 'demo\/\.\.\/x' at the owner-accepted commit does not make a safe workforce record name/);
  });

  it('refuses an upstream on any remote but origin: `remote add x .` + `branch -u x/<b>` is not a push', () => {
    const { work } = acceptedRepo();
    git(work, 'commit', '-q', '--allow-empty', '-m', 'unpushed');
    git(work, 'remote', 'add', 'x', '.');
    git(work, 'fetch', '-q', 'x');
    git(work, 'branch', '-q', '-u', 'x/main');
    const r = cli({ sys: nodeSystem, root: work }, ['workforce', 'roster']);
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toMatch(/upstream is not on 'origin'/);
  });

  it('check-update validates an untrusted manifest before comparing or printing any of it', () => {
    const { work } = acceptedRepo();
    const manifest = join(work, '..', 'manifest.json');
    writeFileSync(manifest, JSON.stringify({ commit: 'b'.repeat(40), files: { 'x/../../y.md': 'not-a-digest', '\u001b[2Jevil.md': 'a'.repeat(64) } }));
    const r = cli({ sys: nodeSystem, root: work }, ['workforce', 'check-update', '--manifest', manifest]);
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toMatch(/not a catalogue manifest: .*\(2 malformed\)/);
    expect(r.lines.join('\n')).not.toContain('\u001b');
  });

  it('evaluate hashes the cached text before use: bytes that are not the registered bytes never reach an engine', () => {
    const { work } = acceptedRepo();
    const base = join(work, '..', 'localappdata');
    const saved = process.env['LOCALAPPDATA'];
    process.env['LOCALAPPDATA'] = base;
    try {
      const cfg = JSON.parse(committed(GOVERNANCE_FILES.config)) as { catalogue: { commit: string; cacheLocation: { relative: string } } };
      const reg = JSON.parse(committed(GOVERNANCE_FILES.registry)) as { entries: { id: string; source: { path: string } }[] };
      const entry = reg.entries.find((e) => e.id === 'minimal-change-engineer')!;
      const file = join(base, ...cfg.catalogue.cacheLocation.relative.split('/'), cfg.catalogue.commit, 'files', ...entry.source.path.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, 'tampered instruction text');
      const r = cli({ sys: nodeSystem, root: work }, ['workforce', 'evaluate', '--role', 'minimal-change-engineer']);
      expect(r.code).toBe(2);
      expect(r.lines.join('\n')).toMatch(/REFUSED \(INSTRUCTION_INTEGRITY\)/);
    } finally {
      if (saved === undefined) delete process.env['LOCALAPPDATA'];
      else process.env['LOCALAPPDATA'] = saved;
    }
  });

  it('mints the one leader, derives the facts, records the team with reasons, and the roster stays inspectable', () => {
    const { work, stateRoot } = acceptedRepo();

    const phase = { phaseId: 'SEC-1', riskLevel: 'high', requiredReviews: ['ECC SECURITY review'], requiredBrowserProof: false };
    const lines = workforceForRun(nodeSystem, work, { phase, objective: 'harden the session check', candidate: git(work, 'rev-parse', 'HEAD'), dryRun: false, stateRoot });
    const text = lines.join('\n');
    expect(text).toMatch(/Workforce: leader project-leader:demo generation 1; 3 specialist\(s\) selected for 'security-sensitive-change'/);
    expect(text).toMatch(/application-security-engineer \(contribute, fixture:deterministic-primary\): mandatory for task type 'security-sensitive-change'; required by declared fact 'security'/);
    expect(text).toMatch(/security-architect \(independent-review/);

    const store = new WorkforceStore(nodeSystem, stateRoot, 'demo', 5000);
    expect(existsSync(join(work, '.projectops', 'workforce-state'))).toBe(false);
    const ledger = projectLedger('demo', store.readVerified());
    expect(ledger.leader?.generation).toBe(1);
    expect(ledger.currentPhase).toBe('SEC-1');
    expect(ledger.activeSpecialists.map((m) => m.roleId)).toEqual(['application-security-engineer', 'test-automation-engineer', 'security-architect']);
    const facts = store.readVerified().find((e) => e.type === 'facts-derived')?.payload['facts'] as { provenance: { fromRecords: string[] } };
    expect(facts.provenance.fromRecords).toEqual(['riskLevel=high', 'fact=security', 'taskType=security-sensitive-change']);

    // Same leader on the next run: persistence across sessions.
    workforceForRun(nodeSystem, work, { phase, objective: 'next', candidate: null, dryRun: false, stateRoot });
    expect(projectLedger('demo', store.readVerified()).leader?.generation).toBe(1);

    const roster = cli({ sys: nodeSystem, root: work }, ['workforce', 'roster']);
    expect(roster.code).toBe(0);
    expect(roster.lines.join('\n')).toMatch(/registered: 279 agents in 18 divisions/);
    const role = cli({ sys: nodeSystem, root: work }, ['workforce', 'roster', '--role', 'content-creator']);
    expect(role.lines.join('\n')).toMatch(/"writeScopes": \[\]/);
  });
});
