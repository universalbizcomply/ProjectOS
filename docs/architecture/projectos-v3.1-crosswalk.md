# ProjectOS V3.1 Roadmap-Integration & Status Crosswalk

- **Document ID:** PROJECTOS-V3.1-CROSSWALK
- **Version:** 1.3 (CD-B4 closure authority, 2026-08-04 — `PROJECTOS-V3-CD-B4-CLOSURE-AUTHORITY-RECORD1A`; v1.2 was `PROJECTOS-V3-ACCEPTANCE-DECISIONS-RECORD1A`, v1.1 `PROJECTOS-V3-RECORDS-RECONCILE1A`)
- **Owner:** Murad
- **Status:** AUTHORITATIVE CURRENT STATUS CROSSWALK
- **Approved-plan reference:** ProjectOS V3 Master Plan v1.0
- **Approved-plan source commit:** 1aa36b9
- **Crosswalk source baseline:** fdee3d341e0c43ae2d62a256e0b755196599139b
- **Previous baseline (superseded, retained for history):** e1749ccd2ca7a6348c5ece7bc97b18643de4e8ee

> **v1.1 CHANGE NOTE.** Version 1.1 corrects status only. It accepts nothing, closes nothing, and does not amend the approved plan, which remains immutable at v1.0 (`1aa36b9`). Superseded v1.0 content is marked **SUPERSEDED** in place rather than deleted. `EXECUTION_READY` remains **false**.

> **v1.2 CHANGE NOTE.** Version 1.2 persists the owner-approved decisions of the read-only acceptance sweep (`PROJECTOS-V3-ACCEPTANCE-SWEEP1A`). It records **implementation acceptance**, which is **not closure**: **no numbered V3 phase is closed here**, `acceptedPhaseCount` stays **3 / 19**, and `EXECUTION_READY` stays **false**. It also corrects a v1.1 error of my own — §3a classified build-order items 3–8 from their report **filenames** rather than from the Reports Index, which is the closure ledger and has recorded them CLOSED since 2026-06-30.

> **v1.3 CHANGE NOTE.** Version 1.3 persists the corrected CD-B4 closure-authority matrix (§8a, §8c, §8d) under the owner ruling of 2026-08-04. It replaces the v1.1/v1.2 blanket *IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE* classification with per-phase authority state, records that **`86ae19c` and `a43898d` remain OPEN**, and changes **no numbered V3 phase**: `acceptedPhaseCount` stays **3 / 19** and `EXECUTION_READY` stays **false**.

> **WARNING — NOT A PLAN.** This document is an authoritative current-status and roadmap-integration crosswalk. It does **not** replace, amend or version the approved ProjectOS V3 Master Plan v1.0. The approved plan remains immutable at v1.0 (source commit `1aa36b9`). This crosswalk records status, integrates later workstreams (Forge, HARDEN/real-worker, CD-B4) that are **not** part of the original numbered V3 Phase 0–18 plan, and persists the **APPROVED DIRECTIONAL V3.1 ROADMAP STRUCTURE** (Track A–G). Directional-roadmap approval is **not** implementation authority: no Track C, Track D or other implementation phase is authorised merely because the directional structure is approved.

## 1. Purpose and authority
Reconcile tracked ProjectOS governance evidence with accepted ChatGPT gate decisions through repository HEAD `fdee3d341e0c43ae2d62a256e0b755196599139b` (v1.0 covered through `e1749ccd`), without renumbering history and without publishing a merged overall percentage. It integrates three parallel workstreams: the numbered V3 product plan, Forge, and the CD-B4 host-authority engine.

## 2. Source hierarchy
1. Owner-approved plans / scope / protected-action decisions. 2. Current ChatGPT gate & closure decisions (may be authoritative before a matching repository closure record is persisted). 3. Persisted accepted closure reports. 4. Pushed repository evidence. 5. Tracked current-state / plan-memory. 6. Accepted local evidence. 7. Unaccepted implementation reports. 8. Historical / stale / superseded sources. 9. Claude private memory (never overrides 1–2).

## 3. Original universal programme
Knowledge pack, universal framework, PolyGo install, phase reporter, staging deploy guard, proof factory, staging drift detector, CI governance, multi-project dashboard — **DELIVERED / PUSHED** (ProjectOps tooling set; per-item formal closure via the ProjectOps report set).

~~PolyGo install path is **BLOCKED** (no trust anchor).~~ **SUPERSEDED 2026-08-03** — see §3a.

### 3a. Original build-order status (v1.2, per capability)

