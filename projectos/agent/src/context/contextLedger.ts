// Origin: original ProjectOS code
/**
 * APPENDING TO THE RETRIEVAL LEDGER (PROJECTOS-CONTEXT-MANAGER1A, plan 3.4).
 *
 * The loop writes one numbered file per entry, `000001.json` and up, in a directory under the INSTALLATION'S state (not in the
 * project tree: see `contextRun.ts`). An entry is written to a temporary name by a CREATE-IF-ABSENT write and then renamed to its
 * number, so a crash in the middle leaves a temporary file, which the next run sweeps, and never a truncated entry under a number.
 * The temporary name is per number, so two writers that reach for the same number cannot both create it: the loser reads the
 * directory again and takes the next, once. An entry that exists is never rewritten (the number is checked before the rename).
 *
 * WHAT IS CHECKED BEFORE AN ENTRY IS ADDED. The directory must hold only files this module would have written (a name it did not
 * make is refused, so a planted file cannot sit in the chain's place), numbered from 1 with no gap, and the NEWEST
 * `CONTEXT_LEDGER_TAIL_WINDOW` entries must read as a chain: each parses at the size an entry has, hashes to itself and follows
 * the one before. The whole history is not read on every run, so a changed entry older than the window is not found here: the
 * full chain is verified by `contextLedgerProblem` where an audit reads it (named residual), and a head hash kept elsewhere
 * would anchor the tail.
 *
 * THE LEDGER FAILING IS THE RUN FAILING. If an entry cannot be written the caller does not show stored text: what was shown must
 * be on the record first.
 */
import {
  MAX_CONTEXT_LEDGER_ENTRIES,
  contextLedgerFileName,
  contextLedgerSeqOfFileName,
  parseContextLedgerEntry,
  sealContextLedgerEntry,
  type ContextLedgerBody,
  type ContextLedgerEntry,
} from '@projectos/core';

/** How much of the end of the chain is read and verified before an entry is added. */
export const CONTEXT_LEDGER_TAIL_WINDOW = 64;

/** What the ledger touches. `removeFile` is only ever asked of a temporary name, and `renameFile` only moves a temporary name to its number. */
export interface ContextLedgerFiles {
  readonly listDir: (path: string) => readonly string[];
  readonly readText: (path: string) => string | null;
  /** Creates the file only if it is not there. True when this call created it. */
  readonly createExclusive: (path: string, content: string) => boolean;
  readonly renameFile: (from: string, to: string) => boolean;
  readonly removeFile: (path: string) => boolean;
}

/** What an operating system leaves in a directory. It is not a foreign file. */
const OS_JUNK = /^(?:desktop\.ini|thumbs\.db|\.ds_store)$/i;
/** A temporary entry name: an entry that was being written when the process died. */
const TEMPORARY_ENTRY = /^\d{6}\.json\.tmp$/;

/** What to do about a ledger that cannot take an entry: who does it, and what. The ledger is ProjectOS's alone, and so is nothing a worker may touch. */
export function contextLedgerRepairOf(code: string, directory: string): string {
  switch (code) {
    case 'CONTEXT_LEDGER_FOREIGN_FILE':
      return `Fix: the owner removes or moves the file in ${directory} that the ledger did not write (the ledger is ProjectOS's alone), then runs again.`;
    case 'CONTEXT_LEDGER_BROKEN':
      return `Fix: the owner compares ${directory} with a backup or the last good copy and restores any entry that was edited, removed or cut off; if the owner decides to abandon that chain, moving the whole directory aside starts a new one. Then run again.`;
    case 'CONTEXT_LEDGER_UNREADABLE':
      return `Fix: the owner checks that ${directory} can be read by the user who runs ProjectOS, then runs again.`;
    case 'CONTEXT_LEDGER_FULL':
      return `Fix: the owner archives ${directory} (moves it aside, and a new chain starts), then runs again.`;
    case 'CONTEXT_LEDGER_WRITE_FAILED':
      return `Fix: the owner checks the disk and the permissions on ${directory}, and that no other ProjectOS run is writing there, then runs again.`;
    default:
      return `Fix: this is a defect in ProjectOS, not in ${directory}: the owner reports it, and nothing is shown to a worker until it is fixed.`;
  }
}

export type ContextLedgerAppendCode =
  | 'CONTEXT_LEDGER_BODY_INVALID'
  | 'CONTEXT_LEDGER_FOREIGN_FILE'
  | 'CONTEXT_LEDGER_BROKEN'
  | 'CONTEXT_LEDGER_UNREADABLE'
  | 'CONTEXT_LEDGER_FULL'
  | 'CONTEXT_LEDGER_WRITE_FAILED';

