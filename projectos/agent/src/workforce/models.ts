/**
 * Role and model are separate: a role's identity, contract and permissions never depend on which
 * model executes it.
 *
 * The model comes from the owner-approved model policy through the role's preference REFERENCE. A
 * fallback is a STATIC substitution declared in that policy and used only when the primary is
 * unavailable — never a runtime routing decision. Eligibility is held per role AND evaluated model, so
 * a fallback outside a role's evaluated set is refused for every role, and an unapproved model is
 * refused outright. Every substitution is returned so it can be recorded in the result provenance.
 */
import { isEligibleFor, type EffectiveRole } from './registry.js';
import type { ModelPolicy } from './types.js';

export type ModelResolution =
  | { readonly ok: true; readonly modelRef: string; readonly substitutedFrom: string | null }
  | { readonly ok: false; readonly code: string; readonly reason: string };

function approvedModel(policy: ModelPolicy, ref: string): boolean {
  return policy.models.some((m) => m.ref === ref && m.approved && m.kind === 'fixture');
}

/** Resolve the model a role runs on. `primaryUnavailable` selects the declared fallback, nothing else. */
export function resolveRoleModel(role: EffectiveRole, policy: ModelPolicy, primaryUnavailable = false): ModelResolution {
  if (role.modelPreference === null) {
    return { ok: false, code: 'NO_MODEL_PREFERENCE', reason: `role '${role.id}' has no ProjectOS model preference, so it cannot run` };
  }
  const pref = Object.prototype.hasOwnProperty.call(policy.preferences, role.modelPreference) ? policy.preferences[role.modelPreference] : undefined;
  if (pref === undefined) return { ok: false, code: 'UNKNOWN_MODEL_PREFERENCE', reason: `'${role.modelPreference}' is not in the model policy` };
  const target = primaryUnavailable ? pref.fallback : pref.primary;
  if (target === null) return { ok: false, code: 'NO_FALLBACK', reason: `'${role.modelPreference}' declares no fallback model` };
  if (!approvedModel(policy, target)) return { ok: false, code: 'UNAPPROVED_MODEL', reason: `model '${target}' is not approved by the model policy` };
  if (!isEligibleFor(role.entry, target)) {
    return { ok: false, code: 'NOT_ELIGIBLE_FOR_MODEL', reason: `role '${role.id}' is not eligible on model '${target}' (evaluated: ${role.entry.eligibility.models.join(', ') || 'none'})` };
  }
  return { ok: true, modelRef: target, substitutedFrom: primaryUnavailable ? pref.primary : null };
}

/** The leader's model: approved by the policy. The leader is a ProjectOS role, not a catalogue agent. */
export function resolveLeaderModel(preference: string, policy: ModelPolicy): ModelResolution {
  const pref = Object.prototype.hasOwnProperty.call(policy.preferences, preference) ? policy.preferences[preference] : undefined;
  if (pref === undefined) return { ok: false, code: 'UNKNOWN_MODEL_PREFERENCE', reason: `'${preference}' is not in the model policy` };
  if (!approvedModel(policy, pref.primary)) return { ok: false, code: 'UNAPPROVED_MODEL', reason: `model '${pref.primary}' is not approved` };
  return { ok: true, modelRef: pref.primary, substitutedFrom: null };
}
