//! The canonical ledger lock — the same file, taken the same way, released the same way.
//!
//! ## Why the lock is a file and not something better
//!
//! Because it is not this crate's lock. `.projectops/gatekeeper-ledger.lock` is the canonical
//! mutual-exclusion primitive already in force between ProjectOS agent processes, created with
//! Node's `writeFileSync(..., { flag: 'wx' })` — `O_EXCL` / `CREATE_NEW`, where the exclusivity is
//! the filesystem's rather than the program's. A Host that took a different lock — an OS byte-range
//! lock, a named mutex, a lock on a different path — would be excluding a set of processes that
//! does not include the agent, which is the same as not locking at all.
//!
//! ## Held is a refusal, never a wait
//!
//! Nothing here blocks, retries or steals. A held lock means another process is deciding spend right
//! now, so this request is refused and the caller is told so; waiting would give a caller a way to
//! hold the Host's admission path open, and stealing would defeat the exclusion outright.
//!
//! ## A lock that will not release leaves evidence
//!
//! `removeFile` is checked rather than assumed, because a handle held open elsewhere — an indexer,
//! on Windows, which the canonical implementation's own notes call an everyday occurrence — leaves
//! the file behind while reporting no error. When that happens a `<lock>.leaked` marker is written,
//! exactly as the canonical implementation does, so an operator meeting a permanently refusing
//! admission path finds out why.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::refusal::LedgerRefusal;

/// The suffix of the marker left behind when a lock cannot be released.
const LEAKED_SUFFIX: &str = ".leaked";

/// An acquired canonical ledger lock. Released when dropped.
///
/// NOT `Clone`, and it releases in `Drop` rather than in a method, so a `?` in the middle of a
/// transaction cannot leave the lock held. Every early return in this crate's transaction body ends
/// with the lock released.
#[derive(Debug)]
pub struct LedgerLock {
    path: PathBuf,
    released: bool,
}

impl LedgerLock {
    /// Take the canonical lock, or refuse.
    ///
    /// The two failure modes are distinguished because they need different answers from an operator:
    /// a lock that EXISTS is held by someone (transient, clears itself), and a lock that could not
    /// be created although nothing is there means the directory cannot be written at all.
    ///
    /// # Errors
    /// [`LedgerRefusal::LockHeld`] or [`LedgerRefusal::LockUnavailable`].
    pub fn take(path: &Path, held_since: &str) -> Result<Self, LedgerRefusal> {
        match OpenOptions::new().write(true).create_new(true).open(path) {
            Ok(mut file) => {
                // The canonical content, so an operator inspecting a stuck lock sees what they
                // expect. A write that fails after the file exists still leaves the lock TAKEN,
                // which is the safe direction: the guard below releases it.
                let body = format!("{{\"heldSince\":\"{held_since}\"}}\n");
                let written = file
                    .write_all(body.as_bytes())
                    .and_then(|()| file.sync_all());
                let lock = Self {
                    path: path.to_path_buf(),
                    released: false,
                };
                if written.is_err() {
                    drop(lock);
                    return Err(LedgerRefusal::LockUnavailable);
                }
                Ok(lock)
            }
            Err(_) if path.exists() => Err(LedgerRefusal::LockHeld),
            Err(_) => Err(LedgerRefusal::LockUnavailable),
        }
    }
}

