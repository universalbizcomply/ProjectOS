import { describe, expect, it } from 'vitest';
import {
  MAX_ROUTE_BINDINGS,
  admitRouteBinding,
  buildAgentSessionKey,
  normalizeAccountId,
  normalizeAgentId,
  parseAgentSessionKey,
  resolveAgentRoute,
  routeBindingScopeMatches,
  sessionKeyInScope,
  type RouteBinding,
} from '../src/agents/index.js';
import type { TenantBinding } from '../src/tenant.js';
import { agency, bookOf, polygo, projectos } from './agents-support.js';

function binding(tenantBinding: TenantBinding, agentId: string, match: Record<string, unknown>): RouteBinding {
  const result = admitRouteBinding({ agentId, match }, tenantBinding);
  if (!result.ok) throw new Error(`the control binding was refused: ${result.code}`);
  return result.binding;
}

const agents = (tenantBinding: TenantBinding) =>
  bookOf(
    tenantBinding,
    ['main', 'support', 'sales', 'guild-a', 'team-a', 'acct', 'chan', 'wild', 'parent', 'peer'].map((agentId) => ({ recordId: `AGT-${agentId}`, agentId })),
  );

describe('a session key carries the tenant and the project', () => {
  it('builds a key that names tenant, project, agent, channel, account and peer', () => {
    const key = buildAgentSessionKey(polygo(), { agentId: 'main', channel: 'telegram', accountId: 'bot1', peer: { kind: 'direct', id: 'U123' } });
    expect(key).toEqual({ ok: true, key: 'tenant:owner-personal:project:polygo:agent:main:telegram:bot1:direct:u123' });
  });

  it('gives the same agent and the same peer another key in another tenant, and in another project', () => {
    const parts = { agentId: 'main', channel: 'telegram', peer: { kind: 'direct' as const, id: 'u1' } };
    const keys = [polygo(), projectos(), agency()].map((b) => {
      const built = buildAgentSessionKey(b, parts);
      return built.ok ? built.key : 'refused';
    });
    expect(new Set(keys).size).toBe(3);
  });

  it('keeps one session per direct peer, never one shared by every peer', () => {
    const a = buildAgentSessionKey(polygo(), { agentId: 'main', channel: 'telegram', peer: { kind: 'direct', id: 'u1' } });
    const b = buildAgentSessionKey(polygo(), { agentId: 'main', channel: 'telegram', peer: { kind: 'direct', id: 'u2' } });
    expect(a).not.toEqual(b);
  });

  it('refuses a part that holds a colon, so no part can forge another tenant prefix', () => {
    const forged = buildAgentSessionKey(polygo(), { agentId: 'main', channel: 'telegram', peer: { kind: 'direct', id: 'x:tenant:agency-business' } });
    expect(forged).toMatchObject({ ok: false });
    expect(buildAgentSessionKey(polygo(), { agentId: 'a:b', channel: 'telegram' })).toMatchObject({ ok: false });
    expect(buildAgentSessionKey(polygo(), { agentId: 'main', channel: 'tele:gram' })).toMatchObject({ ok: false });
  });

  it('refuses a binding that resolveTenant did not produce', () => {
    expect(buildAgentSessionKey({ ...polygo() }, { agentId: 'main', channel: 'telegram' })).toMatchObject({ ok: false });
  });

  it('parses a key back, and checks whether a key belongs to a scope', () => {
    const built = buildAgentSessionKey(polygo(), { agentId: 'main', channel: 'telegram', peer: { kind: 'group', id: 'g1' } });
    if (!built.ok) throw new Error('control key refused');
    expect(parseAgentSessionKey(built.key)).toMatchObject({ tenant: 'owner-personal', project: 'polygo', agentId: 'main' });
    expect(sessionKeyInScope(built.key, polygo())).toBe(true);
    expect(sessionKeyInScope(built.key, projectos())).toBe(false);
    expect(sessionKeyInScope(built.key, agency())).toBe(false);
    expect(parseAgentSessionKey('agent:main:telegram')).toBeNull();
  });

  it('normalizes an agent id and refuses what is not one', () => {
    expect(normalizeAgentId('  Main ')).toBe('main');
    expect(normalizeAgentId('a b')).toBeNull();
    expect(normalizeAgentId('')).toBeNull();
    expect(normalizeAgentId(42)).toBeNull();
  });

  it('answers the default account for no account, and refuses an account that is not one', () => {
    expect(normalizeAccountId(undefined)).toBe('default');
    expect(normalizeAccountId('  ')).toBe('default');
    expect(normalizeAccountId('Bot1')).toBe('bot1');
    expect(normalizeAccountId('a:b')).toBeNull();
  });
});

