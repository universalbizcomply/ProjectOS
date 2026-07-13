/**
 * Storage contracts for the owner-attestation foundation.
 *
 * `RawFs` is an INJECTED low-level port (the module never imports node:fs) so the store logic stays
 * pure/testable and confined to a canonical trust root. The in-memory store backs tests; the
 * bounded-fs store is NOT production-ready without an injected StoreProtection reporting
 * PRODUCTION_PROTECTION_READY. Single-record atomicity only (temp-write + rename) — no cross-file
 * transactional guarantee is claimed. Created in PROJECTOS-OWNER-ATTESTATION-STORE1A.
 */
import { failWith, succeed, type Outcome } from './errors.js';
import { effectiveIntegrityStatus } from './policy.js';
import type { VerifiedStoreProtection } from './capabilities.js';
import type { AttestationPolicy, StoreIntegrityStatus } from './types.js';

/** Injected low-level filesystem port confined by the store to the trust root. */
export interface RawFs {
  readFile(path: string): string | null;
  writeFile(path: string, content: string): void;
  rename(from: string, to: string): void;
  /** Canonical real path (resolves ., .., and — where the impl supports it — reparse points). */
  realpath(path: string): string;
  mkdirp(path: string): void;
  readdir(path: string): string[];
  removeFile(path: string): void;
  exists(path: string): boolean;
}

/** A keyed, revisioned record store with an integrity status. */
export interface RecordStore<T extends { readonly recordRevision?: number; readonly revision?: number }> {
  integrityStatus(): StoreIntegrityStatus;
  create(key: string, record: T): Outcome<T>;
  get(key: string): T | null;
  list(): readonly T[];
  /** Update with the expected current revision (optimistic concurrency). */
  update(key: string, expectedRevision: number, next: T): Outcome<T>;
}

function revOf(r: { readonly recordRevision?: number; readonly revision?: number }): number {
  return r.recordRevision ?? r.revision ?? 0;
}

/** Deterministic in-memory store — always TEST_ISOLATED. */
export class InMemoryRecordStore<T extends { readonly recordRevision?: number; readonly revision?: number }> implements RecordStore<T> {
  readonly #map = new Map<string, T>();

  integrityStatus(): StoreIntegrityStatus { return 'TEST_ISOLATED'; }

