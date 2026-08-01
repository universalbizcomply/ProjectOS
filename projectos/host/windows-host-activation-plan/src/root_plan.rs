//! The canonical production-root PLAN. Modelled, never resolved and never created.
//!
//! The plan states an ANCHOR (the Windows known folder that must later be resolved through an
//! approved mechanism) plus bounded, validated segments beneath it. No path is resolved here: no
//! known folder is queried, no directory is created, opened, inspected or mutated, and no real
//! machine path is ever produced or rendered. `%PROGRAMDATA%` in this module is a SYMBOL, not a value
//! read from the environment — the environment is never consulted, and an environment variable is
//! never treated as authority.

use crate::error::ActivationPlanError;

/// Maximum characters in one path segment (well under the Windows per-component limit).
const MAX_SEGMENT_CHARS: usize = 64;
/// Maximum segments beneath the anchor.
const MAX_DEPTH: usize = 6;

/// Reserved Windows device names. A segment equal to one of these (with or without an extension) is
/// unusable as a directory name on Windows.
const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// The Windows known folder a production root must be anchored to.
///
/// Recording the ANCHOR — not a path — is the point: the concrete location must be resolved at
/// activation time through an approved Windows known-folder mechanism, never from an environment
/// variable, the current working directory, the repository, or a hardcoded literal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum KnownFolderAnchor {
    /// The machine-wide application-data known folder. The only anchor production STATE may use.
    ProgramData,
    /// The machine-wide program-files known folder. The only anchor the installed service BINARY may
    /// use (CD-B4-INSTALLER-READINESS1A). State never lives here, and this anchor is never a root for
    /// a [`ProductionRootPlan`].
    ProgramFiles,
}

impl KnownFolderAnchor {
    /// A SYMBOLIC label for reports. Never a resolved path, never machine-specific.
    #[must_use]
    pub fn symbol(self) -> &'static str {
        match self {
            Self::ProgramData => "%KNOWNFOLDER:ProgramData%",
            Self::ProgramFiles => "%KNOWNFOLDER:ProgramFiles%",
        }
    }
}

/// A location that may NEVER hold production host state, and why it is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ForbiddenRootKind {
    /// Depends on how the process was launched.
    CurrentWorkingDirectory,
    /// Developer-writable, versioned, and not a deployment location.
    RepositoryPath,
    /// World-writable in practice and subject to cleaners.
    SystemTemporary,
    /// Per-user, roaming or interactive-session scoped.
    UserProfile,
    /// Roams between machines; not machine-wide state.
    AppDataRoaming,
    /// Interactive-user surface, not a service location.
    DesktopOrDocuments,
    /// Not absolute; meaning depends on the caller.
    RelativePath,
    /// Caller-controlled, spoofable, and not an authority.
    EnvironmentVariable,
    /// May be unavailable to a service identity and crosses a trust boundary.
    NetworkOrRemovable,
}

/// Which part of the host's on-disk state a subtree holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[non_exhaustive]
pub enum RootSubtree {
    /// Service-owned host state.
    HostState,
    /// Per-project isolated state.
    ProjectState,
    /// Durable protected records (consumed by the accepted durable store).
    DurableState,
    /// Transaction journal / intents.
    Journal,
    /// Same-volume staging for atomic replacement.
    Staging,
    /// REFERENCES to credentials (identifiers only). Never a secret value.
    CredentialReference,
    /// Reserved for logs IF logging is later authorised. Not authorised by this plan.
    Log,
}

impl RootSubtree {
    /// The fixed segment name this subtree occupies.
    #[must_use]
    pub fn segment(self) -> &'static str {
        match self {
            Self::HostState => "host",
            Self::ProjectState => "projects",
            Self::DurableState => "state",
            Self::Journal => "journal",
            Self::Staging => "staging",
            Self::CredentialReference => "credential-refs",
            Self::Log => "logs",
        }
    }

    /// Whether this plan authorises the subtree yet.
    #[must_use]
    pub fn is_authorised_now(self) -> bool {
        !matches!(self, Self::Log)
    }
}

/// One validated path segment. Construction is the only way to hold one, so an invalid segment
/// cannot exist.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct RootSegment(String);

