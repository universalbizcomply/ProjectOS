import { describe, expect, it } from 'vitest';
import { classifyAddress, hostNameProblem, parseWebUrl, parseIpv6, normalizeHostName } from '../src/research/index.js';

const PAGE_PORTS = [80, 443, 8080, 8443];
const parse = (input: unknown) => parseWebUrl(input, PAGE_PORTS);

describe('one URL is read one way, and two spellings of one target are one key', () => {
  it('a plain https URL parses to its canonical form: the positive control', () => {
    const parsed = parse('https://Example.COM/a/b?x=1#frag');
    expect(parsed).toEqual({ ok: true, url: { scheme: 'https', host: 'example.com', hostKind: 'name', port: 443, canonical: 'https://example.com/a/b?x=1' } });
  });

  it('case, default ports, fragments, a trailing dot and punycode all give one canonical form', () => {
    const spellings = ['https://example.com/p', 'HTTPS://EXAMPLE.COM:443/p#top', 'https://example.com./p', 'https://EXAMPLE.com:443/p?#'];
    const forms = spellings.map((s) => (parse(s) as { ok: true; url: { canonical: string } }).url.canonical);
    expect(new Set(forms.slice(0, 3)).size).toBe(1);
    const idn = parse('https://bücher.example/p') as { ok: true; url: { host: string } };
    expect(idn.url.host).toBe('xn--bcher-kva.example');
  });

  it('refuses every scheme that is not http or https, and an authority not introduced by two slashes', () => {
    for (const url of ['ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'gopher://example.com', 'ws://example.com', 'mailto:a@b.co']) {
      expect(parse(url), url).toMatchObject({ ok: false, reason: 'not-http-scheme' });
    }
    for (const url of ['http:/example.com', 'http:example.com', 'https:\\\\example.com']) expect(parse(url), url).toMatchObject({ ok: false });
    expect(parse('example.com/page')).toMatchObject({ ok: false, reason: 'invalid-url' });
    expect(parse('')).toMatchObject({ ok: false });
    expect(parse(undefined)).toMatchObject({ ok: false });
    expect(parse(42)).toMatchObject({ ok: false });
  });

  it('refuses credentials in the URL, in every spelling', () => {
    for (const url of ['https://user:pw@example.com/', 'https://user@example.com/', 'https://example.com@evil.com/', 'https://:pw@example.com/', 'https://127.0.0.1:8080@1.1.1.1/']) {
      expect(parse(url), url).toMatchObject({ ok: false, reason: 'userinfo-in-url' });
    }
  });

  it('refuses what two parsers could read two ways: a backslash, whitespace, control characters and a percent-encoded host', () => {
    const odd = ['https://example.com\\@evil.com/', 'https://exa mple.com/', 'https://example.com/\tx', 'https://example.com/\nx', 'https://example.com/\u0000', 'https://%65xample.com/', ' https://example.com/', 'https://example.com/ '];
    for (const url of odd) expect(parse(url), JSON.stringify(url)).toMatchObject({ ok: false });
  });

  it('refuses a credential-named query parameter and leaves page facets alone', () => {
    for (const url of ['https://example.com/?token=abc', 'https://example.com/?api_key=abc', 'https://example.com/?X-Amz-Signature=abc', 'https://example.com/?a=1&password=x', 'https://example.com/?access%5Ftoken=x', 'https://example.com/?key=color', 'https://example.com/?session=1']) {
      expect(parse(url), url).toMatchObject({ ok: false, reason: 'credential-in-query' });
    }
    for (const url of ['https://example.com/?code=7', 'https://example.com/?token=', 'https://example.com/?page=2&sort=asc']) expect(parse(url), url).toMatchObject({ ok: true });
  });

  it('holds a page to a short list of ports, and an API endpoint to none', () => {
    expect(parse('https://example.com:3000/')).toMatchObject({ ok: false, reason: 'blocked-port' });
    expect(parse('http://example.com:8080/')).toMatchObject({ ok: true });
    expect(parseWebUrl('http://example.com:3000/', null)).toMatchObject({ ok: true });
  });

  it('turns decimal, octal, hex and shorthand IPv4 spellings into the dotted address they are', () => {
    for (const url of ['http://2130706433/', 'http://0177.0.0.1/', 'http://0x7f.1/', 'http://127.1/', 'http://0x7f000001/', 'http://127.0.0.1./']) {
      expect(parse(url), url).toMatchObject({ ok: true, url: { host: '127.0.0.1', hostKind: 'ipv4' } });
    }
    expect(parse('http://1.2.3.256/')).toMatchObject({ ok: false });
  });

  it('keeps an IPv6 literal in brackets and the mapped form as the parser spells it', () => {
    expect(parse('http://[::ffff:127.0.0.1]/')).toMatchObject({ ok: true, url: { host: '[::ffff:7f00:1]', hostKind: 'ipv6' } });
  });
});

describe('an address is public or it is refused', () => {
  const blocked = (text: string) => classifyAddress(text);

  it('the public addresses pass: the positive control', () => {
    for (const ok of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e']) expect(blocked(ok), ok).toEqual({ blocked: false });
  });

  it('refuses loopback, private, link-local, CGNAT, unspecified, multicast and reserved IPv4, with the class', () => {
    const table: Record<string, string> = {
      '127.0.0.1': 'loopback-address', '127.255.255.254': 'loopback-address', '10.0.0.1': 'private-address', '172.16.0.1': 'private-address', '172.31.255.255': 'private-address',
      '192.168.1.1': 'private-address', '169.254.1.1': 'link-local-address', '100.64.0.1': 'cgnat-address', '100.127.255.255': 'cgnat-address', '0.0.0.0': 'unspecified-address',
      '224.0.0.1': 'multicast-address', '240.0.0.1': 'reserved-address', '255.255.255.255': 'reserved-address', '198.18.0.1': 'benchmark-address', '192.0.2.1': 'documentation-address',
    };
    for (const [address, reason] of Object.entries(table)) expect(blocked(address), address).toEqual({ blocked: true, reason });
    for (const near of ['172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.0.1', '11.0.0.1']) expect(blocked(near), near).toEqual({ blocked: false });
  });

  it('names the cloud metadata addresses on their own, in IPv4 and in the wrapped forms', () => {
    for (const address of ['169.254.169.254', '169.254.170.2', '169.254.169.253', '100.100.100.200', 'fd00:ec2::254', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:0:169.254.169.254', '[fd00:ec2::254]']) {
      expect(blocked(address), address).toEqual({ blocked: true, reason: 'metadata-address' });
    }
  });

  it('refuses loopback, private and wrapped IPv6, and every range outside 2000::/3', () => {
    const refused = ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:0:127.0.0.1', '::127.0.0.1', '::2', '64:ff9b::1.2.3.4', '2002:7f00:1::', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1', '2001:1::1', '100::1', '1::1', '4000::1', '[::1]'];
    for (const address of refused) expect(blocked(address).blocked, address).toBe(true);
    expect(blocked('::ffff:8.8.8.8')).toEqual({ blocked: false });
  });

  it('refuses an answer that is not an address, in any shape', () => {
    for (const odd of ['', 'localhost', '127.0.0', '127.0.0.1.1', '256.1.1.1', '01.2.3.4', '1.2.3.04', '::g', '1:2:3', ':::', '1::2::3', '12345::1', ' 1.1.1.1', '1.1.1.1 ', 'example.com', '0x7f.0.0.1', '2130706433']) {
      expect(blocked(odd), JSON.stringify(odd)).toEqual({ blocked: true, reason: 'unparseable-address' });
    }
    for (const notText of [undefined, null, 7, {}, []]) expect(classifyAddress(notText)).toEqual({ blocked: true, reason: 'unparseable-address' });
  });

  it('reads an IPv6 address into eight groups, with a dotted tail and compression', () => {
    expect(parseIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(parseIpv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIpv6('1:2:3:4:5:6:7:8:9')).toBeNull();
  });
});

describe('a host NAME is refused when it means this machine or its network', () => {
  it('a public name passes: the positive control', () => {
    for (const ok of ['example.com', 'a.b.example.co.uk', 'xn--bcher-kva.example', 'not-nip.io.example.com', 'localhost-news.com', 'my-local.example']) expect(hostNameProblem(ok), ok).toBeNull();
  });

  it('refuses localhost and .localhost, in any case and with trailing dots', () => {
    for (const name of ['localhost', 'LOCALHOST', 'localhost.', 'localhost..', 'foo.localhost', 'a.b.localhost']) expect(hostNameProblem(normalizeHostName(name)), name).not.toBeNull();
    expect(normalizeHostName('LocalHost..')).toBe('localhost');
  });

  it('refuses internal and local suffixes, and names the metadata hosts', () => {
    for (const name of ['printer.local', 'db.internal', 'a.corp', 'router.lan', 'nas.home', 'x.localdomain', 'foo.home.arpa', 'intranet.corp', '1.0.0.127.in-addr.arpa']) expect(hostNameProblem(name), name).not.toBeNull();
    for (const name of ['metadata.google.internal', 'metadata.goog', 'instance-data', 'sub.metadata.goog']) expect(hostNameProblem(name), name).toBe('metadata-host-name');
  });

  it('refuses wildcard-DNS services, where the name carries the address', () => {
    for (const name of ['127.0.0.1.nip.io', 'a.sslip.io', 'x.xip.io', 'foo.lvh.me', 'x.localtest.me', 'a.vcap.me', 'a.lacolhost.com', 'a.traefik.me', 'nip.io']) expect(hostNameProblem(name), name).toBe('wildcard-dns-host');
  });

  it('refuses a single-label name, an empty label and a name that ends in digits', () => {
    expect(hostNameProblem('printserver')).toBe('single-label-host');
    expect(hostNameProblem('a..b')).toBe('invalid-host-name');
    expect(hostNameProblem('-a.example.com')).toBe('invalid-host-name');
    expect(hostNameProblem('1.2.3.4.5')).toBe('invalid-host-name');
    expect(hostNameProblem('under_score.example.com')).toBeNull();
    expect(hostNameProblem('')).toBe('invalid-host-name');
  });
});
