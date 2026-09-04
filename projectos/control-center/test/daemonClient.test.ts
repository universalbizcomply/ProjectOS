import { describe, test, expect } from 'vitest';
import { DaemonClient } from '../src/daemon/daemonClient.js';
import { createFakeScheduler, createFakeTransport, makeSnapshot, makeHealth } from './helpers.js';
import type { LiveEvent } from '../src/daemon/types.js';

const event = (over: Partial<LiveEvent> = {}): LiveEvent => ({
  id: 'e1', at: 't', type: 'FILES_CHANGED', project: 'p', phase: 'X', actor: 'implementer', ...over,
});

function setup() {
  const sched = createFakeScheduler();
  const transport = createFakeTransport();
  const client = new DaemonClient(transport, sched, {
    heartbeatMs: 1000,
    livenessTimeoutMs: 2000,
  });
  return { sched, transport, client };
}

describe('DaemonClient', () => {
  test('start connects and reports connecting', () => {
    const { transport, client } = setup();
    client.start();
    client.start(); // idempotent
    expect(transport.connects).toBe(1);
    expect(client.connectionState).toBe('connecting');
  });

  test('snapshot marks connected and populates store', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({
      kind: 'snapshot',
      snapshot: makeSnapshot({
        workers: [{ worker: 'claude-code', provider: 'claude-code', project: 'p', phase: 'X', status: 'implementing', online: true, updatedAt: 't' }],
      }),
    });
    expect(client.connectionState).toBe('connected');
    expect(client.store.getState().workers).toHaveLength(1);
    expect(client.store.getState().health?.running).toBe(true);
  });

  test('events append; pause freezes the visible list', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'snapshot', snapshot: makeSnapshot() });
    transport.emit({ kind: 'event', event: event({ id: 'a' }) });
    expect(client.store.getState().events).toHaveLength(1);
    client.setPaused(true);
    transport.emit({ kind: 'event', event: event({ id: 'b' }) });
    expect(client.store.getState().events).toHaveLength(1);
    client.setPaused(false);
    expect(client.store.getState().events).toHaveLength(2);
    expect(client.paused).toBe(false);
  });

  test('health and notification messages update the store', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'health', health: makeHealth({ uptimeMs: 42 }) });
    expect(client.store.getState().health?.uptimeMs).toBe(42);
    transport.emit({ kind: 'notification', notification: { kind: 'prompt-ready', project: 'p', phase: 'X', at: 't', message: 'm' } });
    expect(client.store.getState().notifications).toHaveLength(1);
  });

  test('heartbeat requests a snapshot while alive', () => {
    const { sched, transport, client } = setup();
    client.start();
    transport.emit({ kind: 'snapshot', snapshot: makeSnapshot() }); // marks message at t=0
    sched.advance(1000); // beat: alive → requestSnapshot
    expect(transport.snapshotRequests).toBe(1);
  });

  test('silent drop → disconnected → auto reconnect', () => {
    const { sched, transport, client } = setup();
    client.start();
    transport.emit({ kind: 'snapshot', snapshot: makeSnapshot() }); // last message at t=0
    // Beats at 1000, 2000 stay alive; by 3000 the 2000ms liveness window is exceeded.
    sched.advance(3000);
    expect(client.connectionState).toBe('disconnected');
    // Reconnect backoff (500ms) then a fresh connect.
    const connectsBefore = transport.connects;
    sched.advance(500);
    expect(client.connectionState).toBe('connecting');
    expect(transport.connects).toBe(connectsBefore + 1);
    expect(transport.disconnects).toBeGreaterThan(0);
  });

  test('governed state does not survive the connection that produced it', () => {
    const { sched, transport, client } = setup();
    client.start();
    // A live projection arrives and the surface would render it as canonical, live truth.
    transport.emit({
      kind: 'governed',
      state: { connected: true, projectId: 'projectos' } as never,
    });
    expect(client.store.getState().governed).toMatchObject({ connected: true });

    // The runtime then dies. Governed state is a LIVE claim, so it must not outlive the connection —
    // otherwise the owner keeps reading "Live · Canonical runtime state" against nothing at all.
    transport.emit({ kind: 'closed' });

    const governed = client.store.getState().governed;
    expect(governed).not.toBeNull();
    expect(governed!.connected).toBe(false);
    // and the owner is told what to do about it, not merely that something is wrong
    expect((governed as { detail: string }).detail).toContain('Restart ProjectOS');
  });

  test('closed message triggers reconnect', () => {
    const { sched, transport, client } = setup();
    client.start();
    transport.emit({ kind: 'closed' });
    expect(client.connectionState).toBe('disconnected');
    sched.advance(500);
    expect(client.connectionState).toBe('connecting');
  });

  test('stop tears down and ignores later messages', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'snapshot', snapshot: makeSnapshot() });
    client.stop();
    expect(transport.disconnects).toBeGreaterThan(0);
    expect(client.connectionState).toBe('disconnected');
    const before = client.store.getState().events.length;
    transport.emit({ kind: 'event', event: event({ id: 'z' }) }); // unsubscribed → ignored
    expect(client.store.getState().events.length).toBe(before);
  });
});

