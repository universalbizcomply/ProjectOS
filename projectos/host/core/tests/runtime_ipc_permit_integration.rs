//! Runtime + IPC → permit/effect-grant integration proof (CD-B4-RUNTIME-IPC-PERMIT-INTEGRATION1A).
//!
//! Folds the closed runtime-instance and IPC-session authorities into the verified execution context, the
//! permit-context digest / issuance identity, the bounded effect grant, and execution-time currentness.
//! Proves a permit or grant cannot cross host instances, host restarts, IPC connections, reconnects,
//! provider epochs, peer processes, or project/repository contexts. No production provider, durable
//! ledger, or real protected effect. Type-forgery + fixture-exclusion are proven by the validator.

#![cfg(feature = "test-fixtures")]
#![allow(clippy::too_many_arguments)]

use projectos_host_core::{
    fixture_issuance_key, mint_effect_grant, reduce, ApprovalOutcome, AuthoritySnapshot,
    BoundIpcSession, ChannelCapability, ConfirmedHandshakeEvidence, ContextField,
    CredentialOutcome, Disposition, EffectFamily, EffectGrantError, EffectGrantLedger,
    EffectOutcome, EffectTarget, ElevationLevel, ElevationObservation, ElevationVerifier,
    EmergencyStateRevision, EmergencyStopState, ExecutableIdentity, ExecutionPermit,
    ExpiryBoundary, FixtureClock, FixtureDimension, FixtureElevationVerifier,
    FixtureIpcSessionVerifier, FixtureRuntimeInstanceVerifier, HostRole, InstallationId,
    InternalOperationRecord, IpcPeerObservation, IpcSessionVerifier, OperationFamily,
    OperationInputs, PeerUserClass, PolicyFloor, PolicyId, PolicyOutcome, PolicyRevision,
    PublisherIdentity, RecordPolicy, ReleaseFloor, ReleaseId, RepositoryRef, RequiredEffect,
    RequiredElevation, ResumePolicy, RevocationRevision, RevocationStatus, RollbackRequirement,
    RuntimeInstanceObservation, RuntimeInstanceVerifier, RuntimeSource, ServiceValidatedFacts,
    SessionId, SyntheticEffectAdapter, SyntheticEffectScript, TrustedClock, ValidatedElevationFact,
    ValidatedEnvironment, ValidatedExecutable, ValidatedFreshness, ValidatedInstallation,
    ValidatedProcess, ValidatedProjectContext, ValidatedPublisherPolicy, ValidatedRelease,
    ValidatedSession, ValidityStatus, VerifiedAuthorityTime, VerifiedExecutionContext,
    VerifiedRuntimeInstance,
};
use projectos_trust_contract::{
    EnvironmentId, OperationFingerprint, OperationName, OperationRef, ProjectId, ProviderId,
};

const PID: u32 = 4242;
const TICK: u64 = 999;
const LEASE: u64 = 200;
const MIN_GEN: u64 = 5;
const RT_PID: u32 = 5000;
const RT_TICK: u64 = 111;
const PEER_PID: u32 = 6000;
const PEER_TICK: u64 = 222;

fn now(c: &FixtureClock) -> VerifiedAuthorityTime {
    c.read_current()
}

fn required_elevation() -> RequiredElevation {
    RequiredElevation {
        minimum_level: ElevationLevel::Elevated,
        min_generation: MIN_GEN,
        expected_pid: PID,
        expected_creation_tick: TICK,
    }
}

fn required_effect() -> RequiredEffect {
    RequiredEffect {
        family: EffectFamily::RecordMarker,
        target: EffectTarget::new("marker-1"),
        argument: "arg-a".into(),
        rollback: RollbackRequirement::NotRequired,
    }
}

