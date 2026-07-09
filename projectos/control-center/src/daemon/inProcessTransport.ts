/**
 * InProcessTransport — the real bridge between a co-located BridgeDaemon and the client.
 *
 * Used where the Control Center shares a JS runtime with the daemon (a Node host or a Tauri
 * Node sidecar) and by the tests. It is the ONLY file that references @projectos/bridge-daemon,
 * and it does so with a type-only import so the browser bundle never pulls in node:fs. It is
 * strictly read-only: it subscribes to the daemon's event bus and projects its state; it never
 * calls a mutating method (the daemon exposes none to it anyway).
 */
import type {
  BridgeDaemon,
  BridgeEvent,
  HealthSnapshot,
  Notification as DaemonNotification,
  PhaseState,
  WorkerState,
} from '@projectos/bridge-daemon';
import type { DaemonTransport, TransportListener } from './ports.js';
import type {
  DaemonSnapshot,
  LiveEvent,
  LiveHealth,
  LiveNotification,
  LivePhase,
  LiveProjectSummary,
  LiveWorker,
} from './types.js';

const MAX_NOTIFICATIONS = 50;

function mapHealth(h: HealthSnapshot, recovered: boolean): LiveHealth {
  return { ...h, recovered };
}

function mapWorker(w: WorkerState): LiveWorker {
  return {
    worker: w.worker,
    provider: w.provider,
    project: w.project,
    phase: w.phase,
    status: w.status,
    online: w.online,
    updatedAt: w.updatedAt,
    ...(w.currentAction !== undefined ? { currentAction: w.currentAction } : {}),
  };
}

function mapPhase(p: PhaseState): LivePhase {
  return {
    project: p.project,
    phase: p.phase,
    stage: p.stage,
    status: p.status,
    validators: p.validators,
    decisionRequired: p.decisionRequired,
    worker: p.worker,
    blockers: p.blockers ?? [],
    ...(p.branch !== undefined ? { branch: p.branch } : {}),
  };
}

function mapProject(p: PhaseState): LiveProjectSummary {
  return {
    project: p.project,
    phase: p.phase,
    stage: p.stage,
    worker: p.worker,
    validators: p.validators,
    decisionRequired: p.decisionRequired,
    ...(p.branch !== undefined ? { branch: p.branch } : {}),
  };
}

function mapNotification(n: DaemonNotification): LiveNotification {
  return { kind: n.kind, project: n.project, phase: n.phase, at: n.at, message: n.message };
}

function mapEvent(e: BridgeEvent): LiveEvent {
  return {
    id: e.id,
    at: e.at,
    type: e.type,
    project: e.project,
    phase: e.phase,
    actor: e.actor,
    ...(e.worker !== undefined ? { worker: e.worker } : {}),
  };
}

export class InProcessTransport implements DaemonTransport {
  readonly kind = 'in-process';
  readonly #daemon: BridgeDaemon;
  readonly #listeners = new Set<TransportListener>();
  #unsub: (() => void) | null = null;

  constructor(daemon: BridgeDaemon) {
    this.#daemon = daemon;
  }

  /** Build a redacted-by-the-daemon snapshot from current daemon state. */
  buildSnapshot(): DaemonSnapshot {
    const phases = this.#daemon.phaseStates();
    return {
      health: mapHealth(this.#daemon.health(), phases.length > 0),
      workers: [...this.#daemon.workers.values()].map(mapWorker),
      phases: phases.map(mapPhase),
      projects: phases.map(mapProject),
      notifications: this.#daemon.notifications.slice(-MAX_NOTIFICATIONS).map(mapNotification),
    };
  }

  connect(): void {
    this.#emit({ kind: 'snapshot', snapshot: this.buildSnapshot() });
    this.#unsub = this.#daemon.bus.subscribe((event) => {
      this.#emit({ kind: 'event', event: mapEvent(event) });
      this.#emit({ kind: 'snapshot', snapshot: this.buildSnapshot() });
    });
  }

  disconnect(): void {
    if (this.#unsub) {
      this.#unsub();
      this.#unsub = null;
    }
  }

  onMessage(listener: TransportListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  requestSnapshot(): void {
    this.#emit({ kind: 'snapshot', snapshot: this.buildSnapshot() });
  }

  #emit(message: Parameters<TransportListener>[0]): void {
    for (const l of this.#listeners) l(message);
  }
}
