// Origin: original ProjectOS code
/**
 * The shape every hash-pinned proposal shares.
 *
 * Something proposed, identified by the hash of exactly what the decider reads, and decided over that
 * hash. Memory writes and PORT-APPROVALS1A both have this shape, so there is one type rather than two.
 * It is a shape and nothing more: it decides nothing and grants nothing, and each user keeps its own
 * states, its own rules and its own hash domain.
 */
import type { Role } from '../types.js';

export type HashPinnedOutcome = 'approved' | 'rejected';

export interface HashPinnedDecision {
  readonly outcome: HashPinnedOutcome;
  readonly by: Role;
  readonly at: string;
  /** The hash the decider reviewed. */
  readonly proposalHash: string;
}

export interface HashPinnedProposal<State extends string = string> {
  readonly id: string;
  /** Covers everything the decider sees. */
  readonly proposalHash: string;
  readonly state: State;
  readonly decision: HashPinnedDecision | null;
}
