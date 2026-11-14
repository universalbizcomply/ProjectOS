// Origin: original ProjectOS code
/**
 * THE ONE DOOR (PROJECTOS-MEMORY-STORES1A).
 *
 * A worker asks for a memory or a skill by adding an entry to the `proposals` list of its findings record. This reads that
 * list into typed requests. It decides nothing: the kernel's own queues (`proposalQueue`, `skillQueue`) turn a request into
 * a PENDING proposal pinned by its hash, and the owner or an independent reviewer decides. Nothing here writes, and nothing
 * here approves.
 *
 * THE FINDINGS RECORD IS WORKER-WRITTEN, SO EVERY BYTE OF IT IS DATA. Each entry is read once, from a copy: a field that is
 * a getter, a symbol key, a Proxy or a non-plain object refuses the entry, so a value cannot be clean when it is checked and
 * something else when it is used. A key the reader does not know refuses the entry too, which is how a worker is kept from
 * naming its own author, role, session, time, state, hash or skill origin: those come from the kernel, and an entry that
 * carries one is refused, not trimmed.
 *
 * A WORKER DOES NOT PROPOSE A DECISION. Worker-written text is never passed on as a decision, so a `decision` kind from a
 * findings record is refused here. The owner states a decision, and the ledger holds it.
 *
 * A REFUSAL IS A VALUE. Each carries a machine-readable code for the audit record and a neutral message that quotes none of
 * the worker's text, and one bad entry does not hide a good one: every entry is answered.
 *
 * Pure: no I/O.
 */
import { types } from 'node:util';
import { MEMORY_ENTRY_KINDS, MEMORY_OPS, type MemoryEntryKind, type MemoryOp } from './proposal.js';
import { MEMORY_TARGETS, type MemoryTarget } from './store.js';

export const FINDINGS_PROPOSAL_CLASSES = ['memory', 'skill'] as const;
export type FindingsProposalClass = (typeof FINDINGS_PROPOSAL_CLASSES)[number];

/** What one record may ask for at once, so a worker cannot bury the owner's queue. The queues cap what waits. */
export const MAX_FINDINGS_PROPOSALS = 10;
/** The door's own bound on text, ahead of the queues' rules, so what is parsed is bounded by this and not by the worker. */
export const MAX_DOOR_FIELD_CHARS = 20_000;
/** Keys that name the prototype chain. JSON can carry them as own keys, and an assignment to one would not make a field. */
const PROTOTYPE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** A record or an entry with more fields than this is refused unread, so the copy is bounded by this and not by the worker. */
export const MAX_DOOR_FIELDS = 200;
export const MAX_DOOR_SKILL_FILES = 50;
export const MAX_DOOR_SKILL_PATH_CHARS = 256;
export const MAX_DOOR_SKILL_TOTAL_CHARS = 1_048_576;

export const PROPOSAL_DOOR_CODES = [
  'PROPOSAL_DOOR_NOT_PLAIN',
  'PROPOSAL_DOOR_NOT_A_LIST',
  'PROPOSAL_DOOR_TOO_MANY',
  'PROPOSAL_DOOR_NOT_AN_OBJECT',
  'PROPOSAL_DOOR_UNKNOWN_CLASS',
  'PROPOSAL_DOOR_UNKNOWN_FIELD',
  'PROPOSAL_DOOR_BAD_FIELD',
  'PROPOSAL_DOOR_TOO_LARGE',
  'PROPOSAL_DOOR_DECISION_KIND',
] as const;
export type ProposalDoorCode = (typeof PROPOSAL_DOOR_CODES)[number];

export interface ProposalDoorRefusal {
  /** The position in the list, or null when the list itself was refused. */
  readonly index: number | null;
  readonly code: ProposalDoorCode;
  readonly message: string;
}

export interface FindingsMemoryRequest {
  readonly class: 'memory';
  readonly index: number;
  readonly request: {
    readonly target: MemoryTarget;
    readonly op: MemoryOp;
    readonly kind: MemoryEntryKind;
    readonly content?: string;
    readonly oldText?: string;
    readonly ledgerRef?: string;
  };
}

