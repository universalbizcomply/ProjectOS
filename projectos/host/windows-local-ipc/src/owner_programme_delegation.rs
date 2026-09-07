//! THE DURABLE OWNER PROGRAMME DELEGATION — the record Murad signs once, verified while he is away.
//!
//! RUN-TO-COMPLETION HOST ATTESTATION.
//!
//! ## Why this exists, and what it is NOT
//!
//! [`super::VerifiedOwnerProgrammeDelegation`] had no production mint. The route its own
//! documentation described consumes an owned `VerifiedOwnerPresence`, and the only non-fixture way
//! to obtain one of those is an **interactive Windows owner-verification ceremony**. Run-to-Completion
//! exists precisely for the case where the owner is not at the keyboard, so that route can never
//! satisfy it — not because it is weak, but because it answers a different question.
//!
//! The two are now distinct and both are kept:
//!
//! * **LIVE OWNER PRESENCE** — "is Murad here, right now?" Unchanged, unweakened, and still required
//!   for anything that needs him present. Nothing here touches it.
//! * **DURABLE OWNER PROGRAMME DELEGATION** — "did Murad, at some earlier moment, authorise exactly
//!   this bounded programme?" Answered by a signature over a canonical record, which is checkable
//!   with nobody present.
//!
//! This is NOT a second trust system. It reuses the ONE embedded owner anchor the trust manifest
//! already verifies against, and it adds no signing capability of any kind: ProjectOS never holds the
//! owner's private key, and there is no code here that could use one if it did.
//!
//! ## The record is a claim until every gate has run
//!
//! ```text
//! untrusted bytes
//!   -> decode: fixed-width, strict, canonical           (a claim)
//!   -> owner signature over the domain-separated subject (provenance)
//!   -> programme + liveness policy                       (relevance)
//!   -> VerifiedOwnerProgrammeDelegation                  (authority)
//! ```
//!
//! A valid signature is NOT sufficient. A genuinely owner-signed delegation for another project,
//! another repository, or one that has expired or been completed, is refused — provenance and
//! relevance are separate questions and both must answer yes.
//!
//! ## What this record can never say
//!
//! The only operation class it can carry is [`OperationClass::IndependentGatekeeperReview`], and the
//! decoder refuses any other. There is no field through which production deployment, database
//! mutation, real email or SMS, payment, signing, credential provisioning, destructive action,
//! general process execution or a generic provider call could arrive — which is a stronger statement
//! than a list of things this code promises not to do.
//!
//! ## Division of labour with the request-scoped gate
//!
//! This module answers what is true of the DELEGATION: it is genuine, it is the owner's, it is for
//! this installation's project and repository, it is still live, and it names one delegable
//! operation. Everything that depends on WHICH REQUEST is being asked — plan, plan digest, phase,
//! candidate, model policy, credential reference, budget headroom, protected-effect state — stays in
//! `satisfy_c4_for_gatekeeper_request`, compared against facts the host resolved for that one
//! request. Splitting it this way is deliberate: a delegation bound to a single candidate would make
//! the owner sign again for every ordinary technical review, which is the workflow this whole
//! programme exists to remove.

use crate::operation_contract::{
    OperationClass, OwnerProgrammeDelegation, VerifiedOwnerProgrammeDelegation,
    DELEGATION_DIGEST_LEN, MAX_DELEGATED_PHASES,
};

/// The domain tag prefixed to every byte string an owner signs as a programme delegation.
///
/// DOMAIN SEPARATION IS THE POINT. The owner's key also signs the packaged trust manifest, whose
/// canonical form is JSON and therefore begins with `{`. Prefixing this subject with an ASCII tag
/// that no JSON document can begin with makes the two signing spaces provably disjoint: a signature
/// made over a manifest is a signature over different bytes, so it cannot be lifted and replayed
/// here, and a delegation signature cannot be replayed as a manifest.
///
/// It is versioned, so a future subject shape gets a new tag rather than quietly reinterpreting
/// bytes an owner already signed.
pub const DELEGATION_SIGNING_DOMAIN: &[u8] = b"projectos.owner-programme-delegation.v1\n";

/// The schema version of the signed body. INSIDE the signature: a version a caller could flip would
/// let one set of bytes be read under two different layouts.
pub const DELEGATION_SCHEMA_VERSION: u32 = 1;

/// The signature algorithm this contract accepts, matching the embedded production anchor.
///
/// A STANDING CONSTRAINT FOR ANY FUTURE SCHEMA. The algorithm field sits OUTSIDE the signed body,
/// which is safe only because exactly one value is accepted: the decoder rejects everything else, so
/// there is no degree of freedom for an attacker to steer. The moment a second algorithm becomes
/// acceptable, that field must move INSIDE the signed body first — otherwise this is the classic
/// algorithm-substitution confusion, where a record's own claim about how to check it is the part
/// nobody signed.
pub const DELEGATION_SIGNATURE_ALGORITHM: &str = "es256";

/// Format marker. Outside the signature deliberately — it identifies the byte layout, and altering
/// it fails the decode before any field is read, so it needs no cryptographic protection.
const MAGIC: [u8; 8] = *b"POSDLG01";

/// Fixed width of the NUL-padded signing key identity.
const KEY_ID_LEN: usize = 64;
/// Fixed width of the NUL-padded algorithm name.
const ALGORITHM_LEN: usize = 16;
/// Raw P-256 signature: `r || s`.
const SIGNATURE_LEN: usize = 64;

// Body field offsets, relative to the start of the signed body.
const OFF_SCHEMA: usize = 0;
const OFF_KEY_ID: usize = OFF_SCHEMA + 4;
const OFF_DELEGATION_ID: usize = OFF_KEY_ID + KEY_ID_LEN;
const OFF_OWNER: usize = OFF_DELEGATION_ID + DELEGATION_DIGEST_LEN;
const OFF_PROJECT: usize = OFF_OWNER + DELEGATION_DIGEST_LEN;
const OFF_REPOSITORY: usize = OFF_PROJECT + DELEGATION_DIGEST_LEN;
const OFF_PLAN: usize = OFF_REPOSITORY + DELEGATION_DIGEST_LEN;
const OFF_PLAN_DIGEST: usize = OFF_PLAN + DELEGATION_DIGEST_LEN;
const OFF_PHASE_COUNT: usize = OFF_PLAN_DIGEST + DELEGATION_DIGEST_LEN;
const OFF_PHASES: usize = OFF_PHASE_COUNT + 1;
const OFF_OPERATION: usize = OFF_PHASES + DELEGATION_DIGEST_LEN * MAX_DELEGATED_PHASES;
const OFF_MODEL_POLICY: usize = OFF_OPERATION + 1;
const OFF_CREDENTIAL_REF: usize = OFF_MODEL_POLICY + DELEGATION_DIGEST_LEN;
const OFF_BUDGET: usize = OFF_CREDENTIAL_REF + DELEGATION_DIGEST_LEN;
const OFF_EXPIRES: usize = OFF_BUDGET + 8;
const OFF_REVOKED: usize = OFF_EXPIRES + 8;