describe('a route binding names no tenant', () => {
  it('admits a binding and stamps it with the derived scope', () => {
    const result = admitRouteBinding({ agentId: 'main', match: { channel: 'telegram' } }, polygo());
    expect(result).toMatchObject({ ok: true, binding: { tenant: 'owner-personal', project: 'polygo', agentId: 'main' } });
  });

  it('refuses a tenant, project or domain written into the binding', () => {
    for (const field of ['tenant', 'project', 'domain']) {
      expect(admitRouteBinding({ agentId: 'main', [field]: 'agency-business', match: { channel: 'telegram' } }, polygo())).toMatchObject({ ok: false, code: 'ROUTE_BINDING_SHAPE' });
    }
  });

  it('refuses a match with a field it does not know, a missing channel or an unusable peer', () => {
    expect(admitRouteBinding({ agentId: 'main', match: { channel: 'telegram', tenantId: 'x' } }, polygo())).toMatchObject({ ok: false });
    expect(admitRouteBinding({ agentId: 'main', match: {} }, polygo())).toMatchObject({ ok: false });
    expect(admitRouteBinding({ agentId: 'main', match: { channel: 'telegram', peer: { kind: 'direct', id: '' } } }, polygo())).toMatchObject({ ok: false });
    expect(admitRouteBinding({ agentId: 'main', match: { channel: 'telegram', peer: { kind: 'bogus', id: 'x' } } }, polygo())).toMatchObject({ ok: false });
  });

  it('refuses a binding that resolveTenant did not produce', () => {
    expect(admitRouteBinding({ agentId: 'main', match: { channel: 'telegram' } }, { ...polygo() })).toMatchObject({ ok: false, code: 'ROUTE_BINDING_SCOPE' });
  });
});

describe('the scope of a binding: guild, team and roles', () => {
  it('matches when the constraint names nothing', () => {
    expect(routeBindingScopeMatches({}, {})).toBe(true);
  });

  it('refuses a different guild or team, and accepts the same one', () => {
    expect(routeBindingScopeMatches({ guildId: 'g1' }, { guildId: 'g2' })).toBe(false);
    expect(routeBindingScopeMatches({ guildId: 'g1' }, { guildId: 'g1' })).toBe(true);
    expect(routeBindingScopeMatches({ teamId: 't1' }, { teamId: 't2' })).toBe(false);
  });

  it('needs one of the named roles when roles are named', () => {
    expect(routeBindingScopeMatches({ roles: ['admin'] }, { memberRoleIds: ['user'] })).toBe(false);
    expect(routeBindingScopeMatches({ roles: ['admin'] }, { memberRoleIds: ['user', 'admin'] })).toBe(true);
    expect(routeBindingScopeMatches({ roles: ['admin'] }, {})).toBe(false);
  });
});

