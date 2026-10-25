//! Shared bounded-validation helpers reused by every DTO family. All bounds are explicit; no field
//! is validated by name alone. Identity validation reuses the `projectos-host-core` /
//! `projectos-trust-contract` rule (`validate_bounded_id`) so persistence introduces no duplicate
//! identity meaning.

use projectos_host_core::validate_bounded_id;

use crate::error::PersistError;

/// Maximum accepted JSON document size (bytes) enforced BEFORE deserialisation. This bounds the
/// PARSER INTAKE only; it does not bound future filesystem-read allocation (that control belongs to
/// the future transactional store adapter). 512 KiB comfortably exceeds the max hex ciphertext plus
/// all metadata.
pub const MAX_DOCUMENT_BYTES: usize = 524_288;

/// Reject an oversized input before any deserialisation runs. Never echoes the input.
///
/// # Errors
/// [`PersistError::DocumentTooLarge`] if `bytes` exceeds [`MAX_DOCUMENT_BYTES`].
pub fn check_intake(bytes: &[u8]) -> Result<(), PersistError> {
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(PersistError::DocumentTooLarge);
    }
    Ok(())
}

/// Max length (bytes) for a bounded free-text field (e.g. a redacted summary or a local root).
pub const MAX_TEXT_LEN: usize = 512;
/// Max length (chars) for a hex-encoded metadata field (nonce/tag/digest).
pub const MAX_HEX_META_LEN: usize = 256;
/// Max length (chars) for a hex-encoded ciphertext field (~128 KiB of ciphertext).
pub const MAX_HEX_CIPHERTEXT_LEN: usize = 262_144;
/// Max entries in a bounded collection (permitted operations, evidence refs, stop lists, etc.).
pub const MAX_COLLECTION: usize = 32;

/// Validate a bounded identifier via the shared core rule (non-empty, ≤128, ASCII-graphic, no
/// path/URL separators).
///
/// # Errors
/// [`PersistError::InvalidIdentifier`] on any violation.
pub fn validate_id(s: &str) -> Result<(), PersistError> {
    validate_bounded_id(s).map_err(|_| PersistError::InvalidIdentifier)
}

/// Validate a hex-encoded field: non-empty, within `max`, all ASCII hex digits.
///
/// # Errors
/// [`PersistError::InvalidHex`] on any violation.
pub fn validate_hex(s: &str, max: usize) -> Result<(), PersistError> {
    if s.is_empty() || s.len() > max || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(PersistError::InvalidHex);
    }
    Ok(())
}

/// Validate a bounded free-text field: within [`MAX_TEXT_LEN`], no control characters. May contain
/// spaces (a redacted summary or a local path is legitimate data — but never a secret; redaction is
/// a service duty enforced before this layer).
///
/// # Errors
/// [`PersistError::InvalidText`] on any violation.
pub fn validate_text(s: &str) -> Result<(), PersistError> {
    if s.len() > MAX_TEXT_LEN || s.chars().any(|c| c.is_control()) {
        return Err(PersistError::InvalidText);
    }
    Ok(())
}

/// Literal secret markers rejected in a redacted free-text field (lower-cased scan). These are
/// assignment/prefix/header forms, NOT bare words, so redaction placeholders like `SECRET_REDACTED`
/// and `TOKEN_REDACTED` (which contain the words `secret`/`token` but not `secret=`/`token=`) pass.
const SECRET_MARKERS: &[&str] = &[
    "ghp_",
    "github_pat_",
    "sbp_",
    "sk_live_",
    "sk_test_",
    "service_role",
    "-----begin",
    "bearer ",
    "authorization:",
    "password=",
    "password:",
    "secret=",
    "token=",
    "apikey=",
    "api_key=",
];

/// Validate a bounded, redacted free-text field — DEFENCE IN DEPTH only. Bounded (≤[`MAX_TEXT_LEN`]),
/// no control characters, and rejects obvious raw-credential / bearer-token / JWT-shaped /
/// private-key / password-assignment / credential-bearing-URL patterns. Redaction placeholders
/// (`TOKEN_REDACTED`, `SECRET_REDACTED`, `CREDENTIAL_REDACTED`, `URL_PLACEHOLDER`,
/// `PROJECT_REF_PLACEHOLDER`) pass. This is NOT perfect secret detection: upstream service redaction
/// and future output redaction remain mandatory, and arbitrary high-entropy secrets cannot always be
/// identified by pattern. The error is fieldless and never echoes the rejected content.
///
/// # Errors
/// [`PersistError::InvalidText`] on any bound violation or matched pattern.
pub fn validate_redacted_text(s: &str) -> Result<(), PersistError> {
    if s.len() > MAX_TEXT_LEN || s.chars().any(|c| c.is_control()) {
        return Err(PersistError::InvalidText);
    }
    let lower = s.to_ascii_lowercase();
    if SECRET_MARKERS.iter().any(|m| lower.contains(m)) {
        return Err(PersistError::InvalidText);
    }
    // JWT-shaped: a whitespace-delimited token starting `eyJ` and containing a dot separator.
    if s.split_whitespace()
        .any(|w| w.len() > 20 && w.starts_with("eyJ") && w.contains('.'))
    {
        return Err(PersistError::InvalidText);
    }
    // Credential-bearing URL: `scheme://user:pass@host` — a `user:...@` authority after `://`.
    let mut rest = s;
    while let Some(pos) = rest.find("://") {
        let after = &rest[pos + 3..];
        let authority = after.split('/').next().unwrap_or(after);
        if authority.contains('@') && authority.contains(':') {
            return Err(PersistError::InvalidText);
        }
        rest = after;
    }
    Ok(())
}

