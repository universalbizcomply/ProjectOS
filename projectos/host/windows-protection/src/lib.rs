//! # ProjectOS Host Windows Protection (DPAPI machine-scope capability + safety proof)
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3I.
//!
//! A bounded, safe wrapper around Windows DPAPI machine-scope protection (`CryptProtectData` /
//! `CryptUnprotectData`) with the EXACT `CRYPTPROTECT_LOCAL_MACHINE | CRYPTPROTECT_UI_FORBIDDEN`
//! flags, sealed zeroising buffers, exactly-once `LocalFree`, and fieldless errors.
//!
//! The synthetic canary and the env-gated live owner-machine probe are TEST-ONLY: they live in the
//! `#[cfg(test)]` submodule of the platform module and are never compiled into the library or a
//! release artefact.
//!
//! ## What this crate does NOT do / claim
//!
//! It handles NO real credential, generates NO service master key, persists NO protected blob, and
//! touches NO filesystem, registry, service, IPC, ACL, Credential Manager, CNG/NCrypt, TPM, or
//! certificate store. It proves ONLY that this owner machine can invoke DPAPI machine scope correctly
//! and safely for bounded synthetic input.
//!
//! **DPAPI machine scope is ONE cryptographic primitive.** It does NOT provide service-only access,
//! service identity, ACL protection, protection against another process on the same machine that can
//! read the blob and call DPAPI, protection against administrators, offline anti-rollback, secure
//! deletion, or credential custody. The future service account, filesystem ACL, and service-owned
//! state boundary remain mandatory.
//!
//! ## Sealed API (compile-fail evidence)
//!
//! No public getter exposes a protected blob's raw bytes:
//! ```compile_fail
//! fn f(b: &projectos_host_windows_protection::ProtectedBlob) -> &[u8] {
//!     b.as_bytes()
//! }
//! ```
//! No public getter exposes unprotected bytes (only a closure-scoped borrow exists):
//! ```compile_fail
//! fn f(o: &projectos_host_windows_protection::UnprotectedOutput) -> &[u8] {
//!     o.as_bytes()
//! }
//! ```
//! The live-probe runner is NOT part of the public API:
//! ```compile_fail
//! let _ = projectos_host_windows_protection::run_machine_scope_probe();
//! ```

#![deny(unsafe_op_in_unsafe_fn)]

mod buffer;
mod error;
mod platform;
mod policy;
#[cfg(windows)]
mod windows;

pub use buffer::{ProtectedBlob, UnprotectedOutput};
pub use error::ProtectionError;
pub use platform::{protect_machine_scope, unprotect_machine_scope};
pub use policy::{MAX_INPUT_BYTES, MAX_PROTECTED_BYTES, MAX_UNPROTECTED_BYTES, PROTECT_FLAGS};
