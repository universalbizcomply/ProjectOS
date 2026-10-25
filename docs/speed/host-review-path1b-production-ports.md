# PROJECTOS-HOST-REVIEW-PATH1B — the production port table

Written for: the PATH1B gatekeeper reviewer and the owner, at the pre-push gate.

Every row is a port the unattended Host review depends on. `FIXTURE IN PRODUCTION?` is the column
the ruling asked for, and the answer is **NO** on every row — the fixture mint of each of these is
gated to `test-fixtures`, and no shipped graph (default, `windows-live-ipc`,
`owner-approved-status-read`, `windows-authority-acquisition`, `production-clock-binding`,
`production-clock-observation`, `production-runtime-observation`) enables it.

`ACTIVATION INPUT` names what the owner must supply for the row to become live. `—` means the row
needs nothing from the owner: it is reachable the moment the service starts on a verified
installation.

## Startup — established once per service start

| PORT | IMPLEMENTATION | CONSTRUCTOR / FACTORY | TRUST SOURCE | LIFETIME | FAIL-CLOSED CONDITION | ACTIVATION INPUT | FIXTURE IN PRODUCTION? |
|---|---|---|---|---|---|---|---|
| Verified canonical installation | `VerifiedCanonicalInstallation` | `service_host::status::verified_canonical_installation()` → `host_identity::canonical_record::verify_record` | The installed ProgramData record, digest-bound, under the frozen reader contract with `Matched` protected evidence | Held for the life of `TrustedHostRuntime` | Record absent, unparseable, or refused by `verify_record` → `CanonicalInstallationUnavailable` | — | **NO** |
| Machine-wide host authority | `ConfirmedAuthorityGuard` | `host_authority::acquire_service_runtime_authority(&installation)` | A FRESH `AcquiredToken` create on the name derived from the installation digest + build channel + schema V1, corroborated by the per-service SID in this process's token | Moved into the provider lease, then into the capability set; released when that set drops | `ExistingToken`, unresolvable service principal, or a non-service process → `AuthorityUnavailable` | — | **NO** |
| One-shot clock authority | `ProductionClockAuthority` | `core::establish_production_clock_authority(&guard)` | The borrowed `ConfirmedAuthorityGuard` in `ServiceRuntimeConfirmed` state | Consumed immediately by `into_clock_binding_grant` | Not the service runtime, or a lineage already established in this process → `ClockAuthorityUnavailable` | — | **NO** |
| Live monotonic tick source | `WindowsMonotonicTickSource` | `WindowsMonotonicTickSource::acquire(&LiveClockObservationCapability::for_production_clock_authority(&clock_authority))` | The same one-shot clock authority, borrowed | Owned by `ProductionTrustedClock` for the life of the runtime | Process-creation seed unreadable → `TickSourceUnavailable` | — | **NO** |
| Clock-binding grant | `ProductionClockBindingGrant` | `ProductionClockAuthority::into_clock_binding_grant()` (consuming) | The one-shot clock authority | Consumed by `bind_production_clock` | Unreachable without the authority; the crate-private `mint()` has exactly two call sites (fixture + production) | — | **NO** |
| Trusted clock | `ProductionTrustedClock<WindowsMonotonicTickSource>` | `core::bind_production_clock(grant, source, MAX_CLOCK_FORWARD_JUMP_MS)` | The consumed grant; provider identity is a crate CONST, epoch derived from the lineage seed | Life of the runtime — ONE lineage per service start | Regression, >10 min forward discontinuity, shutdown or conversion failure permanently POISONS it; every downstream currentness check then refuses | — | **NO** |
| Trusted time | `VerifiedAuthorityTime` | `ProductionTrustedClock::try_read_current()` / `read_current()` | The clock lineage above | Per read — never cached | A poisoned clock reports the POISONED provider identity → `TrustedTimeUnavailable` | — | **NO** |
| Provider-authority lease | `ProviderAuthorityLease` | `core::open_provider_authority(guard, &issued, LEASE_WINDOW = 60)` | The consumed `ConfirmedAuthorityGuard` | One cold-start handshake; consumed in the next statement | Window zero or above `MAX_LEASE_WINDOW` → `LeaseRefused` | — | **NO** |
| Provider capability set | `ProviderCapabilitySet` | `ProviderAuthorityLease::into_provider_capabilities(&consumed)` | The retained guard + a second live clock reading re-checked against issuance | Life of the runtime — ONE set | Provider mismatch, epoch change, clock regression or expiry → `CapabilitiesRefused` | — | **NO** |
| Host self-observation source | `WindowsRuntimeObservationSource` | `WindowsRuntimeObservationSource::acquire(&LiveRuntimeObservationCapability::for_confirmed_service_runtime(&guard))` | The same confirmed guard, borrowed before the lease consumes it | Life of the runtime | Not the service runtime, or acquisition fails → `RuntimeObservationUnavailable` | — | **NO** |

