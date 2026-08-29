//! LOCAL FILE INTAKE — one file, one governed inbox, chosen by the owner.
//!
//! WHY THIS IS NOT A GOVERNED VERB. Copying a file the owner picked into a folder on their own
//! machine is a DEVICE operation, the same category as `pick_folder` / `prepare_folder`. Nothing in
//! `GOVERNED_VERBS` carries a path — deliberately, and every one of those verbs says so in its own
//! comment — and inventing one that did would put a filesystem destination inside the channel whose
//! whole design property is that it cannot name one. A file becomes governed by BEING in the
//! project, which the discovery and approval chain already handles.
//!
//! THE RENDERER CANNOT NAME A DESTINATION. `import_project_file` takes a project IDENTIFIER, never a
//! root. The root is resolved from the protected per-machine registry through
//! `resolve_registered_projects()`, which takes no parameters at all — so a renderer that wanted to
//! write outside a registered project has nothing to write into. The owner's picked path is used as
//! a READ SOURCE and is never joined to anything.
//!
//! IMPORTS ARE INERT. Files land under `.projectops/inbox/`, which `plan-discovery-engine.cjs`
//! excludes from its walk. They are stored and listed; they do not enter the planning corpus, do not
//! influence document precedence, and do not reach authoring. Making them live is a separate
//! decision with a much larger blast radius, because it changes what a paid call sees.
//!
//! Created in PROJECTOS-GOVERNED-UPLOAD-SEAM-IMPLEMENT1A.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::identity::hash::sha256_hex;

/// 50 MiB. A ceiling, not a quota: there is no accounting, no eviction and no per-project budget.
pub(crate) const MAX_IMPORT_BYTES: u64 = 52_428_800;

/// The one destination, relative to a registered project root. POSIX-spelled because the discovery
/// engine's exclusion compares the same string.
pub(crate) const INBOX_RELATIVE: &str = ".projectops/inbox";

/// Provenance lives in a subdirectory rather than beside the files, so a record can never be
/// mistaken for an imported file and an imported file can never be mistaken for a record.
const RECORDS_DIR: &str = ".records";

/// WHAT A SHELL WOULD RUN. An imported file is never executed by ProjectOS, but a governed
/// repository is a place a shell resolves names from: `system.ts` documents why `git` had to be
/// bound to one absolute executable, because on Windows an unqualified name resolves against the
/// spawning process's directory BEFORE `PATH`. Dropping executables into governed roots by hand
/// reopens that. Refused on the extension alone; V1 sniffs no content.
const DENIED_EXTENSIONS: &[&str] = &["exe", "dll", "ps1", "bat", "cmd", "js", "vbs", "msi"];

/// The ProjectOS application's own installed location, which is never a place for owner work.
/// The same literal `prepare_folder` guards against, for the same reason.
const INSTALL_ROOT: &str = "C:\\Program Files\\ProjectOS Control Center";

/// What the owner said the file is FOR. Metadata in V1: nothing branches on it.
///
/// Deliberately NOT mapped onto the plan schema's `sourceDocumentType`. That vocabulary describes
/// documents a plan was approved against, and an inert import is not one — asserting the mapping now
/// would record a binding that does not exist.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ImportPurpose {
    Specification,
    Reference,
    Evidence,
    Other,
}

impl ImportPurpose {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "SPECIFICATION" => Some(Self::Specification),
            "REFERENCE" => Some(Self::Reference),
            "EVIDENCE" => Some(Self::Evidence),
            "OTHER" => Some(Self::Other),
            _ => None,
        }
    }

    const fn token(self) -> &'static str {
        match self {
            Self::Specification => "SPECIFICATION",
            Self::Reference => "REFERENCE",
            Self::Evidence => "EVIDENCE",
            Self::Other => "OTHER",
        }
    }
}

