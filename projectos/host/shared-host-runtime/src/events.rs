//! The typed, redacted runtime event contract.
//!
//! The future runtime surfaces state changes ONLY as [`HostRuntimeEvent`] values. Raw child-process
//! stdout/stderr, raw JSON, and free-form strings can never reach a public event: the only text a
//! diagnostic can carry is a [`RedactedRuntimeMessage`], which is either a closed [`DiagnosticCode`]
//! or a crate-private, length-bounded, pattern-validated string. Nothing in this module launches a
//! process, opens a channel to one, or claims a runtime exists.

/// A SAFE classification of which role became authoritative. It is a label only — it carries no
/// capability and cannot be turned into a role or an authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RoleClass {
    /// The non-authoritative Control Center client.
    ControlCenterClient,
    /// The interactive fallback authority (not available in this phase).
    InteractiveFallback,
    /// The installed service authority (not available in this phase).
    InstalledService,
}

/// Closed set of diagnostic reasons. Preferred over free text: a code cannot leak a path, SID,
/// token, credential, machine name or user name because it carries none.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum DiagnosticCode {
    /// Configuration could not be loaded.
    ConfigurationUnavailable,
    /// Runtime identity or publisher trust was rejected.
    IdentityRejected,
    /// Host authority could not be established.
    AuthorityUnavailable,
    /// Authenticated local IPC could not be bound.
    IpcUnavailable,
    /// A stop request did not complete within its bound.
    ShutdownTimedOut,
    /// A reason that has no more specific closed code.
    Unspecified,
}

/// The maximum length of a validated redacted diagnostic string.
pub const MAX_DIAGNOSTIC_LEN: usize = 200;

/// The longest run of consecutive alphanumerics tolerated in a validated diagnostic string. A longer
/// run is treated as token/credential/hash-like and rejected.
///
/// Reserved future-internal seam: in this contract-only phase a `RedactedRuntimeMessage` is always
/// constructed from a closed code, so the validated-text path is exercised only by the unit tests
/// (which prove it rejects unsafe content). It is retained now so the redaction contract is frozen.
#[allow(dead_code)]
const MAX_ALNUM_RUN: usize = 24;

/// A bounded, redacted diagnostic message.
///
/// It is either a closed [`DiagnosticCode`] or a crate-private, validated, length-bounded string.
/// There is NO public constructor accepting arbitrary text, no public `String`/`Vec<u8>` field, and
/// no `serde_json` anywhere. `Debug` reveals only the classification, never the stored characters,
/// and there is deliberately no `Display`.
#[derive(Clone, PartialEq, Eq)]
pub struct RedactedRuntimeMessage {
    repr: Repr,
}

#[derive(Clone, PartialEq, Eq)]
enum Repr {
    /// A closed, always-safe code.
    Code(DiagnosticCode),
    /// A crate-private validated string. Private so no caller can read the raw characters back out.
    /// Reserved future-internal seam (see [`RedactedRuntimeMessage::try_from_validated_text`]); in
    /// this phase every message is code-based, so it is constructed only under test.
    #[allow(dead_code)]
    Redacted(String),
}

impl RedactedRuntimeMessage {
    /// Build a redacted message from a closed diagnostic code. The one public constructor — it
    /// accepts no free text, so it can leak nothing.
    #[must_use]
    pub fn from_code(code: DiagnosticCode) -> Self {
        Self {
            repr: Repr::Code(code),
        }
    }

    /// CRATE-PRIVATE validated text constructor for future internal use. Returns `None` unless the
    /// input is non-empty, within [`MAX_DIAGNOSTIC_LEN`], free of path/SID/token-like content and of
    /// control characters other than a plain space. No public route reaches this.
    ///
    /// Reserved future-internal seam: exercised only by the unit tests in this phase (a message is
    /// otherwise always code-based), retained so the redaction contract is frozen now.
    #[must_use]
    #[allow(dead_code)]
    pub(crate) fn try_from_validated_text(text: &str) -> Option<Self> {
        if text.is_empty() || text.len() > MAX_DIAGNOSTIC_LEN {
            return None;
        }
        // Only a conservative safe alphabet — anything with `:` `\` `/` (path), `@`, quotes, etc. is
        // rejected because those characters are simply not allowed.
        let allowed = |c: char| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-');
        if !text.chars().all(allowed) {
            return None;
        }
        // Explicit SID prefix rejection (its characters are otherwise in the safe alphabet).
        if text.contains("S-1-") {
            return None;
        }
        // Reject a long unbroken alphanumeric run (token / hash / key-like).
        let mut run = 0usize;
        for c in text.chars() {
            if c.is_ascii_alphanumeric() {
                run += 1;
                if run > MAX_ALNUM_RUN {
                    return None;
                }
            } else {
                run = 0;
            }
        }
        Some(Self {
            repr: Repr::Redacted(text.to_string()),
        })
    }

    /// The closed code, if this message is code-based.
    #[must_use]
    pub fn code(&self) -> Option<DiagnosticCode> {
        match self.repr {
            Repr::Code(c) => Some(c),
            Repr::Redacted(_) => None,
        }
    }

    /// Whether the message is within the bounded representation. Always `true` — an out-of-bound
    /// message can never be constructed.
    #[must_use]
    pub fn is_bounded(&self) -> bool {
        match &self.repr {
            Repr::Code(_) => true,
            Repr::Redacted(s) => !s.is_empty() && s.len() <= MAX_DIAGNOSTIC_LEN,
        }
    }
}

impl core::fmt::Debug for RedactedRuntimeMessage {
    /// Reveals only the classification, never the stored characters — so a redacted message cannot
    /// leak through a debug log.
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match &self.repr {
            Repr::Code(c) => f
                .debug_tuple("RedactedRuntimeMessage::Code")
                .field(c)
                .finish(),
            Repr::Redacted(_) => f.write_str("RedactedRuntimeMessage::Redacted(<redacted>)"),
        }
    }
}

