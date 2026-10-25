//! Trusted-root verification and the canonical, bounded on-disk layout.
//!
//! Root policy: the caller supplies an EXPLICIT root (a trusted higher layer chooses it — never the
//! cwd, repo, user profile, AppData, ProgramData, network share, or removable drive). Syntax is checked
//! with the accepted `projectos_host_persistence::validate_local_root`; this layer then adds the real
//! filesystem checks that validator explicitly defers (canonicalisation, directory check, symlink/
//! reparse rejection, containment). Record identities map to filenames by HEX encoding — never a raw
//! separator, reserved device name, alternate-data-stream, or secret-derived name; the mapping is
//! deterministic and bounded so a Windows filename never exceeds the limit.

use std::path::{Path, PathBuf};

use projectos_host_persistence::validate_local_root;

use crate::error::DurableStoreError;

/// Maximum record-identity length (bytes). Hex-encoded → ≤200 filename chars + suffix, under the
/// Windows per-component limit.
pub const MAX_RECORD_ID_BYTES: usize = 100;
/// Maximum records the store retains / a recovery scan will enumerate before failing closed.
pub const MAX_RECORDS: usize = 4096;
/// Maximum stale temporary files a recovery scan tolerates before failing closed.
pub const MAX_TEMP_SCAN: usize = 4096;
/// Maximum journal/intent entries retained.
pub const MAX_JOURNAL_ENTRIES: usize = 8192;

const RECORDS_DIR: &str = "records";
const TEMP_DIR: &str = "temp";
const JOURNAL_DIR: &str = "journal";
const LOCK_FILE: &str = "store.lock";
const MANIFEST_FILE: &str = "manifest.pdr";
const RECORD_SUFFIX: &str = ".rec";

/// A verified, canonical trusted root. All store paths derive from it by joining FIXED segments and
/// HEX filenames, so no caller-controlled path segment can escape.
#[derive(Debug, Clone)]
pub struct VerifiedRoot {
    canonical: PathBuf,
}

impl VerifiedRoot {
    /// Verify `input` as a trusted root: strict syntax (accepted validator) then real filesystem
    /// canonicalisation, a directory check, and symlink/reparse rejection of the root.
    ///
    /// # Errors
    /// [`DurableStoreError::InvalidRoot`] on any syntax or filesystem violation.
    pub fn verify(input: &str) -> Result<Self, DurableStoreError> {
        // Strict syntax first (drive-rooted absolute, no `..`/ADS/UNC/URL); never touches disk.
        validate_local_root(input).map_err(|_| DurableStoreError::InvalidRoot)?;
        let raw = Path::new(input);
        // Reject a root reached through a symlink/reparse point (best-effort; race-free handle-based
        // enforcement is a later service-owned duty, documented — unsafe roots fail closed here).
        if is_reparse(raw) {
            return Err(DurableStoreError::InvalidRoot);
        }
        let canonical = std::fs::canonicalize(raw).map_err(|_| DurableStoreError::InvalidRoot)?;
        let meta =
            std::fs::symlink_metadata(&canonical).map_err(|_| DurableStoreError::InvalidRoot)?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(DurableStoreError::InvalidRoot); // a file, or a link, is not an acceptable root
        }
        Ok(Self { canonical })
    }

    /// The canonical root path (used only for lock/replace primitives; never surfaced in errors).
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.canonical
    }

    /// The single-writer lock target.
    #[must_use]
    pub fn lock_path(&self) -> PathBuf {
        self.canonical.join(LOCK_FILE)
    }

    /// The framed-manifest path.
    #[must_use]
    pub fn manifest_path(&self) -> PathBuf {
        self.canonical.join(MANIFEST_FILE)
    }

    /// The records directory.
    #[must_use]
    pub fn records_dir(&self) -> PathBuf {
        self.canonical.join(RECORDS_DIR)
    }

    /// The temp directory (same volume as targets; used for atomic write staging).
    #[must_use]
    pub fn temp_dir(&self) -> PathBuf {
        self.canonical.join(TEMP_DIR)
    }

    /// The journal directory.
    #[must_use]
    pub fn journal_dir(&self) -> PathBuf {
        self.canonical.join(JOURNAL_DIR)
    }

    /// The final path for a record identity (HEX filename under `records/`).
    ///
    /// # Errors
    /// [`DurableStoreError::InvalidInput`] for an invalid identity.
    pub fn record_path(&self, id: &[u8]) -> Result<PathBuf, DurableStoreError> {
        let name = record_filename(id)?;
        Ok(self.records_dir().join(name))
    }

    /// A temp path for staging a write of `id`, disambiguated by `token` (a store-owned counter).
    ///
    /// # Errors
    /// [`DurableStoreError::InvalidInput`] for an invalid identity.
    pub fn temp_path(&self, id: &[u8], token: u64) -> Result<PathBuf, DurableStoreError> {
        let hex = to_hex(id)?;
        Ok(self.temp_dir().join(format!("{hex}.{token}.tmp")))
    }

    /// A temp path for staging the manifest.
    #[must_use]
    pub fn manifest_temp_path(&self, token: u64) -> PathBuf {
        self.temp_dir().join(format!("manifest.{token}.tmp"))
    }

    /// The durable journal-entry path for a given monotonic journal `sequence`. Fixed-width decimal
    /// (u64 max = 20 digits) so lexical order equals numeric order; no separator/secret-derived name.
    #[must_use]
    pub fn journal_entry_path(&self, sequence: u64) -> PathBuf {
        self.journal_dir().join(format!("{sequence:020}.j"))
    }

    /// A temp path for staging a journal entry.
    #[must_use]
    pub fn journal_temp_path(&self, token: u64) -> PathBuf {
        self.temp_dir().join(format!("journal.{token}.tmp"))
    }

    /// Harden the fixed subtree: every fixed directory/file, if it exists, must NOT be a symlink,
    /// junction, or other reparse point, must be the expected type, and must remain beneath the
    /// canonical root. Called on open and revalidated before each mutation. (Individual journal-entry
    /// files are not fixed paths; they are read+integrity-checked during recovery.)
    ///
    /// # Errors
    /// [`DurableStoreError::InvalidRoot`] if any fixed path is redirected or the wrong type.
    pub fn verify_fixed_paths_safe(&self) -> Result<(), DurableStoreError> {
        for dir in [self.records_dir(), self.temp_dir(), self.journal_dir()] {
            check_fixed(&dir, /*want_dir=*/ true)?;
        }
        for file in [self.lock_path(), self.manifest_path()] {
            check_fixed(&file, /*want_dir=*/ false)?;
        }
        Ok(())
    }
}

