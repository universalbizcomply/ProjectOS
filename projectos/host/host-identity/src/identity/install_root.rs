//! Installation-root derivation + non-authoritative installation classification
//! (WINDOWS-PACKAGED-RUNTIME-IDENTITY2B).
//!
//! The installation root derives ONLY from the verified running Control Centre executable's
//! canonical path (from its retained handle) — never from argv, environment for the path itself,
//! registry, cwd, or package-name assumptions. Classification is corroboration only: registry /
//! Program Files / installer facts can at most reach `PerMachineEvidenceMatched`. `PerMachineVerified`
//! is UNREACHABLE this phase (no authenticated installer attestation exists), and no registry
//! schema is invented as deployed — evidence is supplied through a seam that returns `Unavailable`
//! in production.

#![cfg(windows)]

use super::composite::InstallationIdentity;
use super::running_executable::{ReparseState, RunningExecutable};

/// Corroborating installer/registry evidence for a candidate per-machine root. Advisory only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallationEvidence {
    /// No installer attestation mechanism exists (the production reality this phase).
    Unavailable,
    /// A record was expected but not found.
    Missing,
    /// A record exists but does not match this installation root / application id.
    Mismatched,
    /// A record matches (exercised through deterministic tests only this phase).
    Matched,
}

/// Seam for installer/registry corroboration. Production performs NO registry lookup (no deployed
/// schema); tests inject matching/missing/mismatched evidence.
pub trait InstallationEvidenceProvider {
    fn evidence(&self) -> InstallationEvidence;
}

/// The production provider: no authenticated installer record exists, so evidence is `Unavailable`.
pub struct NoInstallerEvidence;
impl InstallationEvidenceProvider for NoInstallerEvidence {
    fn evidence(&self) -> InstallationEvidence {
        InstallationEvidence::Unavailable
    }
}

/// Known machine/user roots, captured from the environment. Env is used only to LOCATE candidate
/// roots for classification — never as the source of the executable path or of trust.
#[derive(Debug, Clone)]
pub struct KnownRoots {
    program_files: Vec<String>,
    per_user: Vec<String>,
}

fn norm(s: &str) -> String {
    // Strip the `\\?\` / `\\?\UNC\` verbatim prefix for comparison; lowercase; forward-normalise.
    let s = s
        .strip_prefix("\\\\?\\UNC\\")
        .map(|r| format!("\\\\{r}"))
        .unwrap_or_else(|| s.strip_prefix("\\\\?\\").unwrap_or(s).to_string());
    s.replace('/', "\\").to_lowercase()
}

impl KnownRoots {
    pub fn from_env() -> KnownRoots {
        let mut program_files = Vec::new();
        for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Ok(v) = std::env::var(var) {
                if !v.is_empty() {
                    program_files.push(norm(&v));
                }
            }
        }
        let mut per_user = Vec::new();
        for var in ["LOCALAPPDATA", "APPDATA", "USERPROFILE"] {
            if let Ok(v) = std::env::var(var) {
                if !v.is_empty() {
                    per_user.push(norm(&v));
                }
            }
        }
        KnownRoots {
            program_files,
            per_user,
        }
    }

    /// TEST-ONLY explicit roots.
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn for_test(program_files: Vec<&str>, per_user: Vec<&str>) -> KnownRoots {
        KnownRoots {
            program_files: program_files.iter().map(|s| norm(s)).collect(),
            per_user: per_user.iter().map(|s| norm(s)).collect(),
        }
    }
}

/// True if `path` is a UNC / network location (never a verified installation this phase).
fn is_unc(canonical_lower: &str) -> bool {
    canonical_lower.starts_with("\\\\")
}

