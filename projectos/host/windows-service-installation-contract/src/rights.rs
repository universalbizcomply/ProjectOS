//! Operation-specific minimum SCM and service access masks. PURE constants — no Windows API.
//!
//! Every mask is the least authority a specific future operation needs, defined as a named `u32`
//! from the stable Win32 ABI. There is deliberately NO single broad mask: `SC_MANAGER_ALL_ACCESS`
//! and `SERVICE_ALL_ACCESS` are defined ONLY so a test can prove they are absent from every
//! operation mask, and [`is_broad`] refuses any mask carrying all-access or DAC/owner-writing bits.
//!
//! These are plain integers describing a FUTURE requirement. This crate opens no Service Control
//! Manager and requests no mask.

// ---- SCM manager rights ----
/// `SC_MANAGER_CONNECT`.
pub const SC_MANAGER_CONNECT: u32 = 0x0001;
/// `SC_MANAGER_CREATE_SERVICE`.
pub const SC_MANAGER_CREATE_SERVICE: u32 = 0x0002;
/// `SC_MANAGER_ENUMERATE_SERVICE`.
pub const SC_MANAGER_ENUMERATE_SERVICE: u32 = 0x0004;
/// `SC_MANAGER_ALL_ACCESS`. Defined only to prove its absence; never requested.
pub const SC_MANAGER_ALL_ACCESS: u32 = 0x000F_003F;

// ---- service object rights ----
/// `SERVICE_QUERY_CONFIG`.
pub const SERVICE_QUERY_CONFIG: u32 = 0x0001;
/// `SERVICE_QUERY_STATUS`.
pub const SERVICE_QUERY_STATUS: u32 = 0x0004;
/// `SERVICE_START`.
pub const SERVICE_START: u32 = 0x0010;
/// `SERVICE_STOP`.
pub const SERVICE_STOP: u32 = 0x0020;
/// `DELETE` (standard right).
pub const STANDARD_DELETE: u32 = 0x0001_0000;
/// `WRITE_DAC` (standard right).
pub const STANDARD_WRITE_DAC: u32 = 0x0004_0000;
/// `WRITE_OWNER` (standard right).
pub const STANDARD_WRITE_OWNER: u32 = 0x0008_0000;
/// `SERVICE_ALL_ACCESS`. Defined only to prove its absence; never requested.
pub const SERVICE_ALL_ACCESS: u32 = 0x000F_01FF;

/// One future operation and the exact minimum mask it would require.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[non_exhaustive]
pub enum ScmOperation {
    /// Open the SCM to create the service. `CONNECT | CREATE_SERVICE`.
    OpenForCreation,
    /// Open the SCM to enumerate services for the pre-effect collision check.
    /// `CONNECT | ENUMERATE_SERVICE`.
    OpenForEnumeration,
    /// Re-read the service configuration authoritatively. `QUERY_CONFIG`.
    ConfigReread,
    /// Query the service status. `QUERY_STATUS`.
    StatusQuery,
    /// Verify the service SID type. `QUERY_CONFIG`.
    SidTypeVerification,
    /// Verify the startup configuration. `QUERY_CONFIG`.
    StartupVerification,
    /// Controlled start — ONLY under a separate approval. `SERVICE_START`.
    ControlledStart,
    /// Controlled delete — ONLY under a separate rollback approval. `DELETE`.
    ControlledDelete,
}

impl ScmOperation {
    /// The exact minimum access mask this operation requires.
    #[must_use]
    pub fn required_mask(self) -> u32 {
        match self {
            Self::OpenForCreation => SC_MANAGER_CONNECT | SC_MANAGER_CREATE_SERVICE,
            Self::OpenForEnumeration => SC_MANAGER_CONNECT | SC_MANAGER_ENUMERATE_SERVICE,
            Self::ConfigReread | Self::SidTypeVerification | Self::StartupVerification => {
                SERVICE_QUERY_CONFIG
            }
            Self::StatusQuery => SERVICE_QUERY_STATUS,
            Self::ControlledStart => SERVICE_START,
            Self::ControlledDelete => STANDARD_DELETE,
        }
    }

