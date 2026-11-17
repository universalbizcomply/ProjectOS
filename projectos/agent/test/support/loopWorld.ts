/**
 * The loop-context world, shared (PROJECTOS-PROPOSAL-DOOR-WIRING1A): a copy of the one in loopContext.test.ts, which is left as it was.
 * A test file cannot import another test file without running its tests, so the world lives here for the tests that need the same one.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseContextLedgerEntry, type TaskEnvelope } from '@projectos/core';
import { runLoop as runLoopRaw, type RunOptions } from '../../src/loop/runner.js';
import { invocationIdFor } from '../../src/loop/invocation.js';
import type { ContextManagerPorts } from '../../src/context/contextPorts.js';
import { contextLedgerDirectoryOf } from '../../src/context/contextRun.js';
import type { AdapterRegistry, WorkerAdapter } from '../../src/loop/workers.js';
import type { ExecResult, System } from '../../src/system.js';
import { reviewing, withReviewer } from './fakeReviewer.js';
import { MEMORY_FILE, admittedRun, fakeGit, storeOf, storeText, worldPorts, type WorldOptions } from './contextWorld.js';

export const ROOT = '/proj';
export const HEAD = 'f'.repeat(40);
export const PHASE = 'PROJECTOS-RECOVERY-PLANNING-BRAIN1A';
export const KIND = 'claude-code-cli';
const VALIDATOR = 'validate-plan-discovery-import';
export const FACT = 'The build uses Node 24.';
export const DECISION = 'Bookings are never deleted, only cancelled.';

export const FACTS = { pid: 4242, ppid: 1717, argv: ['C:/node.exe', 'projectos.js', 'run', '--execute'], cwd: 'C:/dev/x' };
export const NOW = '2026-08-11T19:00:00Z';
export const SESSION = `${PHASE}-${HEAD.slice(0, 12)}-${invocationIdFor(PHASE, NOW, FACTS.pid).slice(0, 8)}`;
export const EXECUTION = `${ROOT}/.projectops/execution`;
export const CONTEXT_PATH = `${EXECUTION}/${SESSION}.context.md`;
export const STATE = '/state';
export const LEDGER_DIR = contextLedgerDirectoryOf(STATE, admittedRun().tenant, admittedRun().project);
export const BRIEF_PATH = `${EXECUTION}/${SESSION}.brief.json`;
export const EVIDENCE_PATH = `${EXECUTION}/${SESSION}.evidence.json`;

const realPlan = (): Record<string, unknown> => JSON.parse(readFileSync(resolve(__dirname, '../../../state/projectos-recovery.plan.json'), 'utf8')) as Record<string, unknown>;
const realConfig = (): Record<string, unknown> => JSON.parse(readFileSync(resolve(__dirname, '../../../../.projectops/project-config.json'), 'utf8')) as Record<string, unknown>;

export const cleanFindings = (): Record<string, string> => ({
  [`${EXECUTION}/${SESSION}.findings.json`]: JSON.stringify({ reviews: ['code-review', 'security-review'], findings: [{ id: 'F1', severity: 'LOW', category: 'style', summary: 'nit', resolved: true }] }),
  [`${EXECUTION}/${SESSION}.effects.json`]: JSON.stringify({ productionTouched: false, deploymentOccurred: false, databaseMutationOccurred: false, externalSendOccurred: false, paymentOccurred: false, rawSecretStored: false }),
});

export interface World {
  readonly sys: System & { readonly writes: string[] };
  readonly files: Record<string, string>;
  readonly statuses: { readonly afterDispatch: string[] };
  readonly hidden: Set<string>;
  readonly commands: string[];
  readonly root: string;
  markDispatched(): void;
}

/** The committed tree the context manager reads: the memory store, as committed. */
export const COMMITTED: Record<string, string> = { [MEMORY_FILE]: storeText([FACT, DECISION]) };

