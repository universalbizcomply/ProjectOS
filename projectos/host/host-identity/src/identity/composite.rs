//! Non-authoritative composite packaged-runtime identity (WINDOWS-PACKAGED-RUNTIME-IDENTITY1B).
//!
//! Seven independent, closed identity DIMENSIONS plus a reducer that derives protected eligibility.
//! This phase is CLASSIFICATION ONLY: it verifies no Authenticode, claims no publisher, wires no
//! production manifest key, launches no daemon, and reads no external mutable state at request time.
//!
//! Binding Phase-1B invariant: `protected_eligibility()` ALWAYS derives to `Disabled`. The reducer
//! encodes every future gate explicitly, but no constructor in this phase can produce the
//! all-verified combination — there is no production verifier, so `CcSignature::Verified` and
//! `ReleaseChannel::SignedProduction` are simply unreachable. `PotentiallyEligible` / `Approved`
//! exist only as future closed-model values and are never returned here.
//!
//! Readiness, lifecycle health, recovery state and owner snapshots are NOT inputs to any dimension
//! or to the reducer. Identity is captured ONCE at startup and is immutable thereafter.

use serde::Serialize;

/// A. Structural execution mode. Derived from the SAME build-fact source as the daemon launch
/// authority (`process::authority::detect_app_mode`) plus the `test-fixtures` feature — never from
/// an env var, CLI flag, path name, or a second `debug_assertions` detector.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExecutionMode {
    Development,
    TestFixture,
    PackagedCandidate,
}

/// A′. Authenticated release channel. `SignedStaging` / `SignedProduction` require a production
/// verifier that does not exist in this phase, so they are UNREACHABLE by any Phase-1B path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReleaseChannel {
    Unknown,
    SignedStaging,
    SignedProduction,
}

/// B. Control Centre executable signature status. `NotChecked` is the truthful Phase-1B value for a
/// packaged candidate (no Authenticode is performed yet).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CcSignature {
    NotChecked,
    NotApplicable,
    Unsigned,
    SignatureInvalid,
    /// Crypto- and chain-valid, but no approved publisher policy is configured to confirm the
    /// signer (WINDOWS-PACKAGED-RUNTIME-IDENTITY2B). Distinct from `PublisherMismatch`: it is the
    /// absence of a policy, not a rejected signer. Never `Verified`.
    PublisherPolicyUnavailable,
    PublisherMismatch,
    ChainInvalid,
    RevocationUnknown,
    Revoked,
    Verified,
}

/// C. Release-manifest status. `TestFixtureVerified` is DISTINCT from production `Verified` and can
/// never be promoted to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReleaseManifest {
    NotChecked,
    Missing,
    Malformed,
    UnsupportedSchema,
    UnknownKey,
    SignatureInvalid,
    TestFixtureVerified,
    Verified,
}

/// D. Release file-integrity status. `TestFixtureVerified` is DISTINCT from production `Verified`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReleaseFileIntegrity {
    NotChecked,
    ControlCentreMismatch,
    DaemonMismatch,
    ResourceMismatch,
    TestFixtureVerified,
    Verified,
}

/// E. Installation identity. Only `PerMachineVerified` could ever contribute to protected
/// eligibility (in a future phase); nothing in Phase 1B produces it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InstallationIdentity {
    Development,
    TestFixture,
    Unknown,
    PortableOrCopied,
    PerUser,
    PerMachineUnverified,
    /// Location/registry/installer facts corroborate a per-machine install (WINDOWS-PACKAGED-
    /// RUNTIME-IDENTITY2B). This is CORROBORATION, not authenticated installation identity — it is
    /// strictly weaker than `PerMachineVerified` and never contributes to protected eligibility.
    PerMachineEvidenceMatched,
    /// Authenticated per-machine installation identity. UNREACHABLE until a future installer-
    /// attestation phase; no Phase-2B path produces it.
    PerMachineVerified,
}

impl InstallationIdentity {
    /// Do INDEPENDENTLY OBSERVED facts corroborate a per-machine installation?
    ///
    /// `PerMachineUnverified` deliberately does NOT. It means only "this path looks like Program
    /// Files", which a copied tree satisfies; corroboration requires location AND installer or
    /// registry evidence. This is the observation half of the manifest-vs-reality comparison in
    /// `evaluate()` step 5 — the manifest declares, this is what was actually seen, and production
    /// requires the two to agree.
    pub const fn corroborates_per_machine(self) -> bool {
        matches!(
            self,
            InstallationIdentity::PerMachineEvidenceMatched | InstallationIdentity::PerMachineVerified
        )
    }
}

