/**
 * Derive the G4 closure facts from the repository and the runtime.
 *
 * The rule this file exists to enforce: **a fact asserted by whoever wants the closure is not
 * evidence.** Nothing here reads a field off the closure request. Everything is either computed live
 * (project identity, plan readiness, phase state, git reconciliation, working-tree cleanliness) or
 * read from a durable, HEAD-BOUND evidence record that some earlier, separate step had to write.
 *
 * The evidence record deliberately cannot be satisfied by intent. It carries the commit it was
 * established against, and `evaluateClosureEligibility` refuses when that commit is not the one being
 * closed — so a record written before the work changed is stale rather than convenient.
 *
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */
import type { System } from './system.js';
import { join, projectopsDir } from './context.js';
import type { GovernedContext } from './governedContext.js';
import type { G4Facts, G4Verdict } from '@projectos/core';
import { evaluateClosureEligibility, isClosureTailPath } from '@projectos/core';

/** Where the durable closure-evidence record for a phase lives. */
export function closureEvidencePath(root: string, phaseId: string): string {
  return join(projectopsDir(root), 'closure', `${phaseId}.json`);
}

/** Where the validator-run record for a given subject commit lives. Named after the commit, so a
 *  record for another subject is a different file rather than a silently reused one. */
export function validationRecordPath(root: string, subjectHead: string): string {
  return join(projectopsDir(root), 'validation', `${subjectHead}.json`);
}

/**
 * The durable evidence a closure needs and the runtime cannot compute for itself: whether the
 * validators and checks passed, whether reviews are complete, how many CRITICAL/HIGH findings remain,
 * and whether the required headed proof passed — each bound to the commit it was established at.
 */
interface ClosureEvidenceRecord {
  readonly phaseId?: unknown;
  readonly evidenceSubjectHead?: unknown;
  /** Accepted for records written before the field was renamed. */
  readonly establishedAtHead?: unknown;
  readonly validatorsPass?: unknown;
  readonly checksPass?: unknown;
  readonly reviewsComplete?: unknown;
  readonly unresolvedCriticalOrHigh?: unknown;
  readonly headedProofPass?: unknown;
}

