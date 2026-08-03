# ProjectOS V3 Records Reconciliation — AWAITING-REVIEW

- **Report ID:** PROJECTOS-V3-RECORDS-RECONCILE1A
- **Project:** ProjectOS
- **Date:** 2026-08-03
- **Status:** AWAITING-REVIEW
- **Repository:** `C:\dev\ProjectOS` · branch `projectos-v3`
- **Base HEAD:** `fdee3d341e0c43ae2d62a256e0b755196599139b`
- **Gate:** RECORDS-ONLY — no executable code, no push

> **Purpose.** Bring the committed ProjectOS governance records into agreement with the actual state at
> `fdee3d34`. The records had drifted 24 commits and one complete external pilot behind reality, and the
> drift understated progress: they still asserted that no real Windows activation had occurred and that
> PolyGo Phases 14–16 were blocked. Both assertions were false.
>
> **This phase accepts nothing and closes nothing.** `EXECUTION_READY` remains **false**.

---

## A. Post-`e1749cc` CD-B4 ledger

Twenty-four commits landed between `e1749ccd` (the v1.0 crosswalk baseline) and `fdee3d34`. Two are the
governance documents that were themselves recorded; the remaining twenty-two had **no repository status
record of any kind**. They are ledgered here.

**Status rule applied:** `CLOSED` only where an explicit closure decision is evidenced. No such decision is
persisted in this repository for any commit below, so **none is marked CLOSED**. Per crosswalk §2 a gate
decision can be authoritative before its repository record exists — but a records phase may not manufacture
one, and pushed is not accepted.

| # | Commit | Phase / change | Delivered capability | Status | Evidence |
|---|---|---|---|---|---|
| 1 | `7cad4605849315ede90d91abb07ee2bfd75e55c7` | V3.1 roadmap crosswalk persistence | v1.0 of the status crosswalk | RECORDED (governance doc) | `docs/architecture/projectos-v3.1-crosswalk.md` |
| 2 | `86ae19c2bcb29276142efa8df3fbc4cfd64dc8e4` | CD-B4 production owner-presence provider | sealed capability → move-only grant → `verify_production_owner_presence` | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit + crosswalk §8a |
| 3 | `87db53bec9122a7cdcceb90769a960d674e22b6c` | Control-Centre protected-operation confirmation UX | owner confirmation surface for protected operations | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 4 | `cae6a746205b92eb95adc4fe1fc0dde71e0e2b65` | V3.2 AI provider independence | directional amendment; providers are governed replaceable workers, VS Code optional | RECORDED (governance doc) | `docs/architecture/projectos-v3.2-ai-provider-independence-amendment.md` |
| 5 | `a43898dea72329eafc3d06d6ee60d500168f4415` | Windows user-verification adapter | inert `windows-owner-verification` crate (Model B) | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 6 | `69ebabfb9ede608a782c791a2ae4580423f52ce4` | Control-Centre window observation bridge | module-private mint; window-observation bridge | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 7 | `fe8bbabc6e7fd99ed490b8fdcbfc1cedb2c23262` | Provider-authority seam | tier-0 cold-start capability-acquisition seam | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 8 | `061bb24d42bc076f92e83be33c5dd90c5604ca50` | Sealed expected-window facts | currentness as a mandatory obligation on bridge composition | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 9 | `aa4d499bd798e790a1eb2df553dca7876e72fa70` | Owner-presence capability bridge | full chain to `VerifiedOwnerPresence`; production entry refuses fixture evidence | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 10 | `0abf4e8ce9f3170c4da85b2a0af1e52c3b70d6c9` | Host-authority acquisition fix | `corroborate` confirms a fresh self-acquirer; `confirm` requires an acquired token | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 11 | `1e9b392e48f4ef4ccdf04586bee6b6dee267a792` | Canonical installation identity | versioned record V1 + deterministic digest + read-only symbolic provider | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 12 | `13774b569d934e9c14e553c672b1f0daf35a0699` | Windows host-authority observer | dependency cycle broken; observer reads facts internally | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 13 | `1d25cc8ad3cb4337399547549f9c9272f2a36400` | Validator scratch lifecycle | validators no longer leak temporary Cargo scratch directories | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 14 | `092fe9d6fa705022ea5d4ca0f25152b4b420d266` | Canonical identity record writer | installer-only crate; hard-link publish; canonical codec | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 15 | `7fa0e13d895be84ff814708752cee2e914958bd4` | Installation-id source | CSPRNG relocated to an authority-free leaf; production ID source wired | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 16 | `76d052b8c8175081dca45a6146e5607963a94510` | Elevated installer identity composition | sealed composition crate; identity strictly before service; explicit rollback contract | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 17 | `39ce5f239f298f4d662bb7cf551f4f07c5e48bad` | Installer readiness | trusted read-only Known Folder resolvers; dry run reaches `NotAuthorised` and creates nothing | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 18 | `5e68016e6e705a6ec538a557852e7e9011998c57` | ProjectOSHost service runtime | real SCM service — dispatcher, handler, four states; unsafe confined to `scm.rs` | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 19 | `0220048b099249a840f0b6a23f867f7ffba65b87` | **Local install and live proof** | **the service is really installed and running**; owner-approval-gated live operation capability; three live-exposed defects fixed | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit; §B |
| 20 | `c2130783082d0b09b855a1317109ac34fafd442e` | Installed-host status contract | status contract and reader | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 21 | `193bee91b37411d9aba89107e8c85901b4df28d2` | Installed-host status transport | specific IPC transport for the status payload | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 22 | `bd35e448fd5810fb2f1bc1b5b47a5599d8297780` | Installed-host status workflow proof | end-to-end Control-Centre display proof; record-file ACL defect fixed in the installer | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit; §B |
| 23 | `0eee58e2e501b8d736ccab57ec8bfda64091285b` | Release currentness | readiness requires the running image to match the immutable record | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit |
| 24 | `fdee3d341e0c43ae2d62a256e0b755196599139b` | Current-release reinstall | clean reinstall so the record describes the running binary; record-file ACL applied automatically | IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | commit; §B |

