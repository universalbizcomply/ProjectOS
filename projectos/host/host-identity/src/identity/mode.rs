//! Identity evaluation policy. Production is NEVER selected from ambient inputs: there is
//! deliberately no function anywhere that reads an environment variable, CLI flag, working-directory
//! name, React payload, or daemon request to choose a policy. Callers pass `Policy` explicitly, and
//! only the packaged startup path (with a production verifier and a PerMachine install) uses
//! `Policy::Production`. Created in PROJECTOS-PACKAGED-SIDECAR-IDENTITY1A.

/// Which policy an evaluation runs under.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Policy {
    /// Requires a PerMachine install, a production-grade signature verifier, and a non-test signer.
    Production,
    /// Fixture-only: accepts the deterministic test verifier and reaches `TEST_IDENTITY_VERIFIED`.
    Test,
}

impl Policy {
    pub const fn is_production(self) -> bool {
        matches!(self, Policy::Production)
    }
}
