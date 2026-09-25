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

const VECTORS = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'contracts', 'host-review-path-vectors.v1.json'), 'utf8'),
) as { inputs: { baselineCommit: string; subjectCommit: string; evidence: VectorEntry[] } };

export const VECTOR_BASELINE_COMMIT = VECTORS.inputs.baselineCommit;
export const VECTOR_CANDIDATE_COMMIT = VECTORS.inputs.subjectCommit;

const STATUS = { added: 'A', deleted: 'D', modified: 'M', 'type-changed': 'T' } as const;

/** A git that holds exactly the vector's two commits and answers the three verbs the source uses. */
export function vectorGit(entries: readonly VectorEntry[] = VECTORS.inputs.evidence): GitBytes {
  return (args) => {
    const [verb] = args;
    const last = args[args.length - 1]!;
    if (verb === 'merge-base') {
      return args[2] === VECTOR_BASELINE_COMMIT && last === VECTOR_CANDIDATE_COMMIT ? Buffer.alloc(0) : null;
    }
    if (verb === 'diff-tree') {
      if (args[args.length - 2] !== VECTOR_BASELINE_COMMIT || last !== VECTOR_CANDIDATE_COMMIT) return null;
      return Buffer.concat(
        entries.map((e) => Buffer.from(`:${e.oldMode} ${e.newMode} ${e.oldId} ${e.newId} ${STATUS[e.change]}\0${e.path}\0`, 'latin1')),
      );
    }
    if (verb === 'cat-file') {
      const entry = entries.find((e) => last === `${VECTOR_CANDIDATE_COMMIT}:${e.path}`);
      return entry?.contentsUtf8 === undefined ? null : Buffer.from(entry.contentsUtf8, 'utf8');
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