/// Length of the signed body.
pub const DELEGATION_BODY_LEN: usize = OFF_REVOKED + 1;

/// Length of one complete signed delegation record.
pub const SIGNED_DELEGATION_RECORD_LEN: usize =
    MAGIC.len() + DELEGATION_BODY_LEN + ALGORITHM_LEN + SIGNATURE_LEN;

/// Why a delegation was refused.
///
/// COARSE ON PURPOSE. A refusal taxonomy is an oracle, so it names the gate that refused and never
/// the value that failed — in particular [`DelegationRefusal::ProgrammeMismatch`] does not say
/// whether it was the project or the repository that differed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum DelegationRefusal {
    /// Wrong length, wrong magic, non-canonical padding, or a field that is not well-formed.
    RecordMalformed,
    /// The body declares a schema version this build does not implement.
    SchemaVersionUnsupported,
    /// The signature algorithm is not the one the embedded anchor uses.
    AlgorithmUnsupported,
    /// The operation class is not one a programme delegation may ever carry.
    OperationNotDelegable,
    /// A bounded field is outside its bound.
    BoundsRefused,
    /// The owner signature did not verify over the domain-separated canonical subject.
    SignatureRefused,
    /// Genuine, but not for this installation's programme.
    ProgrammeMismatch,
    /// Revoked, completed, or expired against the host's own clock - by the signed record OR by the
    /// host's own local state, whichever ended it first.
    NotLive,
    /// The host-local status presented is about a different delegation than the record. A status
    /// answers exactly one delegation id; it is never transferable.
    LocalStatusMismatch,
    /// The host's own clock could not produce a reading. Nothing is compared against a guess.
    ClockUnavailable,
}

/// A signed delegation record, exactly as it was parsed. **A claim, not authority.**
///
/// Holding one proves the bytes decoded and nothing else. There is no accessor that reports
/// "verified", because nothing about this type ever is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignedOwnerProgrammeDelegation {
    delegation: OwnerProgrammeDelegation,
    signing_key_id: String,
    signature_algorithm: String,
    signature: [u8; SIGNATURE_LEN],
    /// The exact body bytes as they arrived, retained so the canonical subject is the bytes that
    /// were signed rather than a re-encoding of what we think we parsed.
    body: [u8; DELEGATION_BODY_LEN],
}

impl SignedOwnerProgrammeDelegation {
    /// The delegation this record claims. Untrusted.
    #[must_use]
    pub fn claimed_delegation(&self) -> &OwnerProgrammeDelegation {
        &self.delegation
    }

    /// The signing key identity the record names. Untrusted until the anchor agrees it is the one.
    #[must_use]
    pub fn signing_key_id(&self) -> &str {
        &self.signing_key_id
    }

    /// The signature algorithm the record names.
    #[must_use]
    pub fn signature_algorithm(&self) -> &str {
        &self.signature_algorithm
    }

    /// The signature as lower-case hex, the form a verifier consumes.
    #[must_use]
    pub fn signature_hex(&self) -> String {
        const HEX: [u8; 16] = *b"0123456789abcdef";
        let mut out = String::with_capacity(SIGNATURE_LEN * 2);
        for b in self.signature {
            out.push(HEX[usize::from(b >> 4)] as char);
            out.push(HEX[usize::from(b & 0x0f)] as char);
        }
        out
    }

    /// THE EXACT BYTES AN OWNER SIGNS: the domain tag followed by the record's signed body.
    ///
    /// Built from the body as it arrived, not from a re-serialisation of the parsed fields. A
    /// verifier that re-encodes is a second implementation of the format, and a second
    /// implementation is a disagreement waiting to happen — the moment it rounds a field differently
    /// from the encoder, a genuine signature stops verifying or, far worse, a tampered record starts.
    #[must_use]
    pub fn canonical_subject(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(DELEGATION_SIGNING_DOMAIN.len() + DELEGATION_BODY_LEN);
        out.extend_from_slice(DELEGATION_SIGNING_DOMAIN);
        out.extend_from_slice(&self.body);
        out
    }
}

/// Read a NUL-padded ASCII field, requiring canonical padding.
///
/// CANONICAL MEANS ONE SPELLING. Once the first NUL appears, every remaining byte must also be NUL —
/// otherwise `"es256\0x"` and `"es256"` would be two encodings of one value, and only one of them
/// would be inside somebody's signature.
fn read_padded_ascii(field: &[u8]) -> Result<String, DelegationRefusal> {
    let end = field.iter().position(|&b| b == 0).unwrap_or(field.len());
    if field[end..].iter().any(|&b| b != 0) {
        return Err(DelegationRefusal::RecordMalformed);
    }
    let text = &field[..end];
    if text.is_empty() || !text.iter().all(u8::is_ascii_graphic) {
        return Err(DelegationRefusal::RecordMalformed);
    }
    // Every byte is ASCII-graphic, so this cannot fail.
    String::from_utf8(text.to_vec()).map_err(|_| DelegationRefusal::RecordMalformed)
}

fn digest_at(body: &[u8], offset: usize) -> [u8; DELEGATION_DIGEST_LEN] {
    let mut out = [0u8; DELEGATION_DIGEST_LEN];
    out.copy_from_slice(&body[offset..offset + DELEGATION_DIGEST_LEN]);
    out
}

fn u64_at(body: &[u8], offset: usize) -> u64 {
    let mut eight = [0u8; 8];
    eight.copy_from_slice(&body[offset..offset + 8]);
    u64::from_be_bytes(eight)
}

