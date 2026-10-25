/**
 * The search path a configured check's child actually gets, and whether git can RUN in it.
 *
 * `ensureSystemPath` already added the bound git's own directory, because with no git reachable the
 * owner's suites died on ENOENT and the check reported a result about the environment wearing the
 * costume of a result about the code. This file exists because that fix stopped one layer short.
 *
 * Git for Windows ships `git.exe` in `mingw64\bin` and its MSYS2 runtime in `usr\bin` of the same
 * installation. With only the binary's own directory reachable, `git.exe` starts and answers
 * ordinary questions — rev-parse, status, log — then dies with an ACCESS_VIOLATION (0xC0000005) and
 * NO stderr the moment it has to spawn a helper, which a push to a local remote always does. Every
 * E2E fixture in this suite that pushes failed exactly that way inside a governed run, in files
 * nobody had touched, while passing when run by hand.
 *
 * Created in PROJECTOS-B9-CHECK-ENVIRONMENT-REPAIR1A.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { gitRuntimeDirs, resolveBoundGit, nodeSystem, setProcessRoot, resetProcessRootForTest } from '../src/system.js';

const planted: string[] = [];
afterEach(() => {
  resetProcessRootForTest();
  for (const d of planted.splice(0)) rmSync(d, { recursive: true, force: true });
});

const GIT = resolveBoundGit(process.env);
/**
 * SKIPPED, NOT SILENTLY PASSED. A bare `return` in a platform guard runs no assertion and vitest
 * still reports the test green, so the two proofs that matter most here would vanish without a
 * trace on a runner that binds no git. `skipIf` makes the absence visible in the report.
 */
const UNPROVABLE_HERE = process.platform !== 'win32' || GIT === null;

/** Narrowing for the guarded tests. `skipIf` guarantees it, but the compiler cannot know that. */
function boundGit(): string {
  if (GIT === null) throw new Error('unreachable: skipIf guards every caller');
  return GIT;
}

describe('gitRuntimeDirs', () => {
  it('contributes nothing when no git is bound', () => {
    expect(gitRuntimeDirs(null)).toEqual([]);
  });

  it.skipIf(GIT === null)('always offers the bound executable a directory it can be found in', () => {
    expect(gitRuntimeDirs(boundGit())[0]).toBe(dirname(boundGit()));
  });

  it.skipIf(UNPROVABLE_HERE)('offers the runtime directory the helpers load, not merely the binary directory', () => {
    const dirs = gitRuntimeDirs(boundGit());
    // Re-checked with a fresh `existsSync` rather than trusting the production predicate, so the
    // test cannot pass merely because the implementation agrees with itself.
    const runtime = dirs.filter((d) => existsSync(join(d, 'msys-2.0.dll')));
    expect(runtime.length, `no MSYS runtime directory among ${dirs.join(', ')}`).toBeGreaterThan(0);
  });

  /**
   * THE NEGATIVE, AGAINST A DIRECTORY THAT REALLY EXISTS.
   *
   * A first version of this test pointed at a path whose parents were never created, which proved
   * nothing: `isFile` answers false identically for "this directory has no marker" and "this
   * directory is not there", so it would have passed unchanged had the implementation checked mere
   * directory existence. Git for Windows ships `Git\bin` beside `Git\usr\bin` — it exists, it holds
   * `bash.exe`, and it does NOT hold `msys-2.0.dll` — so excluding it while including its sibling is
   * the marker discrimination actually being claimed. Found by security review.
   */
  it.skipIf(UNPROVABLE_HERE)('NEGATIVE: excludes a real sibling directory that lacks the runtime marker', () => {
    const root = dirname(dirname(dirname(boundGit())));
    const withoutMarker = join(root, 'bin');
    const withMarker = join(root, 'usr', 'bin');
    // The case only proves anything while the installation really is shaped this way.
    if (!existsSync(withoutMarker) || existsSync(join(withoutMarker, 'msys-2.0.dll'))) {
      return expect(existsSync(withMarker)).toBe(true);
    }
    const dirs = gitRuntimeDirs(boundGit());
    expect(dirs, 'a directory carrying no runtime must not be contributed').not.toContain(withoutMarker);
    expect(dirs, 'and the one that does carry it must be').toContain(withMarker);
  });

  /**
   * THE TWO SPATIAL REFUSALS, CHECKED. `resolveBoundGit` refuses a UNC binary and one inside the
   * governed checkout; the climb must not reintroduce either through a directory. Both are proven
   * from the returned list rather than from the argument that they cannot happen.
   */
  it('NEVER contributes a UNC directory — including the binary’s own', () => {
    const unc = ['', '', 'host', 'share', 'Git', 'mingw64', 'bin', 'git.exe'].join(String.fromCharCode(92));
    expect(unc.startsWith(String.fromCharCode(92, 92)), 'fixture must really be UNC').toBe(true);
    // Nothing at all, not merely "nothing after the first entry". An earlier version of this test
    // skipped index 0, which is exactly where the unguarded case was. Found by review.
    expect(gitRuntimeDirs(unc)).toEqual([]);
  });

  /**
   * THE IN-CHECKOUT REFUSAL, PROVEN BY PLANTING ONE. Asserting against the real installation proves
   * nothing: no real candidate can land inside the repository by accident, so the check could be
   * deleted and every other test would still pass. Here a fully qualifying runtime directory - it
   * carries the marker - is planted INSIDE a governed root, and must still be refused. Same
   * mkdtemp/setProcessRoot fixture `systemBinding.test.ts` uses for the same refusal on the binary.
   */
  it('NEVER contributes a directory inside the governed checkout, even a valid one', () => {
    const governed = mkdtempSync(join(tmpdir(), 'projectos-governed-'));
    planted.push(governed);
    const runtime = join(governed, 'Git', 'usr', 'bin');
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, 'msys-2.0.dll'), 'planted');
    const binDir = join(governed, 'Git', 'mingw64', 'bin');
    mkdirSync(binDir, { recursive: true });
    setProcessRoot(governed);

    // The binary's own directory is inside the checkout, so the whole answer is nothing.
    expect(gitRuntimeDirs(join(binDir, 'git.exe'))).toEqual([]);
  });

  it('refuses a planted runtime reached by DESCENT from an outside binary', () => {
    // The case the transitive argument does NOT cover: the binary sits outside the governed root,
    // but the climb descends into `usr/bin` that lies inside it.
    const base = mkdtempSync(join(tmpdir(), 'projectos-descent-'));
    planted.push(base);
    const gitRoot = join(base, 'Git');
    const binDir = join(gitRoot, 'mingw64', 'bin');
    mkdirSync(binDir, { recursive: true });
    const runtime = join(gitRoot, 'usr', 'bin');
    mkdirSync(runtime, { recursive: true });
    writeFileSync(join(runtime, 'msys-2.0.dll'), 'planted');

    setProcessRoot(base + '_elsewhere');
    expect(gitRuntimeDirs(join(binDir, 'git.exe')), 'outside any root, the runtime IS contributed')
      .toContain(runtime);

    setProcessRoot(join(gitRoot, 'usr'));
    expect(gitRuntimeDirs(join(binDir, 'git.exe')), 'governed root now contains it, so it is refused')
      .not.toContain(runtime);
  });

  it('contributes only the binary directory when nothing around it carries the runtime', () => {
    const lone = join(tmpdir(), 'no-such-install', 'cmd', 'git.exe');
    expect(gitRuntimeDirs(lone)).toEqual([join(tmpdir(), 'no-such-install', 'cmd')]);
  });
});

