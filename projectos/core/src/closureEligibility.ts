/**
 * G4 closure eligibility: the conditions that must hold before a delegated closure may happen.
 *
 * A plan delegation says WHO MAY HOLD the conditional authority. It does not say that the conditions
 * are met. Those are different facts, and conflating them is how `delegated: true` would quietly
 * become an authority token: a caller asks for a delegated close, the runtime sees a valid delegation
 * and closes. The delegation is necessary and nowhere near sufficient.
 *
 * So closure under the pre-issued ChatGPT ProjectOS G4 gate requires BOTH:
 *   1. an owner-recorded, project-scoped delegation naming who may close  (`closureAuthority.ts`), and
 *   2. every G4 predicate below mechanically satisfied                    (this module).
 *
 * This module is PURE. It decides nothing about how facts are obtained — it only says whether the
 * facts it was given satisfy the gate, and if not, exactly which predicates failed. The caller that
 * gathers the facts must DERIVE them; a fact that is merely asserted by whoever wants the closure is
 * not evidence, and the deriving layer is responsible for refusing to accept assertions.
 *
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */

/** The predicate identifiers, so a refusal names exactly what was unmet. */
export type G4Predicate =
  | 'G4-1'
  | 'G4-2'
  | 'G4-3'
  | 'G4-4'
  | 'G4-5'
  | 'G4-6'
  | 'G4-7'
  | 'G4-8'
  | 'G4-9'
  | 'G4-10'
  | 'G4-11'
  | 'G4-12'
  | 'G4-13'
  | 'G4-14'
  | 'G4-15'
  | 'G4-16'
  | 'G4-17';

/** How many predicates this gate checks. Derived, so a new one cannot be added without the basis
 *  note that reports it becoming true again. */
export const G4_PREDICATE_COUNT = 17;

/**
 * The facts the gate needs. Every field is something the deriving layer must establish from the
 * repository, the runtime or a durable evidence record — never from the closure request.
 */
export interface G4Facts {
  /** G4-1 the project actually being governed, and the plan's own project. */
  readonly governedProjectId: string;
  readonly planProjectId: string;
  /** G4-2 the active plan version, and readiness RECOMPUTED by the engine — not the stored string. */
  readonly activePlanVersion: string;
  readonly planReady: boolean;
  readonly planUnmetReasons: readonly string[];
  /** G4-3 / G4-4 the phase, its membership of the active plan, and its real lifecycle state. */
  readonly phaseId: string;
  readonly phaseInActivePlan: boolean;
  readonly phaseStatus: string;
  /** G4-5..G4-10 evidence facts. Each is a durable, HEAD-bound record, or absent. */
  readonly validatorsPass: boolean | null;
  readonly checksPass: boolean | null;
  readonly evidenceReportPresent: boolean;
  readonly headedProofRequired: boolean;
  readonly headedProofPass: boolean | null;
  readonly reviewsComplete: boolean | null;
  readonly unresolvedCriticalOrHigh: number | null;
  /** G4-11 whether any protected effect was recorded. */
  readonly protectedEffectOccurred: boolean;
  /** G4-12 / G4-13 repository state at the decision point. */
  readonly implementationHead: string | null;
  readonly remoteReconciled: boolean;
  readonly workingTreeClean: boolean;
  /**
   * PROVENANCE. `evidenceSubjectHead` is the exact substantive commit whose code and runtime were
   * tested and reviewed. `implementationHead` is the CURRENT governance head, which may legitimately
   * be a later descendant carrying only closure-tail metadata.
   *
   * The first version of this gate required the two to be EQUAL, which was a deadlock: closure
   * evidence lives at a tracked path, so writing it dirties the tree (G4-13), committing it advances
   * HEAD past the evidence (G4-12), and re-pointing the evidence at the new head advances HEAD
   * again. A tracked commit cannot contain its own final SHA. Found by gatekeeper source review.
   *
   * The purpose the equality was protecting is preserved exactly: THE THING TESTED MUST BE THE THING
   * BEING CLOSED. That is now expressed as — the subject is an ancestor of the current head, and
   * every path that changed between them is closure-tail metadata. One substantive file changing
   * after the subject makes the evidence stale, as it always did.
   */
  readonly subjectIsAncestorOfHead: boolean;
  /** Paths changed between the evidence subject and the current head that are NOT closure-tail. */
  readonly substantiveChangesSinceSubject: readonly string[];
  /** G4-14 the delegation validated by `authoriseClosure`, scoped to this project. */
  readonly delegationValidForProject: boolean;
  /** G4-15 whether the implementer supplied any part of the authority. Must be false. */
  readonly authorityAssertedByCaller: boolean;
  /** G4-16 the phase the eligibility decision is bound to. */
  readonly decisionBoundToPhaseId: string;
  /** The commit the evidence facts were established against. */
  readonly evidenceSubjectHead: string | null;
  /**
   * G4-17 REQUIRED VALIDATORS, BY NAME.
   *
   * `validatorsPass` (G4-5) is one boolean in a durable record. It says a suite passed; it cannot say
   * WHICH validators ran, so a phase whose approved plan demands a specific validator could close
   * with that validator absent — and the plan's `requiredValidators` were read by nothing at all.
   * These three facts close that: what the ACTIVE APPROVED PLAN demands for this phase, what a
   * subject-bound validator-run record shows actually passed, and why that record cannot be trusted
   * if it cannot be trusted.
   *
   * `requiredValidators` MUST come from the plan the runtime loaded, never from the closure request.
   * `validationRecordProblems` is non-empty whenever the record is missing, malformed, or bound to a
   * different subject — every one of which refuses, because an unreadable record is not a pass.
   */
  readonly requiredValidators: readonly string[];
  readonly passingValidatorNames: readonly string[];
  readonly validationRecordProblems: readonly string[];
}

