// Origin: original ProjectOS code
/**
 * A PROOF OF A COMMITTED READ IS MINTED HERE AND TRUSTED ONLY HERE (PROJECTOS-MEMORY-PROVENANCE1A, fix round 1, H1).
 *
 * A claim to rank as a decision or as approved memory is believed only with a proof, and a proof used to be any object holding
 * two 40-character hex names: so anyone could write one. A proof is now an object this module made, registered in a WeakSet that
 * nothing outside this file can reach. `judgeCommittedRead` is the only caller of `mintCommittedProof`, and it mints one only
 * for a read that passed every rule. A plain object, a copy, a `structuredClone`, a JSON round-trip and an object that merely
 * inherits from a proof are not in the set, so none of them is a proof.
 *
 * The proof names the ONE FILE it read and the KIND that read established, because a proof from one file is no proof of another:
 * the ranking requires `proof.path === item id` and `proof.kind === item kind`.
 *
 * `mintCommittedProof` is not exported from the core barrel. What the barrel offers is the question, `isCommittedProof`.
 *
 * WHAT THIS CANNOT PROVE. It is an in-process registry: code that can import this file can mint. That is the same trust as the
 * rest of core. It stops data (a worker's JSON, a stored item, a hand-built object) from claiming a rank, which is what it is for.
 *
 * Pure: no I/O.
 */

export type CommittedProofKind = 'committed-decision' | 'approved-memory' | 'plan-memory';

/** What a committed read established: the commit and blob it read, the path, and the kind that path is. */
export interface CommittedProof {
  readonly commit: string;
  readonly blob: string;
  readonly path: string;
  readonly kind: CommittedProofKind;
}

const MINTED: WeakSet<object> = new WeakSet();

/** Make a proof. Only a committed read that passed every rule calls this. */
export function mintCommittedProof(fields: CommittedProof): CommittedProof {
  const proof: CommittedProof = Object.freeze({ commit: fields.commit, blob: fields.blob, path: fields.path, kind: fields.kind });
  MINTED.add(proof);
  return proof;
}

/** Is this exactly an object `mintCommittedProof` made? A look-alike is not. */
export function isCommittedProof(value: unknown): value is CommittedProof {
  return typeof value === 'object' && value !== null && MINTED.has(value);
}
