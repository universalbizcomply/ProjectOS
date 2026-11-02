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
const FENCE_FORGERY = /<\s*\/?\s*untrusted-(?:skill|memory)\b/i;
const MARKDOWN_COMMENT_ANYWHERE = /\[\/\/\]:/;
const RENDERER_DROPS = /<\?|<!\[|<![A-Za-z]/;
/** `[label]: <>` and `[label]: #`, the comment idiom, with or without text after it. */
const REFERENCE_AS_COMMENT = /^ {0,3}\[[^\]\n]{0,512}\]:[ \t]*(?:<[ \t]*#?[ \t]*>|#)/;
/** `[label]: target "text"`: the text shows only as a tooltip, or not at all. */
const REFERENCE_WITH_TITLE = /^ {0,3}\[[^\]\n]{0,512}\]:[ \t]*\S{1,2048}[ \t]+["'(]/;
const HIDDEN_ELEMENT =
  /<[ \t]*(?:style|script|template|noscript|iframe|object|embed)\b|<[A-Za-z][^>\n]{0,512}[ \t](?:hidden\b|style[ \t]*=[ \t]*["'][^"'\n]{0,512}(?:display[ \t]*:[ \t]*none|visibility[ \t]*:[ \t]*hidden|font-size[ \t]*:[ \t]*0|opacity[ \t]*:[ \t]*0))/i;

/** A leading byte-order mark and CRLF endings, which Windows editors add. Nothing else is folded. */
export function foldSkillLines(text: string): string {
  const body = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
  return body.replace(/\r\n/g, '\n');
}

const isMarkdown = (path: string): boolean => path.toLowerCase().endsWith('.md');
const hex = (character: string): string => (character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');

function hiddenInLine(path: string, line: string, lineNumber: number, markdown: boolean): readonly SkillFinding[] {
  const character = HIDDEN_CHARACTER.exec(line)?.[0];
  return [
    ...(character === undefined ? [] : [blockingFinding('hidden-character', path, lineNumber, `Line ${lineNumber} holds U+${hex(character)}, which a reviewer would not see.`)]),
    ...(FENCE_FORGERY.test(line) ? [blockingFinding('fence-forgery', path, lineNumber, 'This text writes the tag that fences untrusted text in a prompt.')] : []),
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
  return folded.split('\n').flatMap((line, index) => hiddenInLine(path, line, index + 1, markdown));
}
