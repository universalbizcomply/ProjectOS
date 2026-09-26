/**
 * THE CANONICAL CANDIDATE EVIDENCE — the agent's own reading of it.
 *
 * PROJECTOS-HOST-REVIEW-PATH1B. The Host derives, from its own repository reader, the complete set of
 * paths that differ between the approved baseline commit and the candidate commit, inserts EXACTLY
 * those canonical bytes into what the reviewer reads, and binds their SHA-256 into the attestation. The
 * agent holds the same two commits, so it REBUILDS the same bytes here and refuses an attestation whose
 * digest disagrees: an attestation over evidence the agent cannot reproduce is an attestation about
 * something other than this candidate.
 *
 * ONE REPRESENTATION, TWO IMPLEMENTATIONS. What is hashed is what the reviewer is shown - there is no
 * second, compact encoding that a digest could vouch for while a reviewer reads something else. This
 * mirrors `gatekeeper-attestation/src/candidate_evidence.rs` byte for byte; both are pinned by the
 * committed vector file, so drift on either side fails that side.
 *
 *   projectos-candidate-evidence: v1
 *   baseline-commit: <40 hex>
 *   candidate-commit: <40 hex>
 *   changed-paths: <n>
 *   (then, for each entry ascending by path BYTES)
 *   <empty line>
 *   [<i>] <added|deleted|modified|type-changed> <path>
 *       mode: <oooooo> -> <oooooo> (<kind of the candidate side>)
 *       object: <old id> -> <new id>
 *       contents-sha256: <64 hex>                      \  when the candidate side is present
 *       contents-bytes: <N> (utf-8, verbatim)          |  followed by the N bytes and one line feed
 *       contents-bytes: <N> (binary, not shown)        /  or this line alone
 *       contents: none (deleted in the candidate)         when it is absent
 *
 * UNAMBIGUOUS ALTHOUGH IT IS TEXT: paths are ASCII-graphic, and verbatim contents are preceded by their
 * exact byte count, so where contents end is never something the contents can decide.
 *
 * PURE. No git, no file, no process: the entries arrive from the caller.
 */
import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';

export const CANDIDATE_EVIDENCE_SCHEMA = 2;
/** Maximum ancestry commits one review will bind (F2). Mirrors the Host's own bound. */
export const MAX_ANCESTRY_STEPS = 128;
export const MAX_EVIDENCE_ENTRIES = 2_000;
export const MAX_EVIDENCE_PATH_LEN = 512;
export const MAX_ENTRY_CONTENT_BYTES = 1_048_576;
export const MAX_TOTAL_CONTENT_BYTES = 4 * 1_048_576;

export type EvidenceChange = 'added' | 'deleted' | 'modified' | 'type-changed';

const CHANGES: ReadonlySet<string> = new Set(['added', 'deleted', 'modified', 'type-changed']);

/** The only entry kinds evidence can describe, and how each is named. Every other mode refuses. */
const KIND_LABEL: ReadonlyMap<number, string> = new Map([
  [0, 'absent'],
  [0o100644, 'file'],
  [0o100755, 'executable-file'],
  [0o120000, 'symbolic-link-not-followed'],
]);

export interface CandidateEvidenceEntry {
  readonly change: EvidenceChange;
  readonly path: string;
  /** Octal tree-entry mode as a number; `0` when that side is absent. */
  readonly oldMode: number;
  readonly newMode: number;
  /** Full-length lower-case object identity; all zero when that side is absent. */
  readonly oldId: string;
  readonly newId: string;
  /** RAW committed bytes of the candidate side; `null` exactly when that side is absent. */
  readonly contents: Buffer | null;
}

/** One changed path of ONE ancestry step (F2). `vanishedContents` is non-null EXACTLY when this
 * step's bytes do not survive to the candidate - reverted or overwritten later - which is what a
 * push publishes that endpoint trees cannot show. */
export interface AncestryEvidenceEntry {
  readonly change: EvidenceChange;
  readonly path: string;
  readonly oldMode: number;
  readonly newMode: number;
  readonly oldId: string;
  readonly newId: string;
  readonly vanishedContents: Buffer | null;
}

/** One ancestry commit: the commit, the single parent that links it, its own changed paths. */
export interface AncestryEvidenceStep {
  readonly commit: string;
  readonly parent: string;
  readonly entries: readonly AncestryEvidenceEntry[];
}

export interface CandidateEvidenceInput {
  readonly baselineCommit: string;
  readonly candidateCommit: string;
  readonly entries: readonly CandidateEvidenceEntry[];
  /** The EXACT ordered ancestry baseline -> candidate (F2). History order; never sorted. */
  readonly ancestry: readonly AncestryEvidenceStep[];
}

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ASCII_GRAPHIC = /^[\x21-\x7e]+$/;

const octal = (mode: number): string => mode.toString(8).padStart(6, '0');

