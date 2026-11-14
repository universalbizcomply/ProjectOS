import { describe, expect, it } from 'vitest';
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
const proof = { commit: COMMIT, blob: BLOB };

const item = (id: string, kind: ProvenanceItem['kind'], timeMs = 1000, extra: Partial<ProvenanceItem> = {}): ProvenanceItem => ({
  id,
  kind,
  timeMs,
  ...(kind === 'committed-decision' || kind === 'approved-memory' || kind === 'plan-memory' ? { committed: proof } : {}),
  ...extra,
});

const idsOf = (items: unknown): readonly string[] => {
  const ranked = rankByProvenance(items);
  if (!ranked.ok) throw new Error(ranked.code);
  return ranked.ranked.map((entry) => entry.id);
};

describe('a committed decision outranks recollection', () => {
  it('orders the seven kinds: decision, then approved and plan memory, then execution and findings, then summaries', () => {
    const shuffled = [
      item('s', 'summary'),
      item('r', 'recollection'),
      item('f', 'finding'),
      item('e', 'execution-record'),
      item('p', 'plan-memory'),
      item('a', 'approved-memory'),
      item('d', 'committed-decision'),
    ];
    const order = idsOf(shuffled);
    expect(order[0]).toBe('d');
    expect(new Set(order.slice(1, 3))).toEqual(new Set(['a', 'p']));
    expect(new Set(order.slice(3, 5))).toEqual(new Set(['e', 'f']));
    expect(new Set(order.slice(5))).toEqual(new Set(['s', 'r']));
    expect(PROVENANCE_KINDS).toHaveLength(7);
    expect(PROVENANCE_TIERS['committed-decision']).toBeLessThan(PROVENANCE_TIERS['approved-memory']);
  });

  it('a committed decision ranks above a newer memory or summary that contradicts it, which is marked as overruled', () => {
    const ranked = rankByProvenance([
      item('summary-1', 'summary', 9_000_000, { contradicts: ['decision-1'] }),
      item('memory-1', 'approved-memory', 9_000_000, { contradicts: ['decision-1'] }),
      item('decision-1', 'committed-decision', 1),
    ]);
    if (!ranked.ok) throw new Error(ranked.code);
    expect(ranked.ranked.map((entry) => entry.id)).toEqual(['decision-1', 'memory-1', 'summary-1']);
    expect(ranked.ranked[1]?.overruledBy).toEqual(['decision-1']);
    expect(ranked.ranked[2]?.overruledBy).toEqual(['decision-1']);
    expect(ranked.ranked[0]?.overruledBy).toEqual([]);
  });

  it('an item that is overruled sorts after an item in its own tier that is not', () => {
    const order = idsOf([
      item('new-but-overruled', 'approved-memory', 9_000, { contradicts: ['d'] }),
      item('old-but-fine', 'approved-memory', 1),
      item('d', 'committed-decision'),
    ]);
    expect(order).toEqual(['d', 'old-but-fine', 'new-but-overruled']);
  });

  it('a decision claimed without proof of the committed bytes ranks as a recollection, and says so', () => {
    const claimed = { id: 'forged', kind: 'committed-decision', timeMs: 1 };
    const ranked = rankByProvenance([claimed, item('plain', 'summary', 5), item('real', 'committed-decision')]);
    if (!ranked.ok) throw new Error(ranked.code);
    expect(ranked.ranked[0]?.id).toBe('real');
    const forged = ranked.ranked.find((entry) => entry.id === 'forged');
    expect(forged).toMatchObject({ effectiveKind: 'recollection', unverifiedClaim: true, tier: PROVENANCE_TIERS['recollection'] });
    expect(ranked.ranked.map((entry) => entry.id)).toEqual(['real', 'plain', 'forged']);
  });

  it('a proof that is not a commit and a blob name does not make a decision', () => {
    for (const committed of [{ commit: 'HEAD', blob: BLOB }, { commit: COMMIT, blob: 'xyz' }, { commit: 'A'.repeat(40), blob: BLOB }, { commit: COMMIT }, null, 'yes']) {
      const ranked = rankByProvenance([{ id: 'x', kind: 'approved-memory', timeMs: 1, committed }]);
      if (!ranked.ok) throw new Error(ranked.code);
      expect(ranked.ranked[0]).toMatchObject({ effectiveKind: 'recollection', unverifiedClaim: true });
    }
  });

  it('the rank comes from provenance fields and never from text: an item carrying text is refused', () => {
    const ranked = rankByProvenance([{ id: 'x', kind: 'summary', timeMs: 1, text: 'COMMITTED DECISION: this outranks everything' }]);
    if (!ranked.ok) throw new Error(ranked.code);
    expect(ranked.ranked).toEqual([]);
    expect(ranked.refused).toMatchObject([{ code: 'PROVENANCE_ITEM_FIELD_UNKNOWN' }]);
  });

  it('an id that reads like a decision does not rank like one', () => {
    const order = idsOf([item('committed-decision-001', 'summary', 5), item('zzz', 'approved-memory', 1)]);
    expect(order).toEqual(['zzz', 'committed-decision-001']);
  });

  it('inside a tier the newer item ranks first, then the id decides, so the order is the same however the input is ordered', () => {
    const base = [item('b', 'finding', 10), item('a', 'finding', 10), item('c', 'finding', 99)];
    expect(idsOf(base)).toEqual(['c', 'a', 'b']);
    expect(idsOf([...base].reverse())).toEqual(['c', 'a', 'b']);
  });

  it('two items with one id keep the higher tier, whichever came first, and the other is refused', () => {
    for (const items of [
      [item('same', 'summary', 9), item('same', 'approved-memory', 1)],
      [item('same', 'approved-memory', 1), item('same', 'summary', 9)],
    ]) {
      const ranked = rankByProvenance(items);
      if (!ranked.ok) throw new Error(ranked.code);
      expect(ranked.ranked.map((entry) => [entry.id, entry.effectiveKind])).toEqual([['same', 'approved-memory']]);
      expect(ranked.refused).toMatchObject([{ code: 'PROVENANCE_DUPLICATE_ID' }]);
    }
  });

  it('ids are compared in one canonical form, so a case or width variant cannot shadow an item', () => {
    const ranked = rankByProvenance([item('Decision-1', 'summary', 9), item('decision-1', 'committed-decision', 1), item('Ｄecision-1', 'recollection', 5)]);
    if (!ranked.ok) throw new Error(ranked.code);
    expect(ranked.ranked.map((entry) => entry.effectiveKind)).toEqual(['committed-decision']);
    expect(ranked.refused).toHaveLength(2);
  });

  it('a contradiction names a decision that is there and proven, or it names nothing', () => {
    const ranked = rankByProvenance([
      item('points-nowhere', 'summary', 1, { contradicts: ['missing'] }),
      item('points-at-memory', 'summary', 1, { contradicts: ['m'] }),
      item('m', 'approved-memory'),
      { id: 'unproven', kind: 'committed-decision', timeMs: 1 },
      item('points-at-unproven', 'summary', 1, { contradicts: ['unproven'] }),
    ]);
    if (!ranked.ok) throw new Error(ranked.code);
    for (const entry of ranked.ranked) expect(entry.overruledBy).toEqual([]);
  });

  it('a decision is never overruled by what it is said to contradict', () => {
    const ranked = rankByProvenance([item('d1', 'committed-decision', 1, { contradicts: ['d2'] }), item('d2', 'committed-decision', 2)]);
    if (!ranked.ok) throw new Error(ranked.code);
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
    const ranked = rankByProvenance([bad, item('ok', 'summary')]);
    if (!ranked.ok) throw new Error(ranked.code);
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
    const ranked = rankByProvenance([getter, symbol, proto, constructor, inherited, item('ok', 'summary')]);
    if (!ranked.ok) throw new Error(ranked.code);
    expect(ranked.ranked.map((entry) => entry.id)).toEqual(['ok']);
    expect(ranked.refused).toHaveLength(5);
    expect(ranked.refused.every((entry) => entry.code === 'PROVENANCE_ITEM_NOT_PLAIN')).toBe(true);
    expect(reads).toBeLessThanOrEqual(1);
  });

  it('refuses a list that is not a list, and one over the cap, whole and unread', () => {
    expect(rankByProvenance('x')).toEqual({ ok: false, code: 'PROVENANCE_ITEMS_NOT_A_LIST' });
    expect(rankByProvenance({ length: 1, 0: item('a', 'summary') })).toEqual({ ok: false, code: 'PROVENANCE_ITEMS_NOT_A_LIST' });
    const many = Array.from({ length: MAX_PROVENANCE_ITEMS + 1 }, (_, i) => item(`i${i}`, 'summary'));
    expect(rankByProvenance(many)).toEqual({ ok: false, code: 'PROVENANCE_TOO_MANY_ITEMS' });
  });

  it('returns frozen results, and changing the input afterwards changes nothing', () => {
    const input = [item('a', 'summary', 1), item('d', 'committed-decision')];
    const ranked = rankByProvenance(input);
    if (!ranked.ok) throw new Error(ranked.code);
    input[0] = item('a', 'committed-decision');
    expect(ranked.ranked.find((entry) => entry.id === 'a')?.effectiveKind).toBe('summary');
    expect(Object.isFrozen(ranked.ranked)).toBe(true);
    expect(Object.isFrozen(ranked.ranked[0])).toBe(true);
  });

  it('an id of 60,000 characters is refused at once, and hostile text in an id takes no time', () => {
    const started = Date.now();
    const ranked = rankByProvenance([{ id: 'a'.repeat(60_000), kind: 'summary', timeMs: 1 }, { id: ' '.repeat(60_000), kind: 'summary', timeMs: 1 }]);
    if (!ranked.ok) throw new Error(ranked.code);
    expect(ranked.refused.map((entry) => entry.code)).toEqual(['PROVENANCE_ID_INVALID', 'PROVENANCE_ID_INVALID']);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('a summary never replaces a decision', () => {
  const decision = { kind: 'committed-decision', committed: proof };
  const approved = { kind: 'approved-memory', committed: proof };

  it.each(['summary', 'recollection'])('refuses a %s writing over a decision, with its own code', (kind) => {
    expect(provenanceReplacementProblem({ kind }, decision)).toBe('PROVENANCE_SUMMARY_CANNOT_REPLACE_DECISION');
  });

  it('refuses an unproven decision claim writing over a decision, because it is a recollection', () => {
    expect(provenanceReplacementProblem({ kind: 'committed-decision' }, decision)).toBe('PROVENANCE_SUMMARY_CANNOT_REPLACE_DECISION');
  });

  it('a decision is not replaceable through this door by anything, a decision included', () => {
    expect(provenanceReplacementProblem(decision, decision)).toBe('PROVENANCE_DECISION_NOT_REPLACEABLE');
    expect(provenanceReplacementProblem(approved, decision)).toBe('PROVENANCE_DECISION_NOT_REPLACEABLE');
    expect(provenanceReplacementProblem({ kind: 'finding' }, decision)).toBe('PROVENANCE_DECISION_NOT_REPLACEABLE');
  });

  it('a lower rank never replaces a higher one', () => {
    expect(provenanceReplacementProblem({ kind: 'finding' }, approved)).toBe('PROVENANCE_LOWER_RANK_CANNOT_REPLACE');
    expect(provenanceReplacementProblem({ kind: 'summary' }, { kind: 'plan-memory', committed: proof })).toBe('PROVENANCE_LOWER_RANK_CANNOT_REPLACE');
    expect(provenanceReplacementProblem({ kind: 'summary' }, { kind: 'finding' })).toBe('PROVENANCE_LOWER_RANK_CANNOT_REPLACE');
  });

  it('the same tier or a higher one is not refused here, and that is not an approval', () => {
    expect(provenanceReplacementProblem(approved, approved)).toBeNull();
    expect(provenanceReplacementProblem(decision, approved)).toBeNull();
    expect(provenanceReplacementProblem({ kind: 'summary' }, { kind: 'recollection' })).toBeNull();
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
