/**
 * PROJECTOS-AGENT-WORKFORCE1A — exactly one persistent project leader (criteria 1-3), the append-only
 * event chain and the bounded projection (22).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/workforce/canonical.js';
import { WorkforceRefusal, WorkforceStore } from '../src/workforce/eventStore.js';
import { assertCurrentGeneration, ensureProjectLeader, leaderIdFor, mintProjectLeader, verifiedLeader } from '../src/workforce/leader.js';
import { projectLedger, reconcileLedger } from '../src/workforce/projection.js';
import { PRIMARY, world, type World } from './support/workforceWorld.js';

const LEASE = 1_800_000;
const terms = (w: World) => ({ now: w.clock.value, modelRef: PRIMARY, leaseBoundMs: LEASE });

function refusalCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof WorkforceRefusal) return e.code;
    throw e;
  }
  return 'NO_REFUSAL';
}

describe('exactly one project leader per governed project', () => {
  let w: World;
  afterEach(() => w.cleanup());

  it('mints one leader, generation 1, identity separate from its model', () => {
    w = world();
    const claim = mintProjectLeader(w.store(), terms(w));
    expect(claim.generation).toBe(1);
    expect(claim.leaderId).toBe(leaderIdFor('proj-alpha'));
    expect(claim.leaderId).not.toContain(PRIMARY);
    expect(claim.modelRef).toBe(PRIMARY);
  });

  it('refuses a second simultaneous leader and leaves the existing one byte-for-byte unchanged', () => {
    w = world();
    mintProjectLeader(w.store(), terms(w));
    const before = readFileSync(w.store().paths.leader, 'utf8');
    expect(refusalCode(() => mintProjectLeader(w.store(), terms(w)))).toBe('LEADER_EXISTS');
    expect(refusalCode(() => mintProjectLeader(w.store(), { ...terms(w), modelRef: 'fixture:deterministic-secondary' }))).toBe('LEADER_EXISTS');
    expect(readFileSync(w.store().paths.leader, 'utf8')).toBe(before);
  });

  it('holds the claim exclusively: a second process cannot act while the store is held', () => {
    w = world();
    const a = w.store();
    const b = w.store();
    a.withLock(() => {
      expect(refusalCode(() => mintProjectLeader(b, terms(w)))).toBe('STORE_BUSY');
    });
    expect(mintProjectLeader(b, terms(w)).generation).toBe(1);
  });

  it('persists across sessions, restarts and phases: a new process finds the same leader', () => {
    w = world();
    const first = mintProjectLeader(w.store(), terms(w));
    w.clock.advance(60_000);
    const again = ensureProjectLeader(w.store(), terms(w));
    expect(again.tookOver).toBe(false);
    expect(again.claim.generation).toBe(first.generation);
    expect(again.claim.claimedAt).toBe(first.claimedAt);
  });

  it('is stale only past the governance lease bound, and only ProjectOS replaces it (generation + 1, recorded)', () => {
    w = world();
    mintProjectLeader(w.store(), terms(w));
    w.clock.advance(LEASE); // exactly at the bound: not stale
    expect(ensureProjectLeader(w.store(), terms(w)).tookOver).toBe(false);
    w.clock.advance(LEASE + 1);
    const take = ensureProjectLeader(w.store(), terms(w));
    expect(take.tookOver).toBe(true);
    expect(take.claim.generation).toBe(2);
    const events = w.store().readVerified();
    const takeover = events.find((e) => e.type === 'leader-takeover');
    expect(takeover?.payload['previousGeneration']).toBe(1);
    expect(takeover?.payload['generation']).toBe(2);
  });

  it('voids everything issued under an older generation', () => {
    w = world();
    mintProjectLeader(w.store(), terms(w));
    w.clock.advance(LEASE + 1);
    ensureProjectLeader(w.store(), terms(w));
    expect(refusalCode(() => assertCurrentGeneration(w.store(), 1, w.clock.value, LEASE))).toBe('GENERATION_VOID');
    expect(assertCurrentGeneration(w.store(), 2, w.clock.value, LEASE).generation).toBe(2);
    w.clock.advance(LEASE + 1);
    expect(refusalCode(() => assertCurrentGeneration(w.store(), 2, w.clock.value, LEASE))).toBe('LEADER_STALE');
  });

  it('refuses when no leader exists', () => {
    w = world();
    expect(refusalCode(() => assertCurrentGeneration(w.store(), 1, w.clock.value, LEASE))).toBe('NO_PROJECT_LEADER');
  });

  it('detects a leader record edited, deleted or forged by hand — never by hand, only by ProjectOS', () => {
    w = world();
    mintProjectLeader(w.store(), terms(w));
    const path = w.store().paths.leader;
    const original = readFileSync(path, 'utf8');
    writeFileSync(path, original.replace('"generation":1', '"generation":7'));
    expect(refusalCode(() => verifiedLeader(w.store()))).toBe('LEADER_RECORD_TAMPERED');
    expect(refusalCode(() => ensureProjectLeader(w.store(), terms(w)))).toBe('LEADER_RECORD_TAMPERED');
    w.sys.removeFile(path);
    expect(refusalCode(() => ensureProjectLeader(w.store(), terms(w)))).toBe('LEADER_RECORD_MISSING');

    const fresh = world(undefined, 'proj-beta');
    try {
      fresh.sys.writeText(fresh.store().paths.leader, canonicalJson({ schema: 'projectos.project-leader.v1', generation: 1 }));
      expect(refusalCode(() => mintProjectLeader(fresh.store(), terms(fresh)))).toBe('LEADER_RECORD_FORGED');
    } finally {
      fresh.cleanup();
    }
  });
});

describe('the event chain', () => {
  let w: World;
  afterEach(() => w.cleanup());

  it('detects a changed, removed or truncated event', () => {
    w = world();
    mintProjectLeader(w.store(), terms(w));
    ensureProjectLeader(w.store(), terms(w));
    ensureProjectLeader(w.store(), terms(w));
    const path = w.store().paths.events;
    const original = readFileSync(path, 'utf8');
    const lines = original.trim().split('\n');
    writeFileSync(path, original.replace('"generation":1', '"generation":3'));
    expect(refusalCode(() => w.store().readVerified())).toBe('LEDGER_CHAIN_BROKEN');
    writeFileSync(path, [lines[0], lines[2]].join('\n') + '\n');
    expect(refusalCode(() => w.store().readVerified())).toBe('LEDGER_CHAIN_BROKEN');
    writeFileSync(path, [lines[0], lines[1]].join('\n') + '\n');
    expect(refusalCode(() => w.store().readVerified())).toBe('LEDGER_TRUNCATED');
  });

  it('refuses and escalates past the governance bound rather than truncating', () => {
    w = world();
    const small = new WorkforceStore(w.sys, w.root, 'proj-alpha', 3);
    mintProjectLeader(small, terms(w));
    ensureProjectLeader(small, terms(w));
    ensureProjectLeader(small, terms(w));
    let err: WorkforceRefusal | null = null;
    try {
      ensureProjectLeader(small, terms(w));
    } catch (e) {
      err = e as WorkforceRefusal;
    }
    expect(err?.code).toBe('LEDGER_BOUND_EXCEEDED');
    expect(err?.escalate).toBe(true);
  });
});

describe('the leader ledger is a projection, and governance wins', () => {
  let w: World;
  afterEach(() => w.cleanup());

  it('rebuilds from events, and reports a disagreement with the governance record', () => {
    w = world();
    const store = w.store();
    mintProjectLeader(store, terms(w));
    store.withLock(() => store.append('objective-set', 1, { objective: 'fix the parser', phaseId: 'PHASE-A', candidate: 'c'.repeat(40) }));
    const ledger = projectLedger('proj-alpha', store.readVerified());
    expect(ledger.leader?.generation).toBe(1);
    expect(ledger.objective).toBe('fix the parser');
    expect(ledger.currentPhase).toBe('PHASE-A');
    expect(ledger.nextAction).toMatch(/select the team/);
    const rec = reconcileLedger(ledger, { activePhase: 'PHASE-B', candidate: 'd'.repeat(40) });
    expect(rec.ledger.currentPhase).toBe('PHASE-B');
    expect(rec.ledger.candidate).toBe('d'.repeat(40));
    expect(rec.disagreements).toHaveLength(2);
    expect(rec.disagreements[0]).toMatch(/governance record wins/);
  });
});