/* ------------------------------------------------------------------------------------------------
 * LIVENESS HAS EXACTLY ONE SOURCE — PROJECTOS-PROVIDER-RUNTIME-TRUTH-FIX1A.
 *
 * `governedRun.active` is what the Health surface is now allowed to call "Working". These prove the
 * link between the daemon that owns the child process and the store the surfaces read, and — the
 * part that matters for authority — that nothing else can set it.
 * --------------------------------------------------------------------------------------------- */
describe('the live run fact comes from the daemon and nowhere else', () => {
  test('nothing is live until the daemon says a run started', () => {
    const { client } = setup();
    client.start();
    expect(client.store.getState().governedRun.active).toBe(false);
  });

  test('run-started makes it live; run-finished ends it', () => {
    const { transport, client } = setup();
    client.start();

    transport.emit({ kind: 'run-started', phaseId: 'TWO', resumed: false } as never);
    expect(client.store.getState().governedRun.active).toBe(true);
    expect(client.store.getState().governedRun.phaseId).toBe('TWO');

    transport.emit({ kind: 'run-finished', phaseId: 'TWO', exitCode: 0 } as never);
    expect(client.store.getState().governedRun.active).toBe(false);
    expect(client.store.getState().governedRun.lastExitCode).toBe(0);
  });

  test('a governed snapshot full of started sessions does not make anything live', () => {
    // THE DEFECT, AT THE OTHER END OF THE WIRE. Session records arrive inside the governed state;
    // they are history. Only the daemon's own run events may move the live flag.
    const { transport, client } = setup();
    client.start();
    transport.emit({
      kind: 'governed',
      state: {
        connected: true,
        sessions: [
          { sessionId: 'S1', phaseId: 'TWO', workerId: 'w', kind: 'run', startedAt: 't', state: 'started', exitCode: null },
        ],
      },
    } as never);
    expect(client.store.getState().governedRun.active).toBe(false);
  });

  test('a finished run does not resurrect on the next output line', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'run-started', phaseId: 'TWO', resumed: false } as never);
    transport.emit({ kind: 'run-finished', phaseId: 'TWO', exitCode: 1 } as never);
    transport.emit({ kind: 'run-output', phaseId: 'TWO', stream: 'stdout', line: 'trailing' } as never);
    expect(client.store.getState().governedRun.active).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------
 * THE RUN BELONGS TO A PROJECT — PROJECTOS-MULTI-PROJECT-PROJECTION-IMPLEMENT1A.
 *
 * The daemon has always sent the root on every run event, and this client always threw it away. That
 * was safe while live state belonged to the selected project alone: only one project can be run, so
 * one flat run state was unambiguous. Portfolio rows change that — an unrooted run event could paint
 * one project's worker onto another's row.
 *
 * The root was already on the wire. These prove it is now kept.
 * --------------------------------------------------------------------------------------------- */
describe('a run is bound to the project it belongs to', () => {
  test('run-started keeps the root the daemon sent', () => {
    const { transport, client } = setup();
    client.start();

    transport.emit({ kind: 'run-started', root: 'C:/dev/polygo', phaseId: 'TWO', resumed: false } as never);

    expect(client.store.getState().governedRun.root).toBe('C:/dev/polygo');
    expect(client.store.getState().governedRun.active).toBe(true);
  });

  test("a run for one project never claims another project's root", () => {
    const { transport, client } = setup();
    client.start();

    transport.emit({ kind: 'run-started', root: 'C:/dev/deadaisle', phaseId: 'ONE', resumed: false } as never);
    expect(client.store.getState().governedRun.root).toBe('C:/dev/deadaisle');
    expect(client.store.getState().governedRun.root).not.toBe('C:/dev/polygo');
  });

  test('a finished run keeps the root of the run that ended', () => {
    // A cleared root would leave a finished run belonging to nothing, and the next reader would have
    // to guess which project it described.
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'run-started', root: 'C:/dev/polygo', phaseId: 'TWO', resumed: false } as never);
    transport.emit({ kind: 'run-finished', root: 'C:/dev/polygo', phaseId: 'TWO', exitCode: 0 } as never);

    expect(client.store.getState().governedRun.root).toBe('C:/dev/polygo');
    expect(client.store.getState().governedRun.active).toBe(false);
  });

  test('no run observed means no root — never a default one', () => {
    const { client } = setup();
    client.start();
    expect(client.store.getState().governedRun.root).toBeNull();
  });
});

