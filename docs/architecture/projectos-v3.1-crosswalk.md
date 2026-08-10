# ProjectOS V3.1 Roadmap-Integration & Status Crosswalk

- **Document ID:** PROJECTOS-V3.1-CROSSWALK
- **Version:** 1.9 (Phase 17 closure + 18/19 and machine plan record v1.2 → v1.3, 2026-08-10 — `PROJECTOS-V3-RELIABILITY-HARDENING1A`; v1.8 was the machine plan record superseded v1.0 → v1.1 under bounded owner approval, 2026-08-09 — §5e; v1.7 was Phase 16 closure + 16/19, 2026-08-09 — `PROJECTOS-V3-POLYGO-PILOT1A`; v1.6 was execution readiness + 15/19, 2026-08-08 — `PROJECTOS-V3-EXECUTION-READY-RECORD1A`; v1.4 was `PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A`, v1.3 `PROJECTOS-V3-CD-B4-CLOSURE-AUTHORITY-RECORD1A`, v1.2 `PROJECTOS-V3-ACCEPTANCE-DECISIONS-RECORD1A`, v1.1 `PROJECTOS-V3-RECORDS-RECONCILE1A`)
- **Owner:** Murad
- **Status:** AUTHORITATIVE CURRENT STATUS CROSSWALK
- **Approved-plan reference:** ProjectOS V3 Master Plan v1.0
- **Approved-plan source commit:** 1aa36b9
- **Crosswalk source baseline:** fdee3d341e0c43ae2d62a256e0b755196599139b
- **Previous baseline (superseded, retained for history):** e1749ccd2ca7a6348c5ece7bc97b18643de4e8ee

> **v1.1 CHANGE NOTE.** Version 1.1 corrects status only. It accepts nothing, closes nothing, and does not amend the approved plan, which remains immutable at v1.0 (`1aa36b9`). Superseded v1.0 content is marked **SUPERSEDED** in place rather than deleted. `EXECUTION_READY` remains **false**.

> **v1.2 CHANGE NOTE.** Version 1.2 persists the owner-approved decisions of the read-only acceptance sweep (`PROJECTOS-V3-ACCEPTANCE-SWEEP1A`). It records **implementation acceptance**, which is **not closure**: **no numbered V3 phase is closed here**, `acceptedPhaseCount` stays **3 / 19**, and `EXECUTION_READY` stays **false**. It also corrects a v1.1 error of my own — §3a classified build-order items 3–8 from their report **filenames** rather than from the Reports Index, which is the closure ledger and has recorded them CLOSED since 2026-06-30.

> **v1.3 CHANGE NOTE.** Version 1.3 persists the corrected CD-B4 closure-authority matrix (§8a, §8c, §8d) under the owner ruling of 2026-08-04. It replaces the v1.1/v1.2 blanket *IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE* classification with per-phase authority state, records that **`86ae19c` and `a43898d` remain OPEN**, and changes **no numbered V3 phase**: `acceptedPhaseCount` stays **3 / 19** and `EXECUTION_READY` stays **false**.

> **v1.4 CHANGE NOTE.** Version 1.4 records the ChatGPT technical closure gate of 2026-08-04 closing numbered **Phase 13 `PROJECTOS-V3-DESKTOP-E2E-PROOF1A`** on the native desktop proof delivered by `PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A` (accepted commits `1fcf416` and `fb203c6`). This is the first numbered V3 phase closed since Phase 2, so `acceptedPhaseCount` moves **3 -> 4 of 19**. `EXECUTION_READY` stays **false**, `installationAuthority` stays **NotAuthorised**, and `86ae19c` and `a43898d` stay **OPEN**. No other numbered phase changes state.

> **v1.5 CHANGE NOTE.** Version 1.5 persists the owner/gatekeeper decisions taken on the read-only `PROJECTOS-V3-EXECUTION-READY-RULING1A`. **Programme/local `EXECUTION_READY` moves false → true**, scoped exclusively to governed LOCAL/SYNTHETIC delivery, because the single prerequisite this document itself named — the ProjectOS runtime-driven external-repository proof (§15 v1.1–v1.4, §17a step 3, carry-forward C2) — was delivered and is now formally **CLOSED** at accepted commit `d9035b4`. **Installation authority stays `NotAuthorised`. Live, production, provider and credential authority stays `NotAuthorised`.** The Rust host/live `EXECUTION_READY` constants stay **false** and are a **different flag**; never conflate them. `acceptedPhaseCount` stays **4 of 19** — `PROJECTOS-V3-FINAL-RUNTIME-E2E1A` is a gate, not a numbered roadmap phase — and `86ae19c` and `a43898d` stay **OPEN**. No numbered V3 phase changes state; V3 is **not complete**.

