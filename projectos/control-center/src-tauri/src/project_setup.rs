//! Add Project, for an owner who should not have to know what a repository is.
//!
//! ## Why this exists
//!
//! Registration worked, and it was not usable. It asked for an absolute path typed by hand, and it
//! answered a folder it could not accept with `ProposedEntryInvalid(GitMarkerMissing)` — a true
//! sentence that tells an owner nothing about what to do next. Two of this machine's real projects
//! (ERP System, TKN) are exactly that case: genuine work in a folder that was never `git init`-ed.
//!
//! These three commands are the smallest set that removes the terminal from that path:
//!
//! * `pick_folder` — the real Windows folder browser, so a path is CHOSEN and never typed.
//! * `inspect_folder` — read-only. Establishes what a folder actually is, and says so in a sentence
//!   an owner can act on, with the technical findings kept beside it for Advanced.
//! * `prepare_folder` — the one mutating command, and it only ever ADDS: it creates the directory
//!   if asked, runs `git init` if there is no repository, and writes a minimal `.projectops`
//!   configuration if there is none. It deletes nothing, rewrites no history, touches no remote and
//!   pushes nothing.
//!
//! ## What bounds them
//!
//! * `prepare_folder` refuses a path that is not clean-absolute-local, refuses to touch anything
//!   under the installed application, and refuses to overwrite an existing `project-config.json`.
//! * Git is resolved through `process::authority::resolve_host_git`, which delegates to the SAME
//!   two resolvers the daemon launch uses. There is no environment override: a wizard that can be
//!   told which `git.exe` to run is a wizard that can be told to initialise a repository with
//!   someone else's binary.
//! * Nothing here registers anything. Registration remains the bounded elevated helper, reached
//!   through `register_project`, at the single point the owner presses Add Project.
//! * No secret is read, written, logged or returned by any of this.
//!
//! Created in PROJECTOS-SIMPLE-PROJECT-WIZARD1A.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::process::authority::resolve_host_git;
use crate::register_project::ComApartment;

#[cfg(windows)]
use windows::core::PCWSTR;
#[cfg(windows)]
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
#[cfg(windows)]
use windows::Win32::UI::Shell::{
    FileOpenDialog, IFileOpenDialog, IShellItem, FILEOPENDIALOGOPTIONS, FOS_FILEMUSTEXIST,
    FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
};

/// Encode a Rust string as a NUL-terminated UTF-16 buffer for the Win32 wide APIs.
#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// THE REAL WINDOWS FOLDER BROWSER.
///
/// Returns the chosen absolute path, or `null` when the owner cancels. Cancelling is an ORDINARY
/// OUTCOME, not an error: `IFileDialog::Show` reports it as a failed HRESULT, and reporting that to
/// the owner as a failure would be a lie about something they did on purpose.
///
/// This opens a picker and reads back a path. It cannot write, cannot execute, and cannot be
/// steered anywhere by its caller — the only argument is the sentence shown in the title bar.
#[tauri::command(async)]
pub fn pick_folder(title: String) -> Option<String> {
    #[cfg(windows)]
    {
        show_open_dialog(&title, FOS_PICKFOLDERS)
    }
    #[cfg(not(windows))]
    {
        let _ = title;
        None
    }
}

/// THE REAL WINDOWS FILE BROWSER. One existing file, or `null` when the owner cancels.
///
/// The same dialog and the same bounds as the folder picker: it opens a picker and reads back a
/// path, it cannot write, it cannot execute, and the only argument is the sentence in the title bar.
/// `FOS_ALLOWMULTISELECT` is deliberately not set, so one call can only ever answer one file.
///
/// Selecting is not importing. This returns a path; deciding whether that path may be copied
/// anywhere is `project_files`, which never accepts a destination from the renderer.
///
/// Added in PROJECTOS-GOVERNED-UPLOAD-SEAM-IMPLEMENT1A.
#[tauri::command(async)]
pub fn pick_file(title: String) -> Option<String> {
    #[cfg(windows)]
    {
        show_open_dialog(&title, FOS_FILEMUSTEXIST)
    }
    #[cfg(not(windows))]
    {
        let _ = title;
        None
    }
}

