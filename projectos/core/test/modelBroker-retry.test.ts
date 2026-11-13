import { describe, expect, it } from 'vitest';
import {
  BACKOFF_FLOOR_MS,
  MAX_MODEL_ATTEMPTS,
  brokerRetryConfig,
  createMemoryAttemptStore,
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

describe('the attempt count belongs to the store, not to the caller', () => {
  it('counts per key, and a second key starts from one', async () => {
    const store = createMemoryAttemptStore();
    const a = `sha256:${'a'.repeat(64)}`;
    const b = `sha256:${'b'.repeat(64)}`;
    expect(await store.begin(a)).toBe(1);
    expect(await store.begin(a)).toBe(2);
    expect(await store.begin(b)).toBe(1);
    expect(await store.count(a)).toBe(2);
  });

  it('refuses a key that is not a key, so an odd spelling cannot open a fresh count', async () => {
    const store = createMemoryAttemptStore();
    await expect(store.begin('')).rejects.toThrow('idempotency key');
    await expect(store.begin(`SHA256:${'a'.repeat(64)}`)).rejects.toThrow('idempotency key');
  });
});
