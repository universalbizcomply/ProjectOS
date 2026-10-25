//! PROJECTOS-HOST-REVIEW-PATH1B (ROUTE A) — the PRODUCTION service-runtime authority acquisition.
//!
//! This is the ONLY production route to a machine-wide ProjectOS host authority, and it is
//! deliberately the MINIMUM surface `service-host` needs.
//!
//! # What a caller cannot choose
//!
//! There is no `acquire(name, security)`. This facade takes **no object name, no security descriptor,
//! no scope, no channel and no path**:
//!
//! - the object NAME is derived internally through the existing authority-key contract, from the
//!   canonical installation identity + the BUILD-derived channel + the authority schema version, and
//!   it never leaves this crate;
//! - the SECURITY descriptor is the existing machine-wide one, built from the resolved ProjectOSHost
//!   service principal;
//! - the CHANNEL comes from the build, via the canonical `AppMode` primitive.
//!
//! No request field, no environment string, no arbitrary path and no caller-selected object name can
//! influence any of it.
//!
//! # What it still refuses
//!
//! The frozen rule is unchanged and is re-applied here rather than restated: only a FRESH acquisition
//! with genuine self/service-runtime corroboration yields authority.
//! [`AuthorityTokenOutcome::ExistingToken`] is NOT local authority — another process already holds the
//! machine-wide token, and confirming it here would produce a guard owning one token while attesting
//! that a different process is authoritative. `ConfirmedAuthorityGuard::confirm` enforces that; this
//! module never bypasses it and never constructs a confirmation itself.

use projectos_host_identity::canonical_record::VerifiedCanonicalInstallation;

use crate::acquisition::HostAuthorityAcquisitionRefusal;
use crate::existence::{acquire_existence_token, WindowsTokenAcquisition};
use crate::key::production_object_name;
use crate::model::{
    AuthorityChannel, AuthorityKey, AuthorityScope, AuthoritySchemaVersion,
    CanonicalInstallationIdentity, ConfirmedAuthorityGuard, ConfirmedPeer,
};
use crate::self_service_runtime::running_as_projectos_host_service;
use crate::security::MachineWideAuthoritySecurity;
use crate::service_principal::resolve_projectos_host_service;
use crate::AuthorityTokenOutcome;

/// The BUILD-derived authority channel. Not a parameter: a caller that could choose the channel could
/// aim the acquisition at a different installation's authority object.
fn build_channel() -> AuthorityChannel {
    match projectos_windows_runtime_primitives::app_mode::detect_app_mode() {
        projectos_windows_runtime_primitives::app_mode::AppMode::Development => {
            AuthorityChannel::Development
        }
        projectos_windows_runtime_primitives::app_mode::AppMode::PackagedCandidate => {
            AuthorityChannel::Packaged
        }
    }
}

/// Acquire the machine-wide ProjectOSHost authority ONCE for this runtime, and confirm it.
///
/// The full ordered chain, every link through the component that owns it:
///
/// 1. the VERIFIED canonical installation supplies its opaque 16-character digest;
/// 2. the authority SCOPE is assembled from that digest + the build channel + schema V1;
/// 3. the authority KEY is derived from the scope, and the production object NAME from the key;
/// 4. the machine-wide SECURITY descriptor is built from the resolved service principal;
/// 5. the existence token is atomically created-or-opened under that exact name and descriptor;
/// 6. only a FRESH create is carried forward, and the frozen
///    [`ConfirmedAuthorityGuard::confirm`] rule decides — this module does not.
///
/// On any refusal the guard is dropped, releasing the token: a process that cannot prove authority
/// does not keep holding it.
///
/// # Errors
/// [`HostAuthorityAcquisitionRefusal`] naming the first failed condition.
pub fn acquire_service_runtime_authority(
    installation: &VerifiedCanonicalInstallation,
) -> Result<ConfirmedAuthorityGuard, HostAuthorityAcquisitionRefusal> {
    // THE CORROBORATION IS DERIVED, NEVER SUPPLIED.
    //
    // This function deliberately takes NO `ConfirmedPeer`. `ConfirmedPeer::ServiceRuntime` is an
    // ordinary public enum variant, so a production caller that could pass one would obtain
    // machine-wide Host authority by SELECTING A VALUE. Authority must rest on a fact about the
    // running process.
    //
    // The fact is the per-service SID the SCM injects into a service process's token. An ordinary
    // process cannot add it to its own token, so its presence is a genuine self proof. A process that
    // is not the ProjectOSHost service runtime gets `None` here and can never reach
    // `ServiceRuntimeConfirmed`.
    let confirmed_peer = if running_as_projectos_host_service() {
        Some(ConfirmedPeer::ServiceRuntime)
    } else {
        None
    };
    // 1-2. The scope. A digest that is not exactly 16 lower-case hex characters, or is the all-zero
    //      placeholder, yields NO identity — the placeholder can never re-enter the vocabulary.
    let identity = CanonicalInstallationIdentity::from_verified_digest(installation.digest16())
        .ok_or(HostAuthorityAcquisitionRefusal::IdentityMismatch)?;
    let scope = AuthorityScope::new(identity, build_channel(), AuthoritySchemaVersion::V1);

    // 3. The key, and from it the production object name. Both stay inside this crate.
    let name = production_object_name(&AuthorityKey::derive(scope));

    // 4. The machine-wide descriptor, from the RESOLVED service principal. Fail closed when the
    //    principal cannot be resolved: an authority object secured by a fallback descriptor is not
    //    the accepted object.
    let (_resolution, principal) = resolve_projectos_host_service();
    let security = MachineWideAuthoritySecurity::build_v1(principal.as_ref())
        .ok_or(HostAuthorityAcquisitionRefusal::AuthoritySecurityUnavailable)?;

    // 5-6. Atomic create-or-open, then the FROZEN confirmation rule.
    match acquire_existence_token(&name, &security) {
        WindowsTokenAcquisition::Acquired(guard) => ConfirmedAuthorityGuard::confirm(
            guard,
            AuthorityTokenOutcome::AcquiredToken,
            confirmed_peer,
        )
        .map_err(|_| HostAuthorityAcquisitionRefusal::CorroborationIncomplete),
        // ANOTHER PROCESS HOLDS IT. Never local authority, and the transient handle was already
        // closed by the acquisition, so this process retains nothing. Reported as the existing
        // dedicated variant rather than collapsed, because a second ProjectOSHost failing to start is
        // an operator-visible condition, not a security disclosure: the refusal names no object,
        // account or path, and only a local startup composition ever sees it.
        WindowsTokenAcquisition::Existing => {
            Err(HostAuthorityAcquisitionRefusal::AuthorityAlreadyHeld)
        }
        WindowsTokenAcquisition::Refused(_) => {
            Err(HostAuthorityAcquisitionRefusal::CorroborationIncomplete)
        }
    }
}
