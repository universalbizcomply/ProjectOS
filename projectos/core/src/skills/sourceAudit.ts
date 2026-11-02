// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/skills_ast_audit.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python's ast module to a linear token scan, because core has no Python parser; source that cannot be read is a finding, where upstream returned nothing and passed it; the bare name of a dynamic builtin counts, so an alias does not pass; a finding stops promotion rather than being a hint
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The audit of Python in a skill: dynamic import and computed attribute access.
 *
 * Upstream walks an AST and returns nothing for source it cannot parse, so a syntax error earned a clean
 * report. There is no Python parser in core, so this reads tokens: names, strings and brackets. It does not
 * execute or import anything. Text inside a string or a comment is not code, and a computed value is one that
 * is anything but string or number literals.
 *
 * LINEAR ON HOSTILE INPUT. One pass over the text, with an explicit stack for brackets, so `((((` a hundred
 * thousand deep costs what it costs to read, and no call looks ahead to find its own arguments.
 *
 * WHAT THIS IS NOT. A hint list, not a proof. It reads the one name in the source, so `g = globals()` and other
 * indirection pass it. The fence, and the rule that nothing in ProjectOS runs a skill's scripts, are what remain.
 */
import { blockingFinding, type SkillFinding } from './refusal.js';

const NAME_START = /[\p{L}_]/u;
const NAME_PART = /[\p{L}\p{N}_]/u;
const DIGIT = /[0-9]/;
const STRING_PREFIX = /^(?:[rRbBuU]|[rR][bB]|[bB][rR])$/;
const FORMATTED_PREFIX = /^(?:[fF]|[rR][fF]|[fF][rR]|[tT]|[rR][tT]|[tT][rR])$/;
/** How far one import statement is read, so `import:import:import` stays linear. */
const MAX_IMPORT_TOKENS = 256;
const OPENERS: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set(Object.values(OPENERS));
/** Which argument of each builtin must be literal, as upstream lists them. */
const DYNAMIC_CALLS: Readonly<Record<string, { readonly argument: number; readonly id: string; readonly message: string }>> = {
  __import__: { argument: 0, id: 'dynamic_import_computed', message: '__import__ with a computed module name' },
  getattr: { argument: 1, id: 'dynamic_getattr', message: 'getattr with a computed attribute name' },
};

type TokenKind = 'name' | 'literal' | 'computed-string' | 'mark';

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly line: number;
  /** One per logical line: a backslash continuation stays in the statement it continues. */
  readonly statement: number;
}

interface Lexed {
  readonly tokens: readonly Token[];
  /** The line of the string that never closed, or 0. */
  readonly unterminated: number;
}

/** The index just past a string opening at `start`, and the lines it crossed. */
function endOfString(text: string, start: number): { readonly end: number; readonly lines: number } | null {
  const quote = text[start] as string;
  const triple = text.startsWith(quote.repeat(3), start);
  const closer = triple ? quote.repeat(3) : quote;
  let lines = 0;
  for (let index = start + closer.length; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\') {
      if (text[index + 1] === '\n') lines += 1;
      index += 1;
    } else if (character === '\n') {
      if (!triple) return null;
      lines += 1;
    } else if (text.startsWith(closer, index)) {
      return { end: index + closer.length, lines };
    }
  }
  return null;
}

function lex(text: string): Lexed {
  const tokens: Token[] = [];
  let line = 1;
  let statement = 1;
  let index = 0;
  const push = (kind: TokenKind, token: string): void => void tokens.push({ kind, text: token, line, statement });
  while (index < text.length) {
    const character = text[index] as string;
    if (character === '\n') {
      line += 1;
      statement += 1;
      index += 1;
    } else if (character === '#') {
      const end = text.indexOf('\n', index);
      index = end < 0 ? text.length : end;
    } else if (character === '"' || character === "'") {
      const string = endOfString(text, index);
      if (string === null) return { tokens, unterminated: line };
      push('literal', '');
      line += string.lines;
      index = string.end;
    } else if (NAME_START.test(character)) {
      const start = index;
      while (index < text.length && NAME_PART.test(text[index] as string)) index += 1;
      const name = text.slice(start, index);
      const next = text[index];
      if ((next === '"' || next === "'") && (STRING_PREFIX.test(name) || FORMATTED_PREFIX.test(name))) {
        const string = endOfString(text, index);
        if (string === null) return { tokens, unterminated: line };
        push(FORMATTED_PREFIX.test(name) ? 'computed-string' : 'literal', '');
        line += string.lines;
        index = string.end;
      } else {
        push('name', name);
      }
    } else if (DIGIT.test(character)) {
      while (index < text.length && NAME_PART.test(text[index] as string)) index += 1;
      push('literal', '');
    } else if (character === ' ' || character === '\t') {
      index += 1;
    } else if (character === '\\' && text[index + 1] === '\n') {
      line += 1;
      index += 2;
    } else {
      push('mark', character);
      index += 1;
    }
  }
  return { tokens, unterminated: 0 };
}

