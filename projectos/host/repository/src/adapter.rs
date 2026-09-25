//! The repository adapter: run the allowlisted read-only Git observation commands under a canonical
//! root, USING ONE VERIFIED ABSOLUTE GIT EXECUTABLE (never an uncontrolled PATH search), parse them
//! structurally, and build an UNTRUSTED [`GitRepositoryObservation`]. It mints NO authority —
//! `projectos_host_core::verify_repository_baseline` is the sole authority origin.

use std::path::{Path, PathBuf};

use projectos_host_core::GitRepositoryObservation;

use crate::command::{CommitId, CommittedPath, CommittedRevision, GitCommand, GitOut, GitRunner};
use crate::config::RepositoryAdapterConfig;
use crate::error::RepoAdapterError;
use crate::tree_diff::{self, TreeChange};
use crate::{parse, path};

/// A contained, read-only local repository adapter bound to one verified Git executable + root.
#[derive(Debug, Clone)]
pub struct RepositoryAdapter {
    runner: GitRunner,
    root: String,
}

impl RepositoryAdapter {
    /// Build a production adapter from a verified configuration (absolute canonical Git executable +
    /// configured root). Production observation runs THIS exact executable — never a PATH lookup.
    #[must_use]
    pub fn new(config: RepositoryAdapterConfig) -> Self {
        Self {
            runner: GitRunner::with_exe(config.git_exe().to_string_lossy().into_owned()),
            root: config.root().to_string(),
        }
    }

    /// TEST-ONLY: an adapter over an explicit (possibly fake) Git executable + root, bypassing executable
    /// verification. Feature/test gated so a live graph cannot reach it.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn for_fixture(git_exe: &str, root: &str) -> Self {
        Self {
            runner: GitRunner::with_exe(git_exe),
            root: root.to_string(),
        }
    }

    /// TEST-ONLY: an adapter over an explicit runner (e.g. a short-timeout fixture) + root.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn for_fixture_with_runner(runner: GitRunner, root: &str) -> Self {
        Self {
            runner,
            root: root.to_string(),
        }
    }

    fn run(&self, root: &Path, cmd: &GitCommand) -> Result<GitOut, RepoAdapterError> {
        self.runner.run(root, cmd)
    }

    /// Observe the configured repository, returning an untrusted observation stamped with `generation`.
    /// Runs ONLY the allowlisted read-only commands; performs NO network fetch.
    ///
    /// # Errors
    /// [`RepoAdapterError`] for a path/root/worktree/command/parse failure.
    pub fn observe(&self, generation: u64) -> Result<GitRepositoryObservation, RepoAdapterError> {
        let canon = path::verify_root(&self.root)?;

        let iwt = self.run(&canon, &GitCommand::IsInsideWorkTree)?;
        if iwt.code != Some(0) || !parse::work_tree_flag(&iwt.stdout)? {
            return Err(RepoAdapterError::NotWorkTree);
        }
        let top = self.run(&canon, &GitCommand::ShowToplevel)?;
        if top.code != Some(0) {
            return Err(RepoAdapterError::NotWorkTree);
        }
        path::same_canonical(&parse::single_line(&top.stdout)?, &canon)?;
        let cdir = self.run(&canon, &GitCommand::GitCommonDir)?;
        if cdir.code != Some(0) {
            return Err(RepoAdapterError::MalformedOutput);
        }
        let common_dir = parse::single_line(&cdir.stdout)?;
        let head = self.run(&canon, &GitCommand::RevParseHead)?;
        if head.code != Some(0) {
            return Err(RepoAdapterError::MalformedOutput);
        }
        let head_oid = parse::oid(&head.stdout)?;
        let sref = self.run(&canon, &GitCommand::SymbolicRefHead)?;
        let branch = match sref.code {
            Some(0) => Some(parse::single_line(&sref.stdout)?),
            _ => None,
        };
        let st = self.run(&canon, &GitCommand::StatusPorcelain)?;
        if st.code != Some(0) {
            return Err(RepoAdapterError::MalformedOutput);
        }
        let sum = parse::porcelain(&st.stdout)?;
        let (tracking_present, ahead, behind) = if sum.upstream_present {
            let local = branch.clone().unwrap_or_else(|| "HEAD".to_string());
            let rl = self.run(
                &canon,
                &GitCommand::RevListCount {
                    local,
                    tracking: "@{upstream}".to_string(),
                },
            )?;
            if rl.code != Some(0) {
                return Err(RepoAdapterError::MalformedOutput);
            }
            let (a, b) = parse::ahead_behind(&rl.stdout)?;
            (true, Some(a), Some(b))
        } else {
            (false, None, None)
        };
        let sm = self.run(&canon, &GitCommand::SubmoduleStatus)?;
        let submodule_dirty = match sm.code {
            Some(0) => parse::submodule_dirty(&sm.stdout)?,
            _ => false,
        };
        let wt = self.run(&canon, &GitCommand::WorktreeList)?;
        if wt.code == Some(0) {
            let _ = parse::worktree_count(&wt.stdout)?;
        }

        Ok(GitRepositoryObservation {
            canonical_root: canon.to_string_lossy().into_owned(),
            common_dir,
            is_worktree: true,
            head_oid,
            branch,
            staged: sum.staged,
            unstaged: sum.unstaged,
            untracked: sum.untracked,
            tracking_present,
            ahead,
            behind,
            submodule_dirty,
            generation,
        })
    }
}

