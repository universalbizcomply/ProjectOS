import { createWebsitePolicy, type HttpFetchRequest, type HttpFetchResponse, type PlannerView } from '@projectos/core';
import { describe, expect, it } from 'vitest';
import { createResearchRuntime, loadCommittedWebsitePolicy, type CommittedRead, type ResearchRuntimeParams } from '../src/research/index.js';

const COMMIT = 'a'.repeat(40);
const POLICY_PATH = 'config/website-blocklist.json';
const POLICY_TEXT = JSON.stringify({ schema: 1, enabled: true, domains: ['blocked.example', '*.tracker.example'] });
const reader = (text: string, commit = COMMIT): CommittedRead => (path) => (path === POLICY_PATH ? { text, commit } : null);
const SCOPE = { tenant: 'acme-co', project: 'alpha-project' };
const OTHER = { tenant: 'other-co', project: 'alpha-project' };
const PAGE = 'https://example.com/bread';

function params(over: Partial<ResearchRuntimeParams> = {}) {
  const requests: HttpFetchRequest[] = [];
  const views: PlannerView[] = [];
  const fetch = async (request: HttpFetchRequest): Promise<HttpFetchResponse> => {
    requests.push(request);
    const body = '<html><head><title>Bread</title></head><body><p>Bread needs flour.</p><p>Bread needs water.</p></body></html>';
    return { status: 200, headers: { 'content-type': 'text/html' }, body, bytesRead: body.length, truncated: false };
  };
  const base: ResearchRuntimeParams = {
    read: reader(POLICY_TEXT),
    policyPath: POLICY_PATH,
    resolver: async () => ['93.184.216.34'],
    fetch,
    clock: (() => { let now = 1_000_000; return () => (now += 10); })(),
    planner: async (view) => {
      views.push(view);
      if (view.step === 1) return { kind: 'fetch', url: PAGE };
      const path = /Citation: (web\/[^\n]+)/.exec(view.evidence.join('\n'))?.[1] ?? '';
      return { kind: 'answer', text: 'Bread needs flour and water.', citations: [{ path, startLine: 1, endLine: 2 }] };
    },
    grant: () => true,
    providers: [],
    ...over,
  };
  return { base, requests, views };
}

describe('the website blocklist is loaded from committed bytes only', () => {
  it('loads a committed policy and judges its rules: the positive control', () => {
    const loaded = loadCommittedWebsitePolicy({ read: reader(POLICY_TEXT), path: POLICY_PATH });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.commit).toBe(COMMIT);
    expect(loaded.policy.rules.map((rule) => rule.pattern).sort()).toEqual(['*.tracker.example', 'blocked.example']);
    expect(loaded.policy.rules[0]?.source).toBe(`${POLICY_PATH}@aaaaaaaaaaaa`);
  });

  it('refuses a reader that returns something with no commit, such as a working-tree read', () => {
    for (const read of [reader(POLICY_TEXT, ''), reader(POLICY_TEXT, 'HEAD'), reader(POLICY_TEXT, 'A'.repeat(40)), reader(POLICY_TEXT, 'a'.repeat(39)), (() => ({ text: POLICY_TEXT })) as unknown as CommittedRead, () => null, () => undefined as never]) {
      expect(loadCommittedWebsitePolicy({ read, path: POLICY_PATH }).ok).toBe(false);
    }
    expect(loadCommittedWebsitePolicy({ read: () => { throw new Error('disk'); }, path: POLICY_PATH })).toMatchObject({ ok: false });
  });

  it('refuses a path that leaves the repository or names another file kind, so a path cannot pick other bytes', () => {
    for (const path of ['../config/x.json', '/etc/passwd.json', 'config/../../x.json', 'config/x.txt', 'config\\x.json', '', 'config/.json/../x.json', 'a b.json', undefined as never]) {
      expect(loadCommittedWebsitePolicy({ read: () => ({ text: POLICY_TEXT, commit: COMMIT }), path }).ok, String(path)).toBe(false);
    }
  });

  it('fails closed: text that is not JSON, another schema, a bad flag or one bad rule refuses the whole load', () => {
    const texts = [
      'not json', '[]', 'null', JSON.stringify({ schema: 2, enabled: true, domains: [] }), JSON.stringify({ enabled: true, domains: [] }), JSON.stringify({ schema: 1, enabled: 'yes', domains: [] }),
      JSON.stringify({ schema: 1, enabled: true, domains: ['ok.example', 5] }), JSON.stringify({ schema: 1, enabled: true }), JSON.stringify({ schema: 1, enabled: true, domains: 'blocked.example' }),
      'x'.repeat(1_000_001),
    ];
    for (const text of texts) expect(loadCommittedWebsitePolicy({ read: reader(text), path: POLICY_PATH }).ok, text.slice(0, 40)).toBe(false);
    expect(createWebsitePolicy({ enabled: true, domains: [] }).ok).toBe(true);
  });
});

