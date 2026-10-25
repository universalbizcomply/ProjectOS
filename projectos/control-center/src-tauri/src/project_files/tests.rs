//! WHAT AN IMPORT MUST NEVER DO.
//!
//! The happy path is one assertion. Everything else here is a refusal, because the risk in this
//! feature is not that a file fails to copy — it is that one lands somewhere it was never meant to,
//! or lands on top of something that was already there.
//!
//! The guards run against an EXPLICIT root so they are provable without a machine registry. That is
//! also the shape production uses: the root is resolved once, from the protected registry, and every
//! rule below then applies to it.
//!
//! Created in PROJECTOS-GOVERNED-UPLOAD-SEAM-IMPLEMENT1A.

use super::*;

const NOW: u64 = 1_756_500_000_000;

/// A disposable project root. Named per test so concurrent tests cannot collide.
fn root(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("projectos-files-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp root");
    std::fs::canonicalize(&dir).expect("canonical temp root")
}

/// A disposable source file with known bytes.
fn source(name: &str, file: &str, content: &[u8]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("projectos-files-src-{name}"));
    std::fs::create_dir_all(&dir).expect("source dir");
    let path = dir.join(file);
    std::fs::write(&path, content).expect("source file");
    path
}

fn inbox_of(root: &Path) -> PathBuf {
    root.join(".projectops").join("inbox")
}

fn import(root: &Path, src: &Path) -> ImportOutcome {
    import_into_root(root, "acme", src, ImportPurpose::Specification, NOW)
}

// -------------------------------------------------------------------------------------------
// IT WORKS, AND IT LEAVES THE OWNER'S FILE ALONE.
// -------------------------------------------------------------------------------------------

#[test]
fn a_chosen_file_lands_in_the_projects_governed_inbox() {
    let root = root("happy");
    let src = source("happy", "booking-spec.md", b"# Booking reminders\n");

    let outcome = import(&root, &src);

    assert!(outcome.ok, "{}", outcome.message);
    assert_eq!(outcome.file_name.as_deref(), Some("booking-spec.md"));
    assert_eq!(
        std::fs::read(inbox_of(&root).join("booking-spec.md")).unwrap(),
        b"# Booking reminders\n"
    );
}

#[test]
fn the_original_is_never_touched() {
    let root = root("original");
    let src = source("original", "brief.md", b"unchanged");

    assert!(import(&root, &src).ok);

    // Still there, still byte-identical. A copy, never a move.
    assert_eq!(std::fs::read(&src).unwrap(), b"unchanged");
}

#[test]
fn nothing_is_created_until_something_is_imported() {
    // What cancelling looks like from the filesystem's point of view: the command never ran, so the
    // inbox does not exist and the listing is empty rather than invented.
    let root = root("cancel");

    assert!(!inbox_of(&root).exists());
    assert!(list_in_root(&root).is_empty());
}

// -------------------------------------------------------------------------------------------
// IT CANNOT BE STEERED OUT OF THE PROJECT.
// -------------------------------------------------------------------------------------------

#[test]
fn a_traversing_source_path_cannot_move_the_destination() {
    // WHAT THE GUARANTEE IS ABOUT. The picked path is a READ source — whatever it resolves to is
    // what gets read, and `..` inside it is ordinary. What it must never do is influence where the
    // copy LANDS. Here the source is reached through a `..`, and the destination is unmoved.
    let root = root("traversal");
    let src = source("traversal", "payload.md", b"x");
    std::fs::create_dir_all(src.parent().unwrap().join("nested")).unwrap();
    let outside = std::env::temp_dir().join("payload.md");
    let outside_existed = outside.exists();

    let through_traversal = src.parent().unwrap().join("nested").join("..").join("payload.md");
    let outcome = import(&root, &through_traversal);

    // Only the final component survives, so this is an ordinary import of `payload.md` into THIS
    // project — and nothing was written anywhere the traversal pointed through.
    assert!(outcome.ok, "{}", outcome.message);
    assert_eq!(outcome.file_name.as_deref(), Some("payload.md"));
    assert_eq!(
        std::fs::read(inbox_of(&root).join("payload.md")).unwrap(),
        b"x"
    );
    assert_eq!(
        outside.exists(),
        outside_existed,
        "the import created a file outside every project root"
    );
}

