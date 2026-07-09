import { describe, test, expect } from 'vitest';
import {
  encodeMessageLine,
  parseMessageLine,
  encodeCommand,
  parseCommandLine,
} from '../src/daemon/ipcProtocol.js';
import { TauriIPCTransport } from '../src/daemon/tauriIpcTransport.js';
import { createDesktopTransport } from '../src/daemon/selectTransport.js';
import { IPC_COMMANDS, IPC_EVENT_CHANNEL } from '../src/daemon/ipcCommands.js';
import type { IpcBridge } from '../src/daemon/ipcBridge.js';
import type { TransportMessage } from '../src/daemon/types.js';
import { makeSnapshot } from './helpers.js';

// ---- a controllable fake IpcBridge -------------------------------------

interface FakeBridge extends IpcBridge {
  fire(payload: unknown): void;
  invokes: string[];
  failInvoke: boolean;
  failListen: boolean;
  tauri: boolean;
}

function createFakeBridge(): FakeBridge {
  let handler: ((payload: unknown) => void) | null = null;
  const b: FakeBridge = {
    tauri: true,
    failInvoke: false,
    failListen: false,
    invokes: [],
    isTauri: () => b.tauri,
    invoke: (command) => {
      b.invokes.push(command);
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
  };
  return b;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

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
  test('connect listens, requests a snapshot, and relays parsed messages', async () => {
    const bridge = createFakeBridge();
    const t = new TauriIPCTransport(bridge);
    const seen: TransportMessage[] = [];
    t.onMessage((m) => seen.push(m));
    t.connect();
    await t.whenReady();
    expect(bridge.invokes).toContain(IPC_COMMANDS.requestSnapshot);
    // The Rust host emits a JSON line string on the event channel.
    bridge.fire(encodeMessageLine({ kind: 'snapshot', snapshot: makeSnapshot() }).trim());
    bridge.fire(encodeMessageLine({ kind: 'closed' }).trim());
    // A non-string payload (object) is also accepted.
    bridge.fire({ kind: 'health', health: makeSnapshot().health });
    // Malformed payloads are ignored.
    bridge.fire('{garbage');
    expect(seen.map((m) => m.kind)).toEqual(['snapshot', 'closed', 'health']);
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
    t.disconnect();
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
