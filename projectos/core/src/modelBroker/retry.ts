// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: packages/retry/src/index.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: DIRECT
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: only the retry runner and its config are taken; the abort, timeout and supervisor helpers are cut, the numeric-attempts form is cut because it had no minimum delay, and sleep and random are injected with no default timer
// Notice: full licence text in THIRD_PARTY_NOTICES

const MAX_TIMER_TIMEOUT_MS = 2_147_000_000;

export type RetryConfig = {
  attempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Fractional symmetric spread or full jitter. */
  jitter?: number | 'full';
};

type RetryDelayContext = {
  attempt: number;
  maxAttempts: number;
  err: unknown;
  label?: string;
};

export type RetryInfo = RetryDelayContext & {
  delayMs: number;
};

export type RetryOptions = RetryConfig & {
  label?: string;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  retryAfterMs?: (err: unknown) => number | undefined;
  retryAfterMaxDelayMs?: number;
  delayMs?: number | ((context: RetryDelayContext) => number);
  onRetry?: (info: RetryInfo) => unknown;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type RetryRuntime = {
  shouldRetry?: (err: unknown) => boolean;
  /** Required: this module holds no timer. */
  sleep: (ms: number) => Promise<void>;
  /** Required: this module holds no random source. */
  random: () => number;
  createFailure?: (attemptErrors: readonly unknown[]) => Error;
};

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  attempts: 3,
  minDelayMs: 300,
  maxDelayMs: 30_000,
  jitter: 0,
};

function clampNumber(value: unknown, fallback: number, min?: number, max?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min ?? Number.NEGATIVE_INFINITY), max ?? Number.POSITIVE_INFINITY);
}

export function resolveRetryDelayMs(value: number): number {
  const finite = value === Number.POSITIVE_INFINITY ? MAX_TIMER_TIMEOUT_MS : Number.isFinite(value) ? value : 0;
  return Math.min(Math.max(Math.round(finite), 0), MAX_TIMER_TIMEOUT_MS);
}

export function resolveRetryConfig(
  defaults: Required<RetryConfig> = DEFAULT_RETRY_CONFIG,
  overrides?: RetryConfig,
): Required<RetryConfig> {
  const attempts = Math.max(1, Math.round(clampNumber(overrides?.attempts, defaults.attempts)));
  const minDelayMs = resolveRetryDelayMs(clampNumber(overrides?.minDelayMs, defaults.minDelayMs, 0));
  const maxDelayMs = Math.max(minDelayMs, resolveRetryDelayMs(clampNumber(overrides?.maxDelayMs, defaults.maxDelayMs, 0)));
  const jitter = overrides?.jitter;
  const fallbackJitter = defaults.jitter;
  return {
    attempts,
    minDelayMs,
    maxDelayMs,
    jitter:
      jitter === 'full'
        ? jitter
        : typeof jitter === 'number' && Number.isFinite(jitter)
          ? Math.min(Math.max(jitter, 0), 1)
          : fallbackJitter,
  };
}

type JitterMode = 'symmetric' | 'positive';

function applyJitter(delayMs: number, jitter: number | 'full', mode: JitterMode, random: () => number): number {
  if (jitter === 'full') {
    if (mode === 'symmetric') {
      // Over-cap Retry-After cannot be honored. Spread downward instead of
      // letting the final cap collapse every client onto the same instant.
      return Math.max(0, Math.round(delayMs * (0.5 + random() * 0.5)));
    }
    return Math.max(0, Math.ceil(delayMs * (1 + random())));
  }
  if (jitter <= 0) {
    return mode === 'positive' ? Math.ceil(delayMs) : delayMs;
  }
  const fraction = random();
  const offset = mode === 'positive' ? fraction * jitter : (fraction * 2 - 1) * jitter;
  const raw = delayMs * (1 + offset);
  // Retry-After is a lower bound. Positive jitter must round upward or a
  // fractional server hint can be undercut even with a zero random draw.
  return Math.max(0, mode === 'positive' ? Math.ceil(raw) : Math.round(raw));
}

export function toRetryError(value: unknown, fallbackMessage = 'Non-Error thrown'): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  const error = new Error(fallbackMessage, { cause: value });
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
    Object.assign(error, value);
  }
  return error;
}

export function createRetryRunner(runtime: RetryRuntime) {
  const runtimeSleep = runtime.sleep;
  const runtimeRandom = runtime.random;
  const createFailure =
    runtime.createFailure ?? ((errors: readonly unknown[]) => toRetryError(errors.at(-1) ?? new Error('Retry failed')));

  return async function retryAsync<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const attemptErrors: unknown[] = [];
    const resolved = resolveRetryConfig(DEFAULT_RETRY_CONFIG, options);
    const maxAttempts = resolved.attempts;
    const minDelayMs = resolved.minDelayMs;
    const maxDelayMs = resolved.maxDelayMs > 0 ? resolved.maxDelayMs : Number.POSITIVE_INFINITY;
    const retryAfterMaxDelayMs =
      options.retryAfterMaxDelayMs === undefined
        ? maxDelayMs
        : Math.max(minDelayMs, resolveRetryDelayMs(clampNumber(options.retryAfterMaxDelayMs, maxDelayMs, 0)));
    const random = options.random ?? runtimeRandom;
    const sleep = options.sleep ?? runtimeSleep;
    const shouldRetry = options.shouldRetry ?? (() => true);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        attemptErrors.push(err);
        if (attempt >= maxAttempts || runtime.shouldRetry?.(err) === false || !shouldRetry(err, attempt)) {
          break;
        }

        const context: RetryDelayContext = {
          attempt,
          maxAttempts,
          err,
          ...(options.label === undefined ? {} : { label: options.label }),
        };
        const retryAfterMs = options.retryAfterMs?.(err);
        const hasRetryAfter = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs);
        const configuredDelay = typeof options.delayMs === 'function' ? options.delayMs(context) : options.delayMs;
        const resolvedConfiguredDelay = configuredDelay === undefined ? undefined : resolveRetryDelayMs(configuredDelay);
        const baseDelay = hasRetryAfter
          ? Math.max(retryAfterMs, minDelayMs)
          : resolvedConfiguredDelay === undefined
            ? minDelayMs * 2 ** (attempt - 1)
            : Math.max(resolvedConfiguredDelay, minDelayMs);
        const delayCap = hasRetryAfter ? retryAfterMaxDelayMs : maxDelayMs;
        let delay = Math.min(baseDelay, delayCap);

        // Honorable Retry-After hints use positive jitter. Only an over-cap,
        // already-unsatisfiable hint may spread downward to avoid lockstep.
        const canHonorRetryAfter = hasRetryAfter && (retryAfterMs ?? 0) <= delayCap;
        const wantsPositiveDraw = resolved.jitter === 'full' ? !hasRetryAfter || canHonorRetryAfter : canHonorRetryAfter;
        delay = applyJitter(delay, resolved.jitter, wantsPositiveDraw ? 'positive' : 'symmetric', random);
        delay = Math.min(Math.max(delay, minDelayMs), delayCap);

        await options.onRetry?.({ ...context, delayMs: delay });
        if (delay > 0) {
          await sleep(delay);
        }
      }
    }

    throw createFailure(attemptErrors);
  };
}
