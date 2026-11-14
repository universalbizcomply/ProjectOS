// SPDX-License-Identifier: MIT
// Ported-From: copilotkit-openbot https://github.com/CopilotKit/OpenBot
// Source-Path: server/src/computer/policy.ts
// Source-Commit: c396a5f68c817043846f1ca3c2b42061ee73ceb5
// Source-Copyright: Copyright (c) 2026 CopilotKit
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the policy context is taken, the tool, the page host, the element, the key, the file, the MCP call, the command and the initiator that a rule is written against, and the idea that the intent of an action is what a rule should name; the intent is now DERIVED here from the tool and its facts and is never accepted from the caller; an action that needs a fact (the element of a click, the page of a navigation, the file of a file action) is refused when the fact is missing, where the source bound an empty neutral value; the command of a run-command is taken from a prepared command and never from free text; text from a page is stripped of hidden characters and folded before a rule reads it; a key chord is normalised to its key; the audit initiator type, the CEL bindings and the file description helpers are cut
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * What an action is about: the facts a policy rule is written against, read once and checked.
 *
 * THE INTENT IS DERIVED, NEVER SAID. `tool` describes the mechanism and the intent describes the effect, and a rule that
 * names only a mechanism is evaded by another mechanism: a click is refused and Enter is pressed instead. So the intent is
 * worked out here from the tool and its facts (a click, Enter, Space, Delete, Backspace and Alt+F4 activate, in every spelling
 * and with any modifier; typing with `submit`, or text that holds a newline or a tab then Enter, activates; any other key
 * types), and a context that states its own intent is refused as an unknown field.
 *
 * A FACT THE ACTION NEEDS MUST BE THERE. A click needs the element the server resolved, a navigation needs a page, a file
 * action needs a workspace-relative file, a run-command needs the PREPARED COMMAND (never free text, so the text a rule reads
 * is the command that will run, with its hash), an MCP call needs its server, tool and effect. A context without them is
 * `CONTEXT_INCOMPLETE`, because a rule about a missing fact would otherwise read as false and let the action through. Text that
 * came from a page (an element name, a title, a url, a key, a host) is untrusted data: bounded, stripped of hidden characters
 * and folded before a rule reads it.
 *
 * Pure: no I/O.
 */
import { isPreparedExec, type PreparedExec } from './execCommand.js';
import { foldForMatch } from './hiddenText.js';
import { snapshotOfFields } from './plainFields.js';

export const COMPUTER_TOOLS = [
  'screenshot', 'read-page', 'navigate', 'click', 'type', 'key', 'scroll', 'list-files', 'read-file', 'write-file', 'download-file', 'run-command', 'mcp-read', 'mcp-write',
] as const;
export type ComputerTool = (typeof COMPUTER_TOOLS)[number];

export const COMPUTER_INTENTS = ['activate', 'type', 'navigate', 'read', 'list-files', 'read-file', 'write-file', 'download-file', 'run-command', 'read-tool', 'write-tool'] as const;
export type ComputerIntent = (typeof COMPUTER_INTENTS)[number];

export const INITIATOR_KINDS = ['person', 'routine', 'deployment', 'agent'] as const;
export type InitiatorKind = (typeof INITIATOR_KINDS)[number];

export const MAX_TEXT_CHARS = 512;
export const MAX_TYPED_TEXT_CHARS = 4096;

export interface ComputerElement {
  readonly role: string;
  readonly name: string;
  readonly type: string;
  readonly label: string;
}

export interface ComputerFile {
  /** Workspace-relative, `/`-separated, lower case. */
  readonly path: string;
  readonly name: string;
  /** Without the dot, lower case. A dotfile such as `.env` has the extension `env`. */
  readonly extension: string;
}

export interface ComputerMcp {
  readonly server: string;
  readonly tool: string;
  readonly effect: 'read' | 'write';
}

export interface ComputerActionContext {
  readonly tool: ComputerTool;
  readonly intent: ComputerIntent;
  readonly host: string | null;
  readonly element: ComputerElement | null;
  /** The key of a chord, in one spelling: `enter`, `space`, `delete`, `backspace`, `f4`, `a`. */
  readonly key: string | null;
  /** Delete, Backspace, or Alt+F4: a key that removes something or closes it. */
  readonly keyDestructive: boolean;
  /** The window title and the url, folded. Empty when not stated. */
  readonly title: string;
  readonly url: string;
  readonly submit: boolean;
  /** Typed text that holds a newline, or a tab then Enter: it submits. */
  readonly textActivates: boolean;
  readonly file: ComputerFile | null;
  readonly mcp: ComputerMcp | null;
  /** The command text of a prepared command, folded; `null` when there is none. */
  readonly command: string | null;
  /** The hash of the prepared command, or `null`. */
  readonly execHash: string | null;
  readonly initiator: InitiatorKind;
}

