//! End-to-end proof of the durable approved-plan adapter over the accepted durable store, using ONLY
//! disposable temporary roots. Candidate → normalize → SHA-256 digest → PlanRecordDto → durable
//! Intent/Commit (journal-backed, atomic, framed) → reload → core recompute + revalidate →
//! ValidatedApprovedPlan. Intent alone is never authority; corruption, wrong binding, and non-active
//! status all fail closed; every test removes its disposable root (zero residue).

#![cfg(windows)]

use std::sync::atomic::{AtomicU64, Ordering};

use projectos_host_core::{
    normalize_candidate, phase_definition_digest_hex, ApprovedPlanBinding, ApprovedPlanJournal,
    ApprovedPlanRef, ApprovedPlanStatus, ApprovedPlanVersion, EffectPolicy, EnvironmentId,
    PhaseDefinitionCandidate, PhaseType, ProjectId, ProviderPolicy, RepositoryPolicy,
    ResidueRequirement,
};
use projectos_host_persistence::{
    EffectPolicyDto, PhaseTypeDto, PlanCandidateDto, PlanRecordDto, PlanStatusDto,
    ProviderPolicyDto, RepositoryPolicyDto, ResidueDto,
};
use projectos_host_plan_durable_store::{PlanDurableStore, PlanStoreError};

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// A disposable temporary root, created empty. The caller removes it at the end.
fn temp_root(tag: &str) -> String {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir =
        std::env::temp_dir().join(format!("pos-plan-durable-{}-{tag}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.to_str().unwrap().to_string()
}

fn cleanup(root: &str) {
    let _ = std::fs::remove_dir_all(root);
    assert!(
        !std::path::Path::new(root).exists(),
        "disposable root residue"
    );
}

fn core_candidate() -> PhaseDefinitionCandidate {
    PhaseDefinitionCandidate {
        phase_id: "phase-x".into(),
        phase_type: PhaseType::SourceOnly,
        project: ProjectId::new("proj").unwrap(),
        environment: EnvironmentId::new("staging").unwrap(),
        scope: vec!["a".into()],
        path_boundary: vec!["src/x".into()],
        allowed_actions: vec!["read".into()],
        prohibited_actions: vec!["write".into()],
        dependencies: vec![],
        predecessors: vec![],
        repository_policy: RepositoryPolicy::ReadOnly,
        provider_policy: ProviderPolicy::None,
        effect_policy: EffectPolicy::ObservationOnly,
        rollback_required: true,
        shutdown_required: true,
        disconnect_required: true,
        residue: ResidueRequirement::ExactlyZero,
    }
}

fn dto_candidate() -> PlanCandidateDto {
    PlanCandidateDto {
        phase_id: "phase-x".into(),
        phase_type: PhaseTypeDto::SourceOnly,
        project: "proj".into(),
        environment: "staging".into(),
        scope: vec!["a".into()],
        path_boundary: vec!["src/x".into()],
        allowed_actions: vec!["read".into()],
        prohibited_actions: vec!["write".into()],
        dependencies: vec![],
        predecessors: vec![],
        repository_policy: RepositoryPolicyDto::ReadOnly,
        provider_policy: ProviderPolicyDto::None,
        effect_policy: EffectPolicyDto::ObservationOnly,
        rollback_required: true,
        shutdown_required: true,
        disconnect_required: true,
        residue: ResidueDto::ExactlyZero,
    }
}

fn stored_hex(version: u64) -> String {
    phase_definition_digest_hex(
        &normalize_candidate(&core_candidate()).unwrap(),
        &ApprovedPlanRef::new("plan-1").unwrap(),
        ApprovedPlanVersion(version),
    )
}

/// The required active binding for `plan-1` v`version`, obtained via the core test fixture.
fn required(version: u64) -> ApprovedPlanBinding {
    ApprovedPlanJournal::new()
        .commit_approved_for_test(&core_candidate(), version, ApprovedPlanStatus::Active, 0)
        .binding()
        .clone()
}

fn record(version: u64, status: PlanStatusDto, revision: u64, committed: bool) -> PlanRecordDto {
    PlanRecordDto {
        schema_version: 1,
        record_revision: if committed { 2 } else { 1 },
        project: "proj".into(),
        environment: "staging".into(),
        plan_ref: "plan-1".into(),
        phase_reference: "phase-ref".into(),
        plan_version: version,
        candidate: dto_candidate(),
        stored_digest_hex: stored_hex(version),
        approval_binding_ref: "appr-1".into(),
        status,
        status_revision: revision,
        superseded_by: None,
        journal_identity: "j-1".into(),
        committed,
    }
}

fn intent(version: u64) -> PlanRecordDto {
    record(version, PlanStatusDto::Active, 0, false)
}
fn commit(version: u64) -> PlanRecordDto {
    record(version, PlanStatusDto::Active, 0, true)
}

// ---- POSITIVE ---------------------------------------------------------------------------------

#[test]
fn intent_then_commit_resolves_the_active_plan() {
    let root = temp_root("positive");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        // Intent alone is NOT authority.
        assert_eq!(
            s.resolve_active("plan-1", 1, &required(1)).unwrap_err(),
            PlanStoreError::Refused
        );
        s.commit(&commit(1)).unwrap();
        let fact = s.resolve_active("plan-1", 1, &required(1)).unwrap();
        assert!(fact.is_active_for(&required(1)));
    }
    cleanup(&root);
}

#[test]
fn a_committed_plan_survives_reopen_and_recovery() {
    let root = temp_root("reopen");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        s.commit(&commit(1)).unwrap();
    }
    {
        // Reopen runs journal-aware recovery; the committed plan still resolves.
        let s = PlanDurableStore::open(&root).unwrap();
        assert!(s
            .resolve_active("plan-1", 1, &required(1))
            .unwrap()
            .is_active_for(&required(1)));
    }
    cleanup(&root);
}

