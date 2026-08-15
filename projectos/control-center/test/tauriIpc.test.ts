import { describe, test, expect, vi, afterEach } from 'vitest';
import {
  encodeMessageLine,
  parseMessageLine,
  encodeCommand,
  parseCommandLine,
} from '../src/daemon/ipcProtocol.js';
import {
  LIFECYCLE_POLL_MS,
  TauriIPCTransport,
  parseLifecycle,
} from '../src/daemon/tauriIpcTransport.js';
import { createDesktopTransport } from '../src/daemon/selectTransport.js';
import { IPC_COMMANDS, IPC_EVENT_CHANNEL } from '../src/daemon/ipcCommands.js';
import type { IpcBridge } from '../src/daemon/ipcBridge.js';
import type { DaemonLifecycleState, LiveLifecycle, TransportMessage } from '../src/daemon/types.js';
import { makeSnapshot } from './helpers.js';

// ---- a controllable fake IpcBridge -------------------------------------

/** The exact sentences the Rust host returns (`DaemonStatus::next_safe_action`). */
const RECOVERING_MESSAGE = 'ProjectOS is finishing recovery from the previous session.';
const BLOCKED_MESSAGE = 'Local worker unavailable. Restart ProjectOS.';

function lifecycle(state: DaemonLifecycleState, nextSafeAction = 'msg'): LiveLifecycle {
  return {
    state,
    readOnlyAvailable: state === 'RUNNING_READ_ONLY',
    protectedApprovalsDisabled: true,
    nextSafeAction,
  };
}

interface FakeBridge extends IpcBridge {
  fire(payload: unknown): void;
  invokes: string[];
  failInvoke: boolean;
  failListen: boolean;
  tauri: boolean;
  /** What `daemon_status` resolves to. */
  status: unknown;
  /** Reject `daemon_status` instead of resolving. */
  failStatus: boolean;
  /** Resolve `daemon_status` only when released (drives the overlap/late-reply proofs). */
  deferStatus: boolean;
  releaseStatus(): void;
}

