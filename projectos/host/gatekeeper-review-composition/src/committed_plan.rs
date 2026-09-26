//! HOST-SIDE INGESTION OF THE COMMITTED APPROVED PLAN — PROJECTOS-HOST-REVIEW-PATH1B, criterion 21.
//!
//! ## What "the plan" is to the Host
//!
//! ONE COMMITTED FILE, in the Host's OWN persisted record shape ([`PlanRecordDto`], persistence
//! schema 2 — no second plan system), at the contract path [`COMMITTED_HOST_PLAN_PATH`], read
//! through the ONE committed-file reader (hooks, replacement references and ambient configuration
//! all disabled by that reader's fixed environment). Working-tree bytes are unreadable by
//! construction: the reader answers only from the pinned commit's object store.
//!
//! ## What makes it TRUE rather than merely well-formed
//!
//! The governed worktree is implementer-writable, so a parseable record proves nothing. Every fact
//! the Host takes from it is re-derived and then bound to the OWNER'S SIGNATURE:
//!
//! * the candidate is re-normalised by core's own [`normalize_candidate`] and its phase-definition
//!   digest RECOMPUTED by core's own [`phase_definition_digest_hex`] — the record's stored digest
//!   must match, so no field of the definition can drift from what was digested;
//! * that recomputed digest must equal, byte for byte, the `plan_digest` the owner SIGNED into the
//!   programme delegation (a V2 digest, so the approved baseline is inside it);
//! * the plan reference and phase id must hash — under the canonical
//!   `projectos.programme-identity.v1` rule — to the delegation's signed `plan` digest and one of
//!   its signed `allowed_phases`.
//!
//! An implementer who edits ANY of it therefore needs a new owner signature, not a new file.
//!
//! ## Two layers, deliberately
//!
//! [`CommittedPlanAuthority::establish`] takes the expected digests as PLAIN VALUES so every gate is
//! provable from any test without a signing ceremony. The production wrapper
//! [`ingest_committed_plan`] is the only other entry, and it derives those values EXCLUSIVELY from a
//! sealed [`VerifiedOwnerProgrammeDelegation`] — a type with no production constructor outside the
//! one O12-pinned verification order — and reads the bytes at the contract path. It contains no
//! decision of its own.

use projectos_host_core::{
    normalize_candidate, phase_definition_digest_hex, ApprovedPlanStatus, PLAN_SCHEMA_VERSION,
};
use projectos_host_identity::{phase_identity_digest, plan_identity_digest};
use projectos_host_persistence::PlanRecordDto;
use projectos_host_repository::{CommittedFileReader, CommittedPath};
use projectos_host_windows_local_ipc::{
    HostPlanAuthority, VerifiedOwnerProgrammeDelegation, BASELINE_COMMIT_LEN,
};

/// The one committed location of the Host-shaped approved-plan record, relative to the governed
/// repository root. Fixed: no caller, configuration or record names a different one.
pub const COMMITTED_HOST_PLAN_PATH: &str = ".projectops/host-approved-plan.v2.json";

/// Why the committed plan was not ingested. Closed and payload-free: a refusal never quotes the
/// implementer-writable record back out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum CommittedPlanRefusal {
    /// The committed bytes could not be read at the contract path of the pinned commit.
    RecordUnreadable,
    /// The bytes are not a valid persisted plan record (parse, schema or field rules).
    RecordInvalid,
    /// The record is not a committed, ACTIVE plan.
    NotCommittedActive,
    /// The candidate does not re-normalise, or its recomputed phase-definition digest does not
    /// match the record's own stored digest.
    DigestMismatch,
    /// The record does not carry the plan, the phase-definition digest or a phase the owner signed.
    NotTheSignedPlan,
    /// The approved baseline is absent or malformed. The unattended review has no candidate range
    /// without it, and a V2 digest match without a decodable baseline is a record error.
    BaselineUnavailable,
}

/// The Host's plan authority, established from the committed record and bound to owner-signed
/// digests. Sealed by privacy: every field is derived here and read-only.
pub struct CommittedPlanAuthority {
    plan: [u8; 32],
    plan_digest: [u8; 32],
    phase: [u8; 32],
    baseline: [u8; BASELINE_COMMIT_LEN],
    plan_ref: String,
    version: u64,
    phase_id: String,
    record: PlanRecordDto,
}