**Carry-forward from this ledger:** some of these phases may have received a gate closure decision that was
never persisted in this repository. `PROJECTOS-V3-ACCEPTANCE-SWEEP1A` must resolve each one explicitly.

---

## B. Windows host — delivered state (fact)

- A real `ProjectOSHost` Windows service is **installed and running** as `NT SERVICE\ProjectOSHost`,
  SID type UNRESTRICTED, `DEMAND_START`.
- It reports **identity = Verified** and **readiness = Ready**; Ready additionally requires that the running
  executable's digest match the `release_manifest_digest` held in the immutable installation record.
- The **Control Centre reads that real status over the accepted named-pipe channel**, and the workflow
  survives service stop and restart. Wrong-kind, malformed and wrong-role probes are refused with no status.

This retires the earlier record's claim that no real activation and no protected effect had occurred.

---

## C. Exact record corrections

| Path | Correction |
|---|---|
| `projectos/state/projectos-v3.current-state.json` | `currentHead` and `currentRemoteHead` `e1749ccd` → `fdee3d34`; `nextRecommendedPhase` `CD-B4-WINDOWS-USER-VERIFICATION-ADAPTER-PREFLIGHT1A` (delivered at `a43898d`) → `PROJECTOS-V3-ACCEPTANCE-SWEEP1A`; `blockedPhases` emptied, the three PolyGo phases moved to `pendingPhases`; `currentBlockers` replaced with the runtime-E2E blocker and the acceptance debt; the stale `EXECUTION_READY` carry-forward given its accurate remaining reason; delivered host state, the §A ledger pointer, the PolyGo supersession and the reconciliation fact appended to `acceptedCarryForward`; `lastEvidenceReference` and `lastUpdated` refreshed |
| `docs/architecture/projectos-v3.1-crosswalk.md` | version 1.0 → 1.1 with change note; baseline → `fdee3d34` (previous retained); new §3a build-order status; §5 rows 14–16 no longer BLOCKED; new §8a post-`e1749cc` ledger and §8b delivered host state; §11 acceptance debt quantified; §12 rewritten with the PolyGo evidence and the runtime-vs-governance limitation; §15, §17, §18, §19, §22 corrected with v1.0 text retained and struck as SUPERSEDED; new §17a critical path; §23 reference added |
| `knowledge/reports/2026-08-03_ProjectOS_PROJECTOS-V3-RECORDS-RECONCILE1A_AWAITING-REVIEW.md` | this report (new) |
| `knowledge/ProjectOS Reports Index.md` | one row, existing convention |

**No other path is touched.** No TypeScript, JavaScript or Rust; no schema, validator, script, package file or
lockfile; no Windows service state; no `ProjectOSHost`; no Control Centre; no PolyGo.

