//! # ProjectOS host Windows owner-verification adapter (INERT)
//!
//! CD-B4-WINDOWS-USER-VERIFICATION-ADAPTER1A. This crate owns, but does NOT run, the Windows owner
//! (user-presence) verification path:
//!
//! - the opaque input contract [`TrustedControlCentreWindowBinding`];
//! - the opaque output [`VerifiedWindowsOwnerEvidence`];
//! - the typed `UserConsentVerifier` availability/result mappings, where only the success value is
//!   eligible and every other value — including any future/unknown one — fails closed;
//! - the window / window-process / session / owner-SID policy (local console only);
//! - the MTA-worker completion contract (late results are non-authoritative; panic fails closed);
//! - the CSPRNG [`nonce::TrustedNonce`] with bounded volatile zeroisation;
//! - the canonical domain-separated SHA-256 proof digest.
//!
//! ## Inertness
//!
//! The default production graph exposes NO externally callable live-verification function and NO way to
//! construct [`VerifiedWindowsOwnerEvidence`] or a real [`TrustedControlCentreWindowBinding`]. The real
//! Windows FFI lives in the gated [`verification_ffi`] module (feature `windows-live-owner-verification`)
//! and is never invoked by tests; synthetic construction is `#[cfg(test)]`-only and reaches no downstream
//! crate and no Cargo feature. This crate acquires NO capability, mints NO grant, performs NO real
//! ceremony, exposes NO raw HWND/SID/nonce/token, and touches NO Tauri/src-tauri/core. `EXECUTION_READY`
//! stays false; installation stays `NotAuthorised`.

// The internal decision machinery — policy layers, digest, worker contract, orchestration — and the gated
// live FFI are intentionally UNREACHED in any non-test build: by design this inert adapter exposes NO
// public entrypoint that runs a verification, so even the live-feature build has no caller (the window
// bridge and runtime composition are later phases). Allow dead_code only outside `test`; under `cargo
// test` everything is exercised and dead_code is enforced, so genuinely unused code is still caught.
#![cfg_attr(not(test), allow(dead_code))]
// Test tables pair a mutator `fn` with an expected error; the tuple-slice type is intentional.
#![cfg_attr(test, allow(clippy::type_complexity))]

use sha2::{Digest, Sha256};

pub mod nonce;
pub mod session;
pub mod sid;
pub mod window;

pub use window::{
    ControlCentreWindowVerifier, ExpectedWindowFacts, OwnerWindowObservationInput,
    TrustedControlCentreWindowBinding, UntrustedControlCentreWindowObservation,
    UntrustedOwnerWindowHandle, DESIGNATED_WINDOW_LABEL,
};

use nonce::{TrustedNonce, NONCE_LEN};
use session::{recheck_matches, session_permits, IdentityTuple, SessionObservation};
use sid::{sid_permits, OwnerSidObservation};
use window::window_permits;

/// This crate ships the INERT owner-verification contract; the default build runs no verification.
pub const WINDOWS_OWNER_VERIFICATION_IS_INERT: bool = true;
/// No live owner-verification ceremony is activated by shipping this crate.
pub const LIVE_OWNER_VERIFICATION_RUN: bool = false;

/// Domain-separation tag for the canonical owner-presence proof digest (version-pinned).
pub(crate) const DOMAIN_TAG: &[u8] = b"PROJECTOS:WINDOWS-OWNER-PRESENCE-EVIDENCE:V1";

// ---------------------------------------------------------------------------------------------------
// Errors — every non-success outcome fails closed with a precise reason. Manual `Display`/`Error` keep
// the dependency set to exactly `sha2` (+ optional `windows`); no `thiserror`.
// ---------------------------------------------------------------------------------------------------

/// Every fail-closed reason the inert owner-verification path can report. No variant implies success.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum OwnerVerificationError {
    /// Availability was any value other than `Available` (incl. an unknown future value).
    AvailabilityUnavailable,
    /// The verification result was any value other than `Verified` (incl. an unknown future value).
    ConsentNotVerified,
    /// `IsWindow` failed.
    InvalidWindow,
    /// `IsWindowVisible` failed.
    WindowNotVisible,
    /// The window is not an eligible top-level surface.
    WindowIneligible,
    /// The window is not the designated Control Centre window.
    WindowNotDesignated,
    /// `GetWindowThreadProcessId` returned no owning thread/process.
    WindowThreadProcessUnavailable,
    /// The window is not owned by the trusted host process.
    WindowProcessMismatch,
    /// A session query failed.
    SessionQueryFailed,
    /// The window process session differs from the trusted host session.
    SessionMismatch,
    /// The session is remote (`WTSClientProtocolType != 0`).
    RemoteSession,
    /// The session is not the active console session.
    NotActiveConsole,
    /// `OpenProcessToken` / `GetTokenInformation(TokenUser)` failed.
    TokenQueryFailed,
    /// `IsValidSid` failed on the token SID.
    InvalidSid,
    /// The token SID does not equal the configured owner SID.
    OwnerSidMismatch,
    /// The owning process changed between pre- and post-checks.
    ProcessChanged,
    /// The owning thread changed between pre- and post-checks.
    ThreadChanged,
    /// The session changed between pre- and post-checks.
    SessionChanged,
    /// The verification worker timed out.
    WorkerTimedOut,
    /// The verification was cancelled.
    WorkerCancelled,
    /// The host shut down before the verification completed.
    WorkerShutdown,
    /// The request was replaced by a newer one.
    WorkerReplaced,
    /// A late (superseded) result was delivered and discarded; no authoritative result exists.
    LateResultDiscarded,
    /// The verification worker panicked; treated as fail-closed.
    WorkerPanicked,
    /// The CSPRNG failed to produce a usable nonce.
    RngFailure,
    /// The verification window has closed (expired) or is not well-formed.
    Expired,
    /// The worker generation does not match the evidence generation.
    GenerationMismatch,
    /// The platform does not support owner verification (non-Windows).
    UnsupportedPlatform,
    /// The required Windows API is unavailable on this build/OS.
    UnsupportedApi,
    /// The `IUserConsentVerifierInterop` interface could not be obtained.
    MissingInterop,
    /// The designated Control Centre window ("main") was not present.
    MissingWindow,
    /// The window label did not equal the designated label.
    LabelMismatch,
    /// A second owner-capable window was present (ambiguity).
    SecondOwnerWindow,
    /// The native window handle was null.
    NullHandle,
    /// The window was minimised (cannot present the confirmation).
    WindowMinimized,
    /// The observed runtime-instance digest did not match the expected one.
    RuntimeInstanceMismatch,
    /// The observed IPC-session digest did not match the expected one.
    IpcSessionMismatch,
    /// The window lifecycle epoch was stale (window closed/destroyed/recreated).
    LifecycleMismatch,
}

