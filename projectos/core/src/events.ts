/**
 * Event system: an immutable append-only domain event log, plus a lightweight bus.
 *
 * The log is pure (append returns a new log). Callers supply id/at so the core stays
 * deterministic. The EventBus is an edge helper for surfaces that want push updates; it
 * is intentionally the only stateful/side-effecting piece here.
 */
import type { Role } from './types.js';

export interface DomainEvent<T = unknown> {
  readonly id: string;
  readonly type: string;
  readonly at: string;
  readonly actor: Role;
  readonly payload: T;
}

export type EventLog = readonly DomainEvent[];

export const EMPTY_LOG: EventLog = [];

/** Append an event, returning a new log. */
export function append(log: EventLog, event: DomainEvent): EventLog {
  return [...log, event];
}

/** All events of a given type, in order. */
export function filterByType(log: EventLog, type: string): EventLog {
  return log.filter((e) => e.type === type);
}

/** All events by a given actor, in order. */
export function filterByActor(log: EventLog, actor: Role): EventLog {
  return log.filter((e) => e.actor === actor);
}

/** The most recent event, or undefined if the log is empty. */
export function latest(log: EventLog): DomainEvent | undefined {
  return log.length > 0 ? log[log.length - 1] : undefined;
}

export type EventHandler = (event: DomainEvent) => void;

/** Minimal synchronous pub/sub for surfaces. Not used by the pure engines. */
export class EventBus {
  #handlers = new Set<EventHandler>();

  subscribe(handler: EventHandler): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  publish(event: DomainEvent): void {
    for (const handler of this.#handlers) {
      handler(event);
    }
  }

  get size(): number {
    return this.#handlers.size;
  }
}
