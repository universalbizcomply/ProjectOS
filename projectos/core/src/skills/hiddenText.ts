// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/skills_guard.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: the list of seventeen invisible characters replaced by Unicode classes, the same ones memory refuses, and extended to surrogates, private use, the replacement character and the blank Braille cell; comments and other text a rendered view drops are refused with or without a keyword; a finding refuses, and no path or trust level skips it
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * Text a reviewer would not see.
 *
 * An approval covers the bytes, so what the reviewer cannot read must not be promoted at all. These are the
 * classes memory refuses, by the same reasoning, and they are refused in every file of a package:
 *
 *  - `Cc` except the newline and the tab, because an escape sequence or a lone carriage return can rewrite a
 *    terminal line. A CRLF pair is a line ending and is folded first; a lone CR is not.
 *  - `Cf`, default-ignorable, U+2028 and U+2029: zero-width, bidirectional, tag and filler characters.
 *  - Surrogates, private use, U+FFFD and U+2800. A lone surrogate hashes as U+FFFD, so two different texts
 *    could share a pin, and the others render as nothing or as noise.
 *
 * WHAT A RENDERED VIEW DROPS. An HTML comment, in any file. In Markdown, also `<?`, `<!X`, `<![`, the
 * `[//]: #` family of link references used as comments (`[x]: <>`, `[x]: # 'y'`, `[ // ]: #`), any link
 * reference carrying a title, and elements hidden by attribute or style. These are refused with no keyword
 * needed, because the keyword is what the attacker controls.
 *
 * A PATTERN LIST PROVES NOTHING. A clean result here means none of these forms was found.
 */
import { blockingFinding, type SkillFinding } from './refusal.js';

const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);
const BRAILLE_BLANK = String.fromCodePoint(0x2800);
const REPLACEMENT = String.fromCodePoint(0xfffd);

const HIDDEN_CHARACTER = new RegExp(
  `(?![\\n\\t])[\\p{Cc}\\p{Cf}\\p{Cs}\\p{Co}\\p{Default_Ignorable_Code_Point}\\p{Zl}\\p{Zp}${BRAILLE_BLANK}${REPLACEMENT}]`,
  'u',
);
const HTML_COMMENT = /<!--/;
/** The tags that fence untrusted text in a prompt. Text that quotes one is trying to leave its fence. */
const FENCE_FORGERY = /[<＜][^a-z0-9\n]{0,32}untrusted[^a-z0-9\n]{0,8}(?:skill|memory|turn|summary)/i;
/** The character references a reader would read as the characters of a tag: numeric, hexadecimal and the few named ones. Decoded twice, for `&amp;lt;`. */
const CHARACTER_REFERENCE = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(lt|gt|sol|amp|quot|apos|nbsp|colon|period|hyphen|dash));/g;
const NAMED_REFERENCES: Readonly<Record<string, string>> = { lt: '<', gt: '>', sol: '/', amp: '&', quot: '"', apos: "'", nbsp: ' ', colon: ':', period: '.', hyphen: '-', dash: '-' };
/**
 * The section titles of the file the context manager writes. A skill's line that starts as one of them, as an ATX heading (any number of hashes, a
 * list marker or a quote before it, emphasis or escapes inside it) or as a setext heading (the title, then a line of `=` or `-`), is a heading the
 * reader could take for the file's own, so it is refused. A heading inside a fence is still text the reader sees.
 */
