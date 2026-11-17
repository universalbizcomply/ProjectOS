/**
 * The Codex IMPLEMENTER adapter — a worker kind of its own, never the reviewer's. PROJECTOS-WORKER-CODEX-IMPLEMENTER1A
 * (plan 4.1a).
 *
 * WHY IT EXISTS. The Stage 4 exit proof is "the same phase runs with the implementer and reviewer providers
 * swapped, and no code change". Until this kind, only Claude could implement, so the swap was impossible.
 * Which provider implements and which reviews is now a committed-config choice (`execution.workers`,
 * `execution.reviewerWorkerId`).
 *
 * A SEPARATE KIND, NOT A MODE OF `codex-cli`. `codex-cli` is the read-only reviewer, and "a Codex reviewer
 * never implements" is pinned by its own validator. Giving one kind two sandboxes would make "reviewer" a
 * configuration question. Here `review` is absent and `rejoin` refuses; there `start` refuses.
 *
 * WHAT CROSSES THE COMMAND LINE. A path and a fixed sentence (the loop's own `pointerInstruction` or
 * `correctionInstruction`, injected so this file imports nothing from the Claude adapter). No key, token or
 * login material; the spawn scrubs credential-shaped variables like every worker spawn.
 *
 * THE SANDBOX IS THE ADAPTER'S, AND IT IS NOT THE BOUNDARY. `--sandbox workspace-write` is added here, always,
 * and nothing configured can widen it. But Codex has no per-path grant: the sandbox covers the whole checkout,
 * including `.projectops/authority/`, validators and CLAUDE.md. What a worker may write is the loop's grants
 * (the plan's `writePaths` plus the worker-owned records), which for Claude are enforced by the CLI before the
 * write. For Codex they are read from the argv the loop composed and never forwarded.
 *
 * THE SCOPE IS PREVENTATIVE (PROJECTOS-WORKER-SCRATCH-CHECKOUT1A). Codex runs in a scratch copy of the checkout (a fresh
 * temporary directory, `scratchCheckout.ts`), and only changes inside the grants are copied back; anything else refuses the
 * whole copy-back and the real tree stays byte-identical. The brief the worker reads is a copy whose root and record paths
 * point into the scratch. The before/after snapshot of the REAL checkout (`writeScope.ts`) stays as the backstop: a write that
 * reached the real tree some other way (an absolute path, a link) is still refused and named, but that one is detective.
 *
 * NOT RESUMABLE. A cut-off Codex run starts a fresh worker (the Stage 3 design: new worker plus retrieved
 * state). `providerRef` is always null, so the loop never calls `rejoin`; if something does, it refuses.
 *
 * WHAT THIS DOES NOT PROVE. It is tested with fakes only; no live Codex run was made. The command and
 * credential heuristics are the reviewer adapter's (`commandProblem`, `credentialShaped`) and are tripwires
 * on text, not proofs; they may over-refuse a real run. Codex runs as the owner's Windows user (D4 stands
 * until Stage 4.3). Stored context is handed over by reference (PROJECTOS-CONTEXT-CODEX1A): this kind is in
 * `CONTEXT_POINTABLE_KINDS`, and both fixed sentences name the file by its project-relative path when the brief has one.
 */
import type { System } from '../../system.js';
import type { WorkerBrief } from '../brief.js';
import { nodeScratchHost, plainName, type Refusal, type ScratchCheckout, type ScratchHost } from '../scratchCheckout.js';
import type { AuthorisedWorker, WorkerAdapter, WorkerOutcome } from '../workers.js';
import { ambiguousGrants, argvGrants } from '../workers.js';
import { candidateSnapshot, grantScopes, scopeBreaches } from '../writeScope.js';
import { CODEX_REPLY_WITHHELD, WINDOWS_SANDBOX, commandProblem, credentialShaped, inert, innerCommand } from './codexCli.js';

export const CODEX_IMPLEMENTER = 'codex-implementer-cli';

/** The bound on what the worker may print. JSONL carries command output. */
const WORKER_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** Chosen here, never configured. The only sandbox this kind runs in. */
const WORKSPACE_WRITE_SANDBOX: readonly string[] = ['--sandbox', 'workspace-write'];