impl RootSegment {
    /// Validate one segment.
    ///
    /// # Errors
    /// [`ActivationPlanError`] classifying the exact refusal.
    pub fn parse(text: &str) -> Result<Self, ActivationPlanError> {
        if text.is_empty() {
            return Err(ActivationPlanError::EmptySegment);
        }
        if text.len() > MAX_SEGMENT_CHARS {
            return Err(ActivationPlanError::SegmentTooLong);
        }
        if text.starts_with("\\\\?\\") || text.starts_with("\\\\.\\") {
            return Err(ActivationPlanError::DeviceNamespace);
        }
        if text.starts_with("\\\\") {
            return Err(ActivationPlanError::UnsupportedUncRoot);
        }
        if text.contains('\\') || text.contains('/') {
            return Err(ActivationPlanError::SeparatorInSegment);
        }
        if text == "." || text == ".." {
            return Err(ActivationPlanError::TraversalSegment);
        }
        if text.contains(':') {
            // `name:stream` — an alternate data stream, and a drive-qualified segment.
            return Err(ActivationPlanError::AlternateDataStream);
        }
        if text.chars().any(|c| {
            matches!(c, '<' | '>' | '"' | '|' | '?' | '*') || (c as u32) < 0x20 || !c.is_ascii()
        }) {
            return Err(ActivationPlanError::InvalidSegmentCharacter);
        }
        if text.ends_with('.') || text.ends_with(' ') || text.starts_with(' ') {
            // Windows silently strips these, so two distinct plans could name one directory.
            return Err(ActivationPlanError::InvalidSegmentCharacter);
        }
        let stem = text.split('.').next().unwrap_or(text).to_ascii_uppercase();
        if RESERVED.contains(&stem.as_str()) {
            return Err(ActivationPlanError::ReservedName);
        }
        Ok(Self(text.to_string()))
    }

    /// The validated text.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Classify a MODELLED root string as a forbidden location.
///
/// Pure string classification: it touches no filesystem, resolves nothing, and reads no environment.
/// It exists so a plan review can refuse an unacceptable location before anything is built.
#[must_use]
pub fn classify_forbidden(text: &str) -> Option<ForbiddenRootKind> {
    let lower = text.to_ascii_lowercase();
    if text.contains('%') || lower.contains("$env:") || lower.contains("${") {
        return Some(ForbiddenRootKind::EnvironmentVariable);
    }
    if lower.starts_with("\\\\") {
        return Some(ForbiddenRootKind::NetworkOrRemovable);
    }
    // Not drive-rooted absolute.
    let b = text.as_bytes();
    if b.len() < 3 || !b[0].is_ascii_alphabetic() || b[1] != b':' || (b[2] != b'\\' && b[2] != b'/')
    {
        return Some(ForbiddenRootKind::RelativePath);
    }
    if lower.contains("\\temp") || lower.contains("\\tmp") || lower.contains("\\windows\\temp") {
        return Some(ForbiddenRootKind::SystemTemporary);
    }
    if lower.contains("\\appdata\\roaming") {
        return Some(ForbiddenRootKind::AppDataRoaming);
    }
    if lower.contains("\\desktop") || lower.contains("\\documents") {
        return Some(ForbiddenRootKind::DesktopOrDocuments);
    }
    if lower.contains("\\users\\") || lower.contains("\\appdata") {
        return Some(ForbiddenRootKind::UserProfile);
    }
    if lower.contains("\\dev\\") || lower.contains("\\src\\") || lower.contains("\\repos\\") {
        return Some(ForbiddenRootKind::RepositoryPath);
    }
    None
}

/// The planned production root: an anchor, bounded segments, and the subtrees beneath it.
///
/// Immutable after construction. Holds no resolved path and no machine identity.
#[derive(Clone, PartialEq, Eq)]
pub struct ProductionRootPlan {
    anchor: KnownFolderAnchor,
    segments: Vec<RootSegment>,
    subtrees: Vec<RootSubtree>,
}

impl core::fmt::Debug for ProductionRootPlan {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // Renders the SYMBOLIC path, so a plan in a report is self-evidently unresolved: the anchor
        // is a symbol and no machine location can appear.
        f.debug_struct("ProductionRootPlan")
            .field("path", &self.symbolic_path())
            .field("subtrees", &self.subtrees)
            .finish()
    }
}

impl ProductionRootPlan {
    /// Build the plan from an anchor, the segments beneath it, and the subtrees it will contain.
    ///
    /// # Errors
    /// [`ActivationPlanError`] if any segment is invalid, the depth is exceeded, or two subtrees
    /// collide.
    pub fn new(
        anchor: KnownFolderAnchor,
        segments: &[&str],
        subtrees: &[RootSubtree],
    ) -> Result<Self, ActivationPlanError> {
        // A production ROOT holds state, and state only ever lives beneath ProgramData. Program Files
        // is an anchor for the installed binary and can never become a state root.
        if !matches!(anchor, KnownFolderAnchor::ProgramData) {
            return Err(ActivationPlanError::StateAnchorNotProgramData);
        }
        if segments.is_empty() || segments.len() > MAX_DEPTH {
            return Err(ActivationPlanError::SegmentTooLong);
        }
        let mut parsed = Vec::with_capacity(segments.len());
        for s in segments {
            parsed.push(RootSegment::parse(s)?);
        }
        let mut ordered: Vec<RootSubtree> = subtrees.to_vec();
        ordered.sort_unstable();
        let before = ordered.len();
        ordered.dedup();
        if ordered.len() != before {
            return Err(ActivationPlanError::NamespaceCollision);
        }
        // Two subtrees may never occupy the same segment name.
        let mut names: Vec<&str> = ordered.iter().map(|s| s.segment()).collect();
        names.sort_unstable();
        let n = names.len();
        names.dedup();
        if names.len() != n {
            return Err(ActivationPlanError::NamespaceCollision);
        }
        Ok(Self {
            anchor,
            segments: parsed,
            subtrees: ordered,
        })
    }