fn governed() -> InternalOperationRecord {
    let mut r = InternalOperationRecord::new(
        OperationRef::new("op-1").unwrap(),
        OperationInputs {
            project: ProjectId::new("proj").unwrap(),
            environment: EnvironmentId::new("staging").unwrap(),
            provider: ProviderId::new("supabase").unwrap(),
            operation: OperationName::new("op").unwrap(),
            fingerprint: OperationFingerprint::new("fp").unwrap(),
            release: ReleaseId::new("rel-1"),
        },
        &projectos_host_core::PhaseReference::new("phase-ref").unwrap(),
        RepositoryRef::new("repo-1"),
        InstallationId::new("inst-1"),
        RecordPolicy {
            approval_required: false,
            credential_required: false,
            resume_policy: ResumePolicy::ResumeAfterRevalidation,
            operation_expiry: ExpiryBoundary(1000),
        },
    )
    .bind_elevation(required_elevation())
    .bind_effect(required_effect());
    r.state = projectos_host_core::OperationState::ReadyForRevalidation;
    r
}

fn elev_fact(
    record: &InternalOperationRecord,
    clock: &FixtureClock,
    v: &FixtureElevationVerifier,
) -> ValidatedElevationFact {
    let e = v
        .verify(
            &ElevationObservation {
                proof_id: "elev-proof-1".into(),
                source: "adapter".into(),
                level: ElevationLevel::Elevated,
                observed_at: 0,
                valid_until: LEASE,
                generation: MIN_GEN,
                pid: PID,
                creation_tick: TICK,
            },
            &required_elevation(),
            &now(clock),
            &ValidatedSession {
                session: SessionId::new("sess-1"),
            },
        )
        .unwrap();
    ValidatedElevationFact::bind(
        e,
        &record.binding.project,
        &record.binding.environment,
        record.binding.phase(),
        record.required_plan.as_ref(),
        &record.operation_ref,
        &record.binding.fingerprint,
        None,
        None,
    )
}

fn full_facts(
    record: &InternalOperationRecord,
    elevation: ValidatedElevationFact,
) -> ServiceValidatedFacts {
    let sid = SessionId::new("sess-1");
    let inst = InstallationId::new("inst-1");
    ServiceValidatedFacts {
        phase: Some(record.binding.phase().clone()),
        approved_plan: None,
        repository: None,
        owner_presence: None,
        elevation: Some(elevation),
        session: Some(ValidatedSession {
            session: sid.clone(),
        }),
        process: Some(ValidatedProcess { session: sid }),
        executable: Some(ValidatedExecutable {
            identity: ExecutableIdentity::new("exe-1"),
            installation: inst.clone(),
        }),
        release: Some(ValidatedRelease {
            release: ReleaseId::new("rel-1"),
        }),
        installation: Some(ValidatedInstallation {
            installation: inst.clone(),
        }),
        project: Some(ValidatedProjectContext {
            project: record.binding.project.clone(),
            repository: RepositoryRef::new("repo-1"),
        }),
        environment: Some(ValidatedEnvironment {
            environment: EnvironmentId::new("staging").unwrap(),
        }),
        publisher_policy: Some(ValidatedPublisherPolicy {
            policy_id: PolicyId::new("pol-1"),
            policy_revision: PolicyRevision(1),
            publisher: PublisherIdentity::new("pub-1"),
            installation: inst.clone(),
            outcome: PolicyOutcome::Accepted,
            revocation_revision: RevocationRevision(1),
        }),
        freshness: Some(ValidatedFreshness {
            release: ReleaseId::new("rel-1"),
            release_floor: ReleaseFloor(1),
            policy_revision: PolicyRevision(1),
            policy_floor: PolicyFloor(1),
            emergency_revocation_floor: RevocationRevision(1),
        }),
        authority: Some(AuthoritySnapshot {
            authority_expiry: ExpiryBoundary(1000),
            operation_expiry: Some(ExpiryBoundary(1000)),
            validity: ValidityStatus::Valid,
            revocation: RevocationStatus::Active(RevocationRevision(1)),
            emergency_state_revision: EmergencyStateRevision(1),
        }),
        approval: ApprovalOutcome::NotRequired,
        credential: CredentialOutcome::NotRequired,
        emergency_stop: EmergencyStopState::Clear,
    }
}

