/**
 * The Codex implementer adapter wired to the REAL scratch checkout (real directories, real git); only Codex itself is a function.
 * PROJECTOS-WORKER-SCRATCH-CHECKOUT1A (plan 4.3a).
 *
 * `codex` is played by a callback that acts on the scratch directory it is given as `cwd`, exactly as a worker would, and
 * returns a scripted event stream. No provider, no network, no real Codex or Claude. What is proven here that the fake-host tests
 * cannot show: the real brief copy, the real placement of the records, the real copy-back and the real removal, end to end.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CODEX_IMPLEMENTER, codexImplementerAdapterWith } from '../src/loop/adapters/codexImplementer.js';
import { contextPointerPathOf, correctionInstruction, pointerInstruction } from '../src/loop/adapters/claudeCodeCli.js';
import type { WorkerBrief } from '../src/loop/brief.js';
import type { AuthorisedWorker, WorkerOutcome } from '../src/loop/workers.js';
import { nodeScratchFs, scratchHostWith } from '../src/loop/scratchCheckout.js';
import type { ScratchFs } from '../src/loop/scratchCheckout.js';
import { nodeSystem } from '../src/system.js';
import type { ExecResult, System } from '../src/system.js';

const CODEX = 'C:/tools/codex/codex.exe';
const RECORD_GRANTS = 'Write(.projectops/execution/*.findings.json),Edit(.projectops/execution/*.findings.json),Write(.projectops/execution/*.effects.json),Edit(.projectops/execution/*.effects.json)';
const GRANTS = `${RECORD_GRANTS},Edit(src/feature.ts),Write(src/feature.ts),Edit(docs),Write(docs)`;
const worker: AuthorisedWorker = { workerId: 'codex-local', kind: CODEX_IMPLEMENTER, command: CODEX, args: ['--allowedTools', GRANTS], timeoutMs: 600_000 };
const CLEAN = [
  { type: 'thread.started', thread_id: 't' },
  { type: 'item.completed', item: { id: 'i1', type: 'file_change', changes: [], status: 'completed' } },
  { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'Done.' } },
  { type: 'turn.completed' },
].map((e) => JSON.stringify(e)).join('\n');

let base = '';
let real = '';
let seenScratchRoots: string[] = [];

const put = (dir: string, rel: string, content: string) => {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
};
function treeOf(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d).sort()) {
      if (rel === '' && name === '.git') continue;
      const abs = join(d, name);
      const key = rel === '' ? name : `${rel}/${name}`;
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) out[key] = 'link';
      else if (st.isDirectory()) {
        out[key] = 'dir';
        walk(abs, key);
      } else out[key] = createHash('sha256').update(readFileSync(abs)).digest('hex');
    }
  };
  walk(dir, '');
  return out;
}

const briefOf = (): WorkerBrief =>
  ({
    repository: { root: real, head: 'a'.repeat(40) },
    plan: { path: join(real, 'docs/plan.json') },
    records: {
      briefPath: join(real, '.projectops/execution/s1.brief.json'),
      findingsPath: join(real, '.projectops/execution/s1.findings.json'),
      effectsPath: join(real, '.projectops/execution/s1.effects.json'),
      evidencePath: join(real, '.projectops/execution/s1.evidence.json'),
    },
  }) as unknown as WorkerBrief;

/** A System that is the real one, except that the Codex binary is a function acting on the cwd it is given. */
function systemWith(codex: (cwd: string, argv: readonly string[]) => ExecResult | void): System {
  return {
    ...nodeSystem,
    exec: (cmd, args, options) => {
      if (cmd !== CODEX) return nodeSystem.exec(cmd, args, options);
      const cwd = options?.cwd ?? '';
      seenScratchRoots.push(cwd);
      return codex(cwd, args) ?? { code: 0, stdout: CLEAN, stderr: '' };
    },
  };
}

const run = (sys: System, fs: ScratchFs = nodeScratchFs, brief: WorkerBrief = briefOf()): WorkerOutcome => {
  const adapter = codexImplementerAdapterWith({ pointerInstruction, correctionInstruction, contextPointerPathOf }, scratchHostWith(fs));
  return adapter.start(sys, worker, brief, brief.records.briefPath);
};

