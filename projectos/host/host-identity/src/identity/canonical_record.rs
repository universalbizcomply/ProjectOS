//! THE CANONICAL INSTALLATION IDENTITY RECORD (V1).
//!
//! Replaces the placeholder canonical-identity source with a genuine, versioned, installation-bound
//! contract for the approved boundary:
//!
//! ```text
//! install root      %ProgramFiles%\ProjectOS\Host
//! service binary    %ProgramFiles%\ProjectOS\Host\ProjectOSHost.exe
//! protected state   %ProgramData%\ProjectOS\Host
//! identity record   %ProgramData%\ProjectOS\Host\installation\identity.v1.json
//! ```
//!
//! **The runtime only ever READS.** There is no create, repair, update or regenerate path here, and the
//! production provider performs no filesystem access at all — see [`ProgramDataIdentityRecord`].
//!
//! **A digest is not authority.** The record is non-secret and its digest only proves internal
//! consistency; authority will come from installer-controlled creation in the protected location plus
//! verified ACL and installation evidence. Until that exists, production identity is
//! [`InstallationEvidence::Unavailable`] and every consumer fails closed.
//!
//! Anchors are resolved ONLY through the accepted symbolic Known Folder abstraction
//! ([`KnownFolderAnchor`]), never from caller arguments, environment variables, the working directory,
//! executable-parent guesses, usernames or ungoverned registry values.

use super::hash::sha256_hex;
use super::install_root::{InstallationEvidence, InstallationEvidenceProvider};

// MINIMUM export for CD-B4-INSTALLER-CANONICAL-IDENTITY-RECORD-WRITER1A: the installer-side writer must
// be able to name the evidence type to drive `verify_record` in its own tests. Re-exporting the enum
// grants nothing — it carries no authority and cannot mint a verified identity.
pub use super::install_root::InstallationEvidence as RecordInstallationEvidence;

/// MINIMUM export for CD-B4-ELEVATED-INSTALLER-IDENTITY-COMPOSITION1A: the installer derives the
/// production record directory from the SAME segments this module already uses for
/// [`symbolic_record_location`]. Exporting the segment prevents a parallel path vocabulary; it
/// resolves nothing and grants nothing.
pub const HOST_STATE_DIRECTORY_SEGMENT: &str = HOST_STATE_SEGMENT;
// CYCLE BREAK (CD-B4-PRODUCTION-HOST-AUTHORITY-WIN32-OBSERVER1A). These two values were previously
// imported from `windows-host-activation-plan`. Reusing that crate is now GENUINELY UNUSABLE here: it
// transitively reaches host-authority (activation-plan -> acl-policy -> root-custody -> persistence ->
// core -> host-authority), so host-authority could never depend on this crate to verify a record, and
// the Windows host-authority observer became unbuildable. They are re-declared as local constants and
// pinned against the upstream contract by val-cd-b4-host-authority-observer1a, which compares both
// source files, so the two definitions cannot silently diverge.
/// The ProgramData Known Folder symbol. Byte-identical to `KnownFolderAnchor::ProgramData.symbol()`.
const PROGRAMDATA_ANCHOR_SYMBOL: &str = "%KNOWNFOLDER:ProgramData%";
/// The host-state subtree segment. Byte-identical to `RootSubtree::HostState.segment()`.
const HOST_STATE_SEGMENT: &str = "host";

/// The only supported record schema version.
pub const RECORD_SCHEMA_VERSION: u32 = 1;
/// Domain separation for the record digest (version-pinned; distinct from every other digest domain).
const DIGEST_DOMAIN: &str = "PROJECTOS:CANONICAL-INSTALLATION-IDENTITY:V1";
/// The only product this contract accepts.
pub const EXPECTED_PRODUCT: &str = "ProjectOS";
/// The only service name this contract accepts.
pub const EXPECTED_SERVICE_NAME: &str = "ProjectOSHost";
/// The only service executable relative path this contract accepts.
pub const EXPECTED_SERVICE_RELATIVE_PATH: &str = "ProjectOSHost.exe";
/// The record's file name beneath the installation subtree.
pub const RECORD_FILE_NAME: &str = "identity.v1.json";
/// The segment beneath the host-state subtree that holds the record.
pub const RECORD_SUBDIRECTORY: &str = "installation";
/// The all-zero digest the previous placeholder used. Never acceptable.
const ZERO_DIGEST_16: &str = "0000000000000000";