describe('the research runtime is made once, with its stores shared and its policy committed', () => {
  it('runs a cited research end to end through fakes: the positive control', async () => {
    const { base, requests } = params();
    const made = createResearchRuntime(base);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.runtime.policyCommit).toBe(COMMIT);
    const out = await made.runtime.run({ scope: SCOPE, question: 'What does bread need?' });
    expect(out.ok).toBe(true);
    expect(out).toMatchObject({ ok: true, steps: 2, value: { answer: { text: 'Bread needs flour and water.' }, sources: [{ url: PAGE }] } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ pinnedAddresses: ['93.184.216.34'] });
  });

  it('does not start without a committed policy, or with a malformed one', () => {
    for (const read of [() => null, reader('not json'), reader(POLICY_TEXT, 'main')]) {
      const made = createResearchRuntime(params({ read }).base);
      expect(made.ok).toBe(false);
    }
    expect(createResearchRuntime(params({ slotsPerScope: 0 }).base)).toMatchObject({ ok: false });
    expect(createResearchRuntime(params({ slotsPerScope: Number.NaN }).base)).toMatchObject({ ok: false });
  });

  it('applies the committed blocklist to every page, a subdomain included', async () => {
    const { base, requests } = params({
      read: reader(JSON.stringify({ schema: 1, enabled: true, domains: ['example.com', 'tracker.example'] })),
      planner: async (view) => (view.step === 1 ? { kind: 'fetch', url: PAGE } : { kind: 'fetch', url: 'https://www.tracker.example/' }),
    });
    const made = createResearchRuntime(base);
    if (!made.ok) throw new Error('setup');
    const out = await made.runtime.run({ scope: SCOPE, question: 'q', maxSteps: 2 });
    expect(out).toMatchObject({ ok: false, refusal: { code: 'STEP_CAP' } });
    expect(requests).toHaveLength(0);
  });

  it('shares the cache across runs for one scope and shares nothing between tenants', async () => {
    const { base, requests } = params();
    const made = createResearchRuntime(base);
    if (!made.ok) throw new Error('setup');
    const first = await made.runtime.run({ scope: SCOPE, question: 'q' });
    const again = await made.runtime.run({ scope: SCOPE, question: 'q' });
    const other = await made.runtime.run({ scope: OTHER, question: 'q' });
    expect([first.ok, again.ok, other.ok]).toEqual([true, true, true]);
    expect(requests).toHaveLength(2);
  });

  it('holds a runtime to its slots per scope, and releases them when a run ends', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => void (release = resolve));
    const { base } = params();
    const slow = { ...base, slotsPerScope: 1, fetch: async (request: HttpFetchRequest) => { await gate; return base.fetch(request); } };
    const made = createResearchRuntime(slow);
    if (!made.ok) throw new Error('setup');
    const running = made.runtime.run({ scope: SCOPE, question: 'q' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const blocked = await made.runtime.run({ scope: { tenant: 'acme-co', project: 'alpha-project' }, question: 'q2', maxSteps: 1 });
    expect(blocked).toMatchObject({ ok: false });
    release();
    expect((await running).ok).toBe(true);
    const later = await made.runtime.run({ scope: SCOPE, question: 'q3' });
    expect(later.ok).toBe(true);
  });
});

