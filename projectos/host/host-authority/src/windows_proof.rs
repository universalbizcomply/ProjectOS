//! TEST-ONLY synthetic authority surface (feature `test-fixtures`, Windows only).
//!
//! Present ONLY under the `test-fixtures` feature — never in a default or release build — so no live
//! acquisition surface ships. It re-exports the bounded Windows helpers to the integration tests and
//! forces every object name through a TEST-ONLY constructor that can never equal the production
//! authority name.

pub use crate::existence::{
    acquire_existence_token, create_colliding_event, guard_handle, try_open,
    WindowsTokenAcquisition,
};
pub use crate::model::{AuthorityGuard, AuthorityRefusal, ServiceSidResolution};
pub use crate::security::{
    inspect_object_security, MachineWideAuthoritySecurity, SecurityProfileInspection,
    AUTHORITY_DETECTION_RIGHTS, RIGHT_WRITE_DAC,
};
pub use crate::service_principal::{resolve_projectos_host_service, ResolvedServicePrincipal};

/// Build a TEST-ONLY existence-token name for the current process, asserting it is never a production
/// name. All synthetic proofs route through this so the production object is never touched.
#[must_use]
pub fn synthetic_object_name(tag: &str) -> String {
    let name = crate::key::test_object_name(std::process::id(), tag);
    assert!(
        !crate::key::is_production_name(&name),
        "synthetic object names must never be production names"
    );
    name
}

/// Whether a name is a TEST-ONLY authority name (and not a production name). A child test process must
/// call this on any parent-supplied name BEFORE acquiring, so it never trusts the name blindly.
#[must_use]
pub fn is_test_object_name(name: &str) -> bool {
    crate::key::is_test_name(name)
}