## Per connection — one governed review exchange

| PORT | IMPLEMENTATION | CONSTRUCTOR / FACTORY | TRUST SOURCE | LIFETIME | FAIL-CLOSED CONDITION | ACTIVATION INPUT | FIXTURE IN PRODUCTION? |
|---|---|---|---|---|---|---|---|
| Governed-review IPC capability | `HostReviewIpcCapability` | `HostReviewIpcCapability::from_owner_programme_delegation(&VerifiedOwnerProgrammeDelegation)` | An ECDSA-P256 owner signature over the domain-separated canonical delegation record, checked against the embedded owner anchor, addressing this installation programme, live in the Host's own durable record | Life of the serve loop | Not an `IndependentGatekeeperReview` delegation, or revoked/completed → `ReviewCapabilityRefusal` | **The owner-signed programme delegation record** — BUT see the correction below: nothing outside `windows-local-ipc` can obtain the `VerifiedOwnerProgrammeDelegation` this takes | **NO** |
| Governed-review transport capability | `LiveIpcOperationCapability` @ `GovernedHostReviewLocalOnly` | `HostReviewIpcCapability::issue_transport_capability()` → `LiveIpcOperationCapability::for_governed_review` (crate-private) | The review capability above — never the owner status-read phrase | Life of the serve loop | A status-scoped capability is refused by all three serving entries before the endpoint is opened | (carried by the row above) | **NO** |
| Client-admission authority | `GovernedReviewAdmissionAuthority` | `GovernedReviewAdmissionAuthority::for_installation(&installation)` | The enrolled configured-owner SID of the verified canonical record — the SAME enrolment the production pipe DACL's fourth principal uses | Life of the serve loop | No enrolled owner, or a malformed SID → `NoEnrolledOwner` | — (the owner enrolment is written at install) | **NO** |
| Host channel context | `GovernedChannelContext` | `GovernedChannelContext::for_governed_review(&attested, plan)` | The sealed `AttestedInstallationProgramme` (owner-signed manifest + execution closure over committed bytes) for project/repository; the Host's durable approved-plan authority for phase and baseline | Life of the serve loop | Phase or approved baseline unestablished → `ChannelUnavailable` | **The owner-signed v2 trust manifest** | **NO** |
| Per-connection session verifier | `ConnectionBoundIpcSessionVerifier<'_>` | `ProviderCapabilitySet::begin_connection()` | Borrows the ONE capability set; identity drawn from a process-unique counter with the high bit set | One connection; cannot outlive the set (borrow-checked) | Takes no argument, so no caller can choose or collide an identity | — | **NO** |
| Verified runtime instance | `VerifiedRuntimeInstance` | `ProviderCapabilitySet::runtime().verify(&installed_service_observation(..), &now)` | The Host's own pid + creation time, corroborated as its own service evidence, attested by the sealed production verifier against the clock lineage | One connection | Role/source disagreement, zero identity, inconsistent or missing service evidence, bad window, expiry or staleness → the connection is refused and the loop backs off | — | **NO** |
| Confirmed handshake | `ConfirmedIpcPeerHandshake` | `LocalIpcAdapter::complete_service_handshake_confirmed(cap).into_confirmed()` | The real bounded, nonce-bound, replay-bound, role-bound `ControllerHello` → `ServiceReady` exchange | Moved into the evidence bundle — one confirmation, one bundle | A non-confirming outcome carries no confirmation at all | — | **NO** |
| Admitted client process | `AdmittedClientProcess` | `ClientPeerAdmissionAttempt::<ClientObserved>::observed_client_process()` | ONE audited kernel capture: `GetNamedPipeClientProcessId` + the impersonated token reads, matched for EXACT equality against the enrolled configured-owner SID, then re-observed and reconciled | One connection | Any capture failure, a non-owner principal, a changed process or session, a cross-connection presentation, or an expired window → `ClientNotAdmitted(verdict)` | — | **NO** |
| Same-connection peer evidence | `ConfirmedSameConnectionIpcPeerEvidence` | `assemble_production_same_connection_evidence(confirmed, verifier, client, channel, now, window)` | The four rows above, none of them a parameter a caller chooses | Moved into the crossing | Zero connection id, handshake generation, pid or creation tick → `EvidenceUnavailable` | — | **NO** |
| Canonical crossing output | `CanonicalPeerAndSessionEvidence` | `bind_canonical_client_to_session_evidence(attempt, bundle, verifier)` | The four-way agreement: the attempt's stored pair == the capture's pair == the bundle's pair == the verifier's live pair | Consumed by `into_parts` | Any mismatch, or a refused admission → `CrossingRefused(reason)` | — | **NO** |
| Bound IPC session | `BoundIpcSession` | `IpcSessionVerifier::verify(verifier, runtime, handshake, obs, now)` | The sealed per-connection verifier alone | One connection | Any verifier refusal → `SessionRefused(reason)` | — | **NO** |
| Trusted peer context | `TrustedPeerContext` | `TrustedPeerContext::from_verified_peer_admission(&admission)` | The sealed `VerifiedPeerAdmission` the crossing produced | One connection | Unreachable without that admission | — | **NO** |
| Host answer | `ProtectedOperationResponse` | `GovernedReviewActivation::answer(request, &session, &peer)` → `answer_review_request` → `compose_protected_operation` + `run_authorised_review` | Everything above, plus the owner-signed delegation, the attested programme and the installation's own durable ports | One request | Every composition and execution refusal becomes a well-formed `Rejected`/`NotRun` response | **The owner-signed delegation + manifest, and the installation's configured ports** | **NO** |