impl Drop for LedgerLock {
    fn drop(&mut self) {
        if self.released {
            return;
        }
        self.released = true;
        let _ = fs::remove_file(&self.path);
        if self.path.exists() {
            // SILENTLY TREATING THIS AS RELEASED WOULD MAKE EVERY LATER ADMISSION REFUSE WITH NO
            // EXPLANATION. The marker is the explanation. Its own failure is ignored, because there
            // is nothing further to do about a filesystem that will neither delete nor create.
            // CREATE-NEW, NOT WRITE — THIS WAS THE LAST LINK-FOLLOWING WRITE IN THE CRATE.
            //
            // `fs::write` is create-or-truncate and FOLLOWS whatever is at the name, exactly like the
            // `File::create` the pending-ledger write used to use. So anything able to write inside
            // `.projectops` could hard-link this marker's name onto a file of its choosing — the
            // canonical ledger itself being the interesting choice — and wait for a lock that would
            // not delete, which this crate's own notes call an everyday Windows occurrence. The Host
            // would then write this sentence into the ledger, and while the Host itself refuses an
            // unparseable ledger, the AGENT reads one as empty: an open budget, which is the outcome
            // the whole module exists to prevent. Reached through a write target rather than through
            // the ledger path, which is why the earlier fix did not cover it.
            //
            // Removing the name first destroys a planted link rather than following it, and
            // `create_new` refuses anything that exists — so a marker already there is LEFT ALONE,
            // which is also the better behaviour: the first leak is the one worth reporting. Raised
            // by the ECC security re-review.
            let mut leaked = self.path.clone().into_os_string();
            leaked.push(LEAKED_SUFFIX);
            let leaked = PathBuf::from(leaked);
            if fs::symlink_metadata(&leaked).is_err() {
                let _ = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&leaked)
                    .and_then(|mut file| {
                        file.write_all(b"the gatekeeper ledger lock could not be released\n")
                    });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "projectos-ledger-lock-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn a_second_taker_is_refused_rather_than_made_to_wait() {
        let dir = scratch();
        let path = dir.join("one.lock");
        let _ = fs::remove_file(&path);
        let first = LedgerLock::take(&path, "2026-09-08T00:00:00Z").expect("first");
        assert_eq!(
            LedgerLock::take(&path, "2026-09-08T00:00:01Z").unwrap_err(),
            LedgerRefusal::LockHeld
        );
        drop(first);
        // Released, so the next taker succeeds.
        let third = LedgerLock::take(&path, "2026-09-08T00:00:02Z").expect("third");
        drop(third);
        assert!(!path.exists());
    }

    #[test]
    fn the_lock_carries_the_canonical_content() {
        let dir = scratch();
        let path = dir.join("two.lock");
        let _ = fs::remove_file(&path);
        let held = LedgerLock::take(&path, "2026-09-08T12:00:00Z").expect("taken");
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "{\"heldSince\":\"2026-09-08T12:00:00Z\"}\n"
        );
        drop(held);
    }

    #[test]
    fn a_lock_in_a_directory_that_does_not_exist_is_unavailable_not_held() {
        let path = scratch().join("no-such-directory").join("three.lock");
        assert_eq!(
            LedgerLock::take(&path, "2026-09-08T00:00:00Z").unwrap_err(),
            LedgerRefusal::LockUnavailable
        );
    }

    /// (C2) THE LEAK MARKER IS NEVER WRITTEN THROUGH A PLANTED LINK.
    ///
    /// The marker path is only reached when the lock will not delete, and that is forced here rather
    /// than waited for: a second open handle without share-delete makes `remove_file` fail on
    /// Windows, which is precisely the everyday case the marker exists for.
    #[cfg(windows)]
    #[test]
    fn the_leak_marker_is_not_written_through_a_planted_link() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = scratch();
        let path = dir.join("five.lock");
        let leaked = dir.join("five.lock.leaked");
        let victim = dir.join("five-victim.txt");
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(&leaked);
        fs::write(&victim, "a file the Host has no business writing\n").unwrap();
        if fs::hard_link(&victim, &leaked).is_err() {
            println!("SKIPPED: this filesystem refused to create a hard link");
            return;
        }

        let held = LedgerLock::take(&path, "2026-09-08T00:00:00Z").expect("taken");
        // A HANDLE THAT REALLY BLOCKS DELETION.
        //
        // `File::open` does NOT block it: Rust opens with FILE_SHARE_DELETE, so the lock was removed
        // anyway and the marker branch never ran — the first version of this test passed for exactly
        // that wrong reason, and the `path.exists()` assertion below is what exposed it. Opening with
        // a share mode of FILE_SHARE_READ alone is what an indexer or scanner holding the file looks
        // like, which is the everyday case the marker exists for.
        const FILE_SHARE_READ: u32 = 0x0000_0001;
        let blocker = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&path)
            .expect("second handle");
        drop(held);

        // THE BRANCH REALLY RAN, and this assertion is what stops the test passing for the wrong
        // reason. If the blocking handle had not prevented deletion, the lock would be gone, the
        // marker branch would never execute, and the victim would be untouched for a reason that has
        // nothing to do with the fix under test. Same class as the vacuous checks that once passed
        // while matching nothing.
        assert!(
            path.exists(),
            "the second handle did not block deletion, so the marker path was never reached"
        );

        assert_eq!(
            fs::read_to_string(&victim).unwrap(),
            "a file the Host has no business writing\n",
            "the leak marker was written through a planted hard link"
        );
        drop(blocker);
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(&leaked);
        let _ = fs::remove_file(&victim);
    }

    #[test]
    fn a_panic_inside_the_transaction_still_releases_the_lock() {
        let dir = scratch();
        let path = dir.join("four.lock");
        let _ = fs::remove_file(&path);
        let taken = path.clone();
        let panicked = std::panic::catch_unwind(move || {
            let _held = LedgerLock::take(&taken, "2026-09-08T00:00:00Z").expect("taken");
            panic!("the transaction body failed");
        });
        assert!(panicked.is_err());
        assert!(!path.exists(), "the lock outlived the panic");
    }
}
