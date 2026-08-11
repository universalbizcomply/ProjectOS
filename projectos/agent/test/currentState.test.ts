/**
 * The durable state must agree with the phase records — and must never invent a completion.
 *
 * ProjectOS wrote phase records and never touched the current-state, so the moment a phase started
 * the owner-facing memory said `activePhase: null` while a phase was plainly running. The consistency
 * validator had caught that since Phase 12 and it was repaired BY HAND each time; nothing ever fixed
 * the cause. These tests pin the cause fixed, and pin the far more important property: syncing state
 * is bookkeeping, not authority, so it can never turn an unclosed phase into a complete one.
 *
 * Created in the post-V3 operational recovery programme.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';

import { syncCurrentState } from '../src/currentStateStore.js';
import type { GovernedContext } from '../src/governedContext.js';
import type { System } from '../src/system.js';

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

const PLAN_PHASES = ['P-ONE1A', 'P-TWO1A', 'P-THREE1A'];

function world(phases: Record<string, { status: string; history?: { to: string; by: string }[] }>, declareState = true): {
  root: string;
  sys: System;
  context: GovernedContext;
  statePath: string;
} {
  const root = mkdtempSync(pjoin(tmpdir(), 'projectos-state-')).replace(/\\/g, '/');
  created.push(root);
  mkdirSync(pjoin(root, '.projectops', 'phases'), { recursive: true });
  mkdirSync(pjoin(root, 'state'), { recursive: true });
  for (const [id, p] of Object.entries(phases)) {
    writeFileSync(
      pjoin(root, '.projectops', 'phases', `${id}.json`),
      JSON.stringify({ phaseId: id, project: 'X', objective: 'o', status: p.status, history: p.history ?? [] }, null, 2),
    );
  }
  const statePath = pjoin(root, 'state', 'current.json').replace(/\\/g, '/');
  writeFileSync(
    statePath,
    JSON.stringify({
      schemaVersion: '1.0.0',
      projectId: 'x',
      currentStatus: 'PLAN READY',
      acceptedPhaseCount: 0,
      totalPhaseCount: 0,
      completionPercentage: 0,
      completedPhases: [],
      activePhase: null,
      pendingPhases: [],
      blockedPhases: [],
      keptField: 'must survive',
    }, null, 2),
  );
  const sys: System = {
    cwd: () => root,
    now: () => '2026-08-11T12:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => { mkdirSync(pjoin(p, '..'), { recursive: true }); writeFileSync(p, c); },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
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
    plan: { phases: PLAN_PHASES.map((phaseId) => ({ phaseId })) },
    projectId: 'x',
    planPath: pjoin(root, 'plan.json'),
    currentStatePath: declareState ? statePath : null,
  };
  return { root, sys, context, statePath };
}

function stateOf(statePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>;
}

describe('current state follows the phase records', () => {
  test('an in-flight phase becomes the active phase, and the rest stay pending', () => {
    const w = world({ 'P-ONE1A': { status: 'awaiting_closure' } });
    const r = syncCurrentState(w.sys, w.root, w.context, 'implementer');
    expect(r.synced).toBe(true);
    const s = stateOf(w.statePath);
    expect(s['activePhase']).toBe('P-ONE1A');
    expect(s['pendingPhases']).toEqual(['P-TWO1A', 'P-THREE1A']);
    expect(s['acceptedPhaseCount']).toBe(0);
    expect(s['totalPhaseCount']).toBe(3);
    expect(s['nextRecommendedPhase']).toBe('P-ONE1A');
  });

  test('a genuine owner closure counts as complete and clears the active phase', () => {
    const w = world({
      'P-ONE1A': { status: 'closed', history: [{ to: 'closed', by: 'owner' }] },
      'P-TWO1A': { status: 'implementing' },
    });
    syncCurrentState(w.sys, w.root, w.context, 'implementer');
    const s = stateOf(w.statePath);
    expect(s['completedPhases']).toEqual(['P-ONE1A']);
    expect(s['activePhase']).toBe('P-TWO1A');
    expect(s['acceptedPhaseCount']).toBe(1);
    expect(s['completionPercentage']).toBe(33.3);
  });

  test('a delegate closure counts too — closure is delegable, and the record shows who', () => {
    const w = world({ 'P-ONE1A': { status: 'closed', history: [{ to: 'closed', by: 'advisor' }] } });
    syncCurrentState(w.sys, w.root, w.context, 'advisor');
    expect(stateOf(w.statePath)['completedPhases']).toEqual(['P-ONE1A']);
  });

  test('THE IMPORTANT ONE: a record that merely SAYS closed is not a completion', () => {
    // Anything that can write a phase record can write the word "closed". A genuine closure always
    // carries a final owner-or-delegate history entry, because that is what the lifecycle enforces.
    const w = world({
      'P-ONE1A': { status: 'closed', history: [{ to: 'closed', by: 'implementer' }] },
      'P-TWO1A': { status: 'closed' },
    });
    syncCurrentState(w.sys, w.root, w.context, 'implementer');
    const s = stateOf(w.statePath);
    expect(s['completedPhases']).toEqual([]);
    expect(s['acceptedPhaseCount']).toBe(0);
  });

  test('a phase that is not in the approved plan shapes nothing', () => {
    const w = world({
      'OTHER-PROGRAMME1A': { status: 'implementing' },
      'P-ONE1A': { status: 'awaiting_closure' },
    });
    syncCurrentState(w.sys, w.root, w.context, 'implementer');
    const s = stateOf(w.statePath);
    expect(s['activePhase']).toBe('P-ONE1A');
    expect(s['pendingPhases']).not.toContain('OTHER-PROGRAMME1A');
  });

  test('a blocked closure is not pending and is not complete', () => {
    const w = world({ 'P-ONE1A': { status: 'closed_as_blocked', history: [{ to: 'closed_as_blocked', by: 'owner' }] } });
    syncCurrentState(w.sys, w.root, w.context, 'owner');
    const s = stateOf(w.statePath);
    expect(s['blockedPhases']).toEqual(['P-ONE1A']);
    expect(s['completedPhases']).toEqual([]);
    expect(s['pendingPhases']).toEqual(['P-TWO1A', 'P-THREE1A']);
  });

  test('fields this module has no business deciding are left exactly as they were', () => {
    const w = world({ 'P-ONE1A': { status: 'implementing' } });
    syncCurrentState(w.sys, w.root, w.context, 'implementer');
    expect(stateOf(w.statePath)['keptField']).toBe('must survive');
  });

  test('a project that declares no current-state is left alone rather than given one', () => {
    const w = world({ 'P-ONE1A': { status: 'implementing' } }, false);
    const r = syncCurrentState(w.sys, w.root, w.context, 'implementer');
    expect(r.synced).toBe(false);
    expect(r.reason).toMatch(/declares no currentStatePath/i);
    // and the state file it did not declare is untouched
    expect(stateOf(w.statePath)['activePhase']).toBeNull();
  });

  test('every phase properly closed reports COMPLETE with no active phase', () => {
    const w = world({
      'P-ONE1A': { status: 'closed', history: [{ to: 'closed', by: 'owner' }] },
      'P-TWO1A': { status: 'closed', history: [{ to: 'closed', by: 'advisor' }] },
      'P-THREE1A': { status: 'closed', history: [{ to: 'closed', by: 'owner' }] },
    });
    syncCurrentState(w.sys, w.root, w.context, 'owner');
    const s = stateOf(w.statePath);
    expect(s['currentStatus']).toBe('COMPLETE');
    expect(s['activePhase']).toBeNull();
    expect(s['completionPercentage']).toBe(100);
    expect(s['nextRecommendedPhase']).toBeNull();
  });
});
