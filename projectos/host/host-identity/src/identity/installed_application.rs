//! THE installer-owned record of an installed ProjectOS application, and its fail-closed reader.
//!
//! WHY IT EXISTS. The packaged runtime needs two machine facts it cannot establish for itself:
//! whether this really is an installed per-machine application rather than a copied tree, and which
//! ProjectOS system root it is authorised to operate. Both are things an INSTALLER knows and a
//! running program cannot infer. This record is where an installer states them.
//!
//! A FILE IN PROGRAMDATA IS NOT AUTHORITY. Being able to read a JSON document proves nothing: the
//! interesting case is an attacker who can write one. So every field is checked, the whole record is
//! bound by a domain-separated digest, and — the part that actually matters — the record must name
//! the install root it was written for, which is compared against where the running executable
//! ACTUALLY is. A record copied beside a copied tree describes an installation that is not this one,
//! and is refused for that reason rather than for looking malformed.
//!
//! IT CONFERS NO CRYPTOGRAPHIC TRUST. It cannot select a verifier, name a public anchor, carry key
//! material or influence signature checking. Installer-owned facts establish INSTALLATION EVIDENCE.
//! The signed manifest and the owner anchor establish trust, and they are untouched by anything
//! here. The strongest thing this record can produce is `PerMachineEvidenceMatched` — corroboration,
//! explicitly weaker than `PerMachineVerified`, which no path in this codebase produces.
//!
//! ONE LOCATION. There is no search, no candidate list and no first-valid-record-wins: the reader
//! resolves exactly one path and reads exactly that. A record anywhere else is not consulted, so
//! placing one somewhere more convenient achieves nothing.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A (installer trust record).

#![cfg(windows)]

use std::path::{Path, PathBuf};

use super::canonical_record::{
    EXPECTED_PRODUCT, HOST_STATE_DIRECTORY_SEGMENT, RECORD_SUBDIRECTORY,
};
use super::composite::InstallationIdentity;
use super::hash::sha256_hex;
use super::install_root::{InstallationEvidence, InstallationEvidenceProvider};

/// The record's file name. Distinct from the service identity record in the same subtree: they
/// describe different things, and a reader that could confuse them would be reading the wrong facts.
pub const APPLICATION_RECORD_FILE_NAME: &str = "application.v1.json";

/// The only supported schema version. There is no permissive "newer than I know" branch.
pub const APPLICATION_RECORD_SCHEMA_VERSION: u32 = 1;

/// The only installation scope that can corroborate a per-machine installation.
pub const PER_MACHINE_SCOPE: &str = "per-machine";

/// Domain separation for this record's digest. Version-pinned, and distinct from every other digest
/// domain in the codebase so two record families can never produce a colliding digest.
const DIGEST_DOMAIN: &str = "PROJECTOS:INSTALLED-APPLICATION:V1";

/// Why an installed-application record was refused. Fail-closed and ordered; the FIRST failure wins.
/// No variant names a machine fact beyond what the caller already supplied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ApplicationRecordError {
    /// The record could not be located at the one canonical path.
    NotFound,
    /// The bytes are not a well-formed record — bad JSON, or a field this schema does not define.
    Malformed,
    /// A schema version this build does not implement.
    UnsupportedVersion,
    /// Not a ProjectOS record.
    WrongProduct,
    /// A record for a different application.
    WrongApplicationId,
    /// A record for a different installed version.
    WrongApplicationVersion,
    /// A scope that cannot corroborate a per-machine installation.
    WrongInstallationScope,
    /// A required field was blank.
    MissingField,
    /// The record describes an installation at a different location than the one running.
    InstallRootMismatch,
    /// The governed system root is not an absolute path.
    GovernedRootNotAbsolute,
    /// The governed system root contains traversal.
    GovernedRootTraversal,
    /// The governed system root is inside the application installation — a system root that lives
    /// inside the payload, or beside the executable, is not independent of it.
    GovernedRootInsideInstallation,
    /// The digest does not cover these bytes.
    DigestMismatch,
}

