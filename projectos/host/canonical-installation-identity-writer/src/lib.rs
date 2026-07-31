//! THE INSTALLER-ONLY CANONICAL INSTALLATION IDENTITY RECORD WRITER.
//!
//! `host-identity` reads and verifies the record; this crate is the only thing that writes one, and
//! **no runtime crate may depend on it**. That split is the point: the runtime must remain structurally
//! unable to create, repair, rotate or regenerate identity.
//!
//! The record contract itself is REUSED, never duplicated — schema, digest domain and the frozen
//! product / service / relative-path constants all come from `host-identity`.
//!
//! What the writer will not do, by construction:
//! * take a filesystem path from a caller (targets are sealed, and fixture construction is gated);
//! * take the product, service name, executable path, schema version or record digest from a caller;
//! * overwrite, truncate, repair or delete an existing record — a conflicting one is refused intact;
//! * write to the final path directly — bytes land in a sibling temporary and are linked into place.
//!
//! Nothing here resolves or touches real ProgramData or Program Files, applies an ACL, installs a
//! service, elevates, or performs a protected effect.

#![forbid(unsafe_code)]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use projectos_host_identity::canonical_record::{
    compute_record_digest, InstallationIdentityRecordV1, EXPECTED_PRODUCT, EXPECTED_SERVICE_NAME,
    EXPECTED_SERVICE_RELATIVE_PATH, RECORD_FILE_NAME, RECORD_SCHEMA_VERSION,
};

/// The three accepted installation channels. No arbitrary channel string is representable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallationChannel {
    Stable,
    Preview,
    Development,
}

impl InstallationChannel {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Preview => "preview",
            Self::Development => "development",
        }
    }

    /// Parse a channel. Anything outside the three accepted values is refused.
    pub fn parse(s: &str) -> Result<Self, WriteError> {
        match s {
            "stable" => Ok(Self::Stable),
            "preview" => Ok(Self::Preview),
            "development" => Ok(Self::Development),
            _ => Err(WriteError::UnsupportedChannel),
        }
    }
}

/// Exactly 32 lower-case hex characters (128 bits). All-zero is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallationId(String);

/// Exactly 64 lower-case hex characters (SHA-256). All-zero is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseManifestDigest(String);

fn is_lower_hex(s: &str, len: usize) -> bool {
    s.len() == len
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn all_zero(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b == b'0')
}

impl InstallationId {
    /// Validate an already-minted id from the installer boundary.
    pub fn parse(s: &str) -> Result<Self, WriteError> {
        if !is_lower_hex(s, 32) {
            return Err(WriteError::InvalidInstallationId);
        }
        if all_zero(s) {
            return Err(WriteError::InvalidInstallationId);
        }
        Ok(Self(s.to_string()))
    }

