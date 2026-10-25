# PROJECTOS-HYBRID-CLOSURE-RECONCILE-ROUTING1A — Evidence Pack

> Status: AWAITING-CLOSURE. Lifecycle reconciliation of already-accepted work. No source changed. Closure is decided by the ChatGPT gatekeeper through the interactive closure route and committed by the owner. This report closes nothing.

1. **Project:** ProjectOS
2. **Phase:** PROJECTOS-HYBRID-CLOSURE-RECONCILE-ROUTING1A (active plan v1.4, `plan-ef6f5cdbbcea85d9-25086397bd75`)
3. **Status:** AWAITING-CLOSURE
4. **Date:** 2026-09-12
5. **Branch:** `projectos-run-to-completion-host-attestation1a`
6. **Two commits, kept apart:**
   - **HISTORICAL IMPLEMENTATION COMMIT:** `9b6da53123c7f4b17df30e0d1639da29f60686e8` — `feat(gatekeeper): route closure and reconcile through hybrid gatekeeper` (16 paths, parent `57d7694`, pushed 2026-09-10). The accepted implementation this phase records. Not modified, and not used as the G4 subject.
   - **G4 EVIDENCE SUBJECT:** `dac794c3c404d0c5daafd93f20fcf269c53e2d5b` — the clean, pushed lifecycle commit every validator and check below ran against. Established by the preceding phase and **reused**, not re-minted.
7. **Summary:** `closure request` and `reconcile` obtain their decisions through the hybrid routing landed at `57d7694`: interactive mode relays the ChatGPT gatekeeper's bound decision through the owner via the existing interactive port; unattended mode asks only ProjectOSHost through a port and checks its attestation. No mode falls back to another, and neither command composes the pre-hybrid in-process provider route. That work landed at `9b6da53` while this phase had no governed record, because it was in no approved plan. v1.4 admitted it; this phase walks its record through the lifecycle against evidence that already existed, recorded today and not backdated.

## What was reconciled

The phase record, and nothing else. `projectos phase new --id PROJECTOS-HYBRID-CLOSURE-RECONCILE-ROUTING1A` created it, and `projectos phase advance` walked it draft to prompted to implementing to validating to evidence to awaiting_review to awaiting_closure, one transition per command, no JSON status edited by hand, every timestamp today's. Each transition note preserves the historical implementation commit `9b6da53`.

**No implementation was performed.** `git diff dac794c..HEAD` touches no source path — see below.

## Historical implementation evidence vs current G4 evidence

These are deliberately separate, and the distinction matters for reading everything that follows.

**Historical implementation evidence** is what was true of `9b6da53` when it was accepted on 2026-09-10, plus what was re-proven at that exact commit today:

| Required validator | At `9b6da53` (re-run 2026-09-12, disposable detached worktree) |
|---|---|
| `val-projectos-gate-decision-evidence1a` | **PASS** |
| `val-projectos-gatekeeper-contract1a` | **PASS** |
| `validate-no-secrets` | **PASS** |

The disposable worktree was created with `git worktree add --detach`, verified clean, and removed; the governed tree was verified clean afterwards. No broad `validate-all` was run there — only the three validators the plan requires.

**Current G4 evidence** is bound to the subject `dac794c`, which is the tree actually being closed.

## Why the G4 subject is reused rather than re-established

G4-12 asks one question: is what was verified the thing being closed? Here it demonstrably is, checked mechanically rather than by judgement:

- `git merge-base --is-ancestor dac794c HEAD` — succeeds.
- Every path in `git diff --name-only dac794c..HEAD` is classified a closure tail by the production `isClosureTailPath`, with the active programme's state path supplied from the governed config (`planMemory.currentStatePath`). **Substantive paths changed: 0.**

The changes since the subject are the preceding phase's closure tail (phase records, closure evidence and decisions, the `dac794c` validator record, reports and the report index, the v1.4 current-state) plus this phase's own lifecycle record. No source, validator, schema, plan or authority file among them.

A fresh subject was therefore **not** minted for ceremony. Doing so would have required a commit whose only purpose was to be newer; it would have proven nothing that the check above does not already prove, and G4 is not weakened by declining to perform it.

## Required validators at the G4 subject

`.projectops/validation/dac794c3c404d0c5daafd93f20fcf269c53e2d5b.json` — `validate-all --record-evidence` from a clean tree (`workingTreeCleanAtRunStart: true`): 142 registered modules, 138 PASS, 4 FAIL. sha256 `6ed4ae3b21101ca098607c9cb6b495b7c76aee3ab71b13b51552f7e4382c24dc`, committed at `7e734c922c5d3d75eb5fac2ec727aac9e14ac059`. Reused; not re-run, because the record is bound to the exact subject and no source has changed since.

| Required validator | At subject `dac794c` |
|---|---|
| `val-projectos-gate-decision-evidence1a` | **PASS** |
| `val-projectos-gatekeeper-contract1a` | **PASS** |
| `validate-no-secrets` | **PASS** |

**The aggregate `validate-all` does NOT pass and is not claimed to.** It is not a validator this phase requires. The four FAILs, stated not hidden:

