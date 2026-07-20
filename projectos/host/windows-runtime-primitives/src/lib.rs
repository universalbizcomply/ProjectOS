//! # ProjectOS Windows runtime primitives
//!
//! Two canonical low-level primitives shared by ProjectOS host identity and process code:
//!
//! * [`handles`] — the owned-handle RAII wrapper: bounded Win32 handle adoption, a non-owning borrow
//!   helper, and deterministic close-on-drop. `unsafe` lives ONLY here.
//! * [`app_mode`] — the build-derived application-mode CLASSIFIER ([`app_mode::AppMode`] /
//!   [`app_mode::detect_app_mode`]). Classification only: it grants no authority.
//!
//! This crate owns no policy — no process supervision, launch/daemon/host/instance authority, no
//! identity/publisher/Authenticode policy, no IPC, no Windows service operation, no ProgramData/ACL/
//! SID/credential/GCM/PAT/GitHub/signing/deployment. It depends on no other ProjectOS crate and never
//! on a UI/adapter framework.

// This crate is NOT `forbid(unsafe_code)`: the handle primitive requires exactly one narrowly-scoped
// unsafe operation. Every unsafe op inside an unsafe fn must be an explicit, documented unsafe block
// (enforced by the crate's `unsafe_op_in_unsafe_fn = "deny"` lint). No other module contains unsafe.

/// Build-derived application-mode classification. Platform-independent; grants no authority.
pub mod app_mode;

/// Owned Win32 handle RAII primitive. The only module that contains `unsafe`.
#[cfg(windows)]
pub mod handles;
