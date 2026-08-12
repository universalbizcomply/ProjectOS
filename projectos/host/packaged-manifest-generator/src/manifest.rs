//! Generate the UNSIGNED trust manifest from an assembled payload.
//!
//! WHAT A CALLER MAY SAY. Only what the build is CALLED: application id, application version, build
//! id, signing key id, and the generation timestamp. That is the whole input surface.
//!
//! WHAT A CALLER MAY NOT SAY, and cannot express because there is no field for it: either digest,
//! the runtime version, the platform, the architecture, or where the runtime and daemon sit inside
//! the payload. Digests are computed from the bytes on disk; the rest is the packaging contract's.
//! A manifest whose security-critical values were typed in by whoever wanted it accepted would
//! attest to nothing at all.
//!
//! THE RUNTIME IS CHECKED AGAIN HERE. The assembler already refuses an unpinned runtime, and this
//! refuses to describe one. The duplication is deliberate: generation must be safe against a payload
//! that some other route produced, and a contract that only one code path enforces is a contract
//! that holds until someone adds a second code path.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A.

use std::path::{Path, PathBuf};

use projectos_host_identity::{
    canonical_bytes, sha256_hex, DaemonArtefactFormat, DaemonArtefactManifest, InstallationModel,
    RuntimeManifest, TrustManifest,
};
use projectos_packaged_runtime_contract as contract;

/// Schema constants this generator emits. They match what the verifier accepts; a mismatch would
/// produce manifests the application refuses, which the round-trip proof catches immediately.
const SCHEMA_VERSION: u32 = 1;
const MANIFEST_VERSION: u32 = 1;
const MINIMUM_PROTOCOL_VERSION: u32 = 1;
/// The one supported signature algorithm. Fixed by the application, never chosen by a manifest.
pub const SIGNATURE_ALGORITHM: &str = "es256";

/// What the BUILD knows and the payload cannot tell us: identifiers, and nothing else.
pub struct ManifestInputs<'a> {
    /// The assembled payload root. Both artefact paths are bound beneath it, from the contract.
    pub payload_root: &'a Path,
    pub application_id: &'a str,
    pub application_version: &'a str,
    pub build_id: &'a str,
    /// Identifier for the signing key that will later sign this. An identifier is not key material.
    pub signing_key_id: &'a str,
    /// Generation timestamp, supplied so the caller controls determinism and so this crate takes no
    /// clock. Must already be a fixed-format UTC instant.
    pub generated_at: &'a str,
}

/// Why a manifest could not be generated. Every variant means "the payload is not what it claims";
/// none of them is recoverable by writing a value into the manifest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GeneratorError {
    /// A contract path was absolute or traversing. Only reachable via a bad contract edit.
    PathOutsidePayload(String),
    /// The pinned runtime is not present in the payload.
    RuntimeMissing(PathBuf),
    /// The runtime in the payload is not the pinned one, so it must not be described as such.
    RuntimeNotPinned { expected: String, actual: String },
    /// The daemon artefact is not present in the payload.
    DaemonArtefactMissing(PathBuf),
    /// The daemon artefact is a DIRECTORY. A tree of loose modules cannot be a `SingleBundle`:
    /// hashing one file of it would attest to a fraction of what actually executes.
    DaemonArtefactNotSingleFile(PathBuf),
    /// A required identifier was blank. A manifest with an empty application id binds nothing, and
    /// would compare equal to any other build that also left it blank.
    RequiredFieldEmpty(&'static str),
    /// A file existed but could not be read, or the manifest could not be serialised.
    Unreadable(PathBuf),
}

/// The generated artefacts: the manifest itself, and exactly the bytes an owner key will sign.
pub struct GeneratedManifest {
    pub manifest: TrustManifest,
    /// Pretty-printed manifest JSON, for writing into the payload.
    pub manifest_json: String,
    /// THE bytes to sign. Produced by the verifier's own canonicalisation.
    pub canonical_signing_bytes: Vec<u8>,
}

/// Bind a contract-declared relative path beneath the payload root, refusing absolute and traversal.
///
/// The same rule the verifier applies when it resolves these paths at run time — if the generator
/// were laxer, it would happily describe a payload the verifier then refuses.
fn bind(root: &Path, relative: &str) -> Result<PathBuf, GeneratorError> {
    let rel = Path::new(relative);
    if rel.is_absolute() || relative.contains("..") || relative.is_empty() {
        return Err(GeneratorError::PathOutsidePayload(relative.to_string()));
    }
    Ok(root.join(rel))
}

/// Read one payload artefact, refusing a directory explicitly so the diagnosis is the real one.
fn read_artefact(
    path: PathBuf,
    missing: fn(PathBuf) -> GeneratorError,
    not_single: Option<fn(PathBuf) -> GeneratorError>,
) -> Result<Vec<u8>, GeneratorError> {
    if let Some(not_single) = not_single {
        if path.is_dir() {
            return Err(not_single(path));
        }
    }
    if !path.is_file() {
        return Err(missing(path));
    }
    std::fs::read(&path).map_err(|_| GeneratorError::Unreadable(path))
}