/**
 * The canonical bytes and their digest, or why this is not evidence. NOTHING IS DROPPED OR SHORTENED to
 * make evidence fit: the same refusals the Host applies are applied here, so the two sides cannot agree
 * on a digest of something one of them would have refused.
 */
export function candidateEvidenceDigest(
  input: CandidateEvidenceInput,
): { readonly problems: readonly string[]; readonly digest: string | null; readonly canonical: Buffer | null } {
  const e: string[] = [];
  const { baselineCommit, candidateCommit, entries, ancestry } = input;
  if (!OBJECT_ID.test(baselineCommit) || !OBJECT_ID.test(candidateCommit) || baselineCommit.length !== candidateCommit.length) {
    e.push('the baseline and candidate must be full-length lower-case commit identities of one length');
  } else if (/^0+$/.test(baselineCommit) || /^0+$/.test(candidateCommit)) {
    // The endpoints hold themselves to the ancestry steps' rule (review finding, 2026-09-26):
    // the all-zero id is git's "no object" sentinel, never a commit. Mirrors the Rust assemble.
    e.push('the baseline and candidate must be full-length lower-case commit identities of one length');
  }
  if (entries.length > MAX_EVIDENCE_ENTRIES) e.push(`the evidence has ${entries.length} changed paths; the bound is ${MAX_EVIDENCE_ENTRIES}`);

  let total = 0;
  for (const x of entries) {
    const where = `changed path '${x.path}'`;
    if (x.path.length === 0 || x.path.length > MAX_EVIDENCE_PATH_LEN || !ASCII_GRAPHIC.test(x.path)) {
      e.push('a changed path is empty, oversize or not ASCII-graphic');
      continue;
    }
    if (!CHANGES.has(x.change)) e.push(`${where} has an unknown change type`);
    if (!OBJECT_ID.test(x.oldId) || !OBJECT_ID.test(x.newId) || x.oldId.length !== baselineCommit.length || x.newId.length !== baselineCommit.length) {
      e.push(`${where} carries a malformed object identity`);
      continue;
    }
    if (!KIND_LABEL.has(x.oldMode) || !KIND_LABEL.has(x.newMode)) {
      e.push(`${where} is a submodule pointer or another unsupported entry kind`);
      continue;
    }
    const oldAbsent = x.oldMode === 0;
    const newAbsent = x.newMode === 0;
    if (oldAbsent !== /^0+$/.test(x.oldId) || newAbsent !== /^0+$/.test(x.newId)) e.push(`${where} disagrees with itself about which side is absent`);
    const consistent =
      x.change === 'added' ? oldAbsent && !newAbsent : x.change === 'deleted' ? !oldAbsent && newAbsent : !oldAbsent && !newAbsent;
    if (!consistent) e.push(`${where} has a change type that disagrees with which sides are present`);
    if ((x.contents !== null) === newAbsent) e.push(`${where} has contents exactly where it should not`);
    if (x.contents !== null) {
      if (x.contents.length > MAX_ENTRY_CONTENT_BYTES) e.push(`${where} exceeds the per-file evidence bound`);
      total += x.contents.length;
    }
  }
  if (total > MAX_TOTAL_CONTENT_BYTES) e.push('the evidence as a whole exceeds its bound');

  // ONE ORDER: ascending by path BYTES, exactly as the Host sorts. Paths are ASCII, so comparing the
  // buffers is comparing the bytes.
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.path === sorted[i - 1]!.path) e.push(`changed path '${sorted[i]!.path}' appears twice`);
  }
  // F2: THE ORDERED ANCESTRY MUST LINK, exactly as the Host requires - baseline -> first -> ... ->
  // candidate, one parent each, in the given order. Two different endpoints with no steps would hide
  // every commit a push publishes; identical endpoints with steps would invent history.
  if (ancestry.length > MAX_ANCESTRY_STEPS) e.push('the ancestry exceeds its bound');
  if ((ancestry.length === 0) !== (baselineCommit === candidateCommit)) {
    e.push('the ancestry does not link the baseline to the candidate');
  }
  let expectedParent = baselineCommit;
  const validatedSteps: { commit: string; parent: string; entries: AncestryEvidenceEntry[] }[] = [];
  for (const step of ancestry) {
    if (
      !OBJECT_ID.test(step.commit) ||
      step.commit.length !== baselineCommit.length ||
      step.parent !== expectedParent ||
      /^0+$/.test(step.commit)
    ) {
      e.push('the ancestry does not link the baseline to the candidate');
      break;
    }
    if (step.entries.length > MAX_EVIDENCE_ENTRIES) e.push('an ancestry step has more changed paths than the bound');
    const stepEntries = [...step.entries].sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
    for (let i = 0; i < stepEntries.length; i++) {
      const x = stepEntries[i]!;
      const where = `ancestry path '${x.path}'`;
      if (i > 0 && stepEntries[i - 1]!.path === x.path) e.push(`${where} appears twice in one step`);
      if (x.path.length === 0 || x.path.length > MAX_EVIDENCE_PATH_LEN || !ASCII_GRAPHIC.test(x.path)) {
        e.push('an ancestry path is empty, oversize or not ASCII-graphic');
        continue;
      }
      if (!CHANGES.has(x.change)) e.push(`${where} has an unknown change type`);
      if (!OBJECT_ID.test(x.oldId) || !OBJECT_ID.test(x.newId) || x.oldId.length !== baselineCommit.length || x.newId.length !== baselineCommit.length) {
        e.push(`${where} carries a malformed object identity`);
        continue;
      }
      if (!KIND_LABEL.has(x.oldMode) || !KIND_LABEL.has(x.newMode)) {
        e.push(`${where} is a submodule pointer or another unsupported entry kind`);
        continue;
      }
      const oldAbsent = x.oldMode === 0;
      const newAbsent = x.newMode === 0;
      if (oldAbsent !== /^0+$/.test(x.oldId) || newAbsent !== /^0+$/.test(x.newId)) e.push(`${where} disagrees with itself about which side is absent`);
      const consistent =
        x.change === 'added' ? oldAbsent && !newAbsent : x.change === 'deleted' ? !oldAbsent && newAbsent : !oldAbsent && !newAbsent;
      if (!consistent) e.push(`${where} has a change type that disagrees with which sides are present`);
      if (x.vanishedContents !== null && newAbsent) e.push(`${where} carries vanished contents for an absent side`);
      if (x.vanishedContents !== null) {
        if (x.vanishedContents.length > MAX_ENTRY_CONTENT_BYTES) e.push(`${where} exceeds the per-file evidence bound`);
        total += x.vanishedContents.length;
      }
    }
    validatedSteps.push({ commit: step.commit, parent: step.parent, entries: stepEntries });
    expectedParent = step.commit;
  }
  if (validatedSteps.length > 0 && validatedSteps[validatedSteps.length - 1]!.commit !== candidateCommit) {
    e.push('the ancestry does not link the baseline to the candidate');
  }
  if (total > MAX_TOTAL_CONTENT_BYTES) e.push('the evidence as a whole exceeds its bound');
  if (e.length > 0) return { problems: e, digest: null, canonical: null };

  const parts: Buffer[] = [];
  const line = (text: string): void => {
    parts.push(Buffer.from(`${text}\n`, 'utf8'));
  };
  line(`projectos-candidate-evidence: v${CANDIDATE_EVIDENCE_SCHEMA}`);
  line(`baseline-commit: ${baselineCommit}`);
  line(`candidate-commit: ${candidateCommit}`);
  line(`ancestry-commits: ${validatedSteps.length}`);
  validatedSteps.forEach((step, stepIndex) => {
    line('');
    line(`commit [${stepIndex + 1}/${validatedSteps.length}] ${step.commit} parent ${step.parent}`);
    line(`    step-changed-paths: ${step.entries.length}`);
    for (const x of step.entries) {
      line(`    ~ ${x.change} ${x.path}`);
      line(`      mode: ${octal(x.oldMode)} -> ${octal(x.newMode)} (${KIND_LABEL.get(x.newMode)!})`);
      line(`      object: ${x.oldId} -> ${x.newId}`);
      if (x.vanishedContents === null) {
        line('      survives-to-candidate');
      } else {
        line(`      vanished-sha256: ${createHash('sha256').update(x.vanishedContents).digest('hex')}`);
        if (isUtf8(x.vanishedContents) && !x.vanishedContents.includes(0)) {
          line(`      vanished-bytes: ${x.vanishedContents.length} (utf-8, verbatim)`);
          parts.push(x.vanishedContents, Buffer.from('\n', 'utf8'));
        } else {
          line(`      vanished-bytes: ${x.vanishedContents.length} (binary, not shown)`);
        }
      }
    }
  });
  line(`changed-paths: ${sorted.length}`);
  sorted.forEach((x, index) => {
    line('');
    line(`[${index + 1}] ${x.change} ${x.path}`);
    line(`    mode: ${octal(x.oldMode)} -> ${octal(x.newMode)} (${KIND_LABEL.get(x.newMode)!})`);
    line(`    object: ${x.oldId} -> ${x.newId}`);
    if (x.contents === null) {
      line('    contents: none (deleted in the candidate)');
      return;
    }
    line(`    contents-sha256: ${createHash('sha256').update(x.contents).digest('hex')}`);
    // TEXT IS VERBATIM AND IN FULL; anything else is described, never decoded lossily. The same rule as
    // the Host: valid UTF-8 with no NUL byte.
    if (isUtf8(x.contents) && !x.contents.includes(0)) {
      line(`    contents-bytes: ${x.contents.length} (utf-8, verbatim)`);
      parts.push(x.contents, Buffer.from('\n', 'utf8'));
    } else {
      line(`    contents-bytes: ${x.contents.length} (binary, not shown)`);
    }
  });
  const canonical = Buffer.concat(parts);
  return { problems: [], digest: createHash('sha256').update(canonical).digest('hex'), canonical };
}