/// The record as written by an installer. `deny_unknown_fields` so an unexpected key is refused
/// rather than ignored: a reader that skips fields it does not understand will happily accept a
/// record written for something else.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InstalledApplicationRecordV1 {
    pub schema_version: u32,
    /// Must equal `EXPECTED_PRODUCT`.
    pub product: String,
    /// The packaged application identity this installation is for.
    pub application_id: String,
    /// The installed application version.
    pub application_version: String,
    /// The installation scope. Only `per-machine` can corroborate.
    pub installation_scope: String,
    /// Where the installer placed the application. Compared against the RUNNING executable's
    /// directory — this is what makes the record evidence about THIS installation.
    pub install_root: String,
    /// The canonical governed ProjectOS SYSTEM root this installation may operate.
    pub governed_system_root: String,
    /// Installer-generated, non-secret installation identifier.
    pub installation_id: String,
    /// Domain-separated deterministic digest over every field above.
    pub record_digest: String,
}

fn put(buf: &mut Vec<u8>, bytes: &[u8]) {
    buf.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    buf.extend_from_slice(bytes);
}

/// Compute the record digest: domain-separated, schema-versioned, length-prefixed over all eight
/// bound fields. Changing ANY of them changes the digest, and the length prefixes mean no two field
/// layouts can be made to collide by moving characters between adjacent fields.
#[must_use]
pub fn compute_application_record_digest(record: &InstalledApplicationRecordV1) -> String {
    let mut b: Vec<u8> = Vec::new();
    put(&mut b, DIGEST_DOMAIN.as_bytes());
    put(&mut b, &record.schema_version.to_be_bytes());
    put(&mut b, &8u32.to_be_bytes());
    for field in [
        &record.product,
        &record.application_id,
        &record.application_version,
        &record.installation_scope,
        &record.install_root,
        &record.governed_system_root,
        &record.installation_id,
    ] {
        put(&mut b, field.as_bytes());
    }
    sha256_hex(&b)
}

/// A verified installed-application record.
///
/// Private fields and no public constructor: holding one IS the evidence that a record was verified
/// against a real installation, not merely parsed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedInstalledApplication {
    governed_system_root: PathBuf,
    installation_id: String,
}

impl VerifiedInstalledApplication {
    /// The governed ProjectOS SYSTEM root this installation may operate.
    #[must_use]
    pub fn governed_system_root(&self) -> &Path {
        &self.governed_system_root
    }

    /// The installer's non-secret installation identifier.
    #[must_use]
    pub fn installation_id(&self) -> &str {
        &self.installation_id
    }
}