export function world(opts: { readonly validatorExit?: number; readonly kind?: string; readonly onValidator?: (files: Record<string, string>) => void; readonly root?: string; readonly failStatusZ?: boolean } = {}): World {
  const R = opts.root ?? ROOT;
  // The runner joins paths, which collapses a doubled slash; the fake file system does the same, so a root written with one still finds its files.
  const N = (p: string): string => p.replace(/\/{2,}/g, '/');
  const K = N(R);
  const config = { ...realConfig(), localPath: R, planMemory: { planPath: 'state/plan.json', currentStatePath: 'state/current.json' }, execution: withReviewer({ workers: [{ workerId: 'test', kind: opts.kind ?? KIND, command: '/usr/local/bin/test-worker' }] }, opts.kind ?? KIND) };
  const files: Record<string, string> = {
    [`${K}/.projectops/project-config.json`]: JSON.stringify(config),
    [`${K}/state/plan.json`]: JSON.stringify(realPlan()),
    [`${K}/state/current.json`]: JSON.stringify({ completedPhases: [] }),
    [`${K}/projectos/validators/${VALIDATOR}.cjs`]: '// present',
    ...cleanFindings(),
    ...Object.fromEntries(Object.entries(COMMITTED).map(([path, text]) => [`${K}/${path}`, text])),
  };
  const baseline = new Set(Object.keys(files));
  const writes: string[] = [];
  const hidden = new Set<string>();
  const commands: string[] = [];
  const statuses = { afterDispatch: [] as string[] };
  let dispatched = false;
  const untracked = (): string[] =>
    Object.keys(files)
      .filter((path) => path.startsWith(`${K}/`) && !baseline.has(path) && !hidden.has(path))
      .map((path) => path.slice(K.length + 1))
      .sort();
  const committedGit = fakeGit(Object.fromEntries(Object.entries(COMMITTED).map(([path, text]) => [path, { text }])), HEAD).git;
  const sys: World['sys'] = {
    writes,
    cwd: () => R,
    now: () => NOW,
    readText: (path) => files[N(path)] ?? null,
    writeText: (path, content) => {
      writes.push(path);
      files[N(path)] = content;
    },
    exists: (path) => N(path) in files,
    listDir: (path) => [...new Set(Object.keys(files).filter((p) => p.startsWith(`${N(path)}/`)).map((p) => p.slice(N(path).length + 1).split('/')[0] as string))],
    createExclusive: (path, content) => {
      if (N(path) in files) return false;
      files[N(path)] = content;
      writes.push(path);
      return true;
    },
    removeFile: (path) => {
      delete files[N(path)];
      return true;
    },
    renameFile: (from, to) => {
      if (!(N(from) in files)) return false;
      files[N(to)] = files[N(from)] as string;
      delete files[N(from)];
      writes.push(to);
      return true;
    },
    exec: (cmd, args): ExecResult => {
      commands.push(`${cmd} ${args.join(' ')}`);
      if (cmd !== 'git') {
        opts.onValidator?.(files);
        return { code: opts.validatorExit ?? 0, stdout: 'validator ran', stderr: '' };
      }
      const key = args.join(' ');
      if (/ (?:rev-parse --verify HEAD|ls-tree -z (?!-r)|cat-file )/.test(` ${key}`)) {
        const answer = committedGit(args.slice(args.findIndex((arg) => N(arg) === K) + 1));
        return { code: answer.code ?? 1, stdout: answer.stdout, stderr: '' };
      }
      if (key.includes('hash-object')) return { code: 0, stdout: `${args.slice(args.indexOf('--') + 1).map(() => 'b'.repeat(40)).join('\n')}\n`, stderr: '' };
      if (key.includes('status --porcelain') && opts.failStatusZ === true && key.includes(' -z')) return { code: 128, stdout: '', stderr: 'fatal' };
      if (key.includes('status --porcelain')) {
        const lines = untracked().map((path) => `?? ${path}`);
        const out = key.includes(' -z') ? lines.map((line) => `${line}\0`).join('') : lines.map((line) => `${line}\n`).join('');
        if (dispatched) statuses.afterDispatch.push(out);
        return { code: 0, stdout: out, stderr: '' };
      }
      if (key.includes('rev-parse --abbrev-ref HEAD')) return { code: 0, stdout: 'projectos-recovery-phase4-prep\n', stderr: '' };
      if (key.includes('--is-inside-work-tree')) return { code: 0, stdout: 'true', stderr: '' };
      if (key.includes('rev-parse HEAD')) return { code: 0, stdout: `${HEAD}\n`, stderr: '' };
      if (key.includes('remote get-url origin')) return { code: 0, stdout: `https://github.com/${String(realConfig()['repo'])}.git\n`, stderr: '' };
      if (key.includes('check-ignore')) return { code: 1, stdout: '', stderr: '' };
      if (key.includes('ls-files')) return { code: 0, stdout: '', stderr: '' };
      if (key.includes('diff --name-only')) return { code: 0, stdout: 'src/x.ts\n', stderr: '' };
      if (key.includes(`ls-tree -r -z --name-only ${HEAD} -- projectos/validators`)) return { code: 0, stdout: `projectos/validators/${VALIDATOR}.cjs\0`, stderr: '' };
      if (key.includes(`show ${HEAD}:projectos/validators/`)) return { code: 0, stdout: '// pinned', stderr: '' };
      if (key.includes('diff --stat')) return { code: 0, stdout: ' 1 file changed\n', stderr: '' };
      if (key.includes('show HEAD:./.projectops/project-config.json')) return { code: 0, stdout: JSON.stringify(config), stderr: '' };
      return { code: 1, stdout: '', stderr: `unexpected: ${key}` };
    },
  };
  return { sys, files, statuses, hidden, commands, root: R, markDispatched: () => { dispatched = true; } };
}