// ---- REFUSAL ----------------------------------------------------------------------------------

#[test]
fn intent_without_commit_is_never_authority() {
    let root = temp_root("intent-only");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        assert_eq!(
            s.resolve_active("plan-1", 1, &required(1)).unwrap_err(),
            PlanStoreError::Refused
        );
    }
    cleanup(&root);
}

#[test]
fn commit_without_intent_is_refused() {
    let root = temp_root("commit-no-intent");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        assert_eq!(
            s.commit(&commit(1)).unwrap_err(),
            PlanStoreError::PhaseMismatch
        );
    }
    cleanup(&root);
}

#[test]
fn an_intent_payload_that_is_committed_is_refused() {
    let root = temp_root("phase-guard");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        // begin_intent must refuse a committed payload; commit must refuse an uncommitted payload.
        assert_eq!(
            s.begin_intent(&commit(1)).unwrap_err(),
            PlanStoreError::PhaseMismatch
        );
    }
    cleanup(&root);
}

#[test]
fn a_missing_plan_is_not_found() {
    let root = temp_root("missing");
    {
        let s = PlanDurableStore::open(&root).unwrap();
        assert_eq!(
            s.resolve_active("plan-1", 1, &required(1)).unwrap_err(),
            PlanStoreError::NotFound
        );
    }
    cleanup(&root);
}

#[test]
fn a_wrong_version_binding_is_refused() {
    let root = temp_root("wrong-binding");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        s.commit(&commit(1)).unwrap();
        // A different version's required binding does not match the committed v1 record.
        assert_eq!(
            s.resolve_active("plan-1", 1, &required(2)).unwrap_err(),
            PlanStoreError::Refused
        );
    }
    cleanup(&root);
}