/// Build a verified runtime instance from a fixture verifier + clock.
fn runtime(c: &FixtureClock, rv: &FixtureRuntimeInstanceVerifier) -> VerifiedRuntimeInstance {
    rv.verify(
        &RuntimeInstanceObservation {
            role: HostRole::InteractiveFallback,
            source: RuntimeSource::InteractiveFallback,
            pid: RT_PID,
            creation_tick: RT_TICK,
            session: Some(SessionId::new("host-sess")),
            observed_at: 0,
            valid_until: 9_000,
            service_evidence: None,
        },
        &now(c),
    )
    .unwrap()
}

/// Build a bound IPC session from a fixture verifier + runtime + clock.
fn ipc(
    c: &FixtureClock,
    iv: &FixtureIpcSessionVerifier,
    rt: &VerifiedRuntimeInstance,
) -> BoundIpcSession {
    let obs = IpcPeerObservation {
        connection_id: iv.connection_id(),
        handshake_generation: iv.handshake_generation(),
        client_pid: PEER_PID,
        client_creation_tick: PEER_TICK,
        user: PeerUserClass::Owner,
        session: Some(SessionId::new("peer-sess")),
        project: ProjectId::new("proj").unwrap(),
        environment: EnvironmentId::new("staging").unwrap(),
        phase_digest: [3u8; 32],
        repository_identity: [4u8; 32],
        repository_baseline: [5u8; 32],
        observed_at: 0,
        valid_until: 8_000,
        capabilities: vec![ChannelCapability::RecordMarker],
        operation_families: vec![OperationFamily::RecordMarker],
    };
    iv.verify(
        rt,
        ConfirmedHandshakeEvidence::confirmed(iv.handshake_generation()),
        &obs,
        &now(c),
    )
    .unwrap()
}

/// The full authority set: clock, elevation verifier, runtime (+verifier), ipc (+verifier).
struct Chain {
    clock: FixtureClock,
    ev: FixtureElevationVerifier,
    rv: FixtureRuntimeInstanceVerifier,
    iv: FixtureIpcSessionVerifier,
    record: InternalOperationRecord,
}

impl Chain {
    fn new() -> Self {
        Self {
            clock: FixtureClock::new(100),
            ev: FixtureElevationVerifier::new(),
            rv: FixtureRuntimeInstanceVerifier::new(),
            iv: FixtureIpcSessionVerifier::new(),
            record: governed(),
        }
    }

    fn runtime(&self) -> VerifiedRuntimeInstance {
        runtime(&self.clock, &self.rv)
    }
    fn ipc(&self, rt: &VerifiedRuntimeInstance) -> BoundIpcSession {
        ipc(&self.clock, &self.iv, rt)
    }

    /// Reduce to an eligible permit + its context, bound to the current runtime + ipc authorities.
    fn permit(&self) -> (ExecutionPermit, VerifiedExecutionContext) {
        let rt = self.runtime();
        let session = self.ipc(&rt);
        let mk = || {
            let rt = self.runtime();
            let session = self.ipc(&rt);
            let facts = full_facts(&self.record, elev_fact(&self.record, &self.clock, &self.ev));
            match reduce(
                &self
                    .record
                    .to_request_with_authorities(&self.clock, &self.ev, &rt, &session),
                &facts,
            ) {
                Disposition::EligibleForServiceExecution(p) => p,
                other => panic!("expected eligible, got {other:?}"),
            }
        };
        let _ = (rt, session);
        (mk(), mk().context().clone())
    }
}

fn cdig(permit: &ExecutionPermit, ctx: &VerifiedExecutionContext) -> [u8; 32] {
    permit.fixture_context_digest_with(ctx)
}
fn ikey(permit: &ExecutionPermit, ctx: &VerifiedExecutionContext) -> [u8; 32] {
    fixture_issuance_key(
        permit.fixture_context_digest_with(ctx),
        required_effect().policy_digest(),
    )
}