describe('a configured check can actually push', () => {
  it.skipIf(UNPROVABLE_HERE)('completes a local push in the environment a check child receives', () => {
    const git = boundGit();
    // The PATH a check's child is really handed, observed rather than reconstructed.
    const seen = nodeSystem.exec(process.execPath, ['-e', 'process.stdout.write(process.env.PATH||"")'], {
      scrubCredentials: true,
      cwd: process.cwd(),
      ensureSystemPath: true,
    });
    expect(seen.code).toBe(0);
    const env = { ...process.env, PATH: seen.stdout, PATHEXT: '.COM;.EXE;.BAT;.CMD' };

    const origin = mkdtempSync(join(tmpdir(), 'checkenv-origin-'));
    const work = mkdtempSync(join(tmpdir(), 'checkenv-work-'));
    const g = (cwd: string, ...a: string[]) => spawnSync(git, ['-C', cwd, ...a], { encoding: 'utf8', env });
    execFileSync(git, ['init', '--bare', '--quiet', '--initial-branch=work', origin], { stdio: 'pipe', env });
    g(work, 'init', '--quiet', '--initial-branch=work');
    g(work, 'config', 'user.name', 'Fixture');
    g(work, 'config', 'user.email', 'fixture@example.com');
    writeFileSync(join(work, 'a.txt'), 'x\n');
    g(work, 'add', '--all');
    g(work, 'commit', '--quiet', '-m', 'fixture');
    g(work, 'remote', 'add', 'origin', origin);

    const pushed = g(work, 'push', '--quiet', 'origin', 'work:work');
    // 3221225477 is 0xC0000005, the crash this file exists to prevent. It carries no stderr at all,
    // so asserting on a message would be asserting on nothing.
    expect(pushed.status, `push exited ${pushed.status}; stderr=${JSON.stringify(pushed.stderr)}`).toBe(0);
    // A real init/commit/push on a loaded machine can exceed vitest's 5s default; a review run timed
    // out here. The bound is generous rather than absent so a genuine hang still ends the test.
  }, 30_000);
});
