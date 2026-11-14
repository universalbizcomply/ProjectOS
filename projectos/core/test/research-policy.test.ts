import { describe, expect, it } from 'vitest';
import { createWebsitePolicy, judgeWebsite, MAX_WEBSITE_RULES } from '../src/research/index.js';
import { policyOf } from './researchFixtures.js';

describe('the website policy is a value, and a decision is a value with a reason', () => {
  it('a bare host blocks itself and its subdomains, and nothing else: the positive control', () => {
    const policy = policyOf(['example.com']);
    expect(judgeWebsite(policy, 'example.com')).toEqual({ allowed: false, reason: 'website-policy', host: 'example.com', rule: 'example.com', source: 'config' });
    expect(judgeWebsite(policy, 'a.b.example.com')).toMatchObject({ allowed: false, rule: 'example.com' });
    expect(judgeWebsite(policy, 'notexample.com')).toEqual({ allowed: true });
    expect(judgeWebsite(policy, 'example.com.evil.net')).toEqual({ allowed: true });
    expect(judgeWebsite(policy, 'example.org')).toEqual({ allowed: true });
  });

  it('a wildcard rule blocks subdomains and not the parent', () => {
    const policy = policyOf(['*.example.com']);
    expect(judgeWebsite(policy, 'a.example.com')).toMatchObject({ allowed: false, rule: '*.example.com' });
    expect(judgeWebsite(policy, 'a.b.example.com')).toMatchObject({ allowed: false });
    expect(judgeWebsite(policy, 'example.com')).toEqual({ allowed: true });
    expect(judgeWebsite(policy, 'badexample.com')).toEqual({ allowed: true });
  });

  it('reduces a rule written as a URL or with www to its host, as upstream does', () => {
    const policy = policyOf(['https://Blocked.Example/path?x=1', 'www.other.example', '  spaced.example.  ', '# a comment', '', 'third.example/with/path']);
    for (const host of ['blocked.example', 'other.example', 'sub.other.example', 'spaced.example', 'third.example']) expect(judgeWebsite(policy, host).allowed, host).toBe(false);
    expect(policy.rules.map((rule) => rule.pattern).sort()).toEqual(['blocked.example', 'other.example', 'spaced.example', 'third.example']);
  });

  it('judges a rule in punycode, as the guard spells hosts', () => {
    const policy = policyOf(['bücher.example']);
    expect(judgeWebsite(policy, 'xn--bcher-kva.example').allowed).toBe(false);
  });

  it('a disabled policy allows everything, and only an enabled one is consulted', () => {
    expect(judgeWebsite(policyOf(['example.com'], false), 'example.com')).toEqual({ allowed: true });
  });

  it('refuses the whole policy when one rule is bad, where upstream failed open', () => {
    for (const domains of [['ok.example', 42], ['ok.example', 'not a host!'], ['ok.example', { a: 1 }], ['ok.example', 'x'.repeat(300)], ['ok.example', 'http://']]) {
      const made = createWebsitePolicy({ enabled: true, domains });
      expect(made.ok, JSON.stringify(domains)).toBe(false);
    }
  });

  it('refuses a policy whose enabled flag is not exactly true or false, whose domains are not a list, or that is not an object', () => {
    for (const bad of [{ enabled: 'yes', domains: [] }, { enabled: 1, domains: [] }, { domains: [] }, { enabled: true }, { enabled: true, domains: 'a.example' }, { enabled: true, domains: null }, null, [], 'x', undefined]) {
      expect(createWebsitePolicy(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(createWebsitePolicy({ enabled: true, domains: new Array(MAX_WEBSITE_RULES + 1).fill('a.example') }).ok).toBe(false);
  });

  it('a policy object this module did not make is refused, whatever it says', () => {
    for (const forged of [{ enabled: false, rules: [], digest: 'x' }, { enabled: true, rules: [], digest: 'x' }, null, undefined, 'policy']) {
      expect(judgeWebsite(forged as never, 'example.com')).toEqual({ allowed: false, reason: 'unknown-policy' });
    }
    const real = policyOf(['a.example']);
    expect(judgeWebsite({ ...real }, 'z.example')).toEqual({ allowed: false, reason: 'unknown-policy' });
  });

  it('the digest covers what the policy decides on: order and spelling do not move it, a rule or the flag does', () => {
    const one = policyOf(['b.example', 'A.example']);
    const two = policyOf(['a.example', 'https://b.example/x']);
    expect(one.digest).toBe(two.digest);
    expect(policyOf(['a.example']).digest).not.toBe(one.digest);
    expect(policyOf(['a.example', 'b.example'], false).digest).not.toBe(one.digest);
  });

  it('records the source of each rule in the decision', () => {
    const made = createWebsitePolicy({ enabled: true, domains: ['x.example'] }, 'config/blocklist.json');
    expect(made.ok && judgeWebsite(made.policy, 'x.example')).toMatchObject({ source: 'config/blocklist.json' });
    expect(createWebsitePolicy({ enabled: true, domains: [] }, '').ok).toBe(false);
  });

  it('a policy is frozen, so a caller cannot edit the rules after they were judged', () => {
    const policy = policyOf(['a.example']);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(() => (policy.rules as unknown as unknown[]).push({ pattern: 'x', source: 'y' })).toThrow();
  });
});