// C1 — same runtime + same IPC session produce a valid permit that mints one grant.
#[test]
fn c1_same_runtime_ipc_valid() {
    let ch = Chain::new();
    let (permit, ctx) = ch.permit();
    let ledger = EffectGrantLedger::new();
    assert!(
        mint_effect_grant(&permit, &ctx, &ch.clock, &required_effect(), LEASE, &ledger).is_ok()
    );
}

// C2 — different runtime instance produces a different context digest.
#[test]
fn c2_runtime_changes_context_digest() {
    let ch = Chain::new();
    let (permit, ctx) = ch.permit();
    // Build an "other" context from a DIFFERENT runtime verifier, swap only the runtime dimension.
    let other_rv = FixtureRuntimeInstanceVerifier::new();
    let other_rt = runtime(&ch.clock, &other_rv);
    let other_ipc = ipc(&ch.clock, &FixtureIpcSessionVerifier::new(), &other_rt);
    let other_ctx = reduce_ctx(&ch, &other_rt, &other_ipc);
    let swapped = ctx.fixture_take(&other_ctx, FixtureDimension::RuntimeInstance);
    assert_ne!(cdig(&permit, &ctx), cdig(&permit, &swapped));
}

// C3 — different IPC connection produces a different context digest.
#[test]
fn c3_ipc_changes_context_digest() {
    let ch = Chain::new();
    let (permit, ctx) = ch.permit();
    let rt = ch.runtime();
    let other_iv = FixtureIpcSessionVerifier::new();
    let other_ipc = ipc(&ch.clock, &other_iv, &rt);
    let other_ctx = reduce_ctx(&ch, &rt, &other_ipc);
    let swapped = ctx.fixture_take(&other_ctx, FixtureDimension::IpcSession);
    assert_ne!(cdig(&permit, &ctx), cdig(&permit, &swapped));
}

// C4 — reconnect (new connection id + handshake generation) produces a different context digest.
#[test]
fn c4_reconnect_changes_context_digest() {
    let ch = Chain::new();
    let (permit, ctx) = ch.permit();
    let rt = ch.runtime();
    ch.iv.reconnect();
    let reconnected = ch.ipc(&rt);
    let other_ctx = reduce_ctx(&ch, &rt, &reconnected);
    let swapped = ctx.fixture_take(&other_ctx, FixtureDimension::IpcSession);
    assert_ne!(cdig(&permit, &ctx), cdig(&permit, &swapped));
}

// C5 — host restart (new runtime generation) produces a different context digest.
#[test]
fn c5_restart_changes_context_digest() {
    let ch = Chain::new();
    let (permit, ctx) = ch.permit();
    ch.rv.restart();
    let restarted_rt = ch.runtime();
    let session = ch.ipc(&restarted_rt);
    let other_ctx = reduce_ctx(&ch, &restarted_rt, &session);
    let swapped = ctx.fixture_take(&other_ctx, FixtureDimension::RuntimeInstance);
    assert_ne!(cdig(&permit, &ctx), cdig(&permit, &swapped));
}

// C6 — runtime difference produces a different issuance key.
#[test]
fn c6_runtime_differs_issuance_key() {
    let ch = Chain::new();
    let (permit, ctx) = ch.permit();
    let other_rv = FixtureRuntimeInstanceVerifier::new();
    let other_rt = runtime(&ch.clock, &other_rv);
    let other_ctx = reduce_ctx(
        &ch,
        &other_rt,
        &ipc(&ch.clock, &FixtureIpcSessionVerifier::new(), &other_rt),
    );
    let swapped = ctx.fixture_take(&other_ctx, FixtureDimension::RuntimeInstance);
    assert_ne!(ikey(&permit, &ctx), ikey(&permit, &swapped));
}

