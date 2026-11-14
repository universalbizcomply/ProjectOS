import { describe, expect, it } from 'vitest';
import { fetchGuarded, judgeUrl, judgeUrlStatic, type GuardedFetchDeps } from '../src/research/index.js';
import { OPEN_POLICY, PUBLIC_IP, clockOf, fetchOf, policyOf, resolverOf, timerOf } from './researchFixtures.js';

const PUBLIC = { 'example.com': [PUBLIC_IP], 'www.example.org': ['93.184.216.35'] };

function rig(table: Parameters<typeof fetchOf>[0], dns: Parameters<typeof resolverOf>[0] = PUBLIC, policy = OPEN_POLICY) {
  const resolved = resolverOf(dns);
  const served = fetchOf(table);
  const deps: GuardedFetchDeps = { resolver: resolved.resolver, fetch: served.fetch, policy, clock: clockOf().clock, timer: timerOf() };
  return { deps, dnsCalls: resolved.calls, requests: served.requests };
}

const run = (url: string, deps: GuardedFetchDeps, over: Partial<Parameters<typeof fetchGuarded>[0]> = {}) =>
  fetchGuarded({ url, mode: 'public', maxHops: 5, maxBytes: 1000, timeoutMs: 5000, headers: {}, ...over }, deps);

describe('a URL passes the SSRF guard only when its host and every address it resolves to are public', () => {
  it('a public name resolving to a public address passes, and the port is given exactly the judged address: the positive control', async () => {
    const { deps, requests } = rig({ 'https://example.com/a': { body: 'ok' } });
    const out = await run('https://example.com/a#x', deps);
    expect(out.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: 'https://example.com/a', pinnedAddresses: [PUBLIC_IP], maxBytes: 1000, timeoutMs: 5000 });
  });

  it('refuses loopback, link-local, private, metadata and non-http(s) URLs before the port is called', async () => {
    const urls = [
      'http://127.0.0.1/', 'http://localhost/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://192.168.0.1/', 'http://172.16.9.9/',
      'http://2130706433/', 'http://0177.0.0.1/', 'http://0x7f.1/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:169.254.169.254]/', 'http://localhost./', 'http://x.localhost/',
      'http://127.0.0.1.nip.io/', 'http://metadata.google.internal/', 'http://100.100.100.200/', 'http://[fd00:ec2::254]/', 'http://0.0.0.0/', 'ftp://example.com/', 'file:///etc/passwd',
    ];
    for (const url of urls) {
      const { deps, requests } = rig({});
      const out = await run(url, deps);
      expect(out.ok, url).toBe(false);
      expect(out).toMatchObject({ refusal: { code: 'URL_REFUSED', hop: 0 } });
      expect(requests, url).toHaveLength(0);
    }
  });

  it('names a metadata address as metadata, not merely private', async () => {
    const { deps } = rig({});
    expect(await run('http://169.254.169.254/', deps)).toMatchObject({ ok: false, refusal: { reason: 'metadata-address' } });
    expect(await run('http://metadata.google.internal/', deps)).toMatchObject({ ok: false, refusal: { reason: 'metadata-host-name' } });
  });

  it('refuses a name that resolves to a private, loopback, metadata or mapped address, through the injected resolver', async () => {
    const dns = { 'a.example': ['10.0.0.1'], 'b.example': ['127.0.0.1'], 'c.example': ['169.254.169.254'], 'd.example': ['::ffff:127.0.0.1'], 'e.example': [PUBLIC_IP, '192.168.1.1'], 'f.example': ['fd00::1'] };
    for (const host of Object.keys(dns)) {
      const { deps, requests } = rig({}, dns);
      const out = await run(`https://${host}/`, deps);
      expect(out, host).toMatchObject({ ok: false, refusal: { code: 'URL_REFUSED' } });
      expect(requests).toHaveLength(0);
    }
    const { deps } = rig({}, dns);
    expect(await run('https://c.example/', deps)).toMatchObject({ refusal: { reason: 'metadata-address' } });
    expect(await run('https://b.example/', deps)).toMatchObject({ refusal: { reason: 'dns-blocked-address' } });
  });

  it('refuses a name whose second answer is private, though the first was public: DNS rebinding', async () => {
    const { deps, requests, dnsCalls } = rig({ 'https://rebind.example/': { body: 'x' } }, { 'rebind.example': [[PUBLIC_IP], ['127.0.0.1']] });
    const out = await run('https://rebind.example/', deps);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'URL_REFUSED', reason: 'dns-rebind' } });
    expect(dnsCalls).toEqual(['rebind.example', 'rebind.example']);
    expect(requests).toHaveLength(0);
  });

  it('refuses an answer that is empty, too long, not text or not an address, and a resolver that fails', async () => {
    const many = Array.from({ length: 17 }, (_, i) => `93.184.216.${i + 1}`);
    const cases: [Record<string, readonly string[] | Error>, string][] = [
      [{ 'x.example': [] }, 'dns-empty'], [{ 'x.example': many }, 'dns-too-many'], [{ 'x.example': ['not-an-ip'] }, 'dns-unparseable'], [{ 'x.example': new Error('SERVFAIL') }, 'dns-failed'],
      [{ 'x.example': [7 as unknown as string] }, 'dns-unparseable'],
    ];
    for (const [dns, reason] of cases) {
      const { deps } = rig({}, dns);
      expect(await run('https://x.example/', deps), reason).toMatchObject({ ok: false, refusal: { reason } });
    }
  });

  it('judges the website policy before the resolver is asked, and a policy this module did not make is refused', async () => {
    const { deps, dnsCalls } = rig({}, PUBLIC, policyOf(['example.com']));
    expect(await run('https://example.com/', deps)).toMatchObject({ ok: false, refusal: { reason: 'website-policy' } });
    expect(await run('https://sub.example.com/', deps)).toMatchObject({ ok: false, refusal: { reason: 'website-policy' } });
    expect(dnsCalls).toHaveLength(0);
    const forged = rig({}, PUBLIC, { enabled: false, rules: [], digest: 'x' });
    expect(await run('https://example.com/', forged.deps)).toMatchObject({ ok: false, refusal: { reason: 'unknown-policy' } });
  });

  it('a refusal repeats neither the credentials in the address nor its query', async () => {
    const { deps } = rig({});
    const out = await run('https://user:hunter2@example.com/?token=abc', deps);
    expect(JSON.stringify(out)).not.toMatch(/hunter2|abc/);
    expect(await judgeUrl('https://example.com/?api_key=zz', deps, 'public')).toEqual({ ok: false, reason: 'credential-in-query' });
  });

  it('the static judge needs no network and answers the literal and name rules alone', () => {
    expect(judgeUrlStatic('http://127.0.0.1/', OPEN_POLICY, 'public')).toMatchObject({ ok: false });
    expect(judgeUrlStatic('https://example.com/', OPEN_POLICY, 'public')).toMatchObject({ ok: true, addresses: [] });
    expect(judgeUrlStatic('http://8.8.8.8/', OPEN_POLICY, 'public')).toMatchObject({ ok: true, addresses: ['8.8.8.8'] });
  });
});

