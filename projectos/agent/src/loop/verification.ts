/**
 * Running the phase's required checks, and collecting what happened as evidence.
 *
 * THE CHECKS COME FROM THE APPROVED PLAN, not from this file. A phase's `requiredValidators` is the
 * owner-approved list, so the loop resolves those names to validator scripts and runs exactly them.
 * A loop with its own idea of "the usual checks" would be running a different contract from the one
 * that was approved, and would still report a pass.
 *
 * A VALIDATOR NAME THAT DOES NOT RESOLVE IS A FAILURE, never a skip. Silently passing over a check
 * the plan requires is the single most dangerous thing this module could do: every downstream record
 * would say the required validators ran.
 *
 * REVIEWS ARE NOT RUN HERE, AND THAT IS SAID PLAINLY. A review is a judgement, not a script. The
 * loop's job is to require the review evidence and to refuse to move on without it — see
 * `outstandingReviews`. Claiming the loop "runs reviews automatically" because it shells out to
 * something would be exactly the kind of untruth this programme exists to remove.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import { createHash } from 'node:crypto';
import { execPath } from 'node:process';
import type { System } from '../system.js';
import { join } from '../context.js';
import { porcelainPaths } from './observation.js';
import type { WorkerBrief } from './brief.js';
import { effectsPath, findingsPath } from './session.js';
import { PINNED_VALIDATOR_ROOT, type ValidatorPin } from './pinnedValidators.js';

/**
 * The Node that runs a validator is THIS process's own executable, by absolute path.
 *
 * `sys.exec('node', …)` would be a bare name, and on Windows a bare name resolves against the
 * spawning process's current directory before PATH — and this CLI is cwd-rooted in the governed
 * checkout. A `node.exe` committed to a repository would then get to decide whether that
 * repository's own validators passed. `system.ts` binds git for exactly this reason; this is the
 * same rule for the same attack.
 */
export const VALIDATOR_RUNNER = execPath;

/** How much of a check's output is kept in evidence. Enough to diagnose, bounded so records stay readable. */
export const MAX_OUTPUT_CHARS = 4_000;

export type CheckKind = 'validator' | 'test' | 'typecheck' | 'lint';

export interface CheckSpec {
  readonly id: string;
  readonly kind: CheckKind;
  /** The executable to run. Absolute, always — a bare name resolves against the governed checkout. */
  readonly command: string;
  readonly args: readonly string[];
  /** Why this check cannot run, when it cannot. A check that cannot run has not passed. */
  readonly unrunnable: string | null;
  /** How long the check may run before it is stopped. Defaults to `DEFAULT_CHECK_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
}

export interface CheckResult {
  readonly id: string;
  readonly kind: CheckKind;
  readonly passed: boolean;
  readonly exitCode: number;
  readonly output: string;
  readonly at: string;
  /** The bound the check ran under — recorded, so a stopped check is never mistaken for a slow pass. */
  readonly timeoutMs?: number;
  /** True when the check was stopped at its bound. A check that did not finish has not passed. */
  readonly timedOut?: boolean;
}

/**
 * EVERY CHECK IS BOUNDED — PROJECTOS-BOOT-CONTINUE1A.
 *
 * A configured check used to run with no limit at all, so one hung test suite held a governed run
 * open for ever and nothing downstream could happen. Every check now runs under a bound: the default
 * matches the worker's own, and a project may declare a longer one per check (`timeoutMinutes`, up to
 * the maximum) for a genuinely slow suite. A check stopped at its bound FAILS, with that said in its
 * output, and flows into the same governed stop as any other failing check.
 */
export const DEFAULT_CHECK_TIMEOUT_MS = 90 * 60_000;
export const MAX_CHECK_TIMEOUT_MINUTES = 240;

/**
 * A validator name that is safe to turn into a path.
 *
 * The name comes from `phases[].requiredValidators` in the plan — a FILE, which the worker this loop
 * spawns can write to, and which the plan schema constrains only to "string". Without this, a name
 * of `../../../../somewhere/payload` resolves out of the validators directory at the syscall
 * boundary and the loop runs it, recording the exit code as a required validator that passed. No
 * separator, no dot: the same discipline `session.ts` applies to session ids.
 */
const SAFE_VALIDATOR_NAME = /^[A-Za-z0-9_-]{1,80}$/;

