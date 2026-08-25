//! Owner-initiated project registration through a real Windows UAC prompt.
//!
//! PROJECTOS-PRODUCT-COMPLETION1A §11. Registering a project writes to an ACL-protected machine
//! location, so it needs elevation. The previous — and still supported — route was an Administrator
//! terminal running `plan`, copying a digest, then running `publish` and typing a confirmation
//! phrase. The owner rejected that as the NORMAL experience; this is the replacement for the normal
//! case, and it does not remove the terminal route.
//!
//! ## What this host does, and what it deliberately cannot do
//!
//! It LAUNCHES a fixed, bounded helper executable beside this one, through `ShellExecuteExW` with the
//! `runas` verb, and waits for its exit code. That is the entire capability.
//!
//! * It does NOT link the registration crate. `control-center/src-tauri/Cargo.toml` must never
//!   depend on `projectos-host-elevated-installer-composition`, and an invariant test in that crate
//!   enforces it. Launching a bounded process and linking a write capability into a WebView host are
//!   very different things.
//! * It does NOT know where the registry lives, cannot name a destination, and passes no path to
//!   write. The elevated helper derives the canonical destination itself.
//! * It runs ONE fixed file name, resolved beside the current executable — never a caller-supplied
//!   path, never a shell, never a command line assembled from renderer text.
//! * It cannot elevate silently. `runas` always raises the Windows consent dialog, which this
//!   application can neither suppress nor pre-answer.
//!
//! ## Where the owner confirmation lives
//!
//! In THIS module, before elevation is requested — not in the renderer. A WebView is the least
//! trustworthy place to decide that an owner approved something, so the exact proposed registration
//! is rendered into a native Windows message box here, from the validated values that will actually
//! be passed, and a non-Yes answer returns before `ShellExecuteExW` is reached. The renderer can ask
//! for a registration; it cannot assert that one was approved.
//!
//! Two consents are therefore required for one registration: this dialog, then the Windows UAC
//! prompt. That is intentional — the first says WHAT, the second says ELEVATE.

#![cfg(windows)]

use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
use windows::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, IDYES, MB_ICONWARNING, MB_SETFOREGROUND, MB_YESNO, SW_HIDE,
};

/// The one binary this module may launch. A fixed name, resolved beside the running executable.
const HELPER_FILE_NAME: &str = "projectos-register-project-elevated.exe";

/// The closed environment vocabulary, mirrored from the registry contract. Validated here as well as
/// in the helper: a value that cannot be represented must not reach an elevated process at all.
const PERMITTED_ENVIRONMENTS: [&str; 3] = ["development", "staging", "production"];

/// Exit codes the helper defines. See its own documentation — they are the entire result channel.
const EXIT_OK: u32 = 0;
const EXIT_ALREADY: u32 = 2;
const EXIT_REFUSED: u32 = 3;

/// A NUL-terminated UTF-16 buffer for a Win32 wide-string parameter.
fn wide(text: &str) -> Vec<u16> {
    std::ffi::OsStr::new(text)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// One identifier segment: the charset the registry contract accepts, enforced before anything is
/// launched. Rejecting here rather than relying on the helper keeps malformed input out of an
/// elevated process entirely.
fn is_valid_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

/// A repository root that may be delivered as a command-line argument.
///
/// Refused: anything not absolute, a UNC path, anything carrying a control character, and anything
/// carrying a double quote. The quote matters specifically — the argument is delivered inside a
/// quoted command-line token below, and a value able to close that token could append arguments the
/// owner never saw in the confirmation dialog.
fn is_valid_root(value: &str) -> bool {
    if value.is_empty() || value.len() > 260 {
        return false;
    }
    if value.starts_with("\\\\") || value.starts_with("//") {
        return false;
    }
    if value.chars().any(|c| c.is_control() || c == '"') {
        return false;
    }
    let bytes = value.as_bytes();
    // A drive-absolute path: `X:\...`. Deliberately stricter than `Path::is_absolute`, which also
    // accepts rooted-but-driveless forms.
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

/// Quote one argument for `CommandLineToArgvW`, which is how the helper's runtime will parse it.
///
/// Backslashes immediately preceding the closing quote are doubled: the parser halves such a run and
/// treats the following quote as escaped, so `C:\dev\repo\` would otherwise swallow its own closing
/// quote and absorb whatever followed. The value has already been refused if it contains a quote.
fn quote_argument(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    let mut pending_backslashes = 0usize;
    for ch in value.chars() {
        if ch == '\\' {
            pending_backslashes += 1;
        } else {
            pending_backslashes = 0;
        }
        out.push(ch);
    }
    for _ in 0..pending_backslashes {
        out.push('\\');
    }
    out.push('"');
    out
}

/// The helper, beside the running executable. Never a caller-supplied path.
fn helper_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|_| "ProjectOS could not locate its own program directory.".to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "ProjectOS could not locate its own program directory.".to_string())?;
    let helper = dir.join(HELPER_FILE_NAME);
    if !helper.is_file() {
        return Err(
            "The registration helper is not installed alongside ProjectOS, so registration cannot \
             run here. This is expected in a development build."
                .to_string(),
        );
    }
    Ok(helper)
}