    /// Whether this operation may run ONLY under a separate, additional approval.
    #[must_use]
    pub fn requires_separate_approval(self) -> bool {
        matches!(self, Self::ControlledStart | Self::ControlledDelete)
    }

    /// Every modelled operation, in a stable order.
    #[must_use]
    pub fn all() -> &'static [ScmOperation] {
        use ScmOperation as O;
        &[
            O::OpenForCreation,
            O::OpenForEnumeration,
            O::ConfigReread,
            O::StatusQuery,
            O::SidTypeVerification,
            O::StartupVerification,
            O::ControlledStart,
            O::ControlledDelete,
        ]
    }
}

/// Whether a mask carries broad authority: any all-access mask, or `WRITE_DAC` / `WRITE_OWNER`.
///
/// Used to refuse a mask that exceeds what a specific operation needs.
#[must_use]
pub fn is_broad(mask: u32) -> bool {
    let broad_bits = STANDARD_WRITE_DAC | STANDARD_WRITE_OWNER;
    mask == SC_MANAGER_ALL_ACCESS
        || mask == SERVICE_ALL_ACCESS
        // A mask that fully contains either all-access set is broad.
        || (mask & SC_MANAGER_ALL_ACCESS) == SC_MANAGER_ALL_ACCESS
        || (mask & SERVICE_ALL_ACCESS) == SERVICE_ALL_ACCESS
        || (mask & broad_bits) != 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_operation_requests_exactly_its_minimum() {
        assert_eq!(
            ScmOperation::OpenForCreation.required_mask(),
            SC_MANAGER_CONNECT | SC_MANAGER_CREATE_SERVICE
        );
        assert_eq!(
            ScmOperation::OpenForEnumeration.required_mask(),
            SC_MANAGER_CONNECT | SC_MANAGER_ENUMERATE_SERVICE
        );
        assert_eq!(
            ScmOperation::ConfigReread.required_mask(),
            SERVICE_QUERY_CONFIG
        );
        assert_eq!(
            ScmOperation::StatusQuery.required_mask(),
            SERVICE_QUERY_STATUS
        );
        assert_eq!(ScmOperation::ControlledStart.required_mask(), SERVICE_START);
        assert_eq!(
            ScmOperation::ControlledDelete.required_mask(),
            STANDARD_DELETE
        );
    }

    #[test]
    fn no_operation_requests_a_broad_mask() {
        for op in ScmOperation::all() {
            assert!(
                !is_broad(op.required_mask()),
                "{op:?} must not request broad authority"
            );
        }
    }

    #[test]
    fn all_access_masks_are_classified_broad() {
        assert!(is_broad(SC_MANAGER_ALL_ACCESS));
        assert!(is_broad(SERVICE_ALL_ACCESS));
        assert!(is_broad(SERVICE_QUERY_CONFIG | STANDARD_WRITE_DAC));
        assert!(is_broad(SERVICE_QUERY_CONFIG | STANDARD_WRITE_OWNER));
        assert!(!is_broad(SERVICE_QUERY_CONFIG));
        assert!(!is_broad(SERVICE_START));
        assert!(!is_broad(STANDARD_DELETE));
    }

    #[test]
    fn only_start_and_delete_need_separate_approval() {
        for op in ScmOperation::all() {
            let expected = matches!(
                op,
                ScmOperation::ControlledStart | ScmOperation::ControlledDelete
            );
            assert_eq!(op.requires_separate_approval(), expected, "{op:?}");
        }
    }

    #[test]
    fn no_operation_carries_dac_or_owner_write() {
        for op in ScmOperation::all() {
            let m = op.required_mask();
            assert_eq!(m & STANDARD_WRITE_DAC, 0, "{op:?}");
            assert_eq!(m & STANDARD_WRITE_OWNER, 0, "{op:?}");
        }
    }
}
