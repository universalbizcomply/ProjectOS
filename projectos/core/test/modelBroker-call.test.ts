import { describe, expect, it } from 'vitest';
import type { LedgerEntry } from '../src/index.js';
import {
  BACKOFF_FLOOR_MS,
  MAX_MODEL_ATTEMPTS,
  MODEL_CALL_CLASS,
  ModelCallError,
  NO_COOLDOWNS,
  armCooldown,
  bindingKeyOf,
  callModel,
  createCooldownBook,
  createMemoryAttemptStore,
  createProviderRegistry,
  parseCommittedPricing,
  type AttemptRecord,
  type ModelBrokerDeps,
  type ModelCallRequest,
  type ModelTransport,
  type ModelTransportRequest,
  type ModelTransportResult,
} from '../src/modelBroker/index.js';

const priced = (provider: string, model: string) => ({ provider, model, input: 1, output: 2, source: 's', pricedAt: '2026-11-01' });
const SCOPE = { tenant: 'acme-co', project: 'alpha-project' };

interface Rig {
  readonly deps: ModelBrokerDeps;
  readonly calls: { provider: string; model: string }[];
  readonly sent: ModelTransportRequest[];
  readonly sleeps: number[];
  readonly records: LedgerEntry[];
  readonly attempts: AttemptRecord[];
  readonly clock: { now: number };
}

const OK: ModelTransportResult = { text: 'hello', stopReason: 'stop', usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 } };

function rig(transport: (provider: string, model: string, n: number) => Promise<ModelTransportResult>, overrides: Partial<ModelBrokerDeps> = {}): Rig {
  const calls: { provider: string; model: string }[] = [];
  const sent: ModelTransportRequest[] = [];
  const sleeps: number[] = [];
  const records: LedgerEntry[] = [];
  const attempts: AttemptRecord[] = [];
  const clock = { now: 10_000 };
  const registry = createProviderRegistry([
    { name: 'primary', kind: 'hosted', api: 'openai-completions' },
    { name: 'backup', kind: 'hosted', api: 'anthropic-messages' },
  ]);
  const parsed = parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: [priced('primary', 'big'), priced('backup', 'small')] }), commit: 'd'.repeat(40) });
  if (!registry.ok || !parsed.ok) throw new Error('rig');
  const send: ModelTransport = async (route) => {
    calls.push({ provider: route.provider, model: route.model });
    sent.push(route);
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
    recordAttempt: (detail) => void attempts.push(detail),
    ...overrides,
  };
  return { deps, calls, sent, sleeps, records, attempts, clock };
}

/** A request whose key is the one the broker binds; vary `requestId` for a fresh logical request. */
const request = (extra: Record<string, unknown> = {}): ModelCallRequest => {
  const base = {
    tenant: SCOPE.tenant,
    requestId: 'req-1',
    project: SCOPE.project,
    phaseId: 'PHASE-1',
    chain: [{ provider: 'primary', model: 'big' }, { provider: 'backup', model: 'small' }],
    prompt: 'say hello',
    estimatedInputTokens: 1000,
    maxOutputTokens: 500,
    budget: { maxMicroUsd: 1_000_000 },
    ...extra,
  };
  return { ...base, idempotencyKey: 'idempotencyKey' in extra ? extra['idempotencyKey'] : bindingKeyOf(base as never) } as ModelCallRequest;
};
const LONE = { chain: [{ provider: 'primary', model: 'big' }] };
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

  it('refuses a request that is not shaped as one: a bad tenant, project, token count or an empty chain', async () => {
    const bad: Record<string, unknown>[] = [{ tenant: 'NOT A TENANT' }, { project: '../x' }, { maxOutputTokens: 0 }, { estimatedInputTokens: -1 }, { chain: [] }, { prompt: 3 }];
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
    expect(out).toMatchObject({ ok: false, refusal: { code: 'USAGE_UNREADABLE', recorded: true } });
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({ costMicroUsd: 2000, unresolved: true });
  });

  it('says so when the unreadable-usage record was not taken by the ledger', async () => {
    const r = rig(async () => ({ ...OK, usage: { input: Number.NaN, output: -1, cacheRead: 0, cacheWrite: 0 } }), { record: () => { throw new Error('disk full'); } });
    expect(await callModel(request(), r.deps)).toMatchObject({ ok: false, refusal: { code: 'USAGE_UNREADABLE', recorded: false } });
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

  it('a clock that goes bad after the spend still returns the answer, dated from the start of the call', async () => {
    let reads = 0;
    const r = rig(async () => OK, { clock: () => (++reads > 2 ? Number.NaN : 10_000) });
    const out = await callModel(request(), r.deps);
    expect(out.ok).toBe(true);
    expect(r.records[0]?.at).toBe(new Date(10_000).toISOString());
  });

  it('an answer over the text cap is refused and its spend is still recorded', async () => {
    const r = rig(async () => ({ ...OK, text: 'x'.repeat(1_000_001) }));
    const out = await callModel(request(), r.deps);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'RESPONSE_INVALID' } });
    expect(r.records).toHaveLength(1);
    expect(r.records[0]?.costMicroUsd).toBe(200);
  });
});