/// Pure classifier: canonical path (already lower/normalised) + reparse + evidence + roots →
/// installation identity. `PerMachineVerified` is never produced.
pub fn classify_path(
    canonical_lower: &str,
    reparse: ReparseState,
    evidence: InstallationEvidence,
    roots: &KnownRoots,
) -> InstallationIdentity {
    // A reparse point on the executable, or a network root, can never be a verified installation.
    if matches!(reparse, ReparseState::Present) || is_unc(canonical_lower) {
        return InstallationIdentity::Unknown;
    }
    let under = |bases: &[String]| {
        bases
            .iter()
            .any(|b| canonical_lower.starts_with(b.as_str()))
    };

    if under(&roots.per_user) {
        return InstallationIdentity::PerUser;
    }
    if under(&roots.program_files) {
        return match evidence {
            InstallationEvidence::Matched => InstallationIdentity::PerMachineEvidenceMatched,
            _ => InstallationIdentity::PerMachineUnverified,
        };
    }
    // Anywhere else (including removable media): a genuine signed release here stays authentic but
    // installation-unverified and read-only.
    InstallationIdentity::PortableOrCopied
}

/// Classify a real running executable using an evidence provider and env-derived roots.
pub fn classify_installation(
    exe: &RunningExecutable,
    provider: &dyn InstallationEvidenceProvider,
) -> InstallationIdentity {
    let canonical_lower = norm(&exe.canonical_path().to_string_lossy());
    classify_path(
        &canonical_lower,
        exe.reparse(),
        provider.evidence(),
        &KnownRoots::from_env(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots() -> KnownRoots {
        KnownRoots::for_test(
            vec!["C:\\Program Files"],
            vec!["C:\\Users\\murad\\AppData\\Local"],
        )
    }

    #[test]
    fn program_files_without_evidence_is_per_machine_unverified() {
        assert_eq!(
            classify_path(
                &norm("C:\\Program Files\\ProjectOS\\app.exe"),
                ReparseState::None,
                InstallationEvidence::Unavailable,
                &roots()
            ),
            InstallationIdentity::PerMachineUnverified
        );
    }

    #[test]
    fn program_files_with_matched_evidence_is_evidence_matched_not_verified() {
        let got = classify_path(
            &norm("C:\\Program Files\\ProjectOS\\app.exe"),
            ReparseState::None,
            InstallationEvidence::Matched,
            &roots(),
        );
        assert_eq!(got, InstallationIdentity::PerMachineEvidenceMatched);
        assert_ne!(got, InstallationIdentity::PerMachineVerified);
    }

    #[test]
    fn per_user_location_is_per_user() {
        assert_eq!(
            classify_path(
                &norm("C:\\Users\\murad\\AppData\\Local\\ProjectOS\\app.exe"),
                ReparseState::None,
                InstallationEvidence::Unavailable,
                &roots()
            ),
            InstallationIdentity::PerUser
        );
    }

    #[test]
    fn elsewhere_is_portable_or_copied() {
        assert_eq!(
            classify_path(
                &norm("D:\\portable\\ProjectOS\\app.exe"),
                ReparseState::None,
                InstallationEvidence::Matched, // even matched evidence off-root cannot lift it
                &roots()
            ),
            InstallationIdentity::PortableOrCopied
        );
    }

    #[test]
    fn unc_and_reparse_are_unknown() {
        assert_eq!(
            classify_path(
                &norm("\\\\server\\share\\ProjectOS\\app.exe"),
                ReparseState::None,
                InstallationEvidence::Matched,
                &roots()
            ),
            InstallationIdentity::Unknown
        );
        assert_eq!(
            classify_path(
                &norm("C:\\Program Files\\ProjectOS\\app.exe"),
                ReparseState::Present,
                InstallationEvidence::Matched,
                &roots()
            ),
            InstallationIdentity::Unknown
        );
    }

    #[test]
    fn per_machine_verified_is_never_produced() {
        for (p, rp, ev) in [
            (
                "C:\\Program Files\\x\\a.exe",
                ReparseState::None,
                InstallationEvidence::Matched,
            ),
            (
                "C:\\Users\\murad\\AppData\\Local\\x\\a.exe",
                ReparseState::None,
                InstallationEvidence::Matched,
            ),
            (
                "D:\\x\\a.exe",
                ReparseState::None,
                InstallationEvidence::Matched,
            ),
            (
                "\\\\s\\x\\a.exe",
                ReparseState::None,
                InstallationEvidence::Matched,
            ),
        ] {
            assert_ne!(
                classify_path(&norm(p), rp, ev, &roots()),
                InstallationIdentity::PerMachineVerified
            );
        }
    }
}