## The two scopes, side by side

| | `ReadInstalledHostStatusLocalOnly` | `GovernedHostReviewLocalOnly` |
|---|---|---|
| Minted from | `OwnerStatusReadApproval::transcribe(REQUIRED_PHRASE)` | `HostReviewIpcCapability::issue_transport_capability()` |
| Root authority | The owner's status-read phrase | The owner's ECDSA-P256 signature over the programme delegation |
| Authorises | Accept, handshake, serve ONE status record, close | Accept, handshake, serve the status record, receive ONE review request, send ONE review response, close |
| Refused by | `serve_one_exchange` and `serve_one_governed_review_exchange` and `serve_review_request` | `serve_one_status_exchange` |
| Does NOT authorise | anything else | provider execution, provider spend, credential access, other message kinds, service control, production mutation, deployment, database access, external sends, payments |

## CORRECTION (2026-09-25) — criterion 21 is NOT met: the activation resolver's inputs

The tables above prove the per-connection TRUST CHAIN and the Host's answer have production
constructors. Criterion 21 asks for more: that *supplying the protected activation inputs and starting the
service* needs no further source. That requires a service-entry resolver which reads every input from its
durable location at service start. A source-read survey of every input found that several have **no
production source**, so the earlier statement that this was "ordinary wiring" was wrong.

`CLASS`: **AUTH** = a new authority or trust decision (needs a ruling); **DESIGN** = a new durable location
or resolver with a trust implication; **WIRING** = ordinary code inside already-ratified authority;
**FIXED** = corrected in this resume.

