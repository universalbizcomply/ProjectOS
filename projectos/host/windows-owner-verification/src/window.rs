//! Window and window-process policy, and the opaque [`TrustedControlCentreWindowBinding`].
//!
//! The policy layer is PURE: it decides over already-observed, typed values ([`WindowObservation`]) so it
//! is exercised entirely with synthetic inputs and never calls a Windows API. The gated
//! [`crate::verification_ffi`] module is the only place that populates a [`WindowObservation`] from live
//! `IsWindow` / `IsWindowVisible` / `GetWindowLongPtrW` / `GetWindowThreadProcessId` calls.
//!
//! [`TrustedControlCentreWindowBinding`] is the opaque INPUT contract owned by this crate. It has no
//! public constructor and no public raw-`HWND` accessor. The real (live) constructor is a future
//! window-bridge concern and is deliberately NOT created in this phase; the only constructors here are the
//! `#[cfg(test)]` synthetic one and a MODULE-PRIVATE mint reachable solely through the sealed
//! [`ControlCentreWindowVerifier`] in this same module.

use core::marker::PhantomData;

use sha2::{Digest, Sha256};

use crate::session::WTS_PROTOCOL_CONSOLE;
use crate::OwnerVerificationError;

/// The designated Control Centre window label (Tauri default when the config sets no explicit label).
pub const DESIGNATED_WINDOW_LABEL: &str = "main";

/// Domain-separation tag for the UNTRUSTED window-observation digest (distinct from the trusted-binding
/// digest tag).
pub(crate) const OBSERVATION_DOMAIN_TAG: &[u8] = b"PROJECTOS:CONTROL-CENTRE-WINDOW-OBSERVATION:V1";

/// Domain-separation tag for the trusted window-binding digest.
pub(crate) const BINDING_DOMAIN_TAG: &[u8] = b"PROJECTOS:CONTROL-CENTRE-WINDOW-BINDING:V1";

/// A typed, already-observed view of a candidate window and its owning thread/process. Populated by the
/// gated live FFI from Win32 calls, or synthesised in tests. Not a Windows handle: it carries no raw
/// `HWND` and never leaves the crate.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct WindowObservation {
    /// `IsWindow(hwnd)` succeeded.
    pub is_window: bool,
    /// `IsWindowVisible(hwnd)` succeeded.
    pub is_visible: bool,
    /// The window is an eligible top-level surface (not a hidden/tool-window style).
    pub eligible: bool,
    /// The window matches the designated Control Centre identity carried by the binding.
    pub identifies_designated_cc: bool,
    /// `GetWindowThreadProcessId` owning thread id (0 = failure / no owner).
    pub thread_id: u32,
    /// `GetWindowThreadProcessId` owning process id (0 = failure / no owner).
    pub process_id: u32,
}

/// Decide the window/process policy fail-closed. Returns `Ok(())` only when every condition holds; the
/// FIRST failing condition wins so the returned error names the exact reason.
pub(crate) fn window_permits(
    obs: &WindowObservation,
    trusted_host_pid: u32,
) -> Result<(), OwnerVerificationError> {
    if !obs.is_window {
        return Err(OwnerVerificationError::InvalidWindow);
    }
    if !obs.is_visible {
        return Err(OwnerVerificationError::WindowNotVisible);
    }
    if !obs.eligible {
        return Err(OwnerVerificationError::WindowIneligible);
    }
    if !obs.identifies_designated_cc {
        return Err(OwnerVerificationError::WindowNotDesignated);
    }
    if obs.thread_id == 0 || obs.process_id == 0 {
        return Err(OwnerVerificationError::WindowThreadProcessUnavailable);
    }
    if trusted_host_pid == 0 || obs.process_id != trusted_host_pid {
        return Err(OwnerVerificationError::WindowProcessMismatch);
    }
    Ok(())
}

