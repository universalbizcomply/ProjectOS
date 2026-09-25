//! The structured form of the ONE read-only endpoint-tree difference, and its strict parser.
//!
//! PROJECTOS-HOST-REVIEW-PATH1B. The input is exactly what
//! [`crate::GitCommand::DiffTreeEndpoints`] emits: `--raw -z` records, each
//! `:<old mode> <new mode> <old id> <new id> <status>` NUL `<path>` NUL.
//!
//! AN AMBIGUOUS PARSE IS A REFUSAL. This output decides which paths a reviewer is shown, so anything
//! the parser does not fully understand — a status it does not know, a record whose modes and
//! identities disagree with its status, a path it cannot hold, a duplicate, trailing bytes — fails
//! the whole read. Skipping the record would make "a changed path cannot be absent from the evidence"
//! false in exactly the case an attacker would construct.

use crate::command::CommittedPath;
use crate::error::RepoAdapterError;
use crate::parse::MAX_RECORDS;

/// How one path differs between the two endpoint trees. Rename detection is off, so a rename is a
/// [`ChangeKind::Deleted`] and an [`ChangeKind::Added`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    /// Present only in the candidate.
    Added,
    /// Present only in the baseline.
    Deleted,
    /// Present in both with a different identity or mode.
    Modified,
    /// Present in both as a different KIND of entry (a file became a link, for instance).
    TypeChanged,
}

/// What kind of tree entry a mode names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    /// `000000` — no entry on this side.
    Absent,
    /// `100644`.
    RegularFile,
    /// `100755`.
    ExecutableFile,
    /// `120000` — a symbolic link, stored as a blob holding its target text. Never followed.
    SymbolicLink,
    /// `160000` — a submodule pointer.
    Gitlink,
    /// Any other mode. Reported, never interpreted.
    Unsupported,
}

/// One side's mode: the exact octal value Git reported and the kind it names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntryMode {
    octal: u32,
}

impl EntryMode {
    fn parse(text: &str) -> Result<Self, RepoAdapterError> {
        if text.len() != 6 || !text.bytes().all(|b| (b'0'..=b'7').contains(&b)) {
            return Err(RepoAdapterError::MalformedOutput);
        }
        u32::from_str_radix(text, 8)
            .map(|octal| Self { octal })
            .map_err(|_| RepoAdapterError::MalformedOutput)
    }

    /// The mode exactly as Git reported it.
    #[must_use]
    pub fn octal(self) -> u32 {
        self.octal
    }

    /// The kind of entry this mode names.
    #[must_use]
    pub fn kind(self) -> EntryKind {
        match self.octal {
            0 => EntryKind::Absent,
            0o100_644 => EntryKind::RegularFile,
            0o100_755 => EntryKind::ExecutableFile,
            0o120_000 => EntryKind::SymbolicLink,
            0o160_000 => EntryKind::Gitlink,
            _ => EntryKind::Unsupported,
        }
    }
}

/// A full-length object identity: 40 or 64 lower-case hex characters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectId {
    hex: String,
}

impl ObjectId {
    fn parse(text: &str) -> Result<Self, RepoAdapterError> {
        let ok = matches!(text.len(), 40 | 64)
            && text
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if !ok {
            return Err(RepoAdapterError::MalformedOid);
        }
        Ok(Self {
            hex: text.to_string(),
        })
    }

    /// The lower-case hex identity.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.hex
    }

    /// The all-zero identity Git writes for the side that has no entry.
    #[must_use]
    pub fn is_null(&self) -> bool {
        self.hex.bytes().all(|b| b == b'0')
    }
}

/// One changed path between the baseline tree and the candidate tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TreeChange {
    kind: ChangeKind,
    path: CommittedPath,
    old_mode: EntryMode,
    new_mode: EntryMode,
    old_id: ObjectId,
    new_id: ObjectId,
}

impl TreeChange {
    /// How the path changed.
    #[must_use]
    pub fn kind(&self) -> ChangeKind {
        self.kind
    }
    /// The validated repository-relative path.
    #[must_use]
    pub fn path(&self) -> &CommittedPath {
        &self.path
    }
    /// The baseline side's mode.
    #[must_use]
    pub fn old_mode(&self) -> EntryMode {
        self.old_mode
    }
    /// The candidate side's mode.
    #[must_use]
    pub fn new_mode(&self) -> EntryMode {
        self.new_mode
    }
    /// The baseline side's object identity (null when the path was added).
    #[must_use]
    pub fn old_id(&self) -> &ObjectId {
        &self.old_id
    }
    /// The candidate side's object identity (null when the path was deleted).
    #[must_use]
    pub fn new_id(&self) -> &ObjectId {
        &self.new_id
    }
}

