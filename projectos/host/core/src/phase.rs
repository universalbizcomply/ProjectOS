//! The canonical, service-issued, operation-bound phase identity (Tier 1).
//!
//! `PhaseId` is the ONE authoritative phase value in the core. It is opaque and has no public
//! constructor: only the internal operation-creation authority ([`crate::operation::InternalOperationRecord::new`])
//! mints one, via the crate-private [`PhaseId::mint`]. A caller, a report, a plan file, a legacy gate,
//! a fixture or a persisted display label cannot manufacture it.
//!
//! ## Tier boundary
//!
//! Tier 1 proves that one operation, its approval, its validated facts and its execution permit all
//! belong to the SAME internally-issued phase identity, and that identity is bound to one project and
//! one environment. Tier 1 does NOT prove approved-plan identity, plan version, phase-definition
//! digest, scope, path boundary, dependencies or predecessor closure — those require the separate,
//! mandatory protected-plan-store track.
//!
//! ## Operation-bound identity (why a caller-chosen reference cannot select authority)
//!
//! Minting folds in the service-issued [`OperationRef`] as well as the verified project, environment
//! and the [`PhaseReference`]. So the identity is OPERATION-UNIQUE: two operations with an identical
//! caller-chosen `PhaseReference` receive DIFFERENT `PhaseId`s, because their `OperationRef`s differ.
//! Naming a reference therefore cannot reproduce another operation's authority — an approval, fact set
//! or permit from one operation carries that operation's `PhaseId`, and the reducer refuses it for any
//! other operation as a phase mismatch. The reference remains non-authoritative; it merely labels.

use core::fmt;

use projectos_trust_contract::{EnvironmentId, OperationFingerprint, OperationRef, ProjectId};

use crate::error::RecordError;
use crate::facts::validate_bounded_id;

/// FNV-1a over the NUL-joined parts, rendered as 16 lowercase hex digits. Deterministic and
/// dependency-free; used only to fold identity fields into an opaque, fixed-width digest — it makes no
/// cryptographic claim, exactly like the rest of this pure crate.
fn fnv1a_hex(parts: &[&str]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for (i, part) in parts.iter().enumerate() {
        if i > 0 {
            hash ^= 0x00;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        for byte in part.bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    format!("{hash:016x}")
}

/// A NON-AUTHORITATIVE phase lookup reference. Well-formedness is validated; it never proves an
/// authorised phase on its own. The service folds it into a [`PhaseId`] together with verified
/// project and environment identity.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PhaseReference(String);

impl PhaseReference {
    /// Construct a validated phase reference.
    ///
    /// # Errors
    /// [`RecordError`] if the token is empty, over-length, or contains an illegal character.
    pub fn new(value: impl Into<String>) -> Result<Self, RecordError> {
        let value = value.into();
        validate_bounded_id(&value)?;
        Ok(Self(value))
    }

    /// Borrow the underlying reference token.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The canonical, opaque, service-issued phase identity.
///
/// No public constructor, no `Default`, no `From<String>`/`From<&str>`, no parsing, no serde. `Clone`
/// and `Eq` are available so the one authentic value can be carried into the binding, approval, facts
/// and context and compared there — cloning an existing identity is not forgery, and there is no way
/// to originate a new value except through [`PhaseId::mint`], which is crate-private.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct PhaseId {
    digest: String,
}

impl fmt::Debug for PhaseId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PhaseId([REDACTED])")
    }
}

impl PhaseId {
    /// Mint the authoritative phase identity. CRATE-PRIVATE: only the operation-creation authority may
    /// call it, so no dependent can originate a `PhaseId`. Operation-bound via `operation_ref`, so two
    /// operations sharing a caller-chosen reference get distinct identities. Deterministic within one
    /// operation — the same project, environment, reference and operation ref always yield the same
    /// identity, which is what lets the permit re-compare it after re-derivation.
    pub(crate) fn mint(
        project: &ProjectId,
        environment: &EnvironmentId,
        reference: &PhaseReference,
        operation_ref: &OperationRef,
    ) -> Self {
        Self {
            digest: fnv1a_hex(&[
                project.as_str(),
                environment.as_str(),
                reference.as_str(),
                operation_ref.as_str(),
            ]),
        }
    }

