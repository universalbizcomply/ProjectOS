//! # ProjectOS Host Windows Crypto Adapter (DPAPI master-key backend bridge)
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3J-B.
//!
//! One Windows-specific implementation of the accepted [`projectos_host_crypto`]
//! `MasterKeyProtectionBackend` SPI. It bridges the SPI to `projectos-host-windows-protection`
//! machine-scope DPAPI ([`projectos_host_windows_protection::protect_machine_scope`] /
//! [`unprotect_machine_scope`](projectos_host_windows_protection::unprotect_machine_scope)) behind a
//! bounded, injected [`MasterKeyMaterialSource`]. It proves the accepted external backend SPI is
//! genuinely implementable and usable by
//! [`projectos_host_crypto::MasterKeyProtectorService`].
//!
//! ## What this crate does NOT do / claim
//!
//! It contains NO direct Windows FFI (all DPAPI goes through `projectos-host-windows-protection`), NO
//! `unsafe`, NO production key generator, NO OS randomness, and generates NO real service master key.
//! It handles NO real credential, persists nothing, and touches NO filesystem, registry, service,
//! IPC, or ACL. The crypto-owned wrapper retains ALL handle issuance, epoch, lifecycle, and
//! operation-id authority; this backend creates none of it.
//!
//! **DPAPI machine scope is ONE cryptographic primitive.** A successful round trip here does NOT prove
//! service identity, service-only custody, filesystem/ACL protection, administrator resistance, secure
//! deletion, or credential custody. Those remain later, separately-governed work.
//!
//! ## Sealed API (compile-fail evidence)
//!
//! A material-source borrow cannot escape its closure:
//! ```compile_fail
//! use projectos_host_windows_crypto_adapter::MasterKeyMaterialSource;
//! fn f(s: &mut impl MasterKeyMaterialSource) -> &[u8] {
//!     s.with_new_material(|b| b).unwrap() // returning the borrow is rejected
//! }
//! ```
//! A protected record cannot be constructed from arbitrary bytes (field is private, no constructor):
//! ```compile_fail
//! use projectos_host_windows_crypto_adapter::WindowsDpapiProtectedRecord;
//! let _ = WindowsDpapiProtectedRecord { blob: Vec::<u8>::new() };
//! ```
//! A protected record exposes no raw protected bytes:
//! ```compile_fail
//! fn f(r: &projectos_host_windows_crypto_adapter::WindowsDpapiProtectedRecord) -> &[u8] {
//!     r.as_bytes() // no such method
//! }
//! ```
//! Unprotected material exposes no raw byte getter (only closure-scoped `with_secret`):
//! ```compile_fail
//! fn f(m: &projectos_host_windows_crypto_adapter::WindowsDpapiUnprotectedMaterial) -> &[u8] {
//!     m.as_bytes() // no such method
//! }
//! ```
//! Unprotected material cannot be constructed from arbitrary bytes (field is private):
//! ```compile_fail
//! use projectos_host_windows_crypto_adapter::WindowsDpapiUnprotectedMaterial;
//! let _ = WindowsDpapiUnprotectedMaterial { output: Vec::<u8>::new() };
//! ```

mod backend;
mod material_source;

pub use backend::{
    WindowsDpapiMasterKeyBackend, WindowsDpapiProtectedRecord, WindowsDpapiUnprotectedMaterial,
};
pub use material_source::{MasterKeyMaterialSource, MaterialSourceError};
