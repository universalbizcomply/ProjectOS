//! The OWNED inspection model, and the pure ACL parser/builder it is produced by.
//!
//! Windows-owned security-descriptor memory is converted into these owned value objects IMMEDIATELY,
//! inside the single unsafe module, before the Windows buffer is released. Nothing here borrows a
//! Windows allocation, holds a pointer, or outlives a descriptor: parsing operates on a copied byte
//! slice and is therefore a pure function that can be exercised on any platform, including for ACE
//! shapes that cannot safely be created on the host.
//!
//! The ACL binary layout used here is the documented, stable Win32 ABI:
//! `ACL` = revision `u8`, Sbz1 `u8`, size `u16`, ACE count `u16`, Sbz2 `u16`;
//! `ACE_HEADER` = type `u8`, flags `u8`, size `u16`; and for the two non-object, non-callback access
//! ACEs the body is an access mask `u32` followed by the trustee SID.

use crate::error::AclPolicyError;
use crate::principal::OwnedSid;

/// Size of the `ACL` header.
const ACL_HEADER_BYTES: usize = 8;
/// Size of an `ACE_HEADER`.
const ACE_HEADER_BYTES: usize = 4;
/// Offset of the trustee SID within a non-object, non-callback access ACE.
const ACE_SID_OFFSET: usize = 8;

const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
const ACCESS_DENIED_ACE_TYPE: u8 = 1;
/// `INHERITED_ACE`.
const INHERITED_ACE: u8 = 0x10;
/// `ACL_REVISION`.
pub(crate) const ACL_REVISION: u8 = 2;
/// `ACL_REVISION_DS`.
const ACL_REVISION_DS: u8 = 4;

// Security-descriptor control bits.
pub(crate) const SE_DACL_PRESENT: u16 = 0x0004;
pub(crate) const SE_DACL_AUTO_INHERITED: u16 = 0x0400;
pub(crate) const SE_DACL_PROTECTED: u16 = 0x1000;

/// CRATE-LOCAL carrier for the DACL Windows reported, including the copied ACL byte image.
///
/// Deliberately NOT public: raw ACL material exists only long enough to be parsed into semantic
/// evidence. A dependent crate can neither name this type nor obtain the bytes it carries. The public
/// projection is [`DaclState`].
#[derive(Clone, PartialEq, Eq)]
pub(crate) enum RawDacl {
    /// `SE_DACL_PRESENT` clear.
    Absent,
    /// `SE_DACL_PRESENT` set with a null ACL pointer.
    Null,
    /// A copied ACL byte image.
    Acl(Vec<u8>),
}

impl RawDacl {
    /// Project to the public semantic state, discarding the bytes.
    pub(crate) fn state(&self) -> DaclState {
        match self {
            Self::Absent => DaclState::Absent,
            Self::Null => DaclState::Null,
            Self::Acl(_) => DaclState::Present,
        }
    }
}

impl core::fmt::Debug for RawDacl {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // REDACTED: the DACL STATE is evidence; the ACL bytes are not rendered.
        core::fmt::Debug::fmt(&self.state(), f)
    }
}

/// The PUBLIC, semantic DACL state, with absent, null and present kept DISTINCT.
///
/// An ABSENT DACL means the descriptor carries none. A NULL DACL means one is present but grants
/// everyone full access. A PRESENT DACL carries ACEs (possibly zero). They are different states and
/// are never collapsed into one. No ACL byte image is reachable from this type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum DaclState {
    /// `SE_DACL_PRESENT` clear — the descriptor carries no DACL.
    Absent,
    /// `SE_DACL_PRESENT` set with a null ACL — everyone has full access.
    Null,
    /// A real DACL is present; its ACEs are exposed as [`AceRecord`]s.
    Present,
}

/// What kind of ACE this is, as far as this verifier is prepared to interpret.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AceKind {
    /// A plain `ACCESS_ALLOWED_ACE`.
    Allow,
    /// A plain `ACCESS_DENIED_ACE`.
    Deny,
    /// Any other ACE: object, callback, conditional, audit, alarm, mandatory-label, or unknown. The
    /// body layout differs, so NO mask and NO SID is interpreted from it, and it fails closed.
    Unsupported,
}

