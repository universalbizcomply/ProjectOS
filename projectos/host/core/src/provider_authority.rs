//! THE COLD-START PROVIDER-AUTHORITY SEAM.
//!
//! One machine-wide host authority yields ONE [`ProviderAuthorityLease`], which converts — exactly once,
//! and atomically — into a [`ProviderCapabilitySet`] holding the three production providers:
//! the runtime-instance verifier, the IPC-session verifier and the owner-presence capability.
//!
//! Why this exists: every production provider's constructor is crate-internal, and before this module
//! there was NO route to one, so a shipping build could hold no production authority at all.
//!
//! Why it is rooted in the existence token and NOT in the effect-grant typestate: an
//! `AuthorisedProofAttemptGrant` requires four witnesses INCLUDING an owner-approval witness, which
//! requires owner presence, which requires the owner-presence capability this seam issues. Rooting cold
//! start there would be circular and unsatisfiable. This is TIER 0 — it never involves the owner.
//! Per-operation, owner-bearing authority remains TIER 1 (the existing witness/grant path), which becomes
//! reachable only because Tier 0 established runtime, IPC and clock first.
//!
//! There is NO bootstrap data circularity: every production provider constructor takes no arguments and
//! draws its own process-unique generation, so none of them needs a `VerifiedRuntimeInstance` to exist.
//! The only question was ever *who may call them*, and the answer is: the holder of a confirmed
//! machine-wide authority, once per process.
//!
//! Authority lifetime: the [`ConfirmedAuthorityGuard`] is RETAINED by the lease and then MOVED into the
//! capability set, so the machine-wide authority cannot be released while any production capability
//! exists. Capabilities are reachable only by borrowing from the set; there is no accessor that yields a
//! capability by value, so a capability can never be extracted and outlive the authority that justified
//! it.
//!
//! Nothing here acquires a real authority name, performs a machine effect, or activates production.

use core::fmt;
use core::marker::PhantomData;
use core::sync::atomic::{AtomicU64, Ordering};

use projectos_host_authority::model::ConfirmedAuthorityGuard;

use crate::authority_time::VerifiedAuthorityTime;
use crate::ipc_session::{ConnectionBoundIpcSessionVerifier, ProductionIpcSessionVerifier};
use crate::owner_presence::ProductionOwnerPresenceCapability;
use crate::runtime_instance::ProductionRuntimeInstanceVerifier;

/// A raw pointer makes the containing type `!Send + !Sync` on stable, matching the other authority types.
type ThreadBound = PhantomData<*const ()>;

/// The longest cold-start window a lease may span, in trusted-clock units. A lease is a startup
/// handshake, not a session: it exists to be consumed immediately.
pub const MAX_LEASE_WINDOW: u64 = 300;

/// Why provider authority was refused. Fail-closed; names no object, handle, process or account.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ProviderAuthorityError {
    /// The requested lease window was zero or exceeded [`MAX_LEASE_WINDOW`].
    WindowInvalid,
    /// The lease was consumed at or after its expiry.
    Expired,
    /// The trusted clock provider identity changed between issuance and consumption.
    ProviderMismatch,
    /// The trusted clock epoch changed between issuance and consumption (a restart).
    EpochMismatch,
    /// The clock moved backwards between issuance and consumption.
    ClockRegressed,
}

impl fmt::Display for ProviderAuthorityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::WindowInvalid => "provider-authority lease window is invalid",
            Self::Expired => "provider-authority lease expired",
            Self::ProviderMismatch => "trusted-clock provider changed",
            Self::EpochMismatch => "trusted-clock epoch changed",
            Self::ClockRegressed => "trusted clock regressed",
        })
    }
}

impl std::error::Error for ProviderAuthorityError {}

/// Process-unique attempt counter. The high bit is set so a cold-start attempt id can never collide with
/// a zero/default value, and the value is NEVER caller-selectable.
fn next_attempt_id() -> u64 {
    static NEXT_ATTEMPT: AtomicU64 = AtomicU64::new(1);
    NEXT_ATTEMPT.fetch_add(1, Ordering::Relaxed) | (1u64 << 63)
}

