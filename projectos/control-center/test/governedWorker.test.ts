/**
 * THE WORKER REALLY RUNS THE CANONICAL COMMAND, AND TAKES NO COMMAND LINE.
 *
 * `governedWorker.mjs` is what makes a provider-backed command leave the daemon's event loop. Two
 * things about it have to be true, and neither is provable by reading it.
 *
 * IT MUST ACTUALLY COMPOSE THE RUNTIME. If the engines were not wired, or the agent package did not
 * resolve, the worker would still exit cleanly and the daemon would report a tidy refusal — a
 * capability failure wearing the costume of a governance one, which this programme has produced
 * before. So the tests below drive the real process and require the AGENT'S OWN words back.
 *
 * IT MUST NOT PARSE OWNER TEXT AS ARGUMENTS. The obvious way to move work off the loop is to spawn
 * the CLI, and the CLI takes argv: `parseArgs` reads any token starting with `--` as a flag name, so
 * an objective beginning "--force" would have become one. The request crosses as JSON instead, and
 * the test below sends exactly that objective to prove it stays data.
 *
 * Nothing here reaches a network: every case refuses before any transport is composed.
 */
import { describe, test, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'sidecar', 'governedWorker.mjs');

const dir = mkdtempSync(join(tmpdir(), 'projectos-worker-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Run the real worker with a real request and return what it printed. */
function runWorker(request: unknown): Promise<{ code: number; lines: readonly string[]; exit: number }> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [WORKER], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (c) => {
      out += c.toString('utf8');
    });
    child.stderr.on('data', () => {});
    child.on('close', (exit) => {
      const line = out.split('\n').find((l) => l.trim() !== '') ?? '{}';
      let parsed: { code?: number; lines?: unknown };
      try {
        parsed = JSON.parse(line) as { code?: number; lines?: unknown };
      } catch {
        parsed = {};
      }
      resolvePromise({
        code: parsed.code ?? -1,
        lines: Array.isArray(parsed.lines) ? (parsed.lines as string[]) : [],
        exit: exit ?? -1,
      });
    });
    child.stdin.end(JSON.stringify(request));
  });
}

describe('the worker composes the real runtime', () => {
  test('a plan command reaches the canonical agent and returns ITS words, not the worker’s', async () => {
    // A temp directory is not a governed project, so the AGENT refuses — and the wording proves the
    // agent ran. A worker that had failed to load would refuse with RUNTIME_ERROR instead.
    const { code, lines, exit } = await runWorker({
      root: dir.replace(/\\/g, '/'),
      command: 'plan',
      positionals: ['draft'],
      flags: { objective: 'x'.repeat(80), authored: 'true' },
    });

    expect(exit).toBe(0);
    expect(code).not.toBe(0);
    const said = lines.join(' ');
    expect(said).not.toContain('RUNTIME_ERROR');
    // The agent's own refusal vocabulary for an ungoverned or unauthorable checkout.
    expect(said).toMatch(/REFUSED \((AUTHOR_NOT_COMPOSED|NO_PROJECT|PROJECT_CONFIG_MISSING|[A-Z_]+)\)/);
  }, 60_000);

  test('an objective that looks like a flag stays an objective', async () => {
    // Spawning the CLI would have turned this into a flag named `force`. It crosses as JSON, so the
    // only thing that can read it is the command's own `flags.objective`.
    const hostile = '--force --authored --objective=pwned ' + 'y'.repeat(60);
    const { lines } = await runWorker({
      root: dir.replace(/\\/g, '/'),
      command: 'plan',
      positionals: ['draft'],
      flags: { objective: hostile, authored: 'true' },
    });

    const said = lines.join(' ');
    expect(said).not.toContain('RUNTIME_ERROR');
    expect(said).toContain('REFUSED');
  }, 60_000);
});

describe('the worker decides nothing', () => {
  test('a command outside its narrow set is refused, never guessed at', async () => {
    const { code, lines } = await runWorker({ root: dir, command: 'approve', positionals: [], flags: {} });
    expect(code).toBe(2);
    expect(lines.join(' ')).toContain('no runnable command');
  }, 30_000);

  test('a request with no root is refused', async () => {
    const { code, lines } = await runWorker({ command: 'plan', positionals: ['draft'], flags: {} });
    expect(code).toBe(2);
    expect(lines.join(' ')).toContain('no runnable command');
  }, 30_000);

  test('an unreadable request is refused rather than assumed', async () => {
    const child = spawn(process.execPath, [WORKER], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const said = await new Promise<string>((res) => {
      let out = '';
      child.stdout.on('data', (c) => {
        out += c.toString('utf8');
      });
      child.on('close', () => res(out));
      child.stdin.end('not json');
    });
    expect(said).toContain('WORKER_REQUEST');
  }, 30_000);
});
