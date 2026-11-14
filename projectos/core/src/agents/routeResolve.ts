// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/routing/resolve-route.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the order in which a route is chosen is taken (peer, parent peer, wildcard peer, guild with roles, guild, team, account, channel, default); the config object, the evaluated-bindings cache and its index, the logging, the audit listing and the legacy agent id are cut; the route is chosen inside the tenant and project of a derived binding, over an agent book keyed by tenant and project, so a binding for another tenant is refused and an agent this tenant does not hold is refused instead of choosing another; a refusal is a result, not a throw
// Notice: full licence text in THIRD_PARTY_NOTICES

import { isDerivedBinding, type TenantBinding } from '../tenant.js';
import { findAgent, isAgentBook, type AgentBook } from './agentBook.js';
import { normalizeRouteBindingId, routeBindingScopeMatches } from './bindingScope.js';
import { MAX_ROUTE_BINDINGS } from './delegationLimits.js';
import { isAdmittedRouteBinding, type RouteBinding } from './routeBinding.js';
import { buildAgentSessionKey, normalizeAccountId, normalizeAgentId, normalizeChannelId, normalizePeer, type PeerKind, type RoutePeer } from './sessionKey.js';

export type RouteMatchedBy =
  | 'binding.peer'
  | 'binding.peer.parent'
  | 'binding.peer.wildcard'
  | 'binding.guild+roles'
  | 'binding.guild'
  | 'binding.team'
  | 'binding.account'
  | 'binding.channel'
  | 'default';

/** What a message says about where it came from. It names no tenant: the tenant is the binding's. */
export interface RouteInput {
  readonly channel: unknown;
  readonly accountId?: unknown;
  readonly peer?: unknown;
  /** The parent peer of a thread, used when the peer itself matches no binding. */
  readonly parentPeer?: unknown;
  readonly guildId?: unknown;
  readonly teamId?: unknown;
  readonly memberRoleIds?: readonly string[];
  readonly defaultAgentId?: unknown;
}

export type RouteCode =
  | 'ROUTE_TENANT'
  | 'ROUTE_BOOK'
  | 'ROUTE_INPUT'
  | 'ROUTE_TOO_MANY_BINDINGS'
  | 'ROUTE_BINDING_SCOPE'
  | 'ROUTE_AGENT_NOT_IN_TENANT'
  | 'ROUTE_NONE';

export interface ResolvedRoute {
  readonly agentId: string;
  readonly channel: string;
  readonly accountId: string;
  /** Keyed on the tenant and the project, so the same agent and peer in another tenant is another session. */
  readonly sessionKey: string;
  readonly matchedBy: RouteMatchedBy;
}

export type RouteResult =
  | { readonly ok: true; readonly route: ResolvedRoute }
  | { readonly ok: false; readonly code: RouteCode; readonly message: string };

type Tier = Exclude<RouteMatchedBy, 'default'>;

interface Scope {
  readonly peer: RoutePeer | null;
  readonly guildId: string;
  readonly teamId: string;
  readonly memberRoleIds: readonly string[];
}

const fail = (code: RouteCode, message: string): RouteResult => ({ ok: false, code, message });

// Routing treats group and channel peers as compatible because several chat platforms expose broadcast-like group spaces
// with either label.
function peerKindMatches(bindingKind: PeerKind, scopeKind: PeerKind): boolean {
  return bindingKind === scopeKind || (bindingKind === 'group' && scopeKind === 'channel') || (bindingKind === 'channel' && scopeKind === 'group');
}

/** The one tier a binding belongs to, by its most specific field. */
function tierOf(binding: RouteBinding): Tier {
  const { peer, guildId, roles, teamId, accountPattern } = binding.match;
  if (peer.state === 'valid') return 'binding.peer';
  if (peer.state === 'wildcard-kind') return 'binding.peer.wildcard';
  if (guildId !== null && roles !== null) return 'binding.guild+roles';
  if (guildId !== null) return 'binding.guild';
  if (teamId !== null) return 'binding.team';
  return accountPattern !== '*' ? 'binding.account' : 'binding.channel';
}

function matchesBindingScope(binding: RouteBinding, scope: Scope): boolean {
  const { peer } = binding.match;
  if (peer.state === 'valid' && (scope.peer === null || !peerKindMatches(peer.kind, scope.peer.kind) || scope.peer.id !== peer.id)) return false;
  if (peer.state === 'wildcard-kind' && (scope.peer === null || !peerKindMatches(peer.kind, scope.peer.kind))) return false;
  return routeBindingScopeMatches(binding.match, scope);
}

/** The binding this tier would choose, in the order the bindings were written; `undefined` when none. */
function chooseFrom(candidates: readonly RouteBinding[], tier: Tier, scope: Scope): RouteBinding | undefined {
  return candidates.find((binding) => {
    if (tierOf(binding) !== tier) return false;
    const { guildId, teamId } = binding.match;
    if ((tier === 'binding.guild' || tier === 'binding.guild+roles') && guildId !== scope.guildId) return false;
    if (tier === 'binding.team' && teamId !== scope.teamId) return false;
    return matchesBindingScope(binding, scope);
  });
}