/// A one-shot cold-start provider-authority lease.
///
/// Opaque, non-`Clone`, non-`Copy`, non-`Default`, non-serialisable, `!Send + !Sync`, redacted `Debug`.
/// It RETAINS the [`ConfirmedAuthorityGuard`], so the machine-wide authority stays held for the lease's
/// whole life. Converting it into capabilities MOVES it, so a lease can never be used twice — a replay is
/// a compile error, not a runtime check.
///
/// Every binding is issuer-assigned: the attempt id comes from a process-unique counter and the provider
/// identity, epoch and issuance reading come from the supplied [`VerifiedAuthorityTime`]. A caller
/// supplies none of them.
pub struct ProviderAuthorityLease {
    guard: ConfirmedAuthorityGuard,
    attempt_id: u64,
    provider_id: String,
    authority_epoch: u64,
    issued_at: u64,
    expires_at: u64,
    _thread_bound: ThreadBound,
}

impl fmt::Debug for ProviderAuthorityLease {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ProviderAuthorityLease([REDACTED])")
    }
}

/// Open the cold-start provider authority, CONSUMING a [`ConfirmedAuthorityGuard`].
///
/// This is the SOLE issuer of a [`ProviderAuthorityLease`]. It cannot be opened from a bare
/// [`projectos_host_authority::model::AuthorityGuard`], a peer-state value, a boolean or any other
/// caller-constructible input: `ConfirmedAuthorityGuard` has no public constructor outside its own crate's
/// confirmation route, and that route in turn requires an `AuthorityGuard`, which has none either.
///
/// Expiry reuses the existing verified authority-time contract; no new clock contract is introduced.
///
/// # Errors
/// [`ProviderAuthorityError::WindowInvalid`] if `window` is zero or exceeds [`MAX_LEASE_WINDOW`].
pub fn open_provider_authority(
    guard: ConfirmedAuthorityGuard,
    now: &VerifiedAuthorityTime,
    window: u64,
) -> Result<ProviderAuthorityLease, ProviderAuthorityError> {
    if window == 0 || window > MAX_LEASE_WINDOW {
        // `guard` drops here: authority is released rather than held by an unusable lease.
        return Err(ProviderAuthorityError::WindowInvalid);
    }
    let issued_at = now.reading();
    Ok(ProviderAuthorityLease {
        guard,
        attempt_id: next_attempt_id(),
        provider_id: now.provider_id().to_string(),
        authority_epoch: now.epoch(),
        issued_at,
        expires_at: issued_at.saturating_add(window),
        _thread_bound: PhantomData,
    })
}

impl ProviderAuthorityLease {
    /// The issuer-assigned cold-start attempt id. Readable for correlation; it is not authority and
    /// cannot be supplied or chosen by a caller.
    #[must_use]
    pub fn attempt_id(&self) -> u64 {
        self.attempt_id
    }

    /// Convert into the three production providers, CONSUMING the lease and MOVING the retained
    /// authority guard into the resulting set.
    ///
    /// Atomic by construction: it returns the whole set or the lease is gone. There is no method that
    /// issues one provider and retains the ability to issue the others later, and none that reissues a
    /// consumed lease — `self` is moved, so the borrow checker enforces both.
    ///
    /// Re-checks the live clock against issuance: a changed provider, a changed epoch (a restart), a
    /// regressed clock or an expired window all refuse and issue nothing.
    ///
    /// # Errors
    /// [`ProviderAuthorityError`] naming the first failed binding.
    pub fn into_provider_capabilities(
        self,
        now: &VerifiedAuthorityTime,
    ) -> Result<ProviderCapabilitySet, ProviderAuthorityError> {
        if self.provider_id != now.provider_id() {
            return Err(ProviderAuthorityError::ProviderMismatch);
        }
        if self.authority_epoch != now.epoch() {
            return Err(ProviderAuthorityError::EpochMismatch);
        }
        let reading = now.reading();
        if reading < self.issued_at {
            return Err(ProviderAuthorityError::ClockRegressed);
        }
        if reading >= self.expires_at {
            return Err(ProviderAuthorityError::Expired);
        }
        Ok(ProviderCapabilitySet {
            _guard: self.guard,
            attempt_id: self.attempt_id,
            runtime: ProductionRuntimeInstanceVerifier::new_internal(),
            ipc: ProductionIpcSessionVerifier::new_internal(),
            owner_presence: ProductionOwnerPresenceCapability::new_internal(),
            _thread_bound: PhantomData,
        })
    }
}