describe('a redirect is judged again at every hop', () => {
  const redirect = (to: string, status = 302) => ({ status, headers: { location: to }, body: '' });

  it('follows a redirect to another public page, judging each hop and reporting the chain', async () => {
    const { deps, requests } = rig({ 'https://example.com/a': redirect('/b'), 'https://example.com/b': redirect('https://www.example.org/c'), 'https://www.example.org/c': { body: 'done' } });
    const out = await run('https://example.com/a', deps);
    expect(out).toMatchObject({ ok: true, value: { finalUrl: { canonical: 'https://www.example.org/c' }, chain: ['https://example.com/a', 'https://example.com/b', 'https://www.example.org/c'] } });
    expect(requests.map((r) => r.pinnedAddresses[0])).toEqual([PUBLIC_IP, PUBLIC_IP, '93.184.216.35']);
  });

  it('refuses a redirect to loopback, metadata, a private name or another scheme, and the port is not called for it', async () => {
    const targets = ['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data/', 'http://internal.example/', 'ftp://example.com/x', 'file:///etc/passwd', '//127.0.0.1/', 'http://localhost:8080/', 'https://user:pw@example.com/'];
    for (const target of targets) {
      const { deps, requests } = rig({ 'https://example.com/a': redirect(target) }, { ...PUBLIC, 'internal.example': ['10.0.0.9'] });
      const out = await run('https://example.com/a', deps);
      expect(out, target).toMatchObject({ ok: false, refusal: { code: 'URL_REFUSED', hop: 1 } });
      expect(requests, target).toHaveLength(1);
    }
  });

  it('refuses a redirect to a name that resolves private, or whose answer changes, on the second hop', async () => {
    const { deps } = rig({ 'https://example.com/a': redirect('https://evil.example/') }, { ...PUBLIC, 'evil.example': [['93.184.216.40'], ['10.1.1.1']] });
    expect(await run('https://example.com/a', deps)).toMatchObject({ ok: false, refusal: { reason: 'dns-rebind', hop: 1 } });
  });

  it('stops at the hop cap, and the cap cannot be raised past the ceiling', async () => {
    const loop = { 'https://example.com/a': redirect('/a') };
    const { deps, requests } = rig(loop);
    expect(await run('https://example.com/a', deps, { maxHops: 2 })).toMatchObject({ ok: false, refusal: { code: 'TOO_MANY_REDIRECTS' } });
    expect(requests).toHaveLength(3);
    const again = rig(loop);
    await run('https://example.com/a', again.deps, { maxHops: 99 });
    expect(again.requests).toHaveLength(6);
  });

  it('refuses a redirect with no Location, and one the parser cannot resolve', async () => {
    for (const odd of [{ status: 302, headers: {}, body: '' }, redirect(''), redirect('http://[bad/'), redirect('https://exa mple.com/')]) {
      const { deps } = rig({ 'https://example.com/a': odd });
      expect(await run('https://example.com/a', deps)).toMatchObject({ ok: false, refusal: { code: 'FETCH_FAILED' } });
    }
  });

  it('every redirect status is a redirect, and 200 is not', async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const { deps, requests } = rig({ 'https://example.com/a': redirect('/b', status), 'https://example.com/b': { body: 'b' } });
      expect(await run('https://example.com/a', deps), String(status)).toMatchObject({ ok: true });
      expect(requests).toHaveLength(2);
    }
    const { deps, requests } = rig({ 'https://example.com/a': { status: 200, headers: { location: '/b' }, body: 'a' } });
    expect(await run('https://example.com/a', deps)).toMatchObject({ ok: true });
    expect(requests).toHaveLength(1);
  });
});

