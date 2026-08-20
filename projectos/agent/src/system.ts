/**
 * System adapter: the ONLY impure edge of the CLI.
 *
 * Every command takes a System so it can be unit-tested with an in-memory fake. The
 * nodeSystem implementation is the real one used by the bin entrypoint. Because all the
 * command logic depends on this interface (never on node builtins directly), the commands
 * stay pure and deterministic.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync, statSync } from 'node:fs';
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
  /**
   * Rename a file over another, atomically where the platform allows it. `false` on failure.
   *
   * IT EXISTS SO THE DURABLE WRITES DO NOT NEED A SHELL. The ledger and the degraded-use record are
   * written to a temporary file and moved into place, and that move used to be `cmd /c move` — a bare
   * command name spawned with the GOVERNED CHECKOUT as its working directory, which on Windows is the
   * first place an unqualified name resolves. A `cmd.exe` committed into a governed repository would
   * therefore have been executed by the runtime immediately after the gatekeeper credential was used,
   * and under the packaged daemon — which is launched with no PATH at all — it would have been the
   * ONLY candidate. Never throws; the caller decides what a failed move means.
   */
  renameFile(from: string, to: string): boolean;
  /** Run a command, capturing output. Never throws; non-zero code is returned. */
  exec(cmd: string, args: readonly string[], options?: ExecOptions): ExecResult;
}

/** Environment variable names that must not be inherited by a spawned worker or check. */
export const CREDENTIAL_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i;

/**
 * Names that decide what code a shell loads, rather than what it is told.
 *
 * `-NoProfile` suppresses profiles and does NOT suppress module auto-loading: the credential adapter
 * calls `Add-Type` and `New-Object`, which PowerShell resolves through `PSModulePath` in order. A
 * prepended directory exporting those names redirects the credential read inside a correctly bound,
 * correctly signed shell — the executable binding does not help, because the executable is genuine.
 * Removing these makes the child fall back to its own installed module path.
 */
const EXECUTION_CONTROL_ENV_NAME = /^(PSModulePath|POWERSHELL_[A-Z_]*|PATHEXT|COMSPEC)$/i;

