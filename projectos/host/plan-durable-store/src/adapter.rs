//! The durable approved-plan adapter. A thin, non-authoritative wrapper over the accepted
//! [`DurableProtectedStore`]: it maps approved-plan Intent/Commit and status transitions onto the
//! store's journal-backed, SHA-256-framed, atomic, recoverable record protocol, and derives authority
//! ONLY through `projectos_host_core::validate_durable_plan`. It adds no framing, no journal state
//! machine, no cryptography, and no authority engine.

use projectos_host_core::{validate_durable_plan, ApprovedPlanBinding, ValidatedApprovedPlan};
use projectos_host_persistence::{PlanRecordDto, PlanStatusDto, TargetFamilyDto};
use projectos_host_windows_durable_protected_store::DurableProtectedStore;

use crate::convert::to_core_dto;
use crate::error::PlanStoreError;

/// A durable, non-authoritative store for approved-plan records over one verified trusted root.
#[derive(Debug)]
pub struct PlanDurableStore {
    inner: DurableProtectedStore,
}

/// The stable durable record identity for one plan reference + version. Same across Intent, Commit and
/// every status transition, so the store treats them as revisions of one record.
fn record_id(plan_ref: &str, version: u64) -> Vec<u8> {
    format!("plan-{plan_ref}-{version}").into_bytes()
}

impl PlanDurableStore {
    /// Open (or lay out) a durable plan store at the explicit trusted `root`. Journal-aware recovery
    /// runs here (inherited from the durable store): an interrupted Intent is reconciled, a stale temp
    /// removed, corruption refused.
    ///
    /// # Errors
    /// [`PlanStoreError`] for an invalid root, lock contention, corruption, or required reconciliation.
    pub fn open(root: &str) -> Result<Self, PlanStoreError> {
        Ok(Self {
            inner: DurableProtectedStore::open(root)?,
        })
    }

    /// The current durable store revision.
    #[must_use]
    pub fn current_revision(&self) -> u64 {
        self.inner.current_revision()
    }

    /// Persist an approved-plan INTENT (uncommitted). Refuses a committed payload and refuses to
    /// overwrite an existing record (an intent must open a fresh version). Intent alone is never
    /// authority — the core reload path rejects `!committed`.
    ///
    /// # Errors
    /// [`PlanStoreError::PhaseMismatch`] if `dto.committed`; [`PlanStoreError`] on a storage failure
    /// (including an already-present record).
    pub fn begin_intent(&mut self, dto: &PlanRecordDto) -> Result<u64, PlanStoreError> {
        if dto.committed {
            return Err(PlanStoreError::PhaseMismatch);
        }
        let id = record_id(&dto.plan_ref, dto.plan_version);
        let json = dto.to_json().map_err(|_| PlanStoreError::Malformed)?;
        // `expected = None` → create only; an existing record makes the store refuse (fail closed).
        Ok(self
            .inner
            .put_record(&id, TargetFamilyDto::Plan, None, json.as_bytes())?)
    }

    /// Persist an approved-plan COMMIT. Requires a matching prior Intent record (fails closed on
    /// commit-without-intent) and a committed payload.
    ///
    /// # Errors
    /// [`PlanStoreError::PhaseMismatch`] if `!dto.committed` or no prior Intent exists.
    pub fn commit(&mut self, dto: &PlanRecordDto) -> Result<u64, PlanStoreError> {
        if !dto.committed {
            return Err(PlanStoreError::PhaseMismatch);
        }
        let id = record_id(&dto.plan_ref, dto.plan_version);
        let Some(rev) = self.inner.record_revision(&id)? else {
            return Err(PlanStoreError::PhaseMismatch); // commit without a durable intent
        };
        // The record being committed must currently be an UNCOMMITTED intent. Committing over an
        // already-committed record would be a re-activation / rollback vector — refuse it.
        if self.load(&dto.plan_ref, dto.plan_version)?.committed {
            return Err(PlanStoreError::PhaseMismatch);
        }
        let json = dto.to_json().map_err(|_| PlanStoreError::Malformed)?;
        Ok(self
            .inner
            .put_record(&id, TargetFamilyDto::Plan, Some(rev), json.as_bytes())?)
    }

    /// Load the latest persisted plan record for `plan_ref`/`version` (untrusted).
    ///
    /// # Errors
    /// [`PlanStoreError::NotFound`] if absent; [`PlanStoreError::Malformed`] if the bytes are not a
    /// valid plan DTO; [`PlanStoreError::Storage`] on corruption.
    pub fn load(&self, plan_ref: &str, version: u64) -> Result<PlanRecordDto, PlanStoreError> {
        let id = record_id(plan_ref, version);
        let bytes = self.inner.get_record(&id)?;
        PlanRecordDto::parse_json(&bytes).map_err(|_| PlanStoreError::Malformed)
    }

