//! The bounded gatekeeper REQUEST INBOX — RUN-TO-COMPLETION HOST ATTESTATION.
//!
//! ## Why an inbox exists at all
//!
//! The authority wire is 512 bytes of identifiers and digests and must stay that way. A gatekeeper
//! review subject is thousands of bytes. So the subject does not cross the authority wire: the wire
//! carries a `parameter_digest`, and the bytes travel out of band. This module is the contract for
//! that out-of-band half.
//!
//! ## The inbox is NOT trusted
//!
//! Living under ProgramData does not make a file trustworthy. Its contents are UNTRUSTED INPUT, and
//! nothing here treats them otherwise. The inbox contributes exactly one thing — bytes — and every
//! authority fact about the request (project, repository, plan, plan digest, phase, candidate,
//! delegation, operation, model, credential, budget, protected-effect state) is resolved by the host
//! from its own sources. A disagreement between what the bytes say and what the host resolved is a
//! refusal, never a merge.
//!
//! ## What this module cannot do
//!
//! It opens no file, creates no directory, changes no ACL, elevates nothing, spawns nothing, holds
//! no credential and makes no Windows call. The filesystem is an injected [`InboxReader`] port, so
//! every property below is provable without touching a disk — and the live path, when it exists,
//! cannot acquire a capability this contract does not describe.

#![forbid(unsafe_code)]

/// THE HOST OPERATION: the ordered production decision for one independent gatekeeper review.
pub mod operation;

use std::collections::HashSet;
use std::io::Read;

use sha2::{Digest, Sha256};

/// Length of the correlation a request is identified by, matching the authority wire.
pub const CORRELATION_LEN: usize = 16;

/// Length of a SHA-256 digest.
pub const DIGEST_LEN: usize = 32;

/// The maximum bytes one review subject may occupy.
///
/// A BOUND, NOT A GUESS. The largest request this programme has actually formed was 8,329 bytes, so
/// 64 KiB is roughly eight times the observed need — comfortable for a subject that grows, and far
/// too small to be a channel for anything else. An unbounded inbox would let a caller hand the host
/// an arbitrary amount of work to hash and an arbitrary amount of text to send to a paid provider,
/// which is a denial-of-service and a cost attack in one.
pub const MAX_REQUEST_BODY_BYTES: usize = 64 * 1024;

/// The fixed inbox subdirectory beneath the ProjectOS ProgramData root.
///
/// A LEAF, deliberately. The narrow ACE that later lets the owner/agent identity write here belongs
/// to this directory alone: the ProgramData root above it keeps its Host-only write boundary, and
/// nothing else inherits the inbox's permission. It is a constant rather than configuration because
/// an inbox location a caller could redirect is an inbox an attacker chooses.
pub const INBOX_RELATIVE_ROOT: &str = "gatekeeper-inbox";

/// The fixed extension of a request file.
pub const REQUEST_FILE_EXTENSION: &str = "request";

/// Why an inbox request could not be accepted. Coarse on purpose: a refusal taxonomy is an oracle,
/// so it names the gate that refused and never the value that failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum InboxRefusal {
    /// Nothing was there to open at the derived identity.
    ///
    /// DISTINCT FROM [`InboxRefusal::RequestUnreadable`], and the distinction is load-bearing: this
    /// is the only refusal that does NOT consume the request identity, because "not written yet" is
    /// a race rather than an answer.
    RequestNotPresent,
    /// The request opened but could not be read to the end.
    ///
    /// A SEPARATE OUTCOME, not folded into absence. Collapsing the two would mean a reader that
    /// fails mid-read is retryable for ever, because the one refusal that does not consume the
    /// identity would also cover every I/O failure. Something WAS there and we failed to read it —
    /// that is an answer, so it is spent like any other.
    RequestUnreadable,
    /// The body exceeded [`MAX_REQUEST_BODY_BYTES`].
    RequestTooLarge,
    /// The bytes read did not hash to the digest the authority wire carried.
    ParameterDigestMismatch,
    /// This request identity was already consumed. One-shot means one shot.
    AlreadyConsumed,
}

