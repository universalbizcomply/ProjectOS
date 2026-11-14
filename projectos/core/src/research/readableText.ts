// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: extensions/web-readability/web-content-extractor.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: Mozilla Readability, linkedom and the SDK sanitizer are replaced by a small tag scanner in this file, so the module adds no dependency, and the scan is linear: the next `>` and the next quote are each looked up once and remembered, and a work budget ends a scan that would cost more than four times the page; the size cap and the estimated-nesting-depth refusal are kept as written; markdown output and link rendering are cut, so only text is produced; elements a reader cannot see (hidden attributes, display:none, script, style, template) are dropped, because hidden text is how a page smuggles instructions; invisible Unicode is stripped as upstream does
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * A small readable-text extractor (PROJECTOS-PORT-RESEARCH1A, C16).
 *
 * This is NOT Mozilla Readability. It keeps the main text of a page well enough to be cited: scripts, styles,
 * navigation, footers, forms and anything the page hides are dropped, block elements become line breaks, entities
 * are decoded, and what is left is cut into lines. A page whose text sits in a script, or whose layout is only its
 * navigation, yields little or nothing, and the caller then refuses it as having no readable text. A better
 * extractor is an injected port (`extractors.ts`), not a dependency here.
 *
 * THE SCAN IS LINEAR ON HOSTILE MARKUP. A tag with an unterminated quote or no `>` used to be re-read for up to 4096 characters
 * for every `<` that followed, which cost seconds on a megabyte of `<br `. Now `Finder` answers "where is the next `>`, or quote,
 * at or after here" from a remembered answer, so the page is walked once, and `WORK_FACTOR` caps the total work a scan may do.
 *
 * HIDDEN TEXT IS DROPPED ONLY WHERE THE PAGE SAYS SO IN THE MARKUP: a `hidden` or `aria-hidden` attribute, or an inline style with
 * `display:none`, `visibility:hidden`, `font-size:0`, `opacity:0` or a far off-screen position. A style sheet or a class cannot be
 * read here, so text hidden that way IS extracted. The threat scan is the defence for that, not this.
 *
 * THE LIMITS ARE CHECKED BEFORE PARSING. Over a million characters, or an estimated nesting depth over 3000, is not
 * parsed at all. The scanner is one pass with no recursion, so depth costs nothing, and every loop moves forward.
 *
 * Pure.
 */

export const READABILITY_MAX_HTML_CHARS = 1_000_000;
export const READABILITY_MAX_ESTIMATED_NESTING_DEPTH = 3_000;
export const MAX_TITLE_CHARS = 200;
const MAX_TAG_CHARS = 4096;
/** A scan may do at most this many times the page's length in work, counting every character a lookup walked. */
export const WORK_FACTOR = 4;

const HTML_VOID_TAGS: ReadonlySet<string> = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Elements whose whole content is dropped. */
const DROPPED_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object', 'embed', 'canvas', 'select', 'textarea', 'nav', 'footer', 'aside', 'form', 'dialog', 'menu']);

/** Elements whose content is not markup: it ends at the matching close tag and nowhere else. */
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'textarea', 'title']);

const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'p', 'div', 'section', 'article', 'main', 'header', 'ul', 'ol', 'li', 'table', 'tr', 'pre', 'blockquote', 'br', 'hr', 'dd', 'dt', 'dl', 'figure', 'figcaption',
  'details', 'summary', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'address', 'fieldset',
]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Everything a reader would not see, except the newline and the tab. */
const INVISIBLE = /(?![\n\t])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}]/gu;

export function stripInvisibleUnicode(text: string): string {
  return text.replace(INVISIBLE, '');
}

/** Where the next `char` is at or after `from`, remembered so that no stretch of the page is searched twice. `work` counts what was walked. */
export interface Finder {
  readonly next: (char: string, from: number) => number;
  readonly work: () => number;
}

export function createFinder(html: string): Finder {
  const held = new Map<string, { readonly from: number; readonly at: number }>();
  let walked = 0;
  return {
    next: (char, from) => {
      const known = held.get(char);
      if (known !== undefined && from >= known.from && known.at >= from) return known.at;
      const found = html.indexOf(char, from);
      const at = found < 0 ? Number.POSITIVE_INFINITY : found;
      walked += (found < 0 ? html.length : found) - from + 1;
      held.set(char, { from, at });
      return at;
    },
    work: () => walked,
  };
}

