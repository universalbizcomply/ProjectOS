# PROJECTOS-HOST-REVIEW-PATH1A — Reconciliation Evidence Pack

> Status: AWAITING-CLOSURE. RECONCILIATION ONLY — no implementation, no source. PATH1A closes owner-direct (Murad), after PROJECTOS-HOST-REVIEW-PATH1B and against the same accepted cumulative candidate, as PATH1B criterion 30 and owner gate 13 require. This report closes nothing.

1. **Project:** ProjectOS
2. **Programme:** projectos-autonomous-self-hosting
3. **Phase:** PROJECTOS-HOST-REVIEW-PATH1A (active plan v1.6, `plan-01053932764c573b-68d21d6830c1`)
4. **Status:** AWAITING-CLOSURE
5. **Date:** 2026-09-27
6. **Evidence subject:** `6f9bd06c443c44e5a33af80c85ea94e44c3bc80d` — the same accepted cumulative candidate as PATH1B, which the gatekeeper closed on its delegated basis.
7. **Validator record:** `.projectops/validation/6f9bd06c443c44e5a33af80c85ea94e44c3bc80d.json` (sha256 `728380f1246df77e06149b824c5175a0535796357927ff3a8e3c49e1f3d3894b`).
   - All 7 validators the plan requires for PATH1A PASS by name: val-projectos-host-review-path1a, val-projectoshost-ipc-operation-contract1a, val-windows-local-ipc-capability-b3, val-projectos-gatekeeper-contract1a, val-projectos-closure-transport1a, val-projectos-trust-boundary1a, validate-no-secrets.
8. **Checks at the subject (2026-09-27, configured commands, clean tree):**
   - core-tests 765/765; agent-tests 2182/2182; agent-typecheck exit 0.
   - speed-benchmark was NOT run. The G4-6 benchmark ruling was for PATH1B only and is NOT claimed for PATH1A. PATH1A closes owner-direct, where G4 is not evaluated, so this phase's `checksPass` is left `null` rather than asserted.
9. **Reviews:**
   - The required Claude self-review, ECC CODE and ECC SECURITY reviews ran over the cumulative ancestry that contains all PATH1A code: ECC CODE APPROVE 0/0/0/0; ECC SECURITY APPROVE, 0 CRITICAL/HIGH.
   - The reconciliation itself was independently challenged by reality-checker (advisory). All 15 findings were verified and accepted before the pack below was finalised.
10. **Decisions already taken:**
    - Gatekeeper G1: the reconciliation was ACCEPTED on 2026-09-26.
    - Owner: O1-A and O1-B CONFIRMED; O2 and O3 authorised; ROUTE R1 on 2026-09-27.

The accepted reconciliation pack follows verbatim. Its closing "decision requested" section is kept as the historical request; the decisions above answer it.

---

# PROJECTOS-HOST-REVIEW-PATH1A — RECONCILIATION CLOSURE PACK

**PROJECTOS-HOST-REVIEW-PATH1A · RECONCILED · NO NEW IMPLEMENTATION · AWAITING GATEKEEPER CLOSURE**

| | |
|---|---|
| Project | ProjectOS |
| Programme | projectos-autonomous-self-hosting |
| Plan | v1.6 `plan-01053932764c573b-68d21d6830c1` (PLAN READY) |
| Phase | PROJECTOS-HOST-REVIEW-PATH1A — 31 frozen criteria. The plan record equals the source doc; criteria sha256 `367602ae…89fd`. |
| Status | RECONCILED against the accepted cumulative candidate. The PATH1A record at `6f9bd06` is still `draft` (parked). |
| Accepted cumulative HEAD | `6f9bd06c443c44e5a33af80c85ea94e44c3bc80d` — equals the origin tip (re-verified by `ls-remote`, 15:46 today). Tree clean. |
| Baseline | `87f734e9f95ec9173074ebae693a06a2650473fb` |
| Ancestry | `87f734e → 1a4e56e → b70c529 → 06323cf → 84eb8ea → c30362e → 6f9bd06` |
| Subject | The SAME accepted PATH1B cumulative candidate. No earlier PATH1A-only candidate is used. |

