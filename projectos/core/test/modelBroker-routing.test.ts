import { describe, expect, it } from 'vitest';
import {
  COOLDOWN_BASE_SECONDS,
  COOLDOWN_MAX_SECONDS,
  COOLDOWN_OUTAGE_SECONDS,
  NO_COOLDOWNS,
  armCooldown,
  chooseRoute,
  cooldownEndsAt,
  clearCooldown,
  createProviderRegistry,
  isNotPortedName,
  isCoolingDown,
  parseCommittedPricing,
  type PricingTable,
  type ProviderRegistry,
} from '../src/modelBroker/index.js';

const COMMIT = 'b'.repeat(40);
const priced = (provider: string, model: string) => ({ provider, model, input: 1, output: 2, source: 's', pricedAt: '2026-11-01' });
const pricing = (...rows: ReturnType<typeof priced>[]): PricingTable => {
  const parsed = parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: rows }), commit: COMMIT });
  if (!parsed.ok) throw new Error(parsed.problems.join('; '));
  return parsed.table;
};
const registryOf = (...names: string[]): ProviderRegistry => {
  const made = createProviderRegistry(names.map((name) => ({ name, kind: 'hosted', api: 'openai-completions' })));
  if (!made.ok) throw new Error(made.problems.join('; '));
  return made.registry;
};

describe('the provider registry is committed and closed', () => {
  it('registers by lower-cased name and answers get, has and a sorted list: the positive control', () => {
    const registry = registryOf('zeta', 'alpha');
    expect(registry.has('ZETA')).toBe(true);
    expect(registry.get(' Alpha ')?.name).toBe('alpha');
    expect(registry.list().map((p) => p.name)).toEqual(['alpha', 'zeta']);
  });

  it('refuses a duplicate name, where upstream let the last one win', () => {
    const made = createProviderRegistry([
      { name: 'one', kind: 'hosted', api: 'openai-completions' },
      { name: 'one', kind: 'hosted', api: 'anthropic-messages' },
    ]);
    expect(made.ok).toBe(false);
    expect(made.ok ? '' : made.problems.join(' ')).toContain('a second time');
  });

  it('refuses a name that is empty, not a string, spaced or odd, and an unknown kind or api', () => {
    const bad = [
      { name: '', kind: 'hosted', api: 'openai-completions' },
      { name: 3, kind: 'hosted', api: 'openai-completions' },
      { name: 'UPPER', kind: 'hosted', api: 'openai-completions' },
      { name: 'has space', kind: 'hosted', api: 'openai-completions' },
      { name: 'x', kind: 'plugin', api: 'openai-completions' },
      { name: 'x', kind: 'hosted', api: 'made-up' },
    ];
    for (const record of bad) expect(createProviderRegistry([record]).ok).toBe(false);
  });

  it('a record that carries a key is refused: no credential is read or held here', () => {
    for (const field of ['apiKey', 'api_key', 'token', 'secret', 'password', 'credentialPool']) {
      expect(createProviderRegistry([{ name: 'x', kind: 'hosted', api: 'openai-completions', [field]: 'sk-123' }]).ok).toBe(false);
    }
  });

  it('a credential is named by reference only', () => {
    expect(createProviderRegistry([{ name: 'x', kind: 'hosted', api: 'openai-completions', credentialRef: 'provider.x' }]).ok).toBe(true);
    expect(createProviderRegistry([{ name: 'x', kind: 'hosted', api: 'openai-completions', credentialRef: 'sk-abcdefghijklmnopqrstuvwxyz0123456789 ' }]).ok).toBe(false);
  });

  it('refuses an xAI or Grok model in the price table, as it refuses the provider', () => {
    expect(parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: [priced('a', 'grok-4')] }), commit: COMMIT }).ok).toBe(false);
    expect(parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: [priced('a', 'x-ai/some-model')] }), commit: COMMIT }).ok).toBe(false);
    expect(parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: [priced('a', 'xai-4')] }), commit: COMMIT }).ok).toBe(false);
  });

  it('matches xAI and Grok as whole tokens: an unrelated name that contains the letters is fine', () => {
    for (const model of ['relaxai-7b', 'maxaimodel', 'ungroked']) {
      expect(parseCommittedPricing({ text: JSON.stringify({ schema: 1, models: [priced('a', model)] }), commit: COMMIT }).ok, model).toBe(true);
    }
    expect(isNotPortedName('grok-4')).toBe(true);
    expect(isNotPortedName('x-ai/anything')).toBe(true);
    expect(isNotPortedName('relaxai-7b')).toBe(false);
  });

  it('refuses an xAI or Grok provider, which this plan does not port', () => {
    for (const name of ['xai', 'grok', 'x-ai', 'grok-4']) {
      expect(createProviderRegistry([{ name, kind: 'hosted', api: 'openai-completions' }]).ok).toBe(false);
    }
  });

  it('is frozen: nothing registers after it is built', () => {
    const registry = registryOf('one');
    expect(Object.isFrozen(registry)).toBe(true);
    expect(registry.list()).toHaveLength(1);
  });
});

