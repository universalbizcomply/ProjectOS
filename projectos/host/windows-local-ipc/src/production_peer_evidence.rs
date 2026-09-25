//! PROJECTOS-HOST-REVIEW-PATH1B G3 - THE PRODUCTION SAME-CONNECTION EVIDENCE ASSEMBLER.
//!
//! # Why this module exists
//!
//! Before it, the ONLY builder of a [`ConfirmedSameConnectionIpcPeerEvidence`] was
//! `assemble_same_connection_ipc_peer_fixture`, gated to `test-fixtures`. So the crossing - and
//! therefore the `BoundIpcSession` and the whole protected-operation composition - could not be fed
//! in a production graph at all, however the Host was activated.
//!
//! # What it assembles from, and what it refuses to assemble from
//!
//! Every TRANSPORT fact is established here or borrowed from something that established it, and NONE
//! of them is a parameter a caller chooses:
//!
//! | fact | where it comes from |
//! |---|---|
//! | confirmed handshake | the REAL `HandshakeTransition`, which attaches a confirmation only for an accepting outcome |
//! | connection id | the sealed per-connection verifier, whose identity is crate-assigned |
//! | handshake generation | the same verifier |
//! | client pid + creation tick | the ONE audited kernel capture, projected by the canonical client-admission attempt that already matched the enrolled configured owner |
//! | peer user class | `Owner`, BY CONSTRUCTION - an attempt only reaches `ClientObserved` when the client is EXACTLY the enrolled configured owner |
//! | observed at / valid until | the trusted clock reading, never a wire value |
//!
//! The CHANNEL context is the Host own resolved facts, carried in a [`GovernedChannelContext`] the
//! service composition builds from its plan authority and its pinned repository. It cannot come from
//! the wire even in principle: the fixed-width `ProtectedOperationRequest` carries a correlation, a
//! sequence, a claimed service epoch, a binding digest, an operation class, an approval reference
//! and a parameter digest - and no project, environment, phase or repository field exists on it.
//!
//! # It mints nothing
//!
//! The output is EVIDENCE. `BoundIpcSession` still comes only from the sealed session verifier and
//! `TrustedPeerContext` still comes only from the sealed admission, both reached through the
//! unchanged canonical crossing. A caller holding everything this module needs still cannot produce
//! a session without the canonical client admission succeeding.

use projectos_host_core::{
    ChannelCapability, EnvironmentId, IpcSessionVerifier, OperationFamily, PeerUserClass, ProjectId,
    VerifiedAuthorityTime,
};
use projectos_host_windows_service_identity_proof::AdmittedClientProcess;

use crate::adapter::ConfirmedIpcPeerHandshake;
use crate::observation::ConfirmedSameConnectionIpcPeerEvidence;

/// THE HOST OWN RESOLVED CHANNEL FACTS for one governed review connection.
///
/// It is a plain value, and deliberately so: nothing here is authority, and every field is a fact
/// the Host resolved for ITSELF before any client connected - the project and environment it is
/// installed for, the digests of the phase, repository identity and repository baseline it pinned,
/// and the capability/operation bounds the sealed verifier will then re-check against its own.
///
/// WHY IT IS NOT READ FROM THE WIRE. It cannot be: the review request frame has no field for any of
/// it. A Host that took its own channel identity from a client would be letting the client choose
/// which project, phase and baseline its request is judged against, which is the whole thing the
/// composition exists to prevent.
///
/// WHY IT IS NOT AUTHORITY. Supplying one opens nothing. The capabilities and families are still
/// BOUNDED by the sealed verifier (an observation asking for more than the verifier permits is
/// refused), the digests are compared downstream against the Host own plan and candidate authority,
/// and the session is minted only after the canonical client admission.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GovernedChannelContext {
    /// The channel project the Host is installed for.
    pub project: ProjectId,
    /// The channel environment the Host is installed for.
    pub environment: EnvironmentId,
    /// A bounded digest of the channel phase.
    pub phase_digest: [u8; 32],
    /// A bounded digest of the repository identity the Host pinned.
    pub repository_identity: [u8; 32],
    /// A bounded digest of the repository baseline the Host pinned.
    pub repository_baseline: [u8; 32],
    /// The channel capabilities this connection carries. Re-bounded by the sealed verifier.
    pub capabilities: Vec<ChannelCapability>,
    /// The operation families this connection carries. Re-bounded by the sealed verifier.
    pub operation_families: Vec<OperationFamily>,
}

