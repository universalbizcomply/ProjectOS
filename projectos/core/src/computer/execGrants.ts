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
 * past its expiry, a grant already spent, a grant revoked and a grant presented by another agent are refused. A command that
 * does not match does not spend the grant.
 *
 * A DECISION IS NOT BELIEVED BECAUSE IT SAYS SO. A decision record names an id, says `decidedBy: 'owner'`, and CARRIES THE HASH
 * the owner was shown; `issue` refuses unless that hash is the prepared command's. Then an injected VERIFIER PORT is asked,
 * for this tenant, project, agent, decision id and hash, whether the owner really made that decision, and a grant is made only
 * if it answers exactly `true`. A store made with no verifier, a verifier that throws and a verifier that answers anything
 * else (a truthy value, a promise) mint nothing.
 *
 * A DECISION ID IS USED ONCE, WITHIN ITS HORIZON. The id of every decision, a deny or an allow, is kept as a tombstone until the
 * decision's own expiry plus a named replay window (`DECISION_REPLAY_WINDOW_MS`, a day), and only then released. A spent or an
 * expired id therefore cannot mint again for as long as a grant it made could still be replayed, and the set does not fill for
 * ever. The tombstones are bounded per tenant and project; at the bound a new decision is refused (`STORE_FULL`) and a tombstone
 * inside its horizon is never evicted. Denials count against the tombstones and not against the live grants.
 *
 * THE AGENT IS THE CALLER'S, NOT THE REQUEST'S. A grant records the agent its command was prepared for, and `consume` is told
 * which agent is asking by the kernel's identity, never by a request field: agent-a presenting a grant made for agent-b is
 * `AGENT_MISMATCH`.
 *
 * A GRANT NEVER BEATS THE POLICY. `consume` runs the one policy gate (`gateExecPolicy`) when the grant is spent: deny mode, a
 * class that is never run, a policy this module did not compile and (where nobody is asked) a command no entry allows all
 * refuse, and the grant stays unspent.
 *
 * A POSSIBLY-ACTED GRANT IS SPENT FOR GOOD. `consume` marks the grant spent before the plan is handed back. If the runner
 * then fails, times out or is killed, the command may have acted, so nothing re-opens the grant and nothing retries: a new
 * decision is a new grant. The plan it returns goes stale after a minute and never outlives the grant, and `revoke` makes a
 * grant read as revoked to a runner that asks.
 *
 * NOTHING THE CALLER SAYS IS A BOUND. The clock is the store's own, injected at creation, read once per operation and never
 * allowed to run backwards (a clock that jumped forward and was corrected is refused until it catches up, and that is the
 * choice: refusing is the safe side). The lifetime is the caller's request held to this module's cap, refused past it and never
 * taken as given. The hash is computed from the prepared command, never supplied. The tenant and project are those of a
 * derived binding, and every key starts with both, as a JSON array, so no two scopes can collide.
 *
 * THE STORE IS BOUNDED AND NEVER EVICTS A LIVE ENTRY. A grant is dropped only once it has expired, and an expired grant is
 * refused whether or not it is held. When a project holds its limit of live grants, a new decision is refused, not given room
 * by forgetting an older one.
 *
 * A WELL-FORMED RECORD THAT NAMES A DECISION ID IS NOT AN APPROVAL. This module checks the form, the hash and, through the
 * verifier port, the owner. That the verifier port really reaches the owner's authenticated decision is the caller's to
 * prove, as it is for the tool approvals; the wiring phase must supply it before this is used.
 *
 * WHAT THIS MODULE CANNOT PROVE. The store is in this process's memory: a restart forgets every grant and every decision id,
 * which only ever refuses a grant but would make an old decision id new again, so the verifier must refuse an id it has seen.
 * A grant spent in another process is not seen here.
 */
import { createHash } from 'node:crypto';
import type { ActionRegistry } from '../actionRegistry.js';
import { isDerivedBinding, type TenantBinding } from '../tenant.js';
import { readComputerClock, type ComputerClock } from './clock.js';
import { isPreparedExec, type PreparedExec } from './execCommand.js';
import { PLAN_TTL_MS, mintExecLaunchPlan, type ExecLaunchPlan } from './execLaunch.js';
import { gateExecPolicy, type ExecPolicy } from './execPolicy.js';
import { snapshotOfFields } from './plainFields.js';

export const MIN_GRANT_TTL_MS = 1_000;
export const MAX_GRANT_TTL_MS = 600_000;
export const MAX_GRANTS_PER_SCOPE = 16;
/** Decision ids kept for good, per tenant and project. */
export const MAX_DECISIONS_PER_SCOPE = 1_024;
/** How long past its own expiry a decision id is still refused. */
export const DECISION_REPLAY_WINDOW_MS = 86_400_000;
export const DECISION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
export const GRANT_DECISIONS = ['allow-once', 'deny'] as const;

