// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/mcp_tool_scope.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: translated from Python to TypeScript; the owner scope became a tenant, and a key is `tenant/server`; adoption of another scope's live connection removed, so a tenant can only ever resolve its own connection; the mutable ledgers and the re-keying of bare names under a multiplexer removed, because a key here is always tenant-scoped from the start; keys are checked against the tenant and server id shapes
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The connection key: which tenant owns which MCP server connection.
 *
 * Upstream keys every connection by a bare server name, or by an owner scope and a name under a multiplexer,
 * and lets one profile ADOPT another's live connection when the route and credentials match. Here a connection
 * is the tenant and the server, always, and there is no adoption: two tenants that name a server `mail-reader`
 * hold two connections, and one can never be handed the other's. Pure.
 */
import { isTenantId } from '../tenant.js';

/** `tenant/server`. */
export type ServerKey = string;

const SERVER_ID = /^[a-z][a-z0-9-]{0,47}$/;

const TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** An MCP tool name as a record may hold it: one plain word, with no wildcard. */
export function isToolName(value: unknown): value is string {
  return typeof value === 'string' && TOOL_NAME.test(value);
}

export function isServerId(value: unknown): value is string {
  return typeof value === 'string' && SERVER_ID.test(value);
}

/** The key for one tenant's server, or `null` when either part is not what a record may hold. */
export function serverKeyOf(tenant: string, serverId: string): ServerKey | null {
  return isTenantId(tenant) && isServerId(serverId) ? `${tenant}/${serverId}` : null;
}

export function splitServerKey(key: string): { readonly tenant: string; readonly serverId: string } | null {
  const parts = typeof key === 'string' ? key.split('/') : [];
  const [tenant, serverId] = parts;
  return parts.length === 2 && tenant !== undefined && serverId !== undefined && serverKeyOf(tenant, serverId) === key ? { tenant, serverId } : null;
}

/** The tenant's own live connection to this server, or `null`. Another tenant's is never returned. */
export function resolveServerKey(live: readonly ServerKey[], tenant: string, serverId: string): ServerKey | null {
  const own = serverKeyOf(tenant, serverId);
  return own !== null && live.includes(own) ? own : null;
}
