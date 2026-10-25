//! Assemble the packaged payload: the pinned runtime, and one closed daemon bundle.
//!
//! WHAT "PINNED" MEANS HERE. The packaging contract names a SHA-256. This step refuses to copy any
//! other bytes under the runtime's name. That refusal is the whole difference between a pin and a
//! comment: without it, `PACKAGED_NODE_VERSION` would be a label someone typed, and a payload could
//! carry a runtime nobody chose while the manifest cheerfully attested the expected version.
//!
//! WHY THE PAYLOAD ROOT MUST BE FRESH. The manifest describes exactly two files. Anything else left
//! lying in the payload travels into the installation unattested — present at runtime, covered by no
//! digest, named by no signature. Assembling into a directory that already has contents is therefore
//! refused rather than merged.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A.

use std::path::{Path, PathBuf};

use projectos_host_identity::sha256_hex;
use projectos_packaged_runtime_contract as contract;

/// Why a payload could not be assembled. Every variant means "these are not the bytes we package";
/// none is recoverable by relaxing a check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssembleError {
    /// The candidate runtime does not exist.
    RuntimeSourceMissing(PathBuf),
    /// The candidate runtime is the wrong size. Checked before hashing: a 91 MB digest is slow, and
    /// a length disagreement is a clearer diagnosis than a hash mismatch.
    RuntimeSizeMismatch { expected: u64, actual: u64 },
    /// The candidate runtime is not the pinned one. THIS is what makes the pin binding.
    RuntimeNotPinned { expected: String, actual: String },
    /// The daemon bundle does not exist.
    DaemonBundleMissing(PathBuf),
    /// The daemon "bundle" is a directory. A tree of loose modules cannot be a single bundle:
    /// hashing one file of it would attest to a fraction of what actually executes.
    DaemonBundleNotSingleFile(PathBuf),
    /// The payload root already has contents. Stale files would ship unattested.
    PayloadRootNotEmpty(PathBuf),
    /// A filesystem operation failed.
    Io(PathBuf),
}

/// A payload that exists on disk, with the digests of what was actually written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssembledPayload {
    pub root: PathBuf,
    pub runtime_path: PathBuf,
    pub daemon_path: PathBuf,
    /// Digest of the runtime as written. Equal to the contract pin by construction.
    pub runtime_sha256: String,
    /// Digest of the daemon bundle as written.
    pub daemon_sha256: String,
}

/// What the caller supplies: where the two real artefacts are, and where to build the payload.
///
/// Note what is absent. No runtime version, no architecture, no payload-relative paths, no hashes.
/// Those are the packaging contract's, and a caller that could set them could describe a payload
/// that is not the one on disk.
pub struct AssembleInputs<'a> {
    /// The candidate Node runtime to package. Its bytes must be the pinned ones.
    pub node_exe: &'a Path,
    /// The single daemon bundle, as produced by `npm run build:daemon-bundle`.
    pub daemon_bundle: &'a Path,
    /// The payload root to create. Must not already contain anything.
    pub payload_root: &'a Path,
}

/// True when the directory does not exist, or exists and is empty.
fn is_empty_dir(path: &Path) -> Result<bool, AssembleError> {
    if !path.exists() {
        return Ok(true);
    }
    let mut entries = std::fs::read_dir(path).map_err(|_| AssembleError::Io(path.to_path_buf()))?;
    Ok(entries.next().is_none())
}

/// Join a contract-declared relative path beneath the payload root.
///
/// The contract's own tests forbid absolute and traversing constants, so this cannot escape today.
/// It is still written as a checked join rather than a bare `join`, because the failure mode of a
/// future contract edit is writing 91 MB somewhere outside the payload.
fn bind(root: &Path, relative: &str) -> Result<PathBuf, AssembleError> {
    let rel = Path::new(relative);
    if rel.is_absolute() || relative.contains("..") || relative.is_empty() {
        return Err(AssembleError::Io(root.join(relative)));
    }
    Ok(root.join(rel))
}

