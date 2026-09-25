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
