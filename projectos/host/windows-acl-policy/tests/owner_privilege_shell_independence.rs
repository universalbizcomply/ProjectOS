//! §10G-PRIV — SYSTEM ownership through the accepted service does not depend on the launching shell.
//!
//! An elevated PowerShell launch hands a process `SeRestorePrivilege` DISABLED; an elevated Git Bash
//! launch hands it ENABLED. Before §10G-PRIV the same SYSTEM-owned apply failed with
//! `ERROR_INVALID_OWNER` under the first and succeeded under the second. Run this binary from BOTH
//! shells: the apply must be `Confirmed` in each, and the whole privilege table must read back
//! exactly as it was before.
//!
//! It is a SEPARATE test binary on purpose: a sibling test in the same process applying an ACL could
//! be inside its own privilege window at the instant this one snapshots the token.
//!
//! Disposable `%TEMP%` fixtures only. Requires an elevated administrator token.

#![cfg(windows)]

use std::path::{Path, PathBuf};
use std::process::Command;

use projectos_host_windows_acl_policy::{
    AclPolicy, AclPrincipal, AllowedPrincipal, ApplyOutcome, RightsClass, WindowsAclPolicyService,
};

/// `whoami /priv` of a child process. A child receives a COPY of this process's token, so this is the
/// privilege table exactly as this process holds it at the moment of the call. TEST ONLY.
fn privilege_table() -> String {
    // The absolute System32 path: under Git Bash a bare `whoami` resolves to the MSYS one.
    let system_root = std::env::var_os("SystemRoot").expect("SystemRoot is set on Windows");
    let whoami = PathBuf::from(system_root)
        .join("System32")
        .join("whoami.exe");
    let output = Command::new(whoami)
        .arg("/priv")
        .output()
        .expect("whoami runs");
    assert!(output.status.success(), "whoami /priv failed");
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn restore_line(table: &str) -> String {
    table
        .lines()
        .find(|line| line.starts_with("SeRestorePrivilege"))
        .expect("the token must HOLD SeRestorePrivilege — run elevated")
        .split_whitespace()
        .last()
        .unwrap_or_default()
        .to_owned()
}

fn disposable(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("projectos-aclshell-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("the disposable directory is created");
    dir
}

fn cleanup(path: &Path) {
    let _ = std::fs::remove_dir_all(path);
}

/// The accepted SHAPE — SYSTEM owner, SYSTEM and Administrators full — plus the current account,
/// which stands in for the per-service SID and lets the test remove its own fixture.
fn system_owned_policy() -> AclPolicy {
    AclPolicy::strict(
        AclPrincipal::LocalSystem,
        vec![
            AllowedPrincipal {
                principal: AclPrincipal::LocalSystem,
                rights: RightsClass::FullControl,
            },
            AllowedPrincipal {
                principal: AclPrincipal::BuiltinAdministrators,
                rights: RightsClass::FullControl,
            },
            AllowedPrincipal {
                principal: AclPrincipal::CurrentInteractiveUser,
                rights: RightsClass::FullControl,
            },
        ],
    )
}

#[test]
fn system_ownership_is_applied_whichever_shell_launched_the_process() {
    let before = privilege_table();
    let dir = disposable("dir");
    let parent = disposable("file");
    let file = parent.join("record.v1.json");
    std::fs::write(&file, b"{\"disposable\":true}").expect("the disposable file is written");

    let service = WindowsAclPolicyService::new();
    let policy = system_owned_policy();

    // Every observation is taken BEFORE any assertion, so the fixtures are always removed.
    let dir_outcome = service.apply_and_verify(&dir, &policy);
    let file_outcome = service.apply_and_verify_file(&file, &policy);
    let dir_owner = service.inspect_directory(&dir).map(|i| i.owner);
    let file_owner = service.inspect_file(&file).map(|i| i.owner);
    let after = privilege_table();
    cleanup(&dir);
    cleanup(&parent);

    println!(
        "SeRestorePrivilege BEFORE={} AFTER={} directory={dir_outcome:?} file={file_outcome:?}",
        restore_line(&before),
        restore_line(&after)
    );

    let system = AclPrincipal::LocalSystem
        .resolve()
        .expect("SYSTEM resolves");
    assert_eq!(dir_outcome, Ok(ApplyOutcome::Confirmed));
    assert_eq!(file_outcome, Ok(ApplyOutcome::Confirmed));
    assert_eq!(dir_owner, Ok(Some(system.clone())));
    assert_eq!(file_owner, Ok(Some(system)));
    assert_eq!(
        after, before,
        "the whole privilege table — SeRestorePrivilege and every other — is unchanged"
    );
}
