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
import { createHash } from 'node:crypto';
import type { System } from './system.js';
import { join, projectopsDir } from './context.js';
import { PROTECTED_EFFECT_FIELDS } from './loop/outcome.js';
import { effectsPath, isSafeSessionId, sessionPath } from './loop/session.js';
import { DEFAULT_PLAN_RELPATH, type GovernedContext } from './governedContext.js';
import type { G4Facts, G4Verdict, ClosureDecisionRecord } from '@projectos/core';
import {
  evaluateClosureEligibility,
  isClosureTailPath,
  checkClosureDecision,
  consumedDecisionIds,
  validateOwnerAcceptedHighFindings,
} from '@projectos/core';

/** Where the durable closure-evidence record for a phase lives. */
export function closureEvidencePath(root: string, phaseId: string): string {
  return join(projectopsDir(root), 'closure', `${phaseId}.json`);
}

/** Where the validator-run record for a given subject commit lives. Named after the commit, so a
 *  record for another subject is a different file rather than a silently reused one. */
export function validationRecordPath(root: string, subjectHead: string): string {
  return join(projectopsDir(root), 'validation', `${subjectHead}.json`);
}

/** Where the gatekeeper's closure DECISION for a phase lives. One canonical location, never a
 *  caller-supplied path — a path argument would be one more thing the caller controls. */
export function closureDecisionPath(root: string, phaseId: string): string {
  return join(projectopsDir(root), 'closure', 'decisions', `${phaseId}.json`);
}

/** Repo-relative form of the same path, for git queries. */
export function closureDecisionRelPath(phaseId: string): string {
  return `.projectops/closure/decisions/${phaseId}.json`;
}

/**
 * Is the decision COMMITTED, not merely sitting on disk?
 *
 * This is the whole difference between "someone wrote a file" and "someone put a decision through the
 * owner's commit gate". `git log -1 -- <path>` answers it without trusting the file, and `git diff
 * HEAD -- <path>` catches the case where a committed decision has since been edited in the working
 * tree — which would otherwise let the committed version launder an uncommitted change.
 *
 * Any git failure returns false. An unverifiable decision is not a decision.
 */
export function decisionIsCommitted(sys: System, root: string, phaseId: string): boolean {
  const rel = closureDecisionRelPath(phaseId);
  const logged = sys.exec('git', ['-C', root, 'log', '-1', '--format=%H', '--', rel]);
  if (logged.code !== 0 || logged.stdout.trim().length === 0) return false;
  const dirty = sys.exec('git', ['-C', root, 'diff', '--name-only', 'HEAD', '--', rel]);
  if (dirty.code !== 0) return false;
  return dirty.stdout.trim().length === 0;
}

/**
 * The decision AS COMMITTED — read from the git object, not from the working tree.
 *
 * Reading the file would validate bytes that git never saw. If the tracked path is a symlink, git
 * records only the link target string while `readFileSync` follows it: the link is committed once
 * and the content it resolves to can then be rewritten freely, invisible to `git diff`, `git log`
 * and `git status`. The whole claimed boundary — "a forged decision is a visible diff" — would be
 * gone. Reading the object makes "what is validated" and "what is committed" the same bytes by
 * construction, so the question cannot arise.
 *
 * Any failure yields null, which the checker treats as no decision.
 */
