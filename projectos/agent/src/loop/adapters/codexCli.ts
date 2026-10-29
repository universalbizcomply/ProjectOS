/**
 * The Codex CLI adapter — a REVIEWER kind, and only that. PROJECTOS-KERNEL-FOLLOWUP1A.
 *
 * WHY IT EXISTS. D11 records `providerDistinct` on every reviewer record, and the Stage 1 exit proof
 * needs it true: a Claude implementer reviewed by a reviewer from a different provider. This is that
 * reviewer. It runs `codex exec` non-interactively, in Codex's own READ-ONLY sandbox, placed in the
 * candidate checkout, and hands back the reply in the same structured shape the Claude reviewer's
 * output has — so the loop reads it with the ONE shared parser (`reviewerText`, `parseReviewerVerdict`
 * in reviewRoles.ts) and the same turn and denial checks (independentReview.ts). Nothing here parses a
 * verdict.
 *
 * NEVER AN IMPLEMENTER. `start` and `rejoin` refuse before anything is spawned. A reviewer that could
 * also be pointed at the implementer's seat would make "a different provider reviewed it" depend on
 * nobody ever configuring it the other way round.
 *
 * NOT AN API CLIENT, AND NO CREDENTIAL CROSSES THE COMMAND LINE OR THE ENVIRONMENT. Codex is a local CLI
 * the owner logs into themselves. This adapter passes no key, token or credential argument (a
 * credential-shaped configured argument, or argument value, is refused), and the spawn scrubs
 * credential-shaped environment variables, as every worker spawn does.
 *
 * THAT IS NOT THE SAME AS "THE REVIEWER CANNOT REACH A CREDENTIAL", and it is said plainly. A read-only
 * sandbox blocks WRITES, not reads: the reviewer process runs as the owner and can read any file the
 * owner's account can read — including the owner's own Codex login under `~/.codex`, which Codex itself
 * needs and which therefore cannot be hidden from it (`CODEX_HOME` / `USERPROFILE` must stay). What this
 * adapter does instead, both HEURISTICS that fail closed rather than proofs:
 *   - every `command_execution` whose command names a path outside the candidate checkout (an absolute
 *     path not under it, a home-directory reference, a `..` escape, a UNC path, or `.codex`) is reported
 *     as a `permission_denials` entry, so the loop's "may have been steered" refusal fires;
 *   - a reply carrying credential-shaped content (JWT-like, `sk-` keys, token or key assignments, bearer
 *     values, long base64 or hex runs) is WITHHELD — never passed through as the reply — and reported as a
 *     denial, so the review is refused and the text never reaches a record, a stop detail or a prompt.
 * A command can still be written to evade the first, and a secret re-encoded to evade the second.
 *
 * THE SANDBOX IS NOT CONFIGURABLE. `--sandbox read-only` is added here, always, and the configured
 * arguments are a closed allowlist: nothing that could widen the sandbox (`workspace-write`,
 * `danger-full-access`, `--dangerously-bypass-approvals-and-sandbox`, `--add-dir`, `-c` overrides,
 * profiles) can reach the command line. `--ignore-user-config` and `--ignore-rules` mean the read-only
 * property does not rest on what the owner's `~/.codex` happens to contain either — the same reason the
 * Claude reviewer is started with `--strict-mcp-config`. If the finished argv does not carry exactly
 * one read-only sandbox, the review is refused rather than started.
 */
import type { ExecResult, System } from '../../system.js';
import type { WorkerBrief } from '../brief.js';
import type { AuthorisedWorker, WorkerAdapter, WorkerOutcome } from '../workers.js';

export const CODEX_CLI = 'codex-cli';

/** The bound on what the reviewer may print, matching the Claude adapter's. JSONL carries command output. */
const WORKER_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** The sandbox a Codex reviewer runs in. Never configurable, never another value. */
const READ_ONLY_SANDBOX: readonly string[] = ['--sandbox', 'read-only'];