describe('the fetch port is held to its contract, and the caps are held to ceilings', () => {
  it('refuses a response that is not a response, and a port that throws', async () => {
    const bad = [
      { status: 99, headers: {}, body: '', bytesRead: 0, truncated: false }, { status: 200, headers: null, body: '', bytesRead: 0, truncated: false },
      { status: 200, headers: {}, body: 5, bytesRead: 0, truncated: false }, { status: 200, headers: {}, body: '', bytesRead: -1, truncated: false },
      { status: 200, headers: {}, body: '', bytesRead: 2000, truncated: false }, { status: 200, headers: {}, body: '', bytesRead: 0, truncated: 'no' }, { status: 200.5, headers: {}, body: '', bytesRead: 0, truncated: false },
    ];
    for (const response of bad) {
      const deps: GuardedFetchDeps = { ...rig({}).deps, fetch: async () => response as never };
      expect(await run('https://example.com/', deps), JSON.stringify(response)).toMatchObject({ ok: false, refusal: { code: 'FETCH_FAILED' } });
    }
    const throwing: GuardedFetchDeps = { ...rig({}).deps, fetch: async () => { throw new Error('boom: secret detail'); } };
    const out = await run('https://example.com/', throwing);
    expect(out).toMatchObject({ ok: false, refusal: { code: 'FETCH_FAILED' } });
    expect(JSON.stringify(out)).not.toContain('secret detail');
  });

  it('refuses a caller-supplied timeout, byte cap or hop count that is not a whole positive number, and holds the timeout to its ceiling', async () => {
    const { deps, requests } = rig({ 'https://example.com/': { body: 'x' } });
    for (const over of [{ timeoutMs: Number.NaN }, { timeoutMs: 0 }, { timeoutMs: -1 }, { maxBytes: 0 }, { maxBytes: Number.POSITIVE_INFINITY }, { maxHops: -1 }, { maxHops: 1.5 }]) {
      expect(await run('https://example.com/', deps, over), JSON.stringify(over)).toMatchObject({ ok: false, refusal: { code: 'INVALID_REQUEST' } });
    }
    expect(requests).toHaveLength(0);
    await run('https://example.com/', deps, { timeoutMs: 999_999_999 });
    expect(requests[0]?.timeoutMs).toBe(30_000);
  });

  it('refuses when the clock gives no usable time or goes backwards, before anything is sent', async () => {
    for (const clock of [() => Number.NaN, () => 'now' as unknown as number, () => -5, () => { throw new Error('x'); }]) {
      const base = rig({ 'https://example.com/': { body: 'x' } });
      expect(await run('https://example.com/', { ...base.deps, clock }), String(clock)).toMatchObject({ ok: false, refusal: { code: 'BAD_CLOCK' } });
      expect(base.requests).toHaveLength(0);
    }
    const times = [100, 50, 60];
    const base = rig({ 'https://example.com/a': { status: 302, headers: { location: '/b' }, body: '' }, 'https://example.com/b': { body: 'b' } });
    expect(await run('https://example.com/a', { ...base.deps, clock: () => times.shift() as number })).toMatchObject({ ok: false, refusal: { code: 'BAD_CLOCK' } });
  });
});

