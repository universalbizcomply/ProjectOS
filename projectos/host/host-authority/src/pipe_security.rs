//! The FIXED ProjectOSHost proof-pipe security POLICY — a closed, platform-independent, effect-free
//! contract (3K-I-D-E-C-CAPABILITY-B3-SECURITY-PRINCIPAL-CONTRACT1A).
//!
//! host-authority is the canonical owner of the ProjectOSHost service principal and of the
//! service-SID-backed security descriptor. This module states, in safe portable types, the FIXED DACL
//! policy the future named-pipe transport (windows-local-ipc, a later phase) must obey; the live,
//! service-SID-backed descriptor and its borrowed Windows security-attributes lease are constructed by
//! the Windows FFI owner in [`crate::security`] (compiled only under `test-fixtures` on Windows) and are
//! NEVER invoked in this phase.
//!
//! This is a SINGLE-PURPOSE policy, not a general ACL/SDDL builder: it names exactly three allowed
//! principals, refuses every broad principal, requires a protected DACL, and exposes NO raw SID, SID
//! bytes, SDDL, account name, service name, principal list or access mask input.

/// The minimum access the fixed proof pipe grants each allowed principal: `FILE_GENERIC_READ |
/// FILE_GENERIC_WRITE` (`0x0012_019F`). It carries `SYNCHRONIZE` and `READ_CONTROL` and the message
/// read/write data rights, and DELIBERATELY excludes `WRITE_DAC` (`0x0004_0000`), `WRITE_OWNER`
/// (`0x0008_0000`), `DELETE` (`0x0001_0000`) and `FILE_EXECUTE` — so no allowed principal can re-secure,
/// take ownership of, or delete the endpoint. This is the ONLY mask the policy grants.
pub const PIPE_PROOF_RIGHTS: u32 = 0x0012_019F;

/// The exact allowlisted principals for the protected proof-pipe DACL. There is no arbitrary-principal
/// variant, no SID input and no account-name input — the set is fixed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProjectOsHostPipeAllowPrincipal {
    /// The expected ProjectOSHost service-specific principal (resolved by host-authority; the SID is
    /// never exposed here).
    ExpectedServiceSid,
    /// The `LocalSystem` account (`S-1-5-18`).
    LocalSystem,
    /// The `Builtin Administrators` group (`S-1-5-32-544`).
    BuiltinAdministrators,
}

/// Principals so broad that granting them any allow ACE on the proof pipe is a defect. NONE is ever
/// allowed; `CurrentInteractiveUser` is included because an interactive user is not a proof peer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProjectOsHostPipeBroadPrincipal {
    /// `S-1-1-0`.
    Everyone,
    /// `S-1-5-32-545`.
    BuiltinUsers,
    /// `S-1-5-11`.
    AuthenticatedUsers,
    /// `S-1-5-32-546`.
    Guests,
    /// `S-1-5-7`.
    AnonymousLogon,
    /// The interactive user — never a proof peer for the service pipe.
    CurrentInteractiveUser,
}

/// The closed, redacted outcome of an attempt to construct the fixed proof-pipe security. It carries no
/// raw Win32 code, error text, SID, account name, domain, machine name or token information.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProjectOsHostPipeSecurityStatus {
    /// The service principal resolved and a protected, service-SID-backed descriptor was built.
    Ready,
    /// The service principal cannot be resolved before ProjectOSHost is installed. FAIL CLOSED — the
    /// caller gets NO descriptor and MUST NOT fall back to a broader security.
    RequiresInstalledServiceProof,
    /// The service principal could not be resolved for a reason other than pending installation.
    ServicePrincipalUnavailable,
    /// Resolution was denied.
    AccessDenied,
    /// The platform does not support the resolution (non-Windows).
    UnsupportedPlatform,
    /// The service principal resolved but the descriptor could not be constructed.
    DescriptorConstructionFailed,
    /// An unexpected resolution failure. FAIL CLOSED.
    UnexpectedResolutionFailure,
}

impl ProjectOsHostPipeSecurityStatus {
    /// Only [`Ready`](Self::Ready) yields a usable descriptor. Every other status is fail-closed.
    #[must_use]
    pub fn is_ready(self) -> bool {
        matches!(self, Self::Ready)
    }
}

/// A typed refusal the fixed policy raises against a non-conforming request. Fieldless — no name, SID,
/// SDDL or mask.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProjectOsHostPipeSecurityRefusal {
    /// A broad principal held (or was requested) an allow ACE.
    BroadPrincipalAllowRefused,
    /// The DACL was not protected from inheritance.
    UnprotectedDaclRefused,
    /// The DACL depended on inherited ACEs.
    InheritedDaclRefused,
    /// A principal outside the fixed allowlist was requested.
    ArbitraryPrincipalRefused,
    /// The service principal was not resolved, so no security may be produced.
    ServicePrincipalUnresolved,
}