export type GrantRefusal =
  | 'NO_TENANT_BINDING'
  | 'NOT_PREPARED'
  | 'WRONG_SCOPE'
  | 'DECISION_SHAPE'
  | 'NOT_THE_OWNER'
  | 'DECISION_VOCABULARY'
  | 'HASH_MISMATCH'
  | 'UNVERIFIED'
  | 'TTL'
  | 'CLOCK'
  | 'DECISION_REUSED'
  | 'OWNER_DENIED'
  | 'STORE_FULL'
  | 'GRANT_UNKNOWN'
  | 'GRANT_EXPIRED'
  | 'GRANT_SPENT'
  | 'GRANT_REVOKED'
  | 'AGENT_MISMATCH'
  | 'BINDING_MISMATCH'
  | 'POLICY_REFUSED';

export interface ExecGrant {
  readonly grantId: string;
  readonly decisionId: string;
  readonly hash: string;
  readonly expiresAt: number;
}

export type IssueResult = { readonly ok: true; readonly grant: ExecGrant } | { readonly ok: false; readonly code: GrantRefusal };
export type ConsumeResult = { readonly ok: true; readonly plan: ExecLaunchPlan } | { readonly ok: false; readonly code: GrantRefusal };

/** What the verifier port is asked. It must answer exactly `true` for the owner's real decision on exactly this. */
export interface DecisionClaim {
  readonly tenant: string;
  readonly project: string;
  readonly agentId: string;
  readonly decisionId: string;
  readonly hash: string;
  readonly decision: 'allow-once' | 'deny';
}
export type DecisionVerifier = (claim: DecisionClaim) => unknown;

export interface ExecGrantStore {
  /** Record the owner's decision on one prepared command. `allow-once` makes a grant; `deny` records the refusal. */
  readonly issue: (binding: TenantBinding, decision: unknown, prepared: PreparedExec, ttlMs: number) => IssueResult;
  /** Spend the grant for this exact command, for this agent, under this policy. The first matching use is the only use. */
  readonly consume: (binding: TenantBinding, grantId: string, prepared: PreparedExec, agentId: string, policy: ExecPolicy, registry: ActionRegistry) => ConsumeResult;
  /** Make a grant read as revoked. */
  readonly revoke: (binding: TenantBinding, grantId: string) => boolean;
  /** Whether a runner must treat the grant as revoked. A grant this store does not hold reads as revoked. */
  readonly revoked: (tenant: string, project: string, grantId: string) => boolean;
}

interface Held {
  readonly scope: string;
  readonly hash: string;
  readonly agentId: string;
  readonly expiresAt: number;
  state: 'open' | 'spent' | 'revoked';
}

const keyOf = (tenant: string, project: string, id: string): string => JSON.stringify([tenant, project, id]);
const scopeOf = (tenant: string, project: string): string => JSON.stringify([tenant, project]);