  create(key: string, record: T): Outcome<T> {
    if (this.#map.has(key)) return failWith('CREDENTIAL_ALREADY_EXISTS', 'record already exists');
    this.#map.set(key, record);
    return succeed(record);
  }

  get(key: string): T | null { return this.#map.get(key) ?? null; }
  list(): readonly T[] { return [...this.#map.values()]; }

  update(key: string, expectedRevision: number, next: T): Outcome<T> {
    const cur = this.#map.get(key);
    if (cur === undefined) return failWith('CREDENTIAL_NOT_FOUND', 'record not found');
    if (revOf(cur) !== expectedRevision) return failWith('STALE_REVISION', 'revision mismatch');
    this.#map.set(key, next);
    return succeed(next);
  }
}

const KEY = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * Bounded filesystem store over an injected RawFs. Confined to a canonical trust root; every op
 * path must resolve under it or PATH_TRAVERSAL_BLOCKED. Writes go to a same-directory temp file then
 * atomic rename. Production is gated: not writable unless integrity == PRODUCTION_PROTECTION_READY.
 */
export class BoundedFsRecordStore<T extends { readonly recordRevision?: number; readonly revision?: number }> implements RecordStore<T> {
  readonly #fs: RawFs;
  readonly #root: string;
  readonly #policy: AttestationPolicy;
  readonly #protection: VerifiedStoreProtection | null;
  readonly #clock: () => string;
  readonly #parse: (raw: string) => T | null;
  readonly #serialise: (record: T) => string;

  constructor(opts: {
    fs: RawFs; root: string; policy: AttestationPolicy; protection: VerifiedStoreProtection | null;
    clock: () => string; parse: (raw: string) => T | null; serialise: (record: T) => string;
  }) {
    this.#fs = opts.fs;
    this.#policy = opts.policy;
    this.#protection = opts.protection;
    this.#clock = opts.clock;
    this.#parse = opts.parse;
    this.#serialise = opts.serialise;
    this.#fs.mkdirp(opts.root);
    this.#root = this.#fs.realpath(opts.root);
  }

  integrityStatus(): StoreIntegrityStatus { return effectiveIntegrityStatus(this.#policy, this.#protection, this.#clock()); }

  #pathFor(key: string): Outcome<string> {
    if (!KEY.test(key)) return failWith('PATH_TRAVERSAL_BLOCKED', 'invalid record key');
    const candidate = `${this.#root}/${key}.json`;
    // Resolve the parent dir (the file may not exist yet) and confirm it is the canonical root.
    const parent = this.#fs.realpath(this.#root);
    if (parent !== this.#root) return failWith('INVALID_STORE_ROOT', 'root is not canonical');
    if (!candidate.startsWith(`${this.#root}/`)) return failWith('PATH_TRAVERSAL_BLOCKED', 'path escapes trust root');
    return succeed(candidate);
  }

  #writable(): Outcome<true> {
    const s = this.integrityStatus();
    if (this.#policy === 'test') return s === 'TEST_ISOLATED' ? succeed(true) : failWith('STORE_PROTECTION_INVALID', 'test store not isolated');
    if (s !== 'PRODUCTION_PROTECTION_READY') return failWith('STORE_PROTECTION_REQUIRED', 'production store not protection-ready');
    return succeed(true);
  }

  create(key: string, record: T): Outcome<T> {
    const w = this.#writable(); if (!w.ok) return w;
    const p = this.#pathFor(key); if (!p.ok) return p;
    if (this.#fs.exists(p.value)) return failWith('CREDENTIAL_ALREADY_EXISTS', 'record already exists');
    return this.#atomicWrite(p.value, record);
  }

  get(key: string): T | null {
    const p = this.#pathFor(key); if (!p.ok) return null;
    const raw = this.#fs.readFile(p.value);
    if (raw === null) return null;
    return this.#parse(raw);
  }

  list(): readonly T[] {
    const out: T[] = [];
    for (const name of this.#fs.readdir(this.#root)) {
      if (!name.endsWith('.json')) continue;
      const raw = this.#fs.readFile(`${this.#root}/${name}`);
      const rec = raw === null ? null : this.#parse(raw);
      if (rec !== null) out.push(rec);
    }
    return out;
  }

  update(key: string, expectedRevision: number, next: T): Outcome<T> {
    const w = this.#writable(); if (!w.ok) return w;
    const p = this.#pathFor(key); if (!p.ok) return p;
    const raw = this.#fs.readFile(p.value);
    if (raw === null) return failWith('CREDENTIAL_NOT_FOUND', 'record not found');
    const cur = this.#parse(raw);
    if (cur === null) return failWith('MALFORMED_RECORD', 'persisted record is malformed');
    if (revOf(cur) !== expectedRevision) return failWith('STALE_REVISION', 'revision mismatch');
    return this.#atomicWrite(p.value, next);
  }

  #atomicWrite(finalPath: string, record: T): Outcome<T> {
    try {
      const tmp = `${finalPath}.tmp-${revOf(record)}`;
      const serialised = this.#serialise(record);
      // Validate round-trip BEFORE committing so a partial/garbled record can never be finalised.
      if (this.#parse(serialised) === null) return failWith('MALFORMED_RECORD', 'record failed pre-write validation');
      this.#fs.writeFile(tmp, serialised);
      this.#fs.rename(tmp, finalPath);
      const back = this.#fs.readFile(finalPath);
      if (back === null || this.#parse(back) === null) return failWith('PERSISTENCE_FAILURE', 'post-write validation failed');
      return succeed(record);
    } catch {
      return failWith('PERSISTENCE_FAILURE', 'atomic write failed');
    }
  }
}