/// Normalise a path for comparison: strip the `\\?\` verbatim prefix, unify separators, lower-case.
fn norm(p: &Path) -> String {
    let s = p.to_string_lossy();
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
    s.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

/// Verify a record against what is INDEPENDENTLY known about the running installation.
///
/// Ordered so the most specific refusal wins, and so the digest is checked before anything is
/// believed. `observed_install_root` is the directory the running executable is actually in — the
/// caller derives it from `current_exe()`, never from this record.
///
/// # Errors
/// [`ApplicationRecordError`] naming the first failed check.
pub fn verify_application_record(
    record: &InstalledApplicationRecordV1,
    expected_application_id: &str,
    expected_application_version: &str,
    observed_install_root: &Path,
) -> Result<VerifiedInstalledApplication, ApplicationRecordError> {
    if record.schema_version != APPLICATION_RECORD_SCHEMA_VERSION {
        return Err(ApplicationRecordError::UnsupportedVersion);
    }
    for field in [
        &record.product,
        &record.application_id,
        &record.application_version,
        &record.installation_scope,
        &record.install_root,
        &record.governed_system_root,
        &record.installation_id,
        &record.record_digest,
    ] {
        if field.trim().is_empty() {
            return Err(ApplicationRecordError::MissingField);
        }
    }
    if record.product != EXPECTED_PRODUCT {
        return Err(ApplicationRecordError::WrongProduct);
    }
    if record.application_id != expected_application_id {
        return Err(ApplicationRecordError::WrongApplicationId);
    }
    if record.application_version != expected_application_version {
        return Err(ApplicationRecordError::WrongApplicationVersion);
    }
    if record.installation_scope != PER_MACHINE_SCOPE {
        return Err(ApplicationRecordError::WrongInstallationScope);
    }

    // THE binding check. The record must describe the installation that is actually running; a
    // record beside a copied tree describes somewhere else, and says so.
    let declared_root = PathBuf::from(&record.install_root);
    if norm(&declared_root) != norm(observed_install_root) {
        return Err(ApplicationRecordError::InstallRootMismatch);
    }

    let governed = PathBuf::from(&record.governed_system_root);
    if !governed.is_absolute() {
        return Err(ApplicationRecordError::GovernedRootNotAbsolute);
    }
    if record.governed_system_root.contains("..") {
        return Err(ApplicationRecordError::GovernedRootTraversal);
    }
    // A system root inside the installation is not independent of it: it would put mutable governed
    // state inside the very tree the trust manifest attests, and a payload-relative root would make
    // the attested bytes and the governed state one thing.
    let governed_norm = norm(&governed);
    let install_norm = norm(observed_install_root);
    if governed_norm == install_norm || governed_norm.starts_with(&format!("{install_norm}\\")) {
        return Err(ApplicationRecordError::GovernedRootInsideInstallation);
    }

    // Last, because everything above is cheaper and gives a better diagnosis.
    if compute_application_record_digest(record) != record.record_digest {
        return Err(ApplicationRecordError::DigestMismatch);
    }

    Ok(VerifiedInstalledApplication {
        governed_system_root: governed,
        installation_id: record.installation_id.clone(),
    })
}

/// Parse and verify raw record bytes.
///
/// # Errors
/// [`ApplicationRecordError`] naming the first failed check.
pub fn verify_application_record_bytes(
    raw: &[u8],
    expected_application_id: &str,
    expected_application_version: &str,
    observed_install_root: &Path,
) -> Result<VerifiedInstalledApplication, ApplicationRecordError> {
    let record: InstalledApplicationRecordV1 =
        serde_json::from_slice(raw).map_err(|_| ApplicationRecordError::Malformed)?;
    verify_application_record(
        &record,
        expected_application_id,
        expected_application_version,
        observed_install_root,
    )
}

/// THE one canonical record path: `<ProgramData>\ProjectOS\host\installation\application.v1.json`.
///
/// ProgramData comes from `SHGetKnownFolderPath` through the shared primitive — never from
/// `%ProgramData%`, which is an environment variable and therefore something a caller can move. The
/// segments are the ones the canonical installation record already uses, so there is one path
/// vocabulary rather than two.
///
/// # Errors
/// [`ApplicationRecordError::NotFound`] when ProgramData itself cannot be resolved.
pub fn canonical_application_record_path() -> Result<PathBuf, ApplicationRecordError> {
    let program_data = projectos_windows_runtime_primitives::known_folder::resolve_program_data()
        .map_err(|_| ApplicationRecordError::NotFound)?;
    Ok(program_data
        .join(EXPECTED_PRODUCT)
        .join(HOST_STATE_DIRECTORY_SEGMENT)
        .join(RECORD_SUBDIRECTORY)
        .join(APPLICATION_RECORD_FILE_NAME))
}

/// Read and verify the canonical record for this installation.
///
/// # Errors
/// [`ApplicationRecordError`] naming the first failed check.
pub fn read_canonical_application_record(
    expected_application_id: &str,
    expected_application_version: &str,
    observed_install_root: &Path,
) -> Result<VerifiedInstalledApplication, ApplicationRecordError> {
    let path = canonical_application_record_path()?;
    let raw = std::fs::read(&path).map_err(|_| ApplicationRecordError::NotFound)?;
    verify_application_record_bytes(
        &raw,
        expected_application_id,
        expected_application_version,
        observed_install_root,
    )
}

/// The PRODUCTION installation-evidence provider, backed by the canonical installer record.
///
/// This is what turns "the executable is under Program Files" into corroboration — or, far more
/// often, does not. A copied tree has no record at the canonical location, or has one describing a
/// different install root, and either way this reports evidence that does not corroborate.
///
/// `Missing` and `Mismatched` are distinguished deliberately: absent evidence and CONTRADICTED
/// evidence are different situations, and only one of them suggests somebody is trying something.
pub struct InstalledApplicationEvidence<'a> {
    pub expected_application_id: &'a str,
    pub expected_application_version: &'a str,
    pub observed_install_root: &'a Path,
}

