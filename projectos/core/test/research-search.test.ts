import { describe, expect, it } from 'vitest';
import {
  SearchProviderError,
  createBraveProvider,
  createSearxngProvider,
  createSpendBook,
  runWebSearch,
  type GuardedFetchDeps,
  type SearchResult,
  type WebSearchDeps,
  type WebSearchProvider,
} from '../src/research/index.js';
import { OPEN_POLICY, PUBLIC_IP, SCOPE, clockOf, fetchOf, resolverOf } from './researchFixtures.js';

const RESULT: SearchResult = { title: 'T', url: 'https://example.com/a', snippet: 'S' };

function provider(over: Partial<WebSearchProvider> & { id: string }): WebSearchProvider & { calls: number } {
  const state = { calls: 0 };
  const made = { paid: false, microUsdPerQuery: 0, search: async () => [RESULT], ...over };
  return Object.defineProperty({ ...made, search: async (q: Parameters<WebSearchProvider['search']>[0]) => { state.calls += 1; return made.search(q); } }, 'calls', { get: () => state.calls }) as WebSearchProvider & { calls: number };
}

const deps = (providers: readonly WebSearchProvider[], over: Partial<WebSearchDeps> = {}): WebSearchDeps => ({ providers, spend: createSpendBook({ maxMicroUsd: 1000 }), grant: () => true, ...over });
const ask = (d: WebSearchDeps, extra: Record<string, unknown> = {}) => runWebSearch({ scope: SCOPE, query: 'bread', ...extra }, d);

describe('a search is judged before it is asked, and what comes back is bounded', () => {
  it('asks a free provider and returns bounded, text-only results: the positive control', async () => {
    const free = provider({ id: 'searx', search: async () => [RESULT, { title: 5 } as never, null as never, { title: 'x', url: '' } as never, { ...RESULT, snippet: 's'.repeat(5000), title: 't'.repeat(5000) }] });
    const out = await ask(deps([free]));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.provider).toBe('searx');
    expect(out.value.results).toHaveLength(2);
    expect(out.value.results[1]?.snippet).toHaveLength(1000);
    expect(out.value.results[1]?.title).toHaveLength(300);
    expect(out.value.spentMicroUsd).toBe(0);
  });

  it('refuses a bad scope, query or count before any provider is asked', async () => {
    const free = provider({ id: 'searx' });
    const d = deps([free]);
    expect(await runWebSearch({ scope: { tenant: 'X', project: 'p' } as never, query: 'q' }, d)).toMatchObject({ refusal: { code: 'BAD_SCOPE' } });
    for (const query of ['', '   ', undefined, 7, 'a'.repeat(401), 'a\u0000b', 'line\nbreak']) expect(await ask(d, { query }), JSON.stringify(query)).toMatchObject({ refusal: { code: 'INVALID_REQUEST' } });
    for (const count of [0, -1, 11, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '5', null]) expect(await ask(d, { count }), String(count)).toMatchObject({ refusal: { code: 'INVALID_REQUEST' } });
    expect(free.calls).toBe(0);
  });

  it('holds the answer to the count asked for, however many the provider sends', async () => {
    const wide = provider({ id: 'searx', search: async () => Array.from({ length: 30 }, (_, i) => ({ ...RESULT, url: `https://example.com/${i}` })) });
    const out = await ask(deps([wide]), { count: 3 });
    expect(out.ok && out.value.results).toHaveLength(3);
    const dflt = await ask(deps([wide]));
    expect(dflt.ok && dflt.value.results).toHaveLength(5);
  });
});

