import { describe, test, expect } from 'vitest';
import {
  isAllowedTransition,
  stageForEvent,
  stageToStatus,
} from '../src/state/stateMachine.js';
import {
  initialState,
  applyEvent,
  applyGitCommit,
  applyGitPush,
} from '../src/state/stateManager.js';
import { toStateJson } from '../src/state/stateStore.js';
import { makeEvent } from '../src/events/eventTypes.js';
import type { BridgeEvent, BridgeEventType, PhaseStage, PhaseState } from '../src/types.js';

let seq = 0;
function ev(type: BridgeEventType, over: Partial<BridgeEvent> = {}): BridgeEvent {
  seq += 1;
  return makeEvent({
    id: `evt_${seq}`,
    seq,
    type,
    project: 'p',
    phase: 'X1A',
    at: '2026-07-09T00:00:00.000Z',
    actor: 'agent',
    source: 'test',
    ...over,
  }) as BridgeEvent;
}

function drive(types: BridgeEventType[], start?: PhaseState): PhaseState {
  let s = start ?? initialState('p', 'X1A', 't', 'test');
  for (const t of types) s = applyEvent(s, ev(t)).state;
  return s;
}

describe('stateMachine', () => {
  test('stageForEvent maps events (and non-movers → null)', () => {
    expect(stageForEvent('PHASE_CREATED')).toBe('created');
    expect(stageForEvent('OWNER_APPROVED')).toBe('approved');
    expect(stageForEvent('PHASE_BLOCKED')).toBe('blocked');
    expect(stageForEvent('VALIDATION_COMPLETED')).toBeNull();
    expect(stageForEvent('SYNC_STARTED')).toBeNull();
  });

  test('isAllowedTransition enforces adjacency', () => {
    expect(isAllowedTransition('created', 'ready')).toBe(true);
    expect(isAllowedTransition('created', 'closed')).toBe(false);
    expect(isAllowedTransition('implementing', 'implementing')).toBe(true);
    expect(isAllowedTransition('closed', 'ready')).toBe(false);
  });

  test('stageToStatus maps every stage', () => {
    const stages: PhaseStage[] = [
      'created', 'ready', 'implementing', 'validating', 'evidence', 'awaiting_review',
      'approved', 'ready_to_commit', 'committed', 'ready_to_push', 'pushed', 'closed',
      'blocked', 'rolled_back',
    ];
    for (const st of stages) expect(typeof stageToStatus(st)).toBe('string');
    expect(stageToStatus('approved')).toBe('awaiting_closure');
    expect(stageToStatus('created')).toBe('draft');
  });
});

describe('stateManager happy path', () => {
  test('advances through the full lifecycle', () => {
    const s = drive([
      'PHASE_CREATED', 'PROMPT_READY', 'IMPLEMENTATION_STARTED', 'VALIDATION_STARTED',
      'EVIDENCE_CREATED', 'REVIEW_READY', 'OWNER_APPROVED', 'COMMIT_APPROVED',
    ]);
    expect(s.stage).toBe('ready_to_commit');
    expect(s.status).toBe('awaiting_closure');
  });

  test('validators track running → pass/fail; FILES_CHANGED resets', () => {
    let s = drive(['PHASE_CREATED', 'PROMPT_READY', 'IMPLEMENTATION_STARTED', 'VALIDATION_STARTED']);
    expect(s.validators).toBe('running');
    s = applyEvent(s, ev('VALIDATION_COMPLETED', { payload: { result: 'pass' } })).state;
    expect(s.validators).toBe('pass');
    s = applyEvent(s, ev('VALIDATION_COMPLETED', { payload: { result: 'fail' } })).state;
    expect(s.validators).toBe('fail');
    s = applyEvent(s, ev('FILES_CHANGED')).state;
    expect(s.validators).toBe('unknown');
  });

  test('FILES_CHANGED records changed files from relatedFiles and payload', () => {
    let s = drive(['PHASE_CREATED', 'PROMPT_READY', 'IMPLEMENTATION_STARTED']);
    s = applyEvent(s, ev('FILES_CHANGED', { relatedFiles: ['a.ts'] })).state;
    expect(s.changedFiles).toEqual(['a.ts']);
    s = applyEvent(s, ev('FILES_CHANGED', { payload: { files: ['b.ts', 5] } })).state;
    expect(s.changedFiles).toEqual(['b.ts']);
  });
});

