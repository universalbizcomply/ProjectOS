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

/** The delegable scopes. Protected actions are deliberately absent and must never be added. */
export type ClosureScope = 'phase-closure' | 'programme-closure';

export const CLOSURE_SCOPES: readonly ClosureScope[] = ['phase-closure', 'programme-closure'];

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
  | 'OWNER_IDENTITY_MISMATCH';

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
}

function refuse(code: ClosureRefusal, detail: string): Result<ClosureGrant> {
  return err(`${code}: ${detail}`);
}

/** Identity tokens that can never hold closure authority, however they are spelled. */
const IMPLEMENTER_TOKENS = ['claude', 'anthropic', 'implementer', 'assistant', 'copilot'];
const IMPLEMENTER_WORDS = new Set(['ai', 'bot', 'agent', 'llm', 'model']);

export function isImplementerIdentity(name: string): boolean {
  const lower = name.toLowerCase();
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

  // 2. Owner closure. Unchanged behaviour, plus one addition: a stated identity must actually BE the
  //    recorded owner, so nobody can claim the owner role under another name.
  if (input.actorRole === 'owner') {
    if (input.actorIdentity !== null && input.actorIdentity !== input.owner) {
      return refuse(
        'OWNER_IDENTITY_MISMATCH',
        `identity '${input.actorIdentity}' is not the recorded owner '${input.owner}'`,
      );
    }
    return ok({
      basis: 'owner',
      authorisedIdentity: input.owner,
      projectScope: input.governedProjectId,
      scope: input.scope,
      ...(input.phaseId === undefined ? {} : { phaseId: input.phaseId }),
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

  return ok({
    basis: 'delegated',
    authorisedIdentity: d.delegatedTo,
    projectScope: d.projectScope,
    scope: input.scope,
    ...(input.phaseId === undefined ? {} : { phaseId: input.phaseId }),
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
  return grant.basis === 'owner'
    ? `closed by owner ${grant.authorisedIdentity}`
    : `closed by ${grant.authorisedIdentity} under the ${grant.projectScope}-scoped ${grant.scope} delegation`;
}