describe('the budget is a bound: the estimate is floored from the prompt', () => {
  it('refuses a 500 KB prompt whose caller claimed zero input tokens, one output token and a budget of 1', async () => {
    const r = rig(async () => OK);
    const out = await callModel(request({ prompt: 'x'.repeat(500_000), estimatedInputTokens: 0, maxOutputTokens: 1, budget: { maxMicroUsd: 1 } }), r.deps);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'OVER_BUDGET' } });
    expect(r.calls).toHaveLength(0);
    // a budget that covers the claimed cost but not the real one is refused too: the floor is what refuses it
    const again = await callModel(request({ prompt: 'x'.repeat(500_000), estimatedInputTokens: 0, maxOutputTokens: 1, budget: { maxMicroUsd: 100 } }), r.deps);
    expect(again).toMatchObject({ ok: false, refusal: { code: 'OVER_BUDGET' } });
    expect(r.calls).toHaveLength(0);
  });

  it('a caller estimate above the floor stands, and one below it is raised to it', async () => {
    const small = rig(async () => OK);
    expect((await callModel(request({ prompt: 'hi', estimatedInputTokens: 0, maxOutputTokens: 1, budget: { maxMicroUsd: 1000 } }), small.deps)).ok).toBe(true);
    const big = rig(async () => OK);
    // 200 KB is far above 1,000 micro-USD of input at 1 USD per million, whatever the caller said
    const out = await callModel(request({ prompt: 'x'.repeat(200_000), estimatedInputTokens: 1, maxOutputTokens: 1, budget: { maxMicroUsd: 1000 } }), big.deps);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'OVER_BUDGET' } });
  });
});

describe('the key is bound, the count is scoped, and an answer is replayed', () => {
  it('refuses a key the caller made up, and one bound to a different prompt', async () => {
    const r = rig(async () => OK);
    for (const idempotencyKey of [`sha256:${'c'.repeat(64)}`, bindingKeyOf({ tenant: SCOPE.tenant, project: SCOPE.project, requestId: 'req-1', prompt: 'another prompt' })]) {
      const out = await callModel(request({ idempotencyKey }), r.deps);
      expect(out).toMatchObject({ ok: false, refusal: { code: 'REQUEST_INVALID' } });
    }
    expect(r.calls).toHaveLength(0);
  });

  it('the same request twice with a successful transport reaches the transport once and the ledger once', async () => {
    const r = rig(async () => OK);
    const first = await callModel(request(), r.deps);
    const second = await callModel(request(), r.deps);
    expect(first.ok && first.replayed).toBe(false);
    expect(second.ok && second.replayed).toBe(true);
    // a replay made no attempt and cost nothing now: what the original call did is labelled as the original's
    expect(second.ok && second.attempts).toBe(0);
    expect(second.ok && second.costMicroUsd).toBe(0);
    expect(second.ok && second.original).toMatchObject({ attempts: 1, costMicroUsd: 200, overBudget: false, recorded: true });
    expect(second.ok && second.text).toBe('hello');
    expect(r.calls).toHaveLength(1);
    expect(r.records).toHaveLength(1);
  });

  it('the attempt count belongs to a tenant and a project: another tenant starts from one', async () => {
    const r = rig(async () => { throw new ModelCallError('may_have_acted', 'timeout'); });
    for (let i = 0; i < 3; i += 1) await callModel(request({ ...LONE }), r.deps);
    const used = r.calls.length;
    expect(used).toBe(MAX_MODEL_ATTEMPTS);
    const other = await callModel(request({ ...LONE, tenant: 'other-co' }), r.deps);
    expect(other.ok).toBe(false);
    expect(r.calls.length).toBeGreaterThan(used);
    expect(await r.deps.attempts.count({ tenant: 'other-co', project: SCOPE.project }, bindingKeyOf({ tenant: 'other-co', project: SCOPE.project, requestId: 'req-1', prompt: 'say hello' }))).toBeGreaterThan(0);
  });

  it('a cooldown belongs to a tenant and a project too', async () => {
    const r = rig(async (provider) => { if (provider === 'primary') throw rateLimited(); return OK; }, { retry: { attempts: 1 } });
    await callModel(request(), r.deps);
    const mine = await callModel(request({ requestId: 'req-2' }), r.deps);
    const theirs = await callModel(request({ requestId: 'req-3', tenant: 'other-co' }), r.deps);
    expect(mine.ok && mine.route.provider).toBe('backup');
    expect(theirs.ok).toBe(true);
    expect(r.calls.map((c) => c.provider)).toEqual(['primary', 'backup', 'backup', 'primary', 'backup']);
  });
});