/// One owned ACE record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AceRecord {
    /// Interpreted kind.
    pub kind: AceKind,
    /// Whether Windows marked the ACE as inherited.
    pub inherited: bool,
    /// The RAW access mask, or `None` for an unsupported ACE.
    pub raw_mask: Option<u32>,
    /// The trustee SID, or `None` for an unsupported ACE or one whose SID did not validate.
    pub sid: Option<OwnedSid>,
}

/// The complete owned observation of one object's owner and DACL.
///
/// Semantic evidence only: the ACL byte image the observation was parsed from is discarded here and
/// is not reachable through any field, accessor, conversion or serialisation route.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AclInspection {
    /// The owner SID, if the descriptor carried one. Opaque and redacted.
    pub owner: Option<OwnedSid>,
    /// Absent / null / present — never collapsed.
    pub dacl: DaclState,
    /// `SE_DACL_PROTECTED`.
    pub dacl_protected: bool,
    /// `SE_DACL_AUTO_INHERITED`.
    pub dacl_auto_inherited: bool,
    /// The parsed ACEs, in DACL order. Empty when the DACL is absent, null or has no ACEs.
    pub aces: Vec<AceRecord>,
}

impl AclInspection {
    /// Build the owned model from copied owner bytes, control bits and DACL state.
    ///
    /// CRATE-LOCAL: it takes raw Windows material, so it is not part of the public contract.
    ///
    /// # Errors
    /// [`AclPolicyError::MalformedDescriptor`] if the ACL header or any ACE is truncated,
    /// mis-sized, or inconsistent with the declared ACE count.
    pub(crate) fn from_raw(
        owner_bytes: Option<&[u8]>,
        control: u16,
        dacl: RawDacl,
    ) -> Result<Self, AclPolicyError> {
        // An owner SID that does not validate is a malformed descriptor, never a silent `None`.
        let owner = match owner_bytes {
            Some(b) => Some(OwnedSid::from_bytes(b)?),
            None => None,
        };
        let aces = match &dacl {
            RawDacl::Acl(bytes) => parse_acl(bytes)?,
            RawDacl::Absent | RawDacl::Null => Vec::new(),
        };
        Ok(Self {
            owner,
            // The bytes are consumed by the parse above and dropped here: the observation retains
            // semantic evidence only.
            dacl: dacl.state(),
            dacl_protected: control & SE_DACL_PROTECTED != 0,
            dacl_auto_inherited: control & SE_DACL_AUTO_INHERITED != 0,
            aces,
        })
    }
}

/// Parse a copied ACL byte image into owned ACE records.
///
/// CRATE-LOCAL: an arbitrary-byte ACL parser is not part of the public contract. It has no authorised
/// production caller outside this crate, and exposing one would hand dependent crates a
/// descriptor-parsing surface this phase does not sanction. Synthetic malformed, exotic-ACE and
/// inheritance fixtures are exercised through the private unit tests below.
///
/// # Errors
/// [`AclPolicyError::MalformedDescriptor`] on any structural inconsistency.
pub(crate) fn parse_acl(bytes: &[u8]) -> Result<Vec<AceRecord>, AclPolicyError> {
    let malformed = || AclPolicyError::MalformedDescriptor;
    if bytes.len() < ACL_HEADER_BYTES {
        return Err(malformed());
    }
    let revision = bytes[0];
    if revision != ACL_REVISION && revision != ACL_REVISION_DS {
        return Err(malformed());
    }
    let acl_size = u16::from_le_bytes([bytes[2], bytes[3]]) as usize;
    if acl_size < ACL_HEADER_BYTES || acl_size > bytes.len() {
        return Err(malformed());
    }
    let ace_count = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;

    let mut offset = ACL_HEADER_BYTES;
    let mut records = Vec::with_capacity(ace_count);
    for _ in 0..ace_count {
        if offset + ACE_HEADER_BYTES > acl_size {
            return Err(malformed());
        }
        let ace_type = bytes[offset];
        let ace_flags = bytes[offset + 1];
        let ace_size = u16::from_le_bytes([bytes[offset + 2], bytes[offset + 3]]) as usize;
        // Every ACE is DWORD-aligned and at least a header.
        if ace_size < ACE_HEADER_BYTES
            || !ace_size.is_multiple_of(4)
            || offset + ace_size > acl_size
        {
            return Err(malformed());
        }
        let body = &bytes[offset..offset + ace_size];
        let inherited = ace_flags & INHERITED_ACE != 0;

        let record = match ace_type {
            ACCESS_ALLOWED_ACE_TYPE | ACCESS_DENIED_ACE_TYPE => {
                if ace_size <= ACE_SID_OFFSET {
                    return Err(malformed());
                }
                let raw_mask = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
                // A SID that does not validate makes the whole descriptor malformed: silently
                // dropping the trustee would leave an unattributed grant in place.
                let sid = OwnedSid::from_bytes(&body[ACE_SID_OFFSET..])?;
                AceRecord {
                    kind: if ace_type == ACCESS_ALLOWED_ACE_TYPE {
                        AceKind::Allow
                    } else {
                        AceKind::Deny
                    },
                    inherited,
                    raw_mask: Some(raw_mask),
                    sid: Some(sid),
                }
            }
            // Object / callback / conditional / audit / alarm / label / unknown: the body layout is
            // NOT the plain access-ACE layout, so nothing is interpreted from it.
            _ => AceRecord {
                kind: AceKind::Unsupported,
                inherited,
                raw_mask: None,
                sid: None,
            },
        };
        records.push(record);
        offset += ace_size;
    }
    Ok(records)
}

