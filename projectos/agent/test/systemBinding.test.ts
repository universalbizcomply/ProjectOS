/**
 * The executables that answer governance questions and handle the secret, and what they are allowed
 * to be.
 *
 * WHY THIS FILE EXISTS. An adversarial review pointed out that `resolveBoundGit` — the function whose
 * whole purpose is that a governed repository must not choose the binary that decides whether its own
 * phase may close — accepted the first `git.exe` on PATH, including one inside the governed checkout.
 * Every `npm run` puts `<root>/node_modules/.bin` at the front of PATH, and that directory is
 * writable, gitignored, and exactly where a planted binary would sit. The sibling implementation in
 * `worker/bound-git.cjs` had the guard; this one did not.
 *
 * NOTHING HERE EXECUTES A PLANTED BINARY. The files are inert text named like executables; the tests
 * assert only which PATH the resolver returns.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  resolveBoundGit,
  resolveBoundPowerShell,
  scrubbedEnv,
  setProcessRoot,
  resetProcessRootForTest,
  nodeSystem,
} from '../src/system.js';

const dirs: string[] = [];
afterEach(() => {
  resetProcessRootForTest();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A directory holding an inert file named like the real executable. */
function planted(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'projectos-planted-'));
  dirs.push(dir);
  writeFileSync(join(dir, name), 'not a real executable');
  return dir;
}

const GIT_NAME = process.platform === 'win32' ? 'git.exe' : 'git';

describe('the git a governed repository may not choose', () => {
  it('accepts an ordinary absolute PATH directory', () => {
    const dir = planted(GIT_NAME);
    expect(resolveBoundGit({ PATH: dir })).toBe(join(dir, GIT_NAME));
  });

  it('refuses a PATH directory inside the governed checkout', () => {
    const governed = mkdtempSync(join(tmpdir(), 'projectos-governed-'));
    dirs.push(governed);
    const inside = join(governed, 'node_modules', '.bin');
    mkdirSync(inside, { recursive: true });
    writeFileSync(join(inside, GIT_NAME), 'planted');
    setProcessRoot(governed);

    // The planted binary is real and first on PATH. It is still not the answer.
    expect(resolveBoundGit({ PATH: inside })).toBeNull();
  });

  it('prefers a trusted directory over one inside the governed checkout', () => {
    const governed = mkdtempSync(join(tmpdir(), 'projectos-governed-'));
    dirs.push(governed);
    const inside = join(governed, 'node_modules', '.bin');
    mkdirSync(inside, { recursive: true });
    writeFileSync(join(inside, GIT_NAME), 'planted');
    const trusted = planted(GIT_NAME);
    setProcessRoot(governed);

    expect(resolveBoundGit({ PATH: [inside, trusted].join(delimiter) })).toBe(join(trusted, GIT_NAME));
  });

  it('refuses a UNC PATH entry, which names another host', () => {
    expect(resolveBoundGit({ PATH: String.fromCharCode(92, 92) + 'attacker/share' })).toBeNull();
  });

  it('honours an absolute bound override', () => {
    const dir = planted(GIT_NAME);
    expect(resolveBoundGit({ PROJECTOS_GIT_EXE: join(dir, GIT_NAME), PATH: '' })).toBe(join(dir, GIT_NAME));
  });
});

describe('the environment handed to the child that reads the credential', () => {
  it('drops credential-shaped names', () => {
    const out = scrubbedEnv({ OPENAI_API_KEY: 'x', SOME_TOKEN: 'y', HOME: '/home' });
    expect(out['OPENAI_API_KEY']).toBeUndefined();
    expect(out['SOME_TOKEN']).toBeUndefined();
    expect(out['HOME']).toBe('/home');
  });

  it('drops the names that decide which code a shell loads', () => {
    // `-NoProfile` suppresses profiles and not module auto-loading: `Add-Type` and `New-Object` are
    // resolved through PSModulePath, so a prepended directory redirects the credential read inside a
    // correctly bound, genuine shell.
    const out = scrubbedEnv({ PSModulePath: 'C:/evil', PATHEXT: '.EVIL', COMSPEC: 'C:/evil/cmd.exe', PATH: '/usr/bin' });
    expect(out['PSModulePath']).toBeUndefined();
    expect(out['PATHEXT']).toBeUndefined();
    expect(out['COMSPEC']).toBeUndefined();
    expect(out['PATH']).toBe('/usr/bin');
  });
});

describe('the binding survives how the command is spelled', () => {
  it('binds `git.exe` as well as `git`', () => {
    if (process.platform !== 'win32') return;
    // Both spellings must reach the SAME bound executable. Before normalisation, `git.exe` skipped the
    // binding entirely and spawned bare — the spelling the credential store itself uses.
    const plain = nodeSystem.exec('git', ['--version']);
    const spelled = nodeSystem.exec('git.exe', ['--version']);
    expect(plain.code).toBe(spelled.code);
    expect(spelled.stdout.startsWith('git version') || spelled.code === 127).toBe(true);
  });

  it('refuses to run the credential adapter when no trusted shell is bound', () => {
    const resolved = resolveBoundPowerShell({ SystemRoot: 'C:/definitely-not-a-real-system-root' });
    expect(resolved).toBeNull();
  });
});