describe('routing, in the order the source states', () => {
  const home = polygo();
  const book = agents(home);
  const resolve = (bindings: readonly RouteBinding[], input: Record<string, unknown>, tenantBinding: TenantBinding = home, held = book) =>
    resolveAgentRoute({ channel: 'telegram', ...input }, held, bindings, tenantBinding);
  const agentOf = (result: ReturnType<typeof resolve>) => (result.ok ? `${result.route.agentId}/${result.route.matchedBy}` : result.code);

  it('prefers the peer binding over the channel binding', () => {
    const bindings = [binding(home, 'chan', { channel: 'telegram', accountId: '*' }), binding(home, 'peer', { channel: 'telegram', peer: { kind: 'direct', id: 'u1' } })];
    expect(agentOf(resolve(bindings, { peer: { kind: 'direct', id: 'u1' } }))).toBe('peer/binding.peer');
  });

  it('falls to the parent peer, then a wildcard peer of the kind', () => {
    const bindings = [binding(home, 'wild', { channel: 'telegram', peer: { kind: 'group', id: '*' } }), binding(home, 'parent', { channel: 'telegram', peer: { kind: 'group', id: 'g9' } })];
    expect(agentOf(resolve(bindings, { peer: { kind: 'group', id: 'thread-1' }, parentPeer: { kind: 'group', id: 'g9' } }))).toBe('parent/binding.peer.parent');
    expect(agentOf(resolve(bindings, { peer: { kind: 'group', id: 'thread-1' } }))).toBe('wild/binding.peer.wildcard');
  });

  it('treats a group and a channel peer as the same kind, as the source does', () => {
    const bindings = [binding(home, 'peer', { channel: 'telegram', peer: { kind: 'group', id: 'g1' } })];
    expect(agentOf(resolve(bindings, { peer: { kind: 'channel', id: 'g1' } }))).toBe('peer/binding.peer');
  });

  it('then the guild with roles, the guild, the team, the account and the channel', () => {
    const bindings = [
      binding(home, 'chan', { channel: 'telegram', accountId: '*' }),
      binding(home, 'acct', { channel: 'telegram', accountId: 'bot1' }),
      binding(home, 'team-a', { channel: 'telegram', teamId: 't1' }),
      binding(home, 'guild-a', { channel: 'telegram', guildId: 'g1' }),
      binding(home, 'sales', { channel: 'telegram', guildId: 'g1', roles: ['vip'] }),
    ];
    expect(agentOf(resolve(bindings, { guildId: 'g1', memberRoleIds: ['vip'] }))).toBe('sales/binding.guild+roles');
    expect(agentOf(resolve(bindings, { guildId: 'g1' }))).toBe('guild-a/binding.guild');
    expect(agentOf(resolve(bindings, { teamId: 't1' }))).toBe('team-a/binding.team');
    expect(agentOf(resolve(bindings, { accountId: 'bot1' }))).toBe('acct/binding.account');
    expect(agentOf(resolve(bindings, { accountId: 'other' }))).toBe('chan/binding.channel');
  });

  it('uses the default agent only when it exists in this tenant and project, else refuses', () => {
    expect(agentOf(resolve([], { defaultAgentId: 'main' }))).toBe('main/default');
    expect(agentOf(resolve([], { defaultAgentId: 'ghost' }))).toBe('ROUTE_AGENT_NOT_IN_TENANT');
    expect(agentOf(resolve([], {}))).toBe('ROUTE_NONE');
  });

  it('refuses a binding for an agent this tenant does not hold, rather than choosing another', () => {
    const bindings = [binding(home, 'ghost', { channel: 'telegram' })];
    expect(agentOf(resolve(bindings, { defaultAgentId: 'main' }))).toBe('ROUTE_AGENT_NOT_IN_TENANT');
  });

  it('refuses a binding admitted for another tenant or project, never routing through it', () => {
    const foreign = binding(agency(), 'main', { channel: 'telegram' });
    const sibling = binding(projectos(), 'main', { channel: 'telegram' });
    expect(agentOf(resolve([foreign], { defaultAgentId: 'main' }))).toBe('ROUTE_BINDING_SCOPE');
    expect(agentOf(resolve([sibling], { defaultAgentId: 'main' }))).toBe('ROUTE_BINDING_SCOPE');
  });

  it('does not find another tenant\'s agent even when the same name is held there', () => {
    const other = agency();
    const held = bookOf(other, [{ recordId: 'AGT-agency-only', agentId: 'agency-only' }]);
    expect(agentOf(resolve([binding(home, 'agency-only', { channel: 'telegram' })], {}, home, held))).toBe('ROUTE_AGENT_NOT_IN_TENANT');
  });

  it('refuses a binding that was only shaped by hand', () => {
    const forged = { tenant: home.tenant, project: home.projectId, agentId: 'main', match: { channel: 'telegram', accountPattern: '', peer: { state: 'none' }, guildId: null, teamId: null, roles: null } };
    expect(agentOf(resolve([forged as unknown as RouteBinding], {}))).toBe('ROUTE_BINDING_SCOPE');
  });

  it('keys the session of the route on the tenant and project of the binding', () => {
    const result = resolve([binding(home, 'main', { channel: 'telegram' })], { peer: { kind: 'direct', id: 'u1' } });
    expect(result.ok && result.route.sessionKey).toBe('tenant:owner-personal:project:polygo:agent:main:telegram:default:direct:u1');
  });

  it('reads no tenant from the input: a tenant written into the input changes nothing', () => {
    const result = resolve([binding(home, 'main', { channel: 'telegram' })], { tenant: 'agency-business', project: 'seo-agency' });
    expect(result.ok && result.route.sessionKey.startsWith('tenant:owner-personal:project:polygo:')).toBe(true);
  });

  it('refuses an input that is not usable: a channel that is not one, or a peer with no id', () => {
    expect(agentOf(resolve([], { channel: 'a:b' }))).toBe('ROUTE_INPUT');
    expect(agentOf(resolve([], { peer: { kind: 'direct', id: '' } }))).toBe('ROUTE_INPUT');
  });

  it('refuses a list of bindings past the cap rather than reading part of it', () => {
    const one = binding(home, 'main', { channel: 'telegram' });
    const many = Array.from({ length: MAX_ROUTE_BINDINGS + 1 }, () => one);
    expect(agentOf(resolve(many, {}))).toBe('ROUTE_TOO_MANY_BINDINGS');
  });
});
