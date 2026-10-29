# PROJECTOS-KERNEL-TRUTH1A — evidence

**Phase:** PROJECTOS-KERNEL-TRUTH1A, plan v1.18 (Stage 1, item 1.5): five truth fixes carried from plan v1.15.
**Branch:** `projectos-kernel-truth1a`, from `d77f20a` (the platform stop). Implementation `ae4f54c`.
**Route:** Claude (lead) implemented it directly in its own worktree. It was not dispatched to a governed
worker, and this document claims no gatekeeper ruling and no closure.

The grant was the phase's writePaths, narrowed to `projectos/agent/src/loop/`,
`projectos/agent/src/commands/run.ts`, `projectos/agent/test/`, this validator and this file. Two of the five
items reach code outside that grant. What was done inside it, and what is left, is stated per item.

## The five items

| # | Item (finding) | What changed | Test | Rule and named mutation(s) |
|---|---|---|---|---|
| 1 | Run-loop stop wording (EXTERNAL-PROOF3A) | `mayContinueAfter` (`loop/programmeContinuation.ts`) no longer says "closure is never continued through" for a phase awaiting closure. It now says the loop does not close the phase itself, the next step is the closure route, and that route's gates decide whether closure carries on or stops for the owner. This is true whether `run --continue` then closes the phase, stops, or (dry run) only names the step | `programmeContinuation.test.ts` "awaiting_closure says the closure route decides what happens next, and never that closure is not continued through" | TR-1: `awaiting-closure-denies-continuation` (restores the old sentence) |
| 2 | Broker provenance (D9) | **Run-loop route, done.** `takeGatekeeperTurn` (`loop/gatekeeperTurn.ts`) records which route answered (`viaBroker`) where the call is made. A broker answer is stamped `InstallationBrokerProviderAnswer` with the provider's response id, instead of carrying no stamp. `recordGatekeeperDecisionEvidence` (`loop/gatekeeperConfig.ts`) writes `provenance` and `providerResponseId`. Host and interactive stamps, and the unstamped pre-hybrid direct route, are unchanged. **Closure route, not done:** see "Not done" | `gatekeeperTurn.test.ts` "stamps an accepted broker answer InstallationBrokerProviderAnswer, with the provider response id" and "stamps nothing for the pre-hybrid direct route"; `gatekeeperDecisionEvidence.test.ts` "writes the class and the response id, and refuses to relabel it" | TR-2: `broker-answer-unstamped`, `broker-evidence-drops-response-id` |
| 3 | Dry run writes (D5) | `runLoop` (`loop/runner.ts`) builds and checks the brief on a dry run but no longer writes it. The dry run already returned before the invocation and session records, so it now writes nothing. The lines say so: "Brief: … (built and checked; not written on a dry run)" and "DRY RUN: nothing was written and no worker was started." Two existing tests that read the brief a dry run left behind now take it from a live run | `loopRunner.test.ts` "a dry run writes NOTHING — not even the brief — and starts nothing" (zero writes); `continuationEndToEnd.test.ts` "continue --dry-run on a phase with work left writes no execution brief or other run record" (real git; two dry passes, then NO_PROGRESS; `.projectops/execution/` empty; `git status --ignored` clean) | TR-3: `dry-run-writes-brief` |
| 4 | Receipt scope (D3) | **Machine-readable half, done.** `loop/ownerGateReceipts.ts` adds `questionKinds`, a closed list (`technical`, `closure`). It is separate from `scope`, which core pins to `owner-gate-only`. `receiptQuestionScope` reads it and treats an unknown, duplicate or empty list as unrecorded. `secretsHandlingReceiptScope` reads it only from a committed receipt that approves credential use. `closureFundingLine` derives the human line from it. **Removing the hard-coded line, not done:** see "Not done" | `ownerGateReceipts.test.ts` "reads questionKinds as a closed, non-empty list of known kinds, each named once", "reads the scope only from a committed receipt that approves credential use", "says a receipt covers closure questions only when its scope names them, and says when it records none" | TR-4: `funding-line-always-covers-closure`, `unknown-question-kind-skipped` |
| 5 | Clean-tree pin in `closurePrepared` (CONTINUE-INTEGRITY1A carry-forward) | No code change. Its first statement, `if (!gitFacts(ctx.sys, ctx.root).clean) return false;` (`commands/run.ts`), is now pinned on its own | `continuationEndToEnd.test.ts` "records prepared and committed route to the request only on a clean tree; one untracked file routes back to prepare" (same records; one untracked file is the only difference) | TR-5: `closure-prepared-ignores-dirty-tree` |