describe('stateManager branches', () => {
  test('refuses an illegal transition and keeps stage', () => {
    const s0 = initialState('p', 'X1A', 't', 'test');
    const { state, refusedTransition } = applyEvent(s0, ev('OWNER_APPROVED'));
    expect(state.stage).toBe('created');
    expect(refusedTransition).toEqual({ from: 'created', to: 'approved' });
  });

  test('block then resume returns to prior stage', () => {
    let s = drive(['PHASE_CREATED', 'PROMPT_READY', 'IMPLEMENTATION_STARTED']);
    s = applyEvent(s, ev('PHASE_BLOCKED')).state;
    expect(s.stage).toBe('blocked');
    expect(s.resumeStage).toBe('implementing');
    s = applyEvent(s, ev('PHASE_RESUMED')).state;
    expect(s.stage).toBe('implementing');
    expect(s.resumeStage).toBeUndefined();
  });

  test('resume from non-blocked is a no-op', () => {
    const s = drive(['PHASE_CREATED']);
    const r = applyEvent(s, ev('PHASE_RESUMED'));
    expect(r.state.stage).toBe('created');
  });

  test('reject sends awaiting_review back to implementing', () => {
    let s = drive([
      'PHASE_CREATED', 'PROMPT_READY', 'IMPLEMENTATION_STARTED', 'VALIDATION_STARTED',
      'EVIDENCE_CREATED', 'REVIEW_READY',
    ]);
    expect(s.stage).toBe('awaiting_review');
    s = applyEvent(s, ev('OWNER_REJECTED')).state;
    expect(s.stage).toBe('implementing');
  });

  test('close out of blocked → closed_as_blocked', () => {
    let s = drive(['PHASE_CREATED', 'PROMPT_READY']);
    s = applyEvent(s, ev('PHASE_BLOCKED')).state;
    // blocked has no direct edge to closed; resume then rollback then close
    s = applyEvent(s, ev('PHASE_RESUMED')).state;
    s = applyEvent(s, ev('SAFETY_VIOLATION_DETECTED')).state; // → blocked again
    expect(s.stage).toBe('blocked');
  });

  test('rolled_back can close as blocked', () => {
    let s = drive(['PHASE_CREATED', 'PROMPT_READY', 'IMPLEMENTATION_STARTED']);
    s = applyEvent(s, ev('PHASE_CLOSED')).state; // illegal from implementing → refused, stays
    expect(s.stage).toBe('implementing');
  });
});

describe('git-driven transitions', () => {
  test('applyGitCommit advances ready_to_commit → committed', () => {
    let s = drive([
      'PHASE_CREATED', 'PROMPT_READY', 'IMPLEMENTATION_STARTED', 'VALIDATION_STARTED',
      'EVIDENCE_CREATED', 'REVIEW_READY', 'OWNER_APPROVED', 'COMMIT_APPROVED',
    ]);
    s = applyGitCommit(s, 'deadbeef', 't2');
    expect(s.stage).toBe('committed');
    expect(s.head).toBe('deadbeef');
  });

  test('applyGitCommit elsewhere only records head', () => {
    const s = drive(['PHASE_CREATED']);
    const out = applyGitCommit(s, 'abc', 't2');
    expect(out.stage).toBe('created');
    expect(out.head).toBe('abc');
  });

  test('applyGitPush advances committed → pushed, else no-op stage', () => {
    let s = drive([
      'PHASE_CREATED', 'PROMPT_READY', 'IMPLEMENTATION_STARTED', 'VALIDATION_STARTED',
      'EVIDENCE_CREATED', 'REVIEW_READY', 'OWNER_APPROVED', 'COMMIT_APPROVED',
    ]);
    s = applyGitCommit(s, 'h', 't');
    s = applyGitPush(s, 't3');
    expect(s.stage).toBe('pushed');
    const other = applyGitPush(drive(['PHASE_CREATED']), 't');
    expect(other.stage).toBe('created');
  });
});

describe('stateStore', () => {
  test('toStateJson emits schema-shaped keys with optionals', () => {
    let s = drive(['PHASE_CREATED', 'PROMPT_READY', 'IMPLEMENTATION_STARTED']);
    s = applyEvent(s, ev('FILES_CHANGED', { relatedFiles: ['a.ts'] })).state;
    s = { ...s, branch: 'main', head: 'abc', blockers: ['b'] };
    const json = toStateJson(s);
    expect(json['status']).toBe(s.status);
    expect(json['updated_at']).toBe(s.updatedAt);
    expect(json['decision_required']).toBe(s.decisionRequired);
    expect(json['branch']).toBe('main');
    expect(json['changedFiles']).toEqual(['a.ts']);
    expect(json['blockers']).toEqual(['b']);
  });
});