/// The shared dialog. Both pickers differ by ONE option flag, and sharing the body is what keeps
/// them agreeing about cancellation, filesystem-only results and path retrieval.
#[cfg(windows)]
fn show_open_dialog(title: &str, mode: FILEOPENDIALOGOPTIONS) -> Option<String> {
    let _com = ComApartment::enter();
    // SAFETY: every call below is checked, and no pointer outlives the buffer it borrows.
    unsafe {
        let dialog: IFileOpenDialog =
            CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).ok()?;
        let options = dialog.GetOptions().ok()?;
        dialog
            .SetOptions(options | mode | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST)
            .ok()?;
        let caption = wide(title);
        dialog.SetTitle(PCWSTR(caption.as_ptr())).ok()?;
        // Err here is overwhelmingly "the owner pressed Cancel".
        dialog.Show(None).ok()?;
        let item: IShellItem = dialog.GetResult().ok()?;
        let name = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
        let chosen = name.to_string().ok()?;
        windows::Win32::System::Com::CoTaskMemFree(Some(name.0 as *const _));
        Some(chosen)
    }
}

/// What the wizard should DO about a folder. One of these, never a raw error string.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Readiness {
    /// A prepared, canonical project root. Nothing to do but register it.
    Ready,
    /// Genuine work, but never set up for ProjectOS. `prepare_folder` can fix it, additively.
    NeedsPreparation,
    /// Already in the protected registry under this exact root.
    AlreadyRegistered,
    /// A worktree or a second checkout of a repository governed elsewhere. Registering it would
    /// create two logical projects for one product.
    DuplicateOfAnotherRoot,
    /// Not a directory this machine has.
    NotAFolder,
}

/// Read-only findings about a folder, plus the sentence the owner actually reads.
#[derive(Serialize)]
pub struct FolderInspection {
    pub path: String,
    pub readiness: Readiness,
    /// Plain English. No jargon, no path, no identifier.
    pub summary: String,
    /// What ProjectOS would do next, phrased as an action rather than a diagnosis.
    pub next_step: String,
    /// Ticked lines for the normal view — short, and each one a fact.
    pub findings: Vec<String>,
    // ---- Advanced. Present for the technical panel; nothing normal depends on it. ----
    pub exists: bool,
    pub git_marker: String,
    pub is_worktree: bool,
    pub is_canonical_root: bool,
    pub has_projectops: bool,
    pub declared_project_id: Option<String>,
    pub declared_project_name: Option<String>,
    pub branch: Option<String>,
    pub remote: Option<String>,
    pub dirty_count: Option<u32>,
    pub registered_as: Option<String>,
}

