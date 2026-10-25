/**
 * Resolving a credential without ever holding one, and refusing in every other case.
 *
 * The tests that matter are the refusals and the silences: what is NOT in a reason string, and what
 * is NOT asked of the store before the owner has approved it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import {
  credentialRefProblems,
  unprovisionedResolver,
  inMemoryResolverForTests,
} from '../src/loop/credentialResolver.js';
import type { System } from '../src/system.js';
/**
 * THE VAULT RESOLVER IS GONE, AND SO ARE ITS TESTS.
 *
 * It resolved the OpenAI credential into the AGENT process — verify a script path, run PowerShell on
 * that path, read the secret back into a string. Under the trusted broker none of that is needed: the
 * installation resolves the value on its own side and returns an answer, never the value. The module
 * was already unwired, but it was exported, tested and one composition change away from being live,
 * and a raw-credential path that exists is a raw-credential path that can be reached.
 *
 * What its tests covered — the adapter must be the committed one, PowerShell is bound rather than
 * searched for, and both factors are required — is enforced on the trusted side and covered by
 * `brokeredTransport.test.ts`. Removed under the owner ruling of 2026-08-21, pre-live fix 4.
 */

import { resolveBoundPowerShell } from '../src/system.js';
import { CREDENTIAL_ADAPTER_REL } from '../src/nodeRuntimeRoot.js';

const REF = 'OPENAI_GATEKEEPER_KEY';
const SECRET = 'sk-proj-notarealkey000000000000000000';
const ROOT = 'C:/dev/ProjectOS';

/**
 * A System that records every command and returns what the test dictates.
 *
 * IT NOW MODELS TWO DIFFERENT CHILDREN, because the resolver runs two: git, to establish that the
 * credential adapter is the one the INSTALLATION committed, and PowerShell, to read the value. A fake
 * that answered both with the same string proved nothing about either.
 */
const ADAPTER_BYTES = '# windows-credential-store.ps1 (fixture)';
/** The one governed checkout these fixtures authorise. */
const GOVERNED_ROOT = '/governed/project';

function fakeSys(
  over: {
    exists?: boolean;
    code?: number;
    stdout?: string;
    /** Has git ever seen the adapter? */
    committed?: boolean;
    /** Does the working tree differ from HEAD? */
    dirty?: boolean;
    /** What `git show HEAD:./<rel>` returns. */
    committedBytes?: string;
    /** What the adapter actually is on disk. */
    onDiskBytes?: string;
    /** Exit code for the PowerShell child; 127 is "no trusted shell is bound". */
    shellCode?: number;
    /** Does the installation's committed allowlist name this project? */
    allowlisted?: boolean;
  } = {},
): {
  sys: System;
  calls: Array<{ cmd: string; args: readonly string[] }>;
} {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const sys = {
    exists: () => over.exists ?? true,
    readText: () => over.onDiskBytes ?? ADAPTER_BYTES,
    createExclusive: (p: string, c: string) => {
      try {
        if (existsSync(p)) return false;
        mkdirSync(join(p, '..'), { recursive: true });
        writeFileSync(p, c, { flag: 'wx' });
        return true;
      } catch {
        return false;
      }
    },
    removeFile: (p: string) => {
      try {
        rmSync(p, { force: true });
        return true;
      } catch {
        return false;
      }
    },
    renameFile: () => true,
    exec: (cmd: string, args: readonly string[]) => {
      calls.push({ cmd, args });
      if (cmd === 'git') {
        const spec = args.join(' ');
        // The installation's committed allowlist, and the checkout's canonical identity. Both are
        // asked BEFORE the credential store is touched, so the fake has to answer them.
        if (spec.includes('remote')) {
          return { code: 0, stdout: 'https://github.com/universalbizcomply/ProjectOS.git', stderr: '' };
        }
        // The checkout's shape: an ordinary full checkout rooted exactly where it says.
        if (spec.includes('--show-toplevel')) return { code: 0, stdout: GOVERNED_ROOT, stderr: '' };
        if (spec.includes('--absolute-git-dir')) return { code: 0, stdout: `${GOVERNED_ROOT}/.git`, stderr: '' };
        if (spec.includes('installation-project-allowlist')) {
          if (over.allowlisted === false) return { code: 0, stdout: '', stderr: '' };
          if (spec.includes(' diff ')) return { code: 0, stdout: '', stderr: '' };
          if (spec.includes(' log ')) return { code: 0, stdout: 'aaaaaaa', stderr: '' };
          return {
            code: 0,
            stdout: JSON.stringify({
              schemaVersion: '1.0.0',
              projects: [
                {
                  projectId: 'projectos',
                  repository: 'github.com/universalbizcomply/ProjectOS',
                  governedRoot: GOVERNED_ROOT,
                },
              ],
            }),
            stderr: '',
          };
        }
        const sub = args[2];
        if (sub === 'log') {
          return { code: 0, stdout: over.committed === false ? '' : 'aaaaaaa\n', stderr: '' };
        }
        if (sub === 'diff') {
          return { code: 0, stdout: over.dirty === true ? 'projectos/credentials/x.ps1\n' : '', stderr: '' };
        }
        return { code: 0, stdout: over.committedBytes ?? ADAPTER_BYTES, stderr: '' };
      }
      return {
        code: over.shellCode ?? over.code ?? 0,
        stdout: over.stdout ?? `${SECRET}\n`,
        stderr: '',
      };
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

describe('the test resolver', () => {
  it('is obviously a test resolver, and only answers its own reference', () => {
    const r = inMemoryResolverForTests(REF, SECRET);
    expect(r.resolve(REF).ok).toBe(true);
    expect(r.resolve('OTHER_CREDENTIAL_NAME').ok).toBe(false);
  });
});
