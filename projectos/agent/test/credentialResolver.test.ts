/**
 * Resolving a credential without ever holding one, and refusing in every other case.
 *
 * The tests that matter are the refusals and the silences: what is NOT in a reason string, and what
 * is NOT asked of the store before the owner has approved it.
 */
import { describe, it, expect } from 'vitest';
import {
  credentialRefProblems,
  unprovisionedResolver,
  inMemoryResolverForTests,
} from '../src/loop/credentialResolver.js';
import { windowsVaultResolver, VAULT_REFERENCE } from '../src/loop/windowsVaultResolver.js';
import type { System } from '../src/system.js';

const REF = 'OPENAI_GATEKEEPER_KEY';
const SECRET = 'sk-proj-notarealkey000000000000000000';
const ROOT = 'C:/dev/ProjectOS';

/** A System that records every command and returns what the test dictates. */
function fakeSys(over: { exists?: boolean; code?: number; stdout?: string } = {}): {
  sys: System;
  calls: Array<{ cmd: string; args: readonly string[] }>;
} {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const sys = {
    exists: () => over.exists ?? true,
    exec: (cmd: string, args: readonly string[]) => {
      calls.push({ cmd, args });
      return { code: over.code ?? 0, stdout: over.stdout ?? `${SECRET}\n`, stderr: '' };
    },
  } as unknown as System;
  return { sys, calls };
}

describe('a reference names a secret and is never one', () => {
  it('accepts a well-formed reference', () => {
    expect(credentialRefProblems(REF)).toEqual([]);
  });

  // THE MOST IMPORTANT CHECK: configuration holding a key where it should hold a name.
  it.each([
    'sk-proj-abcdefghijklmnop',
    'sk-ant-abcdefghijklmnop',
    'ghp_abcdefghijklmnopqrst',
    'eyJhbGciOiJIUzI1NiJ9',
    'AKIAABCDEFGHIJKLMNOP',
  ])('refuses %s without repeating it', (value) => {
    const problems = credentialRefProblems(value);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toContain('names a credential and never holds one');
    expect(problems.join(' ')).not.toContain(value);
  });

  it.each(['lower_case', 'Has Space', 'SHORT', '1STARTS_WITH_DIGIT', '', '   '])(
    'refuses %s as a reference shape',
    (value) => {
      expect(credentialRefProblems(value).length).toBeGreaterThan(0);
    },
  );

  it('refuses a missing reference with a reason about the transport', () => {
    expect(credentialRefProblems(undefined).join(' ')).toContain('cannot be called');
  });
});

describe('the unprovisioned resolver', () => {
  it('refuses and says so, rather than returning an empty secret', () => {
    const r = unprovisionedResolver('nothing is stored yet').resolve(REF);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reasons.some((x) => x.includes('has not been provisioned'))).toBe(true);
  });

  // NO SECOND CHANCE. An environment-variable fallback is how a governed system ends up running on
  // a developer's stray key.
  it('offers no fallback', () => {
    const r = unprovisionedResolver('x').resolve(REF);
    if (r.ok) throw new Error('unreachable');
    expect(r.reasons.some((x) => x.includes('no fallback is attempted'))).toBe(true);
  });
});

describe('the vault resolver', () => {
  const opts = (over: Record<string, unknown> = {}) => ({
    sys: fakeSys().sys,
    root: ROOT,
    ownerConfirmation: true,
    ...over,
  });

  it('maps the agent reference to exactly one vault reference', () => {
    expect(VAULT_REFERENCE[REF]).toBe('ProjectOS/projectos/development/openai/gatekeeper-api-key');
    expect(Object.keys(VAULT_REFERENCE)).toHaveLength(1);
  });

  // THE THIRD SEGMENT IS THE ENVIRONMENT, and this programme's plan declares `local` under a
  // production freeze. `local` is not in the grammar's frozen vocabulary, so `development` is the
  // truthful designation available — and no reference this project holds may say `production` while
  // the freeze stands.
  it('names no production environment while the programme is production-frozen', () => {
    for (const ref of Object.values(VAULT_REFERENCE)) {
      expect(ref.split('/')[2]).toBe('development');
    }
  });

  it('resolves through the existing credential store and hands the value only to the callback', () => {
    const { sys, calls } = fakeSys();
    const r = windowsVaultResolver(opts({ sys })).resolve(REF);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.use((s) => s.length)).toBe(SECRET.length);
    expect(calls[0]?.cmd).toBe('powershell');
    expect(calls[0]?.args.join(' ')).toContain('windows-credential-store.ps1');
    expect(calls[0]?.args).toContain('get');
    // The value is never a command-line argument.
    expect(calls[0]?.args.join(' ')).not.toContain(SECRET);
  });

  // THE OWNER GATE COMES BEFORE THE STORE IS TOUCHED. Reading first and deciding afterwards would
  // already have read it.
  it('does not touch the store at all without the owner\'s secrets-handling approval', () => {
    const { sys, calls } = fakeSys();
    const r = windowsVaultResolver(opts({ sys, ownerConfirmation: false })).resolve(REF);
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
    if (r.ok) throw new Error('unreachable');
    expect(r.reasons.some((x) => x.includes('secrets-handling gate receipt'))).toBe(true);
  });

  it('refuses a reference the project does not hold', () => {
    const r = windowsVaultResolver(opts()).resolve('SOME_OTHER_CREDENTIAL');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reasons.some((x) => x.includes('not a credential this project holds'))).toBe(true);
  });

  it('refuses rather than substituting a weaker store when the adapter is absent', () => {
    const r = windowsVaultResolver(opts({ sys: fakeSys({ exists: false }).sys })).resolve(REF);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reasons.some((x) => x.includes('no weaker store is substituted'))).toBe(true);
  });

  it('refuses when nothing is stored under the reference', () => {
    const r = windowsVaultResolver(opts({ sys: fakeSys({ stdout: '\n' }).sys })).resolve(REF);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reasons.some((x) => x.includes('provision it with the credentials command'))).toBe(true);
  });

  // A FAILING STORE HAS BEEN KNOWN TO QUOTE WHAT IT WAS HANDLING. The refusal text is fixed, so a
  // value in stderr cannot travel out through the reason.
  it('never repeats the store\'s own error text', () => {
    const leaky = fakeSys({ code: 1 });
    (leaky.sys as unknown as { exec: unknown }).exec = () => ({
      code: 1,
      stdout: '',
      stderr: `failed while handling ${SECRET}`,
    });
    const r = windowsVaultResolver(opts({ sys: leaky.sys })).resolve(REF);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reasons.join(' ')).not.toContain(SECRET);
  });

  it('scrubs credential-shaped environment names from the child it spawns', () => {
    const calls: Array<{ options: { scrubCredentials?: boolean } | undefined }> = [];
    const sys = {
      exists: () => true,
      exec: (_c: string, _a: readonly string[], options?: { scrubCredentials?: boolean }) => {
        calls.push({ options });
        return { code: 0, stdout: `${SECRET}\n`, stderr: '' };
      },
    } as unknown as System;
    windowsVaultResolver(opts({ sys })).resolve(REF);
    expect(calls[0]?.options?.scrubCredentials).toBe(true);
  });
});

describe('the test resolver', () => {
  it('is obviously a test resolver, and only answers its own reference', () => {
    const r = inMemoryResolverForTests(REF, SECRET);
    expect(r.resolve(REF).ok).toBe(true);
    expect(r.resolve('OTHER_CREDENTIAL_NAME').ok).toBe(false);
  });
});