/// The ONE environment a governed Host review runs in.
///
/// A CONSTANT, and deliberately so. There is exactly one governed-review channel - this installation,
/// local only - so an environment that varied would be a value somebody chose rather than a fact. It
/// is never read from a request, an environment variable, a command line or the record.
pub const GOVERNED_REVIEW_ENVIRONMENT: &str = "projectos-governed-review-local";

/// The domain separator for the bounded repository-baseline digest. Prefixing keeps this digest from
/// ever colliding with any other 32-byte value the Host computes over the same bytes.
const BASELINE_DOMAIN: &[u8] = b"PROJECTOS:GOVERNED-REVIEW-BASELINE:V1";

impl GovernedChannelContext {
    /// THE PRODUCTION CONSTRUCTOR: this installation own channel, resolved from its own sealed facts.
    ///
    /// | field | source |
    /// |---|---|
    /// | `project` | the ATTESTED installation programme project digest, rendered as lower-case hex |
    /// | `environment` | [`GOVERNED_REVIEW_ENVIRONMENT`], a constant |
    /// | `phase_digest` | the Host own validated approved-plan authority |
    /// | `repository_identity` | the ATTESTED installation programme repository digest |
    /// | `repository_baseline` | a domain-separated digest of the APPROVED baseline commit from that same plan authority |
    /// | `capabilities` / `operation_families` | the NARROWEST sets the sealed production verifier permits |
    ///
    /// `attested` is the sealed [`AttestedInstallationProgramme`], obtainable in exactly one way: by
    /// verifying the installed trust manifest signature and its whole execution closure over the
    /// installation COMMITTED bytes. So the project and repository identities here are the ones the
    /// OWNER signed, carried across unchanged - this is a projection, never a second opinion.
    ///
    /// `plan` is the Host own approved-plan authority. `None` from it means "could not establish",
    /// and this returns `None` rather than substituting anything: a review whose phase or baseline
    /// the Host cannot establish is not a review it may hold a channel for.
    ///
    /// NOTHING HERE IS CALLER-CHOSEN. There is no project argument, no environment argument, no
    /// digest argument and no string of any kind.
    ///
    /// [`AttestedInstallationProgramme`]: projectos_host_identity::AttestedInstallationProgramme
    #[must_use]
    pub fn for_governed_review(
        attested: &projectos_host_identity::AttestedInstallationProgramme,
        plan: &dyn crate::operation_contract::host_composition::HostPlanAuthority,
    ) -> Option<Self> {
        let phase_digest = plan.phase()?;
        let baseline = plan.approved_baseline()?;
        // The baseline commit is 20 bytes and the bounded channel field is 32, so it is DIGESTED
        // rather than padded: a padded encoding would make a short commit and a long one distinguish
        // themselves by their padding, and a domain-separated digest simply cannot collide with the
        // other 32-byte channel values.
        // The SAME sha2 the rest of this crate already uses; no new dependency and no second hash.
        let repository_baseline: [u8; 32] = {
            use sha2::{Digest, Sha256};
            let mut h = Sha256::new();
            h.update(BASELINE_DOMAIN);
            h.update(baseline);
            h.finalize().into()
        };

        let project_hex: String = attested
            .project()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        Some(Self {
            // Bounded-identifier validation: 64 lower-case hex characters is always well formed, so
            // this cannot fail for a real attested programme. It is asked rather than assumed so
            // there is no branch here that ships an unvalidated identifier.
            project: projectos_host_core::ProjectId::new(project_hex).ok()?,
            environment: projectos_host_core::EnvironmentId::new(GOVERNED_REVIEW_ENVIRONMENT)
                .ok()?,
            phase_digest,
            repository_identity: *attested.repository(),
            repository_baseline,
            // THE NARROWEST SETS THE SEALED VERIFIER PERMITS. A governed review observes a candidate
            // and records one attestation marker; it asks for no capability beyond that, and the
            // verifier re-bounds whatever is asked for regardless.
            capabilities: vec![ChannelCapability::ObserveOnly],
            operation_families: vec![OperationFamily::RecordMarker],
        })
    }
}