Chain notes:
- Last source commit: `c30362e`.
- `6f9bd06` changes one docs file.
- All PATH1A code first landed in `1a4e56e`, the inherited 76-path candidate (manifest `5d5d35ff…`).

**Result: 28 SATISFIED · 3 SUPERSEDED (in part, each by a ratified PATH1B rule) · 0 NOT APPLICABLE · 0 BLOCKED.**
- Two amendments have no owner-table row. They are listed for explicit owner confirmation (decision item O1) rather than claimed as ratified.
- An independent challenge ran against this pack (see the section at the end). All 15 findings were verified and accepted.

## Criterion-by-criterion reconciliation

Key: **S** = satisfied by the accepted cumulative candidate · **SUP** = superseded in part by an accepted PATH1B rule.
Paths are under `projectos/`. "Pn" = a section of `val-projectos-host-review-path1a`.

| # | Class | Source | Test / evidence | Validator | Commit |
|---|---|---|---|---|---|
| 1 Agent Host gatekeeper + closure review ports | S | `agent/src/loop/hostReviewClient.ts:96` `hostReviewClient(): HostReviewPort & HostClosureReviewPort` | `agent/test/host-review-client.test.ts:124`; `hostReviewPath.e2e.test.ts:68,302` | P5, P7 | 1a4e56e |
| 2 Agent local transport; fails closed without activation/config | S | `transports/hostIpcTransport.ts:48,87` — one fixed endpoint, takes no parameter. `hostReviewComposition.ts:38` absent → `none`; `:41,58` invalid → `refused` | `hostIpcTransport.e2e.test.ts:170,196,222`; `hostReviewPath.e2e.test.ts:195,216,228` | P6, P7 | 1a4e56e |
| 3 run / reconcile / closure wire the client iff activation names it | S | `commands/run.ts:171`; `commands/closure.ts:603`; reconcile goes through `composeGatekeeper` (`run.ts:106`) | `hostReviewPath.e2e.test.ts:183-252,264,302` | P7 | 1a4e56e |
| 4 Host recognises the review op on the existing frame and dispatches to the production responder | S | `host/windows-local-ipc/src/review_exchange.rs:227` `serve_review_request`; `gatekeeper-review-composition/src/review_dispatch.rs:254` `answer_review_request`. Production serving: `service-host/src/serve.rs:385` `serve_resolved_until_stop` (C21) | `review_vectors_tests.rs` (real decoder → `compose_verified` → rung → responder) | P2 (129/44-byte payloads, 512 bound, 10 kinds unchanged), P3 | 1a4e56e, 84eb8ea, c30362e |
| 5 Rung consumes the composed op, invokes the seam, completion only after the seam succeeded | S | `operation_contract/host_composition.rs:989-1037`. `NotDispatched` → release, then Rejected/NotRun. Completion is reported only on `Ok(..)` from `execution.execute(` (`:997`); mint at `:1035` | `host_composition/tests.rs`: `a_successful_execution_completes_and_commits_the_bill` (2273), `a_refusal_before_dispatch_is_not_run_and_releases_the_reservation` (2298), `a_failed_execution_with_an_unknown_bill_retains_the_reservation` (2319), `…known_bill_commits_it` (2338), `a_refused_composition_cannot_reach_the_execution_rung` (2380), `the_dispatch_fact_crosses_the_existing_wire_unchanged` (2403) | O6 Amendment 1 (`val-projectoshost-ipc-operation-contract1a.cjs:1076-1120`) | 1a4e56e |
| 6 Exactly one shipped execution-evidence mint, pinned to its call site | S | `operation_contract.rs:1201` private `from_completed_execution`; the only call is `host_composition.rs:1035`, inside `run_authorised_review` | O6h battery 11/11 (PATH1A record) | O6 Amendment 1 — PASS today; re-ratified by PATH1B gate 2 and table row 1 | 1a4e56e |
| 7 Decision representation sufficient; reviewer choices separate from host facts | S | `gatekeeper-attestation/src/operation.rs:278` `ReviewedDecision` (reviewer choices only); `envelope.rs:152` `DecisionView`; the agent assembles its record from the Host-echoed declared block | `core/test/host-review-path-vectors.test.ts:321,344` — the EXISTING decision and closure checks pass | P4 | 1a4e56e |
| 8 Rung uses facts composition already resolved; no second resolution | S | `host_composition.rs:808` `ReviewSubjectFacts`, carried on the composed op and taken at `:994`. No `ReviewContextPort` exists | `tests.rs:2357` `the_seam_is_handed_the_facts_the_evaluator_compared` | O6 | 1a4e56e (see note ⁸) |
| 9 Attestation serialisation via existing accessors; sealed construction unchanged | **SUP** | Satisfied part: the envelope reads accessors only; the seal is intact (private fields; declaration `operation.rs:319`; sole literal `:908`). Superseded part: the construction CHANGED in attestation revision 2 — `+baseline_commit`, `+evidence_digest`, `cost_micro_usd → admitted_cost_micro_usd` | client matrix `attestation-revision-1` refused; core vectors `:231` | P4, P10 | 1a4e56e, b70c529, 84eb8ea |
| 10 Out-of-band shapes deterministic, bounded, carry no credential / token / raw body / reasoning | S | `envelope.rs:64,90` `deny_unknown_fields`. Bounds: `gatekeeper-attestation/src/lib.rs:62` `MAX_REQUEST_BODY_BYTES` 64 KiB; `:89` `MAX_RESPONSE_RECORD_BYTES` 64 KiB | client matrix `oversized-record`; core vectors `:200` | P4 (response-view field scan); `validate-no-secrets` PASS | 1a4e56e (see note ¹⁰) |
| 11 Response record bound to the wire completion by a digest the agent recomputes | S | `core/src/hostReviewEnvelope.ts:238` refuses when `hostEvidenceRefOf(bytes) !== wire evidenceRef` (the evidence ref is the first 16 bytes of SHA-256 over the record, `host_composition.rs:905-907`) | matrix `tampered-record`, `missing-record`; e2e it.each `:111` | P4 | 1a4e56e |
| 12 Real agent request bytes accepted by the real Host decoder | S | `contracts/host-review-path-vectors.v1.json`, agent half | `review_vectors_tests.rs` | P9 | 1a4e56e, b70c529, 84eb8ea (honest regeneration) |
| 13 Real Host response bytes accepted by the real agent decoder | S | same file, host half | `core/test/host-review-path-vectors.test.ts:169,321,344`; `host-review-client.test.ts:124` | P9 | 1a4e56e, 84eb8ea, c30362e |
| 14 One isolated round trip over the real production transport, run-scoped endpoint, no installed service / production endpoint / ACL change | S | the agent's production transport `hostIpcTransport.ts` (isolated-test factory) | **Primary:** `agent/test/hostIpcTransport.e2e.test.ts:170` — see note ¹⁴. **Supporting:** `host/windows-local-ipc/tests/live_host_review_exchange.rs:141` (always-on: the production endpoint cannot be bound) and `:150,:174` (the elevated owner run, C24, ruled PASS by the gatekeeper) | P1, P6 | 1a4e56e |
| 15 Valid technical review through the actual hybrid turn to continuation | S | production turn path | `hostReviewPath.e2e.test.ts:68` | P7 | 1a4e56e |
| 16 Valid closure review through the actual hybrid closure path | S | production closure path | `hostReviewPath.e2e.test.ts:302` (reaches CLOSED); reconcile `:264` | P7 | 1a4e56e |
| 17 Wrong project / phase / subject / request digest refused by the existing check | S | existing decision check | `hostReviewPath.e2e.test.ts` it.each: `wrong-project`, `wrong-phase`, `wrong-subject`, `wrong-request-digest` (~`:156-181`) | gatekeeper-contract | 1a4e56e |
| 18 Wrong correlation refused | S | the correlation is derived from the request id | matrix `wrong-correlation`; `host-review-client.test.ts:325` | — | 1a4e56e |
| 19 Invalid attestation refused by the existing check | S | existing attestation check | `host-review-client.test.ts:318`; e2e `invalid-attestation`; core vectors `:231` | — | 1a4e56e |
| 20 Malformed / oversize / non-parsing / trailing-data never read as approval | S | `hostReviewEnvelope.ts` reader | matrix `malformed-response`, `oversized-record`, `trailing-data-record`, `tampered-record` → all `PROVIDER_UNAVAILABLE` | — | 1a4e56e |
| 21 Replayed answer refused | S | Host replay store | `host-review-client.test.ts:287` | — | 1a4e56e |
| 22 Absent / unavailable Host fails closed; no secondary route | S | literal dispatch facts in `hostReviewClient.ts` | `hostIpcTransport.e2e.test.ts:196,212`; matrix `absent`, `not-accepting`; e2e asserts `interactiveFiles == []` | P5 | 1a4e56e |
| 23 Reservation follows the dispatch fact; recorded usage never released | S | `agent/src/loop/gatekeeperConfig.ts:875` `settleUnansweredGatekeeperSpend`; `:844` `releaseUndispatchedReservation`; Rust side `host_composition.rs:1020-1030` | `hostReviewSpendSettlement.test.ts:69,77,85,99`; `tests.rs:2438` | P8 | 1a4e56e |
| 24 No activation → refuse before spend admission, no ledger file | S | `hostReviewComposition.ts:38`; `gatekeeperTurn.ts:484-495` | `hostReviewPath.e2e.test.ts:195`; `hybridVerticalSlice.test.ts:510` (that ledger assertion is not among the amended lines) | P7 | 1a4e56e |
| 25 No direct-provider / interactive / self-review fallback | S | `gatekeeperTurn.ts:484-495` (unattended without a Host route → `TRANSPORT_NOT_CONFIGURED`) | e2e legs assert `interactiveFiles == []` with no in-process call | P5 (`:282-310`) | 1a4e56e |
| 26 No unattended provider client, no credential in the agent | S | `gatekeeperTurn.ts:484-495` refuses unattended without a Host route. `:678-691`: with a Host route composed, the answer is `fromHost`, so `submitToOpenAi` is unreachable. `run.ts:187` `unprovisionedResolver` refuses by construction | `hostReviewPath.e2e.test.ts` it.each (no in-process call on any Host behaviour); `hybridVerticalSlice.test.ts:502-512` | P5 (four Host-route files) | 1a4e56e (see note ²⁶) |
| 27 Host provenance distinct from the interactive class | S | `HostIndependentProviderAttestation`; interactive `InteractiveGatekeeperDecision` (`closureTurn.ts:752`) | `hostReviewPath.e2e.test.ts:78,102,276,311-313` | gatekeeper-contract, closure-transport | 1a4e56e |
| 28 No production review-scope authority; live constant false; transport deps / endpoints / bin / unsafe unchanged | **SUP** | Satisfied (see note ²⁸): `lib.rs:928` `LIVE_LOCAL_IPC_AUTHORISED = false`; `unsafe_code = "deny"`; FFI confined to `windows_ffi.rs`; no `[[bin]]`; endpoint count unchanged. Superseded part: the runtime `[dependencies]` list gained exactly one edge, to gatekeeper-attestation, with a sibling scan and a closed list | ipc graphs green at freeze | b3 PASS; P1 PASS | 1a4e56e, 84eb8ea |
| 29 Interactive unchanged; hybrid gatekeeper / closure / reconcile suites pass unmodified | **SUP** | Satisfied: `hybridGatekeeper.test.ts`, `hybridClosureReconcile.test.ts` and `reconciliation.test.ts` have zero diff across `87f734e..6f9bd06` (verified) and were green at freeze. Superseded (1): `hybridVerticalSlice.test.ts` — 2 UNATTENDED assertions changed from `unchanged(w)` to `recordedLocallyNotPublished(w)` (+20/−2, in 1a4e56e); interactive assertions untouched. Superseded (2): EVERY agent git call, interactive included, now resolves hooks beneath the null device, so repository hooks no longer run (a disclosed behaviour change) | agent 2181/2182 at freeze (the 1 = disclosed environmental `checkEnvironmentGitRuntime`) | technical-continuation §13 (interactive, old) + §16 (new) | 1a4e56e |
| 30 Agent typecheck; tests of touched host crates pass | S | 15 host crates touched | See note ³⁰ | — | c30362e |
| 31 No provider call / spend / credential / service start / ACL / production activity | S | boundary statement, PATH1B gate pack; the C24 procedure excludes service start, credential, provider, spend and ACL | — | — | 6f9bd06 |

