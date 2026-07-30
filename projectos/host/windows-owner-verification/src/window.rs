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
//! `#[cfg(test)]` synthetic one and a crate-internal one used solely by the gated live FFI.

use crate::OwnerVerificationError;

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
    /// Crate-internal constructor used ONLY by the gated live FFI once it has established the binding from
    /// a real window. It is not `pub` (invisible downstream) and it is not the future cross-crate sealed
    /// window-bridge seam (deliberately not built this phase). Dead in the pure default graph.
    #[allow(dead_code)]
    pub(crate) fn from_observed(observation: WindowObservation, binding_digest: [u8; 32]) -> Self {
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
}