/// The three production providers, held together with the confirmed machine-wide authority that
/// justified them.
///
/// Opaque, non-`Clone`, non-`Copy`, non-`Default`, non-serialisable, `!Send + !Sync`, redacted `Debug`.
/// The capability fields are PRIVATE and reachable only by borrowing: there is deliberately no
/// `into_runtime()`, no `take_*`, no field access and no `Deref`. A capability therefore cannot be
/// extracted from the set, so it can never outlive — nor be used after dropping — the authority guard the
/// set retains. Dropping the set drops the capabilities and the authority together.
pub struct ProviderCapabilitySet {
    /// The retained confirmed authority. Never exposed, borrowed or returned.
    _guard: ConfirmedAuthorityGuard,
    attempt_id: u64,
    runtime: ProductionRuntimeInstanceVerifier,
    ipc: ProductionIpcSessionVerifier,
    owner_presence: ProductionOwnerPresenceCapability,
    _thread_bound: ThreadBound,
}

impl fmt::Debug for ProviderCapabilitySet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ProviderCapabilitySet([REDACTED])")
    }
}

impl ProviderCapabilitySet {
    /// The cold-start attempt id these providers were issued under.
    #[must_use]
    pub fn attempt_id(&self) -> u64 {
        self.attempt_id
    }

    /// Borrow the production runtime-instance verifier.
    #[must_use]
    pub fn runtime(&self) -> &ProductionRuntimeInstanceVerifier {
        &self.runtime
    }

    /// Borrow the production IPC-session verifier.
    #[must_use]
    pub fn ipc(&self) -> &ProductionIpcSessionVerifier {
        &self.ipc
    }

    /// Borrow the production owner-presence capability.
    #[must_use]
    pub fn owner_presence(&self) -> &ProductionOwnerPresenceCapability {
        &self.owner_presence
    }

    /// PROJECTOS-HOST-REVIEW-PATH1B: derive a FRESH connection-bound IPC session verifier for ONE
    /// accepted IPC connection.
    ///
    /// # Why this exists
    ///
    /// A [`ProviderAuthorityLease`] is a COLD-START authority handoff, not an IPC-session lease: it
    /// consumes the [`ConfirmedAuthorityGuard`] and moves it into this set, which retains the
    /// machine-wide authority for as long as the governed IPC service lives. Asking for a second
    /// lease per connection would mean a second existence-token acquisition while this one is still
    /// held — which is, correctly, [`AuthorityTokenOutcome::ExistingToken`], which is never local
    /// authority. Dropping and reacquiring authority between ordinary client connections is not an
    /// acceptable serve-loop design either.
    ///
    /// So the lifetimes are separated: ONE machine-wide authority, ONE lease, ONE long-lived
    /// capability set — and MANY fresh connection-bound verifiers derived from it.
    ///
    /// # What it guarantees
    ///
    /// Each call yields a NEW non-zero connection identity and handshake generation, so connection A
    /// and connection B never share a verifier and A's session can never validate B. The returned
    /// verifier BORROWS this set, so it cannot outlive the authority that issued it and cannot be
    /// extracted from it; dropping a per-connection verifier releases nothing, and only dropping this
    /// set releases the retained machine-wide authority.
    ///
    /// The identity originates HERE, in the Host, and the transport ADOPTS it for the connection it
    /// has just accepted — it is never taken from an Agent, a request field or a peer.
    #[must_use]
    pub fn begin_connection(&self) -> ConnectionBoundIpcSessionVerifier<'_> {
        ConnectionBoundIpcSessionVerifier::derive()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authority_time::{FixtureClock, TrustedClock};
    use crate::runtime_instance::RuntimeInstanceVerifier;
    use projectos_host_authority::model::AuthorityPeerState;

    fn confirmed() -> ConfirmedAuthorityGuard {
        ConfirmedAuthorityGuard::for_local_proof(AuthorityPeerState::ServiceRuntimeConfirmed)
            .expect("authoritative state confirms")
    }

    fn clock(reading: u64) -> FixtureClock {
        FixtureClock::new(reading)
    }