### The validator

`val-projectos-boot-continue1a` gains section (15), TR-1 to TR-5. There are seven named mutations in
`TRUTH_MUTATIONS`. `selfTest` applies each one in memory, re-runs the whole validator, and counts a mutation
killed only when its own rule fires and **no other rule in the validator does**. `run()` = `check()`, then
`selfTest()` when the check is clean. No existing rule was changed or weakened. The new test names are
added to `TESTS` (BC-9).

Behavioural battery (scratch tool, each mutation applied on disk, then restored with a sha256 check):
7/7 killed by their own rule alone, and 7/7 killed by the named test.

## Not done (outside the grant), with the fix

Both items need `projectos/agent/src/commands/closure.ts`; D9 also needs `projectos/agent/src/closureWait.ts`
and `projectos/core/src/gatekeeperMode.ts`. None is in the writePaths. Cheapest route: a plan amendment that
adds these three paths to this phase, or to a one-item follow-up. That is an owner decision; it costs one
plan decision and activation.

- **D3, the hard-coded line.** `closureRequest` still prints the fixed sentence ("that receipt now also covers
  closure questions, which it did not when it was written"), at `closure.ts` lines 1061 to 1063. The fix is
  to replace the `fundedBy` literal with
  `closureFundingLine(id, secretsHandlingReceiptScope(sys, root, id))`. Making the broker enforce
  `questionKinds` (and a subject range) is the separate amendment D3 already named. Receipts also need
  `questionKinds` added when they are next written; none carries it today, so the derived line would honestly
  say "records no machine-readable question scope".
- **D9, the closure route.** `takeClosureTurn` still stamps nothing for a broker answer, on purpose.
  `closureResume` decides that a broker answer was produced in the call from that absence:
  `waiting.provenance === undefined && brokerRouteOptedIn(…)` (`closure.ts` line 1452, pinned by ZT-4). Stamping
  the class in `closureTurn.ts` alone would turn every brokered delegated closure into an owner-commit wait.
  The fix is to add the class to core's `GATEKEEPER_PROVENANCES` (or widen `ClosureWaitRecord.provenance`),
  stamp it with `providerResponseId` in `takeClosureTurn`, persist it in the wait, and replace the absence
  test with `waiting.provenance === <broker class>`. ZT-4 then needs updating in the same change.

## Verification

- `npm ci` in `projectos/core` and `projectos/agent`; `npm run build` in core.
- `npx tsc --noEmit -p .` (agent): clean. `npm run typecheck:tests`: clean.
- Full agent suite, `npx vitest run`: 98 files, 2700 of 2700 tests pass, 0 failures.
- Each validator's `run()` returned `[]`: `val-projectos-boot-continue1a` (7 named mutations killed),
  `val-projectos-technical-continuation1a`, `val-projectos-work-record-not-authority1a`,
  `val-projectos-kernel-role-review1a`, `val-projectos-kernel-cost-cap1a`, `val-projectos-kernel-platform-stop1a`.
  Also `val-projectos-gate-decision-evidence1a`, `val-projectos-live-gate-owner-floor1a`,
  `val-projectos-host-review-path1a` and `val-projectos-gatekeeper-contract1a`, which read the touched turn.
  `validate-no-secrets`: PASS.
- The platform-stop checks (`platformStopRefusal` in `runner.ts` and `run.ts`) are untouched.
  `val-projectos-kernel-platform-stop1a` passes with all its named mutations.
- `git diff --stat` equals `git diff --stat --ignore-cr-at-eol` (13 files, +432 −34): line endings are
  preserved, and `run.ts` stays CRLF.

## Carried forward

- **Shadowed test needles in this validator (pre-existing).** `TESTS` declares
  `continuationEndToEnd.test.ts` twice, and the second declaration wins. So the first list's 14 needles
  (BOOT-CONTINUE1A to MULTIPROJECT1A) are not checked. All 14 are still present in the test file. The fix is to
  merge the two arrays. It was left alone here as outside the five items.
- **Reviews.** The phase requires a Claude self-review and an ECC CODE review. Neither is recorded here.
