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
import { execPath } from 'node:process';
import type { System } from '../system.js';
import { join } from '../context.js';
import { porcelainPaths } from './observation.js';
import type { WorkerBrief } from './brief.js';

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
}

export interface CheckResult {
  readonly id: string;
  readonly kind: CheckKind;
  readonly passed: boolean;
  readonly exitCode: number;
  readonly output: string;
  readonly at: string;
}

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
 */
export function requiredChecks(sys: System, root: string, brief: WorkerBrief, configured: readonly ConfiguredCheck[] = []): readonly CheckSpec[] {
  const validators: CheckSpec[] = brief.phase.requiredValidators.map((name) => {
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
    return {
      id: name,
      kind: 'validator' as const,
      command: VALIDATOR_RUNNER,
      args: [script],
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
    checks.push({
      id,
      kind: kind as ConfiguredCheck['kind'],
      command,
      args: Array.isArray(e['args']) ? e['args'].filter((a): a is string => typeof a === 'string') : [],
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
  const r = sys.exec(spec.command, [...spec.args], { scrubCredentials: true });
  return {
    id: spec.id,
    kind: spec.kind,
    passed: r.code === 0,
    exitCode: r.code,
    output: trimOutput(r.stdout, r.stderr),
    at: sys.now(),
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
  const status = sys.exec('git', ['-C', root, 'status', '--porcelain']);
  const uncommitted = status.code === 0 ? porcelainPaths(status.stdout) : [];
  const changedFiles = [...new Set([...committed, ...uncommitted])].sort();

  const stat = sys.exec('git', ['-C', root, 'diff', '--stat', base]);
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
  };
}