/// Show the exact proposal and require an explicit Yes. Returns `false` for every other answer,
/// including a dialog that could not be shown at all — an unanswerable question is not consent.
fn owner_confirms(
    project_id: &str,
    repository_root: &str,
    environments: &str,
    production_frozen: bool,
) -> bool {
    let body = format!(
        "Register this project on this computer?\n\n\
         Project ID:\t{project_id}\n\
         Folder:\t{repository_root}\n\
         Environments:\t{environments}\n\
         Production frozen:\t{production_frozen}\n\n\
         Windows will then ask for administrator permission, because this writes protected \
         machine configuration.\n\n\
         Nothing is written unless you choose Yes and then approve that prompt."
    );
    let wide_body = wide(&body);
    let wide_title = wide("ProjectOS — register project");
    // SAFETY: both buffers are NUL-terminated and outlive the call; a null parent HWND shows an
    // owner-less modal, which is the documented form. Any result other than IDYES is treated as a
    // refusal, so a failed dialog cannot become an approval.
    let answer = unsafe {
        MessageBoxW(
            None,
            PCWSTR(wide_body.as_ptr()),
            PCWSTR(wide_title.as_ptr()),
            MB_YESNO | MB_ICONWARNING | MB_SETFOREGROUND,
        )
    };
    answer == IDYES
}

/// Launch the helper elevated and wait for it. Returns its exit code.
fn run_elevated(helper: &PathBuf, parameters: &str) -> Result<u32, String> {
    let wide_verb = wide("runas");
    let wide_file = wide(&helper.to_string_lossy());
    let wide_params = wide(parameters);

    let mut info = SHELLEXECUTEINFOW {
        cbSize: u32::try_from(std::mem::size_of::<SHELLEXECUTEINFOW>())
            .map_err(|_| "ProjectOS could not prepare the elevation request.".to_string())?,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: PCWSTR(wide_verb.as_ptr()),
        lpFile: PCWSTR(wide_file.as_ptr()),
        lpParameters: PCWSTR(wide_params.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };

    // SAFETY: every PCWSTR points at a NUL-terminated buffer that outlives the call, and `cbSize` is
    // the real struct size. `runas` raises the Windows consent dialog; a declined prompt returns an
    // error here rather than a process handle, which is why the failure below is reported as a
    // refusal and not as a fault.
    unsafe { ShellExecuteExW(&mut info) }.map_err(|_| {
        "Registration was not approved at the Windows permission prompt, so nothing was written."
            .to_string()
    })?;

    let process = HANDLE(info.hProcess.0);
    if process.is_invalid() {
        return Err("ProjectOS could not observe the registration helper, so it cannot report \
                    what happened. Check the Projects list before trying again."
            .to_string());
    }

    // SAFETY: `process` is a live process handle produced by the call above.
    let waited = unsafe { WaitForSingleObject(process, INFINITE) };
    let mut code: u32 = EXIT_REFUSED;
    if waited == WAIT_OBJECT_0 {
        // SAFETY: same live handle; `code` is a valid out-parameter for the duration of the call.
        let _ = unsafe { GetExitCodeProcess(process, &mut code) };
    }
    // SAFETY: the handle was opened by `SEE_MASK_NOCLOSEPROCESS` and is closed exactly once here.
    let _ = unsafe { CloseHandle(process) };

    if waited != WAIT_OBJECT_0 {
        return Err("ProjectOS could not confirm the registration finished. Check the Projects \
                    list before trying again."
            .to_string());
    }
    Ok(code)
}

/// Register one project, with owner confirmation and a real UAC prompt.
///
/// Returns a short non-secret status token the renderer maps to plain language. Every failure path
/// returns a sentence the owner can act on; none carries a path the caller did not already supply,
/// a native error code, or an internal reason string.
#[tauri::command]
pub fn register_project(
    project_id: String,
    repository_root: String,
    environments: Vec<String>,
    production_frozen: bool,
) -> Result<String, String> {
    if !is_valid_segment(&project_id) {
        return Err("That project ID is not usable. Use letters, digits, dots, underscores or \
                    hyphens, starting with a letter or digit."
            .to_string());
    }
    if !is_valid_root(&repository_root) {
        return Err("That folder is not usable. Give the full path to a folder on a local drive, \
                    for example C:\\dev\\my-app."
            .to_string());
    }
    if environments.is_empty()
        || environments
            .iter()
            .any(|e| !PERMITTED_ENVIRONMENTS.contains(&e.as_str()))
    {
        return Err("Choose at least one environment: development, staging or production."
            .to_string());
    }

    let helper = helper_path()?;
    let joined = environments.join(",");

    if !owner_confirms(
        &project_id,
        &repository_root,
        &joined,
        production_frozen,
    ) {
        return Ok("DECLINED".to_string());
    }

    // Fixed flag names, validated values, each argument individually quoted. Nothing here is
    // assembled from renderer text that has not passed the checks above.
    let parameters = format!(
        "publish --id {} --root {} --environments {} --frozen {}",
        quote_argument(&project_id),
        quote_argument(&repository_root),
        quote_argument(&joined),
        if production_frozen { "true" } else { "false" }
    );

    match run_elevated(&helper, &parameters)? {
        EXIT_OK => Ok("REGISTERED".to_string()),
        EXIT_ALREADY => Ok("ALREADY_REGISTERED".to_string()),
        EXIT_REFUSED => Err("ProjectOS refused this registration and wrote nothing. The folder \
                             may not be a valid project, or may already be registered under a \
                             different ID."
            .to_string()),
        _ => Err("The registration helper stopped unexpectedly and may not have written \
                  anything. Check the Projects list before trying again."
            .to_string()),
    }
}