/// The identity of one request file, derived and never supplied.
///
/// A CALLER CANNOT NAME A FILE. There is no constructor taking a path, a name, a directory or a
/// string of any kind — the only way to obtain one is [`RequestFileIdentity::for_correlation`],
/// which renders the correlation from the authority wire as lower-case hex and appends a fixed
/// extension. Hex has no separator, no dot segment, no drive letter, no UNC prefix and no NUL, so a
/// traversal, an absolute path, an alternate root, an ADS suffix or a device name is not merely
/// rejected — it is unrepresentable.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RequestFileIdentity {
    file_name: String,
}

impl RequestFileIdentity {
    /// Derive the file identity from the correlation the authority wire already carries.
    #[must_use]
    pub fn for_correlation(correlation: &[u8; CORRELATION_LEN]) -> Self {
        let mut file_name =
            String::with_capacity(CORRELATION_LEN * 2 + 1 + REQUEST_FILE_EXTENSION.len());
        // A closed table rather than `from_digit(..).unwrap_or('0')`: the fallback branch was
        // unreachable, and unreachable error handling is a place a future reader has to reason about
        // for nothing. Indexing a 16-entry table with a value masked to 0..=15 cannot fail.
        const HEX: [u8; 16] = *b"0123456789abcdef";
        for b in correlation {
            file_name.push(HEX[usize::from(b >> 4)] as char);
            file_name.push(HEX[usize::from(b & 0x0f)] as char);
        }
        file_name.push('.');
        file_name.push_str(REQUEST_FILE_EXTENSION);
        Self { file_name }
    }

    /// The file name, relative to the inbox root. Never absolute, never nested.
    #[must_use]
    pub fn file_name(&self) -> &str {
        &self.file_name
    }
}

/// One OPEN of one request file. The implementation opens; it never reads.
///
/// THE BOUND IS STRUCTURAL, NOT A PROMISE. This trait used to hand the implementation a `max_bytes`
/// and ask it to stop there — which is a prose MUST, and a conforming-by-the-letter implementation
/// could read a multi-gigabyte file into memory and then "report the overrun" by returning all of
/// it. That defeats the very cost and denial-of-service argument the limit exists for, because the
/// unbounded work has already happened by the time anyone checks a length.
///
/// So the implementation no longer reads at all. It returns an open stream, and
/// [`accept_request_body`] does the reading through a cap it controls. An implementation cannot
/// perform an unbounded read because it is never the thing doing the reading.
///
/// It is still ONE act: there is no `stat`, no `exists`, no `len` and no way to open the same
/// identity twice through this port within an acceptance, so a caller cannot measure one version
/// and consume another.
pub trait InboxReader {
    /// Open the request body, or `None` if it is not present or cannot be opened.
    ///
    /// The returned stream is read exactly once, to a cap this crate applies. Whatever happens to
    /// the underlying file afterwards cannot affect the bytes already read.
    fn open_once(&self, identity: &RequestFileIdentity) -> Option<Box<dyn Read + '_>>;
}

/// Bytes proven to be the subject the authority wire named.
///
/// Sealed: private field, no public constructor, no `Default`. The only way to obtain one is
/// [`accept_request_body`], which means possession IS the proof that these exact bytes hashed to the
/// `parameter_digest` carried on the wire. Nothing else may be sent to a provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedRequestBody {
    bytes: Vec<u8>,
}