describe('a paid search needs a budget, a grant and room, asked before the provider is called', () => {
  const paid = (over: Partial<WebSearchProvider> = {}) => provider({ id: 'brave', paid: true, microUsdPerQuery: 400, ...over });

  it('a paid search with a budget and a grant is asked, reserved and counted: the positive control', async () => {
    const p = paid();
    const out = await ask(deps([p]));
    expect(out).toMatchObject({ ok: true, value: { provider: 'brave', spentMicroUsd: 400 } });
    expect(p.calls).toBe(1);
  });

  it('refuses a paid search with no budget, a zero budget or a budget that is not a whole positive number, and never calls the provider', async () => {
    for (const budget of [undefined, null, {}, { maxMicroUsd: 0 }, { maxMicroUsd: -5 }, { maxMicroUsd: 1.5 }, { maxMicroUsd: Number.NaN }, { maxMicroUsd: '1000' }, { maxMicroUsd: Number.POSITIVE_INFINITY }, 1000]) {
      const p = paid();
      const out = await ask(deps([p], { spend: createSpendBook(budget) }));
      expect(out, JSON.stringify(budget)).toMatchObject({ ok: false, refusal: { code: 'BUDGET_REQUIRED' } });
      expect(p.calls).toBe(0);
    }
  });

  it('refuses a paid search when no grant answers exactly true, and a grant that throws is not a grant', async () => {
    for (const grant of [() => false, () => 'yes' as never, () => undefined as never, () => 1 as never, () => { throw new Error('boom'); }, async () => { throw new Error('async boom'); }]) {
      const p = paid();
      expect(await ask(deps([p], { grant })), String(grant)).toMatchObject({ ok: false, refusal: { code: 'NO_GRANT' } });
      expect(p.calls).toBe(0);
    }
  });

  it('asks the grant about this scope, this provider and this price', async () => {
    const asked: unknown[] = [];
    await ask(deps([paid()], { grant: (request) => { asked.push(request); return true; } }));
    expect(asked).toEqual([{ scope: SCOPE, provider: 'brave', microUsd: 400 }]);
  });

  it('refuses a paid search that does not fit what is left, counting what earlier searches reserved', async () => {
    const p = paid();
    const d = deps([p], { spend: createSpendBook({ maxMicroUsd: 1000 }) });
    expect(await ask(d)).toMatchObject({ ok: true });
    expect(await ask(d)).toMatchObject({ ok: true, value: { spentMicroUsd: 800 } });
    expect(await ask(d)).toMatchObject({ ok: false, refusal: { code: 'OVER_BUDGET' } });
    expect(p.calls).toBe(2);
  });

  it('reserves before the call, so two searches started together cannot both fit a budget that holds one', async () => {
    const p = paid({ search: async () => { await new Promise((resolve) => setTimeout(resolve, 10)); return [RESULT]; } });
    const d = deps([p], { spend: createSpendBook({ maxMicroUsd: 500 }) });
    const [a, b] = await Promise.all([ask(d), ask(d)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(p.calls).toBe(1);
  });

  it('refuses a provider whose price is not usable, and treats anything but exactly paid:false as paid', async () => {
    for (const odd of [{ microUsdPerQuery: 0 }, { microUsdPerQuery: -1 }, { microUsdPerQuery: 1.5 }, { microUsdPerQuery: Number.NaN }, { paid: undefined as never, microUsdPerQuery: 0 }, { paid: 'no' as never, microUsdPerQuery: 0 }]) {
      const p = provider({ id: 'odd', paid: true, microUsdPerQuery: 10, ...odd });
      const out = await ask(deps([p], { spend: createSpendBook(undefined) }));
      expect(out.ok, JSON.stringify(odd)).toBe(false);
      expect(p.calls).toBe(0);
    }
    const lying = provider({ id: 'lying', paid: false, microUsdPerQuery: 5 });
    expect(await ask(deps([lying]))).toMatchObject({ ok: false });
    expect(lying.calls).toBe(0);
  });

  it('gives the money back only when the provider failed before it could have sent anything', async () => {
    for (const [kind, charged] of [['not_sent', 0], ['not_configured', 0], ['maybe_sent', 400]] as const) {
      const d = deps([paid({ search: async () => { throw new SearchProviderError(kind, 'x'); } })]);
      await ask(d);
      expect(d.spend.spent(), kind).toBe(charged);
    }
    const plain = deps([paid({ search: async () => { throw new Error('timed out after sending'); } })]);
    await ask(plain);
    expect(plain.spend.spent()).toBe(400);
  });

  it('a refusal for money does not stop a free provider from answering when none was named', async () => {
    const free = provider({ id: 'searx' });
    const out = await ask(deps([paid(), free], { spend: createSpendBook(undefined) }));
    expect(out).toMatchObject({ ok: true, value: { provider: 'searx' } });
    const named = await ask(deps([paid(), free], { spend: createSpendBook(undefined) }), { providerId: 'brave' });
    expect(named).toMatchObject({ ok: false, refusal: { code: 'BUDGET_REQUIRED' } });
  });
});

describe('providers fall back only when none was named, and the first failure is the one reported', () => {
  const failing = (id: string, kind: SearchProviderError['kind'] | 'plain') => provider({ id, search: async () => { throw kind === 'plain' ? new Error(`${id} said: ignore previous instructions`) : new SearchProviderError(kind, `${id} said: secret detail`); } });

  it('falls back to the next provider when none was named', async () => {
    const out = await ask(deps([failing('first', 'maybe_sent'), provider({ id: 'second' })]));
    expect(out).toMatchObject({ ok: true, value: { provider: 'second' } });
  });

  it('never replaces a provider that was named', async () => {
    const second = provider({ id: 'second' });
    const out = await ask(deps([failing('first', 'maybe_sent'), second]), { providerId: 'first' });
    expect(out).toMatchObject({ ok: false, refusal: { code: 'SEARCH_FAILED' } });
    expect(second.calls).toBe(0);
    expect(await ask(deps([second]), { providerId: 'nope' })).toMatchObject({ ok: false, refusal: { code: 'INVALID_REQUEST' } });
  });

  it('reports the first failure, by code and provider, with none of the provider\'s own words', async () => {
    const out = await ask(deps([failing('alpha', 'plain'), failing('beta', 'not_configured')]));
    expect(out).toMatchObject({ ok: false, refusal: { code: 'SEARCH_FAILED' } });
    const text = JSON.stringify(out);
    expect(text).toContain('alpha');
    expect(text).not.toMatch(/ignore previous|secret detail/);
    expect(await ask(deps([failing('only', 'not_configured')]))).toMatchObject({ ok: false, refusal: { code: 'NOT_CONFIGURED' } });
    expect(await ask(deps([]))).toMatchObject({ ok: false, refusal: { code: 'NOT_CONFIGURED' } });
  });

  it('stops when the run is cancelled, before the next provider and before returning stale work', async () => {
    const controller = new AbortController();
    const second = provider({ id: 'second' });
    const first = provider({ id: 'first', search: async () => { controller.abort(); return [RESULT]; } });
    expect(await ask(deps([first, second], { signal: controller.signal }))).toMatchObject({ ok: false, refusal: { message: 'the search was cancelled' } });
    expect(second.calls).toBe(0);
    const cancelled = provider({ id: 'x' });
    expect(await ask(deps([cancelled], { assertCurrent: () => { throw new Error('stale'); } }))).toMatchObject({ ok: false });
    expect(cancelled.calls).toBe(0);
  });
});

function endpoint(table: Parameters<typeof fetchOf>[0], dns: Parameters<typeof resolverOf>[0] = { 'search.example': [PUBLIC_IP], 'api.search.brave.com': ['93.184.216.99'] }) {
  const resolved = resolverOf(dns);
  const served = fetchOf(table);
  const guard: GuardedFetchDeps = { resolver: resolved.resolver, fetch: served.fetch, policy: OPEN_POLICY, clock: clockOf().clock };
  return { guard, requests: served.requests };
}
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const searxBody = (rows: unknown[]) => JSON.stringify({ results: rows });

describe('the SearXNG adapter sits behind an injected fetch', () => {
  const built = (config: Parameters<typeof createSearxngProvider>[0], g: GuardedFetchDeps) => {
    const made = createSearxngProvider(config, g);
    if (!made.ok) throw new Error(JSON.stringify(made.refusal));
    return made.value;
  };

  it('asks the JSON endpoint with the query, never follows a redirect, and returns bounded results: the positive control', async () => {
    const { guard, requests } = endpoint({ 'http://127.0.0.1:8888/search?q=bread&format=json': { headers: JSON_HEADERS, body: searxBody([{ url: 'https://a.example/', title: 'A', content: 'about a' }, { url: 7, title: 'bad' }, { url: 'https://b.example/', title: 'B' }]) } });
    const searx = built({ baseUrl: 'http://127.0.0.1:8888', mode: 'self-hosted' }, guard);
    expect(searx).toMatchObject({ id: 'searx'.replace('searx', 'searxng'), paid: false, microUsdPerQuery: 0 });
    expect(await searx.search({ query: 'bread', count: 5 })).toEqual([{ url: 'https://a.example/', title: 'A', snippet: 'about a' }, { url: 'https://b.example/', title: 'B', snippet: '' }]);
    expect(requests[0]).toMatchObject({ pinnedAddresses: ['127.0.0.1'], headers: { accept: 'application/json' } });
  });

  it('refuses a configuration the guard refuses: the metadata floor, a bad scheme, credentials, a plain-http public host', () => {
    const { guard } = endpoint({});
    for (const [baseUrl, mode] of [['http://169.254.169.254/', 'self-hosted'], ['ftp://x.example/', 'self-hosted'], ['http://u:p@127.0.0.1/', 'self-hosted'], ['http://search.example/', 'public'], ['https://127.0.0.1/', 'public'], ['https://localhost/', 'public']] as const) {
      expect(createSearxngProvider({ baseUrl, mode }, guard).ok, baseUrl).toBe(false);
    }
    expect(createSearxngProvider({ baseUrl: 'https://search.example', mode: 'public', categories: 'general,news' }, guard).ok).toBe(true);
    for (const categories of ['general news', 'a;b', '']) expect(createSearxngProvider({ baseUrl: 'https://search.example', mode: 'public', categories }, guard).ok, categories).toBe(false);
    expect(createSearxngProvider({ baseUrl: 'https://search.example', mode: 'public', language: 'en US' }, guard).ok).toBe(false);
  });

  it('a bad status, a cut body, a body that is not JSON and a redirect are failures of the provider, not empty answers', async () => {
    const cases: [Parameters<typeof fetchOf>[0][string], string][] = [
      [{ status: 500, headers: JSON_HEADERS, body: '{}' }, 'status'], [{ headers: JSON_HEADERS, body: '{"results":[', truncated: true }, 'cut'], [{ headers: JSON_HEADERS, body: 'not json' }, 'json'],
      [{ headers: { 'content-type': 'text/html' }, body: '<html>' }, 'html'], [{ status: 302, headers: { location: 'http://10.0.0.1/' }, body: '' }, 'redirect'],
    ];
    for (const [page, label] of cases) {
      const { guard } = endpoint({ 'https://search.example/search?q=q&format=json': page });
      const searx = built({ baseUrl: 'https://search.example', mode: 'public' }, guard);
      await expect(searx.search({ query: 'q', count: 5 }), label).rejects.toBeInstanceOf(SearchProviderError);
    }
  });

  it('retries in the general category when the chosen ones find nothing, as upstream does', async () => {
    const { guard, requests } = endpoint({
      'https://search.example/search?q=q&format=json&categories=science': { headers: JSON_HEADERS, body: searxBody([]) },
      'https://search.example/search?q=q&format=json&categories=general': { headers: JSON_HEADERS, body: searxBody([{ url: 'https://g.example/', title: 'G' }]) },
    });
    const searx = built({ baseUrl: 'https://search.example', mode: 'public', categories: 'science' }, guard);
    expect(await searx.search({ query: 'q', count: 5 })).toHaveLength(1);
    expect(requests).toHaveLength(2);
  });

  it('an endpoint path that already ends in /search is not doubled, and a trailing slash is dropped', async () => {
    const { guard, requests } = endpoint({ 'https://search.example/x/search?q=q&format=json': { headers: JSON_HEADERS, body: searxBody([]) } });
    await built({ baseUrl: 'https://search.example/x/search/', mode: 'public' }, guard).search({ query: 'q', count: 1 });
    expect(requests[0]?.url).toBe('https://search.example/x/search?q=q&format=json');
  });
});

describe('the Brave adapter is paid, holds no credential, and sends its header only to the endpoint', () => {
  const headersFor = async () => ({ 'X-Subscription-Token': 'brave-key-value' });
  const built = (over: Partial<Parameters<typeof createBraveProvider>[0]>, g: GuardedFetchDeps) => {
    const made = createBraveProvider({ microUsdPerQuery: 300, headersFor, ...over }, g);
    if (!made.ok) throw new Error(JSON.stringify(made.refusal));
    return made.value;
  };
  const braveUrl = 'https://api.search.brave.com/res/v1/web/search?q=bread&count=5';

  it('declares its price, asks the web endpoint with the header, and returns bounded results: the positive control', async () => {
    const { guard, requests } = endpoint({ [braveUrl]: { headers: JSON_HEADERS, body: JSON.stringify({ web: { results: [{ title: 'B', url: 'https://b.example/', description: 'D' }, { title: 5 }] } }) } });
    const brave = built({}, guard);
    expect(brave).toMatchObject({ id: 'brave', paid: true, microUsdPerQuery: 300 });
    expect(await brave.search({ query: 'bread', count: 5 })).toEqual([{ title: 'B', url: 'https://b.example/', snippet: 'D' }]);
    expect(requests[0]?.headers).toEqual({ accept: 'application/json', 'x-subscription-token': 'brave-key-value' });
  });

  it('through the runtime, a paid Brave search without a budget never reaches the fetch port', async () => {
    const { guard, requests } = endpoint({ [braveUrl]: { headers: JSON_HEADERS, body: '{}' } });
    const brave = built({}, guard);
    expect(await ask(deps([brave], { spend: createSpendBook(undefined) }))).toMatchObject({ ok: false, refusal: { code: 'BUDGET_REQUIRED' } });
    expect(requests).toHaveLength(0);
  });

  it('with no usable credential nothing is sent and nothing is charged', async () => {
    for (const bad of [async () => { throw new Error('vault locked'); }, async () => ({}), async () => ({ 'X-Subscription-Token': '' }), async () => ({ authorization: 'x' }), async () => ({ 'X-Subscription-Token': 'a\nb' }), async () => ({ 'X-Subscription-Token': 'a', host: 'evil' }), () => null as never]) {
      const { guard, requests } = endpoint({});
      const d = deps([built({ headersFor: bad }, guard)]);
      expect(await ask(d)).toMatchObject({ ok: false, refusal: { code: 'NOT_CONFIGURED' } });
      expect(requests).toHaveLength(0);
      expect(d.spend.spent()).toBe(0);
    }
  });

  it('a refusal before dispatch is free and a failure after it is charged', async () => {
    const free = endpoint({});
    const dFree = deps([built({ baseUrl: 'https://api.search.brave.com' }, { ...free.guard, resolver: async () => ['10.0.0.1'] })]);
    expect(await ask(dFree)).toMatchObject({ ok: false });
    expect(dFree.spend.spent()).toBe(0);
    const sent = endpoint({ [braveUrl]: { status: 429, headers: JSON_HEADERS, body: '{}' } });
    const dSent = deps([built({}, sent.guard)]);
    expect(await ask(dSent)).toMatchObject({ ok: false });
    expect(dSent.spend.spent()).toBe(300);
  });

  it('never follows a redirect, so the header cannot be carried to another host', async () => {
    const { guard, requests } = endpoint({ [braveUrl]: { status: 307, headers: { location: 'https://evil.example/' }, body: '' } });
    await expect(built({}, guard).search({ query: 'bread', count: 5 })).rejects.toBeInstanceOf(SearchProviderError);
    expect(requests).toHaveLength(1);
  });

  it('refuses a price that is not a whole positive number, an unsupported country or language, and an unusable address', () => {
    const { guard } = endpoint({});
    for (const microUsdPerQuery of [0, -1, 1.5, Number.NaN, undefined as never]) expect(createBraveProvider({ microUsdPerQuery, headersFor }, guard).ok, String(microUsdPerQuery)).toBe(false);
    expect(createBraveProvider({ microUsdPerQuery: 1, headersFor, country: 'ZZ' }, guard).ok).toBe(false);
    expect(createBraveProvider({ microUsdPerQuery: 1, headersFor, country: 'gb', searchLang: 'zh-TW' }, guard).ok).toBe(true);
    expect(createBraveProvider({ microUsdPerQuery: 1, headersFor, searchLang: 'xx' }, guard).ok).toBe(false);
    expect(createBraveProvider({ microUsdPerQuery: 1, headersFor: undefined as never }, guard).ok).toBe(false);
    expect(createBraveProvider({ microUsdPerQuery: 1, headersFor, baseUrl: 'http://api.example/' }, guard).ok).toBe(false);
    expect(createBraveProvider({ microUsdPerQuery: 1, headersFor, baseUrl: 'https://169.254.169.254/' }, guard).ok).toBe(false);
  });

  it('adds the country and the language to the query when they are set', async () => {
    const { guard, requests } = endpoint({ 'https://api.search.brave.com/res/v1/web/search?q=bread&count=2&country=GB&search_lang=zh-hant': { headers: JSON_HEADERS, body: '{}' } });
    await built({ country: 'gb', searchLang: 'zh-TW' }, guard).search({ query: 'bread', count: 2 });
    expect(requests).toHaveLength(1);
  });
});