/** The nesting depth upstream estimates by walking tags without parsing, kept as written. True when it is over `maxDepth`. */
export function exceedsEstimatedHtmlNestingDepth(html: string, maxDepth: number, finder: Finder = createFinder(html)): boolean {
  let depth = 0;
  const len = html.length;
  for (let i = html.indexOf('<'); i >= 0; i = html.indexOf('<', i + 1)) {
    const next = html.charCodeAt(i + 1);
    if (next === 33 || next === 63) continue;
    let j = i + 1;
    let closing = false;
    if (html.charCodeAt(j) === 47) {
      closing = true;
      j += 1;
    }
    while (j < len && html.charCodeAt(j) <= 32) j += 1;
    const nameStart = j;
    while (j < len) {
      const c = html.charCodeAt(j);
      const isNameChar = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 58 || c === 45;
      if (!isNameChar) break;
      j += 1;
    }
    if (j === nameStart) continue;
    if (closing) {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (HTML_VOID_TAGS.has(html.slice(nameStart, j).toLowerCase())) continue;
    // Upstream looks at the next 200 characters for a `>`. The lookup is the remembered one, so it costs nothing twice.
    const gt = finder.next('>', j);
    if (gt - j < 200 && html.charCodeAt(gt - 1) === 47) continue;
    depth += 1;
    if (depth > maxDepth) return true;
  }
  return false;
}

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]{2,6}));/g, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name !== undefined) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const code = dec !== undefined ? Number(dec) : Number.parseInt(hex as string, 16);
    return code >= 1 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ';
  });
}

interface Tag {
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  readonly attributes: string;
  /** Index just past the `>`. */
  readonly end: number;
}

const TAG_NAME = /[A-Za-z][A-Za-z0-9:-]*/y;

/** One tag starting at `from` (a `<`). Null when it is not a tag, and the text is kept as text. */
function readTag(html: string, from: number, finder: Finder): Tag | null {
  let i = from + 1;
  const closing = html.charCodeAt(i) === 47;
  if (closing) i += 1;
  const nameStart = i;
  TAG_NAME.lastIndex = nameStart;
  const named = TAG_NAME.exec(html);
  if (named === null) return null;
  i = nameStart + named[0].length;
  const name = named[0].toLowerCase();
  const attributesFrom = i;
  for (;;) {
    const gt = finder.next('>', i);
    const first = Math.min(gt, finder.next('"', i), finder.next("'", i));
    if (first === Number.POSITIVE_INFINITY || first - from > MAX_TAG_CHARS) return null;
    if (first === gt) return { name, closing, selfClosing: html.charAt(gt - 1) === '/', attributes: html.slice(attributesFrom, gt), end: gt + 1 };
    const close = finder.next(html.charAt(first), first + 1);
    if (close === Number.POSITIVE_INFINITY || close - from > MAX_TAG_CHARS) return null;
    i = close + 1;
  }
}

/** An inline style that takes text out of view: no display, no visibility, no size, no opacity, or far off the page. */
const HIDING_STYLE = new RegExp(
  ['style\\s*=\\s*["\'][^"\']*?(?:display\\s*:\\s*none', 'visibility\\s*:\\s*hidden', 'font-size\\s*:\\s*0(?![.\\d])(?:px|em|rem|pt|%)?', 'opacity\\s*:\\s*0(?:\\.0*)?(?![.\\d])', '(?:left|top|right|bottom|text-indent)\\s*:\\s*-\\d{3,})'].join('|'),
  'i',
);