> **v1.6 CHANGE NOTE — ELEVEN NUMBERED PHASES FORMALLY CLOSED.** Version 1.6 persists a second owner + gatekeeper decision taken on the read-only `PROJECTOS-V3-19-PHASE-CLOSURE-RECONCILE1A` audit, in the same governance commit as the readiness ruling above. Phases **3, 4, 5, 6, 7, 8, 9, 10, 11, 14 and 15** move from *IMPLEMENTATION ACCEPTED — OPEN* to **CLOSED**, taking `acceptedPhaseCount` from **4 to 15 of 19**. **Phase 18 is NOT retired**: only its July completion *claim* was superseded; the numbered phase remains **OPEN** as the final closure phase. Phases **12, 16, 17 and 18 remain OPEN** and now carry explicit acceptance criteria (§5b) — recorded prospectively, because the audit found that phases 3–18 never had any. §5c records the two-stack architecture ruling. `EXECUTION_READY` stays **true** (programme/local only), `installationAuthority` stays **NotAuthorised**, and V3 is **not complete**.

> **v1.7 CHANGE NOTE — PHASE 16 CLOSED, 16/19.** Numbered **Phase 16 `PROJECTOS-V3-POLYGO-PILOT1A`** is **CLOSED** (2026-08-09, owner + ChatGPT gatekeeper): the first real ProjectOS-governed PolyGo phase. The canonical runtime drove the lifecycle against the owner-approved PolyGo plan at genuine PLAN READY, and now **enforces** that plan — wrong repository, wrong project identity and invalid/not-ready plans all fail closed before mutation. Owner approval `CFT-CLOSE-1` was recorded **before** owner closure, and both PolyGo commits are pushed and reconciled. `acceptedPhaseCount` **15 → 16 of 19**. **Phases 12, 17 and 18 remain OPEN and V3 is NOT complete.** `EXECUTION_READY` stays **true** (programme/local only), `installationAuthority` stays **NotAuthorised**, and no live, production, provider or credential authority is granted.

> **v1.9 CHANGE NOTE — PHASE 17 CLOSED, 18/19, AND THE MACHINE PLAN RECORD AT v1.3.** Numbered **Phase 17 `PROJECTOS-V3-RELIABILITY-HARDENING1A`** is **CLOSED** (2026-08-10) by ChatGPT under the projectos-scoped delegation, with **all 17 G4 predicates mechanically satisfied** at evidence subject `2b362eb`. Plan v1.2 → **v1.3** on explicit owner approval bound to the canonical committed blob of the candidate (`sha256 4d35bc34…`), adding one Phase-17 acceptance criterion — a LIVE-PROVEN zero-relay handoff — and the required validator that makes it checkable. The phase then closed the gap that made plan text non-binding: G4 never iterated `acceptanceCriteria` and read no `requiredValidator` by name, and `validatorsPass` was a boolean in a file no code wrote. **G4-17** now compares the plan's required names against a subject-bound validator-run record the runner itself writes — and it refused this very closure once, correctly, before the aggregate command could be named. Zero-relay was proven LIVE with three real processes and no prompt relay. `acceptedPhaseCount` **17 → 18 of 19**. **Phase 18 remains OPEN and V3 is NOT complete.** `installationAuthority` stays **NotAuthorised**; no live, production, provider or credential authority is granted.
>
> **v1.8 CHANGE NOTE — MACHINE PLAN RECORD SUPERSEDED v1.0 → v1.1.** Version 1.8 records, and does not itself perform, the owner-approved bounded supersession of the **machine-readable** plan record `projectos/state/projectos-v3.plan.json` from v1.0 to **v1.1** (§5e). The **human-readable** master plan `docs/architecture/projectos-v3-master-plan.md` stays **byte-immutable** at v1.0 (`1aa36b9`) and remains the authoritative source document. Nothing is closed, accepted or renumbered here: `acceptedPhaseCount` stays **16 of 19**, phases **12, 17 and 18 stay OPEN**, V3 is **not complete**, `installationAuthority` stays **NotAuthorised**, and no live, production, provider or credential authority is granted.

