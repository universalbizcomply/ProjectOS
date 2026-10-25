/**
 * Persistence CONTRACT (not a production adapter). The controller is the only writer; state is
 * never sourced from UI memory. Optimistic concurrency: an update must supply the expected
 * revision, and a mismatch fails rather than overwriting newer state. An in-memory deterministic
 * implementation is provided for tests and the synthetic runtime. This module writes NOTHING to
 * canonical ProjectOS state files. Created in PROJECTOS-EXECUTION-RUNTIME-CORE1A.
 */
import type { ExecutionRecord } from './types.js';

/**
 * A recorded idempotency result: the COMPLETE canonical semantic request string (not a hash — so
 * equivalence is decided by exact value comparison, never by a hash collision) + the response.
 */
export interface IdempotencyEntry<R> {
  readonly canonicalRequest: string;
  readonly response: R;
}

export interface ExecutionStore {
  /** Create a new record. Fails if the operationId already exists. */
  create(record: ExecutionRecord): { ok: true } | { ok: false; reason: 'duplicate' };
  get(operationId: string): ExecutionRecord | null;
  /** Update with expected revision (optimistic concurrency). */
  update(
    operationId: string,
    expectedRevision: number,
    next: ExecutionRecord,
  ): { ok: true } | { ok: false; reason: 'not-found' | 'revision-mismatch' };
  list(): readonly ExecutionRecord[];
  getIdempotency(key: string): IdempotencyEntry<unknown> | null;
  saveIdempotency(key: string, entry: IdempotencyEntry<unknown>): void;
}

/** Deterministic in-memory store. No clock, no randomness, no external I/O. */
export class InMemoryExecutionStore implements ExecutionStore {
  readonly #records = new Map<string, ExecutionRecord>();
  readonly #idem = new Map<string, IdempotencyEntry<unknown>>();

  create(record: ExecutionRecord): { ok: true } | { ok: false; reason: 'duplicate' } {
    const id = record.identity.operationId;
    if (this.#records.has(id)) return { ok: false, reason: 'duplicate' };
    this.#records.set(id, record);
    return { ok: true };
  }

  get(operationId: string): ExecutionRecord | null {
    return this.#records.get(operationId) ?? null;
  }

  update(
    operationId: string,
    expectedRevision: number,
    next: ExecutionRecord,
  ): { ok: true } | { ok: false; reason: 'not-found' | 'revision-mismatch' } {
    const current = this.#records.get(operationId);
    if (current === undefined) return { ok: false, reason: 'not-found' };
    if (current.revision !== expectedRevision) return { ok: false, reason: 'revision-mismatch' };
    this.#records.set(operationId, next);
    return { ok: true };
  }

  list(): readonly ExecutionRecord[] {
    return [...this.#records.values()];
  }

  getIdempotency(key: string): IdempotencyEntry<unknown> | null {
    return this.#idem.get(key) ?? null;
  }

  saveIdempotency(key: string, entry: IdempotencyEntry<unknown>): void {
    this.#idem.set(key, entry);
  }
}
