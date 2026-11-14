// Origin: original ProjectOS code
/**
 * A command line, read as a shell would read it, and refused wherever it cannot be read completely.
 *
 * A LINE THAT CANNOT BE FULLY PARSED IS REFUSED. The reader knows POSIX-style quoting (single, double, backslash) and the
 * operators that change what runs. It names every feature it finds, and the caller decides which of two it may allow:
 *
 * - `redirection`  `<` and `>`: the text stays in its argument, as literal text, because no shell runs here. The argument
 *                  hash covers it.
 * - `glob`         `*` `?` `[` `]` `{` `}` and a leading `~`: the text stays in its argument, unexpanded, for the same reason.
 *
 * These are NEVER allowed, because the text they stand for is not in the line, or because running them needs a shell:
 * `chaining` (`;` `&` `&&` `|` `||` and a newline: more than one command, which only a shell can sequence), `substitution`
 * (a dollar sign, a backtick), `grouping` (parentheses) and `unparsed` (an open quote, a trailing backslash, a percent sign,
 * a caret, a bang or a leading hash, a control character, an invisible or non-ASCII space, an empty command between two
 * operators, a line past the caps).
 *
 * Pure: no I/O.
 */

export type SyntaxFeature = 'chaining' | 'redirection' | 'glob' | 'substitution' | 'grouping' | 'unparsed';
/** What a pattern may allow. The others cannot be allowed by anything. */
export const ALLOWABLE_SYNTAX: readonly SyntaxFeature[] = ['redirection', 'glob'];

export const MAX_LINE_CHARS = 8192;
export const MAX_SEGMENTS = 16;
export const MAX_TOKENS = 256;

export type CommandLineAnalysis =
  | { readonly ok: true; readonly segments: readonly (readonly string[])[]; readonly features: readonly SyntaxFeature[] }
  | { readonly ok: false; readonly features: readonly SyntaxFeature[] };

const BACKSLASH = String.fromCharCode(92);
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [[0x80, 0xa0], [0x1680, 0x1680], [0x180e, 0x180e], [0x2000, 0x200f], [0x2028, 0x202f], [0x205f, 0x206f], [0x3000, 0x3000], [0xfeff, 0xfeff]];
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([from, to]) => String.fromCharCode(from) + '-' + String.fromCharCode(to)).join('')}]`);
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const ESCAPABLE_IN_DOUBLE = new Set(['"', BACKSLASH, '$', '`']);

interface Reading {
  readonly segments: string[][];
  readonly features: Set<SyntaxFeature>;
}

/** Walk the line once. Quote state decides which characters are operators. */
function read(line: string): Reading {
  const segments: string[][] = [[]];
  const features = new Set<SyntaxFeature>();
  let token = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  const endToken = (): void => {
    if (started) (segments[segments.length - 1] as string[]).push(token);
    token = '';
    started = false;
  };
  const operator = (): void => {
    features.add('chaining');
    endToken();
    segments.push([]);
  };
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index] as string;
    if (CONTROL.test(ch) || INVISIBLE.test(ch)) features.add('unparsed');
    if (quote === "'") {
      if (ch === "'") quote = null;
      else token += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === BACKSLASH && ESCAPABLE_IN_DOUBLE.has(line[index + 1] as string)) token += line[(index += 1)] as string;
      else {
        if (ch === '$' || ch === '`') features.add('substitution');
        token += ch;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if (ch === BACKSLASH) {
      if (index + 1 >= line.length) features.add('unparsed');
      else token += line[(index += 1)] as string;
      started = true;
    } else if (ch === ' ' || ch === '\t') endToken();
    else if (ch === '\n' || ch === '\r' || ch === ';' || ch === '&' || ch === '|') {
      if ((ch === '&' || ch === '|') && line[index + 1] === ch) index += 1;
      if (ch === '\r' && line[index + 1] === '\n') index += 1;
      operator();
    } else {
      if (ch === '$' || ch === '`') features.add('substitution');
      else if (ch === '(' || ch === ')') features.add('grouping');
      else if (ch === '<' || ch === '>') features.add('redirection');
      else if (ch === '*' || ch === '?' || ch === '[' || ch === ']' || ch === '{' || ch === '}' || (ch === '~' && !started)) features.add('glob');
      else if (ch === '%' || ch === '^' || ch === '!' || (ch === '#' && !started)) features.add('unparsed');
      token += ch;
      started = true;
    }
  }
  if (quote !== null) features.add('unparsed');
  endToken();
  return { segments, features };
}

/**
 * The commands in `line`, or the features that stop it. `allowed` is what the caller may accept from
 * `ALLOWABLE_SYNTAX`; a feature outside it, or one that can never be allowed, refuses the whole line.
 */
export function analyzeCommandLine(line: unknown, allowed: readonly SyntaxFeature[] = []): CommandLineAnalysis {
  if (typeof line !== 'string' || line.trim() === '' || line.length > MAX_LINE_CHARS) return { ok: false, features: ['unparsed'] };
  const { segments, features } = read(line);
  // A trailing operator leaves an empty segment at the end: an empty command is unparsed, not skipped.
  if (segments.some((segment) => segment.length === 0)) features.add('unparsed');
  if (segments.length > MAX_SEGMENTS || segments.reduce((sum, segment) => sum + segment.length, 0) > MAX_TOKENS) features.add('unparsed');
  const found = [...features].sort();
  const refused = found.filter((feature) => !allowed.includes(feature) || !ALLOWABLE_SYNTAX.includes(feature));
  if (refused.length > 0) return { ok: false, features: refused };
  return { ok: true, segments: Object.freeze(segments.map((segment) => Object.freeze([...segment]))), features: found };
}
