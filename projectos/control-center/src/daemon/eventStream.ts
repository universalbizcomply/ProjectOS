/**
 * EventStream + HealthStream — bounded, newest-first buffers for the live viewers.
 *
 * The event viewer is strictly read-only. Pausing stops new events from being committed to
 * the visible snapshot (the buffer keeps filling underneath); filtering/search are pure.
 */
import type { LiveEvent, LiveHealth } from './types.js';

const DEFAULT_MAX = 200;

export interface EventFilter {
  readonly project?: string;
  readonly worker?: string;
  readonly type?: string;
  readonly text?: string;
}

/** Pure predicate: does an event match a filter? Empty filter matches everything. */
export function matchEvent(event: LiveEvent, filter: EventFilter): boolean {
  if (filter.project && event.project !== filter.project) return false;
  if (filter.worker && event.worker !== filter.worker) return false;
  if (filter.type && event.type !== filter.type) return false;
  if (filter.text) {
    const hay = `${event.type} ${event.project} ${event.phase} ${event.actor} ${event.worker ?? ''}`.toLowerCase();
    if (!hay.includes(filter.text.toLowerCase())) return false;
  }
  return true;
}

export function filterEvents(events: readonly LiveEvent[], filter: EventFilter): readonly LiveEvent[] {
  return events.filter((e) => matchEvent(e, filter));
}

export class EventStream {
  readonly #max: number;
  #buffer: readonly LiveEvent[] = [];

  constructor(max: number = DEFAULT_MAX) {
    this.#max = max;
  }

  /** Prepend an event (newest first), capping the buffer. Returns the new snapshot. */
  push(event: LiveEvent): readonly LiveEvent[] {
    const next = [event, ...this.#buffer];
    this.#buffer = next.length > this.#max ? next.slice(0, this.#max) : next;
    return this.#buffer;
  }

  snapshot(): readonly LiveEvent[] {
    return this.#buffer;
  }

  clear(): void {
    this.#buffer = [];
  }

  get size(): number {
    return this.#buffer.length;
  }
}

export class HealthStream {
  readonly #max: number;
  #latest: LiveHealth | null = null;
  #history: readonly LiveHealth[] = [];

  constructor(max = 30) {
    this.#max = max;
  }

  set(health: LiveHealth): void {
    this.#latest = health;
    const next = [...this.#history, health];
    this.#history = next.length > this.#max ? next.slice(next.length - this.#max) : next;
  }

  get latest(): LiveHealth | null {
    return this.#latest;
  }

  get history(): readonly LiveHealth[] {
    return this.#history;
  }
}
