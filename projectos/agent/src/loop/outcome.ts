/**
 * What the loop does next: correct and carry on, or stop and say whose decision it is.
 *
 * THE WHOLE PHASE TURNS ON THIS ASYMMETRY. An ordinary defect — a failing validator, a failing test,
 * a LOW or MEDIUM review finding — is work, and stopping for it would make the loop pointless. A
 * CRITICAL or HIGH finding, a protected effect, an owner gate or a scope question is a DECISION, and
 * correcting it automatically would make the loop dangerous. So the classification here is the
 * safety property, and it fails towards stopping: anything it cannot classify stops.
 *
 * BOUNDED CORRECTION. Retrying forever is how an autonomous loop turns a defect into an outage. The
 * attempt bound is small and, when it is exhausted, the loop stops and says the defect resisted
 * correction rather than reporting that it is still working on it.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import type { CheckResult } from './verification.js';
import type { WorkerBrief } from './brief.js';

/** Correction attempts on the same phase before the loop hands it back. */
export const MAX_CORRECTION_ATTEMPTS = 3;

export type LoopStopCode =
  | 'UNRESOLVED_CRITICAL_OR_HIGH'
  | 'PROTECTED_EFFECT'
  | 'EFFECTS_NOT_ATTESTED'
  | 'OWNER_GATE'
  | 'SCOPE_DECISION'
  | 'CORRECTION_EXHAUSTED'
  | 'WORKER_REFUSED'
  | 'REVIEW_OUTSTANDING';

export interface LoopStop {
  readonly code: LoopStopCode;
  readonly detail: string;
}

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface ReviewFinding {
  readonly id: string;
  readonly severity: Severity;
  readonly category: string;
  readonly summary: string;
  readonly resolved: boolean;
}

/**
 * Effects that end unattended execution, named exactly as the closure gate already names them so the
 * loop and the gate cannot disagree about what a protected effect is.
 *
 * EVERY FIELD IS REQUIRED, and required to be a boolean. An optional field lets `{}` certify a run
 * that attested to nothing, which is the same fail-open the absent-record rule already closes,
 * wearing a different hat: the answer "I did not say" would be read as "no". A worker must state a
 * position on each effect, and stating none is not one.
 *
 * This is an ATTESTATION under the project's existing manual-governance model — `tamperProof: false`
 * throughout. Anything that can write this file can write `false` into it. The backstop is the owner
 * commit/push gate, where the claim is a visible diff; nothing here is cryptographic and nothing
 * here should be described as tamper-proof.
 */
export interface EffectsRecord {
  readonly productionTouched: boolean;
  readonly deploymentOccurred: boolean;
  readonly databaseMutationOccurred: boolean;
  readonly externalSendOccurred: boolean;
  readonly paymentOccurred: boolean;
  readonly rawSecretStored: boolean;
}

/** The fields an attestation must carry. Exported so the reader and the judge cannot drift apart. */
export const PROTECTED_EFFECT_FIELDS: readonly (keyof EffectsRecord)[] = [
  'productionTouched',
  'deploymentOccurred',
  'databaseMutationOccurred',
  'externalSendOccurred',
  'paymentOccurred',
  'rawSecretStored',
];

export type ContinuationDecision =
  | { readonly kind: 'retry'; readonly attempt: number; readonly detail: string }
  | { readonly kind: 'stop'; readonly reason: LoopStop }
  | { readonly kind: 'proceed'; readonly detail: string };

/** The severities the loop may never carry past, whether or not the checks pass. */
export function blockingFindings(findings: readonly ReviewFinding[]): readonly ReviewFinding[] {
  return findings.filter((f) => !f.resolved && (f.severity === 'CRITICAL' || f.severity === 'HIGH'));
}

/**
 * The severities that are WORK: an unresolved LOW or MEDIUM goes back to the worker like a failing
 * test does.
 *
 * Carrying them to the owner gate untouched was the quieter half of the same mistake as never
 * retrying a failing check: the loop exists to correct ordinary defects, and a MEDIUM finding
 * nobody acted on is an ordinary defect that reached the owner wearing "reviewed" as a label.
 */
export function correctableFindings(findings: readonly ReviewFinding[]): readonly ReviewFinding[] {
  return findings.filter((f) => !f.resolved && (f.severity === 'MEDIUM' || f.severity === 'LOW'));
}

/** Protected effects the run attested to, by name. Empty means it attested `false` to every one. */
export function protectedEffects(effects: EffectsRecord | null): readonly string[] {
  if (effects === null) return [];
  return PROTECTED_EFFECT_FIELDS.filter((f) => effects[f] === true);
}

/**
 * Why this is not a usable attestation, or empty when it is.
 *
 * Kept beside the judge rather than in the reader so both use one rule: a field that is absent, or
 * present as a string, a number or null, is not an answer. `"false"` is a particularly nasty case —
 * it LOOKS like a denial and is truthy in JavaScript.
 */
export function attestationProblems(value: unknown): readonly string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return ['the effects attestation is not an object'];
  }
  const rec = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const field of PROTECTED_EFFECT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(rec, field)) {
      problems.push(`the effects attestation does not state ${field}`);
    } else if (typeof rec[field] !== 'boolean') {
      problems.push(`the effects attestation states ${field} as ${JSON.stringify(rec[field])}, which is not a boolean`);
    }
  }
  return problems;
}

/** Reviews the plan requires that this run has no finding record for at all. */
export function outstandingReviews(
  brief: WorkerBrief,
  reviewsRecorded: readonly string[],
): readonly string[] {
  return brief.phase.requiredReviews.filter((r) => !reviewsRecorded.includes(r));
}