describe('cooldown: a provider that was limited rests until its time is up', () => {
  const T0 = 1_000_000;

  it('arms 60 s, then 120 s, doubling to a 4 h ceiling', () => {
    let state = NO_COOLDOWNS;
    const seen: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const armed = armCooldown(state, 'p', 'rate_limit', T0);
      state = armed.state;
      seen.push(armed.cooldownSeconds as number);
    }
    expect(seen.slice(0, 3)).toEqual([COOLDOWN_BASE_SECONDS, 2 * COOLDOWN_BASE_SECONDS, 4 * COOLDOWN_BASE_SECONDS]);
    expect(Math.max(...seen)).toBe(COOLDOWN_MAX_SECONDS);
    expect(seen.at(-1)).toBe(COOLDOWN_MAX_SECONDS);
  });

  it('is skipped until the injected clock reaches the end, and not a moment longer', () => {
    const { state } = armCooldown(NO_COOLDOWNS, 'p', 'rate_limit', T0);
    expect(isCoolingDown(state, 'p', T0)).toBe(true);
    expect(isCoolingDown(state, 'p', T0 + 59_999)).toBe(true);
    expect(isCoolingDown(state, 'p', T0 + 60_000)).toBe(false);
    expect(isCoolingDown(state, 'q', T0)).toBe(false);
  });

  it('follows a provider-declared reset when it is in the future, capped at the ceiling', () => {
    expect(armCooldown(NO_COOLDOWNS, 'p', 'rate_limit', T0, T0 + 90_000).cooldownSeconds).toBe(90);
    expect(armCooldown(NO_COOLDOWNS, 'p', 'rate_limit', T0, T0 + 10 * 365 * 86_400_000).cooldownSeconds).toBe(COOLDOWN_MAX_SECONDS);
    expect(armCooldown(NO_COOLDOWNS, 'p', 'rate_limit', T0, T0 - 5).cooldownSeconds).toBe(COOLDOWN_BASE_SECONDS);
    // a provider's own reset never shortens the cooldown below the base
    expect(armCooldown(NO_COOLDOWNS, 'p', 'rate_limit', T0, T0 + 5_000).cooldownSeconds).toBe(COOLDOWN_BASE_SECONDS);
    expect(armCooldown(NO_COOLDOWNS, 'p', 'rate_limit', T0, Number.NaN).cooldownSeconds).toBe(COOLDOWN_BASE_SECONDS);
  });

  it('arms only for the rate-limit family, and a success clears the level', () => {
    expect(armCooldown(NO_COOLDOWNS, 'p', 'authentication', T0).cooldownSeconds).toBeNull();
    expect(armCooldown(NO_COOLDOWNS, 'p', 'may_have_acted', T0).cooldownSeconds).toBeNull();
    expect(armCooldown(NO_COOLDOWNS, 'p', 'provider_error', T0).cooldownSeconds).toBeNull();
    expect(armCooldown(NO_COOLDOWNS, 'p', 'upstream_unavailable', T0).cooldownSeconds).toBe(COOLDOWN_OUTAGE_SECONDS);
    expect(cooldownEndsAt(armCooldown(NO_COOLDOWNS, 'p', 'rate_limit', T0).state, 'p')).toBe(T0 + 60_000);
    expect(cooldownEndsAt(NO_COOLDOWNS, 'p')).toBeNull();
    expect(armCooldown(NO_COOLDOWNS, 'p', 'invalid_request', T0).state).toBe(NO_COOLDOWNS);
    let state = armCooldown(NO_COOLDOWNS, 'p', 'billing', T0).state;
    state = armCooldown(state, 'p', 'upstream_rate_limit', T0).state;
    state = clearCooldown(state, 'p');
    expect(armCooldown(state, 'p', 'rate_limit', T0).cooldownSeconds).toBe(COOLDOWN_BASE_SECONDS);
  });

  it('does not change the state it was given', () => {
    const before = armCooldown(NO_COOLDOWNS, 'p', 'rate_limit', T0).state;
    armCooldown(before, 'p', 'rate_limit', T0);
    expect(isCoolingDown(before, 'p', T0 + 60_000)).toBe(false);
  });
});