impl VerifiedRequestBody {
    /// The exact verified bytes. These, and only these, are the provider input.
    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

/// Read a request body once, under a cap this crate enforces, and bind it to the digest the
/// authority wire carried.
///
/// ONE READ, CAPPED HERE, AND THE BYTES NEVER LEAVE MEMORY AGAIN. The stream is read through
/// `take(MAX + 1)`, so at most one byte beyond the limit is ever allocated — an oversized body is
/// detected without the host doing the work an attacker wanted done. The bytes read are hashed, and
/// that very same `Vec` is moved into the [`VerifiedRequestBody`]. There is no second read, no path
/// retained and no re-open, so a mutation after this returns cannot change what was accepted.
///
/// SIZE IS CHECKED BEFORE THE DIGEST, and now the read itself is bounded too, so neither the hash
/// nor the allocation can be made arbitrarily expensive.
pub fn accept_request_body(
    reader: &dyn InboxReader,
    identity: &RequestFileIdentity,
    parameter_digest: &[u8; DIGEST_LEN],
) -> Result<VerifiedRequestBody, InboxRefusal> {
    let mut stream = reader
        .open_once(identity)
        .ok_or(InboxRefusal::RequestNotPresent)?;

    // One byte past the limit is enough to KNOW it is over the limit, and is all we are willing to
    // spend finding out.
    let mut bytes = Vec::new();
    let read = std::io::Read::take(&mut stream, (MAX_REQUEST_BODY_BYTES + 1) as u64)
        .read_to_end(&mut bytes);
    if read.is_err() {
        // Something was there and we could not read it. That is not absence.
        return Err(InboxRefusal::RequestUnreadable);
    }
    if bytes.len() > MAX_REQUEST_BODY_BYTES {
        return Err(InboxRefusal::RequestTooLarge);
    }

    let mut h = Sha256::new();
    h.update(&bytes);
    let seen: [u8; DIGEST_LEN] = h.finalize().into();
    if &seen != parameter_digest {
        return Err(InboxRefusal::ParameterDigestMismatch);
    }
    Ok(VerifiedRequestBody { bytes })
}

/// The one-shot lifecycle of a request identity.
///
/// A REQUEST FILE MUST NEVER BECOME REUSABLE AUTHORITY. Left alone, a file that satisfied one call
/// would satisfy the next one identically — same bytes, same digest, same everything — so a stale
/// inbox would quietly authorise repeats. The identity is therefore consumed at the moment it is
/// accepted OR refused, and a consumed identity is refused before anything is read.
///
/// Consumption here is SEPARATE from attestation consumption. Both are one-shot and they protect
/// different things: this stops the same question being asked twice, the attestation's own one-shot
/// state stops the same answer being spent twice.
///
/// IN MEMORY ONLY, AND THAT LIMIT IS REAL. `consumed` lives in this process, so a host restart
/// forgets every request it has answered. If a live inbox implementation does not also delete the
/// request file on consumption, the same correlation could be accepted again after a restart and
/// re-executed against a paid provider. That is a repeat-cost and repeat-review exposure rather than
/// an integrity break — the second run would mint its own correctly-attributed attestation with its
/// own provider response id, not forge or overwrite the first — but "cannot be replayed" is not yet
/// true across a restart, and saying so plainly is better than a guarantee that quietly has a
/// boundary. Durable lifecycle state is owed by the phase that gives this crate a real store.
#[derive(Debug, Default)]
pub struct RequestLifecycle {
    /// A SET, not a list. A linear scan over an ever-growing vector makes every later review pay for
    /// every earlier one, and a host process is long-running — so the cost of remembering would have
    /// grown without bound for as long as the service stayed up.
    consumed: HashSet<RequestFileIdentity>,
}

impl RequestLifecycle {
    /// A fresh lifecycle with nothing consumed.
    #[must_use]
    pub fn new() -> Self {
        Self {
            consumed: HashSet::new(),
        }
    }

    /// Whether this identity has already been used, successfully or not.
    #[must_use]
    pub fn is_consumed(&self, identity: &RequestFileIdentity) -> bool {
        self.consumed.contains(identity)
    }

