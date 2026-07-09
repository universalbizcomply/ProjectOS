/**
 * Providers — read-only views over the store for each UI concern. Pure selectors plus thin
 * provider objects (matching the spec's DaemonHealthProvider / WorkerStatusProvider /
 * PhaseStatusProvider / NotificationProvider) that expose get() + subscribe() over one slice.
 */
import type { LiveStore } from './store.js';
import type {
  LiveHealth,
  LiveNotification,
  LivePhase,
  LiveProjectSummary,
  LiveWorker,
} from './types.js';

// ---- pure selectors -----------------------------------------------------

export function selectHealth(store: LiveStore): LiveHealth | null {
  return store.getState().health;
}
export function selectWorkers(store: LiveStore): readonly LiveWorker[] {
  return store.getState().workers;
}
export function selectPhases(store: LiveStore): readonly LivePhase[] {
  return store.getState().phases;
}
export function selectProjects(store: LiveStore): readonly LiveProjectSummary[] {
  return store.getState().projects;
}
export function selectNotifications(store: LiveStore): readonly LiveNotification[] {
  return store.getState().notifications;
}

/** Phases parked at the review stage — the owner's review queue. */
export function selectPendingReviews(store: LiveStore): readonly LivePhase[] {
  return store.getState().phases.filter((p) => p.stage === 'awaiting_review');
}

/** Phases explicitly flagged as needing an owner decision. */
export function selectApprovals(store: LiveStore): readonly LivePhase[] {
  return store.getState().phases.filter((p) => p.decisionRequired && p.stage !== 'closed');
}

/** Workers currently online. */
export function selectOnlineWorkers(store: LiveStore): readonly LiveWorker[] {
  return store.getState().workers.filter((w) => w.online);
}

// ---- provider objects ---------------------------------------------------

class SliceProvider<T> {
  readonly #store: LiveStore;
  readonly #select: (s: LiveStore) => T;
  constructor(store: LiveStore, select: (s: LiveStore) => T) {
    this.#store = store;
    this.#select = select;
  }
  get(): T {
    return this.#select(this.#store);
  }
  subscribe(listener: () => void): () => void {
    return this.#store.subscribe(listener);
  }
}

export class DaemonHealthProvider extends SliceProvider<LiveHealth | null> {
  constructor(store: LiveStore) {
    super(store, selectHealth);
  }
}
export class WorkerStatusProvider extends SliceProvider<readonly LiveWorker[]> {
  constructor(store: LiveStore) {
    super(store, selectWorkers);
  }
}
export class PhaseStatusProvider extends SliceProvider<readonly LivePhase[]> {
  constructor(store: LiveStore) {
    super(store, selectPhases);
  }
}
export class NotificationProvider extends SliceProvider<readonly LiveNotification[]> {
  constructor(store: LiveStore) {
    super(store, selectNotifications);
  }
}
