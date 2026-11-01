// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/memory_tool_store.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-01: modified for ProjectOS. CHANGED: translated from Python to TypeScript onto the agent's System port; the OS file lock became a create-if-absent lock; a provenance record sits beside each store; the drift backup is not ported, because a remove now shows the reviewer the whole entry
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The memory files, on the agent's `System` port. Reads for anyone, and the write half for the queue.
 *
 *   .projectops/memory/MEMORY.md                  the capped store, §-delimited
 *   .projectops/memory/USER.md
 *   .projectops/memory/MEMORY.provenance.json     who proposed each entry, and who approved it
 *   .projectops/memory/USER.provenance.json
 *   .projectops/memory/proposals/<id>.json        every proposal, pending or decided
 *
 * `core` holds the rules. This file holds the failure modes a pure rule cannot see.
 *
 * AN UNREADABLE STORE IS NOT AN EMPTY STORE. `readText` answers null for "absent" and for "there and
 * unreadable" alike. Treating the second as empty and saving would wipe the store, so it is told apart
 * with `exists`, and refused. A file with invalid UTF-8 decodes with replacement characters, and a
 * rewrite would persist that loss over the real bytes, so that is refused too.
 *
 * A LOCK THAT DOES NOT CLEAR ITSELF. As with the degraded ledger: the second writer loses at once, and
 * a lock left by a killed process blocks until an operator removes the file the message names.
 */
import {
  isMemoryEntryProvenance,
  joinMemoryEntries,
  memoryRefused,
  memoryOk,
  parseMemoryEntries,
  renderMemoryBlock,
  type MemoryEntryProvenance,
  type MemoryPromptBlock,
  type MemoryResult,
  type MemoryStoreState,
  type MemoryTarget,
} from '@projectos/core';
import { join, projectopsDir } from '../context.js';
import type { System } from '../system.js';

const LOCK_FILENAME = '.memory.lock';
const LOSSY = '\ufffd';

export function memoryDir(root: string): string {
  return join(projectopsDir(root), 'memory');
}

export function memoryStorePath(root: string, target: MemoryTarget): string {
  return join(memoryDir(root), target === 'user' ? 'USER.md' : 'MEMORY.md');
}

export function memoryProvenancePath(root: string, target: MemoryTarget): string {
  return join(memoryDir(root), target === 'user' ? 'USER.provenance.json' : 'MEMORY.provenance.json');
}

function readEntries(sys: System, path: string): MemoryResult<readonly string[]> {
  const raw = sys.readText(path);
  if (raw === null) {
    return sys.exists(path) ? memoryRefused('MEMORY_UNREADABLE', `${path} exists but could not be read, so nothing was changed.`) : memoryOk([]);
  }
  if (raw.includes(LOSSY)) {
    return memoryRefused('MEMORY_UNREADABLE', `${path} is not valid text, so nothing was changed. Repair it first.`);
  }
  return memoryOk(parseMemoryEntries(raw));
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function readProvenance(sys: System, path: string): MemoryResult<ReadonlyMap<string, MemoryEntryProvenance>> {
  const raw = sys.readText(path);
  if (raw === null) {
    return sys.exists(path) ? memoryRefused('MEMORY_UNREADABLE', `${path} exists but could not be read.`) : memoryOk(new Map());
  }
  const parsed = parsedJson(raw);
  if (parsed === undefined) return memoryRefused('MEMORY_UNREADABLE', `${path} is not valid JSON, so no entry can be trusted to it.`);
  const held = isRecord(parsed) ? parsed['entries'] : undefined;
  if (!isRecord(held)) return memoryRefused('MEMORY_UNREADABLE', `${path} holds no entries, so no entry can be trusted to it.`);
  const records = new Map<string, MemoryEntryProvenance>();
  for (const [hash, record] of Object.entries(held)) {
    if (!isMemoryEntryProvenance(hash, record)) {
      return memoryRefused('MEMORY_UNREADABLE', `${path} holds a record that is not valid, so no entry can be trusted to it.`);
    }
    records.set(hash, record);
  }
  return memoryOk(records);
}

/** One store as it stands. Refused, never guessed, when either file cannot be read. */
export function readMemoryStore(sys: System, root: string, target: MemoryTarget): MemoryResult<MemoryStoreState> {
  const entries = readEntries(sys, memoryStorePath(root, target));
  if (!entries.ok) return entries;
  const provenance = readProvenance(sys, memoryProvenancePath(root, target));
  if (!provenance.ok) return provenance;
  return memoryOk({ entries: entries.value, provenance: provenance.value });
}

/** The fenced, scanned block for one store. The only way memory text leaves this module for a prompt. */
export function loadMemoryBlock(sys: System, root: string, target: MemoryTarget): MemoryResult<MemoryPromptBlock> {
  const state = readMemoryStore(sys, root, target);
  return state.ok ? renderMemoryBlock(target, state.value) : state;
}

/** Temp file and rename, so a reader never sees a partial file. */
export function writeFileAtomically(sys: System, path: string, content: string): boolean {
  const temporary = `${path}.tmp`;
  try {
    sys.writeText(temporary, content);
  } catch {
    sys.removeFile(temporary);
    return false;
  }
  if (sys.renameFile(temporary, path)) return true;
  sys.removeFile(temporary);
  return false;
}

export function writeMemoryProvenance(sys: System, root: string, target: MemoryTarget, records: ReadonlyMap<string, MemoryEntryProvenance>): boolean {
  const entries = Object.fromEntries([...records].sort(([a], [b]) => a.localeCompare(b)));
  return writeFileAtomically(sys, memoryProvenancePath(root, target), `${JSON.stringify({ target, entries }, null, 2)}\n`);
}

export function writeMemoryEntries(sys: System, root: string, target: MemoryTarget, entries: readonly string[]): boolean {
  return writeFileAtomically(sys, memoryStorePath(root, target), joinMemoryEntries(entries));
}

/**
 * Do one read-modify-write with nobody else inside. Read, check and write happen under one hold.
 *
 * A LOCK THAT WILL NOT RELEASE DOES NOT CHANGE WHAT HAPPENED. The body's answer is returned as it was,
 * with a warning beside it, so a write that landed is never reported as a write that did not.
 */
export function underMemoryLock<T>(sys: System, root: string, body: () => MemoryResult<T>): MemoryResult<T> {
  const lock = join(memoryDir(root), LOCK_FILENAME);
  if (!sys.createExclusive(lock, `{"heldSince":"${sys.now()}"}\n`)) {
    return sys.exists(lock)
      ? memoryRefused('MEMORY_LOCKED', `Another process is writing memory; nothing changed. If none is, ${lock} was left by one that died and must be removed.`)
      : memoryRefused('MEMORY_WRITE_FAILED', `${memoryDir(root)} could not be written, so nothing was changed.`);
  }
  let result: MemoryResult<T> = memoryRefused('MEMORY_WRITE_FAILED', 'The memory write did not run.');
  let released = false;
  try {
    result = body();
  } finally {
    released = sys.removeFile(lock);
  }
  return released ? result : { ...result, warning: `The memory lock ${lock} could not be released; later writes will refuse until it is removed.` };
}