Notes:
- ⁸ At step 5c (`operation.rs:831-846`), the review operation now derives the Host's own candidate evidence. It binds that evidence back to the composed candidate and baseline, refusing on `EvidenceBindingRefused`. This is new DERIVATION of evidence, not a second resolution of binding facts. Per-exchange re-pinning (84eb8ea) is still one resolution per exchange.
- ¹⁰ Two disclosures:
  - The subject carries a free-text, agent-written `provider_request` field (`envelope.rs:100-102`), bounded at 64 KiB. The P4 scan covers the response views only. "No credential" holds structurally: the agent holds no credential (P5; `unprovisionedResolver`), so it has none to write.
  - The record carries the reviewer's STATED `reason`. "Reasoning" in the criterion means hidden reasoning or chain-of-thought, which the attestation never carries (`operation.rs:314-316`).
- ¹⁴ The primary test uses the real agent transport on a real pipe in the `ProjectOS.Test.` namespace. It touches no installed service, production endpoint or ACL. The server is a separate process that plays back the REAL Rust Host's recorded bytes. That the real Host accepts the agent's real bytes is proven separately (C12). The Rust elevated proof is supporting evidence only: it pairs the proof-only client with an in-process Host, and it needs the ProjectOSHost service principal to be resolvable (installed; never started). The C24 raw output is held by the owner and is not in the repo.
- ²⁶ The agent still contains the pre-existing provider client for other modes (`transports/openaiResponses.ts:341`, `nodeHttpPort.ts:33`), and the unattended composition passes `http: nodeHttpPort()` (`run.ts:188`). Neither is reachable in unattended mode, for the reasons in the Source column.
- ²⁸ "A production build cannot obtain an authority of the review scope" is word-for-word PATH1B criterion B27, which the gatekeeper accepted with PATH1B. It holds under that same reading: the one production mint, `review_exchange.rs:128` `from_owner_programme_delegation`, takes only a sealed `VerifiedOwnerProgrammeDelegation`. That is an owner ECDSA signature ProjectOS cannot produce, and minting it is an owner activation input (PATH1B gate 12). The mint route exists in source because ratified B21 requires activation to need no further source. **The P1 validator amendment that admits this mint (OLD: no production mint → NEW: exactly two constructions, `val-projectos-host-review-path1a.cjs:115-133`) has NO owner-table row. See O1.**
- ³⁰ Freeze runs at c30362e: `typecheck:all` clean, plus windows-local-ipc 369+11+6+39 (fixtures) and 384+11+2+1+6+39 (live), gatekeeper-attestation 73+9, gatekeeper-review-composition green, service-host 29, repository 30+10. Run today because they changed in 84eb8ea with no own-test run recorded after: packaged-runtime-contract 10/10, plan-durable-store 31/31. The remaining crates, last changed in the 1a4e56e bytes, have runs recorded in the progress log on those bytes: host core 111/114, host-authority 45+11+7, host-identity 158, packaged-manifest-generator 36, persistence ok, windows-clock 1, windows-runtime-observation 1/5, windows-service-identity-proof 140 / 144+5+1. host-authority's `test-fixtures` graph has 4 errors, pre-existing at `87f734e` and proven in a throwaway worktree. PATH1B criterion B28 (the same claim) was accepted with PATH1B.