/**
 * Always on the command line, after the sandbox. `--json` is the event stream this adapter reads;
 * `--ephemeral` writes no session files (a reviewer is never rejoined); `--ignore-user-config` and
 * `--ignore-rules` keep the owner's config, MCP servers and exec-policy rules out of the review.
 */
const FIXED_REVIEW_ARGS: readonly string[] = ['--json', '--color', 'never', '--ignore-user-config', '--ignore-rules', '--ephemeral'];

/** Configured arguments that take a value. Model selection only — nothing that touches authority. */
const CONFIGURABLE_VALUED: readonly string[] = ['-m', '--model', '--local-provider'];
/** Configured switches. None of them widens what the reviewer may do. */
const CONFIGURABLE_SWITCHES: readonly string[] = ['--oss', '--skip-git-repo-check', '--strict-config'];

/**
 * Tokens that widen the sandbox or skip approvals, refused by name so the reason is specific. The
 * allowlist above refuses them anyway; this list is also what the finished argv is checked against.
 */
const FORBIDDEN_TOKENS: ReadonlyMap<string, string> = new Map([
  ['--dangerously-bypass-approvals-and-sandbox', 'skips every approval and the sandbox'],
  ['--full-auto', 'turns on a writable sandbox'],
  ['--approve-for-me', 'routes approvals through the workspace-write sandbox'],
  ['workspace-write', 'is a writable sandbox'],
  ['danger-full-access', 'removes the sandbox'],
  ['--add-dir', 'makes another directory writable'],
  ['-s', 'sets the sandbox, which only this adapter may do'],
  ['--sandbox', 'sets the sandbox, which only this adapter may do'],
  ['-c', 'overrides configuration, including the sandbox and approval policy'],
  ['--config', 'overrides configuration, including the sandbox and approval policy'],
  ['-p', 'loads a profile, which can set the sandbox'],
  ['--profile', 'loads a profile, which can set the sandbox'],
  ['--enable', 'turns on a feature this config does not show'],
  ['--dangerously-bypass-hook-trust', 'runs hooks without trust'],
  ['--worktree', 'creates and writes a worktree'],
]);

/** Anything that looks like a credential being handed to the reviewer. */
const CREDENTIAL_SHAPED = /(api[_-]?key|token|secret|password|passwd|bearer|credential|auth)/i;

const CREDENTIAL_ARGUMENT =
  'a credential-shaped argument is configured; no key, token or credential is ever passed to the reviewer';

/**
 * The VALUE of a permitted valued flag gets the same two tests as a flag: `['-m', 'my-token']` is a
 * credential handed over as a "model", and `['-m', 'workspace-write']` is a sandbox token in a value slot.
 */
function valueProblems(flag: string, value: string): readonly string[] {
  if (CREDENTIAL_SHAPED.test(value)) return [CREDENTIAL_ARGUMENT];
  const forbidden = FORBIDDEN_TOKENS.get(value.split('=')[0] as string);
  return forbidden === undefined ? [] : [`'${flag}' is given '${value}', which ${forbidden}; a Codex reviewer only reads`];
}

/** Why these configured arguments may not be given to a Codex reviewer, or empty. */
export function codexArgProblems(args: readonly string[]): readonly string[] {
  const problems: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (CREDENTIAL_SHAPED.test(arg)) {
      problems.push(CREDENTIAL_ARGUMENT);
      continue;
    }
    const flag = arg.split('=')[0] as string;
    const forbidden = FORBIDDEN_TOKENS.get(flag) ?? FORBIDDEN_TOKENS.get(arg);
    if (forbidden !== undefined) {
      problems.push(`'${flag}' ${forbidden}; a Codex reviewer only reads`);
      continue;
    }
    if (CONFIGURABLE_SWITCHES.includes(arg)) continue;
    const joined = CONFIGURABLE_VALUED.find((f) => arg.startsWith(`${f}=`));
    if (joined !== undefined) {
      problems.push(...valueProblems(joined, arg.slice(joined.length + 1)));
      continue;
    }
    if (CONFIGURABLE_VALUED.includes(arg)) {
      const value = args[i + 1];
      i += 1;
      if (value === undefined || value.startsWith('-')) problems.push(`'${arg}' is given with no value`);
      else problems.push(...valueProblems(arg, value));
      continue;
    }
    problems.push(
      `'${flag}' is not an argument a Codex reviewer may be configured with; permitted: ` +
        `${[...CONFIGURABLE_VALUED, ...CONFIGURABLE_SWITCHES].join(', ')}`,
    );
  }
  return problems;
}

