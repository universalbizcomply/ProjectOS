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
    EXPECTED_SERVICE_RELATIVE_PATH, HOST_STATE_DIRECTORY_SEGMENT, RECORD_FILE_NAME,
    RECORD_SCHEMA_VERSION, RECORD_SUBDIRECTORY,
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

/// The PRODUCTION installation-ID source: the Windows system-preferred CSPRNG.
///
/// A unit struct with no field, no constructor and no callback: a caller cannot hand it bytes, a seed,
/// an id or an alternative entropy source. It draws exactly 16 bytes from the single canonical
/// primitive `projectos_windows_runtime_primitives::system_random::system_preferred_fill`, which is the
/// only `BCryptGenRandom` implementation on this dependency route — the unsafe FFI stays in that
/// authority-free leaf, so this crate keeps `#![forbid(unsafe_code)]`.
///
/// Compiled only under `installer-windows`, so the default graph has no production generation route at
/// all. Not invoked during tests or validation: doing so would execute the real OS CSPRNG.
#[cfg(all(windows, feature = "installer-windows"))]
pub struct SystemPreferredInstallationIdSource;

#[cfg(all(windows, feature = "installer-windows"))]
impl InstallationIdSource for SystemPreferredInstallationIdSource {
    fn fill(&self, buf: &mut [u8; 16]) -> Result<(), InstallationIdSourceError> {
        // Any failure — OS refusal or a length this primitive will not serve — becomes the fieldless
        // error. There is no retry, no second entropy source and no partial-buffer acceptance; the
        // caller's `InstallationId::generate` then refuses rather than minting an id.
        projectos_windows_runtime_primitives::system_random::system_preferred_fill(&mut buf[..])
            .map_err(|_| InstallationIdSourceError)
    }
}

/// Sealed evidence that the approved ProgramData anchor was resolved by an APPROVED resolver.
///
/// Private field and no public constructor takes a caller path in a production graph, so the anchor
/// cannot be pointed somewhere else. Holding one is the only way to derive a production
/// [`InstallerTarget`].
#[derive(Debug)]
pub struct ResolvedProgramDataAnchor {
    root: PathBuf,
}

impl ResolvedProgramDataAnchor {
    /// The PRODUCTION anchor route: the approved read-only Known Folder resolver.
    ///
    /// The location comes from `SHGetKnownFolderPath` through the authority-free primitive — never from
    /// an environment variable, the working directory, the repository or a literal. Resolution creates
    /// nothing; the returned root is canonicalised and refused if it is a reparse point, exactly as a
    /// fixture anchor is.
    ///
    /// # Errors
    /// [`WriteError::AnchorUnresolved`] if the OS does not resolve the folder,
    /// [`WriteError::ReparsePointRefused`] or [`WriteError::TargetUnavailable`] if the resolved root
    /// fails the boundary checks.
    #[cfg(all(windows, feature = "installer-windows"))]
    pub fn resolve_approved() -> Result<Self, WriteError> {
        let root = projectos_windows_runtime_primitives::known_folder::resolve_program_data()
            .map_err(|_| WriteError::AnchorUnresolved)?;
        Self::from_resolved_root(&root)
    }

    /// Apply the boundary checks every anchor must pass, whoever resolved the root.
    #[cfg_attr(
        not(any(test, feature = "fixture-writer", feature = "installer-windows")),
        allow(dead_code)
    )]
    fn from_resolved_root(root: &Path) -> Result<Self, WriteError> {
        let root = root
            .canonicalize()
            .map_err(|_| WriteError::TargetUnavailable)?;
        if fs::symlink_metadata(&root)
            .map_err(|_| WriteError::TargetUnavailable)?
            .file_type()
            .is_symlink()
        {
            return Err(WriteError::ReparsePointRefused);
        }
        Ok(Self { root })
    }

    /// FIXTURE-ONLY anchor beneath a disposable directory the caller already owns.
    ///
    /// # Errors
    /// [`WriteError`] if the root cannot be resolved or is a reparse point.
    #[cfg(any(test, feature = "fixture-writer"))]
    pub fn fixture(owned_root: &Path) -> Result<Self, WriteError> {
        Self::from_resolved_root(owned_root)
    }
}

/// The approved INSTALL ROOT: where the service binary lives.
///
/// Separate type from the state anchor on purpose — the binary root and the state root are different
/// folders with different rules, and a value for one must never be usable as the other.
#[derive(Debug)]
pub struct ResolvedInstallRoot {
    /// `<ProgramFiles>/ProjectOS/host`. Derived internally from the frozen segments.
    install_dir: PathBuf,
}

impl ResolvedInstallRoot {
    /// The PRODUCTION install root, via the approved read-only Program Files resolver.
    ///
    /// # Errors
    /// [`WriteError`] if the folder does not resolve or fails the boundary checks.
    #[cfg(all(windows, feature = "installer-windows"))]
    pub fn resolve_approved() -> Result<Self, WriteError> {
        let root = projectos_windows_runtime_primitives::known_folder::resolve_program_files()
            .map_err(|_| WriteError::AnchorUnresolved)?;
        Self::under(&root)
    }

