//! Structured, bounded parsers for the allowlisted Git outputs. Only machine-readable forms are parsed
//! (porcelain v2, exact OIDs, integer counts) — never localized human-readable `git status` prose.

use projectos_host_core::is_valid_oid;

use crate::error::RepoAdapterError;

/// Maximum lines parsed from any single command output.
pub const MAX_LINES: usize = 100_000;
/// Maximum status/submodule/worktree records considered.
pub const MAX_RECORDS: usize = 100_000;

fn as_str(bytes: &[u8]) -> Result<&str, RepoAdapterError> {
    std::str::from_utf8(bytes).map_err(|_| RepoAdapterError::MalformedOutput)
}

/// A single trimmed line (e.g. a path or ref). Empty is malformed for a required single-line output.
pub fn single_line(bytes: &[u8]) -> Result<String, RepoAdapterError> {
    let s = as_str(bytes)?.trim_end_matches(['\n', '\r']).trim();
    if s.is_empty() || s.contains('\n') {
        return Err(RepoAdapterError::MalformedOutput);
    }
    Ok(s.to_string())
}

/// A validated Git object id from `rev-parse HEAD`.
pub fn oid(bytes: &[u8]) -> Result<String, RepoAdapterError> {
    let s = as_str(bytes)?.trim();
    if !is_valid_oid(s) {
        return Err(RepoAdapterError::MalformedOid);
    }
    Ok(s.to_string())
}

/// `is-inside-work-tree` → bool.
pub fn work_tree_flag(bytes: &[u8]) -> Result<bool, RepoAdapterError> {
    match as_str(bytes)?.trim() {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(RepoAdapterError::MalformedOutput),
    }
}

/// The parsed porcelain-v2 `--branch` summary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PorcelainSummary {
    /// Branch head name, or `None` for detached.
    pub head: Option<String>,
    /// Whether an upstream tracking reference is configured.
    pub upstream_present: bool,
    /// Staged (index) change count.
    pub staged: u32,
    /// Unstaged (worktree) change count.
    pub unstaged: u32,
    /// Untracked file count.
    pub untracked: u32,
}

/// Parse `git status --porcelain=v2 --branch --untracked-files=all`.
///
/// # Errors
/// [`RepoAdapterError::MalformedOutput`] for a non-UTF-8, over-long, or structurally invalid record;
/// duplicate branch headers are refused.
pub fn porcelain(bytes: &[u8]) -> Result<PorcelainSummary, RepoAdapterError> {
    let text = as_str(bytes)?;
    let mut head: Option<String> = None;
    let mut head_seen = false;
    let mut upstream_present = false;
    let (mut staged, mut unstaged, mut untracked) = (0u32, 0u32, 0u32);
    let mut lines = 0usize;
    for line in text.split('\n') {
        if line.is_empty() {
            continue;
        }
        lines += 1;
        if lines > MAX_LINES {
            return Err(RepoAdapterError::OutputOverflow);
        }
        if let Some(rest) = line.strip_prefix("# ") {
            if let Some(v) = rest.strip_prefix("branch.head ") {
                if head_seen {
                    return Err(RepoAdapterError::MalformedOutput); // duplicate header
                }
                head_seen = true;
                head = if v.trim() == "(detached)" {
                    None
                } else {
                    Some(v.trim().to_string())
                };
            } else if rest.starts_with("branch.upstream ") {
                upstream_present = true;
            }
            // branch.oid / branch.ab are not load-bearing here (ahead/behind come from rev-list).
            continue;
        }
        // Entry records.
        let mut parts = line.splitn(3, ' ');
        match parts.next() {
            Some("1") | Some("2") => {
                let xy = parts.next().ok_or(RepoAdapterError::MalformedOutput)?;
                let b = xy.as_bytes();
                if b.len() != 2 {
                    return Err(RepoAdapterError::MalformedOutput);
                }
                if b[0] != b'.' {
                    staged += 1;
                }
                if b[1] != b'.' {
                    unstaged += 1;
                }
            }
            Some("u") => unstaged += 1, // unmerged/conflict counts as a worktree change
            Some("?") => untracked += 1,
            Some("!") => {} // ignored (not requested; benign)
            _ => return Err(RepoAdapterError::MalformedOutput),
        }
    }
    if !head_seen {
        return Err(RepoAdapterError::MalformedOutput);
    }
    Ok(PorcelainSummary {
        head,
        upstream_present,
        staged,
        unstaged,
        untracked,
    })
}