| INPUT THE RESOLVER NEEDS | PRODUCTION SOURCE TODAY | CLASS |
|---|---|---|
| `VerifiedOwnerProgrammeDelegation` (for the review capability mint) | **None outside `windows-local-ipc`.** `ExpectedProgramme::from_attested_installation` (`owner_programme_delegation.rs:438`) and `HostDelegationStatus::from_durable_store` (`:607`) are `pub(crate)`; the only production verification runs inside `compose_protected_operation` and never returns the value | AUTH |
| An `Active` lifecycle record for that delegation | **None.** `record_lifecycle` is `pub(crate)` and dead outside tests (`durable_store.rs:306`); a fresh store answers `LocalStatusUnavailable` | AUTH |
| `ApprovedPlanBinding`, plan reference and version | **None.** Only `commit_approved_for_test` (`core/src/plan.rs:1126`); no durable plan-store location | AUTH |
| Payload root, installation root, `HostGovernedRoot` string | **None.** No trusted resolver for the packaged payload (`runtime-payload`) or the governed installation root | DESIGN |
| A pinned git for the Host's repository reader | **None** in the host crates (only the Control Centre's private packaged-git resolver) | DESIGN |
| Durable location of the 1455-byte signed delegation record | **None** defined | WIRING |
| Service epoch | **None** (`core::authority_time::epoch()` is `pub(crate)`) | WIRING |
| Host state-root path from `ActivatedHostDurableState` | No accessor (the root is private) | WIRING |
| Project selector | Derivable: the registry entry whose `project_identity_digest(id)` equals the delegation's owner-signed project digest | WIRING |
| Per-session admission store | `GovernedReviewActivation` held ONE store for the loop, but `InMemoryRequestAdmissionStore` is bound to one session → the 2nd connection would be refused | **FIXED** (made per exchange) |
| Per-exchange candidate pin | HEAD moves with each unattended local candidate commit, so the reader must be pinned per exchange | Requirement recorded on `GovernedReviewActivation::candidate`; belongs to the resolver |

**Answer to criterion 21 as written at 2026-09-25: NO.** The trust chain and the answer were
source-complete; the activation resolver was not.

## FINAL STATUS (2026-09-26) — criterion 21 is MET: every row above now has a production source

The gatekeeper's PRE-PUSH ruling ordered the three AUTH rows closed inside PATH1B, and they were:

| INPUT | PRODUCTION SOURCE NOW | WHERE |
|---|---|---|
| `VerifiedOwnerProgrammeDelegation` outside the compose | `verify_owner_programme_delegation_for_installation` — the same ONE O12-pinned verifier, sealed inputs composed internally, provenance checked BEFORE the durable read (SEC-L1) | `windows-local-ipc::owner_programme_delegation` |
| `Active` lifecycle record | `activate_owner_programme_delegation` — authority is the two owner signatures alone (manifest + delegation); store lifecycle rules bound it; idempotent on Active; terminal states never resurrected | same module (`record_lifecycle` gains its production caller) |
| Plan identity/version/digest + `ApprovedPlanBinding` | `CommittedPlanAuthority` — the COMMITTED `PlanRecordDto` at `.projectops/host-approved-plan.v2.json` of the pinned commit, re-normalised, digest recomputed, admitted only when it equals the DELEGATION-SIGNED `plan`/`plan_digest`/phase membership; `mirror_into` is the plan store's first production writer | `gatekeeper-review-composition::committed_plan` |
| Payload root / installation root | `RunningExecutable::open_current()` + `PAYLOAD_RELATIVE_ROOT` (existing contract) | `service-host::activation_resolver` |
| Pinned git | `PACKAGED_GIT_RELATIVE_PATH = "runtime/git/cmd/git.exe"` under the validated payload root; reader confines it to the closed vocabulary + fixed env | `packaged-runtime-contract` |
| Delegation record location | `owner-delegation/gatekeeper-review.delegation` under the host state root; exact `SIGNED_DELEGATION_RECORD_LEN` no-follow read; ABSENT = ordinary dormancy | `service-host::activation_resolver` |
| Service epoch / state root / plan store root | `host_state_activation::host_state_root()` + fixed leaves (`approved-plans`, `broker-scratch`) | `windows-local-ipc::host_state_activation` |
| Project selector | The registry entry whose committed closure attests to the delegation's owner-signed digests | `service-host::activation_resolver` |
| Per-exchange candidate pin | `pin_exchange` re-reads HEAD and re-ingests the plan on EVERY exchange (local candidate commits move HEAD) | `service-host::activation_resolver` |

The SCM entry calls ONE dispatcher, `serve_resolved_until_stop`: governed activation resolves →
governed review serving; any `GovernedActivationUnavailable` → the status loop, exactly as before.
Supplying the owner-signed inputs and starting the service now needs **no further production
source**. Proof: `service_entry_tests.rs` (9/9) drives the full route end-to-end over a real
durable store, and the production entries refuse the fixture record.
