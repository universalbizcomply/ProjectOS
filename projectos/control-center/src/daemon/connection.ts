/**
 * Connection lifecycle — keeps the UI honest about whether it is seeing live data, and
 * recovers automatically without ever crashing the UI.
 *
 *  - ConnectionManager owns the ConnectionState and writes it to the store.
 *  - ReconnectManager schedules capped exponential-backoff retries via the Scheduler.
 *  - Heartbeat re-arms a liveness check each beat (one-shot Scheduler timers, no interval).
 *  - DaemonConnection tracks last-message time so the heartbeat can detect a silent drop.
 */
import type { Scheduler } from './ports.js';
import type { LiveStore } from './store.js';
import type { ConnectionState } from './types.js';

export class ConnectionManager {
  readonly #store: LiveStore;
  #state: ConnectionState = 'disconnected';

  constructor(store: LiveStore) {
    this.#store = store;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  #set(state: ConnectionState, reconnectAttempt: number): void {
    this.#state = state;
    this.#store.update({ connection: state, reconnectAttempt });
  }

  connecting(attempt = 0): void {
    this.#set('connecting', attempt);
  }
  connected(): void {
    this.#set('connected', 0);
  }
  disconnected(attempt = 0): void {
    this.#set('disconnected', attempt);
  }
}

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 15_000;

/** Capped exponential backoff for the given attempt number (0-based). */
export function backoffDelay(attempt: number): number {
  const raw = BACKOFF_BASE_MS * 2 ** attempt;
  return Math.min(raw, BACKOFF_MAX_MS);
}

export class ReconnectManager {
  readonly #scheduler: Scheduler;
  #handle: number | null = null;
  #attempt = 0;

  constructor(scheduler: Scheduler) {
    this.#scheduler = scheduler;
  }

  get attempt(): number {
    return this.#attempt;
  }

  /** Schedule the next reconnect attempt; returns the delay used. */
  schedule(run: () => void): number {
    this.cancel();
    const delay = backoffDelay(this.#attempt);
    this.#attempt += 1;
    this.#handle = this.#scheduler.setTimer(run, delay);
    return delay;
  }

  /** Reset the backoff after a successful connect. */
  reset(): void {
    this.cancel();
    this.#attempt = 0;
  }

  cancel(): void {
    if (this.#handle !== null) {
      this.#scheduler.clearTimer(this.#handle);
      this.#handle = null;
    }
  }
}

export class Heartbeat {
  readonly #scheduler: Scheduler;
  readonly #intervalMs: number;
  #handle: number | null = null;
  #running = false;

  constructor(scheduler: Scheduler, intervalMs: number) {
    this.#scheduler = scheduler;
    this.#intervalMs = intervalMs;
  }

  get running(): boolean {
    return this.#running;
  }

  /** Start beating; `onBeat` runs each interval until stop(). */
  start(onBeat: () => void): void {
    this.#running = true;
    const tick = (): void => {
      if (!this.#running) return;
      onBeat();
      if (this.#running) this.#handle = this.#scheduler.setTimer(tick, this.#intervalMs);
    };
    this.#handle = this.#scheduler.setTimer(tick, this.#intervalMs);
  }

  stop(): void {
    this.#running = false;
    if (this.#handle !== null) {
      this.#scheduler.clearTimer(this.#handle);
      this.#handle = null;
    }
  }
}

export class DaemonConnection {
  #lastMessageAt = 0;

  markMessage(now: number): void {
    this.#lastMessageAt = now;
  }

  get lastMessageAt(): number {
    return this.#lastMessageAt;
  }

  /** Alive if a message arrived within the timeout window. */
  isAlive(now: number, timeoutMs: number): boolean {
    return now - this.#lastMessageAt <= timeoutMs;
  }
}