| # | Capability | Status | Basis |
|---|---|---|---|
| 1 | Universal framework | **CLOSED** | `PROJECTOPS-UNIVERSAL1A` — index: *"Closed by owner/advisor 2026-06-30"*; + V2 closure (§4) |
| 2 | PolyGo installation | **COMPLETED / CLOSED** | `PROJECTOPS-POLYGO-INSTALL1A` — index: *"Closed by owner/advisor 2026-06-30"*; canonical `.projectops/project-config.json` later installed in `polygonia-apres/polygo` at `b6e6993` + `e788d3c6173a7e599aff482328b9b9d2cb7dad74` |
| 3 | Phase reporter | **CLOSED** (authority ratified 2026-08-04) | Reports Index row CLOSED since 2026-06-30; validate-all 12/12 |
| 4 | Staging deploy guard | **CLOSED** (authority ratified 2026-08-04) | Reports Index row CLOSED since 2026-06-30 |
| 5 | Proof factory | **CLOSED** (authority ratified 2026-08-04) | Reports Index row CLOSED since 2026-06-30 |
| 6 | Staging drift detector | **CLOSED** (authority ratified 2026-08-04) | Reports Index row CLOSED since 2026-06-30 |
| 7 | CI governance | **CLOSED** (authority ratified 2026-08-04) | Reports Index row CLOSED since 2026-06-30; validate-all 27/27 |
| 8 | Multi-project dashboard | **CLOSED** (authority ratified 2026-08-04) | Reports Index row CLOSED since 2026-06-30; validate-all 31/31 |

**SUPERSEDED v1.1 text (retained):** ~~Items 3–8 have carried `AWAITING-REVIEW` reports since 2026-06-30. They are deliberately NOT promoted to CLOSED here — code and a report existing is not acceptance.~~

**Correction.** That v1.1 classification was **wrong**. It read the report **filenames**, which still carry the `AWAITING-REVIEW` suffix, instead of the **Reports Index**, which is the closure ledger and has recorded all six as **CLOSED since 2026-06-30**. The only genuine gap was that those six rows named no closure authority, unlike their siblings (`PROJECTOPS-UNIVERSAL1A`: *"Closed by owner/advisor 2026-06-30"*). The owner ratified that authority on **2026-08-04**. The filenames are deliberately **not** renamed — an existing report file is historical evidence, not a status field.

None of items 3–8 is a numbered V3 phase, so this ratification leaves `acceptedPhaseCount` at **3 / 19**.

## 4. ProjectOS V2
**CLOSED (ACCEPTED)** — `knowledge/reports/2026-07-11_ProjectOS_PROJECTOS-V2-FINAL-CLOSURE-EVIDENCE1A_CLOSED.md` (+ `…SYSTEM-E2E1A_CLOSED`).

> **v1.2 — V2 component reports are SUBSUMED, not newly accepted.** The nineteen V2 component reports — `PROJECTOS-CORE1A`, `LOCAL-AGENT1A`, `WORKERS1A`, `PHASE-RUNTIME1A`, `PROJECT-INSTALL1A`, `PROJECT-INSTALL1B`, `APPROVALS1A`, `ORCHESTRATION1A`, `PLUGINS1A`, `VSCODE1A`, `CONTROL-CENTER1A`, `CONTROL-CENTER1B`, `CLOUD-DASHBOARD1A`, `CLOUD-DASHBOARD1B`, `V2-COMPLETION`, `BRIDGE-DAEMON1A`, `CONTROL-CENTER-DAEMON-WIRE1A`, `TAURI-IPC-CLOSURE1A`, `AUTOMATIC-BRIDGE-ARCHITECTURE1A` — are components of the already-accepted V2 programme. The owner decided on 2026-08-04 that they are **SUBSUMED** under `PROJECTOS-V2-FINAL-CLOSURE-EVIDENCE1A` (*"accepted by Murad and ChatGPT"*) together with `PROJECTOS-SYSTEM-E2E1A` (*"ChatGPT ACCEPTED"*). This grants **no new individual acceptance**, changes no numbered V3 phase, and leaves every historical report path untouched. Kernel, CLI/local agent, worker model, phase runtime, install, approvals, orchestration, bridge daemon, desktop Control Centre, web dashboard, auth, Tauri — accepted under V2 closure.

## 5. Original V3 Phase 0–18 ledger (numbered roadmap — IDs preserved, not renumbered)
| # | Phase ID | Status |
|---|---|---|
| 0 | PROJECTOS-V3-BASELINE-RECONCILE1A | CLOSED AND PUSHED |
| 1 | PROJECTOS-V3-MASTER-PLAN-MEMORY1A | CLOSED AND PUSHED |
| 2 | PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A | CLOSED AND PUSHED |
| 3 | PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A | IMPLEMENTATION ACCEPTED — OPEN |
| 4 | PROJECTOS-V3-LOCAL-SECRET-BROKER1A | IMPLEMENTATION ACCEPTED — OPEN |
| 5 | PROJECTOS-V3-SECRET-OPERATION-BROKER1A | IMPLEMENTATION ACCEPTED — OPEN |
| 6 | PROJECTOS-V3-OWNER-CHAT1A | IMPLEMENTATION ACCEPTED — OPEN |
| 7 | PROJECTOS-V3-PROJECT-SESSION-LAUNCHER1A | IMPLEMENTATION ACCEPTED — OPEN |
| 8 | PROJECTOS-V3-CLAUDE-DESKTOP-BRIDGE1A | IMPLEMENTATION ACCEPTED — OPEN |
| 9 | PROJECTOS-V3-E2E-RUNNER1A | IMPLEMENTATION ACCEPTED — OPEN |
| 10 | PROJECTOS-V3-APPROVAL-QUEUE1A | IMPLEMENTATION ACCEPTED — OPEN |
| 11 | PROJECTOS-V3-PROVIDER-CONTEXT-GUARDS1A | IMPLEMENTATION ACCEPTED — OPEN |
| 12 | PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A | IMPLEMENTATION ACCEPTED — OPEN (UI present; now also reads real host status, §8b) |
| 13 | PROJECTOS-V3-DESKTOP-E2E-PROOF1A | **OPEN — NATIVE DESKTOP-WINDOW PROOF REQUIRED** |
| 14 | PROJECTOS-V3-POLYGO-BASELINE-RECONCILE1A | IMPLEMENTATION ACCEPTED — OPEN (was BLOCKED in v1.0; see §12) |
| 15 | PROJECTOS-V3-POLYGO-INSTALL-REENTRY1A | IMPLEMENTATION ACCEPTED — OPEN (was BLOCKED in v1.0; see §12) |
| 16 | PROJECTOS-V3-POLYGO-PILOT1A | **OPEN — PROJECTOS RUNTIME-DRIVEN EXTERNAL E2E REQUIRED** (manual pilot done; see §12) |
| 17 | PROJECTOS-V3-RELIABILITY-HARDENING1A | IMPLEMENTATION ACCEPTED — OPEN |
| 18 | PROJECTOS-V3-FINAL-E2E-CLOSURE1A | **SUPERSEDED** — replaced by `PROJECTOS-V3-FINAL-RUNTIME-E2E1A` (§5a) |

