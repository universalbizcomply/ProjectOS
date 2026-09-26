//! PROJECTOS-HOST-REVIEW-PATH1B, criterion 21 — Host-side ingestion of the COMMITTED approved plan,
//! against a REAL disposable repository.
//!
//! The expected digests handed to `establish` are computed HERE, from first principles, with the
//! same public canonical functions the owner's signing tooling uses (`plan_identity_digest`,
//! `phase_identity_digest`, core's `phase_definition_digest_hex`) — playing the role of the values
//! the owner signs into the programme delegation. The production wrapper differs only in taking
//! them from the sealed `VerifiedOwnerProgrammeDelegation`.

#![cfg(windows)]

use std::path::{Path, PathBuf};
use std::process::Command;

use projectos_host_core::phase_definition_digest_hex;
use projectos_host_gatekeeper_review_composition::committed_plan::{
    CommittedPlanAuthority, CommittedPlanRefusal, COMMITTED_HOST_PLAN_PATH,
};
use projectos_host_identity::{phase_identity_digest, plan_identity_digest};
use projectos_host_persistence::{
    EffectPolicyDto, PhaseTypeDto, PlanCandidateDto, PlanRecordDto, PlanStatusDto,
    ProviderPolicyDto, RepositoryPolicyDto, ResidueDto,
};
use projectos_host_plan_durable_store::{to_core_dto, PlanDurableStore};
use projectos_host_repository::{
    CommitId, CommittedFileReader, CommittedPath, CommittedRevision, RepositoryAdapterConfig,
};
use projectos_host_windows_local_ipc::HostPlanAuthority;

const PLAN_REF: &str = "plan-c21-ingestion";
const VERSION: u64 = 6;
const PHASE_ID: &str = "PROJECTOS-HOST-REVIEW-PATH1B";
const BASELINE: &str = "b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4";

fn temp(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("pos-c21-plan-{}-{tag}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@example.invalid")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@example.invalid")
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn resolve_git() -> String {
    let path = std::env::var_os("PATH").expect("PATH");
    for dir in std::env::split_paths(&path) {
        let cand = dir.join("git.exe");
        if cand.is_file() {
            return cand.to_str().unwrap().to_string();
        }
    }
    panic!("git.exe not found on PATH");
}

fn candidate(baseline: Option<&str>) -> PlanCandidateDto {
    PlanCandidateDto {
        phase_id: PHASE_ID.to_string(),
        phase_type: PhaseTypeDto::SourceOnly,
        project: "projectos".to_string(),
        environment: "development".to_string(),
        scope: vec!["host-review".to_string()],
        path_boundary: vec!["projectos".to_string()],
        allowed_actions: vec!["source-edit".to_string()],
        prohibited_actions: vec!["production-deploy".to_string()],
        dependencies: vec![],
        predecessors: vec![],
        repository_policy: RepositoryPolicyDto::PinnedBaseline,
        provider_policy: ProviderPolicyDto::None,
        effect_policy: EffectPolicyDto::None,
        rollback_required: false,
        shutdown_required: false,
        disconnect_required: false,
        residue: ResidueDto::ExactlyZero,
        approved_baseline: baseline.map(str::to_string),
    }
}

/// A record whose stored digest is RECOMPUTED here with core's own rule, so it is internally true.
fn record(baseline: Option<&str>, status: PlanStatusDto, committed: bool) -> PlanRecordDto {
    let mut dto = PlanRecordDto {
        schema_version: 2,
        record_revision: 1,
        project: "projectos".to_string(),
        environment: "development".to_string(),
        plan_ref: PLAN_REF.to_string(),
        phase_reference: PHASE_ID.to_string(),
        plan_version: VERSION,
        candidate: candidate(baseline),
        stored_digest_hex: "0".repeat(64),
        approval_binding_ref: "PLANDEC-c21".to_string(),
        status,
        status_revision: 1,
        superseded_by: None,
        journal_identity: "journal-c21".to_string(),
        committed,
    };
    let core = to_core_dto(&dto).expect("mappable");
    let normalized = projectos_host_core::normalize_candidate(&core.candidate).expect("normal");
    dto.stored_digest_hex = phase_definition_digest_hex(&normalized, &core.plan_ref, core.version);
    dto
}

/// The digests the OWNER would sign for this record, computed from first principles.
fn signed_for(dto: &PlanRecordDto) -> ([u8; 32], [u8; 32], Vec<[u8; 32]>) {
    let mut digest = [0u8; 32];
    for (i, pair) in dto.stored_digest_hex.as_bytes().chunks(2).enumerate() {
        let hex = std::str::from_utf8(pair).unwrap();
        digest[i] = u8::from_str_radix(hex, 16).unwrap();
    }
    (
        plan_identity_digest(&dto.plan_ref),
        digest,
        vec![phase_identity_digest(&dto.candidate.phase_id)],
    )
}

/// Commit the record into a fresh governed repository and pin a reader at HEAD.
fn committed_reader(dir: &Path, dto: &PlanRecordDto) -> CommittedFileReader {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "core.autocrlf", "false"]);
    let rel = COMMITTED_HOST_PLAN_PATH;
    let abs = dir.join(rel.replace('/', "\\"));
    std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
    std::fs::write(&abs, dto.to_json().unwrap()).unwrap();
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", "the committed host plan"]);
    let head = git(dir, &["rev-parse", "HEAD"]);
    let cfg = RepositoryAdapterConfig::new(&resolve_git(), dir.to_str().unwrap()).unwrap();
    CommittedFileReader::open(&cfg, CommittedRevision::Commit(CommitId::parse(&head).unwrap()))
        .unwrap()
}

