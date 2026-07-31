//! The full fixture-only chain proof, end to end.
//!
//! Runs only under `fixture-chain-proof`. Calls no Windows API and never executes UserConsentVerifier:
//! the adapter's gated producer synthesises the OS-observed facts in-crate and runs the SAME fail-closed
//! decision the live path uses.
#![cfg(feature = "fixture-chain-proof")]

use projectos_host_authority::model::{AuthorityPeerState, ConfirmedAuthorityGuard};
use projectos_host_core::{
    open_provider_authority, with_expected_window_facts, BoundIpcSession, ChannelCapability,
    ConfirmedHandshakeEvidence, ExpectedWindowFactsSink, ExpectedWindowMetadata, FixtureClock,
    HostRole, IpcPeerObservation, IpcSessionVerifier, OperationFamily, PeerUserClass,
    ProviderCapabilitySet, RequiredOwnerPresence, RuntimeInstanceObservation,
    RuntimeInstanceVerifier, RuntimeSource, SessionId, TrustedClock, VerifiedAuthorityTime,
    VerifiedRuntimeInstance,
};
use projectos_host_owner_presence_bridge::{
    verify_owner_presence_at_control_centre, verify_owner_presence_for_local_proof, BridgeError,
    LifecycleContext, PresenceRequest,
};
use projectos_host_windows_owner_verification as owner;
use projectos_trust_contract::ids::{EnvironmentId, ProjectId};

const LABEL: &str = "main";
const PID: u32 = 4242;
const SESSION: u32 = 1;
const EPOCH: u64 = 7;
const GENERATION: u64 = 9;
const OP_DIGEST: [u8; 32] = [0x11; 32];
const SUMMARY_DIGEST: [u8; 32] = [0x22; 32];

/// Builds the untrusted observation AND the expectation from the SAME trusted binding digests, then runs
/// the adapter's gated fixture verification. Modelling the future composition, where both sides are fed
/// by core rather than by a caller.
struct VerifyWithAdapter {
    now: u64,
    valid_until: u64,
}

impl ExpectedWindowFactsSink for VerifyWithAdapter {
    type Out = Result<owner::VerifiedWindowsOwnerEvidence, owner::OwnerVerificationError>;

