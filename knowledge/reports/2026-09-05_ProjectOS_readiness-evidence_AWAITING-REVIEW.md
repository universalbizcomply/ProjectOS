# readiness-evidence — Evidence Pack

> Status: IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure is owner-gated.

1. **Project:** ProjectOS
2. **Phase:** readiness-evidence (Speed & Reliability plan 1.3, 4 of 4)
3. **Date:** 2026-09-05
4. **Branch / HEAD:** `projectos-post-v3-selfhost-pilot1a`, measured at `ff4190c` from a clean tree.
5. **Files changed:** `projectos/speed/benchmark.cjs` (scorer repair), `projectos/agent/test/speedBenchmarkScorer.test.ts` (new), `docs/speed/readiness-evidence.md` (new — the full measured evidence and verdict).
6. **Summary:** All five timing standards in the approved plan were measured on the reference environment. Four are met. One is missed by 5.3×. The verdict is **NOT READY**, and the deciding reason is not the missed target.

## VERDICT: NOT READY for the Forge autonomy proof

The foundation is fast and it is safe. What it cannot yet do is **detect its own regression**:

- The benchmark judges **2 of the 5** standards. Proof/data-only validation, Doctor and replay have no automated check at all — they were measured by hand, today, once.
- The one scorer that existed **never judged anything**. `benchmarkFailures` read `result.fullRun.misses`; `runBenchmark` returns `result.fullCachedRun.cacheMisses`. The branch never executed. On a 92,849 ms run against a 60,000 ms target it printed its own `FAIL` line and exited 0 with "every target met" — and as a configured check it reported PASS for `validation-cache`, `doctor-preflight` and `gatekeeper-replay`.

An autonomy proof runs unattended. A harness that cannot fail is exactly what lets unattended drift pass unnoticed. That is why this is NOT READY rather than READY-with-a-caveat.

**The verdict starts nothing** — Forge Programme C needs a separate owner programme-transition decision — and authorises no protected action.

## Acceptance criteria

1. **Reference environment and all specified timing targets measured.** Windows 11 10.0.26200, Node 24.14.1, Rust 1.96.1, i5-13420H (12 logical), 15.7 GB, at clean `ff4190c`. All five measured — see table below.
2. **Full uncached validation authoritative; cache failures fall toward validation.** `validate-all` runs every module with no cache: 141/141 PASS. **14/14** induced failure conditions refused to answer from cache. The harness first proved a genuine cache HIT as its baseline and aborts if that fails, so the negatives are not vacuous — on the first attempt it *did* abort, which is how the `coverage:"full"` requirement was found rather than assumed.
3. **Doctor boundaries and replay zero-spend confirmed.** Doctor: mandatory for the three named contexts, advisory elsewhere, five read-only checks in 38 ms, "performed no action and authorised none". Replay: zero spend is structural — its import set is asserted exactly, so no transport, credential or broker is reachable.
4. **A single explicit verdict.** NOT READY, above, with bounded remediation.
5. **Configured suites run and `validate-all` passes.** 141/141 validators; 1869/1869 agent tests; core tests, `agent-typecheck` and `typecheck:tests` all clean.
6. **Verdict authorises nothing.** Stated in the verdict and in the evidence document.

## Measured results

| # | Standard | Target | Measured | |
|---|---|---|---|---|
| 1 | Warm unchanged validation | ≤ 2,000 ms | **55 / 57 / 68 ms** (suite cache hit, 141 modules) | MET |
| 2 | Proof/data-only validation | ≤ 5,000 ms | **26,307 ms** (43 of 141 re-ran) | **NOT MET** |
| 3 | Targeted source validation | ≤ 60,000 ms | **28,950 ms** (12 misses, real 2-file edit) | MET |
| 4 | Doctor | ≤ 10,000 ms | **233 / 251 / 266 ms** wall, 38 ms of checks | MET |
| 5 | Gatekeeper replay | ≤ 2,000 ms, zero spend | **1,213 / 1,213 / 1,247 ms**; 75 ms of tests | MET |

Two measurements are reported in a way that could have been dressed up and was not:

- **Target 1** is met by the *suite-level* short-circuit, which needs a clean tree and unchanged HEAD. A full cached run never reaches zero misses — **11 of 141 validators never cache**, correctly, because their declared input is all of `.projectops`, which changes every governed run — so that path costs **~21.8 s** and is judged against the 60 s target. Reporting only the 55 ms would imply the 21.8 s path does not exist.
- **Target 5** measured via `npx` is 2,320–6,572 ms and would miss. Via the vitest binary directly it is ~1.22 s. The difference is `npx` resolution, which is not replay. The direct figure is used and the method is stated so the choice can be disagreed with.

**Target 2's miss is structural.** A whitespace change to one example file invalidated 43 of 141 validators: 31 declare `projectos/examples`, and the governance group additionally declares `AGENT_SRC` and `CORE_SRC` with the comment "conservative: include all schema + agent/core source". Conservative is right for a cache that must never wrongly skip. Narrowing it is a per-validator correctness exercise — **hardening, which this phase is scoped not to undertake** — so it is named as remediation, not attempted.

## What the phase fixed, because the verdict depended on it

A verdict about timings cannot come from an instrument whose scorer cannot fail. `benchmarkFailures` now reads the names the result actually uses, and treats an **absent or malformed** measurement as a failure rather than a skip: "we did not measure it" and "it met the target" must not share an exit code.

`speedBenchmarkScorer.test.ts` asserts the scorer **refuses** — warm over target, targeted-source over target, which target applies when there are misses, absent sections, malformed sections, and the regression proper: the old `fullRun`/`misses` shape must not be silently accepted. **5 of its 8 tests fail against the pre-fix scorer; 8/8 pass against the fix, in 3 ms.**

This does not weaken the three closed phases. Their validator suites, agent tests, typechecks and reviews were independently recorded and stand. What it removes is any claim that their *timing* was proven — and none of their acceptance criteria depended on it.

## What would make this READY

1. Extend the benchmark to measure **and judge** all five standards; it currently judges two.
2. Resolve target 2 deliberately — narrow the input map, or restate the ≤5 s standard with the owner. Measuring it and leaving it unstated is the only unacceptable option.
3. *(Latent, optional)* `checkValidatorCache(root, name, undefined)` throws, because the guard tests `=== null` but not `undefined`. Unreachable today, since `computeCacheKey` returns null-or-object and is the only key source. Recorded, not patched — a measurement phase should not quietly change what it measures.

7. **Validators:** 141/141 PASS, 0 FAIL, clean tree. Required validator `validate-all` passed.
8. **Secrets used?** No.
9. **Gated actions performed?** None yet — commit and push under the governed loop.
10. **Risks / carry-forward:** provider estimate under-reserve (measured 8.4× and 13.8× last phase); free re-ask unproven; no native producer for `.projectops/closure/<phase>.json`; paid dispatch for a mechanically-decidable stop code; benchmark coverage of 2 of 5 standards; target 2 unmet; latent `undefined` throw in `checkValidatorCache`.
11. **Decision needed:** owner/advisor review + closure. **The NOT READY verdict is itself the deliverable** — the phase asked for an honest verdict, not a favourable one.

## Full evidence
`docs/speed/readiness-evidence.md`

## Final status
**readiness-evidence — AWAITING-REVIEW. Verdict: NOT READY for the Forge autonomy proof.**
