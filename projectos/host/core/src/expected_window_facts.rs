//! THE LEASE-GATED EXPECTED-WINDOW-FACTS SINK (G4 option B1).
//!
//! The Windows owner-verification adapter owns `ExpectedWindowFacts`, needs the trusted runtime-instance
//! and IPC-session binding digests to populate it, and deliberately depends on NOTHING but `sha2` — so it
//! cannot name a core type, and core cannot name its type either. Two crates that must not know each
//! other, and a value that must cross between them.
//!
//! The mechanism: core never RETURNS a digest, it CALLS you with one. A caller implements
//! [`ExpectedWindowFactsSink`] and hands it to [`with_expected_window_facts`], which requires a borrowed
//! [`ProviderCapabilitySet`] — the retained cold-start authority. Core reads the two digests from the
//! trusted values through its OWN crate-private accessors and passes them as ARGUMENTS to the sink, which
//! assembles whatever the caller needs. `instance_digest()` and `session_digest()` stay `pub(crate)`; no
//! public getter is added anywhere, and no type here stores a digest.
//!
//! What this does NOT do: the sink receives digests, and digests are EVIDENCE, never authority. Nothing
//! here mints, verifies or grants anything. The `ExpectedWindowFacts` a caller builds remains UNTRUSTED
//! input to the adapter's sealed `ControlCentreWindowVerifier`, which re-checks every fact before it will
//! mint a binding. A caller that assembles a wrong expectation simply fails that verification.
//!
//! Renderer exposure is impossible by construction: this is host-side Rust with no Tauri command, no
//! serialisation and no IPC surface, and the digests never reach a returned value.

use crate::ipc_session::BoundIpcSession;
use crate::provider_authority::ProviderCapabilitySet;
use crate::runtime_instance::VerifiedRuntimeInstance;

/// The NON-authority window metadata a caller supplies. Deliberately carries **no digest field**: the
/// runtime-instance and IPC-session digests are supplied by core from the trusted values, so a caller
/// cannot substitute an observation-provided digest for a trusted one.
#[derive(Debug, Clone)]
pub struct ExpectedWindowMetadata<'a> {
    /// The designated window label the caller expects.
    pub expected_label: &'a str,
    /// The process the caller expects to own the window.
    pub expected_process_id: u32,
    /// The session the caller expects the window to live in.
    pub expected_session: u32,
    /// The caller's current window-lifecycle epoch.
    pub current_lifecycle_epoch: u64,
    /// The expectation's expiry bound.
    pub valid_until: u64,
}

/// Receives the trusted binding values for exactly one expectation and assembles the caller's own type.
///
/// The digests arrive as ARGUMENTS and are never handed over in a container, so nothing in this contract
/// stores or re-exposes them. Implementing this trait grants NOTHING: the only way to be called is
/// [`with_expected_window_facts`], which requires a borrowed [`ProviderCapabilitySet`] that a caller
/// cannot fabricate.
pub trait ExpectedWindowFactsSink {
    /// Whatever the caller assembles — typically the adapter's `ExpectedWindowFacts`.
    type Out;

    /// Build the caller's expectation from the supplied values.
    ///
    /// The two digest parameters are read by core from the trusted `VerifiedRuntimeInstance` and
    /// `BoundIpcSession`; the remaining parameters are the caller's own non-authority metadata.
    #[allow(clippy::too_many_arguments)]
    fn build(
        self,
        expected_label: &str,
        expected_process_id: u32,
        expected_session: u32,
        expected_runtime_instance_digest: [u8; 32],
        expected_ipc_session_digest: [u8; 32],
        current_lifecycle_epoch: u64,
        valid_until: u64,
    ) -> Self::Out;
}