/** Hidden from a reader by the page itself: an attribute or an inline style says so. */
function isHidden(attributes: string): boolean {
  return /(?:^|\s)hidden(?:\s|=|$|\/)/i.test(attributes) || /aria-hidden\s*=\s*["']?true/i.test(attributes) || HIDING_STYLE.test(attributes);
}

interface Scan {
  readonly text: string;
  readonly title: string;
}

const RAW_END: Readonly<Record<string, RegExp>> = Object.fromEntries([...RAW_TEXT_TAGS].map((name) => [name, new RegExp('</' + name, 'gi')]));

/** Where a raw-text element's body ends and where scanning resumes. A search from `from`, so it costs the body and no more. */
function rawTextEnd(html: string, name: string, from: number): { readonly bodyEnd: number; readonly next: number } {
  const end = RAW_END[name] as RegExp;
  end.lastIndex = from;
  const found = end.exec(html);
  if (found === null) return { bodyEnd: html.length, next: html.length };
  const close = html.indexOf('>', found.index);
  return { bodyEnd: found.index, next: close < 0 ? html.length : close + 1 };
}

function scan(html: string, onlyMain: boolean, finder: Finder, budget: number): Scan | null {
  const out: string[] = [];
  let title = '';
  let skipName = '';
  let skipDepth = 0;
  let mainDepth = 0;
  let i = 0;
  while (i < html.length) {
    if (finder.work() + i > budget) return null;
    const lt = html.indexOf('<', i);
    const textEnd = lt < 0 ? html.length : lt;
    if (skipDepth === 0 && (!onlyMain || mainDepth > 0) && textEnd > i) out.push(decodeEntities(html.slice(i, textEnd)));
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      i = close < 0 ? html.length : close + 3;
      continue;
    }
    if (html.charCodeAt(lt + 1) === 33 || html.charCodeAt(lt + 1) === 63) {
      const close = html.indexOf('>', lt + 1);
      i = close < 0 ? html.length : close + 1;
      continue;
    }
    const tag = readTag(html, lt, finder);
    if (tag === null) {
      const visible = skipDepth === 0 && (!onlyMain || mainDepth > 0);
      // With no `>` and no comment or declaration left, nothing after here can be a tag: the rest is text, and is taken at once.
      if (finder.next('>', lt) === Number.POSITIVE_INFINITY && finder.next('<!', lt) === Number.POSITIVE_INFINITY && finder.next('<?', lt) === Number.POSITIVE_INFINITY) {
        if (visible) out.push(decodeEntities(html.slice(lt)));
        break;
      }
      if (visible) out.push('<');
      i = lt + 1;
      continue;
    }
    i = tag.end;
    if (RAW_TEXT_TAGS.has(tag.name) && !tag.closing && !tag.selfClosing) {
      const closeAt = rawTextEnd(html, tag.name, i);
      if (tag.name === 'title' && title === '' && skipDepth === 0) title = decodeEntities(html.slice(i, closeAt.bodyEnd));
      i = closeAt.next;
      continue;
    }
    if (skipDepth > 0) {
      if (tag.name === skipName && !tag.selfClosing && !HTML_VOID_TAGS.has(tag.name)) skipDepth += tag.closing ? -1 : 1;
      continue;
    }
    if (!tag.closing && !tag.selfClosing && !HTML_VOID_TAGS.has(tag.name) && (DROPPED_TAGS.has(tag.name) || isHidden(tag.attributes))) {
      skipName = tag.name;
      skipDepth = 1;
      continue;
    }
    if (tag.name === 'main' || tag.name === 'article') mainDepth = Math.max(0, mainDepth + (tag.closing ? -1 : 1));
    if (BLOCK_TAGS.has(tag.name) && (!onlyMain || mainDepth > 0)) out.push('\n');
  }
  return { text: out.join(''), title };
}

function tidy(text: string): string {
  return stripInvisibleUnicode(text.replace(/\r\n?/g, '\n'))
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export interface ReadableContent {
  readonly text: string;
  readonly title?: string;
}

/** The readable text of a page, or null when the page is over a limit or has none. Never throws. */
export function extractReadableText(html: string): ReadableContent | null {
  if (typeof html !== 'string' || html.length > READABILITY_MAX_HTML_CHARS) return null;
  const finder = createFinder(html);
  if (exceedsEstimatedHtmlNestingDepth(html, READABILITY_MAX_ESTIMATED_NESTING_DEPTH, finder)) return null;
  const budget = WORK_FACTOR * html.length + 1000;
  const hasMain = /<(?:main|article)[\s>/]/i.test(html);
  let found = scan(html, hasMain, finder, budget);
  if (found !== null && hasMain && tidy(found.text) === '') found = scan(html, false, finder, budget);
  if (found === null) return null;
  const text = tidy(found.text);
  if (text === '') return null;
  const title = tidy(found.title).replace(/\s+/g, ' ').slice(0, MAX_TITLE_CHARS);
  return title === '' ? { text } : { text, title };
}
