//! # ProjectOS Host Windows Master-Key Composition (canonical production wiring)
//!
//! WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3J-D.
//!
//! The single canonical PRODUCTION composition of the accepted master-key components:
//!
//! [`WindowsCngMasterKeyMaterialSource`] → [`WindowsDpapiMasterKeyBackend`] →
//! [`MasterKeyProtectorService`].
//!
//! This crate adds NO new protector, material-source contract, DPAPI backend, handle model, lifecycle
//! model, operation-id model, or authority system — it only wires the accepted crates together through
//! their public APIs. It contains NO Windows FFI, NO `unsafe`, and NO direct `windows-sys`/DPAPI/CNG
//! dependency (those responsibilities stay in the lower-level accepted crates).
//!
//! ## Side-effect-free construction
//!
//! [`new_windows_production_master_key_protector`] only constructs the empty crypto service wrapping
//! the backend wrapping the RNG source. It generates NO material, calls NO RNG, calls NO DPAPI,
//! provisions/opens/rotates NOTHING, writes NO state, and creates NO handle/operation-id/authority.
//! Those effects happen ONLY when an authorised caller invokes an accepted
//! [`MasterKeyProtectorService`] operation (`provision`/`open`/`rotate`) via the accepted
//! [`projectos_host_crypto::MasterKeyProtector`] trait.
//!
//! ## Not a service / no custody claim
//!
//! This is composition wiring, not a Windows service. It provides no durable custody, service
//! identity, persistent key storage, administrator resistance, or production credential readiness.
//!
//! ## Sealed API (compile-fail evidence)
//!
//! The canonical production constructor accepts no injected component (no alternative source/backend):
//! ```compile_fail
//! use projectos_host_windows_master_key_source::WindowsCngMasterKeyMaterialSource;
//! let _ = projectos_host_windows_master_key_composition::new_windows_production_master_key_protector(
//!     WindowsCngMasterKeyMaterialSource::new(),
//! );
//! ```
//! The composed protector exposes no backend/source getter:
//! ```compile_fail
//! let p = projectos_host_windows_master_key_composition::new_windows_production_master_key_protector();
//! let _ = p.backend(); // no such method
//! ```

use projectos_host_crypto::MasterKeyProtectorService;
use projectos_host_windows_crypto_adapter::WindowsDpapiMasterKeyBackend;
use projectos_host_windows_master_key_source::WindowsCngMasterKeyMaterialSource;

/// The canonical production Windows master-key protector: the crypto-owned
/// [`MasterKeyProtectorService`] over the accepted Windows DPAPI backend over the accepted Windows CNG
/// material source. Authority (handle issuance, epoch, lifecycle, operation ids) remains entirely with
/// the crypto layer.
pub type WindowsProductionMasterKeyProtector =
    MasterKeyProtectorService<WindowsDpapiMasterKeyBackend<WindowsCngMasterKeyMaterialSource>>;

/// Construct the canonical production Windows master-key protector.
///
/// Side-effect free: it wires `WindowsCngMasterKeyMaterialSource::new()` into
/// `WindowsDpapiMasterKeyBackend::new(..)` into `MasterKeyProtectorService::new(..)` using the exact
/// accepted constructor signatures. No RNG/DPAPI call, no material, no provisioning, no handle, no
/// state — those occur only when an authorised caller invokes an accepted service operation.
#[must_use]
pub fn new_windows_production_master_key_protector() -> WindowsProductionMasterKeyProtector {
    MasterKeyProtectorService::new(WindowsDpapiMasterKeyBackend::new(
        WindowsCngMasterKeyMaterialSource::new(),
    ))
}