function createFakeBridge(): FakeBridge {
  let handler: ((payload: unknown) => void) | null = null;
  let pending: (() => void)[] = [];
  const b: FakeBridge = {
    tauri: true,
    failInvoke: false,
    failListen: false,
    failStatus: false,
    deferStatus: false,
    status: lifecycle('RUNNING_READ_ONLY', 'ready'),
    invokes: [],
    isTauri: () => b.tauri,
    invoke: (command) => {
      b.invokes.push(command);
      if (command === IPC_COMMANDS.status) {
        if (b.failStatus) return Promise.reject(new Error('ipc gone'));
        if (b.deferStatus) {
          return new Promise((resolve) => pending.push(() => resolve(b.status)));
        }
        return Promise.resolve(b.status);
      }
      return b.failInvoke ? Promise.reject(new Error('down')) : Promise.resolve(null);
    },
    listen: (_event, h) => {
      if (b.failListen) return Promise.reject(new Error('no host'));
      handler = h;
      return Promise.resolve(() => {
        handler = null;
      });
    },
    fire: (payload) => handler?.(payload),
    releaseStatus: () => {
      const p = pending;
      pending = [];
      for (const r of p) r();
    },
  };
  return b;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('ipcProtocol', () => {
  test('encode/parse round-trips a message', () => {
    const msg: TransportMessage = { kind: 'snapshot', snapshot: makeSnapshot() };
    const line = encodeMessageLine(msg);
    expect(line.endsWith('\n')).toBe(true);
    const parsed = parseMessageLine(line);
    expect(parsed?.kind).toBe('snapshot');
  });

  test('parseMessageLine rejects blank/malformed/unknown-kind', () => {
    expect(parseMessageLine('')).toBeNull();
    expect(parseMessageLine('   ')).toBeNull();
    expect(parseMessageLine('{bad')).toBeNull();
    expect(parseMessageLine('42')).toBeNull();
    expect(parseMessageLine('{"kind":"nope"}')).toBeNull();
    expect(parseMessageLine('{"kind":"closed"}')?.kind).toBe('closed');
  });

  test('command encode/parse', () => {
    expect(encodeCommand({ cmd: 'snapshot' })).toContain('snapshot');
    expect(parseCommandLine('{"cmd":"snapshot"}')).toEqual({ cmd: 'snapshot' });
    expect(parseCommandLine('')).toBeNull();
    expect(parseCommandLine('{bad')).toBeNull();
    expect(parseCommandLine('{"cmd":"delete"}')).toBeNull();
  });
});

describe('TauriIPCTransport', () => {
  test('connect listens, asks the host for its lifecycle, then requests a snapshot once ready, and relays parsed messages', async () => {
    const bridge = createFakeBridge(); // defaults to RUNNING_READ_ONLY
    const t = new TauriIPCTransport(bridge);
    const seen: TransportMessage[] = [];
    t.onMessage((m) => seen.push(m));
    t.connect();
    await t.whenReady();
    await flush();
    // Lifecycle is asked for FIRST; the snapshot only follows because the host reported ready.
    expect(bridge.invokes[0]).toBe(IPC_COMMANDS.status);
    expect(bridge.invokes).toContain(IPC_COMMANDS.requestSnapshot);
    expect(seen[0]).toEqual({ kind: 'lifecycle', lifecycle: bridge.status });
    seen.length = 0;
    // The Rust host emits a JSON line string on the event channel.
    bridge.fire(encodeMessageLine({ kind: 'snapshot', snapshot: makeSnapshot() }).trim());
    bridge.fire(encodeMessageLine({ kind: 'closed' }).trim());
    // A non-string payload (object) is also accepted.
    bridge.fire({ kind: 'health', health: makeSnapshot().health });
    // Malformed payloads are ignored.
    bridge.fire('{garbage');
    expect(seen.map((m) => m.kind)).toEqual(['snapshot', 'closed', 'health']);
  });

  test('the daemon can never assert its own lifecycle over the event channel', () => {
    // `lifecycle` is host-authoritative: the wire parser must not accept it.
    expect(parseMessageLine('{"kind":"lifecycle","lifecycle":{"state":"RUNNING_READ_ONLY"}}')).toBeNull();
  });

  test.each([
    ['RECOVERING', RECOVERING_MESSAGE],
    ['STARTING', 'Starting local worker…'],
    ['BLOCKED', BLOCKED_MESSAGE],
    ['CRASHED', 'Local worker crashed. Restart ProjectOS.'],
    ['STOPPED', 'Local worker stopped.'],
  ] as const)('emits the %s lifecycle and never a snapshot request or Disconnected', async (state, message) => {
    vi.useFakeTimers();
    const bridge = createFakeBridge();
    bridge.status = lifecycle(state, message);
    const t = new TauriIPCTransport(bridge);
    const seen: TransportMessage[] = [];
    t.onMessage((m) => seen.push(m));
    t.connect();
    await t.whenReady();
    await vi.advanceTimersByTimeAsync(0);

    expect(seen[0]).toEqual({ kind: 'lifecycle', lifecycle: bridge.status });
    // Pre-ready: the host's refusal (DaemonNotReady) is never provoked, so nothing looks dropped.
    expect(bridge.invokes).not.toContain(IPC_COMMANDS.requestSnapshot);
    expect(seen.some((m) => m.kind === 'closed')).toBe(false);
    t.disconnect();
  });

  test('polls on ONE loop while pre-ready, then stops permanently once ready', async () => {
    vi.useFakeTimers();
    const bridge = createFakeBridge();
    bridge.status = lifecycle('RECOVERING', RECOVERING_MESSAGE);
    const t = new TauriIPCTransport(bridge);
    t.connect();
    await t.whenReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.invokes.filter((c) => c === IPC_COMMANDS.status)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(LIFECYCLE_POLL_MS);
    expect(bridge.invokes.filter((c) => c === IPC_COMMANDS.status)).toHaveLength(2);

    // The host finishes recovery: the next poll observes ready and hands over to the snapshot flow.
    bridge.status = lifecycle('RUNNING_READ_ONLY', 'ready');
    await vi.advanceTimersByTimeAsync(LIFECYCLE_POLL_MS);
    expect(bridge.invokes.filter((c) => c === IPC_COMMANDS.status)).toHaveLength(3);
    expect(bridge.invokes).toContain(IPC_COMMANDS.requestSnapshot);

    // Ready ⇒ the fast poll is over; no further status requests, ever.
    await vi.advanceTimersByTimeAsync(LIFECYCLE_POLL_MS * 5);
    expect(bridge.invokes.filter((c) => c === IPC_COMMANDS.status)).toHaveLength(3);
    t.disconnect();
  });

  test('never overlaps status requests when a reply is slow', async () => {
    vi.useFakeTimers();
    const bridge = createFakeBridge();
    bridge.status = lifecycle('RECOVERING', RECOVERING_MESSAGE);
    bridge.deferStatus = true;
    const t = new TauriIPCTransport(bridge);
    t.connect();
    // NOT `whenReady()`: it resolves only once the status settles, and this one deliberately hangs.
    await vi.advanceTimersByTimeAsync(0);
    // One request outstanding; time passing must not stack more on top of it.
    expect(bridge.invokes.filter((c) => c === IPC_COMMANDS.status)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(LIFECYCLE_POLL_MS * 4);
    expect(bridge.invokes.filter((c) => c === IPC_COMMANDS.status)).toHaveLength(1);
    t.disconnect();
  });

  test('disposal clears the timer and silences a late reply', async () => {
    vi.useFakeTimers();
    const bridge = createFakeBridge();
    bridge.status = lifecycle('RECOVERING', RECOVERING_MESSAGE);
    bridge.deferStatus = true;
    const t = new TauriIPCTransport(bridge);
    const seen: TransportMessage[] = [];
    t.onMessage((m) => seen.push(m));
    t.connect();
    // NOT `whenReady()`: the in-flight status is released only after disposal, below.
    await vi.advanceTimersByTimeAsync(0);

    t.disconnect(); // dispose with a status request still in flight
    bridge.releaseStatus(); // the late reply lands after disposal
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toHaveLength(0); // ignored entirely — no state, no 'closed'

    // And no timer survives disposal: no further polling happens.
    const after = bridge.invokes.length;
    await vi.advanceTimersByTimeAsync(LIFECYCLE_POLL_MS * 5);
    expect(bridge.invokes).toHaveLength(after);
  });

  test('a genuine status IPC failure emits closed', async () => {
    const bridge = createFakeBridge();
    bridge.failStatus = true;
    const t = new TauriIPCTransport(bridge);
    const seen: TransportMessage[] = [];
    t.onMessage((m) => seen.push(m));
    t.connect();
    await t.whenReady();
    await flush();
    expect(seen).toEqual([{ kind: 'closed' }]);
  });

  test('an unparseable status is treated as unavailable, never as a state', async () => {
    for (const bad of [null, 42, {}, { state: 'NOPE' }, { state: 'RECOVERING' }]) {
      const bridge = createFakeBridge();
      bridge.status = bad;
      const t = new TauriIPCTransport(bridge);
      const seen: TransportMessage[] = [];
      t.onMessage((m) => seen.push(m));
      t.connect();
      await t.whenReady();
      await flush();
      expect(seen).toEqual([{ kind: 'closed' }]);
      t.disconnect();
    }
  });

  test('parseLifecycle accepts only a complete, known status', () => {
    expect(parseLifecycle(lifecycle('RECOVERING', RECOVERING_MESSAGE))).not.toBeNull();
    expect(parseLifecycle(null)).toBeNull();
    expect(parseLifecycle('RECOVERING')).toBeNull();
    expect(parseLifecycle({ state: 'RECOVERING', nextSafeAction: '' })).toBeNull();
    expect(parseLifecycle({ ...lifecycle('RECOVERING'), state: 'TRUSTED' })).toBeNull();
    expect(parseLifecycle({ ...lifecycle('RECOVERING'), readOnlyAvailable: 'yes' })).toBeNull();
    expect(parseLifecycle({ ...lifecycle('RECOVERING'), protectedApprovalsDisabled: 1 })).toBeNull();
  });

  test('listen failure emits closed', async () => {
    const bridge = createFakeBridge();
    bridge.failListen = true;
    const t = new TauriIPCTransport(bridge);
    const seen: TransportMessage[] = [];
    t.onMessage((m) => seen.push(m));
    t.connect();
    await t.whenReady();
    expect(seen).toEqual([{ kind: 'closed' }]);
  });

  test('requestSnapshot failure emits closed', async () => {
    const bridge = createFakeBridge();
    const t = new TauriIPCTransport(bridge);
    const seen: TransportMessage[] = [];
    t.onMessage((m) => seen.push(m));
    t.connect();
    await t.whenReady();
    bridge.failInvoke = true;
    t.requestSnapshot();
    await flush();
    expect(seen.some((m) => m.kind === 'closed')).toBe(true);
  });

  test('disconnect unlistens and stops relaying', async () => {
    const bridge = createFakeBridge();
    const t = new TauriIPCTransport(bridge);
    const seen: TransportMessage[] = [];
    const off = t.onMessage((m) => seen.push(m));
    t.connect();
    await t.whenReady();
    await flush();
    t.disconnect();
    seen.length = 0; // only what arrives AFTER disposal matters here
    bridge.fire(encodeMessageLine({ kind: 'closed' }).trim()); // handler cleared → nothing
    expect(seen).toHaveLength(0);
    off();
    expect(t.kind).toBe('tauri-ipc');
  });
});

describe('createDesktopTransport', () => {
  test('selects TauriIPCTransport inside Tauri, NullTransport in a browser', () => {
    const bridge = createFakeBridge();
    bridge.tauri = true;
    expect(createDesktopTransport(bridge).kind).toBe('tauri-ipc');
    bridge.tauri = false;
    expect(createDesktopTransport(bridge).kind).toBe('null');
  });

  test('event channel constant is stable', () => {
    expect(IPC_EVENT_CHANNEL).toBe('daemon://message');
  });
});

/**
 * THE INVENTORY IS STRUCTURALLY CHECKED AT THE WIRE BOUNDARY (PROJECTOS-PHASE6-SECTION-C).
 *
 * Every other message kind here is accepted on the strength of its discriminant alone. The inventory
 * is not: it decides WHICH project the surface believes it is looking at, so a malformed one — from
 * version skew between a sidecar and a browser bundle, or from a defect upstream — is dropped at the
 * boundary rather than rendered as though it satisfied the type it is cast to.
 */
describe('governed-projects payloads are validated, not merely discriminated', () => {
  const valid = {
    kind: 'governed-projects',
    inventory: {
      projects: [
        {
          projectId: 'projectos',
          projectName: 'ProjectOS',
          repositoryRoot: 'C:\dev\ProjectOS',
          repository: 'universalbizcomply/ProjectOS',
        },
      ],
      registryStatus: 'ok',
      refusedCount: 0,
      selectedProjectId: 'projectos',
    },
  };

  test('a well-formed inventory parses', () => {
    expect(parseMessageLine(JSON.stringify(valid))).toEqual(valid);
  });

  test('a malformed inventory is refused rather than cast', () => {
    const malformed: unknown[] = [
      { kind: 'governed-projects' },
      { kind: 'governed-projects', inventory: null },
      { kind: 'governed-projects', inventory: [] },
      { kind: 'governed-projects', inventory: { ...valid.inventory, projects: 'all of them' } },
      { kind: 'governed-projects', inventory: { ...valid.inventory, refusedCount: 'none' } },
      { kind: 'governed-projects', inventory: { ...valid.inventory, registryStatus: 7 } },
      { kind: 'governed-projects', inventory: { ...valid.inventory, selectedProjectId: 7 } },
      { kind: 'governed-projects', inventory: { ...valid.inventory, projects: [{ projectId: 'x' }] } },
      {
        kind: 'governed-projects',
        inventory: { ...valid.inventory, projects: [{ ...valid.inventory.projects[0], repositoryRoot: 5 }] },
      },
    ];
    for (const payload of malformed) {
      expect(parseMessageLine(JSON.stringify(payload)), JSON.stringify(payload)).toBeNull();
    }
  });
});