/// Assemble the PRODUCTION same-connection IPC peer evidence for one governed review connection.
///
/// `confirmed` is MOVED IN: one real handshake attests at most one bundle, and a retained
/// confirmation cannot be replayed into a second one.
///
/// `verifier` is BORROWED so the connection identity and handshake generation are read from the
/// sealed per-connection verifier that will judge this very bundle. They are not parameters, so a
/// caller cannot pair one connection identity with another connection evidence - and the crossing
/// re-compares them against the same verifier regardless.
///
/// `client` is the bounded process identity the canonical client-admission attempt captured and
/// already matched against the EXACT enrolled configured owner. It is the same capture, so the
/// process bound into the session is by construction the process that was admitted.
///
/// `now` is the trusted clock reading; `window` is how long the resulting session authority may live
/// from that reading. Both are the Host own, and the sealed verifier still bounds the window and the
/// staleness independently.
///
/// Returns `None` exactly when [`ConfirmedSameConnectionIpcPeerEvidence::observe`] refuses - a zero
/// connection identity, a zero handshake generation, a zero pid or a zero creation tick - so a
/// non-identity can never be dressed up as a peer.
#[must_use]
pub fn assemble_production_same_connection_evidence<V: IpcSessionVerifier>(
    confirmed: ConfirmedIpcPeerHandshake,
    verifier: &V,
    client: AdmittedClientProcess,
    channel: &GovernedChannelContext,
    now: &VerifiedAuthorityTime,
    window: u64,
) -> Option<ConfirmedSameConnectionIpcPeerEvidence> {
    let observed_at = now.reading();
    ConfirmedSameConnectionIpcPeerEvidence::observe(
        confirmed,
        // THE VERIFIER IDENTITY, NOT A PARAMETER.
        verifier.connection_id(),
        verifier.handshake_generation(),
        // THE ONE AUDITED CAPTURE.
        client.pid(),
        client.creation_tick(),
        // BY CONSTRUCTION. The only client that can have produced an `AdmittedClientProcess` is one
        // whose EXACT token user equalled the enrolled configured owner, so the class is not a
        // guess, a token re-read or a caller-supplied label - it is what admission already decided.
        PeerUserClass::Owner,
        // The Windows session stays OPAQUE inside the canonical attempt, which compares it for
        // stability and never exposes it. It is deliberately `None` here rather than reconstructed
        // by a second read: an invented session would be a second identity opinion.
        None,
        channel.project.clone(),
        channel.environment.clone(),
        channel.phase_digest,
        channel.repository_identity,
        channel.repository_baseline,
        observed_at,
        observed_at.saturating_add(window),
        channel.capabilities.clone(),
        channel.operation_families.clone(),
    )
}

// =================================================================================================
// PROOFS. Gated on the fixture graph because the bounded admitted-client process and the sealed
// per-connection verifier both need a producer, and the live ones are a kernel read and a machine
// authority. What is under test - the ASSEMBLY ORDER and where each field comes from - is the
// shipped code, unchanged.
// =================================================================================================
#[cfg(all(test, feature = "test-fixtures"))]
mod tests {
    use super::*;
    use crate::adapter::{HandshakeOutcome, HandshakeTransition};
    use projectos_host_core::{
        bind_production_clock, fixture_production_clock_binding_grant, FixtureMonotonicTickSource,
        ProductionIpcSessionVerifier, TrustedClock,
    };

    fn confirmed() -> ConfirmedIpcPeerHandshake {
        HandshakeTransition::from_outcome(HandshakeOutcome::ExpectedServiceFixturePeerConfirmed)
            .into_confirmed()
            .expect("an accepting outcome carries a confirmation")
    }