/// STRICTLY decode one signed delegation record.
///
/// Every structural question is settled here, before any signature is considered: exact length,
/// exact magic, a schema version this build implements, canonical NUL padding, a known operation
/// class that a programme delegation may carry, a phase count within its bound, all-zero padding
/// beyond that count, and a budget ceiling that is actually a ceiling.
///
/// # Errors
/// [`DelegationRefusal`] naming the gate that refused.
pub fn decode_signed_owner_programme_delegation(
    bytes: &[u8],
) -> Result<SignedOwnerProgrammeDelegation, DelegationRefusal> {
    if bytes.len() != SIGNED_DELEGATION_RECORD_LEN {
        return Err(DelegationRefusal::RecordMalformed);
    }
    if bytes[..MAGIC.len()] != MAGIC {
        return Err(DelegationRefusal::RecordMalformed);
    }
    let body_start = MAGIC.len();
    let body_end = body_start + DELEGATION_BODY_LEN;
    let body = &bytes[body_start..body_end];

    let mut four = [0u8; 4];
    four.copy_from_slice(&body[OFF_SCHEMA..OFF_SCHEMA + 4]);
    if u32::from_be_bytes(four) != DELEGATION_SCHEMA_VERSION {
        return Err(DelegationRefusal::SchemaVersionUnsupported);
    }

    let signing_key_id = read_padded_ascii(&body[OFF_KEY_ID..OFF_KEY_ID + KEY_ID_LEN])?;

    let algorithm_field = &bytes[body_end..body_end + ALGORITHM_LEN];
    let signature_algorithm = read_padded_ascii(algorithm_field)?;
    if signature_algorithm != DELEGATION_SIGNATURE_ALGORITHM {
        return Err(DelegationRefusal::AlgorithmUnsupported);
    }

    let mut signature = [0u8; SIGNATURE_LEN];
    signature.copy_from_slice(&bytes[body_end + ALGORITHM_LEN..]);

    // ONE CLASS, DECIDED HERE. An unknown discriminant is malformed; a known but non-delegable one is
    // a different fact and gets its own refusal, because an operator chasing the two would look in
    // different places.
    let operation = OperationClass::from_discriminant(body[OFF_OPERATION])
        .ok_or(DelegationRefusal::RecordMalformed)?;
    if !operation.may_be_delegated_by_programme() {
        return Err(DelegationRefusal::OperationNotDelegable);
    }

    let allowed_phase_count = body[OFF_PHASE_COUNT];
    if allowed_phase_count == 0 || usize::from(allowed_phase_count) > MAX_DELEGATED_PHASES {
        return Err(DelegationRefusal::BoundsRefused);
    }
    let mut allowed_phases = [[0u8; DELEGATION_DIGEST_LEN]; MAX_DELEGATED_PHASES];
    for (i, phase) in allowed_phases.iter_mut().enumerate() {
        *phase = digest_at(body, OFF_PHASES + i * DELEGATION_DIGEST_LEN);
    }
    // PADDING MUST BE ZERO. Otherwise the same delegation has many encodings, each with its own
    // signature, and a record could carry phase digests that no reader ever looks at.
    if allowed_phases[usize::from(allowed_phase_count)..]
        .iter()
        .any(|p| p != &[0u8; DELEGATION_DIGEST_LEN])
    {
        return Err(DelegationRefusal::RecordMalformed);
    }

    let budget_ceiling_micro_usd = u64_at(body, OFF_BUDGET);
    if budget_ceiling_micro_usd == 0 {
        return Err(DelegationRefusal::BoundsRefused);
    }

    let revoked_or_completed = match body[OFF_REVOKED] {
        0 => false,
        1 => true,
        // A boolean with 254 spare spellings is not canonical.
        _ => return Err(DelegationRefusal::RecordMalformed),
    };

    let mut retained_body = [0u8; DELEGATION_BODY_LEN];
    retained_body.copy_from_slice(body);

    Ok(SignedOwnerProgrammeDelegation {
        delegation: OwnerProgrammeDelegation {
            delegation_id: digest_at(body, OFF_DELEGATION_ID),
            owner: digest_at(body, OFF_OWNER),
            project: digest_at(body, OFF_PROJECT),
            repository: digest_at(body, OFF_REPOSITORY),
            plan: digest_at(body, OFF_PLAN),
            plan_digest: digest_at(body, OFF_PLAN_DIGEST),
            allowed_phases,
            allowed_phase_count,
            operation,
            model_policy: digest_at(body, OFF_MODEL_POLICY),
            credential_ref: digest_at(body, OFF_CREDENTIAL_REF),
            budget_ceiling_micro_usd,
            expires_at_epoch_s: u64_at(body, OFF_EXPIRES),
            revoked_or_completed,
        },
        signing_key_id,
        signature_algorithm,
        signature,
        body: retained_body,
    })
}

/// Private seal for the host-resolved values this module mints. A type carrying it cannot be
/// written as a struct literal outside this module.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Seal;

/// The programme THIS installation is, as the host resolved it for itself.
///
/// Never taken from the record under test, and never from a request. A delegation that is genuinely
/// owner-signed but names another project or another checkout is refused here, which is why
/// provenance alone is not authority.
///
/// SEALED (RUN-TO-COMPLETION HOST ATTESTATION - HOST-RESOLVED BINDING AUTHORITY). The fields used
/// to be public, and that made the following compile, silently, in any composition crate:
///
/// ```text
/// let expected = ExpectedProgramme { project: record.project, repository: record.repository };
/// verify_owner_programme_delegation(&record, &expected, ...)   // "verified"
/// ```
///
/// A record compared against a copy of itself agrees with itself. The fields are now private and
/// there is NO production constructor in this checkpoint: the trusted source of the installation's
/// programme is the signed manifest's execution closure (the installation project allowlist) read
/// by the Host composition, and that rung is not wired yet. Until it is, no production caller can
/// name an expected programme at all - so verification is unreachable in a shipped graph by
/// construction rather than reachable with a value somebody typed in. The fixture constructor is
/// compiled only for tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExpectedProgramme {
    _seal: Seal,
    project: [u8; DELEGATION_DIGEST_LEN],
    repository: [u8; DELEGATION_DIGEST_LEN],
}

impl ExpectedProgramme {
    /// FIXTURE ONLY. Compiled for this crate's tests and the non-default `test-fixtures` graph,
    /// never for a shipped build.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture(
        project: [u8; DELEGATION_DIGEST_LEN],
        repository: [u8; DELEGATION_DIGEST_LEN],
    ) -> Self {
        Self {
            _seal: Seal,
            project,
            repository,
        }
    }

    /// Digest of this installation's project id.
    #[must_use]
    pub fn project(&self) -> &[u8; DELEGATION_DIGEST_LEN] {
        &self.project
    }

    /// Digest of this installation's canonical repository identity.
    #[must_use]
    pub fn repository(&self) -> &[u8; DELEGATION_DIGEST_LEN] {
        &self.repository
    }
}

/// The HOST's own wall-clock reading, in Unix epoch seconds, taken for one verification.
///
/// SEALED, with exactly one production route: [`HostClockReading::now_from_host`], which reads the
/// system clock INSIDE and takes no argument. The verifier used to accept a plain `u64` here, and a
/// clock a caller can supply is a delegation that never expires. There is no `u64` argument left.
///
/// WHY NOT `projectos_host_core`'s `TrustedClock`. That authority is a MONOTONIC tick provider with
/// an opaque epoch - the right thing for "has this window elapsed", and deliberately not wall time.
/// A delegation expires at an absolute instant the owner wrote down, so the comparison needs the
/// calendar, and this reading is the smallest sealed way to get it. It is a reading, not a clock: it
/// is taken per verification and is not `Copy`, so a cached one cannot quietly go stale.
///
/// The fixture constructor is compiled only for tests. Fixture time never reaches a shipped build.
#[derive(Debug, PartialEq, Eq)]
pub struct HostClockReading {
    _seal: Seal,
    epoch_s: u64,
}

impl HostClockReading {
    /// THE PRODUCTION READING: the system clock, read here, now. Fails closed if the clock reports a
    /// time before the Unix epoch, which is not a time a delegation can be compared against.
    ///
    /// # Errors
    /// [`DelegationRefusal::ClockUnavailable`].
    pub fn now_from_host() -> Result<Self, DelegationRefusal> {
        let elapsed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| DelegationRefusal::ClockUnavailable)?;
        Ok(Self {
            _seal: Seal,
            epoch_s: elapsed.as_secs(),
        })
    }

    /// FIXTURE ONLY. Compiled for this crate's tests and the non-default `test-fixtures` graph.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture(epoch_s: u64) -> Self {
        Self {
            _seal: Seal,
            epoch_s,
        }
    }

    /// The reading, in Unix epoch seconds.
    #[must_use]
    pub fn epoch_s(&self) -> u64 {
        self.epoch_s
    }
}