/// Parse `git rev-list --left-right --count local...tracking` → `(ahead, behind)`.
///
/// # Errors
/// [`RepoAdapterError::MalformedOutput`] for a non-`<int>\t<int>` line or a negative/overflow value.
pub fn ahead_behind(bytes: &[u8]) -> Result<(u32, u32), RepoAdapterError> {
    let s = as_str(bytes)?.trim();
    let mut it = s.split_whitespace();
    let a = it.next().ok_or(RepoAdapterError::MalformedOutput)?;
    let b = it.next().ok_or(RepoAdapterError::MalformedOutput)?;
    if it.next().is_some() {
        return Err(RepoAdapterError::MalformedOutput);
    }
    let ahead: u32 = a.parse().map_err(|_| RepoAdapterError::MalformedOutput)?;
    let behind: u32 = b.parse().map_err(|_| RepoAdapterError::MalformedOutput)?;
    Ok((ahead, behind))
}

/// Parse `git submodule status --recursive` → whether any submodule is dirty/out-of-date.
///
/// # Errors
/// [`RepoAdapterError`] on an over-long record set.
pub fn submodule_dirty(bytes: &[u8]) -> Result<bool, RepoAdapterError> {
    let text = as_str(bytes)?;
    let mut dirty = false;
    let mut records = 0usize;
    for line in text.split('\n') {
        if line.is_empty() {
            continue;
        }
        records += 1;
        if records > MAX_RECORDS {
            return Err(RepoAdapterError::OutputOverflow);
        }
        // Leading '+' (checked-out commit differs) or 'U' (merge conflicts) = dirty/out-of-date.
        match line.as_bytes().first() {
            Some(b'+') | Some(b'U') => dirty = true,
            _ => {}
        }
    }
    Ok(dirty)
}

