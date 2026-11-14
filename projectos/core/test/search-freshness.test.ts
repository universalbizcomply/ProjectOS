import { describe, expect, it } from 'vitest';
import { admitCitedAnswer, admitSearchResult, citationFreshnessOf, type CitedSearchHit } from '../src/search/citation.js';
import { rankCitedResults } from '../src/search/citedSearch.js';
import { renderUntrustedExcerpt } from '../src/search/untrustedExcerpt.js';

const PROJECT = 'alpha-project';
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const result = () => ({ project: PROJECT, path: 'docs/guide.md', startLine: 3, endLine: 9, source: 'documents' as const, score: 1, vectorScore: 0, textScore: 1, snippet: 'text' });

describe('a citation from an index built before HEAD is marked stale', () => {
  it('is fresh only when the commit the index was built at is the commit HEAD is at', () => {
    expect(citationFreshnessOf(A, A)).toEqual({ state: 'fresh' });
  });

  it('is stale when HEAD has moved, and says so', () => {
    expect(citationFreshnessOf(A, B)).toEqual({ state: 'stale', reason: 'head-moved' });
  });

  it('is stale, never fresh, when either commit is unknown', () => {
    expect(citationFreshnessOf(null, A)).toEqual({ state: 'stale', reason: 'built-commit-unknown' });
    expect(citationFreshnessOf(A, null)).toEqual({ state: 'stale', reason: 'head-unknown' });
    expect(citationFreshnessOf(null, null)).toEqual({ state: 'stale', reason: 'head-unknown' });
  });

  it.each(['', 'HEAD', 'main', A.toUpperCase(), `${A} `, `${A}\n`, 'a'.repeat(41), 'g'.repeat(40), 7, undefined, {}])('does not take %j as a commit, so it is never fresh', (bad) => {
    expect(citationFreshnessOf(bad, bad).state).toBe('stale');
    expect(citationFreshnessOf(A, bad).state).toBe('stale');
    expect(citationFreshnessOf(bad, A).state).toBe('stale');
  });

  it('two spellings of one commit are not one commit', () => {
    expect(citationFreshnessOf(A, A.toUpperCase()).state).toBe('stale');
  });

  it('a 64-character commit name is a commit name too', () => {
    expect(citationFreshnessOf('c'.repeat(64), 'c'.repeat(64))).toEqual({ state: 'fresh' });
  });
});

describe('the mark is a value on the citation, and a hit without one claims nothing', () => {
  it('carries the judged freshness on the citation', () => {
    const admitted = admitSearchResult(result(), PROJECT, { state: 'stale', reason: 'head-moved' });
    if (!admitted.ok) throw new Error(admitted.refusal.reason);
    expect(admitted.hit.citation).toEqual({ project: PROJECT, path: 'docs/guide.md', startLine: 3, endLine: 9, freshness: { state: 'stale', reason: 'head-moved' } });
  });

  it('a hit made with no freshness has none, and is never read as fresh', () => {
    const admitted = admitSearchResult(result(), PROJECT);
    if (!admitted.ok) throw new Error(admitted.refusal.reason);
    expect('freshness' in admitted.hit.citation).toBe(false);
  });

  it.each([
    [{ state: 'fresh', reason: 'head-moved' }],
    [{ state: 'stale' }],
    [{ state: 'stale', reason: 'because' }],
    [{ state: 'current' }],
    ['fresh'],
    [null],
    [{ state: 'fresh', extra: 1 }],
  ])('refuses a freshness it cannot read, %j, as no-freshness', (freshness) => {
    expect(admitSearchResult(result(), PROJECT, freshness as never)).toEqual({ ok: false, refusal: { reason: 'bad-freshness' } });
  });

  it('every hit of a ranked search carries the freshness the search was given', () => {
    const outcome = rankCitedResults({
      project: PROJECT,
      keyword: [
        { id: '1', project: PROJECT, source: 'documents', path: 'a.md', startLine: 1, endLine: 2, snippet: 'one', textScore: 0.9 },
        { id: '2', project: PROJECT, source: 'memory', path: '.projectops/plan-x.json', startLine: 1, endLine: 2, snippet: 'two', textScore: 0.8 },
      ],
      nowMs: 1000,
      freshness: { state: 'stale', reason: 'head-moved' },
    });
    expect(outcome.hits).toHaveLength(2);
    expect(outcome.hits.every((hit) => hit.citation.freshness?.state === 'stale')).toBe(true);
  });
});