impl core::fmt::Display for OwnerVerificationError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(match self {
            Self::AvailabilityUnavailable => "owner verification unavailable",
            Self::ConsentNotVerified => "owner consent not verified",
            Self::InvalidWindow => "invalid window",
            Self::WindowNotVisible => "window not visible",
            Self::WindowIneligible => "window ineligible",
            Self::WindowNotDesignated => "window is not the designated control centre",
            Self::WindowThreadProcessUnavailable => "window owning thread/process unavailable",
            Self::WindowProcessMismatch => "window not owned by the trusted host process",
            Self::SessionQueryFailed => "session query failed",
            Self::SessionMismatch => "window session differs from host session",
            Self::RemoteSession => "remote session not supported",
            Self::NotActiveConsole => "not the active console session",
            Self::TokenQueryFailed => "process token query failed",
            Self::InvalidSid => "invalid token SID",
            Self::OwnerSidMismatch => "token SID does not match the configured owner",
            Self::ProcessChanged => "owning process changed during verification",
            Self::ThreadChanged => "owning thread changed during verification",
            Self::SessionChanged => "session changed during verification",
            Self::WorkerTimedOut => "verification timed out",
            Self::WorkerCancelled => "verification cancelled",
            Self::WorkerShutdown => "host shut down during verification",
            Self::WorkerReplaced => "verification request replaced",
            Self::LateResultDiscarded => "late verification result discarded",
            Self::WorkerPanicked => "verification worker panicked",
            Self::RngFailure => "CSPRNG failure",
            Self::Expired => "verification window expired",
            Self::GenerationMismatch => "worker/evidence generation mismatch",
            Self::UnsupportedPlatform => "platform does not support owner verification",
            Self::UnsupportedApi => "required Windows API unavailable",
            Self::MissingInterop => "IUserConsentVerifierInterop unavailable",
            Self::MissingWindow => "designated control centre window not present",
            Self::LabelMismatch => "window label is not the designated label",
            Self::SecondOwnerWindow => "a second owner-capable window is present",
            Self::NullHandle => "null native window handle",
            Self::WindowMinimized => "window is minimised",
            Self::RuntimeInstanceMismatch => "runtime-instance digest mismatch",
            Self::IpcSessionMismatch => "IPC-session digest mismatch",
            Self::LifecycleMismatch => "stale window lifecycle epoch",
        })
    }
}

impl std::error::Error for OwnerVerificationError {}

// ---------------------------------------------------------------------------------------------------
// Availability + result mapping — only the success value is eligible; everything else fails closed.
// ---------------------------------------------------------------------------------------------------

/// Typed mirror of `UserConsentVerifierAvailability`. `Unknown(u32)` models any future OS value so no
/// integer wildcard can ever map to success.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ConsentAvailability {
    Available,
    DeviceNotPresent,
    NotConfiguredForUser,
    DisabledByPolicy,
    DeviceBusy,
    Unknown(u32),
}

/// Only `Available` is eligible; every other value (incl. `Unknown`) fails closed.
pub(crate) fn availability_permits(a: ConsentAvailability) -> Result<(), OwnerVerificationError> {
    match a {
        ConsentAvailability::Available => Ok(()),
        ConsentAvailability::DeviceNotPresent
        | ConsentAvailability::NotConfiguredForUser
        | ConsentAvailability::DisabledByPolicy
        | ConsentAvailability::DeviceBusy
        | ConsentAvailability::Unknown(_) => Err(OwnerVerificationError::AvailabilityUnavailable),
    }
}

/// Typed mirror of `UserConsentVerificationResult`. `Unknown(u32)` models any future OS value; `Refused`
/// is kept distinct from `Canceled` per the phase policy even though both fail closed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ConsentResult {
    Verified,
    Refused,
    Canceled,
    RetriesExhausted,
    DeviceBusy,
    DeviceNotPresent,
    DisabledByPolicy,
    NotConfiguredForUser,
    Unknown(u32),
}

/// Only `Verified` is eligible; every other value (incl. `Unknown`) fails closed. No automatic retry.
pub(crate) fn result_permits(r: ConsentResult) -> Result<(), OwnerVerificationError> {
    match r {
        ConsentResult::Verified => Ok(()),
        ConsentResult::Refused
        | ConsentResult::Canceled
        | ConsentResult::RetriesExhausted
        | ConsentResult::DeviceBusy
        | ConsentResult::DeviceNotPresent
        | ConsentResult::DisabledByPolicy
        | ConsentResult::NotConfiguredForUser
        | ConsentResult::Unknown(_) => Err(OwnerVerificationError::ConsentNotVerified),
    }
}

// ---------------------------------------------------------------------------------------------------
// MTA worker completion contract (inert). Real apartment init (`RoInitialize(RO_INIT_MULTITHREADED)`) and
// the blocking `IAsyncOperation::get()` live in the gated FFI; here we model only the completion rules so
// late/superseded results can never become authoritative and a panic fails closed. Single-threaded model
// (`Cell`): the abstraction is exercised without spawning a thread and never blocks a UI/event loop.
// ---------------------------------------------------------------------------------------------------

/// Why a pending request was invalidated. Each maps to a distinct fail-closed error.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WorkerInvalidation {
    TimedOut,
    Cancelled,
    Shutdown,
    Replaced,
}

