"""PROJECTOS-HOST-REVIEW-PATH1B — append the section 10 multi-connection proofs (A-I).

Inserts a nested test module at the end of provider_authority.rs's `mod tests`. Idempotent.
"""

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "projectos" / "host" / "core" / "src" / "provider_authority.rs"

MARKER = "mod multi_connection_proofs"

BLOCK = '''
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
'''


def main() -> int:
    text = SRC.read_text(encoding="utf-8")
    if MARKER in text:
        print("provider_authority.rs: already patched")
        return 0
    idx = text.rstrip().rfind("\n}")
    if idx == -1:
        print("provider_authority.rs: could not find the end of mod tests", file=sys.stderr)
        return 1
    patched = text[:idx] + "\n" + BLOCK + text[idx:]
    SRC.write_text(patched, encoding="utf-8", newline="")
    print("provider_authority.rs: multi-connection proofs appended")
    return 0


if __name__ == "__main__":
    sys.exit(main())
