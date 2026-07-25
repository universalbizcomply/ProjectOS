//! The repository adapter: run the allowlisted read-only Git observation commands under a canonical
//! root, USING ONE VERIFIED ABSOLUTE GIT EXECUTABLE (never an uncontrolled PATH search), parse them
//! structurally, and build an UNTRUSTED [`GitRepositoryObservation`]. It mints NO authority —
//! `projectos_host_core::verify_repository_baseline` is the sole authority origin.

use std::path::Path;

use projectos_host_core::GitRepositoryObservation;

use crate::command::{GitCommand, GitOut, GitRunner};
use crate::config::RepositoryAdapterConfig;
use crate::error::RepoAdapterError;
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