/** One open bracket, and what is being judged inside it. */
interface Frame {
  readonly closer: string;
  readonly watch: { readonly argument: number; readonly id: string; readonly message: string; readonly line: number } | null;
  argument: number;
  tokensInArgument: number;
  literalSoFar: boolean;
}

const finishArgument = (frame: Frame, path: string, found: SkillFinding[]): void => {
  const { watch } = frame;
  if (watch !== null && frame.argument === watch.argument && frame.tokensInArgument > 0 && !frame.literalSoFar) {
    found.push(blockingFinding(watch.id, path, watch.line, `${watch.message}: it loads or reaches something chosen at run time.`));
  }
};

function watchFor(tokens: readonly Token[], at: number): Frame['watch'] {
  const before = tokens[at - 1];
  if (before?.kind !== 'name') return null;
  const opener = tokens[at]?.text;
  if (opener === '[' && before.text === '__dict__' && tokens[at - 2]?.text === '.') {
    return { argument: 0, id: 'dict_access', message: '__dict__ with a computed key', line: before.line };
  }
  const call = opener === '(' && Object.hasOwn(DYNAMIC_CALLS, before.text) ? DYNAMIC_CALLS[before.text] : undefined;
  return call === undefined ? null : { ...call, line: before.line };
}

function isImportLine(tokens: readonly Token[], at: number): boolean {
  const before = tokens[at - 1];
  return before === undefined || before.statement !== (tokens[at] as Token).statement || before.text === ';' || before.text === ':';
}

/** `import a.b, importlib as c` and `from importlib.x import y`: whether any dotted name is importlib's. */
function namesImportlib(tokens: readonly Token[], at: number): boolean {
  const { statement } = tokens[at] as Token;
  const stop = Math.min(tokens.length, at + MAX_IMPORT_TOKENS);
  for (let index = at + 1; index < stop && (tokens[index] as Token).statement === statement; index += 1) {
    const token = tokens[index] as Token;
    if (token.text === ';') return false;
    const leads = (tokens[index - 1] as Token).text !== '.';
    if (token.kind === 'name' && token.text === 'importlib' && leads) return true;
    if (tokens[at]?.text === 'from' && token.text === 'import') return false;
  }
  return false;
}

function bareNameFinding(tokens: readonly Token[], at: number, path: string): SkillFinding | null {
  const token = tokens[at] as Token;
  if (token.kind !== 'name') return null;
  const called = tokens[at + 1]?.text === '(';
  if (token.text === 'import_module') {
    return called ? blockingFinding('dynamic_import', path, token.line, 'importlib.import_module() loads an arbitrary module at run time.') : blockingFinding('dynamic_alias', path, token.line, 'import_module is passed around instead of called, so a later call cannot be judged.');
  }
  if (!called && Object.hasOwn(DYNAMIC_CALLS, token.text)) {
    return blockingFinding('dynamic_alias', path, token.line, `${token.text} is passed around instead of called, so a later call cannot be judged.`);
  }
  if ((token.text === 'import' || token.text === 'from') && isImportLine(tokens, at) && namesImportlib(tokens, at)) {
    return blockingFinding('importlib_import', path, token.line, 'importlib enables dynamic module loading.');
  }
  return null;
}

/** The dynamic import and access patterns in one Python file. Unreadable source is itself a finding. */
export function auditPythonSource(path: string, folded: string): readonly SkillFinding[] {
  const { tokens, unterminated } = lex(folded);
  const found: SkillFinding[] = [];
  const stack: Frame[] = [];
  let unbalanced = 0;
  tokens.forEach((token, at) => {
    const bare = bareNameFinding(tokens, at, path);
    if (bare !== null) found.push(bare);
    const top = stack[stack.length - 1];
    const closer = token.kind === 'mark' ? OPENERS[token.text] : undefined;
    if (closer !== undefined) {
      if (top !== undefined) {
        top.tokensInArgument += 1;
        top.literalSoFar = false;
      }
      stack.push({ closer, watch: watchFor(tokens, at), argument: 0, tokensInArgument: 0, literalSoFar: true });
    } else if (token.kind === 'mark' && CLOSERS.has(token.text)) {
      if (top?.closer !== token.text) {
        unbalanced ||= token.line;
        return;
      }
      finishArgument(top, path, found);
      stack.pop();
    } else if (top !== undefined && token.text === ',' && token.kind === 'mark') {
      finishArgument(top, path, found);
      top.argument += 1;
      top.tokensInArgument = 0;
      top.literalSoFar = true;
    } else if (top !== undefined) {
      top.tokensInArgument += 1;
      if (token.kind !== 'literal') top.literalSoFar = false;
    }
  });
  const openLine = stack[0]?.watch?.line ?? 0;
  const unreadable = unterminated || unbalanced || (stack.length > 0 ? openLine || 1 : 0);
  return unreadable === 0 ? found : [...found, blockingFinding('unreadable_source', path, unreadable, 'This source does not read as Python, so it could not be audited.')];
}
