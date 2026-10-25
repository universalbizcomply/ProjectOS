/**
 * The execution loop's phase selection and its context verification.
 *
 * WHAT THESE TESTS ARE GUARDING. The loop is the component that starts work with no human reading
 * the decision first, so the two ways it can be wrong are (1) picking a phase the governance gate
 * would refuse, and (2) picking the right phase in the wrong world — wrong repository, a protected
 * branch, an unreadable HEAD. Both are silent at the moment they happen: the loop looks like it is
 * working. So every negative below asserts the refusal AND that nothing was written.
 *
 * THE PLAN FIXTURE IS THIS REPOSITORY'S REAL APPROVED PLAN, with only `phases` replaced. A
 * hand-rolled plan literal would drift from the shipped schema, and several of these cases —
 * an unsatisfiable dependency, a plan with no phases — are deliberately states the plan schema and
 * readiness rules REFUSE, so they can only be reached by constructing the context directly. That is
 * the honest way to test the function's own contract rather than a state it can never be handed.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { selectNextPhase } from '../src/loop/selection.js';
import { verifyExecutionContext } from '../src/loop/observation.js';
import type { GovernedContext } from '../src/governedContext.js';
import type { System, ExecResult } from '../src/system.js';
import type { Phase, PhaseStatus, ProjectConfig } from '@projectos/core';

const ROOT = '/proj';

/** This repository's real project config, so the config shape cannot drift from the shipped one. */
function realConfig(): ProjectConfig {
  const p = resolve(__dirname, '../../../.projectops/project-config.json');
  return JSON.parse(readFileSync(p, 'utf8')) as ProjectConfig;
}

