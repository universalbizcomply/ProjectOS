/**
 * The run loop with the context manager wired in (PROJECTOS-CONTEXT-MANAGER1A).
 *
 * A whole world in memory: this repository's real config and approved plan, a checkout that matches them, a fake worker that looks at
 * the file system the way a real one would, and a `git status` that is worked out from the files, so a file the loop leaves behind
 * is a file the candidate would count.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseContextLedgerEntry, type TaskEnvelope } from '@projectos/core';
import { runLoop as runLoopRaw, type RunOptions } from '../src/loop/runner.js';
import { invocationIdFor } from '../src/loop/invocation.js';
import type { ContextManagerPorts } from '../src/context/contextPorts.js';
import { contextLedgerDirectoryOf } from '../src/context/contextRun.js';
import type { AdapterRegistry, WorkerAdapter } from '../src/loop/workers.js';
import type { ExecResult, System } from '../src/system.js';
import { reviewing, withReviewer } from './support/fakeReviewer.js';
import { MEMORY_FILE, admittedRun, fakeGit, storeOf, storeText, worldPorts, type WorldOptions } from './support/contextWorld.js';

const ROOT = '/proj';
const HEAD = 'f'.repeat(40);
const PHASE = 'PROJECTOS-RECOVERY-PLANNING-BRAIN1A';
const KIND = 'claude-code-cli';
const VALIDATOR = 'validate-plan-discovery-import';
const FACT = 'The build uses Node 24.';
const DECISION = 'Bookings are never deleted, only cancelled.';

const FACTS = { pid: 4242, ppid: 1717, argv: ['C:/node.exe', 'projectos.js', 'run', '--execute'], cwd: 'C:/dev/x' };
const NOW = '2026-08-11T19:00:00Z';
const SESSION = `${PHASE}-${HEAD.slice(0, 12)}-${invocationIdFor(PHASE, NOW, FACTS.pid).slice(0, 8)}`;
const EXECUTION = `${ROOT}/.projectops/execution`;
const CONTEXT_PATH = `${EXECUTION}/${SESSION}.context.md`;
const STATE = '/state';
const LEDGER_DIR = contextLedgerDirectoryOf(STATE, admittedRun().tenant, admittedRun().project);
const BRIEF_PATH = `${EXECUTION}/${SESSION}.brief.json`;
const EVIDENCE_PATH = `${EXECUTION}/${SESSION}.evidence.json`;

const realPlan = (): Record<string, unknown> => JSON.parse(readFileSync(resolve(__dirname, '../../state/projectos-recovery.plan.json'), 'utf8')) as Record<string, unknown>;
const realConfig = (): Record<string, unknown> => JSON.parse(readFileSync(resolve(__dirname, '../../../.projectops/project-config.json'), 'utf8')) as Record<string, unknown>;

const cleanFindings = (): Record<string, string> => ({
  [`${EXECUTION}/${SESSION}.findings.json`]: JSON.stringify({ reviews: ['code-review', 'security-review'], findings: [{ id: 'F1', severity: 'LOW', category: 'style', summary: 'nit', resolved: true }] }),
  [`${EXECUTION}/${SESSION}.effects.json`]: JSON.stringify({ productionTouched: false, deploymentOccurred: false, databaseMutationOccurred: false, externalSendOccurred: false, paymentOccurred: false, rawSecretStored: false }),
});

interface World {
  readonly sys: System & { readonly writes: string[] };
  readonly files: Record<string, string>;
  readonly statuses: { readonly afterDispatch: string[] };
  readonly hidden: Set<string>;
  readonly commands: string[];
  markDispatched(): void;
}

/** The committed tree the context manager reads: the memory store, as committed. */
const COMMITTED: Record<string, string> = { [MEMORY_FILE]: storeText([FACT, DECISION]) };

