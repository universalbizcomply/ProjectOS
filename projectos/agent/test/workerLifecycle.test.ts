/**
 * A WORKER ATTEMPT HAS TO BE ABLE TO END.
 *
 * ProjectOS starts a worker and waits for it, synchronously. Before
 * PROJECTOS-WORKER-CHANNEL-HARDENING1A that wait had no bound at all: a worker that hung held the
 * attempt, the phase and the process open indefinitely, and nothing inside the runtime could end it.
 * The only remedy was killing the run from outside, which leaves no truthful account of what
 * happened — the session record still says a worker was started and never says anything else.
 *
 * These use REAL child processes, because the property being proved is about processes. A fake that
 * returns `{failure:'timeout'}` proves the mapping and nothing about whether anything was actually
 * bounded, actually killed, or actually gone afterwards.
 *
 * WHAT IS DELIBERATELY NOT CLAIMED. The runtime terminates the process it started and verifies that
 * process is gone. It never learned the identity of anything that process went on to start, and
 * killing a pid you did not create is exactly how an unrelated process gets terminated — so nothing
 * here asserts ownership of descendants, and nothing in the runtime kills by name.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { nodeSystem } from '../src/system.js';
import { claudeCodeCliAdapter, CLAUDE_CODE_CLI } from '../src/loop/adapters/claudeCodeCli.js';
import {
  authorisedWorkers,
  DEFAULT_WORKER_TIMEOUT_MS,
  MAX_WORKER_TIMEOUT_MS,
  type AuthorisedWorker,
} from '../src/loop/workers.js';
import type { GovernedContext } from '../src/governedContext.js';
import type { WorkerBrief } from '../src/loop/brief.js';
import type { System, ExecResult } from '../src/system.js';

/** A child that records its own pid and then never finishes on its own. */
const HANGS = 'require("fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);';

/** Whether a pid still names a live process. `ESRCH` is the only answer that means "gone". */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'projectos-worker-'));
}

