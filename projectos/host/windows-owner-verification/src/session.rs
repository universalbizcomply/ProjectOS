//! Session policy: local console only, and the owner-identity stability recheck tuple.
//!
//! The policy layer is PURE: it decides over already-observed values ([`SessionObservation`]) and never
//! calls a Windows API. The gated [`crate::verification_ffi`] module is the only place that populates a
//! [`SessionObservation`] from live `ProcessIdToSessionId` / `WTSQuerySessionInformationW`
//! (`WTSClientProtocolType`) / `WTSGetActiveConsoleSessionId` calls.
//!
//! Active-console status is a LOCALITY condition, never owner identity. Owner identity is established
//! separately through the process-token SID (see [`crate::sid`]).

use crate::OwnerVerificationError;

/// `WTSClientProtocolType == 0` means a local console session (not ICA/RDP). Any other value is remote.
pub(crate) const WTS_PROTOCOL_CONSOLE: u32 = 0;

/// A typed, already-observed view of the window process's session and the local-console policy inputs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SessionObservation {
    /// Every session query (`ProcessIdToSessionId` + WTS lookups) succeeded.
    pub session_query_ok: bool,
    /// Session id of the window's owning process.
    pub window_session: u32,
    /// Session id of the trusted host process (`ProcessIdToSessionId(current)`).
    pub host_session: u32,
    /// `WTSClientProtocolType` for the window session (`0` = local console).
    pub client_protocol_type: u32,
    /// `WTSGetActiveConsoleSessionId()`.
    pub active_console_session: u32,
}

/// Decide the session policy fail-closed; the FIRST failing condition wins.
pub(crate) fn session_permits(obs: &SessionObservation) -> Result<(), OwnerVerificationError> {
    if !obs.session_query_ok {
        return Err(OwnerVerificationError::SessionQueryFailed);
    }
    if obs.window_session != obs.host_session {
        return Err(OwnerVerificationError::SessionMismatch);
    }
    if obs.client_protocol_type != WTS_PROTOCOL_CONSOLE {
        return Err(OwnerVerificationError::RemoteSession);
    }
    if obs.active_console_session != obs.window_session {
        return Err(OwnerVerificationError::NotActiveConsole);
    }
    Ok(())
}

/// The (process, thread, session) identity tuple captured before AND after the verification ceremony. Any
/// difference means the surface changed underneath us (process/thread reuse, fast user switch, session
/// move) and fails closed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct IdentityTuple {
    pub process_id: u32,
    pub thread_id: u32,
    pub session: u32,
}

/// Require the post-ceremony tuple to equal the pre-ceremony tuple. The FIRST differing field wins.
pub(crate) fn recheck_matches(
    before: &IdentityTuple,
    after: &IdentityTuple,
) -> Result<(), OwnerVerificationError> {
    if before.process_id != after.process_id {
        return Err(OwnerVerificationError::ProcessChanged);
    }
    if before.thread_id != after.thread_id {
        return Err(OwnerVerificationError::ThreadChanged);
    }
    if before.session != after.session {
        return Err(OwnerVerificationError::SessionChanged);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good() -> SessionObservation {
        SessionObservation {
            session_query_ok: true,
            window_session: 1,
            host_session: 1,
            client_protocol_type: WTS_PROTOCOL_CONSOLE,
            active_console_session: 1,
        }
    }

    #[test]
    fn accepts_a_local_console_session_owned_by_the_host() {
        assert!(session_permits(&good()).is_ok());
    }

    #[test]
    fn rejects_each_failing_session_condition() {
        let cases: &[(fn(&mut SessionObservation), OwnerVerificationError)] = &[
            (
                |o| o.session_query_ok = false,
                OwnerVerificationError::SessionQueryFailed,
            ),
            (
                |o| o.window_session = 2,
                OwnerVerificationError::SessionMismatch,
            ),
            (
                |o| o.client_protocol_type = 2,
                OwnerVerificationError::RemoteSession,
            ),
            (
                |o| o.active_console_session = 7,
                OwnerVerificationError::NotActiveConsole,
            ),
        ];
        for (mutate, expected) in cases {
            let mut o = good();
            mutate(&mut o);
            assert_eq!(session_permits(&o).unwrap_err(), *expected);
        }
    }

    #[test]
    fn recheck_detects_each_identity_change() {
        let before = IdentityTuple {
            process_id: 4242,
            thread_id: 11,
            session: 1,
        };
        assert!(recheck_matches(&before, &before).is_ok());
        for (mutate, expected) in [
            (
                (|t: &mut IdentityTuple| t.process_id = 5) as fn(&mut IdentityTuple),
                OwnerVerificationError::ProcessChanged,
            ),
            (
                |t: &mut IdentityTuple| t.thread_id = 5,
                OwnerVerificationError::ThreadChanged,
            ),
            (
                |t: &mut IdentityTuple| t.session = 5,
                OwnerVerificationError::SessionChanged,
            ),
        ] {
            let mut after = before;
            mutate(&mut after);
            assert_eq!(recheck_matches(&before, &after).unwrap_err(), expected);
        }
    }
}