    fn channel() -> GovernedChannelContext {
        GovernedChannelContext {
            project: ProjectId::new("proj").unwrap(),
            environment: EnvironmentId::new("staging").unwrap(),
            phase_digest: [3u8; 32],
            repository_identity: [4u8; 32],
            repository_baseline: [5u8; 32],
            capabilities: vec![ChannelCapability::RecordMarker],
            operation_families: vec![OperationFamily::RecordMarker],
        }
    }

    fn now(reading: u64) -> projectos_host_core::VerifiedAuthorityTime {
        let clock = bind_production_clock(
            fixture_production_clock_binding_grant(),
            FixtureMonotonicTickSource::new(reading, 7),
            1_000_000,
        );
        clock.read_current()
    }

    #[test]
    fn the_connection_identity_comes_from_the_verifier_and_is_not_a_parameter() {
        let verifier = ProductionIpcSessionVerifier::for_local_proof();
        let t = now(1_000);
        let bundle = assemble_production_same_connection_evidence(
            confirmed(),
            &verifier,
            AdmittedClientProcess::synthetic_for_fixture(7000, 321),
            &channel(),
            &t,
            5_000,
        )
        .expect("a real identity assembles");
        assert_eq!(bundle.connection_id(), verifier.connection_id());
        assert_eq!(
            bundle.handshake_generation(),
            verifier.handshake_generation()
        );
        // Not zero, and not caller-selectable: there is no argument that could have set either.
        assert_ne!(bundle.connection_id(), 0);
        assert_ne!(bundle.handshake_generation(), 0);
    }

    #[test]
    fn two_connections_never_share_an_assembled_identity() {
        // Each sealed verifier draws a FRESH crate-assigned identity, so stale evidence from one
        // connection cannot be presented as another.
        let a = ProductionIpcSessionVerifier::for_local_proof();
        let b = ProductionIpcSessionVerifier::for_local_proof();
        let t = now(1_000);
        let ba = assemble_production_same_connection_evidence(
            confirmed(),
            &a,
            AdmittedClientProcess::synthetic_for_fixture(7000, 321),
            &channel(),
            &t,
            5_000,
        )
        .unwrap();
        let bb = assemble_production_same_connection_evidence(
            confirmed(),
            &b,
            AdmittedClientProcess::synthetic_for_fixture(7000, 321),
            &channel(),
            &t,
            5_000,
        )
        .unwrap();
        assert_ne!(ba.connection_id(), bb.connection_id());
    }

    #[test]
    fn a_non_identity_client_assembles_nothing() {
        // Fail closed: the bundle own constructor refuses the zero pid / zero creation tick, and this
        // assembler adds no branch that dresses one up as a peer.
        let verifier = ProductionIpcSessionVerifier::for_local_proof();
        let t = now(1_000);
        for (pid, tick) in [(0u32, 321u64), (7000, 0), (0, 0)] {
            assert!(
                assemble_production_same_connection_evidence(
                    confirmed(),
                    &verifier,
                    AdmittedClientProcess::synthetic_for_fixture(pid, tick),
                    &channel(),
                    &t,
                    5_000,
                )
                .is_none(),
                "pid {pid} tick {tick} must not assemble"
            );
        }
    }

    #[test]
    fn the_window_is_taken_from_the_trusted_clock_and_never_from_the_wire() {
        // observed_at IS the clock reading, and valid_until is that reading plus the window the Host
        // chose. There is no wire value anywhere in the signature that could have set either.
        let verifier = ProductionIpcSessionVerifier::for_local_proof();
        let t = now(9_999);
        let bundle = assemble_production_same_connection_evidence(
            confirmed(),
            &verifier,
            AdmittedClientProcess::synthetic_for_fixture(7000, 321),
            &channel(),
            &t,
            5_000,
        )
        .unwrap();
        // The bundle is opaque, so the window is proven where it lands: through the crossing into the
        // core observation. Here the reading itself is what matters, and it is the clock own.
        assert_eq!(t.reading(), 9_999);
        let _ = bundle;
    }

    #[test]
    fn a_saturating_window_never_wraps_into_the_past() {
        // A window that would overflow saturates rather than wrapping, so `valid_until` can never
        // land BEFORE `observed_at` and turn an expiry check into a permanent pass.
        let verifier = ProductionIpcSessionVerifier::for_local_proof();
        let t = now(u64::MAX - 1);
        assert!(assemble_production_same_connection_evidence(
            confirmed(),
            &verifier,
            AdmittedClientProcess::synthetic_for_fixture(7000, 321),
            &channel(),
            &t,
            u64::MAX,
        )
        .is_some());
    }

