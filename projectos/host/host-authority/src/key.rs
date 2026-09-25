//! Internal Windows object-name derivation for the authority existence token.
//!
//! PURE and unsafe-free: it only formats a `Global\…` name string from the sealed
//! [`crate::model::AuthorityKey`]. It opens/creates nothing. The production name is IMPLEMENTED here
//! but is never acquired in this phase (synthetic tests use the separate test-only name). The raw
//! name is exposed ONLY through crate-private functions consumed by `token.rs`; it never appears in a
//! public getter, `Debug`, error or evidence value.

use crate::model::AuthorityKey;

/// The fixed product + schema prefix for the production authority name.
const PRODUCTION_PREFIX: &str = "Global\\ProjectOS.HostAuthority.v1";

/// The fixed prefix for TEST-ONLY authority names. Distinct from the production prefix so a test can
/// never collide with — or be mistaken for — the production authority object.
const TEST_PREFIX: &str = "Global\\ProjectOS.Test.HostAuthority";

/// The production authority object name, `Global\ProjectOS.HostAuthority.v1.<channel>.i<digest16>`.
///
/// CRATE-PRIVATE. Derived from the sealed key's scope only — build-derived channel and the opaque
/// canonical installation digest. It contains no user identity, service identity, machine name,
/// service name or raw path. This function is implemented so the production path exists, but no test
/// acquires this name (enforced by the windows-boundary validator and a runtime assertion).
#[must_use]
#[allow(dead_code)] // Production path IMPLEMENTED but never acquired this phase; used by key.rs tests.
pub(crate) fn production_object_name(key: &AuthorityKey) -> String {
    let scope = key.scope();
    format!(
        "{PRODUCTION_PREFIX}.{}.i{}",
        scope.channel_component(),
        scope.installation_digest16(),
    )
}

/// A TEST-ONLY unique authority object name, `Global\ProjectOS.Test.HostAuthority.<pid>.<unique>`.
///
/// CRATE-PRIVATE, gated to test/feature builds via the caller. Globally unique per (process, tag);
/// contains no username, SID, machine name or private path; bounded; and — being a mutex handle — is
/// removed automatically when every handle closes.
#[must_use]
#[cfg(feature = "test-fixtures")]
pub(crate) fn test_object_name(process_id: u32, unique: &str) -> String {
    // Only bounded ASCII alphanumerics/hyphen from the caller's tag are used.
    let safe: String = unique
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(48)
        .collect();
    format!("{TEST_PREFIX}.p{process_id}.{safe}")
}

/// Whether a name is a production authority name. Used by the runtime guard-rail that forbids tests
/// from ever touching the production object.
#[must_use]
#[allow(dead_code)] // Used by windows_proof (test-fixtures) + key.rs tests; guard-rail against acquiring production.
pub(crate) fn is_production_name(name: &str) -> bool {
    name.starts_with(PRODUCTION_PREFIX)
}

/// Whether a name is a TEST-ONLY authority name (and definitively not a production name). A child test
/// process validates this independently before ever acquiring, so it never trusts a parent-supplied
/// name blindly.
#[must_use]
#[allow(dead_code)] // Used by windows_proof (test-fixtures) child-mode validation + key.rs tests.
pub(crate) fn is_test_name(name: &str) -> bool {
    name.starts_with(TEST_PREFIX) && !is_production_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::test_support;

    #[test]
    fn production_name_has_no_identity_components() {
        let key = test_support::contract_key();
        let name = production_object_name(&key);
        assert!(name.starts_with("Global\\ProjectOS.HostAuthority.v1."));
        assert!(is_production_name(&name));
        assert!(!name.to_lowercase().contains("s-1-"));
        assert!(!name.contains(":\\"));
        // No user/service/machine token: the only variable parts are channel + digest.
        assert!(name.contains(".dev.i"));
    }

    #[test]
    fn test_name_uses_the_test_prefix_and_is_not_production() {
        let name = test_object_name(1234, "unit-abc");
        assert!(name.starts_with("Global\\ProjectOS.Test.HostAuthority.p1234."));
        assert!(!is_production_name(&name));
        assert!(name.ends_with("unit-abc"));
    }

    #[test]
    fn test_name_strips_unsafe_characters() {
        let name = test_object_name(1, "a\\b/c:d e");
        assert!(!name.contains('\\') || name.matches('\\').count() == 1); // only the namespace sep
        assert!(!name.contains('/'));
        assert!(!name.contains(':'));
        // Every non-alphanumeric/hyphen char is stripped: "a\b/c:d e" -> "abcde".
        assert!(name.ends_with("abcde"));
    }
}