/// F. Release freshness. Authenticity ≠ currency; without a trusted freshness source this stays
/// `Unknown` (Phase-1B: always).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReleaseFreshness {
    Unknown,
    Current,
    Superseded,
    Revoked,
}

/// G. Protected-capability eligibility. DERIVED, never stored or set by a caller. Phase 1B always
/// derives `Disabled`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtectedEligibility {
    Disabled,
    PotentiallyEligible,
    Approved,
}

/// The closed composite identity. Fields are PRIVATE; the only way to build one is a controlled
/// constructor, so a caller cannot assemble an arbitrary inconsistent combination. Protected
/// eligibility is not a field — it is always derived, so it can never be set to a granted value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositeIdentity {
    execution: ExecutionMode,
    channel: ReleaseChannel,
    signature: CcSignature,
    manifest: ReleaseManifest,
    integrity: ReleaseFileIntegrity,
    installation: InstallationIdentity,
    freshness: ReleaseFreshness,
}

impl CompositeIdentity {
    /// A development tree: never a production trust anchor. No file/signature checks apply.
    pub fn development() -> CompositeIdentity {
        CompositeIdentity {
            execution: ExecutionMode::Development,
            channel: ReleaseChannel::Unknown,
            signature: CcSignature::NotApplicable,
            manifest: ReleaseManifest::NotChecked,
            integrity: ReleaseFileIntegrity::NotChecked,
            installation: InstallationIdentity::Development,
            freshness: ReleaseFreshness::Unknown,
        }
    }

    /// A test-fixture build. A deterministic fixture MAY prove manifest/file consistency, but the
    /// result is labelled `TestFixtureVerified` — never production `Verified` — and can never reach
    /// a signed channel, PerMachine install, or protected eligibility.
    pub fn test_fixture(manifest_consistent: bool, files_consistent: bool) -> CompositeIdentity {
        CompositeIdentity {
            execution: ExecutionMode::TestFixture,
            channel: ReleaseChannel::Unknown,
            signature: CcSignature::NotApplicable,
            manifest: if manifest_consistent {
                ReleaseManifest::TestFixtureVerified
            } else {
                ReleaseManifest::NotChecked
            },
            integrity: if files_consistent {
                ReleaseFileIntegrity::TestFixtureVerified
            } else {
                ReleaseFileIntegrity::NotChecked
            },
            installation: InstallationIdentity::TestFixture,
            freshness: ReleaseFreshness::Unknown,
        }
    }

    /// A normal packaged candidate WITHOUT a production Authenticode verifier or manifest key: no
    /// check is performed, so every dimension is a truthful unverified value. Used as the
    /// fail-closed fallback when the running-executable identity cannot even be established.
    pub fn packaged_unverified() -> CompositeIdentity {
        CompositeIdentity {
            execution: ExecutionMode::PackagedCandidate,
            channel: ReleaseChannel::Unknown,
            signature: CcSignature::NotChecked,
            manifest: ReleaseManifest::NotChecked,
            integrity: ReleaseFileIntegrity::NotChecked,
            installation: InstallationIdentity::Unknown,
            freshness: ReleaseFreshness::Unknown,
        }
    }

    /// A packaged candidate whose Control Centre signature and installation were classified
    /// (WINDOWS-PACKAGED-RUNTIME-IDENTITY2B). Release channel/manifest/integrity/freshness remain
    /// unverified — Authenticode of the Control Centre alone never verifies the release — so
    /// protected eligibility still derives to `Disabled` (the reducer requires `Verified` signature
    /// AND `SignedProduction` channel AND `PerMachineVerified`, none reachable this phase).
    pub fn packaged(
        signature: CcSignature,
        installation: InstallationIdentity,
    ) -> CompositeIdentity {
        CompositeIdentity {
            execution: ExecutionMode::PackagedCandidate,
            channel: ReleaseChannel::Unknown,
            signature,
            manifest: ReleaseManifest::NotChecked,
            integrity: ReleaseFileIntegrity::NotChecked,
            installation,
            freshness: ReleaseFreshness::Unknown,
        }
    }

    pub fn execution(&self) -> ExecutionMode {
        self.execution
    }
    pub fn channel(&self) -> ReleaseChannel {
        self.channel
    }
    pub fn signature(&self) -> CcSignature {
        self.signature
    }
    pub fn manifest(&self) -> ReleaseManifest {
        self.manifest
    }
    pub fn integrity(&self) -> ReleaseFileIntegrity {
        self.integrity
    }
    pub fn installation(&self) -> InstallationIdentity {
        self.installation
    }
    pub fn freshness(&self) -> ReleaseFreshness {
        self.freshness
    }

