/**
 * When ProjectOS may carry out an ordinary technical continuation, and what "ordinary" means.
 *
 * WHAT THIS REPLACES. Until now every commit, push and integration in this project was a sentence the
 * owner typed. The gatekeeper could say "I would commit this"; nothing could act on it. This module
 * is the decision about whether an action may happen — and it is deliberately nothing but refusals,
 * because the whole difficulty here is that several things are each *nearly* an authorisation and
 * none of them is one.
 *
 * THE CONJUNCTION IS THE DESIGN. Four independent facts must all hold, and no three of them are
 * enough:
 *
 *   1. A LIVE DECISION THAT PASSED ITS OWN CHECK. Not a decision read back from disk, not one
 *      remembered from a previous run — one that `checkGatekeeperDecision` accepted in the transition
 *      now asking. The caller must hand over that check's own output, so "did you check it" is a
 *      structural question rather than a convention.
 *   2. A COMMITTED DELEGATION CARRYING `technical-continuation`. The owner recorded, in a reviewable
 *      artefact that had to pass the commit gate, that this class of authority may be delegated at
 *      all — for this project and this programme only.
 *   3. THE ACTION IN THAT DECISION'S `allowedActions`. The delegation says the class may be
 *      delegated; the decision says which action, this time.
 *   4. THE ACTION IN PROJECTOS'S OWN CLOSED VOCABULARY. What the runtime is capable of doing is not a
 *      matter of what a model asked for. An unknown action is refused rather than attempted.
 *
 * AND THE BINDINGS MUST STILL HOLD AT THE MOMENT OF ACTING. A decision is about a project, a phase, a
 * base commit and a specific set of candidate bytes. Every one of those can change between the answer
 * and the action, and each change makes the answer about something else.
 *
 * WHAT IS NOT AUTHORITY, stated because each has been mistaken for it somewhere: persisted decision
 * evidence, `.projectops/work.v1.json`, a checkpoint state of `GATE_APPROVED`, a `nextCandidateAction`
 * field, a report that says APPROVED, or any text the implementer wrote. This module reads none of
 * them and has no parameter through which one could arrive.
 *
 * PURE. No I/O, no git, no disk — so every refusal above is testable without a repository, and the
 * agent-side executor is left with nothing to decide.
 *
 * Created in PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A.
 */
import { TECHNICAL_CONTINUATION_SCOPE } from './closureAuthority.js';

/**
 * Every technical action ProjectOS can perform. CLOSED, and short on purpose.
 *
 * ORDINARY SOURCE-CONTROL CONTINUATION AND NOTHING ELSE. There is no deploy, no release, no tag, no
 * branch deletion and no "run this command" — not because they were forgotten but because an
 * executor that can express them is an executor that can be talked into them. Adding a member here is
 * a deliberate act with a test and a validator attached, which is the point.
 *
 * THE NAMES MATCH THE PROJECT'S EXISTING VOCABULARY. `commit` and `push` are spelled exactly as
 * `ALWAYS_OWNER_ONLY` spells them, so the floor and this list cannot disagree about what a word
 * means. `ff-only-integration` is new because the project had no word for it.
 */
export const TECHNICAL_ACTIONS = ['commit', 'push', 'ff-only-integration'] as const;

export type TechnicalAction = (typeof TECHNICAL_ACTIONS)[number];

/** Is this string one of the actions ProjectOS can actually carry out? */
export function isTechnicalAction(value: unknown): value is TechnicalAction {
  return typeof value === 'string' && (TECHNICAL_ACTIONS as readonly string[]).includes(value);
}

/**
 * The identity of the exact bytes a commit would record.
 *
 * A DIGEST PLUS THE ENTRIES IT WAS TAKEN OVER. The digest is what gets compared; the entries exist so
 * a refusal can say WHICH path stopped it rather than only that two hex strings differ. An operator
 * told "the candidate changed" and nothing else has to go and find out what changed, which is the
 * moment the temptation to skip the check appears.
 */
export interface CandidateIdentity {
  readonly schemaVersion: string;
  /** `sha256:<hex>` over the canonical entry encoding. */
  readonly digest: string;
  /** Sorted, one per path in the candidate boundary. */
  readonly entries: readonly CandidateEntry[];
}

export interface CandidateEntry {
  /** Repo-relative, forward slashes. */
  readonly path: string;
  /** `present` — the file exists and is part of the candidate. `deleted` — it is gone. */
  readonly state: 'present' | 'deleted';
  /** The git blob id of the working-tree content, or `null` for a deleted path. */
  readonly blob: string | null;
  /** The mode git would record. See the note in the agent-side computation about `core.filemode`. */
  readonly mode: string;
}

