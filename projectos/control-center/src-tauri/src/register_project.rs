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

use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{
    CloseHandle, ERROR_CANCELLED, HANDLE, HWND, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
use windows::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, IDYES, MB_ICONWARNING, MB_SETFOREGROUND, MB_TASKMODAL, MB_YESNO, SW_HIDE,
};

/// How long the elevated helper may take before this host stops waiting on it.
///
/// The wait used to be `INFINITE`. That is indefensible on a thread the owner is waiting behind: a
/// helper that hung — or a UAC prompt left unanswered on a locked machine — would keep the command
/// pending forever with no cancel. Ten minutes is far longer than a consent click plus one small
/// protected write, and a timeout is reported as "could not confirm", never as a refusal, because a
/// wait that ran out has observed nothing about what the helper did.
const HELPER_WAIT_MS: u32 = 10 * 60 * 1000;

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

/// What the owner said, or why they were never asked.
///
/// A dialog that could not be DISPLAYED and a dialog the owner answered No to are both refusals —
/// but they are not the same fact, and reporting them identically is what made a silent failure
/// indistinguishable from a deliberate cancellation. `MessageBoxW` returns `MESSAGEBOX_RESULT(0)`
/// on failure, which is neither `IDYES` nor `IDNO`; that case is now its own answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OwnerAnswer {
    Yes,
    No,
    /// The question could not be put. Still refuses — an unanswerable question is not consent.
    CouldNotAsk,
}

/// Show the exact proposal and require an explicit Yes.
///
/// `owner` is the Control Centre's own window. Passing it makes the box modal to the application
/// (with `MB_TASKMODAL` as the fallback when no handle is available), so it cannot open BEHIND the
/// window that triggered it — which looks exactly like nothing having happened.
fn owner_confirms(
    owner: Option<HWND>,
    project_id: &str,
    repository_root: &str,
    environments: &str,
    production_frozen: bool,
) -> OwnerAnswer {
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
    // Application-modal against our own window when we have one; task-modal otherwise, so the box
    // is never merely a background window the owner has to go looking for.
    let style = if owner.is_some() {
        MB_YESNO | MB_ICONWARNING | MB_SETFOREGROUND
    } else {
        MB_YESNO | MB_ICONWARNING | MB_SETFOREGROUND | MB_TASKMODAL
    };
    // SAFETY: both buffers are NUL-terminated and outlive the call, and `owner` is either a live
    // window handle obtained from Tauri or None. Anything that is not an explicit IDYES refuses.
    let answer = unsafe {
        MessageBoxW(
            owner,
            PCWSTR(wide_body.as_ptr()),
            PCWSTR(wide_title.as_ptr()),
            style,
        )
    };
    if answer == IDYES {
        OwnerAnswer::Yes
    } else if answer.0 == 0 {
        // The call itself failed — no dialog was ever presented to anyone.
        OwnerAnswer::CouldNotAsk
    } else {
        OwnerAnswer::No
    }
}

/// COM, initialised for the duration of one elevated launch and uninitialised on every exit path.
///
/// `ShellExecuteExW` delegates to COM shell extensions and requires an initialised apartment. This
/// used to be satisfied by accident — the command ran on tao's already-initialised main thread. It
/// no longer does (blocking the event loop behind a UAC prompt is not acceptable), so the apartment
/// is established explicitly. `RAII` rather than a bare pair of calls so an early return cannot
/// leak it.
struct ComApartment {
    owned: bool,
}

impl ComApartment {
    fn enter() -> Self {
        // SAFETY: no arguments are borrowed and the result is inspected rather than assumed. An
        // apartment already initialised by this thread (RPC_E_CHANGED_MODE / S_FALSE) is fine — we
        // simply must not uninitialise what we did not initialise.
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        Self { owned: hr.is_ok() }
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.owned {
            // SAFETY: balanced against exactly one successful CoInitializeEx on this thread.
            unsafe { CoUninitialize() };
        }
    }
}

/// What the elevated launch established. Every variant is something actually OBSERVED.
enum LaunchOutcome {
    /// The helper ran to completion and reported this code.
    Exited(u32),
    /// The owner declined at the Windows consent prompt. Nothing ran.
    Declined,
}