/** The id suffix that marks a validator check as the phase's own copy rather than the pinned base copy. */
export const PHASE_COPY_SUFFIX = '@phase-copy';

function validatorScript(root: string, name: string): string {
  return join(root, 'projectos', 'validators', `${name}.cjs`);
}

/** Windows drive-qualified or POSIX absolute. Duplicated deliberately — see `workers.ts`. */
function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\');
}

/**
 * The checks this phase requires: the validators THE PLAN names, plus the suites the PROJECT
 * declares.
 *
 * The split is deliberate. Which validators must pass is an owner-approved statement about a phase,
 * so it comes from the plan and the loop may not add to it. Which tests a project runs is a property
 * of the repository that no plan could sensibly name, so it comes from config. Neither is invented
 * here.
 *
 * A plan may name a validator this repository does not have — a typo, a rename, one never written.
 * A config may name an executable that is not absolute. Both are recorded as `unrunnable` and FAIL
 * when run; neither is ever skipped.
 *
 * EVERY VALIDATOR RUNS FROM THE PHASE'S BASE COMMIT — PROJECTOS-FINISH-WRITEPATHS1A. The pin is not
 * optional: there is no way to build a validator check that runs the working tree's copy. See
 * `pinnedValidators.ts`.
 */
export function requiredChecks(
  sys: System,
  root: string,
  brief: WorkerBrief,
  configured: readonly ConfiguredCheck[],
  pin: ValidatorPin,
): readonly CheckSpec[] {
  return checksFor(sys, root, brief.phase.requiredValidators, configured, pin);
}

/**
 * The PHASE'S OWN COPY of each required validator its approved write paths cover — PROJECTOS-FINISH-
 * CONTINUE-INTEGRITY1A (EXTERNAL-PROOF2A D8).
 *
 * WHY. Every validator runs from the base commit, so a phase cannot weaken what judges it. The other side
 * of that rule was found live: a phase whose job was to CHANGE its own required validator was judged only
 * by the old copy, so the new code, with real gaps, passed every gate and was closed. When the grant covers
 * a required validator, its phase copy is therefore run as well, against the subject, with its own id.
 * It is ADDED, never substituted: the pinned base copy still runs and must still pass, so the phase copy
 * can only add a failure, never remove one.
 *
 * `paths` are the phase's repository-relative write paths. Only an EXACT file entry covers a validator: the
 * write-grant rule refuses any directory over `projectos/validators/` (`workers.ts`), so a directory entry
 * could never be the grant that let the phase change it.
 */
export function phaseCopyChecks(sys: System, root: string, requiredValidators: readonly string[], paths: readonly string[]): readonly CheckSpec[] {
  const covered = (rel: string): boolean => paths.some((p) => p.replace(/\\/g, '/').replace(/^\.[/]/, '') === rel);
  return requiredValidators
    .filter((name) => SAFE_VALIDATOR_NAME.test(name) && covered(`projectos/validators/${name}.cjs`))
    .map((name) => {
      const script = validatorScript(root, name);
      return {
        id: `${name}${PHASE_COPY_SUFFIX}`,
        kind: 'validator' as const,
        command: VALIDATOR_RUNNER,
        args: [script],
        unrunnable: sys.exists(script) ? null : `the phase's own copy of validator '${name}' is missing, so the check it was granted cannot judge it`,
        timeoutMs: PHASE_COPY_TIMEOUT_MS,
      };
    });
}

/** The phase copy is worker-written code run before any review, so its bound is short. */
export const PHASE_COPY_TIMEOUT_MS = 10 * 60_000;

/** The largest checkout picture the phase-copy guard reads; anything larger fails the copy, closed. */
export const PHASE_COPY_PICTURE_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Run the phase copies, each failing if it changed the checkout — ECC SECURITY against this phase.
 *
 * A phase copy is the worker's own code, run before any reviewer sees it. Running it must leave the
 * checkout exactly as it found it, ignored and untracked files included: otherwise it could leave state
 * that a later attempt, or a pinned base check, then loads. The checkout is compared before and after
 * each copy, and any difference fails that copy, with the reason in its output.
 */
