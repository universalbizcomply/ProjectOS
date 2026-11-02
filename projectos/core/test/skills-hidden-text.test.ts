import { describe, expect, it } from 'vitest';
import { foldSkillLines, hiddenTextFindings } from '../src/skills/index.js';

const rules = (text: string, path = 'SKILL.md'): readonly string[] => hiddenTextFindings(path, foldSkillLines(text)).map((finding) => finding.rule);
const CHARACTERS: readonly (readonly [string, number])[] = [
  ['escape', 0x1b],
  ['null', 0],
  ['bell', 0x07],
  ['next line', 0x85],
  ['a tag character', 0xe0041],
  ['a zero-width space', 0x200b],
  ['a soft hyphen', 0xad],
  ['an interlinear annotation', 0xfff9],
  ['a right-to-left override', 0x202e],
  ['a variation selector', 0xfe0f],
  ['the grapheme joiner', 0x34f],
  ['the Hangul filler', 0x3164],
  ['the line separator', 0x2028],
  ['the paragraph separator', 0x2029],
  ['a private-use character', 0xe000],
  ['the blank Braille cell', 0x2800],
  ['the replacement character', 0xfffd],
  ['a lone surrogate', 0xd800],
];

describe('characters a reviewer would not see', () => {
  it.each(CHARACTERS)('refuses %s', (_, codepoint) => {
    expect(rules(`a${String.fromCodePoint(codepoint)}b`)).toContain('hidden-character');
  });

  it('flags the escape sequence that hides a line from a terminal reviewer', () => {
    const [finding] = hiddenTextFindings('SKILL.md', `ok\n${String.fromCodePoint(0x1b)}[2Khidden`);
    expect(finding?.rule).toBe('hidden-character');
    expect(finding?.line).toBe(2);
    expect(finding?.message).toContain('U+001B');
  });

  it('a lone carriage return is refused, because it rewrites a terminal line', () => {
    expect(rules('safe\rhidden')).toContain('hidden-character');
  });

  it('a newline, a tab and a CRLF pair are ordinary text: the positive control', () => {
    expect(rules('one\ntwo\tthree\r\nfour')).toEqual([]);
  });

  it('one leading byte-order mark is folded, and one anywhere else is refused', () => {
    const mark = String.fromCodePoint(0xfeff);
    expect(rules(`${mark}text`)).toEqual([]);
    expect(rules(`te${mark}xt`)).toContain('hidden-character');
    expect(rules(`${mark}${mark}text`)).toContain('hidden-character');
  });

  it('an emoji and accented text pass: only what cannot be read is refused', () => {
    expect(rules('naïve café 😀 日本語')).toEqual([]);
  });

  it('is judged in every kind of file', () => {
    expect(rules(`a${String.fromCodePoint(0x200b)}b`, 'references/a.txt')).toContain('hidden-character');
    expect(rules(`a${String.fromCodePoint(0x200b)}b`, 'scripts/a.py')).toContain('hidden-character');
  });
});

describe('text a rendered view drops', () => {
  it('refuses an HTML comment with or without a keyword, in any file', () => {
    expect(rules('<!-- a plain note -->')).toContain('hidden-html-comment');
    expect(rules('text <!-- trailing')).toContain('hidden-html-comment');
    expect(rules('<!-- a plain note -->', 'templates/a.html')).toContain('hidden-html-comment');
  });

  it.each(['[//]: # (a note)', '[x]: <>', "[x]: # 'a note'", '[ // ]: #', '[comment]: <> (a note)', '[x]: <#>'])('refuses the comment idiom %s', (line) => {
    expect(rules(line)).toContain('hidden-markdown-comment');
  });

  it('the comment form is refused outside Markdown too', () => {
    expect(rules('[//]: # (a note)', 'references/a.txt')).toContain('hidden-markdown-comment');
  });

  it('refuses a link reference with a title', () => {
    expect(rules('[docs]: https://x.test "a hidden title"')).toContain('hidden-link-title');
    expect(rules("[docs]: https://x.test 'a hidden title'")).toContain('hidden-link-title');
    expect(rules('[docs]: https://x.test (a hidden title)')).toContain('hidden-link-title');
  });

  it('refuses a processing instruction, a declaration and CDATA in Markdown', () => {
    expect(rules('<?php echo 1; ?>')).toContain('hidden-html-declaration');
    expect(rules('<!DOCTYPE x>')).toContain('hidden-html-declaration');
    expect(rules('<![CDATA[x]]>')).toContain('hidden-html-declaration');
  });

  it('refuses elements hidden by name, attribute or style', () => {
    for (const line of ['<style>x{}</style>', '<script>x</script>', '<span hidden>x</span>', '<p style="display:none">x</p>', "<p style='visibility: hidden'>x</p>", '<p style="font-size:0">x</p>', '<p style="opacity:0">x</p>']) {
      expect(rules(line), line).toContain('hidden-element');
    }
  });

  it('a plain link, a reference with no title and ordinary HTML pass: the positive control', () => {
    expect(rules('[the plan](docs/06_Plan.md) and 1 < 2 -- fine')).toEqual([]);
    expect(rules('[docs]: https://x.test')).toEqual([]);
    expect(rules('<p style="color: red">shown</p>')).toEqual([]);
  });

  it('a declaration in a template is not Markdown, and passes', () => {
    expect(rules('<!DOCTYPE html>', 'templates/a.html')).toEqual([]);
  });
});
