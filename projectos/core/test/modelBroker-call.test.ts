import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '../src/index.js';
import {
  BACKOFF_FLOOR_MS,
  MAX_MODEL_ATTEMPTS,
  MODEL_CALL_CLASS,
  ModelCallError,
  NO_COOLDOWNS,
  callModel,
  createCooldownBook,
  createMemoryAttemptStore,
  createProviderRegistry,
  parseCommittedPricing,
  type ModelBrokerDeps,
  type ModelCallRequest,
  type ModelTransport,
  type ModelTransportResult,
} from '../src/modelBroker/index.js';

const KEY = `sha256:${'c'.repeat(64)}`;
const priced = (provider: string, model: string) => ({ provider, model, input: 1, output: 2, source: 's', pricedAt: '2026-11-01' });

interface Rig {
  readonly deps: ModelBrokerDeps;
  readonly calls: { provider: string; model: string }[];
  readonly sleeps: number[];
  readonly records: LedgerEntry[];
  readonly clock: { now: number };
}

const OK: ModelTransportResult = { text: 'hello', stopReason: 'stop', usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 } };

function rig(transport: (provider: string, model: string, n: number) => Promise<ModelTransportResult>, overrides: Partial<ModelBrokerDeps> = {}): Rig {
  const calls: { provider: string; model: string }[] = [];
  const sleeps: number[] = [];
  const records: LedgerEntry[] = [];
  const clock = { now: 10_000 };
  const registry = createProviderRegistry([
    { name: 'primary', kind: 'hosted', api: 'openai-completions' },
    { name: 'backup', kind: 'hosted', api: 'anthropic-messages' },
  ]);
  const parsed = parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: [priced('primary', 'big'), priced('backup', 'small')] }), commit: 'd'.repeat(40) });
  if (!registry.ok || !parsed.ok) throw new Error('rig');
  const send: ModelTransport = async (route) => {
    calls.push({ provider: route.provider, model: route.model });
    return transport(route.provider, route.model, calls.length);
  };
  const deps: ModelBrokerDeps = {
    registry: registry.registry,
    pricing: parsed.table,
    transport: send,
    grant: () => true,
    attempts: createMemoryAttemptStore(),
    cooldowns: createCooldownBook(),
    clock: () => clock.now,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0,
    record: (entry) => void records.push(entry),
    ...overrides,
  };
  return { deps, calls, sleeps, records, clock };
}

const request = (extra: Record<string, unknown> = {}): ModelCallRequest =>
  ({
    idempotencyKey: KEY,
    requestId: 'req-1',
    project: 'alpha-project',
    phaseId: 'PHASE-1',
    chain: [{ provider: 'primary', model: 'big' }, { provider: 'backup', model: 'small' }],
    prompt: 'say hello',
    estimatedInputTokens: 1000,
    maxOutputTokens: 500,
    budget: { maxMicroUsd: 1_000_000 },
    ...extra,
  }) as ModelCallRequest;

const rateLimited = (retryAfterMs?: number) => new ModelCallError('rate_limit', 'slow down', retryAfterMs === undefined ? {} : { retryAfterMs });

