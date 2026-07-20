//! The explicit ACL policy, and the rights normalisation it is compared against.
//!
//! There is NO permissive default and no `Default` implementation. A policy must be stated, and the
//! only constructor ([`AclPolicy::strict`]) starts fully closed: no inherited ACEs, protected DACL
//! required, no unknown principals, no deny ACEs, no broad-principal access of any kind.
//!
//! ## Rights normalisation (exact)
//!
//! Generic rights and file-specific rights are NOT interchangeable. An observed access mask is first
//! normalised by expanding each generic bit through the documented FILE object generic mapping, then
//! clearing the generic bits:
//!
//! | Generic bit     | Expanded to                                        |
//! |-----------------|----------------------------------------------------|
//! | `GENERIC_READ`  | `FILE_GENERIC_READ`    (`0x0012_0089`)             |
//! | `GENERIC_WRITE` | `FILE_GENERIC_WRITE`   (`0x0012_0116`)             |
//! | `GENERIC_EXECUTE` | `FILE_GENERIC_EXECUTE` (`0x0012_00A0`)           |
//! | `GENERIC_ALL`   | `FILE_ALL_ACCESS`      (`0x001F_01FF`)             |
//!
//! `MAXIMUM_ALLOWED` is NOT normalised: the authority it confers is resolved at open time and cannot
//! be bounded by inspection, so an ACE carrying it is failed closed as unsupported rather than being
//! compared against a mask.

use crate::principal::AclPrincipal;

// ---- file-specific rights ----
pub(crate) const FILE_WRITE_DATA: u32 = 0x0000_0002;
pub(crate) const FILE_APPEND_DATA: u32 = 0x0000_0004;
pub(crate) const FILE_WRITE_EA: u32 = 0x0000_0010;
pub(crate) const FILE_DELETE_CHILD: u32 = 0x0000_0040;
pub(crate) const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
pub(crate) const FILE_WRITE_ATTRIBUTES: u32 = 0x0000_0100;

// ---- standard rights ----
pub(crate) const DELETE: u32 = 0x0001_0000;
pub(crate) const READ_CONTROL: u32 = 0x0002_0000;
pub(crate) const WRITE_DAC: u32 = 0x0004_0000;
pub(crate) const WRITE_OWNER: u32 = 0x0008_0000;
pub(crate) const SYNCHRONIZE: u32 = 0x0010_0000;

// ---- generic and indeterminate rights ----
pub(crate) const MAXIMUM_ALLOWED: u32 = 0x0200_0000;
const GENERIC_ALL: u32 = 0x1000_0000;
const GENERIC_EXECUTE: u32 = 0x2000_0000;
const GENERIC_WRITE: u32 = 0x4000_0000;
const GENERIC_READ: u32 = 0x8000_0000;
const GENERIC_MASK: u32 = GENERIC_ALL | GENERIC_EXECUTE | GENERIC_WRITE | GENERIC_READ;

// ---- documented FILE generic mapping ----
const FILE_GENERIC_READ: u32 = 0x0012_0089;
const FILE_GENERIC_WRITE: u32 = 0x0012_0116;
const FILE_GENERIC_EXECUTE: u32 = 0x0012_00A0;
const FILE_ALL_ACCESS: u32 = 0x001F_01FF;

/// Every bit that can MODIFY the object, its children, its owner or its own ACL.
pub(crate) const WRITE_LIKE_MASK: u32 = FILE_WRITE_DATA
    | FILE_APPEND_DATA
    | FILE_WRITE_EA
    | FILE_WRITE_ATTRIBUTES
    | FILE_DELETE_CHILD
    | DELETE
    | WRITE_DAC
    | WRITE_OWNER;