export const CANDIDATE_IDENTITY_SCHEMA_VERSION = '1.0.0';

/**
 * What the runtime knows about the world right now. Every field is established by ProjectOS itself —
 * from git, from the committed project config, from the approved plan — and NONE of it may come from
 * a model, a worker's output, a checkpoint or a stored record.
 */
export interface TechnicalContinuationContext {
  readonly projectId: string;
  readonly phaseId: string;
  readonly programmeId: string;
  /** The absolute governed root. Every git invocation is bound to it. */
  readonly root: string;
  /** The branch the checkout is on right now. */
  readonly currentBranch: string;
  /** The branch the governed context says this work belongs on. */
  readonly expectedBranch: string;
  /** HEAD right now. */
  readonly currentHead: string;
  /** The candidate as it stands right now. */
  readonly currentCandidate: CandidateIdentity;
}

/** What the gatekeeper actually answered, as accepted by `checkGatekeeperDecision`. */
export interface CheckedTechnicalDecision {
  /** Exactly what `checkGatekeeperDecision` returned. Empty means it was accepted. */
  readonly problems: readonly string[];
  readonly decisionId: string;
  readonly projectId: string;
  readonly phaseId: string;
  /** The commit the decision was taken against — the base the candidate sits on. */
  readonly subjectCommit: string;
  readonly allowedActions: readonly string[];
  /**
   * The candidate identity the gatekeeper's evidence carried.
   *
   * TRANSITIVELY BOUND, NOT A FIFTH FIELD ON THE DECISION. The identity is written into the evidence
   * text, whose digest is one of `evidenceDigests`, which `gatekeeperRequestDigest` covers, which the
   * decision must match. So a decision that passed its check is already a decision about these bytes
   * — the checker did the binding, and this is that same value carried forward for comparison rather
   * than a new thing to trust.
   */
  readonly reviewedCandidateDigest: string;
  /**
   * The entries the reviewed digest was taken over, when the caller still has them.
   *
   * FOR EXPLANATION ONLY, and never for the decision — the comparison below is on digests alone, so a
   * caller that supplied entries disagreeing with its own digest changes nothing about whether the
   * action is authorised. It exists so a drift refusal can name the path that drifted instead of
   * printing two hex strings at an operator, which is the moment the temptation to skip the check
   * appears.
   */
  readonly reviewedEntries?: readonly CandidateEntry[];
}

/** The delegation as judged by `checkClosureDelegationRecord`, with the scope this needs. */
export interface TechnicalDelegationState {
  /** Exactly what the delegation checker returned. Empty means it was accepted. */
  readonly problems: readonly string[];
  /** Whether the record actually carries `technical-continuation`. */
  readonly carriesTechnicalScope: boolean;
  /** Who it delegates to. Never the implementer — the checker refuses that. */
  readonly delegatedTo: string;
}

export interface TechnicalContinuationRequest {
  readonly action: string;
  readonly context: TechnicalContinuationContext;
  readonly decision: CheckedTechnicalDecision;
  readonly delegation: TechnicalDelegationState;
  /**
   * The actions this phase and the constitution hold to the owner, already unioned by the caller with
   * `enforcedOwnerOnlyActions`.
   *
   * BELT AND BRACES, AND WORTH THE REDUNDANCY. `checkGatekeeperDecision` already refuses a decision
   * whose `allowedActions` names one of these, so a decision reaching here cannot carry one. This
   * checks again at the point of ACTING, because the two checks answer different questions — "was
   * this answer well formed" and "may this be done now" — and the day they are separated by a
   * refactor, the second one is the one that matters.
   */
  readonly ownerOnlyActions: readonly string[];
}

/**
 * Proof that the conjunction above was actually evaluated and passed.
 *
 * A CAPABILITY TOKEN, MODELLED ON `ClosureGrant`. The brand is a symbol private to this module, so no
 * caller anywhere can construct one — an executor that accepts this type is therefore accepting
 * evidence that the decision was made HERE, rather than a boolean somebody set. Without it, the split
 * between "decide" and "perform" would be a naming convention, and the perform half would be one
 * hand-written object away from running unauthorised.
 */
declare const AUTHORISED: unique symbol;

export interface AuthorisedContinuation {
  readonly action: TechnicalAction;
  readonly [AUTHORISED]: true;
}

export type TechnicalContinuationVerdict =
  | { readonly authorised: true; readonly grant: AuthorisedContinuation }
  | { readonly authorised: false; readonly reasons: readonly string[] };

/**
 * May this technical action be carried out right now?
 *
 * Returns EVERY reason it may not, rather than the first, so one refusal shows the whole gap. An
 * authorised result carries a grant no caller could have made, so the executor cannot be reached with
 * a decision this function never took.
 */