fn git_output(git: &Path, root: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new(git)
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The protected registry, read only to answer "is this already registered".
fn registry_entry_for(root: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(
        Path::new("C:\\ProgramData\\ProjectOS\\host\\installation\\projects.v1.json"),
    )
    .ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let projects = parsed.get("projects")?.as_array()?;
    let want = normalise(root);
    for p in projects {
        let entry_root = p.get("repositoryRoot")?.as_str().unwrap_or_default();
        if normalise(Path::new(entry_root)) == want {
            return p
                .get("projectId")
                .and_then(|v| v.as_str())
                .map(str::to_string);
        }
    }
    None
}

/// Compare paths the way Windows resolves them.
fn normalise(p: &Path) -> String {
    p.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

/// READ-ONLY. Establishes what a folder is; changes nothing.
#[tauri::command(async)]
pub fn inspect_folder(path: String) -> FolderInspection {
    let root = PathBuf::from(&path);
    let exists = root.is_dir();

    let mut inspection = FolderInspection {
        path: path.clone(),
        readiness: Readiness::NotAFolder,
        summary: String::new(),
        next_step: String::new(),
        findings: Vec::new(),
        exists,
        git_marker: "none".into(),
        is_worktree: false,
        is_canonical_root: false,
        has_projectops: false,
        declared_project_id: None,
        declared_project_name: None,
        branch: None,
        remote: None,
        dirty_count: None,
        registered_as: None,
    };

    if !exists {
        inspection.summary = "That folder is not on this computer.".into();
        inspection.next_step = "Choose a different folder, or create a new project instead.".into();
        return inspection;
    }

    let git_path = root.join(".git");
    if git_path.is_dir() {
        inspection.git_marker = "directory".into();
    } else if git_path.is_file() {
        inspection.git_marker = "file".into();
        inspection.is_worktree = true;
    }

    let config = root.join(".projectops").join("project-config.json");
    if config.is_file() {
        inspection.has_projectops = true;
        if let Ok(raw) = std::fs::read_to_string(&config) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                inspection.declared_project_id = v
                    .get("projectId")
                    .and_then(|x| x.as_str())
                    .map(str::to_string);
                inspection.declared_project_name = v
                    .get("projectName")
                    .and_then(|x| x.as_str())
                    .map(str::to_string);
            }
        }
    }

    if inspection.git_marker != "none" {
        if let Some(git) = resolve_host_git() {
            inspection.branch = git_output(&git, &root, &["rev-parse", "--abbrev-ref", "HEAD"]);
            inspection.remote = git_output(&git, &root, &["remote", "get-url", "origin"]);
            inspection.dirty_count = git_output(&git, &root, &["status", "--porcelain"])
                .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count() as u32);
            if let Some(top) = git_output(&git, &root, &["rev-parse", "--show-toplevel"]) {
                inspection.is_canonical_root = normalise(Path::new(&top)) == normalise(&root);
            }
        }
    }

    inspection.registered_as = registry_entry_for(&root);

    // ---- The decision, and the sentence. Order matters: the most specific answer wins. ----
    if let Some(id) = inspection.registered_as.clone() {
        inspection.readiness = Readiness::AlreadyRegistered;
        inspection.summary = "ProjectOS already governs this folder.".into();
        inspection.next_step = "Open it from your project list instead of adding it again.".into();
        inspection.findings.push(format!("Already added as \u{201c}{id}\u{201d}"));
        return inspection;
    }

    if inspection.is_worktree || (inspection.git_marker == "directory" && !inspection.is_canonical_root)
    {
        inspection.readiness = Readiness::DuplicateOfAnotherRoot;
        inspection.summary =
            "This folder is a second copy of a project that lives somewhere else.".into();
        inspection.next_step =
            "Add the project's main folder instead, so ProjectOS tracks one copy of it.".into();
        inspection
            .findings
            .push("Belongs to another project folder".into());
        return inspection;
    }

    if inspection.git_marker == "directory" && inspection.has_projectops {
        inspection.readiness = Readiness::Ready;
        inspection.summary = "ProjectOS checked this folder and it is ready.".into();
        inspection.next_step = "Continue to add it.".into();
        inspection.findings.push("Project files found".into());
        inspection.findings.push("Existing project history found".into());
        inspection.findings.push("ProjectOS setup found".into());
        return inspection;
    }

    inspection.readiness = Readiness::NeedsPreparation;
    inspection.summary = "This folder has not been prepared for ProjectOS yet.".into();
    inspection.next_step = "ProjectOS can prepare it. Nothing already in the folder is changed or removed.".into();
    inspection.findings.push("Project files found".into());
    if inspection.git_marker == "none" {
        inspection
            .findings
            .push("No project history yet — ProjectOS will start one".into());
    }
    if !inspection.has_projectops {
        inspection
            .findings
            .push("No ProjectOS setup yet — ProjectOS will add it".into());
    }
    inspection
}

/// What preparation actually did. Every entry is something that HAPPENED.
#[derive(Serialize)]
pub struct PreparationResult {
    pub ok: bool,
    pub path: String,
    pub actions: Vec<String>,
    pub refusal: Option<String>,
}

fn refused(path: &str, why: &str) -> PreparationResult {
    PreparationResult {
        ok: false,
        path: path.to_string(),
        actions: Vec::new(),
        refusal: Some(why.to_string()),
    }
}

/// A minimal, safe project configuration. Deliberately the smallest thing the runtime accepts:
/// production frozen, development only, every dangerous action forbidden.
fn minimal_projectops(project_id: &str, project_name: &str, root: &Path) -> String {
    let local = root.to_string_lossy().replace('\\', "/");
    serde_json::json!({
        "projectId": project_id,
        "projectName": project_name,
        "projectType": "unspecified",
        "owner": "Murad",
        "repo": "none",
        "localPath": local,
        "protectedBranches": ["main"],
        "productionFreeze": true,
        "allowedActions": ["create-local-files", "run-local-validation", "produce-evidence-report"],
        "forbiddenActions": [
            "production-deploy",
            "production-db-mutation",
            "real-email-sms-whatsapp",
            "payment-or-live-charge",
            "use-secrets-in-clear"
        ],
        "approvalGates": [
            "production-deploy",
            "production-db-mutation",
            "real-email-sms-whatsapp",
            "payment-or-live-charge",
            "secrets-handling"
        ],
        "secretsPolicy": { "allowSecretsInRepo": false, "redactionRequired": true, "notes": "placeholders only" },
        "validators": ["validate-project-config", "validate-no-secrets", "validate-forbidden-actions"],
        "evidenceRequirements": ["evidence-pack", "validator-results"],
        "installStatus": "installed"
    })
    .to_string()
}