#[derive(Clone, Copy)]
enum WorkerState {
    Pending,
    Completed(ConsentResult),
    Invalidated(WorkerInvalidation),
    Panicked,
}

/// The completion contract for a single owner-verification request, identified by a monotone generation.
/// A result is authoritative ONLY if it completes the still-pending request whose generation matches; any
/// invalidation, generation mismatch, non-pending state, or panic is fail-closed.
pub(crate) struct MtaWorkerRequest {
    generation: u64,
    state: core::cell::Cell<WorkerState>,
    late_discarded: core::cell::Cell<bool>,
    /// `!Send + !Sync`: a verification request must not silently cross a thread boundary.
    _thread_bound: core::marker::PhantomData<*const ()>,
}

impl MtaWorkerRequest {
    pub(crate) fn new(generation: u64) -> Self {
        Self {
            generation,
            state: core::cell::Cell::new(WorkerState::Pending),
            late_discarded: core::cell::Cell::new(false),
            _thread_bound: core::marker::PhantomData,
        }
    }

    /// The request generation.
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    /// Invalidate a still-pending request (timeout / cancel / shutdown / replace). A terminal state is not
    /// overwritten.
    pub(crate) fn invalidate(&self, reason: WorkerInvalidation) {
        if matches!(self.state.get(), WorkerState::Pending) {
            self.state.set(WorkerState::Invalidated(reason));
        }
    }

    /// Deliver a completion for `delivered_generation`. Accepted (authoritative) ONLY if it matches this
    /// request's generation AND the request is still pending; otherwise it is a late/superseded result and
    /// is discarded. Returns whether it was accepted.
    pub(crate) fn complete(&self, delivered_generation: u64, result: ConsentResult) -> bool {
        if delivered_generation == self.generation
            && matches!(self.state.get(), WorkerState::Pending)
        {
            self.state.set(WorkerState::Completed(result));
            true
        } else {
            self.late_discarded.set(true);
            false
        }
    }

    /// Run a verification closure guarded against panics: a panic marks the request `Panicked` (fail
    /// closed) instead of unwinding across the FFI boundary. On success it delivers the result.
    #[allow(dead_code)] // reached by the gated live FFI + unit tests; dead in the pure default graph
    pub(crate) fn complete_guarded<F>(&self, delivered_generation: u64, f: F)
    where
        F: FnOnce() -> ConsentResult + std::panic::UnwindSafe,
    {
        match std::panic::catch_unwind(f) {
            Ok(result) => {
                self.complete(delivered_generation, result);
            }
            Err(_) => {
                if matches!(self.state.get(), WorkerState::Pending) {
                    self.state.set(WorkerState::Panicked);
                }
            }
        }
    }