/** `--ephemeral`: no session files (nothing is rejoined). The two `--ignore-*` keep the owner's config and rules out. */
const FIXED_ARGS: readonly string[] = ['--json', '--color', 'never', '--ignore-user-config', '--ignore-rules', '--ephemeral'];

const GRANT_FLAGS: readonly string[] = ['--allowedTools', '--allowed-tools'];
const CONFIGURABLE_VALUED: readonly string[] = ['-m', '--model', '--local-provider'];
const CONFIGURABLE_SWITCHES: readonly string[] = ['--oss', '--skip-git-repo-check', '--strict-config'];
const READ_GRANT = /^(Read|Grep|Glob|LS)(\(.*\))?$/;
const WRITE_GRANT = /^(Write|Edit)\(.+\)$/;
const CREDENTIAL_SHAPED = /(api[_-]?key|token|secret|password|passwd|bearer|credential|auth)/i;
const CREDENTIAL_ARGUMENT = 'a credential-shaped argument is configured; no key, token or credential is ever passed to the worker';

/** Tokens that widen the sandbox, skip approvals or load authority from elsewhere. Refused by name. */
const FORBIDDEN_TOKENS: ReadonlyMap<string, string> = new Map([
  ['--dangerously-bypass-approvals-and-sandbox', 'skips every approval and the sandbox'],
  ['--dangerously-bypass-hook-trust', 'runs hooks without trust'],
  ['--full-auto', 'turns on a writable sandbox with its own approval policy'],
  ['--approve-for-me', 'routes approvals through another sandbox'],
  ['workspace-write', 'is the sandbox, which only this adapter sets'],
  ['read-only', 'is a sandbox, which only this adapter sets'],
  ['danger-full-access', 'removes the sandbox'],
  ['--add-dir', 'makes another directory writable'],
  ['-s', 'sets the sandbox, which only this adapter may do'],
  ['--sandbox', 'sets the sandbox, which only this adapter may do'],
  ['-c', 'overrides configuration, including the sandbox and approval policy'],
  ['--config', 'overrides configuration, including the sandbox and approval policy'],
  ['-p', 'loads a profile, which can set the sandbox'],
  ['--profile', 'loads a profile, which can set the sandbox'],
  ['--enable', 'turns on a feature this config does not show'],
  ['--worktree', 'creates and writes a worktree'],
]);

/** Split the configured arguments into what is forwarded to Codex and the grants the adapter reads for itself. */
function splitArgs(args: readonly string[]): { readonly forwarded: readonly string[]; readonly problems: readonly string[] } {
  const forwarded: string[] = [];
  const problems: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (GRANT_FLAGS.some((f) => arg.startsWith(`${f}=`))) {
      problems.push(`'${arg.split('=')[0]}=' is not accepted; give the grant list as its own argument`);
      continue;
    }
    if (!GRANT_FLAGS.includes(arg)) {
      forwarded.push(arg);
      continue;
    }
    let values = 0;
    while (i + 1 < args.length && !(args[i + 1] as string).startsWith('-')) {
      i += 1;
      values += 1;
    }
    if (values === 0) problems.push(`'${arg}' is given with no value`);
  }
  return { forwarded, problems };
}

function valueProblems(flag: string, value: string): readonly string[] {
  if (CREDENTIAL_SHAPED.test(value)) return [CREDENTIAL_ARGUMENT];
  const forbidden = FORBIDDEN_TOKENS.get(value.split('=')[0] as string);
  return forbidden === undefined ? [] : [`'${flag}' is given '${value}', which ${forbidden}`];
}

function forwardedProblems(args: readonly string[]): readonly string[] {
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
      problems.push(`'${flag}' ${forbidden}`);
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
      `'${flag}' is not an argument a Codex implementer may be configured with; permitted: ` +
        `${[...CONFIGURABLE_VALUED, ...CONFIGURABLE_SWITCHES, ...GRANT_FLAGS].join(', ')}`,
    );
  }
  return problems;
}

