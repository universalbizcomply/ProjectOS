import { describe, expect, it } from 'vitest';
import { beginStoreGuard, endStoreGuard, porcelainZPaths, type StoreGuardSystem } from '../src/context/contextStoreGuard.js';
import { ROOT, memoryFs } from './support/contextWorld.js';

const MEMORY = `${ROOT}/.projectops/memory/MEMORY.md`;
const SKILL = `${ROOT}/.projectops/skills/promoted/x/SKILL.md`;

/** A project whose `git status` and files the test changes between `begin` and `end`. */
function world(initialFiles: Record<string, string> = {}) {
  const state = { files: { ...initialFiles } as Record<string, string>, status: '' as string | null, statusCalls: [] as string[] };
  const sys: StoreGuardSystem = {
    exec: (_cmd, args) => {
      state.statusCalls.push(args.join(' '));
      return state.status === null ? { code: 128, stdout: '' } : { code: 0, stdout: state.status };
    },
  };
  const fs = { stat: (path: string) => memoryFs(state.files).stat(path), readText: (path: string) => memoryFs(state.files).readText(path), listDir: (path: string) => memoryFs(state.files).listDir(path) };
  return { state, sys, fs };
}

describe('porcelain -z paths, with both sides of a rename', () => {
  it('lists every path, and both the new and the old name of a rename', () => {
    expect(porcelainZPaths('?? a.txt\0 M src/b.ts\0R  new name.md\0old name.md\0')).toEqual(['a.txt', 'src/b.ts', 'new name.md', 'old name.md']);
    expect(porcelainZPaths('')).toEqual([]);
    expect(porcelainZPaths('C  copy.md\0source.md\0')).toEqual(['copy.md', 'source.md']);
  });

  it('refuses output it cannot read as complete: a rename with no old name, a short entry', () => {
    expect(porcelainZPaths('R  new.md\0')).toBeNull();
    expect(porcelainZPaths('??\0')).toBeNull();
    expect(porcelainZPaths('?? a\0b')).toBeNull();
  });

  it('is bounded: a status of more than 100,000 paths is refused unread', () => {
    const many = Array.from({ length: 100_001 }, (_, index) => `?? f${index}\0`).join('');
    const started = Date.now();
    expect(porcelainZPaths(many)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('a worker does not write memory or skills: refused where its changes are judged', () => {
  it('asks git for every path, untracked files one by one, in the null-separated form', () => {
    const w = world();
    beginStoreGuard(w.sys, ROOT, w.fs);
    expect(w.state.statusCalls[0]).toContain('status --porcelain -z --untracked-files=all');
  });

  it('passes a run that touched neither store', () => {
    const w = world({ [`${ROOT}/src/a.ts`]: 'a' });
    const before = beginStoreGuard(w.sys, ROOT, w.fs);
    w.state.status = ' M src/a.ts\0?? src/new.ts\0';
    expect(endStoreGuard(w.sys, ROOT, w.fs, before)).toEqual({ ok: true });
  });

  it.each([
    ['a new memory file', '?? .projectops/memory/MEMORY.md\0'],
    ['an edited memory file', ' M .projectops/memory/MEMORY.md\0'],
    ['a skill file', '?? .projectops/skills/promoted/x/SKILL.md\0'],
    ['a proposal file written around the door', '?? .projectops/memory/proposals/p.json\0'],
    ['a case variant', '?? .PROJECTOPS/Memory/x.md\0'],
    ['the new name of a moved store file', 'R  moved.md\0.projectops/memory/MEMORY.md\0'],
    ['the old name of a file moved into a store', 'R  .projectops/skills/x.md\0notes.md\0'],
    ['a directory above a store', '?? .projectops/\0'],
  ])('refuses %s', (_name, status) => {
    const w = world();
    const before = beginStoreGuard(w.sys, ROOT, w.fs);
    w.state.status = status;
    expect(endStoreGuard(w.sys, ROOT, w.fs, before)).toMatchObject({ ok: false, code: 'MEMORY_DIRECT_WRITE' });
  });

  it('does not blame the worker for a store path that was already changed before it ran, and sees it changed again', () => {
    const w = world({ [MEMORY]: 'one' });
    w.state.status = ' M .projectops/memory/MEMORY.md\0';
    const before = beginStoreGuard(w.sys, ROOT, w.fs);
    expect(endStoreGuard(w.sys, ROOT, w.fs, before)).toEqual({ ok: true });
    w.state.files[MEMORY] = 'two';
    expect(endStoreGuard(w.sys, ROOT, w.fs, before)).toMatchObject({ ok: false, code: 'MEMORY_STORE_CHANGED' });
  });

  it('sees a write that git does not: an ignored store, by its digest', () => {
    const w = world({ [MEMORY]: 'one', [SKILL]: 'skill' });
    const before = beginStoreGuard(w.sys, ROOT, w.fs);
    w.state.files[SKILL] = 'a skill the worker wrote';
    w.state.status = '';
    expect(endStoreGuard(w.sys, ROOT, w.fs, before)).toMatchObject({ ok: false, code: 'MEMORY_STORE_CHANGED' });
  });

  it('sees a file added to a store that git ignores', () => {
    const w = world();
    const before = beginStoreGuard(w.sys, ROOT, w.fs);
    w.state.files[MEMORY] = 'a memory the worker wrote';
    expect(endStoreGuard(w.sys, ROOT, w.fs, before)).toMatchObject({ ok: false, code: 'MEMORY_STORE_CHANGED' });
  });

  it('clears nothing it could not check: git failing, a status it cannot read, a digest it could not take', () => {
    const w = world();
    const before = beginStoreGuard(w.sys, ROOT, w.fs);
    w.state.status = null;
    expect(endStoreGuard(w.sys, ROOT, w.fs, before)).toMatchObject({ ok: false, code: 'MEMORY_STORE_UNCHECKED' });
    w.state.status = 'R  new.md\0';
    expect(endStoreGuard(w.sys, ROOT, w.fs, before)).toMatchObject({ ok: false, code: 'MEMORY_STORE_UNCHECKED' });

    const broken = world();
    broken.state.status = null;
    const unchecked = beginStoreGuard(broken.sys, ROOT, broken.fs);
    broken.state.status = '';
    expect(endStoreGuard(broken.sys, ROOT, broken.fs, unchecked)).toMatchObject({ ok: false, code: 'MEMORY_STORE_UNCHECKED' });

    const linked = world();
    const refusing = { ...linked.fs, stat: (path: string) => (path.endsWith('.projectops') ? { kind: 'link' as const, size: 0, mtimeMs: 1 } : linked.fs.stat(path)) };
    const noDigest = beginStoreGuard(linked.sys, ROOT, refusing);
    expect(endStoreGuard(linked.sys, ROOT, refusing, noDigest)).toMatchObject({ ok: false, code: 'MEMORY_STORE_UNCHECKED' });
  });

  it('a refusal names paths and never quotes a file', () => {
    const w = world({ [MEMORY]: 'SECRET MEMORY BODY' });
    const before = beginStoreGuard(w.sys, ROOT, w.fs);
    w.state.files[MEMORY] = 'SECRET MEMORY BODY, edited';
    const verdict = endStoreGuard(w.sys, ROOT, w.fs, before);
    expect(JSON.stringify(verdict)).not.toContain('SECRET MEMORY BODY');
  });
});