/// Redaction placeholders — valid inside redacted narrative text, but NEVER valid as an identity
/// (repository remote or local root).
const REDACTION_PLACEHOLDERS: &[&str] = &[
    "TOKEN_REDACTED",
    "SECRET_REDACTED",
    "CREDENTIAL_REDACTED",
    "URL_PLACEHOLDER",
    "PROJECT_REF_PLACEHOLDER",
];

/// Validate an approved repository-remote identifier. STRICT DTO SYNTAX ONLY — this is not live
/// repository verification or authority; runtime verification is a future Host Service /
/// Windows-repository-adapter duty. Supports the HTTPS Git remote form ProjectOS uses
/// (`https://host/org/repo` with an optional `.git` suffix). SSH/scp-style remotes are deliberately
/// NOT supported (no ProjectOS-config evidence justifies them; the only occurrences are third-party
/// `node_modules` package URLs). No credential/userinfo, query, fragment, path, or placeholder.
///
/// # Errors
/// [`PersistError::InvalidRepositoryRemote`] on any violation.
pub fn validate_repository_remote(s: &str) -> Result<(), PersistError> {
    let err = || PersistError::InvalidRepositoryRemote;
    if s.is_empty() || s.len() > MAX_TEXT_LEN {
        return Err(err());
    }
    if s != s.trim() || s.chars().any(|c| c.is_control()) {
        return Err(err());
    }
    if REDACTION_PLACEHOLDERS.iter().any(|p| s.contains(p)) {
        return Err(err());
    }
    // Only HTTPS; reject userinfo/query/fragment.
    let rest = s.strip_prefix("https://").ok_or_else(err)?;
    if rest.contains('@') || rest.contains('?') || rest.contains('#') {
        return Err(err());
    }
    let mut parts = rest.split('/');
    let host = parts.next().ok_or_else(err)?;
    if host.is_empty()
        || !host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        || !host.contains('.')
    {
        return Err(err());
    }
    // Require at least org/repo, each a bounded path token; a trailing `.git` on the last is allowed.
    let segments: Vec<&str> = parts.filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 {
        return Err(err());
    }
    for seg in &segments {
        if !seg
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        {
            return Err(err());
        }
    }
    Ok(())
}

/// Validate a permitted-local-root descriptor. STRICT DTO SYNTAX ONLY — no filesystem
/// canonicalisation, existence check, final-path resolution, case-normalisation, symlink/junction/
/// reparse-point/ACL/containment check (all future Windows service-adapter duties). Requires a
/// drive-rooted absolute Windows path (`X:\seg\seg…`). Rejects relative paths, `.`/`..` segments,
/// alternate-data-stream (`:` in a segment), UNC/device (`\\…`) forms, URL schemes, placeholders,
/// and control/whitespace.
///
/// # Errors
/// [`PersistError::InvalidLocalRoot`] on any violation.
pub fn validate_local_root(s: &str) -> Result<(), PersistError> {
    let err = || PersistError::InvalidLocalRoot;
    if s.is_empty() || s.len() > MAX_TEXT_LEN {
        return Err(err());
    }
    if s != s.trim() || s.chars().any(|c| c.is_control()) {
        return Err(err());
    }
    if REDACTION_PLACEHOLDERS.iter().any(|p| s.contains(p)) {
        return Err(err());
    }
    if s.contains("://") || s.contains('/') {
        return Err(err()); // URL scheme or POSIX/forward-slash form.
    }
    let bytes = s.as_bytes();
    // Drive-rooted: letter ':' '\' — rejects relative paths and `\\` UNC/device forms.
    if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || bytes[2] != b'\\' {
        return Err(err());
    }
    let tail = &s[3..];
    for seg in tail.split('\\').filter(|s| !s.is_empty()) {
        if seg == "." || seg == ".." || seg.contains(':') {
            return Err(err()); // dot/dotdot traversal or alternate-data-stream.
        }
    }
    Ok(())
}

/// Validate a bounded collection of identifiers: count ≤ [`MAX_COLLECTION`], each a valid id, no
/// duplicates.
///
/// # Errors
/// [`PersistError::InvalidCollection`] for count/duplicate; [`PersistError::InvalidIdentifier`] for a
/// malformed entry.
pub fn validate_id_collection(items: &[String]) -> Result<(), PersistError> {
    if items.len() > MAX_COLLECTION {
        return Err(PersistError::InvalidCollection);
    }
    for (i, item) in items.iter().enumerate() {
        validate_id(item)?;
        if items[..i].contains(item) {
            return Err(PersistError::InvalidCollection);
        }
    }
    Ok(())
}

/// A required revision must be non-zero.
///
/// # Errors
/// [`PersistError::InvalidRevision`] if zero.
pub fn require_nonzero_revision(rev: u64) -> Result<(), PersistError> {
    if rev == 0 {
        Err(PersistError::InvalidRevision)
    } else {
        Ok(())
    }
}