/// Generate the unsigned manifest from an assembled payload.
///
/// Reads the real runtime and daemon bytes, hashes them, and emits a manifest whose signature is
/// deliberately empty.
pub fn generate_unsigned_manifest(
    inputs: &ManifestInputs<'_>,
) -> Result<GeneratedManifest, GeneratorError> {
    for (name, value) in [
        ("applicationId", inputs.application_id),
        ("applicationVersion", inputs.application_version),
        ("buildId", inputs.build_id),
        ("signingKeyId", inputs.signing_key_id),
        ("generatedAt", inputs.generated_at),
    ] {
        if value.trim().is_empty() {
            return Err(GeneratorError::RequiredFieldEmpty(match name {
                "applicationId" => "applicationId",
                "applicationVersion" => "applicationVersion",
                "buildId" => "buildId",
                "signingKeyId" => "signingKeyId",
                _ => "generatedAt",
            }));
        }
    }

    // ---- the pinned runtime, hashed from the bytes actually shipped -----------------------------
    let runtime_bytes = read_artefact(
        bind(inputs.payload_root, contract::RUNTIME_RELATIVE_PATH)?,
        GeneratorError::RuntimeMissing,
        None,
    )?;
    let runtime_sha256 = sha256_hex(&runtime_bytes);
    if runtime_sha256 != contract::PACKAGED_NODE_SHA256 {
        return Err(GeneratorError::RuntimeNotPinned {
            expected: contract::PACKAGED_NODE_SHA256.to_string(),
            actual: runtime_sha256,
        });
    }

    // ---- the daemon artefact: one file, or nothing ----------------------------------------------
    let daemon_bytes = read_artefact(
        bind(inputs.payload_root, contract::DAEMON_RELATIVE_PATH)?,
        GeneratorError::DaemonArtefactMissing,
        Some(GeneratorError::DaemonArtefactNotSingleFile),
    )?;

    let manifest = TrustManifest {
        schema_version: SCHEMA_VERSION,
        manifest_version: MANIFEST_VERSION,
        application_id: inputs.application_id.to_string(),
        application_version: inputs.application_version.to_string(),
        build_id: inputs.build_id.to_string(),
        // DECLARED, not evidenced. Whether this installation really is per-machine is a runtime
        // observation the application makes for itself; the manifest is not its own witness, and it
        // carries nothing that pretends to corroborate this.
        installation_model: InstallationModel::PerMachine,
        runtime: RuntimeManifest {
            relative_path: contract::RUNTIME_RELATIVE_PATH.to_string(),
            sha256: runtime_sha256,
            expected_version: contract::PACKAGED_NODE_VERSION.to_string(),
            platform: contract::PACKAGED_PLATFORM.to_string(),
            architecture: contract::PACKAGED_ARCHITECTURE.to_string(),
        },
        daemon_artefact: DaemonArtefactManifest {
            relative_path: contract::DAEMON_RELATIVE_PATH.to_string(),
            sha256: sha256_hex(&daemon_bytes),
            // The only production-eligible shape, and it was checked to be one file above.
            format: DaemonArtefactFormat::SingleBundle,
            build_id: inputs.build_id.to_string(),
        },
        generated_at: inputs.generated_at.to_string(),
        minimum_protocol_version: MINIMUM_PROTOCOL_VERSION,
        signature_algorithm: SIGNATURE_ALGORITHM.to_string(),
        signing_key_id: inputs.signing_key_id.to_string(),
        // UNSIGNED. Never a placeholder that could be mistaken for a signature.
        signature: String::new(),
    };

    let canonical_signing_bytes = canonical_bytes(&manifest);
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|_| GeneratorError::Unreadable(inputs.payload_root.to_path_buf()))?;

    Ok(GeneratedManifest {
        manifest,
        manifest_json,
        canonical_signing_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The contract's payload paths must bind beneath the root. This is the unit-level guard on the
    /// join; the behavioural proofs live in `tests/`.
    #[test]
    fn contract_paths_bind_and_traversal_does_not() {
        let root = Path::new(r"C:\payload");
        for rel in [
            contract::RUNTIME_RELATIVE_PATH,
            contract::DAEMON_RELATIVE_PATH,
        ] {
            assert!(bind(root, rel).unwrap().starts_with(root));
        }
        for bad in [
            "../outside.exe",
            "runtime/../../outside.exe",
            "",
            r"C:\abs.exe",
        ] {
            assert!(
                matches!(bind(root, bad), Err(GeneratorError::PathOutsidePayload(_))),
                "{bad} must be refused"
            );
        }
    }
}