#[test]
fn a_name_that_is_only_a_traversal_is_refused() {
    let root = root("dots");
    let outcome = import_into_root(
        &root,
        "acme",
        Path::new("C:\\somewhere\\.."),
        ImportPurpose::Reference,
        NOW,
    );
    assert_eq!(outcome.refusal, Some(ImportRefusal::UnusableName));
}

#[test]
fn an_inbox_that_points_outside_the_project_is_refused() {
    // THE M1 GAP, CLOSED WHERE IT WOULD FIRST BE WRITTEN THROUGH. A lexical containment check
    // passes here — `<root>/.projectops/inbox` is spelled inside the root — and the file would
    // still be written into an entirely different directory.
    let root = root("junction");
    let elsewhere = std::env::temp_dir().join("projectos-files-junction-elsewhere");
    let _ = std::fs::remove_dir_all(&elsewhere);
    std::fs::create_dir_all(&elsewhere).expect("escape target");
    std::fs::create_dir_all(root.join(".projectops")).expect("projectops");

    // A directory junction needs no privilege, unlike a symlink.
    let made = std::process::Command::new("C:\\Windows\\System32\\cmd.exe")
        .args([
            "/c",
            "mklink",
            "/J",
            &inbox_of(&root).to_string_lossy(),
            &elsewhere.to_string_lossy(),
        ])
        .output()
        .expect("mklink runs");
    assert!(
        made.status.success(),
        "this proof needs a directory junction: {}",
        String::from_utf8_lossy(&made.stderr)
    );

    let src = source("junction", "escape.md", b"should not land outside");
    let outcome = import(&root, &src);

    assert_eq!(outcome.refusal, Some(ImportRefusal::UnsafePath));
    assert!(
        !elsewhere.join("escape.md").exists(),
        "the file escaped the project root"
    );
}

#[test]
fn the_applications_own_installation_is_never_a_project() {
    // A REAL source, so the refusal proven here is the one about the DESTINATION. Refusals run
    // cheapest-first, and an unreadable source would otherwise answer before the location is
    // examined at all — a green test that proved nothing about the install guard.
    let src = source("install", "brief.md", b"owner work");
    let outcome = import_into_root(
        Path::new("C:\\Program Files\\ProjectOS Control Center\\projects\\acme"),
        "acme",
        &src,
        ImportPurpose::Other,
        NOW,
    );
    assert_eq!(outcome.refusal, Some(ImportRefusal::UnsafePath));
}

#[test]
fn one_import_reaches_exactly_one_projects_inbox() {
    // Cross-project write is unrepresentable rather than refused: the destination comes from the
    // root that was resolved, so naming a second project in the SOURCE path changes nothing.
    let mine = root("mine");
    let theirs = root("theirs");
    let src = source("cross", "shared.md", b"one copy only");

    assert!(import(&mine, &src).ok);

    assert!(inbox_of(&mine).join("shared.md").is_file());
    assert!(!inbox_of(&theirs).join("shared.md").exists());
    assert!(list_in_root(&theirs).is_empty());
}

// -------------------------------------------------------------------------------------------
// IT REFUSES WHAT IT SHOULD NOT STORE.
// -------------------------------------------------------------------------------------------

#[test]
fn programs_and_scripts_are_refused() {
    for name in ["tool.exe", "hook.ps1", "run.bat", "go.cmd", "lib.dll", "s.vbs", "p.js", "i.msi"] {
        let root = root(&format!("denied-{name}"));
        let src = source("denied", name, b"whatever");
        let outcome = import(&root, &src);
        assert_eq!(
            outcome.refusal,
            Some(ImportRefusal::UnsupportedType),
            "{name} was not refused"
        );
        assert!(!inbox_of(&root).join(name).exists());
    }
}

#[test]
fn a_name_windows_would_rewrite_is_refused() {
    // THE DENYLIST BYPASS THIS EXISTS TO CLOSE. Windows strips trailing dots and spaces, so both of
    // these land on disk as `tool.exe` — while Rust reports their extensions as "" and "exe ",
    // neither of which the denylist matches. Checking the extension of a name the filesystem is
    // about to rewrite is checking the wrong string.
    for name in ["tool.exe.", "tool.exe ", "hook.ps1.", "brief.md."] {
        assert_eq!(
            storable_file_name(Path::new(name)),
            None,
            "{name} was accepted, and Windows would have stored it under a different name"
        );
    }
    // An ordinary name is unaffected.
    assert_eq!(storable_file_name(Path::new("brief.md")).as_deref(), Some("brief.md"));
}

