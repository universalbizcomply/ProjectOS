# Readiness remediation — the three bounded fixes, and what they measured

Follows the owner's acceptance of the `readiness-evidence` **NOT READY** verdict (Speed & Reliability
plan 1.3, 4 of 4, `466cc2e`). Three bounded remediations were ordered. This records what each one
found, what changed, and what it now measures.

**No programme was started.** No plan phase was created, no protected action was taken, and Forge
remains where the approved sequence leaves it.

## Why the verdict was NOT READY, restated

Not because the foundation was slow. Because it could not detect its own regression: the benchmark
judged 2 of the 5 approved standards, and the one scorer that existed had been proven capable of
reporting PASS while judging nothing at all.

---

## 1. The benchmark now judges all five standards

### What was wrong

`runBenchmark` measured two things — a suite cache-check and one full cached run — and
`benchmarkFailures` judged those two. Proof/data-only validation, Doctor and gatekeeper replay had
**no automated check of any kind**. They were measured by hand, once, on the day the verdict was
written.

### What changed

`projectos/speed/benchmark.cjs` was rewritten around the five approved standards as named entries in
a `standards` section, each carrying its own target, its measurement, its samples and its method.

**Each measurement is taken in its own process.** This is not cosmetic. Measured in-process, back to
back with a warm-up, the data-only scenario reported **23,805 ms**; the identical scenario in a fresh
process reported **under 4,000 ms**. An operator runs validation once, from a fresh process, and that
is what the standards describe.

**Nothing edits the checkout to create a scenario.** Standards 2 and 3 need a changed tree to mean
anything, and the obvious way to get one — touch a file, time the run, revert — mutates a governed
repository in the middle of a measurement. Instead the changed surface is *declared*
(`SURFACES.dataOnly`, `SURFACES.targetedSource`), `validatorsInvalidatedBy` projects it onto the
input map, and the runner is told to refuse the cache for exactly those validators and run them for
real. The timing is of real validator execution, not of a model of it. The new `invalidate` option
can only ever force a run; there is no value of it that turns a miss into a hit.

**Three samples, median judged, every sample recorded.** On this machine, after an hour of sustained
validation, the same scenario reported 3,913 ms and 87,801 ms — a 22× spread from thermal
throttling, with every child process in the slow run about four times slower. A harness that judged
either sample alone would have been confidently wrong in one direction or the other. Best-of-N would
be gaming; the median of three with all three in the result cannot hide a genuine miss, because two
of three samples have to be inside the target, and a reader can see the spread instead of trusting
one number.

### The scorer refuses

`benchmarkFailures` now fails on each of:

| Condition | Why it is a failure and not a skip |
|---|---|
| A standard's section is absent | Nothing measured it, and that is not a pass |
| A section is malformed, or its timing is not a usable number | A coercion here is how the original defect hid |
| The measurement exceeds the target | The obvious one, and the one that never ran before |
| The section carries a *different target* from the approved one | Otherwise a result restates the standard and passes its own exam |
| The judged number is not the median of the samples shown | Otherwise "median of three" is prose in a method string |
| Replay did not prove zero provider spend | Standard 5 is two promises, and a fast replay that called a provider keeps only one |
| A standard was **not measured** | With exactly one enumerated exception, below |

**The one excusable non-measurement, and it is corroborated.** "Warm *unchanged* validation" is a
claim about an unchanged tree; on a dirty tree the scenario does not exist to be measured. That is
the only entry in `EXCUSABLE`, it belongs to one standard, and the scorer checks the claim against
`result.git.clean` — which `runBenchmark` records independently. A result asserting a dirty tree
while recording a clean one is **refused**. A clean tree with no suite entry is *not* excused: that
is the harness failing, not the machine.

### Proof that a deleted rule cannot leave the suite green

`projectos/agent/test/speedBenchmarkScorer.test.ts` — **52 tests**. The organising rule is
independence: every standard gets a test in which it is the *only* thing wrong and the scorer must
produce **exactly one** failure naming it. A scorer that judged the first standard and copied its
verdict onto the rest would pass a test that merely asked "did anything fail"; requiring a failure
count of one, naming the spoiled standard, makes each of the five rules load-bearing. Delete any one
and its row goes red while the other four stay green.

The suite also pins the five names and the five target values, so a sixth standard added to the plan
must be wired rather than assumed, and a softened target is a test failure rather than a quiet
restatement.

---

## 2. The data-only miss: it was not the input map

### What the evidence said, and what was actually true

The accepted evidence recorded 26,307 ms for a data-only change and attributed it to blast radius:
31 validators declare `projectos/examples`, and the governance group also declares agent and core
source, so 43 of 141 re-ran. Narrowing that map was named as the remediation.

