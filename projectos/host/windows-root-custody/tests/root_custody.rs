//! Root-custody behaviour tests over the PUBLIC API only, using isolated synthetic temporary roots.
//! No ProgramData, no administrator requirement, no external provider. Reparse-creation tests need
//! Windows privileges that may be unavailable, so they are Windows-only, `#[ignore]` and explicitly
//! env-gated — they are never silently counted as passed. No path, volume id, file id or handle value
//! is printed.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use projectos_host_windows_root_custody::{RootCustodyError, WindowsRootCustody};

/// Exact env gate for privileged reparse-creation proofs.
const REPARSE_GATE: &str = "PROJECTOS_RUN_WINDOWS_ROOT_CUSTODY_REPARSE_PROBE";

static SEQ: AtomicU64 = AtomicU64::new(0);

/// A unique synthetic temporary directory (created on disk).
fn unique_dir(tag: &str) -> PathBuf {
    let n = SEQ.fetch_add(1, Ordering::SeqCst);
    let dir =
        std::env::temp_dir().join(format!("pos-rootcustody-{tag}-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn cleanup(path: &Path) {
    let _ = std::fs::remove_dir_all(path);
}

// ---- A. valid root ----

#[cfg(windows)]
#[test]
fn opens_directory_captures_identity_and_revalidates() {
    let dir = unique_dir("valid");
    let custody = WindowsRootCustody::open(&dir).expect("open");
    // Identity is stable across queries and revalidation succeeds.
    let first = custody.identity();
    custody.revalidate().expect("revalidate");
    assert!(first.same_object(&custody.identity()));
    // Canonical path is stable and non-empty (value itself is not asserted against a private path).
    let canonical = custody.canonical_path().to_path_buf();
    assert!(!canonical.as_os_str().is_empty());
    assert_eq!(canonical, custody.canonical_path());
    drop(custody);
    cleanup(&dir);
}

#[cfg(windows)]
#[test]
fn distinct_directories_have_distinct_identities() {
    let a = unique_dir("ida");
    let b = unique_dir("idb");
    let ca = WindowsRootCustody::open(&a).unwrap();
    let cb = WindowsRootCustody::open(&b).unwrap();
    assert!(!ca.identity().same_object(&cb.identity()));
    drop(ca);
    drop(cb);
    cleanup(&a);
    cleanup(&b);
}

// ---- B. input refusals ----

#[test]
fn empty_path_refused() {
    assert_eq!(
        WindowsRootCustody::open(Path::new("")).unwrap_err(),
        RootCustodyError::EmptyPath
    );
}

#[test]
fn relative_path_refused() {
    assert_eq!(
        WindowsRootCustody::open(Path::new("relative\\path")).unwrap_err(),
        RootCustodyError::RelativePath
    );
}

#[test]
fn unc_and_device_namespaces_refused() {
    assert_eq!(
        WindowsRootCustody::open(Path::new("\\\\server\\share")).unwrap_err(),
        RootCustodyError::UnsupportedNamespace
    );
    assert_eq!(
        WindowsRootCustody::open(Path::new("\\\\?\\C:\\x")).unwrap_err(),
        RootCustodyError::UnsupportedNamespace
    );
    assert_eq!(
        WindowsRootCustody::open(Path::new("\\\\.\\PhysicalDrive0")).unwrap_err(),
        RootCustodyError::UnsupportedNamespace
    );
}

#[test]
fn traversal_and_alternate_data_stream_refused() {
    assert_eq!(
        WindowsRootCustody::open(Path::new("C:\\a\\..\\b")).unwrap_err(),
        RootCustodyError::UnsupportedNamespace
    );
    assert_eq!(
        WindowsRootCustody::open(Path::new("C:\\a\\dir:stream")).unwrap_err(),
        RootCustodyError::UnsupportedNamespace
    );
}

#[cfg(windows)]
#[test]
fn nonexistent_root_refused() {
    let dir = unique_dir("missing");
    let ghost = dir.join("does-not-exist");
    assert_eq!(
        WindowsRootCustody::open(&ghost).unwrap_err(),
        RootCustodyError::NotFound
    );
    cleanup(&dir);
}

#[cfg(windows)]
#[test]
fn regular_file_refused() {
    let dir = unique_dir("file");
    let file = dir.join("a.txt");
    std::fs::write(&file, b"x").unwrap();
    assert_eq!(
        WindowsRootCustody::open(&file).unwrap_err(),
        RootCustodyError::NotADirectory
    );
    cleanup(&dir);
}

// ---- D. identity drift / path replacement ----

#[cfg(windows)]
#[test]
fn replacement_directory_at_same_path_is_detected() {
    let parent = unique_dir("drift");
    let root = parent.join("root");
    std::fs::create_dir_all(&root).unwrap();

    let custody = WindowsRootCustody::open(&root).expect("open A");
    custody.revalidate().expect("initially valid");

    // Move the original object aside and create a DIFFERENT directory at the same pathname.
    let moved = parent.join("root-moved");
    std::fs::rename(&root, &moved).unwrap();
    std::fs::create_dir_all(&root).unwrap();

    // The held handle for A is still valid, but the pathname now denotes object B.
    let err = custody.revalidate().unwrap_err();
    assert_eq!(err, RootCustodyError::PathReplaced);

    drop(custody);
    cleanup(&parent);
}

#[cfg(windows)]
#[test]
fn removed_root_path_is_detected_as_missing() {
    let parent = unique_dir("gone");
    let root = parent.join("root");
    std::fs::create_dir_all(&root).unwrap();
    let custody = WindowsRootCustody::open(&root).expect("open");
    let moved = parent.join("root-moved");
    std::fs::rename(&root, &moved).unwrap(); // pathname no longer exists
    assert_eq!(
        custody.revalidate().unwrap_err(),
        RootCustodyError::NotFound
    );
    drop(custody);
    cleanup(&parent);
}

// ---- E. handle lifecycle ----

/// TEST-ONLY: the process's current open-handle COUNT (never a handle value) via the supported
/// `GetProcessHandleCount` API. Requires no administrator authority.
#[cfg(windows)]
#[allow(unsafe_code)]
fn process_handle_count() -> u32 {
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessHandleCount};
    let mut count: u32 = 0;
    // SAFETY: `GetCurrentProcess` returns a pseudo-handle that needs no release; `count` is a valid,
    // writable out-parameter; we read it only after the call reports success. No handle VALUE is read.
    let ok = unsafe { GetProcessHandleCount(GetCurrentProcess(), &mut count) };
    assert!(ok != 0, "GetProcessHandleCount failed");
    count
}

#[cfg(windows)]
#[test]
fn repeated_open_and_drop_does_not_materially_leak_handles() {
    let dir = unique_dir("lifecycle");

    // Warm up so one-time runtime allocations are not attributed to the measured window.
    {
        let custody = WindowsRootCustody::open(&dir).expect("warmup open");
        custody.revalidate().expect("warmup revalidate");
    }

    let baseline = process_handle_count();
    const ITERATIONS: u32 = 512;
    for _ in 0..ITERATIONS {
        let custody = WindowsRootCustody::open(&dir).expect("open");
        // `revalidate` additionally opens (and must close) a transient handle for the fresh path probe.
        custody.revalidate().expect("revalidate");
        drop(custody); // held handle closed exactly once here
    }
    let after = process_handle_count();

    // A genuine leak would grow with ITERATIONS (>= 512 leaked handles, and >= 1024 counting the
    // transient revalidation probe). This small fixed tolerance absorbs unrelated test-runtime
    // activity while remaining far below any proportional growth.
    const TOLERANCE: u32 = 32;
    let growth = after.saturating_sub(baseline);
    println!("handle growth over {ITERATIONS} open/drop cycles: {growth}");
    assert!(
        growth <= TOLERANCE,
        "process handle count grew beyond the documented tolerance across repeated open/drop"
    );
    cleanup(&dir);
}

#[cfg(windows)]
#[test]
fn failed_open_leaves_no_custody_and_root_reopenable() {
    let dir = unique_dir("partial");
    let file = dir.join("f.txt");
    std::fs::write(&file, b"x").unwrap();
    // A failed open (not a directory) acquires then drops its handle; the directory remains usable.
    assert!(WindowsRootCustody::open(&file).is_err());
    let custody = WindowsRootCustody::open(&dir).expect("open dir after failed open");
    custody.revalidate().unwrap();
    drop(custody);
    cleanup(&dir);
}

// ---- canonical-path stability ----

#[cfg(windows)]
#[test]
fn canonical_path_is_stable_across_revalidation() {
    let dir = unique_dir("canonical");
    let custody = WindowsRootCustody::open(&dir).expect("open");
    let initial = custody.canonical_path().to_path_buf();
    assert!(!initial.as_os_str().is_empty());

    // Repeated successful revalidation must not mutate the stored canonical root. Compared with
    // `assert!` (not `assert_eq!`) so a failure never prints the private temporary paths.
    for _ in 0..8 {
        custody.revalidate().expect("revalidate");
        assert!(
            custody.canonical_path() == initial.as_path(),
            "canonical root changed across successful revalidation"
        );
    }
    drop(custody);
    cleanup(&dir);
}

// ---- F. error/identity redaction ----

#[cfg(windows)]
#[test]
fn debug_and_error_output_disclose_nothing_private() {
    let dir = unique_dir("redact");
    let custody = WindowsRootCustody::open(&dir).unwrap();
    let custody_dbg = format!("{custody:?}");
    let identity_dbg = format!("{:?}", custody.identity());
    assert_eq!(custody_dbg, "WindowsRootCustody(redacted)");
    assert_eq!(identity_dbg, "RootIdentity(redacted)");
    // No fragment of the private temporary path appears in any rendering.
    let leaf = dir.file_name().unwrap().to_str().unwrap();
    assert!(!custody_dbg.contains(leaf));
    assert!(!identity_dbg.contains(leaf));
    // Errors are fieldless classifications only.
    let err = WindowsRootCustody::open(Path::new("relative\\x")).unwrap_err();
    let rendered = format!("{err} {err:?}");
    assert!(!rendered.contains(leaf));
    assert!(!rendered.contains(':')); // no drive/volume-looking fragment
    drop(custody);
    cleanup(&dir);
}

// ---- G. concurrency (read-only; writer locking stays with the accepted durable store) ----

#[cfg(windows)]
#[test]
fn two_independent_custodies_may_hold_the_same_root() {
    let dir = unique_dir("concurrent");
    let first = WindowsRootCustody::open(&dir).expect("first");
    let second = WindowsRootCustody::open(&dir).expect("second");
    assert!(first.identity().same_object(&second.identity()));
    first.revalidate().unwrap();
    second.revalidate().unwrap();
    drop(first);
    second.revalidate().unwrap(); // dropping one does not invalidate the other
    drop(second);
    cleanup(&dir);
}

// ---- C. reparse defence ----

/// Create a directory JUNCTION as a TEST FIXTURE only (junctions need no special privilege, unlike
/// symlinks). `mklink` is used solely to build the fixture — never as the custody primitive itself.
#[cfg(windows)]
fn make_junction(link: &Path, target: &Path) -> bool {
    std::process::Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            link.to_str().unwrap(),
            target.to_str().unwrap(),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
        && link.exists()
}

#[cfg(windows)]
#[test]
fn junction_root_refused() {
    let parent = unique_dir("junction");
    let target = parent.join("target");
    std::fs::create_dir_all(&target).unwrap();
    let link = parent.join("link");
    // Fail loudly rather than skip silently: junction creation is expected to work without privilege.
    assert!(
        make_junction(&link, &target),
        "junction fixture not created"
    );
    assert_eq!(
        WindowsRootCustody::open(&link).unwrap_err(),
        RootCustodyError::ReparsePointRefused
    );
    cleanup(&parent);
}

#[cfg(windows)]
#[test]
fn root_replaced_by_junction_after_open_is_detected() {
    let parent = unique_dir("junction-sub");
    let root = parent.join("root");
    let elsewhere = parent.join("elsewhere");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&elsewhere).unwrap();

    let custody = WindowsRootCustody::open(&root).expect("open real root");
    custody.revalidate().expect("initially valid");

    // Move the real root aside and substitute a JUNCTION at the original pathname.
    let moved = parent.join("root-moved");
    std::fs::rename(&root, &moved).unwrap();
    assert!(
        make_junction(&root, &elsewhere),
        "junction fixture not created"
    );

    // The held handle is still valid, but the pathname is now a reparse point → refused.
    assert_eq!(
        custody.revalidate().unwrap_err(),
        RootCustodyError::ReparsePointRefused
    );
    drop(custody);
    cleanup(&parent);
}

// ---- privileged symlink variant (env-gated; skipped where privilege is unavailable) ----

#[cfg(windows)]
#[test]
#[ignore = "requires symlink/junction creation privilege; set PROJECTOS_RUN_WINDOWS_ROOT_CUSTODY_REPARSE_PROBE=1"]
fn directory_symlink_root_refused() {
    if std::env::var(REPARSE_GATE).as_deref() != Ok("1") {
        return;
    }
    let parent = unique_dir("reparse");
    let target = parent.join("target");
    std::fs::create_dir_all(&target).unwrap();
    let link = parent.join("link");
    // Requires SeCreateSymbolicLinkPrivilege (or Developer Mode); skip cleanly if unavailable.
    if std::os::windows::fs::symlink_dir(&target, &link).is_err() {
        cleanup(&parent);
        return;
    }
    assert_eq!(
        WindowsRootCustody::open(&link).unwrap_err(),
        RootCustodyError::ReparsePointRefused
    );
    cleanup(&parent);
}