/// Why a canonical installation identity record was refused. Fail-closed; names no path or machine fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum RecordError {
    /// No record was present at the approved location.
    Missing,
    /// The record could not be parsed.
    Malformed,
    /// The schema version is not supported.
    UnsupportedVersion,
    /// A required identity field was absent or empty.
    MissingField,
    /// The product identifier is not ProjectOS.
    WrongProduct,
    /// The service name is not ProjectOSHost.
    WrongServiceName,
    /// The service executable relative path is not the expected one.
    WrongServiceRelativePath,
    /// The recorded digest does not match the recomputed one.
    DigestMismatch,
    /// The digest is the all-zero placeholder.
    PlaceholderDigest,
    /// The installation root does not match the approved boundary.
    WrongInstallationRoot,
    /// Protected installation evidence is unavailable, so nothing can be canonical.
    ProtectedEvidenceUnavailable,
    /// Running installation evidence does not correspond to the record.
    EvidenceMismatch,
}

/// The V1 record as an installer would write it. Plain data with NO authority: holding one proves
/// nothing until [`verify_record`] accepts it against the approved boundary and protected evidence.
///
/// `Deserialize` is derived with `deny_unknown_fields` so the READ boundary can load an installed
/// record without a second parser, and an unexpected field is refused rather than ignored. It grants
/// nothing on its own — every binding, the digest and the protected evidence are still checked by
/// [`verify_record`], which is the only thing that can turn a record into a verified identity.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstallationIdentityRecordV1 {
    /// Must equal [`RECORD_SCHEMA_VERSION`].
    pub schema_version: u32,
    /// Must equal [`EXPECTED_PRODUCT`].
    pub product: String,
    /// Must equal [`EXPECTED_SERVICE_NAME`].
    pub service_name: String,
    /// Installer-generated, non-secret installation identifier.
    pub installation_id: String,
    /// The installation channel.
    pub channel: String,
    /// Must equal [`EXPECTED_SERVICE_RELATIVE_PATH`].
    pub service_relative_path: String,
    /// Digest of the release manifest this installation was produced from.
    pub release_manifest_digest: String,
    /// The domain-separated deterministic digest over every field above.
    pub record_digest: String,
}

/// Length-prefixed append, matching the accepted canonical-encoding pattern used by the plan digest.
fn put(buf: &mut Vec<u8>, bytes: &[u8]) {
    buf.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    buf.extend_from_slice(bytes);
}

/// Name-tagged, length-prefixed field, so no two field layouts can collide.
fn put_field(buf: &mut Vec<u8>, name: &str, value: &str) {
    put(buf, name.as_bytes());
    put(buf, value.as_bytes());
}

/// Compute the canonical record digest: domain-separated, schema-versioned, deterministic and
/// length-prefixed over all seven bound identity fields. Changing ANY of them changes the digest.
#[must_use]
pub fn compute_record_digest(record: &InstallationIdentityRecordV1) -> String {
    let mut b: Vec<u8> = Vec::new();
    put(&mut b, DIGEST_DOMAIN.as_bytes());
    put(&mut b, &record.schema_version.to_be_bytes());
    b.extend_from_slice(&7u32.to_be_bytes());
    put_field(&mut b, "product", &record.product);
    put_field(&mut b, "service_name", &record.service_name);
    put_field(&mut b, "installation_id", &record.installation_id);
    put_field(&mut b, "channel", &record.channel);
    put_field(
        &mut b,
        "service_relative_path",
        &record.service_relative_path,
    );
    put_field(
        &mut b,
        "release_manifest_digest",
        &record.release_manifest_digest,
    );
    sha256_hex(&b)
}

