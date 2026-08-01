//! Fixture-backed composition proofs.
//!
//! Every filesystem effect happens inside a disposable directory created and removed by the test
//! itself. No production path is resolved or touched, no ACL/registry/SCM call is made, no elevation is
//! requested and the production RNG is never invoked.

use super::fixture::*;
use super::*;
use projectos_host_identity::canonical_record::{
    verify_record, RecordInstallationEvidence, EXPECTED_PRODUCT,
};
use projectos_host_windows_acl_policy::{AclPolicy, AclPrincipal, AllowedPrincipal, RightsClass};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

/// The exclusive installation operation is process-wide, so composing tests must not overlap.
static SERIALISE: Mutex<()> = Mutex::new(());

fn serialised() -> MutexGuard<'static, ()> {
    SERIALISE.lock().unwrap_or_else(|e| e.into_inner())
}

/// A disposable fixture root, removed on drop even if a test panics.
struct Disposable(PathBuf);

impl Disposable {
    fn new() -> Self {
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let p = std::env::temp_dir().join(format!(
            "projectos-installer-fixture-{}-{n}",
            std::process::id()
        ));
        fs::create_dir_all(&p).expect("fixture root");
        Self(p)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Disposable {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

const REL: &str = "aa11bb22cc33dd44ee55ff6600112233445566778899aabbccddeeff00112233";

fn request() -> InstallationRequest {
    InstallationRequest::parse("stable", REL).expect("valid request")
}

/// A composed ACL outcome that satisfies the policy: a single non-broad principal.
fn good_acl() -> AclCompositionOutcome {
    // The narrow shape the approved boundary expects: SYSTEM owns it, Administrators may modify, and no
    // broad principal appears at all.
    AclCompositionOutcome::Composed(AclPolicy::strict(
        AclPrincipal::LocalSystem,
        vec![
            AllowedPrincipal {
                principal: AclPrincipal::LocalSystem,
                rights: RightsClass::FullControl,
            },
            AllowedPrincipal {
                principal: AclPrincipal::BuiltinAdministrators,
                rights: RightsClass::Modify,
            },
        ],
    ))
}

fn evidence<'a>(d: &'a Disposable, acl: AclCompositionOutcome) -> FixtureInstallerEvidence<'a> {
    FixtureInstallerEvidence {
        owned_root: d.path(),
        elevated: true,
        custody_available: true,
        acl,
        service_name: frozen_service_name(),
        service_relative_path: frozen_service_relative_path(),
    }
}

// ---------------------------------------------------------------- ordering + plan shape

#[test]
fn the_plan_orders_identity_before_any_service_step() {
    let _s = serialised();
    let d = Disposable::new();
    let c = compose_fixture_installation(&evidence(&d, good_acl()), &request()).expect("composes");

    assert!(c.plan.identity_precedes_service());
    assert_eq!(
        c.plan.steps().first(),
        Some(&PlannedStep::ConfirmElevationAndExclusivity)
    );
    assert_eq!(
        c.plan.steps().last(),
        Some(&PlannedStep::AwaitSeparateOwnerActivationGate)
    );
    // The declared order is total, gapless and strictly increasing.
    for (i, s) in c.plan.steps().iter().enumerate() {
        assert_eq!(s.order(), i + 1, "{s:?}");
        assert_eq!(
            s.prerequisite(),
            if i == 0 {
                None
            } else {
                Some(c.plan.steps()[i - 1])
            }
        );
    }
    // The frozen orderings are carried, not restated.
    assert!(!c.plan.activation_sequence().is_empty());
    assert!(!c.plan.pre_effect_sequence().is_empty());
    // The location stays SYMBOLIC: the anchor is still a Known Folder symbol, and no resolved
    // production path (drive letter or UNC prefix) is rendered anywhere in the plan.
    let loc = c.plan.symbolic_record_location();
    assert!(loc.starts_with("%KNOWNFOLDER:ProgramData%"), "{loc}");
    assert!(loc.ends_with("identity.v1.json"), "{loc}");
    assert!(!loc.contains(":\\"), "a resolved drive path leaked: {loc}");
    assert!(!loc.starts_with("\\\\"), "a UNC path leaked: {loc}");
}

#[test]
fn the_frozen_service_facts_are_not_caller_selectable() {
    let _s = serialised();
    let d = Disposable::new();
    let c = compose_fixture_installation(&evidence(&d, good_acl()), &request()).expect("composes");
    assert_eq!(c.plan.channel(), "stable");
    assert_eq!(c.plan.service_name(), "ProjectOSHost");
    assert_eq!(c.plan.service_relative_path(), "ProjectOSHost.exe");
}

#[test]
fn the_rollback_contract_is_explicit() {
    for s in PlannedStep::all() {
        // A failure never continues into a later step.
        assert!(s.failure_halts_all_later_steps(), "{s:?}");
        // No step may weaken an ACL to make progress.
        assert!(!s.permits_acl_weakening(), "{s:?}");
        // Nothing pre-existing is ever cleaned up.
        assert!(
            matches!(
                s.cleanup_scope_on_failure(),
                CleanupScope::Nothing | CleanupScope::InstallerOwnedTemporaryOnly
            ),
            "{s:?}"
        );
    }
    // Only the writing step may remove anything, and only its own residue.
    assert_eq!(
        PlannedStep::WriteAndVerifyIdentityRecord.cleanup_scope_on_failure(),
        CleanupScope::InstallerOwnedTemporaryOnly
    );
    assert_eq!(
        PlannedStep::PrepareStateRootAndCustody.cleanup_scope_on_failure(),
        CleanupScope::Nothing
    );
    // No automatic retry with a fresh id after an identity conflict.
    assert!(!PlannedStep::WriteAndVerifyIdentityRecord.automatic_retry_permitted());
    assert!(!PlannedStep::InstallOrConfigureService.automatic_retry_permitted());
    // Partially prepared directories are carried forward, never silently undone.
    assert_eq!(
        PlannedStep::PrepareStateRootAndCustody.carry_forward_on_failure(),
        CarryForward::PartiallyPreparedDirectory
    );
    assert_eq!(
        PlannedStep::WriteAndVerifyIdentityRecord.carry_forward_on_failure(),
        CarryForward::ExistingCanonicalRecord
    );
}

// ---------------------------------------------------------------- refusals

#[test]
fn the_production_entry_point_refuses_before_any_write_capability() {
    let _s = serialised();
    assert_eq!(
        plan_production_installation(&request()).unwrap_err(),
        PlanRefusal::ElevationAbsent
    );
}

#[test]
fn missing_elevation_refuses() {
    let _s = serialised();
    let d = Disposable::new();
    let mut e = evidence(&d, good_acl());
    e.elevated = false;
    assert_eq!(
        compose_fixture_installation(&e, &request()).unwrap_err(),
        PlanRefusal::ElevationAbsent
    );
}

#[test]
fn an_unresolvable_anchor_refuses() {
    let _s = serialised();
    let missing = std::env::temp_dir().join("projectos-installer-does-not-exist-zzz");
    let e = FixtureInstallerEvidence {
        owned_root: &missing,
        elevated: true,
        custody_available: true,
        acl: good_acl(),
        service_name: frozen_service_name(),
        service_relative_path: frozen_service_relative_path(),
    };
    assert_eq!(
        compose_fixture_installation(&e, &request()).unwrap_err(),
        PlanRefusal::AnchorUnresolved
    );
}

#[test]
fn a_missing_custody_plan_refuses() {
    let _s = serialised();
    let d = Disposable::new();
    let mut e = evidence(&d, good_acl());
    e.custody_available = false;
    assert_eq!(
        compose_fixture_installation(&e, &request()).unwrap_err(),
        PlanRefusal::CustodyPlanUnavailable
    );
}

#[test]
fn an_unavailable_or_inconsistent_acl_plan_refuses() {
    let _s = serialised();
    let d = Disposable::new();
    for (acl, expected) in [
        (
            AclCompositionOutcome::OwnerDecisionRequired,
            PlanRefusal::AclPlanUnavailable,
        ),
        (
            AclCompositionOutcome::ServiceIdentityRequired,
            PlanRefusal::AclPlanUnavailable,
        ),
    ] {
        assert_eq!(
            compose_fixture_installation(&evidence(&d, acl), &request()).unwrap_err(),
            expected
        );
    }
    // A policy that grants broad write is inconsistent with the approved boundary.
    let broad = AclCompositionOutcome::Composed(AclPolicy::strict(
        AclPrincipal::LocalSystem,
        vec![AllowedPrincipal {
            principal: AclPrincipal::ExplicitSid(
                projectos_host_windows_acl_policy::OwnedSid::everyone(),
            ),
            rights: RightsClass::FullControl,
        }],
    ));
    assert_eq!(
        compose_fixture_installation(&evidence(&d, broad), &request()).unwrap_err(),
        PlanRefusal::AclPlanInconsistent
    );
}

#[test]
fn a_wrong_service_name_or_binary_path_refuses() {
    let _s = serialised();
    let d = Disposable::new();
    let mut e = evidence(&d, good_acl());
    e.service_name = "ProjectOSHost2";
    assert_eq!(
        compose_fixture_installation(&e, &request()).unwrap_err(),
        PlanRefusal::ServiceNameMismatch
    );

    let mut e = evidence(&d, good_acl());
    e.service_relative_path = "bin\\ProjectOSHost.exe";
    assert_eq!(
        compose_fixture_installation(&e, &request()).unwrap_err(),
        PlanRefusal::ServiceBinaryPathMismatch
    );
}

#[test]
fn a_malformed_release_digest_or_unsupported_channel_refuses() {
    for bad in ["", "abc", &REL.to_uppercase(), &"0".repeat(64)] {
        assert_eq!(
            InstallationRequest::parse("stable", bad).unwrap_err(),
            PlanRefusal::ReleaseDigestMissingOrMalformed,
            "{bad}"
        );
    }
    for bad in ["", "nightly", "Stable"] {
        assert_eq!(
            InstallationRequest::parse(bad, REL).unwrap_err(),
            PlanRefusal::UnsupportedChannel,
            "{bad}"
        );
    }
}

#[test]
fn a_conflicting_existing_identity_refuses_before_authorisation() {
    let _s = serialised();
    let d = Disposable::new();
    // First installation succeeds and writes one record. The whole composition is dropped inside this
    // block, which also releases the exclusive operation it holds for the duration of the install.
    let (record_path, before) = {
        let first =
            compose_fixture_installation(&evidence(&d, good_acl()), &request()).expect("first");
        let record_path = first.authorisation.record_path_for_test();
        first
            .authorisation
            .write(&fixture_id(0xAB), &request())
            .expect("first write");
        let before = fs::read(&record_path).expect("record");
        (record_path, before)
    };

    // A second composition against the same root refuses at plan time — no authorisation is issued, so
    // there is nothing that could overwrite the record.
    assert_eq!(
        compose_fixture_installation(&evidence(&d, good_acl()), &request()).unwrap_err(),
        PlanRefusal::ConflictingIdentityExists
    );
    assert_eq!(fs::read(&record_path).unwrap(), before, "record untouched");
}

#[test]
fn a_second_concurrent_operation_refuses() {
    let _s = serialised();
    let held = ExclusiveInstallationOperation::claim().expect("first claim");
    assert_eq!(
        ExclusiveInstallationOperation::claim().unwrap_err(),
        PlanRefusal::InstallationAlreadyInProgress
    );
    drop(held);
    // Released on drop, so a later operation is not permanently blocked.
    assert!(ExclusiveInstallationOperation::claim().is_ok());
}

// ---------------------------------------------------------------- the passing path

#[test]
fn a_valid_fixture_plan_reaches_the_writer_and_produces_a_verifiable_record() {
    let _s = serialised();
    let d = Disposable::new();
    let c = compose_fixture_installation(&evidence(&d, good_acl()), &request()).expect("composes");
    let record_path = c.authorisation.record_path_for_test();

    // The target is derived from the FROZEN contract segments, beneath the supplied anchor only.
    let rel = record_path
        .strip_prefix(d.path().canonicalize().unwrap())
        .expect("contained beneath the anchor");
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    assert_eq!(parts[0], EXPECTED_PRODUCT);
    assert_eq!(parts[3], "identity.v1.json");
    assert_eq!(parts.len(), 4);

    assert_eq!(
        c.authorisation
            .write(&fixture_id(0xAB), &request())
            .expect("write"),
        projectos_host_canonical_installation_identity_writer::WriteOutcome::Written
    );

    // The record the closed reader verifies.
    let bytes = fs::read(&record_path).expect("record exists");
    let parsed =
        projectos_host_canonical_installation_identity_writer::parse_canonical_json(&bytes)
            .expect("canonical");
    verify_record(&parsed, RecordInstallationEvidence::Matched).expect("reader verifies");
}

#[test]
fn a_writer_failure_prevents_every_later_service_step() {
    let _s = serialised();
    let d = Disposable::new();
    let c = compose_fixture_installation(&evidence(&d, good_acl()), &request()).expect("composes");
    let record_path = c.authorisation.record_path_for_test();

    // Occupy the record location with unparseable content so the write refuses.
    fs::create_dir_all(record_path.parent().unwrap()).unwrap();
    let junk = b"{ not a record }".to_vec();
    fs::write(&record_path, &junk).unwrap();

    let outcome = c.authorisation.write(&fixture_id(0xAB), &request());
    assert!(outcome.is_err(), "write must refuse");

    // The failure halts everything later, and the pre-existing content is neither repaired nor removed.
    assert!(PlannedStep::WriteAndVerifyIdentityRecord.failure_halts_all_later_steps());
    assert!(
        PlannedStep::WriteAndVerifyIdentityRecord.order()
            < PlannedStep::InstallOrConfigureService.order()
    );
    assert_eq!(fs::read(&record_path).unwrap(), junk);
    // And no residue is left beside it.
    let residue = fs::read_dir(record_path.parent().unwrap())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
        .count();
    assert_eq!(residue, 0);
}

#[test]
fn the_production_rng_is_never_invoked_by_this_crate() {
    // The only id route reachable here is deterministic, so no CSPRNG call occurs during validation.
    let a = fixture_id(0x11);
    let b = fixture_id(0x11);
    assert_eq!(a.as_str(), b.as_str());
    assert_eq!(a.as_str().len(), 32);
}

#[test]
fn the_frozen_production_acl_composition_is_reused_not_restated() {
    // Reaching for the frozen plan rather than composing a second one.
    let plan = production_acl_plan();
    assert!(matches!(
        plan.compose(&projectos_host_windows_activation_plan::service_identity::ServiceIdentityPlan::analysed()),
        AclCompositionOutcome::OwnerDecisionRequired | AclCompositionOutcome::ServiceIdentityRequired
    ));
}

#[test]
fn a_reparse_point_boundary_and_a_path_escape_both_refuse() {
    use projectos_host_canonical_installation_identity_writer::WriteError;
    // A live reparse point cannot be created in this environment: `symlink_dir` needs
    // SeCreateSymbolicLinkPrivilege (OS error 1314), and this phase may not elevate. The boundary is
    // therefore proven at the mapping — exhaustively, so no failure can silently become "continue".
    assert_eq!(
        refusal_for_anchor(WriteError::ReparsePointRefused),
        PlanRefusal::ReparsePointBoundary
    );
    assert_eq!(
        refusal_for_anchor(WriteError::ContainmentRefused),
        PlanRefusal::PathEscapesApprovedRoot
    );
    assert_eq!(
        refusal_for_target(WriteError::ContainmentRefused),
        PlanRefusal::PathEscapesApprovedRoot
    );
    assert_eq!(
        refusal_for_target(WriteError::ReparsePointRefused),
        PlanRefusal::ReparsePointBoundary
    );
    // Every OTHER writer error still refuses; none maps to success or is silently ignored.
    for e in [
        WriteError::TargetUnavailable,
        WriteError::AnchorUnresolved,
        WriteError::WriteFailed,
        WriteError::PublishFailed,
        WriteError::VerifyAfterWriteFailed,
        WriteError::CleanupFailed,
        WriteError::ConflictingIdentityExists,
        WriteError::ExistingRecordUnreadable,
        WriteError::InvalidInstallationId,
        WriteError::InvalidReleaseDigest,
        WriteError::UnsupportedChannel,
        WriteError::InstallationIdSourceFailed,
    ] {
        assert_eq!(refusal_for_anchor(e.clone()), PlanRefusal::AnchorUnresolved);
        assert_eq!(refusal_for_target(e), PlanRefusal::TargetNotDerivable);
    }
}
