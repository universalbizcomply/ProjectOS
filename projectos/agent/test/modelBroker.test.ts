import { describe, expect, it } from 'vitest';
import { bindingKeyOf, callModel, createCooldownBook, createMemoryAttemptStore } from '@projectos/core';
import { detectLocalModels, loadCommittedBrokerConfig, type CommittedRead } from '../src/modelBroker/index.js';

const COMMIT = '1'.repeat(40);
const PRICING_PATH = 'projectos/config/model-pricing.json';
const REGISTRY_PATH = 'projectos/config/model-providers.json';
const pricingText = JSON.stringify({ schema: 1, models: [{ provider: 'primary', model: 'big', input: 1, output: 2, source: 's', pricedAt: '2026-11-01' }] });
const registryText = JSON.stringify({ schema: 1, providers: [{ name: 'primary', kind: 'hosted', api: 'openai-completions' }, { name: 'ollama', kind: 'local', api: 'ollama', baseUrl: 'http://127.0.0.1:11434' }] });

const reader = (files: Record<string, string>, commit = COMMIT): { read: CommittedRead; asked: string[] } => {
  const asked: string[] = [];
  return { asked, read: (path) => (asked.push(path), path in files ? { text: files[path] as string, commit } : null) };
};

describe('the broker config is read from committed bytes only', () => {
  it('loads a registry and a price table through the committed reader: the positive control', () => {
    const { read, asked } = reader({ [PRICING_PATH]: pricingText, [REGISTRY_PATH]: registryText });
    const loaded = loadCommittedBrokerConfig({ read, pricingPath: PRICING_PATH, registryPath: REGISTRY_PATH });
    expect(loaded.ok).toBe(true);
    expect(asked.sort()).toEqual([PRICING_PATH, REGISTRY_PATH]);
    expect(loaded.ok && loaded.pricing.commit).toBe(COMMIT);
    expect(loaded.ok && loaded.registry.has('ollama')).toBe(true);
  });

  it('refuses when the reader has no committed copy, and reads nothing else', () => {
    const { read } = reader({ [REGISTRY_PATH]: registryText });
    const loaded = loadCommittedBrokerConfig({ read, pricingPath: PRICING_PATH, registryPath: REGISTRY_PATH });
    expect(loaded).toMatchObject({ ok: false });
    expect(loaded.ok ? [] : loaded.problems.join(' ')).toContain(PRICING_PATH);
  });

  it('refuses a reader that returns something with no commit, such as a working-tree read', () => {
    const read: CommittedRead = (path) => ({ text: path === PRICING_PATH ? pricingText : registryText, commit: 'working-tree' });
    expect(loadCommittedBrokerConfig({ read, pricingPath: PRICING_PATH, registryPath: REGISTRY_PATH }).ok).toBe(false);
  });

  it('refuses a path that leaves the repository or names another file kind, so a path cannot pick other bytes', () => {
    const { read } = reader({ '../x.json': pricingText, [REGISTRY_PATH]: registryText });
    for (const pricingPath of ['../x.json', '/etc/passwd', 'C:/x.json', 'a/../b.json', 'pricing.txt', '']) {
      expect(loadCommittedBrokerConfig({ read, pricingPath, registryPath: REGISTRY_PATH }).ok, pricingPath).toBe(false);
    }
  });

  it('a registry with a key, an unknown schema or a bad provider refuses the whole load', () => {
    for (const bad of [
      JSON.stringify({ schema: 1, providers: [{ name: 'p', kind: 'hosted', api: 'openai-completions', apiKey: 'sk-x' }] }),
      JSON.stringify({ schema: 9, providers: [] }),
      JSON.stringify({ schema: 1, providers: [{ name: 'xai', kind: 'hosted', api: 'openai-completions' }] }),
      '{broken',
    ]) {
      const { read } = reader({ [PRICING_PATH]: pricingText, [REGISTRY_PATH]: bad });
      expect(loadCommittedBrokerConfig({ read, pricingPath: PRICING_PATH, registryPath: REGISTRY_PATH }).ok).toBe(false);
    }
  });

  it('the loaded config drives the core broker end to end, with a fake transport', async () => {
    const { read } = reader({ [PRICING_PATH]: pricingText, [REGISTRY_PATH]: registryText });
    const loaded = loadCommittedBrokerConfig({ read, pricingPath: PRICING_PATH, registryPath: REGISTRY_PATH });
    if (!loaded.ok) throw new Error(loaded.problems.join('; '));
    const fields = { tenant: 'acme-co', project: 'alpha-project', requestId: 'r', prompt: 'hi' };
    const out = await callModel(
      {
        ...fields,
        idempotencyKey: bindingKeyOf(fields),
        phaseId: 'P',
        chain: [{ provider: 'primary', model: 'big' }],
        estimatedInputTokens: 10,
        maxOutputTokens: 10,
        budget: { maxMicroUsd: 1000 },
      },
      {
        registry: loaded.registry,
        pricing: loaded.pricing,
        transport: async () => ({ text: 'ok', stopReason: 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
        grant: () => true,
        attempts: createMemoryAttemptStore(),
        cooldowns: createCooldownBook(),
        clock: () => 1,
        sleep: async () => undefined,
        random: () => 0,
        record: () => undefined,
        recordAttempt: () => undefined,
      },
    );
    expect(out.ok).toBe(true);
  });
});

describe('local model detection is loopback only, and reaches nothing else', () => {
  it('asks a loopback OpenAI-compatible endpoint for its models: the positive control', async () => {
    const asked: string[] = [];
    const found = await detectLocalModels({
      endpoints: [{ baseUrl: 'http://127.0.0.1:1234', api: 'openai-completions' }],
      getJson: async (url) => (asked.push(url), { data: [{ id: 'llama-3' }, { id: 'qwen' }] }),
    });
    expect(asked).toEqual(['http://127.0.0.1:1234/v1/models']);
    expect(found).toEqual([{ baseUrl: 'http://127.0.0.1:1234', status: 'found', models: ['llama-3', 'qwen'] }]);
  });

  it('does not ask for /v1/v1/models when the address already ends in /v1', async () => {
    const asked: string[] = [];
    await detectLocalModels({
      endpoints: [{ baseUrl: 'http://localhost:1234/v1/', api: 'openai-completions' }],
      getJson: async (url) => (asked.push(url), { data: [] }),
    });
    expect(asked).toEqual(['http://localhost:1234/v1/models']);
  });

  it('asks an Ollama endpoint on its own path', async () => {
    const asked: string[] = [];
    const found = await detectLocalModels({
      endpoints: [{ baseUrl: 'http://localhost:11434', api: 'ollama' }],
      getJson: async (url) => (asked.push(url), { models: [{ name: 'mistral:7b' }] }),
    });
    expect(asked).toEqual(['http://localhost:11434/api/tags']);
    expect(found[0]).toMatchObject({ status: 'found', models: ['mistral:7b'] });
  });

  it('refuses any other host and never calls the port for it', async () => {
    const asked: string[] = [];
    const found = await detectLocalModels({
      endpoints: ['http://10.0.0.5:11434', 'https://api.openai.com', 'http://127.0.0.1@evil.com', 'http://localhost.evil.com:11434', 'http://0.0.0.0:1234', 'http://169.254.169.254'].map((baseUrl) => ({ baseUrl, api: 'openai-completions' as const })),
      getJson: async (url) => (asked.push(url), { data: [] }),
    });
    expect(asked).toEqual([]);
    expect(found.every((f) => f.status === 'refused')).toBe(true);
  });

  it('reports an unreachable or malformed local answer without throwing, and caps what it keeps', async () => {
    const down = await detectLocalModels({ endpoints: [{ baseUrl: 'http://127.0.0.1:1', api: 'openai-completions' }], getJson: async () => { throw new Error('ECONNREFUSED'); } });
    expect(down[0]).toMatchObject({ status: 'unreachable' });
    const odd = await detectLocalModels({ endpoints: [{ baseUrl: 'http://127.0.0.1:1', api: 'openai-completions' }], getJson: async () => ({ data: 'nope' }) });
    expect(odd[0]).toMatchObject({ status: 'unreachable' });
    const many = await detectLocalModels({
      endpoints: [{ baseUrl: 'http://127.0.0.1:1', api: 'openai-completions' }],
      getJson: async () => ({ data: Array.from({ length: 500 }, (_, i) => ({ id: `m${i}` })).concat([{ id: 'x'.repeat(500) } as { id: string }, { id: 7 as unknown as string }]) }),
    });
    expect(many[0]).toMatchObject({ status: 'found' });
    expect(many[0]?.status === 'found' && many[0].models.length).toBe(100);
    expect(many[0]?.status === 'found' && many[0].models.every((m) => m.length <= 200)).toBe(true);
  });
});