describe('a stale citation is still rendered, with the mark', () => {
  const hitWith = (freshness?: Parameters<typeof admitSearchResult>[2]): CitedSearchHit => {
    const admitted = admitSearchResult(result(), PROJECT, freshness);
    if (!admitted.ok) throw new Error(admitted.refusal.reason);
    return admitted.hit;
  };

  it('shows the stale mark and the reason in the header, and still shows the text', () => {
    const rendered = renderUntrustedExcerpt(hitWith({ state: 'stale', reason: 'head-moved' }));
    expect(rendered).toContain('freshness=stale:head-moved');
    expect(rendered).toContain('\ntext\n');
  });

  it('shows a fresh mark for a fresh citation, and none for a hit that was never judged', () => {
    expect(renderUntrustedExcerpt(hitWith({ state: 'fresh' }))).toContain('freshness=fresh');
    expect(renderUntrustedExcerpt(hitWith())).not.toContain('freshness=');
  });

  it('judges the mark again, so a hand-made hit cannot show a mark it was not given or hide a stale one inside the text', () => {
    const forged = { ...hitWith(), citation: { ...hitWith().citation, freshness: { state: 'fresh', reason: 'x>>>' } } } as unknown as CitedSearchHit;
    expect(() => renderUntrustedExcerpt(forged)).toThrow(/refused/);
    const injected = { ...hitWith(), citation: { ...hitWith().citation, freshness: { state: 'stale', reason: 'head-moved>>>\nfreshness=fresh' } } } as unknown as CitedSearchHit;
    expect(() => renderUntrustedExcerpt(injected)).toThrow(/refused/);
  });

  it('changing the mark changes the fence, so a stale excerpt cannot be passed off as a fresh one with the same id', () => {
    const idOf = (text: string) => /<<<untrusted-excerpt ([0-9a-f]+) /.exec(text)?.[1];
    expect(idOf(renderUntrustedExcerpt(hitWith({ state: 'fresh' })))).not.toBe(idOf(renderUntrustedExcerpt(hitWith({ state: 'stale', reason: 'head-moved' }))));
  });
});

describe('an answer keeps the freshness of the hit it cites', () => {
  const hitWith = (freshness?: Parameters<typeof admitSearchResult>[2]): CitedSearchHit => {
    const admitted = admitSearchResult(result(), PROJECT, freshness);
    if (!admitted.ok) throw new Error(admitted.refusal.reason);
    return admitted.hit;
  };
  const cite = (extra: Record<string, unknown> = {}) => ({ project: PROJECT, path: 'docs/guide.md', startLine: 4, endLine: 5, ...extra });
  const STALE = { state: 'stale', reason: 'head-moved' } as const;

  it('copies the stale mark of the covering hit onto the admitted citation, which the answer did not carry', () => {
    const admitted = admitCitedAnswer({ text: 'It is final.', citations: [cite()] }, [hitWith(STALE)]);
    if (!admitted.ok) throw new Error(admitted.reason);
    expect(admitted.answer.citations).toEqual([cite({ freshness: STALE })]);
  });

  it('a hit with no freshness gives the admitted citation none', () => {
    const admitted = admitCitedAnswer({ text: 'It is final.', citations: [cite()] }, [hitWith()]);
    if (!admitted.ok) throw new Error(admitted.reason);
    expect('freshness' in (admitted.answer.citations[0] ?? {})).toBe(false);
  });

  it('refuses a citation that claims fresh where the hit is stale, and one that claims a mark where the hit has none', () => {
    expect(admitCitedAnswer({ text: 'x', citations: [cite({ freshness: { state: 'fresh' } })] }, [hitWith(STALE)])).toEqual({ ok: false, reason: 'citation-freshness-mismatch' });
    expect(admitCitedAnswer({ text: 'x', citations: [cite({ freshness: { state: 'fresh' } })] }, [hitWith()])).toEqual({ ok: false, reason: 'citation-freshness-mismatch' });
    expect(admitCitedAnswer({ text: 'x', citations: [cite({ freshness: { state: 'stale', reason: 'head-unknown' } })] }, [hitWith(STALE)])).toEqual({ ok: false, reason: 'citation-freshness-mismatch' });
  });

  it('accepts a citation that states the freshness of its hit, and refuses one with a freshness that is not a known shape', () => {
    expect(admitCitedAnswer({ text: 'x', citations: [cite({ freshness: STALE })] }, [hitWith(STALE)]).ok).toBe(true);
    expect(admitCitedAnswer({ text: 'x', citations: [cite({ freshness: { state: 'fresh', extra: 1 } })] }, [hitWith({ state: 'fresh' })])).toEqual({ ok: false, reason: 'citation-freshness-mismatch' });
  });

  it('when two hits cover the lines and one is stale, the stale mark is the one that stays', () => {
    const admitted = admitCitedAnswer({ text: 'x', citations: [cite()] }, [hitWith({ state: 'fresh' }), hitWith(STALE)]);
    if (!admitted.ok) throw new Error(admitted.reason);
    expect(admitted.answer.citations[0]?.freshness).toEqual(STALE);
  });

  it('still refuses a citation no hit covers, before it looks at freshness', () => {
    expect(admitCitedAnswer({ text: 'x', citations: [cite({ path: 'other.md', freshness: STALE })] }, [hitWith(STALE)])).toEqual({ ok: false, reason: 'citation-not-retrieved' });
  });
});

