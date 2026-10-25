import { describe, test, expect } from 'vitest';
import { BridgeDaemon } from '../src/daemon/bridgeDaemon.js';
import { DEFAULT_CONFIG } from '../src/constants.js';
import { createFakeSystem } from './helpers/fakeSystem.js';
import {
  eventLogPath,
  reportsDir,
  evidenceDir,
  approvalsDir,
  statePath,
  eventsDir,
} from '../src/utils/paths.js';
import type { DaemonConfig } from '../src/types.js';

const ROOT = '/dev/app';

function logLine(o: Record<string, unknown>): string {
  return JSON.stringify(o);
}

function seedProject(sys: ReturnType<typeof createFakeSystem>, lines: string[]): void {
  sys.put(eventLogPath(ROOT), lines.join('\n') + '\n');
}

function config(over: Partial<DaemonConfig> = {}): DaemonConfig {
  return { ...DEFAULT_CONFIG, watchRoots: [ROOT], debounceMs: 0, ...over };
}

const created = logLine({ id: 'a', seq: 0, type: 'PHASE_CREATED', project: 'app', phase: 'X1A', at: 't', actor: 'agent', source: 'cli', decision_required: false });
const prompt = logLine({ id: 'b', seq: 1, type: 'PROMPT_READY', project: 'app', phase: 'X1A', at: 't', actor: 'advisor', source: 'cli', decision_required: false });
const impl = logLine({ id: 'c', seq: 2, type: 'IMPLEMENTATION_STARTED', project: 'app', phase: 'X1A', at: 't', actor: 'implementer', worker: 'claude-code', source: 'vscode', decision_required: false });
const val = logLine({ id: 'v', seq: 3, type: 'VALIDATION_STARTED', project: 'app', phase: 'X1A', at: 't', actor: 'implementer', worker: 'claude-code', source: 'vscode', decision_required: false });

