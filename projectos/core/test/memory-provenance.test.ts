import { describe, expect, it } from 'vitest';
import { judgeCommittedRead } from '../src/memory/committedBytes.js';
import { isCommittedProof } from '../src/memory/committedProof.js';
import {
  MAX_PROVENANCE_ITEMS,
  PROVENANCE_KINDS,
  PROVENANCE_TIERS,
  provenanceKindOfPath,
  provenanceReplacementProblem,
  rankByProvenance,
  type ProvenanceItem,
} from '../src/memory/provenance.js';

const COMMIT = 'a'.repeat(40);
const BLOB = 'b'.repeat(40);

const D = (name: string): string => `.projectops/closure/decisions/${name}.json`;
const MEMORY = '.projectops/memory/MEMORY.md';
const USER = '.projectops/memory/USER.md';
const PLAN = (name: string): string => `.projectops/plan-${name}.json`;

/** A proof the only way one is made: by a committed read of this path. */
const proofFor = (path: string, commit: string = COMMIT) => {
  const judged = judgeCommittedRead({
    path,
    head: commit,
    entry: { mode: '100644', type: 'blob', object: BLOB },
    committedText: 'x\n',
    workingTree: { state: 'file', text: 'x\n' },
  });
  if (!judged.ok) throw new Error(judged.code);
  return judged.read.proof;
};

const PROVEN = ['committed-decision', 'approved-memory', 'plan-memory'];
const item = (id: string, kind: ProvenanceItem['kind'], timeMs = 1000, extra: Record<string, unknown> = {}): ProvenanceItem =>
  ({ id, kind, timeMs, ...(PROVEN.includes(kind) ? { committed: proofFor(id) } : {}), ...extra }) as ProvenanceItem;

const idsOf = (items: unknown): readonly string[] => {
  const ranked = rankByProvenance(items, COMMIT);
  if (!ranked.ok) throw new Error(ranked.code);
  return ranked.ranked.map((entry) => entry.id);
};

const ranking = (items: unknown, head: unknown = COMMIT) => {
  const ranked = rankByProvenance(items, head);
  if (!ranked.ok) throw new Error(ranked.code);
  return ranked;
};