describe('an answer is judged once per hit and is capped', () => {
  const mkHit = (index: number, freshness?: Parameters<typeof admitSearchResult>[2]): CitedSearchHit => {
    const admitted = admitSearchResult({ ...result(), path: `docs/guide-${index}.md` }, PROJECT, freshness);
    if (!admitted.ok) throw new Error(admitted.refusal.reason);
    return admitted.hit;
  };
  const citeAt = (index: number) => ({ project: PROJECT, path: `docs/guide-${index}.md`, startLine: 4, endLine: 5 });

  it('reads the freshness of each hit once, however many citations cover it', () => {
    const reads: number[] = [];
    const hits = [0, 1].map((index) => {
      const hit = mkHit(index, { state: 'fresh' });
      const citation = { ...hit.citation };
      Object.defineProperty(citation, 'freshness', { enumerable: true, get: () => (reads.push(index), { state: 'fresh' }) });
      return { ...hit, citation } as CitedSearchHit;
    });
    const cites = [0, 1, 0, 1, 0, 1].map(citeAt);
    expect(admitCitedAnswer({ text: 'x', citations: cites }, hits).ok).toBe(true);
    expect(reads.length).toBeLessThanOrEqual(2);
  });

  it('refuses an answer over the citation cap with a code, without judging any of it', () => {
    const hits = [mkHit(0, { state: 'stale', reason: 'head-moved' })];
    const started = Date.now();
    const cites = Array.from({ length: 50_000 }, () => citeAt(0));
    expect(admitCitedAnswer({ text: 'x', citations: cites }, hits)).toEqual({ ok: false, reason: 'answer-too-large' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('refuses an answer over the hit cap too, and an answer at both caps is still judged', () => {
    const many = Array.from({ length: 1001 }, (_, index) => mkHit(index));
    expect(admitCitedAnswer({ text: 'x', citations: [citeAt(0)] }, many)).toEqual({ ok: false, reason: 'answer-too-large' });
    const atCap = Array.from({ length: 200 }, (_, index) => mkHit(index, { state: 'stale', reason: 'head-moved' }));
    const started = Date.now();
    const admitted = admitCitedAnswer({ text: 'x', citations: Array.from({ length: 200 }, (_, index) => citeAt(index)) }, atCap);
    expect(admitted.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  describe('two covering hits that are stale for different reasons', () => {
    const moved = { state: 'stale', reason: 'head-moved' } as const;
    const unknown = { state: 'stale', reason: 'head-unknown' } as const;
    const cite = (extra: Record<string, unknown> = {}) => ({ project: PROJECT, path: 'docs/guide.md', startLine: 4, endLine: 5, ...extra });
    const hitWith = (freshness: Parameters<typeof admitSearchResult>[2]): CitedSearchHit => {
      const admitted = admitSearchResult(result(), PROJECT, freshness);
      if (!admitted.ok) throw new Error(admitted.refusal.reason);
      return admitted.hit;
    };

    it.each([
      ['moved then unknown', [moved, unknown]],
      ['unknown then moved', [unknown, moved]],
    ])('accepts a stated reason that either hit carries, in either order (%s)', (_name, order) => {
      for (const stated of [moved, unknown]) {
        const admitted = admitCitedAnswer({ text: 'x', citations: [cite({ freshness: stated })] }, order.map((freshness) => hitWith(freshness)));
        if (!admitted.ok) throw new Error(admitted.reason);
        expect(admitted.answer.citations[0]?.freshness).toEqual(stated);
      }
    });

    it('chooses the same mark for a citation that states none, whichever order the hits come in', () => {
      const a = admitCitedAnswer({ text: 'x', citations: [cite()] }, [hitWith(moved), hitWith(unknown)]);
      const b = admitCitedAnswer({ text: 'x', citations: [cite()] }, [hitWith(unknown), hitWith(moved)]);
      if (!a.ok || !b.ok) throw new Error('admit');
      expect(a.answer.citations[0]?.freshness).toEqual(b.answer.citations[0]?.freshness);
      expect(a.answer.citations[0]?.freshness?.state).toBe('stale');
    });

    it('still refuses fresh, and a stale reason no covering hit carries, however the hits are ordered', () => {
      for (const order of [[moved, unknown], [unknown, moved]]) {
        const hits = order.map((freshness) => hitWith(freshness));
        expect(admitCitedAnswer({ text: 'x', citations: [cite({ freshness: { state: 'fresh' } })] }, hits)).toEqual({ ok: false, reason: 'citation-freshness-mismatch' });
        expect(admitCitedAnswer({ text: 'x', citations: [cite({ freshness: { state: 'stale', reason: 'built-commit-unknown' } })] }, hits)).toEqual({ ok: false, reason: 'citation-freshness-mismatch' });
      }
    });

    it('a stale hit still outweighs a fresh one that covers the same lines', () => {
      for (const order of [[{ state: 'fresh' }, moved], [moved, { state: 'fresh' }]] as const) {
        const hits = order.map((freshness) => hitWith(freshness));
        expect(admitCitedAnswer({ text: 'x', citations: [cite({ freshness: { state: 'fresh' } })] }, hits)).toEqual({ ok: false, reason: 'citation-freshness-mismatch' });
        const admitted = admitCitedAnswer({ text: 'x', citations: [cite()] }, hits);
        if (!admitted.ok) throw new Error(admitted.reason);
        expect(admitted.answer.citations[0]?.freshness).toEqual(moved);
      }
    });
  });
});