export interface G4Unmet {
  readonly code: G4Predicate;
  readonly detail: string;
}

export interface G4Verdict {
  readonly eligible: boolean;
  readonly unmet: readonly G4Unmet[];
  /** Every predicate that was checked and held — so a PASS is enumerable, not just an absence. */
  readonly satisfied: readonly G4Predicate[];
}

/** The only lifecycle state a phase may be closed from. */
export const CLOSURE_READY_STATUS = 'awaiting_closure';

/**
 * G4-17: every validator the ACTIVE APPROVED PLAN requires for this phase is recorded as PASSING in
 * a subject-bound validator-run record.
 *
 * Deliberately universal — it knows no phase and no validator name. A phase whose plan entry declares
 * no required validators is vacuously satisfied, so no existing phase gains an invented requirement;
 * a phase that declares one cannot close without it, whatever `validatorsPass` claims.
 *
 * The record is checked BEFORE the names: a missing or malformed or wrong-subject record refuses on
 * its own terms rather than being read as "no passing validators", so the refusal says why.
 */
function requiredValidatorVerdict(facts: G4Facts): readonly [boolean, string] {
  // A caller from untyped JavaScript can omit these. "Not established" is not "nothing required" —
  // reading an absent list as an empty one would fail OPEN, which is the one thing this gate may
  // never do — so an absent list refuses.
  if (!Array.isArray(facts.requiredValidators) || !Array.isArray(facts.passingValidatorNames) || !Array.isArray(facts.validationRecordProblems)) {
    return [false, "the phase's plan-required validators and their run evidence were not established"];
  }
  const required = facts.requiredValidators;
  if (required.length === 0) return [true, ''];
  if (facts.validationRecordProblems.length > 0) {
    return [
      false,
      `the phase requires ${required.length} named validator(s) and the validator-run evidence cannot be trusted: ` +
        facts.validationRecordProblems.slice(0, 3).join('; '),
    ];
  }
  const passing = new Set(facts.passingValidatorNames);
  const missing = required.filter((name) => !passing.has(name));
  if (missing.length > 0) {
    return [
      false,
      `${missing.length} plan-required validator(s) are not recorded as passing at the evidence subject: ${missing.join(', ')}`,
    ];
  }
  return [true, ''];
}

