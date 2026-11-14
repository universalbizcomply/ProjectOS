import { describe, expect, it } from 'vitest';
import { searchIndexFileName } from '../src/index.js';

const nameOf = (tenant: string, project: string): string => {
  const result = searchIndexFileName({ tenant, project });
  if (!result.ok) throw new Error(result.reason);
  return result.fileName;
};

describe('the file that holds one project index', () => {
  it('is a hash name with no id text, no separator and no dot segment: the positive control', () => {
    expect(nameOf('agency-one', 'alpha-project')).toMatch(/^idx-[0-9a-f]{64}\.sqlite$/);
  });

  it('is the same for the same pair, and differs for any other', () => {
    expect(nameOf('agency-one', 'alpha-project')).toBe(nameOf('agency-one', 'alpha-project'));
    expect(nameOf('agency-one', 'alpha-project')).not.toBe(nameOf('agency-one', 'beta-project'));
    expect(nameOf('agency-one', 'alpha-project')).not.toBe(nameOf('agency-two', 'alpha-project'));
  });

  it('keeps two pairs apart when their ids run together into one string', () => {
    expect(nameOf('agency-one', 'two-alpha')).not.toBe(nameOf('agency-one-two', 'alpha'));
    expect(nameOf('ab-cd', 'ef')).not.toBe(nameOf('ab', 'cd-ef'));
  });

  it('keeps two spellings apart that a case-folding file system would join', () => {
    expect(nameOf('agency-one', 'Alpha-project').toLowerCase()).not.toBe(nameOf('agency-one', 'alpha-project').toLowerCase());
  });

  it.each([
    ['a path climb', '../x'],
    ['a separator', 'a/b'],
    ['a backslash', 'a\b'],
    ['a drive', 'C:x'],
    ['a dot only', '..'],
    ['an empty string', ''],
    ['a newline', 'a\nb'],
    ['a NUL', 'a\0b'],
    ['a space', 'a b'],
    ['a long id', 'a'.repeat(65)],
  ])('refuses %s as a project id', (_label, project) => {
    expect(searchIndexFileName({ tenant: 'agency-one', project })).toEqual({ ok: false, reason: 'invalid-project' });
  });

  it.each([['a path climb', '../x'], ['upper case', 'Agency'], ['an empty string', ''], ['a separator', 'a/b'], ['a one-letter id', 'a']])('refuses %s as a tenant id', (_label, tenant) => {
    expect(searchIndexFileName({ tenant, project: 'alpha-project' })).toEqual({ ok: false, reason: 'invalid-tenant' });
  });

  it('refuses a value that is not text at all', () => {
    expect(searchIndexFileName({ tenant: 7 as unknown as string, project: 'alpha-project' }).ok).toBe(false);
    expect(searchIndexFileName({ tenant: 'agency-one', project: null as unknown as string }).ok).toBe(false);
  });
});
