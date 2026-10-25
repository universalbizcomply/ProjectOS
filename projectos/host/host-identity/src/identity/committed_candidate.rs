//! THE canonical committed-candidate digest — the one thing the agent and the host must both be able
//! to say about "which bytes is this review about".
//!
//! Ratified by the owner for PROJECTOS-HOST-REVIEW-PATH1A after the implementation stopped: the
//! protected-operation binding digest folds in a `candidate_digest`, and there was no rule by which
//! two independent parties could arrive at the same 32 bytes. This is that rule, and it is deliberately
//! the smallest one that works.
//!
//! ## What it is over
//!
//! One immutable git commit object id, spelled as exactly 40 lowercase ASCII hexadecimal characters.
//! Nothing else. No tree id, no path list, no working-tree state, no branch name, no `HEAD`.
//!
//! ## Why not the working tree
//!
//! The agent already has a canonical identity for the bytes a commit WOULD record
//! (`candidateIdentity.ts`). It cannot be used here, and that is not a preference: the host resolves
//! its own candidate and refuses caller bytes, so a digest of an uncommitted working tree is a digest
//! of a subject only one of the two parties can see. Two sides cannot independently agree on that.
//! The consequence, stated plainly because it shapes what unattended review means: this path can only
//! ever review a candidate that has already been committed.
//!
//! ## Why not the bare object id, and what that does NOT buy
//!
//! `candidate_digest` is 32 bytes wide and a git commit id is 20, so the id has to be projected into a
//! fixed-width value under its own domain tag — that keeps this digest's namespace disjoint from every
//! other SHA-256 subject in the tree. That is the ONLY reason. Hashing a git object id with SHA-256
//! does NOT improve the collision resistance of git's own object identity, and nothing here should be
//! read as claiming it does.
//!
//! ## Encoding
//!
//! Every field is fixed width, so the concatenation is unambiguous without length prefixes:
//!
//! ```text
//! COMMITTED_CANDIDATE_DOMAIN                 (a fixed-length constant)
//! COMMITTED_CANDIDATE_SCHEMA_VERSION as u32  (big endian, 4 bytes)
//! the commit oid                             (exactly 40 ASCII bytes)
//! ```
//!
//! ## It mints nothing
//!
//! A digest is not authority. The host still resolves its own commit, the agent still resolves its own,
//! and `evaluate_protected_operation` still refuses unless the two agree.

use sha2::{Digest, Sha256};

/// Width of a committed-candidate digest, matching the protected-operation binding digest's field.
pub const COMMITTED_CANDIDATE_DIGEST_LEN: usize = 32;

/// THE ONE domain tag under which a committed candidate is digested.
///
/// Disjoint from `PROGRAMME_IDENTITY_DOMAIN` and from the host request-binding domain, so a commit id
/// can never collide with an identity or a binding subject. Its exact bytes are pinned by the tests
/// here and by the cross-language vectors, because a signer and a verifier that disagree about a domain
/// tag fail permanently and for no visible reason.
pub const COMMITTED_CANDIDATE_DOMAIN: &[u8] = b"projectos.committed-candidate.v1";

/// The only accepted schema version. There is no downgrade and no negotiation.
pub const COMMITTED_CANDIDATE_SCHEMA_VERSION: u32 = 1;

/// The exact number of characters in a git commit object id, as this contract accepts it.
pub const COMMIT_OID_CHARS: usize = 40;

/// Is this exactly 40 lowercase ASCII hexadecimal characters?
///
/// STRICT, AND UPPERCASE IS REFUSED RATHER THAN NORMALISED. `ABC…` and `abc…` name the same commit to
/// git, so normalising would be the friendly thing to do — and it would mean two spellings of one
/// subject produce two different digests unless every implementation in every language normalises
/// identically. Refusing one spelling is the only rule that cannot drift.
#[must_use]
pub fn is_canonical_commit_oid(oid: &str) -> bool {
    oid.len() == COMMIT_OID_CHARS
        && oid
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// THE canonical committed-candidate digest, or `None` when the oid is not canonical.
///
/// `None` IS A REFUSAL, NEVER A FALLBACK. There is no "best effort" digest of a malformed id: a caller
/// that cannot name an immutable commit has not named a candidate, and the only safe answer is to
/// refuse before anything is bound.
#[must_use]
pub fn committed_candidate_digest(commit_oid: &str) -> Option<[u8; COMMITTED_CANDIDATE_DIGEST_LEN]> {
    if !is_canonical_commit_oid(commit_oid) {
        return None;
    }
    let mut h = Sha256::new();
    h.update(COMMITTED_CANDIDATE_DOMAIN);
    h.update(COMMITTED_CANDIDATE_SCHEMA_VERSION.to_be_bytes());
    h.update(commit_oid.as_bytes());
    Some(h.finalize().into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The vector every other implementation of this contract is pinned to. If this value changes,
    /// every agent and every host that already agreed stop agreeing — so it changes only with the
    /// schema version beside it.
    const VECTOR_A_OID: &str = "20fe0722528af748504baf9c094818c003a95ef7";

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn vector_a_is_stable() {
        let d = committed_candidate_digest(VECTOR_A_OID).expect("canonical oid");
        // Pinned by value, not by recomputation: a test that recomputes the function it is testing
        // proves only that the function is deterministic, not that the contract has not moved.
        assert_eq!(
            hex(&d),
            "b51a9290b5633009dbe1f53e575ed97d4367ce142f4621ca105389a8a6ceedbf"
        );
    }

    #[test]
    fn vector_b_one_character_changes_the_digest() {
        let a = committed_candidate_digest(VECTOR_A_OID).expect("canonical");
        let mutated = format!("20fe0722528af748504baf9c094818c003a95ef8");
        let b = committed_candidate_digest(&mutated).expect("canonical");
        assert_ne!(a, b);
    }

    #[test]
    fn vector_c_uppercase_is_refused() {
        assert!(committed_candidate_digest("20FE0722528AF748504BAF9C094818C003A95EF7").is_none());
    }

    #[test]
    fn vector_d_wrong_length_is_refused() {
        assert!(committed_candidate_digest(&VECTOR_A_OID[..39]).is_none());
        assert!(committed_candidate_digest(&format!("{VECTOR_A_OID}a")).is_none());
    }

    #[test]
    fn vector_e_non_hex_is_refused() {
        assert!(committed_candidate_digest("20fe0722528af748504baf9c094818c003a95efg").is_none());
        assert!(committed_candidate_digest("20fe0722528af748504baf9c094818c003a95ef ").is_none());
    }

    #[test]
    fn the_domain_is_disjoint_from_the_programme_identity_domain() {
        assert_ne!(
            COMMITTED_CANDIDATE_DOMAIN,
            super::super::installation_programme::PROGRAMME_IDENTITY_DOMAIN
        );
    }
}