export function runPhaseCopyChecks(sys: System, root: string, specs: readonly CheckSpec[]): readonly CheckResult[] {
  // A FULL PICTURE ON A REAL CHECKOUT IS LARGE: ignored build output alone ran to megabytes here, past the
  // spawn default, and an overflow reads as "git could not say" — failing every copy (ECC SECURITY round 2).
  const picture = (): string | null => {
    const s = sys.exec('git', ['-C', root, '--no-optional-locks', 'status', '--porcelain', '--ignored', '--untracked-files=all'], {
      maxOutputBytes: PHASE_COPY_PICTURE_MAX_BYTES,
    });
    return s.code === 0 ? s.stdout : null;
  };
  return specs.map((spec) => {
    const before = picture();
    const result = runCheck(sys, root, spec);
    const after = picture();
    if (before !== null && after !== null && before === after) return result;
    return {
      ...result,
      passed: false,
      output: `${result.output}\n[ProjectOS] the phase's own validator copy changed the checkout while it ran (or git could not say), so it fails: a check must leave the tree as it found it.`.slice(-MAX_OUTPUT_CHARS),
    };
  });
}

/**
 * The same check set from the plan phase's validator names directly — for closure preparation, which
 * re-runs exactly what the run ran, at the pushed subject, with no brief in hand.
 */
export function checksFor(
  sys: System,
  root: string,
  requiredValidators: readonly string[],
  configured: readonly ConfiguredCheck[],
  pin: ValidatorPin,
): readonly CheckSpec[] {
  const validators: CheckSpec[] = requiredValidators.map((name) => {
    if (!SAFE_VALIDATOR_NAME.test(name)) {
      return {
        id: name,
        kind: 'validator' as const,
        command: VALIDATOR_RUNNER,
        args: [],
        unrunnable:
          `the plan requires a validator named '${name}', which is not a plain validator name; ` +
          'the loop will not turn it into a path',
      };
    }
    const script = validatorScript(root, name);
    if (!pin.ok) {
      return {
        id: name,
        kind: 'validator' as const,
        command: VALIDATOR_RUNNER,
        args: [],
        unrunnable: `validator '${name}' cannot be run from the phase's base commit: ${pin.problem}`,
      };
    }
    if (!pin.files.has(`${PINNED_VALIDATOR_ROOT}/${name}.cjs`)) {
      return {
        id: name,
        kind: 'validator' as const,
        command: VALIDATOR_RUNNER,
        args: [],
        unrunnable:
          `the approved plan requires validator '${name}', which is not in the phase's base commit ${pin.commit.slice(0, 12)}; ` +
          'a validator the phase itself added cannot judge that phase',
      };
    }
    return {
      id: name,
      kind: 'validator' as const,
      command: VALIDATOR_RUNNER,
      args: ['--require', pin.loader, script],
      unrunnable: sys.exists(script)
        ? null
        : `the approved plan requires validator '${name}', which does not exist at ${script}`,
    };
  });

  const suites: CheckSpec[] = configured.map((c) => ({
    id: c.id,
    kind: c.kind,
    command: c.command,
    args: c.args,
    ...(c.timeoutMs === undefined ? {} : { timeoutMs: c.timeoutMs }),
    unrunnable: isAbsolutePath(c.command)
      ? null
      : `check '${c.id}' declares command '${c.command}', which is not an absolute path; ` +
        'a bare name would resolve against the governed checkout before PATH',
  }));

  return [...validators, ...suites];
}

/** A test, typecheck or lint command the project declares. Validators are NOT configured here. */
export interface ConfiguredCheck {
  readonly id: string;
  readonly kind: Exclude<CheckKind, 'validator'>;
  readonly command: string;
  readonly args: readonly string[];
  /** From `timeoutMinutes`, when the project declares one. */
  readonly timeoutMs?: number;
}

const CONFIGURED_KINDS: ReadonlySet<string> = new Set(['test', 'typecheck', 'lint']);

