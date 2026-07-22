//! Safe consumption of host-authority's OPAQUE ProjectOSHost pipe-security contract. This crate NEVER
//! resolves a SID, builds an ACL/SDDL, or accepts a caller-supplied security descriptor: it depends on
//! `projectos-host-authority` and only interprets the opaque [`ProjectOsHostPipeSecurityStatus`],
//! failing CLOSED when the principal is not Ready. The borrowed Windows security-attributes lease is
//! consumed solely at the private Windows FFI boundary (`windows_ffi.rs`), never here.

use projectos_host_authority::ProjectOsHostPipeSecurityStatus;

/// The decision the safe transport makes from host-authority's opaque security status. A live pipe may
/// be prepared ONLY on [`Proceed`](Self::Proceed); every other status refuses with NO weaker fallback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum EndpointSecurityDecision {
    /// The opaque security object is Ready; the future server may proceed (with a sealed capability).
    Proceed,
    /// The service principal is not yet resolvable (pre-installation) — refuse, install proof required.
    RefusedRequiresInstall,
    /// The security object is otherwise unavailable — refuse.
    RefusedUnavailable,
}

impl EndpointSecurityDecision {
    /// Only [`Proceed`](Self::Proceed) permits preparing the endpoint.
    #[must_use]
    pub fn permits_endpoint(self) -> bool {
        matches!(self, Self::Proceed)
    }
}

/// Evaluate host-authority's opaque status. Proceeds ONLY when the descriptor is Ready; a
/// `RequiresInstalledServiceProof` status is a fail-closed install-required refusal, and every other
/// non-ready status refuses. There is NO fallback to LocalSystem-only, Administrators-only, a default
/// descriptor, a null DACL, inherited security or caller-supplied attributes.
#[must_use]
pub fn evaluate_pipe_security(status: ProjectOsHostPipeSecurityStatus) -> EndpointSecurityDecision {
    match status {
        ProjectOsHostPipeSecurityStatus::Ready => EndpointSecurityDecision::Proceed,
        ProjectOsHostPipeSecurityStatus::RequiresInstalledServiceProof => {
            EndpointSecurityDecision::RefusedRequiresInstall
        }
        _ => EndpointSecurityDecision::RefusedUnavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_ready_permits_the_endpoint() {
        assert_eq!(
            evaluate_pipe_security(ProjectOsHostPipeSecurityStatus::Ready),
            EndpointSecurityDecision::Proceed
        );
        assert!(evaluate_pipe_security(ProjectOsHostPipeSecurityStatus::Ready).permits_endpoint());
    }

    #[test]
    fn requires_install_fails_closed_without_fallback() {
        let d =
            evaluate_pipe_security(ProjectOsHostPipeSecurityStatus::RequiresInstalledServiceProof);
        assert_eq!(d, EndpointSecurityDecision::RefusedRequiresInstall);
        assert!(!d.permits_endpoint());
    }

    #[test]
    fn every_other_status_refuses() {
        for s in [
            ProjectOsHostPipeSecurityStatus::ServicePrincipalUnavailable,
            ProjectOsHostPipeSecurityStatus::AccessDenied,
            ProjectOsHostPipeSecurityStatus::UnsupportedPlatform,
            ProjectOsHostPipeSecurityStatus::DescriptorConstructionFailed,
            ProjectOsHostPipeSecurityStatus::UnexpectedResolutionFailure,
        ] {
            assert!(!evaluate_pipe_security(s).permits_endpoint());
        }
    }
}
