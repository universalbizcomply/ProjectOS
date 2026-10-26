/**
 * Closure authority: who may close a phase, and on what recorded basis.
 *
 * Until now closure was owner-only, full stop: `transitionPhase` refused any role but `owner`. The
 * approved plan can now record a NARROW delegation — `governance.closureDelegation` — by which the
 * owner grants phase/programme closure for ONE named project to the gatekeeper. This module is the
 * only place that decision is made, and the only place a delegated grant can be minted.
 *
 * DESIGN RULES, in force order:
 *  1. The implementer can NEVER close. Not by role, not by identity, not by delegation. This is
 *     checked before anything else so no later branch can reach past it.
 *  2. Absent or malformed delegation means the previous behaviour, unchanged: owner-only. A plan
 *     that records nothing grants nothing.
 *  3. A delegation is confined to ONE project. `projectScope` must equal both the plan's project and
 *     the project actually being governed, so a delegation recorded in ProjectOS's plan cannot reach
 *     PolyGo — even if the same plan file were somehow loaded elsewhere.
 *  4. Closure only. `excludesProtectedActions` must be true; protected actions stay owner-only and
 *     are not reachable through this path at all.
 *  5. The grant is a capability token. `ClosureGrant` cannot be constructed by a caller — the brand
 *     is private to this module — so `transitionPhase` accepting one is proof the decision was made
 *     here, not asserted by whoever called it.
 *
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */
import type { Role, Result } from './types.js';
import { ok, err } from './types.js';
import type { G4Verdict } from './closureEligibility.js';

/** The CLOSURE scopes. Protected actions are deliberately absent and must never be added. */
export type ClosureScope = 'phase-closure' | 'programme-closure';

export const CLOSURE_SCOPES: readonly ClosureScope[] = ['phase-closure', 'programme-closure'];

/**
 * Deciding a gatekeeper REVIEW, which is not closing anything.
 *
 * WHY IT IS SEPARATE FROM CLOSURE. The gatekeeper's decider used to be read from the closure
 * delegation, which had only closure scopes to offer. A project that needed a review decider had to
 * be given phase closure to get one — authority nobody intended to grant, obtained because the
 * vocabulary had no word for what was actually wanted. This is that word.
 *
 * WHAT IT DELIBERATELY CANNOT DO. It is not a `ClosureScope` and the type says so, so it can never
 * be passed as `ClosureAuthorityInput.scope`; `decideClosureAuthority` compares the requested closure
 * scope against the delegation's own list, so a delegation carrying only this one covers neither
 * phase nor programme closure. It approves no plan, accepts no risk, and authorises no protected
 * effect — those never travelled through a delegation at all.
 */
export const GATEKEEPER_REVIEW_SCOPE = 'gatekeeper-review-decisions';

/**
 * Carrying out an ordinary TECHNICAL continuation, which is neither closing nor reviewing.
 *
 * WHY A THIRD WORD, for the same reason there was a second. Reviewing decides whether work is sound;
 * closing decides that a phase is finished. Neither of them is "commit these reviewed bytes and push
 * the branch" — and until this existed, a project that wanted that had nothing to ask for. The
 * previous phase established that the alternative vehicle, a `governance.technicalDelegation` block
 * in the plan, cannot work: the plan schema forbids unknown governance keys, `materialisePlan` writes
 * a fixed literal, and every activated record's own approval evidence asserts that governance was
 * carried forward unchanged. A delegation record is where a capability is granted in this project,
 * and this is that capability's name.
 *
 * WHAT IT DELIBERATELY CANNOT DO. It is not a `ClosureScope` and the type says so, so it can never be
 * passed as `ClosureAuthorityInput.scope`: a delegation carrying only this one closes nothing, and
 * closure keeps travelling through `closureDelegation` and the delegated phase advance exactly as
 * before. It approves no plan, accepts no risk, and authorises no protected effect.
 *
 * AND IT IS NOT, BY ITSELF, PERMISSION TO ACT. It says this CLASS of authority may be delegated to
 * the gatekeeper for this project and programme. Which action is actually performed still comes from
 * a live checked decision's `allowedActions`, and what ProjectOS is technically capable of performing
 * is a closed dispatcher. Those are three separate questions and all three must answer yes.
 *
 * Added in PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A under the owner's explicit approval,
 * "APPROVE B6 TECHNICAL DELEGATION SCOPE".
 */