fn establish_via_reader(
    reader: &CommittedFileReader,
    signed: &([u8; 32], [u8; 32], Vec<[u8; 32]>),
) -> Result<CommittedPlanAuthority, CommittedPlanRefusal> {
    // The wrapper's own read, spelled out: the contract path, through the one reader.
    let bytes = reader
        .committed_bytes(&CommittedPath::new(COMMITTED_HOST_PLAN_PATH).unwrap())
        .map_err(|_| CommittedPlanRefusal::RecordUnreadable)?;
    CommittedPlanAuthority::establish(&bytes, &signed.0, &signed.1, &signed.2)
}

#[test]
fn the_committed_signed_plan_establishes_and_answers_every_port_question() {
    let dir = temp("positive");
    let dto = record(Some(BASELINE), PlanStatusDto::Active, true);
    let signed = signed_for(&dto);
    let reader = committed_reader(&dir, &dto);

    let authority = establish_via_reader(&reader, &signed).expect("establishes");
    assert_eq!(authority.plan(), Some(signed.0));
    assert_eq!(authority.plan_digest(), Some(signed.1));
    assert_eq!(authority.phase(), Some(signed.2[0]));
    let baseline = authority.approved_baseline().expect("baseline");
    assert_eq!(baseline, [0xb4; 20]);
    assert_eq!(authority.plan_ref(), PLAN_REF);
    assert_eq!(authority.version(), VERSION);
    assert_eq!(authority.phase_id(), PHASE_ID);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn working_tree_bytes_cannot_reach_the_ingestion() {
    let dir = temp("worktree");
    let dto = record(Some(BASELINE), PlanStatusDto::Active, true);
    let signed = signed_for(&dto);
    let reader = committed_reader(&dir, &dto);

    // The implementer rewrites the file in the WORKING TREE - another phase, another baseline.
    let mut tampered = record(Some(&"c".repeat(40)), PlanStatusDto::Active, true);
    tampered.candidate.phase_id = "SOME-OTHER-PHASE".to_string();
    std::fs::write(
        dir.join(COMMITTED_HOST_PLAN_PATH.replace('/', "\\")),
        tampered.to_json().unwrap(),
    )
    .unwrap();

    // The reader answers from the pinned commit's object store; the ingestion is unmoved.
    let authority = establish_via_reader(&reader, &signed).expect("still the committed record");
    assert_eq!(authority.phase_id(), PHASE_ID);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn every_gate_refuses_its_own_failure() {
    let honest = record(Some(BASELINE), PlanStatusDto::Active, true);
    let signed = signed_for(&honest);
    let bytes = |d: &PlanRecordDto| d.to_json().unwrap();

    // A candidate edited after the digest was stored: recompute != stored.
    let mut drifted = honest.clone();
    drifted.candidate.scope = vec!["widened".to_string()];
    assert_eq!(
        CommittedPlanAuthority::establish(bytes(&drifted).as_bytes(), &signed.0, &signed.1, &signed.2)
            .unwrap_err(),
        CommittedPlanRefusal::DigestMismatch
    );

    // Internally consistent records that are NOT what the owner signed.
    let other_phase = {
        let mut c = candidate(Some(BASELINE));
        c.phase_id = "SOME-OTHER-PHASE".to_string();
        let mut d = honest.clone();
        d.candidate = c;
        d.phase_reference = "SOME-OTHER-PHASE".to_string();
        let core = to_core_dto(&d).unwrap();
        let n = projectos_host_core::normalize_candidate(&core.candidate).unwrap();
        d.stored_digest_hex = phase_definition_digest_hex(&n, &core.plan_ref, core.version);
        d
    };
    assert_eq!(
        CommittedPlanAuthority::establish(bytes(&other_phase).as_bytes(), &signed.0, &signed.1, &signed.2)
            .unwrap_err(),
        CommittedPlanRefusal::NotTheSignedPlan
    );
    let mut other_plan = record(Some(BASELINE), PlanStatusDto::Active, true);
    other_plan.plan_ref = "plan-someone-elses".to_string();
    let core = to_core_dto(&other_plan).unwrap();
    let n = projectos_host_core::normalize_candidate(&core.candidate).unwrap();
    other_plan.stored_digest_hex = phase_definition_digest_hex(&n, &core.plan_ref, core.version);
    assert_eq!(
        CommittedPlanAuthority::establish(bytes(&other_plan).as_bytes(), &signed.0, &signed.1, &signed.2)
            .unwrap_err(),
        CommittedPlanRefusal::NotTheSignedPlan
    );

    // Not committed, or not active.
    for d in [
        record(Some(BASELINE), PlanStatusDto::Active, false),
        record(Some(BASELINE), PlanStatusDto::Superseded, true),
    ] {
        assert_eq!(
            CommittedPlanAuthority::establish(bytes(&d).as_bytes(), &signed.0, &signed.1, &signed.2)
                .unwrap_err(),
            CommittedPlanRefusal::NotCommittedActive
        );
    }

    // No baseline: a V1 definition cannot carry the unattended review.
    let v1 = record(None, PlanStatusDto::Active, true);
    let signed_v1 = signed_for(&v1);
    assert_eq!(
        CommittedPlanAuthority::establish(bytes(&v1).as_bytes(), &signed_v1.0, &signed_v1.1, &signed_v1.2)
            .unwrap_err(),
        CommittedPlanRefusal::BaselineUnavailable
    );

    // Not a record at all.
    assert_eq!(
        CommittedPlanAuthority::establish(b"{}".as_slice(), &signed.0, &signed.1, &signed.2).unwrap_err(),
        CommittedPlanRefusal::RecordInvalid
    );
}

#[test]
fn the_ingested_record_mirrors_into_the_host_durable_plan_store_idempotently() {
    let dir = temp("mirror");
    let dto = record(Some(BASELINE), PlanStatusDto::Active, true);
    let signed = signed_for(&dto);
    let authority = CommittedPlanAuthority::establish(
        dto.to_json().unwrap().as_bytes(),
        &signed.0,
        &signed.1,
        &signed.2,
    )
    .expect("establishes");

    let store_root = dir.join("plan-store");
    std::fs::create_dir_all(&store_root).unwrap();
    let mut store = PlanDurableStore::open(store_root.to_str().unwrap()).expect("opens");

    authority.mirror_into(&mut store).expect("first mirror writes");
    authority.mirror_into(&mut store).expect("second mirror is idempotent");
    let loaded = store.load(PLAN_REF, VERSION).expect("read back");
    assert_eq!(loaded.to_json().unwrap(), dto.to_json().unwrap());

    // A DIVERGENT copy already durable for the same (ref, version) is never overwritten.
    let mut divergent_store_root = dir.join("plan-store-divergent");
    std::fs::create_dir_all(&divergent_store_root).unwrap();
    divergent_store_root.push(""); // keep the path a directory string
    let mut store2 =
        PlanDurableStore::open(dir.join("plan-store-divergent").to_str().unwrap()).expect("opens");
    let mut other = record(Some(&"d".repeat(40)), PlanStatusDto::Active, true);
    let core = to_core_dto(&other).unwrap();
    let n = projectos_host_core::normalize_candidate(&core.candidate).unwrap();
    other.stored_digest_hex = phase_definition_digest_hex(&n, &core.plan_ref, core.version);
    let mut intent = other.clone();
    intent.committed = false;
    store2.begin_intent(&intent).unwrap();
    store2.commit(&other).unwrap();
    assert_eq!(
        authority.mirror_into(&mut store2).unwrap_err(),
        CommittedPlanRefusal::NotCommittedActive
    );
    assert_eq!(
        store2.load(PLAN_REF, VERSION).unwrap().to_json().unwrap(),
        other.to_json().unwrap(),
        "the divergent durable copy was left exactly as it was"
    );

    // REVIEW FINDING (2026-09-26): a durable copy that EXISTS but cannot be read is a question for
    // the owner, never something the mirror overwrites. Corrupt the stored bytes on disk (behind
    // the store's back, as real corruption would) and the mirror must refuse - and must leave the
    // corrupt bytes exactly as they were, so the owner can inspect them.
    let corrupt_root = dir.join("plan-store-corrupt");
    std::fs::create_dir_all(&corrupt_root).unwrap();
    let mut store3 = PlanDurableStore::open(corrupt_root.to_str().unwrap()).expect("opens");
    authority.mirror_into(&mut store3).expect("first mirror writes");
    let mut corrupted = Vec::new();
    let mut walk = vec![corrupt_root.clone()];
    while let Some(d) = walk.pop() {
        for entry in std::fs::read_dir(&d).unwrap() {
            let p = entry.unwrap().path();
            if p.is_dir() {
                walk.push(p);
            } else if std::fs::read(&p).is_ok() && std::fs::write(&p, b"{ not a record").is_ok() {
                // A file the live store holds locked (its lock file) is infrastructure, not the
                // record; corruption of the RECORD bytes is what this proves.
                corrupted.push(p);
            }
        }
    }
    assert!(!corrupted.is_empty(), "the mirror stored at least one file to corrupt");
    assert_eq!(
        authority.mirror_into(&mut store3).unwrap_err(),
        CommittedPlanRefusal::RecordUnreadable,
        "an unreadable existing copy refuses; it is never treated as absent and overwritten"
    );
    for p in &corrupted {
        assert_eq!(
            std::fs::read(p).unwrap(),
            b"{ not a record".to_vec(),
            "the corrupt bytes were left in place for the owner"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}
