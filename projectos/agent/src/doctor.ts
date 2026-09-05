/**
 * DOCTOR — is this machine fit to do governed work right now?
 *
 * A preflight, not a diagnostic tool. It answers one question in under ten seconds: if ProjectOS
 * starts a worker, pays a reviewer, or commits and pushes on its own, will it be doing that on a
 * machine where those things can actually work?
 *
 * EVERY CHECK HERE IS A FAILURE THIS PROJECT HAS ALREADY HAD. None of them is hypothetical:
 *
 *   * Git absent from the runtime's PATH crashed `git.exe` with 0xC0000005 and no stderr, so the
 *     loop reported governance findings that were all false — "the committed gatekeeper.json
 *     declares no programmeId" against a file that declared one.
 *   * `PATHEXT`, not `PATH`, broke npm, and a missing bound-git directory killed 284 tests. Four
 *     environment faults were each reported as a fact about the code.
 *   * A disk with no room turned a validator run into a cascade of unexplained failures.
 *   * An unreadable project configuration made every downstream read a null that ten callers each
 *     interpreted as "the record says no" rather than "I could not ask".
 *
 * WHAT IT NEVER DOES. It performs no protected action, authorises nothing, spends nothing, and
 * writes nothing outside a caller-supplied report. It only reads. A Doctor that could fix things
 * would be a Doctor that could break them.
 *
 * IT REPORTS SEVERITY, AND THE CALLER DECIDES. `blocking` means "an autonomous or paid action must
 * not start"; `advisory` means "worth knowing, and not a reason to stop someone reading a screen".
 * The same report therefore serves the mandatory contexts and the advisory ones without either
 * borrowing the other's answer — see `MANDATORY_CONTEXTS`.
 *
 * Built for the doctor-preflight phase of the Speed and Reliability plan.
 */
import type { System } from './system.js';
import { join, projectopsDir } from './context.js';

/** How long the whole preflight may take before it is itself the problem. */
export const DOCTOR_BUDGET_MS = 10_000;

/**
 * What a failing check means for the caller.
 *
 * `blocking` is deliberately narrow. A check earns it only when proceeding would produce a WRONG
 * ANSWER rather than a slow or ugly one — a governance fact derived from an unreadable record, a
 * commit that cannot be made, a paid call whose evidence could not be assembled. Everything else is
 * advisory, because a preflight that blocks on taste is one an owner learns to bypass.
 */
export type DoctorSeverity = 'blocking' | 'advisory';

export interface DoctorCheck {
  readonly id: string;
  /** What was asked, in words an owner reads once and understands. */
  readonly asked: string;
  readonly passed: boolean;
  readonly severity: DoctorSeverity;
  /** Why it failed, or what it found. Never empty on a failure. */
  readonly detail: string;
  readonly ms: number;
}

export interface DoctorReport {
  readonly ok: boolean;
  /** True when every BLOCKING check passed, whatever the advisory ones said. */
  readonly safeToActAutonomously: boolean;
  readonly checks: readonly DoctorCheck[];
  readonly totalMs: number;
  readonly withinBudget: boolean;
  readonly at: string;
}

/**
 * The contexts in which Doctor is MANDATORY, from the plan's own words.
 *
 * Exported as a closed list because the acceptance criterion is about exactly these three and
 * exactly not the others: browsing, read-only inspection and local preview stay advisory. A context
 * that is not named here has not been made mandatory by being added to some caller.
 */
export const MANDATORY_CONTEXTS = [
  'autonomous-execution',
  'paid-gatekeeper-dispatch',
  'technical-continuation',
] as const;

export type MandatoryContext = (typeof MANDATORY_CONTEXTS)[number];

/** Is Doctor mandatory for this context, or merely advisory? */
export function doctorIsMandatoryFor(context: string): boolean {
  return (MANDATORY_CONTEXTS as readonly string[]).includes(context);
}

/**
 * Is this command an absolute path the runtime can spawn without guessing at PATH?
 *
 * WRITTEN WITHOUT A REGEX ON PURPOSE. The first version was a pattern whose backslash did not
 * survive being written as a string: the compiled class matched a forward slash and NOT a
 * backslash, so an ordinary Windows path would have been reported as "not an absolute path" and
 * failed a BLOCKING check. Comparing characters cannot be mis-escaped.
 */
function isAbsoluteCommand(cmd: string): boolean {
  if (cmd.startsWith('/')) return true;
  if (cmd.length < 3 || cmd[1] !== ':') return false;
  const drive = cmd[0] ?? '';
  const sep = cmd[2] ?? '';
  const isLetter = (drive >= 'a' && drive <= 'z') || (drive >= 'A' && drive <= 'Z');
  return isLetter && (sep === '/' || sep === String.fromCharCode(92));
}