/// Launch the helper elevated and wait for it, bounded.
fn run_elevated(helper: &PathBuf, parameters: &str) -> Result<LaunchOutcome, String> {
    let _com = ComApartment::enter();

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
    // the real struct size.
    if let Err(error) = unsafe { ShellExecuteExW(&mut info) } {
        // ONLY 1223 MEANS THE OWNER SAID NO. Every failure used to be announced as "not approved at
        // the Windows permission prompt", so a missing file, a denied access or a broken `runas`
        // association all claimed the owner had declined something they were never shown. That is a
        // statement about a person's action, made without observing it.
        return if error.code().0 as u32 & 0xFFFF == ERROR_CANCELLED.0 {
            Ok(LaunchOutcome::Declined)
        } else {
            Err("Windows could not start the registration helper, so nothing was written. \
                 Reinstalling ProjectOS restores it."
                .to_string())
        };
    }

    let process = HANDLE(info.hProcess.0);
    if process.is_invalid() {
        return Err("ProjectOS could not observe the registration helper, so it cannot report \
                    what happened. Check the Projects list before trying again."
            .to_string());
    }

    // SAFETY: `process` is a live process handle produced by the call above.
    let waited = unsafe { WaitForSingleObject(process, HELPER_WAIT_MS) };
    let mut code: u32 = 0;
    let read_code = waited == WAIT_OBJECT_0 && {
        // SAFETY: same live handle; `code` is a valid out-parameter for the duration of the call.
        unsafe { GetExitCodeProcess(process, &mut code) }.is_ok()
    };
    // SAFETY: the handle was opened by `SEE_MASK_NOCLOSEPROCESS` and is closed exactly once here.
    let _ = unsafe { CloseHandle(process) };

    if waited == WAIT_TIMEOUT {
        return Err("The registration helper is still running after ten minutes. ProjectOS stopped \
                    waiting and cannot say whether it finished — check the Projects list."
            .to_string());
    }
    if !read_code {
        // The exit code used to DEFAULT to "refused", so a failure to read it announced that
        // ProjectOS had refused the registration — a positive claim about a branch never observed.
        return Err("ProjectOS could not read the result of the registration helper. Check the \
                    Projects list before trying again."
            .to_string());
    }
    Ok(LaunchOutcome::Exited(code))
}

/// Register one project, with owner confirmation and a real UAC prompt.
///
/// Returns a short non-secret status token the renderer maps to plain language. Every failure path
/// returns a sentence the owner can act on; none carries a path the caller did not already supply,
/// a native error code, or an internal reason string.
/// `async` DELIBERATELY, and it is not decoration.
///
/// A non-async `#[tauri::command]` is dispatched `Blocking`, on the thread servicing the WebView IPC
/// callback — the thread running the event loop. This command waits for a UAC prompt and a child
/// process, so as a blocking command it froze the entire application for the duration, and a helper
/// that never exited froze it permanently with no cancel. `async` moves it to a worker; the COM
/// apartment that `ShellExecuteExW` needs is established there explicitly rather than inherited.
#[tauri::command(async)]
pub fn register_project(
    window: tauri::WebviewWindow,
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
    // The count is bounded as well as the membership. Only three values are legal, so anything
    // longer is a caller repeating them — and an unbounded repeat becomes a command line past the
    // ~32KB limit and a confirmation dialog too long to read, which is a way to make the owner
    // approve something they cannot actually see.
    if environments.is_empty()
        || environments.len() > PERMITTED_ENVIRONMENTS.len()
        || environments
            .iter()
            .any(|e| !PERMITTED_ENVIRONMENTS.contains(&e.as_str()))
    {
        return Err("Choose at least one environment: development, staging or production."
            .to_string());
    }

    let helper = helper_path()?;
    let joined = environments.join(",");

    // The Control Centre's own window, so the confirmation is modal to it. A handle that cannot be
    // obtained is not fatal — `owner_confirms` falls back to a task-modal box.
    let owner = window.hwnd().ok().map(|h| HWND(h.0 as *mut c_void));

    match owner_confirms(
        owner,
        &project_id,
        &repository_root,
        &joined,
        production_frozen,
    ) {
        OwnerAnswer::Yes => {}
        OwnerAnswer::No => return Ok("DECLINED".to_string()),
        OwnerAnswer::CouldNotAsk => {
            return Err("ProjectOS could not show the confirmation, so it did not ask for \
                        permission and nothing was written."
                .to_string())
        }
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
        LaunchOutcome::Declined => Ok("DECLINED".to_string()),
        LaunchOutcome::Exited(EXIT_OK) => Ok("REGISTERED".to_string()),
        LaunchOutcome::Exited(EXIT_ALREADY) => Ok("ALREADY_REGISTERED".to_string()),
        LaunchOutcome::Exited(EXIT_REFUSED) => {
            Err("ProjectOS refused this registration and wrote nothing. The folder may not be a \
                 valid project, or may already be registered under a different ID."
                .to_string())
        }
        LaunchOutcome::Exited(_) => Err("The registration helper stopped unexpectedly and may not \
                                         have written anything. Check the Projects list before \
                                         trying again."
            .to_string()),
    }
}