/// A typed runtime event. The ONLY public event surface. Raw process output, raw JSON and free-form
/// strings are unrepresentable here.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum HostRuntimeEvent {
    /// The runtime process has begun starting.
    RuntimeStarting,
    /// Runtime identity and publisher trust validated.
    IdentityValidated,
    /// An authority role was acquired. Carries a safe classification only.
    AuthorityAcquired(RoleClass),
    /// The runtime reached its authoritative ready state.
    RuntimeReady,
    /// A fresh redacted snapshot is available (fetched through the typed status/snapshot API).
    SnapshotAvailable,
    /// The runtime is degraded. Carries a redacted reason only.
    RuntimeDegraded(RedactedRuntimeMessage),
    /// A stop has been requested.
    StopRequested,
    /// The runtime has stopped.
    RuntimeStopped,
    /// The runtime fail-closed and refuses to serve. Carries a redacted reason only.
    FatalRefusal(RedactedRuntimeMessage),
    /// A standalone redacted diagnostic.
    RedactedDiagnostic(RedactedRuntimeMessage),
}

/// A fieldless classification of the most recent event, safe to embed in a status snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum EventClass {
    /// [`HostRuntimeEvent::RuntimeStarting`].
    RuntimeStarting,
    /// [`HostRuntimeEvent::IdentityValidated`].
    IdentityValidated,
    /// [`HostRuntimeEvent::AuthorityAcquired`].
    AuthorityAcquired,
    /// [`HostRuntimeEvent::RuntimeReady`].
    RuntimeReady,
    /// [`HostRuntimeEvent::SnapshotAvailable`].
    SnapshotAvailable,
    /// [`HostRuntimeEvent::RuntimeDegraded`].
    RuntimeDegraded,
    /// [`HostRuntimeEvent::StopRequested`].
    StopRequested,
    /// [`HostRuntimeEvent::RuntimeStopped`].
    RuntimeStopped,
    /// [`HostRuntimeEvent::FatalRefusal`].
    FatalRefusal,
    /// [`HostRuntimeEvent::RedactedDiagnostic`].
    RedactedDiagnostic,
}

impl HostRuntimeEvent {
    /// The fieldless classification of this event. Carries no payload — safe for a status snapshot.
    #[must_use]
    pub fn class(&self) -> EventClass {
        match self {
            Self::RuntimeStarting => EventClass::RuntimeStarting,
            Self::IdentityValidated => EventClass::IdentityValidated,
            Self::AuthorityAcquired(_) => EventClass::AuthorityAcquired,
            Self::RuntimeReady => EventClass::RuntimeReady,
            Self::SnapshotAvailable => EventClass::SnapshotAvailable,
            Self::RuntimeDegraded(_) => EventClass::RuntimeDegraded,
            Self::StopRequested => EventClass::StopRequested,
            Self::RuntimeStopped => EventClass::RuntimeStopped,
            Self::FatalRefusal(_) => EventClass::FatalRefusal,
            Self::RedactedDiagnostic(_) => EventClass::RedactedDiagnostic,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_code_message_is_bounded_and_carries_no_text() {
        let m = RedactedRuntimeMessage::from_code(DiagnosticCode::AuthorityUnavailable);
        assert!(m.is_bounded());
        assert_eq!(m.code(), Some(DiagnosticCode::AuthorityUnavailable));
    }

    #[test]
    fn validated_text_rejects_paths_sids_and_tokens() {
        // Path-like (contains ':' and '\').
        assert!(RedactedRuntimeMessage::try_from_validated_text(r"C:\dev\app").is_none());
        // Forward-slash path.
        assert!(RedactedRuntimeMessage::try_from_validated_text("/etc/passwd").is_none());
        // SID-like.
        assert!(RedactedRuntimeMessage::try_from_validated_text("user S-1-5-21-1").is_none());
        // Token/hash-like (long unbroken alphanumeric run).
        let token = "a".repeat(MAX_ALNUM_RUN + 1);
        assert!(RedactedRuntimeMessage::try_from_validated_text(&token).is_none());
        // Control character.
        assert!(RedactedRuntimeMessage::try_from_validated_text("line\nbreak").is_none());
        // Empty / oversized.
        assert!(RedactedRuntimeMessage::try_from_validated_text("").is_none());
        assert!(
            RedactedRuntimeMessage::try_from_validated_text(&"x ".repeat(MAX_DIAGNOSTIC_LEN))
                .is_none()
        );
    }

    #[test]
    fn validated_text_accepts_a_safe_bounded_phrase() {
        let m = RedactedRuntimeMessage::try_from_validated_text("configuration unavailable")
            .expect("safe phrase");
        assert!(m.is_bounded());
        assert_eq!(m.code(), None);
    }

    #[test]
    fn debug_never_reveals_redacted_characters() {
        let m = RedactedRuntimeMessage::try_from_validated_text("secret phrase here").unwrap();
        let shown = format!("{m:?}");
        assert!(shown.contains("<redacted>"));
        assert!(!shown.contains("secret"));
    }

    #[test]
    fn event_class_is_fieldless_and_total() {
        let e = HostRuntimeEvent::FatalRefusal(RedactedRuntimeMessage::from_code(
            DiagnosticCode::IdentityRejected,
        ));
        assert_eq!(e.class(), EventClass::FatalRefusal);
        assert_eq!(
            HostRuntimeEvent::AuthorityAcquired(RoleClass::InstalledService).class(),
            EventClass::AuthorityAcquired
        );
    }
}
