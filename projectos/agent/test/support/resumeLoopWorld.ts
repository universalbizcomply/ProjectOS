/**
 * A whole run loop in memory, for PROJECTOS-RESUME1A: this repository's real config and approved plan (with one phase given write
 * paths), a checkout that matches them, a fake worker that looks at the file system the way a real one would, and a `git status` that is
 * worked out from the files. Adapted from the world `loopContext.test.ts` builds; that file registers tests, so it cannot be imported.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TaskEnvelope } from '@projectos/core';
import { runLoop as runLoopRaw, type RunOptions } from '../../src/loop/runner.js';
import { invocationIdFor } from '../../src/loop/invocation.js';
import { advanceWork, beginWork, writeWorkRecord, type WorkRecord } from '../../src/loop/workRecord.js';
import type { ContextManagerPorts } from '../../src/context/contextPorts.js';
import type { AdapterRegistry, WorkerAdapter, WorkerOutcome } from '../../src/loop/workers.js';
import type { ExecResult, System } from '../../src/system.js';
import { reviewing, withReviewer } from './fakeReviewer.js';
import { MEMORY_FILE, admittedRun, fakeGit, storeOf, storeText, worldPorts } from './contextWorld.js';

export const ROOT = '/proj';
export const HEAD = 'f'.repeat(40);
export const MOVED_HEAD = 'e'.repeat(40);
export const PHASE = 'PROJECTOS-RECOVERY-PLANNING-BRAIN1A';
export const KIND = 'claude-code-cli';
export const VALIDATOR = 'validate-plan-discovery-import';
export const FACT = 'The build uses Node 24.';
export const DECISION = 'Bookings are never deleted, only cancelled.';
export const WRITE_DIRECTORY = 'src/widget/';
export const STATE = '/state';
export const NOW = '2026-08-11T19:00:00Z';
export const EXECUTION = `${ROOT}/.projectops/execution`;

const FACTS = { pid: 4242, ppid: 1717, argv: ['C:/node.exe', 'projectos.js', 'run', '--execute'], cwd: 'C:/dev/x' };
export const SESSION = `${PHASE}-${HEAD.slice(0, 12)}-${invocationIdFor(PHASE, NOW, FACTS.pid).slice(0, 8)}`;
export const CONTEXT_PATH = `${EXECUTION}/${SESSION}.context.md`;
/** The session the cut-off attempt used. */
export const EARLIER_SESSION = `${PHASE}-${HEAD.slice(0, 12)}-0a1b2c3d`;

const realPlan = (writePaths: readonly string[]): Record<string, unknown> => {
  const plan = JSON.parse(readFileSync(resolve(__dirname, '../../../state/projectos-recovery.plan.json'), 'utf8')) as { phases: { phaseId: string; writePaths?: string[] }[] };
  const phase = plan.phases.find((entry) => entry.phaseId === PHASE);
  if (phase === undefined) throw new Error('the phase is not in the plan');
  if (writePaths.length > 0) phase.writePaths = [...writePaths];
  return plan as unknown as Record<string, unknown>;
};
const realConfig = (): Record<string, unknown> => JSON.parse(readFileSync(resolve(__dirname, '../../../../.projectops/project-config.json'), 'utf8')) as Record<string, unknown>;

const cleanRecords = (): Record<string, string> => ({
  [`${EXECUTION}/${SESSION}.findings.json`]: JSON.stringify({ reviews: ['code-review', 'security-review'], findings: [{ id: 'F1', severity: 'LOW', category: 'style', summary: 'nit', resolved: true }] }),
  [`${EXECUTION}/${SESSION}.effects.json`]: JSON.stringify({ productionTouched: false, deploymentOccurred: false, databaseMutationOccurred: false, externalSendOccurred: false, paymentOccurred: false, rawSecretStored: false }),
});

export interface ResumeWorld {
  readonly sys: System & { readonly writes: string[] };
  readonly files: Record<string, string>;
  readonly commands: string[];
  readonly root: string;
  /** Paths git shows as changed beyond the untracked ones the files imply, as `XY path` porcelain codes. */
  readonly tracked: Record<string, string>;
  /** Make HEAD another commit from now on. */
  moveHead(head: string): void;
}

const COMMITTED: Record<string, string> = { [MEMORY_FILE]: storeText([FACT, DECISION]) };

