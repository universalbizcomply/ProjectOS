# readiness-evidence — Owner-Direct Closure Evidence

> Status: AWAITING-CLOSURE. Owner-direct closure approved by Murad on 2026-09-11. This is not a G4 delegated closure: `phase advance --to closed --as owner` does not evaluate G4, and G4-17 is NOT satisfied and is not claimed. This report closes nothing.

1. **Project:** ProjectOS
2. **Phase:** readiness-evidence (active plan v1.4, `plan-ef6f5cdbbcea85d9-25086397bd75`; carried unchanged from Speed & Reliability v1.3)
3. **Date:** 2026-09-11
4. **Branch:** `projectos-run-to-completion-host-attestation1a`
5. **Evidence subject:** `d87bfcd0f10bac3ab118025e663e162d0e1c7b62`, where the READY verdict was measured on a clean tree.
6. **Closure evidence:** `.projectops/closure/readiness-evidence.json`
7. **Summary:** The owner accepts PROJECTOS readiness as **READY** at `d87bfcd`, for the Forge autonomy proof only. The earlier NOT READY verdict stays in the record as superseded history. The current 139/142 validation state, the 11 September benchmark misses, and carry-forward items A, B and C are disclosed. None of them is represented as passing current-head readiness.

## Verdict history

| Order | Verdict | Where | Source |
|---|---|---|---|
| 1 | **NOT READY** (superseded) | measured at `ff4190c`, recorded at `466cc2e` | `docs/speed/readiness-evidence.md`, `reports/2026-09-05_ProjectOS_readiness-evidence_AWAITING-REVIEW.md` |
| 2 | **READY** | `d87bfcd`, clean tree | `docs/speed/readiness-remediation.md`, `reports/2026-09-05_ProjectOS_readiness-remediation_AWAITING-REVIEW.md` (gate acceptance recorded as prose in `f59b5d7`) |
| 3 | **READY accepted by the owner** | subject `d87bfcd` | owner decision `.projectops/closure/decisions/readiness-evidence.json` |

NOT READY turned on the instrument, not on speed: the benchmark judged 2 of 5 standards and its scorer never judged anything. The three bounded remediations fixed that at `d87bfcd`.

## The five standards at the subject `d87bfcd`

Clean tree, median of 3, every sample recorded. Benchmark exit 0.

| Standard | Target | Samples | Median | |
|---|---|---|---|---|
| Warm unchanged validation | ≤ 2,000 ms | 65 / 75 / 70 | 70 ms | MET |
| Proof/data-only validation | ≤ 5,000 ms | 4,391 / 4,425 / **5,340** | 4,425 ms | MET, with one sample over |
| Targeted source validation | ≤ 60,000 ms | 55,257 / 53,135 / 54,041 | 54,041 ms | MET |
| Doctor preflight | ≤ 10,000 ms | 226 / 200 / 208 | 208 ms | MET |
| Gatekeeper replay | ≤ 2,000 ms, zero spend | 7,635 / 1,194 / 1,158 | 1,194 ms | MET, ledger unchanged |

## Acceptance criteria (approved plan)

1. **Reference environment and all timing targets measured.** Win 11 10.0.26200, Node 24.14.1, Rust 1.96.1, i5-13420H, 15.7 GB. All five were measured at `ff4190c` and again at `d87bfcd`.
2. **Uncached validation stays authoritative; cache failures fall toward running.** 14/14 induced failure modes refused to answer from cache, against a proven HIT baseline. `validate-speed-validation-cache` §§9–12 were added at `d87bfcd`.
3. **Doctor boundaries and replay zero spend.** Confirmed. Replay's import set is asserted exactly.
4. **A single explicit verdict.** READY at `d87bfcd`. NOT READY is superseded history.
5. **Configured suites run and `validate-all` passes.** Historically met at the subject: the documents record `validate-all` uncached 141/141, agent 1923/1923, core 682/682 and typechecks clean. There is **no subject-bound validator-run record** for `d87bfcd`, so the closure evidence records `validatorsPass: null` and `checksPass: null`. It does not record true. **At the current head this criterion is not met** (see below). The owner accepted this for closure.
6. **The verdict starts nothing.** Stated here and in the owner decision.