const SECTION_TITLES: readonly string[] = ['committed decisions', 'approved memory decisions', 'promoted skills', 'items left out', 'other stored items', 'stored context'];
const HEADING_PREFIX = /^[ \t>]{0,8}(?:(?:[-*+]|\d{1,9}[.)])[ \t]+){0,3}#{1,6}[ \t]+/;
const SETEXT_UNDERLINE = /^[ \t]{0,3}(?:=+|-+)[ \t]*$/;
const EMPHASIS_OR_ESCAPE = /[*_\\`~]/g;
const MARKDOWN_COMMENT_ANYWHERE = /\[\/\/\]:/;
const RENDERER_DROPS = /<\?|<!\[|<![A-Za-z]/;
/** `[label]: <>` and `[label]: #`, the comment idiom, with or without text after it. */
const REFERENCE_AS_COMMENT = /^ {0,3}\[[^\]\n]{0,512}\]:[ \t]*(?:<[ \t]*#?[ \t]*>|#)/;
/** `[label]: target "text"`: the text shows only as a tooltip, or not at all. */
const REFERENCE_WITH_TITLE = /^ {0,3}\[[^\]\n]{0,512}\]:[ \t]*\S{1,2048}[ \t]+["'(]/;
const HIDDEN_ELEMENT =
  /<[ \t]*(?:style|script|template|noscript|iframe|object|embed)\b|<[A-Za-z][^>\n]{0,512}[ \t](?:hidden\b|style[ \t]*=[ \t]*["'][^"'\n]{0,512}(?:display[ \t]*:[ \t]*none|visibility[ \t]*:[ \t]*hidden|font-size[ \t]*:[ \t]*0|opacity[ \t]*:[ \t]*0))/i;

const startsAsSectionTitle = (text: string): boolean => {
  const plain = text.replace(EMPHASIS_OR_ESCAPE, '').trimStart().toLowerCase();
  return SECTION_TITLES.some((title) => plain.startsWith(title) && !/[a-z0-9]/.test(plain.charAt(title.length)));
};

/** Does this line start as a heading of the context file? `next` is the line after it, for the setext form. Every step is bounded by the line. */
function forgesSectionHeading(line: string, next: string | undefined): boolean {
  const folded = line.normalize('NFKC');
  const prefix = HEADING_PREFIX.exec(folded);
  if (prefix !== null) return startsAsSectionTitle(folded.slice(prefix[0].length));
  return next !== undefined && SETEXT_UNDERLINE.test(next.normalize('NFKC')) && startsAsSectionTitle(folded.replace(/^[ \t>]{0,8}/, ''));
}

function decodedReferences(line: string): string {
  const once = (text: string): string =>
    text.replace(CHARACTER_REFERENCE, (_whole, decimal: string | undefined, hexadecimal: string | undefined, named: string | undefined) => {
      if (named !== undefined) return NAMED_REFERENCES[named] ?? '';
      const code = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hexadecimal as string, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
  return once(once(line));
}

/** A leading byte-order mark and CRLF endings, which Windows editors add. Nothing else is folded. */
export function foldSkillLines(text: string): string {
  const body = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
  return body.replace(/\r\n/g, '\n');
}

const isMarkdown = (path: string): boolean => path.toLowerCase().endsWith('.md');
const hex = (character: string): string => (character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');

function hiddenInLine(path: string, line: string, lineNumber: number, markdown: boolean, next: string | undefined): readonly SkillFinding[] {
  const character = HIDDEN_CHARACTER.exec(line)?.[0];
  return [
    ...(character === undefined ? [] : [blockingFinding('hidden-character', path, lineNumber, `Line ${lineNumber} holds U+${hex(character)}, which a reviewer would not see.`)]),
    // The tag is looked for as written and as the NFKC fold reads it, with any dash or space between its words: a non-breaking hyphen or a full-width `<` is the same tag to a reader.
    ...(FENCE_FORGERY.test(line) || FENCE_FORGERY.test(line.normalize('NFKC')) || FENCE_FORGERY.test(decodedReferences(line).normalize('NFKC')) ? [blockingFinding('fence-forgery', path, lineNumber, 'This text writes the tag that fences untrusted text in a prompt.')] : []),
    ...(markdown && forgesSectionHeading(line, next) ? [blockingFinding('section-heading-forgery', path, lineNumber, 'This line starts as a section heading of the file the context manager writes.')] : []),
    ...(HTML_COMMENT.test(line) ? [blockingFinding('hidden-html-comment', path, lineNumber, 'An HTML comment holds text a rendered view does not show.')] : []),
    ...(MARKDOWN_COMMENT_ANYWHERE.test(line) || (markdown && REFERENCE_AS_COMMENT.test(line))
      ? [blockingFinding('hidden-markdown-comment', path, lineNumber, 'A link reference used as a comment holds text a rendered view does not show.')]
      : []),
    ...(markdown && REFERENCE_WITH_TITLE.test(line) ? [blockingFinding('hidden-link-title', path, lineNumber, 'A link reference title is text a rendered view does not show.')] : []),
    ...(markdown && RENDERER_DROPS.test(line) ? [blockingFinding('hidden-html-declaration', path, lineNumber, 'A processing instruction or declaration is text a rendered view drops.')] : []),
    ...(markdown && HIDDEN_ELEMENT.test(line) ? [blockingFinding('hidden-element', path, lineNumber, 'This element is hidden from a rendered view.')] : []),
  ];
}

/** Every form of hidden text in one file, line by line. The caller folds the text and has capped its lines. */
export function hiddenTextFindings(path: string, folded: string): readonly SkillFinding[] {
  const markdown = isMarkdown(path);
  const lines = folded.split('\n');
  return lines.flatMap((line, index) => hiddenInLine(path, line, index + 1, markdown, lines[index + 1]));
}