describe('BridgeDaemon lifecycle', () => {
  test('start discovers, recovers, wires watch and persists state', () => {
    const sys = createFakeSystem();
    seedProject(sys, [created, prompt]);
    const d = new BridgeDaemon(sys, config());
    d.start();

    expect(d.running).toBe(true);
    expect(d.projects.map((p) => p.name)).toEqual(['app']);
    expect(d.phaseStates()[0]?.stage).toBe('ready');
    expect(sys.files.has(statePath(ROOT))).toBe(true);
    expect(sys.lastWatch).not.toBeNull();

    d.stop();
    expect(d.running).toBe(false);
    expect(sys.lastWatch).toBeNull();
  });

  test('handleChange(event) folds newly-appended events', () => {
    const sys = createFakeSystem();
    seedProject(sys, [created, prompt]);
    const d = new BridgeDaemon(sys, config());
    d.start();
    // External writer appends an event.
    sys.put(eventLogPath(ROOT), [created, prompt, impl].join('\n') + '\n');
    d.handleChange({ project: 'app', path: eventsDir(ROOT), kind: 'event' });
    expect(d.phaseStates()[0]?.stage).toBe('implementing');
    expect(d.workers.size).toBe(1);
  });

  test('owner approval file becomes a canonical event and advances the phase', () => {
    const sys = createFakeSystem();
    // Drive to awaiting_review so OWNER_APPROVED is legal.
    const evidence = logLine({ id: 'd', seq: 4, type: 'EVIDENCE_CREATED', project: 'app', phase: 'X1A', at: 't', actor: 'implementer', source: 'vscode', decision_required: true });
    const review = logLine({ id: 'e', seq: 5, type: 'REVIEW_READY', project: 'app', phase: 'X1A', at: 't', actor: 'implementer', source: 'vscode', decision_required: true });
    seedProject(sys, [created, prompt, impl, val, evidence, review]);
    const d = new BridgeDaemon(sys, config());
    d.start();
    expect(d.phaseStates()[0]?.stage).toBe('awaiting_review');

    sys.put(approvalsDir(ROOT) + '/decision.json', JSON.stringify({ decision: 'approved', decidedBy: 'owner' }));
    d.handleChange({ project: 'app', path: approvalsDir(ROOT) + '/decision.json', kind: 'approval' });
    expect(d.phaseStates()[0]?.stage).toBe('approved');
    // Event was appended to the log.
    expect(sys.readFile(eventLogPath(ROOT))).toContain('OWNER_APPROVED');
  });

  test('non-owner approval is ignored', () => {
    const sys = createFakeSystem();
    seedProject(sys, [created, prompt]);
    const d = new BridgeDaemon(sys, config());
    d.start();
    sys.put(approvalsDir(ROOT) + '/x.json', JSON.stringify({ decision: 'approved', decidedBy: 'chatgpt' }));
    d.handleChange({ project: 'app', path: approvalsDir(ROOT) + '/x.json', kind: 'approval' });
    expect(sys.readFile(eventLogPath(ROOT))).not.toContain('OWNER_APPROVED');
  });

  test('report + evidence files raise canonical signals', () => {
    const sys = createFakeSystem();
    seedProject(sys, [created, prompt, impl]);
    const d = new BridgeDaemon(sys, config());
    d.start();
    sys.put(reportsDir(ROOT) + '/report.md', '# report');
    sys.put(evidenceDir(ROOT) + '/evidence.json', '{}');
    d.handleChange({ project: 'app', path: reportsDir(ROOT), kind: 'report' });
    const log = sys.readFile(eventLogPath(ROOT)) ?? '';
    expect(log).toContain('REPORT_CREATED');
    expect(log).toContain('EVIDENCE_CREATED');
    expect(log).toContain('REVIEW_READY');
  });

  test('observed commit advances ready_to_commit → committed', () => {
    const sys = createFakeSystem();
    const evidence = logLine({ id: 'd', seq: 4, type: 'EVIDENCE_CREATED', project: 'app', phase: 'X1A', at: 't', actor: 'implementer', source: 'vscode', decision_required: true });
    const review = logLine({ id: 'e', seq: 5, type: 'REVIEW_READY', project: 'app', phase: 'X1A', at: 't', actor: 'implementer', source: 'vscode', decision_required: true });
    const approved = logLine({ id: 'f', seq: 6, type: 'OWNER_APPROVED', project: 'app', phase: 'X1A', at: 't', actor: 'owner', source: 'control-center', decision_required: false });
    const commitOk = logLine({ id: 'g', seq: 7, type: 'COMMIT_APPROVED', project: 'app', phase: 'X1A', at: 't', actor: 'owner', source: 'control-center', decision_required: false });
    seedProject(sys, [created, prompt, impl, val, evidence, review, approved, commitOk]);
    sys.gitSnapshots.set(ROOT, { branch: 'main', head: 'aaa', dirtyCount: 0 });
    const d = new BridgeDaemon(sys, config());
    d.start();
    expect(d.phaseStates()[0]?.stage).toBe('ready_to_commit');
    sys.gitSnapshots.set(ROOT, { branch: 'main', head: 'bbb', dirtyCount: 0 });
    d.handleChange({ project: 'app', path: ROOT + '/.git/HEAD', kind: 'git' });
    expect(d.phaseStates()[0]?.stage).toBe('committed');
  });

  test('syncDashboard writes a redacted per-project cache', () => {
    const sys = createFakeSystem();
    seedProject(sys, [created, prompt]);
    const d = new BridgeDaemon(sys, config());
    d.start();
    const snap = d.syncDashboard();
    expect(snap.projects).toHaveLength(1);
    expect(d.dashboard).not.toBeNull();
    const cache = [...sys.files.keys()].find((k) => k.endsWith('dashboard-cache.json'));
    expect(cache).toBeDefined();
  });

  test('tickAt flushes debounced changes then syncs', () => {
    const sys = createFakeSystem();
    seedProject(sys, [created, prompt]);
    const d = new BridgeDaemon(sys, config({ debounceMs: 10 }));
    d.start();
    sys.put(eventLogPath(ROOT), [created, prompt, impl].join('\n') + '\n');
    d.onRawPath(eventsDir(ROOT) + '/event-log.jsonl', 0);
    d.tickAt(50);
    expect(d.phaseStates()[0]?.stage).toBe('implementing');
    expect(d.dashboard).not.toBeNull();
  });

  test('health reports counts; unknown project change is a no-op', () => {
    const sys = createFakeSystem();
    seedProject(sys, [created, prompt]);
    const d = new BridgeDaemon(sys, config());
    d.start();
    d.handleChange({ project: 'ghost', path: '/x', kind: 'event' });
    const h = d.health();
    expect(h.projects).toBe(1);
    expect(h.running).toBe(true);
    expect(h.pendingPrompts).toBe(1); // phase is in 'ready'
  });

  test('appendCanonical starts a log when none exists', () => {
    const sys = createFakeSystem();
    // Project discovered via an empty .projectops dir (no log yet).
    sys.mkdir(ROOT + '/.projectops/bridge/events');
    const d = new BridgeDaemon(sys, config());
    d.start();
    // Manually ingest a created event so a phase exists, then append.
    d.ingestEvent(
      {
        id: 'x', seq: 0, type: 'PHASE_CREATED', project: 'app', phase: 'X1A',
        at: 't', actor: 'agent', source: 'test', decisionRequired: false,
      },
      ROOT,
    );
    d.appendCanonical(ROOT, { project: 'app', phase: 'X1A', type: 'PROMPT_READY', actor: 'advisor' });
    expect(sys.readFile(eventLogPath(ROOT))).toContain('PROMPT_READY');
    expect(d.phaseStates()[0]?.stage).toBe('ready');
  });

  test('a refused transition is logged as WARN', () => {
    const sys = createFakeSystem();
    seedProject(sys, [created]);
    const d = new BridgeDaemon(sys, config());
    d.start();
    d.ingestEvent(
      {
        id: 'y', seq: 9, type: 'OWNER_APPROVED', project: 'app', phase: 'X1A',
        at: 't', actor: 'owner', source: 'test', decisionRequired: false,
      },
      ROOT,
    );
    expect(sys.logs.some((l) => l.includes('refused illegal transition'))).toBe(true);
  });
});