/** Why these configured arguments may not be given to a Codex implementer, or empty. */
export function codexImplementerArgProblems(args: readonly string[]): readonly string[] {
  const { forwarded, problems } = splitArgs(args);
  const out = [...problems, ...forwardedProblems(forwarded)];
  for (const grant of ambiguousGrants(args)) {
    out.push(`tool grant '${grant}' has nested or unbalanced parentheses, which could be read as several grants`);
  }
  for (const grant of argvGrants(args)) {
    if (!WRITE_GRANT.test(grant) && !READ_GRANT.test(grant)) {
      out.push(`tool grant '${grant}' is neither a file write nor a read; a Codex implementer runs no governed tool`);
    }
  }
  return [...out, ...grantScopes(argvGrants(args)).problems];
}

/** The grants the loop composed for this attempt, read from the worker's argv. */
function attemptScopes(worker: AuthorisedWorker): { readonly scopes: readonly string[]; readonly problems: readonly string[] } {
  return grantScopes(argvGrants(worker.args));
}

/**
 * Does this argv carry exactly one workspace-write sandbox and nothing that widens or replaces it? The prompt
 * (the last element) is text, not a flag. Null when it does; otherwise why not.
 */
export function implementerSandboxProblem(argv: readonly string[]): string | null {
  const all = argv.slice(0, -1);
  const pairAt = all.flatMap((a, i) => (a === WINDOWS_SANDBOX[0] && all[i + 1] === WINDOWS_SANDBOX[1] ? [i] : []));
  if (pairAt.length > 1) return 'the Codex command line carries the Windows sandbox mode more than once';
  const flags = pairAt.length === 1 ? [...all.slice(0, pairAt[0]), ...all.slice((pairAt[0] as number) + 2)] : all;
  const sandboxAt = flags.flatMap((a, i) => (a === '--sandbox' || a === '-s' || a.startsWith('--sandbox=') ? [i] : []));
  if (sandboxAt.length !== 1 || flags[sandboxAt[0] as number] !== '--sandbox' || flags[(sandboxAt[0] as number) + 1] !== 'workspace-write') {
    return 'the workspace-write sandbox could not be set on the Codex command line, so no worker is started';
  }
  const attached = (a: string) => /^-[csp]./.test(a) || /^--(config|sandbox|profile)=/.test(a);
  const sandboxValue = (sandboxAt[0] as number) + 1;
  const widened = flags.filter((a, i) => i !== sandboxValue && a !== '--sandbox' && (FORBIDDEN_TOKENS.has(a.split('=')[0] as string) || attached(a)));
  return widened.length === 0 ? null : `the Codex command line carries ${widened.join(', ')}, which widens or replaces the workspace-write sandbox`;
}

/** The exact argv an implementer run uses, or why it may not run. */
export function codexImplementerArgv(
  worker: AuthorisedWorker,
  root: string,
  instruction: string,
): { readonly ok: true; readonly argv: readonly string[] } | { readonly ok: false; readonly problem: string } {
  const problems = codexImplementerArgProblems(worker.args);
  if (problems.length > 0) return { ok: false, problem: `the Codex implementer '${worker.workerId}': ${problems.join('; ')}` };
  if (instruction.trim() === '' || instruction.startsWith('-')) return { ok: false, problem: 'the instruction is empty or would be read as a flag' };
  const argv = ['exec', ...splitArgs(worker.args).forwarded, ...WORKSPACE_WRITE_SANDBOX, ...WINDOWS_SANDBOX, ...FIXED_ARGS, '--cd', root, instruction];
  const sandbox = implementerSandboxProblem(argv);
  return sandbox === null ? { ok: true, argv } : { ok: false, problem: sandbox };
}

/** What one `codex exec --json` run reported about itself. */
export interface ImplementerRun {
  readonly turnCompleted: boolean;
  readonly failure: string | null;
  /** One fixed reason per item that suggests the run was steered or went beyond its remit. */
  readonly denials: readonly string[];
}

/**
 * A command that reads a secret file or the environment. A workspace-write sandbox restricts WRITES, not reads, so
 * `cat .env` stays inside the checkout and `commandProblem` passes it, and the output would go to the provider.
 * A tripwire on the command text, like the others: it can be dodged, and it may refuse a run that read a file
 * with such a name.
 */