/// Parse the complete `--raw -z` output. Empty output is a valid answer: the two trees are equal.
///
/// # Errors
/// [`RepoAdapterError::MalformedOutput`] for any record that is not fully understood,
/// [`RepoAdapterError::MalformedOid`] for an identity that is not full-length lower-case hex, and
/// [`RepoAdapterError::CommittedPathInvalid`] for a path the bounded path type cannot hold.
pub fn parse_raw_z(bytes: &[u8]) -> Result<Vec<TreeChange>, RepoAdapterError> {
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    // Every record ends in NUL, so the text after the last NUL must be empty — anything else is a
    // truncated record.
    let Some(body) = bytes.strip_suffix(&[0u8]) else {
        return Err(RepoAdapterError::MalformedOutput);
    };
    let fields: Vec<&[u8]> = body.split(|b| *b == 0).collect();
    if fields.len() % 2 != 0 || fields.len() / 2 > MAX_RECORDS {
        return Err(RepoAdapterError::MalformedOutput);
    }

    let mut changes: Vec<TreeChange> = Vec::with_capacity(fields.len() / 2);
    for pair in fields.chunks_exact(2) {
        let change = parse_record(pair[0], pair[1])?;
        if changes.iter().any(|seen| seen.path == change.path) {
            return Err(RepoAdapterError::MalformedOutput);
        }
        changes.push(change);
    }
    Ok(changes)
}

