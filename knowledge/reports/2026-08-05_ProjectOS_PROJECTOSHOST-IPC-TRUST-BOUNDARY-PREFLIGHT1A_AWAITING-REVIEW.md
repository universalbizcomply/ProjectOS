# PROJECTOSHOST-IPC-TRUST-BOUNDARY-PREFLIGHT1A — AWAITING REVIEW

| | |
|---|---|
| **Project** | ProjectOS |
| **Phase** | PROJECTOSHOST-IPC-TRUST-BOUNDARY-PREFLIGHT1A |
| **Date** | 2026-08-05 |
| **Branch / HEAD** | `projectos-v3` @ `b15ce0a58487c7c2990561fbb9de6d5eefccb5fe` |
| **Gate** | read-only architecture preflight; records-only commit |
| **Decision requested** | **PREFLIGHT ACCEPTED — IPC TRUST-BOUNDARY IMPLEMENTATION GATES REQUIRED** |

No IPC, service, ACL, credential, provider, ProgramData or registry change. The service was not started and the pipe was not contacted.

---

## 1. Headline

**Selected architecture: OPTION A — Windows kernel-mediated peer identity, plus a versioned secret-free operation protocol.**

The decisive finding is that **no secret needs to cross the pipe at all**. Under the accepted Model C the host executes the operation and returns an exit code and redacted output, so the wire carries only bounded identifiers and digests. That removes the need for wire cryptography — and the gate is explicit that cryptography must not be required merely because the transport is IPC.

Three source facts make Option A the smallest sufficient design, and all three are gaps rather than obstacles:

| | |
|---|---|
| `ImpersonateNamedPipeClient` | **0 files** — the service cannot obtain a client token today |
| `OpenThreadToken` | **0 files** |
| `contribute_ipc_peer` | exists, but is **never called in the shipped serve flow** |

Windows already provides everything needed, verified present on this machine by parsing the export tables.

---

## 2. Source review and classification

| Statement | Class |
|---|---|
| Pipe `\\.\pipe\ProjectOS.Test.ServiceIdentityProof.504f534853544154`, single instance, message mode, `PIPE_REJECT_REMOTE_CLIENTS` | SOURCE-BACKED FACT |
| DACL `D:P` — `SY`, `BA`, service SID; rights `0x0012_019F`; `CurrentInteractiveUser` refused as a broad principal | SOURCE-BACKED FACT |
| Frame = magic + version(2) + kind(1) + nonce(32) + len(2) = 41-byte header; max frame 512; **max payload 471** | SOURCE-BACKED FACT |
| 8 kinds, each one fixed payload length; `InstalledHostStatus` = 21 bytes | SOURCE-BACKED FACT |
| Handshake nonce = deterministic expansion of the public const `POSHSTAT` | SOURCE-BACKED FACT |
| No AEAD, HMAC, BCrypt, NCrypt or challenge anywhere in the IPC/contract/core path | SOURCE-BACKED FACT (0 files each) |
| No `sequence_number`, no `CorrelationId` | SOURCE-BACKED FACT |
| `ImpersonateNamedPipeClient`, `OpenThreadToken` absent from all host source | SOURCE-BACKED FACT (0 files) |
| `GetNamedPipeClientProcessId` present only in `windows-service-identity-proof/instance_ffi.rs` | SOURCE-BACKED FACT |
| `contribute_ipc_peer` never called in `serve_one_status_exchange` | SOURCE-BACKED FACT |
| `PeerUserClass` is a bounded class (Owner/System/Service/Other), never a raw SID | SOURCE-BACKED FACT |
| Service `Stopped`/`Manual`, SID type `UNRESTRICTED`, service SID `S-1-5-80-3378865708-…` | SOURCE-BACKED FACT (live read-only) |
| Six Win32 primitives exported on this OS | SOURCE-BACKED FACT (export tables parsed) |
| Model C, and the ban on returning a raw secret | OWNER / GATEKEEPER DECISION |
| Option A is sufficient | **INFERENCE** from the payload classification in §6 |