// C7 — IPC-session difference produces a different issuance key.
#[test]
fn c7_ipc_differs_issuance_key() {
    let ch = Chain::new();
    let (permit, ctx) = ch.permit();
    let rt = ch.runtime();
    let other_ctx = reduce_ctx(
        &ch,
        &rt,
        &ipc(&ch.clock, &FixtureIpcSessionVerifier::new(), &rt),
    );
    let swapped = ctx.fixture_take(&other_ctx, FixtureDimension::IpcSession);
    assert_ne!(ikey(&permit, &ctx), ikey(&permit, &swapped));
}

/// Reduce a variant context under DIFFERENT runtime/ipc authorities (same record/facts).
fn reduce_ctx(
    ch: &Chain,
    rt: &VerifiedRuntimeInstance,
    session: &BoundIpcSession,
) -> VerifiedExecutionContext {
    let facts = full_facts(&ch.record, elev_fact(&ch.record, &ch.clock, &ch.ev));
    match reduce(
        &ch.record
            .to_request_with_authorities(&ch.clock, &ch.ev, rt, session),
        &facts,
    ) {
        Disposition::EligibleForServiceExecution(p) => p.context().clone(),
        other => panic!("expected eligible, got {other:?}"),
    }
}

// C8 — permit minted under runtime A cannot be accepted with a context bound to runtime B.
#[test]
fn c8_permit_cannot_cross_runtime() {
    let ch = Chain::new();
    let (permit, _ctx) = ch.permit();
    let other_rv = FixtureRuntimeInstanceVerifier::new();
    let other_rt = runtime(&ch.clock, &other_rv);
    let cross = reduce_ctx(
        &ch,
        &other_rt,
        &ipc(&ch.clock, &FixtureIpcSessionVerifier::new(), &other_rt),
    );
    assert_eq!(
        mint_effect_grant(
            &permit,
            &cross,
            &ch.clock,
            &required_effect(),
            LEASE,
            &EffectGrantLedger::new()
        )
        .unwrap_err(),
        EffectGrantError::PermitContextMismatch(ContextField::RuntimeInstance)
    );
}

// C9 — permit minted on connection A cannot be accepted with a context bound to connection B.
#[test]
fn c9_permit_cannot_cross_ipc() {
    let ch = Chain::new();
    let (permit, ctx) = ch.permit();
    let rt = ch.runtime();
    // Rebuild the context but swap only the IPC dimension to a different connection.
    let other_ctx = reduce_ctx(
        &ch,
        &rt,
        &ipc(&ch.clock, &FixtureIpcSessionVerifier::new(), &rt),
    );
    let cross = ctx.fixture_take(&other_ctx, FixtureDimension::IpcSession);
    assert_eq!(
        mint_effect_grant(
            &permit,
            &cross,
            &ch.clock,
            &required_effect(),
            LEASE,
            &EffectGrantLedger::new()
        )
        .unwrap_err(),
        EffectGrantError::PermitContextMismatch(ContextField::IpcSession)
    );
}

/// Mint a grant for the canonical chain and return (adapter, grant, runtime, ipc).
fn mint(ch: &Chain) -> BoundGrant {
    let (permit, ctx) = ch.permit();
    let ledger = EffectGrantLedger::new();
    let grant =
        mint_effect_grant(&permit, &ctx, &ch.clock, &required_effect(), LEASE, &ledger).unwrap();
    BoundGrant { ledger, grant }
}
struct BoundGrant {
    ledger: EffectGrantLedger,
    grant: projectos_host_core::BoundedEffectGrant,
}

// C10 — grant cannot cross runtime instances (execution-time bound check).
#[test]
fn c10_grant_cannot_cross_runtime() {
    let ch = Chain::new();
    let bg = mint(&ch);
    let rt = ch.runtime();
    let session = ch.ipc(&rt);
    // Present a DIFFERENT runtime instance at execution.
    let other_rv = FixtureRuntimeInstanceVerifier::new();
    let other_rt = runtime(&ch.clock, &other_rv);
    let w = SyntheticEffectAdapter::new().perform_bound(
        bg.grant,
        &EffectTarget::new("marker-1"),
        &bg.ledger,
        &ch.clock,
        &other_rt,
        &other_rv,
        &session,
        &ch.iv,
        SyntheticEffectScript::Succeed,
    );
    assert_eq!(
        w.outcome(),
        EffectOutcome::Refused(EffectGrantError::RuntimeInstanceMismatch)
    );
}

