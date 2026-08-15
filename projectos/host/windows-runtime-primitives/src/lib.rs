//! # ProjectOS Windows runtime primitives
//!
//! Two canonical low-level primitives shared by ProjectOS host identity and process code:
//!
//! * [`handles`] — the owned-handle RAII wrapper: bounded Win32 handle adoption, a non-owning borrow
//!   helper, and deterministic close-on-drop. `unsafe` lives ONLY here.
//! * [`app_mode`] — the build-derived application-mode CLASSIFIER ([`app_mode::AppMode`] /
//!   [`app_mode::detect_app_mode`]). Classification only: it grants no authority.
//! * [`known_folder`] — the trusted READ-ONLY Known Folder resolution primitives (ProgramData and
//!   Program Files). Two named functions, not a folder vocabulary; they resolve and grant nothing.
//! * [`system_random`] — the canonical system-preferred CSPRNG fill primitive. It fills a caller-owned
//!   buffer and reports success or failure; it grants no key, credential or identity semantics.
//!
//! This crate owns no policy — no process supervision, launch/daemon/host/instance authority, no
//! identity/publisher/Authenticode policy, no IPC, no Windows service operation, no ProgramData/ACL/
//! SID/credential/GCM/PAT/GitHub/signing/deployment. It depends on no other ProjectOS crate and never
//! on a UI/adapter framework.

// This crate is NOT `forbid(unsafe_code)`: two primitives require narrowly-scoped unsafe operations.
// Every unsafe op inside an unsafe fn must be an explicit, documented unsafe block (enforced by the
// crate's `unsafe_op_in_unsafe_fn = "deny"` lint). Only `handles`, `system_random` and `known_folder`
// contain unsafe, and each confines it to a single documented call.

/// Build-derived application-mode classification. Platform-independent; grants no authority.
pub mod app_mode;

/// Owned Win32 handle RAII primitive. Contains `unsafe`.
#[cfg(windows)]
pub mod handles;


/// The canonical system-preferred CSPRNG fill primitive. Contains `unsafe` on Windows only.
pub mod system_random;

/// The trusted read-only Known Folder resolvers. Contains `unsafe` on Windows only.
pub mod known_folder;
