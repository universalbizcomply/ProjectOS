// Origin: original ProjectOS code
/**
 * The retry rules a model call lives under, wrapped round the ported retry runner.
 *
 * THE FLOOR AND THE CAP ARE NOT THE CALLER'S TO LOWER. A caller may ask for a longer wait or fewer attempts and gets
 * them; a request for no wait, a negative or NaN delay, or 99 attempts gets the floor and the cap. A provider that
 * says "retry in 0 ms" is held to the floor as well. The raw runner holds them too, so using it directly is no way
 * round them. This closes the carry the connector contract recorded: "no backoff floor, a rate-limited key may retry
 * as soon as a caller asks".
 *
 * THE COUNT BELONGS TO THE STORE, AND THE STORE BELONGS TO A TENANT AND A PROJECT. The attempts a key has used are
 * held by an `AttemptStore` under that scope, and the caller hands in no history at all, so a caller passing an empty
 * one has nothing to reset. The store also remembers a completed outcome per key, so a repeat of a finished request
 * is answered from memory and does not reach the transport again. A later phase backs the store with the connector
 * contract's attempt history; the in-memory one here is the test double. It is bounded per tenant and project by
 * refusing NEW keys, never by forgetting one: an exhausted or unknown-outcome key keeps its count.
 */

import { CONNECTOR_MAX_ATTEMPTS } from '../connectorContract.js';
import { RETRY_ATTEMPT_CEILING, RETRY_FLOOR_MS, createRetryRunner, resolveRetryConfig, type RetryConfig } from './retry.js';

/** The shortest wait between two attempts. */
export const BACKOFF_FLOOR_MS = RETRY_FLOOR_MS;
/** No wait is asked to be longer than this. */
export const BACKOFF_CEILING_MS = 300_000;
/** The most attempts one idempotency key may ever use, across retries, providers and calls. */
export const MAX_MODEL_ATTEMPTS = CONNECTOR_MAX_ATTEMPTS;

const BROKER_DEFAULTS: Required<RetryConfig> = { attempts: 3, minDelayMs: BACKOFF_FLOOR_MS, maxDelayMs: 30_000, jitter: 0 };

/** The retry config a request may have: its own values, held between the floor and the ceiling, and under the cap. */
export function brokerRetryConfig(requested?: RetryConfig): Required<RetryConfig> {
  const merged = resolveRetryConfig(BROKER_DEFAULTS, requested);
  const minDelayMs = Math.min(Math.max(merged.minDelayMs, BACKOFF_FLOOR_MS), BACKOFF_CEILING_MS);
  return {
    attempts: Math.min(merged.attempts, MAX_MODEL_ATTEMPTS, RETRY_ATTEMPT_CEILING),
    minDelayMs,
    maxDelayMs: Math.min(Math.max(merged.maxDelayMs, minDelayMs), BACKOFF_CEILING_MS),
    jitter: merged.jitter,
  };
}

export interface ModelRetryOptions {
  readonly requested?: RetryConfig;
  readonly shouldRetry?: (err: unknown, attempt: number) => boolean;
  readonly retryAfterMs?: (err: unknown) => number | undefined;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

/** Run `fn` with retries under the floor and the cap. Sleep and random are injected: there is no timer here. */
export function retryModelCall<T>(fn: () => Promise<T>, options: ModelRetryOptions): Promise<T> {
  const runner = createRetryRunner({ sleep: options.sleep, random: options.random ?? (() => 0.5) });
  return runner(fn, {
    ...brokerRetryConfig(options.requested),
    ...(options.shouldRetry === undefined ? {} : { shouldRetry: options.shouldRetry }),
    ...(options.retryAfterMs === undefined ? {} : { retryAfterMs: options.retryAfterMs }),
  });
}

const IDEMPOTENCY_KEY = /^sha256:[0-9a-f]{64}$/;
export const isModelIdempotencyKey = (value: unknown): value is string => typeof value === 'string' && IDEMPOTENCY_KEY.test(value);

/** Whose attempts these are. A key is only ever counted under the tenant and project that made it. */
export interface AttemptScope {
  readonly tenant: string;
  readonly project: string;
}

/** What the store holds for one key. */
export interface StoredRequest {
  /** The terms of the first attempt (`fingerprintOf`): the chain, output cap, phase and budget ceiling. */
  readonly fingerprint: string;
  readonly count: number;
  /** The outcome this key completed with, or null while it has none. */
  readonly outcome: unknown | null;
}

export interface AttemptStore {
  /** Count one more attempt under this scope and key, and answer the new count. The first call fixes the fingerprint. */
  begin(scope: AttemptScope, key: string, fingerprint: string): Promise<number>;
  count(scope: AttemptScope, key: string): Promise<number>;
  recall(scope: AttemptScope, key: string): Promise<StoredRequest | null>;
  remember(scope: AttemptScope, key: string, fingerprint: string, outcome: unknown): Promise<void>;
}

/** The store will not take a new key: this tenant and project already hold as many as it keeps. */
export class AttemptStoreFull extends Error {}

/** Per tenant and project. Past it a NEW key is refused: no key is ever forgotten, so an exhausted one stays exhausted. */
export const DEFAULT_ATTEMPT_STORE_KEYS = 4096;

export function createMemoryAttemptStore(options: { readonly maxKeysPerScope?: number } = {}): AttemptStore {
  const maxKeys = Number.isSafeInteger(options.maxKeysPerScope) && (options.maxKeysPerScope as number) >= 1 ? (options.maxKeysPerScope as number) : DEFAULT_ATTEMPT_STORE_KEYS;
  const entries = new Map<string, StoredRequest>();
  const perScope = new Map<string, number>();
  const scopeOf = (scope: AttemptScope): string => `${scope.tenant}/${scope.project}`;
  const slot = (scope: AttemptScope, key: string): string => {
    if (!isModelIdempotencyKey(key)) throw new Error('that is not an idempotency key');
    return `${scopeOf(scope)}/${key}`;
  };
  /** A new key is counted against its tenant and project, and refused past the bound. */
  const admit = (scope: AttemptScope, at: string): void => {
    if (entries.has(at)) return;
    const held = perScope.get(scopeOf(scope)) ?? 0;
    if (held >= maxKeys) throw new AttemptStoreFull('this tenant and project hold as many request keys as the store keeps');
    perScope.set(scopeOf(scope), held + 1);
  };
  return {
    begin: async (scope, key, fingerprint) => {
      const at = slot(scope, key);
      admit(scope, at);
      const held = entries.get(at);
      entries.set(at, { fingerprint: held?.fingerprint ?? fingerprint, count: (held?.count ?? 0) + 1, outcome: held?.outcome ?? null });
      return (held?.count ?? 0) + 1;
    },
    count: async (scope, key) => entries.get(slot(scope, key))?.count ?? 0,
    recall: async (scope, key) => entries.get(slot(scope, key)) ?? null,
    remember: async (scope, key, fingerprint, outcome) => {
      const at = slot(scope, key);
      admit(scope, at);
      const held = entries.get(at);
      entries.set(at, { fingerprint: held?.fingerprint ?? fingerprint, count: held?.count ?? 0, outcome });
    },
  };
}
