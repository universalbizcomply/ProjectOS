//! Typed identity failures for PACKAGED-SIDECAR-IDENTITY1A.
//!
//! Every failure is closed (no `_ =>` wildcards downstream) and carries safe operator guidance.
//! Errors never expose private keys, raw test-key material, stack traces, environment variables,
//! authentication data, or unnecessary local paths. Created in PROJECTOS-PACKAGED-SIDECAR-IDENTITY1A.

use serde::Serialize;

/// Closed set of identity-verification failures. Ordinary read-only operation stays available for
/// most of these (identity affects only *production trust*, never the read-only snapshot path).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IdentityError {
    PathRuntimeForbidden,
    RuntimeNotProvisioned,
    RuntimePathInvalid,
    RuntimeOutsideInstallRoot,
    RuntimeHashMismatch,
    RuntimeVersionMismatch,
    RuntimeArchitectureMismatch,
    DaemonArtefactNotFound,
    DaemonArtefactHashMismatch,
    LooseModuleIdentityForbidden,
    ManifestNotFound,
    ManifestMalformed,
    ManifestVersionUnsupported,
    ManifestSignatureRequired,
    ManifestSignatureInvalid,
    ManifestSignerUnknown,
    TestSignerRejectedInProduction,
    ApplicationVersionMismatch,
    ApplicationIdMismatch,
    InstallationModelUnsafe,
    /// The manifest declared a per-machine installation that independently observed facts do not
    /// corroborate. Distinct from `InstallationModelUnsafe`, which is the manifest declaring a model
    /// that can never anchor production: this one is the manifest saying something that reality does
    /// not confirm, and the two failures deserve different words.
    InstallationModelUncorroborated,
    DevelopmentBuildNotTrusted,
    IdentityChangedAfterVerify,
    ProductionIdentityUnavailable,

    // ── the gatekeeper EXECUTION CLOSURE ─────────────────────────────────────────────────────────
    //
    // ARTEFACT-SPECIFIC ON PURPOSE. Reusing `DaemonArtefactHashMismatch` for a broker or an
    // allowlist would make the verifier name the wrong file in the one situation where knowing
    // which file changed is the entire diagnosis — and an operator chasing a daemon that was never
    // touched is an operator who does not find the allowlist that was.
    /// A manifest below version 2 was offered for a host-attested gatekeeper execution. It is a
    /// valid manifest of what it signed; it simply never signed the closure.
    ExecutionClosureManifestVersionTooLow,
    /// A manifest claiming version 2 or above carries no execution closure.
    ExecutionClosureMissing,
    /// A version 1 manifest carries closure fields. They would sit outside the canonical bytes and
    /// so outside the signature — decoration that could be mistaken for attestation.
    ExecutionClosureUnexpected,

    /// The manifest names a broker path that is not the one the packaging contract declares.
    BrokerArtefactPathMismatch,
    /// The broker's committed bytes could not be established at all. "I could not ask" is not "it
    /// is fine", so it fails closed and says which of the two it was.
    BrokerArtefactNotReadable,
    /// The broker's committed bytes are not the attested ones.
    BrokerArtefactHashMismatch,

    /// The manifest names an allowlist path that is not the declared one.
    InstallationAllowlistPathMismatch,
    /// The allowlist's committed bytes could not be established.
    InstallationAllowlistNotReadable,
    /// The allowlist's committed bytes are not the attested ones.
    InstallationAllowlistHashMismatch,

    /// The manifest names a credential-adapter path that is not the declared one.
    CredentialAdapterPathMismatch,
    /// The credential adapter's committed bytes could not be established.
    CredentialAdapterNotReadable,
    /// The credential adapter's committed bytes are not the attested ones.
    CredentialAdapterHashMismatch,

    InternalErrorRedacted,
}

impl IdentityError {
    /// Whether the ordinary read-only Control Centre snapshot path stays safe despite this failure.
    /// Identity failures never disable read-only operation — only production trust.
    pub const fn read_only_operation_safe(self) -> bool {
        // No identity failure compromises the read-only projection; it only withholds trust.
        true
    }

    /// Protected approvals are disabled on *every* identity failure — fail closed, always.
    pub const fn protected_approvals_disabled(self) -> bool {
        true
    }

    /// Short, safe operator hint. No paths, keys, env, or stack content.
    pub const fn next_safe_action(self) -> &'static str {
        match self {
            IdentityError::PathRuntimeForbidden
            | IdentityError::RuntimeNotProvisioned
            | IdentityError::RuntimePathInvalid
            | IdentityError::RuntimeOutsideInstallRoot
            | IdentityError::RuntimeHashMismatch
            | IdentityError::RuntimeVersionMismatch
            | IdentityError::RuntimeArchitectureMismatch => {
                "Install ProjectOS from an approved packaged release; run read-only meanwhile."
            }
            IdentityError::DaemonArtefactNotFound
            | IdentityError::DaemonArtefactHashMismatch
            | IdentityError::LooseModuleIdentityForbidden => {
                "Reinstall the approved packaged daemon artefact; run read-only meanwhile."
            }
            IdentityError::ManifestNotFound
            | IdentityError::ManifestMalformed
            | IdentityError::ManifestVersionUnsupported
            | IdentityError::ManifestSignatureRequired
            | IdentityError::ManifestSignatureInvalid
            | IdentityError::ManifestSignerUnknown
            | IdentityError::TestSignerRejectedInProduction => {
                "Reinstall an authentically signed release; protected approvals stay disabled."
            }
            IdentityError::ApplicationVersionMismatch
            | IdentityError::ApplicationIdMismatch
            | IdentityError::InstallationModelUnsafe
            | IdentityError::InstallationModelUncorroborated
            | IdentityError::DevelopmentBuildNotTrusted => {
                "Use a per-machine approved installation of the matching application version."
            }
            IdentityError::IdentityChangedAfterVerify => {
                "Restart ProjectOS to re-verify identity; protected approvals stay disabled."
            }
            IdentityError::ProductionIdentityUnavailable => {
                "Continue in read-only mode; production trust is unavailable in this environment."
            }
            IdentityError::ExecutionClosureManifestVersionTooLow
            | IdentityError::ExecutionClosureMissing
            | IdentityError::ExecutionClosureUnexpected => {
                "Reinstall a release whose signed manifest covers the gatekeeper execution closure."
            }
            IdentityError::BrokerArtefactPathMismatch
            | IdentityError::BrokerArtefactNotReadable
            | IdentityError::BrokerArtefactHashMismatch => {
                "The gatekeeper broker does not match the signed release; provider calls stay disabled."
            }
            IdentityError::InstallationAllowlistPathMismatch
            | IdentityError::InstallationAllowlistNotReadable
            | IdentityError::InstallationAllowlistHashMismatch => {
                "The installation project allowlist does not match the signed release; provider calls stay disabled."
            }
            IdentityError::CredentialAdapterPathMismatch
            | IdentityError::CredentialAdapterNotReadable
            | IdentityError::CredentialAdapterHashMismatch => {
                "The credential adapter does not match the signed release; provider calls stay disabled."
            }
            IdentityError::InternalErrorRedacted => {
                "Restart ProjectOS; if it persists, reinstall from an approved release."
            }
        }
    }
}