const SECRET_FILE_NAMES =
  String.raw`(?:^|[\\/\s'"=(;,|&<>])(?:\.env(?!\.(?:example|sample|template)\b)(?:\.[\w.-]+)?|\.npmrc|\.netrc|\.pgpass|\.pypirc|id_rsa|id_ed25519|credentials(?:\.json)?|\.aws|\.ssh|\.kube|\.docker[\\/]config\.json)(?=$|[\\/\s'"&;|)])`;
const ENVIRONMENT_READS = String.raw`homedir\s*\(|process\.env|\bprintenv\b|\b(?:Get-ChildItem|gci|dir|ls)\s+env:|\$env:`;
const SECRET_READ = new RegExp(`${SECRET_FILE_NAMES}|${ENVIRONMENT_READS}`, 'i');

/** Free text from the provider or its stderr reaches a stop detail and the evidence: bounded, inert, and withheld whole if credential-shaped. */
function safeText(text: string, instruction: string): string {
  // Judged on the WHOLE text, before it is cut: a key straddling the cut would otherwise leak its first part.
  return credentialShaped(text, instruction) ? '<withheld: credential-shaped text>' : inert(text);
}

/** Items that neither act nor read beyond the checkout. A file change is expected of an implementer. */
const NEUTRAL_ITEMS: ReadonlySet<string> = new Set(['agent_message', 'reasoning', 'todo_list', 'file_change']);

/**
 * Read the JSONL stream. A line that is not a JSON object contributes nothing, so skipping one can only make a
 * run fail, never pass. An item of a kind this reader does not know is a denial (fail closed).
 */
export function readImplementerEvents(stdout: string, context: { readonly root: string; readonly instruction: string }): ImplementerRun {
  let turnCompleted = false;
  let failure: string | null = null;
  const denials = new Map<string, string>();
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
    if (type === 'turn.completed') turnCompleted = true;
    else if (type === 'turn.failed') failure = safeText(String((e['error'] as Record<string, unknown> | undefined)?.['message'] ?? ''), context.instruction) || 'the turn failed';
    else if (type === 'error') failure = safeText(String(e['message'] ?? ''), context.instruction) || 'the run reported an error';
    else if (type === 'item.started' || type === 'item.completed') {
      const item = e['item'];
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
      const it = item as Record<string, unknown>;
      const itemType = typeof it['type'] === 'string' ? it['type'] : 'unknown';
      const id = typeof it['id'] === 'string' ? it['id'] : `${itemType}#${denials.size}`;
      if (itemType === 'command_execution') {
        const reported = typeof it['command'] === 'string' ? innerCommand(it['command']) : '';
        const problem = commandProblem(it, context.root) ?? (SECRET_READ.test(reported) ? 'command_execution: reads a secret file or the environment' : null);
        if (problem !== null && !denials.has(id)) denials.set(id, problem);
      } else if (itemType === 'agent_message') {
        if (type === 'item.completed' && typeof it['text'] === 'string' && credentialShaped(it['text'], context.instruction)) {
          denials.set(`${CODEX_REPLY_WITHHELD}#reply`, CODEX_REPLY_WITHHELD);
        }
      } else if (itemType === 'error') {
        if (failure === null) failure = safeText(String(it['message'] ?? ''), context.instruction) || 'the run reported an error item';
      } else if (!NEUTRAL_ITEMS.has(itemType)) {
        denials.set(id, `${inert(itemType)}: an item an implementer is not expected to use`);
      }
    }
  }
  return { turnCompleted, failure, denials: [...denials.values()] };
}

function boundProblem(worker: AuthorisedWorker): string | null {
  const ms = worker.timeoutMs;
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
    ? null
    : 'this worker declares no attempt bound, and an attempt that cannot be ended is not one this runtime will start';
}

/** Why a Codex implementer is never rejoined. */
export const CODEX_IMPLEMENTER_NOT_RESUMABLE =
  `a '${CODEX_IMPLEMENTER}' worker is never resumed: it starts a fresh worker, which reads the brief and the loop's records; ` +
  'there is no Codex session to rejoin';

/**
 * The two fixed sentences the loop already uses for a start and a correction, and the function that turns the brief's context path into the
 * project-relative one the sentences may name. Injected, so this file imports nothing from the Claude adapter.
 */