/// The opaque trusted binding to the designated Control Centre window. Private fields, no public
/// constructor, no public raw-`HWND` accessor, redacted `Debug`, not serialisable. Carries only the
/// already-observed window view and a domain-separated binding digest that feeds the proof digest.
#[derive(PartialEq, Eq)]
pub struct TrustedControlCentreWindowBinding {
    observation: WindowObservation,
    binding_digest: [u8; 32],
}

impl core::fmt::Debug for TrustedControlCentreWindowBinding {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("TrustedControlCentreWindowBinding([REDACTED])")
    }
}

impl TrustedControlCentreWindowBinding {
    /// Module-PRIVATE mint: no `pub`, no `pub(crate)`. Rust privacy therefore confines it to this module,
    /// so ONLY [`ControlCentreWindowVerifier`] (same module) can call it — no other adapter module
    /// (including the gated `verification_ffi`) and no downstream crate can construct a binding through it.
    #[allow(dead_code)]
    fn from_observed(observation: WindowObservation, binding_digest: [u8; 32]) -> Self {
        Self {
            observation,
            binding_digest,
        }
    }

    /// TEST-ONLY synthetic binding so unit tests can drive the inert orchestration. `#[cfg(test)]` only —
    /// it is NOT exposed through a Cargo feature and is unreachable from any downstream crate or the
    /// default graph.
    #[cfg(test)]
    pub(crate) fn synthetic(observation: WindowObservation, binding_digest: [u8; 32]) -> Self {
        Self {
            observation,
            binding_digest,
        }
    }

    /// The observed window view (crate-internal).
    pub(crate) fn observation(&self) -> &WindowObservation {
        &self.observation
    }

    /// The domain-separated window-binding digest folded into the proof digest (crate-internal).
    pub(crate) fn binding_digest(&self) -> [u8; 32] {
        self.binding_digest
    }
}

// ---------------------------------------------------------------------------------------------------
// UNTRUSTED observation surface. Public and forgeable BY DESIGN: it carries no authority and cannot mint
// anything. Only the sealed `ControlCentreWindowVerifier` (below), re-checking every fact, mints a
// trusted binding.
// ---------------------------------------------------------------------------------------------------

/// An UNTRUSTED opaque native window handle. A trusted-Rust caller may wrap a raw native value, but doing
/// so grants NO authority. Private raw field, redacted `Debug`, not serialisable, no public raw accessor.
pub struct UntrustedOwnerWindowHandle {
    raw: isize,
}

impl UntrustedOwnerWindowHandle {
    /// Wrap a raw native handle value. UNTRUSTED: no authority; the value is re-observed and re-checked by
    /// the sealed verifier before any binding is minted.
    #[must_use]
    pub fn from_raw(raw: isize) -> Self {
        Self { raw }
    }

    /// Whether the handle is the null non-handle.
    #[must_use]
    pub fn is_null(&self) -> bool {
        self.raw == 0
    }

    /// The raw value, crate-internal only (folded into digests, never rendered or exported).
    pub(crate) fn raw(&self) -> isize {
        self.raw
    }
}

impl core::fmt::Debug for UntrustedOwnerWindowHandle {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("UntrustedOwnerWindowHandle([REDACTED])")
    }
}

/// An UNTRUSTED, immutable observation of the candidate Control Centre window and its trust-relevant
/// context. Public construction is permitted (it is evidence, not authority); private fields, narrow
/// crate-internal accessors, redacted `Debug`, not serialisable. It CANNOT become owner evidence, a grant
/// or an effect, and cannot mint a binding.
pub struct UntrustedControlCentreWindowObservation {
    label: String,
    handle: UntrustedOwnerWindowHandle,
    is_window: bool,
    is_visible: bool,
    is_minimized: bool,
    is_focused: bool,
    eligible: bool,
    process_id: u32,
    thread_id: u32,
    session: u32,
    client_protocol_type: u32,
    active_console_session: u32,
    runtime_instance_digest: [u8; 32],
    ipc_session_digest: [u8; 32],
    project_digest: [u8; 32],
    repository_digest: [u8; 32],
    environment_digest: [u8; 32],
    phase_digest: [u8; 32],
    lifecycle_epoch: u64,
    capture_generation: u64,
    observed_at: u64,
}