/// The CLOSED host-local lifecycle state of one delegation.
///
/// Plain data on purpose - a state is a description. What makes it count is the sealed
/// [`HostDelegationStatus`] that carries it, which only the Host's own record can produce.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum DelegationLocalState {
    /// The host has not ended this delegation.
    Active,
    /// The host recorded this delegation as revoked. Overrides any signed copy that says otherwise.
    Revoked,
    /// The host recorded this delegation as completed. Overrides any signed copy that says otherwise.
    Completed,
}

/// What the HOST itself knows about one delegation's lifecycle - never what the record says.
///
/// THE SIGNED `revoked_or_completed` FLAG IS NOT ENOUGH ON ITS OWN. It is inside the signature, so
/// an older, still-valid signed copy that says "active" stays a genuine owner-signed record after
/// the owner has revoked the programme, and would remain usable until its expiry. The host's local
/// state therefore OVERRIDES the signed flag: `Revoked` or `Completed` here refuses a record however
/// live the record claims to be. The signed flag still refuses on its own too - the two are ANDed,
/// never ORed.
///
/// SEALED, bound to ONE delegation id, and with NO production constructor in this checkpoint. The
/// production source is the durable host-local delegation record (the persistence checkpoint); until
/// it is wired, no shipped path can present a status, so verification fails closed by construction.
/// The request and the caller never select this state: there is no argument on the verification
/// path through which a state could arrive except this sealed value.
#[derive(Debug, PartialEq, Eq)]
pub struct HostDelegationStatus {
    _seal: Seal,
    delegation_id: [u8; DELEGATION_DIGEST_LEN],
    state: DelegationLocalState,
}

impl HostDelegationStatus {
    /// FIXTURE ONLY. Compiled for this crate's tests and the non-default `test-fixtures` graph.
    #[cfg(any(test, feature = "test-fixtures"))]
    #[must_use]
    pub fn fixture(
        delegation_id: [u8; DELEGATION_DIGEST_LEN],
        state: DelegationLocalState,
    ) -> Self {
        Self {
            _seal: Seal,
            delegation_id,
            state,
        }
    }

    /// The delegation this status is about.
    #[must_use]
    pub fn delegation_id(&self) -> &[u8; DELEGATION_DIGEST_LEN] {
        &self.delegation_id
    }

    /// The host-local state.
    #[must_use]
    pub fn state(&self) -> DelegationLocalState {
        self.state
    }
}

/// Evidence that the owner's key signed exactly these bytes.
///
/// CRATE-PRIVATE, AND THAT IS THE WHOLE DESIGN. If this were public, a downstream crate could
/// implement it as `true` and mint owner authority from nothing. Keeping the trait unnameable means
/// the only implementations that can ever exist are the ones in this crate, so "who decides whether
/// the signature is good" is not a question a caller gets to answer.
trait OwnerSignatureOracle {
    /// Whether the owner's embedded anchor verifies `signature` over `canonical`.
    fn owner_signed(
        &self,
        canonical: &[u8],
        algorithm: &str,
        signing_key_id: &str,
        signature_hex: &str,
    ) -> bool;
}

/// The one verification order, shared by every entry point.
///
/// ONE FUNCTION, SO A FIXTURE CANNOT PROVE A DIFFERENT PROGRAM. The oracle is the ONLY thing that
/// varies between the production path and the test path; every structural, programme and liveness
/// check below is literally the same code in both. A test that exercised a parallel implementation
/// would be evidence about the test.
///
/// The order is the control: provenance is settled BEFORE policy, so no comparison against the
/// host's own programme is ever performed on behalf of bytes nobody signed.
fn verify_delegation_with_oracle(
    record: &SignedOwnerProgrammeDelegation,
    expected: &ExpectedProgramme,
    now: &HostClockReading,
    local: &HostDelegationStatus,
    oracle: &dyn OwnerSignatureOracle,
) -> Result<VerifiedOwnerProgrammeDelegation, DelegationRefusal> {
    // 1. PROVENANCE. The owner's key, over the domain-separated subject, in the algorithm the anchor
    //    uses. Nothing below this line runs for a record the owner did not sign.
    if !oracle.owner_signed(
        &record.canonical_subject(),
        record.signature_algorithm(),
        record.signing_key_id(),
        &record.signature_hex(),
    ) {
        return Err(DelegationRefusal::SignatureRefused);
    }

    let delegation = record.claimed_delegation();

    // 2. RELEVANCE. Genuine, but is it for THIS installation? Project and canonical repository both:
    //    a project id alone is a name a second checkout can also use.
    if delegation.project != *expected.project() || delegation.repository != *expected.repository()
    {
        return Err(DelegationRefusal::ProgrammeMismatch);
    }

    // 3. THE HOST'S OWN WORD ON THIS DELEGATION. The status must be about THIS record - a status
    //    for another delegation answers nothing - and if the host has ended the programme, an
    //    older signed copy that still says "active" does not resurrect it.
    if *local.delegation_id() != delegation.delegation_id {
        return Err(DelegationRefusal::LocalStatusMismatch);
    }
    if local.state() != DelegationLocalState::Active {
        return Err(DelegationRefusal::NotLive);
    }

    // 4. STILL LIVE BY THE RECORD'S OWN TERMS. Completed, revoked or expired all end it. `>=`
    //    because a delegation that expires at this instant has expired. The clock is the HOST's
    //    own sealed reading; there is no argument through which a caller could supply one.
    if delegation.revoked_or_completed || now.epoch_s() >= delegation.expires_at_epoch_s {
        return Err(DelegationRefusal::NotLive);
    }

    Ok(VerifiedOwnerProgrammeDelegation::from_verified_owner_signature(delegation.clone()))
}

/// THE ONE PRODUCTION ORACLE: the owner's embedded anchor, and nothing else.
///
/// A unit struct with no fields, so there is no key, no algorithm and no verifier to choose. It
/// delegates to `projectos_host_identity::verify_against_embedded_anchor`, which is the SAME
/// function the packaged trust manifest is verified with — one anchor, one implementation, one
/// opinion about what a valid owner signature is. A second verifier here is how a signature scheme
/// quietly becomes decorative.
struct EmbeddedAnchorOracle;

impl OwnerSignatureOracle for EmbeddedAnchorOracle {
    fn owner_signed(
        &self,
        canonical: &[u8],
        algorithm: &str,
        signing_key_id: &str,
        signature_hex: &str,
    ) -> bool {
        // Refuses on its own if no anchor is embedded, so a build without one cannot verify
        // anything rather than verifying everything.
        projectos_host_identity::verify_against_embedded_anchor(
            canonical,
            algorithm,
            signing_key_id,
            signature_hex,
        )
    }
}

