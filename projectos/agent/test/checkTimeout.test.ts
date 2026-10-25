/**
 * EVERY CHECK IS BOUNDED, AND A STOPPED CHECK NEVER PASSES — PROJECTOS-BOOT-CONTINUE1A.
 *
 * Configured checks ran with no limit, so one hung suite held a governed run open for ever. These
 * prove, with a real child process, that a check outliving its bound is stopped and reported as a
 * failure that names the bound, and that the bound is recorded on every result.
 */
import { describe, it, expect } from 'vitest';
import { execPath } from 'node:process';
import { nodeSystem } from '../src/system.js';
import { configuredChecks, runCheck, DEFAULT_CHECK_TIMEOUT_MS } from '../src/loop/verification.js';
import { tmpdir } from 'node:os';

const ROOT = tmpdir();

describe('runCheck under a bound', () => {
  it('a check that outlives its bound is stopped, fails and says why', () => {
    const r = runCheck(nodeSystem, ROOT, {
      id: 'hangs',
      kind: 'test',
      command: execPath,
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      unrunnable: null,
      timeoutMs: 1500,
    });
    expect(r.passed).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.timeoutMs).toBe(1500);
    expect(r.output).toContain('did not finish');
  }, 30_000);

  it('a check that finishes passes and records the default bound it ran under', () => {
    const r = runCheck(nodeSystem, ROOT, { id: 'quick', kind: 'test', command: execPath, args: ['-e', 'process.exit(0)'], unrunnable: null });
    expect(r.passed).toBe(true);
    expect(r.timedOut).toBeUndefined();
    expect(r.timeoutMs).toBe(DEFAULT_CHECK_TIMEOUT_MS);
  });

  it('a failing check stays a failure and is not reported as a timeout', () => {
    const r = runCheck(nodeSystem, ROOT, { id: 'fails', kind: 'test', command: execPath, args: ['-e', 'process.exit(3)'], unrunnable: null });
    expect(r.passed).toBe(false);
    expect(r.exitCode).toBe(3);
    expect(r.timedOut).toBeUndefined();
  });
});

describe('configuredChecks timeoutMinutes', () => {
  const base = { id: 'agent-tests', kind: 'test', command: execPath, args: [] };
  it('accepts a whole number of minutes within range', () => {
    const { checks, problems } = configuredChecks({ execution: { checks: [{ ...base, timeoutMinutes: 120 }] } });
    expect(problems).toEqual([]);
    expect(checks[0]?.timeoutMs).toBe(120 * 60_000);
  });
  it('refuses, and drops, an unusable bound rather than running unbounded', () => {
    for (const bad of [0, -5, 241, 1.5, '60', null]) {
      const { checks, problems } = configuredChecks({ execution: { checks: [{ ...base, timeoutMinutes: bad }] } });
      expect(checks).toEqual([]);
      expect(problems.join(' ')).toContain('timeoutMinutes');
    }
  });
  it('leaves the bound to the default when none is declared', () => {
    const { checks } = configuredChecks({ execution: { checks: [base] } });
    expect(checks[0]?.timeoutMs).toBeUndefined();
  });
});