    /// The authoritative result, or the precise fail-closed reason. A still-pending request yields
    /// `LateResultDiscarded` if a superseded result was seen, else `WorkerTimedOut`.
    pub(crate) fn authoritative_result(&self) -> Result<ConsentResult, OwnerVerificationError> {
        match self.state.get() {
            WorkerState::Completed(r) => Ok(r),
            WorkerState::Invalidated(WorkerInvalidation::TimedOut) => {
                Err(OwnerVerificationError::WorkerTimedOut)
            }
            WorkerState::Invalidated(WorkerInvalidation::Cancelled) => {
                Err(OwnerVerificationError::WorkerCancelled)
            }
            WorkerState::Invalidated(WorkerInvalidation::Shutdown) => {
                Err(OwnerVerificationError::WorkerShutdown)
            }
            WorkerState::Invalidated(WorkerInvalidation::Replaced) => {
                Err(OwnerVerificationError::WorkerReplaced)
            }
            WorkerState::Panicked => Err(OwnerVerificationError::WorkerPanicked),
            WorkerState::Pending => {
                if self.late_discarded.get() {
                    Err(OwnerVerificationError::LateResultDiscarded)
                } else {
                    Err(OwnerVerificationError::WorkerTimedOut)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------
// Canonical proof digest — SHA-256, domain-separated, length-prefixed variable fields, fixed-width
// numerics/digests, big-endian, no separators, no XOR, no platform-native integer encoding.
// ---------------------------------------------------------------------------------------------------

/// The bound inputs to the canonical owner-presence proof digest, in the frozen field order (§13).
pub(crate) struct EvidenceDigestInputs<'a> {
    pub nonce: &'a TrustedNonce,
    pub proof_id: &'a [u8],
    pub verifier_identity: &'a [u8],
    pub operation_digest: [u8; 32],
    pub display_summary_digest: [u8; 32],
    pub runtime_instance_digest: [u8; 32],
    pub ipc_session_digest: [u8; 32],
    pub provider_id: &'a [u8],
    pub provider_epoch: u64,
    pub observed_at: u64,
    pub valid_until: u64,
    pub generation: u64,
    pub trusted_window_binding_digest: [u8; 32],
    pub trusted_session_digest: [u8; 32],
}

#[inline]
fn feed_var(h: &mut Sha256, bytes: &[u8]) {
    h.update((bytes.len() as u64).to_be_bytes());
    h.update(bytes);
}

#[inline]
fn feed_u64(h: &mut Sha256, v: u64) {
    h.update(v.to_be_bytes());
}

/// Compute the canonical proof digest. Field order (frozen):
/// 1 domain tag, 2 nonce, 3 proof id, 4 verifier identity, 5 operation digest, 6 display-summary digest,
/// 7 runtime-instance digest, 8 IPC-session digest, 9 provider identity, 10 provider epoch, 11 observed
/// time, 12 valid-until time, 13 generation, 14 trusted-window-binding digest, 15 trusted-session digest.
pub(crate) fn compute_evidence_digest(input: &EvidenceDigestInputs<'_>) -> [u8; 32] {
    let mut h = Sha256::new();
    feed_var(&mut h, DOMAIN_TAG); // 1 (length-prefixed so a tag change is unambiguous)
    h.update(input.nonce.expose_for_digest()); // 2 (fixed NONCE_LEN)
    feed_var(&mut h, input.proof_id); // 3
    feed_var(&mut h, input.verifier_identity); // 4
    h.update(input.operation_digest); // 5
    h.update(input.display_summary_digest); // 6
    h.update(input.runtime_instance_digest); // 7
    h.update(input.ipc_session_digest); // 8
    feed_var(&mut h, input.provider_id); // 9
    feed_u64(&mut h, input.provider_epoch); // 10
    feed_u64(&mut h, input.observed_at); // 11
    feed_u64(&mut h, input.valid_until); // 12
    feed_u64(&mut h, input.generation); // 13
    h.update(input.trusted_window_binding_digest); // 14
    h.update(input.trusted_session_digest); // 15
    let out = h.finalize();
    let mut digest = [0u8; 32];
    digest.copy_from_slice(&out);
    digest
}

const _: () = assert!(NONCE_LEN == 32);

/// Build a trusted nonce from CSPRNG bytes, mapping the all-zero non-nonce (which also signals a silent
/// RNG failure) to [`OwnerVerificationError::RngFailure`]. Used by the gated live FFI (after
/// `BCryptGenRandom`) and by tests (deterministic injection).
#[allow(dead_code)] // reached by the gated live FFI + unit tests; dead in the pure default graph
pub(crate) fn nonce_from_rng_bytes(
    bytes: [u8; NONCE_LEN],
) -> Result<TrustedNonce, OwnerVerificationError> {
    TrustedNonce::from_bytes(bytes).ok_or(OwnerVerificationError::RngFailure)
}

// ---------------------------------------------------------------------------------------------------
// Opaque evidence.
// ---------------------------------------------------------------------------------------------------

/// The opaque proof that the designated owner was verified present at the designated Control Centre window
/// for a bound operation. Private fields, no public constructor, not `Clone`/`Copy`/`Default`, not
/// serialisable, redacted `Debug`. Carries only the proof digest and generation — never a raw SID, HWND,
/// nonce or token, and no capability/grant/effect authority.
pub struct VerifiedWindowsOwnerEvidence {
    proof_digest: [u8; 32],
    generation: u64,
    /// Whether this evidence came from the gated `fixture-owner-evidence` producer rather than a real
    /// ceremony. ALWAYS `false` on the live path. Never settable by a caller.
    fixture: bool,
}

impl core::fmt::Debug for VerifiedWindowsOwnerEvidence {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(
            f,
            "VerifiedWindowsOwnerEvidence(gen={}, [REDACTED])",
            self.generation
        )
    }
}

impl VerifiedWindowsOwnerEvidence {
    /// Crate-internal mint. Only [`run_inert_verification`] reaches this; it is not `pub`, so no downstream
    /// crate and no test outside this crate can construct evidence.
    fn mint(proof_digest: [u8; 32], generation: u64) -> Self {
        Self {
            proof_digest,
            generation,
            fixture: false,
        }
    }

    /// Whether this evidence came from the gated fixture producer instead of a real Windows ceremony.
    ///
    /// A consumer that grants authority MUST refuse fixture evidence. It is `false` for anything the
    /// live path produces, and a caller can neither set nor clear it.
    #[must_use]
    pub fn is_fixture(&self) -> bool {
        self.fixture
    }

    /// The canonical proof digest (safe to expose — a digest, not a secret).
    #[must_use]
    pub fn proof_digest(&self) -> [u8; 32] {
        self.proof_digest
    }

    /// The verification generation bound into the proof.
    #[must_use]
    pub fn generation(&self) -> u64 {
        self.generation
    }
}

// ---------------------------------------------------------------------------------------------------
// Inert orchestration — ties the layers together fail-closed. `pub(crate)`: never externally callable.
// ---------------------------------------------------------------------------------------------------

/// All inputs the inert orchestration needs. In the default graph these are only ever supplied by
/// `#[cfg(test)]` code with synthetic values; the gated live FFI supplies real observations. Supplying
/// these does not, by itself, constitute authority — the whole struct is `pub(crate)`.
pub(crate) struct InertVerificationInput<'a> {
    pub binding: &'a TrustedControlCentreWindowBinding,
    pub trusted_host_pid: u32,
    pub availability: ConsentAvailability,
    pub worker: &'a MtaWorkerRequest,
    pub session: SessionObservation,
    pub sid: OwnerSidObservation,
    pub pre: IdentityTuple,
    pub post: IdentityTuple,
    pub nonce: TrustedNonce,
    pub proof_id: &'a [u8],
    pub verifier_identity: &'a [u8],
    pub operation_digest: [u8; 32],
    pub display_summary_digest: [u8; 32],
    pub runtime_instance_digest: [u8; 32],
    pub ipc_session_digest: [u8; 32],
    pub provider_id: &'a [u8],
    pub provider_epoch: u64,
    pub observed_at: u64,
    pub valid_until: u64,
    pub generation: u64,
    pub trusted_session_digest: [u8; 32],
    pub now: u64,
}

/// Run the inert verification decision. Every layer is checked fail-closed in a fixed order; the FIRST
/// failure returns and NO evidence is minted. On full success the trusted nonce is folded into the
/// canonical digest and then dropped (zeroised) before evidence is returned.
pub(crate) fn run_inert_verification(
    input: InertVerificationInput<'_>,
) -> Result<VerifiedWindowsOwnerEvidence, OwnerVerificationError> {
    availability_permits(input.availability)?;
    let result = input.worker.authoritative_result()?;
    result_permits(result)?;

    if input.worker.generation() != input.generation {
        return Err(OwnerVerificationError::GenerationMismatch);
    }

    window_permits(input.binding.observation(), input.trusted_host_pid)?;
    session_permits(&input.session)?;
    sid_permits(&input.sid)?;
    recheck_matches(&input.pre, &input.post)?;

    if input.valid_until <= input.observed_at || input.now > input.valid_until {
        return Err(OwnerVerificationError::Expired);
    }

    let digest = compute_evidence_digest(&EvidenceDigestInputs {
        nonce: &input.nonce,
        proof_id: input.proof_id,
        verifier_identity: input.verifier_identity,
        operation_digest: input.operation_digest,
        display_summary_digest: input.display_summary_digest,
        runtime_instance_digest: input.runtime_instance_digest,
        ipc_session_digest: input.ipc_session_digest,
        provider_id: input.provider_id,
        provider_epoch: input.provider_epoch,
        observed_at: input.observed_at,
        valid_until: input.valid_until,
        generation: input.generation,
        trusted_window_binding_digest: input.binding.binding_digest(),
        trusted_session_digest: input.trusted_session_digest,
    });

    // Fold complete: drop the nonce now so the raw bytes are cleared before evidence is returned.
    drop(input.nonce);

    Ok(VerifiedWindowsOwnerEvidence::mint(digest, input.generation))
}

// ---------------------------------------------------------------------------------------------------
// GATED FIXTURE EVIDENCE (CD-B4-PRODUCTION-OWNER-PRESENCE-CAPABILITY-BRIDGE1A, post-freeze Option B).
// ---------------------------------------------------------------------------------------------------

/// Produce FIXTURE owner evidence for the bridge chain proof, without any Windows call.
///
/// This exists because every input to the real decision is an OS-observed fact that only the gated live
/// FFI can honestly supply, and exposing those inputs publicly would let a caller forge evidence. Instead
/// the OS facts are synthesised HERE, in-crate, and fed to the SAME `run_inert_verification` decision the
/// live path uses — so the fail-closed policy under test is the real one, not a stand-in.
///
/// It calls NO Windows API and NEVER runs `UserConsentVerifier`. The window binding is minted by the
/// sealed [`ControlCentreWindowVerifier`] from the caller's UNTRUSTED observation and expected facts, so
/// the window policy is genuinely exercised. Resulting evidence is permanently marked
/// [`VerifiedWindowsOwnerEvidence::is_fixture`] and must never be granted production authority.
///
/// Compiled only under `fixture-owner-evidence`, which is non-default and enabled only by bridge tests.
///
/// # Errors
/// [`OwnerVerificationError`] naming the first failed invariant — the same refusals the live path gives.
#[cfg(feature = "fixture-owner-evidence")]
#[allow(clippy::too_many_arguments)]
pub fn fixture_owner_evidence(
    observation: &UntrustedControlCentreWindowObservation,
    expected: &ExpectedWindowFacts<'_>,
    trusted_host_pid: u32,
    proof_id: &[u8],
    verifier_identity: &[u8],
    operation_digest: [u8; 32],
    display_summary_digest: [u8; 32],
    runtime_instance_digest: [u8; 32],
    ipc_session_digest: [u8; 32],
    provider_id: &[u8],
    provider_epoch: u64,
    observed_at: u64,
    valid_until: u64,
    generation: u64,
    trusted_session_digest: [u8; 32],
    now: u64,
) -> Result<VerifiedWindowsOwnerEvidence, OwnerVerificationError> {
    // Real window policy: the sealed verifier re-checks every fact before minting a binding.
    let binding = window::fixture_verify_binding(observation, expected, now)?;

    // Synthesised OS facts. In the live path these come from WTS / token / consent calls; here they are
    // constructed in-crate so no caller can supply (or forge) them.
    let worker = MtaWorkerRequest::new(generation);
    worker.complete(generation, ConsentResult::Verified);
    let session = SessionObservation {
        session_query_ok: true,
        window_session: expected.expected_session,
        host_session: expected.expected_session,
        client_protocol_type: session::WTS_PROTOCOL_CONSOLE,
        active_console_session: expected.expected_session,
    };
    let sid = OwnerSidObservation {
        token_query_ok: true,
        sid_valid: true,
        equals_configured_owner: true,
    };
    let tuple = IdentityTuple {
        process_id: expected.expected_process_id,
        thread_id: trusted_host_pid,
        session: expected.expected_session,
    };
    let nonce = nonce_from_rng_bytes([0xA5u8; nonce::NONCE_LEN])?;

    let evidence = run_inert_verification(InertVerificationInput {
        binding: &binding,
        trusted_host_pid,
        availability: ConsentAvailability::Available,
        worker: &worker,
        session,
        sid,
        pre: tuple,
        post: tuple,
        nonce,
        proof_id,
        verifier_identity,
        operation_digest,
        display_summary_digest,
        runtime_instance_digest,
        ipc_session_digest,
        provider_id,
        provider_epoch,
        observed_at,
        valid_until,
        generation,
        trusted_session_digest,
        now,
    })?;
    // Mark it, permanently and unforgeably, as fixture-derived.
    Ok(VerifiedWindowsOwnerEvidence {
        proof_digest: evidence.proof_digest(),
        generation: evidence.generation(),
        fixture: true,
    })
}

// ---------------------------------------------------------------------------------------------------
// Platform behaviour.
// ---------------------------------------------------------------------------------------------------

/// The platform/build owner-verification status. Constructs no evidence; a status only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlatformOwnerVerificationStatus {
    /// Windows: the contract is present and inert (no live entrypoint in this build/graph).
    SupportedInert,
    /// Non-Windows: owner verification is unavailable and fails closed.
    Unsupported,
}

/// Report the platform/build status. Non-Windows is `Unsupported` (fail closed); Windows is
/// `SupportedInert` — present but not live, since no default-graph entrypoint runs a verification.
#[must_use]
pub fn platform_owner_verification_status() -> PlatformOwnerVerificationStatus {
    #[cfg(windows)]
    {
        PlatformOwnerVerificationStatus::SupportedInert
    }
    #[cfg(not(windows))]
    {
        PlatformOwnerVerificationStatus::Unsupported
    }
}

// The gated live FFI. Compiled only under the feature on Windows; never invoked by tests; exposes no
// public live-verification entrypoint.
#[cfg(all(windows, feature = "windows-live-owner-verification"))]
mod verification_ffi;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::window::WindowObservation;