/// One explicit allow entry to encode.
pub(crate) struct AllowEntry<'a> {
    pub(crate) sid: &'a OwnedSid,
    pub(crate) mask: u32,
}

/// Build a DWORD-aligned ACL byte image containing ONLY explicit, non-inherited allow ACEs.
///
/// Deterministic and pure: the result is validated by Windows (`IsValidAcl`) before use and is
/// round-tripped through [`parse_acl`] in tests. No null ACL and no absent DACL can be produced.
///
/// # Errors
/// [`AclPolicyError::PolicyRefused`] if there are no entries (an empty DACL denies everyone,
/// including the owner, and is never produced accidentally) or the encoding would exceed `u16`.
pub(crate) fn build_allow_acl(entries: &[AllowEntry<'_>]) -> Result<Vec<u8>, AclPolicyError> {
    if entries.is_empty() {
        return Err(AclPolicyError::PolicyRefused);
    }
    let mut total = ACL_HEADER_BYTES;
    for e in entries {
        total += ACE_SID_OFFSET + e.sid.as_bytes().len();
    }
    if total > usize::from(u16::MAX) || entries.len() > usize::from(u16::MAX) {
        return Err(AclPolicyError::PolicyRefused);
    }

    let mut bytes = Vec::with_capacity(total);
    bytes.push(ACL_REVISION);
    bytes.push(0); // Sbz1
    #[allow(clippy::cast_possible_truncation)]
    bytes.extend_from_slice(&(total as u16).to_le_bytes());
    #[allow(clippy::cast_possible_truncation)]
    bytes.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    bytes.extend_from_slice(&0u16.to_le_bytes()); // Sbz2

    for e in entries {
        let sid = e.sid.as_bytes();
        let ace_size = ACE_SID_OFFSET + sid.len();
        bytes.push(ACCESS_ALLOWED_ACE_TYPE);
        bytes.push(0); // No ACE flags: not inherited, not inheritable, no audit flags.
        #[allow(clippy::cast_possible_truncation)]
        bytes.extend_from_slice(&(ace_size as u16).to_le_bytes());
        bytes.extend_from_slice(&e.mask.to_le_bytes());
        bytes.extend_from_slice(sid);
    }
    debug_assert_eq!(bytes.len(), total);
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Encode one ACE of an arbitrary type, for shapes that cannot safely be created on the host.
    fn synthetic_acl(aces: &[(u8, u8, u32, &[u8])]) -> Vec<u8> {
        let mut body = Vec::new();
        for (ace_type, flags, mask, sid) in aces {
            let size = 8 + sid.len();
            body.push(*ace_type);
            body.push(*flags);
            body.extend_from_slice(&u16::try_from(size).unwrap().to_le_bytes());
            body.extend_from_slice(&mask.to_le_bytes());
            body.extend_from_slice(sid);
        }
        let total = 8 + body.len();
        let mut acl = vec![ACL_REVISION, 0];
        acl.extend_from_slice(&u16::try_from(total).unwrap().to_le_bytes());
        acl.extend_from_slice(&u16::try_from(aces.len()).unwrap().to_le_bytes());
        acl.extend_from_slice(&0u16.to_le_bytes());
        acl.extend_from_slice(&body);
        acl
    }

    #[test]
    fn a_built_allow_acl_round_trips_through_the_parser() {
        let system = OwnedSid::local_system();
        let admins = OwnedSid::builtin_administrators();
        let acl = build_allow_acl(&[
            AllowEntry {
                sid: &system,
                mask: 0x001F_01FF,
            },
            AllowEntry {
                sid: &admins,
                mask: 0x0012_0089,
            },
        ])
        .unwrap();

        let aces = parse_acl(&acl).unwrap();
        assert_eq!(aces.len(), 2);
        assert_eq!(aces[0].kind, AceKind::Allow);
        assert_eq!(aces[0].raw_mask, Some(0x001F_01FF));
        assert_eq!(aces[0].sid.as_ref(), Some(&system));
        assert!(!aces[0].inherited, "built ACEs are never inherited");
        assert_eq!(aces[1].sid.as_ref(), Some(&admins));
        assert_eq!(aces[1].raw_mask, Some(0x0012_0089));
    }

    #[test]
    fn an_empty_acl_is_never_built() {
        assert_eq!(
            build_allow_acl(&[]).unwrap_err(),
            AclPolicyError::PolicyRefused
        );
    }

    #[test]
    fn absent_and_null_dacls_stay_distinct_and_carry_no_aces() {
        let absent = AclInspection::from_raw(None, 0, RawDacl::Absent).unwrap();
        let null = AclInspection::from_raw(None, SE_DACL_PRESENT, RawDacl::Null).unwrap();
        assert_eq!(absent.dacl, DaclState::Absent);
        assert_eq!(null.dacl, DaclState::Null);
        assert_ne!(absent.dacl, null.dacl);
        assert!(absent.aces.is_empty());
        assert!(null.aces.is_empty());
    }

    /// Containment must not collapse the three states, and a parsed observation must retain NO ACL
    /// byte image — only the semantic projection.
    #[test]
    fn the_public_projection_keeps_all_three_states_and_drops_the_bytes() {
        let sid = OwnedSid::local_system();
        let acl = build_allow_acl(&[AllowEntry {
            sid: &sid,
            mask: 0x001F_01FF,
        }])
        .unwrap();
        assert_eq!(RawDacl::Absent.state(), DaclState::Absent);
        assert_eq!(RawDacl::Null.state(), DaclState::Null);
        assert_eq!(RawDacl::Acl(acl.clone()).state(), DaclState::Present);

        let present =
            AclInspection::from_raw(None, SE_DACL_PRESENT | SE_DACL_PROTECTED, RawDacl::Acl(acl))
                .unwrap();
        assert_eq!(present.dacl, DaclState::Present);
        assert_eq!(present.aces.len(), 1, "semantic ACE evidence survives");
        // `DaclState` is a fieldless enum: `size_of` proves it carries no payload at all.
        assert_eq!(std::mem::size_of::<DaclState>(), 1);
    }

    #[test]
    fn control_bits_are_decoded_independently() {
        let protected =
            AclInspection::from_raw(None, SE_DACL_PRESENT | SE_DACL_PROTECTED, RawDacl::Null)
                .unwrap();
        assert!(protected.dacl_protected);
        assert!(!protected.dacl_auto_inherited);

        let inherited = AclInspection::from_raw(
            None,
            SE_DACL_PRESENT | SE_DACL_AUTO_INHERITED,
            RawDacl::Null,
        )
        .unwrap();
        assert!(!inherited.dacl_protected);
        assert!(inherited.dacl_auto_inherited);
    }

    #[test]
    fn an_inherited_ace_is_identified() {
        let sid = OwnedSid::builtin_users();
        let acl = synthetic_acl(&[(
            ACCESS_ALLOWED_ACE_TYPE,
            INHERITED_ACE,
            0x1F01FF,
            sid.as_bytes(),
        )]);
        let aces = parse_acl(&acl).unwrap();
        assert!(aces[0].inherited);
        assert_eq!(aces[0].kind, AceKind::Allow);
    }

    #[test]
    fn a_deny_ace_is_identified() {
        let sid = OwnedSid::everyone();
        let acl = synthetic_acl(&[(ACCESS_DENIED_ACE_TYPE, 0, 0x1F01FF, sid.as_bytes())]);
        let aces = parse_acl(&acl).unwrap();
        assert_eq!(aces[0].kind, AceKind::Deny);
    }

    /// Object, callback and conditional ACEs must never be interpreted as a plain allow ACE — their
    /// body begins with flags/GUIDs or carries a trailing conditional expression, so the bytes at the
    /// plain-ACE mask and SID offsets are NOT a mask and NOT a trustee.
    #[test]
    fn object_callback_and_conditional_aces_fail_closed() {
        let sid = OwnedSid::everyone();
        for ace_type in [
            5u8,  // ACCESS_ALLOWED_OBJECT_ACE_TYPE
            6,    // ACCESS_DENIED_OBJECT_ACE_TYPE
            9,    // ACCESS_ALLOWED_CALLBACK_ACE_TYPE (conditional)
            10,   // ACCESS_DENIED_CALLBACK_ACE_TYPE (conditional)
            11,   // ACCESS_ALLOWED_CALLBACK_OBJECT_ACE_TYPE
            2,    // SYSTEM_AUDIT_ACE_TYPE
            0x11, // SYSTEM_RESOURCE_ATTRIBUTE_ACE_TYPE
            0x7F, // unknown future type
        ] {
            let acl = synthetic_acl(&[(ace_type, 0, 0x1F01FF, sid.as_bytes())]);
            let aces = parse_acl(&acl).unwrap();
            assert_eq!(
                aces[0].kind,
                AceKind::Unsupported,
                "ACE type {ace_type} must not be interpreted"
            );
            assert_eq!(aces[0].raw_mask, None, "no mask may be read from it");
            assert_eq!(aces[0].sid, None, "no trustee may be read from it");
        }
    }

    #[test]
    fn malformed_acls_are_refused() {
        let sid = OwnedSid::local_system();
        // Truncated header.
        assert_eq!(
            parse_acl(&[2, 0, 8]).unwrap_err(),
            AclPolicyError::MalformedDescriptor
        );
        // Unknown revision.
        assert_eq!(
            parse_acl(&[9, 0, 8, 0, 0, 0, 0, 0]).unwrap_err(),
            AclPolicyError::MalformedDescriptor
        );
        // Declared ACL size beyond the buffer.
        assert_eq!(
            parse_acl(&[2, 0, 0xFF, 0xFF, 0, 0, 0, 0]).unwrap_err(),
            AclPolicyError::MalformedDescriptor
        );
        // ACE count exceeds the bytes actually present.
        let mut short = synthetic_acl(&[(ACCESS_ALLOWED_ACE_TYPE, 0, 1, sid.as_bytes())]);
        short[4] = 5; // claim five ACEs
        assert_eq!(
            parse_acl(&short).unwrap_err(),
            AclPolicyError::MalformedDescriptor
        );
        // Mis-aligned ACE size.
        let mut misaligned = synthetic_acl(&[(ACCESS_ALLOWED_ACE_TYPE, 0, 1, sid.as_bytes())]);
        misaligned[10] = 13;
        assert_eq!(
            parse_acl(&misaligned).unwrap_err(),
            AclPolicyError::MalformedDescriptor
        );
        // Access ACE with no room for a trustee.
        let stub = {
            let mut acl = vec![2u8, 0, 16, 0, 1, 0, 0, 0];
            acl.extend_from_slice(&[ACCESS_ALLOWED_ACE_TYPE, 0, 8, 0, 0, 0, 0, 0]);
            acl
        };
        assert_eq!(
            parse_acl(&stub).unwrap_err(),
            AclPolicyError::MalformedDescriptor
        );
        // Access ACE whose trustee is not a valid SID.
        let bad_sid = synthetic_acl(&[(ACCESS_ALLOWED_ACE_TYPE, 0, 1, &[9, 9, 9, 9, 9, 9, 9, 9])]);
        assert_eq!(parse_acl(&bad_sid).unwrap_err(), AclPolicyError::InvalidSid);
    }

    #[test]
    fn a_malformed_owner_sid_makes_the_descriptor_malformed() {
        assert_eq!(
            AclInspection::from_raw(Some(&[9, 9, 9]), SE_DACL_PRESENT, RawDacl::Null).unwrap_err(),
            AclPolicyError::InvalidSid
        );
    }
}