## Superseded rules

| PATH1A rule | Replaced by | Authority |
|---|---|---|
| Owner gate 2: "exactly one amendment … no other pinned invariant changes" | O6h and b3 re-ratified in their own right, plus the PATH1B amendment set | PATH1B gate 3 (explicit supersession text) |
| C9: attestation construction unchanged | Attestation revision 2: binds baseline + evidence digest; the cost is **admitted**, never billed | PATH1B gate 8; criteria B9, B15; table rows 6 and 8; owner material amendment 2026-09-20 (recorded in the progress log, not in the repo) |
| Review subject = agent-written provider request | Host-framed evidence envelope | PATH1B gate 8; B8, B9; table row 6 |
| C28: transport dependency list unchanged | + exactly one runtime edge, to gatekeeper-attestation | PATH1B gate 3; table row 2 |
| Service entry starts the status-only loop | One dispatcher, with the status loop as fallback | C21 ruling; table row 11 (10h H2/H5/H6) |
| C29 (vertical slice): an unattended failed review leaves HEAD at base | A local candidate commit precedes the review; nothing is published | PATH1B gate 5; B12; table row 4 |
| C29 (interactive git behaviour) | Hooks never run for any ProjectOS git call | PATH1B gate 7; B13; table row 5 |
| PATH1A known limit: the Host binds the BASE commit | The reviewed subject is the local candidate commit containing the work | UNIT L; B12, B13 |
| First-incomplete phase selection | One pinned historical→continuation pairing | PATH1B gate 6; B31 |
| PATH1A independently closable | Closes only after PATH1B, on the same accepted candidate, **by the owner** | PATH1B gate 13; B30 |