---

## 3. Current trust boundary — reconciled

**What the kernel gives us today.** The pipe DACL is protected (`D:P`) and admits exactly `SY`, `BA` and the service SID with `FILE_GENERIC_READ|WRITE`, deliberately excluding `WRITE_DAC`, `WRITE_OWNER`, `DELETE` and `FILE_EXECUTE`. `CurrentInteractiveUser` is enumerated among the **refused** broad principals. This is a real, working access boundary — it is simply drawn in the wrong place for F3.

**What the protocol gives us today: nothing.** The 32-byte "nonce" is a deterministic expansion of a public compile-time constant, so it authenticates no one; the source says so itself. There is no challenge, no MAC, no sequence number and no correlation id. The client never verifies the server — no `SECURITY_SQOS_PRESENT`, no `GetNamedPipeServerProcessId`. Replay protection is a per-backend-instance `Cell<bool>` that, because the server object is per-invocation, effectively never fires.

**What exists but is unreachable.** `contribute_ipc_peer` wraps `GetNamedPipeClientProcessId`, and `BoundIpcSession` in core already binds connection id, handshake generation, client PID, client creation tick and `PeerUserClass`. The serve flow calls none of it, and `ProductionIpcSessionVerifier` is behind a non-default feature. **The authority model is built; it is not wired.**

**The live machine position.** Service `Stopped`/`Manual`; service SID resolved; no ProjectOS pipe while stopped. The would-be client here is `MSI\murad`, SID `S-1-5-21-…-1001`, **session 2**, integrity **High** *because this shell is elevated* — a normal client shell would be **Medium**. OS Windows 11 Home build 26200.

---

## 4. Client identity (questions A1–A3)

**How the host determines the caller.** Three mechanisms, all verified exported on this machine:

| Mechanism | API | Yields |
|---|---|---|
| Peer PID | `GetNamedPipeClientProcessId` (kernel32) ✅ | PID, then creation tick to defeat PID reuse |
| Peer session | `GetNamedPipeClientSessionId` (kernel32) ✅ | Windows session id |
| Peer token | `ImpersonateNamedPipeClient` → `OpenThreadToken` → `GetTokenInformation` → `RevertToSelf` (advapi32) ✅ | user SID, integrity level, elevation |

**Authority versus evidence — the distinction that matters.**

| Field | Class | Why |
|---|---|---|
| Client **token user SID** | **AUTHORITY** | kernel-attested, unforgeable by the caller |
| Client **session id** | **AUTHORITY** | kernel-attested |
| Client **integrity level** | **AUTHORITY** | kernel-attested |
| Client **PID + creation tick** | **AUTHORITY for binding**, evidence for identity | kernel-attested pair; PID alone is reusable |
| Client **executable identity** (path/hash) | **EVIDENCE ONLY** | resolved from the PID, and the image can be replaced between check and use — a TOCTOU the host cannot close |
| Anything **declared in the payload** | **EVIDENCE ONLY, always** | a protocol assertion, exactly as the existing code says of a declared peer role |

**Binding to an approved ProjectOS execution session** must be the host's own judgement from the kernel-attested triple plus its own state — never a caller-supplied session token, which would be a bearer secret on a channel that has none.

---

## 5. Channel access and DACL (B4–B6)

The current DACL cannot serve F3: a non-elevated client holds neither `SY` nor `BA`, and `CurrentInteractiveUser` is refused by policy. Three ways to change that:

| Option | Assessment |
|---|---|
| Add the interactive user to the **existing** pipe | **Reject.** It reverses a stated policy on the channel that also carries the identity-proof workflow, widening one endpoint for two unrelated purposes. |
| **A dedicated second pipe** for protected operations, its own DACL admitting the specific user SID | **Recommended.** Blast radius confined; the status pipe keeps its current policy verbatim. |
| A separate broker process | **Reject for now** — see §8 Option C. |