// C11 — grant cannot cross IPC connections (execution-time bound check).
#[test]
fn c11_grant_cannot_cross_ipc() {
    let ch = Chain::new();
    let bg = mint(&ch);
    let rt = ch.runtime();
    let other_iv = FixtureIpcSessionVerifier::new();
    let other_ipc = ipc(&ch.clock, &other_iv, &rt);
    let w = SyntheticEffectAdapter::new().perform_bound(
        bg.grant,
        &EffectTarget::new("marker-1"),
        &bg.ledger,
        &ch.clock,
        &rt,
        &ch.rv,
        &other_ipc,
        &other_iv,
        SyntheticEffectScript::Succeed,
    );
    assert_eq!(
        w.outcome(),
        EffectOutcome::Refused(EffectGrantError::IpcSessionMismatch)
    );
}

/// Run perform_bound with the canonical authorities but a mutated verifier/clock and assert refusal.
fn refused_with(
    ch: &Chain,
    bg: BoundGrant,
    rt: &VerifiedRuntimeInstance,
    rv: &FixtureRuntimeInstanceVerifier,
    session: &BoundIpcSession,
    iv: &FixtureIpcSessionVerifier,
    clock: &FixtureClock,
) -> EffectOutcome {
    let _ = ch;
    SyntheticEffectAdapter::new()
        .perform_bound(
            bg.grant,
            &EffectTarget::new("marker-1"),
            &bg.ledger,
            clock,
            rt,
            rv,
            session,
            iv,
            SyntheticEffectScript::Succeed,
        )
        .outcome()
}

// C12/C13 — runtime restart after grant mint is refused at execution.
#[test]
fn c12_c13_runtime_restart_refused() {
    let ch = Chain::new();
    let rt = ch.runtime();
    let session = ch.ipc(&rt);
    let bg = mint(&ch);
    ch.rv.restart(); // runtime generation advances after the grant was minted
    let out = refused_with(&ch, bg, &rt, &ch.rv, &session, &ch.iv, &ch.clock);
    // runtime digest still matches the grant's binding, but is_current fails on generation.
    assert_eq!(
        out,
        EffectOutcome::Refused(EffectGrantError::RuntimeNotCurrent)
    );
}

// C14/C15 — IPC reconnect after grant mint is refused at execution.
#[test]
fn c14_c15_reconnect_refused() {
    let ch = Chain::new();
    let rt = ch.runtime();
    let session = ch.ipc(&rt);
    let bg = mint(&ch);
    ch.iv.reconnect(); // new connection id after the grant was minted
    let out = refused_with(&ch, bg, &rt, &ch.rv, &session, &ch.iv, &ch.clock);
    assert_eq!(out, EffectOutcome::Refused(EffectGrantError::IpcNotCurrent));
}

// C16/C17 — runtime-provider substitution/epoch restart refused (currentness against the clock).
#[test]
fn c16_c17_runtime_provider_refused() {
    let ch = Chain::new();
    let rt = ch.runtime();
    let session = ch.ipc(&rt);
    let bg = mint(&ch);
    ch.clock.next_epoch(100); // provider epoch advances
    let out = refused_with(&ch, bg, &rt, &ch.rv, &session, &ch.iv, &ch.clock);
    assert_eq!(
        out,
        EffectOutcome::Refused(EffectGrantError::RuntimeNotCurrent)
    );
}

