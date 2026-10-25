//! Verification of an owned observation against an explicit policy, and the post-effect
//! classification of an application.
//!
//! Verification is a PURE function of the owned model and the policy: no Windows call, no pointer, no
//! borrowed descriptor. Every finding is a semantic classification — the SID that caused it is never
//! rendered to prove it.

use crate::descriptor::{AceKind, AclInspection, DaclState};
use crate::error::AclPolicyError;
use crate::policy::{normalize_mask, AclPolicy, MAXIMUM_ALLOWED, WRITE_LIKE_MASK};
use crate::principal::{BroadPrincipal, OwnedSid};

/// A single semantic non-conformance. Fieldless: it names the defect, never the trustee.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum AclViolation {
    /// The descriptor carried no owner.
    OwnerMissing,
    /// The owner is not the principal the policy requires.
    OwnerMismatch,
    /// No DACL is present. Absent is NOT the same defect as null.
    DaclAbsent,
    /// A null DACL is present, granting everyone full access.
    NullDacl,
    /// The DACL is not protected from inheritance, but the policy requires protection.
    DaclNotProtected,
    /// An inherited ACE is present, but the policy forbids inheritance.
    UnexpectedInheritedAce,
    /// An ACE names a principal the policy does not list.
    UnknownPrincipal,
    /// A deny ACE is present, but the policy forbids deny ACEs.
    UnexpectedDenyAce,
    /// An ACE type this verifier does not interpret (object, callback, conditional, audit, or
    /// unknown). Never treated as harmless.
    UnsupportedAce,
    /// A broad principal holds access the policy does not permit it to hold.
    BroadPrincipalAccess,
    /// A broad principal holds WRITE-LIKE authority.
    BroadPrincipalWrite,
    /// An allow ACE grants more than the policy permits that principal.
    RightsBroaderThanPolicy,
    /// An ACE carries `MAXIMUM_ALLOWED`, whose effective authority cannot be bounded by inspection.
    IndeterminateRights,
    /// A principal the policy requires holds no allow ACE at all.
    MissingRequiredPrincipal,
}

/// The result of judging one observation against one policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AclVerification {
    violations: Vec<AclViolation>,
}

impl AclVerification {
    /// True only when NOTHING was found. There is no "mostly conforming".
    #[must_use]
    pub fn is_conforming(&self) -> bool {
        self.violations.is_empty()
    }

    /// The distinct findings, in detection order.
    #[must_use]
    pub fn violations(&self) -> &[AclViolation] {
        &self.violations
    }

    /// Whether a specific finding is present.
    #[must_use]
    pub fn has(&self, violation: AclViolation) -> bool {
        self.violations.contains(&violation)
    }
}

/// What actually happened to the object when a policy application was attempted.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum ApplyOutcome {
    /// The ACL was changed AND authoritative re-verification passed.
    Confirmed,
    /// Windows reported success, but the re-read descriptor does not match the policy. NOT a
    /// success. Nothing is retried, nothing is broadened, and no guessed prior state is restored.
    ReconciliationRequired(AclVerification),
}

/// Classify a post-effect outcome from the AUTHORITATIVE re-read verification.
///
/// A successful `Set` call is not evidence; only this re-verification is.
#[must_use]
pub fn classify_apply_outcome(reverified: AclVerification) -> ApplyOutcome {
    if reverified.is_conforming() {
        ApplyOutcome::Confirmed
    } else {
        ApplyOutcome::ReconciliationRequired(reverified)
    }
}

