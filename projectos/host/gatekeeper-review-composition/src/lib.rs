//! THE PRODUCTION ADAPTERS behind ProjectOSHost's independent-gatekeeper-review composition.
//!
//! PROJECTOS-HOST-REVIEW-PATH1A. `compose_protected_operation` has always taken its facts through named
//! ports; two of them — `HostPlanAuthority` and `CommittedCandidateSource` — had no production
//! implementation, which is why the host could resolve nothing and every request failed closed. These
//! are those implementations.
//!
//! ## Why this is a separate crate
//!
//! `windows-local-ipc`'s dependency list is closed by an accepted validator, and these adapters need the
//! durable plan store and the repository reader. Depending on them FROM there would need that list
//! widened; implementing its UNSEALED ports from here needs no change at all. The arrow points this way
//! on purpose. (The sealed ports are a different matter and stay in-crate, where their private
//! supertraits are nameable.)
//!
//! ## It mints nothing
//!
//! Every value returned here is a digest. A digest is not authority: `evaluate_protected_operation`
//! still compares the host's facts against the caller's claim and refuses on any disagreement, and
//! nothing in this crate can produce a sealed value, an authority or an attestation.
//!
//! ## `None` is always "could not establish"
//!
//! Every port here returns `Option`, and every `None` means the adapter could not resolve the fact —
//! never that there is nothing wrong. The composition turns that into a refusal. There is no
//! best-effort, no default and no placeholder digest anywhere in this crate.
//!
//! ## What it will not do
//!
//! It opens no pipe, starts no service, installs nothing, reads no credential, contacts no provider,
//! mutates no repository and performs no Windows call of its own. The only effects it can cause are the
//! read-only ones the accepted durable store and the accepted pinned reader already perform.

#![forbid(unsafe_code)]

/// THE HOST'S ANSWER TO ONE REVIEW REQUEST, and the three filesystem adapters it needs.
pub mod candidate_evidence;
pub mod closure_facts;
pub mod host_ports;
pub mod review_dispatch;

use projectos_host_core::{ApprovedPlanBinding, ValidatedApprovedPlan};
use projectos_host_identity::{
    committed_candidate_digest, phase_identity_digest, plan_identity_digest,
};
use projectos_host_plan_durable_store::{PlanDurableStore, PlanStoreError};
use projectos_host_repository::CommittedFileReader;
use projectos_host_windows_local_ipc::{
    CommittedCandidateSource, HostPlanAuthority, BASELINE_COMMIT_LEN,
};

/// The width every digest on the authority wire has.
const DIGEST_LEN: usize = 32;

/// THE PRODUCTION `HostPlanAuthority`: the host's own validated approved-plan authority.
///
/// ## Where each fact comes from
///
/// ```text
/// plan        plan_identity_digest(binding.plan_ref())     canonical programme identity of the plan REF
/// plan_digest binding.digest_bytes()                       the already-validated phase-definition digest
/// phase       phase_identity_digest(binding.phase_id())    canonical programme identity of the phase ID
/// baseline    validated.approved_baseline()                the commit the durable record was approved against
/// ```
///
/// ## The baseline is the record's, or there is none
///
/// PROJECTOS-HOST-REVIEW-PATH1B. The approved baseline commit is read off the SAME validated fact, which
/// carries one only when it was reloaded from the durable record. Nothing here takes a commit as an
/// argument, consults the repository, reads a remote-tracking reference or advances anything: the value
/// is the one written with the approval, decoded, or it is `None` and the composition refuses.
///
/// ## `phase` is NOT `phase_definition_digest`, and that distinction is load-bearing
///
/// An owner programme delegation's `allowed_phases` entries are digests of phase IDS — its own field
/// documentation says so. `phase_definition_digest` is the integrity digest over a normalized phase
/// DEFINITION's nineteen authority fields, and it answers "is this definition the approved one". Using
/// it where the delegation means the other produces a permanent, unexplainable refusal, so the two are
/// reached through different functions that cannot be confused for one another.
///
/// `plan_digest` IS that definition digest, because that is what the delegation's `plan_digest` means:
/// the exact plan, not a plan name that can be re-authored.
///
/// ## It resolves, it does not accept
///
/// The delegation is never consulted here. A `ValidatedApprovedPlan` comes only from the durable store's
/// reload path, which re-normalizes the candidate, recomputes the definition digest and compares it to
/// what was stored — so these bytes exist only after that comparison passed. `stored_digest_hex` is
/// never read directly; the whole reason the reload recomputes is that a stored digest is not authority.
pub struct DurablePlanAuthority {
    plan: [u8; DIGEST_LEN],
    plan_digest: [u8; DIGEST_LEN],
    phase: [u8; DIGEST_LEN],
    baseline: Option<[u8; BASELINE_COMMIT_LEN]>,
}

