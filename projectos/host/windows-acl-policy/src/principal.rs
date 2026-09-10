//! Typed principals and owned, length-bounded SIDs.
//!
//! Authority is SID identity, never an account display name: name lookup is language-dependent,
//! spoofable through a renamed local account, and can involve domain traffic. Well-known principals
//! are built as the documented BINARY SID form (revision, sub-authority count, 6-byte big-endian
//! identifier authority, little-endian sub-authorities), which is deterministic, allocation-free and
//! testable on any platform — no Windows call, no Windows-owned buffer, no display name.
//!
//! Every SID value is redacted in `Debug` and `Display`. A complete SID is never rendered.

use std::fmt;

use crate::error::AclPolicyError;

/// `SECURITY_MAX_SID_SIZE`. Anything larger is treated as malformed rather than stored.
const MAX_SID_BYTES: usize = 68;
/// Revision 1 is the only SID revision Windows defines.
const SID_REVISION: u8 = 1;
/// `SID_MAX_SUB_AUTHORITIES`.
const MAX_SUB_AUTHORITIES: u8 = 15;
/// Fixed header: revision + sub-authority count + 6-byte identifier authority.
const SID_HEADER_BYTES: usize = 8;

/// An owned, validated, length-bounded binary SID.
///
/// Copied into owned memory the moment it is observed, so it never borrows a Windows-owned buffer and
/// can never outlive one. No raw pointer is stored and none is exposed.
#[derive(Clone, PartialEq, Eq)]
pub struct OwnedSid {
    bytes: Vec<u8>,
}

impl OwnedSid {
    /// Validate and copy a binary SID.
    ///
    /// # Errors
    /// [`AclPolicyError::InvalidSid`] if the revision, sub-authority count or length is not a valid,
    /// bounded SID.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, AclPolicyError> {
        if bytes.len() < SID_HEADER_BYTES || bytes.len() > MAX_SID_BYTES {
            return Err(AclPolicyError::InvalidSid);
        }
        if bytes[0] != SID_REVISION {
            return Err(AclPolicyError::InvalidSid);
        }
        let count = bytes[1];
        if count > MAX_SUB_AUTHORITIES {
            return Err(AclPolicyError::InvalidSid);
        }
        // The encoded length must match EXACTLY: a longer buffer would silently hide trailing bytes.
        if bytes.len() != SID_HEADER_BYTES + 4 * usize::from(count) {
            return Err(AclPolicyError::InvalidSid);
        }
        Ok(Self {
            bytes: bytes.to_vec(),
        })
    }

    /// Build a well-known SID from its identifier authority and sub-authorities.
    fn well_known(authority: u64, sub_authorities: &[u32]) -> Self {
        let mut bytes = Vec::with_capacity(SID_HEADER_BYTES + 4 * sub_authorities.len());
        bytes.push(SID_REVISION);
        #[allow(clippy::cast_possible_truncation)]
        bytes.push(sub_authorities.len() as u8);
        // Identifier authority is 6 bytes, BIG-endian (the one big-endian field in a SID).
        bytes.extend_from_slice(&authority.to_be_bytes()[2..]);
        for sub in sub_authorities {
            bytes.extend_from_slice(&sub.to_le_bytes());
        }
        Self { bytes }
    }

    /// The validated binary form, for equality comparison and for handing to Windows.
    pub(crate) fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// `S-1-1-0`.
    #[must_use]
    pub fn everyone() -> Self {
        Self::well_known(1, &[0])
    }
    /// `S-1-5-18`.
    #[must_use]
    pub fn local_system() -> Self {
        Self::well_known(5, &[18])
    }
    /// `S-1-5-11`.
    #[must_use]
    pub fn authenticated_users() -> Self {
        Self::well_known(5, &[11])
    }
    /// `S-1-5-7`.
    #[must_use]
    pub fn anonymous_logon() -> Self {
        Self::well_known(5, &[7])
    }
    /// `S-1-5-32-544`.
    #[must_use]
    pub fn builtin_administrators() -> Self {
        Self::well_known(5, &[32, 544])
    }
    /// `S-1-5-32-545`.
    #[must_use]
    pub fn builtin_users() -> Self {
        Self::well_known(5, &[32, 545])
    }
    /// `S-1-5-32-546`.
    #[must_use]
    pub fn builtin_guests() -> Self {
        Self::well_known(5, &[32, 546])
    }
    /// `S-1-3-4` — OWNER RIGHTS.
    #[must_use]
    pub fn owner_rights() -> Self {
        Self::well_known(3, &[4])
    }
}

impl fmt::Debug for OwnedSid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // REDACTED: never render the SID, its authority, or its length.
        f.write_str("OwnedSid(redacted)")
    }
}