**Ratification record.** Table rows 1–15 and the per-crossing amendment were ratified in the gatekeeper's owner-delegated ruling of 2026-09-26. That ruling was relayed in session and is recorded in `ProjectOS-candidate-backups\PATH1B-PROGRESS.md` (checkpoint 12:35). It is **not** a committed record; recording it in the closure evidence is recommended.

**Two amendments without a table row** (for O1):
1. The P1 production review-capability mint (G5; OLD→NEW at `val-projectos-host-review-path1a.cjs:115-133`). Its basis is the G1–G5 ruling of 2026-09-20; the implementation is recorded, the ruling text is not in the repo.
2. The `windows-client-admission` feature on the existing identity-proof dependency. Its basis is the ROUTE 1 ruling of 2026-09-20 (progress log). It is pinned by `val-windows-service-identity-proof-3kideb.cjs:142-153`.

The dev-only `serde_json` is outside b3's pinned scope by design (`val-windows-local-ipc-capability-b3.cjs:328`).

## Validators (run this session at 6f9bd06; `run()` called directly)

| Validator | Result |
|---|---|
| PATH1A's 7 required: host-review-path1a, projectoshost-ipc-operation-contract1a, windows-local-ipc-capability-b3, gatekeeper-contract1a, closure-transport1a, trust-boundary1a, validate-no-secrets | **7/7 PASS** |
| val-projectos-work-record-not-authority1a (selection pin §8) | PASS |
| val-projectos-host-review-path1b | PASS |
| val-projectos-v3-active-phase-consistency1a | **FAIL, as disclosed** — `more than one core phase record is in flight (PATH1A=draft, PATH1B=implementing)` |