---

## D. Statuses promoted, and why

| Item | From | To | Why |
|---|---|---|---|
| Windows host activation | "no production activation; no real effect" | delivered, installed, running, live-proven | direct live observation recorded at `0220048`, `bd35e44`, `fdee3d3` |
| PolyGo installation (build-order 2) | BLOCKED (no trust anchor) | COMPLETED | canonical `.projectops/project-config.json` at `b6e6993` + `e788d3c` |
| V3 Phases 14–16 | BLOCKED | NO LONGER BLOCKED — AWAITING ACCEPTANCE | the stated blocker no longer exists; acceptance is a separate gate |
| Post-`e1749cc` CD-B4 work | absent from records | ledgered as IMPLEMENTED AND PUSHED / AWAITING ACCEPTANCE | §A |
| Crosswalk §17/§18/§19 next-phase lists | live plan | SUPERSEDED, retained | every listed item is delivered |

## E. Statuses deliberately NOT promoted

- **Nothing was promoted to CLOSED.** Not one of the twenty-four commits, and not one of the 64
  `AWAITING-REVIEW` reports.
- **Build-order items 3–8** (phase reporter, staging deploy guard, proof factory, staging drift detector,
  CI governance, multi-project dashboard) stay **IMPLEMENTED / AWAITING ACCEPTANCE**. Code plus a report is
  not acceptance.
- **Numbered V3 phases 3–9** stay AWAITING-REVIEW; **10, 11, 13, 17, 18** stay PENDING; **12** stays PARTIAL.
- **Phases 14–16** were unblocked, not accepted.
- **`acceptedPhaseCount` stays 3**, `totalPhaseCount` 19, ratio **3 / 19**, completion 15.8% — untouched.
- **Forge** stays IMPLEMENTED AND PUSHED — FORMAL CLOSURE NOT VERIFIED; native Windows worker proof NOT RUN.

## F. `EXECUTION_READY`

**Remains `false`.** Installation authority remains `NotAuthorised`.

The accurate remaining reason, recorded in both corrected records: **the ProjectOS runtime-driven
external-project E2E proof is outstanding.** ProjectOS itself must drive a small real external-repository
phase through its own `install` / `phase` / `report` / `close` workflow.

The Windows host proof and the PolyGo governance proof are **not** the missing items. Both are delivered.
The PolyGo pilot was executed manually — hand-written manifest, hand-run validators, hand-authored evidence
pack — and `projectos/agent`'s commands were never invoked, so it proves the governance **model**, not the
**runtime**.

## G. Acceptance debt

64 reports `AWAITING-REVIEW`, 2 `AWAITING-CLOSURE`, 5 `CLOSED`. This phase changes none of those counts.
`PROJECTOS-V3-ACCEPTANCE-SWEEP1A` is approved as a **review gate only** and must decide each item explicitly.

## H. Validation

- `npm run validate:v3plan` — **8/8 PASS** (project-plan, current-project-state, active-execution-session,
  plan-ready-gate, plan-status, plan-version, plan-staleness, plan-no-secrets); same 8/8 before the edits.
- `npm run validate:secrets` — PASS.
- `npm run report:status` / report-index validators — PASS.
- Every ProjectOS commit cited above exists in `projectos-v3` history (verified with `git cat-file -e`).
  The four PolyGo commits are external accepted evidence and are explicitly labelled as belonging to
  `polygonia-apres/polygo`, not to this repository.
- `git diff --check` — clean. No executable, schema, validator, script, package or lockfile path changed.

## I. Safety ledger

| Action | Taken |
|---|---|
| Executable code changed | NO |
| Schema / validator / script changed | NO |
| Package or lockfile changed | NO |
| Windows service or `ProjectOSHost` touched | NO |
| Control Centre touched | NO |
| PolyGo accessed or modified | NO |
| `EXECUTION_READY` activated | NO |
| Reports accepted or phases closed | NO |
| Push / tag / amend / rebase | NO |
| Global GitHub account changed | NO |

## J. Carry-forward

- **C1 — `PROJECTOS-V3-ACCEPTANCE-SWEEP1A`** (review gate).
- **C2 — `PROJECTOS-V3-FINAL-RUNTIME-E2E1A`**, or the existing Phase 18 equivalent: the actual ProjectOS
  runtime against a real external repository. Mandatory; gates `EXECUTION_READY`.
