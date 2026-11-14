// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: extensions/web-readability/web-content-extractor.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: Mozilla Readability, linkedom and the SDK sanitizer are replaced by a small tag scanner in this file, so the module adds no dependency; the size cap and the estimated-nesting-depth refusal are kept as written; markdown output and link rendering are cut, so only text is produced; elements a reader cannot see (hidden attributes, display:none, script, style, template) are dropped, because hidden text is how a page smuggles instructions; invisible Unicode is stripped as upstream does
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
 * THE LIMITS ARE CHECKED BEFORE PARSING. Over a million characters, or an estimated nesting depth over 3000, is not
 * parsed at all. The scanner is one pass with no recursion, so depth costs nothing, and every loop moves forward.
 *
 * Pure.
 */

export const READABILITY_MAX_HTML_CHARS = 1_000_000;
export const READABILITY_MAX_ESTIMATED_NESTING_DEPTH = 3_000;
export const MAX_TITLE_CHARS = 200;
const MAX_TAG_CHARS = 4096;

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

/** The nesting depth upstream estimates by walking tags without parsing, kept as written. True when it is over `maxDepth`. */
export function exceedsEstimatedHtmlNestingDepth(html: string, maxDepth: number): boolean {
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
    let selfClosing = false;
    for (let k = j; k < len && k < j + 200; k += 1) {
      if (html.charCodeAt(k) === 62) {
        selfClosing = html.charCodeAt(k - 1) === 47;
        break;
      }
    }
    if (selfClosing) continue;
    depth += 1;
    if (depth > maxDepth) return true;
  }
  return false;
}

function decodeEntities(text: string): string {
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

/** One tag starting at `from` (a `<`). Null when it is not a tag, and the text is kept as text. */
function readTag(html: string, from: number): Tag | null {
  let i = from + 1;
  const closing = html.charCodeAt(i) === 47;
  if (closing) i += 1;
  const nameStart = i;
  while (i < html.length && /[A-Za-z0-9:-]/.test(html.charAt(i))) i += 1;
  if (i === nameStart || !/[A-Za-z]/.test(html.charAt(nameStart))) return null;
  const name = html.slice(nameStart, i).toLowerCase();
  let quote = '';
  const attributesFrom = i;
  for (; i < html.length && i - from <= MAX_TAG_CHARS; i += 1) {
    const ch = html.charAt(i);
    if (quote !== '') {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return { name, closing, selfClosing: html.charAt(i - 1) === '/', attributes: html.slice(attributesFrom, i), end: i + 1 };
    }
  }
  return null;
}

/** Hidden from a reader by the page itself: an attribute or an inline style says so. */
function isHidden(attributes: string): boolean {
  return /(?:^|\s)hidden(?:\s|=|$|\/)/i.test(attributes) || /aria-hidden\s*=\s*["']?true/i.test(attributes) || /style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attributes);
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

function scan(html: string, onlyMain: boolean): Scan {
  const out: string[] = [];
  let title = '';
  let skipName = '';
  let skipDepth = 0;
  let mainDepth = 0;
  let i = 0;
  while (i < html.length) {
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
    const tag = readTag(html, lt);
    if (tag === null) {
      if (skipDepth === 0 && (!onlyMain || mainDepth > 0)) out.push('<');
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
  if (typeof html !== 'string' || html.length > READABILITY_MAX_HTML_CHARS || exceedsEstimatedHtmlNestingDepth(html, READABILITY_MAX_ESTIMATED_NESTING_DEPTH)) return null;
  const hasMain = /<(?:main|article)[\s>/]/i.test(html);
  let found = scan(html, hasMain);
  if (hasMain && tidy(found.text) === '') found = scan(html, false);
  const text = tidy(found.text);
  if (text === '') return null;
  const title = tidy(found.title).replace(/\s+/g, ' ').slice(0, MAX_TITLE_CHARS);
  return title === '' ? { text } : { text, title };
}