/// Assemble a fresh payload from real artefacts, refusing anything that is not the pinned runtime.
pub fn assemble_payload(inputs: &AssembleInputs<'_>) -> Result<AssembledPayload, AssembleError> {
    // ---- the payload root must be fresh ---------------------------------------------------------
    if !is_empty_dir(inputs.payload_root)? {
        return Err(AssembleError::PayloadRootNotEmpty(
            inputs.payload_root.to_path_buf(),
        ));
    }

    // ---- the runtime: pinned, or refused --------------------------------------------------------
    if !inputs.node_exe.is_file() {
        return Err(AssembleError::RuntimeSourceMissing(
            inputs.node_exe.to_path_buf(),
        ));
    }
    let meta = std::fs::metadata(inputs.node_exe)
        .map_err(|_| AssembleError::Io(inputs.node_exe.to_path_buf()))?;
    if meta.len() != contract::PACKAGED_NODE_BYTES {
        return Err(AssembleError::RuntimeSizeMismatch {
            expected: contract::PACKAGED_NODE_BYTES,
            actual: meta.len(),
        });
    }
    let runtime_bytes = std::fs::read(inputs.node_exe)
        .map_err(|_| AssembleError::Io(inputs.node_exe.to_path_buf()))?;
    let runtime_sha256 = sha256_hex(&runtime_bytes);
    if runtime_sha256 != contract::PACKAGED_NODE_SHA256 {
        return Err(AssembleError::RuntimeNotPinned {
            expected: contract::PACKAGED_NODE_SHA256.to_string(),
            actual: runtime_sha256,
        });
    }

    // ---- the daemon: one file, or nothing -------------------------------------------------------
    if inputs.daemon_bundle.is_dir() {
        // Refused explicitly rather than by the file check below, so the reason is the real one.
        return Err(AssembleError::DaemonBundleNotSingleFile(
            inputs.daemon_bundle.to_path_buf(),
        ));
    }
    if !inputs.daemon_bundle.is_file() {
        return Err(AssembleError::DaemonBundleMissing(
            inputs.daemon_bundle.to_path_buf(),
        ));
    }
    let daemon_bytes = std::fs::read(inputs.daemon_bundle)
        .map_err(|_| AssembleError::Io(inputs.daemon_bundle.to_path_buf()))?;
    let daemon_sha256 = sha256_hex(&daemon_bytes);

    // ---- write the payload ----------------------------------------------------------------------
    let runtime_path = bind(inputs.payload_root, contract::RUNTIME_RELATIVE_PATH)?;
    let daemon_path = bind(inputs.payload_root, contract::DAEMON_RELATIVE_PATH)?;
    for p in [&runtime_path, &daemon_path] {
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir).map_err(|_| AssembleError::Io(dir.to_path_buf()))?;
        }
    }
    std::fs::write(&runtime_path, &runtime_bytes)
        .map_err(|_| AssembleError::Io(runtime_path.clone()))?;
    std::fs::write(&daemon_path, &daemon_bytes)
        .map_err(|_| AssembleError::Io(daemon_path.clone()))?;

    Ok(AssembledPayload {
        root: inputs.payload_root.to_path_buf(),
        runtime_path,
        daemon_path,
        runtime_sha256,
        daemon_sha256,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The contract paths must survive binding unchanged. If a future contract edit introduced
    /// traversal, this is where a 91 MB write outside the payload would be caught.
    #[test]
    fn contract_paths_bind_beneath_the_payload_root() {
        let root = Path::new(r"C:\payload");
        for rel in [
            contract::RUNTIME_RELATIVE_PATH,
            contract::DAEMON_RELATIVE_PATH,
        ] {
            let bound = bind(root, rel).expect("contract paths must bind");
            assert!(bound.starts_with(root), "{rel} escaped the payload root");
        }
    }

    #[test]
    fn traversing_and_absolute_relatives_are_refused() {
        let root = Path::new(r"C:\payload");
        for bad in [
            "../outside.exe",
            "runtime/../../outside.exe",
            "",
            r"C:\abs.exe",
        ] {
            assert!(bind(root, bad).is_err(), "{bad} must not bind");
        }
    }
}