**That diagnosis was incomplete, and acting on it alone would have weakened the cache for almost no
gain.** The 43 validators that re-ran account for **7.6 s** of execution. The other ~19 s was the
cache computing its own keys.

Measured on the reference machine:

| | |
|---|---|
| Computing all 141 cache keys | **59,870 ms** |
| Hashing each distinct declared path exactly once | **1,768 ms** |

141 validators declare **15 distinct input paths** between them. `projectos/agent/src` is declared by
79 of them, `projectos/core/src` by 74, `projectos/host` by 49 — and every declaration re-read and
re-hashed the whole tree from scratch. A validator that missed did it twice: once to check the cache,
once to save it. Thirty-four times the work, for identical bytes and identical digests.

### What changed

Three changes, none of which narrows a single declaration:

1. **A per-run hash snapshot** (`beginSnapshot`/`endSnapshot` in `validation-cache.cjs`, opened by the
   cached runner around its sweep). The same directory is hashed once per run instead of once per
   declaration.
2. **A digest per file rather than the bytes**, so a file read for `projectos` is not read again for
   `projectos/agent/src`. The sub-trees together were 578 ms of the 1,768 ms distinct pass.
   `sha256`-of-`sha256` over sorted path/digest pairs is exactly as strong a fingerprint as `sha256`
   over concatenated bytes.
3. **`validate-project-plan` asks git each question once.** Measured: 93 `git` processes, 43 distinct
   invocations, 2,397 ms — the whole of that validator's cost, and the largest single item in a
   data-only run. Every question is about an immutable fact of the object database (does this commit
   exist, is it an ancestor, does that tree contain this path), so two identical invocations inside
   one `run()` cannot disagree. The memo is reset at the top of every `run()`.

### The fail-safe rule is unchanged, and the cache is now *more* coherent

`KNOWN UNCHANGED → cache allowed`, `KNOWN CHANGED → RUN`, `UNKNOWN → RUN` is untouched. No
declaration was narrowed, the input map is byte-for-byte as conservative as it was, and a memoised
digest is the same digest.

The snapshot also removes a real incoherence rather than adding one. Without it a sweep was *already*
non-atomic: the first validator hashed a tree at t=0 and the last hashed it a minute later, so a file
changed in between was half-seen. With it, one run judges one snapshot taken when the run began.

And it fails **toward running**. The saved key is now the digest the validator was judged against
rather than a fresher one computed after it finished — so a tree that moved under a running validator
mismatches next time and the validator runs again. The old behaviour saved the post-run digest, which
would have *hit* next time on the strength of a result produced before the change.

`validate-speed-validation-cache.cjs` gained sections 9–11 asserting exactly this: that the snapshot
changes no digest and does not leak past `endSnapshot`, that an unusable key result is a miss and
never a crash, and that the change projection reaches in both directions.

### The latent defect, closed

`checkValidatorCache(root, name, undefined)` threw a `TypeError` — the guard tested `=== null` but
not `undefined`, so `undefined.coverage` was evaluated. Recorded as latent in the accepted evidence
and deliberately not fixed there, because a measurement phase should not change what it measures.
Fixed here, and asserted for seven unusable shapes: anything unusable is a miss, and a crash is not a
miss because it takes the runner down with it.

### The ≤5 s target was met, not restaged

**No decision is required, and none is requested.** The approved 5,000 ms target is unchanged, and
the benchmark judges the *stricter* of the two readings of "proof/data-only": `.projectops` **plus**
`projectos/examples`, which is the exact surface the accepted evidence measured at 26,307 ms.

Measured after the change: **4,081 ms** (samples 4,081 / 4,219 / 3,960). The narrower reading —
`.projectops` alone, which is what "proof/data" most plainly names — measures ~2,900–3,300 ms. The
stricter one is the one judged.

### The MEDIUM the security review found, and what was done about it

Inside a snapshot the FIRST validator to touch a path fixes that path's digest for every later
validator declaring it. `projectos/agent/src` is declared by 79 of 141, so sharing is the rule — which
means a late validator decides from the tree as an early one saw it, and a file changed in between is
caught by the *next* sweep rather than this one. That needs a writer running concurrently with
validation, which the operating model excludes; it is nonetheless a **wider** window than the
unmemoised code had.

The reviewer's point was not the window but its defence: `validate-no-secrets` — the mechanically
binding secret scanner — was safe only because it *happens* to be first in a hand-maintained array
that another file is "kept in sync" with. First means it is always the memo's producer and never its
consumer, so the snapshot changes nothing at all for it. That was an accident, and nothing asserted it.

A full end-of-sweep verification pass was measured and rejected as disproportionate: re-hashing the
15 distinct paths costs **1,643 / 2,145 / 1,969 ms**, which would have spent the entire remaining
data-only budget defending against a condition the operating model excludes. Instead the ordering is
now a mechanically enforced invariant:

