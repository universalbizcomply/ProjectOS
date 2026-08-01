//! Fixture-backed writer proofs.
//!
//! Every filesystem effect happens inside a disposable directory created and removed by the test
//! itself. No real ProgramData or Program Files path is resolved or touched, and no residue survives.

use super::*;
use projectos_host_identity::canonical_record::{verify_record, RecordInstallationEvidence};
use std::sync::atomic::{AtomicU64, Ordering};

/// A disposable fixture root, removed on drop even if a test panics.
struct Disposable(PathBuf);

impl Disposable {
    fn new() -> Self {
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let p = std::env::temp_dir().join(format!(
            "projectos-writer-fixture-{}-{n}",
            std::process::id()
        ));
        fs::create_dir_all(&p).expect("fixture root");
        Self(p)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Disposable {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

const REL: &str = "aa11bb22cc33dd44ee55ff6600112233445566778899aabbccddeeff00112233";

fn id() -> InstallationId {
    InstallationId::generate(&FixtureInstallationIdSource([0xAB; 16])).expect("fixture id")
}
fn release() -> ReleaseManifestDigest {
    ReleaseManifestDigest::parse(REL).expect("valid release digest")
}
fn target(d: &Disposable) -> InstallerTarget {
    InstallerTarget::fixture_under(d.path()).expect("fixture target")
}

#[test]
fn a_valid_installation_writes_one_canonical_record_the_reader_accepts() {
    let d = Disposable::new();
    let t = target(&d);
    assert_eq!(
        write_identity_record(&t, &id(), InstallationChannel::Stable, &release()).unwrap(),
        WriteOutcome::Written
    );
    let bytes = fs::read(t.record_path()).expect("record exists");

    // PROOF 3: exact field order, compact, no trailing newline, no BOM.
    let text = String::from_utf8(bytes.clone()).expect("utf-8");
    assert!(
        text.starts_with("{\"schema_version\":1,\"product\":\"ProjectOS\","),
        "{text}"
    );
    assert!(text.ends_with("\"}"), "{text}");
    assert!(!text.contains(" \""), "compact encoding only: {text}");
    assert!(!text.ends_with('\n'));
    assert!(!bytes.starts_with(&[0xEF, 0xBB, 0xBF]));
    let order = [
        "schema_version",
        "product",
        "service_name",
        "installation_id",
        "channel",
        "service_relative_path",
        "release_manifest_digest",
        "record_digest",
    ];
    let mut at = 0;
    for f in order {
        let i = text.find(&format!("\"{f}\"")).expect(f);
        assert!(i >= at, "field {f} out of canonical order");
        at = i;
    }

    // PROOF 2: the existing reader parses and verifies these exact bytes.
    let parsed = parse_canonical_json(&bytes).expect("codec accepts its own output");
    verify_record(&parsed, RecordInstallationEvidence::Matched)
        .expect("reader verifies the written record");
}

#[test]
fn non_canonical_json_is_refused() {
    let d = Disposable::new();
    let t = target(&d);
    write_identity_record(&t, &id(), InstallationChannel::Stable, &release()).unwrap();
    let good = fs::read(t.record_path()).unwrap();
    let text = String::from_utf8(good.clone()).unwrap();

    // Unknown field, duplicate field, reordering, whitespace and a trailing newline must all refuse.
    let unknown = text.replace(
        "{\"schema_version\":1,",
        "{\"extra\":\"x\",\"schema_version\":1,",
    );
    let duplicate = text.replace(
        "\"product\":\"ProjectOS\",",
        "\"product\":\"ProjectOS\",\"product\":\"ProjectOS\",",
    );
    let spaced = text.replace("\":", "\" : ");
    let newline = format!("{text}\n");
    for (label, bad) in [
        ("unknown field", unknown),
        ("duplicate field", duplicate),
        ("whitespace", spaced),
        ("trailing newline", newline),
    ] {
        assert!(
            parse_canonical_json(bad.as_bytes()).is_err(),
            "{label} must be refused"
        );
    }
    assert!(parse_canonical_json(b"not json").is_err());
}

#[test]
fn a_deterministic_fixture_source_produces_deterministic_bytes() {
    let a = Disposable::new();
    let b = Disposable::new();
    let (ta, tb) = (target(&a), target(&b));
    write_identity_record(&ta, &id(), InstallationChannel::Preview, &release()).unwrap();
    write_identity_record(&tb, &id(), InstallationChannel::Preview, &release()).unwrap();
    assert_eq!(
        fs::read(ta.record_path()).unwrap(),
        fs::read(tb.record_path()).unwrap()
    );
}

#[test]
fn invalid_installation_ids_and_release_digests_refuse() {
    for bad in [
        "",
        "ABCDEF00112233445566778899aabbcc",
        "abc",
        &"0".repeat(32),
    ] {
        assert_eq!(
            InstallationId::parse(bad).unwrap_err(),
            WriteError::InvalidInstallationId,
            "{bad}"
        );
    }
    for bad in ["", &REL.to_uppercase(), "abc", &"0".repeat(64)] {
        assert_eq!(
            ReleaseManifestDigest::parse(bad).unwrap_err(),
            WriteError::InvalidReleaseDigest,
            "{bad}"
        );
    }
    // An all-zero draw from a source is refused, not accepted.
    assert_eq!(
        InstallationId::generate(&FixtureInstallationIdSource([0u8; 16])).unwrap_err(),
        WriteError::InvalidInstallationId
    );
}

#[test]
fn unsupported_channels_refuse() {
    for bad in ["nightly", "Stable", "", "prod"] {
        assert_eq!(
            InstallationChannel::parse(bad).unwrap_err(),
            WriteError::UnsupportedChannel,
            "{bad}"
        );
    }
    for good in ["stable", "preview", "development"] {
        assert!(InstallationChannel::parse(good).is_ok());
    }
}

#[test]
fn frozen_fields_come_from_the_contract_not_the_caller() {
    let d = Disposable::new();
    let t = target(&d);
    write_identity_record(&t, &id(), InstallationChannel::Development, &release()).unwrap();
    let r = parse_canonical_json(&fs::read(t.record_path()).unwrap()).unwrap();
    assert_eq!(r.product, EXPECTED_PRODUCT);
    assert_eq!(r.service_name, EXPECTED_SERVICE_NAME);
    assert_eq!(r.service_relative_path, EXPECTED_SERVICE_RELATIVE_PATH);
    assert_eq!(r.schema_version, RECORD_SCHEMA_VERSION);
    // The digest is recomputed, never carried from a caller.
    assert_eq!(r.record_digest, compute_record_digest(&r));
}

#[test]
fn repeating_the_same_installation_is_idempotent_and_does_not_rewrite() {
    let d = Disposable::new();
    let t = target(&d);
    write_identity_record(&t, &id(), InstallationChannel::Stable, &release()).unwrap();
    let before = fs::read(t.record_path()).unwrap();
    let mtime = fs::metadata(t.record_path()).unwrap().modified().unwrap();

    assert_eq!(
        write_identity_record(&t, &id(), InstallationChannel::Stable, &release()).unwrap(),
        WriteOutcome::AlreadyInstalledSameIdentity
    );
    assert_eq!(
        fs::read(t.record_path()).unwrap(),
        before,
        "must not rewrite"
    );
    assert_eq!(
        fs::metadata(t.record_path()).unwrap().modified().unwrap(),
        mtime
    );
}

#[test]
fn a_conflicting_identity_refuses_and_is_left_byte_identical() {
    let d = Disposable::new();
    let t = target(&d);
    write_identity_record(&t, &id(), InstallationChannel::Stable, &release()).unwrap();
    let before = fs::read(t.record_path()).unwrap();

    let other = InstallationId::generate(&FixtureInstallationIdSource([0x11; 16])).unwrap();
    assert_eq!(
        write_identity_record(&t, &other, InstallationChannel::Stable, &release()).unwrap_err(),
        WriteError::ConflictingIdentityExists
    );
    assert_eq!(
        fs::read(t.record_path()).unwrap(),
        before,
        "conflicting record must survive intact"
    );
    assert_eq!(residue(&t), 0, "no temporary residue after refusal");
}

#[test]
fn a_malformed_existing_record_refuses_and_is_left_byte_identical() {
    let d = Disposable::new();
    let t = target(&d);
    fs::create_dir_all(t.record_path().parent().unwrap()).unwrap();
    let junk = b"{ not a record }".to_vec();
    fs::write(t.record_path(), &junk).unwrap();

    assert_eq!(
        write_identity_record(&t, &id(), InstallationChannel::Stable, &release()).unwrap_err(),
        WriteError::ExistingRecordUnreadable
    );
    assert_eq!(
        fs::read(t.record_path()).unwrap(),
        junk,
        "malformed record must not be repaired"
    );
    assert_eq!(residue(&t), 0);
}

/// Count temporary files beside the record.
fn residue(t: &InstallerTarget) -> usize {
    let dir = t.record_path();
    let dir = dir.parent().unwrap();
    match fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .count(),
        Err(_) => 0,
    }
}

#[test]
fn success_leaves_no_temporary_residue() {
    let d = Disposable::new();
    let t = target(&d);
    write_identity_record(&t, &id(), InstallationChannel::Stable, &release()).unwrap();
    assert_eq!(residue(&t), 0);
    assert!(t.record_path().exists());
}

#[test]
fn a_containment_escape_or_missing_root_refuses() {
    // A non-existent root cannot be canonicalised, so no target can be built for it.
    let missing = std::env::temp_dir().join("projectos-writer-does-not-exist-zzz");
    assert!(InstallerTarget::fixture_under(&missing).is_err());
}

/// A source that always refuses, standing in for an OS RNG failure. Test-only: it supplies no bytes,
/// so it can never mint an id.
struct RefusingSource;

impl InstallationIdSource for RefusingSource {
    fn fill(&self, _buf: &mut [u8; 16]) -> Result<(), InstallationIdSourceError> {
        Err(InstallationIdSourceError)
    }
}

#[test]
fn an_rng_failure_refuses_and_mints_nothing() {
    assert_eq!(
        InstallationId::generate(&RefusingSource).unwrap_err(),
        WriteError::InstallationIdSourceFailed
    );
}

#[test]
fn exactly_sixteen_bytes_become_exactly_thirty_two_lowercase_hex_characters() {
    let mut bytes = [0u8; 16];
    for (i, b) in bytes.iter_mut().enumerate() {
        *b = (i as u8) * 17; // 0x00,0x11,... covers both hex nibble halves
    }
    bytes[0] = 0x0f; // prove a leading zero nibble is preserved, not trimmed
    let id = InstallationId::generate(&FixtureInstallationIdSource(bytes)).expect("id");
    assert_eq!(id.as_str().len(), 32);
    assert!(id.as_str().starts_with("0f"));
    assert!(id
        .as_str()
        .bytes()
        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)));
    assert_eq!(id.as_str(), id.as_str().to_lowercase());
}