    // ---- synthetic input builders (test-only) ----

    fn good_window() -> WindowObservation {
        WindowObservation {
            is_window: true,
            is_visible: true,
            eligible: true,
            identifies_designated_cc: true,
            thread_id: 11,
            process_id: 4242,
        }
    }

    fn good_session() -> SessionObservation {
        SessionObservation {
            session_query_ok: true,
            window_session: 1,
            host_session: 1,
            client_protocol_type: session::WTS_PROTOCOL_CONSOLE,
            active_console_session: 1,
        }
    }

    fn good_sid() -> OwnerSidObservation {
        OwnerSidObservation {
            token_query_ok: true,
            sid_valid: true,
            equals_configured_owner: true,
        }
    }

    fn tuple() -> IdentityTuple {
        IdentityTuple {
            process_id: 4242,
            thread_id: 11,
            session: 1,
        }
    }

    fn nonce(seed: u8) -> TrustedNonce {
        let mut b = [0u8; NONCE_LEN];
        b[0] = seed;
        b[31] = seed ^ 0xAB;
        nonce_from_rng_bytes(b).expect("nonzero nonce")
    }

    fn binding() -> TrustedControlCentreWindowBinding {
        TrustedControlCentreWindowBinding::synthetic(good_window(), [3u8; 32])
    }

