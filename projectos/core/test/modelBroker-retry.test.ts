import { describe, expect, it } from 'vitest';
import {
  AttemptStoreFull,
  BACKOFF_FLOOR_MS,
  MAX_MODEL_ATTEMPTS,
  RETRY_ATTEMPT_CEILING,
  RETRY_FLOOR_MS,
  bindingKeyOf,
  brokerRetryConfig,
  createMemoryAttemptStore,
  createRetryRunner,
  fingerprintOf,
  retryModelCall,
} from '../src/modelBroker/index.js';

const failing = (count: { n: number }) => async (): Promise<never> => {
  count.n += 1;
  throw new Error('upstream said no');
};
const recorder = (): { sleeps: number[]; sleep: (ms: number) => Promise<void> } => {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms) => void sleeps.push(ms) };
};

describe('retries never go below the backoff floor', () => {
  it('a caller asking for no delay still waits the floor: the positive control is a longer wait staying longer', async () => {
    const calls = { n: 0 };
    const { sleeps, sleep } = recorder();
    await expect(
      retryModelCall(failing(calls), { requested: { attempts: 3, minDelayMs: 0, maxDelayMs: 0, jitter: 0 }, sleep, random: () => 0 }),
    ).rejects.toThrow('upstream said no');
    expect(calls.n).toBe(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps.every((ms) => ms >= BACKOFF_FLOOR_MS)).toBe(true);
    const longer = recorder();
    await expect(
      retryModelCall(failing({ n: 0 }), { requested: { attempts: 2, minDelayMs: 5 * BACKOFF_FLOOR_MS, jitter: 0 }, sleep: longer.sleep, random: () => 0 }),
    ).rejects.toThrow();
    expect(longer.sleeps).toEqual([5 * BACKOFF_FLOOR_MS]);
  });

  it('full jitter with a zero draw does not go under the floor', async () => {
    const { sleeps, sleep } = recorder();
    await expect(
      retryModelCall(failing({ n: 0 }), { requested: { attempts: 4, jitter: 'full' }, sleep, random: () => 0 }),
    ).rejects.toThrow();
    expect(sleeps.length).toBeGreaterThan(0);
    expect(Math.min(...sleeps)).toBeGreaterThanOrEqual(BACKOFF_FLOOR_MS);
  });

  it('a provider that says retry in 0 ms is held to the floor, and one that says 20 s is honoured', async () => {
    const zero = recorder();
    await expect(
      retryModelCall(failing({ n: 0 }), { requested: { attempts: 2 }, retryAfterMs: () => 0, sleep: zero.sleep, random: () => 0 }),
    ).rejects.toThrow();
    expect(zero.sleeps).toEqual([BACKOFF_FLOOR_MS]);
    const long = recorder();
    await expect(
      retryModelCall(failing({ n: 0 }), { requested: { attempts: 2 }, retryAfterMs: () => 20_000, sleep: long.sleep, random: () => 0 }),
    ).rejects.toThrow();
    expect(long.sleeps).toEqual([20_000]);
  });

  it('a NaN or negative request falls back to the floor rather than to no wait', () => {
    expect(brokerRetryConfig({ minDelayMs: Number.NaN }).minDelayMs).toBe(BACKOFF_FLOOR_MS);
    expect(brokerRetryConfig({ minDelayMs: -5 }).minDelayMs).toBe(BACKOFF_FLOOR_MS);
  });
});

describe('retries stop at the attempt cap', () => {
  it('a caller asking for 99 attempts gets the cap', async () => {
    const calls = { n: 0 };
    const { sleep } = recorder();
    await expect(retryModelCall(failing(calls), { requested: { attempts: 99 }, sleep, random: () => 0 })).rejects.toThrow();
    expect(calls.n).toBe(MAX_MODEL_ATTEMPTS);
  });

  it('a decision not to retry stops at once', async () => {
    const calls = { n: 0 };
    await expect(retryModelCall(failing(calls), { shouldRetry: () => false, sleep: async () => undefined })).rejects.toThrow();
    expect(calls.n).toBe(1);
  });

  it('a success returns its value and sleeps no more', async () => {
    const { sleeps, sleep } = recorder();
    let n = 0;
    const value = await retryModelCall(async () => (++n < 2 ? Promise.reject(new Error('once')) : 'fine'), { sleep, random: () => 0 });
    expect(value).toBe('fine');
    expect(sleeps).toHaveLength(1);
  });
});

describe('the raw runner holds the floor and the ceiling itself', () => {
  it('the exported runner, given no minimum, a zero maximum and 99 attempts, still waits the floor and stops at the ceiling', async () => {
    const { sleeps, sleep } = recorder();
    let n = 0;
    const retry = createRetryRunner({ sleep, random: () => 0 });
    await expect(retry(async () => { n += 1; throw new Error('x'); }, { attempts: 99, minDelayMs: 0, maxDelayMs: 0, jitter: 0 })).rejects.toThrow();
    expect(n).toBe(RETRY_ATTEMPT_CEILING);
    expect(sleeps).toHaveLength(RETRY_ATTEMPT_CEILING - 1);
    expect(sleeps.every((ms) => ms >= RETRY_FLOOR_MS)).toBe(true);
    expect(RETRY_FLOOR_MS).toBe(BACKOFF_FLOOR_MS);
    expect(RETRY_ATTEMPT_CEILING).toBe(MAX_MODEL_ATTEMPTS);
  });

  it('a default config does not go below the floor either', async () => {
    const { sleeps, sleep } = recorder();
    await expect(createRetryRunner({ sleep, random: () => 0 })(async () => { throw new Error('x'); })).rejects.toThrow();
    expect(sleeps.every((ms) => ms >= RETRY_FLOOR_MS)).toBe(true);
  });

  it('a random source that answers NaN never skips the sleep: the wait is finite and at least the floor', async () => {
    for (const jitter of ['full', 0.5] as const) {
      const { sleeps, sleep } = recorder();
      await expect(createRetryRunner({ sleep, random: () => Number.NaN })(async () => { throw new Error('x'); }, { attempts: 3, jitter })).rejects.toThrow();
      expect(sleeps).toHaveLength(2);
      expect(sleeps.every((ms) => Number.isFinite(ms) && ms >= RETRY_FLOOR_MS)).toBe(true);
    }
  });
});