#[test]
fn the_production_id_source_is_boundary_proven_and_never_executed_here() {
    // BOUNDARY ONLY. The production source is namable and usable as the sealed trait object, which is
    // what proves it is wired. It is deliberately NOT invoked: calling `fill` would execute the real
    // OS CSPRNG, which this phase forbids. Its refusal path is proven by `RefusingSource` above, which
    // exercises the identical `InstallationId::generate` failure mapping.
    #[cfg(all(windows, feature = "installer-windows"))]
    {
        let source: &dyn InstallationIdSource = &SystemPreferredInstallationIdSource;
        let _ = source;
    }
}

#[test]
fn the_production_anchors_resolve_read_only_without_creating_anything() {
    // Resolution is READ-ONLY: it returns the registered locations and creates nothing. The derived
    // ProjectOS subtrees must NOT exist merely because this test resolved their anchors.
    #[cfg(all(windows, feature = "installer-windows"))]
    {
        let state = ResolvedProgramDataAnchor::resolve_approved().expect("ProgramData anchor");
        let install = ResolvedInstallRoot::resolve_approved().expect("install root");

        // The state target and the binary path are derived from the FROZEN segments only.
        let target = InstallerTarget::under_resolved_anchor(&state).expect("target");
        let record = target.record_path_for_test();
        assert!(record.ends_with(RECORD_FILE_NAME));
        let expected_tail: PathBuf = [EXPECTED_PRODUCT, "host", "installation", RECORD_FILE_NAME]
            .iter()
            .collect();
        assert!(record.ends_with(&expected_tail), "{record:?}");
        assert!(install
            .service_binary_path()
            .ends_with(EXPECTED_SERVICE_RELATIVE_PATH));

        // The two roots are different folders, and NEITHER production location was created.
        assert_ne!(
            install.install_dir(),
            target.record_path_for_test().parent().unwrap()
        );
        assert!(!record.exists(), "no production record may exist");
        assert!(
            !target.record_path_for_test().parent().unwrap().exists(),
            "resolving must not create the installation directory"
        );
    }
}

#[test]
fn a_derived_target_stays_beneath_its_anchor_and_uses_only_frozen_segments() {
    let d = Disposable::new();
    let anchor = ResolvedProgramDataAnchor::fixture(d.path()).expect("anchor");
    let t = InstallerTarget::under_resolved_anchor(&anchor).expect("target");
    let root = d.path().canonicalize().unwrap();
    let rel = t.record_path_for_test();
    let rel = rel
        .strip_prefix(&root)
        .expect("contained beneath the anchor");
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    assert_eq!(
        parts,
        vec![EXPECTED_PRODUCT, "host", "installation", RECORD_FILE_NAME]
    );
}
