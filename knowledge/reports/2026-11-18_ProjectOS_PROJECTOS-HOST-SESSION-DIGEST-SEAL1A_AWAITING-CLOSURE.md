# PROJECTOS-HOST-SESSION-DIGEST-SEAL1A — awaiting closure

**Phase:** PROJECTOS-HOST-SESSION-DIGEST-SEAL1A, phase 51 of 55 of plan v1.42
**Closure route:** owner-direct, under the owner's full-authority grant. No gatekeeper closure ruling was obtained, and none is claimed.

One visibility change in the dormant Rust host: AdmittedRequest::session_digest in projectos/host/core/src/ipc_session.rs becomes pub(crate), as val-cd-b4-sealed-expected-window-facts1a rule V2 has required since 2026-07-31. No caller outside the crate was found. Owner-approved edit to a protected file (2026-11-17), commit 72f7fcb7. cargo test passes in projectos/host/core (doctests included) and projectos/host/windows-local-ipc. The same digest is still readable through the public trait method RequestAdmissionStore::session_digest (ipc_session.rs line 500): an owner follow-up decision, not part of this phase.

Full record: `docs/finish/PROJECTOS-HOST-SESSION-DIGEST-SEAL1A.md`.
