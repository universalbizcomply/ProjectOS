// SPDX-License-Identifier: MIT
// Ported-From: copilotkit-openbot https://github.com/CopilotKit/OpenBot
// Source-Path: server/src/computer/policy.ts
// Source-Commit: c396a5f68c817043846f1ca3c2b42061ee73ceb5
// Source-Copyright: Copyright (c) 2026 CopilotKit
// Port-Strategy: ADAPT
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: only the policy context is taken, the tool, the page host, the element, the key, the file, the MCP call, the command and the initiator that a rule is written against, and the idea that the intent of an action is what a rule should name; the intent is now DERIVED here from the tool and its facts and is never accepted from the caller; an action that needs a fact (the element of a click, the page of a navigation, the file of a file action) is refused when the fact is missing, where the source bound an empty neutral value; the audit initiator type, the CEL bindings and the file description helpers are cut
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * What an action is about: the facts a policy rule is written against, read once and checked.
 *
 * THE INTENT IS DERIVED, NEVER SAID. `tool` describes the mechanism and the intent describes the effect, and a rule that
 * names only a mechanism is evaded by another mechanism: a click is refused and Enter is pressed instead. So the intent is
 * worked out here from the tool and its facts (a click, Enter and Space activate; typing with `submit` ends in Enter and
 * activates; any other key types), and a context that states its own intent is refused as an unknown field.
 *
 * A FACT THE ACTION NEEDS MUST BE THERE. A click needs the element the server resolved, a navigation needs a page, a file
 * action needs a workspace-relative file, a command needs its text, an MCP call needs its server, tool and effect. A context
 * without them is `CONTEXT_INCOMPLETE`, because a rule about a missing fact would otherwise read as false and let the action
 * through. Text that came from a page (an element name, a key, a host) is untrusted data, bounded and folded before a rule
 * reads it.
 *
 * Pure: no I/O.
 */
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
export const MAX_COMMAND_CHARS = 8192;

export interface ComputerElement {
  readonly role: string;
  readonly name: string;
  readonly type: string;
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
  readonly key: string | null;
  readonly submit: boolean;
  readonly file: ComputerFile | null;
  readonly mcp: ComputerMcp | null;
  readonly command: string | null;
  readonly initiator: InitiatorKind;
}

export type ContextRefusal = 'CONTEXT_INVALID' | 'CONTEXT_INCOMPLETE';
export type ContextResult = { readonly ok: true; readonly context: ComputerActionContext } | { readonly ok: false; readonly code: ContextRefusal; readonly detail: string };

const FIELDS = ['tool', 'host', 'element', 'key', 'submit', 'file', 'mcp', 'command', 'initiator'] as const;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const WORD = /^[a-z][a-z0-9_.-]{0,63}$/;

const bad = (detail: string): ContextResult => ({ ok: false, code: 'CONTEXT_INVALID', detail });
const missing = (detail: string): ContextResult => ({ ok: false, code: 'CONTEXT_INCOMPLETE', detail });

/** Untrusted text, folded: NFKC, lower case, bounded. `null` when it is not text or has a control character. */
export function foldedText(value: unknown, max = MAX_TEXT_CHARS): string | null {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.normalize('NFKC').toLowerCase();
}

/** A host as ASCII letters, digits and dots, lower case, with no trailing dot. `null` for an address literal or anything else. */
export function canonicalHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const host = value.endsWith('.') ? value.slice(0, -1) : value;
  if (!HOST.test(host) || /^[0-9.]+$/.test(host)) return null;
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
  const fields = snapshotOfFields(raw, ['role', 'name', 'type']);
  if (fields === null) return null;
  const role = foldedText(fields['role'], 64);
  const name = foldedText(fields['name']);
  const type = fields['type'] === undefined ? '' : foldedText(fields['type'], 64);
  return role === null || name === null || type === null ? null : Object.freeze({ role, name, type });
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

/** The effect of the action, worked out from the tool and what it presses. Never read from a request. */
export function intentOf(tool: ComputerTool, key: string | null, submit: boolean): ComputerIntent {
  switch (tool) {
    case 'click':
      return 'activate';
    case 'type':
      return submit ? 'activate' : 'type';
    case 'key':
      return key === 'enter' || key === 'return' || key === 'space' || key === ' ' ? 'activate' : 'type';
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

const NEEDS: Readonly<Record<ComputerTool, readonly ('host' | 'element' | 'file' | 'mcp' | 'command' | 'key')[]>> = {
  screenshot: ['host'], 'read-page': ['host'], scroll: ['host'], navigate: ['host'], click: ['host', 'element'], type: ['host', 'element'], key: ['host', 'key'],
  'list-files': ['file'], 'read-file': ['file'], 'write-file': ['file'], 'download-file': ['file'], 'run-command': ['command'], 'mcp-read': ['mcp'], 'mcp-write': ['mcp'],
};

/** Read one action's facts. Every field is copied once; an unknown field refuses the whole context. */
export function readActionContext(raw: unknown): ContextResult {
  const fields = snapshotOfFields(raw, FIELDS);
  if (fields === null) return bad('a context is a plain object of the known fields, with no getter and no intent');
  const tool = fields['tool'];
  if (!(COMPUTER_TOOLS as readonly unknown[]).includes(tool)) return bad('the tool is not one this module knows');
  const initiator = fields['initiator'];
  if (!(INITIATOR_KINDS as readonly unknown[]).includes(initiator)) return bad('the initiator is not one of person, routine, deployment, agent');
  if (fields['submit'] !== undefined && typeof fields['submit'] !== 'boolean') return bad('submit is true or false');
  const host = fields['host'] === undefined ? null : canonicalHost(fields['host']);
  const key = fields['key'] === undefined ? null : foldedText(fields['key'], 32);
  const element = fields['element'] === undefined ? null : elementOf(fields['element']);
  const file = fields['file'] === undefined ? null : fileOf(fields['file']);
  const mcp = fields['mcp'] === undefined ? null : mcpOf(fields['mcp']);
  const command = fields['command'] === undefined ? null : foldedText(fields['command'], MAX_COMMAND_CHARS);
  const present: Readonly<Record<string, unknown>> = { host, element, file, mcp, command, key };
  for (const name of Object.keys(present)) {
    if (fields[name] !== undefined && present[name] === null) return bad(`${name} is not in a form this module reads`);
  }
  for (const need of NEEDS[tool as ComputerTool]) {
    if (present[need] === null) return missing(`${tool as string} needs ${need}`);
  }
  if (command === '') return missing('a command needs its text');
  const submit = fields['submit'] === true;
  const done: ComputerActionContext = Object.freeze({
    tool: tool as ComputerTool,
    intent: intentOf(tool as ComputerTool, key, submit),
    host,
    element,
    key,
    submit,
    file,
    mcp,
    command,
    initiator: initiator as InitiatorKind,
  });
  return { ok: true, context: done };
}
