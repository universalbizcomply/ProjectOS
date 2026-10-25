//! PRODUCTION HOST-AUTHORITY ACQUISITION (local-console interactive host).
//!
//! The decision is a PURE policy over already-observed facts, so it is exercised in full without any
//! Windows call and without ever creating a machine-wide token. The live observer that populates those
//! facts is compiled only under `windows-host-authority-acquisition` and has NO caller in this phase —
//! compiling it is not authority to run it.
//!
//! Ordering matters and is deliberate: the cheap, non-privileged context checks (interactive, local
//! console, session, identity) all run BEFORE anything looks at the token outcome, so a wrong-context
//! process never reaches the point of contending for the machine-wide authority.
//!
//! A CLIENT CONNECTION IS NEVER AUTHORITY. `AuthorityPeerState::permits_startup()` returns true for
//! `ClientConnectionConfirmed`, so this module never consults it; it derives the state through the frozen
//! [`AuthorityPeerState::corroborate`] rule and then accepts only the two genuinely authoritative states,
//! exactly as [`ConfirmedAuthorityGuard::confirm`] does.
//!
//! Nothing here creates a provider capability, an owner-presence grant or any protected effect, and
//! service installation / VirtualServiceAccount activation are out of scope.

#[cfg(all(
    any(test, feature = "effect-witness-fixtures"),
    not(all(windows, feature = "test-fixtures"))
))]
use crate::model::ConfirmedAuthorityGuard;
use crate::model::{AuthorityPeerState, AuthorityTokenOutcome, ConfirmedPeer};

/// `WTSClientProtocolType` value meaning "local console" — any other value is a remote session.
pub const LOCAL_CONSOLE_PROTOCOL: u32 = 0;

/// Why production host-authority acquisition was refused.
///
/// A dedicated, fail-closed reason set: the frozen [`crate::model::AuthorityRefusal`] is left untouched
/// rather than widened, and every variant names a context condition, never an object, SID, path or
/// account.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum HostAuthorityAcquisitionRefusal {
    /// The host is not running in an interactive context.
    NotInteractive,
    /// The session is remote (`WTSClientProtocolType != 0`).
    RemoteSession,
    /// The host process is not in the active console session.
    WrongSession,
    /// The running identity does not match the expected canonical host identity.
    IdentityMismatch,
    /// A machine-wide authority already exists and this process is not it.
    AuthorityAlreadyHeld,
    /// The token outcome could not be corroborated into an authoritative peer state.
    CorroborationIncomplete,
    /// Corroboration produced a client connection, which is never authority.
    ClientIsNotAuthority,
    /// PROJECTOS-HOST-REVIEW-PATH1B (ROUTE A): the machine-wide authority SECURITY descriptor could
    /// not be built, because the ProjectOSHost service principal did not resolve.
    ///
    /// Fail closed rather than falling back: an authority object secured by anything other than the
    /// accepted machine-wide descriptor is not the accepted object, and creating it would publish a
    /// differently-secured object under the production name. It names no SID, account or descriptor.
    AuthoritySecurityUnavailable,
}

/// The already-observed facts the policy decides over.
///
/// CRATE-PRIVATE: no downstream crate can name or build one, so nobody outside the trusted host boundary
/// can hand the policy a fabricated context. The live observer fills it from Win32; the fixture entry
/// point below fills it from bounded test parameters.
#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
pub(crate) struct HostAuthorityObservation {
    /// The host runs in an interactive (station-attached) context.
    pub interactive: bool,
    /// `WTSClientProtocolType` for the host session.
    pub client_protocol_type: u32,
    /// `ProcessIdToSessionId(current)`.
    pub process_session: u32,
    /// `WTSGetActiveConsoleSessionId()`.
    pub active_console_session: u32,
    /// The running identity matches the expected canonical host identity.
    pub identity_matches: bool,
    /// The raw create-or-open outcome for the machine-wide authority name.
    pub token_outcome: AuthorityTokenOutcome,
    /// Corroborating peer evidence, where any exists.
    pub confirmed_peer: Option<ConfirmedPeer>,
}

