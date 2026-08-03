# ProjectOS V3.1 Roadmap-Integration & Status Crosswalk

- **Document ID:** PROJECTOS-V3.1-CROSSWALK
- **Version:** 1.1 (records reconciliation, 2026-08-03 — `PROJECTOS-V3-RECORDS-RECONCILE1A`)
- **Owner:** Murad
- **Status:** AUTHORITATIVE CURRENT STATUS CROSSWALK
- **Approved-plan reference:** ProjectOS V3 Master Plan v1.0
- **Approved-plan source commit:** 1aa36b9
- **Crosswalk source baseline:** fdee3d341e0c43ae2d62a256e0b755196599139b
- **Previous baseline (superseded, retained for history):** e1749ccd2ca7a6348c5ece7bc97b18643de4e8ee

> **v1.1 CHANGE NOTE.** Version 1.1 corrects status only. It accepts nothing, closes nothing, and does not amend the approved plan, which remains immutable at v1.0 (`1aa36b9`). Superseded v1.0 content is marked **SUPERSEDED** in place rather than deleted. `EXECUTION_READY` remains **false**.

> **WARNING — NOT A PLAN.** This document is an authoritative current-status and roadmap-integration crosswalk. It does **not** replace, amend or version the approved ProjectOS V3 Master Plan v1.0. The approved plan remains immutable at v1.0 (source commit `1aa36b9`). This crosswalk records status, integrates later workstreams (Forge, HARDEN/real-worker, CD-B4) that are **not** part of the original numbered V3 Phase 0–18 plan, and persists the **APPROVED DIRECTIONAL V3.1 ROADMAP STRUCTURE** (Track A–G). Directional-roadmap approval is **not** implementation authority: no Track C, Track D or other implementation phase is authorised merely because the directional structure is approved.

## 1. Purpose and authority
Reconcile tracked ProjectOS governance evidence with accepted ChatGPT gate decisions through repository HEAD `fdee3d341e0c43ae2d62a256e0b755196599139b` (v1.0 covered through `e1749ccd`), without renumbering history and without publishing a merged overall percentage. It integrates three parallel workstreams: the numbered V3 product plan, Forge, and the CD-B4 host-authority engine.

## 2. Source hierarchy
1. Owner-approved plans / scope / protected-action decisions. 2. Current ChatGPT gate & closure decisions (may be authoritative before a matching repository closure record is persisted). 3. Persisted accepted closure reports. 4. Pushed repository evidence. 5. Tracked current-state / plan-memory. 6. Accepted local evidence. 7. Unaccepted implementation reports. 8. Historical / stale / superseded sources. 9. Claude private memory (never overrides 1–2).

## 3. Original universal programme
Knowledge pack, universal framework, PolyGo install, phase reporter, staging deploy guard, proof factory, staging drift detector, CI governance, multi-project dashboard — **DELIVERED / PUSHED** (ProjectOps tooling set; per-item formal closure via the ProjectOps report set).

~~PolyGo install path is **BLOCKED** (no trust anchor).~~ **SUPERSEDED 2026-08-03** — see §3a.

### 3a. Original build-order status (v1.1, per capability)