**Grant the specific user SID, not `BU`/`IU`.** Every ordinary process of that user can still open it, so **the DACL is a coarse gate and must never be the only one**; the token and PID checks in §4 do the real work.

**Rejecting stale, copied or unrelated processes** is the host's job: bind each accepted request to PID + creation tick + session + user SID + service-instance epoch, and refuse anything that does not match a live, still-current peer.

---

## 6. Confidentiality classification (D10–D13)

**What crosses the pipe under Model C:** an operation identifier, bounded project/environment/provider/credential *references* (names, never values), an operation fingerprint digest, a correlation id, and back an accept/reject state, an exit code and redacted-or-withheld output.

**No secret crosses.** The credential is read and used **inside** the service; the L4 operation gate already withholds output by default and returns exit codes rather than values.

**Therefore wire cryptography is NOT required.** Confidentiality is provided by the kernel object's DACL plus authenticated peer identity, which is proportionate for identifiers and digests. Adding AEAD would introduce key establishment and storage — pulling in **F4**, which is unresolved — to protect data that is not secret.

**Two conditions would flip this**, and both are recorded as tripwires: if any design later needs to return a credential value, a decrypted blob or a reusable protected authority across the pipe, or to carry owner-approval material that is itself bearer-secret. **Either would first require re-opening the Model C decision**, so the correct control is the A7 prohibition, not encryption.

**Redaction remains mandatory** — the existing redactor and size-bucketing must apply to anything returned, because "no secret by design" is a claim that must survive a child process echoing one.

---

## 7. Replay, correlation and restart (E14–E16)

Required in F2/F3:

- a **per-connection server-generated nonce** — a real challenge the client must echo, replacing today's public constant;
- a **correlation id** per request, since the protocol has none and a request/response family cannot work without one;
- the **service-instance epoch**, already derived in core with a process-unique nonce so a restart always yields a new value;
- **monotonic sequence within a connection**, to reject reorder and duplication.

**Division of responsibility, stated so F5 is not silently pre-empted:**

| Concern | Owner |
|---|---|
| Duplicate/stale/reordered **within a live connection** | **F2/F3** — nonce, sequence, correlation |
| Requests from a **previous service instance** | **F2/F3** — epoch comparison, fail closed |
| **A grant already consumed, surviving restart** | **F5 durable ledger — NOT this work** |

Today's ledger is `RefCell<HashMap>` and the source calls it "fixture-durable only". **F2/F3 must not paper over that**; single-use across restart is F5's job, and claiming otherwise would be a false assurance.

---

## 8. Architecture options

**OPTION A — Windows peer identity + versioned secret-free protocol. ✅ SELECTED**
Attack surface small: no new crypto, no key storage, no new process. Isolation from binding project/environment/provider into the context digest — noting `ProviderId` is **not** currently folded in and must be. Replay from nonce + sequence + epoch. Process substitution addressed by PID + creation tick + token SID. Restart handled by epoch. Complexity low. Testable synthetically. Installer impact: none beyond a second pipe's DACL. **Fits the 471-byte ceiling**, because identifiers and digests are small — the existing 21-byte status record is the proof. Compatible with Model C. **No dependency on F4 or F5** for the channel itself.

**OPTION B — peer identity + application challenge/response.**
The challenge/response half is **already inside Option A** (the server-generated nonce). As a *separate* layer implying a shared secret, it needs key establishment and storage, which is F4. **Rejected as a distinct option**: its useful part is adopted; its costly part is unjustified while no secret crosses the wire.

**OPTION C — separate authenticated local broker.**
Adds a third process to trust, its own lifetime, its own identity problem, and simply moves the boundary rather than removing it. If it runs as the user it reproduces the boundary C5 rejected; if as a service, it *is* the host. **Rejected**, revisit only if a UI must talk to the host without the user's own token.

**OPTION D — considered and rejected.** Reusing the existing pipe with a widened DACL: cheapest to build, worst to reason about, and it weakens a channel that is currently correct.

---

## 9. Owner authority (G21–G23)