/// Expand generic bits through the FILE generic mapping and clear them.
///
/// CRATE-LOCAL: normalisation exists to serve verification, and it has no authorised external
/// production caller. Callers receive the SEMANTIC outcome ([`crate::AclViolation`]) rather than a
/// mask-arithmetic helper, so the crate — not the caller — remains the authority on what a mask means.
///
/// `MAXIMUM_ALLOWED` is deliberately preserved so the verifier can fail closed on it.
#[must_use]
pub(crate) fn normalize_mask(raw: u32) -> u32 {
    let mut mask = raw & !GENERIC_MASK;
    if raw & GENERIC_READ != 0 {
        mask |= FILE_GENERIC_READ;
    }
    if raw & GENERIC_WRITE != 0 {
        mask |= FILE_GENERIC_WRITE;
    }
    if raw & GENERIC_EXECUTE != 0 {
        mask |= FILE_GENERIC_EXECUTE;
    }
    if raw & GENERIC_ALL != 0 {
        mask |= FILE_ALL_ACCESS;
    }
    mask
}

/// An explicit rights class. Each maps to one exact normalised mask.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RightsClass {
    /// Read the object's attributes and its security descriptor. Nothing else.
    ReadAttributes,
    /// Read and traverse.
    Read,
    /// Read, traverse, write and delete — but NOT `WRITE_DAC` or `WRITE_OWNER`.
    Modify,
    /// Everything the file object defines.
    FullControl,
}

impl RightsClass {
    /// The exact normalised access mask this class permits.
    #[must_use]
    pub fn mask(self) -> u32 {
        match self {
            Self::ReadAttributes => READ_CONTROL | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
            Self::Read => FILE_GENERIC_READ | FILE_GENERIC_EXECUTE,
            Self::Modify => FILE_GENERIC_READ | FILE_GENERIC_EXECUTE | FILE_GENERIC_WRITE | DELETE,
            Self::FullControl => FILE_ALL_ACCESS,
        }
    }
}

/// One permitted principal and the most it may hold.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllowedPrincipal {
    /// Who.
    pub principal: AclPrincipal,
    /// The most authority that principal may hold. An observed ACE broader than this is a violation.
    pub rights: RightsClass,
}

/// The explicit custody policy an observed descriptor is judged against.
///
/// Construct with [`AclPolicy::strict`] and relax only deliberately. Nothing is implied: a policy
/// never silently permits Everyone, Authenticated Users, Builtin Users, inherited parent authority,
/// or an unknown ACE.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AclPolicy {
    /// The principal that MUST own the object.
    pub expected_owner: AclPrincipal,
    /// The complete set of principals permitted an allow ACE, and their maximum rights.
    pub allowed: Vec<AllowedPrincipal>,
    /// Whether inherited ACEs may be present at all.
    pub allow_inherited_aces: bool,
    /// Whether the DACL must be protected from inheritance (`SE_DACL_PROTECTED`).
    pub require_protected_dacl: bool,
    /// Whether a principal absent from `allowed` may hold an ACE.
    pub allow_unknown_principals: bool,
    /// Whether deny ACEs may be present.
    pub allow_deny_aces: bool,
    /// Whether a broad principal may hold ANY access.
    pub allow_broad_principals_any_access: bool,
    /// Whether a broad principal may hold WRITE-LIKE access.
    pub allow_broad_principals_write: bool,
}

impl AclPolicy {
    /// A fully closed policy: the stated owner, the stated principals, nothing else.
    ///
    /// No inherited ACEs, protection required, no unknown principals, no deny ACEs, no broad
    /// principal access of any kind.
    #[must_use]
    pub fn strict(expected_owner: AclPrincipal, allowed: Vec<AllowedPrincipal>) -> Self {
        Self {
            expected_owner,
            allowed,
            allow_inherited_aces: false,
            require_protected_dacl: true,
            allow_unknown_principals: false,
            allow_deny_aces: false,
            allow_broad_principals_any_access: false,
            allow_broad_principals_write: false,
        }
    }