#[test]
fn the_provenance_directory_cannot_be_overwritten_by_an_import() {
    // Accepting this name would destroy the record store, and every later import in that project
    // would silently lose its provenance.
    assert_eq!(storable_file_name(Path::new("C:\\docs\\.records")), None);
    assert_eq!(storable_file_name(Path::new("C:\\docs\\.RECORDS")), None);
}

#[test]
fn a_trailing_dot_executable_never_reaches_the_inbox() {
    let root = root("trailingdot");
    let src = source("trailingdot", "payload.md", b"x");
    let disguised = src.parent().unwrap().join("tool.exe.");
    // The source need not exist: the name is refused before anything is read.
    let outcome = import(&root, &disguised);
    assert_eq!(outcome.refusal, Some(ImportRefusal::UnusableName));
    assert!(!inbox_of(&root).join("tool.exe").exists());
}

#[test]
fn the_denylist_does_not_care_about_case() {
    assert!(is_denied_extension("Payload.EXE"));
    assert!(is_denied_extension("Script.Ps1"));
    // …and does not refuse documents that merely contain the letters.
    assert!(!is_denied_extension("executables-explained.md"));
    assert!(!is_denied_extension("notes.txt"));
}

#[test]
fn a_file_over_the_ceiling_is_refused_before_anything_is_written() {
    let root = root("toolarge");
    let src = source("toolarge", "big.bin", &vec![0u8; (MAX_IMPORT_BYTES + 1) as usize]);

    let outcome = import(&root, &src);

    assert_eq!(outcome.refusal, Some(ImportRefusal::TooLarge));
    assert!(!inbox_of(&root).join("big.bin").exists());
}

#[test]
fn a_file_exactly_at_the_ceiling_is_allowed() {
    // The boundary is inclusive, and a ceiling nobody can reach is a different ceiling.
    let root = root("atlimit");
    let src = source("atlimit", "limit.bin", &vec![7u8; MAX_IMPORT_BYTES as usize]);
    assert!(import(&root, &src).ok);
}

#[test]
fn a_source_that_is_not_a_file_is_refused() {
    let root = root("notafile");
    let dir = std::env::temp_dir().join("projectos-files-notafile-dir");
    std::fs::create_dir_all(&dir).unwrap();
    let outcome = import(&root, &dir);
    assert_eq!(outcome.refusal, Some(ImportRefusal::UnreadableSource));
}

#[test]
fn a_purpose_outside_the_four_is_refused() {
    assert!(ImportPurpose::parse("SPECIFICATION").is_some());
    assert!(ImportPurpose::parse("REFERENCE").is_some());
    assert!(ImportPurpose::parse("EVIDENCE").is_some());
    assert!(ImportPurpose::parse("OTHER").is_some());
    assert!(ImportPurpose::parse("ANYTHING_ELSE").is_none());
    assert!(ImportPurpose::parse("specification").is_none());
}

// -------------------------------------------------------------------------------------------
// IT NEVER DESTROYS WHAT IS ALREADY THERE.
// -------------------------------------------------------------------------------------------

#[test]
fn a_second_file_of_the_same_name_is_refused_and_the_first_survives() {
    let root = root("duplicate");
    let first = source("dup-a", "spec.md", b"the first one");
    assert!(import(&root, &first).ok);

    // A DIFFERENT file, the SAME name — the case where a silent overwrite loses work.
    let second = source("dup-b", "spec.md", b"a completely different document");
    let outcome = import(&root, &second);

    assert_eq!(outcome.refusal, Some(ImportRefusal::AlreadyExists));
    assert_eq!(
        std::fs::read(inbox_of(&root).join("spec.md")).unwrap(),
        b"the first one",
        "the stored file was overwritten"
    );
}

// -------------------------------------------------------------------------------------------
// IT RECORDS WHAT IT DID, AND NOT WHERE THE OWNER KEEPS THEIR FILES.
// -------------------------------------------------------------------------------------------