| # | Capability | Status | Basis |
|---|---|---|---|
| 1 | Universal framework | **CLOSED** | V1 `PROJECTOPS-UNIVERSAL1A` + V2 closure (§4) |
| 2 | PolyGo installation | **COMPLETED** — repository record previously stale | canonical `.projectops/project-config.json` installed in `polygonia-apres/polygo` at `b6e6993` + `e788d3c6173a7e599aff482328b9b9d2cb7dad74` |
| 3 | Phase reporter | **IMPLEMENTED / AWAITING ACCEPTANCE** | `2026-06-30_ProjectOS_PROJECTOPS-PHASE-REPORTER1A_AWAITING-REVIEW.md`; code in `projectos/scripts/` |
| 4 | Staging deploy guard | **IMPLEMENTED / AWAITING ACCEPTANCE** | `…PROJECTOPS-STAGING-DEPLOY-GUARD1A_AWAITING-REVIEW.md` |
| 5 | Proof factory | **IMPLEMENTED / AWAITING ACCEPTANCE** | `…PROJECTOPS-PROOF-FACTORY1A_AWAITING-REVIEW.md` |
| 6 | Staging drift detector | **IMPLEMENTED / AWAITING ACCEPTANCE** | `…PROJECTOPS-STAGING-DRIFT-DETECTOR1A_AWAITING-REVIEW.md` |
| 7 | CI governance | **IMPLEMENTED / AWAITING ACCEPTANCE** | `…PROJECTOPS-CI-GOVERNANCE1A_AWAITING-REVIEW.md` |
| 8 | Multi-project dashboard | **IMPLEMENTED / AWAITING ACCEPTANCE** | `…PROJECTOPS-MULTI-PROJECT-DASHBOARD1A_AWAITING-REVIEW.md` |

Items 3–8 have carried `AWAITING-REVIEW` reports since 2026-06-30. **They are deliberately NOT promoted to CLOSED here** — code and a report existing is not acceptance. Resolution belongs to `PROJECTOS-V3-ACCEPTANCE-SWEEP1A`, which is a review gate.

## 4. ProjectOS V2
**CLOSED (ACCEPTED)** — `knowledge/reports/2026-07-11_ProjectOS_PROJECTOS-V2-FINAL-CLOSURE-EVIDENCE1A_CLOSED.md` (+ `…SYSTEM-E2E1A_CLOSED`). Kernel, CLI/local agent, worker model, phase runtime, install, approvals, orchestration, bridge daemon, desktop Control Centre, web dashboard, auth, Tauri — accepted under V2 closure.

## 5. Original V3 Phase 0–18 ledger (numbered roadmap — IDs preserved, not renumbered)
| # | Phase ID | Status |
|---|---|---|
| 0 | PROJECTOS-V3-BASELINE-RECONCILE1A | CLOSED AND PUSHED |
| 1 | PROJECTOS-V3-MASTER-PLAN-MEMORY1A | CLOSED AND PUSHED |
| 2 | PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A | CLOSED AND PUSHED |
| 3 | PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A | IMPLEMENTED LOCALLY — AWAITING REVIEW |
| 4 | PROJECTOS-V3-LOCAL-SECRET-BROKER1A | IMPLEMENTED LOCALLY — AWAITING REVIEW |
| 5 | PROJECTOS-V3-SECRET-OPERATION-BROKER1A | IMPLEMENTED LOCALLY — AWAITING REVIEW |
| 6 | PROJECTOS-V3-OWNER-CHAT1A | IMPLEMENTED LOCALLY — AWAITING REVIEW |
| 7 | PROJECTOS-V3-PROJECT-SESSION-LAUNCHER1A | IMPLEMENTED LOCALLY — AWAITING REVIEW |
| 8 | PROJECTOS-V3-CLAUDE-DESKTOP-BRIDGE1A | IMPLEMENTED LOCALLY — AWAITING REVIEW |
| 9 | PROJECTOS-V3-E2E-RUNNER1A | IMPLEMENTED LOCALLY — AWAITING REVIEW |
| 10 | PROJECTOS-V3-APPROVAL-QUEUE1A | PENDING |
| 11 | PROJECTOS-V3-PROVIDER-CONTEXT-GUARDS1A | PENDING |
| 12 | PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A | PARTIAL (UI present) |
| 13 | PROJECTOS-V3-DESKTOP-E2E-PROOF1A | PENDING |
| 14 | PROJECTOS-V3-POLYGO-BASELINE-RECONCILE1A | NO LONGER BLOCKED — AWAITING ACCEPTANCE (was BLOCKED in v1.0; see §12) |
| 15 | PROJECTOS-V3-POLYGO-INSTALL-REENTRY1A | NO LONGER BLOCKED — AWAITING ACCEPTANCE (was BLOCKED in v1.0; see §12) |
| 16 | PROJECTOS-V3-POLYGO-PILOT1A | NO LONGER BLOCKED — AWAITING ACCEPTANCE (was BLOCKED in v1.0; see §12) |
| 17 | PROJECTOS-V3-RELIABILITY-HARDENING1A | PENDING |
| 18 | PROJECTOS-V3-FINAL-E2E-CLOSURE1A | PENDING |

