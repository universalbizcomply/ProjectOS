// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/routing/binding-scope.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: DIRECT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the scope test is taken (guild, team, group space and roles); the channel and account normalisers and the binding-match reader are cut because the binding is admitted by routeBinding.ts, and an iterable of member roles is read once into a set whose size is bounded
// Notice: full licence text in THIRD_PARTY_NOTICES

/** The most member roles read from one request. A longer list is read in part, which can only make a role binding match less. */
const MAX_MEMBER_ROLES = 256;

export function normalizeRouteBindingId(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value).trim();
  }
  return '';
}

export function normalizeRouteBindingRoles(value: readonly string[] | null | undefined): readonly string[] | null {
  return Array.isArray(value) && value.length > 0 ? value : null;
}

function memberRoleSet(memberRoleIds: Iterable<string> | null | undefined): ReadonlySet<string> {
  const roles = new Set<string>();
  if (!memberRoleIds) return roles;
  for (const role of memberRoleIds) {
    if (roles.size >= MAX_MEMBER_ROLES) break;
    roles.add(role);
  }
  return roles;
}

// A binding's scope constrains it to a guild, team, group space, and optionally platform role ids.
export function routeBindingScopeMatches(
  constraint: {
    readonly guildId?: string | null;
    readonly teamId?: string | null;
    readonly roles?: readonly string[] | null;
  },
  scope: {
    readonly guildId?: string | null;
    readonly teamId?: string | null;
    readonly groupSpace?: string | null;
    readonly memberRoleIds?: Iterable<string> | null;
  },
): boolean {
  const guildId = normalizeRouteBindingId(scope.guildId);
  const teamId = normalizeRouteBindingId(scope.teamId);
  const groupSpace = normalizeRouteBindingId(scope.groupSpace);
  if (constraint.guildId && constraint.guildId !== guildId && constraint.guildId !== groupSpace) {
    return false;
  }
  if (constraint.teamId && constraint.teamId !== teamId && constraint.teamId !== groupSpace) {
    return false;
  }

  const roles = normalizeRouteBindingRoles(constraint.roles);
  if (!roles) {
    return true;
  }
  const members = memberRoleSet(scope.memberRoleIds);
  return roles.some((role) => members.has(role));
}