#[test]
fn provenance_records_the_facts_and_omits_the_owners_directory() {
    let root = root("record");
    let src = source("record", "evidence.md", b"proof");
    assert!(import_into_root(&root, "acme", &src, ImportPurpose::Evidence, NOW).ok);

    let raw = std::fs::read_to_string(
        inbox_of(&root).join(".records").join("evidence.md.json"),
    )
    .expect("record written");
    let record: serde_json::Value = serde_json::from_str(&raw).unwrap();

    assert_eq!(record["projectId"], "acme");
    assert_eq!(record["fileName"], "evidence.md");
    assert_eq!(record["relativePath"], ".projectops/inbox/evidence.md");
    assert_eq!(record["purpose"], "EVIDENCE");
    assert_eq!(record["sizeBytes"], 5);
    assert_eq!(record["importedAtEpochMs"], NOW);
    assert_eq!(record["sha256"].as_str().unwrap().len(), 64);

    // The owner's own directory layout is not governed content and is deliberately absent.
    let source_dir = src.parent().unwrap().to_string_lossy().to_lowercase();
    assert!(
        !raw.to_lowercase().contains(&source_dir),
        "the record leaked the owner's source directory"
    );
}

// -------------------------------------------------------------------------------------------
// THE LISTING IS THE INBOX, AND ONLY THE INBOX.
// -------------------------------------------------------------------------------------------

#[test]
fn the_listing_shows_imported_files_and_not_their_records() {
    let root = root("listing");
    assert!(import_into_root(
        &root,
        "acme",
        &source("list-a", "one.md", b"a"),
        ImportPurpose::Reference,
        NOW
    )
    .ok);
    assert!(import_into_root(
        &root,
        "acme",
        &source("list-b", "two.md", b"bb"),
        ImportPurpose::Evidence,
        NOW + 1000
    )
    .ok);

    let files = list_in_root(&root);

    // Newest first. The record directory is not a file and never appears.
    assert_eq!(
        files.iter().map(|f| f.file_name.as_str()).collect::<Vec<_>>(),
        vec!["two.md", "one.md"]
    );
    assert_eq!(files[0].purpose.as_deref(), Some("EVIDENCE"));
    assert_eq!(files[0].size_bytes, 2);
    assert_eq!(files[1].purpose.as_deref(), Some("REFERENCE"));
    assert_eq!(files[1].imported_at_epoch_ms, Some(NOW));
}

#[test]
fn the_listing_does_not_reach_outside_the_inbox() {
    let root = root("scoped");
    std::fs::write(root.join("README.md"), b"project file, not an import").unwrap();
    std::fs::create_dir_all(root.join(".projectops")).unwrap();
    std::fs::write(root.join(".projectops").join("plan.json"), b"{}").unwrap();

    assert!(import(&root, &source("scoped", "brief.md", b"x")).ok);

    let files = list_in_root(&root);
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].file_name, "brief.md");
}

#[test]
fn a_file_whose_record_is_missing_is_still_listed() {
    // The file is really there. Hiding it because its sidecar is gone would be the less truthful
    // answer, so the unknown fields are reported as unknown instead.
    let root = root("norecord");
    assert!(import(&root, &source("norecord", "orphan.md", b"still here")).ok);
    std::fs::remove_dir_all(inbox_of(&root).join(".records")).unwrap();

    let files = list_in_root(&root);
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].file_name, "orphan.md");
    assert_eq!(files[0].purpose, None);
    assert_eq!(files[0].imported_at_epoch_ms, None);
}

// -------------------------------------------------------------------------------------------
// THE COMMAND SURFACE ITSELF.
// -------------------------------------------------------------------------------------------

#[test]
fn an_unregistered_project_has_no_root_to_write_into() {
    // Reads the real per-machine registry and changes nothing. No such project can be registered:
    // the identifier is not one the registry's own charset accepts.
    let outcome = import_project_file(
        "not a registered project".to_string(),
        "C:\\somewhere\\brief.md".to_string(),
        "REFERENCE".to_string(),
    );
    assert_eq!(outcome.refusal, Some(ImportRefusal::UnknownProject));

    let listing = list_project_files("not a registered project".to_string());
    assert!(!listing.ok);
    assert!(listing.files.is_empty());
}

#[test]
fn every_refusal_says_something_an_owner_can_act_on() {
    for refusal in [
        ImportRefusal::UnknownProject,
        ImportRefusal::InvalidPurpose,
        ImportRefusal::UnreadableSource,
        ImportRefusal::UnusableName,
        ImportRefusal::UnsupportedType,
        ImportRefusal::TooLarge,
        ImportRefusal::AlreadyExists,
        ImportRefusal::UnsafePath,
        ImportRefusal::CopyFailed,
    ] {
        let message = refusal.message();
        assert!(!message.is_empty());
        // No paths, no drive letters, no error codes.
        assert!(!message.contains('\\'), "{refusal:?} leaked a path");
        assert!(!message.contains(":\\"), "{refusal:?} leaked a path");
    }
}