export interface InstructionBuilders {
  readonly pointerInstruction: (briefPath: string, contextPath?: string) => string;
  readonly correctionInstruction: (briefPath: string, contextPath?: string) => string;
  readonly contextPointerPathOf: (contextPath: unknown, root: unknown) => string | null;
}

/** What actually happened, with the same non-completion outcomes as the other adapters. */
function outcomeFrom(r: { code: number; stdout: string; stderr: string; failure?: 'timeout' | 'not-started' | 'output-overflow' }, timeoutMs: number, instruction: string, root: string): WorkerOutcome {
  if (r.failure === 'timeout') return { kind: 'timedOut', afterMs: timeoutMs, stdout: '', stderr: '' };
  if (r.failure === 'output-overflow') {
    return { kind: 'refused', detail: 'the Codex worker ran but produced more output than the runtime will hold, and was ended before it finished' };
  }
  if (r.failure === 'not-started') {
    return {
      kind: 'refused',
      detail:
        `the Codex executable could not be started${r.stderr.trim() === '' ? '' : `: ${safeText(r.stderr.trim(), instruction)}`}` + ' — nothing ran, so this is not a run that failed',
    };
  }
  if (r.code !== 0) return { kind: 'completed', exitCode: r.code, stdout: '', stderr: safeText(r.stderr.trim().split(/\r?\n/).slice(-1)[0] ?? '', instruction), providerRef: null };
  const run = readImplementerEvents(r.stdout, { root, instruction });
  if (run.failure !== null) return { kind: 'refused', detail: `the Codex worker's turn failed: ${run.failure}` };
  if (run.denials.length > 0) {
    return { kind: 'refused', detail: `the Codex worker's run may have been steered or went beyond its remit: ${run.denials.join('; ')}` };
  }
  if (!run.turnCompleted) return { kind: 'refused', detail: 'the Codex worker exited without reporting a completed turn' };
  // A translation, never the raw event stream: command output in it may carry whatever the worker read.
  return { kind: 'completed', exitCode: 0, stdout: JSON.stringify({ type: 'result', is_error: false, session_id: null }), stderr: '', providerRef: null };
}

/** At most this many paths of a refusal are named; the count says how many there were. */
const MAX_NAMED_REFUSALS = 20;

function namedRefusals(refusals: readonly Refusal[]): string {
  const shown = refusals.slice(0, MAX_NAMED_REFUSALS).map((r) => `${plainName(r.path)} (${r.why})`);
  return `${shown.join(', ')}${refusals.length > shown.length ? ', …' : ''}`;
}

/** The brief with its root and record paths mapped into the scratch, or null when one of them is not inside the checkout. */
function scratchBriefOf(brief: WorkerBrief, scratch: ScratchCheckout): WorkerBrief | null {
  const r = brief.records;
  const at = (real: string): string | null => scratch.scratchPathOf(real);
  const mapped = [at(r.briefPath), at(r.findingsPath), at(r.effectsPath), at(r.evidencePath), r.contextPath === undefined ? '' : at(r.contextPath)];
  if (mapped.some((p) => p === null)) return null;
  const [briefPath, findingsPath, effectsPath, evidencePath, contextPath] = mapped as string[];
  return {
    ...brief,
    repository: { ...brief.repository, root: scratch.root },
    records: { ...r, briefPath, findingsPath, effectsPath, evidencePath, ...(r.contextPath === undefined ? {} : { contextPath }) },
  } as WorkerBrief;
}

/**
 * Put into the scratch what the worker reads and writes beside the code: its brief (rewritten to point into the scratch) and the
 * evidence, findings, effects and stored-context files that already exist in the real checkout. Returns the scratch path of the
 * brief, or why nothing may run.
 */
function prepareScratch(sys: System, scratch: ScratchCheckout, brief: WorkerBrief, briefPath: string): { readonly ok: true; readonly briefPath: string } | { readonly ok: false; readonly problem: string } {
  const inside = scratchBriefOf(brief, scratch);
  const where = scratch.scratchPathOf(briefPath);
  if (inside === null || where === null) return { ok: false, problem: 'a record path in the brief is not inside the checkout, so no worker was started' };
  const wrote = scratch.placeText(briefPath, `${JSON.stringify(inside, null, 2)}\n`);
  if (wrote !== null) return { ok: false, problem: `the brief could not be placed in the scratch checkout, so no worker was started: ${wrote}` };
  const records = [brief.records.evidencePath, brief.records.findingsPath, brief.records.effectsPath, ...(brief.records.contextPath === undefined ? [] : [brief.records.contextPath])];
  for (const record of records) {
    const placed = sys.exists(record) ? scratch.placeFile(record) : null;
    if (placed !== null) return { ok: false, problem: `a record could not be placed in the scratch checkout, so no worker was started: ${placed}` };
  }
  return { ok: true, briefPath: where };
}

