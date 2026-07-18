/**
 * Observable store — the single object the React layer binds to via useSyncExternalStore.
 *
 * The UI never owns state; it renders this mirror of the daemon's truth. Updates replace only
 * changed slices (reference-stable otherwise) so React repaints just the components that moved.
 */
import type { LiveState } from './types.js';

export const INITIAL_STATE: LiveState = {
  connection: 'disconnected',
  reconnectAttempt: 0,
  lifecycle: null,
  health: null,
  workers: [],
  phases: [],
  projects: [],
  events: [],
  notifications: [],
};

export type Listener = () => void;

export class LiveStore {
  #state: LiveState;
  readonly #listeners = new Set<Listener>();

  constructor(initial: LiveState = INITIAL_STATE) {
    this.#state = initial;
  }

  getState = (): LiveState => this.#state;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * Apply a partial update. Only the provided keys change; if every provided value is
   * reference-equal to the current one, no notification fires (no wasted repaint).
   */
  update(patch: Partial<LiveState>): void {
    let changed = false;
    const next = { ...this.#state } as { [K in keyof LiveState]: LiveState[K] };
    for (const key of Object.keys(patch) as (keyof LiveState)[]) {
      const value = patch[key];
      if (value !== undefined && value !== this.#state[key]) {
        (next[key] as LiveState[keyof LiveState]) = value as LiveState[keyof LiveState];
        changed = true;
      }
    }
    if (!changed) return;
    this.#state = next;
    for (const l of this.#listeners) l();
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }
}