describe('one request at a time: concurrent calls with the same key share one call', () => {
  it('two simultaneous calls reach the transport once and the ledger once, and both get the answer', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const r = rig(async () => { await gate; return OK; });
    const req = request();
    const first = callModel(req, r.deps);
    const second = callModel(req, r.deps);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(r.calls).toHaveLength(1);
    expect(r.records).toHaveLength(1);
    expect(a.ok && a.text).toBe('hello');
    expect(b.ok && b.text).toBe('hello');
    expect([a, b].filter((o) => o.ok && o.replayed)).toHaveLength(1);
  });

  it('a waiting call is still held to the grant, and to the same terms', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let asked = 0;
    const r = rig(async () => { await gate; return OK; }, { grant: () => ++asked === 1 });
    const first = callModel(request(), r.deps);
    const second = callModel(request(), r.deps);
    const third = callModel(request({ budget: { maxMicroUsd: 900_000 } }), r.deps);
    release();
    const [a, b, c] = await Promise.all([first, second, third]);
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, refusal: { code: 'NO_GRANT' } });
    expect(c).toMatchObject({ ok: false, refusal: { code: 'IDEMPOTENCY_MISMATCH' } });
    expect(r.calls).toHaveLength(1);
  });

  it('clears its place when the call fails, so a later call is not held behind it', async () => {
    const r = rig(async () => { throw new ModelCallError('invalid_request', 'bad'); });
    await callModel(request(), r.deps);
    await callModel(request(), r.deps);
    expect(r.calls).toHaveLength(2);
  });
});

describe('a call that may have acted is never masked', () => {
  it('stays unknown after a later attempt fails safely: may_have_acted, then a rate limit, then exhaustion never falls back', async () => {
    const r = rig(async (_provider, _model, n) => { throw n === 1 ? new ModelCallError('may_have_acted', 'timeout') : rateLimited(); });
    const out = await callModel(request(), r.deps);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'OUTCOME_UNKNOWN' } });
    expect(r.calls.every((c) => c.provider === 'primary')).toBe(true);
    expect(r.calls.length).toBe(3);
    expect(r.deps.cooldowns.get(SCOPE).until.has('backup')).toBe(false);
  });

  it('reports the unknown outcome even when the attempt cap runs out next', async () => {
    const r = rig(async () => { throw new ModelCallError('may_have_acted', 'timeout'); });
    await callModel(request(LONE), r.deps);
    const second = await callModel(request(LONE), r.deps);
    expect(second).toMatchObject({ ok: false, refusal: { code: 'OUTCOME_UNKNOWN' } });
    expect(r.calls).toHaveLength(MAX_MODEL_ATTEMPTS);
  });
});