export interface Worker {
  readonly calls: string[];
  readonly registry: AdapterRegistry;
  readonly seenAtDispatch: (string | null)[];
}

/** A worker that looks at the context file when it is dispatched, and may do something else while it is there. */
export function worker(w: World, act: (attempt: number) => void = () => undefined, kind: string = KIND): Worker {
  const calls: string[] = [];
  const seenAtDispatch: (string | null)[] = [];
  const dispatch = (name: string) => {
    calls.push(name);
    seenAtDispatch.push(w.files[CONTEXT_PATH] ?? null);
    w.markDispatched();
    act(calls.length);
    return { kind: 'completed' as const, exitCode: 0, stdout: '', stderr: '', providerRef: 'ref-1' };
  };
  const adapter: WorkerAdapter = { kind, ...reviewing(), start: () => dispatch('start'), rejoin: () => dispatch('rejoin') };
  return { calls, registry: { [kind]: adapter }, seenAtDispatch };
}

export const stores = { memory: storeOf([{ text: FACT, kind: 'fact' }, { text: DECISION, kind: 'decision' }]) };

export function contextPorts(w: World, options: WorldOptions = {}, patch: Partial<ContextManagerPorts> = {}): ContextManagerPorts {
  const base = worldPorts({ tree: COMMITTED, stores, head: HEAD, ...options }).ports;
  const flat = (path: string): string => path.replace(/\/{2,}/g, '/');
  const fsOf = (path: string): string | null => w.files[flat(path)] ?? null;
  return {
    ...base,
    git: (args) => {
      const result = w.sys.exec('git', ['--no-replace-objects', '-C', w.root, ...args]);
      return { code: result.code, stdout: result.stdout };
    },
    fs: { readText: fsOf, listDir: (path) => w.sys.listDir(path), stat: (path) => (flat(path) in w.files ? { kind: 'file', size: new TextEncoder().encode(w.files[flat(path)] ?? '').length, mtimeMs: 1 } : [...Object.keys(w.files)].some((p) => p.startsWith(`${flat(path)}/`)) ? { kind: 'directory', size: 0, mtimeMs: 1 } : null) },
    ...patch,
  };
}

export function run(w: World, wk: Worker, over: Partial<RunOptions> = {}, envelope: TaskEnvelope | null = admittedRun(), ports: ContextManagerPorts = contextPorts(w)) {
  return runLoopRaw(w.sys, w.root, { invocation: FACTS, adapters: wk.registry, runEnvelope: envelope, contextPorts: ports, contextStateDir: STATE, ...over });
}