function readJson(sys: System, path: string): Record<string, unknown> | null {
  const text = sys.readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Which paths changed between the evidence subject and the current head, split into closure-tail
 * metadata and SUBSTANTIVE changes. A git failure yields a sentinel substantive entry rather than an
 * empty list, so an unreadable diff can never read as "nothing changed".
 */
function changesSince(sys: System, root: string, subject: string): {
  isAncestor: boolean;
  substantive: readonly string[];
} {
  const anc = sys.exec('git', ['-C', root, 'merge-base', '--is-ancestor', subject, 'HEAD']);
  if (anc.code !== 0) return { isAncestor: false, substantive: [] };
  const diff = sys.exec('git', ['-C', root, 'diff', '--name-only', `${subject}..HEAD`]);
  if (diff.code !== 0) return { isAncestor: true, substantive: ['<the diff since the evidence subject could not be read>'] };
  const changed = diff.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return { isAncestor: true, substantive: changed.filter((f) => !isClosureTailPath(f)) };
}

/** `git` facts, computed live. Any failure is reported as NOT reconciled — never assumed clean. */
function gitFacts(sys: System, root: string): {
  head: string | null;
  reconciled: boolean;
  clean: boolean;
} {
  const rev = sys.exec('git', ['-C', root, 'rev-parse', 'HEAD']);
  const head = rev.code === 0 && /^[0-9a-f]{40}$/.test(rev.stdout.trim()) ? rev.stdout.trim() : null;
  const status = sys.exec('git', ['-C', root, 'status', '--porcelain']);
  const clean = status.code === 0 && status.stdout.trim() === '';
  // Reconciled means the local branch and its upstream point at the same commit.
  const counts = sys.exec('git', ['-C', root, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  const reconciled = counts.code === 0 && /^0\s+0$/.test(counts.stdout.trim());
  return { head, reconciled, clean };
}

/** Does a durable evidence report for this phase exist under the project's reports directory? */
function evidenceReportPresent(sys: System, root: string, phaseId: string): boolean {
  const dir = join(root, 'knowledge', 'reports');
  return sys.listDir(dir).some((f) => f.includes(phaseId) && f.endsWith('.md'));
}

/** Whether any protected effect was recorded for the active session. */
function protectedEffectOccurred(sys: System, context: GovernedContext, root: string): boolean {
  const statePath = context.currentStatePath;
  if (statePath === null) return false;
  const session = readJson(sys, join(root, 'projectos', 'state', 'projectos-v3.session.json'));
  if (session === null) return false;
  return (
    session['productionTouched'] === true ||
    session['deploymentOccurred'] === true ||
    session['databaseMutationOccurred'] === true ||
    session['externalSendOccurred'] === true ||
    session['paymentOccurred'] === true ||
    session['rawSecretStored'] === true
  );
}

interface PlanPhase {
  readonly phaseId: string;
  readonly requiredBrowserProof?: boolean;
  readonly requiredValidators?: readonly string[];
}

const HEX40 = /^[0-9a-f]{40}$/;

/**
 * What the validator runner actually recorded at `subjectHead`, or why that cannot be established.
 *
 * Read here, in the deriving layer, for the same reason every other fact is: the closure request may
 * not supply it. The record is located BY the subject commit — so pointing the gate at a different
 * subject means reading a different file, not reinterpreting this one — and its self-declared
 * `subjectHead` is compared with the name rather than trusted, because a file named after a commit
 * whose contents disagree is precisely the forgery the naming scheme is meant to make visible.
 *
 * Every failure path yields a PROBLEM, never an empty pass list: "no record" and "a record showing
 * nothing passed" must not be indistinguishable, and neither may be read as satisfaction.
 */
function validatorRunFacts(
  sys: System,
  root: string,
  subjectHead: string | null,
): { passing: readonly string[]; problems: readonly string[] } {
  if (subjectHead === null || !HEX40.test(subjectHead)) {
    return { passing: [], problems: ['the closure evidence names no valid subject commit, so no validator-run record can be located'] };
  }
  const path = validationRecordPath(root, subjectHead);
  const raw = readJson(sys, path);
  if (raw === null) {
    return {
      passing: [],
      problems: [
        `no validator-run record at .projectops/validation/${subjectHead}.json — run \`node projectos/validators/validate-all.cjs --record-evidence\` at the evidence subject`,
      ],
    };
  }
  const problems: string[] = [];
  if (raw['schemaVersion'] !== '1.1.0') problems.push(`validator-run record schemaVersion is ${JSON.stringify(raw['schemaVersion'])}, expected "1.1.0"`);
  const declared = raw['subjectHead'];
  if (typeof declared !== 'string' || !HEX40.test(declared)) problems.push('validator-run record subjectHead is not a 40-hex commit');
  else if (declared !== subjectHead) problems.push(`validator-run record is bound to ${declared.slice(0, 7)}, not the evidence subject ${subjectHead.slice(0, 7)}`);
  if (raw['workingTreeCleanAtRunStart'] !== true) problems.push('the validator run was not made from a clean working tree');
  const count = raw['registeredModuleCount'];
  const results = raw['results'];
  if (!Array.isArray(results)) {
    problems.push('validator-run record has no results array');
    return { passing: [], problems };
  }
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) problems.push('validator-run record registeredModuleCount is not a positive integer');
  else if (results.length !== count) problems.push(`validator-run record lists ${results.length} result(s) for ${count} registered module(s)`);

  const passing: string[] = [];
  const seen = new Set<string>();
  for (const entry of results as readonly unknown[]) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push('validator-run record contains a malformed result entry');
      continue;
    }
    const r = entry as Record<string, unknown>;
    const name = r['name'];
    if (typeof name !== 'string' || name.length === 0) {
      problems.push('validator-run record contains a result with no validator name');
      continue;
    }
    if (seen.has(name)) {
      problems.push(`validator-run record lists ${name} more than once`);
      continue;
    }
    seen.add(name);
    if (typeof r['passed'] !== 'boolean') {
      problems.push(`validator-run record result for ${name} has no boolean 'passed'`);
      continue;
    }
    if (r['passed'] === true) passing.push(name);
  }

  // THE AGGREGATE IS A NAME TOO. Plans require `validate-all`, which is the command that runs the
  // modules and is deliberately not one of them — counting the wrapper as a module is the conflation
  // that produced a wrong module count in prose. The gate found this by refusing a closure whose plan
  // required `validate-all` and whose record could not name it. It is admitted only when the record
  // says the WHOLE suite passed, and the record's own shape check ties that to every module result,
  // so "validate-all passed" cannot be true while a module failed.
  const aggregate = raw['aggregate'];
  if (aggregate === null || typeof aggregate !== 'object' || Array.isArray(aggregate)) {
    problems.push('validator-run record carries no aggregate command result');
  } else {
    const a = aggregate as Record<string, unknown>;
    const name = a['name'];
    if (typeof name !== 'string' || name.length === 0) problems.push('the aggregate command result has no name');
    else if (seen.has(name)) problems.push(`the aggregate command ${name} is also listed as a registered module`);
    else if (a['passed'] !== true && a['passed'] !== false) problems.push(`the aggregate command ${name} has no boolean 'passed'`);
    else if (a['passed'] !== raw['aggregatePassed']) problems.push(`the aggregate command result contradicts aggregatePassed`);
    else if (a['passed'] === true) passing.push(name);
  }
  return { passing, problems };
}