**Numbered V3 closure ratio = 3 / 19** (phases 0, 1, 2 only; applies ONLY to the original numbered V3 roadmap; not product/shipping/CD-B4/Forge). **Unchanged by v1.1 and v1.2.**

### 5a. What "IMPLEMENTATION ACCEPTED — OPEN" means (v1.2)

The owner accepted, on **2026-08-04**, that the implementation of phases 3–12, 14–15 and 17 is **adequate**. That is **not closure**:

- the phase stays **OPEN**;
- it does **not** count toward `acceptedPhaseCount`, which stays **3**;
- closure still requires the outstanding proof for its track.

**Phase 18 is SUPERSEDED, not deleted.** Its 2026-07-12 claim — *"PROJECTOS V3 LOCALLY COMPLETE AND PROVEN"* — predates the entire CD-B4 host chain, the real service installation and the PolyGo pilot, so it can no longer serve as the final gate. The replacement final gate is **`PROJECTOS-V3-FINAL-RUNTIME-E2E1A`**: the ProjectOS **runtime** driving a real external repository through its own `install` / `phase` / `report` / `close` workflow. The historical Phase 18 report is retained unchanged as evidence of what was true in July.

## 6. Forge ledger
- Synthetic/offline F1–F10: **IMPLEMENTED AND PUSHED**.
- Real local application proof: **PARTIAL** (Postgres round-trip done; Docker/Supabase environment-blocked).
- WSL2 real-worker proof: **DONE** (`3b791e7`).
- Native Windows worker proof: **NOT RUN**.
- Formal phase acceptance / programme closure: **NOT VERIFIED**.

**Forge overall = IMPLEMENTED AND PUSHED — FORMAL PROGRAMME CLOSURE NOT VERIFIED.** Forge is NOT formally closed.

### 6a. Forge / HARDEN records correction and deferral (v1.2, owner decision 2026-08-04)

**Eight** Reports Index rows carried Status `CLOSED` while their own reports concluded the opposite. (The sweep estimated nine; inspecting each report gives **eight** — the ninth flag was a keyword false positive on a dashboard row. Recorded as found, not as estimated.) Corrected from each report's own conclusion:

| Row | Report conclusion (authoritative) | Corrected status |
|---|---|---|
| `PROJECTOS-FORGE-REAL-E2E-ACTIVATION1A` | *"PARTIAL — the provable real subset PASSED; two capabilities are ENVIRONMENT-BLOCKED… Awaiting advisor/owner review"* | AWAITING-REVIEW (PARTIAL) |
| `PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B` | *"BLOCKED — REQUIRED OWNER-MACHINE CAPABILITY UNAVAILABLE"* | **BLOCKED** |
| `…ACTIVATION1B-HARDEN1A` … `…HARDEN1E` (5 rows) | *"IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW"* | AWAITING-REVIEW |
| `PROJECTOS-FORGE-WSL2-FINAL-TOOL-ISOLATION-PROOF1C` | *"REAL WSL2 WORKER PROOF PASSED — AWAITING CHATGPT PUSH/CLOSURE GATE"* | AWAITING-REVIEW (proof passed; closure gate outstanding) |

The index Status column is constrained by `validate-report-index.cjs` to `AWAITING-REVIEW`, `AWAITING-CLOSURE`, `BLOCKED`, `DO-NOT-CLOSE`, `CLOSED`. Where a report's own wording is finer-grained than that enum — "PASSED but awaiting the closure gate", or the PolyGo 14–16 row's superseded blocker — the row carries the nearest true enum value and the exact evidenced conclusion is recorded in its notes. The validator was **not** modified.

**WSL2 proof is WSL2 proof.** It is never to be recorded as native Windows proof. The **native Windows worker proof has NOT been run**.

**DEFERRED — NOT PROJECTOS V3 RELEASE-BLOCKING.** Forge and the HARDEN/real-worker track are a later workstream outside the approved V3 definition-of-complete. They are useful, they are not release-critical, and no V3 gate waits on them.