    /// The opaque digest, for folding into the phase-bound fingerprint. Crate-private; never rendered.
    pub(crate) fn digest(&self) -> &str {
        &self.digest
    }
}

/// Fold a base operation fingerprint together with the phase identity into a phase-bound fingerprint.
///
/// The result changes whenever ONLY the phase changes, so approval-by-fingerprint transitively covers
/// phase; the raw `PhaseId` digest is hashed in, never exposed in the output.
pub(crate) fn derive_operation_fingerprint(
    base: &OperationFingerprint,
    phase: &PhaseId,
) -> OperationFingerprint {
    // The folded value is 16 hex digits — always a well-formed identifier, so construction cannot fail.
    OperationFingerprint::new(fnv1a_hex(&[base.as_str(), phase.digest()]))
        .expect("a 16-hex-digit token is always a valid OperationFingerprint")
}

#[cfg(test)]
mod tests {
    use super::*;
    use projectos_trust_contract::OperationFingerprint;

    fn ids() -> (ProjectId, EnvironmentId) {
        (
            ProjectId::new("proj").unwrap(),
            EnvironmentId::new("env").unwrap(),
        )
    }
    fn op(n: &str) -> OperationRef {
        OperationRef::new(n).unwrap()
    }

    #[test]
    fn mint_is_deterministic_for_the_same_inputs() {
        let (p, e) = ids();
        let r = PhaseReference::new("phase-1").unwrap();
        let o = op("op-1");
        assert_eq!(PhaseId::mint(&p, &e, &r, &o), PhaseId::mint(&p, &e, &r, &o));
    }

    #[test]
    fn a_different_reference_yields_a_different_phase() {
        let (p, e) = ids();
        let o = op("op-1");
        let a = PhaseId::mint(&p, &e, &PhaseReference::new("phase-1").unwrap(), &o);
        let b = PhaseId::mint(&p, &e, &PhaseReference::new("phase-2").unwrap(), &o);
        assert_ne!(a, b);
    }

    #[test]
    fn a_different_project_or_environment_yields_a_different_phase() {
        let (p, e) = ids();
        let r = PhaseReference::new("phase-1").unwrap();
        let o = op("op-1");
        let base = PhaseId::mint(&p, &e, &r, &o);
        assert_ne!(
            base,
            PhaseId::mint(&ProjectId::new("other").unwrap(), &e, &r, &o)
        );
        assert_ne!(
            base,
            PhaseId::mint(&p, &EnvironmentId::new("other").unwrap(), &r, &o)
        );
    }

    #[test]
    fn the_same_reference_in_two_operations_yields_different_phases() {
        // Operation-bound identity: an identical caller-chosen reference cannot reproduce another
        // operation's phase authority, because the operation ref differs.
        let (p, e) = ids();
        let r = PhaseReference::new("phase-1").unwrap();
        assert_ne!(
            PhaseId::mint(&p, &e, &r, &op("op-A")),
            PhaseId::mint(&p, &e, &r, &op("op-B"))
        );
    }

    #[test]
    fn fingerprint_fold_changes_only_with_phase() {
        let (p, e) = ids();
        let o = op("op-1");
        let base = OperationFingerprint::new("op-fp").unwrap();
        let ph1 = PhaseId::mint(&p, &e, &PhaseReference::new("phase-1").unwrap(), &o);
        let ph2 = PhaseId::mint(&p, &e, &PhaseReference::new("phase-2").unwrap(), &o);
        assert_eq!(
            derive_operation_fingerprint(&base, &ph1),
            derive_operation_fingerprint(&base, &ph1)
        );
        assert_ne!(
            derive_operation_fingerprint(&base, &ph1),
            derive_operation_fingerprint(&base, &ph2)
        );
    }

    #[test]
    fn debug_is_redacted() {
        let (p, e) = ids();
        let ph = PhaseId::mint(
            &p,
            &e,
            &PhaseReference::new("phase-1").unwrap(),
            &op("op-1"),
        );
        let rendered = format!("{ph:?}");
        assert_eq!(rendered, "PhaseId([REDACTED])");
        assert!(!rendered.contains("phase-1"));
        assert!(!rendered.contains("op-1"));
    }
}