/// Why an import did not happen. A closed token, never a raw error string and never a path.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ImportRefusal {
    /// No registered project with that identity, so there is no root to write into.
    UnknownProject,
    /// The chosen purpose is not one of the four.
    InvalidPurpose,
    /// The picked path names nothing this process can read, or is not a file.
    UnreadableSource,
    /// The name does not survive being reduced to a plain file name.
    UnusableName,
    /// An executable or script.
    UnsupportedType,
    /// Larger than the ceiling.
    TooLarge,
    /// A file of that name is already in this project's inbox. V1 refuses; it never renames.
    AlreadyExists,
    /// The destination did not stay inside the project root once links were resolved.
    UnsafePath,
    /// The copy itself failed.
    CopyFailed,
}

impl ImportRefusal {
    /// One sentence the owner can act on. No paths, no error codes, no internals.
    const fn message(self) -> &'static str {
        match self {
            Self::UnknownProject => "ProjectOS could not find that project on this computer.",
            Self::InvalidPurpose => "Choose what this file is for before adding it.",
            Self::UnreadableSource => "That file could not be read. Check it still exists.",
            Self::UnusableName => "That file's name cannot be used. Rename it and try again.",
            Self::UnsupportedType => {
                "Programs and scripts cannot be added to a project. Choose a document instead."
            }
            Self::TooLarge => "That file is larger than 50 MB, which is the limit for a project file.",
            Self::AlreadyExists => {
                "A file with that name is already in this project. Rename it and try again."
            }
            Self::UnsafePath => {
                "That project's folder could not be used safely, so nothing was copied."
            }
            Self::CopyFailed => "The file could not be copied. Nothing was changed.",
        }
    }
}

/// The outcome of one import. `ok` and `refusal` are exclusive.
#[derive(Serialize)]
pub struct ImportOutcome {
    pub ok: bool,
    /// The name it was stored under. Present only on success.
    pub file_name: Option<String>,
    pub refusal: Option<ImportRefusal>,
    /// The sentence to show. Always populated, success or refusal.
    pub message: String,
}

impl ImportOutcome {
    const fn refused(refusal: ImportRefusal) -> Self {
        Self {
            ok: false,
            file_name: None,
            refusal: Some(refusal),
            message: String::new(),
        }
    }

    /// Fill the sentence in. Kept separate because `message()` is const and `String` is not.
    fn with_message(mut self) -> Self {
        if let Some(refusal) = self.refusal {
            self.message = refusal.message().to_string();
        }
        self
    }
}

/// One imported file, as the Files tab shows it.
#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
pub struct ImportedFile {
    pub file_name: String,
    /// The purpose token, or `null` when the record is missing or unreadable — the file is still
    /// listed, because it is really there and hiding it would be the less truthful answer.
    pub purpose: Option<String>,
    pub size_bytes: u64,
    /// Milliseconds since the epoch. Formatted by the surface that displays it; no date arithmetic
    /// is done here, and none is invented when the record is absent.
    pub imported_at_epoch_ms: Option<u64>,
}

/// What the Files tab renders.
#[derive(Serialize)]
pub struct FilesListing {
    pub ok: bool,
    pub files: Vec<ImportedFile>,
    pub message: String,
}

// -------------------------------------------------------------------------------------------
// PURE RULES. No filesystem, no registry — so every refusal is provable without a machine layout.
// -------------------------------------------------------------------------------------------