/// Read the COMMITTED bytes of contract-fixed repository paths — never the working tree.
///
/// ## Why this exists
///
/// The owner-signed execution closure attests what was COMMITTED. Until now the host had no way to
/// obtain those bytes: the allowlist held nine observation commands and not one of them could return
/// an object's content, so the closure could be verified only against bytes somebody else had read.
/// A working-tree read would have been the easy substitute and it would have been wrong in exactly
/// the case the closure exists for — an edited-but-uncommitted broker would have verified against
/// its own edit.
///
/// ## What makes the answer the committed answer
///
/// `cat-file` answers from the object store. It consults no index and applies no clean/smudge filter
/// or textconv, so nothing a caller can write to the working tree changes what comes back.
///
/// ## Two things a writer must not be able to move under the reader
///
/// WHICH COMMIT. `HEAD` is a pointer, and moving it needs no commit of the owner's —
/// `git checkout`, `git reset` or a write to `.git/HEAD` will do. A reader that carried the token
/// `HEAD` into every command would re-resolve it each time, so an attacker could change the commit
/// between one artefact's read and the next while every answer still honestly said "this is what is
/// committed". [`CommittedFileReader::open`] therefore RESOLVES the revision to one exact commit id
/// once, and only that id reaches a command line.
///
/// WHICH REPOSITORY. The root is re-proven on EVERY read — canonicalized, confirmed inside a work
/// tree, and confirmed to BE that work tree's top level — exactly as [`RepositoryAdapter::observe`]
/// does. Proving it only at open would leave a window in which the directory at that path is
/// replaced (a junction retargeted, a directory swapped) and later reads are answered from another
/// object store.
///
/// THE RESIDUAL WINDOW, NAMED RATHER THAN CLAIMED AWAY. Each step is its own process spawn, so a
/// swap can still land between the last proof and the read itself. That is inherent to running Git
/// as a child process and is the same shape of window [`RepositoryAdapter::observe`] already has
/// between its own sequential commands. The pinned commit is what narrows it: a substituted
/// repository would have to contain that exact commit for the read to answer at all.
///
/// ## What it still cannot do
///
/// No mutation, no network, no shell, no caller-supplied option, no arbitrary path and no arbitrary
/// revision — the same closed model as [`RepositoryAdapter`], and the reader adds exactly one
/// read-only verb to it.
#[derive(Clone)]
pub struct CommittedFileReader {
    runner: GitRunner,
    configured_root: String,
    commit: CommitId,
}

impl std::fmt::Debug for CommittedFileReader {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never render the root or the resolved Git executable, matching
        // `RepositoryAdapterConfig`'s rule that neither appears in Debug or in an error.
        f.write_str("CommittedFileReader([REDACTED])")
    }
}

impl CommittedFileReader {
    /// Open a reader over a verified configuration, pinning ONE commit.
    ///
    /// [`CommittedRevision::Head`] is resolved here and nowhere else, so the reader that comes back
    /// is bound to the commit `HEAD` named at this moment and is unaffected by any later move.
    ///
    /// # Errors
    /// [`RepoAdapterError`] for an invalid or non-canonical root, a root that is not a work tree or
    /// not its top level, a Git command that could not be launched, or a malformed `HEAD`.
    pub fn open(
        config: &RepositoryAdapterConfig,
        revision: CommittedRevision,
    ) -> Result<Self, RepoAdapterError> {
        let runner = GitRunner::with_exe(config.git_exe().to_string_lossy().into_owned());
        let root = prove_top_level(&runner, config.root())?;

        let commit = match revision {
            CommittedRevision::Commit(id) => id,
            CommittedRevision::Head => {
                let head = runner.run(&root, &GitCommand::RevParseHead)?;
                if head.code != Some(0) {
                    return Err(RepoAdapterError::MalformedOutput);
                }
                CommitId::parse(&parse::oid(&head.stdout)?)?
            }
        };

        Ok(Self {
            runner,
            configured_root: config.root().to_string(),
            commit,
        })
    }

    /// The exact commit every read answers from. Resolved once, at open.
    #[must_use]
    pub fn pinned_commit(&self) -> &CommitId {
        &self.commit
    }