## Current head — disclosed, not represented as passing

At `108914b` the aggregate `validate-all` FAILS, **139/142**. The figure is derived from the subject-bound record at `dac794c` (138/142) plus the four failing modules re-run individually at `108914b` on 2026-09-11. A full `validate-all` was not run at `108914b`.

- `val-projectos-v3-active-phase-consistency1a`: now PASS, because the hybrid phase closed.
- `validate-desktop-e2e`: FAIL. No `projectos/control-center/dist/assets` build (environmental).
- `validate-host-identity-boundary`: FAIL. `installation_programme.rs` is not in the approved 21-file inventory, and there are GitHub-route findings in it and in `tests.rs` (source).
- `val-cd-b4-sealed-expected-window-facts1a`: FAIL. Public `fn session_digest` in `ipc_session.rs` (source).

Because G4-17 has no owner-acceptance path, a delegated G4 closure could not pass this phase's `validate-all` requirement today. That is why the closure is owner-direct.

## Later benchmark — disclosed, not substituted

On 2026-09-11, during PROJECTOS-HYBRID-GATEKEEPER-ROUTING1A at `7e734c9`, on a heavily shared machine:

- dataOnly: median **7,058 ms** vs ≤ 5,000 (7,549 / 7,058 / 5,886). **MISS.**
- gatekeeperReplay: median **2,261 ms** vs ≤ 2,000 (2,173 / 2,261 / 2,838). **MISS.**
- warm 55 ms, targeted 54,771 ms and Doctor 346 ms were met.

This is a different subject from `d87bfcd`: 162 non-docs paths have changed since, 2 lines of them speed code. The environment was contaminated. It is newer advisory evidence, not current-head readiness, and it is not represented as passing.

## Reviews

- **Independent validation and benchmark evidence review:** 7 findings, all resolved (`.projectops/execution/readiness-evidence-466cc2e6dede-c15efb5c.findings.json`). ChatGPT `GKDEC-GKREQ-ca1337d60e14564c13d6a839` recorded the technical checks complete. At `d87bfcd`: ECC code review 0/0/0/0 APPROVE; security review 0 CRITICAL / 0 HIGH, with one MEDIUM fixed.
- **Owner review of the evidence and verdict:** Murad, 2026-09-11. Accepts READY at `d87bfcd`.

## Effects

No production, deployment, database, external send, payment, provider call, spend, credential, ProjectOSHost start, force push or merge. `.projectops/execution/readiness-evidence-466cc2e6dede-c15efb5c.effects.json` records every protected effect false.

## Carry-forward

- **A. Data-only margin:** 4,425 / 5,000 ms, with one sample at 5,340 ms.
- **B. Targeted-source margin:** 54,041 / 60,000 ms. `val-projectos-credential-router-adversarial1a` is about 40 s of it.
- **C. Provider cost estimator:** under-reserved actual billed usage by about 8.4× and 13.8×. This is a REQUIRED gate on Run-to-Completion.
- The three baseline validator FAILs above (current head 139/142).
- The 2026-09-11 benchmark misses (dataOnly, gatekeeperReplay).

## Closure decision

Owner-direct closure by Murad, bound to evidence subject `d87bfcd`. It does not start Forge Programme C (which needs a separate owner programme-transition decision), Hybrid Phase 2, ProjectOSHost, provider spend, credentials, production, messaging, payments or database activity.

## Final status

**readiness-evidence — AWAITING-CLOSURE — owner-direct, subject `d87bfcd`, verdict READY.**

**Decision needed:** none further. The owner decision is recorded, and closure follows through `phase advance --to closed --as owner`.