- `cached-runner` opens the snapshot **only** when the secret scanner is the first module, and prints
  a refusal to stderr when it is not — falling back to the old, unmemoised, narrower-window hashing.
  Correctness is unaffected; only speed is.
- `validate-speed-validation-cache` §12 fails if the scanner is not first in either module list.
- A reordering is therefore loud rather than silent: it costs ~58 s a run, which the five timing
  standards fail on immediately.

**Proven, not asserted.** With the scanner moved to position four in a throwaway process: the
validator reported the error, the runner printed its refusal, and validation still returned 141/141.

---

## 3. Paid review of a mechanically decidable stop

### What the overnight evidence showed

Of `$0.740` spent overnight, **`$0.464`** went on two `EFFECTS_NOT_ATTESTED` stops — 63% of the
night, on the one question that had a mechanical answer. Both calls were to the strong tier
(`gpt-5.6-terra`, ~$0.23 each) and one came back, in prose:

> "The bound readiness-evidence run lacks an effects attestation … An absent effects record cannot
> establish that no protected effects occurred."

That is a restatement of what the loop had already established by reading the disk.

### Three defects, not one

**a. The free re-ask existed and could not fire.** `runner.ts` already bought one no-cost re-ask
before consulting a reviewer. It was guarded on `if (!effects.ok)` — and `readEffects` reports a
*corrupt* record as `{ok:false}` but an **absent** one as `{ok:true, value:null}`. So the budget only
ever fired for the shape a real worker almost never produces, while a plainly missing file went
straight past it. Both overnight runs took that path, with the re-ask sitting unreached.

**b. The stop was routed to a reviewer that could not help.** Whether a named local file exists is
not a judgement. `STOP_ROUTES.EFFECTS_NOT_ATTESTED` now has `audience: 'owner'` and
`applicableVerdicts: []`, and `takeGatekeeperTurn` routes before it builds a request — so no request
is made, no ledger entry is written and nothing is spent, structurally rather than by convention.

**c. The worker was never told who runs the checks.** It read a brief naming required validators and
reviews, concluded it had to prove they passed, found it holds no shell grant — the allowlist covers
two record files and nothing else — and ended the attempt asking for an approval nobody was there to
give, having written neither record. ProjectOS had already run every configured check itself and had
the results in the evidence pack.

### What changed

- **The re-ask covers absence.** The same budget, the same bound (one), now reached by the shape that
  actually occurs.
- **The ordering is preserved.** An *unreadable* record is handled where it is read, because nothing
  downstream can read it. An **absent** one is not: it goes on to `decideContinuation`, which raises
  the stop at the point of *certification*, after failing checks and blocking findings have had their
  say. Hoisting the absent case earlier was a regression caught by the existing suite — a run with an
  unresolved HIGH finding and no attestation stopped on the attestation, so the more serious fact,
  and the one with a reviewer who *can* answer it, was never reported.
- **The brief states the verification contract.** `brief.verification.runner` is `'projectos'` and
  `brief.verification.checkIds` lists the project's own configured checks. `runner` is generated, so
  it is exempt from the provenance walk **by exact path** and pinned by equality instead
  (`verificationContractProblems`), including the key set — the same treatment `effectsContract` gets,
  and for the same reason: exempting a subtree without pinning it reopens the free-text channel the
  walk exists to close. `checkIds` is copied from config and is still walked.
- **The worker is told, in the one place sentences are allowed.** A constant in the adapter, alongside
  the two that were already there: ProjectOS runs the checks and judges them; do not run them and do
  not ask for shell approval, because there is no such grant and nothing is waiting to answer.

### Attestation still fails closed — harder than before

The requirement was not weakened. It was **strengthened**: the route now carries *no applicable
verdict at all*, so there is no longer any answer — from any reviewer — that could carry a run past a
missing attestation. Previously `AMENDMENT_REQUIRED` was applicable; now nothing is. A run that will
not attest ends on the owner, having certified nothing.

---

---

## Fresh readiness evidence

### Reference environment

| | |
|---|---|
| platform | win32 x64, Windows_NT 10.0.26200 |
| node | v24.14.1 |
| rust | 1.96.1 (31fca3adb 2026-06-26) |
| cpu | 13th Gen Intel(R) Core(TM) i5-13420H, 12 logical |
| memory | 15.7 GB |
| tree | `2b7ca11` **plus the uncommitted remediation** — see the blocker below |
| measured | 2026-09-05 |

**The measurement environment was shared, and that is recorded rather than hidden.** Four other
interactive sessions were running on this machine during the work. Standalone `doctor` measured
293 ms at one point and 739 ms at another; the same validation scenario measured 3,913 ms and
87,801 ms within a single session. This is why the benchmark now samples three times and records
every sample: the numbers below were taken once the machine was quiet, and their spreads are tight
enough to show it.

### The five standards

