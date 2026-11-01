import { describe, expect, it } from 'vitest';
import {
  CHARS_PER_TOKEN_ESTIMATE,
  applyMMRToHybridResults,
  applyTemporalDecayToHybridResults,
  bm25RankToScore,
  buildMatchQueryFromTerms,
  chunkMarkdown,
  createMarkdownChunker,
  estimateStringChars,
  mergeHybridResults,
  planKeywordSearch,
  preparedTextSimilarity,
  prepareSimilarityText,
  remapChunkLines,
  selectHybridSearchResults,
  sha256Hex,
  sourceTimeKey,
  tokenizeFtsQuery,
  truncateUtf16Safe,
  type HybridKeywordResult,
  type HybridVectorResult,
  type MarkdownChunk,
  type RankedHybridResult,
} from '../src/index.js';

const OFF = { enabled: false, lambda: 1 };
const NO_DECAY = { enabled: false, halfLifeDays: 30 };
const NOW = Date.UTC(2026, 10, 1);
const DAY = 24 * 60 * 60 * 1000;

describe('the markdown chunker', () => {
  const numbered = (count: number): string => Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');

  it('a short file is one chunk, with its hash: the positive control', () => {
    expect(chunkMarkdown('# Title\n\nbody', { tokens: 100, overlap: 0 })).toEqual([
      { startLine: 1, endLine: 3, text: '# Title\n\nbody', hash: sha256Hex('# Title\n\nbody') },
    ]);
  });

  it('each chunk starts where the last ended, with no overlap, and every line is covered once', () => {
    const chunks = chunkMarkdown(numbered(100), { tokens: 12, overlap: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks.at(-1)?.endLine).toBe(100);
    chunks.slice(1).forEach((chunk, i) => expect(chunk.startLine).toBe((chunks[i] as MarkdownChunk).endLine + 1));
  });

  it('every chunk text is exactly its own lines of the file', () => {
    const content = numbered(100);
    const lines = content.split('\n');

    for (const chunk of chunkMarkdown(content, { tokens: 12, overlap: 4 })) {
      expect(chunk.text.endsWith(lines[chunk.endLine - 1] as string)).toBe(true);
      expect(lines.slice(chunk.startLine - 1, chunk.endLine).join('\n').endsWith(chunk.text)).toBe(true);
    }
  });

  it('overlap carries the tail of one chunk into the next', () => {
    const chunks = chunkMarkdown(numbered(60), { tokens: 12, overlap: 4 });

    chunks.slice(1).forEach((chunk, i) => expect(chunk.startLine).toBeLessThanOrEqual((chunks[i] as MarkdownChunk).endLine));
  });

  it('overlap from a line wider than its window keeps only that line\'s tail, citing that line', () => {
    const wide = `${'a'.repeat(30)}${'z'.repeat(30)}`;
    const chunks = chunkMarkdown(`${wide}\n${'q'.repeat(50)}`, { tokens: 16, overlap: 3 });
    const second = chunks[1] as MarkdownChunk;

    expect(second.startLine).toBe(1);
    expect(second.endLine).toBe(2);
    expect(second.text.split('\n')[0]).toMatch(/^z+$/);
  });

  it('a line wider than a chunk splits, and every part cites that same line', () => {
    const chunks = chunkMarkdown(`before\n${'x'.repeat(200)}\nafter`, { tokens: 10, overlap: 0 });
    const parts = chunks.filter((chunk) => chunk.text.includes('xxxx'));

    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((part) => {
      expect(part.startLine).toBeLessThanOrEqual(2);
      expect(part.endLine).toBe(2);
    });
  });

  it('never splits a surrogate pair', () => {
    const text = '\u{1F600}'.repeat(100);

    for (const chunk of chunkMarkdown(text, { tokens: 10, overlap: 2 })) {
      expect(chunk.text).toBe(chunk.text.toWellFormed());
    }
  });

  it('splits rare ideographs by their weighted cost, whole', () => {
    const chunks = chunkMarkdown('\u{20000}'.repeat(40), { tokens: 10, overlap: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.text).join('')).toBe('\u{20000}'.repeat(40));
  });

  it('per entry, a list entry keeps its span and a section does not', () => {
    const chunks = chunkMarkdown('# Heading\nintro\n- first\n  more\n- second', { tokens: 100, overlap: 0, perEntry: true });

    expect(chunks.map((chunk) => [chunk.startLine, chunk.endLine, chunk.entryStartLine, chunk.entryEndLine])).toEqual([
      [1, 2, undefined, undefined],
      [3, 4, 3, 4],
      [5, 5, 5, 5],
    ]);
  });

  it('a chunker fed in parts joins a line split across them', () => {
    const seen: MarkdownChunk[] = [];
    const chunker = createMarkdownChunker({ tokens: 100, overlap: 0 }, (chunk) => seen.push(chunk));

    chunker.appendLine('hel', 1, false);
    chunker.appendLine('lo', 1);
    chunker.flush();

    expect(seen.map((chunk) => chunk.text)).toEqual(['hello']);
  });

  it('remapping gives new chunks, moves the range and leaves the input alone', () => {
    const chunks = chunkMarkdown('a\nb', { tokens: 100, overlap: 0 });
    const before = JSON.stringify(chunks);

    const remapped = remapChunkLines(chunks, [7, 12]);

    expect(remapped[0]).toMatchObject({ startLine: 7, endLine: 12 });
    expect(JSON.stringify(chunks)).toBe(before);
    expect(remapChunkLines(chunks, undefined)).toEqual(chunks);
    expect(remapChunkLines(chunks, undefined)).not.toBe(chunks);
  });
});

describe('the tokenizer and similarity', () => {
  const similarity = (a: string, b: string): number => preparedTextSimilarity(prepareSimilarityText(a), prepareSimilarityText(b));

  it('identical word sets score 1, disjoint ones 0, a half overlap in between', () => {
    expect(similarity('red green', 'green RED')).toBe(1);
    expect(similarity('red green', 'blue yellow')).toBe(0);
    expect(similarity('red green', 'red blue')).toBeCloseTo(1 / 3);
  });

  it('CJK bigrams form only across adjacent CJK', () => {
    expect(prepareSimilarityText('\u6211\u559c\u6b22hello\u4f60\u597d').tokens.has('\u6b22\u4f60')).toBe(false);
    expect(prepareSimilarityText('\u6211\u559c\u6b22').tokens.has('\u559c\u6b22')).toBe(true);
  });

  it('text with no tokens compares literally, so two different ones do not collapse', () => {
    expect(similarity('!!!', '!!!')).toBe(1);
    expect(similarity('!!!', '???')).toBe(0);
  });

  it('two empty token sets with the same literal are the same', () => {
    expect(similarity('', '')).toBe(1);
  });
});

describe('MMR', () => {
  const item = (snippet: string, score: number) => ({ snippet, score });

  it('moves a near-duplicate below something different', () => {
    const ranked = applyMMRToHybridResults(
      [item('alpha beta gamma', 1), item('alpha beta gamma', 0.95), item('delta epsilon zeta', 0.9)],
      0.5,
    );

    expect(ranked.map((entry) => entry.score)).toEqual([1, 0.9, 0.95]);
  });

  it('at lambda 1 it is a plain sort by score', () => {
    expect(applyMMRToHybridResults([item('a', 1), item('a', 3), item('b', 2)], 1).map((entry) => entry.score)).toEqual([3, 2, 1]);
  });

  it('with equal scores every item stays', () => {
    expect(applyMMRToHybridResults([item('a', 1), item('b', 1), item('c', 1)], 0.7)).toHaveLength(3);
  });

  it('empty and single inputs come back as new arrays', () => {
    const one = [item('a', 1)];
    expect(applyMMRToHybridResults([], 0.7)).toEqual([]);
    expect(applyMMRToHybridResults(one, 0.7)).toEqual(one);
    expect(applyMMRToHybridResults(one, 0.7)).not.toBe(one);
  });
});

describe('temporal decay reads no file', () => {
  const decay = (path: string, source: string, sourceTimes?: ReadonlyMap<string, number | undefined>) =>
    applyTemporalDecayToHybridResults({
      results: [{ path, source, score: 1 }],
      temporalDecay: { enabled: true, halfLifeDays: 30 },
      sourceTimes,
      nowMs: NOW,
    })[0]?.score;

  it('halves a score over one half-life, from the recorded time', () => {
    expect(decay('docs/a.md', 'documents', new Map([[sourceTimeKey('documents', 'docs/a.md'), NOW - 30 * DAY]]))).toBeCloseTo(0.5);
  });

  it('a future time counts as now', () => {
    expect(decay('docs/a.md', 'documents', new Map([[sourceTimeKey('documents', 'docs/a.md'), NOW + DAY]]))).toBe(1);
  });

  it('a source with no recorded time does not decay', () => {
    expect(decay('docs/a.md', 'documents')).toBe(1);
    expect(decay('sessions/a.jsonl', 'sessions')).toBe(1);
  });

  it('the same path under another source is another source', () => {
    expect(decay('a.md', 'sessions', new Map([[sourceTimeKey('documents', 'a.md'), NOW - 30 * DAY]]))).toBe(1);
  });

  it('a session uses its indexed time, whatever its path looks like', () => {
    const times = new Map([[sourceTimeKey('sessions', 'memory/2020-01-01.md'), NOW - 30 * DAY]]);
    expect(decay('memory/2020-01-01.md', 'sessions', times)).toBeCloseTo(0.5);
  });

  it('a dated memory file decays from the date in its name', () => {
    const date = new Date(NOW - 30 * DAY).toISOString().slice(0, 10);
    expect(decay(`memory/${date}.md`, 'memory')).toBeCloseTo(0.5);
  });

  it('an impossible date in a name is no date', () => {
    expect(decay('memory/2026-02-31.md', 'memory')).toBe(1);
  });

  it('curated memory is evergreen, even with a recorded time', () => {
    const times = new Map([[sourceTimeKey('memory', 'MEMORY.md'), NOW - 300 * DAY]]);
    expect(decay('MEMORY.md', 'memory', times)).toBe(1);
    expect(decay('memory/topic.md', 'memory')).toBe(1);
  });

  it('switched off, it changes nothing and hands back a new array', () => {
    const results = [{ path: 'a.md', source: 'documents', score: 1 }];
    const out = applyTemporalDecayToHybridResults({ results, temporalDecay: NO_DECAY, nowMs: NOW });

    expect(out).toEqual(results);
    expect(out).not.toBe(results);
  });
});

describe('the keyword query', () => {
  it('takes words and drops punctuation', () => {
    expect(tokenizeFtsQuery('Hello, wide-world! 42')).toEqual(['Hello', 'wide', 'world', '42']);
  });

  it('a token of underscores alone is no token, and one with a letter is', () => {
    expect(tokenizeFtsQuery('___ under_score')).toEqual(['under_score']);
  });

  it('a word and nothing else plans an all-terms query', () => {
    expect(planKeywordSearch({ query: 'alpha beta' }).matchQuery).toEqual({
      kind: 'all',
      clauses: [
        { kind: 'term', text: 'alpha' },
        { kind: 'term', text: 'beta' },
      ],
    });
  });

  it('match-any plans an any-terms query', () => {
    expect(planKeywordSearch({ query: 'alpha beta', matchAny: true }).matchQuery).toMatchObject({ kind: 'any' });
  });

  it('nothing to search plans no query', () => {
    expect(planKeywordSearch({ query: '...' })).toEqual({ matchQuery: null, substringTerms: [], tokens: [] });
  });

  it('a repeated term is one clause', () => {
    expect(buildMatchQueryFromTerms(['a', 'a'])).toEqual({ kind: 'all', clauses: [{ kind: 'term', text: 'a' }] });
  });

  it('a word unicode61 folds alike in both forms needs no alternative', () => {
    expect(planKeywordSearch({ query: 'caf\u00e9', canonicalVariants: true }).matchQuery).toEqual({
      kind: 'all',
      clauses: [{ kind: 'term', text: 'caf\u00e9' }],
    });
  });

  it('a Hangul word has distinct composed and decomposed forms, and gets both', () => {
    const plan = planKeywordSearch({ query: '\u1112\u1161\u11ab', canonicalVariants: true });

    expect(plan.matchQuery).toMatchObject({ kind: 'all', clauses: [{ kind: 'any' }] });
  });

  it('a mark from the SQLite table reads as a separator', () => {
    const plan = planKeywordSearch({ query: 'a\u0301\u0483b', canonicalVariants: true });

    expect(plan.tokens.length).toBeGreaterThan(0);
  });

  it('with the trigram tokenizer, a short term goes to the substring owner', () => {
    const plan = planKeywordSearch({ query: 'ab abcd', ftsTokenizer: 'trigram', canonicalVariants: true });

    expect(plan.substringTerms).toEqual(['ab']);
    expect(plan.matchQuery).toEqual({ kind: 'all', clauses: [{ kind: 'term', text: 'abcd' }] });
  });

  it('with leading marks on, a trigram query keeps them', () => {
    expect(planKeywordSearch({ query: '\u0301abc', ftsTokenizer: 'trigram', includeLeadingMarks: true }).tokens).toEqual(['\u0301abc']);
  });

  it('bm25 ranks turn into scores between 0 and 1', () => {
    expect(bm25RankToScore(-1)).toBe(0.5);
    expect(bm25RankToScore(1)).toBe(0.5);
    expect(bm25RankToScore(0)).toBe(1);
    expect(bm25RankToScore(Number.NaN)).toBeCloseTo(0.001);
  });
});

describe('the text budget', () => {
  it('Latin text costs its length', () => {
    expect(estimateStringChars('hello')).toBe(5);
  });

  it('CJK text costs a token a character', () => {
    expect(estimateStringChars('\u4e00\u4e01')).toBe(2 * CHARS_PER_TOKEN_ESTIMATE);
  });

  it('each weight bucket costs more than the last plain character', () => {
    expect(estimateStringChars('\u1100')).toBe(1 + (CHARS_PER_TOKEN_ESTIMATE * 3 - 1));
    expect(estimateStringChars('\u02c7')).toBe(1 + (CHARS_PER_TOKEN_ESTIMATE * 2 - 1));
    expect(estimateStringChars('\u{1d360}')).toBe(2 + (CHARS_PER_TOKEN_ESTIMATE * 3 - 2));
    expect(estimateStringChars('\u{20000}')).toBe(2 + (CHARS_PER_TOKEN_ESTIMATE * 4 - 2));
  });

  it('ASCII after CJK and unweighted non-ASCII cost one each', () => {
    expect(estimateStringChars('\u4e00a\u00e9')).toBe(3 + (CHARS_PER_TOKEN_ESTIMATE - 1));
  });

  it('truncation leaves short text alone and cuts long text', () => {
    expect(truncateUtf16Safe('hello', 9)).toBe('hello');
    expect(truncateUtf16Safe('hello', 2)).toBe('he');
    expect(truncateUtf16Safe('hello', -1)).toBe('');
  });

  it('truncation steps back from the middle of a surrogate pair', () => {
    expect(truncateUtf16Safe('a\u{1F600}b', 2)).toBe('a');
    expect(truncateUtf16Safe('a\u{1F600}b', 3)).toBe('a\u{1F600}');
  });
});

describe('the hybrid merge', () => {
  const base = { project: 'p', source: 'documents', startLine: 1, endLine: 2 };
  const kw = (id: string, textScore: number, snippet = `${id} text`): HybridKeywordResult => ({ ...base, id, path: `${id}.md`, snippet, textScore });
  const vec = (id: string, vectorScore: number): HybridVectorResult => ({ ...base, id, path: `${id}.md`, snippet: `${id} meaning`, vectorScore });
  const merge = (keyword: HybridKeywordResult[], vector: HybridVectorResult[], weights = { vectorWeight: 0, textWeight: 1 }) =>
    mergeHybridResults({ keyword, vector, ...weights, mmr: OFF, temporalDecay: NO_DECAY, nowMs: NOW });

  it('keyword only: the score is the text score, best first', () => {
    const merged = merge([kw('low', 0.2), kw('high', 0.8)], []);

    expect(merged.map((entry) => [entry.path, entry.score])).toEqual([['high.md', 0.8], ['low.md', 0.2]]);
  });

  it('equal scores order by path, then line, so a result is repeatable', () => {
    const later = { ...kw('a', 0.5), id: 'a2', startLine: 5, endLine: 6 };

    expect(merge([kw('b', 0.5), later, kw('a', 0.5)], []).map((entry) => [entry.path, entry.startLine])).toEqual([
      ['a.md', 1],
      ['a.md', 5],
      ['b.md', 1],
    ]);
  });

  it('a chunk found both ways combines by weight, and text never out-earns the best vector score', () => {
    const [entry] = merge([kw('a', 0.9)], [vec('a', 0.5)], { vectorWeight: 0.7, textWeight: 0.3 });

    expect(entry?.vectorScore).toBe(0.5);
    expect(entry?.textScore).toBe(0.9);
    expect(entry?.score).toBeCloseTo(0.7 * 0.5 + 0.3 * 0.5);
  });

  it('a keyword score of 1 counts as the strongest', () => {
    const [entry] = merge([kw('a', 1)], [vec('a', 0.5)], { vectorWeight: 0.5, textWeight: 0.5 });

    expect(entry?.score).toBeCloseTo(0.5);
  });

  it('a vector-only chunk scores on its vector', () => {
    expect(merge([], [vec('a', 0.5)], { vectorWeight: 0.5, textWeight: 0.5 })[0]?.score).toBeCloseTo(0.25);
  });

  it('a chunk with no keyword score earns none from the scale', () => {
    const merged = merge([kw('a', 0.5), kw('b', 0)], [vec('a', 0.8), vec('b', 0.8)], { vectorWeight: 0.5, textWeight: 0.5 });

    expect(merged.find((entry) => entry.path === 'b.md')?.score).toBeCloseTo(0.4);
  });

  it('with no vector weight, a vector row does not scale the text', () => {
    expect(merge([kw('a', 0.5)], [vec('a', 0.9)])[0]?.score).toBe(0.5);
  });

  it('decay moves the order and leaves eligibility alone', () => {
    const merged = mergeHybridResults({
      keyword: [kw('old', 0.8), kw('new', 0.5)],
      vector: [],
      vectorWeight: 0,
      textWeight: 1,
      sourceTimes: new Map([
        [sourceTimeKey('documents', 'old.md'), NOW - 300 * DAY],
        [sourceTimeKey('documents', 'new.md'), NOW],
      ]),
      mmr: OFF,
      temporalDecay: { enabled: true, halfLifeDays: 30 },
      nowMs: NOW,
    });

    expect(merged.map((entry) => entry.path)).toEqual(['new.md', 'old.md']);
    expect(merged.find((entry) => entry.path === 'old.md')?.eligibilityScore).toBe(0.8);
  });

  it('MMR runs when enabled', () => {
    const keyword = [kw('a', 0.9, 'same words here'), kw('b', 0.85, 'same words here'), kw('c', 0.8, 'other things entirely')];
    const merged = mergeHybridResults({ keyword, vector: [], vectorWeight: 0, textWeight: 1, mmr: { enabled: true, lambda: 0.3 }, temporalDecay: NO_DECAY, nowMs: NOW });

    expect(merged.map((entry) => entry.path)).toEqual(['a.md', 'c.md', 'b.md']);
  });

  it('leaves its inputs alone', () => {
    const keyword = [kw('a', 0.5)];
    const vector = [vec('a', 0.5)];
    const before = JSON.stringify([keyword, vector]);

    merge(keyword, vector, { vectorWeight: 0.5, textWeight: 0.5 });

    expect(JSON.stringify([keyword, vector])).toBe(before);
  });
});

describe('selecting results', () => {
  const ranked = (path: string, eligibilityScore: number, vectorScore = 0): RankedHybridResult => ({
    project: 'p',
    source: 'documents',
    path,
    startLine: 1,
    endLine: 2,
    score: eligibilityScore,
    vectorScore,
    textScore: eligibilityScore,
    snippet: path,
    eligibilityScore,
  });
  const range = (path: string) => ({ source: 'documents', path, startLine: 1, endLine: 2 });

  it('keeps what clears the bar, up to the cap, and hides eligibility', () => {
    const selected = selectHybridSearchResults({ merged: [ranked('a', 0.9), ranked('b', 0.8), ranked('c', 0.7)], keyword: [], vectorCandidates: [], maxResults: 2, minScore: 0.5 });

    expect(selected.map((entry) => entry.path)).toEqual(['a', 'b']);
    expect(selected[0]).not.toHaveProperty('eligibilityScore');
  });

  it('with no keyword rows, what falls short stays out', () => {
    expect(selectHybridSearchResults({ merged: [ranked('a', 0.1)], keyword: [], vectorCandidates: [], maxResults: 2, minScore: 0.5 })).toEqual([]);
  });

  it('if everything falls short, keyword rows still answer', () => {
    const selected = selectHybridSearchResults({ merged: [ranked('a', 0.1), ranked('b', 0.05)], keyword: [range('a')], vectorCandidates: [], maxResults: 2, minScore: 0.5 });

    expect(selected.map((entry) => entry.path)).toEqual(['a']);
  });

  it('spare capacity goes to keyword rows, not to weak vector rows', () => {
    const selected = selectHybridSearchResults({
      merged: [ranked('strong', 0.9), ranked('weak-keyword', 0.1), ranked('weak-vector', 0.1, 0.1)],
      keyword: [range('strong'), range('weak-keyword')],
      vectorCandidates: [range('strong'), range('weak-vector')],
      maxResults: 3,
      minScore: 0.5,
    });

    expect(selected.map((entry) => entry.path)).toEqual(['strong', 'weak-keyword']);
  });

  it('spare capacity respects the cap', () => {
    const selected = selectHybridSearchResults({
      merged: [ranked('strong', 0.9), ranked('b', 0.1), ranked('c', 0.1)],
      keyword: [range('strong'), range('b'), range('c')],
      vectorCandidates: [],
      maxResults: 2,
      minScore: 0.5,
    });

    expect(selected).toHaveLength(2);
  });
});
