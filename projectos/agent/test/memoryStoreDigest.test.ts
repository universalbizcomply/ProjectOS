import { describe, expect, it } from 'vitest';
import {
  MAX_STORE_DIGEST_FILES,
  MAX_STORE_DIGEST_TOTAL_BYTES,
  checkStoreUnchanged,
  snapshotMemoryStores,
  type MemoryStoreSnapshotResult,
} from '../src/memory/index.js';
import type { DocumentFs, EntryStat } from '../src/search/index.js';

const ROOT = '/w';

/** An in-memory file system: files by absolute path, links and other entries by absolute path, every parent implied. */
function memoryFs(files: Record<string, string>, links: readonly string[] = [], others: readonly string[] = [], unreadable: readonly string[] = [], reverse = false): DocumentFs {
  const directories = new Set<string>();
  for (const path of [...Object.keys(files), ...links, ...others]) {
    const parts = path.split('/');
    for (let length = 1; length < parts.length; length += 1) directories.add(parts.slice(0, length).join('/'));
  }
  return {
    stat: (path): EntryStat | null => {
      if (links.includes(path)) return { kind: 'link', size: 0, mtimeMs: 1 };
      if (others.includes(path)) return { kind: 'other', size: 0, mtimeMs: 1 };
      if (path in files) return { kind: 'file', size: (files[path] ?? '').length, mtimeMs: 1 };
      return directories.has(path) ? { kind: 'directory', size: 0, mtimeMs: 1 } : null;
    },
    readText: (path) => (unreadable.includes(path) ? null : (files[path] ?? null)),
    listDir: (path) => {
      const prefix = `${path}/`;
      const names = [...new Set([...Object.keys(files), ...links, ...others, ...directories].filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length).split('/')[0] ?? ''))].filter((name) => name !== '');
      return reverse ? names.reverse() : names;
    },
  };
}

const STORE = `${ROOT}/.projectops/memory/MEMORY.md`;
const PROVENANCE = `${ROOT}/.projectops/memory/MEMORY.provenance.json`;
const SKILL = `${ROOT}/.projectops/skills/promoted/review.json`;
const base = (): Record<string, string> => ({
  [STORE]: 'The build uses Node 24.',
  [PROVENANCE]: '{"entries":{}}',
  [SKILL]: '{"name":"review"}',
  [`${ROOT}/.projectops/execution/a.session.json`]: '{"x":1}',
  [`${ROOT}/docs/a.md`]: 'not a store',
});
const snap = (files: Record<string, string>, links: readonly string[] = [], others: readonly string[] = [], unreadable: readonly string[] = [], reverse = false): MemoryStoreSnapshotResult =>
  snapshotMemoryStores(ROOT, memoryFs(files, links, others, unreadable, reverse));
const changeOf = (before: MemoryStoreSnapshotResult, after: MemoryStoreSnapshotResult) => checkStoreUnchanged(before, after);