describe('the attempt count belongs to the store, not to the caller', () => {
  const scope = { tenant: 'acme-co', project: 'alpha-project' };
  const keyOf = (requestId: string) => bindingKeyOf({ ...scope, requestId, prompt: 'p' });
  const FP = 'fingerprint-1';

  it('counts per key, and a second key starts from one', async () => {
    const store = createMemoryAttemptStore();
    expect(await store.begin(scope, keyOf('a'), FP)).toBe(1);
    expect(await store.begin(scope, keyOf('a'), FP)).toBe(2);
    expect(await store.begin(scope, keyOf('b'), FP)).toBe(1);
    expect(await store.count(scope, keyOf('a'))).toBe(2);
  });

  it('counts per tenant and project: the same key under another scope is a fresh count', async () => {
    const store = createMemoryAttemptStore();
    await store.begin(scope, keyOf('a'), FP);
    expect(await store.begin({ tenant: 'other-co', project: 'alpha-project' }, keyOf('a'), FP)).toBe(1);
    expect(await store.begin({ tenant: 'acme-co', project: 'beta-project' }, keyOf('a'), FP)).toBe(1);
  });

  it('refuses a key that is not a key, so an odd spelling cannot open a fresh count', async () => {
    const store = createMemoryAttemptStore();
    await expect(store.begin(scope, '', FP)).rejects.toThrow('idempotency key');
    await expect(store.begin(scope, `SHA256:${'a'.repeat(64)}`, FP)).rejects.toThrow('idempotency key');
  });

  it('is bounded per tenant and project by refusing new keys, never by forgetting one: an exhausted key keeps its count', async () => {
    const store = createMemoryAttemptStore({ maxKeysPerScope: 2 });
    for (let i = 0; i < 5; i += 1) await store.begin(scope, keyOf('a'), FP);
    await store.begin(scope, keyOf('b'), FP);
    await expect(store.begin(scope, keyOf('c'), FP)).rejects.toBeInstanceOf(AttemptStoreFull);
    expect(await store.count(scope, keyOf('a'))).toBe(5);
    expect(await store.begin(scope, keyOf('a'), FP)).toBe(6);
    expect(await store.begin({ tenant: 'other-co', project: 'alpha-project' }, keyOf('c'), FP)).toBe(1);
  });

  it('remembers a completed outcome with its fingerprint per scope and key, and answers nothing for another', async () => {
    const store = createMemoryAttemptStore();
    const done = { text: 'hi' } as never;
    await store.begin(scope, keyOf('a'), FP);
    await store.remember(scope, keyOf('a'), FP, done);
    expect(await store.recall(scope, keyOf('a'))).toEqual({ fingerprint: FP, count: 1, outcome: done });
    expect(await store.recall({ tenant: 'other-co', project: 'alpha-project' }, keyOf('a'))).toBeNull();
    expect(await store.recall(scope, keyOf('b'))).toBeNull();
  });

  it('keeps the fingerprint of the first attempt, so a later request with other terms can be told apart', async () => {
    const store = createMemoryAttemptStore();
    await store.begin(scope, keyOf('a'), FP);
    await store.begin(scope, keyOf('a'), 'another');
    expect((await store.recall(scope, keyOf('a')))?.fingerprint).toBe(FP);
  });
});

describe('the request fingerprint covers what the key does not', () => {
  const base = { chain: [{ provider: 'a', model: 'm' }], maxOutputTokens: 10, phaseId: 'P', budget: { maxMicroUsd: 100 } };

  it('moves with the chain, the output cap, the phase and the budget ceiling, and not otherwise', () => {
    const fp = fingerprintOf(base);
    expect(fingerprintOf({ ...base })).toBe(fp);
    for (const change of [{ chain: [{ provider: 'b', model: 'm' }] }, { chain: [{ provider: 'a', model: 'n' }] }, { maxOutputTokens: 11 }, { phaseId: 'Q' }, { budget: { maxMicroUsd: 101 } }]) {
      expect(fingerprintOf({ ...base, ...change })).not.toBe(fp);
    }
  });
});

describe('the key is bound to tenant, project, request and prompt', () => {
  const base = { tenant: 'acme-co', project: 'alpha-project', requestId: 'r', prompt: 'p' };

  it('is deterministic, shaped sha256:<64 hex>, and moves with each part', () => {
    const key = bindingKeyOf(base);
    expect(key).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(bindingKeyOf({ ...base })).toBe(key);
    for (const change of [{ tenant: 'other-co' }, { project: 'beta-project' }, { requestId: 'r2' }, { prompt: 'p2' }]) {
      expect(bindingKeyOf({ ...base, ...change })).not.toBe(key);
    }
  });

  it('cannot be confused across a field boundary', () => {
    expect(bindingKeyOf({ ...base, project: 'a', requestId: 'bc' })).not.toBe(bindingKeyOf({ ...base, project: 'ab', requestId: 'c' }));
  });
});