export interface FindingsSkillRequest {
  readonly class: 'skill';
  readonly index: number;
  readonly files: readonly { readonly path: string; readonly text: string }[];
}

export type FindingsProposalRequest = FindingsMemoryRequest | FindingsSkillRequest;

export interface FindingsProposalsRead {
  readonly requests: readonly FindingsProposalRequest[];
  readonly refused: readonly ProposalDoorRefusal[];
}

const MEMORY_FIELDS = ['class', 'target', 'op', 'kind', 'content', 'oldText', 'ledgerRef'] as const;
const SKILL_FIELDS = ['class', 'files'] as const;
const SKILL_FILE_FIELDS = ['path', 'text'] as const;

const refusal = (index: number | null, code: ProposalDoorCode, message: string): ProposalDoorRefusal => ({ index, code, message });

const isPlainProto = (value: object): boolean => [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null);

/** A Proxy answers every question the reader asks as its handler likes, so it is refused before anything is asked of it. */
const isProxy = (value: object): boolean => types.isProxy(value);

/** The own, enumerable data fields of a plain object, copied once; null for an accessor, a symbol key or a Proxy. */
function fieldsOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || isProxy(value) || Array.isArray(value) || !isPlainProto(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_DOOR_FIELDS) return null;
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== 'string' || PROTOTYPE_KEYS.includes(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) return null;
    if (descriptor.value !== undefined) copy[key] = descriptor.value;
  }
  return copy;
}

/** The elements of a plain array, copied once, or null. Holes and accessors are refused. */
function elementsOf(value: unknown, max: number): readonly unknown[] | null | 'too-many' {
  if (typeof value !== 'object' || value === null || isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  if (value.length > max) return 'too-many';
  const copy: unknown[] = [];
  for (let position = 0; position < value.length; position += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(position));
    if (descriptor === undefined || !('value' in descriptor)) return null;
    copy.push(descriptor.value);
  }
  return copy;
}

const oneOf = <T extends string>(allowed: readonly T[], value: unknown): value is T => typeof value === 'string' && (allowed as readonly string[]).includes(value);

function unknownFieldOf(fields: Record<string, unknown>, allowed: readonly string[]): string | null {
  return Object.keys(fields).find((key) => !allowed.includes(key)) ?? null;
}

type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: ProposalDoorRefusal };

function memoryRequestOf(index: number, fields: Record<string, unknown>): Read<FindingsMemoryRequest> {
  if (unknownFieldOf(fields, MEMORY_FIELDS) !== null) {
    return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_UNKNOWN_FIELD', 'That entry names a field the door does not take. The kernel supplies who proposed it, when, and its hash.') };
  }
  const { target, op, kind, content, oldText, ledgerRef } = fields;
  if (!oneOf(MEMORY_TARGETS, target) || !oneOf(MEMORY_OPS, op) || !oneOf(MEMORY_ENTRY_KINDS, kind)) {
    return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_BAD_FIELD', 'A memory entry needs a target, an op and a kind from the closed lists.') };
  }
  if (kind === 'decision') {
    return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_DECISION_KIND', 'A worker does not propose a decision. The owner states one, and the ledger holds it.') };
  }
  const texts = [content, oldText, ledgerRef];
  if (texts.some((text) => text !== undefined && typeof text !== 'string')) {
    return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_BAD_FIELD', 'The text fields of a memory entry are text.') };
  }
  if (texts.some((text) => typeof text === 'string' && text.length > MAX_DOOR_FIELD_CHARS)) {
    return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_TOO_LARGE', `A memory entry field holds at most ${MAX_DOOR_FIELD_CHARS} characters. Nothing was read.`) };
  }
  return {
    ok: true,
    value: Object.freeze({
      class: 'memory',
      index,
      request: Object.freeze({
        target,
        op,
        kind,
        ...(typeof content === 'string' ? { content } : {}),
        ...(typeof oldText === 'string' ? { oldText } : {}),
        ...(typeof ledgerRef === 'string' ? { ledgerRef } : {}),
      }),
    }),
  };
}

