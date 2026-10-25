//! PROJECTOS-HOST-REVIEW-PATH1B — THE PRODUCTION `SignedExecutionClosureFacts` AND
//! `AdmittedCostSource`: the model policy, the credential reference and the admitted cost of a review,
//! each read from the OWNER-SIGNED execution closure and from nowhere else.
//!
//! ## Why these three come from the closure
//!
//! The fixed authority frames carry no cost and the Host holds no rate card, and the owner programme
//! delegation is the record being CROSS-CHECKED - so it cannot also be the Host's independent source for
//! what it is checked against. The installed trust manifest is the one thing the owner signs that the
//! Host can verify for itself, so that is where the owner states all three.
//!
//! ## It verifies; it never accepts
//!
//! [`SignedClosureFacts::establish`] runs the SAME verification the review operation runs - the owner's
//! signature over the whole manifest under PRODUCTION policy against the embedded anchor, then every
//! closure artefact against its committed bytes - and only a value that passed all of it can answer.
//! The committed reads are aimed at the packaging contract's fixed paths, never at a path the manifest
//! names, so unsigned bytes cannot choose which file the Host opens.
//!
//! ## There is no default
//!
//! Anything that cannot be established - no manifest, a version 1 manifest, an unsigned or test-signed
//! one, a closure artefact that does not match, a missing or unusable policy fact - makes ALL THREE
//! answers `None`, and the composition refuses before anything is reserved or consumed. A cost is never
//! assumed, and an accounted figure is never described as actual or provider-billed cost.

use projectos_host_gatekeeper_attestation::operation::{CommittedBytesPort, TrustManifestPort};
use projectos_host_identity::{
    verify_execution_closure, CommittedClosureBytes, Policy, ProductionEs256Verifier, TrustManifest,
    VerifiedExecutionClosure,
};
use projectos_host_windows_local_ipc::{AdmittedCostSource, SignedExecutionClosureFacts};
use projectos_packaged_runtime_contract as contract;

/// The width every digest on the authority wire has.
const DIGEST_LEN: usize = 32;

/// The signed policy facts of the installed execution closure, or nothing.
pub struct SignedClosureFacts {
    verified: Option<VerifiedExecutionClosure>,
}

impl SignedClosureFacts {
    /// Establish the facts from the installed manifest and the committed closure artefacts.
    ///
    /// NEVER FAILS LOUDLY AND NEVER DEFAULTS: whatever goes wrong, the result answers `None` to every
    /// question, which the composition turns into a refusal that names the closure.
    #[must_use]
    pub fn establish(manifest: &dyn TrustManifestPort, committed: &dyn CommittedBytesPort) -> Self {
        Self {
            verified: Self::verify(manifest, committed),
        }
    }

    fn verify(
        manifest: &dyn TrustManifestPort,
        committed: &dyn CommittedBytesPort,
    ) -> Option<VerifiedExecutionClosure> {
        let raw = manifest.manifest_bytes()?;
        let parsed = TrustManifest::parse(&raw).ok()?;
        // THE PATHS ARE THE CONTRACT'S, NEVER THE MANIFEST'S - the same rule, for the same reason, as
        // the review operation's own reads.
        let broker = committed.committed_bytes(contract::BROKER_REPOSITORY_RELATIVE_PATH)?;
        let allowlist =
            committed.committed_bytes(contract::INSTALLATION_ALLOWLIST_REPOSITORY_RELATIVE_PATH)?;
        let adapter =
            committed.committed_bytes(contract::CREDENTIAL_ADAPTER_REPOSITORY_RELATIVE_PATH)?;
        verify_execution_closure(
            &parsed,
            Policy::Production,
            &ProductionEs256Verifier::from_embedded(),
            &CommittedClosureBytes {
                gatekeeper_broker: Some(&broker),
                installation_project_allowlist: Some(&allowlist),
                credential_adapter: Some(&adapter),
            },
        )
        .ok()
    }

    /// Whether the owner-signed closure was established at all. Reported so a composition site can say
    /// WHICH fact was missing rather than only that something was.
    #[must_use]
    pub fn is_established(&self) -> bool {
        self.verified.is_some()
    }
}

impl SignedExecutionClosureFacts for SignedClosureFacts {
    fn model_policy(&self) -> Option<[u8; DIGEST_LEN]> {
        self.verified
            .as_ref()
            .map(VerifiedExecutionClosure::model_policy_digest)
    }

    fn credential_ref(&self) -> Option<[u8; DIGEST_LEN]> {
        self.verified
            .as_ref()
            .map(VerifiedExecutionClosure::credential_ref_digest)
    }
}

impl AdmittedCostSource for SignedClosureFacts {
    /// The cost the owner signed that one review may be ADMITTED to cost. A reservation figure taken
    /// before dispatch; whatever a provider later bills is settled separately, and an entry carrying
    /// recorded usage is never released on the strength of this number.
    fn admitted_cost_micro_usd(&self) -> Option<u64> {
        self.verified
            .as_ref()
            .map(VerifiedExecutionClosure::admitted_review_cost_micro_usd)
    }
}