> **WARNING — NOT A PLAN.** This document is an authoritative current-status and roadmap-integration crosswalk. It does **not** replace, amend or version the approved ProjectOS V3 Master Plan v1.0. The human-readable master plan remains byte-immutable at v1.0 (source commit `1aa36b9`); the separate machine-readable plan record moved to v1.1 by owner decision, recorded in §5e. This crosswalk records status, integrates later workstreams (Forge, HARDEN/real-worker, CD-B4) that are **not** part of the original numbered V3 Phase 0–18 plan, and persists the **APPROVED DIRECTIONAL V3.1 ROADMAP STRUCTURE** (Track A–G). Directional-roadmap approval is **not** implementation authority: no Track C, Track D or other implementation phase is authorised merely because the directional structure is approved.

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
| 3 | PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A | **CLOSED** (2026-08-08) — owner control plane in `control-center/src/owner/`; 57 vitest, build, live browser proof at 5 breakpoints |
| 4 | PROJECTOS-V3-LOCAL-SECRET-BROKER1A | **CLOSED** (2026-08-08) — `security/broker.cjs`; `validate-secret-broker` registered + green; sec/code review, HIGH+MEDIUM fixed |
| 5 | PROJECTOS-V3-SECRET-OPERATION-BROKER1A | **CLOSED** (2026-08-08) — `security/operation-broker.cjs`; `validate-secret-operation-broker` registered + green; **2 CRITICAL fixed** |
| 6 | PROJECTOS-V3-OWNER-CHAT1A | **CLOSED** (2026-08-08) — local deterministic NLU, no AI/metered API; 77 vitest; HIGH fixed; live browser proof |
| 7 | PROJECTOS-V3-PROJECT-SESSION-LAUNCHER1A | **CLOSED** (2026-08-08) — `launcher/session-launcher.cjs`; `validate-session-launcher` registered + green; HIGH untrusted-root fixed |
| 8 | PROJECTOS-V3-CLAUDE-DESKTOP-BRIDGE1A | **CLOSED** (2026-08-08) — `bridge/desktop-bridge.cjs`; `validate-desktop-bridge` registered + green; **CRITICAL denylist→allowlist fixed** |
| 9 | PROJECTOS-V3-E2E-RUNNER1A | **CLOSED** (2026-08-08) — `e2e/e2e-runner.cjs`; 6 offline scenarios composing phases 4/5/7/8; `validate-e2e-runner` registered + green |
| 10 | PROJECTOS-V3-APPROVAL-QUEUE1A | **CLOSED** (2026-08-08) — `approval/approval-queue.cjs`; cannot self-approve, fail-closed; `validate-approval-queue` registered + green |
| 11 | PROJECTOS-V3-PROVIDER-CONTEXT-GUARDS1A | **CLOSED** (2026-08-08) — `guards/provider-context-guards.cjs`; default-REFUSED; `validate-provider-context-guards` registered + green; HIGH fail-open fixed |
| 12 | PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A | **CLOSED 2026-08-10** by the canonical runtime under the pre-issued ChatGPT ProjectOS G4 gate, evidence subject `7e65fe5`. Definition-of-complete bullet 6 is now PROVEN: the owner drove `validating -> evidence -> awaiting_review -> awaiting_closure` by real clicks in the real Tauri Control Centre, each transition written by `@projectos/core`, and the closure itself was decided by G4 recomputing all sixteen predicates and recorded `by: advisor`. The surface is no longer inert or snapshot-driven. |
| 13 | PROJECTOS-V3-DESKTOP-E2E-PROOF1A | **CLOSED** (2026-08-04, ChatGPT technical closure gate) — native Tauri release proof, authenticated UI proof, responsive/accessibility proof, STOPPED -> UNAVAILABLE host correspondence, R1-R15 passed; evidence `1fcf416` + `fb203c6` and the `PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A` CLOSED report |
| 14 | PROJECTOS-V3-POLYGO-BASELINE-RECONCILE1A | **CLOSED** (2026-08-08) — trust anchor `b6e6993` + `e788d3c`; evidence is EXTERNAL to this repository (§12) |
| 15 | PROJECTOS-V3-POLYGO-INSTALL-REENTRY1A | **CLOSED** (2026-08-08) — PolyGo install complete; evidence is EXTERNAL to this repository (§12) |
| 16 | PROJECTOS-V3-POLYGO-PILOT1A | **CLOSED** (2026-08-09, owner + ChatGPT gatekeeper) — real PolyGo × real canonical runtime × owner-approved plan at PLAN READY; bounded work `POLYGO-CARRY-FORWARD-TRUTH1A` with a load-bearing 13/13 validator; self-approval and self-closure refused; approval `CFT-CLOSE-1` recorded before closure; PolyGo `db82e129` + `aa2718cf`, ProjectOS `f531532` |
| 17 | PROJECTOS-V3-RELIABILITY-HARDENING1A | **CLOSED** (2026-08-10, ChatGPT under the projectos-scoped delegation, all 17 G4 predicates mechanically satisfied) — plan v1.3 activated against the canonical candidate blob; the plan's `requiredValidators` made mechanically enforceable by G4-17 against a subject-bound validator-run record the runner writes; LIVE zero-relay handoff proven with three real processes and no prompt relay, ownership proven by a recorded refusal and the protected boundary by a refused attempt; owner stop honoured immediately before spawn in its own ledger; failure matrix 26/26; 1 CRITICAL (bare-name `git`) and 2 HIGH review findings fixed; R17-2 closed. Evidence subject `2b362eb` |
| 18 | PROJECTOS-V3-FINAL-E2E-CLOSURE1A | **OPEN — NOT RETIRED.** Only the July completion *claim* was superseded (§5a). Remains the final V3 closure phase, after 12, 16, 17. Criteria §5b |

**Numbered V3 closure ratio = 18 / 19** (phases 0–17; OPEN: 18). Applies ONLY to the original numbered V3 roadmap; not product/shipping/CD-B4/Forge.

**SUPERSEDED (v1.0–v1.5 text, retained):** ~~Numbered V3 closure ratio = 3 / 19 (phases 0, 1, 2 only). Unchanged by v1.1 and v1.2.~~ Phase 13 closed at v1.4 (→ 4); the eleven-phase closure at v1.6 (→ 15).

### 5a. What "IMPLEMENTATION ACCEPTED — OPEN" means (v1.2)

**SUPERSEDED (v1.2 text, retained):** ~~The owner accepted, on **2026-08-04**, that the implementation of phases 3–12, 14–15 and 17 is **adequate**. That is **not closure**: the phase stays OPEN; it does not count toward `acceptedPhaseCount`, which stays 3; closure still requires the outstanding proof for its track.~~

