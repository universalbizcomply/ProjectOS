# Forge autonomy-proof readiness — measured evidence and verdict

Produced for phase `readiness-evidence` (Speed & Reliability plan 1.3, phase 4 of 4).

Every number below was measured on the reference machine during this phase. Nothing is inherited
from an earlier run, and nothing is asserted that was not observed — which matters more than usual
here, because the instrument that was supposed to police three of these targets turned out to be
incapable of failing (see *The instrument was broken*, below).

## VERDICT: **NOT READY** for the Forge autonomy proof

Not because the foundation is slow, and not because it is unsafe. Both hold up well. The verdict
turns on a third thing: **the foundation cannot yet detect its own regression.**

- The benchmark judges **2 of the 5** standards in the approved plan. The other three — proof/data-only
  validation, Doctor, and gatekeeper replay — have no automated check at all. They were measured
  today, by hand, once.
- The one scorer that did exist **never judged anything**. `benchmarkFailures` read
  `result.fullRun.misses` while `runBenchmark` returns `result.fullCachedRun.cacheMisses`; the branch
  never executed. It printed its own `FAIL` line on a 92,849ms run against a 60,000ms target and then
  exited 0 with "every target met". As a configured check in the governed loop it reported PASS for
  `validation-cache`, `doctor-preflight` and `gatekeeper-replay`.

An autonomy proof runs unattended. A measurement harness that cannot fail is precisely the failure
mode that lets unattended drift go unnoticed, and it is the reason this verdict is NOT READY rather
than "READY with a caveat". The scorer is now fixed and tested (below); what remains is coverage.

**This verdict starts nothing.** It does not begin Forge Programme C, which requires a separate owner
programme-transition decision, and it authorises no protected action.

## Reference environment

| | |
|---|---|
| commit | `ff4190c872ef` (clean tree) |
| platform | win32 x64 |
| node | v24.14.1 |
| rust | 1.96.1 (31fca3adb 2026-06-26) |
| cargo | 1.96.1 (356927216 2026-06-26) |
| os | Windows_NT 10.0.26200 (Windows 11) |
| cpu | 13th Gen Intel(R) Core(TM) i5-13420H (12 logical) |
| memory | 15.7 GB |
| measured | 2026-09-05 |

## Timing targets

| # | Standard | Target | Measured | Verdict |
|---|---|---|---|---|
| 1 | Warm unchanged validation | ≤ 2,000 ms | **55 / 57 / 68 ms** (suite cache hit, 141 modules) | **MET** |
| 2 | Proof/data-only validation | ≤ 5,000 ms | **26,307 ms** (43 of 141 re-ran) | **NOT MET — 5.3× over** |
| 3 | Targeted ProjectOS source validation | ≤ 60,000 ms | **28,950 ms** (12 misses, after a real 2-file source edit) | **MET** |
| 4 | Doctor | ≤ 10,000 ms | **233 / 251 / 266 ms** wall; 38 ms of checks | **MET** |
| 5 | Gatekeeper replay | ≤ 2,000 ms, zero spend | **1,213 / 1,213 / 1,247 ms**; 75 ms of tests | **MET** |

### How target 1 is actually reached

The 2-second warm path is the **suite-level** cache short-circuit, not the per-validator one. A full
cached run never reaches zero misses: **11 of 141 validators never cache**, and correctly so, because
their declared input is the whole of `.projectops`, which changes on every governed run —

`validate-project-plan`, `validate-current-project-state`, `validate-active-execution-session`,
`validate-plan-ready-gate`, `validate-plan-status`, `validate-plan-version`, `validate-plan-staleness`,
`validate-plan-no-secrets`, `validate-plan-discovery-import`,
`val-projectos-recovery-plan-authority1a`, and `val-projectos-release-workspace-freshness1a`.

So a full cached run costs **~21.8 s** (130 hit / 11 miss) and is measured against the 60 s
targeted-source target, never the 2 s warm one. The 2 s standard is met by `checkSuiteCache`, which
requires a clean tree and an unchanged HEAD and then returns all 141 results without running
anything. Both readings are recorded here because reporting only the 55 ms would imply the 21.8 s
path does not exist.

### Why target 2 misses, and why it is not fixed here

The input map is deliberately conservative. A whitespace-only change to a single example file
invalidated **43 of 141** validators and cost 26.3 s. The blast radius is structural:

| Input path | Validators declaring it |
|---|---|
| `projectos/agent/src` | 79 |
| `projectos/core/src` | 74 |
| `projectos/schemas` | 41 |
| `projectos/examples` | **31** |
| `projectos/templates` | 29 |
| `.projectops` | 10 |

The governance validator group declares `[SCHEMAS, TEMPLATES, EXAMPLES, AGENT_SRC, CORE_SRC]` — its
own comment says "conservative: include all schema + agent/core source". Conservative is the right
default for a cache that must never skip validation wrongly, and narrowing it is a correctness
exercise that must be done validator by validator. **That is hardening, which this phase is
explicitly scoped not to undertake.** It is named as remediation instead.

