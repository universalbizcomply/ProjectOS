import { describe, expect, it } from 'vitest';
import { createProviderRegistry, endpointProblem, isLoopbackHost, localEndpointProblem } from '../src/modelBroker/index.js';

describe('local model detection accepts loopback addresses only', () => {
  it('accepts the loopback forms: the positive control', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', '127.255.255.254', '[::1]', '::1', 'localhost', 'LOCALHOST']) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it('refuses everything else, including names that only look local', () => {
    const refused = [
      '0.0.0.0', '10.0.0.1', '192.168.1.5', '172.16.0.1', '169.254.169.254', '8.8.8.8', '128.0.0.1', '126.255.255.255',
      'localhost.evil.com', 'evil.localhost.com', '127.0.0.1.nip.io', '127.0.0.1.evil.com', 'example.com', '',
      '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::]', '[::2]', '[fe80::1]', '2130706433', '0x7f000001', '017700000001', '127.1', '127.0.0', '127.0.0.256', '127.0.0.1 ', ' 127.0.0.1',
    ];
    for (const host of refused) expect(isLoopbackHost(host), host).toBe(false);
  });

  it('judges the host the URL really names, not the text before an @', () => {
    expect(localEndpointProblem('http://127.0.0.1:11434')).toBeNull();
    expect(localEndpointProblem('http://localhost:1234/v1')).toBeNull();
    expect(localEndpointProblem('http://[::1]:8080')).toBeNull();
    for (const url of ['http://127.0.0.1@evil.com/', 'http://evil.com/127.0.0.1', 'http://evil.com:11434', 'http://10.0.0.2:11434', 'https://api.openai.com', 'http://127.0.0.1:11434@evil.com', 'ftp://127.0.0.1', 'not a url', 'http://user:pw@127.0.0.1:11434', 'http://127.0.0.1:11434/?x=1', 'http://127.0.0.1:11434/#f', 'http://127.0.0.1:99999']) {
      expect(localEndpointProblem(url), url).not.toBeNull();
    }
  });

  it('a local provider record must name a loopback endpoint, and a hosted one may not', () => {
    const ok = createProviderRegistry([{ name: 'ollama', kind: 'local', api: 'ollama', baseUrl: 'http://127.0.0.1:11434' }]);
    expect(ok.ok).toBe(true);
    const far = createProviderRegistry([{ name: 'ollama', kind: 'local', api: 'ollama', baseUrl: 'http://10.1.1.1:11434' }]);
    expect(far.ok).toBe(false);
    const none = createProviderRegistry([{ name: 'ollama', kind: 'local', api: 'ollama' }]);
    expect(none.ok).toBe(false);
    const disguised = createProviderRegistry([{ name: 'h', kind: 'hosted', api: 'openai-completions', baseUrl: 'http://127.0.0.1:1' }]);
    expect(disguised.ok).toBe(false);
  });
});

describe('a custom OpenAI-compatible endpoint is a record, not a free address', () => {
  const record = (baseUrl: unknown) => ({ name: 'mine', kind: 'custom-openai-compatible', api: 'openai-completions', baseUrl, credentialRef: 'provider.mine' });

  it('needs https and a public name: the positive control', () => {
    expect(endpointProblem({ kind: 'custom-openai-compatible', baseUrl: 'https://llm.example.com/v1' })).toBeNull();
    expect(createProviderRegistry([record('https://llm.example.com/v1')]).ok).toBe(true);
  });

  it('refuses plain http, a missing address, credentials in the address, a query, a fragment and a bad port', () => {
    for (const url of ['http://llm.example.com/v1', undefined, '', 'https://user:pw@llm.example.com', 'https://llm.example.com/v1?key=1', 'https://llm.example.com/#x', 'https://llm.example.com:0', 'https://llm.example.com:70000', 'ws://llm.example.com', '//llm.example.com', 'https://', 'javascript:alert(1)']) {
      expect(createProviderRegistry([record(url)]).ok, String(url)).toBe(false);
    }
  });

  it('refuses an address that points back at this machine or its network, so a custom record cannot reach them', () => {
    for (const url of ['https://127.0.0.1/v1', 'https://localhost/v1', 'https://[::1]/v1', 'https://10.0.0.1/v1', 'https://192.168.0.1/v1', 'https://172.20.0.1/v1', 'https://169.254.169.254/latest', 'https://0.0.0.0/', 'https://[fe80::1]/v1', 'https://[2001:db8::1]/v1']) {
      expect(createProviderRegistry([record(url)]).ok, url).toBe(false);
    }
  });

  it('refuses internal-looking and wildcard-DNS names, which can resolve to this machine or its network', () => {
    for (const url of ['https://api.localhost/v1', 'https://svc.internal/v1', 'https://printer.local/v1', 'https://corp.svc.internal/v1', 'https://127.0.0.1.nip.io/v1', 'https://a.b.sslip.io/v1', 'https://x.xip.io/v1']) {
      expect(createProviderRegistry([record(url)]).ok, url).toBe(false);
    }
    expect(createProviderRegistry([record('https://llm.example.com/v1')]).ok).toBe(true);
    expect(createProviderRegistry([record('https://notnip.io/v1')]).ok).toBe(true);
  });
});