export type ContextLedgerAppend =
  | { readonly ok: true; readonly entry: ContextLedgerEntry; readonly path: string }
  | { readonly ok: false; readonly code: ContextLedgerAppendCode };

type Tail = { readonly ok: true; readonly last: ContextLedgerEntry | null } | { readonly ok: false; readonly code: ContextLedgerAppendCode };

/** The directory's numbers in order, or why it is not a ledger. */
function numbersOf(files: ContextLedgerFiles, directory: string): readonly number[] | ContextLedgerAppendCode {
  let names: readonly string[];
  try {
    names = files.listDir(directory);
  } catch {
    return 'CONTEXT_LEDGER_UNREADABLE';
  }
  if (!Array.isArray(names) || names.length > MAX_CONTEXT_LEDGER_ENTRIES) return 'CONTEXT_LEDGER_FULL';
  const numbers: number[] = [];
  for (const name of names) {
    if (OS_JUNK.test(name) || TEMPORARY_ENTRY.test(name)) continue;
    const seq = contextLedgerSeqOfFileName(name);
    if (seq === null) return 'CONTEXT_LEDGER_FOREIGN_FILE';
    numbers.push(seq);
  }
  numbers.sort((a, b) => a - b);
  return numbers;
}

/** The newest entries, read and verified as a chain, and the last of them. */
function tailOf(files: ContextLedgerFiles, directory: string, numbers: readonly number[]): Tail {
  if (numbers.length === 0) return { ok: true, last: null };
  if (numbers.some((seq, index) => seq !== (numbers[0] as number) + index)) return { ok: false, code: 'CONTEXT_LEDGER_BROKEN' };
  if ((numbers[0] as number) !== 1) return { ok: false, code: 'CONTEXT_LEDGER_BROKEN' };
  let previous: ContextLedgerEntry | null = null;
  for (const seq of numbers.slice(-CONTEXT_LEDGER_TAIL_WINDOW)) {
    const name = contextLedgerFileName(seq);
    let text: string | null;
    try {
      text = files.readText(`${directory}/${name as string}`);
    } catch {
      text = null;
    }
    if (text === null) return { ok: false, code: 'CONTEXT_LEDGER_UNREADABLE' };
    const parsed = parseContextLedgerEntry(text);
    if (!parsed.ok || parsed.entry.seq !== seq) return { ok: false, code: 'CONTEXT_LEDGER_BROKEN' };
    if (previous !== null && parsed.entry.prevHash !== previous.entryHash) return { ok: false, code: 'CONTEXT_LEDGER_BROKEN' };
    if (previous === null && seq === 1 && parsed.entry.prevHash !== null) return { ok: false, code: 'CONTEXT_LEDGER_BROKEN' };
    previous = parsed.entry;
  }
  return { ok: true, last: previous };
}

function attempt(files: ContextLedgerFiles, directory: string, body: ContextLedgerBody): ContextLedgerAppend | 'raced' {
  const numbers = numbersOf(files, directory);
  if (typeof numbers === 'string') return { ok: false, code: numbers };
  const tail = tailOf(files, directory, numbers);
  if (!tail.ok) return { ok: false, code: tail.code };
  const seq = (tail.last?.seq ?? 0) + 1;
  const sealed = sealContextLedgerEntry(body, seq, tail.last?.entryHash ?? null);
  if (!sealed.ok) return { ok: false, code: sealed.code === 'CONTEXT_LEDGER_BODY_INVALID' ? 'CONTEXT_LEDGER_BODY_INVALID' : 'CONTEXT_LEDGER_FULL' };
  const path = `${directory}/${contextLedgerFileName(seq) as string}`;
  const temporary = `${path}.tmp`;
  let written = false;
  try {
    // A temporary name left by a process that died is this number's own: sweep it, then create it exclusively.
    files.removeFile(temporary);
    written = files.createExclusive(temporary, `${JSON.stringify(sealed.entry)}\n`) && files.readText(path) === null && files.renameFile(temporary, path);
  } catch {
    written = false;
  }
  if (!written) {
    try {
      files.removeFile(temporary);
    } catch {
      // nothing is left under a number either way
    }
  }
  return written ? { ok: true, entry: sealed.entry, path } : 'raced';
}

/** Add one entry. A lost race is tried once more, from a fresh read; nothing is ever overwritten. */
export function appendContextLedger(files: ContextLedgerFiles, directory: string, body: ContextLedgerBody): ContextLedgerAppend {
  const first = attempt(files, directory, body);
  if (first !== 'raced') return first;
  const second = attempt(files, directory, body);
  return second === 'raced' ? { ok: false, code: 'CONTEXT_LEDGER_WRITE_FAILED' } : second;
}
