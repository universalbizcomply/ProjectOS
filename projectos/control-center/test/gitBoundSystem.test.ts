/**
 * The daemon's Git capability.
 *
 * The daemon deliberately runs with no PATH, so it cannot find `git` — and the closure gate derives
 * every repository fact by running git. The host therefore resolves ONE absolute `git.exe` and hands
 * it over in `PROJECTOS_GIT_EXE`. These tests pin the two halves of that bargain: the bound path is
 * used for `git` and nothing else, and an absent or wrong-looking binding FAILS rather than falling
 * back to searching.
 */
import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — the sidecar is plain ESM JavaScript with no type declarations.
import { gitBoundSystem } from '../sidecar/gitBoundSystem.mjs';

const GIT = 'C:\\tools\\git\\cmd\\git.exe';

function baseSystem() {
  const calls: { command: string; args: readonly string[] }[] = [];
  const base = {
    exec: vi.fn((command: string, args: readonly string[]) => {
      calls.push({ command, args });
      return { code: 0, stdout: 'ok', stderr: '' };
    }),
    readText: () => null,
    log: () => {},
  };
  return { base, calls };
}

describe('gitBoundSystem', () => {
  it('GIT9 runs `git` through the host-bound absolute path', () => {
    const { base, calls } = baseSystem();
    const sys = gitBoundSystem(base, { PROJECTOS_GIT_EXE: GIT });

    const result = sys.exec('git', ['-C', 'C:\\repo', 'rev-parse', 'HEAD']);

    expect(result.code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(GIT);
    // the arguments are passed through untouched — this rebinds the executable, nothing else
    expect(calls[0].args).toEqual(['-C', 'C:\\repo', 'rev-parse', 'HEAD']);
  });

  it('GIT10 fails closed when no Git path is bound', () => {
    const { base, calls } = baseSystem();
    const sys = gitBoundSystem(base, {});

    const result = sys.exec('git', ['rev-parse', 'HEAD']);

    // Non-zero, so every fact the gate derives from git stays unestablished and G4 keeps refusing.
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('no bound Git executable');
    // and crucially it did NOT fall back to searching for `git`
    expect(calls).toHaveLength(0);
  });

  it('GIT10 fails closed on a binding that is not a plausible git executable', () => {
    for (const bound of [
      'git.exe', // relative — would resolve against the working directory
      'C:\\tools\\evil.exe', // absolute but not git
      'C:\\tools\\git.cmd', // shell wrapper, not the executable
      '..\\git.exe', // traversal
      '', // empty
    ]) {
      const { base, calls } = baseSystem();
      const sys = gitBoundSystem(base, { PROJECTOS_GIT_EXE: bound });
      const result = sys.exec('git', ['status', '--porcelain']);
      expect(result.code, `binding must be refused: ${bound}`).not.toBe(0);
      expect(calls, `nothing may be executed for: ${bound}`).toHaveLength(0);
    }
  });

  it('GIT11 leaves every other command untouched', () => {
    const { base, calls } = baseSystem();
    const sys = gitBoundSystem(base, { PROJECTOS_GIT_EXE: GIT });

    sys.exec('node', ['--version']);
    sys.exec('npm', ['run', 'build']);
    // near-misses must not be captured either
    sys.exec('gitk', ['--all']);
    sys.exec('git.exe', ['status']);

    expect(calls.map((c) => c.command)).toEqual(['node', 'npm', 'gitk', 'git.exe']);
    expect(calls.some((c) => c.command === GIT)).toBe(false);
  });

  it('preserves the rest of the System surface', () => {
    const { base } = baseSystem();
    const sys = gitBoundSystem(base, { PROJECTOS_GIT_EXE: GIT });
    expect(sys.readText).toBe(base.readText);
    expect(sys.log).toBe(base.log);
  });
});