/// Reduce a picked path to the plain file name it will be stored under.
///
/// TRAVERSAL DIES HERE, BY CONSTRUCTION rather than by pattern-matching: only the final component
/// survives, so `..\..\etc\thing` cannot address anything — there is no directory component left to
/// address with. The remaining checks refuse the names that survive that reduction and still cannot
/// be used.
pub(crate) fn storable_file_name(source: &Path) -> Option<String> {
    let name = source.file_name()?.to_str()?;
    if name.is_empty() || name == "." || name == ".." {
        return None;
    }
    if name.contains('\0') || name.contains('/') || name.contains('\\') || name.contains(':') {
        return None;
    }
    // A NAME WINDOWS WOULD REWRITE IS A NAME THAT DEFEATS THE EXTENSION CHECK.
    //
    // Windows silently strips trailing dots and spaces, so `tool.exe.` and `tool.exe ` both land on
    // disk as `tool.exe` — while Rust reports their extensions as "" and "exe ", neither of which is
    // in the denylist. Checking the extension of a name the filesystem is about to change is
    // checking the wrong string, so the name is refused instead of guessed at.
    if name.ends_with('.') || name.ends_with(' ') {
        return None;
    }
    // The provenance directory is not a file this can be asked to write. Allowing it would let one
    // import destroy the record store, and every later import in that project would silently lose
    // its provenance.
    if name.eq_ignore_ascii_case(RECORDS_DIR) {
        return None;
    }
    Some(name.to_string())
}

/// True if the name ends in something a shell would run.
pub(crate) fn is_denied_extension(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| {
            let lower = ext.to_ascii_lowercase();
            DENIED_EXTENSIONS.contains(&lower.as_str())
        })
}

// -------------------------------------------------------------------------------------------
// THE IMPORT, against an EXPLICIT root.
//
// Split out so the guards are exercisable against a temporary directory. It is crate-private and no
// command reaches it with a caller-supplied root: the only public entry resolves the root itself.
// -------------------------------------------------------------------------------------------