/// A principal a policy may name.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum AclPrincipal {
    /// `S-1-5-18`.
    LocalSystem,
    /// `S-1-5-32-544`.
    BuiltinAdministrators,
    /// `S-1-5-32-545`.
    ///
    /// DELIBERATELY NAMEABLE, and deliberately BROAD. This crate classifies Builtin Users as a broad
    /// principal and refuses one by default, which is the right default for a custody root. It is
    /// nameable because one production object genuinely must be world-readable: the installed-project
    /// registry, which the Control Centre reads while running as an ordinary user. Naming it does not
    /// permit it — a policy still has to opt in through `allow_broad_principals_any_access`, and
    /// `allow_broad_principals_write` stays false, so the most this principal can ever be granted here
    /// is READ.
    BuiltinUsers,
    /// The account SID of the calling process. Intended for SYNTHETIC TEST FIXTURES; no production
    /// service principal is authorised in this phase.
    CurrentInteractiveUser,
    /// `S-1-3-4` — OWNER RIGHTS (RUN-TO-COMPLETION HOST ATTESTATION §10I).
    ///
    /// NOT A PERSON AND NOT A GROUP ANYONE JOINS. Windows substitutes it for whoever owns the object
    /// at access time, and an ACE naming it REPLACES the owner's implicit `READ_CONTROL | WRITE_DAC`
    /// with exactly the rights that ACE grants. Naming it with a read-only class is how a policy
    /// whose owner must be an ordinary principal (one that cannot assign SYSTEM without a privilege)
    /// still keeps `WRITE_DAC` out of that owner's hands: the DACL becomes the complete statement of
    /// what the owner may do.
    OwnerRights,
    /// A validated, explicitly supplied SID. Never read from an environment variable or a repository
    /// file, and never treated as a credential.
    ExplicitSid(OwnedSid),
}

impl AclPrincipal {
    /// Resolve to the binary SID this principal denotes.
    ///
    /// # Errors
    /// [`AclPolicyError::UnsupportedPlatform`] off Windows for
    /// [`AclPrincipal::CurrentInteractiveUser`]; [`AclPolicyError::InvalidSid`] or
    /// [`AclPolicyError::WindowsApiFailure`] if the current account SID cannot be resolved.
    pub fn resolve(&self) -> Result<OwnedSid, AclPolicyError> {
        match self {
            Self::LocalSystem => Ok(OwnedSid::local_system()),
            Self::BuiltinAdministrators => Ok(OwnedSid::builtin_administrators()),
            Self::BuiltinUsers => Ok(OwnedSid::builtin_users()),
            Self::CurrentInteractiveUser => crate::windows::current_account_sid(),
            Self::OwnerRights => Ok(OwnedSid::owner_rights()),
            Self::ExplicitSid(sid) => Ok(sid.clone()),
        }
    }

    /// A safe semantic label. Never an account name, never a SID.
    #[must_use]
    pub fn label(&self) -> &'static str {
        match self {
            Self::LocalSystem => "LocalSystem",
            Self::BuiltinAdministrators => "BuiltinAdministrators",
            Self::BuiltinUsers => "BuiltinUsers",
            Self::CurrentInteractiveUser => "CurrentInteractiveUser",
            Self::OwnerRights => "OwnerRights",
            Self::ExplicitSid(_) => "ExplicitSid(redacted)",
        }
    }
}

impl fmt::Display for AclPrincipal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

/// A principal so broad that granting it authority over a trusted root is a defect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum BroadPrincipal {
    /// `S-1-1-0`.
    Everyone,
    /// `S-1-5-11`.
    AuthenticatedUsers,
    /// `S-1-5-32-545`.
    BuiltinUsers,
    /// `S-1-5-32-546`.
    Guests,
    /// `S-1-5-7`.
    AnonymousLogon,
}

