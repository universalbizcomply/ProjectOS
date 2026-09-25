//! PROJECTOS-HOST-REVIEW-PATH1B — THE PRODUCTION `CandidateEvidencePort`: the Host's own reading of
//! what changed between the approved baseline and the commit it pinned.
//!
//! ## It reuses the one repository reader
//!
//! Every byte here comes through [`CommittedFileReader`]: the changed-path set from
//! [`CommittedFileReader::changes_since`] and each file's contents from
//! [`CommittedFileReader::committed_bytes`], both answered from the object store at the commit the
//! reader pinned ONCE, under the environment the repository crate fixes. There is no second reader, no
//! second candidate, and nothing here spawns a process or names a Git verb.
//!
//! ## What it will not do
//!
//! * TAKE A CANDIDATE. The only parameter is the baseline, which is a Host fact from the durable
//!   approved-plan record. The candidate is whatever the reader pinned.
//! * FOLLOW A LINK. A link's contents are its committed target text, read like any other blob; the
//!   target is never opened.
//! * DESCRIBE WHAT IT CANNOT. A submodule pointer or any other unsupported entry refuses the whole
//!   review - it is not skipped, because a skipped path is a changed path absent from the evidence.
//! * SHORTEN ANYTHING. An object over the reader's bound, or evidence over the contract's, refuses.

use projectos_host_gatekeeper_attestation::candidate_evidence::{
    CandidateEvidence, EvidenceChange, EvidenceEntryInput, EvidenceRefusal, BOUNDARY_MARKER_LEN,
};
use projectos_host_gatekeeper_attestation::operation::{CandidateEvidencePort, EvidenceUnavailable};
use projectos_host_repository::{
    ChangeKind, CommitId, CommittedFileReader, EntryKind, RepoAdapterError, TreeChange,
};
use projectos_windows_runtime_primitives::system_random::system_preferred_fill;

/// Candidate evidence derived from ONE pinned committed-file reader.
pub struct PinnedCommitEvidence<'a> {
    reader: &'a CommittedFileReader,
}

impl<'a> PinnedCommitEvidence<'a> {
    /// Evidence of the commit `reader` pinned. The SAME reader the candidate digest is taken from, so
    /// the evidence and the authority's candidate cannot be two different commits.
    #[must_use]
    pub fn over(reader: &'a CommittedFileReader) -> Self {
        Self { reader }
    }

    fn entry(&self, change: &TreeChange) -> Result<EvidenceEntryInput, EvidenceUnavailable> {
        // AN UNSUPPORTED ENTRY REFUSES HERE, before any contents are read, on EITHER side: a path that
        // WAS a submodule is as undescribable as one that became one.
        for kind in [change.old_mode().kind(), change.new_mode().kind()] {
            if matches!(kind, EntryKind::Gitlink | EntryKind::Unsupported) {
                return Err(EvidenceUnavailable::Refused(
                    EvidenceRefusal::UnsupportedEntryKind,
                ));
            }
        }
        let new_contents = match change.new_mode().kind() {
            EntryKind::Absent => None,
            _ => Some(
                self.reader
                    .committed_bytes(change.path())
                    .map_err(|e| unavailable(&e))?,
            ),
        };
        // THE BYTES MUST BE THE OBJECT THE TREE NAMES (AppSec F1, premise proven live: `git cat-file`
        // returns a substituted loose object under the original id with exit 0 - it never re-hashes on
        // read). The evidence records `new_id` AND shows `new_contents`; without this check those are
        // two independent claims about an object store the implementer writes, and the reviewer could
        // be shown bytes that are not the candidate tree's true content while the attestation binds
        // them as if they were. Git's object id IS the hash of the bytes, so recomputing it here makes
        // the two claims one. Only 40-hex (SHA-1) ids are checkable and only those are ratified; any
        // other length already refused upstream.
        if let Some(bytes) = &new_contents {
            if git_blob_id_hex(bytes) != change.new_id().as_str() {
                return Err(EvidenceUnavailable::RepositoryRefused);
            }
        }
        Ok(EvidenceEntryInput {
            change: match change.kind() {
                ChangeKind::Added => EvidenceChange::Added,
                ChangeKind::Deleted => EvidenceChange::Deleted,
                ChangeKind::Modified => EvidenceChange::Modified,
                ChangeKind::TypeChanged => EvidenceChange::TypeChanged,
            },
            path: change.path().as_str().to_string(),
            old_mode: change.old_mode().octal(),
            new_mode: change.new_mode().octal(),
            old_id: change.old_id().as_str().to_string(),
            new_id: change.new_id().as_str().to_string(),
            new_contents,
        })
    }
}

/// The git object id of `bytes` as a blob: SHA-1 over `blob <len>\0` || bytes, lower hex.
///
/// SHA-1 here binds to GIT'S OWN identifier, which is SHA-1 by the ratified 40-hex contract; it is not
/// used as a collision-resistant primitive (an implementer who can collide SHA-1 can simply commit the
/// colliding bytes honestly - the reviewer then sees them).
fn git_blob_id_hex(bytes: &[u8]) -> String {
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(format!("blob {}\0", bytes.len()).as_bytes());
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(40);
    for b in digest {
        use std::fmt::Write as _;
        let _ = write!(out, "{b:02x}");
    }
    out
}

/// The three answers about the COMMITS keep their meaning; every other repository refusal is one
/// coarse reason, so a refusal never becomes an oracle about the repository's contents.
fn unavailable(error: &RepoAdapterError) -> EvidenceUnavailable {
    match error {
        RepoAdapterError::BaselineUnavailable => EvidenceUnavailable::BaselineUnavailable,
        RepoAdapterError::CandidateUnavailable => EvidenceUnavailable::CandidateUnavailable,
        RepoAdapterError::BaselineNotAncestor => EvidenceUnavailable::BaselineNotAncestor,
        _ => EvidenceUnavailable::RepositoryRefused,
    }
}

impl CandidateEvidencePort for PinnedCommitEvidence<'_> {
    fn candidate_evidence(&self, baseline: &str) -> Result<CandidateEvidence, EvidenceUnavailable> {
        let baseline_id =
            CommitId::parse(baseline).map_err(|_| EvidenceUnavailable::BaselineUnavailable)?;
        let changes = self
            .reader
            .changes_since(&baseline_id)
            .map_err(|e| unavailable(&e))?;
        let mut inputs = Vec::with_capacity(changes.len());
        for change in &changes {
            inputs.push(self.entry(change)?);
        }
        CandidateEvidence::assemble(baseline, self.reader.pinned_commit().as_str(), inputs)
            .map_err(EvidenceUnavailable::Refused)
    }

    /// 32 bytes from the system-preferred CSPRNG, drawn when asked - which the operation does only
    /// AFTER the evidence and the claim are fixed. `None` if the system source fails: no marker, no
    /// frame, no execution.
    fn boundary_marker(&self) -> Option<[u8; BOUNDARY_MARKER_LEN]> {
        let mut marker = [0u8; BOUNDARY_MARKER_LEN];
        system_preferred_fill(&mut marker).ok()?;
        Some(marker)
    }
}