    /// The canonical ProjectOS production-root plan.
    ///
    /// # Errors
    /// [`ActivationPlanError`] only if the canonical constants were edited into an invalid shape,
    /// which the unit tests pin.
    pub fn canonical() -> Result<Self, ActivationPlanError> {
        Self::new(
            KnownFolderAnchor::ProgramData,
            &["ProjectOS"],
            &[
                RootSubtree::HostState,
                RootSubtree::ProjectState,
                RootSubtree::DurableState,
                RootSubtree::Journal,
                RootSubtree::Staging,
                RootSubtree::CredentialReference,
            ],
        )
    }

    /// The anchor that must later be resolved through an approved known-folder mechanism.
    #[must_use]
    pub fn anchor(&self) -> KnownFolderAnchor {
        self.anchor
    }

    /// The validated segments beneath the anchor.
    #[must_use]
    pub fn segments(&self) -> &[RootSegment] {
        &self.segments
    }

    /// The planned subtrees.
    #[must_use]
    pub fn subtrees(&self) -> &[RootSubtree] {
        &self.subtrees
    }

    /// A SYMBOLIC rendering for reports: anchor symbol plus planned segments.
    ///
    /// This is never a real path — the anchor is unresolved by construction, so nothing here can
    /// disclose a machine location.
    #[must_use]
    pub fn symbolic_path(&self) -> String {
        let mut out = self.anchor.symbol().to_string();
        for s in &self.segments {
            out.push('\\');
            out.push_str(s.as_str());
        }
        out
    }