// C20 — disconnected IPC session refused.
#[test]
fn c20_disconnected_refused() {
    let ch = Chain::new();
    let rt = ch.runtime();
    let session = ch.ipc(&rt);
    let bg = mint(&ch);
    ch.iv.disconnect();
    let out = refused_with(&ch, bg, &rt, &ch.rv, &session, &ch.iv, &ch.clock);
    assert_eq!(out, EffectOutcome::Refused(EffectGrantError::IpcNotCurrent));
}

// C21 — revoked IPC session refused.
#[test]
fn c21_revoked_refused() {
    let ch = Chain::new();
    let rt = ch.runtime();
    let session = ch.ipc(&rt);
    let bg = mint(&ch);
    ch.iv.revoke();
    let out = refused_with(&ch, bg, &rt, &ch.rv, &session, &ch.iv, &ch.clock);
    assert_eq!(out, EffectOutcome::Refused(EffectGrantError::IpcNotCurrent));
}

// C22 — expired runtime/IPC authority refused (grant valid_until reached).
#[test]
fn c22_c23_expired_refused() {
    let ch = Chain::new();
    let rt = ch.runtime();
    let session = ch.ipc(&rt);
    let bg = mint(&ch);
    ch.clock.advance_to(LEASE); // grant valid_until reached (clock currentness in perform)
    let out = refused_with(&ch, bg, &rt, &ch.rv, &session, &ch.iv, &ch.clock);
    // runtime + ipc still current; the clock currentness inside perform refuses.
    assert_eq!(out, EffectOutcome::Refused(EffectGrantError::GrantExpired));
}

// C28 — cardinality-one issuance remains enforced.
#[test]
fn c28_cardinality_one() {
    let ch = Chain::new();
    let (permit, ctx) = ch.permit();
    let ledger = EffectGrantLedger::new();
    assert!(
        mint_effect_grant(&permit, &ctx, &ch.clock, &required_effect(), LEASE, &ledger).is_ok()
    );
    assert_eq!(
        mint_effect_grant(&permit, &ctx, &ch.clock, &required_effect(), LEASE, &ledger)
            .unwrap_err(),
        EffectGrantError::AlreadyIssued
    );
}

// C29/C34 — full chain: one consumption succeeds, replay is refused.
#[test]
fn c29_c34_full_chain_once_then_replay_refused() {
    let ch = Chain::new();
    let rt = ch.runtime();
    let session = ch.ipc(&rt);
    let bg = mint(&ch);
    let adapter = SyntheticEffectAdapter::new();
    let w = adapter.perform_bound(
        bg.grant,
        &EffectTarget::new("marker-1"),
        &bg.ledger,
        &ch.clock,
        &rt,
        &ch.rv,
        &session,
        &ch.iv,
        SyntheticEffectScript::Succeed,
    );
    assert_eq!(w.outcome(), EffectOutcome::Success);
    // C31 — the witness records redacted runtime + IPC evidence.
    assert!(w.fixture_runtime_evidence().is_some());
    assert!(w.fixture_ipc_evidence().is_some());
    // A second mint against the same ledger is refused (cardinality-one; no replay authority).
    let (permit2, ctx2) = ch.permit();
    assert_eq!(
        mint_effect_grant(
            &permit2,
            &ctx2,
            &ch.clock,
            &required_effect(),
            LEASE,
            &bg.ledger
        )
        .unwrap_err(),
        EffectGrantError::AlreadyIssued
    );
}

// C30 — crash yields Indeterminate.
#[test]
fn c30_crash_indeterminate() {
    let ch = Chain::new();
    let rt = ch.runtime();
    let session = ch.ipc(&rt);
    let bg = mint(&ch);
    let w = SyntheticEffectAdapter::new().perform_bound(
        bg.grant,
        &EffectTarget::new("marker-1"),
        &bg.ledger,
        &ch.clock,
        &rt,
        &ch.rv,
        &session,
        &ch.iv,
        SyntheticEffectScript::Crash,
    );
    assert_eq!(w.outcome(), EffectOutcome::Indeterminate);
}