/// Decode exactly 40 lower-case hex characters. `None` for anything else - never a partial decode.
fn decode_commit(hex: &str) -> Option<[u8; BASELINE_COMMIT_LEN]> {
    let bytes = hex.as_bytes();
    if bytes.len() != BASELINE_COMMIT_LEN * 2 {
        return None;
    }
    let nibble = |b: u8| match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        _ => None,
    };
    let mut out = [0u8; BASELINE_COMMIT_LEN];
    for (i, pair) in bytes.chunks_exact(2).enumerate() {
        out[i] = (nibble(pair[0])? << 4) | nibble(pair[1])?;
    }
    Some(out)
}

impl DurablePlanAuthority {
    /// Resolve the host's plan authority for one phase from the accepted durable store.
    ///
    /// `required` is the binding the host itself requires; `resolve_active` refuses anything that is not
    /// active for it, so a record for another plan, version, project or phase cannot answer.
    ///
    /// # Errors
    /// [`PlanStoreError`] exactly as the accepted store reports it. The cause is deliberately not
    /// reinterpreted here: a refusal taxonomy that grows a second opinion is a refusal taxonomy that
    /// starts disagreeing with itself.
    pub fn resolve(
        store: &PlanDurableStore,
        plan_ref: &str,
        version: u64,
        required: &ApprovedPlanBinding,
    ) -> Result<Self, PlanStoreError> {
        let validated = store.resolve_active(plan_ref, version, required)?;
        Ok(Self::from_validated(&validated))
    }

    /// Project an already-validated approved plan into the three facts the composition needs.
    ///
    /// Separate from [`Self::resolve`] so the mapping can be proven without a filesystem, and so a
    /// caller that already holds a validated plan does not reload it to ask the same question twice.
    #[must_use]
    pub fn from_validated(validated: &ValidatedApprovedPlan) -> Self {
        let binding = validated.binding();
        Self {
            plan: plan_identity_digest(binding.plan_ref().as_str()),
            plan_digest: *binding.digest_bytes(),
            phase: phase_identity_digest(binding.phase_id()),
            baseline: validated
                .approved_baseline()
                .and_then(|commit| decode_commit(commit.as_str())),
        }
    }
}

impl HostPlanAuthority for DurablePlanAuthority {
    fn plan(&self) -> Option<[u8; DIGEST_LEN]> {
        Some(self.plan)
    }

    fn plan_digest(&self) -> Option<[u8; DIGEST_LEN]> {
        Some(self.plan_digest)
    }

    fn phase(&self) -> Option<[u8; DIGEST_LEN]> {
        Some(self.phase)
    }

    fn approved_baseline(&self) -> Option<[u8; BASELINE_COMMIT_LEN]> {
        self.baseline
    }
}

/// THE PRODUCTION `CommittedCandidateSource`: the candidate digest of ONE pinned immutable commit.
///
/// ## It reuses the accepted reader rather than opening its own
///
/// [`CommittedFileReader`] resolves `HEAD` exactly once, at open, and every read afterwards names the
/// pinned commit. That is the property this adapter needs and the reason it does not run git itself: a
/// second reader would be a second answer to "which commit is current", and an actor who can move `HEAD`
/// between two resolutions would make both answers honest and the pair useless.
///
/// ## The agent's claim is never accepted
///
/// Nothing here takes a commit id as an argument. The commit is whatever the reader pinned, so there is
/// no parameter through which a caller could nominate the subject of its own review. The agent computes
/// the same digest from the commit it independently resolved, and the binding gate refuses unless the two
/// agree.
///
/// ## Why a 64-character object id refuses
///
/// The ratified committed-candidate contract accepts exactly 40 lowercase hex characters. A SHA-256
/// object-format repository pins a 64-character id, which [`committed_candidate_digest`] refuses — so
/// this adapter reports `None` and the composition fails closed. That is the correct outcome for a
/// repository this contract has not been ratified for; silently truncating or re-hashing it would invent
/// a meaning nobody approved.
pub struct PinnedCommitCandidateSource {
    digest: Option<[u8; DIGEST_LEN]>,
}

impl PinnedCommitCandidateSource {
    /// Take the candidate digest from the reader's pinned commit.
    #[must_use]
    pub fn from_reader(reader: &CommittedFileReader) -> Self {
        Self {
            digest: committed_candidate_digest(reader.pinned_commit().as_str()),
        }
    }

    /// Whether a candidate could be established at all. Reported so a composition site can say WHICH
    /// fact was missing rather than only that something was.
    #[must_use]
    pub fn is_established(&self) -> bool {
        self.digest.is_some()
    }
}

impl CommittedCandidateSource for PinnedCommitCandidateSource {
    fn candidate_digest(&self) -> Option<[u8; DIGEST_LEN]> {
        self.digest
    }
}