describe('a digest of the memory and skill stores, taken through a port, with no git in it (fix round 1, M7)', () => {
  it('digests both stores, and the same tree gives the same digest in any listing order', () => {
    const first = snap(base());
    const second = snap(base(), [], [], [], true);

    expect(first.ok && second.ok && first.snapshot.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.ok && second.ok && first.snapshot.digest === second.snapshot.digest).toBe(true);
    expect(first.ok && first.snapshot.files.map((file) => file.path)).toEqual([
      '.projectops/memory',
      '.projectops/memory/MEMORY.md',
      '.projectops/memory/MEMORY.provenance.json',
      '.projectops/skills',
      '.projectops/skills/promoted',
      '.projectops/skills/promoted/review.json',
    ]);
    expect(checkStoreUnchanged(first, second)).toEqual({ ok: true });
  });

  it('a change anywhere else is not a change to the stores: the positive control', () => {
    const files = { ...base(), [`${ROOT}/docs/a.md`]: 'edited', [`${ROOT}/.projectops/execution/b.json`]: '{}' };

    expect(changeOf(snap(base()), snap(files))).toEqual({ ok: true });
  });

  it('refuses a changed file, by path, with one character flipped and the size unchanged', () => {
    const flipped = { ...base(), [STORE]: 'The build uses Node 25.' };

    expect(changeOf(snap(base()), snap(flipped))).toMatchObject({ ok: false, code: 'MEMORY_STORE_CHANGED', changed: ['.projectops/memory/MEMORY.md'], added: [], removed: [] });
  });

  it('refuses an added file and a removed file, and a store that appears', () => {
    const added = { ...base(), [`${ROOT}/.projectops/memory/proposals/mem-0.json`]: '{}' };
    const removed = { ...base() };
    delete removed[PROVENANCE];

    expect(changeOf(snap(base()), snap(added))).toMatchObject({ ok: false, added: ['.projectops/memory/proposals', '.projectops/memory/proposals/mem-0.json'] });
    expect(changeOf(snap(base()), snap(removed))).toMatchObject({ ok: false, removed: ['.projectops/memory/MEMORY.provenance.json'] });
    expect(changeOf(snap({ [`${ROOT}/docs/a.md`]: 'x' }), snap(base()))).toMatchObject({ ok: false, code: 'MEMORY_STORE_CHANGED' });
    expect(changeOf(snap(base()), snap({ [`${ROOT}/docs/a.md`]: 'x' }))).toMatchObject({ ok: false, code: 'MEMORY_STORE_CHANGED' });
  });

  it('a project with neither store has a digest, and it stays the same', () => {
    expect(changeOf(snap({ [`${ROOT}/docs/a.md`]: 'x' }), snap({ [`${ROOT}/docs/a.md`]: 'y' }))).toEqual({ ok: true });
  });

  it.each([
    ['a linked memory directory', [`${ROOT}/.projectops/memory`]],
    ['a linked .projectops', [`${ROOT}/.projectops`]],
    ['a linked skills directory', [`${ROOT}/.projectops/skills`]],
    ['a linked file inside a store', [`${ROOT}/.projectops/memory/MEMORY.md`]],
    ['a linked directory inside a store', [`${ROOT}/.projectops/skills/promoted`]],
  ])('refuses %s, and follows nothing', (_label, links) => {
    const files = { ...base() };
    for (const link of links) delete files[link];
    const result = snap(files, links);

    expect(result).toMatchObject({ ok: false, code: 'MEMORY_STORE_LINK' });
  });

  it('refuses an entry that is neither a file nor a directory, and a file that cannot be read', () => {
    expect(snap(base(), [], [`${ROOT}/.projectops/memory/pipe`])).toMatchObject({ ok: false, code: 'MEMORY_STORE_UNREADABLE' });
    expect(snap(base(), [], [], [STORE])).toMatchObject({ ok: false, code: 'MEMORY_STORE_UNREADABLE', path: '.projectops/memory/MEMORY.md' });
  });

  it('refuses a store with more files than the bound, and one with more bytes', () => {
    const many: Record<string, string> = {};
    for (let index = 0; index <= MAX_STORE_DIGEST_FILES; index += 1) many[`${ROOT}/.projectops/memory/f${index}.json`] = '{}';
    const wide: Record<string, string> = { [STORE]: 'x'.repeat(Math.floor(MAX_STORE_DIGEST_TOTAL_BYTES / 2) + 1), [PROVENANCE]: 'y'.repeat(Math.floor(MAX_STORE_DIGEST_TOTAL_BYTES / 2) + 1) };

    expect(snap(many)).toMatchObject({ ok: false, code: 'MEMORY_STORE_TOO_LARGE' });
    expect(snap(wide)).toMatchObject({ ok: false, code: 'MEMORY_STORE_TOO_LARGE' });
  });

  it('a refused snapshot on either side refuses the comparison, so a check that could not look does not pass', () => {
    const good = snap(base());
    const bad = snap(base(), [`${ROOT}/.projectops/memory`]);

    expect(checkStoreUnchanged(good, bad)).toMatchObject({ ok: false, code: 'MEMORY_STORE_UNCHECKED' });
    expect(checkStoreUnchanged(bad, good)).toMatchObject({ ok: false, code: 'MEMORY_STORE_UNCHECKED' });
    expect(checkStoreUnchanged(bad, bad)).toMatchObject({ ok: false, code: 'MEMORY_STORE_UNCHECKED' });
  });

  it('a refusal names paths and never a file\'s text', () => {
    const secret = 'THE-TEXT-OF-A-STORE-FILE';
    const result = changeOf(snap({ ...base(), [STORE]: 'a' }), snap({ ...base(), [STORE]: secret }));

    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('does not run git, a shell or anything: it reads only through the port it is given', () => {
    const calls: string[] = [];
    const fs = memoryFs(base());
    const watching: DocumentFs = { readText: (path) => (calls.push(`read ${path}`), fs.readText(path)), listDir: (path) => (calls.push(`list ${path}`), fs.listDir(path)), stat: (path) => (calls.push(`stat ${path}`), fs.stat(path)) };

    snapshotMemoryStores(ROOT, watching);

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => /^(?:read|list|stat) \/w\/\.projectops/.test(call))).toBe(true);
  });
});
