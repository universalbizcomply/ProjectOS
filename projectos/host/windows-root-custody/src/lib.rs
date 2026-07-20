//! # ProjectOS Host Windows Root Custody (handle-owned filesystem root foundation)
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-B.
//!
//! Opens ONE explicitly supplied absolute trusted directory, retains an owned Windows directory handle,
//! refuses symlinks/junctions/other reparse points, captures stable handle-derived identity (volume
//! serial + 128-bit file id), and revalidates that BOTH the held object AND the original pathname still
//! denote that same object — detecting replacement, redirection and identity drift.
//!
//! ## The accurate claim
//!
//! A trusted Windows directory can be **opened, held and revalidated by stable filesystem identity**
//! rather than being trusted only through a pathname.
//!
//! ## What this crate does NOT claim
//!
//! It does NOT provide complete race-free CHILD-path custody, service identity, administrator
//! resistance, ACL protection, secure deletion, production filesystem custody, credential custody, or
//! authenticated IPC. It performs no ProgramData placement, no ACL change, no service install, no
//! registry access, no IPC, and touches no credential or key material. It is the custody PRIMITIVE that
//! those later, separately-governed phases require. It does not modify or weaken the accepted durable
//! store, which retains its own path/layout and writer-lock responsibilities.
//!
//! ## Sealed API (compile-fail evidence)
//!
//! Custody is not `Clone` (a second owner could outlive/close the handle):
//! ```compile_fail
//! use projectos_host_windows_root_custody::WindowsRootCustody;
//! fn f(c: &WindowsRootCustody) -> WindowsRootCustody { c.clone() }
//! ```
//! Custody exposes no raw Windows handle:
//! ```compile_fail
//! fn f(c: &projectos_host_windows_root_custody::WindowsRootCustody) -> isize {
//!     c.raw_handle() // no such method
//! }
//! ```
//! Identity exposes no raw volume/file-id accessor:
//! ```compile_fail
//! fn f(i: &projectos_host_windows_root_custody::RootIdentity) -> u64 {
//!     i.volume_serial() // no such method
//! }
//! ```

#![deny(unsafe_code)]

pub mod error;
pub mod identity;
pub mod root;

// The ONLY module permitted to use `unsafe` (the minimal Win32 handle/identity primitives).
#[allow(unsafe_code)]
mod windows;

pub use error::RootCustodyError;
pub use identity::RootIdentity;
pub use root::WindowsRootCustody;