    /// Mint a new id from an installation-ID source. The 128 random bits come from the source; the
    /// caller cannot choose them.
    pub fn generate(source: &dyn InstallationIdSource) -> Result<Self, WriteError> {
        let mut buf = [0u8; 16];
        source
            .fill(&mut buf)
            .map_err(|_| WriteError::InstallationIdSourceFailed)?;
        let mut s = String::with_capacity(32);
        for b in buf {
            s.push_str(&format!("{b:02x}"));
        }
        // An all-zero draw is refused rather than accepted: it is indistinguishable from an
        // uninitialised buffer, which is exactly the failure a fail-closed contract must not trust.
        Self::parse(&s)
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl ReleaseManifestDigest {
    pub fn parse(s: &str) -> Result<Self, WriteError> {
        if !is_lower_hex(s, 64) {
            return Err(WriteError::InvalidReleaseDigest);
        }
        if all_zero(s) {
            return Err(WriteError::InvalidReleaseDigest);
        }
        Ok(Self(s.to_string()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Why a source could not produce randomness. Fieldless: no OS status escapes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InstallationIdSourceError;

/// Supplies the 128 random bits for a new installation id.
///
/// Production implementations must draw from an OS CSPRNG. Timestamps, PIDs, user or machine names and
/// pseudo-random generators are all unacceptable, and the production API never accepts a caller-chosen
/// id — only an already-validated [`InstallationId`] minted at the installer boundary.
pub trait InstallationIdSource {
    /// # Errors
    /// [`InstallationIdSourceError`] if the source cannot produce the requested bytes.
    fn fill(&self, buf: &mut [u8; 16]) -> Result<(), InstallationIdSourceError>;
}

/// The PRODUCTION installation-ID source: the Windows CNG system-preferred RNG.
///
/// Compiled only under `installer-windows` and **never invoked in this phase**. It uses the same
/// accepted primitive (`BCryptGenRandom` with `BCRYPT_USE_SYSTEM_PREFERRED_RNG`) as the existing
/// key-source and owner-verification crates, so no second random vocabulary is introduced.
#[cfg(all(windows, feature = "installer-windows"))]
pub struct SystemPreferredInstallationIdSource;

#[cfg(all(windows, feature = "installer-windows"))]
impl InstallationIdSource for SystemPreferredInstallationIdSource {
    fn fill(&self, buf: &mut [u8; 16]) -> Result<(), InstallationIdSourceError> {
        // The unsafe FFI lives in the accepted key-source boundary, not here: this crate forbids
        // unsafe. Wiring the live source to it is carry-forward for the live installer phase, so this
        // fails closed rather than emulating randomness.
        let _ = buf;
        Err(InstallationIdSourceError)
    }
}

/// Where the record will be written. Sealed: no public constructor takes a path, so a caller cannot
/// aim the writer at a repository path, a TEMP sibling, or anywhere else.
#[derive(Debug, Clone)]
pub struct InstallerTarget {
    /// The `<root>/ProjectOS/Host/installation` directory. Derived internally; never caller-supplied.
    installation_dir: PathBuf,
}

impl InstallerTarget {
    /// The final record path inside the target directory.
    #[must_use]
    fn record_path(&self) -> PathBuf {
        self.installation_dir.join(RECORD_FILE_NAME)
    }

    /// FIXTURE-ONLY target beneath a disposable directory the caller already owns.
    ///
    /// The final location is derived internally as
    /// `<owned-fixture-root>/ProjectOS/Host/installation/identity.v1.json` — the caller supplies only
    /// the disposable root, never the record path. Gated on `fixture-writer`, so the default graph has
    /// no target-construction route at all.
    ///
    /// # Errors
    /// [`WriteError`] if the root escapes containment or is a reparse point.
    #[cfg(any(test, feature = "fixture-writer"))]
    pub fn fixture_under(owned_root: &Path) -> Result<Self, WriteError> {
        let root = owned_root
            .canonicalize()
            .map_err(|_| WriteError::TargetUnavailable)?;
        if fs::symlink_metadata(&root)
            .map_err(|_| WriteError::TargetUnavailable)?
            .file_type()
            .is_symlink()
        {
            return Err(WriteError::ReparsePointRefused);
        }
        let dir = root
            .join(EXPECTED_PRODUCT)
            .join("Host")
            .join("installation");
        // Containment: the derived directory must remain beneath the supplied root.
        if !dir.starts_with(&root) {
            return Err(WriteError::ContainmentRefused);
        }
        Ok(Self {
            installation_dir: dir,
        })
    }
}

/// The outcome of a write attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteOutcome {
    /// The record did not exist and was created.
    Written,
    /// An identical record already existed. Nothing was rewritten.
    AlreadyInstalledSameIdentity,
}

/// Why a write was refused. Every variant preserves any prior valid record byte-for-byte.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum WriteError {
    UnsupportedChannel,
    InvalidInstallationId,
    InvalidReleaseDigest,
    InstallationIdSourceFailed,
    /// The target directory could not be prepared or resolved.
    TargetUnavailable,
    /// A reparse point was found on the target boundary.
    ReparsePointRefused,
    /// The derived path escaped its owned root.
    ContainmentRefused,
    /// A record already exists and describes a DIFFERENT identity. Left untouched.
    ConflictingIdentityExists,
    /// A record already exists but cannot be parsed or verified. Left untouched.
    ExistingRecordUnreadable,
    /// The bytes could not be written or made durable.
    WriteFailed,
    /// The temporary file could not be linked into place.
    PublishFailed,
    /// The published bytes did not match the intended canonical bytes.
    VerifyAfterWriteFailed,
    /// The write succeeded but temporary residue could not be removed. Reported, never swallowed.
    CleanupFailed,
}

/// Why canonical JSON was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum CodecError {
    /// Not parseable as JSON at all.
    Malformed,
    /// A required field is missing, of the wrong type, or the schema version is not 1.
    InvalidShape,
    /// The bytes parse but are not the canonical encoding (order, whitespace, unknown or duplicate
    /// fields, or any other alternative spelling of the same record).
    NonCanonical,
}

/// Escape a string for JSON. The record's fields are constrained to hex, fixed identifiers and the
/// three channel words, so this only ever has to handle plain ASCII — but it stays correct regardless.
fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// Serialise a record to CANONICAL V1 JSON bytes: UTF-8, no BOM, compact, no trailing newline, exact
/// field names in exactly the frozen order. Field order is written explicitly here, never delegated to
/// map iteration.
#[must_use]
pub fn to_canonical_json(r: &InstallationIdentityRecordV1) -> Vec<u8> {
    let s = format!(
        concat!(
            "{{\"schema_version\":{},",
            "\"product\":\"{}\",",
            "\"service_name\":\"{}\",",
            "\"installation_id\":\"{}\",",
            "\"channel\":\"{}\",",
            "\"service_relative_path\":\"{}\",",
            "\"release_manifest_digest\":\"{}\",",
            "\"record_digest\":\"{}\"}}"
        ),
        r.schema_version,
        json_escape(&r.product),
        json_escape(&r.service_name),
        json_escape(&r.installation_id),
        json_escape(&r.channel),
        json_escape(&r.service_relative_path),
        json_escape(&r.release_manifest_digest),
        json_escape(&r.record_digest),
    );
    s.into_bytes()
}

/// Parse STRICT canonical V1 JSON.
///
/// The decisive rule: after extracting the eight fields, the record is re-serialised canonically and
/// the result must equal the input bytes exactly. That single comparison rejects unknown fields,
/// duplicate fields, reordered fields, added whitespace, a trailing newline and every other
/// alternative encoding — without needing to enumerate them.
///
/// # Errors
/// [`CodecError`] naming the first failure.
pub fn parse_canonical_json(bytes: &[u8]) -> Result<InstallationIdentityRecordV1, CodecError> {
    let v: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| CodecError::Malformed)?;
    let obj = v.as_object().ok_or(CodecError::InvalidShape)?;
    let s = |k: &str| -> Result<String, CodecError> {
        obj.get(k)
            .and_then(|x| x.as_str())
            .map(str::to_string)
            .ok_or(CodecError::InvalidShape)
    };
    let schema_version = obj
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        .ok_or(CodecError::InvalidShape)?;
    if schema_version != u64::from(RECORD_SCHEMA_VERSION) {
        return Err(CodecError::InvalidShape);
    }
    let record = InstallationIdentityRecordV1 {
        schema_version: RECORD_SCHEMA_VERSION,
        product: s("product")?,
        service_name: s("service_name")?,
        installation_id: s("installation_id")?,
        channel: s("channel")?,
        service_relative_path: s("service_relative_path")?,
        release_manifest_digest: s("release_manifest_digest")?,
        record_digest: s("record_digest")?,
    };
    if to_canonical_json(&record) != bytes {
        return Err(CodecError::NonCanonical);
    }
    Ok(record)
}

/// Build the validated record. Product, service name, executable path and schema version come from the
/// frozen contract; the digest is computed here. None of them is caller-supplied.
fn build_record(
    id: &InstallationId,
    channel: InstallationChannel,
    release: &ReleaseManifestDigest,
) -> InstallationIdentityRecordV1 {
    let mut r = InstallationIdentityRecordV1 {
        schema_version: RECORD_SCHEMA_VERSION,
        product: EXPECTED_PRODUCT.to_string(),
        service_name: EXPECTED_SERVICE_NAME.to_string(),
        installation_id: id.as_str().to_string(),
        channel: channel.as_str().to_string(),
        service_relative_path: EXPECTED_SERVICE_RELATIVE_PATH.to_string(),
        release_manifest_digest: release.as_str().to_string(),
        record_digest: String::new(),
    };
    r.record_digest = compute_record_digest(&r);
    r
}

/// Write the canonical identity record for a new installation.
///
/// Validates every input BEFORE touching the filesystem, then writes to a sibling temporary, flushes,
/// `sync_all`s, closes, and links it into place. Linking (rather than rename) is deliberate: a rename
/// would silently replace an existing record, and this contract must never overwrite one.
///
/// Idempotent: an existing byte-identical record returns [`WriteOutcome::AlreadyInstalledSameIdentity`]
/// without rewriting. A different, malformed or unverifiable record is refused and left intact.
///
/// # Errors
/// [`WriteError`] naming the first failure. Any prior valid record survives byte-for-byte.
pub fn write_identity_record(
    target: &InstallerTarget,
    id: &InstallationId,
    channel: InstallationChannel,
    release: &ReleaseManifestDigest,
) -> Result<WriteOutcome, WriteError> {
    // 1-3. Validate and build BEFORE any filesystem mutation.
    let record = build_record(id, channel, release);
    let intended = to_canonical_json(&record);
    let final_path = target.record_path();

    // Idempotency / conflict: inspect any existing record without modifying it.
    if final_path.exists() {
        return compare_existing(&final_path, &intended);
    }

    // 4. Prepare the directory, then re-check containment and reparse state.
    fs::create_dir_all(&target.installation_dir).map_err(|_| WriteError::TargetUnavailable)?;
    let dir_meta = fs::symlink_metadata(&target.installation_dir)
        .map_err(|_| WriteError::TargetUnavailable)?;
    if dir_meta.file_type().is_symlink() {
        return Err(WriteError::ReparsePointRefused);
    }

    // 5-9. Sibling temporary, exclusive create-new, full write, flush, sync_all, close.
    let temp_path = target
        .installation_dir
        .join(format!("{RECORD_FILE_NAME}.tmp-{}", id.as_str()));
    {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|_| WriteError::WriteFailed)?;
        let wrote = f
            .write_all(&intended)
            .and_then(|()| f.flush())
            .and_then(|()| f.sync_all());
        if wrote.is_err() {
            let _ = fs::remove_file(&temp_path);
            return Err(WriteError::WriteFailed);
        }
    }

    // 10. Publish without overwriting. `hard_link` fails if the destination exists, which is exactly
    // the race behaviour required: a record that appeared meanwhile is never replaced.
    let published = fs::hard_link(&temp_path, &final_path);
    if published.is_err() {
        let _ = fs::remove_file(&temp_path);
        // The final path may now exist because another installer won the race.
        if final_path.exists() {
            return compare_existing(&final_path, &intended);
        }
        return Err(WriteError::PublishFailed);
    }

    // 12. Remove our temporary residue. A cleanup failure is reported, never converted to success.
    let cleanup = fs::remove_file(&temp_path);

    // 11. Confirm the published bytes are exactly what was intended.
    match fs::read(&final_path) {
        Ok(actual) if actual == intended => {
            if cleanup.is_err() {
                return Err(WriteError::CleanupFailed);
            }
            Ok(WriteOutcome::Written)
        }
        _ => Err(WriteError::VerifyAfterWriteFailed),
    }
}

/// Read an existing record and decide idempotent-success vs conflict. Never modifies it.
fn compare_existing(final_path: &Path, intended: &[u8]) -> Result<WriteOutcome, WriteError> {
    let existing = fs::read(final_path).map_err(|_| WriteError::ExistingRecordUnreadable)?;
    // Must parse and verify through the canonical codec, not merely compare bytes: a malformed record
    // is a distinct refusal from a conflicting one.
    if parse_canonical_json(&existing).is_err() {
        return Err(WriteError::ExistingRecordUnreadable);
    }
    if existing == intended {
        Ok(WriteOutcome::AlreadyInstalledSameIdentity)
    } else {
        Err(WriteError::ConflictingIdentityExists)
    }
}

/// FIXTURE-ONLY deterministic installation-ID source. Non-default; never a production route.
#[cfg(any(test, feature = "fixture-writer"))]
pub struct FixtureInstallationIdSource(pub [u8; 16]);

#[cfg(any(test, feature = "fixture-writer"))]
impl InstallationIdSource for FixtureInstallationIdSource {
    fn fill(&self, buf: &mut [u8; 16]) -> Result<(), InstallationIdSourceError> {
        *buf = self.0;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
