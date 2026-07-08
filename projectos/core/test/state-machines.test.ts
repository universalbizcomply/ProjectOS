import { describe, it, expect } from 'vitest';
import {
  createPhase,
  transitionPhase,
  canTransition,
  requiresOwner,
  isTerminal,
  PHASE_TRANSITIONS,
} from '../src/phase.js';
import {
  createTask,
  setTaskStatus,
  canTransitionTask,
  isTaskTerminal,
} from '../src/task.js';
import {
  WORKFLOW_STEPS,
  stepForStatus,
  nextStep,
  stepIndex,
} from '../src/workflow.js';

const AT = '2026-07-08T00:00:00.000Z';

describe('phase state machine', () => {
  it('creates a phase in draft with empty history', () => {
    const p = createPhase({ phaseId: 'X1A', project: 'projectos', objective: 'o' });
    expect(p.status).toBe('draft');
    expect(p.history).toHaveLength(0);
  });

  it('advances along the happy path and records history', () => {
    let p = createPhase({ phaseId: 'X1A', project: 'p', objective: 'o' });
    for (const to of ['prompted', 'implementing', 'validating', 'evidence', 'awaiting_review', 'awaiting_closure'] as const) {
      const r = transitionPhase(p, to, 'implementer', AT);
      expect(r.ok).toBe(true);
      if (r.ok) p = r.value;
    }
    expect(p.status).toBe('awaiting_closure');
    expect(p.history).toHaveLength(6);
    expect(p.history[0]).toMatchObject({ from: 'draft', to: 'prompted', by: 'implementer' });
  });

  it('rejects illegal transitions', () => {
    const p = createPhase({ phaseId: 'X', project: 'p', objective: 'o' });
    const r = transitionPhase(p, 'closed', 'owner', AT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Illegal transition');
  });

  it('allows owner to close from awaiting_closure', () => {
    const p = { phaseId: 'X', project: 'p', objective: 'o', status: 'awaiting_closure' as const, history: [] };
    const r = transitionPhase(p, 'closed', 'owner', AT, 'accepted');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('closed');
      expect(r.value.history[0]?.note).toBe('accepted');
    }
  });

  it('forbids non-owner from closing', () => {
    const p = { phaseId: 'X', project: 'p', objective: 'o', status: 'awaiting_closure' as const, history: [] };
    for (const role of ['implementer', 'advisor'] as const) {
      const r = transitionPhase(p, 'closed', role, AT);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("requires role 'owner'");
    }
  });

  it('does not mutate the input phase', () => {
    const p = createPhase({ phaseId: 'X', project: 'p', objective: 'o' });
    transitionPhase(p, 'prompted', 'advisor', AT);
    expect(p.status).toBe('draft');
    expect(p.history).toHaveLength(0);
  });

  it('exposes helpers', () => {
    expect(canTransition('draft', 'prompted')).toBe(true);
    expect(canTransition('closed', 'draft')).toBe(false);
    expect(requiresOwner('closed_as_blocked')).toBe(true);
    expect(requiresOwner('evidence')).toBe(false);
    expect(isTerminal('closed')).toBe(true);
    expect(isTerminal('draft')).toBe(false);
    expect(PHASE_TRANSITIONS.rolled_back).toContain('draft');
  });
});

describe('task state machine', () => {
  it('creates pending tasks', () => {
    const t = createTask('t1', 'do thing');
    expect(t.status).toBe('pending');
  });

  it('runs the happy path', () => {
    let t = createTask('t1', 'x');
    const r1 = setTaskStatus(t, 'in_progress');
    expect(r1.ok).toBe(true);
    if (r1.ok) t = r1.value;
    const r2 = setTaskStatus(t, 'done');
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.status).toBe('done');
  });

  it('requires a reason to block and clears it on unblock', () => {
    const started = setTaskStatus(createTask('t', 'x'), 'in_progress');
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const bad = setTaskStatus(started.value, 'blocked');
    expect(bad.ok).toBe(false);
    const good = setTaskStatus(started.value, 'blocked', 'waiting on API');
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.value.blockedReason).toBe('waiting on API');
      const unblocked = setTaskStatus(good.value, 'in_progress');
      expect(unblocked.ok).toBe(true);
      if (unblocked.ok) expect(unblocked.value.blockedReason).toBeUndefined();
    }
  });

  it('rejects illegal task transitions', () => {
    const t = createTask('t', 'x');
    const r = setTaskStatus(t, 'done');
    expect(r.ok).toBe(false);
  });

  it('exposes helpers', () => {
    expect(canTransitionTask('pending', 'in_progress')).toBe(true);
    expect(isTaskTerminal('done')).toBe(true);
    expect(isTaskTerminal('pending')).toBe(false);
  });
});

describe('workflow', () => {
  it('has six ordered steps ending in owner-owned closure', () => {
    expect(WORKFLOW_STEPS).toHaveLength(6);
    expect(WORKFLOW_STEPS[WORKFLOW_STEPS.length - 1]?.owner).toBe('owner');
  });

  it('maps status to step and finds the next step', () => {
    expect(stepForStatus('implementing')?.id).toBe('implement');
    expect(nextStep('implementing')?.id).toBe('validate');
    expect(nextStep('awaiting_closure')).toBeUndefined();
    expect(nextStep('closed')).toBeUndefined();
    expect(stepIndex('prompted')).toBe(0);
    expect(stepIndex('closed')).toBe(-1);
  });
});