describe('every call is P3 and has a budget', () => {
  it('is a P3 call', () => {
    expect(MODEL_CALL_CLASS).toBe('P3');
  });

  it('a call goes through with a budget: the positive control', async () => {
    const r = rig(async () => OK);
    const out = await callModel(request(), r.deps);
    expect(out.ok).toBe(true);
    expect(r.calls).toHaveLength(1);
  });

  it('refuses a call with no budget, a zero budget, or a budget that is not a whole positive number, before the transport', async () => {
    const bad: unknown[] = [undefined, null, {}, { maxMicroUsd: 0 }, { maxMicroUsd: -1 }, { maxMicroUsd: 1.5 }, { maxMicroUsd: Number.NaN }, { maxMicroUsd: Number.POSITIVE_INFINITY }, { maxMicroUsd: '100' }, 0, 100];
    for (const budget of bad) {
      const r = rig(async () => OK);
      const out = await callModel(request({ budget }), r.deps);
      expect(out, JSON.stringify(budget)).toMatchObject({ ok: false, refusal: { code: 'BUDGET_REQUIRED' } });
      expect(r.calls).toHaveLength(0);
    }
    const r = rig(async () => OK);
    const missing = { ...request() } as { -readonly [K in keyof ModelCallRequest]?: ModelCallRequest[K] };
    delete missing.budget;
    expect(await callModel(missing as ModelCallRequest, r.deps)).toMatchObject({ ok: false, refusal: { code: 'BUDGET_REQUIRED' } });
    expect(r.calls).toHaveLength(0);
  });

  it('refuses when no provider-spend grant answers true, and a throwing grant is not a grant', async () => {
    for (const grant of [() => false, () => undefined as unknown as boolean, () => { throw new Error('boom'); }]) {
      const r = rig(async () => OK, { grant });
      expect(await callModel(request(), r.deps)).toMatchObject({ ok: false, refusal: { code: 'NO_GRANT' } });
      expect(r.calls).toHaveLength(0);
    }
  });

  it('refuses a call whose worst case is over its budget, before the transport', async () => {
    const r = rig(async () => OK);
    const out = await callModel(request({ budget: { maxMicroUsd: 10 } }), r.deps);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'OVER_BUDGET' } });
    expect(r.calls).toHaveLength(0);
  });

  it('refuses a request that is not shaped as one: a bad key, project, token count or an empty chain', async () => {
    const bad: Record<string, unknown>[] = [{ idempotencyKey: 'x' }, { project: '../x' }, { maxOutputTokens: 0 }, { estimatedInputTokens: -1 }, { chain: [] }, { prompt: 3 }];
    for (const change of bad) {
      const r = rig(async () => OK);
      expect(await callModel(request(change), r.deps), JSON.stringify(change)).toMatchObject({ ok: false, refusal: { code: 'REQUEST_INVALID' } });
      expect(r.calls).toHaveLength(0);
    }
  });

  it('records each answered call through the ledger with the committed RateCard price', async () => {
    const r = rig(async () => OK);
    const out = await callModel(request(), r.deps);
    expect(out.ok && out.costMicroUsd).toBe(200);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({ requestId: 'req-1', projectId: 'alpha-project', phaseId: 'PHASE-1', model: 'primary/big', costMicroUsd: 200 });
  });

  it('refuses an unpriced model, and does not reach the transport', async () => {
    const r = rig(async () => OK);
    const out = await callModel(request({ chain: [{ provider: 'primary', model: 'unlisted' }] }), r.deps);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'NO_ROUTE' } });
    expect(r.calls).toHaveLength(0);
  });

  it('refuses an answer whose usage cannot be read, and keeps the worst case counted rather than recording a free call', async () => {
    const r = rig(async () => ({ ...OK, usage: { input: Number.NaN, output: -1, cacheRead: 0, cacheWrite: 0 } }));
    const out = await callModel(request(), r.deps);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'USAGE_UNREADABLE' } });
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({ costMicroUsd: 2000, unresolved: true });
  });

  it('a clock that gives no time refuses the call before the transport', async () => {
    const r = rig(async () => OK, { clock: () => Number.NaN });
    expect(await callModel(request(), r.deps)).toMatchObject({ ok: false, refusal: { code: 'REQUEST_INVALID' } });
    expect(r.calls).toHaveLength(0);
  });

  it('a ledger that refuses the record does not lose the answer, and says it was not recorded', async () => {
    const r = rig(async () => OK, { record: () => { throw new Error('disk full'); } });
    const out = await callModel(request(), r.deps);
    expect(out.ok && out.recorded).toBe(false);
    expect(out.ok && out.text).toBe('hello');
  });
});