/**
 * After a run: judge the scratch against the grants, and copy back only when the run itself was not refused. A refused run (steered,
 * failed turn, overflow) copies nothing, so it leaves the real tree byte-identical; a completed or timed-out run keeps its granted work.
 */
function settleScratch(scratch: ScratchCheckout, scopes: readonly string[], outcome: WorkerOutcome): Settled {
  const inspected = scratch.inspect(scopes);
  if (inspected.kind === 'unreadable') {
    return {
      outcome: { kind: 'refused', detail: `the scratch checkout could not be read after the run, so what the worker wrote cannot be judged and the run is not certified: ${inspected.reason}` },
      copyNote: NOTHING_COPIED,
    };
  }
  if (inspected.kind === 'refused') return { outcome: refusedCopyBack(inspected.refusals), copyNote: NOTHING_COPIED };
  if (outcome.kind === 'refused') return { outcome, copyNote: NOTHING_COPIED };
  const copied = scratch.copyBack();
  if (copied.kind === 'copied') return { outcome, copyNote: `the copy-back landed ${copied.paths.length} path(s)` };
  if (copied.kind === 'refused') return { outcome: refusedCopyBack(copied.refusals), copyNote: NOTHING_COPIED };
  const failure = `the copy-back failed: ${copied.reason}; ${copied.rolledBack ? 'the checkout was restored' : 'THE CHECKOUT MAY HOLD PART OF THE COPY'}`;
  return { outcome: { kind: 'refused', detail: `copying the worker's changes back failed: ${failure}, and nothing is certified` }, copyNote: failure };
}

/** What `settleScratch` decided, and what the copy-back did, so a later refusal can say both (the copy-back may already have landed). */
interface Settled {
  readonly outcome: WorkerOutcome;
  readonly copyNote: string;
}
const NOTHING_COPIED = 'nothing was copied back';

function refusedCopyBack(refusals: readonly Refusal[]): WorkerOutcome {
  return {
    kind: 'refused',
    detail:
      `the Codex worker changed ${refusals.length} path(s) its write grants do not allow in the scratch checkout: ${namedRefusals(refusals)}. ` +
      'The worker ran in a scratch copy, so nothing was copied back and the checkout is unchanged; nothing is certified',
  };
}

/** A scratch that could not be removed is said, on the outcome it belongs to. Never swallowed, and never turns a result into another. */
function withCleanupNote(outcome: WorkerOutcome, problem: string | null): WorkerOutcome {
  if (problem === null) return outcome;
  const note = `the scratch checkout could not be removed and was left in the temporary directory (${problem})`;
  if (outcome.kind === 'refused') return { ...outcome, detail: `${outcome.detail}; ${note}` };
  if (outcome.kind === 'completed' || outcome.kind === 'timedOut') return { ...outcome, stderr: outcome.stderr === '' ? note : `${outcome.stderr}; ${note}` };
  return outcome;
}