/**
 * Gather the facts and evaluate the gate.
 *
 * `authorityAssertedByCaller` is a parameter because only the caller knows whether the request tried
 * to supply an identity or role — and if it did, that alone fails G4-15.
 */
export function evaluateG4(
  sys: System,
  root: string,
  context: GovernedContext,
  phaseId: string,
  phaseStatus: string,
  planReady: { ready: boolean; reasons: readonly string[] },
  delegationValidForProject: boolean,
  authorityAssertedByCaller: boolean,
): { facts: G4Facts; verdict: G4Verdict } {
  const plan = context.plan;
  const phases = Array.isArray(plan['phases']) ? (plan['phases'] as readonly PlanPhase[]) : [];
  const planPhase = phases.find((p) => p.phaseId === phaseId);
  const git = gitFacts(sys, root);

  const evidence = (readJson(sys, closureEvidencePath(root, phaseId)) ?? {}) as ClosureEvidenceRecord;
  // The record must name the phase it is about; one written for another phase is not evidence here.
  const boundPhase = typeof evidence.phaseId === 'string' ? evidence.phaseId : '';
  const subject =
    typeof evidence.evidenceSubjectHead === 'string'
      ? evidence.evidenceSubjectHead
      : typeof evidence.establishedAtHead === 'string'
        ? evidence.establishedAtHead
        : null;
  // Ancestry and the changed-path classification are computed from git, never taken from the record.
  const prov = subject === null ? { isAncestor: false, substantive: [] as readonly string[] } : changesSince(sys, root, subject);

  // What the ACTIVE APPROVED PLAN requires by name, and what the runner actually recorded. The
  // required list is read off the plan the runtime loaded — never off the request.
  const requiredValidators = Array.isArray(planPhase?.requiredValidators)
    ? planPhase.requiredValidators.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
  const runFacts = validatorRunFacts(sys, root, subject);

  const facts: G4Facts = {
    governedProjectId: context.projectId,
    planProjectId: typeof plan['projectId'] === 'string' ? plan['projectId'] : '',
    activePlanVersion: typeof plan['planVersion'] === 'string' ? plan['planVersion'] : '',
    planReady: planReady.ready,
    planUnmetReasons: planReady.reasons,
    phaseId,
    phaseInActivePlan: planPhase !== undefined,
    phaseStatus,
    validatorsPass: boolOrNull(evidence.validatorsPass),
    checksPass: boolOrNull(evidence.checksPass),
    evidenceReportPresent: evidenceReportPresent(sys, root, phaseId),
    headedProofRequired: planPhase?.requiredBrowserProof === true,
    headedProofPass: boolOrNull(evidence.headedProofPass),
    reviewsComplete: boolOrNull(evidence.reviewsComplete),
    unresolvedCriticalOrHigh: numOrNull(evidence.unresolvedCriticalOrHigh),
    protectedEffectOccurred: protectedEffectOccurred(sys, context, root),
    implementationHead: git.head,
    remoteReconciled: git.reconciled,
    workingTreeClean: git.clean,
    delegationValidForProject,
    authorityAssertedByCaller,
    decisionBoundToPhaseId: boundPhase,
    evidenceSubjectHead: subject,
    subjectIsAncestorOfHead: prov.isAncestor,
    substantiveChangesSinceSubject: prov.substantive,
    requiredValidators,
    passingValidatorNames: runFacts.passing,
    validationRecordProblems: runFacts.problems,
  };

  return { facts, verdict: evaluateClosureEligibility(facts) };
}

/** Render an unmet gate for the CLI: every outstanding predicate, named. */
export function g4RefusalLines(verdict: G4Verdict): readonly string[] {
  return [
    `REFUSED (G4_NOT_SATISFIED): ${verdict.unmet.length} predicate(s) unmet for delegated closure:`,
    ...verdict.unmet.map((u) => `  ${u.code}: ${u.detail}`),
  ];
}