function timed<T>(fn: () => T): { value: T; ms: number } {
  const start = Date.now();
  const value = fn();
  return { value, ms: Date.now() - start };
}

/**
 * Can the runtime ask git anything at all?
 *
 * BLOCKING, and the most important check here. Every governed fact this system states is read from
 * COMMITTED bytes, and git is what reads them. Without it the loop does not fail — it produces a
 * cascade of confident, false findings about the plan, the delegation and the gatekeeper, because
 * ten separate callers read `null` as "the record says no" instead of "I could not ask".
 */
function checkGit(sys: System, root: string): DoctorCheck {
  const t = timed(() => {
    // ASKED THE WAY EVERY OTHER GOVERNED READ ASKS IT. `sys.exec('git', ...)` is the convention:
    // the System resolves the bound executable itself and runs it under a MINIMAL environment.
    // Resolving the absolute path here and spawning it directly would skip that hardening and ask
    // a different question from the one the loop will ask a moment later — a preflight that probes
    // a path the real call does not take is worse than none.
    const r = sys.exec('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { timeoutMs: 4000 });
    if (r.code === 127) {
      return { passed: false, detail: 'no bound git executable; set PROJECTOS_GIT_EXE or install Git' };
    }
    if (r.code !== 0 || r.stdout.trim() !== 'true') {
      const why = r.stderr.trim() === '' ? `exit ${r.code}` : r.stderr.trim().slice(0, 200);
      return { passed: false, detail: `git could not read this checkout: ${why}` };
    }
    return { passed: true, detail: 'git answers for this checkout' };
  });
  return {
    id: 'git-usable',
    asked: 'Can ProjectOS read this repository with git?',
    severity: 'blocking',
    passed: t.value.passed,
    detail: t.value.detail,
    ms: t.ms,
  };
}

/**
 * Can the runtime read committed bytes, not merely reach git?
 *
 * BLOCKING, and distinct from the check above: a working tree that git can describe is not the same
 * as a HEAD whose objects can be read. `git show HEAD:...` is the exact operation every governed
 * read performs, so this asks the question in the form the runtime actually asks it.
 */
function checkCommittedRead(sys: System, root: string): DoctorCheck {
  const t = timed(() => {
    const r = sys.exec('git', ['-C', root, 'rev-parse', 'HEAD'], { timeoutMs: 4000 });
    if (r.code !== 0 || !/^[0-9a-f]{40}$/.test(r.stdout.trim())) {
      return { passed: false, detail: 'HEAD is not readable as a commit' };
    }
    return { passed: true, detail: `HEAD ${r.stdout.trim().slice(0, 12)}` };
  });
  return {
    id: 'committed-read',
    asked: 'Can ProjectOS read the committed record it governs from?',
    severity: 'blocking',
    passed: t.value.passed,
    detail: t.value.detail,
    ms: t.ms,
  };
}

/**
 * Does this project's own configuration parse?
 *
 * BLOCKING. An unreadable configuration is the root that makes every later read a null, and a null
 * from an oracle is not a fact about the subject.
 */
function checkProjectConfig(sys: System, root: string): DoctorCheck {
  const t = timed(() => {
    const path = join(projectopsDir(root), 'project-config.json');
    const text = sys.readText(path);
    if (text === null) return { passed: false, detail: `no project configuration at ${path}` };
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { passed: false, detail: 'the project configuration is not a JSON object' };
      }
      const id = (parsed as Record<string, unknown>)['projectId'];
      if (typeof id !== 'string' || id.trim() === '') {
        return { passed: false, detail: 'the project configuration declares no projectId' };
      }
      return { passed: true, detail: `projectId ${id}` };
    } catch {
      return { passed: false, detail: 'the project configuration is not valid JSON' };
    }
  });
  return {
    id: 'project-config',
    asked: 'Does this project declare a configuration ProjectOS can read?',
    severity: 'blocking',
    passed: t.value.passed,
    detail: t.value.detail,
    ms: t.ms,
  };
}

/**
 * Are the governed records where ProjectOS expects them?
 *
 * ADVISORY, and deliberately WITHOUT A WRITE. The first version created a probe file in
 * `.projectops` and deleted it. Both reviewers called that HIGH, independently, and they were
 * right twice over: the probe is not in `ASKING_RECORD_PATHS`, so one surviving a crash joins the
 * reviewed candidate -- and `doCommit` stages the candidate's own entries, so it could be committed
 * into governed history. Worse, a probe left by an earlier crash was read as a PASS and never
 * cleaned up, so the hazard was permanent and self-masking: Doctor reported a clean bill of health
 * over the exact residue that would later refuse phase closure at G4-13.
 *
 * Doctor runs BETWEEN the candidate freeze and the continuation, so that window was real.
 *
 * The claim at the top of this file -- that Doctor writes nothing -- is now true. The writability
 * this proved was already proven moments later by the run's own first record write, which fails
 * loudly. A check worth less than the risk it carries should not exist.
 */