describe('the portfolio arrives as the daemon built it', () => {
  test('it is stored verbatim, and absent until the daemon sends one', () => {
    const { transport, client } = setup();
    client.start();
    expect(client.store.getState().portfolio).toBeNull();

    transport.emit({
      kind: 'governed-portfolio',
      portfolio: {
        observedAt: '2026-08-30T12:00:00.000Z',
        projects: [
          {
            projectId: 'polygo',
            projectName: 'PolyGo',
            available: true,
            unavailableDetail: null,
            planStatus: 'PLAN READY',
            acceptedPhaseCount: 2,
            totalPhaseCount: 5,
            activePhaseId: 'POLYGO-TWO',
            blockerCount: 0,
            firstBlocker: null,
            ownerActionRequired: false,
            nextSafeAction: 'Continue POLYGO-TWO',
            liveness: 'UNKNOWN',
            observedAt: '2026-08-30T12:00:00.000Z',
          },
        ],
      },
    } as never);

    const stored = client.store.getState().portfolio;
    expect(stored?.projects).toHaveLength(1);
    expect(stored?.projects[0]?.projectId).toBe('polygo');
    // Not derived, not recomputed — the daemon's answer, unchanged.
    expect(stored?.projects[0]?.nextSafeAction).toBe('Continue POLYGO-TWO');
  });
});

/**
 * A RELOADED WINDOW MUST NOT REPORT LIVE WORK AS STOPPED.
 *
 * `run-started` is an event: a renderer that reloads, reconnects, or opens mid-run never hears it,
 * and showed a running programme as "Interrupted" while the process was still going. The sidecar
 * now repeats the liveness fact as a snapshot with every governed emission.
 */