/// Compare paths the way Windows resolves them. The same rule `project_setup::normalise` applies,
/// and it is spelled again here rather than shared because that one is a wizard-local helper and
/// widening its visibility to reach it would export a path rule this crate keeps private.
fn comparable(p: &Path) -> String {
    p.to_string_lossy()
        .trim_start_matches("\\\\?\\")
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

/// Resolve the inbox for a root, proving containment AFTER links are resolved.
///
/// LEXICAL CONTAINMENT IS NOT ENOUGH HERE. `governedContext.ts` records the gap it lives with: its
/// check is lexical, a symlink planted inside a root still resolves outside it, and its `System`
/// exposes no realpath. Every existing caller only READS through that. This is the first thing that
/// would WRITE through it, so containment is decided by `canonicalize`, which resolves junctions and
/// symlinks, and the comparison is between two canonical paths.
fn resolve_inbox(root: &Path) -> Result<PathBuf, ImportRefusal> {
    // NEVER THE APPLICATION'S OWN INSTALLATION. `prepare_folder` refuses the same location for the
    // same reason: a project is the owner's work, not ours. Asked LEXICALLY first, so a path under
    // the installation that does not exist yet is still refused as unsafe rather than reported as an
    // unknown project — the answer an owner can act on is the one about the location.
    if comparable(root).starts_with(&comparable(Path::new(INSTALL_ROOT))) {
        return Err(ImportRefusal::UnsafePath);
    }

    let canonical_root = std::fs::canonicalize(root).map_err(|_| ImportRefusal::UnknownProject)?;
    // Asked again once links are resolved: a root that merely POINTS into the installation is the
    // case the lexical check above cannot see.
    if comparable(&canonical_root).starts_with(&comparable(Path::new(INSTALL_ROOT))) {
        return Err(ImportRefusal::UnsafePath);
    }

    let inbox = canonical_root.join(".projectops").join("inbox");
    std::fs::create_dir_all(&inbox).map_err(|_| ImportRefusal::UnsafePath)?;

    // The directory that now exists may be a reparse point pointing anywhere. Ask where it REALLY
    // is, and refuse if that is not inside the project.
    let canonical_inbox = std::fs::canonicalize(&inbox).map_err(|_| ImportRefusal::UnsafePath)?;
    if !canonical_inbox.starts_with(&canonical_root) {
        return Err(ImportRefusal::UnsafePath);
    }
    Ok(canonical_inbox)
}

/// Import one file into one root. Every guard, in the order a refusal is cheapest.
pub(crate) fn import_into_root(
    root: &Path,
    project_id: &str,
    source: &Path,
    purpose: ImportPurpose,
    now_epoch_ms: u64,
) -> ImportOutcome {
    let Some(file_name) = storable_file_name(source) else {
        return ImportOutcome::refused(ImportRefusal::UnusableName).with_message();
    };
    if is_denied_extension(&file_name) {
        return ImportOutcome::refused(ImportRefusal::UnsupportedType).with_message();
    }

    // Read the source before touching the destination, so a failure here changes nothing at all.
    let Ok(metadata) = std::fs::metadata(source) else {
        return ImportOutcome::refused(ImportRefusal::UnreadableSource).with_message();
    };
    if !metadata.is_file() {
        return ImportOutcome::refused(ImportRefusal::UnreadableSource).with_message();
    }
    if metadata.len() > MAX_IMPORT_BYTES {
        return ImportOutcome::refused(ImportRefusal::TooLarge).with_message();
    }
    let Ok(bytes) = std::fs::read(source) else {
        return ImportOutcome::refused(ImportRefusal::UnreadableSource).with_message();
    };
    // Checked again against what was actually read: a file can grow between the stat and the read,
    // and the ceiling is about what gets stored, not about what was advertised.
    if bytes.len() as u64 > MAX_IMPORT_BYTES {
        return ImportOutcome::refused(ImportRefusal::TooLarge).with_message();
    }

    let inbox = match resolve_inbox(root) {
        Ok(inbox) => inbox,
        Err(refusal) => return ImportOutcome::refused(refusal).with_message(),
    };
    let destination = inbox.join(&file_name);
    // The belt to `storable_file_name`'s braces: whatever the name was, the file must land directly
    // in the inbox and nowhere else.
    if destination.parent() != Some(inbox.as_path()) {
        return ImportOutcome::refused(ImportRefusal::UnsafePath).with_message();
    }

    // CREATE-NEW IS THE NO-OVERWRITE PROOF, and it is atomic. `exists()` then `write` is not one:
    // two callers both see "absent" and the second silently destroys the first's file.
    let mut handle = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
    {
        Ok(handle) => handle,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            return ImportOutcome::refused(ImportRefusal::AlreadyExists).with_message()
        }
        Err(_) => return ImportOutcome::refused(ImportRefusal::CopyFailed).with_message(),
    };
    if handle.write_all(&bytes).is_err() {
        drop(handle);
        let _ = std::fs::remove_file(&destination);
        return ImportOutcome::refused(ImportRefusal::CopyFailed).with_message();
    }
    drop(handle);

    write_record(
        &inbox,
        project_id,
        &file_name,
        purpose,
        bytes.len() as u64,
        &sha256_hex(&bytes),
        now_epoch_ms,
    );

    ImportOutcome {
        ok: true,
        file_name: Some(file_name.clone()),
        refusal: None,
        message: format!("{file_name} was added to this project."),
    }
}

/// The provenance record. Deliberately small, and deliberately WITHOUT the owner's original
/// absolute path: knowing where on their machine a document came from is not needed to know what it
/// is, and storing it would put a private directory layout into a governed repository. The name is
/// preserved verbatim on import — imports are refused rather than renamed — so the stored name IS
/// the source name and does not need recording twice.
///
/// A failure to write it is not a failure to import: the file is really there, and a listing that
/// hid it because its sidecar was missing would be less truthful, not safer.
fn write_record(
    inbox: &Path,
    project_id: &str,
    file_name: &str,
    purpose: ImportPurpose,
    size_bytes: u64,
    sha256: &str,
    now_epoch_ms: u64,
) {
    let records = inbox.join(RECORDS_DIR);
    if std::fs::create_dir_all(&records).is_err() {
        return;
    }
    let record = serde_json::json!({
        "recordVersion": 1,
        "projectId": project_id,
        "fileName": file_name,
        "relativePath": format!("{INBOX_RELATIVE}/{file_name}"),
        "purpose": purpose.token(),
        "sizeBytes": size_bytes,
        "sha256": sha256,
        "importedAtEpochMs": now_epoch_ms,
    });
    let Ok(encoded) = serde_json::to_vec_pretty(&record) else {
        return;
    };
    let _ = std::fs::write(records.join(format!("{file_name}.json")), encoded);
}