/**
 * Does this argv carry exactly one read-only sandbox and nothing that widens it? The prompt (the last
 * element) is text, not a flag, and is excluded. Null when it does; otherwise why not.
 */
export function sandboxProblem(argv: readonly string[]): string | null {
  const flags = argv.slice(0, -1);
  const sandboxAt = flags.flatMap((a, i) => (a === '--sandbox' || a === '-s' || a.startsWith('--sandbox=') ? [i] : []));
  if (sandboxAt.length !== 1 || flags[sandboxAt[0] as number] !== '--sandbox' || flags[(sandboxAt[0] as number) + 1] !== 'read-only') {
    return 'the read-only sandbox could not be set on the Codex command line, so no review is started';
  }
  const widened = flags.filter((a) => a !== '--sandbox' && FORBIDDEN_TOKENS.has(a.split('=')[0] as string));
  return widened.length === 0 ? null : `the Codex command line carries ${widened.join(', ')}, which widens the read-only sandbox`;
}

/** The exact argv a review runs with, or why it may not run. */
export function codexReviewArgv(
  worker: AuthorisedWorker,
  root: string,
  instruction: string,
): { readonly ok: true; readonly argv: readonly string[] } | { readonly ok: false; readonly problem: string } {
  const problems = codexArgProblems(worker.args);
  if (problems.length > 0) return { ok: false, problem: `the Codex reviewer '${worker.workerId}': ${problems.join('; ')}` };
  // The prompt is a positional argument. One starting with '-' would be read as a flag.
  if (instruction.trim() === '' || instruction.startsWith('-')) {
    return { ok: false, problem: 'the review instruction is empty or would be read as a flag' };
  }
  const argv = ['exec', ...worker.args, ...READ_ONLY_SANDBOX, ...FIXED_REVIEW_ARGS, '--cd', root, instruction];
  const sandbox = sandboxProblem(argv);
  return sandbox === null ? { ok: true, argv } : { ok: false, problem: sandbox };
}

/** What one `codex exec --json` run reported about itself. */
export interface CodexRun {
  readonly threadId: string | null;
  /** The text of the last `agent_message` item: the reviewer's reply. */
  readonly lastMessage: string | null;
  /** `command_execution` items that completed with exit code 0: how the reviewer read the repository. */
  readonly reads: number;
  /**
   * One entry per item that went beyond reading: a write, a tool call, a command that was declined, hit
   * the sandbox or named a path outside the checkout, and a reply withheld for credential-shaped content.
   */
  readonly beyondReading: readonly string[];
  readonly turnCompleted: boolean;
  readonly failure: string | null;
}

/** What the adapter knows about the review it started, for the two heuristics below. */
export interface CodexReviewContext {
  /** The candidate checkout. A command naming a path outside it is reported as a denial. */
  readonly root: string;
  /** The instruction the loop wrote. A run the loop itself put there (a digest, a commit) is not a secret. */
  readonly instruction: string;
}

/**
 * Items that neither read nor act. Anything not here and not a command execution is beyond reading.
 * `error` is deliberately NOT here: an error item is the run's own report that something went wrong, and
 * it is read as a FAILURE (see `readCodexEvents`).
 */
