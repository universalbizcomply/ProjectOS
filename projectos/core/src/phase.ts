/**
 * Phase engine: the ProjectOS phase lifecycle as a pure state machine.
 *
 * Lifecycle: draft -> prompted -> implementing -> validating -> evidence ->
 * awaiting_review -> awaiting_closure -> closed | closed_as_blocked.
 * validating can loop back to implementing (failed validators); awaiting_review can
 * loop back to implementing (review requested changes); any active state can roll back.
 *
 * Closure (closed / closed_as_blocked) is owner-only — Claude never self-closes.
 */
import type { PhaseStatus, Role, Result } from './types.js';
import { ok, err } from './types.js';
import type { ClosureGrant } from './closureAuthority.js';

/** Legal transitions per status. Empty array = terminal. */
export const PHASE_TRANSITIONS: Readonly<Record<PhaseStatus, readonly PhaseStatus[]>> = {
  draft: ['prompted', 'rolled_back'],
  prompted: ['implementing', 'rolled_back'],
  implementing: ['validating', 'rolled_back'],
  validating: ['evidence', 'implementing', 'rolled_back'],
  evidence: ['awaiting_review', 'rolled_back'],
  awaiting_review: ['awaiting_closure', 'implementing', 'rolled_back'],
  awaiting_closure: ['closed', 'closed_as_blocked'],
  closed: [],
  closed_as_blocked: [],
  rolled_back: ['draft'],
};

/** Terminal statuses that only the owner may transition into. */
export const OWNER_ONLY_TARGETS: readonly PhaseStatus[] = ['closed', 'closed_as_blocked'];

export function canTransition(from: PhaseStatus, to: PhaseStatus): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}

export function requiresOwner(to: PhaseStatus): boolean {
  return OWNER_ONLY_TARGETS.includes(to);
}

export function isTerminal(status: PhaseStatus): boolean {
  return PHASE_TRANSITIONS[status].length === 0;
}

export interface PhaseTransition {
  readonly from: PhaseStatus;
  readonly to: PhaseStatus;
  readonly by: Role;
  readonly at: string;
  readonly note?: string;
}

export interface Phase {
  readonly phaseId: string;
  readonly project: string;
  readonly objective: string;
  readonly status: PhaseStatus;
  readonly history: readonly PhaseTransition[];
}

export interface CreatePhaseInput {
  readonly phaseId: string;
  readonly project: string;
  readonly objective: string;
}

export function createPhase(input: CreatePhaseInput): Phase {
  return {
    phaseId: input.phaseId,
    project: input.project,
    objective: input.objective,
    status: 'draft',
    history: [],
  };
}

/**
 * Transition a phase to a new status. Returns a new Phase (never mutates).
 * Fails on illegal transitions and on unauthorised attempts to close.
 *
 * CLOSURE AUTHORITY. Closure is owner-only unless a `ClosureGrant` is supplied. A grant can only be
 * minted by `authoriseClosure` — its brand is private to that module — so passing one is proof the
 * delegation was actually validated against the approved plan, not merely asserted by the caller.
 * With no grant the original rule stands unchanged: role `owner`, or refusal.
 */
export function transitionPhase(
  phase: Phase,
  to: PhaseStatus,
  by: Role,
  at: string,
  note?: string,
  grant?: ClosureGrant,
): Result<Phase> {
  if (!canTransition(phase.status, to)) {
    return err(`Illegal transition: ${phase.status} -> ${to}`);
  }
  if (requiresOwner(to) && by !== 'owner' && grant === undefined) {
    return err(`Transition to '${to}' requires role 'owner', got '${by}'`);
  }
  // A grant authorises CLOSURE only. It can never be used to reach any other transition, so a
  // caller holding one for a legitimate close cannot reuse it elsewhere.
  if (grant !== undefined && !requiresOwner(to)) {
    return err(`A closure grant cannot authorise the transition to '${to}'`);
  }
  // A grant is bound to the phase it was minted for, so one obtained for a legitimate close cannot
  // be replayed against a different phase.
  if (grant !== undefined && grant.phaseId !== undefined && grant.phaseId !== phase.phaseId) {
    return err(`Closure grant was issued for '${grant.phaseId}', not '${phase.phaseId}'`);
  }
  // The implementer can never close, grant or no grant. `authoriseClosure` refuses to mint a grant
  // for the implementer; this is the second, independent check at the point of effect.
  if (requiresOwner(to) && by === 'implementer') {
    return err(`Transition to '${to}' requires role 'owner', got '${by}'`);
  }
  const transition: PhaseTransition =
    note === undefined
      ? { from: phase.status, to, by, at }
      : { from: phase.status, to, by, at, note };
  return ok({
    ...phase,
    status: to,
    history: [...phase.history, transition],
  });
}