beforeEach(() => {
  seenScratchRoots = [];
  base = mkdtempSync(join(tmpdir(), 'projectos-adapterscratch-'));
  real = join(base, 'repo');
  mkdirSync(real);
  execFileSync('git', ['init', '-q', real]);
  const git = (...a: string[]) => execFileSync('git', ['-C', real, ...a], { stdio: ['ignore', 'pipe', 'pipe'] });
  git('config', 'user.email', 'test@projectos.invalid');
  git('config', 'user.name', 'test');
  git('config', 'core.autocrlf', 'false');
  put(real, '.gitignore', 'node_modules/\n.env\n.projectops/execution/\n');
  put(real, 'src/feature.ts', 'one\n');
  put(real, 'src/other.ts', 'one\n');
  put(real, 'docs/plan.json', '{}\n');
  put(real, 'docs/plain.md', 'one\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  put(real, '.env', 'SECRET=1\n');
  put(real, '.projectops/execution/s1.evidence.json', '{"evidence":true}\n');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const gone = () => seenScratchRoots.every((root) => root !== '' && !existsSync(dirname(root)));

describe('PROJECTOS-WORKER-SCRATCH-CHECKOUT1A: the adapter with the real scratch', () => {
  it('runs the worker in a scratch that holds the code, a rewritten brief and the placed records, and not the secrets', () => {
    let seen: Record<string, unknown> = {};
    const out = run(
      systemWith((cwd, argv) => {
        const brief = JSON.parse(readFileSync(join(cwd, '.projectops/execution/s1.brief.json'), 'utf8')) as { repository: { root: string }; records: { findingsPath: string } };
        seen = {
          root: brief.repository.root === cwd,
          findings: brief.records.findingsPath === join(cwd, '.projectops/execution/s1.findings.json'),
          evidence: readFileSync(join(cwd, '.projectops/execution/s1.evidence.json'), 'utf8'),
          code: readFileSync(join(cwd, 'src/feature.ts'), 'utf8'),
          env: existsSync(join(cwd, '.env')),
          realRootOnCommandLine: argv.join('\n').includes(real),
          cdIsScratch: argv[argv.indexOf('--cd') + 1] === cwd,
        };
      }),
    );
    expect(out).toMatchObject({ kind: 'completed', exitCode: 0 });
    expect(seen).toEqual({ root: true, findings: true, evidence: '{"evidence":true}\n', code: 'one\n', env: false, realRootOnCommandLine: false, cdIsScratch: true });
    expect(gone()).toBe(true);
  });

  it('rule 3 and 11: copies back exactly the granted changes and the worker-owned records, and removes the scratch', () => {
    const out = run(
      systemWith((cwd) => {
        put(cwd, 'src/feature.ts', 'two\n');
        put(cwd, 'docs/new.md', 'new\n');
        put(cwd, '.projectops/execution/s1.findings.json', '{"findings":[]}\n');
        put(cwd, '.projectops/execution/s1.effects.json', '{"effects":true}\n');
      }),
    );
    expect(out).toMatchObject({ kind: 'completed', exitCode: 0 });
    expect(readFileSync(join(real, 'src/feature.ts'), 'utf8')).toBe('two\n');
    expect(readFileSync(join(real, 'docs/new.md'), 'utf8')).toBe('new\n');
    expect(readFileSync(join(real, '.projectops/execution/s1.findings.json'), 'utf8')).toBe('{"findings":[]}\n');
    expect(readFileSync(join(real, '.projectops/execution/s1.effects.json'), 'utf8')).toBe('{"effects":true}\n');
    expect(existsSync(join(real, '.projectops/execution/s1.brief.json'))).toBe(false);
    expect(readFileSync(join(real, '.projectops/execution/s1.evidence.json'), 'utf8')).toBe('{"evidence":true}\n');
    expect(gone()).toBe(true);
  });

  it('rule 3 and 10: one change outside the grants refuses the run, names it, and leaves the real tree byte-identical', () => {
    const before = treeOf(real);
    const out = run(
      systemWith((cwd) => {
        put(cwd, 'src/feature.ts', 'good change\n');
        put(cwd, 'src/other.ts', 'not granted\n');
        put(cwd, '.codex/config.toml', 'sandbox = "danger-full-access"\n');
      }),
    );
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') {
      expect(out.detail).toContain('src/other.ts');
      expect(out.detail).toContain('.codex/config.toml');
      expect(out.detail).not.toContain('src/feature.ts');
    }
    expect(treeOf(real)).toEqual(before);
    expect(gone()).toBe(true);
  });

  it('rule 10: a steered run (a command outside the checkout) copies nothing back, even for a granted change', () => {
    const before = treeOf(real);
    const steered = [
      { type: 'item.completed', item: { id: 'c', type: 'command_execution', command: 'type C:/Users/someone/.codex/auth.json', exit_code: 0, status: 'completed' } },
      { type: 'turn.completed' },
    ].map((e) => JSON.stringify(e)).join('\n');
    const out = run(systemWith((cwd) => { put(cwd, 'src/feature.ts', 'steered change\n'); return { code: 0, stdout: steered, stderr: '' }; }));
    expect(out.kind).toBe('refused');
    expect(treeOf(real)).toEqual(before);
    expect(gone()).toBe(true);
  });

  it('keeps the granted work of a run that was cut off by its bound, and reports the timeout', () => {
    const out = run(systemWith((cwd) => { put(cwd, 'src/feature.ts', 'half done\n'); return { code: 1, stdout: '', stderr: '', failure: 'timeout' }; }));
    expect(out).toMatchObject({ kind: 'timedOut' });
    expect(readFileSync(join(real, 'src/feature.ts'), 'utf8')).toBe('half done\n');
    expect(gone()).toBe(true);
  });

  it('rule 12: removes the scratch when the worker throws, and the error reaches the caller', () => {
    expect(() => run(systemWith((cwd) => { put(cwd, 'src/feature.ts', 'x\n'); throw new Error('spawn exploded'); }))).toThrow('spawn exploded');
    expect(gone()).toBe(true);
    expect(readFileSync(join(real, 'src/feature.ts'), 'utf8')).toBe('one\n');
  });

  it('keeps the real-root snapshot as the backstop: a worker that writes the real tree through a junction is refused and named', () => {
    const out = run(
      systemWith((cwd) => {
        mkdirSync(join(cwd, 'docs'), { recursive: true });
        symlinkSync(join(real, 'src'), join(cwd, 'docs/lnk'), 'junction');
        writeFileSync(join(cwd, 'docs/lnk/other.ts'), 'escaped\n');
      }),
    );
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') expect(out.detail).toContain('src/other.ts');
    expect(gone()).toBe(true);
    // the target of the link was not followed by the removal
    expect(existsSync(join(real, 'src/feature.ts'))).toBe(true);
  });

  it('a copy that fails part-way is reported and the real tree is restored', () => {
    const before = treeOf(real);
    let copies = 0;
    const failing: ScratchFs = { ...nodeScratchFs, copyFile: (from, to) => { if (to.startsWith(real) && (copies += 1) === 2) throw Object.assign(new Error('disk gone'), { code: 'EIO' }); nodeScratchFs.copyFile(from, to); } };
    const out = run(systemWith((cwd) => { put(cwd, 'src/feature.ts', 'two\n'); put(cwd, 'docs/plain.md', 'two\n'); }), failing);
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') expect(out.detail).toMatch(/EIO[\s\S]*restored/);
    expect(treeOf(real)).toEqual(before);
    expect(gone()).toBe(true);
  });

  it('starts no worker when the scratch cannot be made, and leaves no directory', () => {
    let spawned = false;
    const tooSmall = scratchHostWith(nodeScratchFs, { maxFiles: 1, maxBytes: 1 << 30, maxEntries: 1000, maxPlacedBytes: 1 << 20 });
    const adapter = codexImplementerAdapterWith({ pointerInstruction, correctionInstruction, contextPointerPathOf }, tooSmall);
    const out = adapter.start(systemWith(() => { spawned = true; }), worker, briefOf(), briefOf().records.briefPath);
    expect(out.kind).toBe('refused');
    expect(spawned).toBe(false);
  });
});