    /// The committed bytes at one validated repository-relative path.
    ///
    /// THE ROOT IS RE-PROVEN FIRST, on every call, so a directory substituted after the reader was
    /// opened is refused rather than silently answered from.
    ///
    /// A NON-ZERO EXIT IS A REFUSAL, NEVER AN EMPTY FILE. `cat-file` exits non-zero when the object
    /// does not exist, when the path is not in that commit's tree, and when the entry is not a blob;
    /// returning `Ok(vec![])` for any of those would let "there is nothing committed there" reach a
    /// digest comparison as content.
    ///
    /// # Errors
    /// [`RepoAdapterError::NotWorkTree`] / [`RepoAdapterError::RootMismatch`] if the root no longer
    /// proves out; [`RepoAdapterError::CommittedObjectUnavailable`] if nothing is committed there;
    /// [`RepoAdapterError::OutputOverflow`] if the object exceeds the bounded read;
    /// [`RepoAdapterError`] for a launch failure or timeout.
    pub fn committed_bytes(&self, path: &CommittedPath) -> Result<Vec<u8>, RepoAdapterError> {
        let root = prove_top_level(&self.runner, &self.configured_root)?;
        let out = self.runner.run(
            &root,
            &GitCommand::CatFileBlob {
                commit: self.commit.clone(),
                path: path.clone(),
            },
        )?;
        if out.code != Some(0) {
            return Err(RepoAdapterError::CommittedObjectUnavailable);
        }
        Ok(out.stdout)
    }

    /// The COMPLETE changed-path set between `baseline` and the pinned candidate commit.
    ///
    /// PROJECTOS-HOST-REVIEW-PATH1B. The candidate is never a parameter: it is the commit this
    /// reader pinned once, at open. The baseline is an exact [`CommitId`] — where it comes from is
    /// the caller's authority question, and this reader mints none.
    ///
    /// THREE REFUSALS BEFORE ANY DIFFERENCE IS TAKEN, each its own error: the baseline is not a
    /// commit here, the candidate is not a commit here, the baseline is not an ancestor of the
    /// candidate. Without the third, the difference between two unrelated trees would be offered
    /// for review as though it were a change to what the owner approved.
    ///
    /// A NON-ZERO EXIT IS A REFUSAL, NEVER AN EMPTY DIFFERENCE — "nothing changed" and "Git could
    /// not answer" must not be the same value.
    ///
    /// # Errors
    /// [`RepoAdapterError::BaselineUnavailable`], [`RepoAdapterError::CandidateUnavailable`],
    /// [`RepoAdapterError::BaselineNotAncestor`]; the root refusals of
    /// [`CommittedFileReader::committed_bytes`]; [`RepoAdapterError::UnexpectedExit`] if the
    /// difference itself fails; and every refusal of [`tree_diff::parse_raw_z`].
    pub fn changes_since(&self, baseline: &CommitId) -> Result<Vec<TreeChange>, RepoAdapterError> {
        let root = prove_top_level(&self.runner, &self.configured_root)?;
        if !self.is_ancestor(&root, baseline, baseline)? {
            return Err(RepoAdapterError::BaselineUnavailable);
        }
        if !self.is_ancestor(&root, &self.commit, &self.commit)? {
            return Err(RepoAdapterError::CandidateUnavailable);
        }
        if !self.is_ancestor(&root, baseline, &self.commit)? {
            return Err(RepoAdapterError::BaselineNotAncestor);
        }
        let out = self.runner.run(
            &root,
            &GitCommand::DiffTreeEndpoints {
                base: baseline.clone(),
                candidate: self.commit.clone(),
            },
        )?;
        if out.code != Some(0) {
            return Err(RepoAdapterError::UnexpectedExit);
        }
        tree_diff::parse_raw_z(&out.stdout)
    }

    /// One ancestry question. Exit 0 is yes and exit 1 is no; ANY other exit — an absent operand, an
    /// operand that is not a commit, a killed process — is `Ok(false)` for the two existence
    /// questions and therefore a refusal there, and is never `Ok(true)` anywhere.
    fn is_ancestor(
        &self,
        root: &Path,
        ancestor: &CommitId,
        descendant: &CommitId,
    ) -> Result<bool, RepoAdapterError> {
        let out = self.runner.run(
            root,
            &GitCommand::IsAncestor {
                ancestor: ancestor.clone(),
                descendant: descendant.clone(),
            },
        )?;
        Ok(out.code == Some(0))
    }
}

/// Canonicalize a configured root and prove it IS a Git work tree's top level.
///
/// A configured root that merely sits somewhere beneath another repository is refused, so no read
/// can be answered out of a parent's object store.
fn prove_top_level(runner: &GitRunner, configured_root: &str) -> Result<PathBuf, RepoAdapterError> {
    let root = path::verify_root(configured_root)?;
    let iwt = runner.run(&root, &GitCommand::IsInsideWorkTree)?;
    if iwt.code != Some(0) || !parse::work_tree_flag(&iwt.stdout)? {
        return Err(RepoAdapterError::NotWorkTree);
    }
    let top = runner.run(&root, &GitCommand::ShowToplevel)?;
    if top.code != Some(0) {
        return Err(RepoAdapterError::NotWorkTree);
    }
    path::same_canonical(&parse::single_line(&top.stdout)?, &root)?;
    Ok(root)
}
