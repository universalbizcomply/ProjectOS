// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/routing/session-key.ts; src/routing/account-id.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the session key model is taken (agent, channel, account, peer); every key now begins with the tenant and the project, taken from a binding only resolveTenant can produce, so two tenants never share a key; the shared main session for direct messages, the identity links, the thread suffix, the legacy and cron key shapes and the default agent id are cut; an account or id that is not a plain word is refused instead of falling back to the default account; a colon in any part is refused so no part can forge another tenant's prefix
// Notice: full licence text in THIRD_PARTY_NOTICES

import { isDerivedBinding, isProjectId, isTenantId, type TenantBinding } from '../tenant.js';
import { AGENT_ID } from './agentRecord.js';

export type PeerKind = 'direct' | 'group' | 'channel';
export const PEER_KINDS: readonly PeerKind[] = ['direct', 'group', 'channel'];

export interface RoutePeer {
  readonly kind: PeerKind;
  readonly id: string;
}

export const DEFAULT_ACCOUNT_ID = 'default';

const CHANNEL_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const ACCOUNT_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const PEER_ID = /^[a-z0-9][a-z0-9._@+-]{0,127}$/;

const trimmed = (value: unknown): string | null => (typeof value === 'string' ? value.trim() : null);

/** An agent id folded to lower case, or `null` when it is not one plain word. */
export function normalizeAgentId(value: unknown): string | null {
  const text = trimmed(value)?.toLowerCase();
  return text !== undefined && AGENT_ID.test(text) ? text : null;
}

/**
 * The account, `default` when none is named, and `null` when one is named and is not a plain word. The source falls back to
 * the default account for a bad id; that would route a mistyped account into the default one, so it is refused here.
 */
export function normalizeAccountId(value: unknown): string | null {
  if (value === undefined || value === null) return DEFAULT_ACCOUNT_ID;
  const text = trimmed(value)?.toLowerCase();
  if (text === undefined) return null;
  if (text === '') return DEFAULT_ACCOUNT_ID;
  return ACCOUNT_ID.test(text) ? text : null;
}

export function normalizeChannelId(value: unknown): string | null {
  const text = trimmed(value)?.toLowerCase();
  return text !== undefined && CHANNEL_ID.test(text) ? text : null;
}

/** A peer with a known kind and a plain id, folded to lower case; `null` otherwise. */
export function normalizePeer(value: unknown): RoutePeer | null {
  if (typeof value !== 'object' || value === null) return null;
  const { kind, id } = value as { readonly kind?: unknown; readonly id?: unknown };
  const text = trimmed(id)?.toLowerCase();
  if (typeof kind !== 'string' || !(PEER_KINDS as readonly string[]).includes(kind)) return null;
  return text !== undefined && PEER_ID.test(text) ? { kind: kind as PeerKind, id: text } : null;
}

export interface SessionKeyParts {
  readonly agentId: string;
  readonly channel: string;
  readonly accountId?: string | null;
  readonly peer?: RoutePeer | null;
}

export type SessionKeyResult = { readonly ok: true; readonly key: string } | { readonly ok: false; readonly reason: string };

/**
 * The key a session is stored and queued under. It starts with the tenant and the project, so the same agent and the same
 * peer in another tenant, or another project, is another session. Each direct peer has its own session; there is no shared
 * main session for every direct message.
 */
export function buildAgentSessionKey(binding: TenantBinding, parts: SessionKeyParts): SessionKeyResult {
  if (!isDerivedBinding(binding)) return { ok: false, reason: 'the tenant binding was not produced by resolveTenant' };
  const agentId = normalizeAgentId(parts.agentId);
  const channel = normalizeChannelId(parts.channel);
  const accountId = normalizeAccountId(parts.accountId);
  const peer = parts.peer === undefined || parts.peer === null ? null : normalizePeer(parts.peer);
  if (agentId === null) return { ok: false, reason: 'the agent id is not one plain word' };
  if (channel === null) return { ok: false, reason: 'the channel is not one plain word' };
  if (accountId === null) return { ok: false, reason: 'the account is not one plain word' };
  if (parts.peer !== undefined && parts.peer !== null && peer === null) return { ok: false, reason: 'the peer needs a known kind and a plain id' };
  const tail = peer === null ? 'main' : `${peer.kind}:${peer.id}`;
  return { ok: true, key: `tenant:${binding.tenant}:project:${binding.projectId}:agent:${agentId}:${channel}:${accountId}:${tail}` };
}

export interface ParsedSessionKey {
  readonly tenant: string;
  readonly project: string;
  readonly agentId: string;
  readonly rest: string;
}

/** The parts of a key this module built, or `null` for anything else. */
export function parseAgentSessionKey(key: unknown): ParsedSessionKey | null {
  if (typeof key !== 'string') return null;
  const tokens = key.split(':');
  if (tokens.length < 8 || tokens[0] !== 'tenant' || tokens[2] !== 'project' || tokens[4] !== 'agent') return null;
  const [, tenant, , project, , agentId] = tokens;
  if (!isTenantId(tenant) || !isProjectId(project) || typeof agentId !== 'string' || !AGENT_ID.test(agentId)) return null;
  return { tenant, project, agentId, rest: tokens.slice(6).join(':') };
}

/** Does this key belong to the tenant and project the binding names? */
export function sessionKeyInScope(key: unknown, binding: TenantBinding): boolean {
  if (!isDerivedBinding(binding)) return false;
  const parsed = parseAgentSessionKey(key);
  return parsed !== null && parsed.tenant === binding.tenant && parsed.project === binding.projectId;
}