/** A copy of `env` with credential-shaped NAMES removed. Values are never inspected or logged. */
export function scrubbedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (CREDENTIAL_ENV_NAME.test(k) || EXECUTION_CONTROL_ENV_NAME.test(k)) continue;
    out[k] = v;
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
  const governedRoot = processRoot;
  const bound = env['PROJECTOS_GIT_EXE'];
  // THE SAME EXCLUSION THE PATH SCAN APPLIES. Naming the binary directly used to skip it, so
  // `PROJECTOS_GIT_EXE=<governed>\tools\git.exe` was accepted — and git answers whether the
  // installation's own records are committed.
  if (
    typeof bound === 'string' &&
    bound.length > 0 &&
    isAbsolute(bound) &&
    !isUnc(bound) &&
    GIT_BASENAME.test(basename(bound)) &&
    isFile(bound) &&
    !(governedRoot !== null && isInside(governedRoot, bound))
  ) {
    return bound;
  }
  // NOT FROM INSIDE THE GOVERNED CHECKOUT. `worker/bound-git.cjs` has always skipped PATH entries
  // under the governed root, for the reason it states: a repository that can add itself to PATH is not
  // a repository that gets to choose the binary deciding whether its own phase may close. That guard
  // never reached here — and every `npm run` puts `<root>\node_modules\.bin` at the front of PATH,
  // which is writable, ignored, and exactly where a planted `git.exe` would sit. Git answers the
  // closure gate AND the credential adapter's integrity check, so forging it forges both.
  const governed = processRoot;
  for (const dir of String(env['PATH'] ?? '').split(delimiter)) {
    if (dir.length === 0 || !isAbsolute(dir) || isUnc(dir)) continue;
    if (governed !== null && isInside(governed, dir)) continue;
    const candidate = join(dir, GIT_FILENAME);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** Is `child` the same as, or beneath, `parent`? Compared case-insensitively, as Windows resolves. */
function isInside(parent: string, child: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const a = norm(parent);
  const b = norm(child);
  return b === a || b.startsWith(a + '/');
}

/** A UNC path names a host, and a host is not something this machine's trust extends to. */
function isUnc(p: string): boolean {
  return p.startsWith(String.fromCharCode(92, 92)) || p.startsWith('//');
}

/**
 * PowerShell, resolved to ONE ABSOLUTE EXECUTABLE — never spawned by bare name, and never from PATH.
 *
 * THE SAME DEFECT `resolveBoundGit` EXISTS TO CLOSE, on the one call that handles a secret. The
 * credential adapter was invoked as `powershell` with the governed checkout as the working directory,
 * and on Windows an unqualified name resolves against that directory before PATH — so a
 * `powershell.exe` committed into a governed repository would have become the credential process at
 * the exact moment the owner's gate had just opened, receiving the vault reference as an argument.
 *
 * PATH IS NOT SEARCHED, unlike git. Git is a general tool an operator may reasonably install
 * anywhere; the Windows shell is at a known location under `%SystemRoot%`, and accepting the first
 * PATH hit would leave the shadowing half of the attack open. `PROJECTOS_POWERSHELL_EXE` is honoured
 * first so a packaged host can bind it explicitly, and it must be an absolute path to a real file
 * with the expected name. Nothing else resolves, and an unresolved shell fails closed.
 */
const POWERSHELL_BASENAME = /^powershell\.exe$/i;

export function resolveBoundPowerShell(env: NodeJS.ProcessEnv = process.env): string | null {
  const bound = env['PROJECTOS_POWERSHELL_EXE'];
  if (
    typeof bound === 'string' &&
    bound.length > 0 &&
    isAbsolute(bound) &&
    !isUnc(bound) &&
    POWERSHELL_BASENAME.test(basename(bound)) &&
    isFile(bound) &&
    !(processRoot !== null && isInside(processRoot, bound))
  ) {
    return bound;
  }
  const systemRoot = env['SystemRoot'] ?? env['SYSTEMROOT'];
  if (
    typeof systemRoot !== 'string' ||
    systemRoot.length === 0 ||
    !isAbsolute(systemRoot) ||
    isUnc(systemRoot)
  ) {
    // A UNC `SystemRoot` names another host, and the process that handles the secret is not fetched
    // from one.
    return null;
  }
  const canonical = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return isFile(canonical) ? canonical : null;
}

/**
 * The process root, supplied by the entrypoint that composes the program.
 *
 * `nodeSystem.cwd()` used to return `process.cwd()` directly. For the CLI that is correct — it is
 * cwd-rooted by design — but the SAME `nodeSystem` is imported by the packaged daemon, which has no
 * meaningful working directory: it is started by the host, and whatever directory it lands in is an
 * accident of the launcher, not a statement about which project is governed. Shipping an ambient
 * `process.cwd()` inside the packaged artefact meant the packaged daemon carried a latent way to
 * derive a governed location from that accident.
 *
 * So the root is now given rather than discovered. The CLI passes its own cwd (legitimate input);
 * the daemon passes nothing and any caller that reaches for `cwd()` there is refused rather than
 * silently answered.
 */
let processRoot: string | null = null;

/** Supply the process root. Called by the entrypoint, once, before anything governed runs. */
export function setProcessRoot(root: string): void {
  processRoot = root;
}

/** TEST-ONLY. Clear the root so a test can prove the refusal path. */
export function resetProcessRootForTest(): void {
  processRoot = null;
}

/** The real Node-backed System used at runtime. */
export const nodeSystem: System = {
  cwd() {
    if (processRoot === null) {
      throw new Error(
        'PROCESS_ROOT_NOT_SET: the entrypoint must call setProcessRoot(). A governed location is ' +
          'never derived from the ambient working directory.',
      );
    }
    return processRoot;
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
  renameFile(from, to) {
    try {
      renameSync(from, to);
      return true;
    } catch {
      return false;
    }
  },
  exec(cmd, args, options) {
    // NORMALISED BEFORE MATCHING. The binding used to key on the exact strings 'git' and
    // 'powershell', so `sys.exec('git.exe', …)` — the more natural spelling on Windows, and the one
    // the credential store itself uses — silently skipped it and spawned bare.
    const bare = cmd.toLowerCase().replace(/\.exe$/, '');
    let executable = cmd;
    if (bare === 'git') {
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
    // Bound here rather than at the call site so no caller can reintroduce the bare name.
    if (bare === 'powershell') {
      const bound = resolveBoundPowerShell();
      if (bound === null) {
        return {
          code: 127,
          stdout: '',
          stderr: 'ProjectOS has no bound PowerShell executable, so the credential adapter cannot be run.',
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
