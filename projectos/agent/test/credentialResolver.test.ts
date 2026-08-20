/**
 * Resolving a credential without ever holding one, and refusing in every other case.
 *
 * The tests that matter are the refusals and the silences: what is NOT in a reason string, and what
 * is NOT asked of the store before the owner has approved it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import {
  credentialRefProblems,
  unprovisionedResolver,
  inMemoryResolverForTests,
} from '../src/loop/credentialResolver.js';
import { windowsVaultResolver, VAULT_REFERENCE } from '../src/loop/windowsVaultResolver.js';
import type { System } from '../src/system.js';
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
        if (spec.includes('installation-project-allowlist')) {
          if (over.allowlisted === false) return { code: 0, stdout: '', stderr: '' };
          if (spec.includes(' diff ')) return { code: 0, stdout: '', stderr: '' };
          if (spec.includes(' log ')) return { code: 0, stdout: 'aaaaaaa', stderr: '' };
          return {
            code: 0,
            stdout: JSON.stringify({
              schemaVersion: '1.0.0',
              projects: [{ projectId: 'projectos', repository: 'github.com/universalbizcomply/ProjectOS' }],
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

describe('the vault resolver', () => {
  const opts = (over: Record<string, unknown> = {}) => ({
    sys: fakeSys().sys,
    // The TRUSTED INSTALLATION, which is deliberately not the governed project root.
    runtime: { installRoot: '/install/ProjectOS', adapterRelPath: CREDENTIAL_ADAPTER_REL },
    governedRoot: '/install/ProjectOS',
    projectId: 'projectos',
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
    // GIT RUNS FIRST, and that ordering is the point: the adapter's provenance is established before
    // it is executed, not after.
    expect(calls[0]?.cmd).toBe('git');
    const shell = calls.find((c) => c.cmd === 'powershell');
    expect(shell).toBeDefined();
    expect(shell?.args.join(' ')).toContain('windows-credential-store.ps1');
    // The adapter that runs is the INSTALLATION'S, never one inside the governed project.
    expect(shell?.args.join(' ').split(String.fromCharCode(92)).join('/')).toContain('/install/ProjectOS');
    expect(shell?.args).toContain('get');
    // The value is never a command-line argument.
    expect(shell?.args.join(' ')).not.toContain(SECRET);
  });

  // THE OWNER GATE COMES BEFORE THE STORE IS TOUCHED. Reading first and deciding afterwards would
  // already have read it.
  it('does not touch the store at all without the owner\'s secrets-handling approval', () => {
    const { sys, calls } = fakeSys();
    const r = windowsVaultResolver(opts({ sys, ownerConfirmation: false })).resolve(REF);
    expect(r.ok).toBe(false);
    // The credential STORE is untouched. Git runs first — the installation is asked whether it
    // will spend on this project at all — but no shell is spawned and no value is read.
    expect(calls.some((c) => c.cmd === 'powershell')).toBe(false);
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
      readText: () => ADAPTER_BYTES,
      renameFile: () => true,
      exec: (c: string, a: readonly string[], options?: { scrubCredentials?: boolean }) => {
        // Git answers as a clean, committed adapter so the integrity check passes and the
        // PowerShell child is actually reached — it is that child's options under test.
        if (c === 'git') {
          const spec = a.join(' ');
          if (spec.includes('remote')) {
            return { code: 0, stdout: 'https://github.com/universalbizcomply/ProjectOS.git', stderr: '' };
          }
          if (spec.includes('installation-project-allowlist')) {
            if (spec.includes(' diff ')) return { code: 0, stdout: '', stderr: '' };
            if (spec.includes(' log ')) return { code: 0, stdout: 'aaaaaaa', stderr: '' };
            return {
              code: 0,
              stdout: JSON.stringify({
                schemaVersion: '1.0.0',
                projects: [{ projectId: 'projectos', repository: 'github.com/universalbizcomply/ProjectOS' }],
              }),
              stderr: '',
            };
          }
          return { code: 0, stdout: a[2] === 'diff' ? '' : ADAPTER_BYTES, stderr: '' };
        }
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

describe('the credential adapter belongs to the installation, and must be the committed one', () => {
  const opts = (over: Record<string, unknown> = {}) => ({
    sys: fakeSys().sys,
    runtime: { installRoot: '/install/ProjectOS', adapterRelPath: CREDENTIAL_ADAPTER_REL },
    governedRoot: '/install/ProjectOS',
    projectId: 'projectos',
    ownerConfirmation: true,
    ...over,
  });

  it('asks git about the INSTALLATION, never about the governed project', () => {
    const { sys, calls } = fakeSys();
    windowsVaultResolver(opts({ sys })).resolve(REF);
    const git = calls.filter((c) => c.cmd === 'git');
    expect(git.length).toBeGreaterThan(0);
    for (const call of git) {
      expect(call.args.slice(0, 2)).toEqual(['-C', '/install/ProjectOS']);
    }
    // `HEAD:./<rel>` — without `./` a nested installation would read the outer repository's adapter.
    expect(git.some((c) => c.args.join(' ').includes(`HEAD:./${CREDENTIAL_ADAPTER_REL}`))).toBe(true);
  });

  it('refuses an adapter git has never seen', () => {
    const r = windowsVaultResolver(opts({ sys: fakeSys({ committed: false }).sys })).resolve(REF);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reasons.join(' ')).toContain('does not match the committed bytes');
  });

  it('refuses an adapter that has been changed in the working tree', () => {
    const { sys, calls } = fakeSys({ dirty: true });
    const r = windowsVaultResolver(opts({ sys })).resolve(REF);
    expect(r.ok).toBe(false);
    // AND THE SHELL WAS NEVER SPAWNED. Refusing after running it would be a report, not a control.
    expect(calls.some((c) => c.cmd === 'powershell')).toBe(false);
  });

  it('refuses when the bytes on disk are not the bytes git committed', () => {
    // The case `git diff` cannot see: the tracked path replaced by a link to something else.
    const { sys, calls } = fakeSys({ onDiskBytes: '# a different script entirely' });
    const r = windowsVaultResolver(opts({ sys })).resolve(REF);
    expect(r.ok).toBe(false);
    expect(calls.some((c) => c.cmd === 'powershell')).toBe(false);
  });

  it('accepts a checkout whose only difference is line endings', () => {
    const crlf = `${ADAPTER_BYTES.split(String.fromCharCode(10)).join(String.fromCharCode(13, 10))}`;
    const r = windowsVaultResolver(opts({ sys: fakeSys({ onDiskBytes: crlf }).sys })).resolve(REF);
    expect(r.ok).toBe(true);
  });

  it('refuses when no trusted shell is bound, and says which control refused', () => {
    const r = windowsVaultResolver(opts({ sys: fakeSys({ shellCode: 127 }).sys })).resolve(REF);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reasons.join(' ')).toContain('no trusted PowerShell executable is bound');
  });

  it('never names the credential value in any refusal', () => {
    for (const over of [{ committed: false }, { dirty: true }, { onDiskBytes: 'x' }, { shellCode: 127 }]) {
      const r = windowsVaultResolver(opts({ sys: fakeSys(over).sys })).resolve(REF);
      if (r.ok) continue;
      expect(r.reasons.join(' ')).not.toContain(SECRET);
    }
  });
});

describe('the PowerShell that handles the secret is bound, not searched for', () => {
  const WIN = process.platform === 'win32';
  const plantedDirs: string[] = [];
  afterEach(() => {
    for (const d of plantedDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('honours an absolute bound executable', () => {
    const bound = WIN ? 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : '/bin/sh';
    const resolved = resolveBoundPowerShell({ PROJECTOS_POWERSHELL_EXE: bound, SystemRoot: 'C:/Windows' });
    // Only accepted when it really exists and is named powershell.exe; otherwise the canonical path.
    expect(resolved === null || resolved.toLowerCase().endsWith('powershell.exe')).toBe(true);
  });

  /**
   * A REAL directory holding a REAL file called `powershell.exe`.
   *
   * The first version of these tests pointed at paths that did not exist, so `isFile` refused and the
   * test passed no matter what the resolver did — deleting the absolute-path check and reinstating the
   * PATH search both survived. A planted binary has to actually be there for the refusal to mean
   * anything. The file is inert text; nothing executes it.
   */
  const plantedShell = (): { dir: string; exe: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'projectos-fake-shell-'));
    plantedDirs.push(dir);
    const exe = join(dir, 'powershell.exe');
    writeFileSync(exe, 'not a real shell');
    return { dir, exe: exe.split(String.fromCharCode(92)).join('/') };
  };

  it('refuses a RELATIVE path even when a file of that name really exists there', () => {
    const { exe } = plantedShell();
    const relativeToCwd = relative(process.cwd(), exe).split(String.fromCharCode(92)).join('/');
    expect(existsSync(exe)).toBe(true);
    const resolved = resolveBoundPowerShell({
      PROJECTOS_POWERSHELL_EXE: relativeToCwd,
      SystemRoot: 'C:/nonexistent',
    });
    expect(resolved).toBeNull();
  });

  it('refuses a real file that is not named powershell.exe', () => {
    const { dir } = plantedShell();
    const other = join(dir, 'cmd.exe');
    writeFileSync(other, 'not a real shell');
    const resolved = resolveBoundPowerShell({
      PROJECTOS_POWERSHELL_EXE: other,
      SystemRoot: 'C:/nonexistent',
    });
    expect(resolved).toBeNull();
  });

  it('never resolves from PATH, so a REAL shadowing binary cannot become the credential process', () => {
    const { dir, exe } = plantedShell();
    expect(existsSync(exe)).toBe(true);
    const resolved = resolveBoundPowerShell({ PATH: dir, SystemRoot: 'C:/nonexistent' });
    expect(resolved).toBeNull();
  });

  it('never resolves from the current directory either', () => {
    const { dir } = plantedShell();
    const resolved = resolveBoundPowerShell({ PATH: `.${delimiter}${dir}`, SystemRoot: 'C:/nonexistent' });
    expect(resolved).toBeNull();
  });

  it('resolves the canonical Windows shell when nothing is bound', () => {
    if (!WIN) return;
    const resolved = resolveBoundPowerShell({ SystemRoot: process.env['SystemRoot'] ?? 'C:/Windows' });
    expect(resolved).not.toBeNull();
    expect(resolved?.toLowerCase()).toContain('system32');
  });
});