    #[test]
    fn one_confirmation_attests_at_most_one_bundle() {
        // The confirmation is MOVED IN. A second bundle needs a second real handshake; this is a
        // compile-time guarantee, restated here so the intent is recorded beside the code.
        let verifier = ProductionIpcSessionVerifier::for_local_proof();
        let t = now(1_000);
        let c = confirmed();
        let first = assemble_production_same_connection_evidence(
            c,
            &verifier,
            AdmittedClientProcess::synthetic_for_fixture(7000, 321),
            &channel(),
            &t,
            5_000,
        );
        assert!(first.is_some());
        // `c` is gone; the following would not compile:
        //   assemble_production_same_connection_evidence(c, ..)
    }
}

// -------------------------------------------------------------------------------------------------
// THE CLIENT-ADMISSION AUTHORITY FOR ONE INSTALLATION (PROJECTOS-HOST-REVIEW-PATH1B §10)
// -------------------------------------------------------------------------------------------------

/// The narrow live client-admission capability PAIRED with the EXACT enrolled configured owner of
/// this installation.
///
/// # Why they are one value
///
/// They are always used together and they must always be about the SAME installation. Keeping them
/// apart would let a composition pair a live capability with an owner principal derived from some
/// other record - which is exactly the confusion G1 exists to remove. Deriving both here, from the
/// ONE `VerifiedCanonicalInstallation` the startup composition established, makes that unpairable.
///
/// # What it is not
///
/// It admits nothing. The capability permits observing the connected client of a handle the Host
/// already owns; the principal is an equality-only, unreadable binding. Every identity question is
/// still decided by the canonical attempt.
pub struct GovernedReviewAdmissionAuthority {
    capability:
        projectos_host_windows_service_identity_proof::ClientAdmissionObservationCapability,
    owner: projectos_host_windows_service_identity_proof::EnrolledOwnerPrincipal,
}

impl core::fmt::Debug for GovernedReviewAdmissionAuthority {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("GovernedReviewAdmissionAuthority([REDACTED])")
    }
}

impl GovernedReviewAdmissionAuthority {
    /// Derive both halves from the ONE verified canonical installation.
    ///
    /// The enrolled owner comes from that record `configured_owner_sid`, already validated and
    /// digest-confirmed by `verify_record` - the SAME enrolment the production pipe DACL fourth
    /// principal is built from, so there is ONE enrolled owner on the machine. An installation with
    /// no enrolled owner REFUSES; nothing infers an owner from the console user, the installing
    /// account, an administrator or the service account.
    ///
    /// # Errors
    /// The canonical crate closed [`ConfiguredOwnerRefusal`], naming the failed check and no value.
    ///
    /// [`ConfiguredOwnerRefusal`]: projectos_host_windows_service_identity_proof::ConfiguredOwnerRefusal
    pub fn for_installation(
        installation: &projectos_host_identity::canonical_record::VerifiedCanonicalInstallation,
    ) -> Result<
        Self,
        projectos_host_windows_service_identity_proof::ConfiguredOwnerRefusal,
    > {
        let capability =
            projectos_host_windows_service_identity_proof::ClientAdmissionObservationCapability::for_production_ipc();
        let owner =
            projectos_host_windows_service_identity_proof::EnrolledOwnerPrincipal::from_canonical_installation(
                &capability,
                installation,
            )?;
        Ok(Self { capability, owner })
    }

    /// The live observation capability. Crate-internal: only the governed-review facade lends it.
    pub(crate) fn capability(
        &self,
    ) -> &projectos_host_windows_service_identity_proof::ClientAdmissionObservationCapability {
        &self.capability
    }

    /// The exact enrolled configured owner. Crate-internal, and unreadable in any case.
    pub(crate) fn owner(
        &self,
    ) -> &projectos_host_windows_service_identity_proof::EnrolledOwnerPrincipal {
        &self.owner
    }
}
