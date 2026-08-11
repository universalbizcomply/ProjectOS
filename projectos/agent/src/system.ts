/**
 * System adapter: the ONLY impure edge of the CLI.
 *
 * Every command takes a System so it can be unit-tested with an in-memory fake. The
 * nodeSystem implementation is the real one used by the bin entrypoint. Because all the
 * command logic depends on this interface (never on node builtins directly), the commands
 * stay pure and deterministic.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';

export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExecOptions {
  /**
   * Drop environment variables whose NAME looks like a credential before spawning.
   *
   * `spawnSync` inherits the whole parent environment, so an `ANTHROPIC_API_KEY` a developer set for
   * unrelated tooling would be handed to every worker and every validator the loop runs — including
   * validator scripts that live in the governed checkout. The project forbids `use-anthropic-api`
   * and requires redaction; inheriting a key silently is how that forbidding becomes decorative.
   */
  readonly scrubCredentials?: boolean;
  /**
   * The working directory to spawn in. MUST come from an already-verified governed execution
   * context — never `process.cwd()`, never a worker-writable record.
   *
   * Without it, `spawnSync` inherits ProjectOS's ambient cwd, so the loop would TELL a worker which
   * repository is governed while mechanically placing it wherever ProjectOS happened to be started.
   * The same gap makes a configured check's relative argument (`--prefix projectos/core`) resolve
   * against the ambient directory rather than the governed root.
   */
  readonly cwd?: string;
}

export interface System {
  cwd(): string;
  /** Current time as an ISO-8601 string. */
  now(): string;
  /** Read a UTF-8 file, or null if it does not exist. */
  readText(path: string): string | null;
  /** Write a UTF-8 file, creating parent directories as needed. */
  writeText(path: string, content: string): void;
  exists(path: string): boolean;
  /** List entry names in a directory, or [] if it does not exist. */
  listDir(path: string): readonly string[];
  /** Run a command, capturing output. Never throws; non-zero code is returned. */
  exec(cmd: string, args: readonly string[], options?: ExecOptions): ExecResult;
}

/** Environment variable names that must not be inherited by a spawned worker or check. */
export const CREDENTIAL_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i;

/** A copy of `env` with credential-shaped NAMES removed. Values are never inspected or logged. */
export function scrubbedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (!CREDENTIAL_ENV_NAME.test(k)) out[k] = v;
  }
  return out;
}

/**
 * `git`, resolved to ONE ABSOLUTE EXECUTABLE — never spawned by bare name.
 *
 * On Windows an unqualified command name resolves against the spawning process's current directory
 * before PATH. The CLI is cwd-rooted by design, so that directory is the governed checkout: content
 * that is untrusted until the owner reviews it. The closure gate derives head, branch, cleanliness,
 * reconciliation and ancestry by running git, so a `git.exe` planted in a repository could decide
 * whether its own phase may close — without needing to run a single line of malicious code, simply
 * by answering "clean".
 *
 * `PROJECTOS_GIT_EXE` is honoured first: the daemon is launched with no PATH at all and the host
 * binds it there (see control-center/sidecar/gitBoundSystem.mjs). Otherwise the first ABSOLUTE PATH
 * entry holding a git executable wins. There is deliberately no fallback to bare-name resolution —
 * when nothing binds, git calls fail and every fact derived from them fails closed, which refuses.
 *
 * Bound in PROJECTOS-V3-RELIABILITY-HARDENING1A after a security review found the bare-name call.
 */
const GIT_BASENAME = process.platform === 'win32' ? /^git\.exe$/i : /^git$/;
const GIT_FILENAME = process.platform === 'win32' ? 'git.exe' : 'git';

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function resolveBoundGit(env: NodeJS.ProcessEnv = process.env): string | null {
  const bound = env['PROJECTOS_GIT_EXE'];
  if (typeof bound === 'string' && bound.length > 0 && isAbsolute(bound) && GIT_BASENAME.test(basename(bound)) && isFile(bound)) {
    return bound;
  }
  for (const dir of String(env['PATH'] ?? '').split(delimiter)) {
    if (dir.length === 0 || !isAbsolute(dir)) continue;
    const candidate = join(dir, GIT_FILENAME);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** The real Node-backed System used at runtime. */
export const nodeSystem: System = {
  cwd() {
    return process.cwd();
  },
  now() {
    return new Date().toISOString();
  },
  readText(path) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  writeText(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  },
  exists(path) {
    return existsSync(path);
  },
  listDir(path) {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  exec(cmd, args, options) {
    let executable = cmd;
    if (cmd === 'git') {
      const bound = resolveBoundGit();
      if (bound === null) {
        return {
          code: 127,
          stdout: '',
          stderr: 'ProjectOS has no bound Git executable, so repository facts cannot be established.',
        };
      }
      executable = bound;
    }
    const r = spawnSync(executable, [...args], {
      encoding: 'utf8',
      shell: false,
      ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options?.scrubCredentials === true ? { env: scrubbedEnv(process.env) } : {}),
    });
    return {
      code: r.status ?? 1,
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
    };
  },
};