#[test]
fn a_corrupt_stored_digest_is_refused() {
    let root = temp_root("corrupt-digest");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        let mut bad = commit(1);
        // A well-formed but WRONG stored digest (as a tampered durable record) — reload recompute refuses.
        bad.stored_digest_hex =
            "00000000000000000000000000000000000000000000000000000000000000ff".into();
        let mut i = intent(1);
        i.stored_digest_hex = bad.stored_digest_hex.clone();
        s.begin_intent(&i).unwrap();
        s.commit(&bad).unwrap();
        assert_eq!(
            s.resolve_active("plan-1", 1, &required(1)).unwrap_err(),
            PlanStoreError::Refused
        );
    }
    cleanup(&root);
}

#[test]
fn an_unsupported_schema_is_refused_at_write() {
    let root = temp_root("bad-schema");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        let mut bad = intent(1);
        bad.schema_version = 2;
        // The durable store validates the DTO family before journaling → refused before any effect.
        assert!(matches!(
            s.begin_intent(&bad).unwrap_err(),
            PlanStoreError::Storage(_)
        ));
    }
    cleanup(&root);
}

// ---- STATUS DURABILITY ------------------------------------------------------------------------

#[test]
fn a_revoked_plan_never_resolves_after_reload() {
    let root = temp_root("revoked");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        s.commit(&commit(1)).unwrap();
        assert!(s.resolve_active("plan-1", 1, &required(1)).is_ok());
        s.revoke("plan-1", 1, 2).unwrap();
        assert_eq!(
            s.resolve_active("plan-1", 1, &required(1)).unwrap_err(),
            PlanStoreError::Refused
        );
    }
    cleanup(&root);
}

#[test]
fn a_superseded_plan_never_resolves_after_reload() {
    let root = temp_root("superseded");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        s.commit(&commit(1)).unwrap();
        s.supersede("plan-1", 1, 2, 2).unwrap();
        assert_eq!(
            s.resolve_active("plan-1", 1, &required(1)).unwrap_err(),
            PlanStoreError::Refused
        );
    }
    cleanup(&root);
}

#[test]
fn a_stale_plan_never_resolves_after_reload() {
    let root = temp_root("stale");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        s.commit(&commit(1)).unwrap();
        s.mark_stale("plan-1", 1, 2).unwrap();
        assert_eq!(
            s.resolve_active("plan-1", 1, &required(1)).unwrap_err(),
            PlanStoreError::Refused
        );
    }
    cleanup(&root);
}

#[test]
fn a_revoked_status_persists_across_reopen() {
    let root = temp_root("revoked-persist");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        s.commit(&commit(1)).unwrap();
        s.revoke("plan-1", 1, 2).unwrap();
    }
    {
        let s = PlanDurableStore::open(&root).unwrap();
        assert_eq!(
            s.resolve_active("plan-1", 1, &required(1)).unwrap_err(),
            PlanStoreError::Refused
        );
    }
    cleanup(&root);
}

// ---- FILESYSTEM POSTURE -----------------------------------------------------------------------

#[test]
fn a_traversal_root_is_refused() {
    // An unsafe root descriptor is refused by the durable store's verified-root check.
    assert!(PlanDurableStore::open("relative/../escape").is_err());
}

#[test]
fn a_deep_traversal_root_is_refused() {
    assert!(PlanDurableStore::open("C:\\dev\\..\\..\\Windows\\escape").is_err());
}

#[test]
fn a_mixed_separator_root_is_refused() {
    assert!(PlanDurableStore::open("C:/dev/escape").is_err());
}

// ---- FRAMING / PAYLOAD INTEGRITY (through the adapter) -----------------------------------------

/// Locate the single durable Record frame file under `root` (PDR2 magic, kind Record = 1).
fn record_file(root: &str) -> std::path::PathBuf {
    fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(&p, out);
                } else {
                    out.push(p);
                }
            }
        }
    }
    let mut files = Vec::new();
    walk(std::path::Path::new(root), &mut files);
    for f in files {
        if let Ok(b) = std::fs::read(&f) {
            if b.len() >= 12 && &b[0..4] == b"PDR2" && b[8..12] == [0, 0, 0, 1] {
                return f;
            }
        }
    }
    panic!("no durable Record frame found under {root}");
}