/// Verify a durable owner programme delegation against the embedded production anchor.
///
/// THE ONLY PRODUCTION ROUTE to a [`VerifiedOwnerProgrammeDelegation`]. The verifier is not a
/// parameter: a caller cannot supply one, name one, or reach the trait that describes one, so
/// "whose signature counts" is settled by this crate and the embedded anchor rather than by whoever
/// happens to be calling.
///
/// Every other input is SEALED and host-resolved: the expected programme, the clock reading and the
/// host-local delegation status each have private fields and no production constructor a caller
/// could feed from the record or the request. The former `now_epoch_s: u64` argument is gone - a
/// clock a caller supplies is a delegation that never expires.
///
/// # Errors
/// [`DelegationRefusal`] naming the gate that refused.
pub fn verify_owner_programme_delegation(
    record: &SignedOwnerProgrammeDelegation,
    expected: &ExpectedProgramme,
    now: &HostClockReading,
    local: &HostDelegationStatus,
) -> Result<VerifiedOwnerProgrammeDelegation, DelegationRefusal> {
    verify_delegation_with_oracle(record, expected, now, local, &EmbeddedAnchorOracle)
}

/// TEST-ONLY signature oracle.
///
/// Compiled only under `cfg(test)`, so it exists in NO shipped graph — not the default build and not
/// the non-default fixture build — and no caller in any crate can reach it. It exists because the
/// embedded production anchor is the OWNER'S REAL KEY: producing a signature that satisfies it
/// requires the private half, which ProjectOS does not have and must never have. Every NEGATIVE
/// production case is provable without it; the positive case is proven structurally through this,
/// against the identical verification order.
#[cfg(test)]
struct FixtureSignatureOracle {
    /// The exact subject bytes this oracle will accept. Anything else is refused, so a test cannot
    /// pass by accident when the code signs the wrong thing.
    accepts_subject: Vec<u8>,
    /// Every subject it was asked about, so a test can assert what was actually signed over.
    seen: std::cell::RefCell<Vec<Vec<u8>>>,
}