/// Judge an owned observation against an explicit policy.
///
/// # Errors
/// [`AclPolicyError`] if a policy principal cannot be resolved to a SID.
pub fn verify(
    inspection: &AclInspection,
    policy: &AclPolicy,
) -> Result<AclVerification, AclPolicyError> {
    let mut found: Vec<AclViolation> = Vec::new();
    let push = |v: AclViolation, into: &mut Vec<AclViolation>| {
        if !into.contains(&v) {
            into.push(v);
        }
    };

    // Resolve the policy's principals ONCE, up front. A policy that cannot be resolved is an error,
    // never a silently-passing verification.
    let expected_owner = policy.expected_owner.resolve()?;
    let mut allowed: Vec<(OwnedSid, u32)> = Vec::with_capacity(policy.allowed.len());
    for entry in &policy.allowed {
        allowed.push((entry.principal.resolve()?, entry.rights.mask()));
    }

    // ---- owner ----
    match &inspection.owner {
        None => push(AclViolation::OwnerMissing, &mut found),
        Some(owner) if *owner != expected_owner => {
            push(AclViolation::OwnerMismatch, &mut found);
        }
        Some(_) => {}
    }

    // ---- DACL state ----
    match &inspection.dacl {
        DaclState::Absent => push(AclViolation::DaclAbsent, &mut found),
        DaclState::Null => push(AclViolation::NullDacl, &mut found),
        DaclState::Present => {}
    }
    if policy.require_protected_dacl && !inspection.dacl_protected {
        push(AclViolation::DaclNotProtected, &mut found);
    }

    // ---- ACEs ----
    let mut satisfied = vec![false; allowed.len()];
    for ace in &inspection.aces {
        if ace.inherited && !policy.allow_inherited_aces {
            push(AclViolation::UnexpectedInheritedAce, &mut found);
        }
        let (mask, sid) = match (ace.kind, ace.raw_mask, ace.sid.as_ref()) {
            (AceKind::Unsupported, _, _) => {
                // Fail closed: the body layout is not interpreted, so no mask or trustee is trusted.
                push(AclViolation::UnsupportedAce, &mut found);
                continue;
            }
            (AceKind::Deny, mask, sid) => {
                if !policy.allow_deny_aces {
                    push(AclViolation::UnexpectedDenyAce, &mut found);
                }
                (mask, sid)
            }
            (AceKind::Allow, mask, sid) => (mask, sid),
        };
        let (Some(raw_mask), Some(sid)) = (mask, sid) else {
            // A supported ACE kind without a mask or trustee cannot be judged.
            push(AclViolation::UnsupportedAce, &mut found);
            continue;
        };

        if raw_mask & MAXIMUM_ALLOWED != 0 {
            push(AclViolation::IndeterminateRights, &mut found);
        }
        let normalized = normalize_mask(raw_mask);

        if BroadPrincipal::classify(sid).is_some() {
            if normalized & WRITE_LIKE_MASK != 0 && !policy.allow_broad_principals_write {
                push(AclViolation::BroadPrincipalWrite, &mut found);
            }
            if !policy.allow_broad_principals_any_access {
                push(AclViolation::BroadPrincipalAccess, &mut found);
            }
        }

        match allowed.iter().position(|(s, _)| s == sid) {
            Some(index) => {
                if ace.kind == AceKind::Allow {
                    satisfied[index] = true;
                    if normalized & !allowed[index].1 != 0 {
                        push(AclViolation::RightsBroaderThanPolicy, &mut found);
                    }
                }
            }
            None => {
                if !policy.allow_unknown_principals {
                    push(AclViolation::UnknownPrincipal, &mut found);
                }
            }
        }
    }

    if satisfied.iter().any(|s| !s) {
        push(AclViolation::MissingRequiredPrincipal, &mut found);
    }

    Ok(AclVerification { violations: found })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::descriptor::{AceRecord, RawDacl, SE_DACL_PRESENT, SE_DACL_PROTECTED};
    use crate::policy::{AllowedPrincipal, RightsClass};
    use crate::principal::AclPrincipal;

    fn allow(sid: OwnedSid, mask: u32) -> AceRecord {
        AceRecord {
            kind: AceKind::Allow,
            inherited: false,
            raw_mask: Some(mask),
            sid: Some(sid),
        }
    }

    fn system_only_policy() -> AclPolicy {
        AclPolicy::strict(
            AclPrincipal::LocalSystem,
            vec![AllowedPrincipal {
                principal: AclPrincipal::LocalSystem,
                rights: RightsClass::FullControl,
            }],
        )
    }

    /// A conforming baseline observation whose ACE list the caller replaces. The DACL byte image is a
    /// valid, empty ACL header; the ACE records under test are supplied directly so that shapes which
    /// cannot safely be created on the host can still be judged.
    fn inspection(aces: Vec<AceRecord>) -> AclInspection {
        let owner = OwnedSid::local_system();
        let mut base = AclInspection::from_raw(
            Some(owner.as_bytes()),
            SE_DACL_PRESENT | SE_DACL_PROTECTED,
            RawDacl::Acl(vec![crate::descriptor::ACL_REVISION, 0, 8, 0, 0, 0, 0, 0]),
        )
        .unwrap();
        base.aces = aces;
        base
    }

    #[test]
    fn a_conforming_observation_produces_no_violations() {
        let v = verify(
            &inspection(vec![allow(OwnedSid::local_system(), 0x001F_01FF)]),
            &system_only_policy(),
        )
        .unwrap();
        assert!(v.is_conforming(), "unexpected: {:?}", v.violations());
    }

    #[test]
    fn owner_mismatch_and_absence_are_distinguished() {
        let mut i = inspection(vec![allow(OwnedSid::local_system(), 0x001F_01FF)]);
        i.owner = Some(OwnedSid::builtin_administrators());
        assert!(verify(&i, &system_only_policy())
            .unwrap()
            .has(AclViolation::OwnerMismatch));

        i.owner = None;
        let v = verify(&i, &system_only_policy()).unwrap();
        assert!(v.has(AclViolation::OwnerMissing));
        assert!(!v.has(AclViolation::OwnerMismatch));
    }

    #[test]
    fn absent_and_null_dacls_produce_distinct_violations() {
        let mut i = inspection(Vec::new());
        i.dacl = DaclState::Absent;
        let v = verify(&i, &system_only_policy()).unwrap();
        assert!(v.has(AclViolation::DaclAbsent));
        assert!(!v.has(AclViolation::NullDacl));

        i.dacl = DaclState::Null;
        let v = verify(&i, &system_only_policy()).unwrap();
        assert!(v.has(AclViolation::NullDacl));
        assert!(!v.has(AclViolation::DaclAbsent));
    }

    #[test]
    fn an_unprotected_dacl_is_refused_when_protection_is_required() {
        let mut i = inspection(vec![allow(OwnedSid::local_system(), 0x001F_01FF)]);
        i.dacl_protected = false;
        assert!(verify(&i, &system_only_policy())
            .unwrap()
            .has(AclViolation::DaclNotProtected));

        let mut relaxed = system_only_policy();
        relaxed.require_protected_dacl = false;
        assert!(verify(&i, &relaxed).unwrap().is_conforming());
    }

    #[test]
    fn an_inherited_ace_is_refused_when_inheritance_is_forbidden() {
        let mut ace = allow(OwnedSid::local_system(), 0x001F_01FF);
        ace.inherited = true;
        assert!(
            verify(&inspection(vec![ace.clone()]), &system_only_policy())
                .unwrap()
                .has(AclViolation::UnexpectedInheritedAce)
        );

        let mut relaxed = system_only_policy();
        relaxed.allow_inherited_aces = true;
        assert!(verify(&inspection(vec![ace]), &relaxed)
            .unwrap()
            .is_conforming());
    }

    #[test]
    fn every_broad_principal_with_modify_authority_is_refused() {
        for sid in [
            OwnedSid::everyone(),
            OwnedSid::authenticated_users(),
            OwnedSid::builtin_users(),
            OwnedSid::builtin_guests(),
            OwnedSid::anonymous_logon(),
        ] {
            let v = verify(
                &inspection(vec![
                    allow(OwnedSid::local_system(), 0x001F_01FF),
                    allow(sid, RightsClass::Modify.mask()),
                ]),
                &system_only_policy(),
            )
            .unwrap();
            assert!(v.has(AclViolation::BroadPrincipalWrite));
            assert!(v.has(AclViolation::BroadPrincipalAccess));
            assert!(v.has(AclViolation::UnknownPrincipal));
        }
    }

    #[test]
    fn broad_full_control_expressed_as_a_generic_right_is_still_refused() {
        // GENERIC_ALL, not FILE_ALL_ACCESS: only normalisation makes this write-like.
        let v = verify(
            &inspection(vec![
                allow(OwnedSid::local_system(), 0x001F_01FF),
                allow(OwnedSid::everyone(), 0x1000_0000),
            ]),
            &system_only_policy(),
        )
        .unwrap();
        assert!(v.has(AclViolation::BroadPrincipalWrite));
    }

    #[test]
    fn a_broad_principal_with_read_only_access_is_still_refused_by_the_strict_policy() {
        let v = verify(
            &inspection(vec![
                allow(OwnedSid::local_system(), 0x001F_01FF),
                allow(OwnedSid::everyone(), RightsClass::Read.mask()),
            ]),
            &system_only_policy(),
        )
        .unwrap();
        assert!(v.has(AclViolation::BroadPrincipalAccess));
        assert!(
            !v.has(AclViolation::BroadPrincipalWrite),
            "read-only must not be reported as write"
        );
    }

    #[test]
    fn an_unknown_principal_is_refused_unless_explicitly_permitted() {
        let ace = allow(OwnedSid::builtin_administrators(), RightsClass::Read.mask());
        assert!(verify(
            &inspection(vec![
                allow(OwnedSid::local_system(), 0x001F_01FF),
                ace.clone()
            ]),
            &system_only_policy()
        )
        .unwrap()
        .has(AclViolation::UnknownPrincipal));

        let mut relaxed = system_only_policy();
        relaxed.allow_unknown_principals = true;
        assert!(verify(
            &inspection(vec![allow(OwnedSid::local_system(), 0x001F_01FF), ace]),
            &relaxed
        )
        .unwrap()
        .is_conforming());
    }

    #[test]
    fn rights_broader_than_the_policy_are_refused() {
        let policy = AclPolicy::strict(
            AclPrincipal::LocalSystem,
            vec![AllowedPrincipal {
                principal: AclPrincipal::LocalSystem,
                rights: RightsClass::Read,
            }],
        );
        let v = verify(
            &inspection(vec![allow(OwnedSid::local_system(), 0x001F_01FF)]),
            &policy,
        )
        .unwrap();
        assert!(v.has(AclViolation::RightsBroaderThanPolicy));
    }

    #[test]
    fn a_deny_ace_is_refused_unless_explicitly_permitted() {
        let deny = AceRecord {
            kind: AceKind::Deny,
            inherited: false,
            raw_mask: Some(RightsClass::Read.mask()),
            sid: Some(OwnedSid::local_system()),
        };
        assert!(verify(
            &inspection(vec![allow(OwnedSid::local_system(), 0x001F_01FF), deny]),
            &system_only_policy()
        )
        .unwrap()
        .has(AclViolation::UnexpectedDenyAce));
    }

    #[test]
    fn an_unsupported_ace_fails_closed() {
        let unsupported = AceRecord {
            kind: AceKind::Unsupported,
            inherited: false,
            raw_mask: None,
            sid: None,
        };
        let v = verify(
            &inspection(vec![
                allow(OwnedSid::local_system(), 0x001F_01FF),
                unsupported,
            ]),
            &system_only_policy(),
        )
        .unwrap();
        assert!(v.has(AclViolation::UnsupportedAce));
        assert!(!v.is_conforming());
    }

    #[test]
    fn maximum_allowed_is_indeterminate_and_never_passes() {
        let v = verify(
            &inspection(vec![allow(OwnedSid::local_system(), MAXIMUM_ALLOWED)]),
            &system_only_policy(),
        )
        .unwrap();
        assert!(v.has(AclViolation::IndeterminateRights));
    }

    #[test]
    fn a_required_principal_holding_no_ace_is_reported() {
        let v = verify(&inspection(Vec::new()), &system_only_policy()).unwrap();
        assert!(v.has(AclViolation::MissingRequiredPrincipal));
    }

    #[test]
    fn a_non_conforming_reverification_is_never_classified_as_success() {
        let non_conforming = AclVerification {
            violations: vec![AclViolation::NullDacl],
        };
        match classify_apply_outcome(non_conforming) {
            ApplyOutcome::ReconciliationRequired(v) => assert!(v.has(AclViolation::NullDacl)),
            ApplyOutcome::Confirmed => panic!("a failed re-verification must never be Confirmed"),
        }
        assert_eq!(
            classify_apply_outcome(AclVerification {
                violations: Vec::new()
            }),
            ApplyOutcome::Confirmed
        );
    }

    #[test]
    fn violation_rendering_discloses_no_sid_or_account() {
        let v = verify(
            &inspection(vec![allow(OwnedSid::everyone(), 0x001F_01FF)]),
            &system_only_policy(),
        )
        .unwrap();
        let text = format!("{v:?}");
        assert!(text.contains("BroadPrincipal"));
        assert!(!text.contains("S-1-"), "no SID string may appear");
        assert!(!text.contains("redacted"), "no SID value is carried at all");
    }
}