    /// A fully valid input that mints evidence, parameterised by nonce seed and generation.
    fn good_input<'a>(
        binding: &'a TrustedControlCentreWindowBinding,
        worker: &'a MtaWorkerRequest,
        nonce: TrustedNonce,
        generation: u64,
    ) -> InertVerificationInput<'a> {
        InertVerificationInput {
            binding,
            trusted_host_pid: 4242,
            availability: ConsentAvailability::Available,
            worker,
            session: good_session(),
            sid: good_sid(),
            pre: tuple(),
            post: tuple(),
            nonce,
            proof_id: b"proof-1",
            verifier_identity: b"UserConsentVerifier",
            operation_digest: [1u8; 32],
            display_summary_digest: [2u8; 32],
            runtime_instance_digest: [4u8; 32],
            ipc_session_digest: [5u8; 32],
            provider_id: b"windows-owner",
            provider_epoch: 7,
            observed_at: 1_000,
            valid_until: 21_000,
            generation,
            trusted_session_digest: [6u8; 32],
            now: 1_500,
        }
    }

    fn completed_worker(generation: u64, result: ConsentResult) -> MtaWorkerRequest {
        let w = MtaWorkerRequest::new(generation);
        assert!(w.complete(generation, result));
        w
    }

    // ---- T1/T2 availability ----

    #[test]
    fn t1_t2_only_available_permits() {
        assert!(availability_permits(ConsentAvailability::Available).is_ok());
        for a in [
            ConsentAvailability::DeviceNotPresent,
            ConsentAvailability::NotConfiguredForUser,
            ConsentAvailability::DisabledByPolicy,
            ConsentAvailability::DeviceBusy,
            ConsentAvailability::Unknown(999),
            ConsentAvailability::Unknown(0),
        ] {
            assert_eq!(
                availability_permits(a).unwrap_err(),
                OwnerVerificationError::AvailabilityUnavailable
            );
        }
    }

    // ---- T3/T4 result ----

    #[test]
    fn t3_t4_only_verified_permits() {
        assert!(result_permits(ConsentResult::Verified).is_ok());
        for r in [
            ConsentResult::Refused,
            ConsentResult::Canceled,
            ConsentResult::RetriesExhausted,
            ConsentResult::DeviceBusy,
            ConsentResult::DeviceNotPresent,
            ConsentResult::DisabledByPolicy,
            ConsentResult::NotConfiguredForUser,
            ConsentResult::Unknown(4242),
            ConsentResult::Unknown(0),
        ] {
            assert_eq!(
                result_permits(r).unwrap_err(),
                OwnerVerificationError::ConsentNotVerified
            );
        }
    }

    // ---- T17/T18 gated-FFI error variants exist and are distinct fail-closed reasons ----

    #[test]
    fn t17_t18_api_and_interop_errors_are_distinct() {
        assert_ne!(
            OwnerVerificationError::UnsupportedApi,
            OwnerVerificationError::MissingInterop
        );
        assert!(!format!("{}", OwnerVerificationError::UnsupportedApi).is_empty());
        assert!(!format!("{}", OwnerVerificationError::MissingInterop).is_empty());
    }

    // ---- T19/T20/T21 worker invalidations ----

    #[test]
    fn t19_t20_t21_worker_invalidations_fail_closed() {
        for (reason, expected) in [
            (
                WorkerInvalidation::TimedOut,
                OwnerVerificationError::WorkerTimedOut,
            ),
            (
                WorkerInvalidation::Cancelled,
                OwnerVerificationError::WorkerCancelled,
            ),
            (
                WorkerInvalidation::Shutdown,
                OwnerVerificationError::WorkerShutdown,
            ),
            (
                WorkerInvalidation::Replaced,
                OwnerVerificationError::WorkerReplaced,
            ),
        ] {
            let w = MtaWorkerRequest::new(1);
            w.invalidate(reason);
            assert_eq!(w.authoritative_result().unwrap_err(), expected);
        }
    }

    // ---- T22 late result discarded ----

    #[test]
    fn t22_late_result_is_non_authoritative() {
        let w = MtaWorkerRequest::new(1);
        w.invalidate(WorkerInvalidation::TimedOut);
        // A late completion after invalidation is rejected...
        assert!(!w.complete(1, ConsentResult::Verified));
        // ...and the timeout still wins (no evidence path).
        assert_eq!(
            w.authoritative_result().unwrap_err(),
            OwnerVerificationError::WorkerTimedOut
        );

        // A late result with no prior invalidation, still pending, surfaces LateResultDiscarded.
        let w2 = MtaWorkerRequest::new(2);
        assert!(!w2.complete(99, ConsentResult::Verified)); // wrong generation
        assert_eq!(
            w2.authoritative_result().unwrap_err(),
            OwnerVerificationError::LateResultDiscarded
        );
    }

    // ---- T23 duplicate request ----

    #[test]
    fn t23_duplicate_completion_keeps_first() {
        let w = MtaWorkerRequest::new(1);
        assert!(w.complete(1, ConsentResult::Verified));
        assert!(!w.complete(1, ConsentResult::Refused)); // second is discarded
        assert_eq!(w.authoritative_result().unwrap(), ConsentResult::Verified);
    }

    // ---- T24 request replacement ----

    #[test]
    fn t24_replaced_request_rejects_old_generation() {
        let old = MtaWorkerRequest::new(1);
        old.invalidate(WorkerInvalidation::Replaced);
        let new = MtaWorkerRequest::new(2);
        assert!(!old.complete(1, ConsentResult::Verified));
        assert!(new.complete(2, ConsentResult::Verified));
        assert_eq!(
            old.authoritative_result().unwrap_err(),
            OwnerVerificationError::WorkerReplaced
        );
        assert_eq!(new.authoritative_result().unwrap(), ConsentResult::Verified);
    }

    // ---- T34 panic fails closed ----

    #[test]
    fn t34_panicking_worker_fails_closed() {
        let w = MtaWorkerRequest::new(1);
        w.complete_guarded(1, || panic!("verifier blew up"));
        assert_eq!(
            w.authoritative_result().unwrap_err(),
            OwnerVerificationError::WorkerPanicked
        );
    }

    // ---- T25 RNG failure ----

    #[test]
    fn t25_all_zero_rng_fails_closed() {
        assert_eq!(
            nonce_from_rng_bytes([0u8; NONCE_LEN]).unwrap_err(),
            OwnerVerificationError::RngFailure
        );
    }

    // ---- T26 nonce uniqueness is load-bearing in the digest ----

    #[test]
    fn t26_distinct_nonces_yield_distinct_digests() {
        let b = binding();
        let w1 = completed_worker(1, ConsentResult::Verified);
        let w2 = completed_worker(1, ConsentResult::Verified);
        let e1 = run_inert_verification(good_input(&b, &w1, nonce(1), 1)).unwrap();
        let e2 = run_inert_verification(good_input(&b, &w2, nonce(2), 1)).unwrap();
        assert_ne!(e1.proof_digest(), e2.proof_digest());
    }

    // ---- T29 evidence Debug redaction + T35 no protected effect ----

    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn t29_t35_evidence_is_redacted_and_inert() {
        let b = binding();
        let w = completed_worker(3, ConsentResult::Verified);
        let e = run_inert_verification(good_input(&b, &w, nonce(9), 3)).unwrap();
        let dbg = format!("{e:?}");
        assert!(dbg.contains("[REDACTED]"));
        assert!(dbg.contains("gen=3"));
        // No live ceremony is ever activated by this crate.
        assert!(WINDOWS_OWNER_VERIFICATION_IS_INERT);
        assert!(!LIVE_OWNER_VERIFICATION_RUN);
    }

    // ---- T30 canonical digest test vector (pinned) ----

    const EXPECTED_DIGEST_VECTOR: &str =
        "3e076662fd97030e6ca3e9182b4098461230c8a9a9bdd84e0d34aecdeec8e28c";

    fn vector_digest() -> [u8; 32] {
        let mut nb = [0u8; NONCE_LEN];
        for (i, byte) in nb.iter_mut().enumerate() {
            *byte = i as u8; // 0x00..0x1F — nonzero overall
        }
        let n = TrustedNonce::from_bytes(nb).expect("vector nonce");
        compute_evidence_digest(&EvidenceDigestInputs {
            nonce: &n,
            proof_id: b"vector-proof",
            verifier_identity: b"UserConsentVerifier",
            operation_digest: [0x11; 32],
            display_summary_digest: [0x22; 32],
            runtime_instance_digest: [0x33; 32],
            ipc_session_digest: [0x44; 32],
            provider_id: b"windows-owner",
            provider_epoch: 0x0102_0304_0506_0708,
            observed_at: 1_000,
            valid_until: 2_000,
            generation: 42,
            trusted_window_binding_digest: [0x55; 32],
            trusted_session_digest: [0x66; 32],
        })
    }

    fn hex(d: &[u8; 32]) -> String {
        let mut s = String::with_capacity(64);
        for b in d {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }

    #[test]
    fn t30_canonical_digest_vector_is_pinned() {
        assert_eq!(hex(&vector_digest()), EXPECTED_DIGEST_VECTOR);
    }

    // ---- T31 every digest field is load-bearing ----

    #[test]
    fn t31_every_digest_field_changes_the_digest() {
        let n = nonce(5);
        let base = EvidenceDigestInputs {
            nonce: &n,
            proof_id: b"pid",
            verifier_identity: b"vid",
            operation_digest: [1u8; 32],
            display_summary_digest: [2u8; 32],
            runtime_instance_digest: [3u8; 32],
            ipc_session_digest: [4u8; 32],
            provider_id: b"prov",
            provider_epoch: 10,
            observed_at: 100,
            valid_until: 200,
            generation: 1,
            trusted_window_binding_digest: [5u8; 32],
            trusted_session_digest: [6u8; 32],
        };
        let base_digest = compute_evidence_digest(&base);

        // Each variable field: a change of value.
        let n2 = nonce(6);
        let variants: Vec<[u8; 32]> = vec![
            compute_evidence_digest(&EvidenceDigestInputs {
                nonce: &n2,
                ..copy(&base, &n)
            }),
            compute_evidence_digest(&EvidenceDigestInputs {
                proof_id: b"pidX",
                ..copy(&base, &n)
            }),
            compute_evidence_digest(&EvidenceDigestInputs {
                verifier_identity: b"vidX",
                ..copy(&base, &n)
            }),
            compute_evidence_digest(&EvidenceDigestInputs {
                operation_digest: [9u8; 32],
                ..copy(&base, &n)
            }),
            compute_evidence_digest(&EvidenceDigestInputs {
                display_summary_digest: [9u8; 32],
                ..copy(&base, &n)
            }),
            compute_evidence_digest(&EvidenceDigestInputs {
                runtime_instance_digest: [9u8; 32],
                ..copy(&base, &n)
            }),
            compute_evidence_digest(&EvidenceDigestInputs {
                ipc_session_digest: [9u8; 32],
                ..copy(&base, &n)
            }),
            compute_evidence_digest(&EvidenceDigestInputs {
                provider_id: b"provX",
                ..copy(&base, &n)
            }),
            compute_evidence_digest(&EvidenceDigestInputs {
                provider_epoch: 11,
                ..copy(&base, &n)
            }),
            compute_evidence_digest(&EvidenceDigestInputs {
                observed_at: 101,
                ..copy(&base, &n)
            }),
            compute_evidence_digest(&EvidenceDigestInputs {
                valid_until: 201,
                ..copy(&base, &n)
            }),
            compute_evidence_digest(&EvidenceDigestInputs {
                generation: 2,
                ..copy(&base, &n)
            }),
            compute_evidence_digest(&EvidenceDigestInputs {
                trusted_window_binding_digest: [9u8; 32],
                ..copy(&base, &n)
            }),
            compute_evidence_digest(&EvidenceDigestInputs {
                trusted_session_digest: [9u8; 32],
                ..copy(&base, &n)
            }),
        ];
        for (i, v) in variants.iter().enumerate() {
            assert_ne!(*v, base_digest, "digest field {i} was not load-bearing");
        }
        // Length-prefix framing: "ab"+"c" must differ from "a"+"bc" (no ambiguous concatenation).
        let split_a = compute_evidence_digest(&EvidenceDigestInputs {
            proof_id: b"ab",
            verifier_identity: b"c",
            ..copy(&base, &n)
        });
        let split_b = compute_evidence_digest(&EvidenceDigestInputs {
            proof_id: b"a",
            verifier_identity: b"bc",
            ..copy(&base, &n)
        });
        assert_ne!(split_a, split_b, "length-prefix framing is ambiguous");
    }

    // Rebuild a base with a given nonce ref (struct is not Clone by design — nonce is move-only).
    fn copy<'a>(b: &EvidenceDigestInputs<'a>, n: &'a TrustedNonce) -> EvidenceDigestInputs<'a> {
        EvidenceDigestInputs {
            nonce: n,
            proof_id: b.proof_id,
            verifier_identity: b.verifier_identity,
            operation_digest: b.operation_digest,
            display_summary_digest: b.display_summary_digest,
            runtime_instance_digest: b.runtime_instance_digest,
            ipc_session_digest: b.ipc_session_digest,
            provider_id: b.provider_id,
            provider_epoch: b.provider_epoch,
            observed_at: b.observed_at,
            valid_until: b.valid_until,
            generation: b.generation,
            trusted_window_binding_digest: b.trusted_window_binding_digest,
            trusted_session_digest: b.trusted_session_digest,
        }
    }

    // ---- T32 platform status ----

    #[test]
    fn t32_platform_status_matches_target() {
        let s = platform_owner_verification_status();
        #[cfg(windows)]
        assert_eq!(s, PlatformOwnerVerificationStatus::SupportedInert);
        #[cfg(not(windows))]
        assert_eq!(s, PlatformOwnerVerificationStatus::Unsupported);
    }

    // ---- T33 no evidence on any failing layer ----

    #[test]
    fn t33_no_evidence_on_failure() {
        let b = binding();

        // availability
        {
            let w = completed_worker(1, ConsentResult::Verified);
            let mut inp = good_input(&b, &w, nonce(1), 1);
            inp.availability = ConsentAvailability::DeviceBusy;
            assert_eq!(
                run_inert_verification(inp).unwrap_err(),
                OwnerVerificationError::AvailabilityUnavailable
            );
        }
        // consent result
        {
            let w = completed_worker(1, ConsentResult::Refused);
            assert_eq!(
                run_inert_verification(good_input(&b, &w, nonce(1), 1)).unwrap_err(),
                OwnerVerificationError::ConsentNotVerified
            );
        }
        // generation mismatch
        {
            let w = completed_worker(1, ConsentResult::Verified);
            let inp = good_input(&b, &w, nonce(1), 2); // evidence gen 2 != worker gen 1
            assert_eq!(
                run_inert_verification(inp).unwrap_err(),
                OwnerVerificationError::GenerationMismatch
            );
        }
        // window process mismatch
        {
            let w = completed_worker(1, ConsentResult::Verified);
            let mut inp = good_input(&b, &w, nonce(1), 1);
            inp.trusted_host_pid = 1; // != observed 4242
            assert_eq!(
                run_inert_verification(inp).unwrap_err(),
                OwnerVerificationError::WindowProcessMismatch
            );
        }
        // session mismatch
        {
            let w = completed_worker(1, ConsentResult::Verified);
            let mut inp = good_input(&b, &w, nonce(1), 1);
            inp.session.window_session = 9;
            assert_eq!(
                run_inert_verification(inp).unwrap_err(),
                OwnerVerificationError::SessionMismatch
            );
        }
        // remote session
        {
            let w = completed_worker(1, ConsentResult::Verified);
            let mut inp = good_input(&b, &w, nonce(1), 1);
            inp.session.client_protocol_type = 2;
            assert_eq!(
                run_inert_verification(inp).unwrap_err(),
                OwnerVerificationError::RemoteSession
            );
        }
        // owner SID mismatch
        {
            let w = completed_worker(1, ConsentResult::Verified);
            let mut inp = good_input(&b, &w, nonce(1), 1);
            inp.sid.equals_configured_owner = false;
            assert_eq!(
                run_inert_verification(inp).unwrap_err(),
                OwnerVerificationError::OwnerSidMismatch
            );
        }
        // pre/post change
        {
            let w = completed_worker(1, ConsentResult::Verified);
            let mut inp = good_input(&b, &w, nonce(1), 1);
            inp.post.session = 2;
            assert_eq!(
                run_inert_verification(inp).unwrap_err(),
                OwnerVerificationError::SessionChanged
            );
        }
        // expiry
        {
            let w = completed_worker(1, ConsentResult::Verified);
            let mut inp = good_input(&b, &w, nonce(1), 1);
            inp.now = 999_999;
            assert_eq!(
                run_inert_verification(inp).unwrap_err(),
                OwnerVerificationError::Expired
            );
        }
    }
}