impl InstallationEvidenceProvider for InstalledApplicationEvidence<'_> {
    fn evidence(&self) -> InstallationEvidence {
        match read_canonical_application_record(
            self.expected_application_id,
            self.expected_application_version,
            self.observed_install_root,
        ) {
            Ok(_) => InstallationEvidence::Matched,
            Err(ApplicationRecordError::NotFound) => InstallationEvidence::Missing,
            Err(_) => InstallationEvidence::Mismatched,
        }
    }
}

/// The strongest identity this evidence can ever produce, for callers that want to assert the
/// ceiling rather than infer it. Corroboration is not authentication.
#[must_use]
pub const fn strongest_corroborated_identity() -> InstallationIdentity {
    InstallationIdentity::PerMachineEvidenceMatched
}

#[cfg(test)]
mod tests {
    use super::*;

    const APP: &str = "com.universalbizcomply.projectos.control";
    const VERSION: &str = "0.1.0";
    const INSTALL: &str = r"C:\Program Files\ProjectOS Control Center";
    const GOVERNED: &str = r"C:\ProgramData\ProjectOS\system";

    fn signed(mut r: InstalledApplicationRecordV1) -> InstalledApplicationRecordV1 {
        r.record_digest = compute_application_record_digest(&r);
        r
    }

    fn valid() -> InstalledApplicationRecordV1 {
        signed(InstalledApplicationRecordV1 {
            schema_version: APPLICATION_RECORD_SCHEMA_VERSION,
            product: EXPECTED_PRODUCT.into(),
            application_id: APP.into(),
            application_version: VERSION.into(),
            installation_scope: PER_MACHINE_SCOPE.into(),
            install_root: INSTALL.into(),
            governed_system_root: GOVERNED.into(),
            installation_id: "inst-0001".into(),
            record_digest: String::new(),
        })
    }

    fn check(
        r: &InstalledApplicationRecordV1,
    ) -> Result<VerifiedInstalledApplication, ApplicationRecordError> {
        verify_application_record(r, APP, VERSION, Path::new(INSTALL))
    }

    #[test]
    fn a_correct_record_verifies_and_yields_the_governed_root() {
        let v = check(&valid()).expect("a correct record verifies");
        assert_eq!(v.governed_system_root(), Path::new(GOVERNED));
        assert_eq!(v.installation_id(), "inst-0001");
    }

    /// The install-root binding is the whole point: a record copied beside a copied tree describes
    /// an installation that is not this one.
    #[test]
    fn a_record_for_another_install_root_is_refused() {
        let mut r = valid();
        r.install_root = r"C:\Program Files\Somewhere Else".into();
        let r = signed(r);
        assert_eq!(check(&r), Err(ApplicationRecordError::InstallRootMismatch));
    }

    /// ...but the comparison tolerates the spellings Windows genuinely produces.
    #[test]
    fn the_install_root_comparison_tolerates_separator_and_case_differences() {
        let mut r = valid();
        r.install_root = r"c:/PROGRAM FILES/ProjectOS Control Center\".into();
        let r = signed(r);
        assert!(check(&r).is_ok());
    }

