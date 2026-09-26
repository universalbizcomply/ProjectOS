/**
 * THE AGENT'S REAL EVIDENCE SOURCE over a git stand-in that serves EXACTLY what the committed vector
 * file says the repository holds (PROJECTOS-HOST-REVIEW-PATH1B).
 *
 * Only `git` is simulated. The raw tree-difference parser, the contents reads and the canonical digest
 * are the production code, so a test that accepts the real Host's recorded attestation is also proof
 * that this implementation reads the same two commits to the same digest the real Host attested.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { candidateEvidenceSource, type CandidateEvidenceSource, type GitBytes } from '../../src/loop/hostCandidateEvidence.js';

interface VectorEntry {
  readonly change: 'added' | 'deleted' | 'modified' | 'type-changed';
  readonly path: string;
  readonly oldMode: string;
  readonly newMode: string;
  readonly oldId: string;
  readonly newId: string;
  readonly contentsUtf8?: string;
}

interface VectorStep {
  readonly commit: string;
  readonly parent: string;
  readonly entries?: (VectorEntry & { readonly vanishedContentsUtf8?: string })[];
}

const VECTORS = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'contracts', 'host-review-path-vectors.v1.json'), 'utf8'),
) as { inputs: { baselineCommit: string; subjectCommit: string; evidence: VectorEntry[]; ancestry: VectorStep[] } };

export const VECTOR_BASELINE_COMMIT = VECTORS.inputs.baselineCommit;
export const VECTOR_CANDIDATE_COMMIT = VECTORS.inputs.subjectCommit;

const STATUS = { added: 'A', deleted: 'D', modified: 'M', 'type-changed': 'T' } as const;

/** A git that holds exactly the vector's commits and answers the four verbs the source uses. */
export function vectorGit(
  entries: readonly VectorEntry[] = VECTORS.inputs.evidence,
  ancestry: readonly VectorStep[] = VECTORS.inputs.ancestry,
): GitBytes {
  const record = (e: VectorEntry): Buffer =>
    Buffer.from(`:${e.oldMode} ${e.newMode} ${e.oldId} ${e.newId} ${STATUS[e.change]}\0${e.path}\0`, 'latin1');
  return (args) => {
    const [verb] = args;
    const last = args[args.length - 1]!;
    if (verb === 'merge-base') {
      return args[2] === VECTOR_BASELINE_COMMIT && last === VECTOR_CANDIDATE_COMMIT ? Buffer.alloc(0) : null;
    }
    if (verb === 'rev-list') {
      // F2: the strict linear enumeration, oldest first, `commit parent` per line.
      if (last !== `${VECTOR_BASELINE_COMMIT}..${VECTOR_CANDIDATE_COMMIT}`) return null;
      return Buffer.from(ancestry.map((s) => `${s.commit} ${s.parent}\n`).join(''), 'latin1');
    }
    if (verb === 'diff-tree') {
      const base = args[args.length - 2]!;
      if (base === VECTOR_BASELINE_COMMIT && last === VECTOR_CANDIDATE_COMMIT) {
        return Buffer.concat(entries.map(record));
      }
      const step = ancestry.find((s) => s.parent === base && s.commit === last);
      return step === undefined ? null : Buffer.concat((step.entries ?? []).map(record));
    }
    if (verb === 'cat-file') {
      const endpoint = entries.find((e) => last === `${VECTOR_CANDIDATE_COMMIT}:${e.path}`);
      if (endpoint?.contentsUtf8 !== undefined) return Buffer.from(endpoint.contentsUtf8, 'utf8');
      for (const s of ancestry) {
        const at = (s.entries ?? []).find((e) => last === `${s.commit}:${e.path}`);
        if (at !== undefined) {
          const bytes = at.vanishedContentsUtf8 ?? at.contentsUtf8;
          if (bytes !== undefined) return Buffer.from(bytes, 'utf8');
        }
      }
      return null;
    }
    return null;
  };
}

/** The production evidence source, reading the vector's repository. */
export const VECTOR_EVIDENCE_SOURCE: CandidateEvidenceSource = candidateEvidenceSource(vectorGit());

/** The digest that source computes for the vector's two commits. Throws if it cannot. */
export function vectorEvidenceDigest(): string {
  const own = VECTOR_EVIDENCE_SOURCE(VECTOR_BASELINE_COMMIT, VECTOR_CANDIDATE_COMMIT);
  if ('problems' in own) throw new Error(`the vector evidence could not be derived: ${own.problems.join('; ')}`);
  return own.digest;
}
