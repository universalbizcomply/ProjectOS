/**
 * Where a stopped loop goes next — the gatekeeper, or the owner.
 *
 * WHAT THIS REPLACES. `decideContinuation` already ends a run with a named stop. Until now every one
 * of those stops ended at the same place: the owner, reading a report and carrying it to ChatGPT by
 * hand. That relay is the only thing left in ProjectOS that a person still has to do, and it is what
 * this phase removes.
 *
 * THE ROUTING IS THE SAFETY PROPERTY, so it is a table rather than a condition. Some stops are
 * REVIEW questions — is this finding real, is this correction sound, did the review happen — and a
 * reviewer is exactly what answers them. Others are AUTHORITY questions — may this be committed, may
 * production be touched, may the scope change — and no reviewer can answer those, however well it
 * reasons, because the answer is not a matter of judgement but of who is entitled to say yes.
 *
 * A VERDICT IS ONLY APPLICABLE TO SOME STOPS. The gatekeeper returns one of a closed set of verdicts,
 * but "APPROVED_TO_PROCEED" means something very different after a failing validator than after a run
 * that never said whether it touched production. So each routed stop declares which verdicts can
 * answer it, and a verdict outside that set is refused rather than applied. Without this, a single
 * over-agreeable reply would carry the loop past the one thing it was stopped for.
 *
 * NOTHING HERE CALLS ANYTHING. It decides; the runner acts. That keeps the routing testable without a
 * network, a key or a worker.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
 */
import type { GatekeeperVerdict } from '@projectos/core';
import type { LoopStop, LoopStopCode } from './outcome.js';

/**
 * Characters that are printable but reorder what a reader sees.
 *
 * GK-SEC-002, raised by the loop's own worker against this code. The sanitisers filtered on
 * `ch >= ' '`, which keeps every Unicode bidirectional override and format character: U+202A-U+202E
 * and U+2066-U+2069 are all above the space. Text carrying them renders in an order that has nothing
 * to do with its bytes, so a refusal quoted into a governance record - or an instruction shown to a
 * reviewer - can be made to READ as the opposite of what it says. Stripped, not escaped: nothing
 * legitimate in an identifier, an operation name or a governance instruction needs them.
 */
const REORDERING = /[‪-‮⁦-⁩‎‏؜]/g;

export type StopAudience = 'gatekeeper' | 'owner';

export interface StopRoute {
  readonly audience: StopAudience;
  /** Verdicts that can actually answer this stop. Ignored when the audience is the owner. */
  readonly applicableVerdicts: readonly GatekeeperVerdict[];
  /** Why it goes where it goes, carried into the request and the report. */
  readonly rationale: string;
}

/**
 * Every stop code, routed. EXHAUSTIVE BY TYPE — adding a stop code without routing it is a compile
 * error, which is the point: an unrouted stop would otherwise fall through to some default, and the
 * safe default is not obvious enough to be worth guessing.
 */
