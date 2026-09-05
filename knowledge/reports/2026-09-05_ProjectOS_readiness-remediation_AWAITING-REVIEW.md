# readiness-remediation — Evidence Pack

> Status: IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure is owner-gated.

1. **Project:** ProjectOS
2. **Work:** the three bounded readiness remediations ordered on the owner's acceptance of the `readiness-evidence` NOT READY verdict. **Not a plan phase and not a programme** — no phase record was created and no plan was amended.
3. **Date:** 2026-09-05
4. **Branch / HEAD:** `projectos-post-v3-selfhost-pilot1a`, measured at `2b7ca11` **plus the uncommitted remediation**.
5. **Files changed (14):** `projectos/speed/{benchmark.cjs, cached-runner.cjs, input-map.cjs, validation-cache.cjs}`, `projectos/validators/{validate-project-plan.cjs, validate-speed-validation-cache.cjs}`, `projectos/agent/src/loop/{brief.ts, runner.ts, gatekeeperRouting.ts, adapters/claudeCodeCli.ts}`, `projectos/agent/test/{speedBenchmarkScorer, loopBrief, loopRunner, loopGatekeeperRouting}.test.ts`. Plus `docs/speed/readiness-remediation.md` (new — the full evidence).
6. **Summary:** All three remediations are complete. Four of the five timing standards are measured and met, including the one that was missed by 5.3×. The fifth cannot be measured on a dirty tree.

## VERDICT: NOT READY — EXACT REMAINING BLOCKER

**Standard 1, warm unchanged validation ≤ 2,000 ms, is unmeasured, because it is measurable only on a clean working tree.** The remediation is uncommitted, so the tree is dirty. Committing it is an owner gate and is the only outstanding item.

Nothing else remains: four of five standards measured and met, every suite green, both reviews clear, and the one MEDIUM raised against this work fixed and proven. The previous measurement of standard 1 was 55–68 ms against a 2,000 ms target and nothing here touches `checkSuiteCache` — but "we did not measure it" and "it met the target" must not produce the same answer, which is the whole point of the exercise, so it is reported as unmeasured rather than assumed.

## The three remediations

**1. The benchmark judges all five standards.** It measured two; proof/data-only, Doctor and replay had no automated check at all. Now each is a named standard carrying its target, samples and method, measured in **its own process** — in-process and back-to-back, the data-only scenario reported 23,805 ms against under 4,000 ms fresh. Scenarios are **declared, never enacted**: the changed surface is projected onto the input map and the cache refused for exactly those validators, so nothing edits a governed checkout mid-measurement. **Three samples, median judged, every sample recorded** — the same scenario measured 3,913 ms and 87,801 ms on this machine within one session. The scorer fails on absence, malformed sections, a self-softened target, a judged number that is not the median of its own samples, non-zero provider spend, and any unmeasured standard bar one enumerated excuse — which is corroborated against independently recorded `git.clean`, so the harness cannot wave itself through. **52 scorer tests**, organised so each standard fails *alone* with exactly one failure naming it: delete any single rule and its row goes red.

**2. The data-only miss was never the input map.** The accepted evidence attributed 26,307 ms to blast radius and named narrowing as the fix. The 43 re-running validators are **7.6 s**; the other ~19 s was the cache computing its own keys. 141 validators declare **15 distinct paths**, `projectos/agent/src` by 79 of them, and every declaration re-hashed the whole tree — **59,870 ms to compute 141 keys against 1,768 ms to hash each distinct path once**. Fixed by a per-run hash snapshot, a digest per file rather than the bytes, and memoising `validate-project-plan`'s git calls (93 processes, 43 distinct, 2,397 ms). **No declaration was narrowed and the fail-safe rule is untouched.** The latent `checkValidatorCache(undefined)` crash recorded in the accepted evidence is closed, asserted for seven unusable shapes.

**3. Paid review of a mechanically decidable stop, three defects.** (a) The free re-ask existed and could not fire: guarded on `!effects.ok`, which is the *corrupt* record, while an *absent* one returns `{ok:true, value:null}` — so the budget never fired for the shape that actually occurs, and both overnight runs went straight past it. (b) The stop was routed to a reviewer that could not help; `EFFECTS_NOT_ATTESTED` is now the owner's with `applicableVerdicts: []`, and `takeGatekeeperTurn` routes before building a request, so nothing is spent structurally. (c) The worker was never told ProjectOS runs the configured checks itself — it asked for shell approval nobody could grant and wrote neither record. The brief now carries a pinned `verification` contract and the adapter a constant clause. **Attestation fails closed harder than before:** no verdict is applicable at all, where `AMENDMENT_REQUIRED` previously was.

