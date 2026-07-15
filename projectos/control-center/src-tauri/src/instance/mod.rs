//! Per-user, cross-session host uniqueness (PROJECTOS-WINDOWS-HOST-SINGLE-INSTANCE1A).
//!
//! Guarantees exactly ONE authoritative Control Centre host per Windows ACCOUNT, across ALL of that
//! account's sessions (console and RDP), per installation and channel. A duplicate is refused before
//! the Tauri builder, managed state, any window, Node resolution, `host.mjs` resolution, Job
//! creation, daemon launch, readiness, or any ProjectOS state mutation.
//!
//! Mechanism: one atomically created/opened `Global\` mutex used purely as an EXISTENCE TOKEN,
//! protected by an explicit single-ACE DACL granting `SYNCHRONIZE` to the current account SID.
//!
//! BINDING — this control is for AVAILABILITY and CONSISTENCY ONLY. It is NOT executable identity,
//! process authentication, owner authentication, production identity, trust evidence, or protected
//! approval authority. The object name is deterministic and derivable by anyone on the machine, so a
//! same-user process can deny startup by pre-creating it; that is an acknowledged availability risk,
//! and it is not defended against here because a same-user attacker is already inside this boundary.

#![cfg(windows)]

pub mod guard;
pub mod key;
pub mod security;

pub use guard::ProjectOsInstanceGuard;

/// Why instance authority could not be established.
///
/// Deliberately carries no native error code, object name, SID or path — nothing here is safe to put
/// in front of an owner, and `app.rs` maps every variant to one generic message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstanceFailure {
    /// The object exists but this account may not open it (foreign or restrictive-DACL squatter).
    /// NEVER reported as "already running" — that would be a false claim about the system.
    AccessDenied,
    /// The name exists as a different kernel-object type.
    ScopeCollision,
    /// Scope material (install root / account SID) was missing or malformed.
    ScopeInvalid,
    /// Any other native failure.
    AuthorityUnavailable,
}

/// The result of attempting to become the authoritative host.
///
/// `dead_code` is allowed for the `Failed` payload specifically: by design every authority failure
/// maps to ONE owner-facing message (distinguishing them in the UI would tell the owner about other
/// accounts' objects), so the default binary reads only the discriminant. The payload is still
/// carried because it is the honest classification — the tests and the feature-gated adapter assert
/// on it, and it must never be collapsed into "already running".
#[allow(dead_code)]
pub enum InstanceOutcome {
    /// This process is authoritative. The guard must be retained for the whole application run.
    Acquired(ProjectOsInstanceGuard),
    /// Another host for this account/installation/channel already exists. Refuse and exit.
    AlreadyRunning,
    /// Authority could not be established. Refuse and exit — never start anyway.
    Failed(InstanceFailure),
}

impl From<key::KeyError> for InstanceFailure {
    fn from(_: key::KeyError) -> Self {
        InstanceFailure::ScopeInvalid
    }
}

/// Attempt to become the single authoritative host for this account/installation/channel.
///
/// Order is load-bearing: every input is resolved and validated BEFORE the object is created, so a
/// failure at any step means no object, no Tauri, and no daemon.
pub fn acquire() -> InstanceOutcome {
    let channel = key::detect_channel();

    let install_dir = match key::resolve_install_dir() {
        Ok(d) => d,
        Err(e) => return InstanceOutcome::Failed(e.into()),
    };
    let install16 = match key::install_component(&install_dir) {
        Ok(c) => c,
        Err(e) => return InstanceOutcome::Failed(e.into()),
    };

    let sid = match security::current_account_sid() {
        Ok(s) => s,
        Err(f) => return InstanceOutcome::Failed(f),
    };
    let user16 = match key::user_component(sid.sid_bytes()) {
        Ok(c) => c,
        Err(e) => return InstanceOutcome::Failed(e.into()),
    };

    let name = key::instance_name(channel, &user16, &install16);

    let sec = match security::InstanceSecurity::build(&sid) {
        Ok(s) => s,
        Err(f) => return InstanceOutcome::Failed(f),
    };

    guard::create_instance_object(&name, &sec)
}

/// TEST-ONLY: run the real create/classify path against a caller-supplied object name.
///
/// Exposed (feature-gated) so multi-process race proofs can use an isolated name instead of the
/// production one, which would collide with a real Control Centre on this machine. It reuses the
/// production security descriptor and the production classification, so what the tests exercise is
/// the real mechanism — only the name differs.
#[cfg(feature = "test-fixtures")]
pub fn acquire_named(name: &str) -> InstanceOutcome {
    let sid = match security::current_account_sid() {
        Ok(s) => s,
        Err(f) => return InstanceOutcome::Failed(f),
    };
    let sec = match security::InstanceSecurity::build(&sid) {
        Ok(s) => s,
        Err(f) => return InstanceOutcome::Failed(f),
    };
    guard::create_instance_object(name, &sec)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The real production path must classify cleanly on this machine — proving unelevated
    /// `Global\` creation actually works, which the corrected design depends on.
    #[test]
    fn production_acquire_path_works_unelevated() {
        let outcome = acquire();
        match outcome {
            InstanceOutcome::Acquired(_) => {}
            // Acceptable only if a real Control Centre happens to be running for this account.
            InstanceOutcome::AlreadyRunning => {}
            InstanceOutcome::Failed(f) => {
                panic!("global instance authority must be establishable unelevated: {f:?}")
            }
        }
    }

    #[test]
    fn key_error_maps_to_scope_invalid() {
        let f: InstanceFailure = key::KeyError::ScopeInvalid.into();
        assert_eq!(f, InstanceFailure::ScopeInvalid);
    }
}
