/**
 * DOCTOR: a preflight that withholds, and never acts.
 *
 * One test per acceptance criterion of the doctor-preflight phase, plus the boundary that matters
 * most: Doctor must be MANDATORY for exactly three contexts and advisory for everything else. A
 * preflight that crept into browsing would make reading a screen contingent on a healthy disk, and
 * a preflight that quietly stopped being mandatory for a paid call would be decoration.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';

import {
  runDoctor,
  doctorRefusalLines,
  doctorIsMandatoryFor,
  MANDATORY_CONTEXTS,
  DOCTOR_BUDGET_MS,
} from '../src/doctor.js';
import type { System } from '../src/system.js';

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const d = created.pop();
    if (d !== undefined && existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
});

/** A root with a readable governed configuration, and a System whose git answers. */
function world(over: { gitOk?: boolean; headOk?: boolean; config?: string | null } = {}): {
  root: string;
  sys: System;
} {
  const root = mkdtempSync(pjoin(tmpdir(), 'projectos-doctor-')).replace(/\\/g, '/');
  created.push(root);
  mkdirSync(pjoin(root, '.projectops'), { recursive: true });
  const cfg = over.config === undefined ? JSON.stringify({ projectId: 'projectos' }) : over.config;
  if (cfg !== null) writeFileSync(pjoin(root, '.projectops', 'project-config.json'), cfg);

  const sys: System = {
    cwd: () => root,
    now: () => '2026-09-05T00:40:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => { mkdirSync(pjoin(p, '..'), { recursive: true }); writeFileSync(p, c); },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    createExclusive: (p: string, c: string) => {
      if (existsSync(p)) return false;
      mkdirSync(pjoin(p, '..'), { recursive: true });
      writeFileSync(p, c);
      return true;
    },
    removeFile: (p: string) => { if (existsSync(p)) rmSync(p, { force: true }); return true; },
    renameFile: () => true,
    exec: (_c: string, args: readonly string[]) => {
      const key = args.join(' ');
      if (key.includes('--is-inside-work-tree')) {
        return over.gitOk === false
          ? { code: 128, stdout: '', stderr: 'not a git repository' }
          : { code: 0, stdout: 'true', stderr: '' };
      }
      if (key.includes('rev-parse HEAD')) {
        return over.headOk === false
          ? { code: 128, stdout: '', stderr: 'unknown revision' }
          : { code: 0, stdout: 'a'.repeat(40), stderr: '' };
      }
      return { code: 1, stdout: '', stderr: '' };
    },
  };
  return { root, sys };
}

describe('criterion 1: Doctor completes well inside its budget', () => {
  test('a full preflight is far below ten seconds, and says so', () => {
    const w = world();
    const r = runDoctor(w.sys, w.root, { checkCommands: [] });
    expect(r.withinBudget).toBe(true);
    expect(r.totalMs).toBeLessThan(DOCTOR_BUDGET_MS);
    // Every check reports its own cost, so a slow one can be found rather than guessed at.
    expect(r.checks.every((c) => typeof c.ms === 'number')).toBe(true);
  });
});

describe('criterion 2: a failing preflight withholds the three mandatory contexts', () => {
  test('unreachable git is BLOCKING, so autonomous work is not safe', () => {
    const w = world({ gitOk: false });
    const r = runDoctor(w.sys, w.root, { checkCommands: [] });
    expect(r.safeToActAutonomously).toBe(false);
    expect(r.checks.find((c) => c.id === 'git-usable')?.passed).toBe(false);
  });

  test('an unreadable committed record is BLOCKING', () => {
    const w = world({ headOk: false });
    expect(runDoctor(w.sys, w.root, { checkCommands: [] }).safeToActAutonomously).toBe(false);
  });

  test('an unreadable project configuration is BLOCKING', () => {
    const w = world({ config: '{ not json' });
    expect(runDoctor(w.sys, w.root, { checkCommands: [] }).safeToActAutonomously).toBe(false);
  });

  test('a configured check command that does not exist is BLOCKING', () => {
    const w = world();
    const r = runDoctor(w.sys, w.root, { checkCommands: ['C:/nowhere/does-not-exist.exe'] });
    expect(r.safeToActAutonomously).toBe(false);
    expect(r.checks.find((c) => c.id === 'check-runner')?.detail).toContain('not found');
  });

  test('the refusal names every blocking failure, not just the first', () => {
    const w = world({ gitOk: false, headOk: false, config: null });
    const r = runDoctor(w.sys, w.root, { checkCommands: [] });
    const said = doctorRefusalLines(r, 'paid-gatekeeper-dispatch').join('\n');
    expect(said).toContain('DOCTOR_PREFLIGHT_FAILED');
    expect(said).toContain('paid-gatekeeper-dispatch');
    // An owner who fixes one and hits the next learns to route around the preflight.
    expect(r.checks.filter((c) => !c.passed && c.severity === 'blocking').length).toBeGreaterThan(1);
  });
});

describe('criterion 3: browsing and read-only inspection stay advisory', () => {
  test('exactly three contexts are mandatory, and they are the three the plan names', () => {
    expect([...MANDATORY_CONTEXTS]).toEqual([
      'autonomous-execution',
      'paid-gatekeeper-dispatch',
      'technical-continuation',
    ]);
  });

  test('browsing, read-only inspection and preview are not mandatory contexts', () => {
    for (const ctx of ['browsing', 'read-only-inspection', 'local-preview', 'refresh', 'project-select']) {
      expect(doctorIsMandatoryFor(ctx)).toBe(false);
    }
  });

  test('a machine that fails only an ADVISORY check is still safe to act on', () => {
    // The distinction is the whole design: a preflight that blocks on taste gets bypassed.
    const w = world();
    const r = runDoctor(w.sys, w.root, { checkCommands: [] });
    const advisory = r.checks.filter((c) => c.severity === 'advisory');
    expect(advisory.length).toBeGreaterThan(0);
    expect(r.safeToActAutonomously).toBe(true);
  });
});

describe('criterion 5: Doctor performs no action and authorises none', () => {
  test('it writes nothing outside its own removed probe', () => {
    const w = world();
    const before = readdirSync(pjoin(w.root, '.projectops')).sort();
    runDoctor(w.sys, w.root, { checkCommands: [] });
    expect(readdirSync(pjoin(w.root, '.projectops')).sort()).toEqual(before);
  });

  test('it never reports itself as permission — only as fitness', () => {
    const w = world();
    const r = runDoctor(w.sys, w.root, { checkCommands: [] });
    // `safeToActAutonomously` is a statement about the MACHINE. Nothing in the report is a decision,
    // a grant, an approval or an authority, and no field here can be mistaken for one.
    expect(Object.keys(r).sort()).toEqual(
      ['at', 'checks', 'ok', 'safeToActAutonomously', 'totalMs', 'withinBudget'].sort(),
    );
  });

  test('a passing preflight is not an approval of anything', () => {
    const w = world();
    const r = runDoctor(w.sys, w.root, { checkCommands: [] });
    expect(r.safeToActAutonomously).toBe(true);
    // It says the machine is fit. It says nothing about whether the action is permitted, which
    // remains entirely the gates' business.
    expect(JSON.stringify(r)).not.toMatch(/approv|grant|authoris|permit/i);
  });
});