impl BroadPrincipal {
    /// Classify a SID as broad, by SID identity only.
    #[must_use]
    pub fn classify(sid: &OwnedSid) -> Option<Self> {
        let b = sid.as_bytes();
        if b == OwnedSid::everyone().as_bytes() {
            Some(Self::Everyone)
        } else if b == OwnedSid::authenticated_users().as_bytes() {
            Some(Self::AuthenticatedUsers)
        } else if b == OwnedSid::builtin_users().as_bytes() {
            Some(Self::BuiltinUsers)
        } else if b == OwnedSid::builtin_guests().as_bytes() {
            Some(Self::Guests)
        } else if b == OwnedSid::anonymous_logon().as_bytes() {
            Some(Self::AnonymousLogon)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn well_known_sids_have_the_documented_binary_form() {
        // S-1-1-0: revision 1, one sub-authority, authority 1, sub-authority 0.
        assert_eq!(
            OwnedSid::everyone().as_bytes(),
            &[1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]
        );
        // S-1-5-18.
        assert_eq!(
            OwnedSid::local_system().as_bytes(),
            &[1, 1, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0]
        );
        // S-1-5-32-544.
        assert_eq!(
            OwnedSid::builtin_administrators().as_bytes(),
            &[1, 2, 0, 0, 0, 0, 0, 5, 32, 0, 0, 0, 32, 2, 0, 0]
        );
    }

    #[test]
    fn every_well_known_sid_round_trips_through_validation() {
        for sid in [
            OwnedSid::everyone(),
            OwnedSid::local_system(),
            OwnedSid::authenticated_users(),
            OwnedSid::anonymous_logon(),
            OwnedSid::builtin_administrators(),
            OwnedSid::builtin_users(),
            OwnedSid::builtin_guests(),
            OwnedSid::owner_rights(),
        ] {
            let parsed =
                OwnedSid::from_bytes(sid.as_bytes()).expect("well-known SID must validate");
            assert_eq!(parsed, sid);
        }
    }

    #[test]
    fn malformed_sids_are_refused() {
        // Too short.
        assert_eq!(
            OwnedSid::from_bytes(&[1, 0, 0]).unwrap_err(),
            AclPolicyError::InvalidSid
        );
        // Wrong revision.
        assert_eq!(
            OwnedSid::from_bytes(&[2, 1, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0]).unwrap_err(),
            AclPolicyError::InvalidSid
        );
        // Declared sub-authority count does not match the length.
        assert_eq!(
            OwnedSid::from_bytes(&[1, 2, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0]).unwrap_err(),
            AclPolicyError::InvalidSid
        );
        // Trailing bytes beyond the encoded length.
        assert_eq!(
            OwnedSid::from_bytes(&[1, 1, 0, 0, 0, 0, 0, 5, 18, 0, 0, 0, 9]).unwrap_err(),
            AclPolicyError::InvalidSid
        );
        // Over SECURITY_MAX_SID_SIZE.
        assert_eq!(
            OwnedSid::from_bytes(&[1; MAX_SID_BYTES + 1]).unwrap_err(),
            AclPolicyError::InvalidSid
        );
        // Sub-authority count beyond SID_MAX_SUB_AUTHORITIES.
        let mut over = vec![1u8, MAX_SUB_AUTHORITIES + 1, 0, 0, 0, 0, 0, 5];
        over.extend(std::iter::repeat_n(
            0,
            4 * usize::from(MAX_SUB_AUTHORITIES + 1),
        ));
        assert_eq!(
            OwnedSid::from_bytes(&over).unwrap_err(),
            AclPolicyError::InvalidSid
        );
    }

    #[test]
    fn broad_principals_are_classified_and_narrow_ones_are_not() {
        assert_eq!(
            BroadPrincipal::classify(&OwnedSid::everyone()),
            Some(BroadPrincipal::Everyone)
        );
        assert_eq!(
            BroadPrincipal::classify(&OwnedSid::authenticated_users()),
            Some(BroadPrincipal::AuthenticatedUsers)
        );
        assert_eq!(
            BroadPrincipal::classify(&OwnedSid::builtin_users()),
            Some(BroadPrincipal::BuiltinUsers)
        );
        assert_eq!(
            BroadPrincipal::classify(&OwnedSid::builtin_guests()),
            Some(BroadPrincipal::Guests)
        );
        assert_eq!(
            BroadPrincipal::classify(&OwnedSid::anonymous_logon()),
            Some(BroadPrincipal::AnonymousLogon)
        );
        assert_eq!(BroadPrincipal::classify(&OwnedSid::local_system()), None);
        assert_eq!(
            BroadPrincipal::classify(&OwnedSid::builtin_administrators()),
            None
        );
        // OWNER RIGHTS names whoever owns the object, never a population of accounts.
        assert_eq!(BroadPrincipal::classify(&OwnedSid::owner_rights()), None);
    }

    #[test]
    fn owner_rights_has_the_documented_binary_form_and_resolves_without_windows() {
        // S-1-3-4: revision 1, one sub-authority, authority 3 (CREATOR), sub-authority 4.
        assert_eq!(
            OwnedSid::owner_rights().as_bytes(),
            &[1, 1, 0, 0, 0, 0, 0, 3, 4, 0, 0, 0]
        );
        assert_eq!(
            AclPrincipal::OwnerRights.resolve().unwrap(),
            OwnedSid::owner_rights()
        );
        assert_eq!(AclPrincipal::OwnerRights.label(), "OwnerRights");
    }

    #[test]
    fn sid_and_principal_rendering_is_redacted() {
        let sid = OwnedSid::local_system();
        assert_eq!(format!("{sid:?}"), "OwnedSid(redacted)");
        let p = AclPrincipal::ExplicitSid(sid);
        assert_eq!(p.to_string(), "ExplicitSid(redacted)");
        assert!(!format!("{p:?}").contains("18"));
    }
}