function inputOf(input: RouteInput) {
  const channel = normalizeChannelId(input.channel);
  const accountId = normalizeAccountId(input.accountId);
  const peer = input.peer === undefined || input.peer === null ? null : normalizePeer(input.peer);
  const parentPeer = input.parentPeer === undefined || input.parentPeer === null ? null : normalizePeer(input.parentPeer);
  const defaultAgentId = input.defaultAgentId === undefined || input.defaultAgentId === null ? null : normalizeAgentId(input.defaultAgentId);
  const roles = input.memberRoleIds;
  const rolesOk = roles === undefined || (Array.isArray(roles) && (roles as readonly unknown[]).every((role) => typeof role === 'string'));
  const peerGiven = input.peer !== undefined && input.peer !== null;
  const parentGiven = input.parentPeer !== undefined && input.parentPeer !== null;
  const defaultGiven = input.defaultAgentId !== undefined && input.defaultAgentId !== null;
  const usable = channel !== null && accountId !== null && rolesOk && !(peerGiven && peer === null) && !(parentGiven && parentPeer === null) && !(defaultGiven && defaultAgentId === null);
  return usable
    ? { channel, accountId, peer, parentPeer, defaultAgentId, scope: { peer, guildId: normalizeRouteBindingId(input.guildId), teamId: normalizeRouteBindingId(input.teamId), memberRoleIds: roles ?? [] } }
    : null;
}

/**
 * Choose the agent for a message, inside the tenant and project of `tenantBinding`.
 *
 * Every binding is read first: one that was not admitted, or was admitted for another tenant or project, refuses the whole
 * call, so a stray binding is found and not quietly skipped. The chosen agent must be one this tenant and project hold. A
 * binding that names an agent they do not hold is refused, and no other agent is chosen in its place.
 */
export function resolveAgentRoute(input: RouteInput, book: AgentBook, bindings: readonly RouteBinding[], tenantBinding: TenantBinding): RouteResult {
  if (!isDerivedBinding(tenantBinding)) return fail('ROUTE_TENANT', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  if (!isAgentBook(book)) return fail('ROUTE_BOOK', 'the agent book was not built by this module');
  if (!Array.isArray(bindings) || bindings.length > MAX_ROUTE_BINDINGS) return fail('ROUTE_TOO_MANY_BINDINGS', `at most ${MAX_ROUTE_BINDINGS} bindings are read; a longer list is refused, not read in part`);
  const foreign = bindings.find((binding) => !isAdmittedRouteBinding(binding) || binding.tenant !== tenantBinding.tenant || binding.project !== tenantBinding.projectId);
  if (foreign !== undefined) return fail('ROUTE_BINDING_SCOPE', 'a route binding was not admitted for this tenant and project');
  const read = inputOf(input);
  if (read === null) return fail('ROUTE_INPUT', 'the channel, account, peer or default agent of the message is not usable');

  const here = bindings.filter(
    ({ match }) => match.channel === read.channel && (match.accountPattern === '*' || (normalizeAccountId(match.accountPattern) as string) === read.accountId),
  );
  const parent = read.parentPeer;
  const chosen: readonly (readonly [Tier, RouteBinding | undefined])[] = [
    ['binding.peer', read.peer === null ? undefined : chooseFrom(here, 'binding.peer', read.scope)],
    ['binding.peer.parent', parent === null ? undefined : chooseFrom(here, 'binding.peer', { ...read.scope, peer: parent })],
    ['binding.peer.wildcard', read.peer === null ? undefined : chooseFrom(here, 'binding.peer.wildcard', read.scope)],
    ['binding.guild+roles', read.scope.guildId !== '' && read.scope.memberRoleIds.length > 0 ? chooseFrom(here, 'binding.guild+roles', read.scope) : undefined],
    ['binding.guild', read.scope.guildId !== '' ? chooseFrom(here, 'binding.guild', read.scope) : undefined],
    ['binding.team', read.scope.teamId !== '' ? chooseFrom(here, 'binding.team', read.scope) : undefined],
    ['binding.account', chooseFrom(here, 'binding.account', read.scope)],
    ['binding.channel', chooseFrom(here, 'binding.channel', read.scope)],
  ];
  const hit = chosen.find(([, binding]) => binding !== undefined);
  const agentId = hit !== undefined ? (hit[1] as RouteBinding).agentId : read.defaultAgentId;
  if (agentId === null) return fail('ROUTE_NONE', 'no binding matches this message, and no default agent was named');
  if (findAgent(book, tenantBinding.tenant, tenantBinding.projectId, agentId) === null) {
    return fail('ROUTE_AGENT_NOT_IN_TENANT', 'the agent this route names is not held by this tenant and project');
  }
  const key = buildAgentSessionKey(tenantBinding, { agentId, channel: read.channel, accountId: read.accountId, peer: read.peer });
  if (!key.ok) return fail('ROUTE_INPUT', key.reason);
  return { ok: true, route: { agentId, channel: read.channel, accountId: read.accountId, sessionKey: key.key, matchedBy: hit !== undefined ? hit[0] : 'default' } };
}