    #[test]
    fn a_confirmed_authority_opens_a_lease_and_issues_all_three_providers() {
        let c = clock(1_000);
        let time = c.read_current();
        let lease = open_provider_authority(confirmed(), &time, 60).expect("lease opens");
        let attempt = lease.attempt_id();
        let set = lease
            .into_provider_capabilities(&time)
            .expect("capabilities issue");
        assert_eq!(set.attempt_id(), attempt);
        // All three are present and borrowable; none is extractable.
        assert!(set.runtime().generation() != 0);
        assert_eq!(format!("{set:?}"), "ProviderCapabilitySet([REDACTED])");
        let _ = set.ipc();
        let _ = set.owner_presence();
    }

    #[test]
    fn attempt_ids_are_issuer_assigned_and_distinct_per_attempt() {
        let c = clock(1_000);
        let time = c.read_current();
        let a = open_provider_authority(confirmed(), &time, 60).expect("first");
        let b = open_provider_authority(confirmed(), &time, 60).expect("second");
        assert_ne!(a.attempt_id(), b.attempt_id());
        // High bit always set, so an attempt id is never a plausible caller-chosen small integer.
        assert_ne!(a.attempt_id() & (1u64 << 63), 0);
    }

    #[test]
    fn a_non_authoritative_state_never_confirms() {
        for state in [
            AuthorityPeerState::Uncorroborated,
            AuthorityPeerState::AuthorityUncertain,
            // A client connects to an authority; it is never one itself.
            AuthorityPeerState::ClientConnectionConfirmed,
        ] {
            assert!(ConfirmedAuthorityGuard::for_local_proof(state).is_none());
        }
    }

    #[test]
    fn an_invalid_window_refuses() {
        let c = clock(1_000);
        let time = c.read_current();
        assert_eq!(
            open_provider_authority(confirmed(), &time, 0).unwrap_err(),
            ProviderAuthorityError::WindowInvalid
        );
        assert_eq!(
            open_provider_authority(confirmed(), &time, MAX_LEASE_WINDOW + 1).unwrap_err(),
            ProviderAuthorityError::WindowInvalid
        );
    }

    #[test]
    fn an_expired_lease_issues_nothing() {
        let c = clock(1_000);
        let issued = c.read_current();
        let lease = open_provider_authority(confirmed(), &issued, 10).expect("lease opens");
        c.advance_to(1_010); // exactly at expiry — inclusive refusal
        let later = c.read_current();
        assert_eq!(
            lease.into_provider_capabilities(&later).unwrap_err(),
            ProviderAuthorityError::Expired
        );
    }

    #[test]
    fn a_restart_epoch_change_invalidates_an_outstanding_lease() {
        let c = clock(1_000);
        let issued = c.read_current();
        let lease = open_provider_authority(confirmed(), &issued, 60).expect("lease opens");
        c.next_epoch(1_001);
        let after = c.read_current();
        assert_eq!(
            lease.into_provider_capabilities(&after).unwrap_err(),
            ProviderAuthorityError::EpochMismatch
        );
    }

    #[test]
    fn lease_and_set_debug_are_redacted_and_carry_no_identity() {
        let c = clock(1_000);
        let time = c.read_current();
        let lease = open_provider_authority(confirmed(), &time, 60).expect("lease opens");
        let rendered = format!("{lease:?}");
        assert_eq!(rendered, "ProviderAuthorityLease([REDACTED])");
        assert!(!rendered.chars().any(|ch| ch.is_ascii_digit()));
        assert_eq!(
            format!("{:?}", confirmed()),
            "ConfirmedAuthorityGuard([REDACTED])"
        );
    }

    // -------------------------------------------------------------------------------------------
    // PROJECTOS-HOST-REVIEW-PATH1B, RULING SECTION 10 - MULTI-CONNECTION PROOFS (A-I).
    //
    // ONE machine-wide authority, ONE lease, ONE capability set, MANY connection-bound verifiers.
    // -------------------------------------------------------------------------------------------
    mod multi_connection_proofs {
        use super::*;
        use crate::ipc_session::IpcSessionVerifier;

        /// One confirmed authority -> one lease -> one long-lived capability set.
        fn capability_set() -> ProviderCapabilitySet {
            let c = clock(1_000);
            let time = c.read_current();
            open_provider_authority(confirmed(), &time, 60)
                .expect("lease opens")
                .into_provider_capabilities(&time)
                .expect("capabilities issue")
        }

