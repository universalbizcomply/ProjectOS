/**
 * In-process event bus — synchronous pub/sub for daemon subsystems (sync, notifications,
 * health). A subscriber that throws is isolated so it cannot take down the publish loop or
 * sibling subscribers. Edge helper; the pure reducers never depend on it.
 */
import type { BridgeEvent } from '../types.js';

export type EventHandler = (event: BridgeEvent) => void;
export type ErrorHandler = (error: unknown, event: BridgeEvent) => void;

export class EventBus {
  readonly #handlers = new Set<EventHandler>();
  readonly #onError: ErrorHandler | undefined;

  constructor(onError?: ErrorHandler) {
    this.#onError = onError;
  }

  subscribe(handler: EventHandler): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  publish(event: BridgeEvent): void {
    for (const handler of this.#handlers) {
      try {
        handler(event);
      } catch (error) {
        this.#onError?.(error, event);
      }
    }
  }

  get size(): number {
    return this.#handlers.size;
  }
}
