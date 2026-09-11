# PROJECTOS-HYBRID-GATEKEEPER-ROUTING1A — Evidence Pack

> Status: AWAITING-CLOSURE. Lifecycle reconciliation of already-accepted work plus one owner-approved, test-only correction. Closure is decided by the ChatGPT gatekeeper through the interactive closure route and committed by the owner. This report closes nothing.

1. **Project:** ProjectOS
2. **Phase:** PROJECTOS-HYBRID-GATEKEEPER-ROUTING1A (active plan v1.4, `plan-ef6f5cdbbcea85d9-25086397bd75`)
3. **Date:** 2026-09-11
4. **Branch:** `projectos-run-to-completion-host-attestation1a`
5. **Three commits, kept apart:**
   - **HISTORICAL IMPLEMENTATION COMMIT:** `57d769433f782a54297a3d4cc7c147c3df5edd93` — `feat(gatekeeper): add hybrid interactive and unattended routing` (15 paths, pushed 2026-09-10). The accepted implementation this phase records. Not modified.
   - **BOUNDED TEST FIX COMMIT:** `74be4eaf90837f3bd3e586576f87943219d4e59e` — `test(agent): fix WorkerAdapter start call in hybrid slice` (1 path, 2 lines, test-only).
   - **CURRENT G4 SUBJECT:** `dac794c3c404d0c5daafd93f20fcf269c53e2d5b` — the clean, pushed lifecycle commit every validator and check below ran against. Every later commit carries closure-tail metadata only.
6. **Summary:** The hybrid gatekeeper routing (one governed loop, interactive or unattended acquisition, mode read from the committed `.projectops/gatekeeper.json`, ProjectOS = interactive) landed at `57d7694` while this phase had no governed record, because it was in no approved plan. v1.4 admitted it; this phase walks its record through the lifecycle against evidence that already existed, recorded today and not backdated.

## Why there is a test fix in a reconciliation phase

Reconciliation found that the configured check `agent-typecheck` (`npm run typecheck:all`, source + `tsconfig.test.json`) FAILED at `57d7694` and at every later commit:

```
test/hybridVerticalSlice.test.ts(470,22): error TS2554: Expected 4 arguments, but got 1.
```

`57d7694` added that file; the error was its own, not pre-existing. Vitest strips types, so the suites stayed green and the earlier reviews did not see it. G4-6 cannot be satisfied truthfully over a failing configured check, so work stopped and the owner approved a bounded, test-only scope amendment (2026-09-11). The phase went `validating -> implementing -> validating` through `phase advance`.

The fix: the fixture's planting worker now forwards the arguments the runner passes (`(...args: Parameters<WorkerAdapter['start']>) => … adapter.start(...args)`) instead of `adapter.start({} as never)`. The delegated fixture worker ignores its arguments, so runtime behaviour is unchanged; one `never` cast is removed, none added. No runtime source, validator, schema, tsconfig or authority file changed.

## Acceptance criteria (approved plan)

1. **The phase record binds accepted commit 57d7694.** Every lifecycle transition note names it; this report and the closure evidence name it as the historical implementation commit.
2. **The required validators pass on that commit.** Re-run 2026-09-11 in a disposable detached worktree at `57d7694`: `val-projectos-gate-decision-evidence1a`, `val-projectos-gatekeeper-contract1a`, `validate-no-secrets` — all PASS. They also pass at the G4 subject (below).
3. **Closure is decided through the interactive gatekeeper route and committed by the owner.** `projectos closure request --id PROJECTOS-HYBRID-GATEKEEPER-ROUTING1A --execute` under committed mode `interactive`; the owner commits the resulting decision.

## Validators at the G4 subject

`.projectops/validation/dac794c3c404d0c5daafd93f20fcf269c53e2d5b.json` — `validate-all --record-evidence` from a clean tree: 142 registered modules, 138 PASS, 4 FAIL, workingTreeCleanAtRunStart true, sha256 `6ed4ae3b21101ca098607c9cb6b495b7c76aee3ab71b13b51552f7e4382c24dc`, committed at `7e734c922c5d3d75eb5fac2ec727aac9e14ac059`. All three validators this phase requires PASS.

FAILs, stated not hidden: `validate-desktop-e2e`, `validate-host-identity-boundary`, `val-cd-b4-sealed-expected-window-facts1a`, `val-projectos-v3-active-phase-consistency1a`. Three are the accepted baseline carried since `9b6da53` (they reproduce on clean `57d7694`). `val-projectos-v3-active-phase-consistency1a` fails because two phases are in flight — this one and `readiness-evidence` (still `awaiting_review` from v1.3); `current-state.activePhase` is null by design in that case. It is not required by this phase, G4 does not evaluate it, and it clears when this phase closes. Resolving `readiness-evidence` is not this phase's business.