/// The approved record location, expressed SYMBOLICALLY. No path is resolved and no filesystem is
/// touched: the anchor stays a Known Folder symbol until an approved resolver exists.
#[must_use]
pub fn symbolic_record_location() -> String {
    format!(
        "{}\\{}\\{}\\{}\\{}",
        PROGRAMDATA_ANCHOR_SYMBOL,
        EXPECTED_PRODUCT,
        HOST_STATE_SEGMENT,
        RECORD_SUBDIRECTORY,
        RECORD_FILE_NAME
    )
}

/// A verified canonical installation identity. Private field, no public constructor: the ONLY way to
/// hold one is [`verify_record`], so runtime corroboration alone can never produce it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedCanonicalInstallation {
    digest: String,
}

impl VerifiedCanonicalInstallation {
    /// The verified canonical record digest (non-secret; safe to compare and log).
    #[must_use]
    pub fn digest(&self) -> &str {
        &self.digest
    }

    /// The first 16 lower-case hex characters, the component the authority object binds.
    #[must_use]
    pub fn digest16(&self) -> &str {
        &self.digest[..16]
    }
}

/// Verify a record against the approved boundary and the running installation evidence.
///
/// Fail-closed and ordered: shape and version first, then the fixed product/service bindings, then the
/// digest, then the protected evidence. The FIRST failure wins.
///
/// `evidence` must be [`InstallationEvidence::Matched`] — `Unavailable`, `Missing` and `Mismatched` all
/// refuse, so corroboration alone (PackagedCandidate, PerMachineEvidenceMatched) can never yield a
/// canonical identity.
///
/// # Errors
/// [`RecordError`] naming the first failed check.
pub fn verify_record(
    record: &InstallationIdentityRecordV1,
    evidence: InstallationEvidence,
) -> Result<VerifiedCanonicalInstallation, RecordError> {
    if record.schema_version != RECORD_SCHEMA_VERSION {
        return Err(RecordError::UnsupportedVersion);
    }
    for field in [
        &record.product,
        &record.service_name,
        &record.installation_id,
        &record.channel,
        &record.service_relative_path,
        &record.release_manifest_digest,
        &record.record_digest,
    ] {
        if field.trim().is_empty() {
            return Err(RecordError::MissingField);
        }
    }
    if record.product != EXPECTED_PRODUCT {
        return Err(RecordError::WrongProduct);
    }
    if record.service_name != EXPECTED_SERVICE_NAME {
        return Err(RecordError::WrongServiceName);
    }
    if record.service_relative_path != EXPECTED_SERVICE_RELATIVE_PATH {
        return Err(RecordError::WrongServiceRelativePath);
    }
    // The placeholder is refused explicitly, before and independently of the digest comparison, so it
    // can never be accepted even if a record carried a matching zero-derived digest.
    if record.record_digest.starts_with(ZERO_DIGEST_16) {
        return Err(RecordError::PlaceholderDigest);
    }
    let recomputed = compute_record_digest(record);
    if recomputed != record.record_digest {
        return Err(RecordError::DigestMismatch);
    }
    // A digest beside caller-writable content is not authority: protected installation evidence must
    // corroborate that this record describes THIS installation.
    match evidence {
        InstallationEvidence::Matched => {}
        InstallationEvidence::Unavailable => return Err(RecordError::ProtectedEvidenceUnavailable),
        InstallationEvidence::Missing => return Err(RecordError::Missing),
        InstallationEvidence::Mismatched => return Err(RecordError::EvidenceMismatch),
    }
    Ok(VerifiedCanonicalInstallation { digest: recomputed })
}

/// The PRODUCTION provider for the approved record location.
///
/// It performs NO filesystem access: the Known Folder anchor is symbolic and no approved resolver
/// exists yet, so the record cannot be located, and evidence is [`InstallationEvidence::Unavailable`].
/// This is the honest production reality — not a stub that pretends to read. It never creates, repairs
/// or regenerates anything.
pub struct ProgramDataIdentityRecord;

impl InstallationEvidenceProvider for ProgramDataIdentityRecord {
    fn evidence(&self) -> InstallationEvidence {
        InstallationEvidence::Unavailable
    }
}