/// Supply the trusted runtime-instance and IPC-session binding digests to `sink`, and return only what
/// the sink assembles.
///
/// Requires a borrowed [`ProviderCapabilitySet`] — the set that RETAINS the confirmed machine-wide
/// authority — so only a host holding cold-start provider authority can drive this path. The set is
/// borrowed, never consumed: obtaining expectations is not an authority-spending operation.
///
/// The digests are read here through core's crate-private accessors and passed straight into the sink.
/// They are never returned, never stored, and never placed in a shared authority object.
#[must_use]
pub fn with_expected_window_facts<S: ExpectedWindowFactsSink>(
    _authority: &ProviderCapabilitySet,
    runtime: &VerifiedRuntimeInstance,
    ipc: &BoundIpcSession,
    window: ExpectedWindowMetadata<'_>,
    sink: S,
) -> S::Out {
    sink.build(
        window.expected_label,
        window.expected_process_id,
        window.expected_session,
        runtime.instance_digest(),
        ipc.session_digest(),
        window.current_lifecycle_epoch,
        window.valid_until,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authority_time::{FixtureClock, TrustedClock, VerifiedAuthorityTime};
    use crate::facts::SessionId;
    use crate::ipc_session::{
        ChannelCapability, ConfirmedHandshakeEvidence, FixtureIpcSessionVerifier,
        IpcPeerObservation, IpcSessionVerifier, OperationFamily, PeerUserClass,
    };
    use crate::provider_authority::open_provider_authority;
    use crate::runtime_instance::{
        FixtureRuntimeInstanceVerifier, HostRole, RuntimeInstanceObservation,
        RuntimeInstanceVerifier, RuntimeSource,
    };
    use projectos_host_authority::model::{AuthorityPeerState, ConfirmedAuthorityGuard};
    use projectos_trust_contract::ids::{EnvironmentId, ProjectId};

    /// A stand-in for the adapter's `ExpectedWindowFacts` — core cannot name the real one, which is
    /// exactly why the sink exists.
    #[derive(Debug)]
    struct Facts {
        label: String,
        process_id: u32,
        session: u32,
        runtime_digest: [u8; 32],
        ipc_digest: [u8; 32],
        lifecycle_epoch: u64,
        valid_until: u64,
    }

    struct FactsSink;

    impl ExpectedWindowFactsSink for FactsSink {
        type Out = Facts;
        fn build(
            self,
            expected_label: &str,
            expected_process_id: u32,
            expected_session: u32,
            expected_runtime_instance_digest: [u8; 32],
            expected_ipc_session_digest: [u8; 32],
            current_lifecycle_epoch: u64,
            valid_until: u64,
        ) -> Facts {
            Facts {
                label: expected_label.to_string(),
                process_id: expected_process_id,
                session: expected_session,
                runtime_digest: expected_runtime_instance_digest,
                ipc_digest: expected_ipc_session_digest,
                lifecycle_epoch: current_lifecycle_epoch,
                valid_until,
            }
        }
    }

    fn now(c: &FixtureClock) -> VerifiedAuthorityTime {
        c.read_current()
    }

    fn capability_set(c: &FixtureClock) -> ProviderCapabilitySet {
        let guard =
            ConfirmedAuthorityGuard::for_local_proof(AuthorityPeerState::ServiceRuntimeConfirmed)
                .expect("authoritative state confirms");
        open_provider_authority(guard, &now(c), 60)
            .expect("lease opens")
            .into_provider_capabilities(&now(c))
            .expect("capabilities issue")
    }

    fn runtime(c: &FixtureClock, rv: &FixtureRuntimeInstanceVerifier) -> VerifiedRuntimeInstance {
        rv.verify(
            &RuntimeInstanceObservation {
                role: HostRole::InteractiveFallback,
                source: RuntimeSource::InteractiveFallback,
                pid: 4242,
                creation_tick: 77,
                session: Some(SessionId::new("host-sess")),
                observed_at: 0,
                valid_until: 9_000,
                service_evidence: None,
            },
            &now(c),
        )
        .expect("runtime attests")
    }

    fn ipc(
        c: &FixtureClock,
        iv: &FixtureIpcSessionVerifier,
        rt: &VerifiedRuntimeInstance,
    ) -> BoundIpcSession {
        let obs = IpcPeerObservation {
            connection_id: iv.connection_id(),
            handshake_generation: iv.handshake_generation(),
            client_pid: 5150,
            client_creation_tick: 88,
            user: PeerUserClass::Owner,
            session: Some(SessionId::new("peer-sess")),
            project: ProjectId::new("proj").unwrap(),
            environment: EnvironmentId::new("staging").unwrap(),
            phase_digest: [3u8; 32],
            repository_identity: [4u8; 32],
            repository_baseline: [5u8; 32],
            observed_at: 0,
            valid_until: 8_000,
            capabilities: vec![ChannelCapability::RecordMarker],
            operation_families: vec![OperationFamily::RecordMarker],
        };
        iv.verify(
            rt,
            ConfirmedHandshakeEvidence::confirmed(iv.handshake_generation()),
            &obs,
            &now(c),
        )
        .expect("ipc binds")
    }

    fn metadata<'a>() -> ExpectedWindowMetadata<'a> {
        ExpectedWindowMetadata {
            expected_label: "main",
            expected_process_id: 4242,
            expected_session: 1,
            current_lifecycle_epoch: 7,
            valid_until: 21_000,
        }
    }

    #[test]
    fn the_sink_receives_the_trusted_binding_digests_and_the_callers_metadata() {
        let c = FixtureClock::new(1_000);
        let set = capability_set(&c);
        let rv = FixtureRuntimeInstanceVerifier::new();
        let iv = FixtureIpcSessionVerifier::new();
        let rt = runtime(&c, &rv);
        let session = ipc(&c, &iv, &rt);

        let facts = with_expected_window_facts(&set, &rt, &session, metadata(), FactsSink);
        assert_eq!(facts.label, "main");
        assert_eq!(facts.process_id, 4242);
        assert_eq!(facts.session, 1);
        assert_eq!(facts.lifecycle_epoch, 7);
        assert_eq!(facts.valid_until, 21_000);
        // The digests are the TRUSTED values: non-zero, distinct, and not caller-supplied.
        assert_ne!(facts.runtime_digest, [0u8; 32]);
        assert_ne!(facts.ipc_digest, [0u8; 32]);
        assert_ne!(facts.runtime_digest, facts.ipc_digest);
    }

    #[test]
    fn a_different_runtime_instance_yields_a_different_expected_digest() {
        let c = FixtureClock::new(1_000);
        let set = capability_set(&c);
        let iv = FixtureIpcSessionVerifier::new();

        let rv_a = FixtureRuntimeInstanceVerifier::new();
        let rt_a = runtime(&c, &rv_a);
        let s_a = ipc(&c, &iv, &rt_a);
        let a = with_expected_window_facts(&set, &rt_a, &s_a, metadata(), FactsSink);

        // A modelled restart: a NEW verifier yields a new per-start generation.
        let rv_b = FixtureRuntimeInstanceVerifier::new();
        let rt_b = runtime(&c, &rv_b);
        let s_b = ipc(&c, &iv, &rt_b);
        let b = with_expected_window_facts(&set, &rt_b, &s_b, metadata(), FactsSink);

        assert_ne!(
            a.runtime_digest, b.runtime_digest,
            "a restarted runtime must not reuse the previous expected digest"
        );
    }

    #[test]
    fn metadata_carries_no_digest_a_caller_could_substitute() {
        // Exhaustive destructuring: adding a digest field to the metadata would fail to compile here.
        let ExpectedWindowMetadata {
            expected_label: _,
            expected_process_id: _,
            expected_session: _,
            current_lifecycle_epoch: _,
            valid_until: _,
        } = metadata();
    }
}