    /// Whether a subtree is part of this plan AND authorised now.
    #[must_use]
    pub fn includes(&self, subtree: RootSubtree) -> bool {
        self.subtrees.contains(&subtree) && subtree.is_authorised_now()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_canonical_plan_is_anchored_and_symbolic_only() {
        let plan = ProductionRootPlan::canonical().unwrap();
        assert_eq!(plan.anchor(), KnownFolderAnchor::ProgramData);
        assert_eq!(plan.symbolic_path(), "%KNOWNFOLDER:ProgramData%\\ProjectOS");
        // No drive letter, so no resolved machine path can have leaked in.
        assert!(!plan.symbolic_path().contains(":\\"));
        assert!(plan.includes(RootSubtree::HostState));
        assert!(plan.includes(RootSubtree::DurableState));
        assert!(plan.includes(RootSubtree::CredentialReference));
    }

    #[test]
    fn logging_is_modelled_but_not_authorised_yet() {
        let plan = ProductionRootPlan::canonical().unwrap();
        assert!(!plan.includes(RootSubtree::Log));
        assert!(!RootSubtree::Log.is_authorised_now());
    }

    #[test]
    fn invalid_segments_are_classified_exactly() {
        for (input, expected) in [
            ("", ActivationPlanError::EmptySegment),
            ("a\\b", ActivationPlanError::SeparatorInSegment),
            ("a/b", ActivationPlanError::SeparatorInSegment),
            ("..", ActivationPlanError::TraversalSegment),
            (".", ActivationPlanError::TraversalSegment),
            ("name:stream", ActivationPlanError::AlternateDataStream),
            ("\\\\?\\C", ActivationPlanError::DeviceNamespace),
            ("\\\\.\\C", ActivationPlanError::DeviceNamespace),
            ("\\\\server", ActivationPlanError::UnsupportedUncRoot),
            ("CON", ActivationPlanError::ReservedName),
            ("nul.txt", ActivationPlanError::ReservedName),
            ("COM1", ActivationPlanError::ReservedName),
            ("bad|name", ActivationPlanError::InvalidSegmentCharacter),
            ("bad*name", ActivationPlanError::InvalidSegmentCharacter),
            ("trailing.", ActivationPlanError::InvalidSegmentCharacter),
            ("trailing ", ActivationPlanError::InvalidSegmentCharacter),
            ("naïve", ActivationPlanError::InvalidSegmentCharacter),
        ] {
            assert_eq!(
                RootSegment::parse(input).unwrap_err(),
                expected,
                "segment {input:?} must be classified exactly"
            );
        }
        assert!(RootSegment::parse("ProjectOS").is_ok());
    }

    #[test]
    fn an_over_long_segment_and_an_over_deep_plan_are_refused() {
        let long = "a".repeat(MAX_SEGMENT_CHARS + 1);
        assert_eq!(
            RootSegment::parse(&long).unwrap_err(),
            ActivationPlanError::SegmentTooLong
        );
        let deep = ["a"; MAX_DEPTH + 1];
        assert_eq!(
            ProductionRootPlan::new(KnownFolderAnchor::ProgramData, &deep, &[]).unwrap_err(),
            ActivationPlanError::SegmentTooLong
        );
        assert_eq!(
            ProductionRootPlan::new(KnownFolderAnchor::ProgramData, &[], &[]).unwrap_err(),
            ActivationPlanError::SegmentTooLong
        );
    }

    #[test]
    fn duplicate_subtrees_are_a_namespace_collision() {
        assert_eq!(
            ProductionRootPlan::new(
                KnownFolderAnchor::ProgramData,
                &["ProjectOS"],
                &[RootSubtree::HostState, RootSubtree::HostState],
            )
            .unwrap_err(),
            ActivationPlanError::NamespaceCollision
        );
    }

    #[test]
    fn every_subtree_occupies_a_distinct_segment() {
        let all = [
            RootSubtree::HostState,
            RootSubtree::ProjectState,
            RootSubtree::DurableState,
            RootSubtree::Journal,
            RootSubtree::Staging,
            RootSubtree::CredentialReference,
            RootSubtree::Log,
        ];
        let mut names: Vec<&str> = all.iter().map(|s| s.segment()).collect();
        names.sort_unstable();
        let n = names.len();
        names.dedup();
        assert_eq!(names.len(), n, "subtree segments must be unique");
        for s in all {
            assert!(RootSegment::parse(s.segment()).is_ok());
        }
    }

    #[test]
    fn forbidden_root_locations_are_classified() {
        for (input, expected) in [
            (
                "%PROGRAMDATA%\\ProjectOS",
                ForbiddenRootKind::EnvironmentVariable,
            ),
            (
                "$env:ProgramData\\X",
                ForbiddenRootKind::EnvironmentVariable,
            ),
            ("\\\\server\\share", ForbiddenRootKind::NetworkOrRemovable),
            ("relative\\path", ForbiddenRootKind::RelativePath),
            (".\\here", ForbiddenRootKind::RelativePath),
            ("C:\\Windows\\Temp\\x", ForbiddenRootKind::SystemTemporary),
            (
                "C:\\Users\\someone\\AppData\\Roaming\\X",
                ForbiddenRootKind::AppDataRoaming,
            ),
            (
                "C:\\Users\\someone\\Desktop\\X",
                ForbiddenRootKind::DesktopOrDocuments,
            ),
            ("C:\\Users\\someone\\X", ForbiddenRootKind::UserProfile),
            ("C:\\dev\\ProjectOS", ForbiddenRootKind::RepositoryPath),
        ] {
            assert_eq!(
                classify_forbidden(input),
                Some(expected),
                "{input:?} must be refused as a production root"
            );
        }
        // A drive-rooted machine-wide location is not classified as forbidden by SHAPE — but it is
        // still never CREATED here, and the anchor, not a literal, remains the authority.
        assert_eq!(classify_forbidden("C:\\ProgramData\\ProjectOS"), None);
    }
}

#[cfg(test)]
mod program_files_anchor_tests {
    use super::*;

    #[test]
    fn program_files_can_never_become_a_state_root() {
        assert_eq!(
            ProductionRootPlan::new(
                KnownFolderAnchor::ProgramFiles,
                &["ProjectOS"],
                &[RootSubtree::HostState]
            )
            .unwrap_err(),
            ActivationPlanError::StateAnchorNotProgramData
        );
    }

    #[test]
    fn each_anchor_has_a_distinct_symbolic_label_and_no_resolved_path() {
        assert_eq!(
            KnownFolderAnchor::ProgramFiles.symbol(),
            "%KNOWNFOLDER:ProgramFiles%"
        );
        assert_ne!(
            KnownFolderAnchor::ProgramData.symbol(),
            KnownFolderAnchor::ProgramFiles.symbol()
        );
        for a in [
            KnownFolderAnchor::ProgramData,
            KnownFolderAnchor::ProgramFiles,
        ] {
            assert!(a.symbol().starts_with("%KNOWNFOLDER:"));
            assert!(!a.symbol().contains(":\\"));
        }
    }
}
