//! Explicit Unicode environment block (PROJECTOS-WINDOWS-PROCESS-CREATION1A).
//!
//! The child NEVER inherits the host environment. The host process holds developer tokens
//! (Supabase / Vercel / GitHub / AWS / npm) and inheriting them would hand every one of them to the
//! worker. Instead an explicit allowlisted block is built here and passed to `CreateProcessW` with
//! `CREATE_UNICODE_ENVIRONMENT`.
//!
//! Block format (documented Win32 contract): `name=value\0` entries, concatenated, terminated by an
//! ADDITIONAL NUL. Entries must be sorted case-insensitively in Unicode order, without locale
//! dependence — `to_uppercase()` is Unicode-defined and locale-independent, unlike a locale collation.
//!
//! Deliberately PURE and platform-independent so the rules are testable everywhere.
//!
//! `PATH` is deliberately NOT allowlisted: nothing may ever be PATH-resolved (the executable is
//! passed absolutely via `lpApplicationName`).

use super::errors::ProcessError;

/// System variables the allowlist may draw from. `SystemRoot` is mandatory in practice — Node's
/// Windows crypto/DNS initialisation fails without it, the classic empty-environment failure.
/// The rest are candidates; the caller passes only what it actually needs.
pub const SYSTEM_ALLOWLIST: &[&str] = &["SystemRoot", "SystemDrive", "windir", "TEMP", "TMP"];

/// The one internally-built, non-secret correlator the adapter is allowed to inject. It is NOT a
/// secret and NOT trust evidence; it exists so a daemon can announce which launch it belongs to.
pub(crate) const DAEMON_INSTANCE_ID_VAR: &str = "PROJECTOS_DAEMON_INSTANCE_ID";

/// The one tool capability the adapter may inject: an ABSOLUTE path to the Git executable the host
/// resolved. It is a path, not a credential — it carries no authority beyond "this file is where
/// git lives" — and it exists precisely so the daemon never needs a PATH to search. `PATH` itself
/// stays un-allowlisted.
pub(crate) const DAEMON_GIT_EXE_VAR: &str = "PROJECTOS_GIT_EXE";

/// The DEVELOPMENT bridge configuration, as ONE absolute path (PROJECTOS-RECOVERY-INSTALLED-APP1A).
///
/// The daemon used to read `bridge.config.json` as a bare relative name, which resolved against
/// whatever directory it happened to start in. That is a redirection primitive: the file chooses the
/// daemon's watch roots, and therefore which repository it treats as governed, so anyone who could
/// place a file beside the launch directory could point the daemon elsewhere. Working directory is
/// not authority.
///
/// The path is now bound by the launch authority, like the Git executable above, and only the
/// DEVELOPMENT authority binds it. Packaged launches inject nothing, so a packaged daemon has no
/// configuration file and cannot be given one; the daemon additionally refuses a relative value,
/// because a relative value is the ambient behaviour under another name.
pub(crate) const DAEMON_BRIDGE_CONFIG_VAR: &str = "PROJECTOS_BRIDGE_CONFIG";

/// Variable-name fragments that must never appear in a child environment.
const SECRET_SHAPED: &[&str] = &[
    "TOKEN",
    "SECRET",
    "PASSWORD",
    "PASSWD",
    "APIKEY",
    "API_KEY",
    "KEY",
    "CREDENTIAL",
    "AUTH",
    "SUPABASE",
    "VERCEL",
    "GITHUB",
    "AWS",
    "NPM",
    "SESSION",
    "COOKIE",
    "JWT",
];

/// True when a variable name is secret-shaped and must be refused.
pub fn is_secret_shaped(name: &str) -> bool {
    let upper = name.to_uppercase();
    SECRET_SHAPED.iter().any(|frag| upper.contains(frag))
}

/// Validate one `name=value` pair.
fn validate(name: &str, value: &str) -> Result<(), ProcessError> {
    if name.is_empty()
        || name.contains('=')
        || name.contains('\0')
        || value.contains('\0')
        || is_secret_shaped(name)
        || name.eq_ignore_ascii_case("PATH")
    {
        return Err(ProcessError::EnvironmentVariableInvalid);
    }
    Ok(())
}

/// Build the explicit UTF-16 environment block from allowlisted pairs.
///
/// Rejects: empty names, `=` in a name, embedded NUL, `PATH`, and any secret-shaped name.
/// Sorts case-insensitively (Unicode `to_uppercase`, locale-independent), then double-NUL terminates.
pub fn build_environment_block(pairs: &[(String, String)]) -> Result<Vec<u16>, ProcessError> {
    for (n, v) in pairs {
        validate(n, v)?;
    }
    let mut sorted: Vec<&(String, String)> = pairs.iter().collect();
    sorted.sort_by(|a, b| {
        let (ka, kb) = (a.0.to_uppercase(), b.0.to_uppercase());
        ka.cmp(&kb)
    });

    let mut block: Vec<u16> = Vec::new();
    for (n, v) in sorted {
        block.extend(n.encode_utf16());
        block.push(u16::from(b'='));
        block.extend(v.encode_utf16());
        block.push(0); // terminate this entry
    }
    // An empty block still needs a valid terminator pair; a lone NUL is the documented empty block.
    block.push(0); // additional NUL terminating the whole block
    Ok(block)
}