    #[test]
    fn a_tampered_field_breaks_the_digest() {
        let mut r = valid();
        r.governed_system_root = r"C:\ProgramData\Attacker".into();
        // digest NOT recomputed — this is the tamper case
        assert_eq!(check(&r), Err(ApplicationRecordError::DigestMismatch));
    }

    #[test]
    fn wrong_product_application_version_and_scope_are_each_refused() {
        for (mutate, expected) in [
            (
                Box::new(|r: &mut InstalledApplicationRecordV1| r.product = "NotProjectOS".into())
                    as Box<dyn Fn(&mut InstalledApplicationRecordV1)>,
                ApplicationRecordError::WrongProduct,
            ),
            (
                Box::new(|r: &mut InstalledApplicationRecordV1| {
                    r.application_id = "com.example.other".into()
                }),
                ApplicationRecordError::WrongApplicationId,
            ),
            (
                Box::new(|r: &mut InstalledApplicationRecordV1| {
                    r.application_version = "9.9.9".into()
                }),
                ApplicationRecordError::WrongApplicationVersion,
            ),
            (
                Box::new(|r: &mut InstalledApplicationRecordV1| {
                    r.installation_scope = "per-user".into()
                }),
                ApplicationRecordError::WrongInstallationScope,
            ),
        ] {
            let mut r = valid();
            mutate(&mut r);
            let r = signed(r);
            assert_eq!(check(&r), Err(expected));
        }
    }

    #[test]
    fn an_unsupported_schema_version_is_refused() {
        let mut r = valid();
        r.schema_version = 2;
        let r = signed(r);
        assert_eq!(check(&r), Err(ApplicationRecordError::UnsupportedVersion));
    }

    #[test]
    fn a_relative_or_traversing_governed_root_is_refused() {
        let mut rel = valid();
        rel.governed_system_root = r"ProgramData\ProjectOS\system".into();
        assert_eq!(
            check(&signed(rel)),
            Err(ApplicationRecordError::GovernedRootNotAbsolute)
        );

        let mut trav = valid();
        trav.governed_system_root = r"C:\ProgramData\ProjectOS\..\..\Windows".into();
        assert_eq!(
            check(&signed(trav)),
            Err(ApplicationRecordError::GovernedRootTraversal)
        );
    }

    /// A governed root inside the installation would put mutable state inside the attested tree.
    #[test]
    fn a_governed_root_inside_the_installation_is_refused() {
        for inside in [
            INSTALL,
            &format!(r"{INSTALL}\runtime-payload"),
            &format!(r"{INSTALL}\runtime-payload\daemon"),
            &format!(r"{INSTALL}\system"),
        ] {
            let mut r = valid();
            r.governed_system_root = (*inside).into();
            assert_eq!(
                check(&signed(r)),
                Err(ApplicationRecordError::GovernedRootInsideInstallation),
                "{inside} must be refused"
            );
        }
    }