### On target 5's measurement method

Replay measured via `npx vitest run` takes 2,320–6,572 ms and would miss the target. Run through the
vitest binary directly it takes 1,213–1,247 ms. The difference is `npx` package resolution, which is
not replay. The direct figure is recorded as the result and the method is stated so the reader can
disagree with the choice rather than be led past it.

## Full uncached validation remains authoritative

`validate-all.cjs` runs every registered module with no cache involvement: **141 registered modules,
141 PASS, 0 FAIL**, recorded at subject `484f14e3` from a clean tree, and re-run at `ff4190c8`.
The cache is a separate runner; it never replaces this path, and the phase's required validator
`validate-all` passes.

## Every cache failure mode falls toward running validation

Fourteen conditions were induced deliberately. **14/14 refused to answer from cache**, which makes
the runner execute the validator.

The harness first established a genuine cache **HIT** as its baseline and was written to abort if
that baseline failed — because negative results from a cache that was never answering would be
vacuous. On the first attempt the baseline did fail and the harness stopped, which is how the
`coverage: "full"` requirement was discovered rather than assumed.

| Condition | Result |
|---|---|
| Entry deleted | no cached answer |
| Entry corrupted (unparseable JSON) | no cached answer |
| Entry structurally malformed | no cached answer |
| Cache key mismatch (inputs changed) | no cached answer |
| Validator absent from the input map | no declared inputs, and no cached answer |
| Key `null` / `{}` / `{key:null}` / `{key:""}` | no cached answer |
| Coverage absent / `partial` / `unknown` / `""` | no cached answer |
| Working tree dirty (suite level) | `checkSuiteCache` returns null — measured `hit: false` |
| HEAD drifted from the entry (suite level) | guarded before any result is returned |

Baseline restored and still hitting after the harness ran.

**One latent defect, recorded and not fixed.** `checkValidatorCache(root, name, undefined)` throws a
`TypeError`: the guard tests `keyResult === null` but not `undefined`, so `undefined.coverage` is
evaluated. It is **not reachable today** — `computeCacheKey` returns null or an object and is the only
key source — so it is a robustness note for a future caller, not a live hole. It is not patched
because a measurement phase should not quietly change the thing it is measuring.

## Doctor's boundaries are as specified

Doctor reports them itself, and the run confirms:

- **Mandatory** for `autonomous-execution`, `paid-gatekeeper-dispatch`, `technical-continuation`.
- **Advisory** for browsing, read-only inspection and local preview, which it never blocks.
- Five read-only checks, 38 ms total: git readable, committed record readable, project config
  readable, four configured check commands resolve to real executables, 33 governed record groups
  present.
- "Doctor performed no action and authorised none. It only read."

## Gatekeeper replay spends nothing, structurally

Zero provider spend is a property of what the suite can call, not a promise about behaviour. Its
import set is asserted exactly — `@projectos/core`, `node:fs`, `node:path`, `node:url`, `vitest` — so
no transport, credential or broker is reachable. **51 tests, 75 ms.** The suite also now measures the
gatekeeper contract against the real `ALWAYS_OWNER_ONLY` floor rather than a list it had invented,
which is what makes the replay meaningful rather than merely fast.

## The instrument was broken

`benchmarkFailures` could not fail. The details are in commit `ff4190c`; the consequences for this
verdict are:

1. The `speed-benchmark` check's PASS in `validation-cache`, `doctor-preflight` and
   `gatekeeper-replay` is **not evidence that any timing target held** in those phases. Their other
   evidence — validator suites, agent tests, typechecks, reviews — was independently recorded and is
   unaffected. None of those three phases had an acceptance criterion that depended on the benchmark.
2. Nothing tested the scorer, which is why it rotted silently. `speedBenchmarkScorer.test.ts` now
   asserts that it **refuses**: 8 tests, and 5 of them fail when run against the pre-fix scorer.

## What would make this READY

Bounded and specific. None of it is a programme.

1. **Extend the benchmark to measure and judge all five standards.** It currently measures two. The
   three added must be judged, not merely printed — that is the defect this phase found.
2. **Resolve target 2 one way or the other.** Either narrow the input map so a data-only change stops
   invalidating 43 validators (a per-validator correctness exercise), or agree with the owner that
   the ≤5 s standard should be restated to match what a conservative map can deliver. Measuring it
   and leaving it unstated is the only unacceptable option.
3. *(Optional, latent)* Guard `checkValidatorCache` against an `undefined` key result.

## Suites and validators

| | |
|---|---|
| `validate-all` (required validator) | **141/141 PASS, 0 FAIL** |
| Agent tests | **1869/1869 PASS** |
| Core tests | PASS |
| `agent-typecheck` | PASS |
| `typecheck:tests` | clean |
| Replay | 51 tests, 75 ms, zero spend |

## What this verdict does not do

It does not start Forge Programme C, which requires a separate owner programme-transition decision.
It authorises no protected action: no deployment, database mutation, messaging, payment, credential
creation or disclosure, force push, or merge.