**CURRENT (v1.6, 2026-08-08).** The `PROJECTOS-V3-19-PHASE-CLOSURE-RECONCILE1A` audit reconstructed the position from evidence rather than defending the recorded number, and found that for phases 3–11, 14 and 15 **no outstanding proof was ever named**. §5a's phrase "the outstanding proof for its track" was never resolved to a concrete criterion for them — because, as §5b records, phases 3–18 never had acceptance criteria at all. On that finding the owner and gatekeeper **formally closed those eleven phases** on the uniform evidence basis below. Phases 12, 16 and 17 were **not** closed, because each has a real, identifiable gap.

**Closure basis applied to all eleven** (recorded once here rather than as eleven near-identical reports):

- the recorded phase purpose is satisfied;
- an accepted implementation exists at the accepted baseline — verified file-by-file at HEAD, not inferred from a report;
- the phase validator is registered in `validate-all` and green in the 121-validator suite, where the phase has one;
- security-reviewer and code-reviewer evidence exists and every CRITICAL/HIGH finding was corrected;
- the accepted commits are ancestors of HEAD, i.e. genuinely pushed and reconciled;
- no explicit unresolved phase-specific closure criterion remained.

**No retrospective acceptance criteria were invented.** Closure was an owner/gatekeeper judgement on the evidence above. **Phases 14 and 15 close on evidence external to this repository** (`polygonia-apres/polygo`), which is not resolvable in this git history — a stated limitation, not a hidden one.

**Phase 18: the CLAIM was superseded, the PHASE was not.** Its 2026-07-12 claim — *"PROJECTOS V3 LOCALLY COMPLETE AND PROVEN"* — predates the entire CD-B4 host chain, the real service installation and the PolyGo pilot, so it can no longer serve as the final gate; **`PROJECTOS-V3-FINAL-RUNTIME-E2E1A`** replaced it in that role and is CLOSED at `d9035b4`. **The numbered Phase 18 itself remains OPEN** as the final V3 closure phase, to run after phases 12, 16 and 17, with its own acceptance criteria in §5b. Claude cannot self-close it. The historical Phase 18 report is retained unchanged as evidence of what was true in July.

### 5b. Acceptance criteria for the OPEN phases (v1.6, recorded prospectively)

**Why this section exists.** The audit found a structural gap: the approved plan v1.0 defines `acceptanceCriteria` for **three** phases (0, 1, 2) in `projectos-v3.plan.json` while declaring `totalPhaseCount` 19. Phases 3–18 never had machine-readable criteria anywhere. That — not missing work — is why the counter sat at 4 / 19: closure could not be measured against a criterion that did not exist. The gap is fixed **prospectively only**; no criteria are back-dated onto the closed phases, and the plan stays byte-immutable.

**Phase 12 — `PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A`**
1. The Control Centre can drive **start / pause / gate / close**.
2. Those actions reach the **canonical ProjectOS runtime** (§5c), not a parallel one.
3. The worker cannot self-approve or self-close through the UI.
4. State shown in the UI matches durable runtime state.
5. Wrong-project operations fail closed.
6. Responsive, accessibility and live-browser evidence.
7. **No third governance runtime is introduced.**

**Phase 16 — `PROJECTOS-V3-POLYGO-PILOT1A`**
1. Real PolyGo repository. 2. Real ProjectOS runtime. 3. One bounded **non-production** phase. 4. PLAN READY enforced. 5. Correct repository, account and environment. 6. Evidence and report **generated by ProjectOS**. 7. Owner approval gate exercised. 8. Closure recorded through ProjectOS. 9. No production, send or payment effect. 10. Zero unrelated residue.

**Phase 17 — `PROJECTOS-V3-RELIABILITY-HARDENING1A`**
1. Runs **after** Phase 16. 2. Adversarial/reliability coverage includes the actual `projectos/core` and `projectos/agent` runtime. 3. Covers the Phase-12 integration seam. 4. Crash, interruption and recovery. 5. Wrong-project and isolation. 6. Approval bypass. 7. Cleanup and residue. 8. Only pilot-observed defects or load-bearing reliability gaps are fixed. **The existing adversarial coverage of the `.cjs` chain is accepted evidence and must be reused, not rebuilt.**

**Phase 18 — `PROJECTOS-V3-FINAL-E2E-CLOSURE1A`**
1. Phases 12, 16 and 17 closed. 2. Final definition-of-complete matrix. 3. Final evidence pack. 4. Final risk register. 5. Control Centre owner workflow proven. 6. Real PolyGo ProjectOS pilot proven. 7. Canonical-runtime reliability proven. 8. Records and counters reconciled. 9. No-secret proof. 10. No-unauthorised-production proof. 11. Owner/gatekeeper final closure.

### 5c. Two-stack architecture ruling (v1.6)

The audit found **two disconnected governed stacks** in this repository:

1. the **`.cjs` chain** delivered by phases 3–12 and 17 — `security/broker`, `security/operation-broker`, `launcher/session-launcher`, `bridge/desktop-bridge`, `e2e/e2e-runner`, `approval/approval-queue`, `guards/provider-context-guards`, `control-center/src/owner/**`;
2. the **TypeScript `@projectos/core` + `agent` runtime** that drove `PROJECTOS-V3-FINAL-RUNTIME-E2E1A`.

Verified in both directions: `core/src` and `agent/src` contain **no** reference to any `.cjs` chain module, and the chain contains no `@projectos/core` import. Each has its own approval engine — `approval/approval-queue.cjs` and `core/src/approval.ts`.