## Configured checks at the G4 subject

Run at the G4 subject `dac794c` with the exact commands the project config declares, from a clean tree:

- **core-tests** — PASS, 717/717 (25 files).
- **agent-tests** — PASS, 2049/2049 (73 files).
- **agent-typecheck** (`npm run typecheck:all`: source + tests) — PASS. This is the check that failed before the bounded fix.

**REQUIRED G4-6 CHECKS: PASS.** Gatekeeper ruling (2026-09-11): the speed-benchmark is NOT a required G4-6 check for this phase; G4-6 is satisfied by the required tests/build/typecheck/lint evidence above. `checksPass: true` rests on those three and on nothing else.

**PERFORMANCE BENCHMARK: 2/5 standards missed — disclosed non-blocking carry-forward. It did NOT pass and is not claimed as passing.** `projectos/speed/benchmark.cjs` at `7e734c9` (same source as the subject), clean tree, after a suite-cache warm-up (`node projectos/speed/cached-runner.cjs`), 3 samples each, median judged, exit 1:

| Standard | Target | Median | Samples | Result |
|---|---|---|---|---|
| warmUnchanged | ≤2,000 ms | 55 ms | 55 / 59 / 55 | PASS |
| dataOnly | ≤5,000 ms | 7,058 ms | 7,549 / 7,058 / 5,886 | **MISS** |
| targetedSource | ≤60,000 ms | 54,771 ms | 54,771 / 53,038 / 57,086 | PASS |
| doctor | ≤10,000 ms | 346 ms | 595 / 346 / 304 | PASS |
| gatekeeperReplay | ≤2,000 ms (zero spend) | 2,261 ms | 2,173 / 2,261 / 2,838 | **MISS** (provider ledger unchanged) |

An earlier run the same evening, without the warm-up, reported warmUnchanged not measured (the harness precondition, my omission), dataOnly 6,673 ms MISS and gatekeeperReplay 1,692 ms MET. Classification: ACCEPTABLE PERFORMANCE CARRY-FORWARD, NOT A G4-6 BLOCKER FOR THIS PHASE. Context: the timings were taken on a heavily shared development machine (29 node processes and 4 Claude sessions running, CPU ~57%); dataOnly was already the recorded readiness margin risk (4,425/5,000 ms at `d87bfcd`); no performance implementation change belongs in this reconciliation phase, and none was made. The benchmark was not re-run further in this phase.

## Reviews

- **Historical, accepted (57d7694):** ECC CODE and ECC SECURITY, both 0 CRITICAL / 0 HIGH APPROVE after one fix round; a delta ECC CODE review of the `"mode": "interactive"` amendment, 0/0 APPROVE. The owner-approved v1.4 plan records both as accepted (`requiredReviews`). No machine-readable review artifact exists in the repository for these; none is claimed.
- **New, bounded (74be4ea):** ECC CODE APPROVE — 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW (the planting function is typed with `start`'s tuple while also registered as `rejoin`; pre-existing reuse, no runtime effect because the delegated worker ignores its arguments; left unchanged as outside the approved scope). Proportional security confirmation: CONFIRMED TEST-ONLY — `test/` is excluded from the shipping build, no runtime/validator/schema/config/authority file changed, the test's assertion that a planted request-shaped file is neither reviewed nor committed is intact.

## Effects

No production, deployment, database, external send, payment, provider call, spend, credential, ProjectOSHost start, force push or merge. `projectos/state/projectos-v3.session.json` records every protected effect false.

## Carry-forward

- The three baseline validator FAILs (desktop-e2e, host-identity-boundary, cd-b4-sealed) — accepted before this phase.
- Two phases in flight until this one closes; `readiness-evidence` needs its own closure.
- LOW: `start`/`rejoin` tuple naming in the planting fixture.
- **Performance:** speed-benchmark dataOnly 7,058 ms vs ≤5,000 ms and gatekeeperReplay 2,261 ms vs ≤2,000 ms (medians) — missed, non-blocking for this phase by gatekeeper ruling; no speed phase created here.
- Process: vitest does not type-check; the evidence for `57d7694` and `9b6da53` that said "checks passed" was wrong about `agent-typecheck`.

**Decision needed:** ChatGPT gatekeeper closure decision through the interactive route; owner commit of the decision.