/** Read `execution.checks`. Malformed entries are dropped with their reason, never guessed at. */
export function configuredChecks(config: Record<string, unknown>): {
  readonly checks: readonly ConfiguredCheck[];
  readonly problems: readonly string[];
} {
  const execution = config['execution'];
  if (execution === null || typeof execution !== 'object' || Array.isArray(execution)) {
    return { checks: [], problems: [] };
  }
  const raw = (execution as Record<string, unknown>)['checks'];
  if (raw === undefined) return { checks: [], problems: [] };
  if (!Array.isArray(raw)) return { checks: [], problems: ['execution.checks is not an array'] };

  const checks: ConfiguredCheck[] = [];
  const problems: string[] = [];
  for (const [i, entry] of raw.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`execution.checks[${i}] is not an object`);
      continue;
    }
    const e = entry as Record<string, unknown>;
    const id = typeof e['id'] === 'string' ? e['id'] : '';
    const kind = typeof e['kind'] === 'string' ? e['kind'] : '';
    const command = typeof e['command'] === 'string' ? e['command'] : '';
    if (id === '' || !CONFIGURED_KINDS.has(kind) || command === '') {
      problems.push(`execution.checks[${i}] needs an id, a kind of test|typecheck|lint, and a command`);
      continue;
    }
    const minutes = e['timeoutMinutes'];
    if (
      minutes !== undefined &&
      (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_CHECK_TIMEOUT_MINUTES)
    ) {
      problems.push(`execution.checks[${i}].timeoutMinutes must be a whole number from 1 to ${MAX_CHECK_TIMEOUT_MINUTES}`);
      continue;
    }
    checks.push({
      id,
      kind: kind as ConfiguredCheck['kind'],
      command,
      args: Array.isArray(e['args']) ? e['args'].filter((a): a is string => typeof a === 'string') : [],
      ...(typeof minutes === 'number' ? { timeoutMs: minutes * 60_000 } : {}),
    });
  }
  return { checks, problems };
}

/**
 * Anything shaped like `NAME=value` or `NAME: value` where NAME looks like a credential.
 *
 * Check output lands verbatim in a durable evidence record the owner is expected to read and keep.
 * A test that echoes its environment, or a tool that prints the token it was handed, would put a
 * live secret there — and the project's own secrets policy requires redaction.
 */
const CREDENTIAL_IN_OUTPUT = /((?:[A-Za-z0-9_-]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z0-9_-]*)\s*[:=]\s*)(\S+)/gi;

export function redact(text: string): string {
  return text.replace(CREDENTIAL_IN_OUTPUT, (_m, prefix: string) => `${prefix}<redacted>`);
}

function trimOutput(stdout: string, stderr: string): string {
  const combined = redact(`${stdout}${stderr === '' ? '' : `\n${stderr}`}`.trim());
  return combined.length <= MAX_OUTPUT_CHARS
    ? combined
    : `${combined.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated at ${MAX_OUTPUT_CHARS} characters`;
}

/** Run one check. Never throws; a check that cannot run is a failure with the reason in its output. */
export function runCheck(sys: System, root: string, spec: CheckSpec): CheckResult {
  if (spec.unrunnable !== null) {
    return {
      id: spec.id,
      kind: spec.kind,
      passed: false,
      exitCode: 127,
      output: `${spec.unrunnable}. A required check that cannot run has not passed.`,
      at: sys.now(),
    };
  }
  // Run IN the governed repository. `--prefix projectos/core` and every other relative argument
  // would otherwise resolve against whatever directory ProjectOS was started in, so a check could
  // report a pass for a different checkout entirely.
  // The owner's committed checks are `node.exe` running `npm-cli.js`, and npm spawns the tooling it
  // is asked for. Under the packaged daemon's PATH-free environment they all failed -- not because
  // anything was broken, but because npm could not find the operating system: run directly, the same
  // checks pass. Same fixed, derived path the worker gets; ProjectOS still resolves every executable
  // it launches absolutely.
  const timeoutMs = spec.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const r = sys.exec(spec.command, [...spec.args], {
    scrubCredentials: true,
    cwd: root,
    ensureSystemPath: true,
    timeoutMs,
  });
  const timedOut = r.failure === 'timeout';
  return {
    id: spec.id,
    kind: spec.kind,
    passed: r.code === 0 && !timedOut,
    exitCode: r.code,
    output: timedOut
      ? `the check did not finish within ${Math.round(timeoutMs / 60_000)} minute(s) and was stopped; a check that did not ` +
        `finish has not passed.\n${trimOutput(r.stdout, r.stderr)}`
      : trimOutput(r.stdout, r.stderr),
    at: sys.now(),
    timeoutMs,
    ...(timedOut ? { timedOut: true } : {}),
  };
}

/** Run every required check, in the order the plan lists them. */
export function runChecks(sys: System, root: string, specs: readonly CheckSpec[]): readonly CheckResult[] {
  return specs.map((s) => runCheck(sys, root, s));
}

