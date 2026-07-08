/**
 * Permission model: which role may perform which governance action.
 *
 * Reflects the role model in the README: owner (Murad) is the final approver and can
 * do anything; advisor (ChatGPT) reviews/architects/recommends; implementer (Claude)
 * implements/tests/reports and requests approval but never approves or closes.
 */
import type { Role } from './types.js';

/** Canonical governance actions used across the engine. */
export type GovernanceAction =
  | 'create_phase'
  | 'prompt_phase'
  | 'implement'
  | 'run_validators'
  | 'generate_evidence'
  | 'generate_report'
  | 'request_approval'
  | 'request_review'
  | 'perform_review'
  | 'architect_phase'
  | 'recommend_closure'
  | 'approve'
  | 'reject'
  | 'close_phase'
  | 'override_gate'
  | 'rollback';

const IMPLEMENTER_ACTIONS: readonly GovernanceAction[] = [
  'implement',
  'run_validators',
  'generate_evidence',
  'generate_report',
  'request_approval',
  'request_review',
  'rollback',
];

const ADVISOR_ACTIONS: readonly GovernanceAction[] = [
  'create_phase',
  'prompt_phase',
  'architect_phase',
  'perform_review',
  'request_review',
  'recommend_closure',
];

/** Actions only the owner may perform (approval + closure + gate override). */
const OWNER_ONLY_ACTIONS: readonly GovernanceAction[] = [
  'approve',
  'reject',
  'close_phase',
  'override_gate',
];

const ROLE_ACTIONS: Readonly<Record<Role, readonly GovernanceAction[]>> = {
  implementer: IMPLEMENTER_ACTIONS,
  advisor: ADVISOR_ACTIONS,
  // Owner is a superset of everything.
  owner: [
    ...OWNER_ONLY_ACTIONS,
    ...ADVISOR_ACTIONS,
    ...IMPLEMENTER_ACTIONS,
  ],
};

export function can(role: Role, action: GovernanceAction): boolean {
  return ROLE_ACTIONS[role].includes(action);
}

/** True when only the owner can perform the action. */
export function isOwnerOnly(action: GovernanceAction): boolean {
  return OWNER_ONLY_ACTIONS.includes(action);
}

export function actionsFor(role: Role): readonly GovernanceAction[] {
  return ROLE_ACTIONS[role];
}