Also run:
- Agent `loopSelection.test.ts` 27/27 and `currentState.test.ts` 20/20.
- Crates packaged-runtime-contract 10/10 and plan-durable-store 31/31.
- No accepted battery was rerun.

## Two-in-flight resolution

**The existing guard is reused; no second selector.**
- `agent/src/loop/selection.ts:120-134` `applyHistoricalPairing`, inside the one `selectNextPhase`.
- With PATH1B recorded complete, PATH1A under ANY status (none, implementing, rolled_back, draft) → `STOP OWNER_DECISION_REQUIRED … offered only to the governed reconciliation and closure operation`.
- Tests: `loopSelection.test.ts`, "after the continuation is accepted…" and "does not step over…". Pin: §8, PASS; mutation battery 16/16 (PATH1B).

**The PATH1B CLOSED decision is not yet a governed record.**
- At `6f9bd06` (and on origin) the PATH1B record is still `implementing`, and no `.projectops/closure/*HOST-REVIEW*` record exists.
- Until those records are written, selection and the consistency validator both still see PATH1B as running.

**Mechanical proof, all real code, repo untouched:**
- Method: the UNMODIFIED consistency validator ran on isolated scratch mirrors of the accepted records.
- `current-state` was written by the REAL `syncCurrentState` (worktree TS source via `vite-node`, not the stale `dist`).
- git was stubbed, because the scratch copy is not a repository.