## 7. HARDEN and real-worker ledger
HARDEN1A–1E + real-e2e-1B + WSL2 tool-isolation (`0f888f7`, `dabcee5`, `597f4ac`, `005a5a5`, `a9990ed`, `3b791e7`): clone isolation, OS-containment, trusted-workspace-diff, process termination/ownership, sandbox-exec binding, fail-closed disposal. **PUSHED, load-bearing, FORMAL CLOSURE NOT VERIFIED.** Residual: real proof WSL2-only, not native.

## 8. CD-B4 ledger (LATER UNINCORPORATED WORKSTREAM)
Formally CLOSED by gate decision (see §10). Other CD-B4 phases (runtime-instance-authority `85df339`, elevation-fact `fdf0499`, owner-presence-fact `c306c80`, permit→effect-grant `1a716f3`, effect-witness `88a5db0`, repository authority `14ef2ed`, protected-plan/durable-store, service-identity/SCM/IPC/binding chain, host-authority/crypto/DPAPI/ACL foundation) are **IMPLEMENTED AND PUSHED — FORMAL CLOSURE NOT VERIFIED**. CD-B4 is a later workstream requiring roadmap integration; it is **not** an original V3 Phase 0–18 track.

### 8a. Post-`e1749cc` CD-B4 closure-authority ledger (corrected, v1.3)

Twenty-four commits landed between `e1749ccd` and `fdee3d34`. Two (`7cad460`, `cae6a74`) are governance documents. The remaining twenty-two are CD-B4 phase work, ledgered per commit in `knowledge/reports/2026-08-03_ProjectOS_PROJECTOS-V3-RECORDS-RECONCILE1A_CLOSED.md` §A.

> **SUPERSEDED (v1.1/v1.2 classification, retained).** ~~All twenty-two were recorded **IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE**, on the reasoning that no explicit closure decision was persisted in this repository.~~ That blanket classification was **wrong**. It searched only the repository and the implementer's local memory and treated their silence as proof of no authority. The authoritative ChatGPT gate history — rank 1 under §2, and outside both of those stores — records explicit closure for most of this chain. **Repository silence is not evidence of absent authority.**

**Corrected matrix (owner ruling, 2026-08-04, `PROJECTOS-V3-CD-B4-CLOSURE-AUTHORITY-RECORD1A`).** Gate wording as supplied by the gatekeeper: `ACCEPTED FOR CLOSURE — CLOSED`, and for `76d052b` specifically `ALREADY ACCEPTED FOR CLOSURE — CLOSED`. Exact decision dates are **unavailable in persisted records** and are deliberately not estimated.

| Commit | Phase | Authority | Status |
|---|---|---|---|
| `87db53b` | `PROJECTOS-V3-OWNER-PRESENCE-CONFIRMATION-UX1A` | ChatGPT gate: ACCEPTED FOR CLOSURE — CLOSED | **A — CLOSED** (E2E4/E2E19 accepted carry-forward) |
| `69ebabf` | `CD-B4-CONTROL-CENTRE-WINDOW-OBSERVATION-BRIDGE1A` | ChatGPT gate: ACCEPTED FOR CLOSURE — CLOSED | **A — CLOSED** (headed-proof blocker deferred, phase not reopened) |
| `fe8bbab` | `CD-B4-PRODUCTION-CAPABILITY-ACQUISITION-SEAM1A` | ChatGPT gate: ACCEPTED FOR CLOSURE — CLOSED | **A — CLOSED** |
| `061bb24` | `CD-B4-SEALED-EXPECTED-WINDOW-FACTS1A` | ChatGPT gate: ACCEPTED FOR CLOSURE — CLOSED | **A — CLOSED** |
| `aa4d499` | `CD-B4-PRODUCTION-OWNER-PRESENCE-CAPABILITY-BRIDGE1A` | ChatGPT gate: ACCEPTED FOR CLOSURE — CLOSED | **A — CLOSED** |
| `0abf4e8` | `CD-B4-PRODUCTION-HOST-AUTHORITY-ACQUISITION1A` | ChatGPT gate: ACCEPTED FOR CLOSURE — CLOSED | **A — CLOSED** |
| `1e9b392` | Canonical installation identity (CD-B4) | ChatGPT gate: ACCEPTED FOR CLOSURE — CLOSED | **A — CLOSED** |
| `13774b5` | Windows host-authority observer (CD-B4) | ChatGPT gate: ACCEPTED FOR CLOSURE — CLOSED | **A — CLOSED** |
| `1d25cc8` | `PROJECTOS-VALIDATOR-SCRATCH-LIFECYCLE1A` | ChatGPT gate: ACCEPTED FOR CLOSURE — CLOSED | **A — CLOSED** (validator **code**, not documentation) |
| `76d052b` | `CD-B4-ELEVATED-INSTALLER-IDENTITY-COMPOSITION1A` | ChatGPT gate: **ALREADY ACCEPTED FOR CLOSURE — CLOSED** | **A — CLOSED** |
| `39ce5f2` | `CD-B4-INSTALLER-READINESS1A` | ChatGPT gate: ACCEPTED FOR CLOSURE — CLOSED | **A — CLOSED** |
| `5e68016` | `CD-B4-PROJECTOSHOST-SERVICE-RUNTIME1A` | ChatGPT gate: ACCEPTED FOR CLOSURE — CLOSED | **A — CLOSED** |
| `0220048` | `CD-B4-LOCAL-INSTALL-AND-LIVE-PROOF1A` | ChatGPT gate: ACCEPTED FOR CLOSURE — CLOSED | **A — CLOSED** (real elevated Windows effect) |
| `fdee3d3` | `CD-B4-PROJECTOSHOST-CURRENT-RELEASE-REINSTALL1A` | ChatGPT gate: ACCEPTED FOR CLOSURE — CLOSED | **A — CLOSED** |
| `092fe9d` + `7fa0e13` | `CD-B4-INSTALLER-CANONICAL-IDENTITY-RECORD-WRITER1A` (+ `-CLOSEOUT1B`) | ChatGPT gate: ACCEPTED FOR CLOSURE — CLOSED, **as one correction pair** | **B — CLOSED AS A PAIR** |
| `c213078`, `193bee9`, `bd35e44`, `0eee58e` | `CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A` | ChatGPT gate at `0eee58e`: ACCEPTED FOR CLOSURE — CLOSED, **closing the whole phase** | **B — CLOSED AS ONE PHASE** (see §8c) |
| `86ae19c` | `CD-B4-PRODUCTION-OWNER-PRESENCE-PROVIDER1A` | **APPROVED TO PUSH only**; no closure authority recovered | **D — OPEN** |
| `a43898d` | `CD-B4-WINDOWS-USER-VERIFICATION-ADAPTER1A` | none located | **G — OPEN**, owner authorisation of the direct `windows-future` dependency required |
| `7cad460`, `cae6a74` | v1.0 crosswalk; V3.2 amendment | — | **F — governance-only**, no independent phase closure needed |