    /// Whether the policy itself would grant a broad principal write-like authority.
    ///
    /// Such a policy is refused BEFORE any application effect: applying it would be the very defect
    /// verification exists to detect.
    #[must_use]
    pub fn grants_broad_write(&self) -> bool {
        if self.allow_broad_principals_write {
            return true;
        }
        self.allowed.iter().any(|a| {
            a.principal
                .resolve()
                .ok()
                .and_then(|sid| crate::principal::BroadPrincipal::classify(&sid))
                .is_some()
                && a.rights.mask() & WRITE_LIKE_MASK != 0
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generic_bits_expand_through_the_file_generic_mapping() {
        assert_eq!(normalize_mask(GENERIC_READ), FILE_GENERIC_READ);
        assert_eq!(normalize_mask(GENERIC_WRITE), FILE_GENERIC_WRITE);
        assert_eq!(normalize_mask(GENERIC_EXECUTE), FILE_GENERIC_EXECUTE);
        assert_eq!(normalize_mask(GENERIC_ALL), FILE_ALL_ACCESS);
        // Generic bits are cleared, never left set alongside their expansion.
        assert_eq!(normalize_mask(GENERIC_ALL) & GENERIC_MASK, 0);
    }

    #[test]
    fn generic_write_is_not_treated_as_a_file_specific_read() {
        // The exact confusion the normalisation exists to prevent.
        assert_ne!(normalize_mask(GENERIC_WRITE), GENERIC_WRITE);
        assert!(normalize_mask(GENERIC_WRITE) & WRITE_LIKE_MASK != 0);
        assert!(normalize_mask(GENERIC_READ) & WRITE_LIKE_MASK == 0);
    }

    #[test]
    fn maximum_allowed_is_preserved_for_fail_closed_handling() {
        assert!(normalize_mask(MAXIMUM_ALLOWED) & MAXIMUM_ALLOWED != 0);
    }

    #[test]
    fn rights_classes_are_ordered_by_authority() {
        let ra = RightsClass::ReadAttributes.mask();
        let r = RightsClass::Read.mask();
        let m = RightsClass::Modify.mask();
        let f = RightsClass::FullControl.mask();
        assert_eq!(ra & !r, 0, "ReadAttributes must be a subset of Read");
        assert_eq!(r & !m, 0, "Read must be a subset of Modify");
        assert_eq!(m & !f, 0, "Modify must be a subset of FullControl");
        // Read-only classes carry no write-like authority.
        assert_eq!(ra & WRITE_LIKE_MASK, 0);
        assert_eq!(r & WRITE_LIKE_MASK, 0);
        // Modify may write and delete but must NOT be able to rewrite the ACL or take ownership.
        assert!(m & WRITE_LIKE_MASK != 0);
        assert_eq!(m & (WRITE_DAC | WRITE_OWNER), 0);
        assert!(f & (WRITE_DAC | WRITE_OWNER) != 0);
    }

    #[test]
    fn the_strict_policy_is_closed_in_every_dimension() {
        let p = AclPolicy::strict(AclPrincipal::LocalSystem, Vec::new());
        assert!(!p.allow_inherited_aces);
        assert!(p.require_protected_dacl);
        assert!(!p.allow_unknown_principals);
        assert!(!p.allow_deny_aces);
        assert!(!p.allow_broad_principals_any_access);
        assert!(!p.allow_broad_principals_write);
    }

    #[test]
    fn a_policy_granting_a_broad_principal_write_is_detected() {
        let unsafe_policy = AclPolicy::strict(
            AclPrincipal::LocalSystem,
            vec![AllowedPrincipal {
                principal: AclPrincipal::ExplicitSid(crate::principal::OwnedSid::everyone()),
                rights: RightsClass::Modify,
            }],
        );
        assert!(unsafe_policy.grants_broad_write());

        let read_only = AclPolicy::strict(
            AclPrincipal::LocalSystem,
            vec![AllowedPrincipal {
                principal: AclPrincipal::ExplicitSid(crate::principal::OwnedSid::everyone()),
                rights: RightsClass::Read,
            }],
        );
        assert!(!read_only.grants_broad_write());

        let narrow = AclPolicy::strict(
            AclPrincipal::LocalSystem,
            vec![AllowedPrincipal {
                principal: AclPrincipal::LocalSystem,
                rights: RightsClass::FullControl,
            }],
        );
        assert!(!narrow.grants_broad_write());
    }
}
