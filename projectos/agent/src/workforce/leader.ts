/**
 * Exactly one persistent project leader per governed project execution.
 *
 * A governed project execution is one governed project identity whose active approved plan scopes its
 * work, so the leader is keyed by the project alone: it persists across that project's phases,
 * sessions, restarts and plan successions.
 *
 * WHO MINTS AND CHECKS IT. Only these functions, called by ProjectOS. The leader session is executed
 * by an engine (`engines.ts`) that receives a bounded ledger projection and returns a proposal; it
 * holds no store, no `System` and no path, so it cannot mint, renew or replace itself.
 *
 * THE CLAIM. `leader.json` is created exclusively and must agree with the leader events in the
 * hash-chained log. A claim edited, deleted or replaced by hand no longer agrees and every workforce
 * operation refuses.
 *
 * GENERATIONS. A claim is stale only when it exceeds the governance-owned lease bound. A stale leader
 * is replaced only by ProjectOS (`ensureProjectLeader`), never by another leader and never by hand;
 * the takeover increments the generation and is recorded, and every task, grant and result issued
 * under an older generation is void and refused when it arrives (`assertCurrentGeneration`).
 *
 * IDENTITY IS NOT THE MODEL. `leaderId` names the role for the project; the model executing it is a
 * separate field and may change without changing the leader.
 */
import { canonicalJson } from './canonical.js';
import { WorkforceRefusal, type WorkforceEvent, type WorkforceStore } from './eventStore.js';

export const LEADER_SCHEMA = 'projectos.project-leader.v1';

export interface LeaderClaim {
  readonly schema: typeof LEADER_SCHEMA;
  readonly projectId: string;
  readonly leaderId: string;
  readonly generation: number;
  readonly modelRef: string;
  readonly claimedAt: string;
  readonly renewedAt: string;
  readonly eventDigest: string;
}

export function leaderIdFor(projectId: string): string {
  return `project-leader:${projectId}`;
}

const LEADER_EVENTS = new Set(['leader-minted', 'leader-takeover', 'leader-lease-renewed']);

/** The claim the event chain implies, or null when no leader was ever minted. */
export function claimFromEvents(projectId: string, events: readonly WorkforceEvent[]): LeaderClaim | null {
  let claim: LeaderClaim | null = null;
  for (const e of events) {
    if (!LEADER_EVENTS.has(e.type)) continue;
    const p = e.payload as { generation?: number; modelRef?: string };
    if (e.type === 'leader-lease-renewed') {
      const current = claim as LeaderClaim | null;
      if (current === null || p.generation !== current.generation) continue;
      claim = {
        schema: LEADER_SCHEMA,
        projectId: current.projectId,
        leaderId: current.leaderId,
        generation: current.generation,
        modelRef: current.modelRef,
        claimedAt: current.claimedAt,
        renewedAt: e.at,
        eventDigest: e.digest,
      };
    } else {
      claim = {
        schema: LEADER_SCHEMA,
        projectId,
        leaderId: leaderIdFor(projectId),
        generation: Number(p.generation),
        modelRef: String(p.modelRef),
        claimedAt: e.at,
        renewedAt: e.at,
        eventDigest: e.digest,
      };
    }
  }
  return claim;
}

/** Past the governance lease bound. A time that cannot be read is neither live nor stale: it refuses. */
export function isStale(claim: LeaderClaim, now: string, leaseBoundMs: number): boolean {
  const idle = Date.parse(now) - Date.parse(claim.renewedAt);
  if (!Number.isFinite(idle)) throw new WorkforceRefusal('LEADER_TIME_UNKNOWN', 'the lease cannot be measured (unreadable time); refusing rather than guessing', true);
  return idle > leaseBoundMs;
}

