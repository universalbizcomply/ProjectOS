//! CORRECTION1B: separation of redacted-narrative / repository-remote / local-root validation.

use projectos_host_persistence::{
    validate_local_root, validate_repository_remote, PersistError, ProjectRegistryDto,
};

// ---- repository-remote validator -----------------------------------------------------------------

#[test]
fn valid_https_remote_accepted() {
    validate_repository_remote("https://github.com/universalbizcomply/PolyGo").unwrap();
    validate_repository_remote("https://github.com/universalbizcomply/PolyGo.git").unwrap();
}

#[test]
fn narrative_text_remote_rejected() {
    assert_eq!(
        validate_repository_remote("the polygo repo on github"),
        Err(PersistError::InvalidRepositoryRemote)
    );
}

#[test]
fn local_path_as_remote_rejected() {
    assert_eq!(
        validate_repository_remote("C:\\dev\\PolyGo"),
        Err(PersistError::InvalidRepositoryRemote)
    );
}

#[test]
fn embedded_userinfo_remote_rejected() {
    assert_eq!(
        validate_repository_remote("https://user@github.com/org/repo"),
        Err(PersistError::InvalidRepositoryRemote)
    );
}

#[test]
fn credential_bearing_remote_rejected() {
    assert_eq!(
        validate_repository_remote("https://user:pass@github.com/org/repo"),
        Err(PersistError::InvalidRepositoryRemote)
    );
}

#[test]
fn query_and_fragment_remote_rejected() {
    assert_eq!(
        validate_repository_remote("https://github.com/org/repo?token=x"),
        Err(PersistError::InvalidRepositoryRemote)
    );
    assert_eq!(
        validate_repository_remote("https://github.com/org/repo#frag"),
        Err(PersistError::InvalidRepositoryRemote)
    );
}

#[test]
fn unsupported_scheme_remote_rejected() {
    for r in [
        "http://github.com/org/repo",
        "git://github.com/org/repo",
        "ssh://git@github.com/org/repo",
        "git@github.com:org/repo.git",
    ] {
        assert_eq!(
            validate_repository_remote(r),
            Err(PersistError::InvalidRepositoryRemote),
            "should reject {r}"
        );
    }
}

#[test]
fn whitespace_padded_remote_rejected() {
    assert_eq!(
        validate_repository_remote(" https://github.com/org/repo "),
        Err(PersistError::InvalidRepositoryRemote)
    );
}

#[test]
fn missing_repository_component_rejected() {
    assert_eq!(
        validate_repository_remote("https://github.com/onlyorg"),
        Err(PersistError::InvalidRepositoryRemote)
    );
}

#[test]
fn placeholder_as_remote_rejected() {
    assert_eq!(
        validate_repository_remote("URL_PLACEHOLDER"),
        Err(PersistError::InvalidRepositoryRemote)
    );
}

// ---- local-root validator ------------------------------------------------------------------------

#[test]
fn drive_rooted_local_root_accepted() {
    validate_local_root("C:\\dev\\ProjectOS").unwrap();
    validate_local_root("D:\\projects\\PolyGo").unwrap();
}

#[test]
fn relative_local_root_rejected() {
    assert_eq!(
        validate_local_root("dev\\ProjectOS"),
        Err(PersistError::InvalidLocalRoot)
    );
}

#[test]
fn url_as_local_root_rejected() {
    assert_eq!(
        validate_local_root("https://github.com/org/repo"),
        Err(PersistError::InvalidLocalRoot)
    );
    // Forward-slash (POSIX-style) path is not the supported Windows form.
    assert_eq!(
        validate_local_root("C:/dev/ProjectOS"),
        Err(PersistError::InvalidLocalRoot)
    );
}

#[test]
fn dot_and_dotdot_segments_rejected() {
    assert_eq!(
        validate_local_root("C:\\dev\\.\\ProjectOS"),
        Err(PersistError::InvalidLocalRoot)
    );
    assert_eq!(
        validate_local_root("C:\\dev\\..\\Secret"),
        Err(PersistError::InvalidLocalRoot)
    );
}

#[test]
fn alternate_data_stream_rejected() {
    assert_eq!(
        validate_local_root("C:\\dev\\ProjectOS\\file:stream"),
        Err(PersistError::InvalidLocalRoot)
    );
}

#[test]
fn device_and_unc_paths_rejected() {
    for p in ["\\\\.\\C:\\dev", "\\\\?\\C:\\dev", "\\\\server\\share\\x"] {
        assert_eq!(
            validate_local_root(p),
            Err(PersistError::InvalidLocalRoot),
            "should reject {p}"
        );
    }
}

#[test]
fn placeholder_and_whitespace_and_control_and_empty_root_rejected() {
    assert_eq!(
        validate_local_root("PROJECT_REF_PLACEHOLDER"),
        Err(PersistError::InvalidLocalRoot)
    );
    assert_eq!(
        validate_local_root(" C:\\dev\\ProjectOS "),
        Err(PersistError::InvalidLocalRoot)
    );
    assert_eq!(
        validate_local_root("C:\\dev\\Proj\tOS"),
        Err(PersistError::InvalidLocalRoot)
    );
    assert_eq!(validate_local_root(""), Err(PersistError::InvalidLocalRoot));
}

// ---- registry DTO wiring + separation ------------------------------------------------------------

fn registry(remote: &str, root: &str) -> Result<(), PersistError> {
    // Build JSON with the two identity fields substituted; escape backslashes for JSON.
    let root_json = root.replace('\\', "\\\\");
    let json = format!(
        r#"{{"schemaVersion":1,"recordRevision":1,"project":"polygo","repositoryIdentity":"repo-1","approvedRemote":"{remote}","permittedLocalRoot":"{root_json}","allowedEnvironments":["staging"],"providerBindings":["supabase"],"productionFreeze":false,"projectStatus":"ACTIVE","approvedConfigVersion":1}}"#
    );
    match ProjectRegistryDto::parse_json(json.as_bytes()) {
        Err(e) => Err(e),
        Ok(d) => d.validate(),
    }
}

#[test]
fn registry_accepts_valid_identities() {
    registry(
        "https://github.com/universalbizcomply/PolyGo.git",
        "C:\\dev\\PolyGo",
    )
    .unwrap();
}

#[test]
fn registry_rejects_placeholder_identities() {
    assert_eq!(
        registry("URL_PLACEHOLDER", "C:\\dev\\PolyGo"),
        Err(PersistError::InvalidRepositoryRemote)
    );
    assert_eq!(
        registry("https://github.com/org/repo", "PROJECT_REF_PLACEHOLDER"),
        Err(PersistError::InvalidLocalRoot)
    );
}

#[test]
fn registry_rejects_credential_bearing_remote() {
    assert_eq!(
        registry("https://user:pass@github.com/org/repo", "C:\\dev\\PolyGo"),
        Err(PersistError::InvalidRepositoryRemote)
    );
}

#[test]
fn identity_errors_do_not_echo_supplied_value() {
    let leak = "https://user:pass_super_secret_1234@github.com/org/repo";
    let err = validate_repository_remote(leak).unwrap_err();
    assert_eq!(err, PersistError::InvalidRepositoryRemote);
    assert!(!format!("{err}").contains("pass_super_secret_1234"));

    let path_leak = "C:\\dev\\ProjectOS\\file:secret_stream_name";
    let perr = validate_local_root(path_leak).unwrap_err();
    assert_eq!(perr, PersistError::InvalidLocalRoot);
    assert!(!format!("{perr}").contains("secret_stream_name"));
}