export const TECHNICAL_CONTINUATION_SCOPE = 'technical-continuation';

/**
 * The owner's grant that lets ProjectOS COMMIT its closure delegate's decision — PROJECTOS-FINISH-
 * ZERO-TOUCH-CLOSURE1A, by the owner's decision of 2026-10-26 ("I have given you full authority").
 *
 * WHAT IT CHANGES, AND ONLY THAT. Without it the delegate's closure decision counts only once the
 * OWNER commits it: the owner's commit is the authenticity anchor of the closure route. With it, for
 * this project and programme, the owner has said in a committed record that the anchor may be
 * ProjectOS's own commit of exactly the presented bytes. Every other check stands: the delegate is
 * still the plan's, the decision is still judged by G4 and the closure checks, and the bytes are still
 * bound to what was presented.
 *
 * WHAT IT DELIBERATELY CANNOT DO. Like `technical-continuation`, it is not a `ClosureScope`, so it can
 * never be passed as `ClosureAuthorityInput.scope`: on its own it closes nothing, decides nothing and
 * names no decider. It grants no protected effect, and the implementer still cannot decide closure.
 */
export const CLOSURE_DECISION_COMMIT_SCOPE = 'closure-decision-commit';

/** Every scope an owner may put in a delegation record. One vocabulary, one place. */
export type DelegableScope =
  | ClosureScope
  | typeof GATEKEEPER_REVIEW_SCOPE
  | typeof TECHNICAL_CONTINUATION_SCOPE
  | typeof CLOSURE_DECISION_COMMIT_SCOPE;

export const DELEGABLE_SCOPES: readonly DelegableScope[] = [
  ...CLOSURE_SCOPES,
  GATEKEEPER_REVIEW_SCOPE,
  TECHNICAL_CONTINUATION_SCOPE,
  CLOSURE_DECISION_COMMIT_SCOPE,
];

/** The `governance.closureDelegation` record, as recorded in an approved plan. */
export interface ClosureDelegation {
  readonly delegatedBy: string;
  readonly delegatedTo: string;
  readonly delegationDate: string;
  readonly delegatedScope: readonly string[];
  readonly projectScope: string;
  readonly excludesProtectedActions: boolean;
  readonly notes?: string;
}

/** The governance facts a closure decision needs, read from the active approved plan and config. */
export interface ClosureAuthorityInput {
  /** The project actually being governed, from `.projectops/project-config.json`. */
  readonly governedProjectId: string;
  /** `plan.projectId` — compared against the governed project so a foreign plan cannot grant. */
  readonly planProjectId: string;
  readonly owner: string;
  readonly implementer: string;
  readonly closureAuthority: string;
  readonly delegation: ClosureDelegation | null;
  readonly actorRole: Role;
  /** Who the actor claims to be. Required for a delegated close; ignored for an owner close. */
  readonly actorIdentity: string | null;
  readonly scope: ClosureScope;
  /** The phase this decision is about. Binds the grant so it cannot be replayed on another phase. */
  readonly phaseId?: string;
  /**
   * The G4 gate verdict. REQUIRED for a delegated close: the delegation says who MAY hold the
   * conditional authority, and this says the conditions actually hold. Without it a delegated close
   * is refused, so `delegated: true` can never by itself be an authority token.
   * Not consulted for an owner close — an owner's authority is not conditional on this gate.
   */
  readonly eligibility?: G4Verdict;
  /**
   * Why the gatekeeper's DECISION is not usable, or `[]` when it is. REQUIRED for a delegated close.
   *
   * The defect this closes: `--delegated` was both the request and, implicitly, the decision. G4
   * answers "are the conditions for a decision satisfied?"; nothing answered "has the delegate
   * decided?", so eligibility alone closed a phase when an implementer typed the flag. The caller now
   * has to present a decision it did not author, and this module refuses without one.
   *
   * `undefined` means the caller never looked, which is refused — distinct from `[]`, which means a
   * decision was found and verified.
   */
  readonly decisionProblems?: readonly string[];
  /** The id of the decision being consumed, recorded on the history so it cannot be replayed. */
  readonly decisionId?: string;
}