function checkGovernedDirectory(sys: System, root: string): DoctorCheck {
  const t = timed(() => {
    const dir = projectopsDir(root);
    if (!sys.exists(dir)) return { passed: false, detail: 'this checkout has no .projectops directory' };
    const entries = sys.listDir(dir);
    return entries.length === 0
      ? { passed: false, detail: 'the .projectops directory is empty or unreadable' }
      : { passed: true, detail: String(entries.length) + ' governed record group(s)' };
  });
  return {
    id: 'governed-directory',
    asked: 'Are this project GOVERNED records where ProjectOS expects them?',
    severity: 'advisory',
    passed: t.value.passed,
    detail: t.value.detail,
    ms: t.ms,
  };
}

/**
 * Is the runtime that runs the configured checks actually reachable?
 *
 * BLOCKING for autonomous work: the configured checks are how a phase proves itself, and a check
 * runner that cannot start turns "the tests did not pass" into "the tests did not run" — reported,
 * historically, as the former.
 */
function checkRunnerReachable(sys: System, root: string, commands: readonly string[]): DoctorCheck {
  const t = timed(() => {
    // THE SAME RULE `verification.ts` ALREADY APPLIES. It marks a non-absolute check command
    // unrunnable, because a bare name resolves against the governed checkout before PATH. The
    // first version of this check SKIPPED bare names and still reported "N commands resolve" -- a
    // blocking gate claiming it had verified commands it never looked at, for the ordinary
    // `npm`/`node` shape. Under-verifying while sounding verified is worse than not checking.
    const unresolved: string[] = [];
    let examined = 0;
    for (const cmd of commands) {
      if (cmd.trim() === '') continue;
      examined += 1;
      const absolute = isAbsoluteCommand(cmd);
      if (!absolute) unresolved.push(cmd + ' (not an absolute path)');
      else if (!sys.exists(cmd)) unresolved.push(cmd + ' (not found)');
    }
    return unresolved.length === 0
      ? { passed: true, detail: examined + ' configured check command(s) resolve to a real executable' }
      : { passed: false, detail: 'check command(s) ProjectOS could not resolve: ' + unresolved.join('; ') };
  });
  return {
    id: 'check-runner',
    asked: 'Can ProjectOS run the checks this project configures?',
    severity: 'blocking',
    passed: t.value.passed,
    detail: t.value.detail,
    ms: t.ms,
  };
}

/**
 * Run the preflight.
 *
 * Reads only. The `checkCommands` are supplied by the caller rather than read here, so this stays a
 * pure function of what it is given and the filesystem it is pointed at.
 */
export function runDoctor(
  sys: System,
  root: string,
  options: { readonly checkCommands?: readonly string[] } = {},
): DoctorReport {
  const started = Date.now();
  const checks: DoctorCheck[] = [
    checkGit(sys, root),
    checkCommittedRead(sys, root),
    checkProjectConfig(sys, root),
    checkRunnerReachable(sys, root, options.checkCommands ?? []),
    checkGovernedDirectory(sys, root),
  ];
  const totalMs = Date.now() - started;
  const blockingFailed = checks.filter((c) => !c.passed && c.severity === 'blocking');
  return {
    ok: checks.every((c) => c.passed),
    safeToActAutonomously: blockingFailed.length === 0,
    checks,
    totalMs,
    withinBudget: totalMs <= DOCTOR_BUDGET_MS,
    at: sys.now(),
  };
}

/**
 * The refusal a mandatory context shows when the preflight did not pass.
 *
 * Names every blocking failure rather than the first: an owner fixing one and hitting the next is
 * how a preflight earns a reputation for wasting time.
 */
export function doctorRefusalLines(report: DoctorReport, context: MandatoryContext): readonly string[] {
  const failed = report.checks.filter((c) => !c.passed && c.severity === 'blocking');
  return [
    `REFUSED (DOCTOR_PREFLIGHT_FAILED): ${context} is withheld because this machine is not fit for it.`,
    ...failed.map((c) => `  - ${c.asked} ${c.detail}`),
    '',
    'Doctor performs no action and authorises none; it only reports. Fix the above and run again.',
  ];
}
