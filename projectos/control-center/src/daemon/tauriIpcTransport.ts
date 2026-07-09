/**
 * TauriIPCTransport — the real desktop transport. It plugs into the SAME DaemonClient as the
 * other transports (so providers, EventStream, ReconnectManager and Heartbeat are reused, not
 * duplicated). It listens to the Rust host's `daemon://message` event channel and asks for a
 * snapshot via a read-only invoke. Strictly read-only: it never invokes a write/exec command.
 */
import { IPC_COMMANDS, IPC_EVENT_CHANNEL } from './ipcCommands.js';
import { parseMessageLine } from './ipcProtocol.js';
import type { IpcBridge } from './ipcBridge.js';
import type { DaemonTransport, TransportListener } from './ports.js';
import type { TransportMessage } from './types.js';

function asLine(payload: unknown): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
}

export class TauriIPCTransport implements DaemonTransport {
  readonly kind = 'tauri-ipc';
  readonly #bridge: IpcBridge;
  readonly #listeners = new Set<TransportListener>();
  #unlisten: (() => void) | null = null;
  #connecting: Promise<void> = Promise.resolve();

  constructor(bridge: IpcBridge) {
    this.#bridge = bridge;
  }

  connect(): void {
    this.#connecting = this.#bridge
      .listen(IPC_EVENT_CHANNEL, (payload) => {
        const message = parseMessageLine(asLine(payload));
        if (message !== null) this.#emit(message);
      })
      .then((unlisten) => {
        this.#unlisten = unlisten;
        // Trigger the first snapshot; failure means the host/daemon isn't up.
        return this.#bridge.invoke(IPC_COMMANDS.requestSnapshot).then(() => undefined);
      })
      .catch(() => {
        this.#emit({ kind: 'closed' });
      });
  }

  disconnect(): void {
    if (this.#unlisten) {
      this.#unlisten();
      this.#unlisten = null;
    }
  }

  onMessage(listener: TransportListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  requestSnapshot(): void {
    this.#bridge.invoke(IPC_COMMANDS.requestSnapshot).catch(() => {
      this.#emit({ kind: 'closed' });
    });
  }

  /** Test seam: resolves once connect()'s listen/invoke chain settles. */
  whenReady(): Promise<void> {
    return this.#connecting;
  }

  #emit(message: TransportMessage): void {
    for (const l of this.#listeners) l(message);
  }
}