export type ContextRefusal = 'CONTEXT_INVALID' | 'CONTEXT_INCOMPLETE';
export type ContextResult = { readonly ok: true; readonly context: ComputerActionContext } | { readonly ok: false; readonly code: ContextRefusal; readonly detail: string };

const FIELDS = ['tool', 'host', 'element', 'key', 'submit', 'text', 'title', 'url', 'file', 'mcp', 'exec', 'initiator'] as const;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const bad = (detail: string): ContextResult => ({ ok: false, code: 'CONTEXT_INVALID', detail });
const missing = (detail: string): ContextResult => ({ ok: false, code: 'CONTEXT_INCOMPLETE', detail });

/** Untrusted text, folded: hidden characters stripped, NFKC, lower case, lookalikes mapped, bounded. `null` when it is not text or has a control character. */
export function foldedText(value: unknown, max = MAX_TEXT_CHARS): string | null {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return foldForMatch(value);
}

/** Whether a host is an address in any spelling: its last label is all digits or a `0x` number. */
export function isAddressLikeHost(host: string): boolean {
  const labels = host.split('.');
  return /^(?:0x[0-9a-f]*|[0-9]+)$/i.test(labels[labels.length - 1] as string);
}

/** A host as ASCII letters, digits and dots, lower case, with no trailing dot. `null` for an address in any spelling or anything else. */
export function canonicalHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const host = value.endsWith('.') ? value.slice(0, -1) : value;
  if (!HOST.test(host) || isAddressLikeHost(host)) return null;
  return host;
}

function fileOf(raw: unknown): ComputerFile | null {
  const fields = snapshotOfFields(raw, ['path']);
  const text = fields === null || typeof fields['path'] !== 'string' ? null : fields['path'];
  if (text === null || text.length === 0 || text.length > 1024 || /[\u0000-\u001f\u007f\\:]/.test(text) || text.startsWith('/')) return null;
  const parts = text.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts.some((part) => part === '..' || /[. ]$/.test(part) || /[^ -~]/.test(part))) return null;
  const path = parts.join('/').toLowerCase();
  const name = parts[parts.length - 1]!.toLowerCase();
  return Object.freeze({ path, name, extension: name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '' });
}

function elementOf(raw: unknown): ComputerElement | null {
  const fields = snapshotOfFields(raw, ['role', 'name', 'type', 'label']);
  if (fields === null) return null;
  const role = foldedText(fields['role'], 64);
  const name = foldedText(fields['name']);
  const type = fields['type'] === undefined ? '' : foldedText(fields['type'], 64);
  const label = fields['label'] === undefined ? '' : foldedText(fields['label']);
  return role === null || name === null || type === null || label === null ? null : Object.freeze({ role, name, type, label });
}

function mcpOf(raw: unknown): ComputerMcp | null {
  const fields = snapshotOfFields(raw, ['server', 'tool', 'effect']);
  if (fields === null) return null;
  const server = foldedText(fields['server'], 64);
  const tool = foldedText(fields['tool'], 128);
  const effect = fields['effect'];
  if (server === null || tool === null || server === '' || tool === '' || (effect !== 'read' && effect !== 'write')) return null;
  return Object.freeze({ server, tool, effect });
}

const ENTER_KEYS = new Set(['enter', 'return', 'kp_enter', 'kp_return', 'kpenter', 'numpadenter', 'linefeed']);
const SPACE_KEYS = new Set(['space', 'spacebar', 'kp_space', ' ']);
const DELETE_KEYS = new Set(['delete', 'del', 'kp_delete', 'forwarddelete']);
const BACKSPACE_KEYS = new Set(['backspace', 'bksp']);
const ALT_NAMES = new Set(['alt', 'option', 'opt', 'altgr']);

/** A key chord as one key and whether Alt was held: modifiers and their order dropped, every spelling of a key made one. */
export function normalizeKey(raw: string): { readonly key: string; readonly alt: boolean } | null {
  const text = foldedText(raw, 32);
  if (text === null) return null;
  const spaceOnly = raw.length > 0 && raw.trim() === '';
  const parts = spaceOnly ? [' '] : text.split('+');
  const last = parts.length > 1 && parts[parts.length - 1] === '' ? '+' : (parts[parts.length - 1] as string);
  const modifiers = parts.slice(0, -1);
  const key = ENTER_KEYS.has(last) ? 'enter' : SPACE_KEYS.has(last) ? 'space' : DELETE_KEYS.has(last) ? 'delete' : BACKSPACE_KEYS.has(last) ? 'backspace' : last;
  return key === '' ? null : { key, alt: modifiers.some((modifier) => ALT_NAMES.has(modifier)) || /^alt\+?f4$/.test(text) };
}