export type ClosureRefusal =
  | 'IMPLEMENTER_CANNOT_CLOSE'
  | 'NO_DELEGATION'
  | 'DELEGATION_MALFORMED'
  | 'DELEGATION_WRONG_PROJECT'
  | 'DELEGATION_WRONG_DELEGATOR'
  | 'DELEGATION_WRONG_ACTOR'
  | 'DELEGATION_SCOPE_MISMATCH'
  | 'DELEGATION_CARRIES_PROTECTED_ACTIONS'
  | 'AUTHORITY_DISAGREEMENT'
  | 'ACTOR_IDENTITY_MISSING'
  | 'OWNER_IDENTITY_MISMATCH'
  | 'G4_NOT_ESTABLISHED'
  | 'G4_NOT_SATISFIED'
  | 'GATEKEEPER_DECISION_NOT_ESTABLISHED'
  | 'GATEKEEPER_DECISION_MISSING';

declare const CLOSURE_GRANT_BRAND: unique symbol;

/**
 * Proof that closure was authorised here. Callers cannot build one: the brand is a private unique
 * symbol, so the only way to obtain a grant is to pass `authoriseClosure`.
 */
export interface ClosureGrant {
  readonly [CLOSURE_GRANT_BRAND]: true;
  readonly basis: 'owner' | 'delegated';
  /** Who exercised the authority — recorded on the phase history so closure is auditable. */
  readonly authorisedIdentity: string;
  readonly projectScope: string;
  readonly scope: ClosureScope;
  /** The phase the grant was minted for, when one was named. `transitionPhase` enforces the match. */
  readonly phaseId?: string;
  /** The gatekeeper decision this grant consumed. Written into the history so it cannot be replayed. */
  readonly decisionId?: string;
}

function refuse(code: ClosureRefusal, detail: string): Result<ClosureGrant> {
  return err(`${code}: ${detail}`);
}

/** Identity tokens that can never hold closure authority, however they are spelled. */
const IMPLEMENTER_TOKENS = ['claude', 'anthropic', 'implementer', 'assistant', 'copilot'];
const IMPLEMENTER_WORDS = new Set(['ai', 'bot', 'agent', 'llm', 'model']);

export function isImplementerIdentity(name: string): boolean {
  // Normalise before folding, so a homoglyph or an accent cannot spell past the token list. NFKC
  // maps compatibility forms, and stripping combining marks turns `Claudé` into `claude`. This is
  // defence in depth — the real boundary is the exact match against the plan's recorded owner or
  // delegate — but a filter advertised as catching spelling variants should actually catch them.
  // NFKD, not NFKC: decomposition is what separates `é` into `e` + a combining mark so the mark can
  // be stripped. NFKC would recompose it and the accent would survive the fold.
  const lower = name.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '');
  const stripped = lower.replace(/[^a-z]/g, '');
  if (IMPLEMENTER_TOKENS.some((t) => stripped.includes(t))) return true;
  return lower
    .split(/[^a-z]+/)
    .filter(Boolean)
    .some((w) => IMPLEMENTER_WORDS.has(w));
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Decide whether `actorRole`/`actorIdentity` may close, and mint the grant if so.
 *
 * Returns a `Result`, never throws, and performs no I/O — the caller supplies the governance facts
 * it has already read and validated.
 */