/**
 * Evaluate the gate. Fails CLOSED on every unknown: a `null` evidence fact means "not established",
 * which is refused, never assumed good. Returns the complete set of unmet predicates rather than the
 * first, so an operator sees everything still outstanding in one refusal.
 */
export function evaluateClosureEligibility(facts: G4Facts): G4Verdict {
  const unmet: G4Unmet[] = [];
  const satisfied: G4Predicate[] = [];
  const check = (code: G4Predicate, ok: boolean, detail: string): void => {
    if (ok) satisfied.push(code);
    else unmet.push({ code, detail });
  };

  check(
    'G4-1',
    facts.governedProjectId === 'projectos' && facts.planProjectId === facts.governedProjectId,
    `the ProjectOS G4 gate applies only to project 'projectos'; governed='${facts.governedProjectId}', plan='${facts.planProjectId}'`,
  );
  check(
    'G4-2',
    facts.planReady,
    facts.planReady
      ? ''
      : `the active plan v${facts.activePlanVersion} is not READY (${facts.planUnmetReasons.length} unmet): ${facts.planUnmetReasons.slice(0, 2).join('; ')}`,
  );
  check('G4-3', facts.phaseInActivePlan, `phase '${facts.phaseId}' is not in the active approved plan`);
  check(
    'G4-4',
    facts.phaseStatus === CLOSURE_READY_STATUS,
    `phase is '${facts.phaseStatus}', not '${CLOSURE_READY_STATUS}'`,
  );
  check('G4-5', facts.validatorsPass === true, 'required phase validators are not recorded as passing');
  check('G4-6', facts.checksPass === true, 'required tests/build/typecheck/lint are not recorded as passing');
  check('G4-7', facts.evidenceReportPresent, 'no durable evidence report is present for this phase');
  check(
    'G4-8',
    !facts.headedProofRequired || facts.headedProofPass === true,
    'the phase requires a headed/desktop proof and no passing proof is recorded',
  );
  check('G4-9', facts.reviewsComplete === true, 'required code/security/ECC reviews are not recorded as complete');
  check(
    'G4-10',
    facts.unresolvedCriticalOrHigh === 0,
    facts.unresolvedCriticalOrHigh === null
      ? 'the count of unresolved CRITICAL/HIGH findings is not established'
      : `${facts.unresolvedCriticalOrHigh} unresolved CRITICAL/HIGH finding(s)`,
  );
  check('G4-11', !facts.protectedEffectOccurred, 'a protected effect was recorded for this phase');
  check(
    'G4-12',
    facts.implementationHead !== null && facts.remoteReconciled,
    'the implementation/evidence commit is not pushed and reconciled with the expected remote',
  );
  check('G4-13', facts.workingTreeClean, 'the working tree has unexplained residue at the closure decision point');
  check('G4-14', facts.delegationValidForProject, 'no valid ProjectOS-scoped closure delegation');
  check('G4-15', !facts.authorityAssertedByCaller, 'the caller supplied part of the closure authority');
  check(
    'G4-16',
    facts.decisionBoundToPhaseId === facts.phaseId,
    `the eligibility decision is bound to '${facts.decisionBoundToPhaseId}', not '${facts.phaseId}'`,
  );
  check('G4-17', ...requiredValidatorVerdict(facts));

  // PROVENANCE. Same question as before — "is what we verified the thing we are closing?" — but
  // asked in a way an ordinary closure workflow can actually satisfy.
  if (facts.evidenceSubjectHead === null) {
    unmet.push({ code: 'G4-12', detail: 'the evidence names no subject commit' });
  } else if (facts.implementationHead === null) {
    unmet.push({ code: 'G4-12', detail: 'the current head could not be established' });
  } else if (facts.evidenceSubjectHead !== facts.implementationHead) {
    // A later head is allowed ONLY as a descendant carrying nothing but closure-tail metadata.
    if (!facts.subjectIsAncestorOfHead) {
      unmet.push({
        code: 'G4-12',
        detail: `evidence subject ${facts.evidenceSubjectHead.slice(0, 7)} is not an ancestor of the current head ${facts.implementationHead.slice(0, 7)}`,
      });
    } else if (facts.substantiveChangesSinceSubject.length > 0) {
      unmet.push({
        code: 'G4-12',
        detail:
          `${facts.substantiveChangesSinceSubject.length} substantive path(s) changed after the evidence subject ` +
          `${facts.evidenceSubjectHead.slice(0, 7)}, so the evidence is stale: ` +
          facts.substantiveChangesSinceSubject.slice(0, 3).join(', ') +
          (facts.substantiveChangesSinceSubject.length > 3 ? ' …' : '') +
          '; re-establish it',
      });
    }
  }

  return { eligible: unmet.length === 0, unmet, satisfied };
}

