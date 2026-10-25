/**
 * Deterministic debounce coalescer — pure, tick-driven (no timers inside).
 *
 * The node adapter calls `schedule` on each raw fs event and `due(now)` on a fixed interval;
 * keys that keep changing keep pushing their fire time out. Because time is injected, the
 * coalescing logic is fully unit-testable without real clocks.
 */
export class Debouncer {
  readonly #delayMs: number;
  readonly #pending = new Map<string, number>();

  constructor(delayMs: number) {
    this.#delayMs = Math.max(0, delayMs);
  }

  /** Record (or push out) a key's fire time to now + delay. */
  schedule(key: string, now: number): void {
    this.#pending.set(key, now + this.#delayMs);
  }

  /** Keys whose fire time has arrived (<= now). Removes them from the pending set. */
  due(now: number): readonly string[] {
    const ready: string[] = [];
    for (const [key, fireAt] of this.#pending) {
      if (fireAt <= now) ready.push(key);
    }
    for (const key of ready) this.#pending.delete(key);
    return ready;
  }

  get size(): number {
    return this.#pending.size;
  }
}