**Numbered V3 closure ratio = 3 / 19** (phases 0, 1, 2 only; applies ONLY to the original numbered V3 roadmap; not product/shipping/CD-B4/Forge). **Unchanged by v1.1** — this reconciliation accepts nothing.

## 6. Forge ledger
- Synthetic/offline F1–F10: **IMPLEMENTED AND PUSHED**.
- Real local application proof: **PARTIAL** (Postgres round-trip done; Docker/Supabase environment-blocked).
- WSL2 real-worker proof: **DONE** (`3b791e7`).
- Native Windows worker proof: **NOT RUN**.
- Formal phase acceptance / programme closure: **NOT VERIFIED**.

**Forge overall = IMPLEMENTED AND PUSHED — FORMAL PROGRAMME CLOSURE NOT VERIFIED.** Forge is NOT formally closed.

## 7. HARDEN and real-worker ledger
HARDEN1A–1E + real-e2e-1B + WSL2 tool-isolation (`0f888f7`, `dabcee5`, `597f4ac`, `005a5a5`, `a9990ed`, `3b791e7`): clone isolation, OS-containment, trusted-workspace-diff, process termination/ownership, sandbox-exec binding, fail-closed disposal. **PUSHED, load-bearing, FORMAL CLOSURE NOT VERIFIED.** Residual: real proof WSL2-only, not native.

## 8. CD-B4 ledger (LATER UNINCORPORATED WORKSTREAM)
Formally CLOSED by gate decision (see §10). Other CD-B4 phases (runtime-instance-authority `85df339`, elevation-fact `fdf0499`, owner-presence-fact `c306c80`, permit→effect-grant `1a716f3`, effect-witness `88a5db0`, repository authority `14ef2ed`, protected-plan/durable-store, service-identity/SCM/IPC/binding chain, host-authority/crypto/DPAPI/ACL foundation) are **IMPLEMENTED AND PUSHED — FORMAL CLOSURE NOT VERIFIED**. CD-B4 is a later workstream requiring roadmap integration; it is **not** an original V3 Phase 0–18 track.

### 8a. Post-`e1749cc` CD-B4 work (added by v1.1 — previously absent from repository records)

Twenty-four commits landed between `e1749ccd` and `fdee3d34`. Two of them (`7cad460`, `cae6a74`) are the governance documents that were themselves recorded; the other **twenty-two had no repository status record at all**. They are now ledgered commit-by-commit in
`knowledge/reports/2026-08-03_ProjectOS_PROJECTOS-V3-RECORDS-RECONCILE1A_CLOSED.md` §A.

Summary of what they delivered, and their status:

| Group | Commits | Delivered | Status |
|---|---|---|---|
| Owner-presence + confirmation UX | `86ae19c`, `87db53b`, `a43898d` | production owner-presence provider; protected-operation confirmation UX; inert Windows owner-verification adapter | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE |
| Capability-acquisition chain | `69ebabf`, `fe8bbab`, `061bb24`, `aa4d499`, `0abf4e8` | Control-Centre window observation bridge; cold-start provider-authority seam; sealed expected-window facts; owner-presence capability bridge; fresh-acquisition confirmation | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE |
| Canonical installation identity | `092fe9d`, `7fa0e13`, `1e9b392`, `13774b5` | canonical identity record writer; installation-id source; canonical installation identity wired; Windows host-authority observer | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE |
| Installer + service runtime | `76d052b`, `39ce5f2`, `5e68016` | elevated identity installation composition; installer readiness; real SCM service runtime | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE |
| **Real installation and live proof** | `0220048` | **ProjectOSHost actually installed and proven on this machine** — first real bounded protected effect | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE |
| Installed-host status workflow | `c213078`, `193bee9`, `bd35e44` | status contract + reader; specific IPC transport; end-to-end Control-Centre display proof; record-file ACL defect fixed | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE |
| Release currentness + reinstall | `0eee58e`, `fdee3d3` | readiness now requires the running image to match the immutable record; clean reinstall so the record describes the running binary | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE |
| Validator hygiene | `1d25cc8` | validators no longer leak temporary Cargo scratch directories | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE |
| Roadmap persistence | `7cad460`, `cae6a74` | v1.0 of this crosswalk; V3.2 AI-provider-independence amendment | RECORDED (governance documents, not implementation phases) |

**None of the above is marked CLOSED.** No explicit closure decision for any of them is persisted in this repository, and per §2 a gate decision may be authoritative before its record exists — but this records phase may not manufacture one. Some of these phases may in fact have received a gate closure that was never persisted; `PROJECTOS-V3-ACCEPTANCE-SWEEP1A` must resolve that. Pushed ≠ accepted.

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
Other CD-B4 phases (§8), **all post-`e1749cc` CD-B4 work (§8a)**, Forge F1–F10 + HARDEN + WSL2, ProjectOps tooling (build-order items 3–8, §3a), V3 numbered phases 3–9 (implemented locally, AWAITING-REVIEW). Acceptance debt at v1.1: **64 reports AWAITING-REVIEW**, 2 AWAITING-CLOSURE, 5 CLOSED.

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

The remaining path is short, and only one item is engineering work:

1. `PROJECTOS-V3-ACCEPTANCE-SWEEP1A` — **review gate, not implementation.** Accept or reject numbered V3 phases 3–9, build-order items 3–8, and the post-`e1749cc` CD-B4 work (§8a) as a governed batch. Nothing is accepted automatically.
2. Owner ruling on `EXECUTION_READY` once (1) and (3) are resolved.
3. `PROJECTOS-V3-FINAL-RUNTIME-E2E1A` (or the existing Phase 18 equivalent) — **the one genuine missing proof**: the actual ProjectOS runtime driving a small real external-repository phase through `install` / `phase` / `report` / `close`. See §12's critical limitation and C2.

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
- **C1 — `PROJECTOS-V3-ACCEPTANCE-SWEEP1A`** (review gate; resolves the 64-report acceptance debt and the §8a statuses).
- **C2 — `PROJECTOS-V3-FINAL-RUNTIME-E2E1A`, or the existing Phase 18 equivalent** — the ProjectOS runtime itself driving a real external repository through `install` / `phase` / `report` / `close`. Mandatory; gates `EXECUTION_READY`.

## 23. Source references
Approved plan: `docs/architecture/projectos-v3-master-plan.md` (v1.0, `1aa36b9`). State: `projectos/state/projectos-v3.current-state.json`. CD-B4 closures: `knowledge/reports/2026-07-29_ProjectOS_CD-B4-PRODUCTION-CLOSURES-LEDGER1A_CLOSED.md`. Post-`e1749cc` CD-B4 ledger and this reconciliation: `knowledge/reports/2026-08-03_ProjectOS_PROJECTOS-V3-RECORDS-RECONCILE1A_CLOSED.md`. Governance: `docs/Governance/projectos-prompting-and-gate-control-standard.md`.

## 24. Update and supersession rules
This crosswalk is updated only under an owner/ChatGPT governance gate. It never amends the approved plan; a formal plan change requires a separate owner-gated plan v1.1 amendment (Option A) that bumps `planVersion` and `current-state.activePlanVersion` together. Historical phase identifiers are never renumbered. No overall ProjectOS percentage is published until a weighted model is formally approved.
