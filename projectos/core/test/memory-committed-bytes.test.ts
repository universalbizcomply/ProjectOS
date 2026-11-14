import { describe, expect, it } from 'vitest';
import { MAX_COMMITTED_FILE_BYTES, committedPathProblem, judgeCommittedRead, type CommittedReadFacts } from '../src/memory/committedBytes.js';

const COMMIT = 'c'.repeat(40);
const BLOB = 'd'.repeat(40);
const PATH = '.projectops/memory/MEMORY.md';

const facts = (overrides: Record<string, unknown> = {}): CommittedReadFacts =>
  ({
    path: PATH,
    head: COMMIT,
    entry: { mode: '100644', type: 'blob', object: BLOB },
    committedText: 'one decision\n',
    workingTree: { state: 'file', text: 'one decision\n' },
    ...overrides,
  }) as CommittedReadFacts;

describe('the path of a committed read', () => {
  it.each([
    PATH,
    '.projectops/memory/USER.md',
    '.projectops/plan-main.json',
    '.projectops/current-state-main.json',
    '.projectops/closure/decisions/PROJECTOS-MEMORY-PROVENANCE1A.json',
  ])('allows %s', (path) => {
    expect(committedPathProblem(path)).toBeNull();
  });

  it.each([
    ['', 'COMMITTED_PATH_INVALID'],
    ['/etc/passwd', 'COMMITTED_PATH_ESCAPES'],
    ['C:/Users/x/MEMORY.md', 'COMMITTED_PATH_ESCAPES'],
    ['C:\\Users\\x', 'COMMITTED_PATH_ESCAPES'],
    ['.projectops\\memory\\MEMORY.md', 'COMMITTED_PATH_ESCAPES'],
    ['.projectops/../.projectops/memory/MEMORY.md', 'COMMITTED_PATH_ESCAPES'],
    ['../outside/MEMORY.md', 'COMMITTED_PATH_ESCAPES'],
    ['./.projectops/memory/MEMORY.md', 'COMMITTED_PATH_ESCAPES'],
    ['.projectops//memory/MEMORY.md', 'COMMITTED_PATH_ESCAPES'],
    ['.projectops/memory/', 'COMMITTED_PATH_ESCAPES'],
    ['.projectops/memory/MEMORY.md:evil', 'COMMITTED_PATH_ESCAPES'],
    ['.git/config', 'COMMITTED_PATH_NOT_A_MEMORY_FILE'],
    ['.projectops/memory/MEMORY.md.', 'COMMITTED_PATH_NOT_NORMAL'],
    ['.projectops/memory/MEMORY.md ', 'COMMITTED_PATH_NOT_NORMAL'],
    ['.projectops/memory./MEMORY.md', 'COMMITTED_PATH_NOT_NORMAL'],
    ['.projectops /memory/MEMORY.md', 'COMMITTED_PATH_NOT_NORMAL'],
    ['.projectops/memory/MEM\u0000ORY.md', 'COMMITTED_PATH_NOT_NORMAL'],
    ['.projectops/memory/MEM\u202EROY.md', 'COMMITTED_PATH_NOT_NORMAL'],
    ['.Projectops/memory/MEMORY.md', 'COMMITTED_PATH_NOT_A_MEMORY_FILE'],
    ['.projectops/MEMORY/MEMORY.md', 'COMMITTED_PATH_NOT_A_MEMORY_FILE'],
    ['.projectops/memory/memory.md', 'COMMITTED_PATH_NOT_A_MEMORY_FILE'],
    ['.projectops/memory/notes.md', 'COMMITTED_PATH_NOT_A_MEMORY_FILE'],
    ['.projectops/execution/s1.json', 'COMMITTED_PATH_NOT_A_MEMORY_FILE'],
    ['docs/00_Baseline_State.md', 'COMMITTED_PATH_NOT_A_MEMORY_FILE'],
  ])('refuses %j with %s', (path, code) => {
    expect(committedPathProblem(path)).toBe(code);
  });

  it('refuses what is not a string, and a 60,000 character path at once', () => {
    for (const bad of [null, undefined, 7, {}, ['.projectops/memory/MEMORY.md']]) expect(committedPathProblem(bad)).toBe('COMMITTED_PATH_INVALID');
    const started = Date.now();
    expect(committedPathProblem(`.projectops/${'a'.repeat(60_000)}`)).not.toBeNull();
    expect(committedPathProblem(`${'.'.repeat(60_000)}/x`)).not.toBeNull();
    expect(committedPathProblem(`.projectops/memory/${' '.repeat(60_000)}`)).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('a file whose working-tree bytes differ from HEAD is refused', () => {
  it('reads the committed bytes when the working tree is the same: the positive control', () => {
    expect(judgeCommittedRead(facts())).toEqual({
      ok: true,
      read: { path: PATH, kind: 'approved-memory', commit: COMMIT, blob: BLOB, text: 'one decision\n' },
    });
  });

  it('the bytes it returns are the committed bytes, not the working tree, and the result is frozen', () => {
    const judged = judgeCommittedRead(facts({ workingTree: { state: 'file', text: 'one decision\r\n' } }));
    if (!judged.ok) throw new Error(judged.code);
    expect(judged.read.text).toBe('one decision\n');
    expect(Object.isFrozen(judged.read)).toBe(true);
  });

  it('a CRLF working copy of the same text is the same bytes, which a Windows checkout needs', () => {
    expect(judgeCommittedRead(facts({ committedText: 'a\nb\n', workingTree: { state: 'file', text: 'a\r\nb\r\n' } })).ok).toBe(true);
  });

  it.each([
    ['one character changed', 'one decisioN\n'],
    ['a line added', 'one decision\nand a second\n'],
    ['emptied', ''],
    ['a trailing space', 'one decision \n'],
    ['a lone carriage return', 'one decision\r'],
    ['a different decision of the same length', 'two decisions\n'],
  ])('refuses a working copy with %s, and returns no text', (_name, text) => {
    const judged = judgeCommittedRead(facts({ workingTree: { state: 'file', text } }));
    expect(judged).toEqual({ ok: false, code: 'COMMITTED_WORKING_TREE_DIFFERS', path: PATH });
  });

  it.each([
    [{ state: 'absent' }, 'COMMITTED_WORKING_TREE_ABSENT'],
    [{ state: 'link' }, 'COMMITTED_WORKING_TREE_LINK'],
    [{ state: 'other' }, 'COMMITTED_WORKING_TREE_NOT_FILE'],
    [{ state: 'unreadable' }, 'COMMITTED_WORKING_TREE_UNREADABLE'],
    [{ state: 'too-large' }, 'COMMITTED_WORKING_TREE_UNREADABLE'],
    [{ state: 'file' }, 'COMMITTED_FACTS_INVALID'],
    [{ state: 'file', text: 5 }, 'COMMITTED_FACTS_INVALID'],
    [null, 'COMMITTED_FACTS_INVALID'],
    [{ state: 'surprise' }, 'COMMITTED_FACTS_INVALID'],
  ])('refuses a working tree that is %j', (workingTree, code) => {
    expect(judgeCommittedRead(facts({ workingTree }))).toEqual({ ok: false, code, path: PATH });
  });
});

describe('what HEAD holds must be a regular file of the project', () => {
  it.each([
    [{ mode: '120000', type: 'blob', object: BLOB }, 'COMMITTED_SYMLINK'],
    [{ mode: '160000', type: 'commit', object: BLOB }, 'COMMITTED_NOT_REGULAR'],
    [{ mode: '040000', type: 'tree', object: BLOB }, 'COMMITTED_NOT_REGULAR'],
    [{ mode: '100664', type: 'blob', object: BLOB }, 'COMMITTED_NOT_REGULAR'],
    [{ mode: '100644', type: 'tree', object: BLOB }, 'COMMITTED_NOT_REGULAR'],
    [{ mode: '100644', type: 'blob', object: 'xyz' }, 'COMMITTED_FACTS_INVALID'],
    [{ mode: '100644', type: 'blob', object: BLOB.toUpperCase() }, 'COMMITTED_FACTS_INVALID'],
    [{ mode: '100644', type: 'blob' }, 'COMMITTED_FACTS_INVALID'],
    ['blob', 'COMMITTED_FACTS_INVALID'],
    [null, 'COMMITTED_NOT_IN_HEAD'],
  ])('refuses the HEAD entry %j with %s', (entry, code) => {
    expect(judgeCommittedRead(facts({ entry }))).toEqual({ ok: false, code, path: PATH });
  });

  it('allows an executable regular file', () => {
    expect(judgeCommittedRead(facts({ entry: { mode: '100755', type: 'blob', object: BLOB } })).ok).toBe(true);
  });

  it('refuses a repository with no HEAD, and a HEAD that is not a commit name', () => {
    expect(judgeCommittedRead(facts({ head: null }))).toEqual({ ok: false, code: 'COMMITTED_NO_HEAD', path: PATH });
    expect(judgeCommittedRead(facts({ head: 'HEAD' }))).toEqual({ ok: false, code: 'COMMITTED_NO_HEAD', path: PATH });
    expect(judgeCommittedRead(facts({ head: COMMIT.toUpperCase() }))).toEqual({ ok: false, code: 'COMMITTED_NO_HEAD', path: PATH });
  });

  it('refuses bytes that could not be read, and bytes over the cap counted in UTF-8 and not in characters', () => {
    expect(judgeCommittedRead(facts({ committedText: null }))).toEqual({ ok: false, code: 'COMMITTED_BYTES_UNREADABLE', path: PATH });
    const emoji = '\u{1F600}'.repeat(Math.floor(MAX_COMMITTED_FILE_BYTES / 4) + 1);
    expect(emoji.length).toBeLessThan(MAX_COMMITTED_FILE_BYTES);
    expect(judgeCommittedRead(facts({ committedText: emoji, workingTree: { state: 'file', text: emoji } }))).toEqual({ ok: false, code: 'COMMITTED_TOO_LARGE', path: PATH });
  });

  it('refuses by the size git reports before any bytes are read, and refuses a size that is not a size', () => {
    expect(judgeCommittedRead(facts({ committedSize: MAX_COMMITTED_FILE_BYTES + 1, committedText: null }))).toEqual({ ok: false, code: 'COMMITTED_TOO_LARGE', path: PATH });
    expect(judgeCommittedRead(facts({ committedSize: 13 })).ok).toBe(true);
    for (const committedSize of [-1, 1.5, '5', Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(judgeCommittedRead(facts({ committedSize }))).toEqual({ ok: false, code: 'COMMITTED_FACTS_INVALID', path: PATH });
    }
  });

  it('judges the path first, so a path that escapes reaches no other rule', () => {
    expect(judgeCommittedRead(facts({ path: '../x' }))).toEqual({ ok: false, code: 'COMMITTED_PATH_ESCAPES', path: null });
    expect(judgeCommittedRead(facts({ path: 7 }))).toEqual({ ok: false, code: 'COMMITTED_PATH_INVALID', path: null });
  });

  it('refuses facts that are not plain data: a getter, a Proxy-shaped accessor, an inherited field', () => {
    let reads = 0;
    const getter = { ...facts() } as Record<string, unknown>;
    Object.defineProperty(getter, 'committedText', { enumerable: true, get: () => (reads++ === 0 ? 'one decision\n' : 'other') });
    expect(judgeCommittedRead(getter)).toEqual({ ok: false, code: 'COMMITTED_FACTS_INVALID', path: null });
    expect(reads).toBe(0);
    const inherited = Object.create(facts()) as unknown;
    expect(judgeCommittedRead(inherited)).toEqual({ ok: false, code: 'COMMITTED_FACTS_INVALID', path: null });
    expect(judgeCommittedRead(null)).toEqual({ ok: false, code: 'COMMITTED_FACTS_INVALID', path: null });
    expect(judgeCommittedRead({ ...facts(), extra: 1 })).toEqual({ ok: false, code: 'COMMITTED_FACTS_INVALID', path: null });
    expect(judgeCommittedRead(JSON.parse(`{"__proto__":{"a":1},"path":"${PATH}"}`))).toEqual({ ok: false, code: 'COMMITTED_FACTS_INVALID', path: null });
  });
});