function world(opts: { readonly validatorExit?: number; readonly kind?: string; readonly onValidator?: (files: Record<string, string>) => void } = {}): World {
  const config = { ...realConfig(), localPath: ROOT, planMemory: { planPath: 'state/plan.json', currentStatePath: 'state/current.json' }, execution: withReviewer({ workers: [{ workerId: 'test', kind: opts.kind ?? KIND, command: '/usr/local/bin/test-worker' }] }, opts.kind ?? KIND) };
  const files: Record<string, string> = {
    [`${ROOT}/.projectops/project-config.json`]: JSON.stringify(config),
    [`${ROOT}/state/plan.json`]: JSON.stringify(realPlan()),
    [`${ROOT}/state/current.json`]: JSON.stringify({ completedPhases: [] }),
    [`${ROOT}/projectos/validators/${VALIDATOR}.cjs`]: '// present',
    ...cleanFindings(),
    ...Object.fromEntries(Object.entries(COMMITTED).map(([path, text]) => [`${ROOT}/${path}`, text])),
  };
  const baseline = new Set(Object.keys(files));
  const writes: string[] = [];
  const hidden = new Set<string>();
  const commands: string[] = [];
  const statuses = { afterDispatch: [] as string[] };
  let dispatched = false;
  const untracked = (): string[] =>
    Object.keys(files)
      .filter((path) => path.startsWith(`${ROOT}/`) && !baseline.has(path) && !hidden.has(path))
      .map((path) => path.slice(ROOT.length + 1))
      .sort();
  const committedGit = fakeGit(Object.fromEntries(Object.entries(COMMITTED).map(([path, text]) => [path, { text }])), HEAD).git;
  const sys: World['sys'] = {
    writes,
    cwd: () => ROOT,
    now: () => NOW,
    readText: (path) => files[path] ?? null,
    writeText: (path, content) => {
      writes.push(path);
      files[path] = content;
    },
    exists: (path) => path in files,
    listDir: (path) => [...new Set(Object.keys(files).filter((p) => p.startsWith(`${path}/`)).map((p) => p.slice(path.length + 1).split('/')[0] as string))],
    createExclusive: (path, content) => {
      if (path in files) return false;
      files[path] = content;
      writes.push(path);
      return true;
    },
    removeFile: (path) => {
      delete files[path];
      return true;
    },
    renameFile: (from, to) => {
      if (!(from in files)) return false;
      files[to] = files[from] as string;
      delete files[from];
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
        const answer = committedGit(args.slice(args.indexOf(ROOT) + 1));
        return { code: answer.code ?? 1, stdout: answer.stdout, stderr: '' };
      }
      if (key.includes('hash-object')) return { code: 0, stdout: `${args.slice(args.indexOf('--') + 1).map(() => 'b'.repeat(40)).join('\n')}\n`, stderr: '' };
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
  return { sys, files, statuses, hidden, commands, markDispatched: () => { dispatched = true; } };
}

interface Worker {
  readonly calls: string[];
  readonly registry: AdapterRegistry;
  readonly seenAtDispatch: (string | null)[];
}

/** A worker that looks at the context file when it is dispatched, and may do something else while it is there. */
function worker(w: World, act: (attempt: number) => void = () => undefined, kind: string = KIND): Worker {
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

const stores = { memory: storeOf([{ text: FACT, kind: 'fact' }, { text: DECISION, kind: 'decision' }]) };

function contextPorts(w: World, options: WorldOptions = {}, patch: Partial<ContextManagerPorts> = {}): ContextManagerPorts {
  const base = worldPorts({ tree: COMMITTED, stores, head: HEAD, ...options }).ports;
  const fsOf = (path: string): string | null => w.files[path] ?? null;
  return {
    ...base,
    git: (args) => {
      const result = w.sys.exec('git', ['--no-replace-objects', '-C', ROOT, ...args]);
      return { code: result.code, stdout: result.stdout };
    },
    fs: { readText: fsOf, listDir: (path) => w.sys.listDir(path), stat: (path) => (path in w.files ? { kind: 'file', size: new TextEncoder().encode(w.files[path] ?? '').length, mtimeMs: 1 } : [...Object.keys(w.files)].some((p) => p.startsWith(`${path}/`)) ? { kind: 'directory', size: 0, mtimeMs: 1 } : null) },
    ...patch,
  };
}

function run(w: World, wk: Worker, over: Partial<RunOptions> = {}, envelope: TaskEnvelope | null = admittedRun(), ports: ContextManagerPorts = contextPorts(w)) {
  return runLoopRaw(w.sys, ROOT, { invocation: FACTS, adapters: wk.registry, runEnvelope: envelope, contextPorts: ports, contextStateDir: STATE, ...over });
}

const ledgerOf = (files: Record<string, string>) =>
  Object.keys(files)
    .filter((path) => path.startsWith(`${LEDGER_DIR}/`))
    .sort()
    .map((path) => {
      const parsed = parseContextLedgerEntry(files[path]);
      if (!parsed.ok) throw new Error(path);
      return parsed.entry;
    });

describe('a run with no admitted envelope retrieves nothing and changes nothing', () => {
  it('writes no context file, no ledger and names none in the brief or the evidence', () => {
    const w = world();
    const wk = worker(w);
    const result = run(w, wk, {}, null);
    expect(result.ok).toBe(true);
    expect(wk.seenAtDispatch).toEqual([null]);
    expect(w.sys.writes.some((path) => path.includes('context'))).toBe(false);
    const brief = JSON.parse(w.files[BRIEF_PATH] as string) as { records: Record<string, unknown> };
    expect(brief.records).not.toHaveProperty('contextPath');
    expect(JSON.parse(w.files[EVIDENCE_PATH] as string)).not.toHaveProperty('storedContext');
  });

  it('a dry run with an envelope still writes nothing', () => {
    const w = world();
    const wk = worker(w);
    const result = run(w, wk, { dryRun: true });
    expect(result.ok).toBe(true);
    expect(w.sys.writes).toEqual([]);
    expect(wk.calls).toEqual([]);
  });
});

describe('with an admitted envelope the runner hands the worker the stored context, by reference', () => {
  it('names the context file in the brief, and the brief still passes its provenance walk', () => {
    const w = world();
    const wk = worker(w);
    const result = run(w, wk);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.join('\n')).not.toContain('BRIEF_NOT_DERIVED');
    const brief = JSON.parse(w.files[BRIEF_PATH] as string) as { records: { contextPath: string } };
    expect(brief.records.contextPath).toBe(CONTEXT_PATH);
  });

  it('places the file before the worker is dispatched: fenced, untrusted, with the decisions and the memory in it', () => {
    const w = world();
    const wk = worker(w);
    run(w, wk);
    const seen = wk.seenAtDispatch[0];
    expect(seen).not.toBeNull();
    expect(seen).toContain('# Stored context for session');
    expect(seen).toContain(DECISION);
    expect(seen).toContain(FACT);
    expect(seen).toMatch(/<untrusted-turn fence="[0-9a-f]{16}"/);
  });

  it('removes the file as soon as the worker returns: it is never in what the checks judge, and never in the candidate', () => {
    const w = world();
    const wk = worker(w);
    run(w, wk);
    expect(CONTEXT_PATH in w.files).toBe(false);
    expect(w.statuses.afterDispatch.length).toBeGreaterThan(0);
    for (const status of w.statuses.afterDispatch) expect(status).not.toContain('.context.md');
    const evidence = JSON.parse(w.files[EVIDENCE_PATH] as string) as { changedFiles: string[] };
    expect(evidence.changedFiles.join('\n')).not.toContain('.context.md');
  });

  it('records the retrieval and each placement in the loop-written ledger, before the worker runs', () => {
    const w = world();
    const wk = worker(w);
    run(w, wk);
    expect(ledgerOf(w.files).map((entry) => [entry.event, entry.attempt, entry.sessionId])).toEqual([['retrieved', null, SESSION], ['placed', 1, SESSION]]);
    expect(ledgerOf(w.files)[0]).toMatchObject({ tenant: admittedRun().tenant, project: admittedRun().project, headCommit: HEAD, taintsRun: true });
  });

  it('places the file again for every correction, from its own copy, and removes it each time', () => {
    const w = world({ validatorExit: 1 });
    const wk = worker(w, () => {
      w.files[CONTEXT_PATH] = 'The worker rewrote this file.';
    });
    run(w, wk);
    expect(wk.calls.length).toBeGreaterThan(1);
    expect(wk.seenAtDispatch.every((text) => typeof text === 'string' && text.startsWith('# Stored context'))).toBe(true);
    expect(CONTEXT_PATH in w.files).toBe(false);
    expect(ledgerOf(w.files).filter((entry) => entry.event === 'placed').map((entry) => entry.attempt)).toEqual(wk.calls.map((_, index) => index + 1));
  });

  it('names every stored item the worker was shown in the run evidence: path, hash, rank', () => {
    const w = world();
    const wk = worker(w);
    run(w, wk);
    const evidence = JSON.parse(w.files[EVIDENCE_PATH] as string) as { storedContext: { shown: { id: string; rank: number; contentHash: string; effectiveKind: string }[]; decisions: unknown[]; contextPath: string; placedAttempts: number[] } };
    expect(evidence.storedContext.shown.map((item) => [item.id, item.rank, item.effectiveKind])).toEqual([[MEMORY_FILE, 1, 'approved-memory']]);
    expect(evidence.storedContext.shown[0]?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(evidence.storedContext.decisions).toHaveLength(1);
    expect(evidence.storedContext.placedAttempts).toEqual([1]);
    expect(evidence.storedContext.contextPath).toBe(`.projectops/execution/${SESSION}.context.md`);
  });

  it('stops before any worker when what must stay does not fit, and writes no brief', () => {
    const w = world();
    const wk = worker(w);
    const long = Array.from({ length: 4 }, (_, index) => `Decision number ${index}: ${'keep every booking record. '.repeat(15)}`);
    const committed = { [MEMORY_FILE]: storeText(long) };
    const hits = Array.from({ length: 5 }, (_, index) => ({
      citation: { project: admittedRun().project, path: `docs/n${index}.md`, startLine: 1, endLine: 9, freshness: { state: 'fresh' } },
      source: 'documents', score: 1, vectorScore: 0, textScore: 1, trust: 'untrusted-data', untrustedText: `${index} ${'an ordinary note about bookings. '.repeat(100)}`,
    }));
    const openIndex = (() => ({ search: () => ({ ok: true, hits, refused: [] }), close: () => undefined })) as unknown as ContextManagerPorts['openIndex'];
    const ports = {
      ...worldPorts({ tree: committed, stores: { memory: storeOf(long.map((text) => ({ text, kind: 'decision' as const }))) }, head: HEAD, openIndex }).ports,
      window: { limitTokens: 1100, reservedOutputTokens: 0, triggerRatio: 0.85 },
    };
    const result = run(w, wk, {}, admittedRun(), ports);
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toMatch(/REFUSED \(CONTEXT_MANAGER_/);
    expect(wk.calls).toEqual([]);
    expect(BRIEF_PATH in w.files).toBe(false);
  });

  it('refuses the run when the retrieval cannot be recorded, before any worker', () => {
    const w = world();
    w.files[`${LEDGER_DIR}/notes.txt`] = 'a file the ledger did not write';
    const wk = worker(w);
    const result = run(w, wk);
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('REFUSED (CONTEXT_NOT_RECORDED)');
    expect(wk.calls).toEqual([]);
  });

  it('refuses a malformed envelope outright', () => {
    const w = world();
    const wk = worker(w);
    const result = run(w, wk, {}, { tenant: 'x' } as unknown as TaskEnvelope);
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('REFUSED (CONTEXT_MANAGER_ENVELOPE_INVALID)');
    expect(wk.calls).toEqual([]);
  });
});

describe('a worker does not write memory or skills: refused at the check step', () => {
  it('stops a run whose worker wrote a memory file, and runs no check', () => {
    const w = world();
    const wk = worker(w, () => {
      w.files[`${ROOT}/.projectops/memory/proposals/p.json`] = '{"approved":true}';
    });
    const result = run(w, wk);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stop?.code).toBe('SCOPE_DECISION');
    expect(result.stop?.detail).toContain('MEMORY_DIRECT_WRITE');
    expect(result.lines.join('\n')).not.toContain(`PASS validator ${VALIDATOR}`);
  });

  it('stops a run whose worker wrote a skill', () => {
    const w = world();
    const wk = worker(w, () => {
      w.files[`${ROOT}/.projectops/skills/promoted/x/SKILL.md`] = 'a skill';
    });
    const result = run(w, wk);
    expect(result.ok && result.stop?.detail).toContain('MEMORY_DIRECT_WRITE');
  });

  it('sees a write git does not show, by the digest of the stores taken before and after the worker', () => {
    const w = world();
    const wk = worker(w, () => {
      w.files[`${ROOT}/${MEMORY_FILE}`] = `${COMMITTED[MEMORY_FILE]}\nA memory the worker wrote.`;
      w.hidden.add(`${ROOT}/${MEMORY_FILE}`);
    });
    const result = run(w, wk);
    expect(result.ok && result.stop?.detail).toContain('MEMORY_STORE_CHANGED');
  });

  it('passes a worker that touched neither store', () => {
    const w = world();
    const wk = worker(w, () => {
      w.files[`${ROOT}/src/new.ts`] = 'export {};';
    });
    const result = run(w, wk);
    expect(result.ok && result.stop?.code).toBe('OWNER_GATE');
  });
});

describe('review round 1: item 1, the empty retrieval; item 7, the pointer; item 2, the guard', () => {
  it('places no file and names none in the brief when nothing is stored, and still records the retrieval', () => {
    const w = world();
    const wk = worker(w);
    const result = run(w, wk, {}, admittedRun(), contextPorts(w, { tree: {}, stores: {} }));
    expect(result.ok).toBe(true);
    expect(wk.seenAtDispatch).toEqual([null]);
    const brief = JSON.parse(w.files[BRIEF_PATH] as string) as { records: Record<string, unknown> };
    expect(brief.records).not.toHaveProperty('contextPath');
    expect(ledgerOf(w.files).map((entry) => entry.event)).toEqual(['retrieved']);
  });

  it('writes the ledger in the state directory and nothing of it in the project tree', () => {
    const w = world();
    run(w, worker(w));
    expect(Object.keys(w.files).some((path) => path.startsWith(`${ROOT}/.projectops/context-ledger`))).toBe(false);
    expect(Object.keys(w.files).some((path) => path.startsWith(`${STATE}/context-ledger/`))).toBe(true);
  });

  it('refuses a worker kind that is not told where the file is, before any file is placed, so the record never says shown when it was not', () => {
    const w = world({ kind: 'test-worker' });
    const wk = worker(w, () => undefined, 'test-worker');
    const result = run(w, wk);
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('REFUSED (CONTEXT_NOT_POINTABLE)');
    expect(wk.calls).toEqual([]);
    expect(ledgerOf(w.files).filter((entry) => entry.event === 'placed')).toEqual([]);
  });

  it('judges a direct store write even when the run has no admitted envelope and no context', () => {
    const w = world();
    const wk = worker(w, () => {
      w.files[`${ROOT}/.projectops/memory/proposals/p.json`] = '{"approved":true}';
    });
    const result = run(w, wk, {}, null);
    expect(result.ok && result.stop?.detail).toContain('MEMORY_DIRECT_WRITE');
  });

  it('keeps its baseline across the checks: check code that writes a store is caught after the checks', () => {
    const w = world({
      onValidator: (files) => {
        files[`${ROOT}/.projectops/skills/promoted/x/SKILL.md`] = 'written by a check';
      },
    });
    const result = run(w, worker(w));
    expect(result.ok && result.stop?.code).toBe('SCOPE_DECISION');
    expect(result.ok && result.stop?.detail).toContain('MEMORY_DIRECT_WRITE');
  });
});