- `validate-desktop-e2e`, `validate-host-identity-boundary`, `val-cd-b4-sealed-expected-window-facts1a` — the accepted baseline carried since `9b6da53`; they reproduce on a clean `57d7694`.
- `val-projectos-v3-active-phase-consistency1a` — failed at that historical run because two phases were then in flight. **It has since cleared**: re-run today it PASSES. The historical validator record is left exactly as written and is **not** rewritten.

## Required checks at the G4 subject (G4-6)

The configured checks are `core-tests`, `agent-tests`, `agent-typecheck` and `speed-benchmark`.

| Check | Result | Provenance |
|---|---|---|
| `core-tests` | **PASS 717/717** | run at this exact subject from a clean tree during the preceding phase; reused — no source changed since |
| `agent-tests` | **PASS 2049/2049** | as above |
| `agent-typecheck` (`npm run typecheck:all`, source + `tsconfig.test.json`) | **PASS** | **re-run today** at the governance head, tree clean before and after |
| `speed-benchmark` | **NOT a G4-6 criterion for this phase** — not run, **not represented as passing** | owner ruling, carried forward from the preceding phase and restated for this one |

`agent-typecheck` was deliberately not reused on trust: it is the check that had been failing since `57d7694` with `TS2554` at `test/hybridVerticalSlice.test.ts:470`, fixed by the owner-approved bounded correction `74be4ea` during the preceding phase. Re-running it is what substantiates the reuse of the other two.

**Performance is a carry-forward, not a pass.** The benchmark was not re-run here. Its last measurement, at `7e734c9` (same source as the subject) after a suite-cache warm-up, exited 1 with 2 of 5 standards missed — `dataOnly` median 7,058ms vs 5,000ms and `gatekeeperReplay` median 2,261ms vs 2,000ms (`warmUnchanged` 55ms, `targetedSource` 54,771ms, `doctor` 346ms met), on a heavily shared machine.

## Reviews

The approved v1.4 plan requires *ECC CODE review (accepted)* and *ECC SECURITY review (accepted)*. Both were run and accepted for the historical implementation `9b6da53` before it landed:

| Review | Verdict | Findings |
|---|---|---|
| ECC CODE | **APPROVE** | 0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW |
| ECC SECURITY | **APPROVE** | 0 CRITICAL / 0 HIGH / 0 MEDIUM / **2 LOW** |

**No machine-readable review artifact exists in this repository for them, none is claimed, and none was manufactured.** This transcription is the record, following the convention the preceding phase used. No new source change was made in this phase, so no new review was owed and none was run. The two LOWs are recorded here rather than rounded to zero; they were accepted at the time and are carried forward unchanged.

Unresolved **CRITICAL: 0**. Unresolved **HIGH: 0**.

## Acceptance criteria (approved plan)

1. **The phase record binds accepted commit `9b6da53`.** Every lifecycle transition note names it; this report and the closure evidence name it as the historical implementation commit.
2. **The required validators pass on that commit.** Re-run 2026-09-12 in a disposable detached worktree at `9b6da53`: all three PASS. They also pass at the G4 subject.
3. **Closure is decided through the interactive gatekeeper route and committed by the owner.** `projectos closure request --id PROJECTOS-HYBRID-CLOSURE-RECONCILE-ROUTING1A --execute` under the committed mode `interactive`; the owner commits the resulting decision.

## Protected effects

**NONE.** No production deployment, no database mutation, no external send, no payment, no credential creation or disclosure, no ProjectOSHost start, no provider call, no spend, no force push, no merge. Git activity was narrow lifecycle commits and fast-forward pushes on `projectos-run-to-completion-host-attestation1a` only. One disposable detached worktree was created at `9b6da53` and removed.

## Risks

1. **Reused check evidence.** `core-tests` and `agent-tests` are cited from runs at the subject rather than re-run today. The mitigation is the mechanical 0-substantive-path proof plus the live re-run of the one check with a failure history. If that proof is ever wrong, these two numbers are the first thing that becomes stale.
2. **Aggregate `validate-all` does not pass** at the subject (138/142). Three baseline FAILs remain unaddressed and are outside this phase.
3. **Performance standards still missed** (`dataOnly`, `gatekeeperReplay`) and unmeasured in this phase.

## Carry-forward

- The three baseline validator FAILs: `validate-desktop-e2e`, `validate-host-identity-boundary`, `val-cd-b4-sealed-expected-window-facts1a`.
- Benchmark misses: `dataOnly` 7,058ms vs 5,000ms; `gatekeeperReplay` 2,261ms vs 2,000ms.
- The LOW fixture-tuple finding from the preceding phase's bounded fix, and the 2 LOWs from this phase's historical ECC SECURITY review.
- **Reporting hygiene (low priority, deliberately not fixed here):** the report-index row for `PROJECTOS-HYBRID-GATEKEEPER-ROUTING1A` still reads AWAITING-CLOSURE although that phase is closed. Correcting it was out of this phase's boundary.

## What this starts

Nothing. No Forge Programme C, no ProjectOSHost, no provider spend, no credential, no production, messaging, payment or database activity.