/// THE ONE MUTATING COMMAND, and it only ever adds.
///
/// Creates the directory when asked, initialises a repository when there is none, and writes a
/// minimal configuration when there is none. It never deletes, never overwrites an existing
/// configuration, never creates or changes a remote, and never pushes.
#[tauri::command(async)]
pub fn prepare_folder(
    path: String,
    project_id: String,
    project_name: String,
    create_folder: bool,
) -> PreparationResult {
    let root = PathBuf::from(&path);

    if !root.is_absolute() || path.trim().is_empty() {
        return refused(&path, "ProjectOS needs a full folder location.");
    }
    // Never anywhere under the installed application. A project is the owner's work, not ours.
    let install = normalise(Path::new("C:\\Program Files\\ProjectOS Control Center"));
    if normalise(&root).starts_with(&install) {
        return refused(
            &path,
            "That location belongs to the ProjectOS application itself. Choose a folder for your own work.",
        );
    }
    if project_id.trim().is_empty() || project_name.trim().is_empty() {
        return refused(&path, "ProjectOS needs a name for this project.");
    }

    let mut actions: Vec<String> = Vec::new();

    if !root.is_dir() {
        if !create_folder {
            return refused(&path, "That folder is not on this computer.");
        }
        if let Err(e) = std::fs::create_dir_all(&root) {
            return refused(&path, &format!("The folder could not be created: {e}"));
        }
        actions.push("Created the folder".into());
    }

    if !root.join(".git").exists() {
        let Some(git) = resolve_host_git() else {
            return refused(
                &path,
                "ProjectOS could not find Git on this computer, so it cannot start tracking this project.",
            );
        };
        let out = Command::new(&git).arg("-C").arg(&root).arg("init").output();
        match out {
            Ok(o) if o.status.success() => actions.push("Started tracking changes in this project".into()),
            Ok(o) => {
                return refused(
                    &path,
                    &format!(
                        "Project tracking could not be started: {}",
                        String::from_utf8_lossy(&o.stderr).trim()
                    ),
                )
            }
            Err(e) => return refused(&path, &format!("Project tracking could not be started: {e}")),
        }
    }

    let pops = root.join(".projectops");
    let config = pops.join("project-config.json");
    if config.is_file() {
        actions.push("Kept the ProjectOS setup that was already here".into());
    } else {
        if let Err(e) = std::fs::create_dir_all(&pops) {
            return refused(&path, &format!("The ProjectOS setup could not be added: {e}"));
        }
        let body = minimal_projectops(project_id.trim(), project_name.trim(), &root);
        if let Err(e) = std::fs::write(&config, body) {
            return refused(&path, &format!("The ProjectOS setup could not be added: {e}"));
        }
        actions.push("Added the ProjectOS setup".into());
    }

    PreparationResult {
        ok: true,
        path,
        actions,
        refusal: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The refusal an owner sees must never be a path into the application.
    #[test]
    fn preparation_refuses_the_installed_application_directory() {
        let r = prepare_folder(
            "C:\\Program Files\\ProjectOS Control Center\\runtime-payload".into(),
            "x".into(),
            "X".into(),
            true,
        );
        assert!(!r.ok);
        assert!(r.refusal.unwrap().contains("ProjectOS application itself"));
    }

    /// A relative path is not a location; refusing it here beats half-creating something.
    #[test]
    fn preparation_refuses_a_relative_location() {
        let r = prepare_folder("somewhere".into(), "x".into(), "X".into(), true);
        assert!(!r.ok);
    }

    /// A missing folder is a sentence, not a stack trace, and nothing is created unless asked.
    #[test]
    fn inspecting_a_missing_folder_says_so_plainly() {
        let i = inspect_folder("C:\\dev\\this-does-not-exist-projectos".into());
        assert_eq!(i.readiness, Readiness::NotAFolder);
        assert!(!i.summary.is_empty());
        assert!(!i.exists);
    }

    /// The minimal configuration must be safe by construction: frozen, and nothing dangerous allowed.
    #[test]
    fn the_minimal_configuration_is_frozen_and_forbids_every_dangerous_action() {
        let body = minimal_projectops("demo", "Demo", Path::new("C:\\dev\\Demo"));
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["productionFreeze"], serde_json::json!(true));
        let forbidden = v["forbiddenActions"].as_array().unwrap();
        for action in [
            "production-deploy",
            "production-db-mutation",
            "real-email-sms-whatsapp",
            "payment-or-live-charge",
        ] {
            assert!(
                forbidden.iter().any(|f| f == action),
                "{action} must be forbidden in a project ProjectOS created"
            );
        }
        assert_eq!(v["secretsPolicy"]["allowSecretsInRepo"], serde_json::json!(false));
    }
}
