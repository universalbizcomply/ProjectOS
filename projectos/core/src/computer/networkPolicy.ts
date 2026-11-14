// SPDX-License-Identifier: MIT
// Ported-From: copilotkit-openbot https://github.com/CopilotKit/OpenBot
// Source-Path: server/src/computer/policy-network.ts
// Source-Commit: c396a5f68c817043846f1ca3c2b42061ee73ceb5
// Source-Copyright: Copyright (c) 2026 CopilotKit
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the choice of which network policy applies is taken, the capability switch that denies all, an organization row, a stored row that no longer reads being refused whole; a group row no longer replaces the organization row: every row that applies must allow a host, so a group can only narrow; the push to running computers, the wake hook, the web-bot key, the fetch calls and the egress matcher import are cut; this file differs from the earlier pin and was reviewed in this phase; the absence of any organization row now means deny all, where the source left the computer as it was, which is allow all; allow all is not a mode here; every row is keyed by tenant and project and a row of another scope refuses the whole answer
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * Which hosts a computer may reach: deny all unless a row says otherwise, and a group can only narrow.
 *
 * NO ROW IS NO NETWORK. The source reads "no organization row" as `allow_all`, which is a computer with no network policy
 * at all. Here the absence of a row, a capability that is off, a row that does not read, a row asking for a mode this module
 * does not know, a row whose `locked` is not a boolean, a malformed row and a row of another tenant or project are all
 * `deny_all`. There is no `allow_all`.
 *
 * A GROUP NEVER WIDENS. The source let a group row REPLACE the organization row unless that was locked, and picked the first
 * group by name. Here every row that applies (the organization's and each of the member's groups') must allow a host, so the
 * answer is the most restrictive, does not depend on the order or the names, and a row that is itself denied or refused denies
 * everything. `locked` is still read, and must be a boolean, but a group can no longer replace a row, so it changes nothing.
 *
 * AN ADDRESS IS NOT A HOST. A rule is a host name, exact or `*.suffix`, in ASCII letters, digits, hyphens and dots. An IP
 * literal in any spelling (dotted, hex, octal, decimal, short, IPv6), a name that is local (`localhost`, `*.local`,
 * `*.internal`), and a wildcard with no registrable name behind it (`*.com`, `*.co.uk`, `*.*`) are never a rule and never a host,
 * so a rule cannot be written that reaches a metadata address or a private network by number or opens a whole top level.
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
  /** One host list per applying row. A host is allowed only if every list allows it. */
  readonly layers: readonly (readonly string[])[];
  readonly from: string;
}

const HOST_RULE = /^(?:\*\.)?[a-z0-9.-]{1,253}$/;
/**
 * Suffixes under which strangers hold their own sites: a country second level, or a hosting platform where anyone can register a
 * name. A wildcard on one of these would open every tenant under it, so it is never a rule; an exact host on one (a single site)
 * still is. The list is named and finite, and a suffix missing from it is a residual (see the finish record).
 */
const PUBLIC_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'co.nz', 'co.in', 'co.za', 'com.br', 'com.cn', 'com.mx', 'com.tr',
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'appspot.com',
  'firebaseapp.com', 'web.app', 'fly.dev', 'onrender.com', 'repl.co', 'glitch.me', 'blogspot.com', 's3.amazonaws.com',
]);
const isLocalName = (name: string): boolean => name === 'localhost' || /\.(?:localhost|local|internal|localdomain)$/.test(name);

/** Policies this module made. A value of the same shape built by hand is not one. */
const MINTED = new WeakSet<object>();
const mint = (mode: NetworkMode, layers: readonly (readonly string[])[], from: string): EffectiveNetworkPolicy => {
  const policy: EffectiveNetworkPolicy = Object.freeze({ mode, layers: Object.freeze(layers), from });
  MINTED.add(policy);
  return policy;
};
const DENY = (from: string): EffectiveNetworkPolicy => mint('deny_all', [], from);