## Measured results

| # | Standard | Target | Median | Samples | |
|---|---|---|---|---|---|
| 1 | Warm unchanged validation | ≤ 2,000 ms | — | — | **NOT MEASURED** (tree not clean) |
| 2 | Proof/data-only validation | ≤ 5,000 ms | **4,081 ms** | 4,081 / 4,219 / 3,960 | **MET** (was 26,307 ms) |
| 3 | Targeted source validation | ≤ 60,000 ms | **52,246 ms** | 52,149 / 52,678 / 52,246 | **MET** |
| 4 | Doctor preflight | ≤ 10,000 ms | **274 ms** | 274 / 279 / 239 | **MET** |
| 5 | Gatekeeper replay | ≤ 2,000 ms, zero spend | **1,389 ms** | 1,411 / 1,371 / 1,389 | **MET**, ledger unchanged |

Standard 3 has the least margin — 87% of budget, ~40 s of it one validator — and that is recorded as the margin risk rather than left to be discovered.

## Suites and reviews

| | |
|---|---|
| Agent tests | **1923 / 1923 PASS** (68 files) |
| Core tests | **682 / 682 PASS** (24 files) |
| `agent-typecheck` (`typecheck` + `typecheck:tests`) | clean |
| Scorer regression suite | **52 / 52 PASS** |
| `validate-speed-validation-cache` | **PASS** — §§9–12 added |
| Cached runner | 141 modules, **141 PASS, 0 FAIL** |
| `validate-all` (uncached, authoritative) | **141 / 141 PASS, 0 FAIL** — and re-run after these documents were written: `validate-no-secrets`, `validate-report-index`, `validate-report-output`, `validate-report-request`, `validate-phase-reporter` all PASS |
| code-reviewer | **0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW — APPROVE** |
| security-reviewer | **0 CRITICAL / 0 HIGH, 1 MEDIUM** — fixed |

**The MEDIUM.** The hash snapshot's safety for `validate-no-secrets` rested on it *happening* to be first in a hand-maintained array. A full end-of-sweep verification pass was measured (1,643 / 2,145 / 1,969 ms) and rejected as disproportionate — it would spend the whole remaining data-only budget defending a condition the operating model excludes. Instead the ordering is enforced: the runner opens the snapshot only when the scanner is first and prints a refusal otherwise, falling back to unmemoised hashing; the validator fails if it is not first in either module list. Proven live — with the scanner moved to position four, the validator errored, the runner refused the snapshot, and validation still returned 141/141.

## One defect in this work's own bytes

A **NUL byte** replaced a space in an edit to `validate-project-plan.cjs`. The code behaved correctly, but the file became binary to `git diff` and `grep` — which is how an unreviewable change gets reviewed. Same silent-corruption class as the `\b`-to-`0x08` mangling that once left four checks passing while matching nothing. Found by scanning every changed file for control characters; one file affected, rewritten so there is no lone separator to mangle, all 14 re-scanned clean.

## Measurement environment

Four other interactive sessions were running on this machine during the work. Standalone `doctor` measured 293 ms at one point and 739 ms at another; the same validation scenario measured 3,913 ms and 87,801 ms within one session. This is why the benchmark now samples three times and records every sample. The results above were taken once the machine was quiet, and their spreads show it.

## Cost estimator

Carried forward, not addressed here, per the owner's instruction: provider estimates observed at **8.4× and 13.8×** below actual billed usage. Recorded as a required **Run-to-Completion** safety item — reliable-enough reserve or conservative bound, a hard actual-spend ceiling, stop-before-overspend behaviour, and no dependence on a knowingly optimistic estimate.

## What this does not do

It starts no programme and does not begin Forge Programme C. It authorises no protected action: no deployment, database mutation, messaging, payment, credential creation or disclosure, force push, or merge. No provider call was made during this work; **provider spend for it is $0.00**.
