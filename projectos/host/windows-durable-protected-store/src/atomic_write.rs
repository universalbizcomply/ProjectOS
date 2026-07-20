//! The atomic, durable write/replace protocol for a single framed file.
//!
//! Ordering: create a fresh temp in the store's own `temp/` dir (same volume) → write the complete
//! framed content → flush file CONTENT (`sync_all` → `FlushFileBuffers`) → durable write-through
//! replace (`MoveFileExW` with `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH`, no copy fallback)
//! → best-effort containing-directory flush. Any failure BEFORE the replace leaves the prior target
//! intact (known-before-effect) and removes the temp; the write-through replace is atomic, so its
//! failure is also known-before-effect. Directory-entry durability is best-effort only (see
//! `windows_fs::flush_dir`).

use std::fs::File;
use std::io::Write;
use std::path::Path;

use crate::error::DurableStoreError;
use crate::windows_fs;

/// Atomically and durably write `bytes` to `final_path`, staging through `temp_path`.
///
/// # Errors
/// [`DurableStoreError::WriteRefusedBeforeEffect`] for any failure before/at the atomic replace;
/// [`DurableStoreError::UnsupportedPlatform`] off Windows.
pub(crate) fn atomic_write(
    temp_path: &Path,
    final_path: &Path,
    bytes: &[u8],
) -> Result<(), DurableStoreError> {
    write_staged(temp_path, bytes)?;
    if let Err(err) = windows_fs::durable_replace(temp_path, final_path) {
        let _ = std::fs::remove_file(temp_path);
        return Err(err);
    }
    if let Some(parent) = final_path.parent() {
        windows_fs::flush_dir(parent); // best-effort; no metadata-durability claim
    }
    Ok(())
}

fn write_staged(temp_path: &Path, bytes: &[u8]) -> Result<(), DurableStoreError> {
    let result = (|| {
        let mut file =
            File::create(temp_path).map_err(|_| DurableStoreError::WriteRefusedBeforeEffect)?;
        file.write_all(bytes)
            .map_err(|_| DurableStoreError::WriteRefusedBeforeEffect)?;
        file.sync_all()
            .map_err(|_| DurableStoreError::WriteRefusedBeforeEffect)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp_path);
    }
    result
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn clean_write_replaces_durably() {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("pos-durable-aw-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let temp = dir.join("stage.tmp");
        let final_path = dir.join("final.bin");
        std::fs::write(&final_path, b"old").unwrap();
        atomic_write(&temp, &final_path, b"new-content").unwrap();
        assert_eq!(std::fs::read(&final_path).unwrap(), b"new-content");
        assert!(!temp.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