Totals: **A = 14 commits**, **B = 6 commits across 2 phase closures**, **D = 1**, **G = 1**, **F = 2** — 24 in all.

### 8c. Phase-chain and correction-pair treatment

**`CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A` is ONE phase in three rounds**, not four independent phases:

| Round | Commits | Content | Interim gate position |
|---|---|---|---|
| 1 | `c213078`, `193bee9` | installed-host status contract + reader; specific IPC transport | CHECKPOINT ACCEPTED |
| 2 | `bd35e44` | end-to-end workflow proof; record-file ACL defect fixed in the installer | initial DO-NOT-CLOSE |
| 3 | `0eee58e` | release currentness — **the phase closes here** | ACCEPTED FOR CLOSURE — CLOSED |

The owner ruled on 2026-08-04 that the `0eee58e` decision **closed the whole phase**. `c213078` and `193bee9` are therefore **accepted checkpoints within the phase**, and `bd35e44` is a **subordinate correction round**. Their interim positions were superseded when the phase closed. **None of the three is an independently closed phase, and none may be presented as one.** `fdee3d3` is a separate phase (`…-CURRENT-RELEASE-REINSTALL1A`), independently closed.

**`092fe9d` + `7fa0e13` are one correction pair**, closed by a single decision: the canonical identity record writer, then CLOSEOUT1B which moved the CSPRNG into the authority-free leaf and wired the production installation-id source. **Two commits, one phase closure — not two.**

### 8d. Why this correction was needed

Every affected memory entry records the request side of these gates — *"AWAITING POST-PUSH ACCEPTED FOR CLOSURE (do NOT self-close)"* — and never the answer. **The decisions were made and never written back to the repository.** That is the systemic defect this ledger closes. Persist the gate decision in the repository at the time it is given; do not rely on it being recoverable later.
### 8b. Delivered Windows host state (fact, verified live 2026-08-01)

- A **real `ProjectOSHost` Windows service is installed and running** on the owner's machine as `NT SERVICE\ProjectOSHost`, SID type UNRESTRICTED, `DEMAND_START`.
- The service reports **identity = Verified** and **readiness = Ready**, where Ready now additionally requires that the running executable's digest match the `release_manifest_digest` in the immutable installation record.
- The **Control Centre reads that real status over the accepted named-pipe channel**, and the workflow survives service stop/restart.
- Wrong-kind, malformed and wrong-role probes are refused with no status returned.

This retires the v1.0 claim that no real activation and no protected effect had occurred. It does **not** make the programme execution-ready — see §15.

## 9. Per-phase evidence classifications
- PRODUCTION-TRUSTED-CLOCK1A: CONTRACT + FIXTURE + TYPE-SYSTEM/COMPILE-FAILURE + BOUNDED LIVE READ-ONLY Windows proof; no production activation; no protected effect.
- PRODUCTION-RUNTIME-PROVIDER1A: CONTRACT + FIXTURE + COMPILE-FAILURE + BOUNDED LIVE READ-ONLY self-observation; WindowsService/SCM ENVIRONMENT-BLOCKED carry-forward; no activation.
- PRODUCTION-IPC-PROVIDER1A: compiled production contract + FIXTURE/SYNTHETIC cross-crate verification; real named-pipe proof NOT RUN; transient named-pipe OWNER-GATED; operational production activation UNAVAILABLE.
- IPC-SESSION-AUTHORITY1A / RUNTIME-IPC-PERMIT-INTEGRATION1A: CONTRACT + FIXTURE + COMPILE-FAILURE; SYNTHETIC currentness; no live/protected effect.

