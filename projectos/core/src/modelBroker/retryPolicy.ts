// Origin: original ProjectOS code
/**
 * The retry rules a model call lives under, wrapped round the ported retry runner.
 *
 * THE FLOOR AND THE CAP ARE NOT THE CALLER'S TO LOWER. A caller may ask for a longer wait or fewer attempts and gets
 * them; a request for no wait, a negative or NaN delay, or 99 attempts gets the floor and the cap. A provider that
 * says "retry in 0 ms" is held to the floor as well. This closes the carry the connector contract recorded: "no
 * backoff floor, a rate-limited key may retry as soon as a caller asks".
 *
 * THE COUNT BELONGS TO THE STORE. The attempts a key has used are held by an `AttemptStore`, and the caller hands in
 * no history at all, so a caller passing an empty one has nothing to reset. A later phase backs the store with the
 * connector contract's attempt history; the in-memory one here is the test double.
 */

import { CONNECTOR_MAX_ATTEMPTS } from '../connectorContract.js';
import { createRetryRunner, resolveRetryConfig, type RetryConfig } from './retry.js';

/** The shortest wait between two attempts. */
export const BACKOFF_FLOOR_MS = 1_000;
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
    attempts: Math.min(merged.attempts, MAX_MODEL_ATTEMPTS),
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

export interface AttemptStore {
  /** Count one more attempt under this key and answer the new count. */
  begin(key: string): Promise<number>;
  count(key: string): Promise<number>;
}

export function createMemoryAttemptStore(): AttemptStore {
  const counts = new Map<string, number>();
  const checked = (key: string): string => {
    if (!isModelIdempotencyKey(key)) throw new Error('that is not an idempotency key');
    return key;
  };
  return {
    begin: async (key) => {
      const next = (counts.get(checked(key)) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    count: async (key) => counts.get(checked(key)) ?? 0,
  };
}