**Consequences.** `d9035b4` did **not** exercise phases 3–12 or 17 and is **not** their discharging proof — and was never recorded as such; the runtime-E2E condition was attached to **Phase 16 alone**. Stack 2 is the **canonical** runtime: it is what will drive PolyGo. **Phase 12 must connect the Control Centre to stack 2.** Do **not** build a third runtime; do **not** duplicate the approval, state or runner systems; prefer the smallest safe adapter/integration seam. No Phase 12 implementation is authorised by this document.

### 5d. Phase 12 / Phase 13 dependency reconciliation (v1.6)

**The apparent violation, stated plainly.** The approved V3 delivery plan **explicitly requires**:

> *"PHASE 12 must complete before complete desktop proof."*
> *"PHASE 13 must complete before the PolyGo pilot."*

**Phase 13 is the complete desktop-proof phase.** The ledger in §5 now records **Phase 13 CLOSED** while **Phase 12 remains OPEN**, so the later-authority sequencing exception below is required. This is reinforced — not replaced — by the general rule in master plan §16: *"A phase may not be eligible for execution until its dependencies are recorded complete."* Without this note the ledger reads as an unexplained formal dependency violation. It is not one. It is a **specific, later-authority sequencing exception**, recorded here rather than left to be rediscovered.

> **Records gap, flagged not hidden.** Those two dependency sentences are authoritative in the approved V3 delivery plan held by the owner/gatekeeper, but they are **not mirrored in this repository's copy** — `docs/architecture/projectos-v3-master-plan.md` carries only the generic §16 rule, and `projectos-v3.plan.json` declares `dependsOn` for phases 0–2 only. The dependency is cited above on owner/gatekeeper authority. Mirroring the delivery plan's per-phase dependencies into this repository is worth a future records phase; it is not attempted here and the SHA-pinned master plan is untouched.

**How it arose.** Phase 13 was formally CLOSED on 2026-08-04 by the ChatGPT technical closure gate, on its own accepted native desktop proof (`1fcf416` + `fb203c6`, delivered under `PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A`). That closure was correct on the evidence before it. A later programme reconciliation — `PROJECTOS-V3-19-PHASE-CLOSURE-RECONCILE1A` — then established that **Phase 12 retains a distinct residual definition-of-complete gap** that Phase 13's proof never addressed and was never scoped to address: **the owner Control Centre is not yet proven to drive start / pause / gate / close through the canonical ProjectOS `core`/`agent` runtime** (§5c). Phase 13 proved the desktop shell renders, authenticates and reports host status; it did not prove the surface *drives* the lifecycle.

**The ruling.**

- **Phase 13 remains CLOSED.** It is not reopened, and its accepted evidence is not disturbed.
- **Phase 12 remains OPEN.**
- **Retaining Phase 13's closure does NOT imply Phase 12 completion.** The two proved different things.
- The earlier sequencing dependency is **superseded for this specific, already-accepted closure state** by the later owner/gatekeeper ruling.
- **Phase 12 must still close before final Phase 18 closure** — the dependency is deferred, not discharged.
- **This exception does not create a general right to bypass roadmap dependencies.** It is a specific historical reconciliation of one already-accepted closure, not a weakening of phase-dependency governance. Any future out-of-order closure needs its own explicit ruling.

### 5e. Machine plan record v1.1 — bounded owner supersession (v1.8, 2026-08-09)

**What changed, precisely.** The **machine-readable** plan record `projectos/state/projectos-v3.plan.json` is now **v1.1**, superseding v1.0. The **human-readable** master plan `docs/architecture/projectos-v3-master-plan.md` is untouched and stays byte-immutable at the SHA-256 pinned by `validate-v3.2-ai-provider-independence`. Two different artefacts; only the machine record moved.

**Why it was needed.** v1.0's `phases[]` contained **three** entries (0, 1, 2) while the same record declared `totalPhaseCount` 19 and the master plan §17 defines the roadmap as phases 0–18. That gap is the structural defect §5b already named: closure could not be evaluated against a criterion that did not exist, and — newly load-bearing — a runtime that enforces *approved-phase membership* could not authorise phases 3–18 at all, because the approved plan did not contain them. v1.1 **reconciles the record to the roadmap the plan already declared**; it does not extend scope.

**What v1.1 contains, and only this.** All **19** numbered phases 0–18 with their canonical IDs, unrenumbered; per-phase `dependsOn` mirroring the sequential roadmap (master plan §16), which is what makes deterministic dependency enforcement possible; acceptance criteria — for phases 12, 16, 17 and 18 taken from §5b, and for the already-closed phases recorded **retrospectively and marked as such**, being the closure basis actually applied in §5a and the §5 ledger rows, never back-dated as if they had governed the work; the approved scope reconciled to the delivered roadmap; the ProjectOS-only closure delegation below; and truthful version, approval and staleness metadata. Phases 0, 1 and 2 keep their v1.0 text verbatim.