/// The PRODUCTION canonical identity route.
///
/// Reads only the approved record location through [`ProgramDataIdentityRecord`] and verifies it. Until
/// an installer writes the record AND an approved known-folder resolver exists, the evidence is
/// [`InstallationEvidence::Unavailable`] and this returns
/// [`RecordError::ProtectedEvidenceUnavailable`] — the expected fail-closed production reality, not a
/// defect. It creates, repairs and writes nothing.
///
/// # Errors
/// [`RecordError`] naming the first failed check.
pub fn production_canonical_identity() -> Result<VerifiedCanonicalInstallation, RecordError> {
    // No record can be located yet, so there is nothing to verify; fail closed on the evidence alone.
    match ProgramDataIdentityRecord.evidence() {
        InstallationEvidence::Matched => Err(RecordError::Missing),
        InstallationEvidence::Unavailable => Err(RecordError::ProtectedEvidenceUnavailable),
        InstallationEvidence::Missing => Err(RecordError::Missing),
        InstallationEvidence::Mismatched => Err(RecordError::EvidenceMismatch),
    }
}

/// TEST/FIXTURE-ONLY record construction. Non-default: a release graph has no route to a canonical
/// identity at all. Touches no real ProgramData or Program Files.
#[cfg(any(test, feature = "test-fixtures"))]
pub mod fixtures {
    use super::*;

    /// A well-formed V1 record with a correctly computed digest.
    #[must_use]
    pub fn valid_record() -> InstallationIdentityRecordV1 {
        let mut r = InstallationIdentityRecordV1 {
            schema_version: RECORD_SCHEMA_VERSION,
            product: EXPECTED_PRODUCT.to_string(),
            service_name: EXPECTED_SERVICE_NAME.to_string(),
            installation_id: "inst-0001".to_string(),
            channel: "packaged".to_string(),
            service_relative_path: EXPECTED_SERVICE_RELATIVE_PATH.to_string(),
            release_manifest_digest: "a".repeat(64),
            record_digest: String::new(),
        };
        r.record_digest = compute_record_digest(&r);
        r
    }

    /// A provider reporting the supplied evidence, for driving the verification paths.
    pub struct FixtureEvidence(pub InstallationEvidence);
    impl InstallationEvidenceProvider for FixtureEvidence {
        fn evidence(&self) -> InstallationEvidence {
            self.0
        }
    }
}

// ---------------------------------------------------------------------------------------------
// THE RELEASE MANIFEST — one algorithm, shared by the installer and the installed service.
//
// CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A (release-currentness correction).
//
// It lived only inside the installer, so the installed service had no way to ask whether the image
// it is running is the one the identity record was written for. It now lives here, beside the
// record contract it belongs to, and BOTH sides call it. There is deliberately no second
// implementation: a duplicate would be free to drift, and a drifting manifest cannot detect drift.
//
// This module depends on nothing but `sha256_hex` and the frozen path constant above, so the
// service can reach it without depending on the installer or the writer crate.
// ---------------------------------------------------------------------------------------------

/// The domain separator. Frozen: a manifest computed under any other domain is a different manifest.
///
/// PRIVATE. A caller can obtain a manifest digest only by asking for one, never by assembling the
/// inputs itself — which is what keeps a single construction single.
const RELEASE_MANIFEST_DOMAIN: &str = "PROJECTOS:RELEASE-MANIFEST:V1";

/// The manifest version. Frozen alongside the domain, and private for the same reason.
const RELEASE_MANIFEST_VERSION: &str = "1";

/// Append one length-prefixed field. Big-endian `u64` length then the raw bytes, so no two distinct
/// field sequences can encode to the same buffer.
fn put_manifest_field(out: &mut Vec<u8>, value: &str) {
    out.extend_from_slice(&(value.len() as u64).to_be_bytes());
    out.extend_from_slice(value.as_bytes());
}