    /// Accept a request exactly once.
    ///
    /// CONSUMED ON EVERY ANSWER EXCEPT "NOT THERE YET", and the exception is the whole subtlety.
    /// Consuming only on success would leave a refused request retryable, so a caller could grind
    /// against the digest check with the same identity until something matched — that is why a
    /// digest mismatch, an oversized body and a stale identity all burn the correlation permanently.
    ///
    /// But absence is not an attack, it is a race. If the host can ever look before the client has
    /// finished writing, burning the correlation there would make a benign timing overlap
    /// permanently unrecoverable under the only identity the request has. The two cases are
    /// distinguished rather than collapsed: nothing was read, nothing was learned, and nothing is
    /// spent. An attacker gains nothing by probing an absent file, because an absent file answers
    /// no question about the digest.
    pub fn accept_once(
        &mut self,
        reader: &dyn InboxReader,
        identity: &RequestFileIdentity,
        parameter_digest: &[u8; DIGEST_LEN],
    ) -> Result<VerifiedRequestBody, InboxRefusal> {
        if self.is_consumed(identity) {
            return Err(InboxRefusal::AlreadyConsumed);
        }
        let outcome = accept_request_body(reader, identity, parameter_digest);
        // ONLY true absence is exempt. Every other outcome — including a read that failed part-way —
        // is an answer, and answers are spent.
        if !matches!(outcome, Err(InboxRefusal::RequestNotPresent)) {
            self.consumed.insert(identity.clone());
        }
        outcome
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest_of(bytes: &[u8]) -> [u8; DIGEST_LEN] {
        let mut h = Sha256::new();
        h.update(bytes);
        h.finalize().into()
    }

    /// A reader that OPENS whatever it was given. It never reads — reading is this crate's job, and
    /// the cap lives there.
    struct FakeInbox {
        body: Option<Vec<u8>>,
    }
    impl InboxReader for FakeInbox {
        fn open_once(&self, _identity: &RequestFileIdentity) -> Option<Box<dyn Read + '_>> {
            self.body
                .as_ref()
                .map(|b| Box::new(std::io::Cursor::new(b.clone())) as Box<dyn Read + '_>)
        }
    }

    /// A HOSTILE reader: it offers an effectively endless stream and would happily hand over
    /// gigabytes if anything let it. It exists to prove the cap is structural — under the old port
    /// shape this implementation could have satisfied the contract by reading everything first.
    struct EndlessInbox;
    impl InboxReader for EndlessInbox {
        fn open_once(&self, _identity: &RequestFileIdentity) -> Option<Box<dyn Read + '_>> {
            Some(Box::new(std::io::repeat(0xAB)))
        }
    }

    fn correlation(seed: u8) -> [u8; CORRELATION_LEN] {
        [seed; CORRELATION_LEN]
    }

    /// (11)(12) A CALLER CANNOT NAME A FILE, so traversal is unrepresentable rather than filtered.
    ///
    /// There is no constructor that takes a path or a string; the only input is 16 bytes from the
    /// authority wire, and every byte renders as two hex digits. This asserts the rendering really is
    /// closed over that alphabet for every possible byte, so no input can produce a separator, a dot
    /// segment, a drive letter, a UNC prefix, an alternate-data-stream suffix or a device name.
    #[test]
    fn a_derived_file_identity_can_only_ever_be_hex() {
        for seed in [0u8, 1, 0x2e, 0x2f, 0x5c, 0x3a, 0x7c, 0xff] {
            let id = RequestFileIdentity::for_correlation(&correlation(seed));
            let name = id.file_name();
            let (stem, ext) = name.split_once('.').expect("one extension");
            assert_eq!(ext, REQUEST_FILE_EXTENSION);
            assert_eq!(stem.len(), CORRELATION_LEN * 2);
            assert!(
                stem.chars()
                    .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
                "{name} must be lower-case hex only"
            );
            for forbidden in ['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0'] {
                assert!(
                    !name.contains(forbidden),
                    "{name} must not contain {forbidden:?}"
                );
            }
            assert!(!name.contains(".."), "{name} must not traverse");
        }
    }

    /// Distinct correlations are distinct files. A collision would let one request read another's.
    #[test]
    fn distinct_correlations_derive_distinct_identities() {
        let a = RequestFileIdentity::for_correlation(&correlation(1));
        let b = RequestFileIdentity::for_correlation(&correlation(2));
        assert_ne!(a, b);
        assert_eq!(a, RequestFileIdentity::for_correlation(&correlation(1)));
    }

    /// The exact case: bytes that hash to the wire's digest are accepted, and are the exact bytes.
    #[test]
    fn bytes_matching_the_parameter_digest_are_accepted_verbatim() {
        let body = b"the exact review subject".to_vec();
        let inbox = FakeInbox {
            body: Some(body.clone()),
        };
        let id = RequestFileIdentity::for_correlation(&correlation(1));
        let verified = accept_request_body(&inbox, &id, &digest_of(&body)).expect("accepted");
        assert_eq!(verified.bytes(), &body[..]);
    }