describe('retries inside a call', () => {
  it('waits at least the floor between attempts, and stops at the cap', async () => {
    const r = rig(async () => { throw rateLimited(0); }, { retry: { attempts: 99, minDelayMs: 0, jitter: 0 } });
    const out = await callModel(request({ chain: [{ provider: 'primary', model: 'big' }] }), r.deps);
    expect(out.ok).toBe(false);
    expect(r.calls.length).toBeLessThanOrEqual(MAX_MODEL_ATTEMPTS);
    expect(r.sleeps.length).toBeGreaterThan(0);
    expect(r.sleeps.every((ms) => ms >= BACKOFF_FLOOR_MS)).toBe(true);
  });

  it('a caller passing an empty history cannot reset the count', async () => {
    const r = rig(async () => { throw new ModelCallError('upstream_unavailable', 'down'); });
    const lone = { chain: [{ provider: 'primary', model: 'big' }] };
    let total = 0;
    for (let i = 0; i < 4; i += 1) {
      await callModel(request({ ...lone, history: [], attempts: 0, attemptHistory: [], attempt: 0 }), r.deps);
      total = r.calls.length;
    }
    expect(total).toBe(MAX_MODEL_ATTEMPTS);
    const after = await callModel(request({ ...lone, history: [] }), r.deps);
    expect(after).toMatchObject({ ok: false, refusal: { code: 'ATTEMPTS_EXHAUSTED' } });
    expect(r.calls.length).toBe(MAX_MODEL_ATTEMPTS);
  });

  it('retries cannot spend past the budget: the next attempt is refused when its worst case no longer fits', async () => {
    // one attempt's worst case is 1000 * 1 + 500 * 2 = 2000 micro-USD; 5000 fits two of them
    const r = rig(async () => { throw rateLimited(); });
    const out = await callModel(request({ chain: [{ provider: 'primary', model: 'big' }], budget: { maxMicroUsd: 5000 } }), r.deps);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'OVER_BUDGET' } });
    expect(r.calls).toHaveLength(2);
  });

  it('does not retry what is not safe to repeat: an unknown failure and a refusal of the request', async () => {
    for (const failure of [new Error('socket closed after write'), new ModelCallError('invalid_request', 'bad'), new ModelCallError('authentication', 'no')]) {
      const r = rig(async () => { throw failure; });
      const out = await callModel(request(), r.deps);
      expect(out).toMatchObject({ ok: false, refusal: { code: 'CALL_FAILED' } });
      expect(r.calls).toHaveLength(1);
    }
  });
});

describe('fallback and cooldown, with an injected clock', () => {
  it('moves to the next registered provider after a rate limit, and leaves the first resting', async () => {
    const r = rig(async (provider) => {
      if (provider === 'primary') throw rateLimited();
      return OK;
    }, { retry: { attempts: 1 } });
    const out = await callModel(request(), r.deps);
    expect(out.ok && out.route.provider).toBe('backup');
    expect(r.calls.map((c) => c.provider)).toEqual(['primary', 'backup']);
    const again = await callModel(request({ idempotencyKey: `sha256:${'e'.repeat(64)}` }), r.deps);
    expect(again.ok && again.route.provider).toBe('backup');
    expect(r.calls.map((c) => c.provider)).toEqual(['primary', 'backup', 'backup']);
  });

  it('returns to the first provider once its cooldown has ended', async () => {
    let limited = true;
    const r = rig(async (provider) => {
      if (provider === 'primary' && limited) throw rateLimited();
      return OK;
    }, { retry: { attempts: 1 } });
    await callModel(request(), r.deps);
    limited = false;
    r.clock.now += 60_001;
    const out = await callModel(request({ idempotencyKey: `sha256:${'f'.repeat(64)}` }), r.deps);
    expect(out.ok && out.route.provider).toBe('primary');
  });

  it('does not fall back on a refusal of the request itself', async () => {
    const r = rig(async () => { throw new ModelCallError('invalid_request', 'bad'); });
    await callModel(request(), r.deps);
    expect(r.calls).toHaveLength(1);
  });

  it('never calls a provider that is not in the registry, even if it is named first', async () => {
    const r = rig(async () => OK);
    const out = await callModel(request({ chain: [{ provider: 'rogue', model: 'big' }, { provider: 'backup', model: 'small' }] }), r.deps);
    expect(out.ok && out.route.provider).toBe('backup');
    expect(r.calls.map((c) => c.provider)).toEqual(['backup']);
  });

  it('fails when every route is exhausted, with what each did', async () => {
    const r = rig(async () => { throw rateLimited(); }, { retry: { attempts: 1 } });
    const out = await callModel(request(), r.deps);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'NO_ROUTE' } });
    expect(r.calls.map((c) => c.provider)).toEqual(['primary', 'backup']);
  });
});

it('the cooldown book starts empty', () => {
  expect(createCooldownBook().get()).toBe(NO_COOLDOWNS);
});
