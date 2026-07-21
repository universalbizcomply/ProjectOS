//! Expected-publisher policy (WINDOWS-PACKAGED-RUNTIME-IDENTITY2B).
//!
//! An expected publisher is pinned by the SHA-256 of the signer certificate's subject public key —
//! never a display name, Common Name, organisation string, or filename. In this phase NO approved
//! production publisher exists, so the production policy is always `Unavailable`: a normal build can
//! never reach an "expected publisher" outcome, and therefore never `CcSignature::Verified`.
//!
//! `Unavailable` (no policy configured) is DISTINCT from `Unexpected` (a policy exists and the
//! signer does not match). An empty policy is never treated as a mismatch.

#![cfg(windows)]

/// Whether an expected-publisher policy is configured and usable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublisherPolicyStatus {
    /// No approved publisher identity is configured (the normal-build reality this phase).
    Unavailable,
    /// A policy with at least one active approved key is configured.
    Present,
    /// A policy object exists but is malformed / has no usable key.
    Invalid,
}

/// The outcome of matching a signer against the policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublisherOutcome {
    /// No policy to compare against — never a mismatch, never verified.
    Unavailable,
    /// A policy exists and the signer key is not on it.
    Unexpected,
    /// A policy exists and the signer key matches an approved, active key.
    Expected,
}

/// A pinned publisher key: SHA-256 of the signer certificate's subject public key. Non-secret.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublisherKey {
    pub spki_sha256: [u8; 32],
}

/// The approved-publisher policy. Production is EMPTY this phase (`status() == Unavailable`).
pub struct PublisherPolicy {
    approved: Vec<PublisherKey>,
}

impl PublisherPolicy {
    /// The production policy. No approved publisher identity is configured in this phase, so it is
    /// always `Unavailable`. No placeholder hash is embedded.
    pub fn production() -> PublisherPolicy {
        PublisherPolicy {
            approved: Vec::new(),
        }
    }

    /// A TEST-ONLY policy over public test key material. Absent from every normal / release build.
    /// It can never verify a production channel, never enable protected eligibility, and never
    /// changes daemon authority (it only lets a fixture reach the `Expected` outcome).
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn test_only(keys: Vec<PublisherKey>) -> PublisherPolicy {
        PublisherPolicy { approved: keys }
    }

    pub fn status(&self) -> PublisherPolicyStatus {
        if self.approved.is_empty() {
            PublisherPolicyStatus::Unavailable
        } else {
            PublisherPolicyStatus::Present
        }
    }

    /// Match a signer public-key hash. `None` signer (no signature / not extracted) with a present
    /// policy is `Unexpected`; any signer with no policy is `Unavailable`.
    pub fn evaluate(&self, signer_spki_sha256: Option<[u8; 32]>) -> PublisherOutcome {
        match self.status() {
            PublisherPolicyStatus::Unavailable | PublisherPolicyStatus::Invalid => {
                PublisherOutcome::Unavailable
            }
            PublisherPolicyStatus::Present => match signer_spki_sha256 {
                Some(hash) if self.approved.iter().any(|k| k.spki_sha256 == hash) => {
                    PublisherOutcome::Expected
                }
                _ => PublisherOutcome::Unexpected,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_policy_is_unavailable_and_never_verifies() {
        let p = PublisherPolicy::production();
        assert_eq!(p.status(), PublisherPolicyStatus::Unavailable);
        // Even a signer hash cannot become Expected with no policy.
        assert_eq!(p.evaluate(Some([7u8; 32])), PublisherOutcome::Unavailable);
        assert_eq!(p.evaluate(None), PublisherOutcome::Unavailable);
    }

    #[test]
    fn unavailable_is_not_unexpected() {
        assert_ne!(PublisherOutcome::Unavailable, PublisherOutcome::Unexpected);
    }

    #[test]
    fn test_policy_matches_only_the_pinned_key() {
        let key = [3u8; 32];
        let p = PublisherPolicy::test_only(vec![PublisherKey { spki_sha256: key }]);
        assert_eq!(p.status(), PublisherPolicyStatus::Present);
        assert_eq!(p.evaluate(Some(key)), PublisherOutcome::Expected);
        assert_eq!(p.evaluate(Some([9u8; 32])), PublisherOutcome::Unexpected);
        // Present policy + no signer = Unexpected (not Unavailable).
        assert_eq!(p.evaluate(None), PublisherOutcome::Unexpected);
    }
}