    #[test]
    fn an_unknown_field_is_refused_rather_than_ignored() {
        let raw = br#"{
            "schemaVersion": 1, "product": "ProjectOS",
            "applicationId": "com.universalbizcomply.projectos.control",
            "applicationVersion": "0.1.0", "installationScope": "per-machine",
            "installRoot": "C:\\Program Files\\ProjectOS Control Center",
            "governedSystemRoot": "C:\\ProgramData\\ProjectOS\\system",
            "installationId": "inst-0001", "recordDigest": "00",
            "trustedAnchor": "attacker-supplied"
        }"#;
        assert_eq!(
            verify_application_record_bytes(raw, APP, VERSION, Path::new(INSTALL)),
            Err(ApplicationRecordError::Malformed)
        );
    }

    #[test]
    fn malformed_bytes_are_refused() {
        assert_eq!(
            verify_application_record_bytes(b"not json", APP, VERSION, Path::new(INSTALL)),
            Err(ApplicationRecordError::Malformed)
        );
    }

    /// [§15.1] THE COMPOSITION: a correct record yields evidence that corroborates a per-machine
    /// installation, and nothing weaker does.
    ///
    /// Proven in the two halves that actually exist, because the whole chain cannot be exercised
    /// without writing to ProgramData — which this increment is not authorised to do. Half one: a
    /// correct record verifies (above). Half two: `Matched` evidence, and only `Matched`, lifts a
    /// Program Files location to `PerMachineEvidenceMatched`.
    #[test]
    fn only_matched_evidence_corroborates_a_per_machine_installation() {
        use super::super::install_root::{classify_path, KnownRoots};
        use super::super::running_executable::ReparseState;

        let roots = KnownRoots::for_test(vec![r"C:\Program Files"], vec![r"C:\Users\x\AppData"]);
        let exe = r"c:\program files\projectos control center\projectos-control-center.exe";

        assert_eq!(
            classify_path(
                exe,
                ReparseState::None,
                InstallationEvidence::Matched,
                &roots
            ),
            InstallationIdentity::PerMachineEvidenceMatched
        );
        // [§16.1, §16.13] A copied tree under a Program Files-looking path, with no record or a
        // contradicted one, does NOT corroborate.
        for weak in [
            InstallationEvidence::Unavailable,
            InstallationEvidence::Missing,
            InstallationEvidence::Mismatched,
        ] {
            assert_eq!(
                classify_path(exe, ReparseState::None, weak, &roots),
                InstallationIdentity::PerMachineUnverified,
                "{weak:?} must not corroborate"
            );
        }
        // And the ceiling is corroboration, never authentication.
        assert_eq!(
            strongest_corroborated_identity(),
            InstallationIdentity::PerMachineEvidenceMatched
        );
        assert_ne!(
            strongest_corroborated_identity(),
            InstallationIdentity::PerMachineVerified
        );
    }

    /// [§16.7, §16.8, §16.11, §16.12] The record location is FIXED, and the governed root has no
    /// other source.
    ///
    /// There is one canonical path, built from the Known Folder anchor plus fixed segments — no
    /// candidate list, no search, no first-valid-wins. And the reader's whole input surface is that
    /// path: it takes no environment variable, no argv, and no manifest field, so a root injected by
    /// any of those is not refused, it is unrepresentable.
    #[test]
    fn the_record_location_is_fixed_and_has_no_alternative_source() {
        let path = canonical_application_record_path().expect("ProgramData resolves");
        let text = path.to_string_lossy().to_lowercase();
        assert!(text.ends_with(&format!(
            r"\{}\{}\{}\{}",
            EXPECTED_PRODUCT.to_lowercase(),
            HOST_STATE_DIRECTORY_SEGMENT,
            RECORD_SUBDIRECTORY,
            APPLICATION_RECORD_FILE_NAME
        )));
        assert!(path.is_absolute());

        // The module reads no ambient source for the location or the root. Both the comments and
        // THIS TEST MODULE are stripped first: the file necessarily discusses environment variables
        // and argv, and the list below literally contains the strings being forbidden. A scan that
        // reads its own forbidden list as evidence is a scan that can only ever fail.
        let src = include_str!("installed_application.rs");
        let production = &src[..src.find("#[cfg(test)]").unwrap_or(src.len())];
        let code: String = production
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        for forbidden in [
            "env::var",
            "env!(",
            "args()",
            "current_dir",
            "bridge.config",
        ] {
            assert!(
                !code.contains(forbidden),
                "the record reader must not consult {forbidden}"
            );
        }
    }

    /// The digest is domain-separated and length-prefixed, so moving characters between adjacent
    /// fields cannot produce the same digest.
    #[test]
    fn adjacent_field_boundaries_cannot_be_shifted() {
        let mut a = valid();
        a.installation_id = "inst".into();
        a.application_version = "0.1.0".into();
        let mut b = a.clone();
        b.installation_id = "ins".into();
        b.application_version = "0.1.0t".into();
        assert_ne!(
            compute_application_record_digest(&a),
            compute_application_record_digest(&b)
        );
    }
}