    fn build(
        self,
        expected_label: &str,
        expected_process_id: u32,
        expected_session: u32,
        expected_runtime_instance_digest: [u8; 32],
        expected_ipc_session_digest: [u8; 32],
        current_lifecycle_epoch: u64,
        valid_until: u64,
    ) -> Self::Out {
        let observation = owner::UntrustedControlCentreWindowObservation::new(
            owner::OwnerWindowObservationInput {
                label: expected_label.to_string(),
                handle: owner::UntrustedOwnerWindowHandle::from_raw(0x1234),
                is_window: true,
                is_visible: true,
                is_minimized: false,
                is_focused: true,
                eligible: true,
                process_id: expected_process_id,
                thread_id: 11,
                session: expected_session,
                client_protocol_type: 0,
                active_console_session: expected_session,
                runtime_instance_digest: expected_runtime_instance_digest,
                ipc_session_digest: expected_ipc_session_digest,
                project_digest: [1u8; 32],
                repository_digest: [2u8; 32],
                environment_digest: [3u8; 32],
                phase_digest: [4u8; 32],
                lifecycle_epoch: current_lifecycle_epoch,
                capture_generation: GENERATION,
                observed_at: self.now,
            },
        );
        let expected = owner::ExpectedWindowFacts {
            expected_label,
            expected_process_id,
            expected_session,
            expected_runtime_instance_digest,
            expected_ipc_session_digest,
            current_lifecycle_epoch,
            valid_until,
        };
        owner::fixture_owner_evidence(
            &observation,
            &expected,
            expected_process_id,
            b"proof-1",
            b"windows-owner-verifier",
            OP_DIGEST,
            SUMMARY_DIGEST,
            expected_runtime_instance_digest,
            expected_ipc_session_digest,
            b"fixture-clock",
            1,
            self.now,
            self.valid_until,
            GENERATION,
            [7u8; 32],
            self.now,
        )
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

fn runtime(c: &FixtureClock, set: &ProviderCapabilitySet) -> VerifiedRuntimeInstance {
    set.runtime()
        .verify(
            &RuntimeInstanceObservation {
                role: HostRole::InteractiveFallback,
                source: RuntimeSource::InteractiveFallback,
                pid: PID,
                creation_tick: 77,
                session: Some(SessionId::new("host-sess")),
                observed_at: 0,
                valid_until: 9_000,
                service_evidence: None,
            },
            &now(c),
        )
        .expect("production runtime attests")
}

fn ipc(
    c: &FixtureClock,
    set: &ProviderCapabilitySet,
    rt: &VerifiedRuntimeInstance,
) -> BoundIpcSession {
    let v = set.ipc();
    let obs = IpcPeerObservation {
        connection_id: v.connection_id(),
        handshake_generation: v.handshake_generation(),
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
    v.verify(
        rt,
        ConfirmedHandshakeEvidence::confirmed(v.handshake_generation()),
        &obs,
        &now(c),
    )
    .expect("production ipc binds")
}

fn evidence(
    c: &FixtureClock,
    set: &ProviderCapabilitySet,
    rt: &VerifiedRuntimeInstance,
    ip: &BoundIpcSession,
    epoch: u64,
) -> owner::VerifiedWindowsOwnerEvidence {
    with_expected_window_facts(
        set,
        rt,
        ip,
        ExpectedWindowMetadata {
            expected_label: LABEL,
            expected_process_id: PID,
            expected_session: SESSION,
            current_lifecycle_epoch: epoch,
            valid_until: 21_000,
        },
        VerifyWithAdapter {
            now: now(c).reading(),
            valid_until: 21_000,
        },
    )
    .expect("fixture adapter verification succeeds")
}

fn request<'a>(c: &FixtureClock) -> PresenceRequest<'a> {
    PresenceRequest {
        proof_id: "proof-1",
        verifier: "windows-owner-verifier",
        confirmation_nonce: "nonce-1",
        operation_digest: OP_DIGEST,
        display_summary_digest: SUMMARY_DIGEST,
        observed_at: c.read_current().reading(),
        valid_until: 21_000,
    }
}

fn required() -> RequiredOwnerPresence {
    RequiredOwnerPresence {
        required_verifier: "windows-owner-verifier".to_string(),
        min_generation: 0,
    }
}

fn lifecycle(captured: u64, current: u64) -> LifecycleContext {
    LifecycleContext {
        captured_epoch: captured,
        current_epoch: current,
    }
}

#[test]
fn the_full_chain_reaches_verified_owner_presence() {
    let c = FixtureClock::new(1_000);
    let set = capability_set(&c);
    let rt = runtime(&c, &set);
    let ip = ipc(&c, &set, &rt);
    let ev = evidence(&c, &set, &rt, &ip, EPOCH);

    // The evidence really did come from the gated fixture producer.
    assert!(ev.is_fixture());

    let presence = verify_owner_presence_for_local_proof(
        &set,
        &rt,
        &ip,
        &now(&c),
        lifecycle(EPOCH, EPOCH),
        &ev,
        request(&c),
        &required(),
    )
    .expect("the chain reaches VerifiedOwnerPresence");

    // The result is opaque: no generation/proof getter is public, and Debug is redacted.
    assert!(format!("{presence:?}").contains("[REDACTED]"));
}

#[test]
fn the_production_entry_point_refuses_fixture_evidence() {
    let c = FixtureClock::new(1_000);
    let set = capability_set(&c);
    let rt = runtime(&c, &set);
    let ip = ipc(&c, &set, &rt);
    let ev = evidence(&c, &set, &rt, &ip, EPOCH);

    assert_eq!(
        verify_owner_presence_at_control_centre(
            &set,
            &rt,
            &ip,
            &now(&c),
            lifecycle(EPOCH, EPOCH),
            &ev,
            request(&c),
            &required(),
        )
        .unwrap_err(),
        BridgeError::FixtureEvidence,
        "fixture evidence must never buy production authority"
    );
}

#[test]
fn a_lifecycle_epoch_change_refuses_the_chain() {
    let c = FixtureClock::new(1_000);
    let set = capability_set(&c);
    let rt = runtime(&c, &set);
    let ip = ipc(&c, &set, &rt);
    let ev = evidence(&c, &set, &rt, &ip, EPOCH);

    assert_eq!(
        verify_owner_presence_for_local_proof(
            &set,
            &rt,
            &ip,
            &now(&c),
            lifecycle(EPOCH, EPOCH + 1),
            &ev,
            request(&c),
            &required(),
        )
        .unwrap_err(),
        BridgeError::LifecycleChanged
    );
}

#[test]
fn a_restarted_runtime_refuses_the_chain() {
    let c = FixtureClock::new(1_000);
    let set = capability_set(&c);
    let rt = runtime(&c, &set);
    let ip = ipc(&c, &set, &rt);
    let ev = evidence(&c, &set, &rt, &ip, EPOCH);

    // A DIFFERENT capability set models a host restart: its verifier carries a new generation, so the
    // runtime attested by the old set is no longer current.
    let other = capability_set(&c);
    assert_eq!(
        verify_owner_presence_for_local_proof(
            &other,
            &rt,
            &ip,
            &now(&c),
            lifecycle(EPOCH, EPOCH),
            &ev,
            request(&c),
            &required(),
        )
        .unwrap_err(),
        BridgeError::RuntimeNotCurrent
    );
}

#[test]
fn an_expired_proof_window_refuses_the_chain() {
    let c = FixtureClock::new(1_000);
    let set = capability_set(&c);
    let rt = runtime(&c, &set);
    let ip = ipc(&c, &set, &rt);
    let ev = evidence(&c, &set, &rt, &ip, EPOCH);

    let mut req = request(&c);
    req.valid_until = 1_000; // already elapsed
    assert_eq!(
        verify_owner_presence_for_local_proof(
            &set,
            &rt,
            &ip,
            &now(&c),
            lifecycle(EPOCH, EPOCH),
            &ev,
            req,
            &required(),
        )
        .unwrap_err(),
        BridgeError::PresenceRefused
    );
}

#[test]
fn a_wrong_verifier_identity_refuses_the_chain() {
    let c = FixtureClock::new(1_000);
    let set = capability_set(&c);
    let rt = runtime(&c, &set);
    let ip = ipc(&c, &set, &rt);
    let ev = evidence(&c, &set, &rt, &ip, EPOCH);

    let mut req = required();
    req.required_verifier = "someone-else".to_string();
    assert_eq!(
        verify_owner_presence_for_local_proof(
            &set,
            &rt,
            &ip,
            &now(&c),
            lifecycle(EPOCH, EPOCH),
            &ev,
            request(&c),
            &req,
        )
        .unwrap_err(),
        BridgeError::PresenceRefused
    );
}
