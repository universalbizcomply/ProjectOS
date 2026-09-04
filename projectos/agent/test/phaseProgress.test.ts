/**
 * The loop's progress must reach the canonical phase record — and must never reach a closure.
 *
 * THE DEFECT. `validation-cache` ran end to end on 2026-09-04: worker, five passing checks, a live
 * gatekeeper approval, a commit and a push. `work.v1.json` said COMPLETE. There was no phase record
 * at all, so `syncCurrentState` — which recomputes the plan screen from those records — truthfully
 * reported `0 of 4 · PLAN READY` over finished, pushed work.
 *
 * These tests pin the cause fixed, and pin the boundary that matters far more than the fix: the
 * loop may drive a phase as far as `awaiting_closure` and not one step further, whatever it reports.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';

import { recordPhaseProgress, phaseStatusForWork, createLifecycleRecorder } from '../src/phaseProgress.js';
import type { GovernedContext } from '../src/governedContext.js';
import type { System } from '../src/system.js';
import type { Phase } from '@projectos/core';

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

const PLAN_PHASES = [
  { phaseId: 'P-ONE1A', description: 'Do the first thing' },
  { phaseId: 'P-TWO1A', description: 'Do the second thing', dependsOn: ['P-ONE1A'] },
  { phaseId: 'P-NODESC1A' },
];

function world(records: Record<string, Partial<Phase>> = {}): {
  root: string;
  sys: System;
  context: GovernedContext;
  statePath: string;
} {
  const root = mkdtempSync(pjoin(tmpdir(), 'projectos-phaseprog-')).replace(/\\/g, '/');
  created.push(root);
  mkdirSync(pjoin(root, '.projectops', 'phases'), { recursive: true });
  mkdirSync(pjoin(root, '.projectops', 'closure', 'decisions'), { recursive: true });
  mkdirSync(pjoin(root, 'state'), { recursive: true });
  for (const [id, p] of Object.entries(records)) {
    writeFileSync(
      pjoin(root, '.projectops', 'phases', `${id}.json`),
      JSON.stringify({ phaseId: id, project: 'ProjectOS', objective: 'o', status: 'draft', history: [], ...p }, null, 2),
    );
  }
  const statePath = pjoin(root, 'state', 'current.json').replace(/\\/g, '/');
  writeFileSync(
    statePath,
    JSON.stringify({ schemaVersion: '1.0.0', projectId: 'x', activePhase: null, completedPhases: [], pendingPhases: [] }, null, 2),
  );
  const sys: System = {
    cwd: () => root,
    now: () => '2026-09-04T12:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => { mkdirSync(pjoin(p, '..'), { recursive: true }); writeFileSync(p, c); },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: (_c: string, args: readonly string[]) => {
      const key = args.join(' ');
      if (key === 'status --porcelain') return { code: 0, stdout: '', stderr: '' };
      if (key === 'rev-parse HEAD') return { code: 0, stdout: 'a'.repeat(40), stderr: '' };
      if (key === 'rev-parse --abbrev-ref HEAD') return { code: 0, stdout: 'main', stderr: '' };
      return { code: 1, stdout: '', stderr: '' };
    },
  };
  const context: GovernedContext = {
    config: {} as GovernedContext['config'],
    plan: { phases: PLAN_PHASES, governance: { owner: 'Ada' }, projectId: 'x' },
    projectId: 'x',
    planPath: pjoin(root, 'plan.json'),
    currentStatePath: statePath,
  };
  return { root, sys, context, statePath };
}

function phaseOf(root: string, id: string): Phase {
  return JSON.parse(readFileSync(pjoin(root, '.projectops', 'phases', `${id}.json`), 'utf8')) as Phase;
}

function report(state: string, phaseId = 'P-ONE1A', gateDecisionId?: string) {
  return gateDecisionId === undefined ? { state, phaseId } : { state, phaseId, gateDecisionId };
}

describe('the loop records the lifecycle it actually drove', () => {
  test('a first report creates the record from the approved plan and walks it forward', () => {
    const w = world();
    const r = recordPhaseProgress(w.sys, w.root, w.context, report('EXECUTING'), 'ProjectOS');
    expect(r.created).toBe(true);
    expect(r.problem).toBeUndefined();
    const p = phaseOf(w.root, 'P-ONE1A');
    expect(p.status).toBe('implementing');
    expect(p.objective).toBe('Do the first thing');
    expect(p.history.map((h) => h.to)).toEqual(['prompted', 'implementing']);
  });

  test('the whole run reaches awaiting_closure, one legal transition at a time', () => {
    const w = world();
    for (const s of ['WAITING_AI', 'EXECUTING', 'VALIDATING', 'AWAITING_GATE', 'GATE_APPROVED', 'COMPLETE']) {
      recordPhaseProgress(w.sys, w.root, w.context, report(s), 'ProjectOS');
    }
    const p = phaseOf(w.root, 'P-ONE1A');
    expect(p.status).toBe('awaiting_closure');
    expect(p.history.map((h) => h.to)).toEqual([
      'prompted', 'implementing', 'validating', 'evidence', 'awaiting_review', 'awaiting_closure',
    ]);
  });

  test('the declared current-state follows, so the plan screen stops saying nothing is happening', () => {
    const w = world();
    recordPhaseProgress(w.sys, w.root, w.context, report('EXECUTING'), 'ProjectOS');
    const state = JSON.parse(readFileSync(w.statePath, 'utf8')) as Record<string, unknown>;
    expect(state['activePhase']).toBe('P-ONE1A');
    expect(state['acceptedPhaseCount']).toBe(0);
    expect(state['totalPhaseCount']).toBe(3);
  });
});

describe('it can never close a phase', () => {
  test('COMPLETE means awaiting_closure, never closed', () => {
    expect(phaseStatusForWork('COMPLETE')).toBe('awaiting_closure');
    const w = world();
    for (const s of ['EXECUTING', 'VALIDATING', 'AWAITING_GATE', 'COMPLETE', 'COMPLETE']) {
      recordPhaseProgress(w.sys, w.root, w.context, report(s), 'ProjectOS');
    }
    const p = phaseOf(w.root, 'P-ONE1A');
    expect(p.status).toBe('awaiting_closure');
    expect(p.history.some((h) => h.to === 'closed')).toBe(false);
    const state = JSON.parse(readFileSync(w.statePath, 'utf8')) as Record<string, unknown>;
    // Completion is an owner closure and nothing else. The work being finished is not a closure.
    expect(state['completedPhases']).toEqual([]);
    expect(state['acceptedPhaseCount']).toBe(0);
  });

  test('the states that say nothing about the phase move nothing', () => {
    // Asserted as null explicitly: the sweep below passes vacuously for null, so on its own it
    // would not notice one of these quietly acquiring a meaning.
    for (const s of ['PLANNING', 'RESUMING', 'BLOCKED']) expect(phaseStatusForWork(s)).toBeNull();
  });

  test('no work state maps to a closed or blocked status', () => {
    for (const s of ['QUEUED', 'PLANNING', 'EXECUTING', 'VALIDATING', 'AWAITING_GATE', 'GATE_APPROVED',
      'CORRECTION_REQUIRED', 'WAITING_AI', 'WAITING_OWNER', 'BLOCKED', 'RESUMING', 'COMPLETE']) {
      const mapped = phaseStatusForWork(s);
      expect(mapped).not.toBe('closed');
      expect(mapped).not.toBe('closed_as_blocked');
      expect(mapped).not.toBe('rolled_back');
    }
  });

  test('a closed phase is left exactly as it is', () => {
    const w = world({ 'P-ONE1A': { status: 'closed', history: [{ to: 'closed', by: 'owner', from: 'awaiting_closure', at: 'x' }] } });
    const r = recordPhaseProgress(w.sys, w.root, w.context, report('EXECUTING'), 'ProjectOS');
    expect(r.moved).toEqual([]);
    expect(r.problem).toMatch(/does not move a phase out of that/);
    expect(phaseOf(w.root, 'P-ONE1A').status).toBe('closed');
  });
});

describe('it refuses rather than inventing a record', () => {
  test('a phase the approved plan does not name is refused', () => {
    const w = world();
    const r = recordPhaseProgress(w.sys, w.root, w.context, report('EXECUTING', 'NOT-IN-PLAN1A'), 'ProjectOS');
    expect(r.created).toBe(false);
    expect(r.problem).toMatch(/PHASE_NOT_AUTHORISED/);
    expect(existsSync(pjoin(w.root, '.projectops', 'phases', 'NOT-IN-PLAN1A.json'))).toBe(false);
  });

  test('a phase whose dependency is not complete is refused, exactly as `phase new` is', () => {
    const w = world();
    const r = recordPhaseProgress(w.sys, w.root, w.context, report('EXECUTING', 'P-TWO1A'), 'ProjectOS');
    expect(r.created).toBe(false);
    expect(r.problem).not.toBeUndefined();
    expect(existsSync(pjoin(w.root, '.projectops', 'phases', 'P-TWO1A.json'))).toBe(false);
  });

  test('a plan phase with no description gets no placeholder objective', () => {
    const w = world();
    const r = recordPhaseProgress(w.sys, w.root, w.context, report('EXECUTING', 'P-NODESC1A'), 'ProjectOS');
    expect(r.created).toBe(false);
    expect(r.problem).toMatch(/no description/);
  });
});

describe('it records what happened, not a tidier version of it', () => {
  test('only a correction moves a phase backward', () => {
    const w = world();
    for (const s of ['EXECUTING', 'VALIDATING', 'AWAITING_GATE']) {
      recordPhaseProgress(w.sys, w.root, w.context, report(s), 'ProjectOS');
    }
    expect(phaseOf(w.root, 'P-ONE1A').status).toBe('awaiting_review');
    recordPhaseProgress(w.sys, w.root, w.context, report('CORRECTION_REQUIRED'), 'ProjectOS');
    expect(phaseOf(w.root, 'P-ONE1A').status).toBe('implementing');
  });

  test('a post-approval EXECUTING does not drag the record back to implementing', () => {
    // The technical continuation reports EXECUTING for each commit and push, after the gate. A naive
    // mapping made a successful continuation look like a correction.
    const w = world();
    for (const s of ['EXECUTING', 'VALIDATING', 'AWAITING_GATE', 'GATE_APPROVED']) {
      recordPhaseProgress(w.sys, w.root, w.context, report(s), 'ProjectOS');
    }
    recordPhaseProgress(w.sys, w.root, w.context, report('EXECUTING'), 'ProjectOS');
    expect(phaseOf(w.root, 'P-ONE1A').status).toBe('awaiting_review');
  });

  test('a stop is not a rollback: BLOCKED moves nothing', () => {
    const w = world();
    recordPhaseProgress(w.sys, w.root, w.context, report('EXECUTING'), 'ProjectOS');
    const before = phaseOf(w.root, 'P-ONE1A');
    const r = recordPhaseProgress(w.sys, w.root, w.context, report('BLOCKED'), 'ProjectOS');
    expect(r.moved).toEqual([]);
    expect(phaseOf(w.root, 'P-ONE1A')).toEqual(before);
  });

  test('the advisor is named only when a gate decision was actually recorded', () => {
    const w = world();
    for (const s of ['EXECUTING', 'VALIDATING', 'AWAITING_GATE']) {
      recordPhaseProgress(w.sys, w.root, w.context, report(s), 'ProjectOS');
    }
    recordPhaseProgress(w.sys, w.root, w.context, report('COMPLETE', 'P-ONE1A', 'GKDEC-abc12345'), 'ProjectOS');
    const p = phaseOf(w.root, 'P-ONE1A');
    const closing = p.history[p.history.length - 1]!;
    expect(closing.to).toBe('awaiting_closure');
    expect(closing.by).toBe('advisor');
    expect(p.history.slice(0, -1).every((h) => h.by === 'implementer')).toBe(true);
  });

  test('an unreviewed run reaching COMPLETE is recorded as the implementer, not the advisor', () => {
    // A degraded or gatekeeper-less run still finishes. Writing `advisor` into a durable governance
    // record because of where the step sits in the walk would be a role asserted by the code
    // claiming it -- the exact failure the closure rules exist to end.
    const w = world();
    for (const s of ['EXECUTING', 'VALIDATING', 'AWAITING_GATE', 'COMPLETE']) {
      recordPhaseProgress(w.sys, w.root, w.context, report(s), 'ProjectOS');
    }
    const p = phaseOf(w.root, 'P-ONE1A');
    expect(p.status).toBe('awaiting_closure');
    expect(p.history[p.history.length - 1]!.by).toBe('implementer');
  });

  test('no history note can be mistaken for a consumed closure decision', () => {
    const w = world();
    for (const s of ['EXECUTING', 'VALIDATING', 'AWAITING_GATE', 'COMPLETE']) {
      recordPhaseProgress(w.sys, w.root, w.context, report(s), 'ProjectOS');
    }
    for (const h of phaseOf(w.root, 'P-ONE1A').history) {
      expect(/, decision [A-Za-z0-9_.:-]{8,128}$/.test(String(h.note ?? '').trim())).toBe(false);
    }
  });
});

describe('a record it cannot trust is refused, never repaired in place', () => {
  test('a phase id that cannot safely become a filename is refused, and nothing is written', () => {
    const w = world();
    for (const bad of ['../../escape', 'a', 'has space', 'dots.and.slash/x']) {
      const r = recordPhaseProgress(w.sys, w.root, w.context, report('EXECUTING', bad), 'ProjectOS');
      expect(r.created).toBe(false);
      expect(r.moved).toEqual([]);
      expect(r.problem).toMatch(/cannot safely become a record filename/);
    }
    expect(readdirSync(pjoin(w.root, '.projectops', 'phases'))).toEqual([]);
  });

  test('a record with an unrecognised status is unreadable, not crashed on', () => {
    // `JSON.parse(...) as Phase` is an assertion, not a check. An unknown status made `isTerminal`
    // read a property off `undefined` and threw out of an unattended run.
    const w = world();
    writeFileSync(
      pjoin(w.root, '.projectops', 'phases', 'P-ONE1A.json'),
      JSON.stringify({ phaseId: 'P-ONE1A', project: 'X', objective: 'o', status: 'nonsense', history: [] }),
    );
    expect(() => recordPhaseProgress(w.sys, w.root, w.context, report('EXECUTING'), 'ProjectOS')).not.toThrow();
  });

  test('a record with no history array is unreadable, not crashed on', () => {
    const w = world();
    writeFileSync(
      pjoin(w.root, '.projectops', 'phases', 'P-ONE1A.json'),
      JSON.stringify({ phaseId: 'P-ONE1A', project: 'X', objective: 'o', status: 'implementing' }),
    );
    expect(() => recordPhaseProgress(w.sys, w.root, w.context, report('VALIDATING'), 'ProjectOS')).not.toThrow();
  });

  test("a record belonging to another project is not this run's to move", () => {
    const w = world({ 'P-ONE1A': { status: 'implementing', project: 'SomethingElse' } });
    const r = recordPhaseProgress(w.sys, w.root, w.context, report('VALIDATING'), 'ProjectOS');
    expect(r.moved).toEqual([]);
    expect(r.problem).toMatch(/belongs to project 'SomethingElse'/);
    expect(phaseOf(w.root, 'P-ONE1A').status).toBe('implementing');
  });
});

describe('the wiring the loop actually goes through', () => {
  test('a run carries its gate decision forward to the completion that never names one', () => {
    // The loop names `gateDecisionId` on GATE_APPROVED and on each continuation action, and NOT on
    // the terminal COMPLETE. Without the carry, every reviewed run would have recorded its final
    // step as unreviewed.
    const w = world();
    const r = createLifecycleRecorder(w.sys, w.root, w.context, 'ProjectOS');
    r.record({ state: 'EXECUTING', phaseId: 'P-ONE1A' });
    r.record({ state: 'VALIDATING', phaseId: 'P-ONE1A' });
    r.record({ state: 'GATE_APPROVED', phaseId: 'P-ONE1A', gateDecisionId: 'GKDEC-abc12345' });
    r.record({ state: 'COMPLETE', phaseId: 'P-ONE1A' });
    expect(r.problems()).toEqual([]);
    const p = phaseOf(w.root, 'P-ONE1A');
    expect(p.status).toBe('awaiting_closure');
    expect(p.history[p.history.length - 1]!.by).toBe('advisor');
  });

  test('a run with no gate decision records its completion as the implementer', () => {
    const w = world();
    const r = createLifecycleRecorder(w.sys, w.root, w.context, 'ProjectOS');
    for (const state of ['EXECUTING', 'VALIDATING', 'AWAITING_GATE', 'COMPLETE']) {
      r.record({ state, phaseId: 'P-ONE1A' });
    }
    expect(phaseOf(w.root, 'P-ONE1A').history.slice(-1)[0]!.by).toBe('implementer');
  });

  test('a throwing store is reported, not propagated: the run is never ended by its bookkeeping', () => {
    const w = world();
    const exploding: System = {
      ...w.sys,
      writeText: () => {
        throw new Error('disk is on fire');
      },
    };
    const r = createLifecycleRecorder(exploding, w.root, w.context, 'ProjectOS');
    expect(() => r.record({ state: 'EXECUTING', phaseId: 'P-ONE1A' })).not.toThrow();
    expect(r.problems()).toEqual(['the phase record could not be updated: disk is on fire']);
  });

  test('the same obstacle is said once, however many reports hit it', () => {
    const w = world();
    const r = createLifecycleRecorder(w.sys, w.root, w.context, 'ProjectOS');
    for (const state of ['EXECUTING', 'VALIDATING', 'AWAITING_GATE']) {
      r.record({ state, phaseId: 'NOT-IN-PLAN1A' });
    }
    expect(r.problems()).toHaveLength(1);
    expect(r.problems()[0]).toMatch(/PHASE_NOT_AUTHORISED/);
  });
});