describe('two factors, both required, neither sufficient', () => {
  const opts = (over: Record<string, unknown> = {}) => ({
    sys: fakeSys().sys,
    runtime: { installRoot: '/install/ProjectOS', adapterRelPath: CREDENTIAL_ADAPTER_REL },
    governedRoot: '/governed/project',
    projectId: 'projectos',
    ownerConfirmation: true,
    ...over,
  });

  it('installation allows AND owner approved: the store is reached', () => {
    const { sys, calls } = fakeSys();
    const r = windowsVaultResolver(opts({ sys })).resolve(REF);
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.cmd === 'powershell')).toBe(true);
  });

  it('installation allows, owner did NOT approve: refused, store untouched', () => {
    const { sys, calls } = fakeSys();
    const r = windowsVaultResolver(opts({ sys, ownerConfirmation: false })).resolve(REF);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reasons.join(' ')).toContain('owner has not approved credential use');
    expect(calls.some((c) => c.cmd === 'powershell')).toBe(false);
  });

  it('owner approved, installation does NOT allow: refused, store untouched', () => {
    // This is the external project that wrote itself an APPROVE receipt. Its own approval is real and
    // it changes nothing, because the installation never named it.
    const { sys, calls } = fakeSys({ allowlisted: false });
    const r = windowsVaultResolver(opts({ sys })).resolve(REF);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reasons.join(' ')).toContain('credential allowlist');
    expect(calls.some((c) => c.cmd === 'powershell')).toBe(false);
  });

  it('the installation is asked BEFORE the owner gate, and before any adapter check', () => {
    const { sys, calls } = fakeSys({ allowlisted: false });
    windowsVaultResolver(opts({ sys, ownerConfirmation: false })).resolve(REF);
    // Nothing about the adapter was even asked: the first refusal is the installation's.
    expect(calls.some((c) => c.args.join(' ').includes('windows-credential-store.ps1'))).toBe(false);
  });

  it('names no credential value in any refusal', () => {
    for (const over of [{ allowlisted: false }, {}]) {
      const r = windowsVaultResolver(opts({ sys: fakeSys(over).sys, ownerConfirmation: false })).resolve(REF);
      if (r.ok) continue;
      expect(r.reasons.join(' ')).not.toContain(SECRET);
    }
  });
});