/* ---------------------------------------------------------------------------------------------- *
 * Evidence.
 * ---------------------------------------------------------------------------------------------- */

export interface ExecutionEvidence {
  readonly schemaVersion: string;
  /**
   * The invocation that started the run this evidence describes. Absent only on evidence collected
   * before the provenance control existed — see `invocation.ts`.
   */
  readonly invocationId?: string;
  readonly sessionId: string;
  readonly phaseId: string;
  readonly briefId: string;
  readonly collectedAt: string;
  /** The commit the brief was bound to, and where the checkout stands now. */
  readonly baseHead: string;
  readonly currentHead: string | null;
  readonly changedFiles: readonly string[];
  readonly diffStat: string;
  readonly checks: readonly CheckResult[];
  /** Reviews the plan requires. Listed, never claimed — see the module note. */
  readonly requiredReviews: readonly string[];
  /**
   * The sha256 of the worker's effects attestation AS THE RUNNER COLLECTED IT, or null when there was
   * none to read — PROJECTOS-BOOT-CONTINUE1A. The worker may write its attestation; it cannot write
   * this record. So a later rewrite of the attestation is detectable, and the protected-effects closure
   * predicate reads the attestation only when it still hashes to this value. Absent on evidence
   * collected before this field existed, which that predicate treats as not established.
   */
  readonly effectsSha256?: string | null;
  /**
   * The sha256 of the worker's findings record AS THE RUNNER COLLECTED IT, or null when there was none —
   * PROJECTOS-BOOT-CONTINUE1A. Closure preparation turns the findings into closure facts; it believes
   * them only while they still hash to this value, so a HIGH finding cannot be marked resolved after
   * the run was judged.
   */
  readonly findingsSha256?: string | null;
}

export const EVIDENCE_SCHEMA_VERSION = '1.0.0';

function gitLines(sys: System, root: string, args: readonly string[]): readonly string[] {
  const r = sys.exec('git', ['-C', root, ...args]);
  if (r.code !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * What this run did to the checkout, plus what the checks said.
 *
 * Changed files are measured from the commit the BRIEF was bound to, not from the last commit: work
 * that was committed mid-phase is still this phase's work, and a diff against HEAD would report an
 * empty change set for a phase that rewrote half the repository.
 */
export function collectEvidence(
  sys: System,
  root: string,
  input: {
    readonly sessionId: string;
    readonly brief: WorkerBrief;
    readonly checks: readonly CheckResult[];
  },
): ExecutionEvidence {
  const base = String(input.brief.repository.head);
  const headOut = sys.exec('git', ['-C', root, 'rev-parse', 'HEAD']);
  const currentHead = headOut.code === 0 && /^[0-9a-f]{40}$/.test(headOut.stdout.trim()) ? headOut.stdout.trim() : null;

  const committed = gitLines(sys, root, ['diff', '--name-only', `${base}..HEAD`]);
  // The SAME parser the observation uses. Two copies would let "what is dirty" and "what changed"
  // drift apart while both claim to describe one checkout.
  // EVERY FILE, never a collapsed directory: a new untracked directory is otherwise listed as `dir/`,
  // and closure preparation binds the subject to exactly the files the run changed.
  const status = sys.exec('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all']);
  const uncommitted = status.code === 0 ? porcelainPaths(status.stdout) : [];
  const changedFiles = [...new Set([...committed, ...uncommitted])].sort();

  const stat = sys.exec('git', ['-C', root, 'diff', '--stat', base]);
  const effectsText = sys.readText(effectsPath(root, input.sessionId));
  const findingsText = sys.readText(findingsPath(root, input.sessionId));
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    sessionId: input.sessionId,
    phaseId: input.brief.phase.phaseId,
    briefId: input.brief.briefId,
    collectedAt: sys.now(),
    baseHead: base,
    currentHead,
    changedFiles,
    diffStat: stat.code === 0 ? stat.stdout.trim() : '<the diff since the brief’s commit could not be read>',
    checks: input.checks,
    requiredReviews: input.brief.phase.requiredReviews,
    effectsSha256: effectsText === null ? null : createHash('sha256').update(effectsText, 'utf8').digest('hex'),
    findingsSha256: findingsText === null ? null : createHash('sha256').update(findingsText, 'utf8').digest('hex'),
  };
}
