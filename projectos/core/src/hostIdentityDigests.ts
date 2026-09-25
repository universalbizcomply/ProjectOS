/**
 * THE AGENT'S MIRROR of the host's canonical identity and committed-candidate digests.
 *
 * WHY A MIRROR EXISTS AT ALL. The protected-operation wire carries a `binding_digest` the host computes
 * from facts IT resolved, and refuses unless the caller's claim equals it byte for byte. So the agent
 * has to be able to spell the same identities. It is not a second opinion about what they mean: the one
 * definition of meaning is Rust — `projectos/host/host-identity/src/identity/installation_programme.rs`
 * and `.../committed_candidate.rs` — and this file exists to produce the same bytes.
 *
 * NEITHER SIDE HAND-AUTHORS ITS EXPECTED VALUES. Both read
 * `projectos/contracts/host-identity-vectors.v1.json`. If this file drifts from the Rust one, the test
 * that reads those vectors fails here, and the matching Rust test fails there. That is the only
 * arrangement in which "the two languages agree" is a checked fact rather than a hope.
 *
 * A DIGEST IS NOT AUTHORITY. Everything here is a claim the agent puts on the wire. The host resolves
 * its own facts and `evaluate_protected_operation` compares; nothing computed here can make something
 * true.
 *
 * Created in PROJECTOS-HOST-REVIEW-PATH1A under the owner's ratified committed-candidate contract and
 * the gatekeeper's source-truth ruling that the delegation's `plan`/`phase` are PROGRAMME IDENTITY
 * digests of the plan reference and the phase id — not `phase_definition_digest`.
 */
import { createHash } from 'node:crypto';

/** Width of every digest in this file, matching the delegation's fixed-width fields. */
export const PROGRAMME_IDENTITY_DIGEST_LEN = 32;

/** THE ONE domain tag under which a programme identity is digested. Mirrors `PROGRAMME_IDENTITY_DOMAIN`. */
export const PROGRAMME_IDENTITY_DOMAIN = 'projectos.programme-identity.v1';

/**
 * The closed set of field tags. Each identity gets its own tag beneath the one domain, so a project
 * literally named like a repository cannot produce a repository's digest.
 *
 * NOT EXPORTED AS A CALLER-CHOSEN PARAMETER, deliberately, and the Rust side keeps its `identity_digest`
 * private for the same reason: a function taking a tag is a function through which the wrong tag can be
 * passed. The typed helpers below are the only way to spell an identity.
 */
const FIELD = {
  project: 'project',
  repository: 'repository',
  plan: 'plan',
  phase: 'phase',
  modelPolicy: 'model-policy',
  credentialRef: 'credential-ref',
} as const;

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

/**
 * The canonical construction: the domain, the field tag and the value, EACH LENGTH-PREFIXED.
 *
 * The length prefixes are what make it injective: without them `("ab", "c")` and `("a", "bc")` encode
 * identically, and two different identities would share a digest. Private, exactly as the Rust
 * counterpart is.
 */
function identityDigest(field: string, value: string): Buffer {
  const d = Buffer.from(PROGRAMME_IDENTITY_DOMAIN, 'ascii');
  const f = Buffer.from(field, 'ascii');
  const v = Buffer.from(value, 'utf8');
  return createHash('sha256')
    .update(u32be(d.length))
    .update(d)
    .update(u32be(f.length))
    .update(f)
    .update(u32be(v.length))
    .update(v)
    .digest();
}

/** The canonical project identity digest. */
export function projectIdentityDigest(projectId: string): Buffer {
  return identityDigest(FIELD.project, projectId);
}

/** The canonical repository identity digest, over the canonical `host/owner/name` spelling. */
export function repositoryIdentityDigest(repository: string): Buffer {
  return identityDigest(FIELD.repository, repository);
}

/** The canonical approved-plan identity digest, over the plan REFERENCE. */
export function planIdentityDigest(planRef: string): Buffer {
  return identityDigest(FIELD.plan, planRef);
}

/**
 * The canonical phase identity digest, over the phase ID.
 *
 * This is what a delegation's `allowed_phases` entries hold. It is NOT the host's
 * `phase_definition_digest`, which is an integrity digest over a normalized definition's nineteen
 * authority fields and answers a different question; using that here produces a permanent refusal.
 */
export function phaseIdentityDigest(phaseId: string): Buffer {
  return identityDigest(FIELD.phase, phaseId);
}

/** The canonical model-policy identity digest. */
export function modelPolicyIdentityDigest(modelPolicy: string): Buffer {
  return identityDigest(FIELD.modelPolicy, modelPolicy);
}

/** The canonical credential-REFERENCE identity digest. A purpose or name, never a secret value. */
export function credentialRefIdentityDigest(credentialRef: string): Buffer {
  return identityDigest(FIELD.credentialRef, credentialRef);
}

// -------------------------------------------------------------------------------------------------
// THE COMMITTED CANDIDATE
// -------------------------------------------------------------------------------------------------

/** THE ONE domain tag under which a committed candidate is digested. */
export const COMMITTED_CANDIDATE_DOMAIN = 'projectos.committed-candidate.v1';

/** The only accepted schema version. No downgrade, no negotiation. */
export const COMMITTED_CANDIDATE_SCHEMA_VERSION = 1;

/** The exact number of characters this contract accepts for a commit object id. */
export const COMMIT_OID_CHARS = 40;

const CANONICAL_OID = /^[0-9a-f]{40}$/;

/**
 * Exactly 40 lowercase ASCII hexadecimal characters?
 *
 * UPPERCASE IS REFUSED RATHER THAN NORMALISED. Git treats the two spellings as one commit, so
 * normalising looks helpful — and it means every implementation in every language has to normalise
 * identically or two spellings of one subject produce two digests. Refusing one spelling is the only
 * rule that cannot drift.
 */
export function isCanonicalCommitOid(oid: unknown): oid is string {
  return typeof oid === 'string' && CANONICAL_OID.test(oid);
}

/**
 * The canonical committed-candidate digest, or `null` when the oid is not canonical.
 *
 * `null` IS A REFUSAL, NEVER A FALLBACK. A caller that cannot name an immutable commit has not named a
 * candidate, and there is no best-effort digest of one.
 *
 * The subject is the commit id alone — no tree id, no path list, no working-tree state. The outer
 * SHA-256 is a fixed-width, domain-separated projection of git's own identity; it does NOT improve the
 * collision resistance of that identity and must not be described as if it does.
 */
export function committedCandidateDigest(commitOid: string): Buffer | null {
  if (!isCanonicalCommitOid(commitOid)) return null;
  return createHash('sha256')
    .update(Buffer.from(COMMITTED_CANDIDATE_DOMAIN, 'ascii'))
    .update(u32be(COMMITTED_CANDIDATE_SCHEMA_VERSION))
    .update(Buffer.from(commitOid, 'ascii'))
    .digest();
}