/// Collect the requested system variables from the host environment, skipping any that are absent.
/// This reads only the named variables — it never enumerates or copies the whole environment.
pub fn collect_system_vars(names: &[&str]) -> Vec<(String, String)> {
    names
        .iter()
        .filter_map(|n| std::env::var(n).ok().map(|v| ((*n).to_string(), v)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(n: &str, v: &str) -> (String, String) {
        (n.to_string(), v.to_string())
    }

    fn decode(block: &[u16]) -> Vec<String> {
        // Split on NUL; the final empty segment is the block terminator.
        let mut out = Vec::new();
        let mut cur: Vec<u16> = Vec::new();
        for &c in block {
            if c == 0 {
                if cur.is_empty() {
                    break;
                }
                out.push(String::from_utf16(&cur).unwrap());
                cur.clear();
            } else {
                cur.push(c);
            }
        }
        out
    }

    #[test]
    fn entries_are_sorted_case_insensitively() {
        let b =
            build_environment_block(&[p("zeta", "1"), p("Alpha", "2"), p("beta", "3")]).unwrap();
        assert_eq!(decode(&b), vec!["Alpha=2", "beta=3", "zeta=1"]);
    }

    #[test]
    fn sort_is_case_insensitive_not_ascii_ordinal() {
        // Ordinal ASCII would put uppercase 'Z' before lowercase 'a'; case-insensitive must not.
        let b = build_environment_block(&[p("Zebra", "1"), p("apple", "2")]).unwrap();
        assert_eq!(decode(&b), vec!["apple=2", "Zebra=1"]);
    }

    #[test]
    fn block_is_double_nul_terminated() {
        let b = build_environment_block(&[p("A", "1")]).unwrap();
        assert_eq!(&b[b.len() - 2..], &[0, 0]);
    }

    #[test]
    fn empty_block_is_a_single_nul() {
        let b = build_environment_block(&[]).unwrap();
        assert_eq!(b, vec![0]);
    }

    #[test]
    fn path_is_rejected() {
        assert_eq!(
            build_environment_block(&[p("PATH", "C:\\x")]),
            Err(ProcessError::EnvironmentVariableInvalid)
        );
        assert_eq!(
            build_environment_block(&[p("Path", "C:\\x")]),
            Err(ProcessError::EnvironmentVariableInvalid)
        );
    }

    #[test]
    fn secret_shaped_names_rejected() {
        for n in [
            "GITHUB_TOKEN",
            "SUPABASE_SERVICE_ROLE_KEY",
            "VERCEL_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
            "npm_config_registry",
            "MY_PASSWORD",
            "SESSION_ID",
            "some_jwt",
        ] {
            assert_eq!(
                build_environment_block(&[p(n, "x")]),
                Err(ProcessError::EnvironmentVariableInvalid),
                "{n} must be rejected"
            );
        }
    }

    #[test]
    fn invalid_names_rejected() {
        assert_eq!(
            build_environment_block(&[p("", "v")]),
            Err(ProcessError::EnvironmentVariableInvalid)
        );
        assert_eq!(
            build_environment_block(&[p("A=B", "v")]),
            Err(ProcessError::EnvironmentVariableInvalid)
        );
    }

    #[test]
    fn embedded_nul_rejected() {
        assert_eq!(
            build_environment_block(&[p("A\0B", "v")]),
            Err(ProcessError::EnvironmentVariableInvalid)
        );
        assert_eq!(
            build_environment_block(&[p("A", "v\0w")]),
            Err(ProcessError::EnvironmentVariableInvalid)
        );
    }

    #[test]
    fn system_allowlist_contains_systemroot_and_not_path() {
        assert!(SYSTEM_ALLOWLIST.contains(&"SystemRoot"));
        assert!(!SYSTEM_ALLOWLIST
            .iter()
            .any(|v| v.eq_ignore_ascii_case("PATH")));
    }

    #[test]
    fn allowlisted_system_vars_pass_validation() {
        // Every candidate in the allowlist must itself be acceptable (no secret-shaped false hit).
        for n in SYSTEM_ALLOWLIST {
            assert!(
                build_environment_block(&[p(n, "x")]).is_ok(),
                "{n} should be allowed"
            );
        }
    }

    #[test]
    fn collect_system_vars_reads_only_named() {
        let got = collect_system_vars(&["SystemRoot", "PROJECTOS_DEFINITELY_ABSENT_VAR"]);
        assert!(got.len() <= 1);
        assert!(got.iter().all(|(n, _)| n == "SystemRoot"));
    }

    #[test]
    fn unicode_values_round_trip() {
        let b = build_environment_block(&[p("A", "ünï")]).unwrap();
        assert_eq!(decode(&b), vec!["A=ünï"]);
    }
}