export const STOP_ROUTES: { readonly [K in LoopStopCode]: StopRoute } = {
  UNRESOLVED_CRITICAL_OR_HIGH: {
    audience: 'gatekeeper',
    applicableVerdicts: ['AMENDMENT_REQUIRED', 'APPROVED_TO_PROCEED', 'DO_NOT_PROCEED', 'AWAITING_OWNER'],
    rationale:
      'whether a finding is real, and what to do about it, is a review question — this is the judgement ' +
      'the owner has been relaying by hand',
  },
  CORRECTION_EXHAUSTED: {
    audience: 'gatekeeper',
    applicableVerdicts: ['AMENDMENT_REQUIRED', 'DO_NOT_PROCEED', 'AWAITING_OWNER'],
    rationale:
      'a defect that resisted the bounded correction loop needs a different instruction, not another ' +
      'identical attempt; it may not simply be approved past',
  },
  REVIEW_OUTSTANDING: {
    audience: 'gatekeeper',
    // NO APPROVED_TO_PROCEED. This stop means a review the approved plan requires has produced no
    // record. A verdict saying "proceed" would discharge EVERY outstanding review at once — including
    // a security review nobody performed — on the strength of one word. The way to satisfy a missing
    // review is for the review to happen and produce its record; until then the honest answers are to
    // ask for the work, to stop, or to refer it upward.
    applicableVerdicts: ['AMENDMENT_REQUIRED', 'DO_NOT_PROCEED', 'AWAITING_OWNER'],
    rationale:
      'the missing review is the gatekeeper own review; asking for it is what this stop is for, and ' +
      'a bare approval would discharge reviews that never happened',
  },
  WORKER_REFUSED: {
    audience: 'gatekeeper',
    // NEVER APPROVED_TO_PROCEED. A worker's refusal is evidence about the task, and approving past it
    // would carry on with whatever the worker declined to do.
    applicableVerdicts: ['AMENDMENT_REQUIRED', 'DO_NOT_PROCEED', 'AWAITING_OWNER'],
    rationale: 'a refusal is information about the brief; the brief may be amended but the refusal may not be overruled',
  },
  EFFECTS_NOT_ATTESTED: {
    audience: 'gatekeeper',
    // NEVER APPROVED_TO_PROCEED either: the unknown here is whether production was touched, and no
    // amount of reviewing turns an absent record into a denial.
    applicableVerdicts: ['AMENDMENT_REQUIRED', 'DO_NOT_PROCEED', 'AWAITING_OWNER'],
    rationale:
      'a run that never said what it did can be sent back to say so; it cannot be certified as having ' +
      'done nothing',
  },
  PROTECTED_EFFECT: {
    audience: 'owner',
    applicableVerdicts: [],
    rationale: 'a protected effect is the owner\'s to accept or reverse; no reviewer holds that authority',
  },
  OWNER_GATE: {
    audience: 'owner',
    applicableVerdicts: [],
    rationale: 'the plan names this gate as the owner\'s; a review can recommend it but never satisfy it',
  },
  SCOPE_DECISION: {
    audience: 'owner',
    applicableVerdicts: [],
    rationale: 'material scope change is excluded from every delegation this project has recorded',
  },
};

/** Where this stop goes. */
export function routeStop(stop: LoopStop): StopRoute {
  return STOP_ROUTES[stop.code];
}

/** Stops the loop can resolve without the owner — the relay this phase removes. */
export function gatekeeperRoutableCodes(): readonly LoopStopCode[] {
  return (Object.keys(STOP_ROUTES) as LoopStopCode[]).filter((c) => STOP_ROUTES[c].audience === 'gatekeeper');
}

export type NextLoopAction =
  | { readonly kind: 'retry'; readonly instruction: string }
  | { readonly kind: 'proceed'; readonly detail: string }
  | { readonly kind: 'owner'; readonly reasons: readonly string[] };

/**
 * A decision that has been through `checkGatekeeperDecision`, together with what that check said.
 *
 * THE PROBLEMS LIST IS PART OF THE ARGUMENT ON PURPOSE. The previous signature took a bare verdict and
 * a bare instruction, and trusted a caller convention stated only in a comment — so a caller could
 * check decision A and then act on a verdict it had parsed from somewhere else entirely, and nothing
 * in this module or its tests could tell. Passing the checked record and the check's own output makes
 * the linkage structural: this function cannot be called without saying whether the decision passed.
 */
export interface CheckedDecision {
  readonly decision: GatekeeperVerdict | string | undefined;
  readonly nextClaudeInstruction?: string | null;
  /** Exactly what `checkGatekeeperDecision` returned. Empty means it was accepted. */
  readonly problems: readonly string[];
}

/**
 * Turn a checked gatekeeper decision into the loop's next move, or refuse it.
 *
 * Binding, replay and authority are `checkGatekeeperDecision`'s job. What this adds is APPLICABILITY:
 * the right answer to the wrong question is still the wrong answer.
 */