/** This repository's real approved recovery plan, for the same reason. */
function realPlan(): Record<string, unknown> {
  const p = resolve(__dirname, '../../state/projectos-recovery.plan.json');
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

/** A plan phase in the shape the plan schema requires. */
function planPhase(phaseId: string, dependsOn: readonly string[] = []): Record<string, unknown> {
  return {
    phaseId,
    description: `the ${phaseId} phase`,
    dependsOn,
    acceptanceCriteria: [`${phaseId} is done`],
    riskLevel: 'medium',
    autonomyLevel: 'local-safe',
    requiredValidators: ['validate-all'],
    requiredReviews: ['code-review'],
    requiredBrowserProof: false,
    requiredOwnerGates: ['commit'],
  };
}

function contextWith(phases: readonly Record<string, unknown>[]): GovernedContext {
  const config = realConfig();
  return {
    config,
    plan: { ...realPlan(), phases },
    projectId: config.projectId,
    planPath: `${ROOT}/state/plan.json`,
    currentStatePath: `${ROOT}/state/current.json`,
  };
}

interface FakeOpts {
  readonly phases?: Readonly<Record<string, Phase>>;
  readonly completed?: readonly string[];
  readonly exec?: (cmd: string, args: readonly string[]) => ExecResult;
}

function fakeSystem(opts: FakeOpts = {}) {
  const records = opts.phases ?? {};
  const files: Record<string, string> = {
    [`${ROOT}/state/current.json`]: JSON.stringify({ completedPhases: opts.completed ?? [] }),
  };
  for (const [id, rec] of Object.entries(records)) {
    files[`${ROOT}/.projectops/phases/${id}.json`] = JSON.stringify(rec);
  }
  const writes: string[] = [];
  const sys: System & { writes: string[] } = {
    writes,
    cwd: () => ROOT,
    now: () => '2026-08-11T18:00:00Z',
    readText: (p) => files[p] ?? null,
    writeText: (p, c) => {
      writes.push(p);
      files[p] = c;
    },
    exists: (p) => p in files,
    listDir: (p) => (p === `${ROOT}/.projectops/phases` ? Object.keys(records).map((id) => `${id}.json`) : []),
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: opts.exec ?? (() => ({ code: 0, stdout: '', stderr: '' })),
  };
  return sys;
}

function record(phaseId: string, status: PhaseStatus): Phase {
  return { phaseId, project: 'projectos', objective: 'o', status, history: [] };
}

const AB = [planPhase('PH-A'), planPhase('PH-B', ['PH-A'])];

describe('selectNextPhase', () => {
  it('starts the first plan phase when nothing has been recorded', () => {
    const sys = fakeSystem();
    const sel = selectNextPhase(sys, ROOT, contextWith(AB));
    expect(sel.kind).toBe('start');
    if (sel.kind === 'start') expect(sel.planPhase.phaseId).toBe('PH-A');
    expect(sys.writes).toEqual([]);
  });

  it('continues an open phase rather than starting the next one', () => {
    const sys = fakeSystem({ phases: { 'PH-A': record('PH-A', 'implementing') } });
    const sel = selectNextPhase(sys, ROOT, contextWith(AB));
    expect(sel.kind).toBe('continue');
    if (sel.kind === 'continue') {
      expect(sel.planPhase.phaseId).toBe('PH-A');
      expect(sel.record.status).toBe('implementing');
    }
  });

  it('advances to the dependent phase once its dependency is recorded complete', () => {
    const sys = fakeSystem({ completed: ['PH-A'] });
    const sel = selectNextPhase(sys, ROOT, contextWith(AB));
    expect(sel.kind).toBe('start');
    if (sel.kind === 'start') expect(sel.planPhase.phaseId).toBe('PH-B');
  });

  it('stops at a phase awaiting closure — closure is the owner’s, never the loop’s', () => {
    const sys = fakeSystem({ phases: { 'PH-A': record('PH-A', 'awaiting_closure') } });
    const sel = selectNextPhase(sys, ROOT, contextWith(AB));
    expect(sel.kind).toBe('stop');
    if (sel.kind === 'stop') {
      expect(sel.reason.code).toBe('OWNER_DECISION_REQUIRED');
      expect(sel.reason.detail).toContain('PH-A');
    }
    expect(sys.writes).toEqual([]);
  });

  it('stops on a blocked phase instead of stepping over it', () => {
    const sys = fakeSystem({ phases: { 'PH-A': record('PH-A', 'closed_as_blocked') } });
    const sel = selectNextPhase(sys, ROOT, contextWith(AB));
    expect(sel.kind).toBe('stop');
    if (sel.kind === 'stop') expect(sel.reason.code).toBe('PHASE_BLOCKED');
  });

  it('does not resume a rolled-back phase on its own', () => {
    const sys = fakeSystem({ phases: { 'PH-A': record('PH-A', 'rolled_back') } });
    const sel = selectNextPhase(sys, ROOT, contextWith(AB));
    expect(sel.kind).toBe('stop');
    if (sel.kind === 'stop') expect(sel.reason.code).toBe('OWNER_DECISION_REQUIRED');
  });

  it('reports the programme complete when every plan phase is recorded complete', () => {
    const sys = fakeSystem({ completed: ['PH-A', 'PH-B'] });
    const sel = selectNextPhase(sys, ROOT, contextWith(AB));
    expect(sel.kind).toBe('stop');
    if (sel.kind === 'stop') expect(sel.reason.code).toBe('PROGRAMME_COMPLETE');
  });

  it('surfaces a record that claims closed while the completion sources do not', () => {
    const sys = fakeSystem({ phases: { 'PH-A': record('PH-A', 'closed') } });
    const sel = selectNextPhase(sys, ROOT, contextWith(AB));
    expect(sel.kind).toBe('stop');
    if (sel.kind === 'stop') expect(sel.reason.code).toBe('RECORD_DISAGREES_WITH_PLAN');
  });

  it('never selects a phase the authorisation gate would refuse', () => {
    const sys = fakeSystem();
    const sel = selectNextPhase(sys, ROOT, contextWith([planPhase('PH-B', ['PH-MISSING'])]));
    expect(sel.kind).toBe('stop');
    if (sel.kind === 'stop') {
      expect(sel.reason.code).toBe('DEPENDENCY_NOT_SATISFIED');
      expect(sel.reason.detail).toContain('PH-MISSING');
    }
    expect(sys.writes).toEqual([]);
  });

  it('reports an empty plan honestly instead of reporting completion', () => {
    const sys = fakeSystem();
    const sel = selectNextPhase(sys, ROOT, contextWith([]));
    expect(sel.kind).toBe('stop');
    if (sel.kind === 'stop') expect(sel.reason.code).toBe('NO_PHASES');
  });
});

/**
 * THE ONE HISTORICAL-TO-CONTINUATION PAIRING — PROJECTOS-HOST-REVIEW-PATH1B.
 *
 * The planning mechanism cannot retire an unfinished phase, so the historical host review phase is
 * still first in plan order while the owner has ruled it must never be implemented on its own. Each
 * branch of the ratified rule is asserted here; `val-projectos-work-record-not-authority1a` pins that
 * the pairing stays exactly this one pair.
 */
describe('selectNextPhase — the historical host review phase is never selected for implementation', () => {
  const HISTORICAL = 'PROJECTOS-HOST-REVIEW-PATH1A';
  const CONTINUATION = 'PROJECTOS-HOST-REVIEW-PATH1B';
  const LATER = 'PROJECTOS-AGENT-WORKFORCE1A';
  const PLAN = [planPhase(HISTORICAL), planPhase(CONTINUATION), planPhase(LATER, [CONTINUATION])];

  it('starts the continuation phase in its place while the continuation is not accepted', () => {
    const sys = fakeSystem();
    const sel = selectNextPhase(sys, ROOT, contextWith(PLAN));
    expect(sel.kind).toBe('start');
    if (sel.kind === 'start') expect(sel.planPhase.phaseId).toBe(CONTINUATION);
    expect(sys.writes).toEqual([]);
  });

  it('continues the continuation phase, not an open historical record', () => {
    const sys = fakeSystem({
      phases: { [HISTORICAL]: record(HISTORICAL, 'implementing'), [CONTINUATION]: record(CONTINUATION, 'implementing') },
    });
    const sel = selectNextPhase(sys, ROOT, contextWith(PLAN));
    expect(sel.kind).toBe('continue');
    if (sel.kind === 'continue') expect(sel.planPhase.phaseId).toBe(CONTINUATION);
  });

  it('is not held up by a stood-down historical record', () => {
    const sys = fakeSystem({ phases: { [HISTORICAL]: record(HISTORICAL, 'rolled_back') } });
    const sel = selectNextPhase(sys, ROOT, contextWith(PLAN));
    expect(sel.kind).toBe('start');
    if (sel.kind === 'start') expect(sel.planPhase.phaseId).toBe(CONTINUATION);
  });

  it('still applies every ordinary stop to the continuation phase', () => {
    const sys = fakeSystem({ phases: { [CONTINUATION]: record(CONTINUATION, 'awaiting_closure') } });
    const sel = selectNextPhase(sys, ROOT, contextWith(PLAN));
    expect(sel.kind).toBe('stop');
    if (sel.kind === 'stop') {
      expect(sel.reason.code).toBe('OWNER_DECISION_REQUIRED');
      expect(sel.reason.detail).toContain(CONTINUATION);
    }
  });

  it('after the continuation is accepted, offers the historical phase only to reconciliation and closure', () => {
    for (const status of [undefined, 'implementing', 'rolled_back', 'draft'] as const) {
      const sys = fakeSystem({
        completed: [CONTINUATION],
        phases: status === undefined ? {} : { [HISTORICAL]: record(HISTORICAL, status) },
      });
      const sel = selectNextPhase(sys, ROOT, contextWith(PLAN));
      expect(sel.kind).toBe('stop');
      if (sel.kind === 'stop') {
        expect(sel.reason.code).toBe('OWNER_DECISION_REQUIRED');
        expect(sel.reason.detail).toContain(HISTORICAL);
        expect(sel.reason.detail).toContain('reconciliation and closure');
      }
      expect(sys.writes).toEqual([]);
    }
  });

  it('does not step over the unclosed historical phase to reach a later one', () => {
    const sys = fakeSystem({ completed: [CONTINUATION] });
    const sel = selectNextPhase(sys, ROOT, contextWith(PLAN));
    expect(sel.kind).toBe('stop');
  });

  it('never selects the historical phase even in a plan that lacks the continuation', () => {
    const sys = fakeSystem();
    const sel = selectNextPhase(sys, ROOT, contextWith([planPhase(HISTORICAL), planPhase(LATER)]));
    expect(sel.kind).toBe('stop');
    if (sel.kind === 'stop') expect(sel.reason.code).toBe('OWNER_DECISION_REQUIRED');
  });

  it('moves on in plan order once both phases of the pair are recorded complete', () => {
    const sys = fakeSystem({ completed: [HISTORICAL, CONTINUATION] });
    const sel = selectNextPhase(sys, ROOT, contextWith(PLAN));
    expect(sel.kind).toBe('start');
    if (sel.kind === 'start') expect(sel.planPhase.phaseId).toBe(LATER);
  });

  it('leaves every other phase on the first-incomplete rule', () => {
    const sys = fakeSystem();
    const sel = selectNextPhase(sys, ROOT, contextWith([planPhase('PH-A'), planPhase(CONTINUATION)]));
    expect(sel.kind).toBe('start');
    if (sel.kind === 'start') expect(sel.planPhase.phaseId).toBe('PH-A');
  });
});

/** git responses for a healthy checkout on a working branch of the configured repository. */
function healthyGit(overrides: Readonly<Record<string, ExecResult>> = {}) {
  const declared = realConfig().repo;
  return (_cmd: string, args: readonly string[]): ExecResult => {
    const key = args.join(' ');
    for (const [prefix, res] of Object.entries(overrides)) {
      if (key.includes(prefix)) return res;
    }
    if (key.includes('rev-parse --abbrev-ref HEAD')) return { code: 0, stdout: 'feature/x\n', stderr: '' };
    if (key.includes('rev-parse HEAD')) return { code: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '' };
    if (key.includes('status --porcelain')) return { code: 0, stdout: '', stderr: '' };
    if (key.includes('remote get-url origin')) return { code: 0, stdout: `https://github.com/${declared}.git\n`, stderr: '' };
    return { code: 1, stdout: '', stderr: `unexpected git call: ${key}` };
  };
}

describe('verifyExecutionContext', () => {
  it('accepts a healthy checkout of the configured repository on a working branch', () => {
    const sys = fakeSystem({ exec: healthyGit() });
    const v = verifyExecutionContext(sys, ROOT, contextWith(AB));
    expect(v.mismatches).toEqual([]);
    expect(v.observed.branch).toBe('feature/x');
    expect(v.observed.head).toBe('a'.repeat(40));
  });

  it('refuses a checkout of a different repository', () => {
    const sys = fakeSystem({
      exec: healthyGit({ 'remote get-url origin': { code: 0, stdout: 'https://github.com/acme/other.git\n', stderr: '' } }),
    });
    const v = verifyExecutionContext(sys, ROOT, contextWith(AB));
    expect(v.mismatches.join(' ')).toContain('acme/other');
  });

  it('refuses to run on a protected branch', () => {
    const protectedBranch = realConfig().protectedBranches[0];
    const sys = fakeSystem({
      exec: healthyGit({ 'rev-parse --abbrev-ref HEAD': { code: 0, stdout: `${protectedBranch}\n`, stderr: '' } }),
    });
    const v = verifyExecutionContext(sys, ROOT, contextWith(AB));
    expect(v.mismatches.join(' ')).toContain('protected');
  });

  /**
   * The root becomes the working directory of every spawned worker and check. A relative one would
   * be resolved against ProjectOS's ambient directory at spawn time — the ambiguity that binding the
   * cwd exists to remove, arriving one step later.
   */
  it('refuses a governed root that is not an absolute path', () => {
    const sys = fakeSystem({ exec: healthyGit() });
    const v = verifyExecutionContext(sys, 'relative/checkout', contextWith(AB));
    expect(v.mismatches.join(' ')).toContain('not an absolute path');
  });

  it('accepts both Windows and POSIX absolute roots', () => {
    const sys = fakeSystem({ exec: healthyGit() });
    for (const r of ['C:/dev/ProjectOS', 'C:\\dev\\ProjectOS', '/home/murad/projectos', '\\\\server\\share']) {
      expect(verifyExecutionContext(sys, r, contextWith(AB)).mismatches.join(' '), r).not.toContain('absolute path');
    }
  });

  it('fails closed when git cannot answer', () => {
    const sys = fakeSystem({ exec: () => ({ code: 127, stdout: '', stderr: 'no git' }) });
    const v = verifyExecutionContext(sys, ROOT, contextWith(AB));
    expect(v.mismatches.length).toBeGreaterThan(0);
    expect(v.observed.head).toBeNull();
  });

  it('records a dirty tree as an observation, not a refusal — mid-phase work is dirty by nature', () => {
    const sys = fakeSystem({
      exec: healthyGit({ 'status --porcelain': { code: 0, stdout: ' M src/a.ts\n', stderr: '' } }),
    });
    const v = verifyExecutionContext(sys, ROOT, contextWith(AB));
    expect(v.mismatches).toEqual([]);
    expect(v.observed.clean).toBe(false);
    expect(v.observed.dirtyPaths).toEqual(['src/a.ts']);
  });
});

describe('a phase id that could escape the phases directory is refused, not run', () => {
  it('stops rather than starting work it could never record', () => {
    // The plan schema constrains phaseId to a non-empty string and nothing more, and a phase id
    // becomes a path in several stores. The loop must not begin work whose lifecycle it would then
    // be unable to write down.
    const sys = fakeSystem();
    const sel = selectNextPhase(sys, ROOT, contextWith([planPhase('../../escape')]));
    expect(sel.kind).toBe('stop');
    if (sel.kind === 'stop') expect(sel.reason.code).toBe('UNSAFE_PHASE_ID');
    expect(sys.writes).toEqual([]);
  });
});
