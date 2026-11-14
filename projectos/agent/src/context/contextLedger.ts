// Origin: original ProjectOS code
/**
 * APPENDING TO THE RETRIEVAL LEDGER (PROJECTOS-CONTEXT-MANAGER1A, plan 3.4).
 *
 * The loop writes one numbered file per entry, `.projectops/context-ledger/000001.json` and up, through a CREATE-IF-ABSENT write
 * and nothing else: the port below has no overwrite and no delete, so an entry that exists is never rewritten. Two writers that
 * reach for the same number cannot both win; the loser reads the directory again and takes the next, once.
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

/** What the ledger touches. There is no overwrite and no delete: this is the whole port. */
export interface ContextLedgerFiles {
  readonly listDir: (path: string) => readonly string[];
  readonly readText: (path: string) => string | null;
  /** Creates the file only if it is not there. True when this call created it. */
  readonly createExclusive: (path: string, content: string) => boolean;
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
  let created = false;
  try {
    created = files.createExclusive(path, `${JSON.stringify(sealed.entry)}\n`);
  } catch {
    created = false;
  }
  return created ? { ok: true, entry: sealed.entry, path } : 'raced';
}

/** Add one entry. A lost race is tried once more, from a fresh read; nothing is ever overwritten. */
export function appendContextLedger(files: ContextLedgerFiles, directory: string, body: ContextLedgerBody): ContextLedgerAppend {
  const first = attempt(files, directory, body);
  if (first !== 'raced') return first;
  const second = attempt(files, directory, body);
  return second === 'raced' ? { ok: false, code: 'CONTEXT_LEDGER_WRITE_FAILED' } : second;
}