/// The bounded inputs a trusted producer supplies to construct an untrusted observation.
pub struct OwnerWindowObservationInput {
    pub label: String,
    pub handle: UntrustedOwnerWindowHandle,
    pub is_window: bool,
    pub is_visible: bool,
    pub is_minimized: bool,
    pub is_focused: bool,
    pub eligible: bool,
    pub process_id: u32,
    pub thread_id: u32,
    pub session: u32,
    pub client_protocol_type: u32,
    pub active_console_session: u32,
    pub runtime_instance_digest: [u8; 32],
    pub ipc_session_digest: [u8; 32],
    pub project_digest: [u8; 32],
    pub repository_digest: [u8; 32],
    pub environment_digest: [u8; 32],
    pub phase_digest: [u8; 32],
    pub lifecycle_epoch: u64,
    pub capture_generation: u64,
    pub observed_at: u64,
}

impl UntrustedControlCentreWindowObservation {
    /// Construct an UNTRUSTED observation. Anyone may call this; it grants no authority.
    #[must_use]
    pub fn new(input: OwnerWindowObservationInput) -> Self {
        Self {
            label: input.label,
            handle: input.handle,
            is_window: input.is_window,
            is_visible: input.is_visible,
            is_minimized: input.is_minimized,
            is_focused: input.is_focused,
            eligible: input.eligible,
            process_id: input.process_id,
            thread_id: input.thread_id,
            session: input.session,
            client_protocol_type: input.client_protocol_type,
            active_console_session: input.active_console_session,
            runtime_instance_digest: input.runtime_instance_digest,
            ipc_session_digest: input.ipc_session_digest,
            project_digest: input.project_digest,
            repository_digest: input.repository_digest,
            environment_digest: input.environment_digest,
            phase_digest: input.phase_digest,
            lifecycle_epoch: input.lifecycle_epoch,
            capture_generation: input.capture_generation,
            observed_at: input.observed_at,
        }
    }

    /// The observed focus state (crate-internal, evidence-only — never an authority gate).
    pub(crate) fn is_focused(&self) -> bool {
        self.is_focused
    }

    /// The UNTRUSTED, domain-separated observation digest (evidence only; NOT authority — it can never
    /// mint a binding or replace the verifier's re-checks). The raw handle enters the digest internally
    /// (so a different handle changes it) but is never output.
    #[must_use]
    pub fn observation_digest(&self) -> [u8; 32] {
        let mut h = Sha256::new();
        feed_var(&mut h, OBSERVATION_DOMAIN_TAG);
        feed_var(&mut h, self.label.as_bytes());
        feed_u64(&mut h, self.handle.raw() as u64);
        feed_u64(&mut h, u64::from(self.process_id));
        feed_u64(&mut h, u64::from(self.thread_id));
        feed_u64(&mut h, u64::from(self.session));
        h.update(self.runtime_instance_digest);
        h.update(self.ipc_session_digest);
        h.update(self.project_digest);
        h.update(self.repository_digest);
        h.update(self.environment_digest);
        h.update(self.phase_digest);
        feed_u64(&mut h, self.lifecycle_epoch);
        feed_u64(&mut h, self.capture_generation);
        feed_u64(&mut h, self.observed_at);
        finalize(h)
    }
}

impl core::fmt::Debug for UntrustedControlCentreWindowObservation {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(
            f,
            "UntrustedControlCentreWindowObservation(label={:?}, gen={}, [REDACTED])",
            self.label, self.capture_generation
        )
    }
}

/// The facts a trusted caller expects the observation to satisfy. The sealed verifier re-checks the
/// observation against these before minting; a forged observation that does not match every expectation
/// fails closed.
pub struct ExpectedWindowFacts<'a> {
    pub expected_label: &'a str,
    pub expected_process_id: u32,
    pub expected_session: u32,
    pub expected_runtime_instance_digest: [u8; 32],
    pub expected_ipc_session_digest: [u8; 32],
    pub current_lifecycle_epoch: u64,
    pub valid_until: u64,
}