export function authoriseClosure(input: ClosureAuthorityInput): Result<ClosureGrant> {
  // 1. The implementer can never close. Checked first and unconditionally, by role AND by identity,
  //    so no delegation branch below can be reached with an implementer in either seat.
  if (input.actorRole === 'implementer') {
    return refuse('IMPLEMENTER_CANNOT_CLOSE', 'the implementer can never close a phase');
  }
  if (input.actorIdentity !== null && isImplementerIdentity(input.actorIdentity)) {
    return refuse(
      'IMPLEMENTER_CANNOT_CLOSE',
      `'${input.actorIdentity}' is an implementer identity and can never hold closure authority`,
    );
  }

  // 2. Owner closure. A stated identity must actually BE the recorded owner — and, since the Phase-18
  //    breach, the owner's DECISION must exist too.
  //
  //    The breach was reported as a delegation problem, and fixing only the delegated branch would
  //    have left the larger hole untouched: `--as owner` is a caller-supplied string, so any caller
  //    able to type it obtained owner authority outright, without even the G4 gate that the delegated
  //    path at least required. The rule is therefore uniform — NO closure without a committed
  //    decision naming the authority the plan records.
  if (input.actorRole === 'owner') {
    if (input.actorIdentity !== null && input.actorIdentity !== input.owner) {
      return refuse(
        'OWNER_IDENTITY_MISMATCH',
        `identity '${input.actorIdentity}' is not the recorded owner '${input.owner}'`,
      );
    }
    if (input.decisionProblems === undefined) {
      return refuse(
        'GATEKEEPER_DECISION_NOT_ESTABLISHED',
        "an owner closure requires the owner's decision to be looked up and verified; the caller did not establish it",
      );
    }
    if (input.decisionProblems.length > 0) {
      return refuse(
        'GATEKEEPER_DECISION_MISSING',
        input.decisionProblems.slice(0, 3).join('; ') +
          (input.decisionProblems.length > 3 ? ` (+${input.decisionProblems.length - 3} more)` : ''),
      );
    }
    return ok({
      basis: 'owner',
      authorisedIdentity: input.owner,
      projectScope: input.governedProjectId,
      scope: input.scope,
      ...(input.phaseId === undefined ? {} : { phaseId: input.phaseId }),
      // Carried for the owner basis too. Omitting it meant every owner closure wrote a history note
      // with no decision reference, so `consumedDecisionIds` could never see an owner decision as
      // consumed — replay detection was silently absent on the MORE privileged of the two bases.
      ...(input.decisionId === undefined ? {} : { decisionId: input.decisionId }),
    } as ClosureGrant);
  }

  // 3. Delegated closure. Everything below must hold; any single failure refuses.
  const d = input.delegation;
  if (d === null || d === undefined) {
    return refuse(
      'NO_DELEGATION',
      'the approved plan records no closure delegation, so closure remains owner-only',
    );
  }
  if (!nonEmpty(d.delegatedBy) || !nonEmpty(d.delegatedTo) || !nonEmpty(d.projectScope)) {
    return refuse('DELEGATION_MALFORMED', 'closureDelegation is missing a required identity or scope');
  }
  if (!Array.isArray(d.delegatedScope) || d.delegatedScope.length === 0) {
    return refuse('DELEGATION_MALFORMED', 'closureDelegation records no delegated scope');
  }
  if (d.excludesProtectedActions !== true) {
    return refuse(
      'DELEGATION_CARRIES_PROTECTED_ACTIONS',
      'closureDelegation does not exclude protected actions; protected authority is never delegable',
    );
  }
  if (isImplementerIdentity(d.delegatedTo)) {
    return refuse('IMPLEMENTER_CANNOT_CLOSE', `closureDelegation delegates to the implementer '${d.delegatedTo}'`);
  }
  // Confinement: the delegation, the plan and the governed project must all name the SAME project.
  if (d.projectScope !== input.planProjectId) {
    return refuse(
      'DELEGATION_WRONG_PROJECT',
      `delegation scope '${d.projectScope}' is not the plan's project '${input.planProjectId}'`,
    );
  }
  if (d.projectScope !== input.governedProjectId) {
    return refuse(
      'DELEGATION_WRONG_PROJECT',
      `delegation scope '${d.projectScope}' is not the governed project '${input.governedProjectId}'`,
    );
  }
  if (d.delegatedBy !== input.owner) {
    return refuse(
      'DELEGATION_WRONG_DELEGATOR',
      `delegation was granted by '${d.delegatedBy}', who is not the recorded owner '${input.owner}'`,
    );
  }
  if (!d.delegatedScope.includes(input.scope)) {
    return refuse(
      'DELEGATION_SCOPE_MISMATCH',
      `delegated scope [${d.delegatedScope.join(', ')}] does not cover '${input.scope}'`,
    );
  }
  if (input.closureAuthority !== d.delegatedTo) {
    return refuse(
      'AUTHORITY_DISAGREEMENT',
      `governance.closureAuthority '${input.closureAuthority}' disagrees with the delegate '${d.delegatedTo}'`,
    );
  }
  if (!nonEmpty(input.actorIdentity)) {
    return refuse(
      'ACTOR_IDENTITY_MISSING',
      'a delegated closure must state who is exercising the delegation',
    );
  }
  if (input.actorIdentity !== d.delegatedTo) {
    return refuse(
      'DELEGATION_WRONG_ACTOR',
      `'${input.actorIdentity}' is not the delegate '${d.delegatedTo}'`,
    );
  }

  // The delegation is necessary and not sufficient. The conditions must be established AND met.
  if (input.eligibility === undefined) {
    return refuse(
      'G4_NOT_ESTABLISHED',
      'a delegated closure requires a G4 eligibility verdict; the delegation alone authorises nothing',
    );
  }
  if (!input.eligibility.eligible) {
    const unmet = input.eligibility.unmet;
    return refuse(
      'G4_NOT_SATISFIED',
      `${unmet.length} G4 predicate(s) unmet: ` +
        unmet.slice(0, 4).map((u) => `${u.code} ${u.detail}`).join('; ') +
        (unmet.length > 4 ? ` (+${unmet.length - 4} more)` : ''),
    );
  }

  // AND the delegate must actually have DECIDED. Eligibility is not a decision: the first version of
  // this module treated a valid delegation plus a passing G4 as sufficient, so any caller able to
  // request a delegated close obtained one. Checked last, after everything else holds, so the refusal
  // an operator sees is the one that is actually outstanding.
  if (input.decisionProblems === undefined) {
    return refuse(
      'GATEKEEPER_DECISION_NOT_ESTABLISHED',
      'a delegated closure requires the gatekeeper decision to be looked up and verified; the caller did not establish it',
    );
  }
  if (input.decisionProblems.length > 0) {
    return refuse(
      'GATEKEEPER_DECISION_MISSING',
      input.decisionProblems.slice(0, 3).join('; ') + (input.decisionProblems.length > 3 ? ` (+${input.decisionProblems.length - 3} more)` : ''),
    );
  }

  return ok({
    basis: 'delegated',
    authorisedIdentity: d.delegatedTo,
    projectScope: d.projectScope,
    scope: input.scope,
    ...(input.phaseId === undefined ? {} : { phaseId: input.phaseId }),
    ...(input.decisionId === undefined ? {} : { decisionId: input.decisionId }),
  } as ClosureGrant);
}