    /// Resolve the ACTIVE validated approved plan for `plan_ref`/`version`, bound EXACTLY to `required`,
    /// via the accepted core reload path (committed + schema + re-normalize + SHA-256 recompute + active
    /// binding). Any failure is a bounded refusal — the specific cause is not surfaced.
    ///
    /// # Errors
    /// [`PlanStoreError::NotFound`]/[`PlanStoreError::Malformed`]/[`PlanStoreError::Storage`] on load;
    /// [`PlanStoreError::Unconvertible`] if the record cannot be reshaped; [`PlanStoreError::Refused`]
    /// if core revalidation refuses it.
    pub fn resolve_active(
        &self,
        plan_ref: &str,
        version: u64,
        required: &ApprovedPlanBinding,
    ) -> Result<ValidatedApprovedPlan, PlanStoreError> {
        let dto = self.load(plan_ref, version)?;
        let core_dto = to_core_dto(&dto)?;
        validate_durable_plan(&core_dto, required).ok_or(PlanStoreError::Refused)
    }

    /// Durably record a status transition (revoke/supersede/stale) on a committed plan version by
    /// replacing the record with a bumped status revision. The revision must strictly advance; a stored
    /// status edited without advancing the revision cannot pass (the store refuses a non-advancing
    /// replacement, and an old revision reload can never validate as current).
    ///
    /// # Errors
    /// [`PlanStoreError`] on load or storage failure.
    pub fn update_status(
        &mut self,
        plan_ref: &str,
        version: u64,
        new_status: PlanStatusDto,
        new_status_revision: u64,
        superseded_by: Option<u64>,
    ) -> Result<u64, PlanStoreError> {
        let mut dto = self.load(plan_ref, version)?;
        let id = record_id(plan_ref, version);
        let Some(rev) = self.inner.record_revision(&id)? else {
            return Err(PlanStoreError::NotFound);
        };
        // Only a committed, ACTIVE plan may transition, and only to a STRICTLY GREATER status revision.
        // A terminal status (Revoked/Superseded/Stale) can never be re-activated or rolled back.
        if !dto.committed {
            return Err(PlanStoreError::PhaseMismatch);
        }
        if dto.status != PlanStatusDto::Active {
            return Err(PlanStoreError::TerminalStatus);
        }
        if new_status_revision <= dto.status_revision {
            return Err(PlanStoreError::StatusRevisionRollback);
        }
        dto.status = new_status;
        dto.status_revision = new_status_revision;
        dto.superseded_by = superseded_by;
        dto.record_revision = dto.record_revision.saturating_add(1).max(1);
        dto.committed = true;
        let json = dto.to_json().map_err(|_| PlanStoreError::Malformed)?;
        Ok(self
            .inner
            .put_record(&id, TargetFamilyDto::Plan, Some(rev), json.as_bytes())?)
    }

    /// Revoke a committed plan version.
    ///
    /// # Errors
    /// [`PlanStoreError`] on load or storage failure.
    pub fn revoke(
        &mut self,
        plan_ref: &str,
        version: u64,
        new_status_revision: u64,
    ) -> Result<u64, PlanStoreError> {
        self.update_status(
            plan_ref,
            version,
            PlanStatusDto::Revoked,
            new_status_revision,
            None,
        )
    }

    /// Supersede a committed plan version (records the superseding version).
    ///
    /// # Errors
    /// [`PlanStoreError`] on load or storage failure.
    pub fn supersede(
        &mut self,
        plan_ref: &str,
        version: u64,
        new_status_revision: u64,
        superseded_by: u64,
    ) -> Result<u64, PlanStoreError> {
        self.update_status(
            plan_ref,
            version,
            PlanStatusDto::Superseded,
            new_status_revision,
            Some(superseded_by),
        )
    }

    /// Mark a committed plan version stale.
    ///
    /// # Errors
    /// [`PlanStoreError`] on load or storage failure.
    pub fn mark_stale(
        &mut self,
        plan_ref: &str,
        version: u64,
        new_status_revision: u64,
    ) -> Result<u64, PlanStoreError> {
        self.update_status(
            plan_ref,
            version,
            PlanStatusDto::Stale,
            new_status_revision,
            None,
        )
    }
}