    /// THE reducer. Every gate is independent and forces `Disabled` when unmet; each is written out
    /// so a future phase can relax exactly one under review. In Phase 1B the all-verified path is
    /// UNREACHABLE (no production verifier exists), so this always returns `Disabled` — and even if
    /// every prior gate somehow held, the final owner-approval gate has no granting mechanism this
    /// phase, so `Disabled` is still the only outcome. Readiness/lifecycle are deliberately absent.
    pub fn protected_eligibility(&self) -> ProtectedEligibility {
        // Only a packaged candidate could ever qualify.
        if !matches!(self.execution, ExecutionMode::PackagedCandidate) {
            return ProtectedEligibility::Disabled;
        }
        // Manifest/file verification is meaningless without a verified Control Centre signature.
        if !matches!(self.signature, CcSignature::Verified) {
            return ProtectedEligibility::Disabled;
        }
        // A test-fixture-verified manifest/integrity is NEVER production verification.
        if !matches!(self.channel, ReleaseChannel::SignedProduction) {
            return ProtectedEligibility::Disabled;
        }
        if !matches!(self.manifest, ReleaseManifest::Verified) {
            return ProtectedEligibility::Disabled;
        }
        if !matches!(self.integrity, ReleaseFileIntegrity::Verified) {
            return ProtectedEligibility::Disabled;
        }
        if !matches!(self.installation, InstallationIdentity::PerMachineVerified) {
            return ProtectedEligibility::Disabled;
        }
        if !matches!(self.freshness, ReleaseFreshness::Current) {
            return ProtectedEligibility::Disabled;
        }
        // Unreachable in Phase 1B: no production verifier can set the states above, and there is no
        // owner-approval mechanism. Fail closed regardless.
        ProtectedEligibility::Disabled
    }

    /// The safe, immutable owner-facing projection. No hashes, keys, certificates, paths, registry
    /// data, native errors, or executable details — only closed classifications and one sentence.
    pub fn to_status_view(&self) -> IdentityStatusView {
        let next_safe_action = match self.execution {
            ExecutionMode::Development => {
                "This ProjectOS build is for development. Protected actions are disabled."
            }
            ExecutionMode::TestFixture => {
                "This ProjectOS build is running in test mode. Protected actions are disabled."
            }
            ExecutionMode::PackagedCandidate => {
                "ProjectOS could not verify this installation. Protected actions are disabled."
            }
        };
        // Redacted diagnostics: safe classification tags only.
        let mut diagnostics: Vec<&'static str> = vec![execution_tag(self.execution)];
        if matches!(self.execution, ExecutionMode::PackagedCandidate) {
            diagnostics.push("SIGNATURE_NOT_CHECKED");
        }
        diagnostics.push("RELEASE_FRESHNESS_UNKNOWN");
        diagnostics.push("PROTECTED_DISABLED");

        IdentityStatusView {
            execution_mode: execution_tag(self.execution),
            protected_eligibility: ProtectedEligibility::Disabled,
            read_only_operation_safe: true,
            protected_approvals_disabled: true,
            next_safe_action: next_safe_action.to_string(),
            diagnostics,
        }
    }
}

const fn execution_tag(m: ExecutionMode) -> &'static str {
    match m {
        ExecutionMode::Development => "DEVELOPMENT",
        ExecutionMode::TestFixture => "TEST_FIXTURE",
        ExecutionMode::PackagedCandidate => "PACKAGED_CANDIDATE",
    }
}

