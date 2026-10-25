import { describe, it, expect } from 'vitest';
import {
  WORKER_TYPES,
  roleForWorkerType,
  registerWorker,
  getWorker,
  workersOfType,
  canWorkerPerform,
  assignForCapability,
  EMPTY_WORKERS,
  type Worker,
} from '../src/workers.js';

const claude: Worker = {
  id: 'claude',
  type: 'implementer',
  displayName: 'Claude Code',
  provider: 'claude-code',
  capabilities: ['implement', 'test'],
};
const chatgpt: Worker = {
  id: 'chatgpt',
  type: 'reviewer',
  displayName: 'ChatGPT',
  provider: 'chatgpt',
  capabilities: ['review'],
};
const murad: Worker = {
  id: 'murad',
  type: 'owner',
  displayName: 'Murad',
  provider: 'human',
  capabilities: ['approve'],
};

describe('worker model', () => {
  it('lists the eleven roadmap worker types', () => {
    expect(WORKER_TYPES).toHaveLength(11);
    expect(WORKER_TYPES).toContain('security');
  });

  it('maps worker types to governance roles', () => {
    expect(roleForWorkerType('owner')).toBe('owner');
    expect(roleForWorkerType('reviewer')).toBe('advisor');
    expect(roleForWorkerType('research')).toBe('advisor');
    expect(roleForWorkerType('implementer')).toBe('implementer');
    expect(roleForWorkerType('security')).toBe('implementer');
    expect(roleForWorkerType('deployment')).toBe('implementer');
  });

  it('registers and resolves workers', () => {
    let reg = EMPTY_WORKERS;
    for (const w of [claude, chatgpt, murad]) {
      const r = registerWorker(reg, w);
      expect(r.ok).toBe(true);
      if (r.ok) reg = r.value;
    }
    expect(getWorker(reg, 'claude')?.provider).toBe('claude-code');
    expect(workersOfType(reg, 'reviewer')).toHaveLength(1);
    expect(assignForCapability(reg, 'test')?.id).toBe('claude');
    expect(assignForCapability(reg, 'nope')).toBeUndefined();
  });

  it('rejects duplicate worker ids', () => {
    const r1 = registerWorker(EMPTY_WORKERS, claude);
    if (!r1.ok) return;
    expect(registerWorker(r1.value, claude).ok).toBe(false);
  });

  it('enforces permissions through the mapped role', () => {
    // owner worker can close; implementer/reviewer cannot
    expect(canWorkerPerform(murad, 'close_phase')).toBe(true);
    expect(canWorkerPerform(claude, 'close_phase')).toBe(false);
    expect(canWorkerPerform(claude, 'implement')).toBe(true);
    expect(canWorkerPerform(chatgpt, 'recommend_closure')).toBe(true);
    expect(canWorkerPerform(chatgpt, 'approve')).toBe(false);
  });
});