| 1A | 1B | activePhase (real sync) | Validator |
|---|---|---|---|
| draft | implementing / validating / evidence / awaiting_review / awaiting_closure | 1B | FAIL two in flight (pre-existing state, all five) |
| draft | closed | null | **FAIL** `activePhase is null but … PATH1A = draft` |
| prompted | awaiting_closure | null | FAIL two in flight |
| prompted / implementing / validating / evidence / awaiting_review / awaiting_closure | closed | 1A | **PASS** (all six) |
| closed | closed | null | PASS |

**Finding (no source change).** The agent (`currentStateStore.ts:105`, `isParkedHistoricalPhase`) treats a parked PATH1A `draft` as not in flight; the validator's `NOT_IN_FLIGHT` counts it. The first passing state is therefore the one where **PATH1B = closed AND PATH1A has left `draft`**.
- **Route:** make PATH1B's `closed` transition and PATH1A's `draft → prompted` part of the SAME commit. Then no committed state shows the new disagreement.
- Before that commit the validator fails as it has since 2026-09-19 (the disclosed state). After it, every state passes.
- Amending the validator was rejected: that would be new hardening and is not needed.

**How PATH1A is walked:**
- There is no dedicated phase-reconciliation command. `projectos reconcile` discharges gatekeeper debt on a degraded work item (`commands/reconcile.ts:1-14`), not a phase.
- The governed operation is therefore the explicit, owner-gated `phase advance` commands plus closure records.
- `phase advance` only saves the record and re-syncs current state (`commands/phase.ts:536-547`: `savePhase` + `syncCurrentState`). It starts no loop, worker or process.
- The core lifecycle has no shortcut (`core/src/phase.ts:16-27`), so PATH1A must pass `prompted → implementing → validating → evidence → awaiting_review → awaiting_closure`. Each transition note must say "reconciliation only — no implementation, no source".

## Boundary

| | |
|---|---|
| Production touched? | NO |
| Provider called? | NO |
| Credentials touched? | NO |
| New implementation? | NO — zero source changes, zero commits, zero records written. Worktree HEAD `6f9bd06`, tree clean before and after every step. |
| Service / ACL / registry / push / merge | none |

## Independent challenge (reality-checker; AMBER; corpus `ad9264e3`; guardrail applied)

- Advisory verdict: **BLOCK** on the first draft.
- All 15 findings were verified against the code and records and **accepted**; this pack incorporates them.
- HIGH:
  - Closure and push had been routed to the gatekeeper, but B30 and owner-only `approve-commit`/`approve-push` say owner.
  - The mint had been superseded on an unratified basis.
  - C26 was citing the wrong evidence.
- MEDIUM:
  - The touched-crate evidence had a gap; closed by running two crates today.
  - The two-in-flight simulation used reasoned `activePhase` values; it now runs the real `syncCurrentState`.
  - Wording and citation fixes to C5, C10, C14 and C29.
  - It found one new real defect (carry-forward 1).
- It also exposed my own counting error: the first draft said 27/4; the table had 28/3.
- The run is logged in `history.tsv`.

