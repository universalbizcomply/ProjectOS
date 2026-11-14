import { describe, expect, it } from 'vitest';
import { MAX_GRANTS_PER_SCOPE, MAX_GRANT_TTL_MS, MIN_GRANT_TTL_MS, createExecGrantStore, isExecLaunchPlan } from '../src/computer/index.js';
import { DECISION, MINUTE, NOW, agency, movingClock, polygo, preparedOf, projectos, resolverOf, TABLE } from './computer-support.js';

const decision = (change: Record<string, unknown> = {}): Record<string, unknown> => ({ ...DECISION, ...change });
const nth = (index: number): string => `EXECDEC-${String(index).padStart(16, '0')}`;
let sequence = 900;
const fresh = (): string => nth(sequence++);

function world() {
  const time = movingClock();
  const store = createExecGrantStore({ clock: time.clock });
  const binding = polygo();
  const prepared = preparedOf(binding);
  const issued = store.issue(binding, decision(), prepared, 5 * MINUTE);
  if (!issued.ok) throw new Error(`the control grant was refused: ${issued.code}`);
  return { time, store, binding, prepared, grant: issued.grant };
}

describe('exec grants: one command, once', () => {
  it('issues a grant for the owner decision on one prepared command and spends it once: the positive control', () => {
    const { store, binding, prepared, grant } = world();
    expect(grant.hash).toBe(prepared.hash);
    expect(grant.expiresAt).toBe(NOW + 5 * MINUTE);
    const used = store.consume(binding, grant.grantId, prepared);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    expect(isExecLaunchPlan(used.plan)).toBe(true);
    expect(used.plan).toMatchObject({ via: 'grant', grantId: grant.grantId, argv: prepared.argv, cwd: prepared.cwd, envNames: prepared.envNames, hash: prepared.hash });
  });

  it('refuses the command if one byte of its argv changes, and keeps the grant for the command it was given for', () => {
    const { store, binding, prepared, grant } = world();
    for (const argv of [['git', 'statu'], ['git', 'status', ''], ['git', 'Status'], ['git', 'status', '-s']]) {
      const changed = preparedOf(binding, { argv });
      expect(store.consume(binding, grant.grantId, changed), argv.join(' ')).toEqual({ ok: false, code: 'BINDING_MISMATCH' });
    }
    expect(store.consume(binding, grant.grantId, prepared).ok).toBe(true);
  });

  it('refuses the command if its cwd changes by one byte', () => {
    const { store, binding, grant } = world();
    for (const cwd of ['/work/polygo/', '/work/polygo2', '/work/Polygo', '/work/polygo/.', '/work/polygo/sub']) {
      expect(store.consume(binding, grant.grantId, preparedOf(binding, { cwd })), cwd).toMatchObject({ ok: false, code: 'BINDING_MISMATCH' });
    }
  });

  it('refuses the command if its hash changes: an env name, a limit, the agent or the real executable', () => {
    const { store, binding, grant } = world();
    const changes = [{ envNames: ['CI'] }, { timeoutMs: 29_999 }, { maxOutputBytes: 65_535 }, { agentId: 'worker2' }];
    for (const change of changes) expect(store.consume(binding, grant.grantId, preparedOf(binding, change)), JSON.stringify(change)).toEqual({ ok: false, code: 'BINDING_MISMATCH' });
    const moved = preparedOf(binding, {}, resolverOf({ ...TABLE, git: '/opt/git/bin/git' }));
    expect(store.consume(binding, grant.grantId, moved)).toEqual({ ok: false, code: 'BINDING_MISMATCH' });
  });

  it('refuses after expiry, at the instant it expires and after', () => {
    const { time, store, binding, prepared, grant } = world();
    time.set(grant.expiresAt - 1);
    expect(store.consume(binding, grant.grantId, prepared).ok).toBe(true);
    const second = world();
    second.time.set(second.grant.expiresAt);
    expect(second.store.consume(second.binding, second.grant.grantId, second.prepared)).toEqual({ ok: false, code: 'GRANT_EXPIRED' });
    second.time.advance(10 * MINUTE);
    expect(second.store.consume(second.binding, second.grant.grantId, second.prepared).ok).toBe(false);
  });

  it('refuses a second use, and never reopens a spent grant, not even after the first run failed', () => {
    const { store, binding, prepared, grant } = world();
    expect(store.consume(binding, grant.grantId, prepared).ok).toBe(true);
    expect(store.consume(binding, grant.grantId, prepared)).toEqual({ ok: false, code: 'GRANT_SPENT' });
    expect(store.consume(binding, grant.grantId, preparedOf(binding))).toEqual({ ok: false, code: 'GRANT_SPENT' });
    const again = store.issue(binding, decision(), prepared, 5 * MINUTE);
    expect(again).toEqual({ ok: false, code: 'DECISION_REUSED' });
  });

  it('does not spend the grant on a command that does not match, so the real command can still run once', () => {
    const { store, binding, prepared, grant } = world();
    expect(store.consume(binding, grant.grantId, preparedOf(binding, { argv: ['git', 'log'] })).ok).toBe(false);
    expect(store.consume(binding, grant.grantId, prepared).ok).toBe(true);
    expect(store.consume(binding, grant.grantId, prepared).ok).toBe(false);
  });

  it('refuses a decision that is not the owner, not in the vocabulary, or not well formed', () => {
    const { store, binding, prepared } = world();
    const code = (change: Record<string, unknown>): string => {
      const result = store.issue(binding, decision({ decisionId: fresh(), ...change }), prepared, MINUTE);
      return result.ok ? 'ok' : result.code;
    };
    expect(code({ decidedBy: 'agent' })).toBe('NOT_THE_OWNER');
    expect(code({ decidedBy: 'worker' })).toBe('NOT_THE_OWNER');
    expect(code({ decision: 'allow-always' })).toBe('DECISION_VOCABULARY');
    expect(code({ decision: 'auto' })).toBe('DECISION_VOCABULARY');
    expect(code({ decisionId: 'x' })).toBe('DECISION_SHAPE');
    expect(code({ decisionId: 'EXEC DEC 0123456789' })).toBe('DECISION_SHAPE');
    expect(code({ expiresAt: NOW + 1e12 })).toBe('DECISION_SHAPE');
    expect(code({ ttlMs: 1e12 })).toBe('DECISION_SHAPE');
    expect(store.issue(binding, null, prepared, MINUTE)).toEqual({ ok: false, code: 'DECISION_SHAPE' });
  });

  it('records a deny and refuses to turn the same decision id into a grant', () => {
    const { store, binding, prepared } = world();
    expect(store.issue(binding, decision({ decisionId: nth(1), decision: 'deny' }), prepared, MINUTE)).toEqual({ ok: false, code: 'OWNER_DENIED' });
    expect(store.issue(binding, decision({ decisionId: nth(1) }), prepared, MINUTE)).toEqual({ ok: false, code: 'DECISION_REUSED' });
  });

  it('refuses a decision id used twice in one scope, and lets another project use the same id', () => {
    const { store, binding, prepared } = world();
    expect(store.issue(binding, decision({ decisionId: nth(7) }), prepared, MINUTE).ok).toBe(true);
    expect(store.issue(binding, decision({ decisionId: nth(7) }), prepared, MINUTE)).toEqual({ ok: false, code: 'DECISION_REUSED' });
    const other = projectos();
    expect(store.issue(other, decision({ decisionId: nth(7) }), preparedOf(other), MINUTE).ok).toBe(true);
  });

  it('refuses a lifetime past the cap, below the floor or not whole, instead of clamping it', () => {
    const { store, binding, prepared } = world();
    const code = (ttl: unknown, index: number): string => {
      const result = store.issue(binding, decision({ decisionId: nth(100 + index) }), prepared, ttl as number);
      return result.ok ? 'ok' : result.code;
    };
    expect([MAX_GRANT_TTL_MS + 1, MIN_GRANT_TTL_MS - 1, 0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '60000', null, undefined].map((ttl, index) => code(ttl, index))).toEqual(
      Array.from({ length: 10 }, () => 'TTL'),
    );
    expect(code(MAX_GRANT_TTL_MS, 50)).toBe('ok');
    expect(code(MIN_GRANT_TTL_MS, 51)).toBe('ok');
  });

  it('dates a grant by the clock the store was made with, and never by anything the decision says', () => {
    const time = movingClock(NOW + 5 * MINUTE);
    const store = createExecGrantStore({ clock: time.clock });
    const binding = polygo();
    const prepared = preparedOf(binding);
    const issued = store.issue(binding, decision(), prepared, MINUTE);
    expect(issued).toMatchObject({ ok: true, grant: { expiresAt: NOW + 6 * MINUTE } });
    expect(store.issue(binding, decision({ decisionId: nth(2), decidedAt: '2026-11-14T12:00:00.000Z' }), prepared, MINUTE)).toEqual({ ok: false, code: 'DECISION_SHAPE' });
  });

  it('refuses a clock that runs backwards, is not whole, is not a number or throws, for every operation', () => {
    const { time, store, binding, prepared, grant } = world();
    expect(store.consume(binding, 'EXECGRANT-none', prepared)).toEqual({ ok: false, code: 'GRANT_UNKNOWN' });
    time.set(NOW - 1);
    expect(store.consume(binding, grant.grantId, prepared)).toEqual({ ok: false, code: 'CLOCK' });
    expect(store.issue(binding, decision({ decisionId: nth(3) }), prepared, MINUTE)).toEqual({ ok: false, code: 'CLOCK' });
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, '12', undefined, null, 8.64e15 + 1]) {
      const fresh = createExecGrantStore({ clock: () => bad as unknown as number });
      expect(fresh.issue(binding, decision(), prepared, MINUTE), String(bad)).toEqual({ ok: false, code: 'CLOCK' });
    }
    const throwing = createExecGrantStore({ clock: () => { throw new Error('no clock'); } });
    expect(throwing.issue(binding, decision(), prepared, MINUTE)).toEqual({ ok: false, code: 'CLOCK' });
    time.set(NOW);
    expect(store.consume(binding, grant.grantId, prepared).ok).toBe(true);
    expect(() => createExecGrantStore({ clock: 7 as unknown as () => number })).toThrow(TypeError);
  });

  it('keeps grants to their tenant and project: a grant of one scope is unknown in another', () => {
    const { store, binding, prepared, grant } = world();
    const other = projectos();
    expect(store.consume(other, grant.grantId, preparedOf(other))).toEqual({ ok: false, code: 'GRANT_UNKNOWN' });
    const third = agency();
    expect(store.consume(third, grant.grantId, preparedOf(third))).toEqual({ ok: false, code: 'GRANT_UNKNOWN' });
    expect(store.consume(binding, grant.grantId, prepared).ok).toBe(true);
  });

  it('refuses a command prepared for another project, a command the reader did not make and a binding that was not derived', () => {
    const { store, binding, prepared, grant } = world();
    expect(store.consume(binding, grant.grantId, preparedOf(projectos()))).toEqual({ ok: false, code: 'WRONG_SCOPE' });
    expect(store.issue(binding, decision({ decisionId: nth(4) }), preparedOf(projectos()), MINUTE)).toEqual({ ok: false, code: 'WRONG_SCOPE' });
    expect(store.consume(binding, grant.grantId, { ...prepared })).toEqual({ ok: false, code: 'NOT_PREPARED' });
    expect(store.issue(binding, decision({ decisionId: nth(5) }), { ...prepared }, MINUTE)).toEqual({ ok: false, code: 'NOT_PREPARED' });
    expect(store.consume({ ...binding }, grant.grantId, prepared)).toEqual({ ok: false, code: 'NO_TENANT_BINDING' });
    expect(store.issue({ ...binding }, decision({ decisionId: nth(6) }), prepared, MINUTE)).toEqual({ ok: false, code: 'NO_TENANT_BINDING' });
  });

  it('is bounded: it refuses a new decision when full of live grants, never evicting one, and reuses room that expired', () => {
    const { time, store, binding, prepared, grant } = world();
    const ids = [grant.grantId];
    for (let index = 0; index < MAX_GRANTS_PER_SCOPE - 1; index += 1) {
      const issued = store.issue(binding, decision({ decisionId: nth(200 + index) }), preparedOf(binding, { argv: ['git', `s${index}`] }), 5 * MINUTE);
      expect(issued.ok).toBe(true);
      if (issued.ok) ids.push(issued.grant.grantId);
    }
    expect(store.issue(binding, decision({ decisionId: nth(299) }), prepared, MINUTE)).toEqual({ ok: false, code: 'STORE_FULL' });
    expect(store.consume(binding, ids[0] as string, prepared).ok).toBe(true);
    expect(store.consume(binding, ids[5] as string, preparedOf(binding, { argv: ['git', 's4'] })).ok).toBe(true);
    time.advance(6 * MINUTE);
    expect(store.issue(binding, decision({ decisionId: nth(299) }), prepared, MINUTE).ok).toBe(true);
  });

  it('keeps one project from filling the room of another', () => {
    const { store, binding, prepared } = world();
    for (let index = 0; index < MAX_GRANTS_PER_SCOPE - 1; index += 1) {
      store.issue(binding, decision({ decisionId: nth(400 + index) }), preparedOf(binding, { argv: ['git', `t${index}`] }), MINUTE);
    }
    expect(store.issue(binding, decision({ decisionId: nth(499) }), prepared, MINUTE)).toEqual({ ok: false, code: 'STORE_FULL' });
    const other = projectos();
    expect(store.issue(other, decision({ decisionId: nth(499) }), preparedOf(other), MINUTE).ok).toBe(true);
  });

  it('hands the runner a launch plan this module minted: a copy of it is not one', () => {
    const { store, binding, prepared, grant } = world();
    const used = store.consume(binding, grant.grantId, prepared);
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    expect(isExecLaunchPlan({ ...used.plan })).toBe(false);
    expect(isExecLaunchPlan(JSON.parse(JSON.stringify(used.plan)))).toBe(false);
    expect(Object.isFrozen(used.plan)).toBe(true);
  });
});