const isDestructiveKey = (key: string, alt: boolean): boolean => key === 'delete' || key === 'backspace' || (key === 'f4' && alt);
const isActivationKey = (key: string, alt: boolean): boolean => key === 'enter' || key === 'space' || isDestructiveKey(key, alt);

/** Typed text that submits: a newline or a carriage return in it, or a tab followed by one. */
export const textSubmits = (text: string): boolean => /[\n\r]/.test(text);

/** The effect of the action, worked out from the tool and what it presses or types. Never read from a request. */
export function intentOf(tool: ComputerTool, key: string | null, submit: boolean, alt = false, textActivates = false): ComputerIntent {
  switch (tool) {
    case 'click':
      return 'activate';
    case 'type':
      return submit || textActivates ? 'activate' : 'type';
    case 'key':
      return key !== null && isActivationKey(key, alt) ? 'activate' : 'type';
    case 'navigate':
      return 'navigate';
    case 'screenshot':
    case 'read-page':
    case 'scroll':
      return 'read';
    case 'mcp-read':
      return 'read-tool';
    case 'mcp-write':
      return 'write-tool';
    default:
      return tool;
  }
}

const NEEDS: Readonly<Record<ComputerTool, readonly ('host' | 'element' | 'file' | 'mcp' | 'exec' | 'key')[]>> = {
  screenshot: ['host'], 'read-page': ['host'], scroll: ['host'], navigate: ['host'], click: ['host', 'element'], type: ['host', 'element'], key: ['host', 'key'],
  'list-files': ['file'], 'read-file': ['file'], 'write-file': ['file'], 'download-file': ['file'], 'run-command': ['exec'], 'mcp-read': ['mcp'], 'mcp-write': ['mcp'],
};

/** Read one action's facts. Every field is copied once; an unknown field refuses the whole context. */
export function readActionContext(raw: unknown): ContextResult {
  const fields = snapshotOfFields(raw, FIELDS);
  if (fields === null) return bad('a context is a plain object of the known fields, with no getter, no intent and no free command text');
  const tool = fields['tool'];
  if (!(COMPUTER_TOOLS as readonly unknown[]).includes(tool)) return bad('the tool is not one this module knows');
  const initiator = fields['initiator'];
  if (!(INITIATOR_KINDS as readonly unknown[]).includes(initiator)) return bad('the initiator is not one of person, routine, deployment, agent');
  if (fields['submit'] !== undefined && typeof fields['submit'] !== 'boolean') return bad('submit is true or false');
  if (fields['text'] !== undefined && (typeof fields['text'] !== 'string' || fields['text'].length > MAX_TYPED_TEXT_CHARS)) return bad('text is a string within the cap');
  const host = fields['host'] === undefined ? null : canonicalHost(fields['host']);
  const chord = fields['key'] === undefined ? null : normalizeKey(fields['key'] as string);
  const element = fields['element'] === undefined ? null : elementOf(fields['element']);
  const file = fields['file'] === undefined ? null : fileOf(fields['file']);
  const mcp = fields['mcp'] === undefined ? null : mcpOf(fields['mcp']);
  const title = fields['title'] === undefined ? '' : foldedText(fields['title']);
  const url = fields['url'] === undefined ? '' : foldedText(fields['url'], 2048);
  if (title === null || url === null) return bad('title and url are text without a control character');
  const exec: PreparedExec | null = fields['exec'] === undefined ? null : isPreparedExec(fields['exec']) ? fields['exec'] : null;
  const present: Readonly<Record<string, unknown>> = { host, element, file, mcp, exec, key: chord };
  for (const name of Object.keys(present)) {
    if (fields[name] !== undefined && present[name] === null) return bad(`${name} is not in a form this module reads`);
  }
  for (const need of NEEDS[tool as ComputerTool]) {
    if (present[need] === null) return missing(`${tool as string} needs ${need}`);
  }
  const submit = fields['submit'] === true;
  const textActivates = typeof fields['text'] === 'string' && textSubmits(fields['text']);
  const key = chord === null ? null : chord.key;
  const alt = chord !== null && chord.alt;
  const done: ComputerActionContext = Object.freeze({
    tool: tool as ComputerTool,
    intent: intentOf(tool as ComputerTool, key, submit, alt, textActivates),
    host,
    element,
    key,
    keyDestructive: key !== null && isDestructiveKey(key, alt),
    title,
    url,
    submit,
    textActivates,
    file,
    mcp,
    command: exec === null ? null : foldForMatch(exec.argv.join(' ')),
    execHash: exec === null ? null : exec.hash,
    initiator: initiator as InitiatorKind,
  });
  return { ok: true, context: done };
}