export function readCommittedDecision(sys: System, root: string, phaseId: string): Record<string, unknown> | null {
  // `-C root` AND `./` — the pathspec that proves committedness resolves against the governed root,
  // while `<rev>:<path>` resolves against the top of the working tree. In a checkout nested inside a
  // larger repository the two addressed different files, so the proof was about one record and the
  // bytes came from another. Reproduced on this repository's own nested fixture.
  const shown = sys.exec('git', ['-C', root, 'show', `HEAD:./${closureDecisionRelPath(phaseId)}`]);
  if (shown.code !== 0 || shown.stdout.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(shown.stdout) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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
  /** The CRITICAL half of that count, and the ids of the unresolved HIGH findings. Absent on records
   *  written before owner acceptance existed, which is harmless while the count is 0 and fails
   *  closed the moment it is not. */
  readonly unresolvedCritical?: unknown;
  readonly unresolvedHighIds?: unknown;
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
/**
 * The ACTIVE programme's state record, as a closure-tail path — or nothing.
 *
 * The static tail list in core names V3's state record by filename, so the recovery programme's
 * ordinary lifecycle sync was read as a substantive change and G4-12 refused a phase that had done
 * nothing wrong. The governed config declares which record this programme keeps, and it is the only
 * authority on that; nothing is inferred from the filename.
 *
 * WHAT THE CONFIG MAY NOT NOMINATE. The config decides WHICH state record, but not what counts as
 * one. A config that could name the active plan, itself, or a source file would be a config that
 * could launder its own substantive changes into a closure tail — so the plan and the config are
 * refused by exact comparison, and the path must live in one of the directories where governed
 * programme records are kept. That is a bound on location, not an inference from the filename: two
 * programmes with quite different filenames both qualify, and no source, validator or schema path
 * can.
 *
 * WHY THERE ARE TWO DIRECTORIES. `projectos/state/` is where this repository's earlier programmes
 * kept their records, and it was the only location recognised here. `plan activate` writes the new
 * programme's state record beside the plan it activates, inside `.projectops/`, and repoints
 * planMemory at it — so a governed activation moved the canonical record out of the only location
 * this function accepted, and it began returning nothing at all. An empty list is not a refusal: it
 * makes the programme's ordinary lifecycle sync read as a SUBSTANTIVE change and G4-12 refuses a
 * phase that has done nothing wrong, which is the exact defect this function exists to prevent.
 * Recognising the governed directory the runtime actually writes to restores that, and widens
 * nothing else: every bound below is unchanged and applies to both directories.
 */
export function programmeStateTailPaths(context: GovernedContext): readonly string[] {
  const memory = context.config.planMemory;
  const declared = memory === undefined ? undefined : memory.currentStatePath;
  if (typeof declared !== 'string' || declared.trim() === '') return [];
  const p = declared.replace(/\\/g, '/').trim();
  const dir = STATE_DIRS.find((d) => p.startsWith(d) && p.length > d.length);
  if (dir === undefined) return [];
  if (p.slice(dir.length).includes('/')) return [];
  const planRel = (memory?.planPath ?? DEFAULT_PLAN_RELPATH).replace(/\\/g, '/').trim();
  if (p === planRel || p === CONFIG_RELPATH) return [];
  return [p];
}

const CONFIG_RELPATH = '.projectops/project-config.json';

/** Where a programme's state record may live. A nominated path outside these is not a state record. */
const STATE_DIRS = ['projectos/state/', '.projectops/'] as const;

export function changesSince(
  sys: System,
  root: string,
  subject: string,
  additionalTailPaths: readonly string[],
): {
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
  return { isAncestor: true, substantive: changed.filter((f) => !isClosureTailPath(f, additionalTailPaths)) };
}

/** `git` facts, computed live. Any failure is reported as NOT reconciled — never assumed clean. */
export function gitFacts(sys: System, root: string): {
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

/**
 * Every RUNNER-written execution evidence record for this phase, oldest first.
 *
 * A record counts only when it is BOUND to a run the runner started: its file is named after its own
 * `sessionId`, that id is a safe record name, and the runner's session record for that id exists and
 * names the same phase. A worker cannot write either record, so a planted `*.evidence.json` — under a
 * name of its choosing, with a far-future `collectedAt` — is not a run and is ignored here, rather than
 * becoming "the latest run" that a predicate then believes.
 */
export function phaseRunEvidence(sys: System, root: string, phaseId: string): readonly Record<string, unknown>[] {
  const dir = join(projectopsDir(root), 'execution');
  const runs: Record<string, unknown>[] = [];
  for (const name of sys.listDir(dir)) {
    if (!name.endsWith('.evidence.json')) continue;
    const e = readJson(sys, join(dir, name));
    if (e === null || e['phaseId'] !== phaseId) continue;
    const sessionId = e['sessionId'];
    if (typeof e['collectedAt'] !== 'string' || typeof sessionId !== 'string' || !isSafeSessionId(sessionId)) continue;
    if (name !== `${sessionId}.evidence.json`) continue;
    const session = readJson(sys, sessionPath(root, sessionId));
    if (session === null || session['phaseId'] !== phaseId || session['sessionId'] !== sessionId) continue;
    runs.push(e);
  }
  return runs.sort((x, y) => String(x['collectedAt']).localeCompare(String(y['collectedAt'])));
}

/** The phase's latest bound run evidence, or null. See `phaseRunEvidence` for what counts as a run. */
export function latestRunEvidence(sys: System, root: string, phaseId: string): Record<string, unknown> | null {
  const runs = phaseRunEvidence(sys, root, phaseId);
  return runs.length === 0 ? null : (runs[runs.length - 1] as Record<string, unknown>);
}

/** Did this one run attest, verifiably, that no protected effect occurred? Never throws. */
function runAttestedNoEffect(sys: System, root: string, run: Record<string, unknown>): boolean {
  const recorded = run['effectsSha256'];
  if (typeof recorded !== 'string' || !/^[0-9a-f]{64}$/.test(recorded)) return false;
  const text = sys.readText(effectsPath(root, String(run['sessionId'])));
  if (text === null) return false;
  if (createHash('sha256').update(text, 'utf8').digest('hex') !== recorded) return false;
  let effects: unknown;
  try {
    effects = JSON.parse(text);
  } catch {
    return false;
  }
  if (effects === null || typeof effects !== 'object' || Array.isArray(effects)) return false;
  return PROTECTED_EFFECT_FIELDS.every((field) => (effects as Record<string, unknown>)[field] === false);
}

/** The session ids of this phase's bound runs that did not verifiably attest no effect. Never throws. */
export function unattestedRuns(sys: System, root: string, phaseId: string): readonly string[] {
  try {
    return phaseRunEvidence(sys, root, phaseId)
      .filter((run) => !runAttestedNoEffect(sys, root, run))
      .map((run) => String(run['sessionId']));
  } catch {
    return ['(the runs of this phase could not be read)'];
  }
}

/**
 * Whether a protected effect occurred — or cannot be ruled out — for this phase's governed runs.
 *
 * PROJECTOS-BOOT-CONTINUE1A (G4-11). This used to read a fixed session file from the V3 programme,
 * never this programme's own run, and answered "no effect" whenever that file was absent: it failed
 * OPEN. It now reads the phase's own runs, and FAILS CLOSED:
 *  - at least one bound runner-written run must exist (see `phaseRunEvidence`);
 *  - EVERY run of the phase must have recorded the sha256 of the worker's effects attestation as the
 *    runner collected it, the attestation on disk must still hash to that value, and every protected
 *    effect field must be exactly `false`. One run that attested a payment is not hidden by a later
 *    run's clean attestation, and a rewrite after collection is refused rather than believed;
 *  - missing, malformed, unbound, non-false or not established all answer "occurred", because "I could
 *    not tell" is not "nothing happened".
 */
export function protectedEffectOccurred(sys: System, root: string, phaseId: string): boolean {
  try {
    const runs = phaseRunEvidence(sys, root, phaseId);
    if (runs.length === 0) return true;
    return !runs.every((run) => runAttestedNoEffect(sys, root, run));
  } catch {
    return true;
  }
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
  const prov =
    subject === null
      ? { isAncestor: false, substantive: [] as readonly string[] }
      : changesSince(sys, root, subject, programmeStateTailPaths(context));

  // What the ACTIVE APPROVED PLAN requires by name, and what the runner actually recorded. The
  // required list is read off the plan the runtime loaded — never off the request.
  const requiredValidators = Array.isArray(planPhase?.requiredValidators)
    ? planPhase.requiredValidators.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
  const runFacts = validatorRunFacts(sys, root, subject);

  // OWNER-ACCEPTED HIGH FINDINGS. Read from the COMMITTED decision only — the same bytes the gate
  // already treats as the decision, for the same reason: an acceptance that has not passed the owner
  // commit gate is not a visible diff, and so is not authority. A working-tree read here would let an
  // uncommitted acceptance satisfy G4-10 while the decision itself was still being refused.
  const unresolvedHighIds = Array.isArray(evidence.unresolvedHighIds)
    ? evidence.unresolvedHighIds.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];
  const planGovernance = plan['governance'];
  const planGov =
    typeof planGovernance === 'object' && planGovernance !== null ? (planGovernance as Record<string, unknown>) : {};
  // The owner is the ACTIVE APPROVED PLAN's, never the decision record's claim about who accepted.
  const owner = typeof planGov['owner'] === 'string' ? planGov['owner'] : '';
  const acceptance = validateOwnerAcceptedHighFindings(
    readCommittedDecision(sys, root, phaseId) as ClosureDecisionRecord | null,
    { phaseId, evidenceSubjectHead: subject, owner, unresolvedHighIds },
  );

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
    unresolvedCritical: numOrNull(evidence.unresolvedCritical),
    unresolvedHighIds,
    ownerAcceptedHighIds: acceptance.acceptedHighIds,
    acceptanceProblems: acceptance.problems,
    protectedEffectOccurred: protectedEffectOccurred(sys, root, phaseId),
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

/**
 * Establish why the gatekeeper's decision is unusable, or `[]` when it is usable.
 *
 * Everything the record is judged against is DERIVED here: the delegate comes from the active
 * approved plan, the evidence subject from the closure evidence, the committed fact from git, and the
 * already-consumed ids from the phase's own history. The record supplies none of its own criteria.
 */
export function closureDecisionProblems(
  sys: System,
  root: string,
  context: GovernedContext,
  phaseId: string,
  phaseHistory: readonly { readonly to?: unknown; readonly note?: unknown }[],
  basis: 'owner' | 'delegated',
): readonly string[] {
  const plan = context.plan;
  const governance = plan['governance'];
  const gov = typeof governance === 'object' && governance !== null ? (governance as Record<string, unknown>) : {};
  const delegation = gov['closureDelegation'] as Record<string, unknown> | undefined;
  // WHOSE decision this must be comes from the plan and from the basis being claimed — never from the
  // record, and never from the caller.
  const expectedDecider =
    basis === 'owner'
      ? typeof gov['owner'] === 'string'
        ? (gov['owner'] as string)
        : ''
      : typeof delegation?.['delegatedTo'] === 'string'
        ? (delegation['delegatedTo'] as string)
        : '';

  const evidence = (readJson(sys, closureEvidencePath(root, phaseId)) ?? {}) as ClosureEvidenceRecord;
  const subject =
    typeof evidence.evidenceSubjectHead === 'string'
      ? evidence.evidenceSubjectHead
      : typeof evidence.establishedAtHead === 'string'
        ? evidence.establishedAtHead
        : null;

  // The COMMITTED bytes are the decision. A working-tree read would validate content git never saw.
  // The consumption marker is read from the working tree as well, because a decision spent since the
  // last commit is still spent — so both are consulted and either one being set refuses.
  const committed = readCommittedDecision(sys, root, phaseId);
  const onDisk = readJson(sys, closureDecisionPath(root, phaseId));
  if (committed === null && onDisk !== null) {
    // Worth saying precisely: a decision was written but never committed. That is a different
    // situation from "nobody has decided", and the operator's next step is different too.
    return [
      `a closure decision exists at ${closureDecisionRelPath(phaseId)} but is NOT committed. An uncommitted decision ` +
        "has not passed the owner commit gate, which is the only thing that makes a forged one a visible diff under " +
        "this programme's tamperProof:false model. Commit it.",
    ];
  }
  const record: ClosureDecisionRecord | null =
    committed === null
      ? null
      : ({ ...committed, ...(onDisk !== null && onDisk['consumedAt'] !== undefined ? { consumedAt: onDisk['consumedAt'] } : {}) } as ClosureDecisionRecord);

  return checkClosureDecision(record, {
    phaseId,
    projectId: context.projectId,
    scope: 'phase-closure',
    expectedDecider,
    evidenceSubjectHead: subject,
    isCommitted: decisionIsCommitted(sys, root, phaseId),
    alreadyConsumedDecisionIds: consumedDecisionIds(phaseHistory),
  });
}

/**
 * The decision's own id, for recording on the history. Read only AFTER the decision has been checked
 * — on its own it establishes nothing, and it is never used as a criterion.
 */
export function readDecisionId(sys: System, root: string, phaseId: string): string | undefined {
  const raw = readCommittedDecision(sys, root, phaseId);
  const id = raw === null ? undefined : raw['decisionId'];
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Mark the decision spent, in the decision itself.
 *
 * Recorded here rather than only in the phase's history because `phase new --force` erases a phase
 * record — reset it, walk the lifecycle again, and the same decision would close the phase twice.
 * The decision file survives that.
 */
export function markDecisionConsumed(sys: System, root: string, phaseId: string, at: string): void {
  const path = closureDecisionPath(root, phaseId);
  const onDisk = readJson(sys, path);
  const base = onDisk ?? readCommittedDecision(sys, root, phaseId);
  if (base === null) return;
  sys.writeText(path, JSON.stringify({ ...base, consumedAt: at }, null, 2) + '\n');
}

/** Render an unmet gate for the CLI: every outstanding predicate, named. */
export function g4RefusalLines(verdict: G4Verdict): readonly string[] {
  return [
    `REFUSED (G4_NOT_SATISFIED): ${verdict.unmet.length} predicate(s) unmet for delegated closure:`,
    ...verdict.unmet.map((u) => `  ${u.code}: ${u.detail}`),
  ];
}