/** The rule list of a row, or `null` when it does not read completely. */
function parseEgressRules(raw: unknown): readonly string[] | null {
  const list = snapshotOfArray(raw, MAX_EGRESS_RULES);
  if (list === null) return null;
  const rules: string[] = [];
  for (const item of list) {
    const fields = snapshotOfFields(item, ['host']);
    const host = fields === null ? null : fields['host'];
    if (typeof host !== 'string' || !HOST_RULE.test(host)) return null;
    const wildcard = host.startsWith('*.');
    const bare = wildcard ? host.slice(2) : host;
    if (canonicalHost(bare) !== bare || isLocalName(bare)) return null;
    if (wildcard && (!bare.includes('.') || PUBLIC_SUFFIXES.has(bare))) return null;
    rules.push(host);
  }
  return Object.freeze(rules);
}

/** The rule list of one row, or `null` when the row is denied or does not read. */
function layerOf(row: NetworkPolicyRow): readonly string[] | null {
  return row.mode === 'allowlist_only' ? parseEgressRules(row.rules) : null;
}

type RowRead = { readonly ok: true; readonly row: NetworkPolicyRow } | { readonly ok: false; readonly from: string };

/** A row of this scope that is whole: every field the right kind, `locked` a boolean. Anything else denies everything. */
function readRow(raw: unknown, binding: TenantBinding): RowRead {
  const fields = snapshotOfFields(raw, ['tenant', 'project', 'scopeKind', 'scopeId', 'mode', 'rules', 'locked']);
  if (fields === null) return { ok: false, from: 'row-malformed' };
  if (typeof fields['tenant'] !== 'string' || typeof fields['project'] !== 'string') return { ok: false, from: 'row-malformed' };
  if (fields['tenant'] !== binding.tenant || fields['project'] !== binding.projectId) return { ok: false, from: 'row-of-another-scope' };
  const kind = fields['scopeKind'];
  if ((kind !== 'organization' && kind !== 'group') || typeof fields['scopeId'] !== 'string' || fields['scopeId'] === '' || typeof fields['mode'] !== 'string' || typeof fields['locked'] !== 'boolean') {
    return { ok: false, from: 'row-malformed' };
  }
  return { ok: true, row: fields as unknown as NetworkPolicyRow };
}

/**
 * The network policy that applies to a member of a project: the capability first, then every row that applies (the
 * organization's, and each of the member's groups'), all of which must allow a host, and deny all when there is none.
 */
export function effectiveNetworkPolicy(
  binding: TenantBinding,
  rows: readonly NetworkPolicyRow[],
  member: { readonly groups: readonly string[] },
  cloudNetworkAllowed: boolean,
): EffectiveNetworkPolicy {
  if (!isDerivedBinding(binding)) return DENY('no-binding');
  if (cloudNetworkAllowed !== true) return DENY('capability');
  const list = snapshotOfArray(rows, 1_024);
  if (list === null) return DENY('row-malformed');
  const read: NetworkPolicyRow[] = [];
  for (const raw of list) {
    const result = readRow(raw, binding);
    if (!result.ok) return DENY(result.from);
    read.push(result.row);
  }
  const groups = Array.isArray(member.groups) ? member.groups : [];
  const applying = read.filter((row) => row.scopeKind === 'organization' || groups.includes(row.scopeId));
  if (applying.length === 0) return DENY('none');
  const layers: (readonly string[])[] = [];
  for (const row of applying) {
    const layer = layerOf(row);
    if (layer === null) return DENY(`${row.scopeKind === 'organization' ? 'organization' : `group:${row.scopeId}`}:refused`);
    layers.push(layer);
  }
  return mint('allowlist_only', layers, applying.map((row) => (row.scopeKind === 'organization' ? 'organization' : `group:${row.scopeId}`)).sort().join('+'));
}

const ruleAllows = (rule: string, name: string): boolean => (rule.startsWith('*.') ? name.endsWith(rule.slice(1)) && name.length > rule.length - 1 : name === rule);

/** Whether a host may be reached under a policy. A host this module cannot read completely is never allowed. */
export function egressAllowed(policy: EffectiveNetworkPolicy, host: unknown): boolean {
  if (typeof policy !== 'object' || policy === null || !MINTED.has(policy) || policy.mode !== 'allowlist_only') return false;
  const name = canonicalHost(host);
  if (name === null) return false;
  return policy.layers.length > 0 && policy.layers.every((layer) => layer.some((rule) => ruleAllows(rule, name)));
}