## 10. Accepted closures
- V3 numbered: Phase 0, Phase 1, Phase 2.
- V2 programme: CLOSED.
- CD-B4 (by ChatGPT gate — persisted in `knowledge/reports/2026-07-29_ProjectOS_CD-B4-PRODUCTION-CLOSURES-LEDGER1A_CLOSED.md`):
  1. CD-B4-IPC-SESSION-AUTHORITY1A — commit e77ce3e
  2. CD-B4-RUNTIME-IPC-PERMIT-INTEGRATION1A — commit 4812f7f
  3. CD-B4-PRODUCTION-TRUSTED-CLOCK1A — commit a5f8ac5
  4. CD-B4-PRODUCTION-RUNTIME-PROVIDER1A — commit 2a438b8
  5. CD-B4-PRODUCTION-IPC-PROVIDER1A — commit e1749ccd2ca7a6348c5ece7bc97b18643de4e8ee

## 11. Pushed but unclosed work
Other CD-B4 phases (§8), Forge F1–F10 + HARDEN + WSL2, V3 numbered phases 3–9 (implemented locally, AWAITING-REVIEW). ~~**all post-`e1749cc` CD-B4 work (§8a)**~~ **SUPERSEDED v1.3** — that chain is now per-phase resolved in §8a: 20 of 24 commits are CLOSED by explicit ChatGPT authority; only `86ae19c` (approved to push only) and `a43898d` (owner dependency authorisation required) remain open. ~~ProjectOps tooling (build-order items 3–8, §3a)~~ **SUPERSEDED v1.2** — those six are CLOSED with authority ratified (§3a). Acceptance debt at v1.1: **64 reports AWAITING-REVIEW**, 2 AWAITING-CLOSURE, 5 CLOSED.

## 12. Blocked work
~~PolyGo baseline / install / pilot (Phases 14–16) — no canonical `.projectops/config.json` trust anchor.~~ **SUPERSEDED 2026-08-03.**

**Nothing in this crosswalk is currently BLOCKED.** The v1.0 PolyGo blocker is resolved on the evidence below:

| Fact | Commit |
|---|---|
| Canonical `.projectops/project-config.json` trust anchor installed in `polygonia-apres/polygo` | `b6e6993` and `e788d3c6173a7e599aff482328b9b9d2cb7dad74` |
| Governed pilot `BOOKING-PANEL-STALE-FETCH-GUARD1A` implemented under a phase manifest and evidence pack | `790c0ae38626704954ee075637ae3e2010e19b7a` |
| Pilot formally closed by owner/gatekeeper decision, closure row appended to the PolyGo rollout ledger | `ce24f084a4cb082d8ff8fd86c120940ceb07a6d5` |

The pilot exercised: an exact seven-path boundary, a phase-specific validator, a mutation matrix, staging-only environment identity, normal push and remote reconciliation, automatic staging deployment, production-freeze preservation, and separate formal closure — with no unauthorised database, send or payment activity.

> **CRITICAL LIMITATION — READ BEFORE TREATING PHASES 14–16 AS DONE.**
> The PolyGo pilot proved the **ProjectOS governance MODEL**. It did **not** prove the **ProjectOS RUNTIME**.
> Every step was performed manually by the implementer: the phase manifest was hand-written, the validators
> were hand-run, the evidence pack was hand-authored. **`projectos/agent`'s `install` / `phase` / `report` /
> `close` commands were never invoked**, and ProjectOS's own validators still resolve paths inside this
> repository, so they do not yet run against an external root.
> Manual governance proof ≠ runtime automation proof. Phases 14–16 are therefore **NO LONGER BLOCKED but NOT
> ACCEPTED**, and the runtime proof remains mandatory — see §17a and C2.

The commits above belong to the **PolyGo** repository (`polygonia-apres/polygo`), not to this repository. They are recorded here as external accepted evidence and are not resolvable in ProjectOS git history.

**v1.2 owner decision (2026-08-04).** Phases 14 and 15 are **IMPLEMENTATION ACCEPTED — OPEN**: installation and the manually governed pilot are complete. Phase 16 is **OPEN — PROJECTOS RUNTIME-DRIVEN EXTERNAL E2E REQUIRED**. **No numbered phase closure is granted by this decision**, and `acceptedPhaseCount` stays 3.

## 13. Superseded work
Host-authority scaffold `823fd26` (superseded by synthetic `bff6a8d`); early identity-relocation (memory-noted). The 6-wave roadmap planning memory is superseded by this crosswalk as the status source.

## 14. Track A–G — APPROVED DIRECTIONAL V3.1 ROADMAP STRUCTURE

The Track A–G structure has been approved by the owner/gatekeeper and is persisted by this current-status crosswalk. It does not replace, amend or version the approved ProjectOS V3 Master Plan v1.0. Roadmap approval is not implementation authority: no Track C, Track D or any other implementation phase is authorised merely because the directional structure is approved — each phase still requires its own owner/gatekeeper gate.