export function resumeWorld(opts: { readonly writePaths?: readonly string[]; readonly validatorExit?: number } = {}): ResumeWorld {
  const N = (p: string): string => p.replace(/\/{2,}/g, '/');
  const config = { ...realConfig(), localPath: ROOT, planMemory: { planPath: 'state/plan.json', currentStatePath: 'state/current.json' }, execution: withReviewer({ workers: [{ workerId: 'test', kind: KIND, command: '/usr/local/bin/test-worker' }] }, KIND) };
  const files: Record<string, string> = {
    [`${ROOT}/.projectops/project-config.json`]: JSON.stringify(config),
    [`${ROOT}/state/plan.json`]: JSON.stringify(realPlan(opts.writePaths ?? [WRITE_DIRECTORY])),
    [`${ROOT}/state/current.json`]: JSON.stringify({ completedPhases: [] }),
    [`${ROOT}/projectos/validators/${VALIDATOR}.cjs`]: '// present',
    ...cleanRecords(),
    ...Object.fromEntries(Object.entries(COMMITTED).map(([path, text]) => [`${ROOT}/${path}`, text])),
  };
  const baseline = new Set(Object.keys(files));
  const writes: string[] = [];
  const commands: string[] = [];
  const tracked: Record<string, string> = {};
  let head = HEAD;
  const untracked = (): string[] =>
    Object.keys(files)
      .filter((path) => path.startsWith(`${ROOT}/`) && !baseline.has(path))
      .map((path) => path.slice(ROOT.length + 1))
      .sort();
  const committedGit = fakeGit(Object.fromEntries(Object.entries(COMMITTED).map(([path, text]) => [path, { text }])), HEAD).git;
  const sys: ResumeWorld['sys'] = {
    writes,
    cwd: () => ROOT,
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
      if (cmd !== 'git') return { code: opts.validatorExit ?? 0, stdout: 'validator ran', stderr: '' };
      const key = args.join(' ');
      if (/ (?:rev-parse --verify HEAD|ls-tree -z (?!-r)|cat-file )/.test(` ${key}`)) {
        const answer = committedGit(args.slice(args.findIndex((arg) => N(arg) === ROOT) + 1));
        const stdout = key.includes('rev-parse --verify HEAD') ? `${head}\n` : answer.stdout;
        return { code: answer.code ?? 1, stdout, stderr: '' };
      }
      if (key.includes('hash-object')) return { code: 0, stdout: `${args.slice(args.indexOf('--') + 1).map(() => 'b'.repeat(40)).join('\n')}\n`, stderr: '' };
      if (key.includes('status --porcelain')) {
        const lines = [...Object.entries(tracked).map(([path, code]) => `${code} ${path}`), ...untracked().map((path) => `?? ${path}`)];
        const out = key.includes(' -z') ? lines.map((line) => `${line}\0`).join('') : lines.map((line) => `${line}\n`).join('');
        return { code: 0, stdout: out, stderr: '' };
      }
      if (key.includes('rev-parse --abbrev-ref HEAD')) return { code: 0, stdout: 'projectos-recovery-phase4-prep\n', stderr: '' };
      if (key.includes('--is-inside-work-tree')) return { code: 0, stdout: 'true', stderr: '' };
      if (key.includes('rev-parse HEAD')) return { code: 0, stdout: `${head}\n`, stderr: '' };
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
  return { sys, files, commands, root: ROOT, tracked, moveHead: (next) => { head = next; } };
}

export interface ResumeWorker {
  readonly calls: string[];
  readonly registry: AdapterRegistry;
  readonly seenAtDispatch: (string | null)[];
}

/** A worker that looks at the context file when it is dispatched. `outcome` can end it as a timeout. */
export function resumeWorker(w: ResumeWorld, outcome: () => WorkerOutcome = () => ({ kind: 'completed', exitCode: 0, stdout: '', stderr: '', providerRef: 'ref-1' })): ResumeWorker {
  const calls: string[] = [];
  const seenAtDispatch: (string | null)[] = [];
  const dispatch = (name: string): WorkerOutcome => {
    calls.push(name);
    const placed = Object.keys(w.files).find((path) => path.endsWith('.context.md'));
    seenAtDispatch.push(placed === undefined ? null : (w.files[placed] ?? null));
    return outcome();
  };
  const adapter: WorkerAdapter = { kind: KIND, ...reviewing(), start: () => dispatch('start'), rejoin: () => dispatch('rejoin') };
  return { calls, registry: { [KIND]: adapter }, seenAtDispatch };
}

export const timedOut = (): WorkerOutcome => ({ kind: 'timedOut', afterMs: 90_000, stdout: '', stderr: '' });

export const stores = { memory: storeOf([{ text: FACT, kind: 'fact' }, { text: DECISION, kind: 'decision' }]) };

export function resumePorts(w: ResumeWorld, patch: Partial<ContextManagerPorts> = {}): ContextManagerPorts {
  const base = worldPorts({ tree: COMMITTED, stores, head: HEAD }).ports;
  const flat = (path: string): string => path.replace(/\/{2,}/g, '/');
  return {
    ...base,
    git: (args) => {
      const result = w.sys.exec('git', ['--no-replace-objects', '-C', w.root, ...args]);
      return { code: result.code, stdout: result.stdout };
    },
    fs: {
      readText: (path) => w.files[flat(path)] ?? null,
      listDir: (path) => w.sys.listDir(path),
      stat: (path) => (flat(path) in w.files ? { kind: 'file', size: new TextEncoder().encode(w.files[flat(path)] ?? '').length, mtimeMs: 1 } : Object.keys(w.files).some((p) => p.startsWith(`${flat(path)}/`)) ? { kind: 'directory', size: 0, mtimeMs: 1 } : null),
    },
    ...patch,
  };
}

/** What `run.ts` does with the loop's progress reports: one record, written by the entrypoint and never read to decide anything. */
export function recordingWork(w: ResumeWorld, projectId: string): NonNullable<RunOptions['onWorkState']> {
  let work: WorkRecord | null = null;
  return (progress) => {
    if (work === null || work.phaseId !== progress.phaseId) work = beginWork({ projectId, phaseId: progress.phaseId, subjectCommit: progress.subjectCommit ?? null, at: NOW });
    const { state, phaseId: _phase, ...rest } = progress;
    work = advanceWork(work, { state, ...rest }, NOW);
    writeWorkRecord(w.sys, w.root, work);
  };
}

export const projectIdOf = (): string => String(realConfig()['projectId']);

export function runResume(w: ResumeWorld, wk: ResumeWorker, over: Partial<RunOptions> = {}, envelope: TaskEnvelope | null = admittedRun(), ports: ContextManagerPorts = resumePorts(w)) {
  return runLoopRaw(w.sys, w.root, { invocation: FACTS, adapters: wk.registry, runEnvelope: envelope, contextPorts: ports, contextStateDir: STATE, ...over });
}