        /// A + B + D: one acquisition authorises connection A, and AFTERWARDS the SAME retained
        /// provider authority authorises a new connection B - with no second lease and no second
        /// machine-wide acquisition.
        #[test]
        fn one_authority_authorises_connection_a_then_connection_b() {
            let set = capability_set();

            let a = set.begin_connection();
            assert_ne!(a.connection_id(), 0);
            assert_ne!(a.handshake_generation(), 0);
            let (a_conn, a_gen) = (a.connection_id(), a.handshake_generation());
            drop(a); // connection A completes

            // B is derived from the SAME set. No `open_provider_authority` call, no new guard.
            let b = set.begin_connection();
            assert_ne!(b.connection_id(), 0);
            assert_ne!(b.handshake_generation(), 0);

            // C: A's identity does not validate B.
            assert_ne!(b.connection_id(), a_conn, "B must not reuse A's connection id");
            assert_ne!(
                b.handshake_generation(),
                a_gen,
                "B must not reuse A's handshake generation"
            );
        }

        /// C + G: two SIMULTANEOUS connections are distinct, so stale A evidence refuses against B.
        #[test]
        fn simultaneous_connections_are_distinct_and_stale_evidence_does_not_transfer() {
            let set = capability_set();
            let a = set.begin_connection();
            let b = set.begin_connection();
            assert_ne!(a.connection_id(), b.connection_id());
            assert_ne!(a.handshake_generation(), b.handshake_generation());
            // The crossing compares a bundle's pair against the verifier's pair, so A's pair simply is
            // not B's - there is no value A could present that B would accept.
            assert!(a.connection_id() != b.connection_id() || a.handshake_generation() != b.handshake_generation());
        }

        /// F: a reconnection receives a NEW connection/generation binding.
        #[test]
        fn a_reconnection_receives_a_new_binding() {
            let set = capability_set();
            let mut seen = std::collections::BTreeSet::new();
            for _ in 0..8 {
                let v = set.begin_connection();
                assert!(
                    seen.insert((v.connection_id(), v.handshake_generation())),
                    "every accepted connection must receive a fresh binding"
                );
            }
        }

        /// E: the identity is never caller-selectable - `begin_connection` takes no argument at all,
        /// so no Agent, request field or peer can influence the connection id or generation.
        #[test]
        fn the_connection_identity_is_not_caller_selectable() {
            let set = capability_set();
            let v = set.begin_connection();
            // High bit set, exactly as the crate-assigned counter guarantees, so a per-connection
            // identity is never a plausible caller-chosen small integer.
            assert_ne!(v.connection_id() & (1u64 << 63), 0);
            assert_ne!(v.handshake_generation() & (1u64 << 63), 0);
        }

        /// H: dropping ONE connection verifier does not release the machine-wide authority - the set
        /// is still usable afterwards, which it could not be if the guard had gone.
        #[test]
        fn dropping_a_connection_verifier_does_not_release_machine_authority() {
            let set = capability_set();
            let first = set.begin_connection();
            let first_conn = first.connection_id();
            drop(first);
            // Still able to derive another, and still able to borrow the other two capabilities.
            let second = set.begin_connection();
            assert_ne!(second.connection_id(), first_conn);
            assert!(set.runtime().generation() != 0);
            let _ = set.owner_presence();
        }

        /// The verifier is redacted and carries no readable authority.
        #[test]
        fn a_connection_bound_verifier_renders_nothing() {
            let set = capability_set();
            let v = set.begin_connection();
            assert_eq!(
                format!("{v:?}"),
                "ConnectionBoundIpcSessionVerifier([REDACTED])"
            );
        }

        /// I: dropping the capability SET releases the retained authority, as previously designed.
        ///
        /// Structural rather than observational: the set OWNS the `ConfirmedAuthorityGuard`, which owns
        /// the existence-token handle, whose `Drop` performs the single close. This test pins the
        /// ownership shape - a per-connection verifier borrows the set and therefore cannot outlive it,
        /// so no verifier can keep authority alive after the set is gone.
        #[test]
        fn a_connection_verifier_cannot_outlive_the_capability_set() {
            let set = capability_set();
            let v = set.begin_connection();
            assert_ne!(v.connection_id(), 0);
            drop(v);
            // `drop(set)` while `v` was alive would be a borrow-check error, which is the proof: the
            // lifetime parameter makes "authority outlived by its verifier" unrepresentable.
            drop(set);
        }
    }

}