- **Track A — Plan, governance and memory.**
- **Track B — Owner Control Centre and no-training-required UX.**
- **Track C — Secure Windows host, authority and protected execution.**
- **Track D — AI provider, worker and project-session control.** *(V3.2 amendment: providers Claude, Codex and future AI operate as governed replaceable workers without a mandatory VS Code dependency; VS Code is an optional specialist editor. See `docs/architecture/projectos-v3.2-ai-provider-independence-amendment.md`.)*
- **Track E — Validation, proof, drift and CI governance.**
- **Track F — PolyGo installation and pilot.**
- **Track G — Multi-project rollout and release closure.**

**V3.2 AI Provider Independence (owner-approved directional amendment, 2026-07-30).** Persisted in `docs/architecture/projectos-v3.2-ai-provider-independence-amendment.md`. ProjectOS is the primary governed delivery environment; Claude, Codex and future AI providers are governed, replaceable workers operating without a mandatory VS Code dependency; VS Code stays an optional specialist editor. Adds Track D subphases (provider broker, Claude local adapter, Codex adapter, credential/capability guard, AI Accounts Control Centre, dual-agent local proof) after the Windows security chain and before the PolyGo pilot, with no renumbering of historical phases 0–18. Provider implementation is NOT YET AUTHORISED; EXECUTION_READY remains false; installation authority remains NotAuthorised; the approved plan stays v1.0.

## 15. Current product state

**SUPERSEDED (v1.0 text, retained):** ~~Governed security engine (CD-B4) + Forge substantially built, synthetic-proven, PUSHED; 5 CD-B4 phases + 3 V3 numbered phases + V2 formally closed. V3 control-plane phases largely implemented-not-accepted or pending; PolyGo blocked; no production activation.~~

**CURRENT (v1.1, 2026-08-03).** Governed security engine (CD-B4) and Forge are built and pushed. The Windows host chain is **no longer synthetic-only**: a real `ProjectOSHost` service is installed and running, reporting Verified identity and Ready current-release status, read live by the Control Centre (§8b). PolyGo is installed and one governed pilot is complete and formally closed (§12). Formally accepted: V2, 3 numbered V3 phases, 5 CD-B4 phases. Everything else is implemented-and-pushed but unaccepted (§11).

**EXECUTION_READY = false. Installation authority = NotAuthorised.**

**Why `EXECUTION_READY` is still false — the accurate reason.** The outstanding item is the **ProjectOS runtime-driven external-project E2E proof**: ProjectOS itself must drive a small real external-repository phase through its own `install` / `phase` / `report` / `close` workflow. The Windows host proof and the PolyGo governance proof are **not** the missing items — both are delivered. Do not restate this flag as "the host is unproven" or "PolyGo governance is unproven"; neither is true.

## 16. Separate metric model (no merged overall ProjectOS percentage)
- **V3 Phase 0–18 closure:** 3 / 19 — ACCEPTED METRIC (numbered roadmap only).
- **V2 programme:** CLOSED — ACCEPTED STATUS.
- **CD-B4 formal closure count:** 5 named phases — ACCEPTED LEDGER COUNT (no percentage; no approved denominator).
- **Forge formal status:** IMPLEMENTED AND PUSHED — FORMAL PROGRAMME CLOSURE NOT VERIFIED.
- **Product capability implemented:** NOT YET CALCULABLE.
- **Shipping readiness:** NOT YET CALCULABLE.
- **97.5%:** HISTORICAL PLANNING ESTIMATE FOR THE GOVERNED HOST-AUTHORITY TRACK ONLY (not a V3 formal-closure percentage).

## 17. Current critical path

**SUPERSEDED (v1.0 text, retained):** ~~Shortest path to enabling EXECUTION_READY (target; currently false) = Track C: production owner-presence provider → production elevation provider → host authority composition → protected-effect adapter (first real bounded effect) → governed Windows real-effect pilot. PolyGo pilot needs Track F (trust-anchor owner decision).~~ **Every step of that Track C chain has been delivered (§8a, §8b), and the Track F trust-anchor blocker is resolved (§12).**

## 17a. Current critical path (v1.1)

**SUPERSEDED v1.1 sequence (retained):** ~~1. `PROJECTOS-V3-ACCEPTANCE-SWEEP1A` — review gate. 2. Owner ruling on `EXECUTION_READY`. 3. `PROJECTOS-V3-FINAL-RUNTIME-E2E1A`.~~ The sweep ran read-only on 2026-08-04 and its decisions are persisted by v1.2.

**Current sequence (v1.2, owner-approved 2026-08-04):**

1. **`PROJECTOS-V3-CD-B4-CLOSURE-AUTHORITY-RECONCILE1A`** — reconcile the true prior gate-closure status of the 22 post-`e1749cc` CD-B4 commits, individually and from evidence. Records work.
2. **`PROJECTOS-V3-DESKTOP-NATIVE-PROOF1A`** — the native desktop-window proof Phase 13 needs.
3. **`PROJECTOS-V3-FINAL-RUNTIME-E2E1A`** — **the one genuine missing proof**: the actual ProjectOS runtime driving a small real external-repository phase through `install` / `phase` / `report` / `close`. Replaces the superseded Phase 18 as the final gate. See §5a and §12.
4. **`PROJECTOS-V3-EXECUTION-READY-RULING1A`** — owner ruling, only after 1–3.

Only step 3 is substantial engineering, and the code it exercises already exists.

RC / final closure still need Tracks B + C + F plus reliability and portability work; none of it is authorised by this crosswalk.