export function codexImplementerAdapterWith(instructions: InstructionBuilders, scratchHost: ScratchHost = nodeScratchHost): WorkerAdapter {
  return {
    kind: CODEX_IMPLEMENTER,

    start(sys: System, worker: AuthorisedWorker, brief: WorkerBrief, briefPath: string): WorkerOutcome {
      const unbounded = boundProblem(worker);
      if (unbounded !== null) return { kind: 'refused', detail: unbounded };
      if (brief.repository.head === null) return { kind: 'refused', detail: 'the brief is not bound to a commit, so no worker may be started from it' };
      const root = brief.repository.root;
      // The stored-context file, when the brief names one, by its project-relative path, exactly as the Claude adapter does it
      // (PROJECTOS-CONTEXT-CODEX1A). A path that is not that file under this root yields no pointer, never a guessed one.
      const contextPointer = instructions.contextPointerPathOf(brief.records.contextPath, root) ?? undefined;
      // A brief that names stored context this worker cannot be pointed at starts nothing: the loop records the file as shown,
      // and a worker that was never told where it is must not run under that record.
      if (brief.records.contextPath !== undefined && contextPointer === undefined) {
        return { kind: 'refused', detail: 'the brief names stored context at a path this worker cannot be pointed at, so no worker was started' };
      }
      // The correction sentence once the LOOP has written its evidence record (a worker cannot write it: not granted).
      const corrected = sys.exists(brief.records.evidencePath);
      const sentenceFor = (path: string): string =>
        corrected ? instructions.correctionInstruction(path, contextPointer) : instructions.pointerInstruction(path, contextPointer);
      // The configured arguments are judged before anything is made; the real run's argv is built again below, for the scratch.
      const probe = codexImplementerArgv(worker, root, sentenceFor(briefPath));
      if (!probe.ok) return { kind: 'refused', detail: probe.problem };
      const { scopes } = attemptScopes(worker);
      const before = candidateSnapshot(sys, root);
      if (before === null) return { kind: 'refused', detail: 'the checkout could not be read before the run, so no worker was started: a write scope cannot be judged afterwards without it' };
      const opened = scratchHost.open(sys, root);
      if (!opened.ok) return { kind: 'refused', detail: `no scratch checkout could be made, so no worker was started: ${opened.reason}` };
      const scratch = opened.scratch;
      const runWorker = (): WorkerOutcome => {
        const prepared = prepareScratch(sys, scratch, brief, briefPath);
        if (!prepared.ok) return { kind: 'refused', detail: prepared.problem };
        // From here the worker's root, brief and sentence are the scratch's.
        const instruction = sentenceFor(prepared.briefPath);
        const built = codexImplementerArgv(worker, scratch.root, instruction);
        if (!built.ok) return { kind: 'refused', detail: built.problem };
        const baselined = scratch.baseline();
        if (baselined !== null) return { kind: 'refused', detail: `the scratch checkout could not be read before the run, so no worker was started: ${baselined}` };
        const result = sys.exec(worker.command, built.argv, {
          // No credential-shaped variable is inherited, and the worker runs in the scratch checkout, never the governed one.
          scrubCredentials: true, ensureSystemPath: true, cwd: scratch.root,
          // BOUNDED, from the committed config, like every worker spawn.
          timeoutMs: worker.timeoutMs, maxOutputBytes: WORKER_MAX_OUTPUT_BYTES,
        });
        if (result.failure !== 'not-started') {
          // The scratch is judged and copied back FIRST, and the real tree is read AFTER that (review F1(c)): the backstop judges what
          // actually landed, copy-back included, not what the tree looked like before it.
          const settled = settleScratch(scratch, scopes, outcomeFrom(result, worker.timeoutMs, instruction, scratch.root));
          const after = candidateSnapshot(sys, root);
          if (after === null) return { kind: 'refused', detail: `the checkout could not be read after the run and the copy-back, so what reached it cannot be judged and the run is not certified; ${settled.copyNote}` };
          const breaches = scopeBreaches(before, after, scopes);
          if (breaches.length > 0) {
            const shown = breaches.slice(0, 20).map(plainName);
            return {
              kind: 'refused',
              detail:
                `the real checkout changed ${breaches.length} path(s) outside the write grants although the worker ran in a scratch copy: ${shown.join(', ')}${breaches.length > shown.length ? ', …' : ''}. ` +
                `Something reached the real tree by another route; the paths are left in the tree for the owner and nothing is certified. Copy-back: ${settled.copyNote}`,
            };
          }
          return settled.outcome;
        }
        return outcomeFrom(result, worker.timeoutMs, instruction, scratch.root);
      };
      let outcome: WorkerOutcome;
      let cleanup: string | null = null;
      try {
        outcome = runWorker();
      } finally {
        cleanup = scratch.dispose();
      }
      return withCleanupNote(outcome, cleanup);
    },

    rejoin(): WorkerOutcome {
      return { kind: 'refused', detail: CODEX_IMPLEMENTER_NOT_RESUMABLE };
    },
  };
}