/// Verify a fixed path (if it exists) is not a reparse point and is the expected type.
fn check_fixed(path: &Path, want_dir: bool) -> Result<(), DurableStoreError> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return Ok(()), // absent is acceptable; it will be created safely
    };
    if is_reparse_meta(&meta) {
        return Err(DurableStoreError::InvalidRoot);
    }
    if want_dir && !meta.is_dir() {
        return Err(DurableStoreError::InvalidRoot);
    }
    if !want_dir && meta.is_dir() {
        return Err(DurableStoreError::InvalidRoot);
    }
    Ok(())
}

/// Validate a record identity: non-empty, bounded, ASCII-graphic (no control/space/separators).
///
/// # Errors
/// [`DurableStoreError::InvalidInput`] on any violation.
pub fn validate_record_id(id: &[u8]) -> Result<(), DurableStoreError> {
    if id.is_empty() || id.len() > MAX_RECORD_ID_BYTES {
        return Err(DurableStoreError::InvalidInput);
    }
    // ASCII graphic only — rejects NUL, control, space, and multibyte; separators/`:`/`.` are graphic
    // but the HEX filename mapping neutralises them, so the on-disk name is always separator-free.
    if !id.iter().all(|b| b.is_ascii_graphic()) {
        return Err(DurableStoreError::InvalidInput);
    }
    Ok(())
}

fn record_filename(id: &[u8]) -> Result<String, DurableStoreError> {
    let hex = to_hex(id)?;
    Ok(format!("{hex}{RECORD_SUFFIX}"))
}

fn to_hex(id: &[u8]) -> Result<String, DurableStoreError> {
    validate_record_id(id)?;
    let mut s = String::with_capacity(id.len() * 2);
    for &b in id {
        s.push(char::from_digit((b >> 4) as u32, 16).unwrap());
        s.push(char::from_digit((b & 0x0f) as u32, 16).unwrap());
    }
    Ok(s)
}

/// Whether `path` (as given, without canonicalisation) is a symlink/junction/reparse point.
fn is_reparse(path: &Path) -> bool {
    match std::fs::symlink_metadata(path) {
        Ok(meta) => is_reparse_meta(&meta),
        // Non-existent is not a reparse point; existence/creation is handled by the caller.
        Err(_) => false,
    }
}

/// Whether the metadata denotes a symlink, junction, or other reparse point. On Windows this checks
/// `FILE_ATTRIBUTE_REPARSE_POINT` (0x400), which catches junctions that `is_symlink()` misses.
fn is_reparse_meta(meta: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    meta.file_type().is_symlink()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_root() {
        assert_eq!(
            VerifiedRoot::verify("relative\\path").unwrap_err(),
            DurableStoreError::InvalidRoot
        );
    }

    #[test]
    fn rejects_traversal_root() {
        assert_eq!(
            VerifiedRoot::verify("C:\\a\\..\\b").unwrap_err(),
            DurableStoreError::InvalidRoot
        );
    }

    #[test]
    fn rejects_unc_root() {
        assert_eq!(
            VerifiedRoot::verify("\\\\server\\share").unwrap_err(),
            DurableStoreError::InvalidRoot
        );
    }

    #[test]
    fn record_id_bounds() {
        assert!(validate_record_id(b"rec-1").is_ok());
        assert_eq!(
            validate_record_id(b"").unwrap_err(),
            DurableStoreError::InvalidInput
        );
        assert_eq!(
            validate_record_id(&[b'a'; MAX_RECORD_ID_BYTES + 1]).unwrap_err(),
            DurableStoreError::InvalidInput
        );
        assert_eq!(
            validate_record_id(b"has space").unwrap_err(),
            DurableStoreError::InvalidInput
        );
    }

    #[test]
    fn hex_filename_has_no_separator() {
        let hex = to_hex(b"a/b\\c:d").unwrap();
        assert!(!hex.contains(['/', '\\', ':', '.']));
    }
}
