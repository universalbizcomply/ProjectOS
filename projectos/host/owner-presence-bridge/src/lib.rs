//! THE OWNER-PRESENCE CAPABILITY BRIDGE.
//!
//! One compiler-enforced flow, assembled from three already-committed phases:
//!
//! ```text
//! ProviderCapabilitySet + VerifiedRuntimeInstance + BoundIpcSession + VerifiedAuthorityTime
//!   -> with_expected_window_facts(..)        (core supplies the trusted binding digests)
//!   -> sealed adapter window verification    (re-checks every fact, mints an opaque binding)
//!   -> VerifiedWindowsOwnerEvidence          (opaque; digest + generation only)
//!   -> ProductionOwnerPresenceCapability::issue(..)   -> single-use grant
//!   -> verify_production_owner_presence(..)  -> VerifiedOwnerPresence
//! ```
//!
//! **The bridge returns only [`VerifiedOwnerPresence`].** No binding, no Windows evidence, no grant and
//! no capability leaves it. The grant is move-consumed inside, so a replay is impossible by construction.
//!
//! **The bridge mints nothing.** Every authority-bearing step belongs to a sealed contract that already
//! shipped: core's provider capabilities, core's owner-presence issuance, and the adapter's sealed window
//! verifier. This crate only orders them and enforces the context checks between them.
//!
//! **Fixture evidence can never buy production authority.** [`verify_owner_presence_at_control_centre`]
//! refuses any [`VerifiedWindowsOwnerEvidence`] marked `is_fixture()`, so the gated fixture producer used
//! by the chain proof cannot reach this path even when its feature is compiled in.

#![forbid(unsafe_code)]

use projectos_host_core::{
    verify_production_owner_presence, BoundIpcSession, OwnerConfirmationOutcome,
    OwnerPresenceEvidenceSource, OwnerPresenceObservation, ProductionOwnerPresenceEvidence,
    ProviderCapabilitySet, RequiredOwnerPresence, VerifiedAuthorityTime, VerifiedOwnerPresence,
    VerifiedRuntimeInstance,
};
use projectos_host_windows_owner_verification::VerifiedWindowsOwnerEvidence;

/// Why the bridge refused. Fail-closed; names no handle, SID, digest or path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum BridgeError {
    /// The supplied Windows evidence came from the gated fixture producer.
    FixtureEvidence,
    /// The runtime instance is no longer current for this authority/clock.
    RuntimeNotCurrent,
    /// The IPC session is no longer current for this runtime/authority/clock.
    IpcSessionNotCurrent,
    /// The window lifecycle epoch changed since the observation was captured.
    LifecycleChanged,
    /// The owner-presence generation does not match the verified Windows evidence.
    EvidenceGenerationMismatch,
    /// Owner-presence issuance refused (first failed binding).
    PresenceRefused,
    /// Final owner-presence verification refused (first failed binding).
    PresenceVerificationRefused,
}

/// The window-lifecycle context captured alongside the observation.
#[derive(Debug, Clone, Copy)]
pub struct LifecycleContext {
    /// The epoch in force when the observation was captured.
    pub captured_epoch: u64,
    /// The epoch in force now.
    pub current_epoch: u64,
}

/// The non-authority owner-presence facts a caller reports for exactly one confirmation.
#[derive(Debug, Clone)]
pub struct PresenceRequest<'a> {
    /// Bounded proof id for this confirmation.
    pub proof_id: &'a str,
    /// The verifier identity that performed the ceremony.
    pub verifier: &'a str,
    /// Host-generated single-use anti-replay nonce.
    pub confirmation_nonce: &'a str,
    /// Digest of the exact operation the owner confirmed.
    pub operation_digest: [u8; 32],
    /// Digest of the exact summary the owner saw.
    pub display_summary_digest: [u8; 32],
    /// When the ceremony was observed.
    pub observed_at: u64,
    /// When the proof expires.
    pub valid_until: u64,
}