## 18. Next five phases

**SUPERSEDED (v1.0 list, retained) — all five delivered:** ~~1. V3.1 rebaseline persistence — Track A. 2. CD-B4-PRODUCTION-OWNER-PRESENCE-PROVIDER-PREFLIGHT1A. 3. CD-B4-PRODUCTION-ELEVATION-PROVIDER-PREFLIGHT1A. 4. CD-B4-HOST-RUNTIME-AUTHORITY-COMPOSITION preflight. 5. CD-B4-PROTECTED-EFFECT-ADAPTER preflight (first real effect).~~ Delivered at `7cad460`, `86ae19c`, the acquisition/identity chain, the installer composition chain, and `0220048` respectively (§8a). Superseded by §17a.

## 19. Next ten phases

**SUPERSEDED (v1.0 list, retained) — items 6–9 delivered:** ~~6. CD-B4 synthetic authority-path E2E. 7. Windows install/upgrade/rollback design. 8. Windows-Home bounded proof. 9. Governed Windows real-effect pilot (owner-gated). 10. Control-Centre runtime integration (Track B).~~ Items 7–9 were delivered by the installer/service/live-proof chain (`39ce5f2`, `5e68016`, `0220048`, `bd35e44`, `0eee58e`, `fdee3d3`); item 10 is partially delivered (the Control Centre reads real host status, §8b). Superseded by §17a.

## 20. Owner decisions
Formally incorporate Forge + CD-B4 into a plan v1.1 (vs keep as crosswalk tracks); production owner-presence mechanism; clock lifecycle; elevation-execution approval; first protected-effect family; Windows proof environment (Home/VM/AVD/Pro); service-install + ProgramData + ACL approvals; PolyGo trust-anchor route A/B; multi-project portability mandatory?; signed vs unsigned RC; final residual-risk acceptance.

## 21. Protected gates
Any real effect, service install, SCM/ACL/ProgramData, elevation, real named pipe, PolyGo production/db/send/payment — all owner-gated. None taken.

## 22. Carry-forward

**SUPERSEDED items from v1.0 (retained, now delivered):** ~~real installed-service capability; real local-pipe proof; WindowsService/SCM live; protected-effect adapter; PolyGo trust anchor.~~ See §8a, §8b, §12.

**Still open at v1.1:**
- Production activation constructors (grant/verifier).
- Session (RemoteDesktop) — cross-session proof remains environment-blocked on Windows 11 Home.
- Durable production ledger.
- Native Forge worker proof; Forge formal closure.
- ~~**C1 — `PROJECTOS-V3-ACCEPTANCE-SWEEP1A`**~~ **DONE 2026-08-04** (read-only; decisions persisted by v1.2). Note: the "64 AWAITING-REVIEW reports" figure was an artefact of the **filename** convention — the Reports Index already recorded 34 rows CLOSED. Never measure acceptance debt from filenames.
- **C2 — `PROJECTOS-V3-FINAL-RUNTIME-E2E1A`** — the ProjectOS runtime itself driving a real external repository through `install` / `phase` / `report` / `close`. Mandatory; gates `EXECUTION_READY`; replaces the superseded Phase 18.
- ~~**C3 — `PROJECTOS-V3-CD-B4-CLOSURE-AUTHORITY-RECONCILE1A`**~~ **DONE 2026-08-04** (read-only 1A, corrected by 1B, persisted by `…-RECORD1A`). Outcome in §8a. **Two items remain OPEN**: `86ae19c` (`CD-B4-PRODUCTION-OWNER-PRESENCE-PROVIDER1A`, approved to push only) and `a43898d` (`CD-B4-WINDOWS-USER-VERIFICATION-ADAPTER1A`, blocked on owner authorisation of the direct `windows-future` dependency — **no such authorisation may be inferred**).
- **C4 — `PROJECTOS-V3-DESKTOP-NATIVE-PROOF1A`** — native desktop-window proof for Phase 13.
- **C5 — `PROJECTOS-V3-EXECUTION-READY-RULING1A`** — owner ruling, after C2–C4.
- **C6 — Forge / HARDEN** — DEFERRED, non-blocking; native Windows worker proof still NOT RUN (§6a).

## 23. Source references
Approved plan: `docs/architecture/projectos-v3-master-plan.md` (v1.0, `1aa36b9`). State: `projectos/state/projectos-v3.current-state.json`. CD-B4 closures: `knowledge/reports/2026-07-29_ProjectOS_CD-B4-PRODUCTION-CLOSURES-LEDGER1A_CLOSED.md`. Post-`e1749cc` CD-B4 ledger and this reconciliation: `knowledge/reports/2026-08-03_ProjectOS_PROJECTOS-V3-RECORDS-RECONCILE1A_CLOSED.md`. Governance: `docs/Governance/projectos-prompting-and-gate-control-standard.md`.

## 24. Update and supersession rules
This crosswalk is updated only under an owner/ChatGPT governance gate. It never amends the approved plan; a formal plan change requires a separate owner-gated plan v1.1 amendment (Option A) that bumps `planVersion` and `current-state.activePlanVersion` together. Historical phase identifiers are never renumbered. No overall ProjectOS percentage is published until a weighted model is formally approved.