**Not a caller-supplied boolean or phrase.** The existing `OwnerStatusReadApproval` transcribes a compile-time constant — fine for a read-only status read, useless as authority for a protected operation, since any caller can transcribe a public string.

Required before the host accepts an operation:

1. **kernel-attested peer identity** (§4);
2. **a host-side owner-presence decision** — the C4 gate, still OPEN;
3. **an operation bound to project, environment, provider, operation and fingerprint**, with `ProviderId` folded into the context digest;
4. **an unexpired, unconsumed, single-use authority**, durable across restart only once F5 lands.

**A structural warning.** `VerifiedApproval` today has **13 public fields, no constructor and no gate**, and `ConfirmedHandshakeEvidence::confirmed()` is public and ungated. Both are reachable in a production build. That is tolerable only while the service process is itself the trust boundary; **an IPC family that accepts operations makes them load-bearing**, so the protocol-and-authority phase must seal them or record explicitly why not.

**Decisions that stay with Murad and ChatGPT, never with ProjectOSHost:** whether an operation class is permitted at all; whether a project may reach production; C4/C6/C7; and any widening of the DACL. The host enforces; it does not decide.

---

## 10. Protocol and framing (F17–F20)

**A new versioned message family on a new dedicated pipe.** `InstalledHostStatus` **must not be overloaded** — its contract is validator-pinned (V3 refuses `String`, `Vec<u8>`, `HashMap`, `serde_json`; V4 refuses any generic payload accessor), it has no request kind by design, and it is a read-only status route.

Framing keeps the existing discipline: fixed header, closed kind enum, **fixed payload length per kind**, ≤471 bytes, fail-closed parsing that refuses bad magic, unknown version, unknown kind, oversize, truncation, trailing bytes and length mismatch. Identifiers and digests only — no free-form strings, no maps, no generic accessor.

States: **Request → Accepted | Rejected(closed reason) → Completed(exit code + redacted output)**. Rejection reasons stay a closed fieldless enum; the current taxonomy is already an oracle and must not become a more informative one.

---

## 11. Frozen implementation phase sequence

Five phases, deliberately separate. **F4 and F5 stay outside all of them.**

| # | Phase | Objective | Likely modules | Mandatory tests | Security mutations | Blocks custody? |
|---|---|---|---|---|---|---|
| 1 | `PROJECTOSHOST-IPC-OPERATION-CONTRACT1A` | Closed message family + authority contract, no transport | `windows-local-ipc/protocol.rs`, new contract module, validators | encode/decode round trip; every malformed frame refused; no generic accessor | add a `String` field; add a payload accessor; overload `InstalledHostStatus`; omit a length | **Yes** |
| 2 | `PROJECTOSHOST-IPC-PEER-AUTHENTICATION1A` | Wire `contribute_ipc_peer`; add token SID, session, integrity | `windows_ffi.rs`, `core/ipc_session.rs` | peer PID+tick bound; wrong SID refused; wrong session refused | accept a declared role; skip the token check; accept a dead PID | **Yes** |
| 3 | `PROJECTOSHOST-IPC-NONELEVATED-CHANNEL1A` | Second pipe + its DACL admitting the specific user SID | `host-authority/pipe_security.rs`, installer | non-elevated client connects; another user refused; status pipe policy unchanged | grant `BU`; grant `Everyone`; widen the existing pipe | **Yes** |
| 4 | `PROJECTOSHOST-IPC-REPLAY-BINDING1A` | Server nonce, correlation, sequence, epoch | `protocol.rs`, `core` | replayed frame refused; reordered refused; cross-epoch refused | reuse a nonce; accept a stale epoch; drop the sequence check | **Yes** |
| 5 | `PROJECTOSHOST-IPC-SYNTHETIC-PROOF1A` | End-to-end synthetic operation, no real credential | proof harness | full refusal matrix; no lease/grant/child left; no value returned | return a value; leak on refusal; spawn on refusal | **Yes** |