/** A store with its own clock and its own verifier. The clock is the only time it will ever read. */
export function createExecGrantStore(options: { readonly clock: ComputerClock; readonly verifier?: DecisionVerifier }): ExecGrantStore {
  const clock = options.clock;
  if (typeof clock !== 'function') throw new TypeError('createExecGrantStore needs a clock');
  const verifier = options.verifier;
  const grants = new Map<string, Held>();
  const decisions = new Map<string, Map<string, number>>();
  let lastSeen = 0;

  const tick = (): number | null => {
    const now = readComputerClock(clock, lastSeen);
    if (now !== null) lastSeen = now;
    return now;
  };
  /** Drop the grants that have expired: they are refused whether or not they are held. A live grant, and every decision id, is kept. */
  const purge = (now: number): void => {
    for (const [key, held] of grants) if (held.expiresAt <= now) grants.delete(key);
    for (const [scope, ids] of decisions) {
      for (const [id, horizon] of ids) if (horizon <= now) ids.delete(id);
      if (ids.size === 0) decisions.delete(scope);
    }
  };
  const scoped = (binding: TenantBinding, prepared: PreparedExec): GrantRefusal | null => {
    if (!isDerivedBinding(binding)) return 'NO_TENANT_BINDING';
    if (!isPreparedExec(prepared)) return 'NOT_PREPARED';
    return prepared.tenant === binding.tenant && prepared.project === binding.projectId ? null : 'WRONG_SCOPE';
  };
  /** Ask the verifier. Anything but exactly `true`, a throw, or no verifier at all, is no. */
  const verified = (claim: DecisionClaim): boolean => {
    if (typeof verifier !== 'function') return false;
    try {
      return verifier(claim) === true;
    } catch {
      return false;
    }
  };

  const issue: ExecGrantStore['issue'] = (binding, decision, prepared, ttlMs) => {
    const refusal = scoped(binding, prepared);
    if (refusal !== null) return { ok: false, code: refusal };
    const fields = snapshotOfFields(decision, ['decisionId', 'decidedBy', 'decision', 'hash']);
    if (fields === null || typeof fields['decisionId'] !== 'string' || !DECISION_ID.test(fields['decisionId']) || typeof fields['hash'] !== 'string') return { ok: false, code: 'DECISION_SHAPE' };
    if (fields['decidedBy'] !== 'owner') return { ok: false, code: 'NOT_THE_OWNER' };
    if (!(GRANT_DECISIONS as readonly unknown[]).includes(fields['decision'])) return { ok: false, code: 'DECISION_VOCABULARY' };
    if (fields['hash'] !== prepared.hash) return { ok: false, code: 'HASH_MISMATCH' };
    if (typeof ttlMs !== 'number' || !Number.isSafeInteger(ttlMs) || ttlMs < MIN_GRANT_TTL_MS || ttlMs > MAX_GRANT_TTL_MS) return { ok: false, code: 'TTL' };
    const now = tick();
    if (now === null) return { ok: false, code: 'CLOCK' };
    purge(now);
    const decisionId = fields['decisionId'];
    const scope = scopeOf(binding.tenant, binding.projectId);
    const seen = decisions.get(scope) ?? new Map<string, number>();
    if (seen.has(decisionId)) return { ok: false, code: 'DECISION_REUSED' };
    const live = [...grants.values()].filter((held) => held.scope === scope).length;
    if (seen.size >= MAX_DECISIONS_PER_SCOPE || (fields['decision'] === 'allow-once' && live >= MAX_GRANTS_PER_SCOPE)) return { ok: false, code: 'STORE_FULL' };
    const claim: DecisionClaim = { tenant: binding.tenant, project: binding.projectId, agentId: prepared.agentId, decisionId, hash: prepared.hash, decision: fields['decision'] as DecisionClaim['decision'] };
    if (!verified(claim)) return { ok: false, code: 'UNVERIFIED' };
    seen.set(decisionId, now + ttlMs + DECISION_REPLAY_WINDOW_MS);
    decisions.set(scope, seen);
    if (fields['decision'] === 'deny') return { ok: false, code: 'OWNER_DENIED' };
    const grantId = `EXECGRANT-${createHash('sha256').update(JSON.stringify([binding.tenant, binding.projectId, decisionId, prepared.hash]), 'utf8').digest('hex').slice(0, 32)}`;
    grants.set(keyOf(binding.tenant, binding.projectId, grantId), { scope, hash: prepared.hash, agentId: prepared.agentId, expiresAt: now + ttlMs, state: 'open' });
    return { ok: true, grant: Object.freeze({ grantId, decisionId, hash: prepared.hash, expiresAt: now + ttlMs }) };
  };

  const consume: ExecGrantStore['consume'] = (binding, grantId, prepared, agentId, policy, registry) => {
    const refusal = scoped(binding, prepared);
    if (refusal !== null) return { ok: false, code: refusal };
    const now = tick();
    if (now === null) return { ok: false, code: 'CLOCK' };
    const held = typeof grantId === 'string' ? grants.get(keyOf(binding.tenant, binding.projectId, grantId)) : undefined;
    if (held === undefined) return { ok: false, code: 'GRANT_UNKNOWN' };
    if (held.expiresAt <= now) return { ok: false, code: 'GRANT_EXPIRED' };
    if (held.state === 'revoked') return { ok: false, code: 'GRANT_REVOKED' };
    if (held.state !== 'open') return { ok: false, code: 'GRANT_SPENT' };
    if (typeof agentId !== 'string' || held.agentId !== agentId || prepared.agentId !== agentId) return { ok: false, code: 'AGENT_MISMATCH' };
    if (held.hash !== prepared.hash) return { ok: false, code: 'BINDING_MISMATCH' };
    if (!gateExecPolicy(policy, registry, prepared, 'grant').ok) return { ok: false, code: 'POLICY_REFUSED' };
    held.state = 'spent';
    return { ok: true, plan: mintExecLaunchPlan(prepared, 'grant', grantId, Math.min(held.expiresAt, now + PLAN_TTL_MS), policy.digest) };
  };

  const revoke: ExecGrantStore['revoke'] = (binding, grantId) => {
    if (!isDerivedBinding(binding)) return false;
    const held = grants.get(keyOf(binding.tenant, binding.projectId, grantId));
    if (held === undefined) return false;
    held.state = 'revoked';
    return true;
  };

  const revoked: ExecGrantStore['revoked'] = (tenant, project, grantId) => {
    const held = grants.get(keyOf(tenant, project, grantId));
    return held === undefined || held.state === 'revoked';
  };

  return Object.freeze({ issue, consume, revoke, revoked });
}