| # | Standard | Target | Median | Samples | |
|---|---|---|---|---|---|
| 1 | Warm unchanged validation | ≤ 2,000 ms | — | — | **NOT MEASURED** — working tree not clean |
| 2 | Proof/data-only validation | ≤ 5,000 ms | **4,081 ms** | 4,081 / 4,219 / 3,960 | **MET** (was 26,307 ms) |
| 3 | Targeted source validation | ≤ 60,000 ms | **52,246 ms** | 52,149 / 52,678 / 52,246 | **MET** |
| 4 | Doctor preflight | ≤ 10,000 ms | **274 ms** | 274 / 279 / 239 | **MET** |
| 5 | Gatekeeper replay | ≤ 2,000 ms, zero spend | **1,389 ms** | 1,411 / 1,371 / 1,389 | **MET**, ledger fingerprint unchanged |

**Standard 3 has the least margin: 52.2 s against 60 s, 87% of budget.** A single validator,
`val-projectos-credential-router-adversarial1a`, is ~40 s of it. That is recorded as the margin risk
rather than left for a future run to discover.

### Suites, checks and reviews

| | |
|---|---|
| Agent tests | **1923 / 1923 PASS** (68 files) |
| Core tests | **682 / 682 PASS** (24 files) |
| `agent-typecheck` (`typecheck` + `typecheck:tests`) | clean |
| Scorer regression suite | **52 / 52 PASS** — each standard proven to fail independently |
| Fail-safe cache validator | `validate-speed-validation-cache` **PASS**, §§9–12 added |
| Cached runner | 141 registered modules, **141 PASS, 0 FAIL** |
| `validate-all` (uncached, authoritative) | **141 / 141 PASS, 0 FAIL** — and re-run after the documents themselves were written: `validate-no-secrets`, `validate-report-index`, `validate-report-output`, `validate-report-request`, `validate-phase-reporter` all PASS |
| code-reviewer | **0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW — APPROVE** |
| security-reviewer | **0 CRITICAL / 0 HIGH, 1 MEDIUM — fixed, above** |

### One defect found in this work's own bytes

A **NUL byte** was substituted for a space in an edit to `validate-project-plan.cjs`, in the memo key
expression. The code still behaved correctly — `0x00` is a perfectly good key separator — but it made
the file binary to `git diff` and to `grep`, which is precisely how an unreviewable change gets
reviewed. This is the same silent-corruption class that previously turned a regex `\b` into a literal
`0x08` and left four checks passing while matching nothing.

Found by scanning every changed file for control characters, not by reading. One file affected, now
expressed as `JSON.stringify([...])` so there is no lone separator character to mangle, and all 14
changed files re-scanned clean.

---

## VERDICT: **PROJECTOS READINESS — NOT READY — EXACT REMAINING BLOCKER**

> **Standard 1, warm unchanged validation ≤ 2,000 ms, is unmeasured.** It is measurable only on a
> clean working tree, because "warm *unchanged*" is a claim about an unchanged tree and
> `checkSuiteCache` returns nothing without one. The remediation is uncommitted, so the tree is
> dirty. **Committing it is an owner gate**, and it is the only thing standing between this and a
> READY verdict.

Nothing else is outstanding. Four of five standards are measured and met, every suite is green, both
reviews are clear, and the one MEDIUM raised against this work is fixed and proven.

**This is not an engineering blocker and it is not a request for a decision about the standard.** The
previous measurement of standard 1 was 55 / 57 / 68 ms against a 2,000 ms target, and nothing in this
remediation touches `checkSuiteCache` or the suite entry format. But the entire point of the exercise
is that "we did not measure it" and "it met the target" must never produce the same answer, so it is
reported as unmeasured rather than assumed.

**On the commit, the benchmark is re-run against the clean tree.** If standard 1 measures inside
2,000 ms, the verdict becomes **PROJECTOS READINESS — READY**, with the exact candidate integrity the
gate requires. If it does not, that is a real finding and it will be reported as one.

**The verdict starts nothing.** It does not begin Forge Programme C, and it authorises no protected
action.

---

## Cost estimator — recorded, not fixed here

Provider estimates were observed at **8.4× and 13.8×** below actual billed usage. The owner's
instruction is to record it as a required **Run-to-Completion** safety item rather than expand this
remediation, and its root cause is not coupled to any of the three fixes above. It is therefore
carried forward, not addressed here.

Before long unattended programme execution, Run-to-Completion requires: a reliable-enough reserve
calculation or a conservative bound; a hard actual-spend ceiling; stop-before-overspend behaviour;
and no dependence on a knowingly optimistic estimate.

---

## What this document does not do

It starts no programme, and it does not begin Forge Programme C. It authorises no protected action:
no deployment, database mutation, messaging, payment, credential creation or disclosure, force push,
or merge.