const NEUTRAL_ITEMS: ReadonlySet<string> = new Set(['agent_message', 'reasoning', 'todo_list']);

/** Reviewer text reaches the stop detail: no control characters, bounded. */
function inert(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  return (typeof value === 'string' ? value : '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 300);
}

// ---- HIGH 1(b): a command that reaches outside the checkout. A HEURISTIC over the command text. ----

/** A home-directory reference, in the shells Codex runs: `~`, `$HOME`, `%USERPROFILE%`, the PowerShell drive. */
const HOME_REFERENCE = new RegExp(
  [
    String.raw`(^|[\s'"=(;,|&])~(?=$|[\\/\s'"])`,
    String.raw`%(USERPROFILE|HOMEPATH|HOMEDRIVE|APPDATA|LOCALAPPDATA|CODEX_HOME)%`,
    String.raw`\$\{?(HOME|USERPROFILE|HOMEPATH|APPDATA|LOCALAPPDATA|CODEX_HOME)\b`,
    // `[:]` rather than a bare colon, so the CX-5 pin against an environment spawn option does not read
    // this PowerShell drive prefix as one.
    String.raw`\$env[:](USERPROFILE|HOME|HOMEPATH|HOMEDRIVE|APPDATA|LOCALAPPDATA|CODEX_HOME)\b`,
  ].join('|'),
  'i',
);
/** The owner's Codex home, wherever it is named. */
const CODEX_HOME_NAME = /\.codex/i;
/** A `..` path component: a climb out of the checkout the command was started in. */
const PARENT_ESCAPE = /(^|[\s'"=(\\/])\.\.(?=$|[\\/\s'"])/;
/** A UNC path: `\\server\share` or `//server/share` (not a URL's `://`, which is preceded by a colon). */
const UNC_PATH = /(^|[\s'"=(])(\\\\|\/\/)[^\s\\/]/;
/** The rest of a path once its start is found. */
const PATH_TAIL = String.raw`[^\s'"|;&<>()]*`;
/** A drive path: `C:\x` or `C:/x`. */
const DRIVE_PATH = new RegExp(String.raw`(?:^|[^A-Za-z0-9])([A-Za-z]):([\\/]${PATH_TAIL})`, 'g');
/** A Git Bash or WSL drive mount: `/c/x`, `/mnt/c/x`. */
const MOUNT_PATH = new RegExp(String.raw`(?:^|[\s'"=(])\/(?:mnt\/)?([A-Za-z])(?=$|[\\/\s'"])(${PATH_TAIL})`, 'g');
/** A POSIX home directory. */
const POSIX_HOME = /(^|[\s'"=(])\/(home|Users|root)(?=$|[\\/\s'"])/;

/** A path in one comparable form: forward slashes, no doubles, lower case, no trailing slash. */
function comparablePath(p: string): string {
  const mount = /^\/(?:mnt\/)?([A-Za-z])(\/.*)?$/.exec(p.replace(/\\/g, '/'));
  const drive = mount === null ? p : `${mount[1]}:${mount[2] ?? ''}`;
  return drive.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '').toLowerCase();
}

/** Every absolute drive or mount path the command names, in comparable form. */
function absolutePaths(command: string): readonly string[] {
  const found: string[] = [];
  for (const m of command.matchAll(DRIVE_PATH)) found.push(comparablePath(`${m[1]}:${m[2]}`));
  for (const m of command.matchAll(MOUNT_PATH)) found.push(comparablePath(`${m[1]}:${m[2] === '' ? '/' : m[2]}`));
  return found;
}

/**
 * Does this command name a path outside the candidate checkout? A heuristic, and said to be one: it reads
 * the command TEXT, so a command built to hide a path (an encoded string, a variable assembled at run
 * time) is not caught. What it does catch fails closed — a reviewer that reads outside the checkout has
 * its review refused as possibly steered, never credited. `root` null means no checkout is known, so
 * every absolute path is outside it.
 */
export function commandLeavesCheckout(command: string, root: string | null): boolean {
  if (HOME_REFERENCE.test(command) || CODEX_HOME_NAME.test(command) || PARENT_ESCAPE.test(command)) return true;
  if (UNC_PATH.test(command) || POSIX_HOME.test(command)) return true;
  const inside = root === null ? null : comparablePath(root);
  return absolutePaths(command).some((p) => inside === null || (p !== inside && !p.startsWith(`${inside}/`)));
}

/** Output that says the command was stopped by the sandbox or an approval, not that it merely failed. */
const SANDBOX_REFUSAL =
  /sandbox|permission denied|access is denied|access to the path .* is denied|\bis denied\b|unauthorizedaccess|operation not permitted|read-only file system|\bEACCES\b|\bEPERM\b|approv/i;

/**
 * MEDIUM 2. Why a `command_execution` item is beyond reading, or null. A command that was DECLINED, or
 * failed because the sandbox or an approval stopped it, was an attempt the reviewer was denied — which is
 * what the loop's "may have been steered" refusal is for. A command that simply failed (a `grep` with no
 * match exits 1) is neither a read nor a denial. A command whose text was not reported cannot be checked
 * for where it reached, so it is a denial too.
 */
function commandProblem(item: Record<string, unknown>, root: string | null): string | null {
  const command = item['command'];
  if (typeof command !== 'string') return 'command_execution: the command was not reported';
  if (commandLeavesCheckout(command, root)) return 'command_execution: names a path outside the repository';
  if (item['status'] === 'declined') return 'command_execution: declined';
  if (item['status'] === 'failed' && SANDBOX_REFUSAL.test(typeof item['aggregated_output'] === 'string' ? item['aggregated_output'] : '')) {
    return 'command_execution: stopped by the sandbox or an approval';
  }
  return null;
}

/** MEDIUM 2. A read is a command that COMPLETED with exit code 0 — never one the sandbox stopped. */
function isRead(item: Record<string, unknown>): boolean {
  return item['status'] === 'completed' && item['exit_code'] === 0;
}

// ---- HIGH 1(c): a reply that carries something credential-shaped is withheld. ----

/** Credential shapes that are recognisable on their own. Case-insensitive where the shape is. */
const CREDENTIAL_CONTENT: readonly RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{16,}/, // a JWT header (`{"` base64url-encoded): Codex's own id and access tokens
  /\bsk-[A-Za-z0-9_-]{16,}/, // an OpenAI-style secret key
  /\bsk_(live|test)_[A-Za-z0-9]{16,}/, // a Stripe-style secret key
  /\b(ghp|gho|ghs|ghu|ghr|github_pat)_[A-Za-z0-9_]{20,}/, // a GitHub token
  /\bAKIA[0-9A-Z]{16}\b/, // an AWS access key id
  /\brt_[A-Za-z0-9_-]{16,}/, // a refresh-token prefix
  /-----BEGIN [A-Z ]*(PRIVATE )?KEY-----/, // a PEM key block
  /(access|refresh|id)_token|api[_-]?key/i, // the names Codex's login file and most key files use
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i, // an HTTP bearer value
];
/**
 * A long unbroken base64 or hex run. `/` and `.` are excluded so a file path is never one. A mixed-class
 * run counts from 30 characters (a 40-character cloud secret is one); a hex run only beyond 40, so a git
 * commit id the reviewer cites is not one.
 */
const LONG_RUN = /[A-Za-z0-9+=_-]{30,}/g;

/**
 * Does this reply text carry credential-shaped content? A heuristic: a false positive refuses a review
 * (the owner sees why), and a false negative is a secret re-encoded to dodge it. A long run counts when
 * it is hex, or mixes digits with upper- and lower-case letters — the shape of a key, not of a
 * hyphenated name — and is not one the loop's own instruction carries (the candidate digest, a commit).
 */
export function credentialShaped(text: string, instruction = ''): boolean {
  if (CREDENTIAL_CONTENT.some((re) => re.test(text))) return true;
  for (const [run] of text.matchAll(LONG_RUN)) {
    if (instruction.includes(run)) continue;
    const hex = run.length > 40 && /^[0-9a-f]+$/i.test(run);
    const mixed = /[0-9]/.test(run) && /[A-Z]/.test(run) && /[a-z]/.test(run);
    if (hex || mixed) return true;
  }
  return false;
}

/** The denial a withheld reply is reported as. Names no part of the text. */
export const CODEX_REPLY_WITHHELD = 'agent_message: credential-shaped reply withheld';

/**
 * Read the JSONL event stream. A line that is not a JSON object is skipped: it can contribute no read,
 * no reply and no completion, so skipping it can only make a review fail, never pass.
 *
 * `context` is the review the adapter started. Without it no checkout is known, so every absolute path a
 * command names counts as outside one, and no instruction exempts a long run.
 */
export function readCodexEvents(stdout: string, context: CodexReviewContext | null = null): CodexRun {
  let threadId: string | null = null;
  let lastMessage: string | null = null;
  let reads = 0;
  let turnCompleted = false;
  let failure: string | null = null;
  const beyond = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    let ev: unknown;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) continue;
    const e = ev as Record<string, unknown>;
    const type = e['type'];
    if (type === 'thread.started' && typeof e['thread_id'] === 'string') threadId = e['thread_id'];
    else if (type === 'turn.completed') turnCompleted = true;
    else if (type === 'turn.failed') failure = inert((e['error'] as Record<string, unknown> | undefined)?.['message']) || 'the turn failed';
    else if (type === 'error') failure = inert(e['message']) || 'the run reported an error';
    else if (type === 'item.started' || type === 'item.completed') {
      const item = e['item'];
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
      const it = item as Record<string, unknown>;
      const itemType = typeof it['type'] === 'string' ? it['type'] : 'unknown';
      const id = typeof it['id'] === 'string' ? it['id'] : `${itemType}#${beyond.size + reads}`;
      if (itemType === 'command_execution') {
        const problem = commandProblem(it, context?.root ?? null);
        if (problem !== null) {
          if (!beyond.has(id)) beyond.set(id, problem);
        } else if (type === 'item.completed' && isRead(it)) {
          reads += 1;
        }
      } else if (itemType === 'agent_message') {
        if (type === 'item.completed' && typeof it['text'] === 'string') lastMessage = it['text'];
      } else if (itemType === 'error') {
        // AN ERROR ITEM IS A FAILURE, NOT A DENIAL — the conservative choice of the two. A failure refuses
        // the review at this adapter, before any reply is translated or handed to the loop, and its reason
        // says what happened; a denial would let the reply be enveloped and would misname the cause.
        if (failure === null) failure = inert(it['message']) || 'the run reported an error item';
      } else if (!NEUTRAL_ITEMS.has(itemType)) {
        beyond.set(id, itemType);
      }
    }
  }
  // HIGH 1(c). The reply is withheld whole, not redacted: a redaction would still pass the rest of a
  // reply written by a reviewer that read a credential, and the findings inside it would still be credited.
  if (lastMessage !== null && credentialShaped(lastMessage, context?.instruction ?? '')) {
    lastMessage = null;
    beyond.set(`${CODEX_REPLY_WITHHELD}#reply`, CODEX_REPLY_WITHHELD);
  }
  return { threadId, lastMessage, reads, beyondReading: [...beyond.values()], turnCompleted, failure };
}

/**
 * The run, in the structured shape the loop's shared reviewer checks read: `result` is the reply text
 * (`reviewerText`), `num_turns` is one plus the reads (so a reviewer that read nothing reports 1, which
 * the loop refuses), and every item beyond reading is a `permission_denials` entry (which the loop
 * treats as a reviewer that may have been steered). A translation of what Codex reported, not a claim.
 */
export function codexReviewEnvelope(run: CodexRun): string {
  return JSON.stringify({
    type: 'result',
    result: run.lastMessage ?? '',
    num_turns: 1 + run.reads,
    permission_denials: run.beyondReading.map((t) => ({ tool_name: t })),
    session_id: run.threadId,
  });
}

/** What actually happened, with the same three non-completion outcomes as the Claude adapter. */
function reviewOutcomeFrom(r: ExecResult, timeoutMs: number, context: CodexReviewContext): WorkerOutcome {
  if (r.failure === 'timeout') return { kind: 'timedOut', afterMs: timeoutMs, stdout: r.stdout, stderr: r.stderr };
  if (r.failure === 'output-overflow') {
    return {
      kind: 'refused',
      detail: 'the Codex reviewer ran but produced more output than the runtime will hold, and was ended before it finished',
    };
  }
  if (r.failure === 'not-started') {
    return {
      kind: 'refused',
      detail:
        `the Codex executable could not be started${r.stderr.trim() === '' ? '' : `: ${inert(r.stderr.trim())}`}` +
        ' — nothing ran, so this is not a review that failed',
    };
  }
  // A non-zero exit is reported as one; the loop refuses it. Nothing is read out of its output.
  if (r.code !== 0) return { kind: 'completed', exitCode: r.code, stdout: r.stdout, stderr: r.stderr, providerRef: null };
  const run = readCodexEvents(r.stdout, context);
  if (run.failure !== null) return { kind: 'refused', detail: `the Codex reviewer's turn failed: ${run.failure}` };
  if (!run.turnCompleted) return { kind: 'refused', detail: 'the Codex reviewer exited without reporting a completed turn' };
  return { kind: 'completed', exitCode: 0, stdout: codexReviewEnvelope(run), stderr: r.stderr, providerRef: run.threadId };
}

/** Why this worker may not be started at all, or null — the same bound rule as the Claude adapter. */
function boundProblem(worker: AuthorisedWorker): string | null {
  const ms = worker.timeoutMs;
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
    ? null
    : 'this worker declares no attempt bound, and an attempt that cannot be ended is not one this runtime will start';
}

/** Why a Codex worker never implements. Said by both `start` and `rejoin`. */
export const CODEX_NOT_AN_IMPLEMENTER =
  `a '${CODEX_CLI}' worker is a reviewer only: it runs in a read-only sandbox and is never started or ` +
  'resumed as the implementer; configure it as `execution.reviewerWorkerId`';

export const codexCliAdapter: WorkerAdapter = {
  kind: CODEX_CLI,

  start(): WorkerOutcome {
    return { kind: 'refused', detail: CODEX_NOT_AN_IMPLEMENTER };
  },

  rejoin(): WorkerOutcome {
    return { kind: 'refused', detail: CODEX_NOT_AN_IMPLEMENTER };
  },

  review(sys: System, worker: AuthorisedWorker, brief: WorkerBrief, instruction: string): WorkerOutcome {
    const unbounded = boundProblem(worker);
    if (unbounded !== null) return { kind: 'refused', detail: unbounded };
    const built = codexReviewArgv(worker, brief.repository.root, instruction);
    if (!built.ok) return { kind: 'refused', detail: built.problem };
    return reviewOutcomeFrom(
      sys.exec(worker.command, built.argv, {
        // No credential-shaped variable is inherited, and the review runs in the candidate checkout.
        scrubCredentials: true, ensureSystemPath: true, cwd: brief.repository.root,
        // BOUNDED, from the committed config, like every worker spawn.
        timeoutMs: worker.timeoutMs, maxOutputBytes: WORKER_MAX_OUTPUT_BYTES,
      }),
      worker.timeoutMs,
      { root: brief.repository.root, instruction },
    );
  },
};