**Historical truth is preserved, not rewritten.** v1.0 is retained at `projectos/state/versions/projectos-v3.plan.v1.0.json` as the **identical git blob** `9091ec2f3149a8fe8087ed5e8cc680f3c21e3cdf` — the same object the superseded file had at `11046f4`, verified with `git hash-object` (the on-disk bytes differ only by the repository's `autocrlf` line endings, which is why the blob, not the raw file, is the claim). v1.1 records `approval.supersedesPlanVersion: "1.0"`, and no historical approval is restated as though v1.1 existed earlier.

**One plan authority.** `.projectops/plan.json` is the default plan location for an ordinary ProjectOS-governed project and still is. ProjectOS itself now declares `planMemory.planPath` in `.projectops/project-config.json`, pointing at its own versioned record, so the runtime governs from **one** file rather than a second byte-identical copy that could later disagree. The declared path is refused at load time if it is absolute, drive-qualified, rooted or traversing, so a config can never point governance outside its own project. Projects that declare nothing are unaffected.

**Closure delegation, recorded truthfully.** v1.1 records `governance.closureDelegation`: Murad delegates **phase closure and final programme closure for ProjectOS only** to the gatekeeper (ChatGPT), on 2026-08-09. `projectScope` pins the delegation to `projectos` so it cannot leak to another project; `excludesProtectedActions` is `true`. **Murad remains project owner** and retains plan approval, plan supersession, material scope decisions and **every** protected action. The implementer (Claude Code) can neither approve nor close, and is never recorded as the owner or the gatekeeper. The field is optional in the schema — a plan without it delegates nothing.

**Approval binding.** Owner Murad authorised a **bounded** v1.0 → v1.1 reconciliation on **2026-08-09**. The exact candidate was independently evaluated (schema-valid, PLAN READY with zero unmet reasons, legal version record, legal delegation) and verified to stay inside that boundary before the approval was bound. Approved-candidate SHA-256: `60be3c833522891b8162ff68c2f4cae7e2d2ccf802266456b3fbb2d5ce7fd11c`. `approvalBinding` is `MANUAL_GOVERNANCE_APPROVAL` with `tamperProof: false` — this is **not** a cryptographic approval and is not represented as one. The only edit made to the record after approval is `repository.planPersistenceCommit`, bound in the immediately following commit under the §17a commit-semantics convention (`null` before persistence, the persisting commit after) — the same two-step used for v1.0 at `de58428` → `6bee874`.

**Limits of the new enforcement, stated rather than assumed away.** The bootstrap security review raised three residuals, all recorded here and none hidden:

- **H1 — completion evidence is writable by the actor it constrains (FIXED, with a stated residual).** Dependency evidence is no longer the word `closed`: a durable phase record now counts only when its final history transition is `-> closed by owner`, which is the only way `transitionPhase` can produce that status. The residual is unchanged from the rest of this programme — anything that can write the record can write a plausible history entry, so this is **not** tamper-proofing and is not claimed as such. ProjectOS governance is `MANUAL_GOVERNANCE_APPROVAL` with `tamperProof: false` throughout; the backstop for a forged record is the owner commit/push gate, where the forgery is a visible diff.
- **M1 — the path check is lexical, not realpath.** A symlink planted **inside** the project could still resolve outside it. `System` exposes no realpath, and the pre-existing default `.projectops/plan.json` has carried the identical exposure since it was introduced, so this is defence-in-depth rather than the boundary itself; planting the symlink already requires local write access. Carried to Phase 17 `PROJECTOS-V3-RELIABILITY-HARDENING1A`.
- **L1 — `closureDelegation` is a RECORD today, not live authorisation.** Nothing in `projectos/core` or `projectos/agent` reads `closureAuthority` or `closureDelegation`; closure is gated solely by role in `core/src/phase.ts`. Wiring the delegation into an actual authorisation decision is **Phase 12** work, and at that point `checkClosureDelegation` becomes the only thing preventing a crafted plan from self-granting closure — it must get a dedicated security re-review then, never be assumed still sufficient.

**What v1.1 does NOT do.** No new numbered phase. No renumbering. No product scope beyond the accepted V3 roadmap. No expansion of protected authority. No production, staging, database, send, payment, provider, credential or installation authority. No historical accepted evidence rewritten. **V3 is not marked complete.** The programme position is unchanged at **16 of 19**, with 12, 17 and 18 OPEN.

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
- V3 numbered: Phase 0, Phase 1, Phase 2, **Phase 13** (`PROJECTOS-V3-DESKTOP-E2E-PROOF1A`, CLOSED 2026-08-04 by ChatGPT technical closure gate; evidence `1fcf416` + `fb203c6` and the `PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A` CLOSED report).
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
>
> **UPDATE 2026-08-08.** The runtime half is now proven — but **on a disposable external repository, not on PolyGo**
> (`PROJECTOS-V3-FINAL-RUNTIME-E2E1A`, CLOSED at `d9035b4`). Phases 14 and 15 are now **CLOSED** (v1.6, §5/§5a) on
> their own completed evidence — installation and baseline reconciliation genuinely happened — with the stated
> limitation that that evidence lives in `polygonia-apres/polygo` and is not resolvable in this repository's history.
> **Phase 16 stays OPEN**: it requires exactly the combination neither proof supplies on its own — the **real
> ProjectOS runtime** driving the **real PolyGo project** through one bounded, non-production governed workflow under
> the existing approval controls (criteria §5b). Nothing here accepts Phase 16, and no PolyGo work is authorised by
> this document.

The commits above belong to the **PolyGo** repository (`polygonia-apres/polygo`), not to this repository. They are recorded here as external accepted evidence and are not resolvable in ProjectOS git history.

**SUPERSEDED (v1.2 owner decision of 2026-08-04, retained):** ~~Phases 14 and 15 are **IMPLEMENTATION ACCEPTED — OPEN**: installation and the manually governed pilot are complete. Phase 16 is **OPEN — PROJECTOS RUNTIME-DRIVEN EXTERNAL E2E REQUIRED**. No numbered phase closure is granted by this decision, and `acceptedPhaseCount` stays 3.~~ **Phases 14 and 15 were CLOSED at v1.6 (2026-08-08).** Phase 16's status is unchanged by that decision.

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

**Programme/local EXECUTION_READY = true. Installation authority = NotAuthorised. Live/production/provider/credential authority = NotAuthorised.**

**SUPERSEDED (v1.1–v1.4 text, retained; the flag then read `EXECUTION_READY` **false**):** ~~**Why `EXECUTION_READY` is still false — the accurate reason.** The outstanding item is the **ProjectOS runtime-driven external-project E2E proof**: ProjectOS itself must drive a small real external-repository phase through its own `install` / `phase` / `report` / `close` workflow. The Windows host proof and the PolyGo governance proof are **not** the missing items — both are delivered.~~ **That prerequisite was delivered and accepted at `d9035b4` (`PROJECTOS-V3-FINAL-RUNTIME-E2E1A`, CLOSED).**

**What programme/local `EXECUTION_READY = true` means — and does not mean.**

It means ProjectOS may perform **governed LOCAL/SYNTHETIC project delivery** using the proven runtime and the existing gates. It is true *because* those gates hold, not in spite of them:

- PLAN READY stays enforced, and `plan-governance-engine.cjs` rejects an implementer identity as plan approver;
- project/repository isolation stays enforced — phase state is cwd-rooted, `install` refuses to overwrite without `--force`, and a phase in one project is invisible from another;
- the implementer cannot approve itself (`approval.ts` requires role `owner` for any gated action) and cannot close itself (`phase.ts` `OWNER_ONLY_TARGETS`) — two independent controls, at the approval layer and at the state machine;
- every owner gate — commit, push, phase closure, deploy, database, external send, payment, secrets — stays in force.

It does **not** grant, and cannot grant: service installation; service start or reconfiguration; ProgramData, ACL or registry mutation; production deployment; production database mutation; real email/SMS; payment or refund; real provider credential use; C4 owner presence; or any protected effect. Those remain controlled by their own gates. This is structural, not merely policy: the delivery runtime's only impure edge is `agent/src/system.ts` `spawnSync`, whose four call sites are three read-only `git` reads and an opt-in `npm run validate`; there is no network call, no environment-variable credential read, and no real `ExecutionProvider` implementation — only `SyntheticExecutionProvider`.

**Do not conflate two different flags.** The Rust `EXECUTION_READY: bool = false` constants in the host crates (`shared-host-runtime`, host-authority, proof-runner) are a **separate per-crate truthfulness pin** governing host/live authority. They remain **false** and are unaffected by this ruling.

## 16. Separate metric model (no merged overall ProjectOS percentage)
- **V3 Phase 0–18 closure:** 16 / 19 — ACCEPTED METRIC (numbered roadmap only). OPEN: 12, 17, 18. History: this section read `3 / 19` until v1.5 corrected a staleness left by the v1.4 Phase 13 closure (→ `4 / 19`); the v1.6 eleven-phase closure moves it to `15 / 19`. The authoritative record is `current-state.acceptedPhaseCount`.
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

**All four steps are now DONE (v1.5, 2026-08-08).** Step 1 at `PROJECTOS-V3-CD-B4-CLOSURE-AUTHORITY-RECORD1A`; step 2 under `PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A`; step 3 CLOSED at `d9035b4`; step 4 ruled and persisted by `PROJECTOS-V3-EXECUTION-READY-RECORD1A`.

## 17b. Current critical path (v1.5, 2026-08-08)

Listing is not implementation authority; each item still needs its own gate.

1. **`PROJECTOS-V3-POLYGO-PILOT1A`** — numbered Phase 16, and the next substantive delivery phase. The **real** ProjectOS runtime against the **real** PolyGo project, one bounded non-production governed workflow under the existing approval controls. Both halves it depends on now exist separately (governance model proven manually on PolyGo; runtime proven on a disposable external repository) — this phase is the join. Criteria §5b.
2. **`PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A`** — numbered Phase 12, definition-of-complete bullet 6. Must connect the Control Centre to the **canonical** runtime (§5c). Criteria §5b.
3. **`PROJECTOS-V3-RELIABILITY-HARDENING1A`** — numbered Phase 17, **after** Phase 16, extending adversarial coverage to `core`/`agent` and the Phase-12 seam. Criteria §5b.
4. **`PROJECTOS-V3-FINAL-E2E-CLOSURE1A`** — numbered Phase 18, the final closure phase. Criteria §5b.
5. Still OPEN and unaffected: `86ae19c` closure, and owner authorisation of the direct `windows-future` dependency for `a43898d` — which must never be inferred.

**These four are the entire remaining numbered roadmap.** Every other phase 0–18 is CLOSED (§5).

RC / final closure still need Tracks B + C + F plus reliability and portability work; none of it is authorised by this crosswalk.

## 18. Next five phases

**SUPERSEDED (v1.0 list, retained) — all five delivered:** ~~1. V3.1 rebaseline persistence — Track A. 2. CD-B4-PRODUCTION-OWNER-PRESENCE-PROVIDER-PREFLIGHT1A. 3. CD-B4-PRODUCTION-ELEVATION-PROVIDER-PREFLIGHT1A. 4. CD-B4-HOST-RUNTIME-AUTHORITY-COMPOSITION preflight. 5. CD-B4-PROTECTED-EFFECT-ADAPTER preflight (first real effect).~~ Delivered at `7cad460`, `86ae19c`, the acquisition/identity chain, the installer composition chain, and `0220048` respectively (§8a). Superseded by §17a.

### 18a. Next critical programme sequence (v1.4, 2026-08-04) — SUPERSEDED by §17b

**SUPERSEDED (v1.5, 2026-08-08), retained for history.** Items 1–3 were delivered by the credential-router track (merged at `87e2475`); item 4 is CLOSED at `d9035b4`; item 5 is this record. The live sequence is §17b, and `current-state.nextRecommendedPhase` now reads `PROJECTOS-V3-POLYGO-PILOT1A`.

Recorded at Phase 13 closure. Listing is not implementation authority; each item still needs its own gate.

1. `PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A` — owner-designated P0: per-session GitHub, Supabase and Vercel
   identity so ProjectOS, BizComply V2, two JD Testing sessions and two PolyGo sessions stop depending on
   machine-global provider state.
2. Project-specific credential-router installations.
3. Six-session isolation proof.
4. `PROJECTOS-V3-FINAL-RUNTIME-E2E1A`.
5. `PROJECTOS-V3-EXECUTION-READY-RULING1A`.

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
- ~~**C2 — `PROJECTOS-V3-FINAL-RUNTIME-E2E1A`** — the ProjectOS runtime itself driving a real external repository through `install` / `phase` / `report` / `close`. Mandatory; gates `EXECUTION_READY`; replaces the superseded Phase 18.~~ **DONE 2026-08-08 — formally CLOSED at accepted commit `d9035b4`.** ProjectOS drove a disposable external Git repository from nothing to a CLOSED phase through its own runtime, every transition recorded in its own phase history with the acting role. The run also found and fixed a real governance defect (`closureAuthorityGate` was defined and risk-rated but had no pattern, so a closure *approval record* classified as ungated; the closure transition itself was never bypassable). This discharged the sole stated `EXECUTION_READY` prerequisite — see §15.
- ~~**C3 — `PROJECTOS-V3-CD-B4-CLOSURE-AUTHORITY-RECONCILE1A`**~~ **DONE 2026-08-04** (read-only 1A, corrected by 1B, persisted by `…-RECORD1A`). Outcome in §8a. **Two items remain OPEN**: `86ae19c` (`CD-B4-PRODUCTION-OWNER-PRESENCE-PROVIDER1A`, approved to push only) and `a43898d` (`CD-B4-WINDOWS-USER-VERIFICATION-ADAPTER1A`, blocked on owner authorisation of the direct `windows-future` dependency — **no such authorisation may be inferred**).
- ~~**C4 — `PROJECTOS-V3-DESKTOP-NATIVE-PROOF1A`** — native desktop-window proof for Phase 13.~~ **DONE 2026-08-04** — delivered under `PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A` (accepted `1fcf416`, `fb203c6`); Phase 13 CLOSED at v1.4. This row was left un-struck at v1.4; corrected at v1.5.
- ~~**C5 — `PROJECTOS-V3-EXECUTION-READY-RULING1A`** — owner ruling, after C2–C4.~~ **DONE 2026-08-08** — ruling made read-only against current source; decisions persisted by `PROJECTOS-V3-EXECUTION-READY-RECORD1A` (this v1.5). Outcome in §15.
- **C6 — Forge / HARDEN** — DEFERRED, non-blocking; native Windows worker proof still NOT RUN (§6a).

## 23. Source references
Approved plan: `docs/architecture/projectos-v3-master-plan.md` (v1.0, `1aa36b9`). State: `projectos/state/projectos-v3.current-state.json`. CD-B4 closures: `knowledge/reports/2026-07-29_ProjectOS_CD-B4-PRODUCTION-CLOSURES-LEDGER1A_CLOSED.md`. Post-`e1749cc` CD-B4 ledger and this reconciliation: `knowledge/reports/2026-08-03_ProjectOS_PROJECTOS-V3-RECORDS-RECONCILE1A_CLOSED.md`. Governance: `docs/Governance/projectos-prompting-and-gate-control-standard.md`.

## 24. Update and supersession rules
This crosswalk is updated only under an owner/ChatGPT governance gate. It never amends the approved plan; a formal plan change requires a separate owner-gated plan v1.1 amendment (Option A) that bumps `planVersion` and `current-state.activePlanVersion` together. Historical phase identifiers are never renumbered. No overall ProjectOS percentage is published until a weighted model is formally approved.
