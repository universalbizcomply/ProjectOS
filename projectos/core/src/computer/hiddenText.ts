// Origin: original ProjectOS code
/**
 * Text read from a page, a file or a command, made fit to be matched: hidden characters stripped, lookalikes folded.
 *
 * A WORD THAT IS SPLIT IS STILL THAT WORD. A zero-width space, a soft hyphen, a bidi control, a variation selector or a tag
 * character is invisible to a person and breaks a word for a pattern, so `De<ZWSP>lete` would read as no word at all. Text is
 * therefore stripped of every character a person cannot see, normalised to NFKC (so a full-width letter is its ASCII
 * letter), lower-cased, and folded for the Cyrillic and Greek letters that look like Latin ones, before any rule reads it.
 * The strip is a list of what to remove, kept short and in code points; the folding is a list of what to map.
 *
 * Terminal output is stripped of ANSI escape sequences and every control character except a newline and a tab for the same
 * reason: what a terminal would not show is not shown.
 *
 * Pure: no I/O.
 */

/** Code point ranges nobody can see. Each range is inclusive. */
export const HIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x00ad, 0x00ad], [0x034f, 0x034f], [0x061c, 0x061c], [0x115f, 0x1160], [0x180b, 0x180e], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064],
  [0x2066, 0x2069], [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfffc, 0xfffc], [0xe0000, 0xe007f], [0xe0100, 0xe01ef],
];

const inRanges = (point: number): boolean => HIDDEN_RANGES.some(([from, to]) => point >= from && point <= to);

/** Whether a character is one nobody can see. */
export const isHiddenChar = (char: string): boolean => inRanges(char.codePointAt(0) ?? 0);

/** The text with every hidden character removed. */
export function stripHiddenText(text: string): string {
  let out = '';
  for (const char of text) if (!isHiddenChar(char)) out += char;
  return out;
}

/** Whether the text holds a hidden character. */
export const hasHiddenText = (text: string): boolean => [...text].some(isHiddenChar);

/** Cyrillic and Greek letters that look like Latin ones, as code point pairs. */
const LOOKALIKES: readonly (readonly [number, string])[] = [
  [0x0430, 'a'], [0x0435, 'e'], [0x043e, 'o'], [0x0440, 'p'], [0x0441, 'c'], [0x0443, 'y'], [0x0445, 'x'], [0x0455, 's'], [0x0456, 'i'], [0x0458, 'j'],
  [0x0501, 'd'], [0x04bb, 'h'], [0x043a, 'k'], [0x043c, 'm'], [0x0442, 't'], [0x0432, 'v'], [0x0261, 'g'], [0x03bf, 'o'], [0x03b1, 'a'], [0x03bd, 'v'],
  [0x03c1, 'p'], [0x03b9, 'i'], [0x03ba, 'k'], [0x03c5, 'u'], [0x0131, 'i'],
];
const LOOKALIKE = new Map<number, string>(LOOKALIKES);

/** Text folded for matching: hidden characters stripped before and after NFKC, lower case, lookalikes mapped to Latin. */
export function foldForMatch(text: string): string {
  const folded = stripHiddenText(stripHiddenText(text).normalize('NFKC')).toLowerCase();
  let out = '';
  for (const char of folded) out += LOOKALIKE.get(char.codePointAt(0) ?? 0) ?? char;
  return out;
}

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');
const OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)?`, 'g');
const OTHER_ESCAPE = new RegExp(`${ESC}[@-Z\\\\-_]`, 'g');
const CONTROL_EXCEPT_NEWLINE_TAB = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Terminal text as a person would read it: no escape sequence, no control character but newline and tab, nothing hidden. */
export function cleanTerminalText(text: string): string {
  return stripHiddenText(text.replace(OSC, '').replace(CSI, '').replace(OTHER_ESCAPE, '').replace(CONTROL_EXCEPT_NEWLINE_TAB, '').replace(/\r/g, ''));
}
