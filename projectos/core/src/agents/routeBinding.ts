// Origin: original ProjectOS code
/**
 * A route binding: which agent serves which channel, account, peer, guild, team and roles, inside one tenant and project.
 *
 * A BINDING NAMES NO TENANT. `tenant` and `project` are stamped from a binding only `resolveTenant` can produce; a binding
 * that carries a `tenant`, `project` or `domain` of its own is refused as a whole, so a route cannot say whose it is. The
 * result is frozen and remembered by this module, so a copy built by hand, with every field right, is not an admitted
 * binding and routes nothing.
 *
 * AN UNUSABLE CONSTRAINT IS REFUSED, NOT SKIPPED. The source drops a binding whose peer cannot match and carries on. Here a
 * peer with an unknown kind or an id that is not a plain word refuses the binding when it is read, so a typo is found when
 * the binding is written and not when a message goes to the wrong agent.
 *
 * Pure: no I/O.
 */
import { isDerivedBinding, type TenantBinding } from '../tenant.js';
import { normalizeRouteBindingId } from './bindingScope.js';
import { normalizeAccountId, normalizeAgentId, normalizeChannelId, normalizePeer, PEER_KINDS, type PeerKind } from './sessionKey.js';
import { snapshotOf } from './plainRecords.js';

export type RouteBindingCode = 'ROUTE_BINDING_SHAPE' | 'ROUTE_BINDING_SCOPE';

export type PeerConstraint =
  | { readonly state: 'none' }
  | { readonly state: 'wildcard-kind'; readonly kind: PeerKind }
  | { readonly state: 'valid'; readonly kind: PeerKind; readonly id: string };

export interface RouteBindingMatch {
  readonly channel: string;
  /** `*` for any account, otherwise the one account; a binding that names none serves the default account only. */
  readonly accountPattern: string;
  readonly peer: PeerConstraint;
  readonly guildId: string | null;
  readonly teamId: string | null;
  readonly roles: readonly string[] | null;
}

export interface RouteBinding {
  readonly tenant: string;
  readonly project: string;
  readonly agentId: string;
  readonly match: RouteBindingMatch;
}

export type RouteBindingResult =
  | { readonly ok: true; readonly binding: RouteBinding }
  | { readonly ok: false; readonly code: RouteBindingCode; readonly message: string };

const BINDING_FIELDS = ['agentId', 'match'] as const;
const MATCH_FIELDS = ['channel', 'accountId', 'peer', 'guildId', 'teamId', 'roles'] as const;
const MAX_ROLES = 32;
const MAX_ROLE_CHARS = 64;
const MAX_SCOPE_ID_CHARS = 128;

const ADMITTED = new WeakSet<object>();

/** Did the reader admit this binding? A copy of one, built by hand, was not admitted. */
export function isAdmittedRouteBinding(value: unknown): value is RouteBinding {
  return typeof value === 'object' && value !== null && ADMITTED.has(value);
}

const no = (code: RouteBindingCode, message: string): RouteBindingResult => ({ ok: false, code, message });

function peerOf(raw: unknown): PeerConstraint | null {
  if (raw === undefined) return { state: 'none' };
  const fields = snapshotOf(raw, ['kind', 'id']);
  if (fields === null || typeof fields['kind'] !== 'string' || !(PEER_KINDS as readonly string[]).includes(fields['kind'])) return null;
  const kind = fields['kind'] as PeerKind;
  if (fields['id'] === '*') return { state: 'wildcard-kind', kind };
  const peer = normalizePeer({ kind, id: fields['id'] });
  return peer === null ? null : { state: 'valid', kind: peer.kind, id: peer.id };
}

function scopeIdOf(raw: unknown): string | null | undefined {
  if (raw === undefined) return null;
  const id = normalizeRouteBindingId(raw);
  return id === '' || id.length > MAX_SCOPE_ID_CHARS ? undefined : id;
}

function rolesOf(raw: unknown): readonly string[] | null | undefined {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length > MAX_ROLES) return undefined;
  const roles = (raw as readonly unknown[]).every((role) => typeof role === 'string' && role.trim() !== '' && role.length <= MAX_ROLE_CHARS)
    ? Object.freeze((raw as readonly string[]).map((role) => role.trim()))
    : undefined;
  return roles === undefined ? undefined : roles.length === 0 ? null : roles;
}

/** Read one binding from parsed JSON for the checkout `binding` names, and admit it or refuse it. */
export function admitRouteBinding(raw: unknown, binding: TenantBinding): RouteBindingResult {
  if (!isDerivedBinding(binding)) return no('ROUTE_BINDING_SCOPE', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  const fields = snapshotOf(raw, BINDING_FIELDS);
  if (fields === null) return no('ROUTE_BINDING_SHAPE', 'a route binding is an agent id and a match, as plain fields, with no tenant and no project');
  const agentId = normalizeAgentId(fields['agentId']);
  const match = snapshotOf(fields['match'], MATCH_FIELDS);
  if (agentId === null || match === null) return no('ROUTE_BINDING_SHAPE', 'a route binding needs one plain agent id and a match of fields this reader knows');
  const channel = normalizeChannelId(match['channel']);
  const account = match['accountId'];
  const accountPattern = account === undefined ? '' : account === '*' ? '*' : normalizeAccountId(account);
  const peer = peerOf(match['peer']);
  const guildId = scopeIdOf(match['guildId']);
  const teamId = scopeIdOf(match['teamId']);
  const roles = rolesOf(match['roles']);
  if (channel === null || accountPattern === null || peer === null || guildId === undefined || teamId === undefined || roles === undefined) {
    return no('ROUTE_BINDING_SHAPE', 'the match needs a plain channel, and any account, peer, guild, team or roles it names must be usable');
  }
  const admitted: RouteBinding = Object.freeze({
    tenant: binding.tenant,
    project: binding.projectId,
    agentId,
    match: Object.freeze({ channel, accountPattern, peer: Object.freeze(peer), guildId, teamId, roles }),
  });
  ADMITTED.add(admitted);
  return { ok: true, binding: admitted };
}