/// The canonical manifest bytes for an artefact digest.
///
/// Pure: the ONLY input is the artefact's SHA-256 hex digest. No path, environment, clock or
/// filesystem is read, so the same artefact always yields the same bytes on any machine.
#[must_use]
pub fn release_manifest_canonical_bytes(artefact_digest: &str) -> Vec<u8> {
    let mut canonical = Vec::new();
    put_manifest_field(&mut canonical, RELEASE_MANIFEST_DOMAIN);
    put_manifest_field(&mut canonical, RELEASE_MANIFEST_VERSION);
    put_manifest_field(&mut canonical, EXPECTED_SERVICE_RELATIVE_PATH);
    put_manifest_field(&mut canonical, artefact_digest);
    canonical
}

/// THE shared release-manifest digest function.
///
/// Takes the validated executable SHA-256 hex digest and returns the canonical release-manifest
/// digest as 64 lower-case hex characters — exactly the value an identity record stores in
/// `release_manifest_digest`.
///
/// The installer computes it for the artefact it is about to install; the installed service computes
/// it for the image it is actually running. Comparing the two is what makes readiness fail closed
/// when the running executable is not the one the record was written for.
#[must_use]
pub fn release_manifest_digest_for_artefact_digest(artefact_digest: &str) -> String {
    sha256_hex(&release_manifest_canonical_bytes(artefact_digest))
}

#[cfg(test)]
mod tests {
    use super::fixtures::valid_record;
    use super::*;

    fn ok() -> Result<VerifiedCanonicalInstallation, RecordError> {
        verify_record(&valid_record(), InstallationEvidence::Matched)
    }

    #[test]
    fn a_valid_record_verifies_deterministically() {
        let a = ok().expect("valid record verifies");
        let b = ok().expect("valid record verifies again");
        assert_eq!(a.digest(), b.digest(), "the digest must be deterministic");
        assert_eq!(a.digest().len(), 64);
        assert_eq!(a.digest16().len(), 16);
        assert_ne!(a.digest16(), ZERO_DIGEST_16);
    }

    #[test]
    fn changing_any_bound_field_changes_the_digest() {
        let base = compute_record_digest(&valid_record());
        let mutations: &[fn(&mut InstallationIdentityRecordV1)] = &[
            |r| r.product = "Other".into(),
            |r| r.service_name = "OtherHost".into(),
            |r| r.installation_id = "inst-0002".into(),
            |r| r.channel = "dev".into(),
            |r| r.service_relative_path = "Other.exe".into(),
            |r| r.release_manifest_digest = "b".repeat(64),
            |r| r.schema_version = 2,
        ];
        for m in mutations {
            let mut r = valid_record();
            m(&mut r);
            assert_ne!(compute_record_digest(&r), base, "a bound field must bind");
        }
    }

    #[test]
    fn the_zero_placeholder_is_rejected() {
        let mut r = valid_record();
        r.record_digest = format!("{ZERO_DIGEST_16}{}", "0".repeat(48));
        assert_eq!(
            verify_record(&r, InstallationEvidence::Matched).unwrap_err(),
            RecordError::PlaceholderDigest
        );
    }

    #[test]
    fn each_failing_field_refuses_with_its_own_reason() {
        type Case = (fn(&mut InstallationIdentityRecordV1), RecordError);
        let cases: &[Case] = &[
            (|r| r.schema_version = 2, RecordError::UnsupportedVersion),
            (
                |r| r.installation_id = String::new(),
                RecordError::MissingField,
            ),
            (|r| r.product = "Other".into(), RecordError::WrongProduct),
            (
                |r| r.service_name = "Other".into(),
                RecordError::WrongServiceName,
            ),
            (
                |r| r.service_relative_path = "Other.exe".into(),
                RecordError::WrongServiceRelativePath,
            ),
            (
                |r| r.record_digest = "f".repeat(64),
                RecordError::DigestMismatch,
            ),
        ];
        for (mutate, expected) in cases {
            let mut r = valid_record();
            mutate(&mut r);
            assert_eq!(
                verify_record(&r, InstallationEvidence::Matched).unwrap_err(),
                *expected
            );
        }
    }