/** Read the claim and prove it agrees with the chain. Refuses on any disagreement. */
export function verifiedLeader(store: WorkforceStore): LeaderClaim | null {
  const events = store.readVerified();
  const derived = claimFromEvents(store.projectId, events);
  const text = store.sys.readText(store.paths.leader);
  if (derived === null) {
    if (text !== null) throw new WorkforceRefusal('LEADER_RECORD_FORGED', 'a leader record exists that no ProjectOS event minted', true);
    return null;
  }
  if (text === null) {
    throw new WorkforceRefusal('LEADER_RECORD_MISSING', `the ledger shows leader generation ${derived.generation} but its record is missing; ProjectOS never re-creates it silently`, true);
  }
  if (text !== canonicalJson(derived)) {
    throw new WorkforceRefusal('LEADER_RECORD_TAMPERED', 'the leader record differs from what the event chain records (edited by hand?)', true);
  }
  return derived;
}

export interface LeaderTerms {
  readonly now: string;
  readonly modelRef: string;
  readonly leaseBoundMs: number;
}

/**
 * Create the FIRST leader of a project. Refuses when any leader exists — live or stale — and leaves it
 * unchanged: a second simultaneous leader is never created, and a stale one is replaced only by the
 * takeover inside `ensureProjectLeader`.
 */
export function mintProjectLeader(store: WorkforceStore, terms: LeaderTerms): LeaderClaim {
  return store.withLock(() => {
    const existing = verifiedLeader(store);
    if (existing !== null) {
      throw new WorkforceRefusal('LEADER_EXISTS', `project '${store.projectId}' already has leader generation ${existing.generation}; a second leader is refused`);
    }
    const event = store.append('leader-minted', 1, { leaderId: leaderIdFor(store.projectId), generation: 1, modelRef: terms.modelRef });
    const claim = claimFromEvents(store.projectId, [event]);
    if (claim === null || !store.sys.createExclusive(store.paths.leader, canonicalJson(claim))) {
      throw new WorkforceRefusal('LEADER_EXISTS', 'another process created the leader record first', true);
    }
    return claim;
  });
}

/**
 * The leader for this project: the live one (lease renewed), a ProjectOS takeover of a stale one
 * (generation + 1, recorded), or the first one. Called only by ProjectOS orchestration.
 */
export function ensureProjectLeader(store: WorkforceStore, terms: LeaderTerms): { readonly claim: LeaderClaim; readonly tookOver: boolean } {
  return store.withLock(() => {
    const existing = verifiedLeader(store);
    if (existing === null) return { claim: mintProjectLeader(store, terms), tookOver: false };
    if (!isStale(existing, terms.now, terms.leaseBoundMs)) {
      const event = store.append('leader-lease-renewed', existing.generation, { generation: existing.generation });
      const claim: LeaderClaim = { ...existing, renewedAt: event.at, eventDigest: event.digest };
      store.replace(store.paths.leader, canonicalJson(claim));
      return { claim, tookOver: false };
    }
    const generation = existing.generation + 1;
    const event = store.append('leader-takeover', generation, {
      leaderId: leaderIdFor(store.projectId),
      generation,
      previousGeneration: existing.generation,
      modelRef: terms.modelRef,
      reason: `lease expired: last renewed ${existing.renewedAt}, bound ${terms.leaseBoundMs} ms`,
    });
    const claim = claimFromEvents(store.projectId, [event]);
    if (claim === null) throw new WorkforceRefusal('LEADER_TAKEOVER_FAILED', 'the takeover event produced no claim', true);
    store.replace(store.paths.leader, canonicalJson(claim));
    return { claim, tookOver: true };
  });
}

/**
 * The gate every task, grant and result passes: a leader exists, it is live, and the generation the
 * item was issued under is the current one. Anything else is void.
 */
export function assertCurrentGeneration(store: WorkforceStore, generation: number, now: string, leaseBoundMs: number): LeaderClaim {
  const claim = verifiedLeader(store);
  if (claim === null) throw new WorkforceRefusal('NO_PROJECT_LEADER', `project '${store.projectId}' has no project leader; no specialist work may start without one`);
  if (isStale(claim, now, leaseBoundMs)) throw new WorkforceRefusal('LEADER_STALE', `leader generation ${claim.generation} exceeded its lease; only a ProjectOS takeover may continue`);
  if (generation !== claim.generation) {
    throw new WorkforceRefusal('GENERATION_VOID', `issued under leader generation ${generation}, but the current generation is ${claim.generation}`);
  }
  return claim;
}
