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
  | 'G4-16';

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
  /** G4-14 the delegation validated by `authoriseClosure`, scoped to this project. */
  readonly delegationValidForProject: boolean;
  /** G4-15 whether the implementer supplied any part of the authority. Must be false. */
  readonly authorityAssertedByCaller: boolean;
  /** G4-16 the phase the eligibility decision is bound to. */
  readonly decisionBoundToPhaseId: string;
  /** The HEAD the evidence facts were established against, for staleness. */
  readonly evidenceHead: string | null;
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

  // Staleness: evidence established against a different commit than the one being closed is not
  // evidence about this state. Folded into G4-12 rather than given its own predicate, because the
  // question it answers — "is what we verified the thing we are closing?" — is the same question.
  if (
    facts.evidenceHead !== null &&
    facts.implementationHead !== null &&
    facts.evidenceHead !== facts.implementationHead
  ) {
    unmet.push({
      code: 'G4-12',
      detail: `evidence was established at ${facts.evidenceHead.slice(0, 7)} but the closure is against ${facts.implementationHead.slice(0, 7)}; re-establish it`,
    });
  }

  return { eligible: unmet.length === 0, unmet, satisfied };
}

/** The recorded basis for an eligible delegated closure. Truthful about what actually authorised it. */
export function g4BasisNote(facts: G4Facts): string {
  return (
    `closed under the pre-issued ChatGPT ProjectOS G4 gate: all 16 predicates mechanically satisfied ` +
    `against plan v${facts.activePlanVersion} at ${facts.implementationHead === null ? 'an unrecorded head' : facts.implementationHead.slice(0, 7)}, ` +
    `under the owner-recorded ${facts.governedProjectId}-scoped closure delegation`
  );
}