fn parse_record(meta: &[u8], path: &[u8]) -> Result<TreeChange, RepoAdapterError> {
    let meta = std::str::from_utf8(meta).map_err(|_| RepoAdapterError::MalformedOutput)?;
    let path = std::str::from_utf8(path).map_err(|_| RepoAdapterError::CommittedPathInvalid)?;
    let Some(meta) = meta.strip_prefix(':') else {
        return Err(RepoAdapterError::MalformedOutput);
    };
    let parts: Vec<&str> = meta.split(' ').collect();
    let [old_mode, new_mode, old_id, new_id, status] = parts.as_slice() else {
        return Err(RepoAdapterError::MalformedOutput);
    };
    let old_mode = EntryMode::parse(old_mode)?;
    let new_mode = EntryMode::parse(new_mode)?;
    let old_id = ObjectId::parse(old_id)?;
    let new_id = ObjectId::parse(new_id)?;
    if old_id.as_str().len() != new_id.as_str().len() {
        return Err(RepoAdapterError::MalformedOid);
    }

    // THE STATUS MUST AGREE WITH WHAT THE MODES AND IDENTITIES SAY. A record claiming `A` while
    // carrying a baseline identity is not an addition this parser understands.
    let old_absent = old_mode.kind() == EntryKind::Absent;
    let new_absent = new_mode.kind() == EntryKind::Absent;
    if old_absent != old_id.is_null() || new_absent != new_id.is_null() {
        return Err(RepoAdapterError::MalformedOutput);
    }
    let kind = match (*status, old_absent, new_absent) {
        ("A", true, false) => ChangeKind::Added,
        ("D", false, true) => ChangeKind::Deleted,
        ("M", false, false) => ChangeKind::Modified,
        ("T", false, false) => ChangeKind::TypeChanged,
        _ => return Err(RepoAdapterError::MalformedOutput),
    };
    if kind == ChangeKind::Modified && old_id == new_id && old_mode == new_mode {
        return Err(RepoAdapterError::MalformedOutput);
    }

    Ok(TreeChange {
        kind,
        path: CommittedPath::new(path)?,
        old_mode,
        new_mode,
        old_id,
        new_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const Z: &str = "0000000000000000000000000000000000000000";

    fn rec(meta: &str, path: &str) -> Vec<u8> {
        let mut v = meta.as_bytes().to_vec();
        v.push(0);
        v.extend_from_slice(path.as_bytes());
        v.push(0);
        v
    }

    #[test]
    fn equal_trees_are_an_empty_answer_not_an_error() {
        assert_eq!(parse_raw_z(b"").unwrap(), Vec::new());
    }

    #[test]
    fn every_status_is_read_with_its_modes_and_full_identities() {
        let mut out = rec(&format!(":000000 100644 {Z} {A} A"), "src/new.rs");
        out.extend(rec(&format!(":100644 000000 {A} {Z} D"), "src/gone.rs"));
        out.extend(rec(&format!(":100644 100755 {A} {A} M"), "run.sh"));
        out.extend(rec(&format!(":100644 120000 {A} {B} T"), "link"));
        let changes = parse_raw_z(&out).unwrap();
        assert_eq!(
            changes.iter().map(TreeChange::kind).collect::<Vec<_>>(),
            [
                ChangeKind::Added,
                ChangeKind::Deleted,
                ChangeKind::Modified,
                ChangeKind::TypeChanged
            ]
        );
        assert_eq!(changes[0].path().as_str(), "src/new.rs");
        assert!(changes[0].old_id().is_null());
        assert_eq!(changes[0].new_id().as_str(), A);
        // A MODE-ONLY CHANGE IS VISIBLE: same identity, different mode.
        assert_eq!(changes[2].old_mode().kind(), EntryKind::RegularFile);
        assert_eq!(changes[2].new_mode().kind(), EntryKind::ExecutableFile);
        assert_eq!(changes[2].new_mode().octal(), 0o100_755);
        assert_eq!(changes[3].new_mode().kind(), EntryKind::SymbolicLink);
    }

    #[test]
    fn a_gitlink_and_an_unknown_mode_are_reported_as_what_they_are() {
        let out = rec(&format!(":000000 160000 {Z} {A} A"), "vendor/sub");
        assert_eq!(
            parse_raw_z(&out).unwrap()[0].new_mode().kind(),
            EntryKind::Gitlink
        );
        let out = rec(&format!(":000000 100664 {Z} {A} A"), "odd");
        assert_eq!(
            parse_raw_z(&out).unwrap()[0].new_mode().kind(),
            EntryKind::Unsupported
        );
    }

    #[test]
    fn anything_not_fully_understood_refuses_the_whole_read() {
        let good = rec(&format!(":000000 100644 {Z} {A} A"), "a");
        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("no trailing NUL", good[..good.len() - 1].to_vec()),
            ("odd field count", [good.clone(), b"x\0".to_vec()].concat()),
            ("no colon", rec(&format!("000000 100644 {Z} {A} A"), "a")),
            (
                "rename status",
                rec(&format!(":100644 100644 {A} {B} R100"), "a"),
            ),
            (
                "unknown status",
                rec(&format!(":100644 100644 {A} {B} X"), "a"),
            ),
            (
                "copy status",
                rec(&format!(":100644 100644 {A} {B} C"), "a"),
            ),
            (
                "unmerged status",
                rec(&format!(":100644 100644 {A} {B} U"), "a"),
            ),
            ("short mode", rec(&format!(":00000 100644 {Z} {A} A"), "a")),
            (
                "non-octal mode",
                rec(&format!(":000008 100644 {Z} {A} A"), "a"),
            ),
            (
                "extra field",
                rec(&format!(":000000 100644 {Z} {A} A extra"), "a"),
            ),
            (
                "double space",
                rec(&format!(":000000  100644 {Z} {A} A"), "a"),
            ),
            (
                "added with a baseline identity",
                rec(&format!(":000000 100644 {A} {B} A"), "a"),
            ),
            (
                "added with a baseline mode",
                rec(&format!(":100644 100644 {Z} {A} A"), "a"),
            ),
            (
                "deleted with a candidate identity",
                rec(&format!(":100644 000000 {A} {B} D"), "a"),
            ),
            (
                "modified with an absent side",
                rec(&format!(":000000 100644 {Z} {A} M"), "a"),
            ),
            (
                "modified with nothing changed",
                rec(&format!(":100644 100644 {A} {A} M"), "a"),
            ),
            ("duplicate path", [good.clone(), good.clone()].concat()),
        ];
        for (name, bytes) in cases {
            assert_eq!(
                parse_raw_z(&bytes).unwrap_err(),
                RepoAdapterError::MalformedOutput,
                "{name}"
            );
        }
    }

    #[test]
    fn an_abbreviated_upper_case_or_mixed_length_identity_refuses() {
        let short = &A[..39];
        let upper = A.to_uppercase();
        let long = "a".repeat(64);
        for meta in [
            format!(":000000 100644 {Z} {short} A"),
            format!(":000000 100644 {Z} {upper} A"),
            format!(":000000 100644 {Z} {long} A"),
            format!(":000000 100644 {Z} {A}... A"),
        ] {
            assert_eq!(
                parse_raw_z(&rec(&meta, "a")).unwrap_err(),
                RepoAdapterError::MalformedOid,
                "{meta}"
            );
        }
    }

    #[test]
    fn a_path_the_bounded_type_cannot_hold_refuses_rather_than_being_skipped() {
        for path in [
            "a b",
            "a\tb",
            "../up",
            "a:b",
            "-opt",
            "\u{00e9}",
            &"p".repeat(513),
        ] {
            assert_eq!(
                parse_raw_z(&rec(&format!(":000000 100644 {Z} {A} A"), path)).unwrap_err(),
                RepoAdapterError::CommittedPathInvalid,
                "{path:?}"
            );
        }
        let mut invalid_utf8 = format!(":000000 100644 {Z} {A} A").into_bytes();
        invalid_utf8.extend_from_slice(&[0, 0xff, 0xfe, 0]);
        assert_eq!(
            parse_raw_z(&invalid_utf8).unwrap_err(),
            RepoAdapterError::CommittedPathInvalid
        );
    }
}
