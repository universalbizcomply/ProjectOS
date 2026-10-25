//! Build-derived application-mode classification (extracted from PROJECTOS-WINDOWS-PROCESS-OWNERSHIP1B).
//!
//! CLASSIFICATION ONLY. [`AppMode`] labels how the application was started, derived from build facts;
//! it grants no authority, launches nothing, and refuses nothing. Launch-authority decisions
//! (`DaemonLaunchAuthority`, `resolve_launch_authority`) deliberately remain in the Control Center
//! process layer and are NOT part of this primitive.

/// How the application was started. Determined from build/packaging facts, never from an
/// environment variable, CLI flag, React payload, or working-directory name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppMode {
    /// Running from a development tree. Always `DEVELOPMENT_UNVERIFIED`.
    Development,
    /// Running from a packaged installation. Requires verified packaged identity — unavailable.
    PackagedCandidate,
}

/// Detect the application mode from packaging facts only.
///
/// A development build is `debug_assertions`. A release build is treated as a packaged candidate,
/// which fails closed until packaged identity exists. Nothing here reads an env var, CLI flag,
/// React payload, or directory name. It selects no authority — it only classifies.
#[must_use]
pub fn detect_app_mode() -> AppMode {
    if cfg!(debug_assertions) {
        AppMode::Development
    } else {
        AppMode::PackagedCandidate
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_app_mode_is_not_ambient() {
        // The decision comes from the build, NEVER from an env var a caller could set: with a hostile
        // env var present, the result is still exactly the build-derived value — Development in a
        // debug build, PackagedCandidate in a release build.
        let build_derived = if cfg!(debug_assertions) {
            AppMode::Development
        } else {
            AppMode::PackagedCandidate
        };
        std::env::set_var("PROJECTOS_MODE", "production");
        assert_eq!(detect_app_mode(), build_derived);
        std::env::remove_var("PROJECTOS_MODE");
    }

    #[test]
    fn app_mode_has_exactly_two_distinct_classifications() {
        assert_ne!(AppMode::Development, AppMode::PackagedCandidate);
    }
}
