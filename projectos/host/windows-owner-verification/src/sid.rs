//! Owner-SID policy.
//!
//! The policy layer is PURE: it decides over already-observed booleans ([`OwnerSidObservation`]) and never
//! calls a Windows API, holds a raw SID, or renders one. The gated [`crate::verification_ffi`] module is
//! the only place that populates a [`OwnerSidObservation`] from live
//! `OpenProcessToken` / `GetTokenInformation(TokenUser)` / `IsValidSid` / `EqualSid` calls, comparing the
//! window process's token SID against the configured owner SID entirely inside that module.

use crate::OwnerVerificationError;

/// A typed, already-decided view of the window process's owner-SID checks. Deliberately booleans only: no
/// raw SID bytes cross into the policy layer or the evidence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct OwnerSidObservation {
    /// `OpenProcessToken` + `GetTokenInformation(TokenUser)` succeeded.
    pub token_query_ok: bool,
    /// `IsValidSid` on the token SID.
    pub sid_valid: bool,
    /// `EqualSid(token_sid, configured_owner_sid)`.
    pub equals_configured_owner: bool,
}

/// Decide the owner-SID policy fail-closed; the FIRST failing condition wins.
pub(crate) fn sid_permits(obs: &OwnerSidObservation) -> Result<(), OwnerVerificationError> {
    if !obs.token_query_ok {
        return Err(OwnerVerificationError::TokenQueryFailed);
    }
    if !obs.sid_valid {
        return Err(OwnerVerificationError::InvalidSid);
    }
    if !obs.equals_configured_owner {
        return Err(OwnerVerificationError::OwnerSidMismatch);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good() -> OwnerSidObservation {
        OwnerSidObservation {
            token_query_ok: true,
            sid_valid: true,
            equals_configured_owner: true,
        }
    }

    #[test]
    fn accepts_a_valid_matching_owner_sid() {
        assert!(sid_permits(&good()).is_ok());
    }

    #[test]
    fn rejects_each_failing_sid_condition() {
        let cases: &[(fn(&mut OwnerSidObservation), OwnerVerificationError)] = &[
            (
                |o| o.token_query_ok = false,
                OwnerVerificationError::TokenQueryFailed,
            ),
            (|o| o.sid_valid = false, OwnerVerificationError::InvalidSid),
            (
                |o| o.equals_configured_owner = false,
                OwnerVerificationError::OwnerSidMismatch,
            ),
        ];
        for (mutate, expected) in cases {
            let mut o = good();
            mutate(&mut o);
            assert_eq!(sid_permits(&o).unwrap_err(), *expected);
        }
    }
}