    /// (13)(15) A DIGEST MISMATCH IS REFUSED — which is also what a mutation before the host's read
    /// looks like from here. The bytes the host read are not the bytes the agent hashed, and that is
    /// exactly the case this check exists for.
    #[test]
    fn a_digest_mismatch_is_refused() {
        let id = RequestFileIdentity::for_correlation(&correlation(1));
        let announced = digest_of(b"what the agent wrote and hashed");
        let inbox = FakeInbox {
            body: Some(b"what somebody else put there instead".to_vec()),
        };
        assert_eq!(
            accept_request_body(&inbox, &id, &announced),
            Err(InboxRefusal::ParameterDigestMismatch)
        );
    }

    /// (16) A MUTATION AFTER THE HOST'S READ CANNOT ALTER WHAT WAS ACCEPTED.
    ///
    /// The verified body owns its bytes. The file is rewritten afterwards — here, as completely as
    /// possible — and the accepted subject is unchanged, because nothing re-opens it.
    #[test]
    fn a_mutation_after_acceptance_cannot_change_the_accepted_bytes() {
        let body = b"the subject the host actually read".to_vec();
        let mut inbox = FakeInbox {
            body: Some(body.clone()),
        };
        let id = RequestFileIdentity::for_correlation(&correlation(1));
        let verified = accept_request_body(&inbox, &id, &digest_of(&body)).expect("accepted");

        // The file becomes something else entirely, or vanishes.
        inbox.body = Some(b"a different question entirely".to_vec());
        assert_eq!(verified.bytes(), &body[..]);
        inbox.body = None;
        assert_eq!(verified.bytes(), &body[..]);
    }

    /// (14) AN OVERSIZED BODY IS REFUSED, and refused before it is hashed.
    #[test]
    fn an_oversized_body_is_refused() {
        let big = vec![0u8; MAX_REQUEST_BODY_BYTES + 1];
        let inbox = FakeInbox {
            body: Some(big.clone()),
        };
        let id = RequestFileIdentity::for_correlation(&correlation(1));
        // Even with a digest that genuinely matches, size refuses first.
        assert_eq!(
            accept_request_body(&inbox, &id, &digest_of(&big)),
            Err(InboxRefusal::RequestTooLarge)
        );

        // Exactly at the bound is allowed: the limit is a maximum, not an off-by-one.
        let exact = vec![7u8; MAX_REQUEST_BODY_BYTES];
        let inbox = FakeInbox {
            body: Some(exact.clone()),
        };
        assert!(accept_request_body(&inbox, &id, &digest_of(&exact)).is_ok());
    }

    /// An absent request is refused rather than treated as an empty subject.
    #[test]
    fn an_absent_request_is_refused() {
        let inbox = FakeInbox { body: None };
        let id = RequestFileIdentity::for_correlation(&correlation(1));
        assert_eq!(
            accept_request_body(&inbox, &id, &digest_of(b"")),
            Err(InboxRefusal::RequestNotPresent)
        );
    }

    /// (17) ONE SHOT. A stale or already-used request cannot authorise a later call.
    #[test]
    fn a_consumed_request_identity_is_refused() {
        let body = b"one question, asked once".to_vec();
        let inbox = FakeInbox {
            body: Some(body.clone()),
        };
        let id = RequestFileIdentity::for_correlation(&correlation(1));
        let mut life = RequestLifecycle::new();

        assert!(life.accept_once(&inbox, &id, &digest_of(&body)).is_ok());
        assert!(life.is_consumed(&id));
        assert_eq!(
            life.accept_once(&inbox, &id, &digest_of(&body)),
            Err(InboxRefusal::AlreadyConsumed),
            "the same file must not answer twice"
        );

        // A different request is unaffected.
        let other = RequestFileIdentity::for_correlation(&correlation(2));
        assert!(!life.is_consumed(&other));
    }