impl core::fmt::Debug for CommittedPlanAuthority {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("CommittedPlanAuthority([REDACTED])")
    }
}

/// One lower-hex byte pair.
fn hex_pair(b: &[u8]) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            _ => None,
        }
    }
    if b.len() % 2 != 0 {
        return None;
    }
    b.chunks(2)
        .map(|p| Some(val(p[0])? << 4 | val(p[1])?))
        .collect()
}

impl CommittedPlanAuthority {
    /// Establish the plan authority from record BYTES and the EXPECTED owner-signed digests.
    ///
    /// Every gate below runs on every call, in this order, and each failure is one closed refusal:
    /// parse → schema/field rules → committed+ACTIVE → re-normalise → recompute digest → stored
    /// digest match → signed plan/digest/phase match → baseline decode.
    ///
    /// # Errors
    /// [`CommittedPlanRefusal`] naming the first gate that refused.
    pub fn establish(
        bytes: &[u8],
        signed_plan: &[u8; 32],
        signed_plan_digest: &[u8; 32],
        signed_phases: &[[u8; 32]],
    ) -> Result<Self, CommittedPlanRefusal> {
        let record =
            PlanRecordDto::parse_json(bytes).map_err(|_| CommittedPlanRefusal::RecordInvalid)?;
        record
            .validate()
            .map_err(|_| CommittedPlanRefusal::RecordInvalid)?;
        if record.schema_version != PLAN_SCHEMA_VERSION {
            return Err(CommittedPlanRefusal::RecordInvalid);
        }

        // COMMITTED AND ACTIVE, by the record's own vocabulary. The stored status is untrusted; it
        // gates nothing downstream on its own — the signed digest below is what admits the plan —
        // but a record that does not even CLAIM to be the active committed plan is refused here.
        let core_dto = projectos_host_plan_durable_store::to_core_dto(&record)
            .map_err(|_| CommittedPlanRefusal::RecordInvalid)?;
        if !core_dto.committed || core_dto.status != ApprovedPlanStatus::Active {
            return Err(CommittedPlanRefusal::NotCommittedActive);
        }

        // RE-NORMALISE AND RECOMPUTE, with core's own rules — the only definition of the digest.
        let normalized = normalize_candidate(&core_dto.candidate)
            .map_err(|_| CommittedPlanRefusal::DigestMismatch)?;
        let recomputed =
            phase_definition_digest_hex(&normalized, &core_dto.plan_ref, core_dto.version);
        if recomputed != core_dto.stored_digest_hex {
            return Err(CommittedPlanRefusal::DigestMismatch);
        }
        let digest_bytes: [u8; 32] = hex_pair(recomputed.as_bytes())
            .and_then(|v| v.try_into().ok())
            .ok_or(CommittedPlanRefusal::DigestMismatch)?;

        // THE OWNER'S SIGNATURE IS THE ADMISSION. Plan identity, the exact phase-definition digest
        // and phase membership must all be the signed values; any edit to the record moves at least
        // one of them.
        let plan = plan_identity_digest(core_dto.plan_ref.as_str());
        let phase = phase_identity_digest(&core_dto.candidate.phase_id);
        if plan != *signed_plan
            || digest_bytes != *signed_plan_digest
            || !signed_phases.contains(&phase)
        {
            return Err(CommittedPlanRefusal::NotTheSignedPlan);
        }

        // THE BASELINE, decoded once. Required: the unattended review is the difference from this
        // commit, and the owner signed a V2 digest that covers it.
        let baseline_hex = core_dto
            .candidate
            .approved_baseline
            .as_deref()
            .ok_or(CommittedPlanRefusal::BaselineUnavailable)?;
        let baseline: [u8; BASELINE_COMMIT_LEN] = hex_pair(baseline_hex.as_bytes())
            .and_then(|v| v.try_into().ok())
            .ok_or(CommittedPlanRefusal::BaselineUnavailable)?;

        Ok(Self {
            plan,
            plan_digest: digest_bytes,
            phase,
            baseline,
            plan_ref: core_dto.plan_ref.as_str().to_string(),
            version: core_dto.version.0,
            phase_id: core_dto.candidate.phase_id.clone(),
            record,
        })
    }