describe('the key is bound to the request, and a replay is held to the same terms', () => {
  it('refuses the same key with a different chain, output cap, phase or budget ceiling, and serves nothing', async () => {
    const r = rig(async () => OK);
    await callModel(request(), r.deps);
    for (const change of [{ chain: [{ provider: 'backup', model: 'small' }] }, { maxOutputTokens: 400 }, { phaseId: 'PHASE-2' }, { budget: { maxMicroUsd: 900_000 } }]) {
      const out = await callModel(request({ ...change, idempotencyKey: request().idempotencyKey }), r.deps);
      expect(out, JSON.stringify(change)).toMatchObject({ ok: false, refusal: { code: 'IDEMPOTENCY_MISMATCH' } });
    }
    expect(r.calls).toHaveLength(1);
  });

  it('asks for the grant before serving a replay', async () => {
    const r = rig(async () => OK);
    await callModel(request(), r.deps);
    const denied = rig(async () => OK, { attempts: r.deps.attempts, grant: () => false });
    expect(await callModel(request(), denied.deps)).toMatchObject({ ok: false, refusal: { code: 'NO_GRANT' } });
  });

  it('a request with a changed id is a new request with its own attempts, by design: the budget per call is what bounds it', async () => {
    const r = rig(async () => { throw new ModelCallError('may_have_acted', 'timeout'); });
    for (let i = 0; i < 3; i += 1) await callModel(request({ ...LONE, requestId: `req-${i}` }), r.deps);
    expect(r.calls.length).toBe(9);
  });
});

describe('the attempt store is bounded without forgetting', () => {
  it('refuses a new key when the tenant and project have too many, and an exhausted key stays exhausted', async () => {
    const r = rig(async () => { throw new ModelCallError('may_have_acted', 'timeout'); }, { attempts: createMemoryAttemptStore({ maxKeysPerScope: 2 }) });
    await callModel(request({ ...LONE, requestId: 'a' }), r.deps);
    await callModel(request({ ...LONE, requestId: 'a' }), r.deps);
    await callModel(request({ ...LONE, requestId: 'b' }), r.deps);
    const full = await callModel(request({ ...LONE, requestId: 'c' }), r.deps);
    expect(full).toMatchObject({ ok: false, refusal: { code: 'STORE_FULL' } });
    const used = r.calls.length;
    expect(await callModel(request({ ...LONE, requestId: 'a' }), r.deps)).toMatchObject({ ok: false, refusal: { code: 'ATTEMPTS_EXHAUSTED' } });
    expect(r.calls).toHaveLength(used);
  });

  it('another tenant is not held back by it', async () => {
    const r = rig(async () => OK, { attempts: createMemoryAttemptStore({ maxKeysPerScope: 1 }) });
    await callModel(request({ requestId: 'a' }), r.deps);
    expect(await callModel(request({ requestId: 'b' }), r.deps)).toMatchObject({ ok: false, refusal: { code: 'STORE_FULL' } });
    expect((await callModel(request({ requestId: 'b', tenant: 'other-co' }), r.deps)).ok).toBe(true);
  });
});

describe('a bad clock fails closed', () => {
  it('refuses before the transport when the clock stops giving a time, rather than skipping cooldowns', async () => {
    let reads = 0;
    const r = rig(async () => OK, { clock: () => (++reads > 1 ? Number.NaN : 10_000) });
    const out = await callModel(request(), r.deps);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'REQUEST_INVALID' } });
    expect(r.calls).toHaveLength(0);
  });
});

describe('an oversize answer is billed once', () => {
  it('a repeat of a request whose answer was too long is answered from memory: one transport call, one ledger record', async () => {
    const r = rig(async () => ({ ...OK, text: 'x'.repeat(1_000_001) }));
    const first = await callModel(request(), r.deps);
    const again = await callModel(request(), r.deps);
    expect(first).toMatchObject({ ok: false, refusal: { code: 'RESPONSE_INVALID' } });
    expect(again).toMatchObject({ ok: false, refusal: { code: 'RESPONSE_INVALID', replayed: true } });
    expect(r.calls).toHaveLength(1);
    expect(r.records).toHaveLength(1);
  });

  it('an xAI-looking letter run inside another word is not refused', async () => {
    const r = rig(async () => OK);
    const out = await callModel(request({ chain: [{ provider: 'primary', model: 'big' }, { provider: 'backup', model: 'relaxai-7b' }] }), r.deps);
    expect(out.ok).toBe(true);
  });
});