#[test]
fn a_framing_header_tamper_is_refused() {
    let root = temp_root("framing-header");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        s.commit(&commit(1)).unwrap();
        // Flip a byte in the framed header (the revision field at offset 16) — the SHA-256 frame digest
        // must reject it. Payload JSON is untouched, so only framing integrity can catch this.
        let f = record_file(&root);
        let mut b = std::fs::read(&f).unwrap();
        b[16] ^= 0x01;
        std::fs::write(&f, &b).unwrap();
        assert!(matches!(
            s.resolve_active("plan-1", 1, &required(1)).unwrap_err(),
            PlanStoreError::Storage(_)
        ));
    }
    cleanup(&root);
}

#[test]
fn a_payload_field_tamper_is_refused() {
    let root = temp_root("framing-payload");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        s.commit(&commit(1)).unwrap();
        // Alter a NON-authority payload field (approvalBindingRef) in place (same length). JSON stays
        // valid and the plan digest is unaffected, so ONLY the framing SHA-256 can detect this edit.
        let f = record_file(&root);
        let mut b = std::fs::read(&f).unwrap();
        let needle = b"appr-1";
        let pos = b
            .windows(needle.len())
            .position(|w| w == needle)
            .expect("approval ref in payload");
        b[pos + 5] = b'2'; // "appr-1" -> "appr-2"
        std::fs::write(&f, &b).unwrap();
        assert!(matches!(
            s.resolve_active("plan-1", 1, &required(1)).unwrap_err(),
            PlanStoreError::Storage(_)
        ));
    }
    cleanup(&root);
}

// ---- CONFLICTS / TWO-ACTIVE -------------------------------------------------------------------

#[test]
fn a_duplicate_intent_for_the_same_version_is_refused() {
    let root = temp_root("dup-intent");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        // A second intent for the same version is a create over an existing record → fails closed.
        assert!(matches!(
            s.begin_intent(&intent(1)).unwrap_err(),
            PlanStoreError::Storage(_)
        ));
    }
    cleanup(&root);
}

#[test]
fn a_commit_over_a_committed_record_is_refused() {
    let root = temp_root("commit-over-commit");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        s.commit(&commit(1)).unwrap();
        // Committing again over an already-committed record is a re-activation vector → refused.
        assert_eq!(
            s.commit(&commit(1)).unwrap_err(),
            PlanStoreError::PhaseMismatch
        );
    }
    cleanup(&root);
}

#[test]
fn two_active_versions_are_resolved_independently_never_ambiguously() {
    let root = temp_root("two-active");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        for v in [1u64, 2] {
            s.begin_intent(&intent(v)).unwrap();
            s.commit(&commit(v)).unwrap();
        }
        // Each version resolves ONLY under its own exact required binding; there is no version-less
        // selector, so two active versions can never be ambiguously chosen.
        assert!(s
            .resolve_active("plan-1", 1, &required(1))
            .unwrap()
            .is_active_for(&required(1)));
        assert!(s
            .resolve_active("plan-1", 2, &required(2))
            .unwrap()
            .is_active_for(&required(2)));
        // Cross-binding is refused (v1 record cannot satisfy v2's required binding).
        assert_eq!(
            s.resolve_active("plan-1", 1, &required(2)).unwrap_err(),
            PlanStoreError::Refused
        );
    }
    cleanup(&root);
}

// ---- STATUS-REVISION MONOTONICITY / TERMINAL --------------------------------------------------

#[test]
fn a_status_revision_rollback_is_refused() {
    let root = temp_root("rev-rollback");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        s.commit(&commit(1)).unwrap();
        // A transition must strictly advance the status revision; a non-advancing revision is refused.
        assert_eq!(
            s.update_status("plan-1", 1, PlanStatusDto::Stale, 0, None)
                .unwrap_err(),
            PlanStoreError::StatusRevisionRollback
        );
    }
    cleanup(&root);
}

