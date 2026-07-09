import { describe, test, expect } from 'vitest';
import {
  applyWorkerEvent,
  onlineWorkers,
  workersForPhase,
  workerKey,
} from '../src/workers/workerManager.js';
import type { WorkerMap } from '../src/workers/workerManager.js';
import { makeEvent } from '../src/events/eventTypes.js';
import type { BridgeEvent, BridgeEventType } from '../src/types.js';

function ev(type: BridgeEventType, worker?: string, over: Partial<BridgeEvent> = {}): BridgeEvent {
  return makeEvent({
    id: 'e',
    seq: 0,
    type,
    project: 'p',
    phase: 'X1A',
    at: 't',
    actor: 'implementer',
    source: 's',
    ...(worker !== undefined ? { worker } : {}),
    ...over,
  }) as BridgeEvent;
}

describe('workerManager', () => {
  test('ignores events without a worker or without a status mapping', () => {
    let m: WorkerMap = new Map();
    m = applyWorkerEvent(m, ev('IMPLEMENTATION_STARTED')); // no worker
    expect(m.size).toBe(0);
    m = applyWorkerEvent(m, ev('PROMPT_GENERATED', 'claude-code')); // no status mapping
    expect(m.size).toBe(0);
  });

  test('tracks status transitions and provider inference', () => {
    let m: WorkerMap = new Map();
    m = applyWorkerEvent(m, ev('IMPLEMENTATION_STARTED', 'claude-code', { payload: { action: 'edit' } }));
    const key = workerKey('p', 'X1A', 'claude-code');
    expect(m.get(key)?.status).toBe('implementing');
    expect(m.get(key)?.provider).toBe('claude-code');
    expect(m.get(key)?.currentAction).toBe('edit');
    expect(m.get(key)?.online).toBe(true);

    m = applyWorkerEvent(m, ev('CHATGPT_REVIEW_STARTED', 'chatgpt'));
    expect(m.get(workerKey('p', 'X1A', 'chatgpt'))?.provider).toBe('chatgpt');

    m = applyWorkerEvent(m, ev('WORKER_OFFLINE', 'claude-code'));
    expect(m.get(key)?.online).toBe(false);
    expect(m.get(key)?.status).toBe('offline');
  });

  test('carries currentAction forward when a later event omits it', () => {
    let m: WorkerMap = new Map();
    m = applyWorkerEvent(m, ev('IMPLEMENTATION_STARTED', 'claude-code', { payload: { action: 'x' } }));
    m = applyWorkerEvent(m, ev('VALIDATION_STARTED', 'claude-code'));
    expect(m.get(workerKey('p', 'X1A', 'claude-code'))?.currentAction).toBe('x');
  });

  test('onlineWorkers and workersForPhase filter correctly', () => {
    let m: WorkerMap = new Map();
    m = applyWorkerEvent(m, ev('IMPLEMENTATION_STARTED', 'claude-code'));
    m = applyWorkerEvent(m, ev('REVIEW_READY', 'claude-code'));
    m = applyWorkerEvent(m, ev('WORKER_OFFLINE', 'owner-murad'));
    expect(onlineWorkers(m).length).toBe(1);
    expect(workersForPhase(m, 'p', 'X1A').length).toBe(2);
    expect(workersForPhase(m, 'p', 'other').length).toBe(0);
  });

  test('various status-implying events map', () => {
    let m: WorkerMap = new Map();
    for (const t of [
      'PROMPT_READ', 'FILES_CHANGED', 'EVIDENCE_CREATED', 'REPORT_CREATED',
      'CHANGES_REQUESTED', 'PHASE_BLOCKED', 'PHASE_CLOSED',
    ] as BridgeEventType[]) {
      m = applyWorkerEvent(m, ev(t, 'claude-code'));
    }
    expect(m.get(workerKey('p', 'X1A', 'claude-code'))?.status).toBe('done');
  });
});
