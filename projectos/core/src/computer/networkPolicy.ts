// SPDX-License-Identifier: MIT
// Ported-From: copilotkit-openbot https://github.com/CopilotKit/OpenBot
// Source-Path: server/src/computer/policy-network.ts
// Source-Commit: c396a5f68c817043846f1ca3c2b42061ee73ceb5
// Source-Copyright: Copyright (c) 2026 CopilotKit
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the choice of which network policy applies is taken, the capability switch that denies all, an organization row, a group row that replaces the organization row unless it is locked, and a stored row that no longer reads being refused whole; the push to running computers, the wake hook, the web-bot key, the fetch calls and the egress matcher import are cut; this file differs from the earlier pin and was reviewed in this phase; the absence of any organization row now means deny all, where the source left the computer as it was, which is allow all; allow all is not a mode here; every row is keyed by tenant and project and a row of another scope refuses the whole answer
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * Which hosts a computer may reach: deny all unless a row says otherwise.
 *
 * NO ROW IS NO NETWORK. The source reads "no organization row" as `allow_all`, which is a computer with no network policy
 * at all. Here the absence of a row, a capability that is off, a row that does not read, a row asking for a mode this module
 * does not know and a row of another tenant or project are all `deny_all`. There is no `allow_all`.
 *
 * AN ADDRESS IS NOT A HOST. A rule is a host name, exact or `*.suffix`, in ASCII letters, digits, hyphens and dots. An IP
 * literal, `localhost` written as an address and every host this module cannot read completely are never allowed, so a rule
 * cannot be written that reaches a metadata address or a private network by number.
 *
 * WHAT THIS MODULE CANNOT PROVE. A host name that resolves to a private address is the egress layer's to refuse at connection
 * time, not a name check's. Nothing here opens a connection.
 *
 * Pure: no I/O.
 */
import { isDerivedBinding, type TenantBinding } from '../tenant.js';
import { canonicalHost } from './actionContext.js';
import { snapshotOfArray, snapshotOfFields } from './plainFields.js';

export const MAX_EGRESS_RULES = 64;
export const NETWORK_MODES = ['deny_all', 'allowlist_only'] as const;
export type NetworkMode = (typeof NETWORK_MODES)[number];

export interface NetworkPolicyRow {
  readonly tenant: string;
  readonly project: string;
  readonly scopeKind: 'organization' | 'group';
  readonly scopeId: string;
  readonly mode: string;
  readonly rules: unknown;
  readonly locked: boolean;
}

export interface EffectiveNetworkPolicy {
  readonly mode: NetworkMode;
  /** Host patterns, only for `allowlist_only`. */
  readonly rules: readonly string[];
  readonly from: string;
}

const HOST_RULE = /^(?:\*\.)?[a-z0-9.-]{1,253}$/;
/** Policies this module made. A value of the same shape built by hand is not one. */
const MINTED = new WeakSet<object>();
const mint = (mode: NetworkMode, rules: readonly string[], from: string): EffectiveNetworkPolicy => {
  const policy: EffectiveNetworkPolicy = Object.freeze({ mode, rules, from });
  MINTED.add(policy);
  return policy;
};
const DENY = (from: string): EffectiveNetworkPolicy => mint('deny_all', Object.freeze([]), from);

/** The rule list of a row, or `null` when it does not read completely. */
function parseEgressRules(raw: unknown): readonly string[] | null {
  const list = snapshotOfArray(raw, MAX_EGRESS_RULES);
  if (list === null) return null;
  const rules: string[] = [];
  for (const item of list) {
    const fields = snapshotOfFields(item, ['host']);
    const host = fields === null ? null : fields['host'];
    if (typeof host !== 'string' || !HOST_RULE.test(host)) return null;
    const bare = host.startsWith('*.') ? host.slice(2) : host;
    if (canonicalHost(bare) !== bare) return null;
    rules.push(host);
  }
  return Object.freeze(rules);
}

/** A stored row that no longer reads is refused whole and denies, as the source does with an empty allowlist. */
function policyOf(row: NetworkPolicyRow, from: string): EffectiveNetworkPolicy {
  if (row.mode !== 'allowlist_only') return DENY(`${from}:refused`);
  const rules = parseEgressRules(row.rules);
  return rules === null ? DENY(`${from}:refused`) : mint('allowlist_only', rules, from);
}

const isRow = (row: unknown): row is NetworkPolicyRow => typeof row === 'object' && row !== null;

/**
 * The network policy that applies to a member of a project: the capability first, then the group row unless the
 * organization row is locked, then the organization row, and deny all when there is none.
 */
export function effectiveNetworkPolicy(
  binding: TenantBinding,
  rows: readonly NetworkPolicyRow[],
  member: { readonly groups: readonly string[] },
  cloudNetworkAllowed: boolean,
): EffectiveNetworkPolicy {
  if (!isDerivedBinding(binding)) return DENY('no-binding');
  if (cloudNetworkAllowed !== true) return DENY('capability');
  if (!Array.isArray(rows) || rows.some((row) => !isRow(row) || row.tenant !== binding.tenant || row.project !== binding.projectId)) return DENY('row-of-another-scope');
  const organization = rows.find((row) => row.scopeKind === 'organization');
  if (organization === undefined || organization.locked !== true) {
    const group = rows
      .filter((row) => row.scopeKind === 'group' && member.groups.includes(row.scopeId))
      .sort((left, right) => (left.scopeId < right.scopeId ? -1 : left.scopeId > right.scopeId ? 1 : 0))[0];
    if (group !== undefined) return policyOf(group, `group:${group.scopeId}`);
  }
  return organization === undefined ? DENY('none') : policyOf(organization, 'organization');
}

/** Whether a host may be reached under a policy. A host this module cannot read completely is never allowed. */
export function egressAllowed(policy: EffectiveNetworkPolicy, host: unknown): boolean {
  if (typeof policy !== 'object' || policy === null || !MINTED.has(policy) || policy.mode !== 'allowlist_only') return false;
  const name = canonicalHost(host);
  if (name === null) return false;
  return policy.rules.some((rule) => (rule.startsWith('*.') ? name.endsWith(rule.slice(1)) && name.length > rule.length - 1 : name === rule));
}