function skillRequestOf(index: number, fields: Record<string, unknown>): Read<FindingsSkillRequest> {
  if (unknownFieldOf(fields, SKILL_FIELDS) !== null) {
    return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_UNKNOWN_FIELD', 'That entry names a field the door does not take. A skill is proposed as a package, and its origin is the kernel\'s to say.') };
  }
  const listed = elementsOf(fields['files'], MAX_DOOR_SKILL_FILES);
  if (listed === 'too-many') {
    return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_TOO_LARGE', `A skill package holds at most ${MAX_DOOR_SKILL_FILES} files. Nothing was read.`) };
  }
  if (listed === null || listed.length === 0) {
    return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_BAD_FIELD', 'A skill entry needs a list of files, each with a path and text.') };
  }
  const files: { readonly path: string; readonly text: string }[] = [];
  let total = 0;
  for (const listedFile of listed) {
    const file = fieldsOf(listedFile);
    if (file === null) return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_NOT_PLAIN', 'A skill file is plain data, with no accessors.') };
    if (unknownFieldOf(file, SKILL_FILE_FIELDS) !== null) {
      return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_UNKNOWN_FIELD', 'A skill file is a path and its text, and nothing else.') };
    }
    const { path, text } = file;
    if (typeof path !== 'string' || path === '' || typeof text !== 'string') {
      return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_BAD_FIELD', 'A skill file needs a path and text, both text.') };
    }
    total += text.length;
    if (path.length > MAX_DOOR_SKILL_PATH_CHARS || total > MAX_DOOR_SKILL_TOTAL_CHARS) {
      return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_TOO_LARGE', 'A skill package is over what the door reads. Nothing was read.') };
    }
    files.push(Object.freeze({ path, text }));
  }
  return { ok: true, value: Object.freeze({ class: 'skill', index, files: Object.freeze(files) }) };
}

function entryOf(index: number, listed: unknown): Read<FindingsProposalRequest> {
  if (typeof listed !== 'object' || listed === null || Array.isArray(listed)) {
    return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_NOT_AN_OBJECT', 'A proposals entry is an object.') };
  }
  const fields = fieldsOf(listed);
  if (fields === null) return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_NOT_PLAIN', 'A proposals entry is plain data, with no accessors, symbols or proxies.') };
  if (fields['class'] === 'memory') return memoryRequestOf(index, fields);
  if (fields['class'] === 'skill') return skillRequestOf(index, fields);
  return { ok: false, refusal: refusal(index, 'PROPOSAL_DOOR_UNKNOWN_CLASS', "A proposals entry's class is 'memory' or 'skill'.") };
}

/**
 * The requests in a findings record's `proposals` entry, and a refusal for each entry that is not one. A record with no
 * `proposals` entry asks for nothing. `record` is the parsed findings record, and it is read once.
 */
export function readFindingsProposals(record: unknown): FindingsProposalsRead {
  const fields = fieldsOf(record);
  if (fields === null) return { requests: [], refused: [refusal(null, 'PROPOSAL_DOOR_NOT_PLAIN', 'The findings record is plain data, with no accessors, symbols or proxies.')] };
  if (!('proposals' in fields)) return { requests: [], refused: [] };
  const listed = elementsOf(fields['proposals'], MAX_FINDINGS_PROPOSALS);
  if (listed === 'too-many') {
    return { requests: [], refused: [refusal(null, 'PROPOSAL_DOOR_TOO_MANY', `A findings record may ask for at most ${MAX_FINDINGS_PROPOSALS} proposals. None was read.`)] };
  }
  if (listed === null) {
    const plainButNotAList = !Array.isArray(fields['proposals']);
    return {
      requests: [],
      refused: [
        plainButNotAList
          ? refusal(null, 'PROPOSAL_DOOR_NOT_A_LIST', 'The proposals entry is a list.')
          : refusal(null, 'PROPOSAL_DOOR_NOT_PLAIN', 'The proposals list is plain data, with no accessors or proxies.'),
      ],
    };
  }
  const read = listed.map((entry, index) => entryOf(index, entry));
  return {
    requests: Object.freeze(read.flatMap((one) => (one.ok ? [one.value] : []))),
    refused: Object.freeze(read.flatMap((one) => (one.ok ? [] : [one.refusal]))),
  };
}
