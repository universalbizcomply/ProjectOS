import { describe, expect, it } from 'vitest';
import {
  ENTRY_DELIMITER,
  MEMORY_CHAR_LIMIT,
  USER_CHAR_LIMIT,
  findMemoryEntry,
  joinMemoryEntries,
  memoryCharCount,
  memoryCharLimit,
  memoryEntriesRoundTrip,
  memoryEntryHash,
  memoryStoreChars,
  normalizeForMatch,
  parseMemoryEntries,
} from '../src/memory/store.js';

describe('the caps', () => {
  it('are the upstream numbers', () => {
    expect(MEMORY_CHAR_LIMIT).toBe(2200);
    expect(USER_CHAR_LIMIT).toBe(1375);
    expect(memoryCharLimit('memory')).toBe(2200);
    expect(memoryCharLimit('user')).toBe(1375);
  });

  it('count characters, not UTF-16 units: one emoji is one', () => {
    expect(memoryCharCount('😀😀')).toBe(2);
  });

  it('count the delimiter', () => {
    expect(memoryStoreChars(['ab', 'cd'])).toBe(4 + ENTRY_DELIMITER.length);
  });
});

describe('§-delimited entries', () => {
  it('splits on the delimiter, trims and drops empties', () => {
    expect(parseMemoryEntries(`  one \n§\n\n§\n two\n`)).toEqual(['one', 'two']);
  });

  it('keeps a bare § inside an entry', () => {
    expect(parseMemoryEntries('see §4 of the delta\n§\nnext')).toEqual(['see §4 of the delta', 'next']);
  });

  it('de-duplicates, first occurrence wins', () => {
    expect(parseMemoryEntries(`one${ENTRY_DELIMITER}two${ENTRY_DELIMITER}one`)).toEqual(['one', 'two']);
  });

  it('reads a file with a byte-order mark and Windows line endings', () => {
    expect(parseMemoryEntries('\ufeffone\r\n§\r\ntwo')).toEqual(['one', 'two']);
  });

  it('round-trips ordinary entries', () => {
    expect(memoryEntriesRoundTrip(['one', 'two\nlines', 'see §4'])).toBe(true);
    expect(parseMemoryEntries(joinMemoryEntries(['one', 'two']))).toEqual(['one', 'two']);
  });

  it('refuses an entry that would come back as two', () => {
    expect(memoryEntriesRoundTrip(['one\n§\ntwo'])).toBe(false);
  });

  it('refuses an entry ending in a bare § line, which splits against the next delimiter', () => {
    expect(memoryEntriesRoundTrip(['one\n§', 'two'])).toBe(false);
  });

  it('refuses that entry when it is last too: it would break the store on the next add', () => {
    expect(memoryEntriesRoundTrip(['two', 'one\n§'])).toBe(false);
  });

  it('refuses an entry that would not read back as written', () => {
    expect(memoryEntriesRoundTrip(['line\rbreak'])).toBe(false);
  });
});

describe('the pin', () => {
  it('is a sha256 of the exact text', () => {
    expect(memoryEntryHash('a')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(memoryEntryHash('a')).toBe(memoryEntryHash('a'));
  });

  it('moves on one character', () => {
    expect(memoryEntryHash('a')).not.toBe(memoryEntryHash('a '));
  });
});

describe('finding the entry', () => {
  const entries = ['Tests pass on Node 24', 'test', 'The owner’s report — weekly'];

  it('finds by substring', () => {
    expect(findMemoryEntry(entries, 'Node 24')).toEqual({ kind: 'found', index: 0 });
  });

  it('a whole-entry match beats a longer entry that contains it', () => {
    expect(findMemoryEntry(['tests pass', 'test'], 'test')).toEqual({ kind: 'found', index: 1 });
  });

  it('finds through retyped quotes and dashes', () => {
    expect(findMemoryEntry(entries, "owner's report - weekly")).toEqual({ kind: 'found', index: 2 });
  });

  it('says none when nothing matches', () => {
    expect(findMemoryEntry(entries, 'absent')).toEqual({ kind: 'none' });
  });

  it('says ambiguous, and does not pick one', () => {
    expect(findMemoryEntry(['alpha one', 'alpha two'], 'alpha')).toEqual({ kind: 'ambiguous', count: 2 });
  });

  it('punctuation alone selects nothing', () => {
    expect(findMemoryEntry(['a - b'], '–')).toEqual({ kind: 'none' });
  });

  it('folds whitespace and a literal backslash-n', () => {
    expect(normalizeForMatch('a\\n  b\tc')).toBe('a b c');
  });
});
