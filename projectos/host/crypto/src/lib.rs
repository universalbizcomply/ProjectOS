//! # ProjectOS Host Crypto (key-hierarchy & encryption ADAPTER CONTRACTS)
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3H.
//!
//! Service-private CONTRACTS for the accepted three-level key hierarchy (service master key →
//! project DEK → credential material) plus a canonical associated-data builder, algorithm/version
//! policy, opaque key handles, rotation/rewrapping result contracts, zeroisation-aware
//! non-serializable secret types, and a validated projection into the accepted
//! `CredentialEnvelopeDto`.
//!
//! ## What this crate does NOT do
//!
//! It performs **no real cryptography**: no key generation, no OS randomness, no AES-GCM, no DPAPI /
//! CNG / NCrypt / TPM / Credential Manager / certificate store, no Windows API, no filesystem, no
//! ProgramData/LocalAppData/registry access, no service, no IPC, no provider execution, and no real
//! credential access. A deterministic **synthetic adapter** exists ONLY under `#[cfg(test)]`; it makes
//! no confidentiality or integrity claim and cannot exist in a non-test build.
//!
//! ## What this crate does NOT prove
//!
//! No confidentiality, no integrity, no encryption-at-rest, and no Windows key protection. Handle
//! privacy is API-level construction control, not cryptographic non-forgeability. Zeroisation clears
//! only THIS crate's owned buffers — it cannot remove prior allocator copies, OS paging, crash dumps,
//! debugger capture, or copies made outside this crate. A key handle is capability-local to the crypto
//! adapter; it is NOT ProjectOS operation authority, and a successful decryption does NOT authorise
//! using the credential.
//!
//! ## Sealed API (compile-fail evidence)
//!
//! An external caller cannot obtain a public `&[u8]` view of plaintext:
//! ```compile_fail
//! let p = projectos_host_crypto::PlaintextCredential::from_bytes(vec![1u8, 2, 3]).unwrap();
//! let _bytes: &[u8] = p.expose(); // no such public method
//! ```
//! An external caller cannot fabricate a successful encrypted result (constructor is crate-private):
//! ```compile_fail
//! use projectos_host_crypto::{EncryptedCredentialMaterial, CryptoAlgorithm, KeyVersion};
//! let _ = EncryptedCredentialMaterial::new(todo!(), vec![0u8], todo!(), KeyVersion::new(1).unwrap(), CryptoAlgorithm::Aes256Gcm);
//! ```
//! An external caller cannot fabricate a sealed encryption artifact:
//! ```compile_fail
//! use projectos_host_crypto::EncryptionArtifact;
//! let _ = EncryptionArtifact::new(todo!(), todo!(), todo!());
//! ```
//! An external caller cannot read raw ciphertext bytes off the material (getter is crate-private):
//! ```compile_fail
//! fn f(m: &projectos_host_crypto::EncryptedCredentialMaterial) -> &[u8] {
//!     m.ciphertext() // no such public method
//! }
//! ```

#![forbid(unsafe_code)]

pub mod aad;
pub mod adapter;
pub mod error;
pub mod handle;
pub mod material;
pub mod policy;
pub mod projection;
pub mod scope;

pub use aad::{build_associated_data, AssociatedData, MAX_AAD_BYTES};
pub use adapter::{
    CredentialCipher, CryptoOperationKind, CryptoReconciler, MasterKeyMetadata, MasterKeyProtector,
    ProjectDekManager, ReconcileResult, RotationOutcome,
};
pub use error::CryptoError;
pub use handle::{
    CryptoOperationId, KeyLifecycle, KeyRole, ProjectDekHandle, ServiceMasterKeyHandle,
};
pub use material::{
    AadBinding, AuthenticationTag, EncryptedCredentialMaterial, EncryptionArtifact, NonceMaterial,
    PlaintextCredential, WrappedProjectDek, MAX_CIPHERTEXT_BYTES, MAX_PLAINTEXT_BYTES,
    MAX_WRAPPED_DEK_BYTES,
};
pub use policy::{
    CryptoAlgorithm, KeyVersion, AES_256_GCM, ALGORITHM_POLICY_VERSION, KEY_SIZE_BYTES,
    NONCE_SIZE_BYTES, TAG_SIZE_BYTES,
};
pub use projection::project_to_envelope_dto;
pub use scope::CredentialScope;

#[cfg(test)]
mod synthetic;