    /// The plan reference the record names (matched to the signed plan identity digest).
    #[must_use]
    pub fn plan_ref(&self) -> &str {
        &self.plan_ref
    }
    /// The plan version the signed digest was computed over.
    #[must_use]
    pub fn version(&self) -> u64 {
        self.version
    }
    /// The phase id (matched to a signed allowed phase).
    #[must_use]
    pub fn phase_id(&self) -> &str {
        &self.phase_id
    }
    /// The validated persisted record, for mirroring into the Host's durable plan store.
    #[must_use]
    pub fn record(&self) -> &PlanRecordDto {
        &self.record
    }

    /// MIRROR the ingested record into the Host's own durable plan store, idempotently.
    ///
    /// The store is the Host-owned restart-safe copy (the ratified §B addition). A record already
    /// present must be BYTE-IDENTICAL under the canonical encoding — a divergent copy refuses, it
    /// is never overwritten. A fresh store receives intent-then-commit, the store's own two-step.
    ///
    /// # Errors
    /// [`CommittedPlanRefusal::NotCommittedActive`] on divergence;
    /// [`CommittedPlanRefusal::RecordUnreadable`] when the store refuses the write or the read-back.
    pub fn mirror_into(
        &self,
        store: &mut projectos_host_plan_durable_store::PlanDurableStore,
    ) -> Result<(), CommittedPlanRefusal> {
        let mine = self
            .record
            .to_json()
            .map_err(|_| CommittedPlanRefusal::RecordUnreadable)?;
        match store.load(&self.plan_ref, self.version) {
            Ok(existing) => {
                let theirs = existing
                    .to_json()
                    .map_err(|_| CommittedPlanRefusal::RecordUnreadable)?;
                if theirs != mine {
                    return Err(CommittedPlanRefusal::NotCommittedActive);
                }
                return Ok(());
            }
            // ONLY a proven absence proceeds to the fresh write. A copy that exists but cannot be
            // read (corruption, I/O) is a question for the owner, never something to overwrite.
            Err(projectos_host_plan_durable_store::PlanStoreError::NotFound) => {}
            Err(_) => return Err(CommittedPlanRefusal::RecordUnreadable),
        }
        let mut intent = self.record.clone();
        intent.committed = false;
        store
            .begin_intent(&intent)
            .map_err(|_| CommittedPlanRefusal::RecordUnreadable)?;
        store
            .commit(&self.record)
            .map_err(|_| CommittedPlanRefusal::RecordUnreadable)?;
        Ok(())
    }
}

impl HostPlanAuthority for CommittedPlanAuthority {
    fn plan(&self) -> Option<[u8; 32]> {
        Some(self.plan)
    }
    fn plan_digest(&self) -> Option<[u8; 32]> {
        Some(self.plan_digest)
    }
    fn phase(&self) -> Option<[u8; 32]> {
        Some(self.phase)
    }
    fn approved_baseline(&self) -> Option<[u8; BASELINE_COMMIT_LEN]> {
        Some(self.baseline)
    }
}

/// THE PRODUCTION ENTRY: read the committed record at the contract path of the pinned commit and
/// establish it against the digests the OWNER SIGNED into the programme delegation.
///
/// This wrapper decides nothing: the expected values come exclusively from the sealed
/// [`VerifiedOwnerProgrammeDelegation`] (whose only production mint is the O12-pinned verification
/// order), the bytes come exclusively from the one committed-file reader, and every gate lives in
/// [`CommittedPlanAuthority::establish`].
///
/// # Errors
/// [`CommittedPlanRefusal`] naming the first gate that refused.
pub fn ingest_committed_plan(
    reader: &CommittedFileReader,
    delegation: &VerifiedOwnerProgrammeDelegation,
) -> Result<CommittedPlanAuthority, CommittedPlanRefusal> {
    let path = CommittedPath::new(COMMITTED_HOST_PLAN_PATH)
        .map_err(|_| CommittedPlanRefusal::RecordUnreadable)?;
    let bytes = reader
        .committed_bytes(&path)
        .map_err(|_| CommittedPlanRefusal::RecordUnreadable)?;
    let d = delegation.delegation();
    let phases = &d.allowed_phases[..usize::from(d.allowed_phase_count).min(d.allowed_phases.len())];
    CommittedPlanAuthority::establish(&bytes, &d.plan, &d.plan_digest, phases)
}