    #[test]
    fn corroboration_alone_never_becomes_canonical_identity() {
        for (evidence, expected) in [
            (
                InstallationEvidence::Unavailable,
                RecordError::ProtectedEvidenceUnavailable,
            ),
            (InstallationEvidence::Missing, RecordError::Missing),
            (
                InstallationEvidence::Mismatched,
                RecordError::EvidenceMismatch,
            ),
        ] {
            assert_eq!(
                verify_record(&valid_record(), evidence).unwrap_err(),
                expected
            );
        }
    }

    #[test]
    fn the_production_provider_is_unavailable_and_reads_nothing() {
        assert_eq!(
            ProgramDataIdentityRecord.evidence(),
            InstallationEvidence::Unavailable
        );
    }

    #[test]
    fn the_record_location_is_symbolic_and_matches_the_approved_boundary() {
        let loc = symbolic_record_location();
        assert!(loc.starts_with("%KNOWNFOLDER:ProgramData%"), "{loc}");
        assert!(loc.ends_with("installation\\identity.v1.json"), "{loc}");
        // No resolved machine path may appear.
        assert!(!loc.contains(":\\"), "{loc}");
    }
}

#[cfg(test)]
mod release_manifest_tests {
    use super::*;

    const A: &str = "93e58f4876c9c048902c75efed41a127133c7d8d7536aef5bc84c5fa03736ba2";
    const B: &str = "a7aff5b1b540324c94f0df115477cb83c136fcde1e5bf96bfc228bc76ab637c5";

    #[test]
    fn the_manifest_digest_is_deterministic_and_well_formed() {
        let d = release_manifest_digest_for_artefact_digest(A);
        assert_eq!(d, release_manifest_digest_for_artefact_digest(A));
        assert_eq!(d.len(), 64);
        assert!(d
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
    }

    #[test]
    fn a_different_artefact_yields_a_different_manifest() {
        assert_ne!(
            release_manifest_digest_for_artefact_digest(A),
            release_manifest_digest_for_artefact_digest(B),
            "a replaced executable must change the manifest, or currentness could never be detected"
        );
    }

    #[test]
    fn the_canonical_bytes_are_length_prefixed_and_unambiguous() {
        let bytes = release_manifest_canonical_bytes(A);
        // Four fields, each an 8-byte big-endian length followed by its value.
        let expected = 4 * 8
            + RELEASE_MANIFEST_DOMAIN.len()
            + RELEASE_MANIFEST_VERSION.len()
            + EXPECTED_SERVICE_RELATIVE_PATH.len()
            + A.len();
        assert_eq!(bytes.len(), expected);
        assert_eq!(
            &bytes[..8],
            &(RELEASE_MANIFEST_DOMAIN.len() as u64).to_be_bytes()
        );
        // Length prefixing means no two distinct field sequences can collide.
        assert_ne!(
            release_manifest_canonical_bytes("ab"),
            release_manifest_canonical_bytes("a")
        );
    }

    #[test]
    fn the_digest_is_the_hash_of_the_canonical_bytes_and_nothing_else() {
        assert_eq!(
            release_manifest_digest_for_artefact_digest(A),
            sha256_hex(&release_manifest_canonical_bytes(A)),
            "there must be exactly one construction, not two that happen to agree"
        );
    }

    #[test]
    fn the_domain_and_version_are_frozen() {
        assert_eq!(RELEASE_MANIFEST_DOMAIN, "PROJECTOS:RELEASE-MANIFEST:V1");
        assert_eq!(RELEASE_MANIFEST_VERSION, "1");
        assert_eq!(EXPECTED_SERVICE_RELATIVE_PATH, "ProjectOSHost.exe");
    }

    /// The value the LIVE installed record stores. If the shared function ever stopped reproducing it
    /// from the original executable's digest, the extraction would have changed behaviour.
    #[test]
    fn the_shared_function_reproduces_the_installed_records_manifest() {
        assert_eq!(
            release_manifest_digest_for_artefact_digest(A),
            "660970568db446e4d654f53dbd0e5034ad843224dd2e69a3900dfb30a2cd0b5b"
        );
    }
}