/** The recorded basis for an eligible delegated closure. Truthful about what actually authorised it. */
export function g4BasisNote(facts: G4Facts): string {
  const subject = facts.evidenceSubjectHead === null ? 'an unrecorded commit' : facts.evidenceSubjectHead.slice(0, 7);
  const head = facts.implementationHead === null ? 'an unrecorded head' : facts.implementationHead.slice(0, 7);
  const validators =
    facts.requiredValidators.length === 0
      ? 'no plan-required validators'
      : `plan-required validators [${facts.requiredValidators.join(', ')}] recorded passing at the subject`;
  return (
    `closed under the pre-issued ChatGPT ProjectOS G4 gate: all ${G4_PREDICATE_COUNT} predicates mechanically ` +
    `satisfied against plan v${facts.activePlanVersion}, ${validators}, evidence subject ${subject}` +
    (subject === head ? '' : ` (governance head ${head}, closure-tail metadata only)`) +
    `, under the owner-recorded ${facts.governedProjectId}-scoped closure delegation`
  );
}

/**
 * Paths a closure TAIL may legitimately touch after the evidence subject commit.
 *
 * Deliberately narrow and derived from what the closure workflow actually writes: the phase
 * lifecycle record, the closure evidence, the evidence report and its index, and the programme
 * state/session records. NOT the plan, NOT any source, validator, schema or architecture document —
 * a change to any of those is substantive and makes the evidence stale.
 *
 * Exported so a test can assert the list rather than restate it.
 */
export const CLOSURE_TAIL_PATHS: readonly string[] = [
  '.projectops/phases/',
  '.projectops/closure/',
  'knowledge/reports/',
  'knowledge/ProjectOS Reports Index.md',
  'projectos/state/projectos-v3.current-state.json',
  'projectos/state/projectos-v3.session.json',
];

/**
 * The ONE additional tail shape: a validator-run record named after a 40-hex subject commit.
 *
 * It has to be a tail path — the record can only be produced AFTER the subject exists, so writing it
 * necessarily changes the tree after the commit it describes. It is admitted as an exact-shape
 * pattern rather than as the directory `.projectops/validation/`, because a directory prefix would
 * make ANY file under it non-substantive, including a hand-placed one with an arbitrary name. The
 * record carries its own subject binding, so a stale one cannot masquerade as current: G4-17 checks
 * the name, the internal `subjectHead`, and their agreement with the evidence subject.
 */
const VALIDATION_RECORD_PATH = /^\.projectops\/validation\/[0-9a-f]{40}\.json$/;

/**
 * Is this changed path permissible in a closure tail? Anything not matched is SUBSTANTIVE.
 *
 * Prefix matching against an explicit list rather than pattern matching: an allowlist that decides
 * whether evidence is still valid should be readable at a glance and hard to widen by accident.
 * Directory entries end in `/` and match only paths beneath them; file entries match exactly.
 * Traversal is refused outright so `.projectops/closure/../../src/x.ts` cannot pass as tail.
 */
export function isClosureTailPath(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  if (p.includes('..')) return false;
  if (VALIDATION_RECORD_PATH.test(p)) return true;
  return CLOSURE_TAIL_PATHS.some((allowed) =>
    allowed.endsWith('/') ? p.startsWith(allowed) && p.length > allowed.length : p === allowed,
  );
}