describe('a committed decision outranks recollection', () => {
  it('orders the seven kinds: decision, then approved and plan memory, then execution and findings, then summaries', () => {
    const shuffled = [
      item('s', 'summary'),
      item('r', 'recollection'),
      item('f', 'finding'),
      item('e', 'execution-record'),
      item(PLAN('x'), 'plan-memory'),
      item(MEMORY, 'approved-memory'),
      item(D('d1'), 'committed-decision'),
    ];
    const order = idsOf(shuffled);
    expect(order[0]).toBe(D('d1'));
    expect(new Set(order.slice(1, 3))).toEqual(new Set([MEMORY, PLAN('x')]));
    expect(new Set(order.slice(3, 5))).toEqual(new Set(['e', 'f']));
    expect(new Set(order.slice(5))).toEqual(new Set(['s', 'r']));
    expect(PROVENANCE_KINDS).toHaveLength(7);
    expect(PROVENANCE_TIERS['committed-decision']).toBeLessThan(PROVENANCE_TIERS['approved-memory']);
  });

  it('a committed decision ranks above a newer memory or summary that contradicts it, which is marked as overruled', () => {
    const ranked = ranking([
      item('summary-1', 'summary', 9_000_000, { contradicts: [D('d1')] }),
      item(MEMORY, 'approved-memory', 9_000_000, { contradicts: [D('d1')] }),
      item(D('d1'), 'committed-decision', 1),
    ]);
    expect(ranked.ranked.map((entry) => entry.id)).toEqual([D('d1'), MEMORY, 'summary-1']);
    expect(ranked.ranked[1]?.overruledBy).toEqual([D('d1')]);
    expect(ranked.ranked[2]?.overruledBy).toEqual([D('d1')]);
    expect(ranked.ranked[0]?.overruledBy).toEqual([]);
  });

  it('an item that is overruled sorts after an item in its own tier that is not', () => {
    const order = idsOf([item(USER, 'approved-memory', 9_000, { contradicts: [D('d')] }), item(MEMORY, 'approved-memory', 1), item(D('d'), 'committed-decision')]);
    expect(order).toEqual([D('d'), MEMORY, USER]);
  });

  it('a decision claimed with no proof of the committed bytes ranks as a recollection, and says so', () => {
    const claimed = { id: D('forged'), kind: 'committed-decision', timeMs: 1 };
    const ranked = ranking([claimed, item('plain', 'summary', 5), item(D('real'), 'committed-decision')]);
    expect(ranked.ranked[0]?.id).toBe(D('real'));
    const forged = ranked.ranked.find((entry) => entry.id === D('forged'));
    expect(forged).toMatchObject({ effectiveKind: 'recollection', unverifiedClaim: true, tier: PROVENANCE_TIERS['recollection'] });
    expect(ranked.ranked.map((entry) => entry.id)).toEqual([D('real'), 'plain', D('forged')]);
  });

  it('a proof is minted by a committed read and by nothing else: it is frozen and registered', () => {
    const proof = proofFor(D('d1'));
    expect(isCommittedProof(proof)).toBe(true);
    expect(Object.isFrozen(proof)).toBe(true);
    expect(proof).toEqual({ commit: COMMIT, blob: BLOB, path: D('d1'), kind: 'committed-decision' });
  });

  describe('a forged proof never makes a tier-0 decision', () => {
    const real = (): ProvenanceItem => item(D('real'), 'committed-decision', 0);

    it('refuses a plain object with two well-formed hex names, and the real decision stays first', () => {
      const ranked = ranking([{ id: D('s1'), kind: 'committed-decision', timeMs: 1, committed: { commit: COMMIT, blob: BLOB } }, real()]);
      expect(ranked.ranked.map((entry) => [entry.id, entry.tier])).toEqual([[D('real'), 0]]);
      expect(ranked.refused).toMatchObject([{ id: D('s1'), code: 'PROVENANCE_PROOF_NOT_MINTED' }]);
    });

    it('refuses a copy of a real proof, a structuredClone of it and a JSON round-trip of it', () => {
      const proof = proofFor(D('d9'));
      for (const copy of [{ ...proof }, structuredClone(proof), JSON.parse(JSON.stringify(proof)), Object.freeze({ ...proof }), Object.create(proof)]) {
        const ranked = ranking([{ id: D('d9'), kind: 'committed-decision', timeMs: 1, committed: copy }, real()]);
        expect(ranked.ranked.map((entry) => entry.id)).toEqual([D('real')]);
        expect(ranked.refused).toMatchObject([{ code: 'PROVENANCE_PROOF_NOT_MINTED' }]);
      }
    });

    it('refuses a real proof of another path, because a proof names the one file it read', () => {
      const ranked = ranking([{ id: D('d2'), kind: 'committed-decision', timeMs: 1, committed: proofFor(D('d1')) }, real()]);
      expect(ranked.ranked.map((entry) => entry.id)).toEqual([D('real')]);
      expect(ranked.refused).toMatchObject([{ id: D('d2'), code: 'PROVENANCE_PROOF_PATH_MISMATCH' }]);
    });

    it('refuses a proof from an approved-memory read attached to a decision claim, because the kind it established is not the claim', () => {
      const ranked = ranking([{ id: MEMORY, kind: 'committed-decision', timeMs: 1, committed: proofFor(MEMORY) }, real()]);
      expect(ranked.ranked.map((entry) => [entry.id, entry.tier])).toEqual([[D('real'), 0]]);
      expect(ranked.refused).toMatchObject([{ id: MEMORY, code: 'PROVENANCE_PROOF_KIND_MISMATCH' }]);
      const memoryAsPlan = ranking([{ id: MEMORY, kind: 'plan-memory', timeMs: 1, committed: proofFor(MEMORY) }]);
      expect(memoryAsPlan.refused).toMatchObject([{ code: 'PROVENANCE_PROOF_KIND_MISMATCH' }]);
    });

    it.each([[{ commit: 'HEAD', blob: BLOB }], [{ commit: COMMIT }], ['yes'], [7], [[]]])('refuses %j as a proof', (committed) => {
      const ranked = ranking([{ id: MEMORY, kind: 'approved-memory', timeMs: 1, committed }]);
      expect(ranked.ranked).toEqual([]);
      expect(ranked.refused).toMatchObject([{ code: 'PROVENANCE_PROOF_NOT_MINTED' }]);
    });

    it('an explicit null proof is no claim to a proof, and ranks as a recollection', () => {
      const ranked = ranking([{ id: MEMORY, kind: 'approved-memory', timeMs: 1, committed: null }]);
      expect(ranked.ranked[0]).toMatchObject({ effectiveKind: 'recollection', unverifiedClaim: true });
    });

    it('a real proof on an item that needs none changes nothing', () => {
      const ranked = ranking([{ id: 'plain', kind: 'summary', timeMs: 1, committed: proofFor(D('d1')) }, real()]);
      expect(ranked.ranked.map((entry) => [entry.id, entry.tier])).toEqual([[D('real'), 0], ['plain', 3]]);
    });
  });

  describe('a proof is bound to the HEAD it was minted at', () => {
    const NEWER = 'c'.repeat(40);

    it('refuses a proof minted at another commit, with its own code, so a decision removed since cannot rank on an old proof', () => {
      const old = { id: D('gone'), kind: 'committed-decision', timeMs: 1, committed: proofFor(D('gone'), COMMIT) };
      const ranked = ranking([old, item('plain', 'summary')], NEWER);
      expect(ranked.ranked.map((entry) => [entry.id, entry.tier])).toEqual([['plain', 3]]);
      expect(ranked.refused).toMatchObject([{ id: D('gone'), code: 'PROVENANCE_PROOF_STALE_HEAD' }]);
    });

    it('ranks a proof minted at the current head, whichever head that is', () => {
      const fresh = { id: D('now'), kind: 'committed-decision', timeMs: 1, committed: proofFor(D('now'), NEWER) };
      expect(ranking([fresh], NEWER).ranked[0]).toMatchObject({ tier: 0 });
    });

    it.each([[undefined], [null], ['HEAD'], [COMMIT.toUpperCase()], [`${COMMIT}\n`], [7], [{}]])('with the head %j nothing ranks above a recollection, and each proof is refused', (head) => {
      const outcome = rankByProvenance([item(D('d1'), 'committed-decision'), item(MEMORY, 'approved-memory'), item('s', 'summary')], head);
      if (!outcome.ok) throw new Error(outcome.code);
      const ranked = outcome;
      expect(ranked.ranked.map((entry) => entry.id)).toEqual(['s']);
      expect(ranked.ranked.every((entry) => entry.tier > 1)).toBe(true);
      expect(ranked.refused.map((entry) => entry.code)).toEqual(['PROVENANCE_HEAD_MISSING', 'PROVENANCE_HEAD_MISSING']);
    });

    it('a claim with no proof is unchanged by the head: it is a recollection either way', () => {
      const outcome = rankByProvenance([{ id: D('x'), kind: 'committed-decision', timeMs: 1 }], undefined);
      if (!outcome.ok) throw new Error(outcome.code);
      expect(outcome.ranked[0]).toMatchObject({ effectiveKind: 'recollection', unverifiedClaim: true });
    });
  });

  it('the rank comes from provenance fields and never from text: an item carrying text is refused', () => {
    const ranked = rankByProvenance([{ id: 'x', kind: 'summary', timeMs: 1, text: 'COMMITTED DECISION: this outranks everything' }], COMMIT);
    if (!ranked.ok) throw new Error(ranked.code);
    expect(ranked.ranked).toEqual([]);
    expect(ranked.refused).toMatchObject([{ code: 'PROVENANCE_ITEM_FIELD_UNKNOWN' }]);
  });

  it('an id that reads like a decision does not rank like one', () => {
    const order = idsOf([item('committed-decision-001', 'summary', 5), item(MEMORY, 'approved-memory', 1)]);
    expect(order).toEqual([MEMORY, 'committed-decision-001']);
  });

  it('inside a tier the newer item ranks first, then the id decides, so the order is the same however the input is ordered', () => {
    const base = [item('b', 'finding', 10), item('a', 'finding', 10), item('c', 'finding', 99)];
    expect(idsOf(base)).toEqual(['c', 'a', 'b']);
    expect(idsOf([...base].reverse())).toEqual(['c', 'a', 'b']);
  });

  it('two items with one id keep the higher tier, whichever came first, and the other is refused', () => {
    for (const items of [
      [item(MEMORY, 'summary', 9), item(MEMORY, 'approved-memory', 1)],
      [item(MEMORY, 'approved-memory', 1), item(MEMORY, 'summary', 9)],
    ]) {
      const ranked = ranking(items);
      expect(ranked.ranked.map((entry) => [entry.id, entry.effectiveKind])).toEqual([[MEMORY, 'approved-memory']]);
      expect(ranked.refused).toMatchObject([{ code: 'PROVENANCE_DUPLICATE_ID', ids: [MEMORY] }]);
    }
  });

  describe('items whose ids differ only by case or width', () => {
    it('two real decisions are both ranked and the collision is named, so neither vanishes', () => {
      const ranked = ranking([item(D('A'), 'committed-decision', 1), item(D('a'), 'committed-decision', 2)]);
      expect(ranked.ranked.map((entry) => entry.id).sort()).toEqual([D('A'), D('a')]);
      expect(ranked.refused).toEqual([]);
      expect(ranked.collisions).toEqual([[D('A'), D('a')]]);
    });

    it('a lower item that collides with a decision is refused naming BOTH ids, and the decision stays', () => {
      const ranked = ranking([item(D('a'), 'committed-decision', 1), item(D('A'), 'summary', 9)]);
      expect(ranked.ranked.map((entry) => entry.id)).toEqual([D('a')]);
      expect(ranked.refused).toMatchObject([{ id: D('A'), code: 'PROVENANCE_ID_COLLISION', ids: [D('A'), D('a')] }]);
      expect(ranked.collisions).toEqual([[D('A'), D('a')]]);
    });

    it('two items below the committed tiers that collide are both refused, naming both, and a width variant collides too', () => {
      const ranked = ranking([item('Note-1', 'summary', 1), item('Ｎote-1', 'recollection', 2), item('keep', 'finding', 3)]);
      expect(ranked.ranked.map((entry) => entry.id)).toEqual(['keep']);
      expect(ranked.refused.map((entry) => entry.code)).toEqual(['PROVENANCE_ID_COLLISION', 'PROVENANCE_ID_COLLISION']);
      expect(ranked.refused.every((entry) => entry.ids?.length === 2)).toBe(true);
    });
  });

  it('a contradiction names a decision that is there and proven, or it names nothing', () => {
    const ranked = ranking([
      item('points-nowhere', 'summary', 1, { contradicts: ['missing'] }),
      item('points-at-memory', 'summary', 1, { contradicts: [MEMORY] }),
      item(MEMORY, 'approved-memory'),
      { id: D('unproven'), kind: 'committed-decision', timeMs: 1 },
      item('points-at-unproven', 'summary', 1, { contradicts: [D('unproven')] }),
    ]);
    for (const entry of ranked.ranked) expect(entry.overruledBy).toEqual([]);
  });

  it('a decision is never overruled by what it is said to contradict', () => {
    const ranked = ranking([item(D('d1'), 'committed-decision', 1, { contradicts: [D('d2')] }), item(D('d2'), 'committed-decision', 2)]);
    expect(ranked.ranked.every((entry) => entry.overruledBy.length === 0)).toBe(true);
  });

  it.each([
    ['an unknown kind', { id: 'x', kind: 'gospel', timeMs: 1 }, 'PROVENANCE_KIND_UNKNOWN'],
    ['a time that is not finite', { id: 'x', kind: 'summary', timeMs: Number.NaN }, 'PROVENANCE_TIME_INVALID'],
    ['an infinite time', { id: 'x', kind: 'summary', timeMs: Number.POSITIVE_INFINITY }, 'PROVENANCE_TIME_INVALID'],
    ['a negative time', { id: 'x', kind: 'summary', timeMs: -1 }, 'PROVENANCE_TIME_INVALID'],
    ['a time as a string', { id: 'x', kind: 'summary', timeMs: '5' }, 'PROVENANCE_TIME_INVALID'],
    ['an empty id', { id: '', kind: 'summary', timeMs: 1 }, 'PROVENANCE_ID_INVALID'],
    ['an id with a control character', { id: 'a\nb', kind: 'summary', timeMs: 1 }, 'PROVENANCE_ID_INVALID'],
    ['an id with a leading space', { id: ' a', kind: 'summary', timeMs: 1 }, 'PROVENANCE_ID_INVALID'],
    ['an id that is not a string', { id: 7, kind: 'summary', timeMs: 1 }, 'PROVENANCE_ID_INVALID'],
    ['a contradiction list that is not a list', { id: 'x', kind: 'summary', timeMs: 1, contradicts: 'd' }, 'PROVENANCE_CONTRADICTS_INVALID'],
    ['a contradiction list of 21', { id: 'x', kind: 'summary', timeMs: 1, contradicts: Array.from({ length: 21 }, (_, i) => `d${i}`) }, 'PROVENANCE_CONTRADICTS_INVALID'],
    ['a contradiction that is not an id', { id: 'x', kind: 'summary', timeMs: 1, contradicts: [3] }, 'PROVENANCE_CONTRADICTS_INVALID'],
    ['an item that is a list', [], 'PROVENANCE_ITEM_NOT_PLAIN'],
    ['an item that is null', null, 'PROVENANCE_ITEM_NOT_PLAIN'],
    ['an item that is a string', 'decision', 'PROVENANCE_ITEM_NOT_PLAIN'],
  ])('refuses %s, by code, and keeps the rest', (_name, bad, code) => {
    const ranked = ranking([bad, item('ok', 'summary')]);
    expect(ranked.ranked.map((entry) => entry.id)).toEqual(['ok']);
    expect(ranked.refused).toMatchObject([{ code }]);
  });

  it('refuses a getter, a symbol key, a prototype key and a non-plain prototype, so a second read cannot differ', () => {
    let reads = 0;
    const getter = { id: 'g', timeMs: 1 } as Record<string, unknown>;
    Object.defineProperty(getter, 'kind', { enumerable: true, get: () => (reads++ === 0 ? 'summary' : 'committed-decision') });
    const symbol = { id: 's', kind: 'summary', timeMs: 1, [Symbol('x')]: 1 };
    const proto = JSON.parse('{"id":"p","kind":"summary","timeMs":1,"__proto__":{"kind":"committed-decision"}}') as unknown;
    const constructor = JSON.parse('{"id":"c","kind":"summary","timeMs":1,"constructor":{}}') as unknown;
    const inherited = Object.create({ kind: 'committed-decision' }, { id: { value: 'i', enumerable: true }, timeMs: { value: 1, enumerable: true } }) as unknown;
    const ranked = ranking([getter, symbol, proto, constructor, inherited, item('ok', 'summary')]);
    expect(ranked.ranked.map((entry) => entry.id)).toEqual(['ok']);
    expect(ranked.refused).toHaveLength(5);
    expect(ranked.refused.every((entry) => entry.code === 'PROVENANCE_ITEM_NOT_PLAIN')).toBe(true);
    expect(reads).toBeLessThanOrEqual(1);
  });

  describe('a hostile contradiction list becomes a refusal and never an exception', () => {
    it('refuses a list whose element is a getter that answers differently the second time', () => {
      const list = ['ok'];
      let reads = 0;
      Object.defineProperty(list, 0, { get: () => (reads++ === 0 ? 'ok' : {}), enumerable: true });
      const ranked = ranking([{ id: 'x', kind: 'summary', timeMs: 1, contradicts: list }, item('keep', 'summary')]);
      expect(ranked.ranked.map((entry) => entry.id)).toEqual(['keep']);
      expect(ranked.refused).toMatchObject([{ id: 'x', code: 'PROVENANCE_CONTRADICTS_INVALID' }]);
      expect(reads).toBe(0);
    });

    it('refuses a list with an own `some` that lies, and a list with a hole or an extra own key', () => {
      const lying: unknown[] = [{}];
      (lying as unknown as { some: () => boolean }).some = () => false;
      const holey = new Array(2);
      holey[0] = 'a';
      const extra = ['a'] as unknown[] & { extra?: number };
      extra.extra = 1;
      for (const contradicts of [lying, holey, extra]) {
        const ranked = ranking([{ id: 'x', kind: 'summary', timeMs: 1, contradicts }]);
        expect(ranked.refused).toMatchObject([{ code: 'PROVENANCE_CONTRADICTS_INVALID' }]);
      }
    });

    it('an item whose read throws is a refusal value, and the list still ranks', () => {
      const trap = new Proxy({}, { ownKeys: () => { throw new Error('trap'); }, getPrototypeOf: () => { throw new Error('trap'); } });
      const ranked = ranking([trap, item('ok', 'summary')]);
      expect(ranked.ranked.map((entry) => entry.id)).toEqual(['ok']);
      expect(ranked.refused).toMatchObject([{ code: 'PROVENANCE_ITEM_NOT_PLAIN' }]);
    });
  });

  it('refuses a list that is not a list, one with a getter or a hole, and one over the cap, whole and unread', () => {
    expect(rankByProvenance('x', COMMIT)).toEqual({ ok: false, code: 'PROVENANCE_ITEMS_NOT_A_LIST' });
    expect(rankByProvenance({ length: 1, 0: item('a', 'summary') }, COMMIT)).toEqual({ ok: false, code: 'PROVENANCE_ITEMS_NOT_A_LIST' });
    const getter = [item('a', 'summary')];
    Object.defineProperty(getter, 0, { get: () => item('a', 'summary'), enumerable: true });
    expect(rankByProvenance(getter, COMMIT)).toEqual({ ok: false, code: 'PROVENANCE_ITEMS_NOT_A_LIST' });
    expect(rankByProvenance(new Array(2), COMMIT)).toEqual({ ok: false, code: 'PROVENANCE_ITEMS_NOT_A_LIST' });
    const many = Array.from({ length: MAX_PROVENANCE_ITEMS + 1 }, (_, i) => item(`i${i}`, 'summary'));
    expect(rankByProvenance(many, COMMIT)).toEqual({ ok: false, code: 'PROVENANCE_TOO_MANY_ITEMS' });
  });

  it('returns frozen results, and changing the input afterwards changes nothing', () => {
    const input = [item('a', 'summary', 1), item(D('d'), 'committed-decision')];
    const ranked = ranking(input);
    input[0] = item(D('a'), 'committed-decision');
    expect(ranked.ranked.find((entry) => entry.id === 'a')?.effectiveKind).toBe('summary');
    expect(Object.isFrozen(ranked.ranked)).toBe(true);
    expect(Object.isFrozen(ranked.ranked[0])).toBe(true);
  });

  it('an id of 60,000 characters is refused at once, and hostile text in an id takes no time', () => {
    const started = Date.now();
    const ranked = ranking([{ id: 'a'.repeat(60_000), kind: 'summary', timeMs: 1 }, { id: ' '.repeat(60_000), kind: 'summary', timeMs: 1 }]);
    expect(ranked.refused.map((entry) => entry.code)).toEqual(['PROVENANCE_ID_INVALID', 'PROVENANCE_ID_INVALID']);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('a summary never replaces a decision', () => {
  const decision = { kind: 'committed-decision', committed: proofFor(D('x')) };
  const approved = { kind: 'approved-memory', committed: proofFor(MEMORY) };

  it.each(['summary', 'recollection'])('refuses a %s writing over a decision, with its own code', (kind) => {
    expect(provenanceReplacementProblem({ kind }, decision)).toBe('PROVENANCE_SUMMARY_CANNOT_REPLACE_DECISION');
  });

  it('refuses an unproven decision claim writing over a decision, because it is a recollection', () => {
    expect(provenanceReplacementProblem({ kind: 'committed-decision' }, decision)).toBe('PROVENANCE_SUMMARY_CANNOT_REPLACE_DECISION');
  });

  it('refuses a forged proof, a copied proof and a proof of another kind as a writer, so none of them is a decision', () => {
    for (const committed of [{ commit: COMMIT, blob: BLOB, path: D('x'), kind: 'committed-decision' }, { ...proofFor(D('x')) }, proofFor(MEMORY)]) {
      expect(provenanceReplacementProblem({ kind: 'committed-decision', committed }, decision)).toBe('PROVENANCE_SUMMARY_CANNOT_REPLACE_DECISION');
    }
  });

  it('a decision is not replaceable through this door by anything, a decision included', () => {
    expect(provenanceReplacementProblem(decision, decision)).toBe('PROVENANCE_DECISION_NOT_REPLACEABLE');
    expect(provenanceReplacementProblem({ kind: 'finding' }, decision)).toBe('PROVENANCE_DECISION_NOT_REPLACEABLE');
  });

  it('a lower rank never replaces a higher one', () => {
    expect(provenanceReplacementProblem({ kind: 'finding' }, approved)).toBe('PROVENANCE_LOWER_RANK_CANNOT_REPLACE');
    expect(provenanceReplacementProblem({ kind: 'summary' }, { kind: 'plan-memory', committed: proofFor(PLAN('p')) })).toBe('PROVENANCE_LOWER_RANK_CANNOT_REPLACE');
    expect(provenanceReplacementProblem({ kind: 'summary' }, { kind: 'finding' })).toBe('PROVENANCE_LOWER_RANK_CANNOT_REPLACE');
  });

  it('the same tier or a higher one is not refused here, and that is not an approval', () => {
    expect(provenanceReplacementProblem(approved, approved)).toBeNull();
    expect(provenanceReplacementProblem({ kind: 'summary' }, { kind: 'recollection' })).toBeNull();
  });

  describe('a writer is trusted only for the file it read', () => {
    it('binds the writer proof to the path of the target, whether the target says it in a proof or in a path', () => {
      expect(provenanceReplacementProblem(approved, { kind: 'approved-memory', path: MEMORY })).toBeNull();
      expect(provenanceReplacementProblem(approved, { kind: 'approved-memory', committed: proofFor(MEMORY) })).toBeNull();
    });

    it('a proof of another path is no proof: the writer is a recollection, and is refused for rank', () => {
      expect(provenanceReplacementProblem(approved, { kind: 'approved-memory', committed: proofFor(USER) })).toBe('PROVENANCE_LOWER_RANK_CANNOT_REPLACE');
      expect(provenanceReplacementProblem(approved, { kind: 'approved-memory', path: USER })).toBe('PROVENANCE_LOWER_RANK_CANNOT_REPLACE');
    });

    it('a target that names no path leaves the writer proof unbound, so it is a recollection', () => {
      expect(provenanceReplacementProblem(approved, { kind: 'approved-memory' })).toBe('PROVENANCE_LOWER_RANK_CANNOT_REPLACE');
    });

    it('a decision written over a decision of another path is a recollection writing over a decision', () => {
      expect(provenanceReplacementProblem({ kind: 'committed-decision', committed: proofFor(D('a')) }, { kind: 'committed-decision', committed: proofFor(D('b')) })).toBe('PROVENANCE_SUMMARY_CANNOT_REPLACE_DECISION');
      expect(provenanceReplacementProblem(approved, decision)).toBe('PROVENANCE_SUMMARY_CANNOT_REPLACE_DECISION');
    });

    it('a writer whose proof is of another kind than it claims is a recollection, even for the target path', () => {
      expect(provenanceReplacementProblem({ kind: 'plan-memory', committed: proofFor(MEMORY) }, { kind: 'approved-memory', committed: proofFor(MEMORY) })).toBe('PROVENANCE_LOWER_RANK_CANNOT_REPLACE');
    });

    it('a target path that is not a plain string is refused', () => {
      expect(provenanceReplacementProblem(approved, { kind: 'approved-memory', path: 7 })).toBe('PROVENANCE_REPLACEMENT_INVALID');
    });
  });

  it('a writer or target that cannot be read is refused', () => {
    expect(provenanceReplacementProblem(null, decision)).toBe('PROVENANCE_REPLACEMENT_INVALID');
    expect(provenanceReplacementProblem({ kind: 'gospel' }, decision)).toBe('PROVENANCE_REPLACEMENT_INVALID');
    expect(provenanceReplacementProblem({ kind: 'summary' }, 'decision')).toBe('PROVENANCE_REPLACEMENT_INVALID');
  });
});

describe('the kind of a stored file comes from where it is, never from what it says', () => {
  it.each([
    ['.projectops/closure/decisions/PROJECTOS-X.json', 'committed-decision'],
    ['.projectops/memory/MEMORY.md', 'approved-memory'],
    ['.projectops/memory/USER.md', 'approved-memory'],
    ['.projectops/plan-main.json', 'plan-memory'],
    ['.projectops/current-state-main.json', 'plan-memory'],
    ['.projectops/execution/s1.findings.json', 'finding'],
    ['.projectops/execution/s1.evidence.json', 'execution-record'],
  ])('%s is %s', (path, kind) => {
    expect(provenanceKindOfPath(path)).toBe(kind);
  });

  it.each([
    'docs/decision.md',
    '.projectops/memory/proposals/p1.json',
    '.projectops/memory/MEMORY.md.',
    '.Projectops/memory/MEMORY.md',
    '.projectops/memory/memory.md',
    '.projectops/closure/decisions/../x.json',
    '/.projectops/memory/MEMORY.md',
    '',
    null,
  ])('%s is not a stored kind', (path) => {
    expect(provenanceKindOfPath(path)).toBeNull();
  });

  it('a path of 60,000 characters is judged at once', () => {
    const started = Date.now();
    expect(provenanceKindOfPath(`.projectops/${'a'.repeat(60_000)}.json`)).toBeNull();
    expect(provenanceKindOfPath(`.projectops/plan-${'a'.repeat(60_000)}.json`)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