describe('a self-hosted endpoint keeps the metadata floor and never follows a redirect', () => {
  it('allows a loopback or private endpoint that the operator declared: the positive control', async () => {
    const { deps, requests } = rig({ 'http://127.0.0.1:8888/search': { body: '{}' }, 'http://searx.corp/x': { body: '{}' } }, { 'searx.corp': ['10.2.3.4'] });
    expect(await run('http://127.0.0.1:8888/search', deps, { mode: 'self-hosted', maxHops: 0 })).toMatchObject({ ok: true });
    expect(await run('http://searx.corp/x', deps, { mode: 'self-hosted', maxHops: 0 })).toMatchObject({ ok: true });
    expect(requests).toHaveLength(2);
  });

  it('still refuses the metadata addresses and names, and a name that resolves to one', async () => {
    const { deps, requests } = rig({}, { 'sneaky.example': ['169.254.169.254'] });
    for (const url of ['http://169.254.169.254/', 'http://metadata.google.internal/', 'http://[fd00:ec2::254]/', 'https://sneaky.example/']) {
      expect(await run(url, deps, { mode: 'self-hosted', maxHops: 0 }), url).toMatchObject({ ok: false, refusal: { code: 'URL_REFUSED' } });
    }
    expect(requests).toHaveLength(0);
  });

  it('does not follow a redirect, so an endpoint cannot send the adapter somewhere else', async () => {
    const { deps, requests } = rig({ 'http://127.0.0.1:8888/search': { status: 302, headers: { location: 'http://10.0.0.1/' }, body: '' } });
    expect(await run('http://127.0.0.1:8888/search', deps, { mode: 'self-hosted', maxHops: 0 })).toMatchObject({ ok: false, refusal: { code: 'TOO_MANY_REDIRECTS' } });
    expect(requests).toHaveLength(1);
  });
});