mod sealed {
    /// Crate-private witness: no external crate can name it, so it cannot construct the sealed verifier.
    pub struct Private;
}

/// The sealed verifier that mints a [`TrustedControlCentreWindowBinding`] from an UNTRUSTED observation by
/// re-checking every fact. No public constructor, no `Default`/`Clone`/`Copy`, no serialisation derive,
/// redacted `Debug`,
/// `!Send + !Sync`. Production construction is deliberately unavailable in this phase: `new_internal` is
/// crate-private and the synthetic constructor is `#[cfg(test)]`-only, so no downstream crate and no
/// default-graph code can construct it — therefore no downstream code can mint a binding.
pub struct ControlCentreWindowVerifier {
    _seal: sealed::Private,
    _thread_bound: PhantomData<*const ()>,
}

impl core::fmt::Debug for ControlCentreWindowVerifier {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("ControlCentreWindowVerifier([REDACTED])")
    }
}

impl ControlCentreWindowVerifier {
    /// Crate-private construction. Reachable only inside this crate (e.g. the gated live FFI); there is no
    /// public or production constructor, so no downstream crate can obtain a verifier.
    #[allow(dead_code)]
    pub(crate) fn new_internal() -> Self {
        Self {
            _seal: sealed::Private,
            _thread_bound: PhantomData,
        }
    }

    /// TEST-ONLY synthetic verifier. `#[cfg(test)]`-only; not exposed through a Cargo feature and
    /// unreachable from any downstream crate or the default graph.
    #[cfg(test)]
    pub(crate) fn synthetic() -> Self {
        Self {
            _seal: sealed::Private,
            _thread_bound: PhantomData,
        }
    }

    /// Re-check the untrusted observation against the expected facts and mint an opaque binding. The FIRST
    /// failing check wins and NO binding is minted. This is the sole path (other than the FFI mint below)
    /// to a trusted binding, and it exists only because a verifier was constructed.
    pub(crate) fn verify(
        &self,
        obs: &UntrustedControlCentreWindowObservation,
        expected: &ExpectedWindowFacts<'_>,
        now: u64,
    ) -> Result<TrustedControlCentreWindowBinding, OwnerVerificationError> {
        if obs.label != expected.expected_label {
            return Err(OwnerVerificationError::LabelMismatch);
        }
        if obs.handle.is_null() {
            return Err(OwnerVerificationError::NullHandle);
        }
        if !obs.is_window {
            return Err(OwnerVerificationError::InvalidWindow);
        }
        if !obs.is_visible {
            return Err(OwnerVerificationError::WindowNotVisible);
        }
        if obs.is_minimized {
            return Err(OwnerVerificationError::WindowMinimized);
        }
        if !obs.eligible {
            return Err(OwnerVerificationError::WindowIneligible);
        }
        if obs.thread_id == 0 || obs.process_id == 0 {
            return Err(OwnerVerificationError::WindowThreadProcessUnavailable);
        }
        if expected.expected_process_id == 0 || obs.process_id != expected.expected_process_id {
            return Err(OwnerVerificationError::WindowProcessMismatch);
        }
        if obs.session != expected.expected_session {
            return Err(OwnerVerificationError::SessionMismatch);
        }
        if obs.client_protocol_type != WTS_PROTOCOL_CONSOLE {
            return Err(OwnerVerificationError::RemoteSession);
        }
        if obs.active_console_session != obs.session {
            return Err(OwnerVerificationError::NotActiveConsole);
        }
        if obs.runtime_instance_digest != expected.expected_runtime_instance_digest {
            return Err(OwnerVerificationError::RuntimeInstanceMismatch);
        }
        if obs.ipc_session_digest != expected.expected_ipc_session_digest {
            return Err(OwnerVerificationError::IpcSessionMismatch);
        }
        if obs.lifecycle_epoch != expected.current_lifecycle_epoch {
            return Err(OwnerVerificationError::LifecycleMismatch);
        }
        if expected.valid_until <= obs.observed_at || now > expected.valid_until {
            return Err(OwnerVerificationError::Expired);
        }
        let window = WindowObservation {
            is_window: true,
            is_visible: true,
            eligible: true,
            identifies_designated_cc: true,
            thread_id: obs.thread_id,
            process_id: obs.process_id,
        };
        let binding_digest = compute_binding_digest(obs, expected);
        Ok(TrustedControlCentreWindowBinding::from_observed(
            window,
            binding_digest,
        ))
    }

