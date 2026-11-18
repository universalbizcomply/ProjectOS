// Origin: original ProjectOS code
/**
 * HOW MUCH THE PROPOSALS MAY TAKE (PROJECTOS-PROPOSAL-DOOR-WIRING1A, fix round, rule DW-12).
 *
 * A worker's findings can make the door write many large pending proposals through the legitimate path: a skill package may be 1 MiB, a record may carry ten entries,
 * and one author may hold ten pending. The store digest, which the guard judges every worker against, refuses a store tree over 8 MiB (`MEMORY_STORE_TOO_LARGE`). A
 * store that reaches that bound cannot be digested, so the guard refuses every later run (`MEMORY_STORE_UNCHECKED`) until a person deletes files by hand. The door must
 * not be the way a worker gets there.
 *
 * So the loop hands the door a BUDGET. It measures the two store roots the way the digest does (the size of each file, links and unreadable entries refused) and answers
 * whether one more entry fits under `PROPOSALS_BUDGET_BYTES`. The door asks it before it writes anything, once per entry that would be a new proposal, so the entries of one
 * record and of every later attempt all count. A refusal is the closed code `PROPOSAL_DOOR_BUDGET`; nothing is written for it, the attempt is not touched, and the entries that
 * were accepted are still absorbed into the guard's baseline by the step beside this one.
 *
 * It reads sizes and writes nothing. It is the only thing here that looks at an entry's text, and only for its length.
 */
import type { FindingsMemoryRequest, FindingsSkillRequest } from '@projectos/core';
import type { ProposalBudget } from '../memory/proposalDoor.js';
import { MAX_STORE_DIGEST_DEPTH, MAX_STORE_DIGEST_FILES } from '../memory/storeDigest.js';
import type { DocumentFs } from '../search/ports.js';

/**
 * What the stores may hold once a proposal is in them: 6 MiB, which is 2 MiB under the 8 MiB the digest refuses above (`MAX_STORE_DIGEST_TOTAL_BYTES` in `memory/storeDigest.ts`). The 2 MiB is the room
 * for what this check cannot see exactly: a proposal file is pretty-printed JSON with its provenance and validation report, and other things (an approved memory file, a
 * promoted skill, a decision the owner makes during a run) may be written between two measurements. A budget at the bound itself would leave none.
 */
export const PROPOSALS_BUDGET_BYTES = 6 * 1024 * 1024;
/** What a proposal file holds beyond the text it was asked for: schema, hashes, provenance, the validation report. Added to every entry, so the estimate is over and not under. */
export const PROPOSAL_FILE_OVERHEAD_BYTES = 64 * 1024;

const STORE_ROOTS: readonly string[] = ['.projectops/memory', '.projectops/skills'];

interface Tally {
  files: number;
  bytes: number;
}

function addBytesUnder(fs: DocumentFs, root: string, relative: string, depth: number, tally: Tally): boolean {
  if (depth > MAX_STORE_DIGEST_DEPTH) return false;
  for (const name of fs.listDir(`${root}/${relative}`)) {
    const path = `${relative}/${name}`;
    tally.files += 1;
    if (tally.files > MAX_STORE_DIGEST_FILES) return false;
    const stat = fs.stat(`${root}/${path}`);
    if (stat === null || stat.kind === 'link') return false;
    if (stat.kind === 'directory') {
      if (!addBytesUnder(fs, root, path, depth + 1, tally)) return false;
    } else if (stat.kind === 'file') {
      tally.bytes += stat.size;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * The bytes of every file under both store roots, summed from each file's size the way the store digest sums them, or null when the stores cannot be measured (a link, an
 * entry that cannot be read, more entries or depth than the digest reads). Null is never "nothing there": the budget refuses on it.
 */
export function storeBytesNow(fs: DocumentFs, root: string): number | null {
  const parent = fs.stat(`${root}/.projectops`);
  if (parent === null) return 0;
  if (parent.kind !== 'directory') return null;
  const tally: Tally = { files: 0, bytes: 0 };
  for (const store of STORE_ROOTS) {
    const stat = fs.stat(`${root}/${store}`);
    if (stat === null) continue;
    if (stat.kind !== 'directory') return null;
    if (!addBytesUnder(fs, root, store, 1, tally)) return null;
  }
  return tally.bytes;
}

/** An upper bound on the file the door would write for this entry: its own text as pretty-printed JSON, escapes included, and the fixed overhead. */
function entryBytesBound(entry: FindingsMemoryRequest | FindingsSkillRequest): number {
  const own = entry.class === 'skill' ? entry.files : entry.request;
  return Buffer.byteLength(JSON.stringify(own, null, 2), 'utf8') + PROPOSAL_FILE_OVERHEAD_BYTES;
}

/** The budget the loop gives the door: the stores are measured again for every entry, so entries of one record and of later attempts all count. */
export function proposalBudgetOf(fs: DocumentFs, root: string): ProposalBudget {
  return (entry) => {
    const used = storeBytesNow(fs, root);
    return used !== null && used + entryBytesBound(entry) <= PROPOSALS_BUDGET_BYTES;
  };
}