/// List the governed inbox for a root. Files only; the record directory is not a file.
pub(crate) fn list_in_root(root: &Path) -> Vec<ImportedFile> {
    let Ok(canonical_root) = std::fs::canonicalize(root) else {
        return Vec::new();
    };
    let inbox = canonical_root.join(".projectops").join("inbox");
    let Ok(entries) = std::fs::read_dir(&inbox) else {
        // No inbox yet is an ordinary state, not an error: nothing has been imported.
        return Vec::new();
    };
    let records = inbox.join(RECORDS_DIR);

    let mut files: Vec<ImportedFile> = Vec::new();
    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let (purpose, imported_at_epoch_ms) = read_record(&records, &name);
        files.push(ImportedFile {
            file_name: name,
            purpose,
            size_bytes,
            imported_at_epoch_ms,
        });
    }
    // Newest first, then by name so the order is stable when timestamps are absent or equal.
    files.sort_by(|a, b| {
        b.imported_at_epoch_ms
            .cmp(&a.imported_at_epoch_ms)
            .then_with(|| a.file_name.cmp(&b.file_name))
    });
    files
}

/// Read one sidecar. Missing or malformed yields `None`s rather than a guess.
fn read_record(records: &Path, file_name: &str) -> (Option<String>, Option<u64>) {
    let Ok(raw) = std::fs::read_to_string(records.join(format!("{file_name}.json"))) else {
        return (None, None);
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return (None, None);
    };
    let purpose = parsed
        .get("purpose")
        .and_then(|v| v.as_str())
        .filter(|token| ImportPurpose::parse(token).is_some())
        .map(str::to_string);
    let imported = parsed.get("importedAtEpochMs").and_then(|v| v.as_u64());
    (purpose, imported)
}

// -------------------------------------------------------------------------------------------
// THE COMMANDS. Each takes a project IDENTIFIER and resolves the root itself.
// -------------------------------------------------------------------------------------------

/// The registered root for an identity, or `None`. The registry read takes no parameters, so there
/// is no route by which a caller could name a different registry.
fn registered_root(project_id: &str) -> Option<PathBuf> {
    crate::process::installed_projects::resolve_registered_projects()
        .projects()
        .iter()
        .find(|(id, _)| id == project_id)
        .map(|(_, root)| root.clone())
}

fn now_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Copy ONE owner-picked file into ONE registered project's governed inbox.
///
/// `project_id` is an identity, not a location. `source_path` is a read source and is never joined
/// to anything — only its final component survives, as the name the copy is stored under.
#[tauri::command(async)]
pub fn import_project_file(
    project_id: String,
    source_path: String,
    purpose: String,
) -> ImportOutcome {
    let Some(purpose) = ImportPurpose::parse(&purpose) else {
        return ImportOutcome::refused(ImportRefusal::InvalidPurpose).with_message();
    };
    let Some(root) = registered_root(&project_id) else {
        return ImportOutcome::refused(ImportRefusal::UnknownProject).with_message();
    };
    import_into_root(
        &root,
        &project_id,
        Path::new(&source_path),
        purpose,
        now_epoch_ms(),
    )
}

/// What is in one registered project's governed inbox. Reads; changes nothing.
#[tauri::command(async)]
pub fn list_project_files(project_id: String) -> FilesListing {
    let Some(root) = registered_root(&project_id) else {
        return FilesListing {
            ok: false,
            files: Vec::new(),
            message: ImportRefusal::UnknownProject.message().to_string(),
        };
    };
    FilesListing {
        ok: true,
        files: list_in_root(&root),
        message: String::new(),
    }
}

#[cfg(test)]
mod tests;