## Risks

1. The C24 raw output is owner-held. C14 rests on the agent real-pipe e2e with the playback disclosed.
2. Splitting PATH1B `closed` and PATH1A leaving `draft` across commits produces a new validator FAIL (route above).
3. PATH1A's record will carry `implementing`-labelled transitions. The notes are the mitigation.
4. Two amendments lack a table row (O1). Closing without O1 would leave them ratified only by prose rulings.
5. Delegated G4 needs a subject-bound `validate-all --record-evidence` record, never written by hand. PATH1A's 7 required validators all PASS. `validate-all` still has 2 non-passes unrelated to this phase: desktop-e2e (environmental) and sealed-window facts (pre-existing).

## Carry-forward

1. **NEW (LOW, no behaviour change):** a B15 wording defect in accepted PATH1B source.
   - `host_composition.rs:909` says "What the provider actually billed", and `:920` says "What the provider billed". The settlement's `cost_micro_usd` is fed from `admitted_cost_micro_usd` (`review_execution.rs:213`); only the token counts come from the provider.
   - Fix: a two-line doc-comment correction in an authorised additive commit or a later phase.
2. Consistency validator vs `isParkedHistoricalPhase`: LOW, transient, handled by the sequencing above.
3. Record the 2026-09-26 table ratification, the C24 output and the O1 confirmations in the closure evidence.
4. Existing PATH1B carry-forwards stand: F5 filter TOCTOU; F6 envelope default; packaged-git location pin (table row 14); rotation of the exposed tokens.
5. WORKFORCE1A not started.

## Disk / residue

- C: 63 GB free (GREEN).
- My one generated untracked `plan-durable-store/Cargo.lock` was deleted; the tree is clean.
- Both simulation mirrors deleted themselves.
- Scripts and this pack are in the session scratchpad, with copies in `C:\dev\ProjectOS-candidate-backups\` (tools\ + pack). The worktree and backups are kept as evidence.

## Exact closure decision requested

**Gatekeeper (ChatGPT; `closureDelegation` covers phase-closure, excludes protected actions):**
- **G1.** ACCEPT this reconciliation: 28 S / 3 SUP-in-part / 0 N/A / 0 BLOCKED, evidence subject `6f9bd06`. Make it **conditional** on PATH1B's governed closure record landing in the same commit as, or an earlier commit than, PATH1A's first transition.
- **G2.** Record the PATH1B closure decision under the delegation: `.projectops/closure/decisions/PROJECTOS-HOST-REVIEW-PATH1B.json`, subject `6f9bd06`, basis `--delegated` (no `--as`).
- **G3.** RECOMMEND that the owner close PATH1A.

**Owner (Murad) — B30 and the owner-only actions require these:**
- **O1.** Confirm explicitly the two amendments without a table row: the P1 production review-capability mint and the identity-proof `windows-client-admission` feature edge.
- **O2.** Authorise the closure-record commits on `projectos-run-to-completion-host-attestation1a` on top of `6f9bd06` — records only, no source — in the precedent shape (`74a567f` / `14ccfdc` / `41039d8`):
  1. PATH1B closure evidence + walk to `awaiting_closure`.
  2. The PATH1B decision record (G2).
  3. **One commit:** PATH1B → `closed` AND PATH1A `draft → … → awaiting_closure` + PATH1A closure evidence. Every note says "reconciliation only". This is the first commit where the consistency validator passes.
  4. The PATH1A **owner** decision record (`decidedBy` Murad, `close`, bound to evidence subject `6f9bd06`).
  5. PATH1A → `closed` via `phase advance --to closed --as owner`, with current state re-synced by the commands and never hand-edited.
- **O3.** Authorise or withhold the push of that tail (normal push, no force).

Expected afterwards: `val-projectos-v3-active-phase-consistency1a` PASS; v1.6 at 2/3; next phase PROJECTOS-AGENT-WORKFORCE1A.
**I stop here and am not starting it.**