/// The immutable owner-safe projection returned by `identity_status`. Serialised as-is; no
/// evaluation, filesystem, environment, or native call happens when producing or reading it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityStatusView {
    pub execution_mode: &'static str,
    /// Always `DISABLED` in this phase.
    pub protected_eligibility: ProtectedEligibility,
    pub read_only_operation_safe: bool,
    /// Always true — no identity or trust exists to enable approvals.
    pub protected_approvals_disabled: bool,
    pub next_safe_action: String,
    /// Redacted safe classification tags only.
    pub diagnostics: Vec<&'static str>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn development_is_disabled_and_labelled() {
        let c = CompositeIdentity::development();
        assert_eq!(c.execution(), ExecutionMode::Development);
        assert_eq!(c.protected_eligibility(), ProtectedEligibility::Disabled);
        let v = c.to_status_view();
        assert_eq!(v.execution_mode, "DEVELOPMENT");
        assert_eq!(
            v.next_safe_action,
            "This ProjectOS build is for development. Protected actions are disabled."
        );
        assert!(v.protected_approvals_disabled);
    }

    #[test]
    fn test_fixture_is_labelled_and_never_production() {
        let c = CompositeIdentity::test_fixture(true, true);
        assert_eq!(c.execution(), ExecutionMode::TestFixture);
        // A consistent fixture is TEST-FIXTURE-verified, NOT production verified.
        assert_eq!(c.manifest(), ReleaseManifest::TestFixtureVerified);
        assert_eq!(c.integrity(), ReleaseFileIntegrity::TestFixtureVerified);
        assert_ne!(c.manifest(), ReleaseManifest::Verified);
        assert_ne!(c.integrity(), ReleaseFileIntegrity::Verified);
        assert_eq!(c.channel(), ReleaseChannel::Unknown);
        assert_ne!(c.channel(), ReleaseChannel::SignedProduction);
        assert_eq!(c.protected_eligibility(), ProtectedEligibility::Disabled);
        assert_eq!(c.to_status_view().execution_mode, "TEST_FIXTURE");
    }

    #[test]
    fn packaged_candidate_is_unverified_and_disabled() {
        let c = CompositeIdentity::packaged_unverified();
        assert_eq!(c.execution(), ExecutionMode::PackagedCandidate);
        assert_eq!(c.signature(), CcSignature::NotChecked);
        assert_ne!(c.signature(), CcSignature::Verified);
        assert_eq!(c.channel(), ReleaseChannel::Unknown);
        assert_ne!(c.channel(), ReleaseChannel::SignedProduction);
        assert_eq!(c.installation(), InstallationIdentity::Unknown);
        assert_eq!(c.freshness(), ReleaseFreshness::Unknown);
        assert_eq!(c.protected_eligibility(), ProtectedEligibility::Disabled);
        assert_eq!(
            c.to_status_view().next_safe_action,
            "ProjectOS could not verify this installation. Protected actions are disabled."
        );
    }

    #[test]
    fn every_constructor_derives_disabled() {
        for c in [
            CompositeIdentity::development(),
            CompositeIdentity::test_fixture(true, true),
            CompositeIdentity::test_fixture(false, false),
            CompositeIdentity::packaged_unverified(),
        ] {
            assert_eq!(
                c.protected_eligibility(),
                ProtectedEligibility::Disabled,
                "Phase 1B must never derive eligibility for {:?}",
                c.execution()
            );
        }
    }

    #[test]
    fn no_constructor_produces_a_signed_production_channel_or_verified_signature() {
        for c in [
            CompositeIdentity::development(),
            CompositeIdentity::test_fixture(true, true),
            CompositeIdentity::packaged_unverified(),
        ] {
            assert_ne!(c.channel(), ReleaseChannel::SignedProduction);
            assert_ne!(c.channel(), ReleaseChannel::SignedStaging);
            assert_ne!(c.signature(), CcSignature::Verified);
            assert_ne!(c.installation(), InstallationIdentity::PerMachineVerified);
            assert_ne!(c.freshness(), ReleaseFreshness::Current);
        }
    }

    #[test]
    fn status_view_leaks_no_identifier() {
        for c in [
            CompositeIdentity::development(),
            CompositeIdentity::test_fixture(true, true),
            CompositeIdentity::packaged_unverified(),
        ] {
            let json = serde_json::to_string(&c.to_status_view()).unwrap();
            let lower = json.to_lowercase();
            for forbidden in [
                "sha",
                "0x",
                "s-1-5",
                "c:\\",
                ".exe",
                "pubkey",
                "thumbprint",
                "cert",
                "mutex",
                "hkey",
                "\\device",
            ] {
                assert!(!lower.contains(forbidden), "leaked {forbidden}: {json}");
            }
        }
    }

    #[test]
    fn status_view_is_stable_across_repeated_projection() {
        let c = CompositeIdentity::packaged_unverified();
        assert_eq!(c.to_status_view(), c.to_status_view());
    }

    /// A hand-built all-verified composite still derives Disabled — the reducer's terminal gate is
    /// fail-closed even if every prior gate were somehow satisfied. (Constructed only in-module
    /// because production callers cannot assemble this combination.)
    #[test]
    fn reducer_is_fail_closed_even_if_all_gates_were_met() {
        let all_verified = CompositeIdentity {
            execution: ExecutionMode::PackagedCandidate,
            channel: ReleaseChannel::SignedProduction,
            signature: CcSignature::Verified,
            manifest: ReleaseManifest::Verified,
            integrity: ReleaseFileIntegrity::Verified,
            installation: InstallationIdentity::PerMachineVerified,
            freshness: ReleaseFreshness::Current,
        };
        assert_eq!(
            all_verified.protected_eligibility(),
            ProtectedEligibility::Disabled,
            "Phase 1B reducer must fail closed at the final gate"
        );
    }
}
