/**
 * TauriIPCTransport — the real desktop transport. It plugs into the SAME DaemonClient as the
 * other transports (so providers, EventStream, ReconnectManager and Heartbeat are reused, not
 * duplicated). It listens to the Rust host's `daemon://message` event channel and asks for a
 * snapshot via a read-only invoke. Strictly read-only: it never invokes a write/exec command.
 *
 * Lifecycle-first (RECOVERY-BARRIER1D): before the worker is ready there is no daemon and
 * therefore no snapshot to ask for, so the host's `daemon_status` is the authority. On connect the
 * transport requests it immediately, then polls it on ONE owned, cancellable loop while the state
 * is pre-ready, and asks for a snapshot only once the host reports RUNNING_READ_ONLY. Recovering /
 * starting / blocked are expected lifecycle states, NOT transport loss, so they are never reported
 * as Disconnected.
 */
import { IPC_COMMANDS, IPC_EVENT_CHANNEL } from './ipcCommands.js';
import { parseMessageLine } from './ipcProtocol.js';
import type { IpcBridge } from './ipcBridge.js';
import type { DaemonTransport, TransportListener } from './ports.js';
import type { DaemonLifecycleState, LiveLifecycle, TransportMessage } from './types.js';

/** Poll cadence while the host is pre-ready. Fast enough to feel live, bounded to avoid churn. */
export const LIFECYCLE_POLL_MS = 400;

const LIFECYCLE_STATES: ReadonlySet<string> = new Set<DaemonLifecycleState>([
  'NOT_STARTED',
  'RECOVERING',
  'STARTING',
  'RUNNING_READ_ONLY',
  'STOPPING',
  'STOPPED',
  'CRASHED',
  'BLOCKED',
]);

function asLine(payload: unknown): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
}

/**
 * Validate the host's `SafeDaemonStatus` reply. An unknown shape is rejected rather than coerced:
 * a status we cannot understand must never be presented to the owner as fact.
 */
export function parseLifecycle(value: unknown): LiveLifecycle | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.state !== 'string' || !LIFECYCLE_STATES.has(v.state)) return null;
  if (typeof v.nextSafeAction !== 'string' || v.nextSafeAction.length === 0) return null;
  if (typeof v.readOnlyAvailable !== 'boolean') return null;
  if (typeof v.protectedApprovalsDisabled !== 'boolean') return null;
  return {
    state: v.state as DaemonLifecycleState,
    readOnlyAvailable: v.readOnlyAvailable,
    protectedApprovalsDisabled: v.protectedApprovalsDisabled,
    nextSafeAction: v.nextSafeAction,
  };
}

export class TauriIPCTransport implements DaemonTransport {
  readonly kind = 'tauri-ipc';
  readonly #bridge: IpcBridge;
  readonly #listeners = new Set<TransportListener>();
  #unlisten: (() => void) | null = null;
  #connecting: Promise<void> = Promise.resolve();
  /** The ONE pre-ready poll timer. Never more than one in flight. */
  #pollTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while a `daemon_status` invoke is outstanding — prevents overlapping requests. */
  #statusInFlight = false;
  /** Bumped by every disconnect; replies from an older generation are ignored. */
  #generation = 0;

  constructor(bridge: IpcBridge) {
    this.#bridge = bridge;
  }

  connect(): void {
    const generation = this.#generation;
    this.#connecting = this.#bridge
      .listen(IPC_EVENT_CHANNEL, (payload) => {
        const message = parseMessageLine(asLine(payload));
        if (message !== null) this.#emit(message);
      })
      .then((unlisten) => {
        if (generation !== this.#generation) {
          unlisten(); // disconnected while listening was still being established
          return;
        }
        this.#unlisten = unlisten;
        // Lifecycle first: before readiness there is no snapshot to ask for.
        return this.#pollLifecycle(generation);
      })
      .catch(() => {
        // A failed `listen` is genuine transport loss: the native IPC is unavailable.
        this.#emit({ kind: 'closed' });
      });
  }

  disconnect(): void {
    this.#generation += 1;
    this.#clearPoll();
    this.#statusInFlight = false;
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
      // Only reached once ready (connect gates it, and the heartbeat runs after): a real drop.
      this.#emit({ kind: 'closed' });
    });
  }

  /** Test seam: resolves once connect()'s listen/status chain settles. */
  whenReady(): Promise<void> {
    return this.#connecting;
  }

  /**
   * Ask the host for its authoritative lifecycle once, publish it, then decide what follows:
   * ready ⇒ hand over to the existing snapshot flow and stop the fast poll; pre-ready ⇒ schedule
   * exactly one more poll. A rejected invoke means the native IPC itself is gone.
   */
  async #pollLifecycle(generation: number): Promise<void> {
    if (generation !== this.#generation || this.#statusInFlight) return;
    this.#statusInFlight = true;
    let reply: unknown;
    try {
      reply = await this.#bridge.invoke(IPC_COMMANDS.status);
    } catch {
      this.#statusInFlight = false;
      if (generation !== this.#generation) return; // disposed: stay silent
      this.#emit({ kind: 'closed' });
      return;
    }
    this.#statusInFlight = false;
    // A reply that arrives after disposal must change nothing.
    if (generation !== this.#generation) return;

    const lifecycle = parseLifecycle(reply);
    if (lifecycle === null) {
      // The host answered in a shape we do not speak: unavailable, not a lifecycle state.
      this.#emit({ kind: 'closed' });
      return;
    }
    this.#emit({ kind: 'lifecycle', lifecycle });

    if (lifecycle.state === 'RUNNING_READ_ONLY') {
      // Ready: the existing snapshot + heartbeat flow takes over and the fast poll stops here.
      this.requestSnapshot();
      return;
    }
    this.#schedulePoll(generation);
  }

  #schedulePoll(generation: number): void {
    this.#clearPoll();
    this.#pollTimer = setTimeout(() => {
      this.#pollTimer = null;
      void this.#pollLifecycle(generation);
    }, LIFECYCLE_POLL_MS);
  }

  #clearPoll(): void {
    if (this.#pollTimer !== null) {
      clearTimeout(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  #emit(message: TransportMessage): void {
    for (const l of this.#listeners) l(message);
  }
}