/// Count `git worktree list --porcelain` entries (awareness only).
///
/// # Errors
/// [`RepoAdapterError`] on an over-long record set.
pub fn worktree_count(bytes: &[u8]) -> Result<u32, RepoAdapterError> {
    let text = as_str(bytes)?;
    let mut n = 0u32;
    let mut records = 0usize;
    for line in text.split('\n') {
        records += 1;
        if records > MAX_RECORDS {
            return Err(RepoAdapterError::OutputOverflow);
        }
        if line.starts_with("worktree ") {
            n += 1;
        }
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- OID -----------------------------------------------------------------------------------

    #[test]
    fn oid_accepts_only_lowercase_hex_of_valid_length() {
        assert_eq!(
            oid(b"a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n")
                .unwrap()
                .len(),
            40
        );
        assert_eq!(oid(&"0".repeat(64).into_bytes()).unwrap().len(), 64);
        assert_eq!(oid(b"nothex"), Err(RepoAdapterError::MalformedOid));
        assert_eq!(
            oid(&"A".repeat(40).into_bytes()),
            Err(RepoAdapterError::MalformedOid)
        );
        assert_eq!(
            oid(&"a".repeat(39).into_bytes()),
            Err(RepoAdapterError::MalformedOid)
        );
        assert_eq!(oid(b""), Err(RepoAdapterError::MalformedOid));
    }

    #[test]
    fn non_utf8_is_malformed() {
        assert_eq!(oid(&[0xff, 0xfe]), Err(RepoAdapterError::MalformedOutput));
        assert_eq!(porcelain(&[0xff]), Err(RepoAdapterError::MalformedOutput));
    }

    // ---- SINGLE LINE / FLAG --------------------------------------------------------------------

    #[test]
    fn single_line_rejects_empty_and_multiline() {
        assert_eq!(single_line(b"C:/repo\n").unwrap(), "C:/repo");
        assert_eq!(single_line(b""), Err(RepoAdapterError::MalformedOutput));
        assert_eq!(
            single_line(b"   \n"),
            Err(RepoAdapterError::MalformedOutput)
        );
        assert_eq!(single_line(b"a\nb"), Err(RepoAdapterError::MalformedOutput));
    }

    #[test]
    fn work_tree_flag_is_exact() {
        assert!(work_tree_flag(b"true\n").unwrap());
        assert!(!work_tree_flag(b"false\n").unwrap());
        assert_eq!(
            work_tree_flag(b"yes"),
            Err(RepoAdapterError::MalformedOutput)
        );
    }

    // ---- PORCELAIN (M18: malformed porcelain refused, never trusted) ---------------------------

    fn clean_porcelain() -> Vec<u8> {
        b"# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n".to_vec()
    }

    #[test]
    fn porcelain_parses_a_clean_branch_summary() {
        let s = porcelain(&clean_porcelain()).unwrap();
        assert_eq!(s.head.as_deref(), Some("main"));
        assert!(s.upstream_present);
        assert_eq!((s.staged, s.unstaged, s.untracked), (0, 0, 0));
    }

    #[test]
    fn porcelain_detached_head_is_none() {
        let s = porcelain(b"# branch.head (detached)\n").unwrap();
        assert!(s.head.is_none());
        assert!(!s.upstream_present);
    }

    #[test]
    fn porcelain_counts_staged_unstaged_and_untracked() {
        // "1 M. ..." = staged; "1 .M ..." = unstaged; "? path" = untracked; "u ..." = unstaged.
        let mut v = b"# branch.head main\n".to_vec();
        v.extend_from_slice(b"1 M. N... 100644 100644 100644 aaa bbb staged.txt\n");
        v.extend_from_slice(b"1 .M N... 100644 100644 100644 aaa bbb unstaged.txt\n");
        v.extend_from_slice(b"? untracked.txt\n");
        v.extend_from_slice(b"u UU N... 1 2 3 aaa bbb ccc conflict.txt\n");
        let s = porcelain(&v).unwrap();
        assert_eq!((s.staged, s.unstaged, s.untracked), (1, 2, 1));
    }

    #[test]
    fn porcelain_missing_branch_header_is_malformed() {
        assert_eq!(
            porcelain(b"? a.txt\n"),
            Err(RepoAdapterError::MalformedOutput)
        );
    }

    #[test]
    fn porcelain_duplicate_branch_header_is_malformed() {
        assert_eq!(
            porcelain(b"# branch.head main\n# branch.head dev\n"),
            Err(RepoAdapterError::MalformedOutput)
        );
    }

    #[test]
    fn porcelain_bad_record_token_and_xy_length_are_malformed() {
        assert_eq!(
            porcelain(b"# branch.head main\n9 bogus\n"),
            Err(RepoAdapterError::MalformedOutput)
        );
        assert_eq!(
            porcelain(b"# branch.head main\n1 M\n"),
            Err(RepoAdapterError::MalformedOutput) // xy field not 2 bytes
        );
    }

    // ---- AHEAD / BEHIND ------------------------------------------------------------------------

    #[test]
    fn ahead_behind_parses_two_ints_only() {
        assert_eq!(ahead_behind(b"0\t0\n").unwrap(), (0, 0));
        assert_eq!(ahead_behind(b"3 5\n").unwrap(), (3, 5));
        assert_eq!(ahead_behind(b"1"), Err(RepoAdapterError::MalformedOutput));
        assert_eq!(
            ahead_behind(b"1 2 3"),
            Err(RepoAdapterError::MalformedOutput)
        );
        assert_eq!(ahead_behind(b"x 2"), Err(RepoAdapterError::MalformedOutput));
        assert_eq!(
            ahead_behind(b"-1 2"),
            Err(RepoAdapterError::MalformedOutput)
        );
    }

    // ---- SUBMODULE / WORKTREE ------------------------------------------------------------------

    #[test]
    fn submodule_dirty_flags_plus_or_conflict() {
        assert!(!submodule_dirty(b" abc sub (v1)\n").unwrap());
        assert!(submodule_dirty(b"+abc sub (v1)\n").unwrap());
        assert!(submodule_dirty(b"U abc sub\n").unwrap());
    }

    #[test]
    fn worktree_count_counts_worktree_records() {
        assert_eq!(
            worktree_count(b"worktree C:/a\nHEAD abc\n\nworktree C:/b\n").unwrap(),
            2
        );
    }
}