Each phase prohibits: real credentials, provider calls, `.projectops`, production effect, installed-binary replacement, and any F4/F5 work.

---

## 12. Test and mutation matrix (before implementation)

| Area | Must pass | Must fail |
|---|---|---|
| Framing | exact length per kind; ≤471; fail-closed on all seven malformations | free-form field; generic accessor; overloaded status kind |
| Peer identity | PID+tick+SID+session bound and re-checked | declared role accepted; token check skipped; stale PID accepted |
| DACL | named user SID connects; other users refused; status pipe byte-identical policy | `BU`/`Everyone` granted; existing pipe widened |
| Replay | server nonce single-use; sequence enforced; epoch compared | nonce reuse; reorder; cross-restart acceptance |
| Secret flow | no value on the wire; output redacted/withheld | any credential value returned |
| Authority | expired/consumed/wrong-provider refused | caller-supplied boolean or phrase accepted |

---

## 13. Installer and service-DACL impact

**Service-object DACL: no change.** `RP`/`WP` stay with `SY` and `BA`; the client does not start or stop the service.

**File ACLs: no change.** F1 stands untouched.

**Installer: one addition** — the new pipe's DACL needs the approved user SID at install time, so the installer must learn which principal that is. That is a real installer change and belongs to phase 3, not to this preflight.

**ProgramData: no change** for the channel itself; storage is F4.

---

## 14. Machine non-interference

Before and after: service `Stopped` / `Manual`, `NT SERVICE\ProjectOSHost`, SID type `UNRESTRICTED`; **no ProjectOS pipe present**; service never started; pipe never contacted; no ACL, ProgramData, registry, credential or provider operation.

---

## 15. Review stack

**USED** — Windows IPC security review, confused-deputy review, peer-identity review, process-substitution review, replay/stale-authority review, protocol-framing review, privilege-boundary review, secret-flow review, installer/DACL impact review, repository-boundary review, Claude adversarial self-review (which produced the TOCTOU classification of executable identity, the DACL-is-coarse warning, and the `VerifiedApproval` escalation in §9).
**AVAILABLE BUT NOT APPLICABLE** — ECC review agents (no code changed; this is design and records), Obsidian.
**NOT APPLICABLE** — UI UX Pro Max, Flow Motion, Figma. **PROHIBITED** — Provider MCP, not invoked.

---

## 16. Residual risks

1. **The DACL is coarse.** Any process of the approved user can open the pipe; token and PID binding carry the real weight.
2. **Executable identity is TOCTOU-bound** and can only ever be evidence.
3. **`VerifiedApproval` and `ConfirmedHandshakeEvidence` are unsealed** and become load-bearing the moment operations are accepted.
4. **Single-use across restart is not solvable here** — it is F5.
5. **`ProviderId` is absent from the permit context digest** and must be added.
6. An **elevated administrator** can defeat any of this; source already says no service identity resists one.

---

## 17. Programme position

`acceptedPhaseCount` **4 / 19**, **21.1**, `EXECUTION_READY` **false**, `installationAuthority` **NotAuthorised**. **F2, F3, F4, F5 remain OPEN. C4, C6 OPEN; C7 OPEN / PROHIBITED.** No numbered V3 phase closes from this work. Nothing here implements IPC, ships custody, completes F2–F5 or authorises C7.

---

## 18. Decision requested

**PREFLIGHT ACCEPTED — IPC TRUST-BOUNDARY IMPLEMENTATION GATES REQUIRED**

Option A is selected because the payload classification, not the transport, decides the cryptography question: under Model C no secret crosses the pipe, so kernel-mediated peer identity plus a closed secret-free protocol is sufficient — and every primitive it needs is already exported on this machine and already modelled in core, merely unwired.

The judgement I would most like reviewed is §6: I am asserting that **no wire encryption is needed**. That holds only while Model C holds. I have written the two conditions that would overturn it directly into the report, so if a future design proposes returning a value across the pipe, the encryption question reopens automatically rather than being quietly assumed settled.