    /// A REFUSED request is consumed too, so the digest check cannot be ground against.
    #[test]
    fn a_refused_request_is_also_consumed() {
        let inbox = FakeInbox {
            body: Some(b"not what was announced".to_vec()),
        };
        let id = RequestFileIdentity::for_correlation(&correlation(1));
        let mut life = RequestLifecycle::new();

        assert_eq!(
            life.accept_once(&inbox, &id, &digest_of(b"announced")),
            Err(InboxRefusal::ParameterDigestMismatch)
        );
        assert_eq!(
            life.accept_once(&inbox, &id, &digest_of(b"not what was announced")),
            Err(InboxRefusal::AlreadyConsumed),
            "a refused identity must not be retryable under a different digest"
        );
    }

    /// THE CAP IS STRUCTURAL: an endless stream is refused without reading it all.
    ///
    /// The port hands over an open stream and this crate reads it through `take(MAX + 1)`, so the
    /// implementation never gets to decide how much is read. `std::io::repeat` would yield bytes
    /// forever; if the bound were still a prose MUST on the implementation, this test would not
    /// terminate. That it returns promptly with `RequestTooLarge` IS the proof.
    #[test]
    fn an_endless_stream_is_refused_without_reading_it_all() {
        let id = RequestFileIdentity::for_correlation(&correlation(1));
        assert_eq!(
            accept_request_body(&EndlessInbox, &id, &digest_of(b"anything")),
            Err(InboxRefusal::RequestTooLarge)
        );
    }

    /// A READ THAT FAILS PART-WAY IS AN ANSWER, AND IT IS SPENT.
    ///
    /// Something was there; we opened it and failed to finish reading it. Reporting that as absence
    /// would have folded it into the one refusal that does not consume the identity, making every
    /// I/O failure infinitely retryable under the same correlation. The two are separate outcomes.
    #[test]
    fn a_read_that_fails_partway_is_refused_and_consumed() {
        struct FailsMidRead;
        impl InboxReader for FailsMidRead {
            fn open_once(&self, _identity: &RequestFileIdentity) -> Option<Box<dyn Read + '_>> {
                Some(Box::new(
                    std::io::Cursor::new(b"partial".to_vec()).chain(BrokenReader),
                ))
            }
        }
        struct BrokenReader;
        impl Read for BrokenReader {
            fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("the file went away mid-read"))
            }
        }

        let id = RequestFileIdentity::for_correlation(&correlation(1));
        let mut life = RequestLifecycle::new();
        assert_eq!(
            life.accept_once(&FailsMidRead, &id, &digest_of(b"partial")),
            Err(InboxRefusal::RequestUnreadable)
        );
        assert!(
            life.is_consumed(&id),
            "an unreadable request is an answer and must be spent, unlike a genuinely absent one"
        );
    }

    /// ABSENCE IS A RACE, NOT AN ATTACK, so it does not burn the correlation.
    ///
    /// A benign write-then-notify overlap would otherwise make a request permanently unrecoverable
    /// under the only identity it has. Every other refusal still burns it — proven above.
    #[test]
    fn an_absent_request_does_not_consume_the_identity() {
        let id = RequestFileIdentity::for_correlation(&correlation(1));
        let mut life = RequestLifecycle::new();

        let absent = FakeInbox { body: None };
        assert_eq!(
            life.accept_once(&absent, &id, &digest_of(b"x")),
            Err(InboxRefusal::RequestNotPresent)
        );
        assert!(
            !life.is_consumed(&id),
            "a file that was not there yet must remain acceptable once it arrives"
        );

        // And once it arrives, the same identity still works.
        let body = b"x".to_vec();
        let present = FakeInbox {
            body: Some(body.clone()),
        };
        assert!(life.accept_once(&present, &id, &digest_of(&body)).is_ok());
        assert!(life.is_consumed(&id));
    }

    /// The inbox root is one plain leaf segment: it receives the narrow ACE, and nothing above it.
    #[test]
    fn the_inbox_root_is_a_single_leaf_segment() {
        assert!(!INBOX_RELATIVE_ROOT.is_empty());
        assert!(!INBOX_RELATIVE_ROOT.contains('/'));
        assert!(!INBOX_RELATIVE_ROOT.contains('\\'));
        assert!(!INBOX_RELATIVE_ROOT.contains(".."));
        assert!(!std::path::Path::new(INBOX_RELATIVE_ROOT).is_absolute());
    }
}