describe('the key reaches the transport, and a call that may have acted is not blindly repeated', () => {
  it('passes the idempotency key in every transport request', async () => {
    const r = rig(async () => OK);
    const req = request();
    await callModel(req, r.deps);
    expect(r.sent.every((s) => s.idempotencyKey === req.idempotencyKey)).toBe(true);
  });

  it('retries a call that may have acted on the same route with the same key, never falls back, and says the outcome is unknown', async () => {
    const r = rig(async () => { throw new ModelCallError('may_have_acted', 'timeout after send'); });
    const req = request();
    const out = await callModel(req, r.deps);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'OUTCOME_UNKNOWN' } });
    expect(r.calls.every((c) => c.provider === 'primary')).toBe(true);
    expect(r.calls.length).toBeGreaterThan(1);
    expect(new Set(r.sent.map((s) => s.idempotencyKey))).toEqual(new Set([req.idempotencyKey]));
    expect(r.records.length).toBeGreaterThan(0);
    expect(r.records.every((e) => e.unresolved === true && e.costMicroUsd === 2000)).toBe(true);
  });

  it('records each failed attempt with its reason and what may have been billed', async () => {
    const r = rig(async () => { throw new ModelCallError('may_have_acted', 'timeout after send'); });
    const out = await callModel(request({ ...LONE }), r.deps);
    expect(out.ok).toBe(false);
    expect(r.attempts.every((a) => a.reason === 'may_have_acted' && a.possiblySpentMicroUsd === 2000)).toBe(true);
  });
});

describe('a stop reason is part of the answer', () => {
  it('carries "length" on the success so the caller can see the answer was cut', async () => {
    const r = rig(async () => ({ ...OK, stopReason: 'length' }));
    const out = await callModel(request(), r.deps);
    expect(out.ok && out.stopReason).toBe('length');
  });

  it('treats "error" and "aborted" as failures that fall back, and neither is an ok answer', async () => {
    for (const stopReason of ['error', 'aborted'] as const) {
      const r = rig(async (provider) => (provider === 'primary' ? { ...OK, stopReason } : OK));
      const out = await callModel(request({ requestId: `req-${stopReason}` }), r.deps);
      expect(out.ok && out.route.provider).toBe('backup');
      expect(r.calls.map((c) => c.provider)).toEqual(['primary', 'backup']);
      expect(r.attempts[0]).toMatchObject({ reason: 'provider_error', possiblySpentMicroUsd: 2000 });
    }
  });

  it('does not clear a cooldown on an answer that was an error', async () => {
    const r = rig(async (provider) => (provider === 'primary' ? { ...OK, stopReason: 'error' } : OK));
    r.deps.cooldowns.set(SCOPE, armCooldown(NO_COOLDOWNS, 'primary', 'rate_limit', 0).state);
    r.clock.now = 70_000;
    const out = await callModel(request(), r.deps);
    expect(out.ok && out.route.provider).toBe('backup');
    expect(r.deps.cooldowns.get(SCOPE).levels.get('primary')).toBe(1);
  });
});