describe('a bound is a bound', () => {
  it('ends a child that would otherwise run forever, and says that is what happened', () => {
    const dir = scratch();
    const started = Date.now();
    const r = nodeSystem.exec(process.execPath, ['-e', HANGS, join(dir, 'child.pid')], { timeoutMs: 1200 });
    const elapsed = Date.now() - started;

    // BOUNDED IN FACT, not merely requested. The child had no exit of its own to reach.
    expect(elapsed).toBeLessThan(15_000);
    expect(r.failure).toBe('timeout');
    rmSync(dir, { recursive: true, force: true });
  });

  it('the process it started is really gone, checked rather than assumed', () => {
    const dir = scratch();
    const pidFile = join(dir, 'child.pid');
    nodeSystem.exec(process.execPath, ['-e', HANGS, pidFile], { timeoutMs: 1200 });

    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(Number.isInteger(pid)).toBe(true);
    // THE CLEANUP THIS RUNTIME CLAIMS. Exactly the process it spawned, verified by its own pid.
    expect(alive(pid)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('terminates nothing else — a process this test owns is untouched', async () => {
    const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });
    // Started by this test, ended by this test, addressed by the exact pid it was given. Nothing in
    // the runtime may do this to a process it did not create, which is why the test does it itself.
    try {
      await new Promise((res) => setTimeout(res, 200));
      expect(alive(bystander.pid as number)).toBe(true);

      const dir = scratch();
      nodeSystem.exec(process.execPath, ['-e', HANGS, join(dir, 'child.pid')], { timeoutMs: 1000 });
      rmSync(dir, { recursive: true, force: true });

      expect(alive(bystander.pid as number)).toBe(true);
    } finally {
      bystander.kill();
    }
  });

  it('a child that finishes inside its bound is unaffected by having one', () => {
    const r = nodeSystem.exec(process.execPath, ['-e', 'process.stdout.write("done"); process.exit(0);'], {
      timeoutMs: 30_000,
    });
    expect(r.failure).toBeUndefined();
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('done');
  });
});

describe('an exit state that is not known is not reported as one', () => {
  it('a non-zero exit is a real exit, and says nothing about a bound', () => {
    const r = nodeSystem.exec(process.execPath, ['-e', 'process.exit(3);'], { timeoutMs: 30_000 });
    expect(r.code).toBe(3);
    expect(r.failure).toBeUndefined();
  });

  it('a child that RAN and printed too much is not reported as one that never started', () => {
    // FOUND BY REVIEW, REPRODUCED BEFORE IT WAS FIXED. Node kills a child that exceeds the output
    // limit and reports `ENOBUFS` — with a null status, exactly like a missing executable. Folded
    // together, a worker that ran and worked came back as "the executable could not be started".
    const noisy = 'process.stdout.write("x".repeat(3 * 1024 * 1024));';
    const r = nodeSystem.exec(process.execPath, ['-e', noisy], { timeoutMs: 30_000, maxOutputBytes: 1024 });
    expect(r.failure).toBe('output-overflow');
  });

  it('a generous output allowance lets an ordinary long result through', () => {
    // The bound exists so a faulty child cannot exhaust memory. It must not turn a run that worked
    // into a run that failed, which is what Node's own default did.
    const long = 'process.stdout.write("y".repeat(2 * 1024 * 1024));';
    const r = nodeSystem.exec(process.execPath, ['-e', long], { timeoutMs: 30_000, maxOutputBytes: 16 * 1024 * 1024 });
    expect(r.failure).toBeUndefined();
    expect(r.code).toBe(0);
    expect(r.stdout.length).toBe(2 * 1024 * 1024);
  });

  it('an executable that never started is not reported as having exited 1', () => {
    // THE LIE THIS REMOVES. `status` is null both for a child that was killed and for one that never
    // existed, and both were reported as exit code 1 — the same answer a program that ran and failed
    // gives. Three different events cannot share one number.
    const r = nodeSystem.exec(join(tmpdir(), 'projectos-no-such-executable-xyz.exe'), []);
    expect(r.failure).toBe('not-started');
  });
});

/* ---------------------------------------------------------------------------------------------- *
 * What the adapter makes of each of those.
 * ---------------------------------------------------------------------------------------------- */

const WORKER: AuthorisedWorker = {
  workerId: 'claude-local',
  kind: CLAUDE_CODE_CLI,
  command: 'C:/Users/x/AppData/Roaming/npm/claude.cmd',
  args: [],
  timeoutMs: 60_000,
};

function brief(): WorkerBrief {
  return {
    repository: { root: 'C:/proj', head: 'a'.repeat(40) },
    records: { briefPath: 'C:/proj/.projectops/execution/S1.brief.json' },
  } as unknown as WorkerBrief;
}

interface ExecOptionSpy {
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

/** A System whose `exec` returns exactly one prepared result, and records the options it was given. */
function systemReturning(result: ExecResult): System & { options: ExecOptionSpy[] } {
  const options: ExecOptionSpy[] = [];
  const sys = {
    options,
    cwd: () => 'C:/proj',
    now: () => '2026-08-30T00:00:00Z',
    readText: () => null,
    writeText: () => undefined,
    exists: () => false,
    listDir: () => [],
    renameFile: () => true,
    createExclusive: () => true,
    removeFile: () => true,
    exec: (_c: string, _a: readonly string[], o?: ExecOptionSpy) => {
      options.push(o ?? {});
      return result;
    },
  };
  return sys as unknown as System & { options: ExecOptionSpy[] };
}

describe('the adapter reports the three outcomes as three outcomes', () => {
  it('passes the bound down to the spawn, so the attempt is bounded in fact and not only on paper', () => {
    const sys = systemReturning({ code: 0, stdout: '{}', stderr: '' });
    claudeCodeCliAdapter.start(sys, WORKER, brief(), 'C:/proj/b.json');
    expect(sys.options[0]?.timeoutMs).toBe(60_000);
  });

  it('a timed-out attempt is timedOut, and takes no handle from what it left behind', () => {
    // The partial output is a PERFECTLY PARSEABLE handle document. That is the trap: reading it
    // would let a later rejoin continue a session the worker never finished reporting.
    const sys = systemReturning({
      code: 1,
      stdout: JSON.stringify({ session_id: 'handle-from-an-unfinished-run' }),
      stderr: '',
      failure: 'timeout',
    });
    const out = claudeCodeCliAdapter.start(sys, WORKER, brief(), 'C:/proj/b.json');
    expect(out.kind).toBe('timedOut');
    if (out.kind !== 'timedOut') return;
    expect(out.afterMs).toBe(60_000);
    expect(out).not.toHaveProperty('providerRef');
    expect(out).not.toHaveProperty('exitCode');
  });

  it('a worker whose output overran the limit is not called an executable that never started', () => {
    const sys = systemReturning({ code: 1, stdout: 'x'.repeat(64), stderr: '', failure: 'output-overflow' });
    const out = claudeCodeCliAdapter.start(sys, WORKER, brief(), 'C:/proj/b.json');
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') return;
    expect(out.detail).toContain('the worker ran');
    expect(out.detail).not.toContain('could not be started');
  });

  it('asks for an output allowance large enough that an ordinary result is not mistaken for a failure', () => {
    const sys = systemReturning({ code: 0, stdout: '{}', stderr: '' });
    claudeCodeCliAdapter.start(sys, WORKER, brief(), 'C:/proj/b.json');
    expect(sys.options[0]?.maxOutputBytes).toBeGreaterThanOrEqual(16 * 1024 * 1024);
  });

  it('an executable that never started is a refusal that says nothing ran', () => {
    const sys = systemReturning({ code: 1, stdout: '', stderr: 'nope', failure: 'not-started' });
    const out = claudeCodeCliAdapter.start(sys, WORKER, brief(), 'C:/proj/b.json');
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') return;
    expect(out.detail).toContain('nothing ran');
  });

  it('an ordinary run is untouched: exit code kept, handle parsed', () => {
    const sys = systemReturning({ code: 0, stdout: JSON.stringify({ session_id: 'sess-1' }), stderr: '' });
    const out = claudeCodeCliAdapter.start(sys, WORKER, brief(), 'C:/proj/b.json');
    expect(out.kind).toBe('completed');
    if (out.kind !== 'completed') return;
    expect(out.exitCode).toBe(0);
    expect(out.providerRef).toBe('sess-1');
  });

  it('a non-zero exit stays a non-zero exit, distinguishable from a bound that was reached', () => {
    const sys = systemReturning({ code: 7, stdout: '', stderr: 'boom' });
    const out = claudeCodeCliAdapter.start(sys, WORKER, brief(), 'C:/proj/b.json');
    expect(out.kind).toBe('completed');
    if (out.kind !== 'completed') return;
    expect(out.exitCode).toBe(7);
  });

  it('refuses to start a worker that carries no bound at all', () => {
    // Unreachable through the configuration path, which always supplies one — which is why it is
    // guarded: a future caller that hand-built a worker would otherwise silently restore the
    // unlimited wait this phase removed, and nothing else would notice.
    const unbounded = { ...WORKER, timeoutMs: undefined as unknown as number };
    const sys = systemReturning({ code: 0, stdout: '{}', stderr: '' });
    const out = claudeCodeCliAdapter.start(sys, unbounded, brief(), 'C:/proj/b.json');
    expect(out.kind).toBe('refused');
    // AND NOTHING WAS SPAWNED. The refusal has to come before the process, not after it.
    expect(sys.options).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------------------------------------- *
 * Where the bound comes from.
 * ---------------------------------------------------------------------------------------------- */

function context(execution: unknown): GovernedContext {
  return { config: { execution } } as unknown as GovernedContext;
}

const BASE = { workerId: 'w', kind: CLAUDE_CODE_CLI, command: 'C:/tools/claude.cmd' };

describe('the bound a project declares', () => {
  it('defaults when the project says nothing — never to unbounded', () => {
    const r = authorisedWorkers(context({ workers: [BASE] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workers[0]?.timeoutMs).toBe(DEFAULT_WORKER_TIMEOUT_MS);
  });

  it('takes a declared bound as declared', () => {
    const r = authorisedWorkers(context({ workers: [{ ...BASE, timeoutMs: 300_000 }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workers[0]?.timeoutMs).toBe(300_000);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['wider than the permitted maximum', MAX_WORKER_TIMEOUT_MS + 1],
    ['not a number', 'soon'],
    ['a numeric string', '60000'],
    ['fractional', 1500.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative zero', -0],
    ['larger than any real wait', 1e21],
  ])('refuses a bound that is %s, rather than quietly substituting the default', (_label, value) => {
    // SAYING NOTHING AND SAYING SOMETHING IMPOSSIBLE ARE DIFFERENT. Silently replacing the second
    // with the default would hide a mistake in the one file the owner reviews.
    const r = authorisedWorkers(context({ workers: [{ ...BASE, timeoutMs: value }] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain('timeoutMs');
  });
});