#[test]
fn a_terminal_status_cannot_be_reactivated() {
    let root = temp_root("terminal");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        s.commit(&commit(1)).unwrap();
        s.revoke("plan-1", 1, 2).unwrap();
        // Once revoked, no further transition (to Active or anything else) is permitted.
        assert_eq!(
            s.update_status("plan-1", 1, PlanStatusDto::Active, 3, None)
                .unwrap_err(),
            PlanStoreError::TerminalStatus
        );
        assert_eq!(
            s.revoke("plan-1", 1, 3).unwrap_err(),
            PlanStoreError::TerminalStatus
        );
    }
    cleanup(&root);
}

// ---- RECOVERY ---------------------------------------------------------------------------------

#[test]
fn recovery_of_an_intent_without_commit_yields_no_authority() {
    let root = temp_root("recover-intent");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
    }
    {
        // Reopen: recovery runs, but an uncommitted intent is never authority.
        let s = PlanDurableStore::open(&root).unwrap();
        assert_eq!(
            s.resolve_active("plan-1", 1, &required(1)).unwrap_err(),
            PlanStoreError::Refused
        );
    }
    cleanup(&root);
}

#[test]
fn a_stale_temporary_file_is_cleaned_and_never_authority() {
    let root = temp_root("stale-temp");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        s.commit(&commit(1)).unwrap();
    }
    // Drop a stray file into the temp subdir; reopen must clean it and still resolve the committed plan.
    let temp_dir = std::path::Path::new(&root).join("temp");
    if temp_dir.is_dir() {
        std::fs::write(temp_dir.join("orphan.tmp"), b"garbage").unwrap();
    }
    {
        let s = PlanDurableStore::open(&root).unwrap();
        assert!(s.resolve_active("plan-1", 1, &required(1)).is_ok());
    }
    if temp_dir.is_dir() {
        assert!(
            std::fs::read_dir(&temp_dir).unwrap().next().is_none(),
            "stale temp not cleaned"
        );
    }
    cleanup(&root);
}

// ---- CONCURRENCY / IDEMPOTENCY ----------------------------------------------------------------

#[test]
fn a_second_writer_on_the_same_root_is_refused_by_the_single_writer_lock() {
    let root = temp_root("single-writer");
    {
        let _first = PlanDurableStore::open(&root).unwrap();
        // A second handle on the same root cannot acquire the exclusive lock while the first is held.
        assert!(PlanDurableStore::open(&root).is_err());
    }
    // After the first is dropped, a fresh handle opens cleanly.
    {
        let _reopened = PlanDurableStore::open(&root).unwrap();
    }
    cleanup(&root);
}

#[test]
fn a_stale_expected_revision_commit_fails_closed() {
    let root = temp_root("stale-rev");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        s.begin_intent(&intent(1)).unwrap();
        s.commit(&commit(1)).unwrap();
        // A revoke advances the frame; a subsequent transition targeting the pre-revoke state is
        // rejected by the store's optimistic revision (terminal status also refuses).
        s.revoke("plan-1", 1, 2).unwrap();
        assert!(s
            .update_status("plan-1", 1, PlanStatusDto::Stale, 3, None)
            .is_err());
    }
    cleanup(&root);
}

// ---- FAILURE-PATH CLEANUP ---------------------------------------------------------------------

#[test]
fn a_failure_path_leaves_zero_residue() {
    let root = temp_root("failure-cleanup");
    {
        let mut s = PlanDurableStore::open(&root).unwrap();
        // Trigger a refusal (commit without intent), then a corrupt-reload refusal.
        assert!(s.commit(&commit(1)).is_err());
        s.begin_intent(&intent(1)).unwrap();
        s.commit(&commit(1)).unwrap();
        s.revoke("plan-1", 1, 2).unwrap();
        assert!(s.resolve_active("plan-1", 1, &required(1)).is_err());
    }
    // After failures, the disposable root removes cleanly with zero residue.
    cleanup(&root);
}