export function applyVerdictToStop(stop: LoopStop, checked: CheckedDecision): NextLoopAction {
  const route = routeStop(stop);

  // A DECISION THAT DID NOT PASS ITS OWN CHECK DECIDES NOTHING — and a caller that does not SAY
  // whether it checked has not checked. An absent `problems` array is treated as a failure rather
  // than as an empty one, because the alternative is that forgetting to check looks like passing.
  const problems = Array.isArray(checked?.problems)
    ? checked.problems
    : ['no result from checkGatekeeperDecision was supplied, so it is not known whether the decision passed'];
  if (problems.length > 0) {
    return {
      kind: 'owner',
      reasons: [
        `STOPPED (${stop.code}): ${stop.detail}`,
        'the gatekeeper decision did not pass its own checks, so no verdict was applied',
        ...problems,
      ],
    };
  }

  const verdict = checked.decision as GatekeeperVerdict;
  const nextInstruction = checked.nextClaudeInstruction ?? null;

  if (route.audience === 'owner') {
    return {
      kind: 'owner',
      reasons: [
        `STOPPED (${stop.code}): ${stop.detail}`,
        `this stop is the owner's: ${route.rationale}`,
        'a gatekeeper verdict cannot answer it, so none was applied',
      ],
    };
  }

  if (!route.applicableVerdicts.includes(verdict)) {
    return {
      kind: 'owner',
      reasons: [
        `STOPPED (${stop.code}): ${stop.detail}`,
        `the gatekeeper returned ${verdict}, which cannot answer this stop; ` +
          `applicable verdicts are: ${route.applicableVerdicts.join(', ')}`,
        route.rationale,
      ],
    };
  }

  // AN OWNER-GATED VERDICT IS NEVER APPLICABLE TO ANY STOP — that is an invariant of the table above,
  // asserted in the tests rather than re-checked here. A redundant runtime guard for it would be
  // unreachable code that reads like protection; the switch below has no case for those verdicts, so
  // one arriving anyway falls through to the owner.
  switch (verdict) {
    case 'AMENDMENT_REQUIRED': {
      // A correction with no instruction is an instruction to guess.
      if (nextInstruction === null || nextInstruction.trim() === '') {
        return {
          kind: 'owner',
          reasons: [
            `STOPPED (${stop.code}): ${stop.detail}`,
            'the gatekeeper required an amendment but gave no instruction, so there is nothing to act on',
          ],
        };
      }
      // BOUNDED. This string is written by a model and becomes the implementer's next instruction, so
      // it is truncated and stripped of control characters. An unbounded instruction is both a
      // practical hazard (it is carried into records and prompts) and an honesty problem: the loop
      // should not relay arbitrary volumes of model text as though ProjectOS had authored it.
      // Bidi and format characters are stripped first: they are printable, so a filter on `ch >= ' '`
      // keeps them, and they reorder what a reader sees without changing the bytes. GK-SEC-002.
      const instruction = Array.from(nextInstruction.replace(REORDERING, '').trim())
        .filter((ch) => ch >= ' ' || ch === '\n')
        .join('')
        .slice(0, 2000);
      return { kind: 'retry', instruction };
    }
    case 'APPROVED_TO_PROCEED':
      return { kind: 'proceed', detail: `the gatekeeper reviewed ${stop.code} and approved continuation` };
    case 'DO_NOT_PROCEED':
      return {
        kind: 'owner',
        reasons: [
          `STOPPED (${stop.code}): ${stop.detail}`,
          'the gatekeeper decided the work must not continue',
        ],
      };
    case 'AWAITING_OWNER':
      return {
        kind: 'owner',
        reasons: [
          `STOPPED (${stop.code}): ${stop.detail}`,
          'the gatekeeper referred this to the owner rather than deciding it',
        ],
      };
    default:
      // Unreachable while the vocabulary and the routing table agree; fails towards the owner if not.
      return {
        kind: 'owner',
        reasons: [`STOPPED (${stop.code}): ${stop.detail}`, `unhandled gatekeeper verdict ${String(verdict)}`],
      };
  }
}