    /// FIXTURE-ONLY install root beneath a disposable directory the caller already owns.
    ///
    /// # Errors
    /// [`WriteError`] if the root fails the boundary checks.
    #[cfg(any(test, feature = "fixture-writer"))]
    pub fn fixture(owned_root: &Path) -> Result<Self, WriteError> {
        Self::under(owned_root)
    }

    /// Derive `<root>/ProjectOS/host` using the frozen segments only, then re-check containment.
    #[cfg_attr(
        not(any(test, feature = "fixture-writer", feature = "installer-windows")),
        allow(dead_code)
    )]
    fn under(root: &Path) -> Result<Self, WriteError> {
        let root = root
            .canonicalize()
            .map_err(|_| WriteError::TargetUnavailable)?;
        if fs::symlink_metadata(&root)
            .map_err(|_| WriteError::TargetUnavailable)?
            .file_type()
            .is_symlink()
        {
            return Err(WriteError::ReparsePointRefused);
        }
        let install_dir = root
            .join(EXPECTED_PRODUCT)
            .join(HOST_STATE_DIRECTORY_SEGMENT);
        if !install_dir.starts_with(&root) {
            return Err(WriteError::ContainmentRefused);
        }
        Ok(Self { install_dir })
    }

    /// The expected service-binary path: `<install root>/ProjectOSHost.exe`. The file name comes from
    /// the frozen contract, never from a caller.
    #[must_use]
    pub fn service_binary_path(&self) -> PathBuf {
        self.install_dir.join(EXPECTED_SERVICE_RELATIVE_PATH)
    }

    /// The install directory itself.
    #[must_use]
    pub fn install_dir(&self) -> &Path {
        &self.install_dir
    }
}

/// Where the record will be written. Sealed: no public constructor takes a path, so a caller cannot
/// aim the writer at a repository path, a TEMP sibling, or anywhere else.
///
/// Deliberately NOT `Clone`, `Copy` or serialisable: a derived target is a single authorisation to
/// write one location, not a value to be duplicated, stored or transported.
#[derive(Debug)]
pub struct InstallerTarget {
    /// The `<anchor>/ProjectOS/host/installation` directory, derived from the frozen contract
    /// segments. Never caller-supplied.
    installation_dir: PathBuf,
}

impl InstallerTarget {
    /// The final record path inside the target directory.
    #[must_use]
    fn record_path(&self) -> PathBuf {
        self.installation_dir.join(RECORD_FILE_NAME)
    }

    /// Derive the target from a resolved anchor.
    ///
    /// Every segment comes from the frozen canonical-record contract — product, host-state segment and
    /// record subdirectory — so this crate defines no second path vocabulary and a caller chooses none
    /// of them. Containment is re-checked after derivation.
    ///
    /// # Errors
    /// [`WriteError::ContainmentRefused`] if the derived directory escapes the anchor.
    pub fn under_resolved_anchor(anchor: &ResolvedProgramDataAnchor) -> Result<Self, WriteError> {
        let dir = anchor
            .root
            .join(EXPECTED_PRODUCT)
            .join(HOST_STATE_DIRECTORY_SEGMENT)
            .join(RECORD_SUBDIRECTORY);
        if !dir.starts_with(&anchor.root) {
            return Err(WriteError::ContainmentRefused);
        }
        Ok(Self {
            installation_dir: dir,
        })
    }

    /// FIXTURE-ONLY target beneath a disposable directory the caller already owns. Gated on
    /// `fixture-writer`, so the default graph has no target-construction route at all.
    ///
    /// # Errors
    /// [`WriteError`] if the root escapes containment or is a reparse point.
    #[cfg(any(test, feature = "fixture-writer"))]
    pub fn fixture_under(owned_root: &Path) -> Result<Self, WriteError> {
        Self::under_resolved_anchor(&ResolvedProgramDataAnchor::fixture(owned_root)?)
    }

    /// Whether a record already occupies this target. Read-only: it opens, creates and locks nothing.
    ///
    /// Gated, because only an installer composing a plan has any reason to ask — the runtime reads the
    /// record through `host-identity`, never through this crate.
    #[cfg(any(test, feature = "fixture-writer"))]
    #[must_use]
    pub fn record_already_exists(&self) -> bool {
        self.record_path().exists()
    }

    /// The derived record location.
    ///
    /// Available to the installer graph (fixture or `installer-windows`) and to nothing else: the
    /// runtime reads the record through `host-identity` and never learns a target path from here.
    #[cfg(any(test, feature = "fixture-writer", feature = "installer-windows"))]
    #[must_use]
    pub fn record_location(&self) -> PathBuf {
        self.record_path()
    }

    /// The record path, for fixture verification only. Never exposed in a default graph, so no runtime
    /// code can learn or transport a target location.
    #[cfg(any(test, feature = "fixture-writer"))]
    #[must_use]
    pub fn record_path_for_test(&self) -> PathBuf {
        self.record_path()
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
    /// The approved ProgramData Known Folder anchor could not be resolved, so no production target
    /// exists. Refused before any derivation.
    AnchorUnresolved,
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