/// Decide local-console interactive host authority, fail-closed. The FIRST failing condition wins, so the
/// refusal names the exact reason.
///
/// Returns the corroborated, genuinely authoritative peer state on success.
#[allow(dead_code)]
pub(crate) fn local_console_authority_permits(
    obs: &HostAuthorityObservation,
) -> Result<AuthorityPeerState, HostAuthorityAcquisitionRefusal> {
    // Context first: a wrong-context process must never reach token contention.
    if !obs.interactive {
        return Err(HostAuthorityAcquisitionRefusal::NotInteractive);
    }
    if obs.client_protocol_type != LOCAL_CONSOLE_PROTOCOL {
        return Err(HostAuthorityAcquisitionRefusal::RemoteSession);
    }
    if obs.process_session != obs.active_console_session {
        return Err(HostAuthorityAcquisitionRefusal::WrongSession);
    }
    if !obs.identity_matches {
        return Err(HostAuthorityAcquisitionRefusal::IdentityMismatch);
    }

    // An EXISTING token means someone else already holds the machine-wide authority. This process is a
    // second authority attempt and must fail closed regardless of any corroboration offered.
    if obs.token_outcome == AuthorityTokenOutcome::ExistingToken {
        return Err(HostAuthorityAcquisitionRefusal::AuthorityAlreadyHeld);
    }

    // Derive the state through the FROZEN corroboration rule — never a caller-supplied state, and never
    // `permits_startup()`, which would admit a client connection.
    let state = AuthorityPeerState::corroborate(obs.token_outcome, obs.confirmed_peer);
    match state {
        AuthorityPeerState::InteractiveFallbackConfirmed
        | AuthorityPeerState::ServiceRuntimeConfirmed => Ok(state),
        AuthorityPeerState::ClientConnectionConfirmed => {
            Err(HostAuthorityAcquisitionRefusal::ClientIsNotAuthority)
        }
        _ => Err(HostAuthorityAcquisitionRefusal::CorroborationIncomplete),
    }
}

