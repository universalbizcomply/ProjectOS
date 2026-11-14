// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/infra/exec-approvals-core.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the decision vocabulary and the idea of a request that expires are taken, allow-once and deny; the allow-always decision and the allow-always allowlist it wrote, the 30-minute default timeout, the session targets, the forwarder and the channel runtime are cut; a decision binds ONE prepared command by its hash, is single use, lasts at most ten minutes, is keyed by tenant and project, is dated by an injected monotonic clock and never by the decision, and is held in a bounded store that never evicts a live entry
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * A grant for one exact command, once.
 *
 * A GRANT IS FOR ONE COMMAND, ONCE. It is bound to the hash of a prepared command (argv as asked and as launched, cwd,
 * environment names, limits, real executable, tenant, project, agent). A command that differs by one byte anywhere, a grant
 * past its expiry, and a grant already spent are refused. A command that does not match does not spend the grant.
 *
 * A POSSIBLY-ACTED GRANT IS SPENT FOR GOOD. `consume` marks the grant spent before the plan is handed back. If the runner
 * then fails, times out or is killed, the command may have acted, so nothing re-opens the grant and nothing retries: a new
 * decision is a new grant.
 *
 * NOTHING THE CALLER SAYS IS A BOUND. The clock is the store's own, injected at creation, read once per operation and never
 * allowed to run backwards. The lifetime is the caller's request held to this module's cap, refused past it and never taken
 * as given. The hash is computed from the prepared command, never supplied. The tenant and project are those of a derived
 * binding, and every key starts with both, as a JSON array, so no two scopes can collide.
 *
 * THE STORE IS BOUNDED AND NEVER EVICTS A LIVE ENTRY. An entry is dropped only once it has expired, and an expired grant
 * is refused whether or not it is held. When the store is full of live entries, a new decision is refused, not given room by
 * forgetting an older one.
 *
 * A WELL-FORMED RECORD THAT NAMES A DECISION ID IS NOT AN APPROVAL. A decision names an id and says `decidedBy: 'owner'`.
 * This module checks that form. That the id is the owner's real, authenticated decision is the caller's to prove, as it is
 * for the tool approvals in the approvals directory, and the wiring phase must replace that trust before this is used.
 *
 * WHAT THIS MODULE CANNOT PROVE. The store is in this process's memory: a restart forgets every grant, which only ever
 * refuses. A grant spent in another process is not seen here.
 */
import { createHash } from 'node:crypto';
import { isDerivedBinding, type TenantBinding } from '../tenant.js';
import { readComputerClock, type ComputerClock } from './clock.js';
import { isPreparedExec, type PreparedExec } from './execCommand.js';
import { mintExecLaunchPlan, type ExecLaunchPlan } from './execLaunch.js';
import { snapshotOfFields } from './plainFields.js';

export const MIN_GRANT_TTL_MS = 1_000;
export const MAX_GRANT_TTL_MS = 600_000;
export const MAX_GRANTS_PER_SCOPE = 16;
export const MAX_GRANTS_TOTAL = 256;
export const DECISION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
export const GRANT_DECISIONS = ['allow-once', 'deny'] as const;

export type GrantRefusal =
  | 'NO_TENANT_BINDING'
  | 'NOT_PREPARED'
  | 'WRONG_SCOPE'
  | 'DECISION_SHAPE'
  | 'NOT_THE_OWNER'
  | 'DECISION_VOCABULARY'
  | 'TTL'
  | 'CLOCK'
  | 'DECISION_REUSED'
  | 'OWNER_DENIED'
  | 'STORE_FULL'
  | 'GRANT_UNKNOWN'
  | 'GRANT_EXPIRED'
  | 'GRANT_SPENT'
  | 'BINDING_MISMATCH';

export interface ExecGrant {
  readonly grantId: string;
  readonly decisionId: string;
  readonly hash: string;
  readonly expiresAt: number;
}

export type IssueResult = { readonly ok: true; readonly grant: ExecGrant } | { readonly ok: false; readonly code: GrantRefusal };
export type ConsumeResult = { readonly ok: true; readonly plan: ExecLaunchPlan } | { readonly ok: false; readonly code: GrantRefusal };

export interface ExecGrantStore {
  /** Record the owner's decision on one prepared command. `allow-once` makes a grant; `deny` records the refusal. */
  readonly issue: (binding: TenantBinding, decision: unknown, prepared: PreparedExec, ttlMs: number) => IssueResult;
  /** Spend the grant for this exact command. The first matching use is the only use. */
  readonly consume: (binding: TenantBinding, grantId: string, prepared: PreparedExec) => ConsumeResult;
}

interface Held {
  readonly scope: string;
  readonly hash: string;
  readonly expiresAt: number;
  state: 'open' | 'spent' | 'denied';
}