describe('run-snapshot — liveness for a client that missed the event', () => {
  test('a snapshot for an unseen run makes it live, with no invented output', () => {
    const { transport, client } = setup();
    client.start();
    expect(client.store.getState().governedRun.active).toBe(false);

    transport.emit({
      kind: 'run-snapshot',
      root: 'C:/dev/ProjectOS',
      active: true,
      phaseId: 'validation-cache',
      startedAt: '2026-09-04T08:24:00.000Z',
    } as never);

    const run = client.store.getState().governedRun;
    expect(run.active).toBe(true);
    expect(run.root).toBe('C:/dev/ProjectOS');
    expect(run.phaseId).toBe('validation-cache');
    expect(run.startedAt).toBe('2026-09-04T08:24:00.000Z');
    // A snapshot carries no lines and must not pretend otherwise.
    expect(run.lines).toEqual([]);
  });

  test('a snapshot for the run already being followed keeps its output', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'run-started', root: 'C:/dev/ProjectOS', phaseId: 'validation-cache', resumed: false } as never);
    transport.emit({ kind: 'run-output', root: 'C:/dev/ProjectOS', phaseId: 'validation-cache', stream: 'stdout', line: 'Worker dispatched.' } as never);
    transport.emit({
      kind: 'run-snapshot',
      root: 'C:/dev/ProjectOS',
      active: true,
      phaseId: 'validation-cache',
      startedAt: '2026-09-04T08:24:00.000Z',
    } as never);

    const run = client.store.getState().governedRun;
    expect(run.active).toBe(true);
    expect(run.lines.map((l) => l.line)).toEqual(['Worker dispatched.']);
  });

  test('a snapshot saying nothing is running ends a run this client thought was live', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'run-started', root: 'C:/dev/ProjectOS', phaseId: 'validation-cache', resumed: false } as never);
    expect(client.store.getState().governedRun.active).toBe(true);

    transport.emit({ kind: 'run-snapshot', root: 'C:/dev/ProjectOS', active: false, phaseId: null, startedAt: null } as never);
    expect(client.store.getState().governedRun.active).toBe(false);
  });

  test('a snapshot for ANOTHER project does not carry this project\'s output across', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'run-started', root: 'C:/dev/ProjectOS', phaseId: 'validation-cache', resumed: false } as never);
    transport.emit({ kind: 'run-output', root: 'C:/dev/ProjectOS', phaseId: 'validation-cache', stream: 'stdout', line: 'ProjectOS line.' } as never);

    transport.emit({ kind: 'run-snapshot', root: 'C:/dev/Other', active: true, phaseId: 'x', startedAt: null } as never);
    const run = client.store.getState().governedRun;
    expect(run.root).toBe('C:/dev/Other');
    expect(run.lines).toEqual([]);
  });
});

/**
 * ONE PROJECT'S ENDING MUST NOT BE REPORTED ON ANOTHER.
 *
 * `GovernedActions` renders "Finished (exit code N)" from `lastExitCode` with no root filter, so a
 * code carried across a project switch is displayed on a project that never ran anything.
 */
describe('run-snapshot — nothing crosses between projects', () => {
  test('a finished run\'s exit code does not follow the store to another project', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'run-started', root: 'C:/dev/A', phaseId: 'p', resumed: false } as never);
    transport.emit({ kind: 'run-finished', root: 'C:/dev/A', phaseId: 'p', exitCode: 3 } as never);
    expect(client.store.getState().governedRun.lastExitCode).toBe(3);

    // Selecting project B: its snapshot says nothing is running there.
    transport.emit({ kind: 'run-snapshot', root: 'C:/dev/B', active: false, phaseId: null, startedAt: null } as never);
    const run = client.store.getState().governedRun;
    expect(run.root).toBe('C:/dev/B');
    expect(run.lastExitCode).toBeNull();
    expect(run.lines).toEqual([]);
  });

  test('a repeated snapshot for an idle project does not churn the store', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'run-snapshot', root: 'C:/dev/A', active: false, phaseId: null, startedAt: null } as never);
    const first = client.store.getState().governedRun;
    transport.emit({ kind: 'run-snapshot', root: 'C:/dev/A', active: false, phaseId: null, startedAt: null } as never);
    // Same object identity: subscribers must not re-render on a heartbeat that changed nothing.
    expect(client.store.getState().governedRun).toBe(first);
  });

  test('the exit code survives a snapshot for the SAME idle project', () => {
    const { transport, client } = setup();
    client.start();
    transport.emit({ kind: 'run-started', root: 'C:/dev/A', phaseId: 'p', resumed: false } as never);
    transport.emit({ kind: 'run-finished', root: 'C:/dev/A', phaseId: 'p', exitCode: 0 } as never);
    transport.emit({ kind: 'run-snapshot', root: 'C:/dev/A', active: false, phaseId: null, startedAt: null } as never);
    expect(client.store.getState().governedRun.lastExitCode).toBe(0);
  });
});