describe('retries inside a call', () => {
  it('waits at least the floor between attempts, and stops at the cap', async () => {
    const r = rig(async () => { throw rateLimited(0); }, { retry: { attempts: 99, minDelayMs: 0, jitter: 0 } });
    const out = await callModel(request({ ...LONE }), r.deps);
    expect(out.ok).toBe(false);
    expect(r.calls.length).toBeLessThanOrEqual(MAX_MODEL_ATTEMPTS);
    expect(r.sleeps.length).toBeGreaterThan(0);
    expect(r.sleeps.every((ms) => ms >= BACKOFF_FLOOR_MS)).toBe(true);
  });

  it('a caller passing an empty history cannot reset the count', async () => {
    const r = rig(async () => { throw new ModelCallError('may_have_acted', 'timeout'); });
    for (let i = 0; i < 4; i += 1) await callModel(request({ ...LONE, history: [], attempts: 0, attemptHistory: [], attempt: 0 }), r.deps);
    expect(r.calls.length).toBe(MAX_MODEL_ATTEMPTS);
    const after = await callModel(request({ ...LONE, history: [] }), r.deps);
    expect(after).toMatchObject({ ok: false, refusal: { code: 'ATTEMPTS_EXHAUSTED' } });
    expect(r.calls.length).toBe(MAX_MODEL_ATTEMPTS);
  });

  it('retries that may have been billed cannot spend past the budget: the next attempt is refused when its worst case no longer fits', async () => {
    // one attempt's worst case is 1000 * 1 + 500 * 2 = 2000 micro-USD; 5000 fits two of them
    const r = rig(async () => { throw new ModelCallError('may_have_acted', 'timeout'); });
    const out = await callModel(request({ ...LONE, budget: { maxMicroUsd: 5000 } }), r.deps);
    // the budget ran out after a call that may have acted: the unknown outcome is what the caller is told, not a safe-looking refusal
    expect(out).toMatchObject({ ok: false, refusal: { code: 'OUTCOME_UNKNOWN' } });
    expect(r.calls).toHaveLength(2);
  });

  it('a rate limit that cost nothing releases its reservation, so a cheap backup route is still tried', async () => {
    // 3000 fits one 2000 attempt; a 429 is known to be free, so the backup's 2000 fits after it
    const r = rig(async (provider) => { if (provider === 'primary') throw rateLimited(); return OK; }, { retry: { attempts: 1 } });
    const out = await callModel(request({ budget: { maxMicroUsd: 3000 } }), r.deps);
    expect(out.ok && out.route.provider).toBe('backup');
    expect(r.attempts[0]).toMatchObject({ reason: 'rate_limit', possiblySpentMicroUsd: 0 });
  });

  it('does not retry what is not safe to repeat: an unknown failure and a refusal of the request', async () => {
    for (const failure of [new Error('socket closed after write'), new ModelCallError('invalid_request', 'bad'), new ModelCallError('authentication', 'no')]) {
      const r = rig(async () => { throw failure; });
      const out = await callModel(request(), r.deps);
      expect(out).toMatchObject({ ok: false, refusal: { code: 'CALL_FAILED' } });
      expect(r.calls).toHaveLength(1);
    }
  });

  it('a Retry-After above the cap skips the retries, arms the cooldown from it, and falls back', async () => {
    const r = rig(async (provider) => { if (provider === 'primary') throw rateLimited(120_000); return OK; });
    const out = await callModel(request(), r.deps);
    expect(out.ok && out.route.provider).toBe('backup');
    expect(r.calls.map((c) => c.provider)).toEqual(['primary', 'backup']);
    expect(r.sleeps).toEqual([]);
    r.clock.now += 119_000;
    const during = await callModel(request({ requestId: 'req-2' }), r.deps);
    expect(during.ok && during.route.provider).toBe('backup');
    r.clock.now += 2_000;
    const after = await callModel(request({ requestId: 'req-3' }), r.deps);
    expect(after.ok && after.route.provider).toBe('backup');
    expect(r.calls.filter((c) => c.provider === 'primary')).toHaveLength(2);
  });

  it('an outage arms a short cooldown of its own', async () => {
    const r = rig(async (provider) => { if (provider === 'primary') throw new ModelCallError('upstream_unavailable', 'down'); return OK; }, { retry: { attempts: 1 } });
    await callModel(request(), r.deps);
    const during = await callModel(request({ requestId: 'req-2' }), r.deps);
    expect(during.ok && during.route.provider).toBe('backup');
    expect(r.calls.map((c) => c.provider)).toEqual(['primary', 'backup', 'backup']);
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
    const again = await callModel(request({ requestId: 'req-2' }), r.deps);
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
    const out = await callModel(request({ requestId: 'req-2' }), r.deps);
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
    const failures = out.ok ? [] : out.refusal.failures ?? [];
    expect(failures.map((f) => [f.provider, f.reason, f.attempts])).toEqual([['primary', 'rate_limit', 1], ['backup', 'rate_limit', 1]]);
  });

  it('says when to come back when every route is cooling down', async () => {
    const r = rig(async () => { throw rateLimited(); }, { retry: { attempts: 1 } });
    await callModel(request({ ...LONE }), r.deps);
    const out = await callModel(request({ ...LONE, requestId: 'req-2' }), r.deps);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'NO_ROUTE', retryAtMs: 70_000 } });
  });
});

it('the cooldown book starts empty for any scope', () => {
  expect(createCooldownBook().get(SCOPE)).toBe(NO_COOLDOWNS);
});