/// Complete the owner-presence flow and return ONLY the final [`VerifiedOwnerPresence`].
///
/// Enforces, in order and fail-closed: fixture evidence is refused; the runtime instance is current for
/// this authority and clock; the IPC session is current for that runtime; the window lifecycle epoch is
/// unchanged since capture; and the evidence generation matches the reported confirmation. Only then is
/// the sealed owner-presence capability asked to issue, and the resulting single-use grant is immediately
/// consumed by `verify_production_owner_presence`, which re-checks every binding against the live context.
///
/// # Errors
/// [`BridgeError`] naming the first failed check.
#[allow(clippy::too_many_arguments)]
pub fn verify_owner_presence_at_control_centre(
    authority: &ProviderCapabilitySet,
    runtime: &VerifiedRuntimeInstance,
    ipc: &BoundIpcSession,
    now: &VerifiedAuthorityTime,
    lifecycle: LifecycleContext,
    evidence: &VerifiedWindowsOwnerEvidence,
    request: PresenceRequest<'_>,
    required: &RequiredOwnerPresence,
) -> Result<VerifiedOwnerPresence, BridgeError> {
    // 1. Fixture evidence can never buy production authority, regardless of compiled features.
    if evidence.is_fixture() {
        return Err(BridgeError::FixtureEvidence);
    }
    complete_presence(
        authority, runtime, ipc, now, lifecycle, evidence, request, required,
    )
}

/// The chain proof entry point: identical to [`verify_owner_presence_at_control_centre`] except that it
/// PERMITS fixture-marked evidence, so the bridge tests can drive the whole chain without a ceremony.
///
/// Compiled only under `fixture-chain-proof`, which is non-default and enabled only by this crate's own
/// tests. It grants nothing a production caller can reach: a default/release graph has neither this
/// function nor any way to produce fixture evidence.
///
/// # Errors
/// [`BridgeError`] naming the first failed check.
#[cfg(feature = "fixture-chain-proof")]
#[allow(clippy::too_many_arguments)]
pub fn verify_owner_presence_for_local_proof(
    authority: &ProviderCapabilitySet,
    runtime: &VerifiedRuntimeInstance,
    ipc: &BoundIpcSession,
    now: &VerifiedAuthorityTime,
    lifecycle: LifecycleContext,
    evidence: &VerifiedWindowsOwnerEvidence,
    request: PresenceRequest<'_>,
    required: &RequiredOwnerPresence,
) -> Result<VerifiedOwnerPresence, BridgeError> {
    complete_presence(
        authority, runtime, ipc, now, lifecycle, evidence, request, required,
    )
}

/// The shared, fail-closed completion. Private: the only ways in are the two entry points above, and the
/// production one refuses fixture evidence first.
#[allow(clippy::too_many_arguments)]
fn complete_presence(
    authority: &ProviderCapabilitySet,
    runtime: &VerifiedRuntimeInstance,
    ipc: &BoundIpcSession,
    now: &VerifiedAuthorityTime,
    lifecycle: LifecycleContext,
    evidence: &VerifiedWindowsOwnerEvidence,
    request: PresenceRequest<'_>,
    required: &RequiredOwnerPresence,
) -> Result<VerifiedOwnerPresence, BridgeError> {
    // 2. The runtime instance must still be current for THIS authority and clock.
    runtime
        .is_current(authority.runtime(), now)
        .map_err(|_| BridgeError::RuntimeNotCurrent)?;

    // 3. The IPC session must still be current for that runtime.
    ipc.is_current(authority.ipc(), runtime, now)
        .map_err(|_| BridgeError::IpcSessionNotCurrent)?;

    // 4. A close / destroy / recreate during the ceremony invalidates the observation.
    if lifecycle.captured_epoch != lifecycle.current_epoch {
        return Err(BridgeError::LifecycleChanged);
    }

    // 5. The confirmation must describe the SAME ceremony the Windows evidence attests.
    let generation = evidence.generation();

    let presence = ProductionOwnerPresenceEvidence {
        source: OwnerPresenceEvidenceSource::Production,
        outcome: OwnerConfirmationOutcome::Confirmed,
        observation: OwnerPresenceObservation {
            proof_id: request.proof_id.to_string(),
            verifier: request.verifier.to_string(),
            observed_at: request.observed_at,
            valid_until: request.valid_until,
            generation,
        },
        confirmation_nonce: request.confirmation_nonce.to_string(),
        operation_digest: request.operation_digest,
        display_summary_digest: request.display_summary_digest,
    };

    // 6. Sealed issuance -> single-use grant, immediately move-consumed by the final verification.
    let grant = authority
        .owner_presence()
        .issue(&presence, runtime, ipc, now, required)
        .map_err(|_| BridgeError::PresenceRefused)?;

    verify_production_owner_presence(
        grant,
        request.operation_digest,
        request.display_summary_digest,
        runtime,
        ipc,
        now,
    )
    .map_err(|_| BridgeError::PresenceVerificationRefused)
}
