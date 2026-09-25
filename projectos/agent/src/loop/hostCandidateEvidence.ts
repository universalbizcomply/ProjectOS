/**
 * THE AGENT'S OWN READING OF THE CANDIDATE — so it can refuse an attestation over any other evidence.
 *
 * PROJECTOS-HOST-REVIEW-PATH1B. The Host shows a reviewer the complete difference between the approved
 * baseline commit and the candidate commit and binds that evidence's digest into its attestation. The
 * agent has the same two commits, so it derives the same changed-path set here, with its OWN git, and
 * recomputes the digest BEFORE anything is asked. `readHostResponseRecord` then refuses an attestation
 * whose digest differs: an approval of evidence the agent cannot reproduce is an approval of something
 * other than this candidate.
 *
 * IT IS A CHECK, NEVER AN INPUT TO THE HOST. Nothing computed here is sent. The Host derives its own
 * evidence from its own reader and never sees the agent's; agreement is two independent readings of one
 * repository arriving at one digest.
 *
 * BUFFERS, NOT STRINGS. `System.exec` returns decoded text, which would corrupt a binary blob and with it
 * the content digest. The production source therefore spawns git itself and keeps every byte as read.
 *
 * THE SAME SPELLING THE HOST USES: endpoint trees, rename detection off, full-length identities, and
 * replacement objects disabled, so both sides read the difference the same way.
 */
import { spawnSync } from 'node:child_process';
import { candidateEvidenceDigest, type CandidateEvidenceEntry, type EvidenceChange } from '@projectos/core';

/** The agent's recomputed evidence digest, or why it could not be established. */
export type CandidateEvidenceSource = (
  baselineCommit: string,
  candidateCommit: string,
) => { readonly digest: string } | { readonly problems: readonly string[] };

/** One committed-object read: raw bytes on success, `null` on any failure. Injectable for proofs. */
export type GitBytes = (args: readonly string[]) => Buffer | null;

const COMMIT = /^[0-9a-f]{40}$/;
const STATUS: Readonly<Record<string, EvidenceChange>> = { A: 'added', D: 'deleted', M: 'modified', T: 'type-changed' };
/** Matches the Host reader's per-object bound; a larger object is refused, never shortened. */
const MAX_GIT_OUTPUT = 1_048_576;

/**
 * Parse `diff-tree -r --raw -z` output. ANYTHING NOT FULLY UNDERSTOOD IS A REFUSAL: a record skipped
 * here is a changed path missing from the digest, which would then disagree with the Host for a reason
 * nobody could see.
 */
export function parseRawTreeDifference(
  raw: Buffer,
): { readonly entries: readonly Omit<CandidateEvidenceEntry, 'contents'>[] } | { readonly problems: readonly string[] } {
  if (raw.length === 0) return { entries: [] };
  if (raw[raw.length - 1] !== 0) return { problems: ['the tree difference does not end in a record terminator'] };
  const fields = raw.subarray(0, raw.length - 1).toString('latin1').split('\0');
  if (fields.length % 2 !== 0) return { problems: ['the tree difference is not a whole number of records'] };
  const entries: Omit<CandidateEvidenceEntry, 'contents'>[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const meta = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([ADMT])$/.exec(fields[i]!);
    const path = fields[i + 1]!;
    if (meta === null) return { problems: ['a tree-difference record is not in the expected raw form'] };
    entries.push({
      change: STATUS[meta[5]!]!,
      path,
      oldMode: parseInt(meta[1]!, 8),
      newMode: parseInt(meta[2]!, 8),
      oldId: meta[3]!,
      newId: meta[4]!,
    });
  }
  return { entries };
}

/** The evidence source over any committed-object reader. */
export function candidateEvidenceSource(git: GitBytes): CandidateEvidenceSource {
  return (baselineCommit, candidateCommit) => {
    if (!COMMIT.test(baselineCommit) || !COMMIT.test(candidateCommit)) {
      return { problems: ['the baseline and the candidate must each be an exact 40-character commit id'] };
    }
    // THE BASELINE MUST BE AN ANCESTOR, exactly as the Host requires: the difference between two
    // unrelated trees is not a change to what the owner approved.
    if (git(['merge-base', '--is-ancestor', baselineCommit, candidateCommit]) === null) {
      return { problems: ['the approved baseline is not an ancestor of the candidate in this repository'] };
    }
    const raw = git(['diff-tree', '-r', '--raw', '-z', '--no-abbrev', '--no-renames', '--no-ext-diff', '--end-of-options', baselineCommit, candidateCommit]);
    if (raw === null) return { problems: ['the difference between the baseline and the candidate could not be read'] };
    const parsed = parseRawTreeDifference(raw);
    if ('problems' in parsed) return parsed;

    const entries: CandidateEvidenceEntry[] = [];
    for (const e of parsed.entries) {
      if (e.newMode === 0) {
        entries.push({ ...e, contents: null });
        continue;
      }
      // Read only what the digest will accept a description of; an unsupported kind is refused by the
      // digest itself, so there is nothing to read for it.
      const readable = e.newMode === 0o100644 || e.newMode === 0o100755 || e.newMode === 0o120000;
      const contents = readable ? git(['cat-file', 'blob', '--end-of-options', `${candidateCommit}:${e.path}`]) : Buffer.alloc(0);
      if (contents === null) return { problems: [`the committed contents of '${e.path}' could not be read within the evidence bound`] };
      entries.push({ ...e, contents });
    }
    const computed = candidateEvidenceDigest({ baselineCommit, candidateCommit, entries });
    return computed.digest === null ? { problems: computed.problems } : { digest: computed.digest };
  };
}

/**
 * The production reader: the bound git executable, in the governed root, no shell, bounded output and
 * time, replacement objects and grafts disabled, and no pager or prompt.
 */
export function nodeGitBytes(gitExe: string, root: string): GitBytes {
  return (args) => {
    const result = spawnSync(gitExe, [...args], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: MAX_GIT_OUTPUT,
      timeout: 15_000,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        GIT_NO_REPLACE_OBJECTS: '1',
        GIT_GRAFT_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_PAGER: 'cat',
        GIT_NO_LAZY_FETCH: '1',
        LC_ALL: 'C',
      },
    });
    if (result.error !== undefined || result.status !== 0) return null;
    return result.stdout;
  };
}
