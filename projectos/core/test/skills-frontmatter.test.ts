import { describe, expect, it } from 'vitest';
import { MAX_FRONTMATTER_CHARS, frontmatterList, frontmatterText, parseSkillFrontmatter, type FrontmatterMap } from '../src/skills/index.js';
import { GOOD_SKILL_MD } from './skillFixtures.js';

const parse = (block: string, body = 'Body.\n') => parseSkillFrontmatter(`---\n${block}\n---\n${body}`);
const map = (block: string): FrontmatterMap => {
  const parsed = parse(block);
  if (!parsed.ok) throw new Error(`refused: ${parsed.rule} at ${parsed.line}`);
  return parsed.value.frontmatter;
};
const rule = (block: string): string => {
  const parsed = parse(block);
  return parsed.ok ? 'ok' : parsed.rule;
};

describe('reading a SKILL.md', () => {
  it('splits the frontmatter from the body: the positive control', () => {
    const parsed = parseSkillFrontmatter(GOOD_SKILL_MD);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(frontmatterText(parsed.value.frontmatter, 'name')).toBe('release-notes');
    expect(frontmatterList(parsed.value.frontmatter, 'tags')).toEqual(['writing', 'release']);
    expect(parsed.value.body.startsWith('# Release notes')).toBe(true);
    expect(parsed.value.bodyLine).toBe(9);
  });

  it('reads Windows line endings as line endings', () => {
    const parsed = parseSkillFrontmatter(GOOD_SKILL_MD.replace(/\n/g, '\r\n'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(frontmatterText(parsed.value.frontmatter, 'description')).toBe('Drafts release notes from merged work.');
    expect(parsed.value.body.includes('\r')).toBe(false);
  });

  it('tolerates one leading byte-order mark, as a Windows editor writes it', () => {
    expect(parseSkillFrontmatter(`${String.fromCodePoint(0xfeff)}${GOOD_SKILL_MD}`).ok).toBe(true);
  });

  it('keeps every value a string: nothing is coerced', () => {
    const read = map('version: 1.10\nenabled: no\ncount: 007');
    expect(read.get('version')).toBe('1.10');
    expect(read.get('enabled')).toBe('no');
    expect(read.get('count')).toBe('007');
  });

  it('reads block text, quotes, both list forms and nesting', () => {
    expect(map('a: |\n  one\n  two').get('a')).toBe('one\ntwo');
    expect(map('a: >-\n  one\n  two').get('a')).toBe('one two');
    expect(map("a: 'it''s'").get('a')).toBe("it's");
    expect(map('a: "x\\ty\\n"').get('a')).toBe('x\ty\n');
    expect(map('a:\n  - one\n  - two').get('a')).toEqual(['one', 'two']);
    expect(map('a:\n- one\nb: two').get('a')).toEqual(['one']);
    expect(map("a: [one, 'two, three', \"four\"]").get('a')).toEqual(['one', 'two, three', 'four']);
    expect(map('a: []').get('a')).toEqual([]);
    const nested = map('metadata:\n  tags: [one]').get('metadata') as FrontmatterMap;
    expect(nested.get('tags')).toEqual(['one']);
  });

  it('a lone scalar reads as a list of one, and a list is not text', () => {
    const read = map('platforms: linux\ntags: [a]');
    expect(frontmatterList(read, 'platforms')).toEqual(['linux']);
    expect(frontmatterText(read, 'tags')).toBeNull();
    expect(frontmatterList(read, 'absent')).toEqual([]);
  });
});

describe('what is refused, by name', () => {
  it('refuses a file with no frontmatter, where upstream read the whole file as body', () => {
    const parsed = parseSkillFrontmatter('# Just a heading\n');
    expect(parsed.ok ? 'ok' : parsed.rule).toBe('frontmatter-missing');
    const fenced = parseSkillFrontmatter('---foo\nname: x\n---\n');
    expect(fenced.ok ? 'ok' : fenced.rule).toBe('frontmatter-missing');
  });

  it('refuses an unclosed block', () => {
    const parsed = parseSkillFrontmatter('---\nname: x\n');
    expect(parsed.ok ? 'ok' : parsed.rule).toBe('frontmatter-unclosed');
  });

  it('refuses a block over the cap, and one at the cap is read', () => {
    const fits = `a: ${'x'.repeat(MAX_FRONTMATTER_CHARS - 'a: '.length - 1)}`;
    expect(rule(fits)).toBe('ok');
    expect(rule(`${fits}x`)).toBe('frontmatter-too-long');
  });

  it('refuses a duplicate key: two parsers would read two different skills', () => {
    expect(rule('name: one\nname: two')).toBe('frontmatter-duplicate-key');
    expect(rule('a:\n  b: 1\n  b: 2')).toBe('frontmatter-duplicate-key');
  });

  it('refuses the YAML forms that multiply text or run it', () => {
    for (const block of ['a: &anchor value', 'a: *alias', 'a: !!python/object x', 'a: {b: c}', '<<: *base', 'a: |+\n  x', 'a: |2\n  x', 'a: [[x]]', 'a: "\\u001b"', 'a: "\\e"', 'a:\n  - b: c', 'a:\n  - - b']) {
      expect(rule(block), block).toBe('frontmatter-unsupported');
    }
  });

  it('refuses a comment: no parsed view would show it', () => {
    expect(rule('# hidden\nname: x')).toBe('frontmatter-comment');
    expect(rule('a:\n  - one\n  # hidden')).toBe('frontmatter-comment');
  });

  it('refuses text that is not the subset, where upstream fell back to splitting on colons', () => {
    for (const block of ['name', ': x', '"name": x', '__proto__: x', 'name:x', '\tname: x', '  name: x', 'a: "open', "a: 'open", 'a: "x" y', 'a: [x', 'a: [x,,y]', 'a: b\n   c: d']) {
      expect(rule(block), block).toBe('frontmatter-syntax');
    }
  });

  it('refuses nesting past the cap, and the deepest allowed level is read', () => {
    expect(rule('a:\n  b:\n    c:\n      d: e')).toBe('ok');
    expect(rule('a:\n  b:\n    c:\n      d:\n        e: f')).toBe('frontmatter-too-deep');
  });

  it('names the line it refused', () => {
    const parsed = parse('name: one\nname: two');
    expect(parsed.ok ? 0 : parsed.line).toBe(3);
  });
});

describe('hostile input', () => {
  const quick = (work: () => unknown): void => {
    const started = performance.now();
    work();
    expect(performance.now() - started).toBeLessThan(1000);
  };

  it('stays linear on the shapes that break a naive parser', () => {
    const size = 2_000_000;
    quick(() => parseSkillFrontmatter('---\n'.repeat(size / 4)));
    quick(() => parseSkillFrontmatter(`---\n${'a: b\n'.repeat(size / 5)}`));
    quick(() => parseSkillFrontmatter(`---\n${' '.repeat(size)}\n---\n`));
    quick(() => parseSkillFrontmatter(`---\na: [${'['.repeat(MAX_FRONTMATTER_CHARS - 10)}]\n---\n`));
    quick(() => parseSkillFrontmatter(`---\na: "${'\\'.repeat(MAX_FRONTMATTER_CHARS - 10)}\n---\n`));
    quick(() => parseSkillFrontmatter('\r\n'.repeat(size / 2)));
  });

  it('a prototype key cannot reach an object', () => {
    expect(map('constructor: x\ntoString: y').get('constructor')).toBe('x');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
