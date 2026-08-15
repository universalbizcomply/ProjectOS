/**
 * DaemonClient — the Control Center's read-only window onto the Bridge Daemon.
 *
 * It owns no authoritative state: it subscribes to a transport, mirrors snapshots/events into
 * the store (redacted), keeps a heartbeat to detect silent drops, and reconnects with backoff.
 * The UI binds to `store` + the providers; it never talks to the daemon directly.
 */
import { ConnectionManager, DaemonConnection, Heartbeat, ReconnectManager } from './connection.js';
import { EventStream, HealthStream } from './eventStream.js';
import {
  DaemonHealthProvider,
  NotificationProvider,
  PhaseStatusProvider,
  WorkerStatusProvider,
} from './providers.js';
import { LiveStore } from './store.js';
import { StatusSynchroniser } from './synchroniser.js';
import type { DaemonTransport, Scheduler } from './ports.js';
import type { ConnectionState, TransportMessage } from './types.js';

export interface DaemonClientOptions {
  readonly heartbeatMs?: number;
  readonly livenessTimeoutMs?: number;
  readonly eventBufferSize?: number;
}

const DEFAULT_HEARTBEAT_MS = 5_000;
const DEFAULT_LIVENESS_MS = 12_000;

export class DaemonClient {
  readonly #transport: DaemonTransport;
  readonly #scheduler: Scheduler;
  readonly store = new LiveStore();
  readonly #sync = new StatusSynchroniser();
  readonly #events: EventStream;
  readonly #healthStream = new HealthStream();
  readonly #conn = new ConnectionManager(this.store);
  readonly #reconnect: ReconnectManager;
  readonly #heartbeat: Heartbeat;
  readonly #connection = new DaemonConnection();

  readonly health: DaemonHealthProvider;
  readonly workers: WorkerStatusProvider;
  readonly phases: PhaseStatusProvider;
  readonly notifications: NotificationProvider;

  readonly #heartbeatMs: number;
  readonly #livenessMs: number;
  #unsub: (() => void) | null = null;
  #paused = false;
  #started = false;

  constructor(transport: DaemonTransport, scheduler: Scheduler, opts: DaemonClientOptions = {}) {
    this.#transport = transport;
    this.#scheduler = scheduler;
    this.#events = new EventStream(opts.eventBufferSize);
    this.#reconnect = new ReconnectManager(scheduler);
    this.#heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.#livenessMs = opts.livenessTimeoutMs ?? DEFAULT_LIVENESS_MS;
    this.#heartbeat = new Heartbeat(scheduler, this.#heartbeatMs);
    this.health = new DaemonHealthProvider(this.store);
    this.workers = new WorkerStatusProvider(this.store);
    this.phases = new PhaseStatusProvider(this.store);
    this.notifications = new NotificationProvider(this.store);
  }

  /** Connect, subscribe, and begin the heartbeat. Idempotent. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#unsub = this.#transport.onMessage((m) => this.#handle(m));
    this.#conn.connecting(0);
    this.#transport.connect();
    this.#heartbeat.start(() => this.#beat());
  }

  stop(): void {
    this.#started = false;
    this.#heartbeat.stop();
    this.#reconnect.cancel();
    if (this.#unsub) {
      this.#unsub();
      this.#unsub = null;
    }
    this.#transport.disconnect();
    this.#conn.disconnected(0);
  }

  #handle(message: TransportMessage): void {
    if (message.kind === 'closed') {
      this.#down();
      return;
    }
    this.#connection.markMessage(this.#scheduler.now());
    switch (message.kind) {
      case 'lifecycle':
        // The host's authoritative worker lifecycle. Receiving it proves the native IPC is alive,
        // so the reconnect ladder resets — but the connection is NOT marked `connected`: that
        // still means "mirroring live daemon data", which only a snapshot establishes.
        this.store.update({ lifecycle: message.lifecycle });
        this.#reconnect.reset();
        break;
      case 'snapshot':
        this.#sync.applySnapshot(this.store, message.snapshot);
        this.#healthStream.set(message.snapshot.health);
        this.#conn.connected();
        this.#reconnect.reset();
        break;
      case 'event':
        this.#sync.applyEvent(this.store, this.#events, message.event, this.#paused);
        break;
      case 'notification':
        this.#sync.applyNotification(this.store, message.notification);
        break;
      case 'health':
        this.#healthStream.set(message.health);
        this.store.update({ health: message.health });
        break;
      case 'governed':
        // Canonical governed state. Stored verbatim — the UI renders what the runtime reported and
        // never recomputes authority for itself.
        this.store.update({ governed: message.state });
        this.#reconnect.reset();
        break;
      case 'governed-projects':
        // The installed-project inventory and the current selection. Stored verbatim for the same
        // reason: which projects exist is the installed host's answer, not the renderer's.
        this.store.update({ governedProjects: message.inventory });
        this.#reconnect.reset();
        break;
    }
  }

  #beat(): void {
    if (!this.#connection.isAlive(this.#scheduler.now(), this.#livenessMs)) {
      this.#down();
      return;
    }
    // Command lock: before the host reports the worker ready there is no daemon to answer, and a
    // refused snapshot would otherwise be misread as a dropped connection. The host's own
    // lifecycle poll keeps liveness fresh meanwhile. Transports with no lifecycle (in-process,
    // null) are unaffected.
    if (!this.#snapshotPermitted()) return;
    this.#transport.requestSnapshot();
  }

  /** Whether the host's lifecycle currently permits a read-only snapshot request. */
  #snapshotPermitted(): boolean {
    const lifecycle = this.store.getState().lifecycle;
    return lifecycle === null || lifecycle.readOnlyAvailable;
  }

  #down(): void {
    this.#conn.disconnected(this.#reconnect.attempt);
    // Governed state is a LIVE claim, so it must not outlive the connection that produced it.
    // Without this the last projection stayed in the store after the runtime died and the owner
    // surface went on reporting "Live · Canonical runtime state" against a runtime that no longer
    // existed — the precise dishonesty this surface is supposed to make impossible.
    this.store.update({
      governed: {
        connected: false,
        reason: 'RUNTIME_STOPPED',
        detail:
          'The ProjectOS runtime stopped responding, so this is no longer live state. Restart ProjectOS to reconnect.',
      },
    });
    this.#reconnect.schedule(() => this.#reconnect_attempt());
  }

  #reconnect_attempt(): void {
    this.#conn.connecting(this.#reconnect.attempt);
    this.#transport.disconnect();
    this.#transport.connect();
  }

  /** Pause/resume the event viewer (buffer keeps filling; visible list freezes). */
  setPaused(paused: boolean): void {
    this.#paused = paused;
    if (!paused) this.store.update({ events: this.#events.snapshot() });
  }

  get paused(): boolean {
    return this.#paused;
  }
  get eventStream(): EventStream {
    return this.#events;
  }
  get healthStream(): HealthStream {
    return this.#healthStream;
  }
  get connectionState(): ConnectionState {
    return this.#conn.state;
  }
}
