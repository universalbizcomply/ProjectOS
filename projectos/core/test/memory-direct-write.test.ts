import { describe, expect, it } from 'vitest';
import { checkNoDirectStoreWrites } from '../src/memory/directWrite.js';

const refused = (paths: readonly unknown[]) => {
  const result = checkNoDirectStoreWrites(paths);
  if (result.ok) throw new Error('expected a refusal');
  return result;
};

describe('a worker writing the memory or skill store directly is refused', () => {
  it('clears a run that changed neither store: the positive control', () => {
    expect(checkNoDirectStoreWrites(['docs/06_Plan.md', 'projectos/core/src/a.ts', '.projectops/execution/x.findings.json', 'src/.projectops/memory.txt'])).toEqual({ ok: true });
    expect(checkNoDirectStoreWrites([])).toEqual({ ok: true });
  });

  it.each([
    ['a memory store file', '.projectops/memory/MEMORY.md', 'inside-memory-store'],
    ['the user store', '.projectops/memory/USER.md', 'inside-memory-store'],
    ['a provenance file', '.projectops/memory/MEMORY.provenance.json', 'inside-memory-store'],
    ['a queue proposal file', '.projectops/memory/proposals/mem-000000000000000000000000.json', 'inside-memory-store'],
    ['the directory itself', '.projectops/memory', 'inside-memory-store'],
    ['a promoted skill', '.projectops/skills/promoted/review.json', 'inside-skill-store'],
    ['a skill proposal', '.projectops/skills/proposals/skl-000000000000000000000000.json', 'inside-skill-store'],
  ])('refuses %s', (_label, path, reason) => {
    const result = refused([path]);
    expect(result.code).toBe('MEMORY_DIRECT_WRITE');
    expect(result.direct).toEqual([{ path, reason }]);
  });

  it.each([
    ['backslashes', '.projectops\\memory\\MEMORY.md'],
    ['a leading dot segment', './.projectops/memory/MEMORY.md'],
    ['doubled separators', '.projectops//memory///MEMORY.md'],
    ['a climb that comes back', 'docs/../.projectops/memory/MEMORY.md'],
    ['another case', '.ProjectOps/MEMORY/memory.md'],
    ['a trailing dot a Windows path drops', '.projectops./memory./MEMORY.md'],
    ['trailing spaces a Windows path drops', '.projectops /memory /MEMORY.md'],
    ['a dot in the middle', '.projectops/./memory/MEMORY.md'],
  ])('refuses the same path spelled with %s', (_label, path) => {
    expect(refused([path]).direct).toHaveLength(1);
  });

  it('names a skill store hit apart from a memory store hit, and reports every path', () => {
    const result = refused(['a.ts', '.projectops/memory/MEMORY.md', '.projectops/skills/promoted/x.json']);
    expect(result.direct.map((finding) => finding.reason)).toEqual(['inside-memory-store', 'inside-skill-store']);
  });

  it('a neighbouring name is not the store: the positive control', () => {
    expect(checkNoDirectStoreWrites(['.projectops/memory-notes.md', '.projectops/skills.json', '.projectops/memoryx/a', 'x/.projectops/memory/a'])).toEqual({ ok: true });
  });
});

describe('a path that cannot be judged is refused, not passed', () => {
  it.each([
    ['an absolute path', '/etc/passwd', 'absolute-path'],
    ['a drive path', 'C:\\work\\.projectops\\memory\\MEMORY.md', 'absolute-path'],
    ['a climb out of the project', '../outside/.projectops/memory/MEMORY.md', 'outside-project'],
    ['a climb that starts inside and leaves', 'a/../../x', 'outside-project'],
  ])('refuses %s', (_label, path, reason) => {
    const result = refused([path]);
    expect(result.unjudgeable.map((entry) => entry.reason)).toEqual([reason]);
    expect(result.direct).toEqual([]);
  });

  it.each([[42], [null], [undefined], [''], ['   '], [{ toString: () => '.projectops/memory/a' }]])('refuses %j as not a path', (value) => {
    expect(refused([value]).unjudgeable.map((entry) => entry.reason)).toEqual(['not-a-path']);
  });

  it('refuses a run with more paths than can be judged, unread', () => {
    const many = Array.from({ length: 20_001 }, (_, index) => `f${index}.ts`);
    expect(refused(many).unjudgeable).toEqual([{ path: null, reason: 'not-a-path' }]);
    expect(checkNoDirectStoreWrites(many.slice(0, 20_000))).toEqual({ ok: true });
  });

  it('refuses a value that is not a list', () => {
    expect(checkNoDirectStoreWrites('.projectops/memory/a' as unknown as readonly string[]).ok).toBe(false);
  });

  it('a very long path is cut in the report and still refused', () => {
    const long = `${'a/'.repeat(600)}x`;
    expect(refused([long]).unjudgeable[0]?.path?.length).toBeLessThanOrEqual(80);
  });
});

describe('the refusal tells and does not quote', () => {
  it('carries a code for the audit record and a message that names no path text', () => {
    const result = refused(['.projectops/memory/MEMORY.md']);
    expect(result.code).toBe('MEMORY_DIRECT_WRITE');
    expect(result.message).toContain('proposals');
    expect(result.message).not.toContain('MEMORY.md');
  });
});