export interface DecisionInput {
  readonly brief: WorkerBrief;
  readonly checks: readonly CheckResult[];
  readonly findings: readonly ReviewFinding[];
  /**
   * The run's effects attestation. `null` means NONE WAS WRITTEN, which is not the same as "nothing
   * happened" and is never treated as such — see `decideContinuation`.
   */
  readonly effects: EffectsRecord | null;
  /** Which of the plan's required reviews have produced a finding record for this run. */
  readonly reviewsRecorded: readonly string[];
  /** Correction attempts already spent on this phase. */
  readonly attemptsSpent: number;
  /** A scope question the worker raised, when it raised one. */
  readonly scopeQuestion?: string | null;
  /** Set when the worker itself refused to run. */
  readonly workerRefusal?: string | null;
}

/**
 * Decide what happens next. The ORDER is the safety argument, so it is spelled out:
 *
 *  1. a worker that refused never produces a pass, so nothing after it may be read as one;
 *  2. a protected effect stops everything, including a run whose checks all passed — a green run
 *     that touched production is the worst thing to carry forward, not the best;
 *  3. an unresolved CRITICAL or HIGH stops next, ahead of ordinary defects, so a failing test can
 *     never mask a security finding by being retried first;
 *  4. a scope question is the owner's and is not a defect to be corrected;
 *  5. only then is ordinary work handled — failing checks AND unresolved LOW/MEDIUM findings, which
 *     are the same kind of thing — and only while attempts remain;
 *  6. a run that attested nothing about its own effects cannot be certified, and a required review
 *     with no record is outstanding, not passed;
 *  7. everything green with reviews recorded reaches the owner gate, which is a stop with a name.
 */
export function decideContinuation(input: DecisionInput): ContinuationDecision {
  const refusal = input.workerRefusal ?? null;
  if (refusal !== null && refusal !== '') {
    return { kind: 'stop', reason: { code: 'WORKER_REFUSED', detail: refusal } };
  }

  const effects = protectedEffects(input.effects);
  if (effects.length > 0) {
    return {
      kind: 'stop',
      reason: {
        code: 'PROTECTED_EFFECT',
        detail: `this run recorded a protected effect (${effects.join(', ')}); unattended execution ends here regardless of what the checks say`,
      },
    };
  }

  const blocking = blockingFindings(input.findings);
  if (blocking.length > 0) {
    return {
      kind: 'stop',
      reason: {
        code: 'UNRESOLVED_CRITICAL_OR_HIGH',
        detail: `${blocking.length} unresolved finding(s) at CRITICAL or HIGH: ${blocking
          .map((f) => `${f.severity} ${f.id} — ${f.summary}`)
          .join('; ')}`,
      },
    };
  }

  const scope = input.scopeQuestion ?? null;
  if (scope !== null && scope !== '') {
    return { kind: 'stop', reason: { code: 'SCOPE_DECISION', detail: scope } };
  }

  // ORDINARY WORK: a failing check and an unresolved LOW/MEDIUM finding are the same kind of thing,
  // and both go back to the worker under the same bound.
  const failed = input.checks.filter((c) => !c.passed);
  const correctable = correctableFindings(input.findings);
  if (failed.length > 0 || correctable.length > 0) {
    const parts: string[] = [];
    if (failed.length > 0) parts.push(`${failed.length} required check(s) failing: ${failed.map((c) => c.id).join(', ')}`);
    if (correctable.length > 0) {
      parts.push(
        `${correctable.length} unresolved finding(s) at MEDIUM or LOW: ${correctable
          .map((f) => `${f.severity} ${f.id}`)
          .join(', ')}`,
      );
    }
    const what = parts.join('; ');
    if (input.attemptsSpent >= MAX_CORRECTION_ATTEMPTS) {
      return {
        kind: 'stop',
        reason: {
          code: 'CORRECTION_EXHAUSTED',
          detail: `${what} — still outstanding after ${input.attemptsSpent} correction attempt(s). It resisted correction and is now a decision, not work.`,
        },
      };
    }
    return { kind: 'retry', attempt: input.attemptsSpent + 1, detail: what };
  }

  // ABSENCE IS NOT INNOCENCE. A missing attestation was, in the first cut of this module, read as
  // "no protected effect occurred" — which made the PROTECTED_EFFECT branch above unreachable on
  // every real run, since nothing had written the record yet. It is checked HERE, at the point of
  // certification, rather than at the top: a failing check does not need an attestation to be sent
  // back for correction, but nothing may be CERTIFIED by a run that never said what it did.
  if (input.effects === null) {
    return {
      kind: 'stop',
      reason: {
        code: 'EFFECTS_NOT_ATTESTED',
        detail:
          'this run wrote no effects attestation, so whether it touched anything protected is unknown; ' +
          'an absent record is not evidence that nothing happened',
      },
    };
  }

  const outstanding = outstandingReviews(input.brief, input.reviewsRecorded);
  if (outstanding.length > 0) {
    return {
      kind: 'stop',
      reason: {
        code: 'REVIEW_OUTSTANDING',
        detail:
          `the approved plan requires ${outstanding.join(', ')} for this phase and no finding record exists for ` +
          'them in this run; a review that did not happen has not passed',
      },
    };
  }

  const gates = input.brief.phase.requiredOwnerGates;
  if (gates.length > 0) {
    return {
      kind: 'stop',
      reason: {
        code: 'OWNER_GATE',
        detail:
          `every required check passed and every required review is recorded; the phase now needs ${gates.join(', ')}, ` +
          'which the loop may not perform',
      },
    };
  }

  return { kind: 'proceed', detail: 'every required check passed and this phase declares no owner gate' };
}

/** Render a loop stop for the CLI, in the same shape every other refusal uses. */
export function loopStopLines(reason: LoopStop): readonly string[] {
  return [`STOPPED (${reason.code}): ${reason.detail}`];
}