/**
 * Is this durable phase record CLOSED by someone who could legitimately close it?
 *
 * Single-sourced here because two places need the identical answer and previously each had its own
 * copy: the runtime's dependency gate (`governedContext`) and the Control Centre's projection. When
 * they disagree the surface offers a Start the runtime then refuses, or hides one it would allow.
 *
 * `owner` has always been able to close. `advisor` can now close too, but ONLY by presenting a grant
 * minted from a validated project-scoped delegation — `transitionPhase` refuses an advisor close
 * without one — so an `advisor` closure in the history is evidence of that validated path. The first
 * version of this check accepted `owner` alone, which silently made every delegated closure invisible
 * to dependency satisfaction and would have blocked any phase depending on one. Found in review.
 *
 * This is NOT tamper-proofing: whatever can write the record can write its history. That residual is
 * unchanged from the owner-only version and is covered by the owner commit/push gate.
 */
const CLOSING_ROLES: readonly Role[] = ['owner', 'advisor'];

export function isAuthoritativelyClosed(record: {
  readonly status?: unknown;
  readonly history?: unknown;
}): boolean {
  if (record.status !== 'closed') return false;
  const history = Array.isArray(record.history) ? record.history : [];
  const last = history[history.length - 1] as { to?: unknown; by?: unknown } | undefined;
  if (last === undefined || last.to !== 'closed') return false;
  return typeof last.by === 'string' && (CLOSING_ROLES as readonly string[]).includes(last.by);
}

/** Human-readable basis recorded on the phase history, so closure is auditable after the fact. */
export function grantNote(grant: ClosureGrant): string {
  // The decision id is written into the history deliberately: it is what makes a replay detectable,
  // because `consumedDecisionIds` reads it back out of exactly this sentence. Both bases carry it.
  const decision = grant.decisionId === undefined ? '' : `, decision ${grant.decisionId}`;
  if (grant.basis === 'owner') return `closed by owner ${grant.authorisedIdentity}${decision}`;
  return `closed by ${grant.authorisedIdentity} under the ${grant.projectScope}-scoped ${grant.scope} delegation${decision}`;
}