/// The FIXED proof-pipe security policy. A zero-sized marker with associated queries only — it holds no
/// state, accepts no principal/SID/SDDL/mask input, and builds nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProjectOsHostPipeSecurityPolicy;

impl ProjectOsHostPipeSecurityPolicy {
    /// The fixed allowlist, in DACL order.
    #[must_use]
    pub fn allowlist() -> &'static [ProjectOsHostPipeAllowPrincipal] {
        &[
            ProjectOsHostPipeAllowPrincipal::ExpectedServiceSid,
            ProjectOsHostPipeAllowPrincipal::LocalSystem,
            ProjectOsHostPipeAllowPrincipal::BuiltinAdministrators,
        ]
    }

    /// Whether a principal is on the fixed allowlist.
    #[must_use]
    pub fn allows(principal: ProjectOsHostPipeAllowPrincipal) -> bool {
        Self::allowlist().contains(&principal)
    }

    /// A broad principal NEVER receives an allow ACE.
    #[must_use]
    pub fn allows_broad(_broad: ProjectOsHostPipeBroadPrincipal) -> bool {
        false
    }

    /// The DACL is always protected from inheritance (`D:P`).
    #[must_use]
    pub fn is_protected() -> bool {
        true
    }

    /// An explicit deny ACE is NOT required: the absence of any allow ACE for a broad principal already
    /// denies it. No deny ACE compensates for a broad allow, because no broad allow is ever emitted.
    #[must_use]
    pub fn requires_explicit_deny() -> bool {
        false
    }

    /// The only access mask granted to allowed principals.
    #[must_use]
    pub fn granted_rights() -> u32 {
        PIPE_PROOF_RIGHTS
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_is_exactly_service_sid_localsystem_administrators() {
        assert_eq!(
            ProjectOsHostPipeSecurityPolicy::allowlist(),
            &[
                ProjectOsHostPipeAllowPrincipal::ExpectedServiceSid,
                ProjectOsHostPipeAllowPrincipal::LocalSystem,
                ProjectOsHostPipeAllowPrincipal::BuiltinAdministrators,
            ]
        );
        for p in [
            ProjectOsHostPipeAllowPrincipal::ExpectedServiceSid,
            ProjectOsHostPipeAllowPrincipal::LocalSystem,
            ProjectOsHostPipeAllowPrincipal::BuiltinAdministrators,
        ] {
            assert!(ProjectOsHostPipeSecurityPolicy::allows(p));
        }
    }

    #[test]
    fn every_broad_principal_is_refused() {
        for b in [
            ProjectOsHostPipeBroadPrincipal::Everyone,
            ProjectOsHostPipeBroadPrincipal::BuiltinUsers,
            ProjectOsHostPipeBroadPrincipal::AuthenticatedUsers,
            ProjectOsHostPipeBroadPrincipal::Guests,
            ProjectOsHostPipeBroadPrincipal::AnonymousLogon,
            ProjectOsHostPipeBroadPrincipal::CurrentInteractiveUser,
        ] {
            assert!(!ProjectOsHostPipeSecurityPolicy::allows_broad(b));
        }
    }

    #[test]
    fn dacl_is_protected_and_needs_no_explicit_deny() {
        assert!(ProjectOsHostPipeSecurityPolicy::is_protected());
        assert!(!ProjectOsHostPipeSecurityPolicy::requires_explicit_deny());
    }

    #[test]
    fn granted_rights_are_minimum_and_exclude_write_dac_owner_delete() {
        let r = ProjectOsHostPipeSecurityPolicy::granted_rights();
        assert_eq!(r, PIPE_PROOF_RIGHTS);
        assert_eq!(r & 0x0004_0000, 0, "WRITE_DAC must not be granted");
        assert_eq!(r & 0x0008_0000, 0, "WRITE_OWNER must not be granted");
        assert_eq!(r & 0x0001_0000, 0, "DELETE must not be granted");
        assert_ne!(r, 0x001F_01FF, "must not be FILE_ALL_ACCESS");
    }

    #[test]
    fn unresolved_status_is_not_ready_and_fails_closed() {
        for s in [
            ProjectOsHostPipeSecurityStatus::RequiresInstalledServiceProof,
            ProjectOsHostPipeSecurityStatus::ServicePrincipalUnavailable,
            ProjectOsHostPipeSecurityStatus::AccessDenied,
            ProjectOsHostPipeSecurityStatus::UnsupportedPlatform,
            ProjectOsHostPipeSecurityStatus::DescriptorConstructionFailed,
            ProjectOsHostPipeSecurityStatus::UnexpectedResolutionFailure,
        ] {
            assert!(!s.is_ready());
        }
        assert!(ProjectOsHostPipeSecurityStatus::Ready.is_ready());
    }
}