/// FIXTURE-ONLY acquisition proof. Runs the REAL policy above over caller-described context, then mints
/// the confirmation through the same fixture route the rest of the trust engine uses.
///
/// Gated on `effect-witness-fixtures` — the crate's pure contract-fixture feature: no dependency, no
/// Windows API, and NO machine-wide token is created. A default/release graph enables neither this nor
/// the live observer, so it has no acquisition route at all.
///
/// # Errors
/// [`HostAuthorityAcquisitionRefusal`] naming the first failed condition.
#[cfg(all(
    any(test, feature = "effect-witness-fixtures"),
    not(all(windows, feature = "test-fixtures"))
))]
#[allow(clippy::too_many_arguments)]
pub fn acquire_local_console_authority_for_local_proof(
    interactive: bool,
    client_protocol_type: u32,
    process_session: u32,
    active_console_session: u32,
    identity_matches: bool,
    token_outcome: AuthorityTokenOutcome,
    confirmed_peer: Option<ConfirmedPeer>,
) -> Result<ConfirmedAuthorityGuard, HostAuthorityAcquisitionRefusal> {
    let obs = HostAuthorityObservation {
        interactive,
        client_protocol_type,
        process_session,
        active_console_session,
        identity_matches,
        token_outcome,
        confirmed_peer,
    };
    let state = local_console_authority_permits(&obs)?;
    ConfirmedAuthorityGuard::for_local_proof(state)
        .ok_or(HostAuthorityAcquisitionRefusal::CorroborationIncomplete)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good() -> HostAuthorityObservation {
        HostAuthorityObservation {
            interactive: true,
            client_protocol_type: LOCAL_CONSOLE_PROTOCOL,
            process_session: 1,
            active_console_session: 1,
            identity_matches: true,
            token_outcome: AuthorityTokenOutcome::AcquiredToken,
            confirmed_peer: Some(ConfirmedPeer::InteractiveFallback),
        }
    }

    #[test]
    fn a_fresh_local_console_interactive_acquirer_is_confirmed() {
        let guard = acquire_local_console_authority_for_local_proof(
            true,
            LOCAL_CONSOLE_PROTOCOL,
            1,
            1,
            true,
            AuthorityTokenOutcome::AcquiredToken,
            Some(ConfirmedPeer::InteractiveFallback),
        )
        .expect("a fresh local-console interactive acquirer is confirmed");
        assert_eq!(
            guard.peer_state(),
            AuthorityPeerState::InteractiveFallbackConfirmed
        );
        assert_eq!(format!("{guard:?}"), "ConfirmedAuthorityGuard([REDACTED])");
    }

    #[test]
    fn a_fresh_service_runtime_acquirer_is_confirmed() {
        let guard = acquire_local_console_authority_for_local_proof(
            true,
            LOCAL_CONSOLE_PROTOCOL,
            1,
            1,
            true,
            AuthorityTokenOutcome::AcquiredToken,
            Some(ConfirmedPeer::ServiceRuntime),
        )
        .expect("a fresh service-runtime acquirer is confirmed");
        assert_eq!(
            guard.peer_state(),
            AuthorityPeerState::ServiceRuntimeConfirmed
        );
    }

    #[test]
    fn a_client_connection_is_never_authority() {
        // A fresh create corroborated as a client connection: refused, even though `permits_startup()`
        // would return true for that state.
        // A FRESH create corroborated as a client connection reaches the corroboration arm and is
        // refused there: a client connects to an authority and is never one.
        let mut o = good();
        o.confirmed_peer = Some(ConfirmedPeer::ClientConnection);
        assert_eq!(
            local_console_authority_permits(&o).unwrap_err(),
            HostAuthorityAcquisitionRefusal::CorroborationIncomplete
        );
        // `permits_startup()` would have admitted it — which is exactly why it is never consulted.
        assert!(AuthorityPeerState::ClientConnectionConfirmed.permits_startup());
        assert_eq!(
            acquire_local_console_authority_for_local_proof(
                true,
                LOCAL_CONSOLE_PROTOCOL,
                1,
                1,
                true,
                AuthorityTokenOutcome::ExistingToken,
                Some(ConfirmedPeer::ClientConnection),
            )
            .unwrap_err(),
            HostAuthorityAcquisitionRefusal::AuthorityAlreadyHeld
        );
    }

    #[test]
    fn a_second_authority_is_refused() {
        let mut o = good();
        o.token_outcome = AuthorityTokenOutcome::ExistingToken;
        o.confirmed_peer = Some(ConfirmedPeer::InteractiveFallback);
        assert_eq!(
            local_console_authority_permits(&o).unwrap_err(),
            HostAuthorityAcquisitionRefusal::AuthorityAlreadyHeld
        );
    }

    #[test]
    fn each_failing_context_condition_refuses_in_order() {
        type Case = (
            fn(&mut HostAuthorityObservation),
            HostAuthorityAcquisitionRefusal,
        );
        let cases: &[Case] = &[
            (
                |o| o.interactive = false,
                HostAuthorityAcquisitionRefusal::NotInteractive,
            ),
            (
                |o| o.client_protocol_type = 2,
                HostAuthorityAcquisitionRefusal::RemoteSession,
            ),
            (
                |o| o.process_session = 2,
                HostAuthorityAcquisitionRefusal::WrongSession,
            ),
            (
                |o| o.identity_matches = false,
                HostAuthorityAcquisitionRefusal::IdentityMismatch,
            ),
            (
                |o| o.confirmed_peer = None,
                HostAuthorityAcquisitionRefusal::CorroborationIncomplete,
            ),
        ];
        for (mutate, expected) in cases {
            let mut o = good();
            mutate(&mut o);
            assert_eq!(local_console_authority_permits(&o).unwrap_err(), *expected);
        }
    }

    #[test]
    fn a_refused_kernel_outcome_never_confirms() {
        let mut o = good();
        o.token_outcome = AuthorityTokenOutcome::Refused;
        assert_eq!(
            local_console_authority_permits(&o).unwrap_err(),
            HostAuthorityAcquisitionRefusal::CorroborationIncomplete
        );
    }
}