export function authoriseTechnicalContinuation(
  request: TechnicalContinuationRequest,
): TechnicalContinuationVerdict {
  const e: string[] = [];
  const { action, context, decision, delegation } = request;

  // 1. THE DECISION PASSED ITS OWN CHECK — and a caller that does not SAY whether it checked has not
  //    checked. A non-array `problems` is treated as a failure rather than as an empty one, because
  //    the alternative is that forgetting to check looks like passing. Same rule as
  //    `applyVerdictToStop`, for the same reason.
  const decisionProblems = Array.isArray(decision?.problems)
    ? decision.problems
    : ['no result from checkGatekeeperDecision was supplied, so it is not known whether the decision passed'];
  if (decisionProblems.length > 0) {
    e.push('the gatekeeper decision did not pass its own checks, so it authorises nothing', ...decisionProblems);
  }

  // 2. THE OWNER DELEGATED THIS CLASS OF AUTHORITY AT ALL.
  const delegationProblems = Array.isArray(delegation?.problems)
    ? delegation.problems
    : ['no result from the delegation check was supplied, so it is not known whether the delegation is valid'];
  if (delegationProblems.length > 0) {
    e.push(
      `no valid committed delegation grants '${TECHNICAL_CONTINUATION_SCOPE}' for this project`,
      ...delegationProblems,
    );
  } else if (delegation.carriesTechnicalScope !== true) {
    e.push(
      `the committed delegation is valid but does not carry '${TECHNICAL_CONTINUATION_SCOPE}' — ` +
        'reviewing and closing are not carrying out a technical action',
    );
  }

  // 3. PROJECTOS CAN ACTUALLY DO THIS, and knows what it means.
  if (!isTechnicalAction(action)) {
    e.push(
      `'${String(action)}' is not one of the technical actions ProjectOS performs ` +
        `(${TECHNICAL_ACTIONS.join(', ')}); an unrecognised action is refused, never attempted`,
    );
  }

  // 4. THE DECISION ACTUALLY APPROVED THIS ACTION. A delegation that permits the class is not a
  //    decision that approved the instance.
  const allowed = Array.isArray(decision?.allowedActions) ? decision.allowedActions.map(String) : [];
  if (!allowed.includes(String(action))) {
    e.push(
      `the decision's allowedActions [${allowed.join(', ') || 'none'}] does not include ` +
        `'${String(action)}'`,
    );
  }

  // 5. AND IT IS NOT SOMETHING THE OWNER KEEPS. See the note on the field.
  if (request.ownerOnlyActions.map(String).includes(String(action))) {
    e.push(
      `'${String(action)}' is owner-only for this phase, so no delegation and no decision can carry ` +
        'it; the owner performs it or it does not happen',
    );
  }

  // 6. THE BINDINGS STILL DESCRIBE THIS WORLD. Each of these is a different way an answer could be
  //    about something else by the time it is acted on.
  if (decision.projectId !== context.projectId) {
    e.push(`the decision is for project '${decision.projectId}', and this is '${context.projectId}'`);
  }
  if (decision.phaseId !== context.phaseId) {
    e.push(`the decision is for phase '${decision.phaseId}', and this is '${context.phaseId}'`);
  }
  if (decision.subjectCommit !== context.currentHead) {
    e.push(
      `the decision was taken against ${short(decision.subjectCommit)} and HEAD is now ` +
        `${short(context.currentHead)} — the base moved after the answer, so the answer is about ` +
        'other bytes',
    );
  }
  if (context.currentBranch !== context.expectedBranch) {
    e.push(
      `this checkout is on '${context.currentBranch}' and the governed context expects ` +
        `'${context.expectedBranch}'`,
    );
  }

  // 7. THE BYTES ARE THE BYTES THAT WERE REVIEWED. The whole point of the candidate identity.
  if (decision.reviewedCandidateDigest !== context.currentCandidate.digest) {
    e.push(
      'the candidate changed after the gatekeeper reviewed it, so what would be committed is not ' +
        'what was approved',
      `  reviewed: ${decision.reviewedCandidateDigest}`,
      `  now:      ${context.currentCandidate.digest}`,
      '  this is not a question of how large the change is; changed reviewed bytes require a fresh gate',
    );
  }

  if (e.length > 0) return { authorised: false, reasons: e };
  // The one place a grant is minted, past every refusal above.
  return { authorised: true, grant: { action: action as TechnicalAction } as AuthorisedContinuation };
}

function short(commit: string): string {
  return typeof commit === 'string' && commit.length >= 7 ? commit.slice(0, 7) : String(commit);
}