describe('a fallback never leaves the committed registry', () => {
  const table = pricing(priced('a', 'm1'), priced('b', 'm2'), priced('c', 'm3'));
  const base = { registry: registryOf('a', 'b'), cooldowns: NO_COOLDOWNS, pricing: table, nowMs: 5, promptTokens: 10, tried: new Set<string>() };

  it('takes the first usable entry in order: the positive control', () => {
    const route = chooseRoute({ ...base, chain: [{ provider: 'a', model: 'm1' }, { provider: 'b', model: 'm2' }] });
    expect(route.ok && route.route.provider).toBe('a');
    expect(route.ok && route.route.rate.model).toBe('a/m1');
  });

  it('skips a provider that is priced but not registered, and says so', () => {
    const route = chooseRoute({ ...base, chain: [{ provider: 'c', model: 'm3' }, { provider: 'b', model: 'm2' }] });
    expect(route.ok && route.route.provider).toBe('b');
    expect(route.skipped).toEqual([{ provider: 'c', model: 'm3', reason: 'not-registered' }]);
  });

  it('fails closed when the clock gives no time: no route is chosen, so no cooldown is skipped by accident', () => {
    for (const nowMs of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const route = chooseRoute({ ...base, nowMs, chain: [{ provider: 'a', model: 'm1' }] });
      expect(route.ok).toBe(false);
      expect(route.skipped[0]?.reason).toBe('no-clock');
    }
  });

  it('refuses when only unregistered providers remain', () => {
    const route = chooseRoute({ ...base, chain: [{ provider: 'c', model: 'm3' }, { provider: 'zz', model: 'm' }] });
    expect(route.ok).toBe(false);
  });

  it('skips a provider in cooldown until its end, by the injected clock', () => {
    const { state } = armCooldown(NO_COOLDOWNS, 'a', 'rate_limit', 5);
    const chain = [{ provider: 'a', model: 'm1' }, { provider: 'b', model: 'm2' }];
    const during = chooseRoute({ ...base, cooldowns: state, chain, nowMs: 59_999 });
    expect(during.ok && during.route.provider).toBe('b');
    expect(during.skipped[0]).toMatchObject({ provider: 'a', reason: 'cooling-down' });
    const after = chooseRoute({ ...base, cooldowns: state, chain, nowMs: 60_005 });
    expect(after.ok && after.route.provider).toBe('a');
  });

  it('skips an unpriced model and one already tried', () => {
    const route = chooseRoute({ ...base, chain: [{ provider: 'a', model: 'unpriced' }, { provider: 'a', model: 'm1' }, { provider: 'b', model: 'm2' }], tried: new Set(['a/m1']) });
    expect(route.ok && route.route.provider).toBe('b');
    expect(route.skipped.map((s) => s.reason)).toEqual(['unpriced', 'already-tried']);
  });

  it('is not led by the chain into a provider the registry has not got, whatever its spelling', () => {
    const route = chooseRoute({ ...base, chain: [{ provider: 'A ', model: 'm1' }, { provider: 'a/../c', model: 'm3' }] });
    expect(route.ok).toBe(false);
  });
});