const keyOf = (tenant: string, project: string, id: string): string => JSON.stringify([tenant, project, id]);
const scopeOf = (tenant: string, project: string): string => JSON.stringify([tenant, project]);

/** A store with its own clock. The clock is the only time it will ever read. */
export function createExecGrantStore(options: { readonly clock: ComputerClock }): ExecGrantStore {
  const clock = options.clock;
  if (typeof clock !== 'function') throw new TypeError('createExecGrantStore needs a clock');
  const grants = new Map<string, Held>();
  const decisions = new Map<string, number>();
  let lastSeen = 0;

  const tick = (): number | null => {
    const now = readComputerClock(clock, lastSeen);
    if (now !== null) lastSeen = now;
    return now;
  };
  /** Drop what has expired: it is refused whether or not it is held. A live entry is never dropped. */
  const purge = (now: number): void => {
    for (const [key, held] of grants) if (held.expiresAt <= now) grants.delete(key);
    for (const [key, expiresAt] of decisions) if (expiresAt <= now) decisions.delete(key);
  };
  const scoped = (binding: TenantBinding, prepared: PreparedExec): GrantRefusal | null => {
    if (!isDerivedBinding(binding)) return 'NO_TENANT_BINDING';
    if (!isPreparedExec(prepared)) return 'NOT_PREPARED';
    return prepared.tenant === binding.tenant && prepared.project === binding.projectId ? null : 'WRONG_SCOPE';
  };

  const issue: ExecGrantStore['issue'] = (binding, decision, prepared, ttlMs) => {
    const refusal = scoped(binding, prepared);
    if (refusal !== null) return { ok: false, code: refusal };
    const fields = snapshotOfFields(decision, ['decisionId', 'decidedBy', 'decision']);
    if (fields === null || typeof fields['decisionId'] !== 'string' || !DECISION_ID.test(fields['decisionId'])) return { ok: false, code: 'DECISION_SHAPE' };
    if (fields['decidedBy'] !== 'owner') return { ok: false, code: 'NOT_THE_OWNER' };
    if (!(GRANT_DECISIONS as readonly unknown[]).includes(fields['decision'])) return { ok: false, code: 'DECISION_VOCABULARY' };
    if (typeof ttlMs !== 'number' || !Number.isSafeInteger(ttlMs) || ttlMs < MIN_GRANT_TTL_MS || ttlMs > MAX_GRANT_TTL_MS) return { ok: false, code: 'TTL' };
    const now = tick();
    if (now === null) return { ok: false, code: 'CLOCK' };
    purge(now);
    const decisionId = fields['decisionId'];
    const decisionKey = keyOf(binding.tenant, binding.projectId, decisionId);
    if (decisions.has(decisionKey)) return { ok: false, code: 'DECISION_REUSED' };
    const scope = scopeOf(binding.tenant, binding.projectId);
    const inScope = [...grants.values()].filter((held) => held.scope === scope).length;
    if (grants.size >= MAX_GRANTS_TOTAL || decisions.size >= MAX_GRANTS_TOTAL || inScope >= MAX_GRANTS_PER_SCOPE) return { ok: false, code: 'STORE_FULL' };
    const expiresAt = now + ttlMs;
    decisions.set(decisionKey, expiresAt);
    if (fields['decision'] === 'deny') return { ok: false, code: 'OWNER_DENIED' };
    const grantId = `EXECGRANT-${createHash('sha256').update(JSON.stringify([binding.tenant, binding.projectId, decisionId, prepared.hash]), 'utf8').digest('hex').slice(0, 32)}`;
    grants.set(keyOf(binding.tenant, binding.projectId, grantId), { scope, hash: prepared.hash, expiresAt, state: 'open' });
    return { ok: true, grant: Object.freeze({ grantId, decisionId, hash: prepared.hash, expiresAt }) };
  };

  const consume: ExecGrantStore['consume'] = (binding, grantId, prepared) => {
    const refusal = scoped(binding, prepared);
    if (refusal !== null) return { ok: false, code: refusal };
    const now = tick();
    if (now === null) return { ok: false, code: 'CLOCK' };
    const held = typeof grantId === 'string' ? grants.get(keyOf(binding.tenant, binding.projectId, grantId)) : undefined;
    if (held === undefined) return { ok: false, code: 'GRANT_UNKNOWN' };
    if (held.expiresAt <= now) return { ok: false, code: 'GRANT_EXPIRED' };
    if (held.state !== 'open') return { ok: false, code: 'GRANT_SPENT' };
    if (held.hash !== prepared.hash) return { ok: false, code: 'BINDING_MISMATCH' };
    held.state = 'spent';
    return { ok: true, plan: mintExecLaunchPlan(prepared, 'grant', grantId) };
  };

  return Object.freeze({ issue, consume });
}