    /// FFI mint path: build a binding from an already-verified live [`WindowObservation`] and its digest.
    /// A METHOD, not a free mint: it can only be reached through an existing sealed verifier, and it is the
    /// verifier — never the caller — that touches the module-private `from_observed`. Crate-internal, so no
    /// downstream crate can name it; and since no downstream crate can obtain a verifier, none can reach it.
    #[allow(dead_code)]
    pub(crate) fn mint_from_window_observation(
        &self,
        window: WindowObservation,
        binding_digest: [u8; 32],
    ) -> TrustedControlCentreWindowBinding {
        TrustedControlCentreWindowBinding::from_observed(window, binding_digest)
    }
}

/// Compute the trusted window-binding digest over the RE-VERIFIED facts (domain-separated; distinct tag
/// from the observation digest). Raw handle enters internally; never output.
fn compute_binding_digest(
    obs: &UntrustedControlCentreWindowObservation,
    expected: &ExpectedWindowFacts<'_>,
) -> [u8; 32] {
    let mut h = Sha256::new();
    feed_var(&mut h, BINDING_DOMAIN_TAG);
    feed_var(&mut h, expected.expected_label.as_bytes());
    feed_u64(&mut h, obs.handle.raw() as u64);
    feed_u64(&mut h, u64::from(obs.process_id));
    feed_u64(&mut h, u64::from(obs.thread_id));
    feed_u64(&mut h, u64::from(obs.session));
    h.update(obs.runtime_instance_digest);
    h.update(obs.ipc_session_digest);
    h.update(obs.project_digest);
    h.update(obs.repository_digest);
    h.update(obs.environment_digest);
    h.update(obs.phase_digest);
    feed_u64(&mut h, obs.lifecycle_epoch);
    feed_u64(&mut h, obs.capture_generation);
    feed_u64(&mut h, obs.observed_at);
    feed_u64(&mut h, expected.valid_until);
    finalize(h)
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

#[inline]
fn finalize(h: Sha256) -> [u8; 32] {
    let out = h.finalize();
    let mut digest = [0u8; 32];
    digest.copy_from_slice(&out);
    digest
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good() -> WindowObservation {
        WindowObservation {
            is_window: true,
            is_visible: true,
            eligible: true,
            identifies_designated_cc: true,
            thread_id: 11,
            process_id: 4242,
        }
    }

    #[test]
    fn accepts_a_fully_valid_window_for_the_trusted_process() {
        assert!(window_permits(&good(), 4242).is_ok());
    }

    #[test]
    fn rejects_each_failing_window_condition() {
        let cases: &[(fn(&mut WindowObservation), OwnerVerificationError)] = &[
            (
                |o| o.is_window = false,
                OwnerVerificationError::InvalidWindow,
            ),
            (
                |o| o.is_visible = false,
                OwnerVerificationError::WindowNotVisible,
            ),
            (
                |o| o.eligible = false,
                OwnerVerificationError::WindowIneligible,
            ),
            (
                |o| o.identifies_designated_cc = false,
                OwnerVerificationError::WindowNotDesignated,
            ),
            (
                |o| o.thread_id = 0,
                OwnerVerificationError::WindowThreadProcessUnavailable,
            ),
            (
                |o| o.process_id = 0,
                OwnerVerificationError::WindowThreadProcessUnavailable,
            ),
        ];
        for (mutate, expected) in cases {
            let mut o = good();
            mutate(&mut o);
            assert_eq!(window_permits(&o, 4242).unwrap_err(), *expected);
        }
    }

    #[test]
    fn rejects_a_window_owned_by_another_process() {
        assert_eq!(
            window_permits(&good(), 9999).unwrap_err(),
            OwnerVerificationError::WindowProcessMismatch
        );
        // A zero trusted pid can never match.
        assert_eq!(
            window_permits(&good(), 0).unwrap_err(),
            OwnerVerificationError::WindowProcessMismatch
        );
    }

    #[test]
    fn binding_is_redacted_and_opaque() {
        let b = TrustedControlCentreWindowBinding::synthetic(good(), [9u8; 32]);
        assert!(format!("{b:?}").contains("[REDACTED]"));
        assert_eq!(b.binding_digest(), [9u8; 32]);
        assert_eq!(b.observation().process_id, 4242);
    }

    // ---- untrusted observation + sealed verifier ----

    fn good_obs() -> UntrustedControlCentreWindowObservation {
        UntrustedControlCentreWindowObservation::new(OwnerWindowObservationInput {
            label: DESIGNATED_WINDOW_LABEL.to_string(),
            handle: UntrustedOwnerWindowHandle::from_raw(0x1234),
            is_window: true,
            is_visible: true,
            is_minimized: false,
            is_focused: true,
            eligible: true,
            process_id: 4242,
            thread_id: 11,
            session: 1,
            client_protocol_type: WTS_PROTOCOL_CONSOLE,
            active_console_session: 1,
            runtime_instance_digest: [7u8; 32],
            ipc_session_digest: [8u8; 32],
            project_digest: [1u8; 32],
            repository_digest: [2u8; 32],
            environment_digest: [3u8; 32],
            phase_digest: [4u8; 32],
            lifecycle_epoch: 5,
            capture_generation: 9,
            observed_at: 1_000,
        })
    }

    fn good_expected<'a>() -> ExpectedWindowFacts<'a> {
        ExpectedWindowFacts {
            expected_label: DESIGNATED_WINDOW_LABEL,
            expected_process_id: 4242,
            expected_session: 1,
            expected_runtime_instance_digest: [7u8; 32],
            expected_ipc_session_digest: [8u8; 32],
            current_lifecycle_epoch: 5,
            valid_until: 21_000,
        }
    }

    #[test]
    fn verifier_mints_on_full_match_only() {
        let v = ControlCentreWindowVerifier::synthetic();
        let b = v
            .verify(&good_obs(), &good_expected(), 1_500)
            .expect("mint binding");
        assert!(format!("{b:?}").contains("[REDACTED]"));
        assert_eq!(b.observation().process_id, 4242);
    }

    #[test]
    fn verifier_rejects_each_failing_fact() {
        let v = ControlCentreWindowVerifier::synthetic();
        // (mutate observation, expected-override, now, expected error)
        type ObsMut = fn(&mut OwnerWindowObservationInput);
        let obs_cases: &[(ObsMut, OwnerVerificationError)] = &[
            (
                |i| i.label = "other".into(),
                OwnerVerificationError::LabelMismatch,
            ),
            (
                |i| i.handle = UntrustedOwnerWindowHandle::from_raw(0),
                OwnerVerificationError::NullHandle,
            ),
            (
                |i| i.is_window = false,
                OwnerVerificationError::InvalidWindow,
            ),
            (
                |i| i.is_visible = false,
                OwnerVerificationError::WindowNotVisible,
            ),
            (
                |i| i.is_minimized = true,
                OwnerVerificationError::WindowMinimized,
            ),
            (
                |i| i.eligible = false,
                OwnerVerificationError::WindowIneligible,
            ),
            (
                |i| i.thread_id = 0,
                OwnerVerificationError::WindowThreadProcessUnavailable,
            ),
            (
                |i| i.process_id = 5000,
                OwnerVerificationError::WindowProcessMismatch,
            ),
            (|i| i.session = 2, OwnerVerificationError::SessionMismatch),
            (
                |i| i.client_protocol_type = 2,
                OwnerVerificationError::RemoteSession,
            ),
            (
                |i| i.active_console_session = 9,
                OwnerVerificationError::NotActiveConsole,
            ),
            (
                |i| i.runtime_instance_digest = [0u8; 32],
                OwnerVerificationError::RuntimeInstanceMismatch,
            ),
            (
                |i| i.ipc_session_digest = [0u8; 32],
                OwnerVerificationError::IpcSessionMismatch,
            ),
            (
                |i| i.lifecycle_epoch = 99,
                OwnerVerificationError::LifecycleMismatch,
            ),
        ];
        for (mutate, expected) in obs_cases {
            let mut input = obs_input();
            mutate(&mut input);
            let obs = UntrustedControlCentreWindowObservation::new(input);
            assert_eq!(
                v.verify(&obs, &good_expected(), 1_500).unwrap_err(),
                *expected
            );
        }
        // Expiry: now past valid_until.
        assert_eq!(
            v.verify(&good_obs(), &good_expected(), 999_999)
                .unwrap_err(),
            OwnerVerificationError::Expired
        );
    }

    // The raw input used by the mutation table (kept separate so each case starts fresh).
    fn obs_input() -> OwnerWindowObservationInput {
        OwnerWindowObservationInput {
            label: DESIGNATED_WINDOW_LABEL.to_string(),
            handle: UntrustedOwnerWindowHandle::from_raw(0x1234),
            is_window: true,
            is_visible: true,
            is_minimized: false,
            is_focused: true,
            eligible: true,
            process_id: 4242,
            thread_id: 11,
            session: 1,
            client_protocol_type: WTS_PROTOCOL_CONSOLE,
            active_console_session: 1,
            runtime_instance_digest: [7u8; 32],
            ipc_session_digest: [8u8; 32],
            project_digest: [1u8; 32],
            repository_digest: [2u8; 32],
            environment_digest: [3u8; 32],
            phase_digest: [4u8; 32],
            lifecycle_epoch: 5,
            capture_generation: 9,
            observed_at: 1_000,
        }
    }

    /// The module-private mint has exactly two callers, both methods on the sealed verifier, so EVERY route
    /// to a binding needs a verifier instance first. This exercises the second one (the gated-FFI route)
    /// through a verifier, mirroring `verifier_mints_on_full_match_only` for the `verify` route. Privacy
    /// itself is compile-enforced (no `pub`/`pub(crate)` on `from_observed`) and asserted statically by
    /// val-cd-b4-control-centre-window-observation-bridge1a V23.
    #[test]
    fn the_ffi_mint_route_also_requires_a_verifier() {
        let v = ControlCentreWindowVerifier::synthetic();
        let b = v.mint_from_window_observation(good(), [5u8; 32]);
        assert_eq!(b.binding_digest(), [5u8; 32]);
        assert_eq!(b.observation().process_id, 4242);
        assert!(format!("{b:?}").contains("[REDACTED]"));
    }

    #[test]
    fn observation_is_untrusted_redacted_and_digest_is_evidence() {
        let obs = good_obs();
        assert!(obs.is_focused()); // evidence-only field, not an authority gate
        let dbg = format!("{obs:?}");
        assert!(dbg.contains("[REDACTED]"));
        assert!(dbg.contains(DESIGNATED_WINDOW_LABEL));
        assert!(!dbg.contains("1234")); // raw handle never rendered
                                        // Handle Debug is redacted too.
        assert!(
            format!("{:?}", UntrustedOwnerWindowHandle::from_raw(0x1234)).contains("[REDACTED]")
        );
        // Digest is deterministic and depends on the handle (load-bearing) but never outputs it.
        let d1 = obs.observation_digest();
        let mut i2 = obs_input();
        i2.handle = UntrustedOwnerWindowHandle::from_raw(0x9999);
        let d2 = UntrustedControlCentreWindowObservation::new(i2).observation_digest();
        assert_ne!(d1, d2);
        // Observation digest domain differs from the binding digest domain.
        assert_ne!(OBSERVATION_DOMAIN_TAG, BINDING_DOMAIN_TAG);
    }
}