#[cfg(test)]
impl OwnerSignatureOracle for FixtureSignatureOracle {
    fn owner_signed(
        &self,
        canonical: &[u8],
        algorithm: &str,
        signing_key_id: &str,
        signature_hex: &str,
    ) -> bool {
        self.seen.borrow_mut().push(canonical.to_vec());
        canonical == self.accepts_subject.as_slice()
            && algorithm == DELEGATION_SIGNATURE_ALGORITHM
            && !signing_key_id.is_empty()
            && signature_hex.len() == SIGNATURE_LEN * 2
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROJECT: [u8; DELEGATION_DIGEST_LEN] = [0x11; DELEGATION_DIGEST_LEN];
    const REPOSITORY: [u8; DELEGATION_DIGEST_LEN] = [0x22; DELEGATION_DIGEST_LEN];
    const NOW: u64 = 1_000;
    const EXPIRES: u64 = 2_000;

    /// The delegation id `record_bytes` writes, so a fixture status can be about THIS record.
    const RECORD_ID: [u8; DELEGATION_DIGEST_LEN] = [0xaa; DELEGATION_DIGEST_LEN];

    fn expected() -> ExpectedProgramme {
        ExpectedProgramme::fixture(PROJECT, REPOSITORY)
    }

    fn at(epoch_s: u64) -> HostClockReading {
        HostClockReading::fixture(epoch_s)
    }

    fn now() -> HostClockReading {
        at(NOW)
    }

    /// The host has not ended this delegation.
    fn active() -> HostDelegationStatus {
        HostDelegationStatus::fixture(RECORD_ID, DelegationLocalState::Active)
    }

    /// Build a well-formed record. TEST ENCODER ONLY — production never encodes one of these,
    /// because production never signs.
    fn record_bytes() -> Vec<u8> {
        let mut body = [0u8; DELEGATION_BODY_LEN];
        body[OFF_SCHEMA..OFF_SCHEMA + 4].copy_from_slice(&DELEGATION_SCHEMA_VERSION.to_be_bytes());
        let key = b"projectos-signing-20260812";
        body[OFF_KEY_ID..OFF_KEY_ID + key.len()].copy_from_slice(key);
        body[OFF_DELEGATION_ID..OFF_DELEGATION_ID + DELEGATION_DIGEST_LEN]
            .copy_from_slice(&[0xaa; DELEGATION_DIGEST_LEN]);
        body[OFF_OWNER..OFF_OWNER + DELEGATION_DIGEST_LEN]
            .copy_from_slice(&[0xbb; DELEGATION_DIGEST_LEN]);
        body[OFF_PROJECT..OFF_PROJECT + DELEGATION_DIGEST_LEN].copy_from_slice(&PROJECT);
        body[OFF_REPOSITORY..OFF_REPOSITORY + DELEGATION_DIGEST_LEN].copy_from_slice(&REPOSITORY);
        body[OFF_PLAN..OFF_PLAN + DELEGATION_DIGEST_LEN]
            .copy_from_slice(&[0x33; DELEGATION_DIGEST_LEN]);
        body[OFF_PLAN_DIGEST..OFF_PLAN_DIGEST + DELEGATION_DIGEST_LEN]
            .copy_from_slice(&[0x44; DELEGATION_DIGEST_LEN]);
        body[OFF_PHASE_COUNT] = 2;
        body[OFF_PHASES..OFF_PHASES + DELEGATION_DIGEST_LEN]
            .copy_from_slice(&[0x55; DELEGATION_DIGEST_LEN]);
        body[OFF_PHASES + DELEGATION_DIGEST_LEN..OFF_PHASES + 2 * DELEGATION_DIGEST_LEN]
            .copy_from_slice(&[0x56; DELEGATION_DIGEST_LEN]);
        body[OFF_OPERATION] = OperationClass::IndependentGatekeeperReview.discriminant();
        body[OFF_MODEL_POLICY..OFF_MODEL_POLICY + DELEGATION_DIGEST_LEN]
            .copy_from_slice(&[0x66; DELEGATION_DIGEST_LEN]);
        body[OFF_CREDENTIAL_REF..OFF_CREDENTIAL_REF + DELEGATION_DIGEST_LEN]
            .copy_from_slice(&[0x77; DELEGATION_DIGEST_LEN]);
        body[OFF_BUDGET..OFF_BUDGET + 8].copy_from_slice(&5_000_000u64.to_be_bytes());
        body[OFF_EXPIRES..OFF_EXPIRES + 8].copy_from_slice(&EXPIRES.to_be_bytes());
        body[OFF_REVOKED] = 0;

        let mut out = Vec::with_capacity(SIGNED_DELEGATION_RECORD_LEN);
        out.extend_from_slice(&MAGIC);
        out.extend_from_slice(&body);
        let mut alg = [0u8; ALGORITHM_LEN];
        alg[..DELEGATION_SIGNATURE_ALGORITHM.len()]
            .copy_from_slice(DELEGATION_SIGNATURE_ALGORITHM.as_bytes());
        out.extend_from_slice(&alg);
        out.extend_from_slice(&[0x9c; SIGNATURE_LEN]);
        out
    }

    fn decoded() -> SignedOwnerProgrammeDelegation {
        decode_signed_owner_programme_delegation(&record_bytes()).expect("well-formed")
    }

    /// An oracle that accepts exactly the subject this record ought to be signed over.
    fn oracle_for(record: &SignedOwnerProgrammeDelegation) -> FixtureSignatureOracle {
        FixtureSignatureOracle {
            accepts_subject: record.canonical_subject(),
            seen: std::cell::RefCell::new(Vec::new()),
        }
    }

    /// An oracle that accepts nothing — the shape of an unsigned, wrongly-signed or foreign record.
    fn refusing_oracle() -> FixtureSignatureOracle {
        FixtureSignatureOracle {
            accepts_subject: b"nothing matches this".to_vec(),
            seen: std::cell::RefCell::new(Vec::new()),
        }
    }

    /// THE ONE PATH THAT WORKS, and every field it carries through.
    #[test]
    fn a_signed_live_delegation_for_this_programme_verifies() {
        let record = decoded();
        let oracle = oracle_for(&record);
        let verified =
            verify_delegation_with_oracle(&record, &expected(), &now(), &active(), &oracle)
                .expect("the exact case must verify");

        let d = verified.delegation();
        assert_eq!(d.project, PROJECT);
        assert_eq!(d.repository, REPOSITORY);
        assert_eq!(d.operation, OperationClass::IndependentGatekeeperReview);
        assert_eq!(d.allowed_phase_count, 2);
        assert_eq!(d.allowed_phases[0], [0x55; DELEGATION_DIGEST_LEN]);
        assert_eq!(d.allowed_phases[1], [0x56; DELEGATION_DIGEST_LEN]);
        assert_eq!(d.budget_ceiling_micro_usd, 5_000_000);
        assert_eq!(d.expires_at_epoch_s, EXPIRES);
        assert!(!d.revoked_or_completed);
    }

    /// THE SIGNED SUBJECT IS DOMAIN-SEPARATED, and the assertion is on what the verifier was
    /// actually asked about — not on what this module says it builds.
    #[test]
    fn the_subject_the_owner_signs_is_domain_tagged_and_is_the_body() {
        let record = decoded();
        let oracle = oracle_for(&record);
        verify_delegation_with_oracle(&record, &expected(), &now(), &active(), &oracle)
            .expect("verifies");

        let seen = oracle.seen.borrow();
        assert_eq!(seen.len(), 1, "exactly one signature question");
        let subject = &seen[0];
        assert!(
            subject.starts_with(DELEGATION_SIGNING_DOMAIN),
            "the subject must carry its domain tag"
        );
        assert_eq!(
            subject.len(),
            DELEGATION_SIGNING_DOMAIN.len() + DELEGATION_BODY_LEN
        );
        assert_eq!(
            &subject[DELEGATION_SIGNING_DOMAIN.len()..],
            &record.body[..]
        );
    }

    /// A TRUST-MANIFEST SIGNATURE CANNOT BE REPLAYED AS A DELEGATION.
    ///
    /// The manifest's canonical form is JSON, so it begins with `{`. A delegation subject always
    /// begins with the domain tag. The two signing spaces are therefore disjoint by construction:
    /// no byte string is a valid subject for both, so a signature made over one is a signature over
    /// different bytes and cannot be lifted into the other.
    #[test]
    fn a_manifest_subject_and_a_delegation_subject_are_disjoint() {
        let manifest_canonical = br#"{"schemaVersion":1,"manifestVersion":2}"#;
        assert!(!manifest_canonical.starts_with(DELEGATION_SIGNING_DOMAIN));
        assert_ne!(DELEGATION_SIGNING_DOMAIN[0], b'{');

        let subject = decoded().canonical_subject();
        assert!(subject.starts_with(DELEGATION_SIGNING_DOMAIN));
        assert_ne!(subject.first(), Some(&b'{'));
        assert_ne!(&subject[..], &manifest_canonical[..]);
    }

    /// AN UNSIGNED OR WRONGLY-SIGNED RECORD IS REFUSED, and refused BEFORE any policy comparison.
    ///
    /// The record below is for the right programme and is perfectly live, so a policy-first order
    /// would have let it through every other gate. The refusal is the signature's.
    #[test]
    fn a_record_the_owner_did_not_sign_is_refused_before_policy() {
        let record = decoded();
        assert_eq!(
            verify_delegation_with_oracle(
                &record,
                &expected(),
                &now(),
                &active(),
                &refusing_oracle()
            ),
            Err(DelegationRefusal::SignatureRefused)
        );
    }

    /// A SIGNATURE OVER DIFFERENT BYTES IS NOT A SIGNATURE OVER THESE.
    ///
    /// The oracle accepts the subject of a DIFFERENT record; the record under test is refused even
    /// though a genuine owner signature exists over something.
    #[test]
    fn a_signature_over_another_delegation_does_not_transfer() {
        let mut other_bytes = record_bytes();
        // One byte of the body differs: a different delegation id, hence a different subject.
        other_bytes[MAGIC.len() + OFF_DELEGATION_ID] ^= 0xff;
        let other = decode_signed_owner_programme_delegation(&other_bytes).expect("well-formed");

        let oracle = FixtureSignatureOracle {
            accepts_subject: other.canonical_subject(),
            seen: std::cell::RefCell::new(Vec::new()),
        };
        assert_eq!(
            verify_delegation_with_oracle(&decoded(), &expected(), &now(), &active(), &oracle),
            Err(DelegationRefusal::SignatureRefused)
        );
    }

    /// A GENUINE DELEGATION FOR ANOTHER PROGRAMME IS STILL REFUSED.
    #[test]
    fn a_genuinely_signed_delegation_for_another_programme_is_refused() {
        let record = decoded();
        let oracle = oracle_for(&record);
        for wrong in [
            ExpectedProgramme::fixture([0xee; DELEGATION_DIGEST_LEN], REPOSITORY),
            ExpectedProgramme::fixture(PROJECT, [0xee; DELEGATION_DIGEST_LEN]),
        ] {
            assert_eq!(
                verify_delegation_with_oracle(&record, &wrong, &now(), &active(), &oracle),
                Err(DelegationRefusal::ProgrammeMismatch),
                "a signature is provenance, not relevance"
            );
        }
    }

    /// AN EXPIRED OR ENDED DELEGATION IS REFUSED, however genuine.
    #[test]
    fn an_expired_revoked_or_completed_delegation_is_refused() {
        let record = decoded();
        let oracle = oracle_for(&record);

        // Exactly at the expiry instant it has expired.
        assert_eq!(
            verify_delegation_with_oracle(&record, &expected(), &at(EXPIRES), &active(), &oracle),
            Err(DelegationRefusal::NotLive)
        );
        assert_eq!(
            verify_delegation_with_oracle(
                &record,
                &expected(),
                &at(EXPIRES + 1),
                &active(),
                &oracle
            ),
            Err(DelegationRefusal::NotLive)
        );

        let mut ended = record_bytes();
        ended[MAGIC.len() + OFF_REVOKED] = 1;
        let ended = decode_signed_owner_programme_delegation(&ended).expect("well-formed");
        let ended_oracle = oracle_for(&ended);
        assert_eq!(
            verify_delegation_with_oracle(&ended, &expected(), &now(), &active(), &ended_oracle),
            Err(DelegationRefusal::NotLive)
        );
    }

    /// ONLY ONE OPERATION CLASS IS SAYABLE, and it is refused at decode rather than later.
    #[test]
    fn no_other_operation_class_can_be_delegated() {
        for class in [
            OperationClass::ProviderIdentityRead,
            OperationClass::StagingRead,
        ] {
            let mut bytes = record_bytes();
            bytes[MAGIC.len() + OFF_OPERATION] = class.discriminant();
            assert_eq!(
                decode_signed_owner_programme_delegation(&bytes),
                Err(DelegationRefusal::OperationNotDelegable),
                "{class:?} must never be delegable"
            );
        }
        // An operation nobody defined is malformed, not merely non-delegable.
        let mut unknown = record_bytes();
        unknown[MAGIC.len() + OFF_OPERATION] = 0xfe;
        assert_eq!(
            decode_signed_owner_programme_delegation(&unknown),
            Err(DelegationRefusal::RecordMalformed)
        );
    }

    /// EVERY MALFORMED SPELLING IS REFUSED, and none of them reaches a signature check.
    #[test]
    fn a_malformed_record_is_refused_at_decode() {
        let good = record_bytes();

        // Wrong length, either way.
        assert_eq!(
            decode_signed_owner_programme_delegation(&good[..good.len() - 1]),
            Err(DelegationRefusal::RecordMalformed)
        );
        let mut longer = good.clone();
        longer.push(0);
        assert_eq!(
            decode_signed_owner_programme_delegation(&longer),
            Err(DelegationRefusal::RecordMalformed)
        );
        assert_eq!(
            decode_signed_owner_programme_delegation(&[]),
            Err(DelegationRefusal::RecordMalformed)
        );

        // Wrong magic.
        let mut magic = good.clone();
        magic[0] ^= 0xff;
        assert_eq!(
            decode_signed_owner_programme_delegation(&magic),
            Err(DelegationRefusal::RecordMalformed)
        );

        // Wrong schema version.
        let mut schema = good.clone();
        schema[MAGIC.len() + OFF_SCHEMA + 3] = 2;
        assert_eq!(
            decode_signed_owner_programme_delegation(&schema),
            Err(DelegationRefusal::SchemaVersionUnsupported)
        );

        // A boolean with a third value.
        let mut tristate = good.clone();
        tristate[MAGIC.len() + OFF_REVOKED] = 2;
        assert_eq!(
            decode_signed_owner_programme_delegation(&tristate),
            Err(DelegationRefusal::RecordMalformed)
        );

        // Non-canonical NUL padding in the key id: one encoding per value, or a signature covers
        // only one of them.
        let mut padding = good.clone();
        padding[MAGIC.len() + OFF_KEY_ID + KEY_ID_LEN - 1] = b'x';
        assert_eq!(
            decode_signed_owner_programme_delegation(&padding),
            Err(DelegationRefusal::RecordMalformed)
        );

        // An empty key id names no key at all.
        let mut nameless = good.clone();
        nameless[MAGIC.len() + OFF_KEY_ID..MAGIC.len() + OFF_KEY_ID + KEY_ID_LEN].fill(0);
        assert_eq!(
            decode_signed_owner_programme_delegation(&nameless),
            Err(DelegationRefusal::RecordMalformed)
        );

        // Phase padding that is not padding.
        let mut dirty = good.clone();
        let third = MAGIC.len() + OFF_PHASES + 2 * DELEGATION_DIGEST_LEN;
        dirty[third] = 1;
        assert_eq!(
            decode_signed_owner_programme_delegation(&dirty),
            Err(DelegationRefusal::RecordMalformed)
        );
    }

    /// A WRONG SIGNING DOMAIN IS A DIFFERENT ALGORITHM NAME, AND IT IS REFUSED.
    #[test]
    fn an_unsupported_algorithm_is_refused() {
        let mut bytes = record_bytes();
        let alg_at = MAGIC.len() + DELEGATION_BODY_LEN;
        bytes[alg_at..alg_at + ALGORITHM_LEN].fill(0);
        bytes[alg_at..alg_at + 5].copy_from_slice(b"rs256");
        assert_eq!(
            decode_signed_owner_programme_delegation(&bytes),
            Err(DelegationRefusal::AlgorithmUnsupported)
        );
    }

    /// BOUNDS ARE BOUNDS.
    #[test]
    fn an_out_of_bounds_phase_count_or_absent_ceiling_is_refused() {
        for count in [0u8, (MAX_DELEGATED_PHASES + 1) as u8, 0xff] {
            let mut bytes = record_bytes();
            bytes[MAGIC.len() + OFF_PHASE_COUNT] = count;
            assert_eq!(
                decode_signed_owner_programme_delegation(&bytes),
                Err(DelegationRefusal::BoundsRefused),
                "phase count {count} must be refused"
            );
        }
        let mut no_ceiling = record_bytes();
        no_ceiling[MAGIC.len() + OFF_BUDGET..MAGIC.len() + OFF_BUDGET + 8].fill(0);
        assert_eq!(
            decode_signed_owner_programme_delegation(&no_ceiling),
            Err(DelegationRefusal::BoundsRefused),
            "a ceiling of zero is not a ceiling"
        );
    }

    /// THE RECORD IS A CLAIM. Decoding one grants nothing.
    ///
    /// This is the property the whole module rests on: `decode` is public and anyone may call it,
    /// and what comes back cannot be turned into authority without the oracle — which no code
    /// outside this crate can name, implement or reach.
    #[test]
    fn decoding_a_record_is_not_verifying_it() {
        let record = decoded();
        // Everything readable here is what the record CLAIMS.
        assert_eq!(record.claimed_delegation().project, PROJECT);
        assert_eq!(record.signing_key_id(), "projectos-signing-20260812");
        assert_eq!(record.signature_algorithm(), DELEGATION_SIGNATURE_ALGORITHM);
        assert_eq!(record.signature_hex().len(), SIGNATURE_LEN * 2);
        assert!(record
            .signature_hex()
            .chars()
            .all(|c| c.is_ascii_hexdigit()));
        // And there is no accessor, method or conversion on it that reports verification.
    }

    /// THE PRODUCTION ANCHOR REFUSES EVERY RECORD WE CAN BUILD, and that is the correct result.
    ///
    /// The embedded anchor is the owner's REAL public key. ProjectOS does not hold the private half
    /// and must never hold it, so no test can manufacture a signature that satisfies this — which
    /// means every one of these refusals is a genuine production-path proof, not a fixture's
    /// opinion. The positive case is proven separately, through the identical verification order,
    /// with the oracle as the only substituted part.
    ///
    /// If this test ever starts failing, something has taught the production path to accept a
    /// signature nobody made.
    #[test]
    fn the_production_path_refuses_every_signature_we_can_produce() {
        let record = decoded();
        assert_eq!(
            verify_owner_programme_delegation(&record, &expected(), &now(), &active()),
            Err(DelegationRefusal::SignatureRefused),
            "an invented signature must never satisfy the owner's anchor"
        );

        // Not a fluke of one byte pattern: nothing we can write satisfies it.
        for fill in [0x00u8, 0x01, 0x7f, 0xff] {
            let mut bytes = record_bytes();
            let sig_at = MAGIC.len() + DELEGATION_BODY_LEN + ALGORITHM_LEN;
            bytes[sig_at..].fill(fill);
            let forged = decode_signed_owner_programme_delegation(&bytes).expect("well-formed");
            assert_eq!(
                verify_owner_programme_delegation(&forged, &expected(), &now(), &active()),
                Err(DelegationRefusal::SignatureRefused)
            );
        }
    }

    /// THE PRODUCTION PATH SETTLES PROVENANCE FIRST.
    ///
    /// A record for the wrong programme, and an expired one, both come back as a SIGNATURE refusal
    /// rather than as a policy refusal — because the signature gate stands in front of both and no
    /// policy comparison is performed on behalf of bytes nobody signed.
    #[test]
    fn the_production_path_never_reports_policy_for_an_unsigned_record() {
        let record = decoded();
        let wrong = ExpectedProgramme::fixture(
            [0xee; DELEGATION_DIGEST_LEN],
            [0xee; DELEGATION_DIGEST_LEN],
        );
        assert_eq!(
            verify_owner_programme_delegation(&record, &wrong, &at(EXPIRES + 10_000), &active()),
            Err(DelegationRefusal::SignatureRefused),
            "provenance is decided before relevance, so this must not leak a policy verdict"
        );
    }

    // =============================================================================================
    // HOST-RESOLVED BINDING AUTHORITY: the host's own clock and the host's own word on lifecycle.
    // =============================================================================================

    /// THE HOST'S LOCAL STATE OVERRIDES A SIGNED COPY THAT STILL SAYS ACTIVE.
    ///
    /// The record is genuine, for this programme, unexpired, and its signed flag says live. The only
    /// thing that differs is what the host itself recorded - and that is enough.
    #[test]
    fn a_revoked_or_completed_local_state_refuses_an_otherwise_valid_signed_delegation() {
        let record = decoded();
        let oracle = oracle_for(&record);
        // Positive control: with the host's state Active, the same everything verifies.
        assert!(
            verify_delegation_with_oracle(&record, &expected(), &now(), &active(), &oracle).is_ok()
        );

        for ended in [
            DelegationLocalState::Revoked,
            DelegationLocalState::Completed,
        ] {
            let local = HostDelegationStatus::fixture(RECORD_ID, ended);
            assert_eq!(
                verify_delegation_with_oracle(&record, &expected(), &now(), &local, &oracle),
                Err(DelegationRefusal::NotLive),
                "{ended:?} recorded by the host must end the delegation whatever the record says"
            );
        }
    }

    /// A STATUS ABOUT ANOTHER DELEGATION ANSWERS NOTHING - not even an Active one.
    #[test]
    fn a_local_status_for_another_delegation_is_refused() {
        let record = decoded();
        let oracle = oracle_for(&record);
        let other = HostDelegationStatus::fixture(
            [0xab; DELEGATION_DIGEST_LEN],
            DelegationLocalState::Active,
        );
        assert_eq!(
            verify_delegation_with_oracle(&record, &expected(), &now(), &other, &oracle),
            Err(DelegationRefusal::LocalStatusMismatch)
        );
    }

    /// THE SIGNED FLAG AND THE LOCAL STATE ARE ANDED. A signed "ended" record is refused even when
    /// the host's own state is Active - the host's state overrides towards refusal, never towards
    /// permission.
    #[test]
    fn an_active_local_state_does_not_resurrect_a_signed_ended_record() {
        let mut ended = record_bytes();
        ended[MAGIC.len() + OFF_REVOKED] = 1;
        let ended = decode_signed_owner_programme_delegation(&ended).expect("well-formed");
        let oracle = oracle_for(&ended);
        assert_eq!(
            verify_delegation_with_oracle(&ended, &expected(), &now(), &active(), &oracle),
            Err(DelegationRefusal::NotLive)
        );
    }

    /// PROVENANCE STILL COMES FIRST. A revoked local state on an UNSIGNED record reports the
    /// signature, so the local ledger is never consulted on behalf of bytes nobody signed.
    #[test]
    fn local_state_is_not_consulted_for_an_unsigned_record() {
        let record = decoded();
        let local = HostDelegationStatus::fixture(RECORD_ID, DelegationLocalState::Revoked);
        assert_eq!(
            verify_delegation_with_oracle(&record, &expected(), &now(), &local, &refusing_oracle()),
            Err(DelegationRefusal::SignatureRefused)
        );
    }

    /// EXPIRY IS DECIDED BY THE HOST'S SEALED READING. The same record, the same status; only the
    /// host's reading moves, and there is no other clock argument left to move.
    #[test]
    fn expiry_is_decided_by_the_host_clock_reading() {
        let record = decoded();
        let oracle = oracle_for(&record);
        assert!(verify_delegation_with_oracle(
            &record,
            &expected(),
            &at(EXPIRES - 1),
            &active(),
            &oracle
        )
        .is_ok());
        for reading in [EXPIRES, EXPIRES + 1, u64::MAX] {
            assert_eq!(
                verify_delegation_with_oracle(
                    &record,
                    &expected(),
                    &at(reading),
                    &active(),
                    &oracle
                ),
                Err(DelegationRefusal::NotLive),
                "a host reading of {reading} is at or past expiry"
            );
        }
    }

    /// THE PRODUCTION READING IS A REAL CLOCK. It is read inside, takes nothing, and reports a
    /// calendar time this crate could not have been built before.
    #[test]
    fn the_production_clock_reading_comes_from_the_host_clock() {
        let reading = HostClockReading::now_from_host().expect("the host clock is available");
        // 2025-01-01T00:00:00Z. A reading before this is not the host's clock.
        assert!(reading.epoch_s() >= 1_735_689_600);
        let later = HostClockReading::now_from_host().expect("still available");
        assert!(
            later.epoch_s() >= reading.epoch_s(),
            "the host clock does not run backwards"
        );
    }

    /// THE LAYOUT IS FIXED. A silent change to any offset would invalidate every signature the owner
    /// has ever made over this schema, so the arithmetic is pinned rather than trusted.
    #[test]
    fn the_record_layout_is_exactly_what_the_owner_signs_over() {
        assert_eq!(DELEGATION_BODY_LEN, 1367);
        assert_eq!(SIGNED_DELEGATION_RECORD_LEN, 8 + 1367 + 16 + 64);
        assert_eq!(SIGNED_DELEGATION_RECORD_LEN, 1455);
        assert_eq!(record_bytes().len(), SIGNED_DELEGATION_RECORD_LEN);
        // The domain tag is stable, and it is not JSON.
        assert_eq!(
            DELEGATION_SIGNING_DOMAIN,
            b"projectos.owner-programme-delegation.v1\n"
        );
    }
}
