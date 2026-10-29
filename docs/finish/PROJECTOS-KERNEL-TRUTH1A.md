# PROJECTOS-KERNEL-TRUTH1A — evidence

**Phase:** PROJECTOS-KERNEL-TRUTH1A, plan v1.18 (Stage 1, item 1.5): five truth fixes carried from plan v1.15.
**Branch:** `projectos-kernel-truth1a`, from `d77f20a` (the platform stop). Implementation `ae4f54c`;
record `eee7708`; code-review fixes in the commit that follows it.
**Route:** Claude (lead) implemented it directly in its own worktree. It was not dispatched to a governed
worker, and this document claims no gatekeeper ruling and no closure.

The grant was the phase's writePaths, narrowed to `projectos/agent/src/loop/`,
`projectos/agent/src/commands/run.ts`, `projectos/agent/test/`, this validator and this file.

**Delivered: 3 of 5 items** (1, 3 and 5). **D3 and D9 are half done.** Their authority-relevant halves —
`commands/closure.ts`, `closureWait.ts`, core `GATEKEEPER_PROVENANCES` and validator rule ZT-4 — are outside
the grant and are carried to the Stage 1 follow-up phase. What was done, and what is left, is stated per item.

## The five items

| # | Item (finding) | What changed | Test | Rule and named mutation(s) |
|---|---|---|---|---|
| 1 | Run-loop stop wording (EXTERNAL-PROOF3A) | `mayContinueAfter` (`loop/programmeContinuation.ts`) no longer says "closure is never continued through" for a phase awaiting closure. It now says the loop does not close the phase itself, the next step is the closure route, and that route's gates decide whether closure carries on or stops for the owner. This is true whether `run --continue` then closes the phase, stops, or (dry run) only names the step | `programmeContinuation.test.ts` "awaiting_closure says the closure route decides what happens next, and never that closure is not continued through" | TR-1: `awaiting-closure-denies-continuation` (restores the old sentence) |
| 2 | Broker provenance (D9) | **Run-loop route, done.** `takeGatekeeperTurn` (`loop/gatekeeperTurn.ts`) records which route answered (`viaBroker`) where the call is made. A broker answer is stamped `InstallationBrokerProviderAnswer` with the provider's response id, instead of carrying no stamp. `recordGatekeeperDecisionEvidence` (`loop/gatekeeperConfig.ts`) writes `provenance` and `providerResponseId`. Host and interactive stamps, and the unstamped pre-hybrid direct route, are unchanged. **Closure route, not done:** see "Not done" | `gatekeeperTurn.test.ts` "stamps an accepted broker answer InstallationBrokerProviderAnswer, with the provider response id" and "stamps nothing for the pre-hybrid direct route"; `gatekeeperDecisionEvidence.test.ts` "writes the class and the response id, and refuses to relabel it"; route precedence: `hybridGatekeeper.test.ts` "a Host-attested answer stays Host-stamped even when a broker is also configured", `gatekeeperTurn.test.ts` "stamps nothing for a rehearsal answer, even with a broker configured" | TR-2: `broker-answer-unstamped`, `broker-evidence-drops-response-id`, `broker-stamp-ignores-route-precedence` |
| 3 | Dry run writes (D5) | `runLoop` (`loop/runner.ts`) builds and checks the brief on a dry run but no longer writes it. The dry run already returned before the invocation and session records, so it now writes nothing. The lines say so: "Brief: … (built and checked; not written on a dry run)" and "DRY RUN: nothing was written and no worker was started." Two existing tests that read the brief a dry run left behind now take it from a live run | `loopRunner.test.ts` "a dry run writes NOTHING — not even the brief — and starts nothing" (zero writes); `continuationEndToEnd.test.ts` "continue --dry-run on a phase with work left writes no execution brief or other run record" (real git; two dry passes, then NO_PROGRESS; `.projectops/execution/` empty; `git status --ignored` clean) | TR-3: `dry-run-writes-brief` |
| 4 | Receipt scope (D3) | **Machine-readable half, done, and ADVISORY ONLY:** not enforced by the broker, and not wired into `closure.ts`; each helper says so in its doc comment. `loop/ownerGateReceipts.ts` adds `questionKinds`, a closed list (`technical`, `closure`). It is separate from `scope`, which core pins to `owner-gate-only`. `receiptQuestionScope` reads it and treats an unknown, duplicate or empty list as unrecorded. `secretsHandlingReceiptScope` reads it only from a committed receipt that approves credential use. `closureFundingLine` derives the human line from it. **Removing the hard-coded line, not done:** see "Not done" | `ownerGateReceipts.test.ts` "reads questionKinds as a closed, non-empty list of known kinds, each named once", "reads the scope only from a committed receipt that approves credential use", "says a receipt covers closure questions only when its scope names them, and says when it records none" | TR-4 (pins the helper only): `funding-line-always-covers-closure`, `unknown-question-kind-skipped`. TR-7 pins the CURRENT hard-coded sentence in `closure.ts` read-only, so the follow-up must flip it deliberately: `closure-funding-sentence-edited` |
| 5 | Clean-tree pin in `closurePrepared` (CONTINUE-INTEGRITY1A carry-forward) | No code change. Its first statement, `if (!gitFacts(ctx.sys, ctx.root).clean) return false;` (`commands/run.ts`), is now pinned on its own | `continuationEndToEnd.test.ts` "records prepared and committed route to the request only on a clean tree; one untracked file routes back to prepare" (same records; one untracked file is the only difference) | TR-5: `closure-prepared-ignores-dirty-tree` |

### The validator

`val-projectos-boot-continue1a` gains section (15), TR-1 to TR-7, with ten named mutations in
`TRUTH_MUTATIONS`. `selfTest` applies each one in memory, re-runs the whole validator, and counts a mutation
killed only when its own rule fires and **no other rule in the validator does**. `run()` = `check()`, then
`selfTest()` when the check is clean. No existing rule was changed or weakened. The new test names are
added to `TESTS` (BC-9).

- **TR-6** fixes a pre-existing hole. `TESTS` declared `continuationEndToEnd.test.ts` twice, and the second
  key silently replaced the first, so 14 needles (BOOT-CONTINUE1A to MULTIPROJECT1A) were never checked. The
  two lists are merged (all 14 were still present), and TR-6 reads the validator's own source and fails when
  a `"projectos/…": [` key repeats in `TESTS` (mutation `tests-key-repeated`).
- **TR-7** is the read-only pin on the hard-coded D3 sentence in `closure.ts` (above).

Behavioural battery (scratch tool, each mutation applied on disk, then restored with a sha256 check):
10/10 killed by their own rule alone. 8/8 with a behavioural test are killed by it; TR-6 and TR-7 are
pins with no behaviour to test. For `broker-stamp-ignores-route-precedence` the rehearsal test fails; the
Host test passes, as expected, because it guards the order of the stamp ternary, not that condition.

## Not done (outside the grant), with the fix

Both items need `projectos/agent/src/commands/closure.ts`; D9 also needs `projectos/agent/src/closureWait.ts`
and `projectos/core/src/gatekeeperMode.ts`. None is in the writePaths. Cheapest route: a plan amendment that
adds these three paths to this phase, or to a one-item follow-up. That is an owner decision; it costs one
plan decision and activation.

- **D3, the hard-coded line.** `closureRequest` still prints the fixed sentence ("that receipt now also covers
  closure questions, which it did not when it was written"), at `closure.ts` lines 1061 to 1063. The fix is
  to replace the `fundedBy` literal with
  `closureFundingLine(id, secretsHandlingReceiptScope(sys, root, id))`, flipping TR-7 in the same change.
  Making the broker enforce `questionKinds` (and a subject range) is the separate amendment D3 already named.
  Until the line is wired or enforced, `questionKinds` changes nothing and should not be added to receipts.
- **D9, the closure route.** `takeClosureTurn` still stamps nothing for a broker answer, on purpose.
  `closureResume` decides that a broker answer was produced in the call from that absence:
  `waiting.provenance === undefined && brokerRouteOptedIn(…)` (`closure.ts` line 1452, pinned by ZT-4). Stamping
  the class in `closureTurn.ts` alone would turn every brokered delegated closure into an owner-commit wait.
  The fix is to add the class to core's `GATEKEEPER_PROVENANCES` (or widen `ClosureWaitRecord.provenance`),
  stamp it with `providerResponseId` in `takeClosureTurn`, persist it in the wait, and replace the absence
  test with `waiting.provenance === <broker class>`. ZT-4 then needs updating in the same change.

### Stale text outside the grant (follow-up)

- `projectos/agent/src/cli.ts` ~108: "A dry run writes a worker brief and session records". After D5 it
  writes nothing; the refusal under the stop is still right, but the reason should be restated.
- `docs/02_AppFlow.md` ~40: "`run --dry-run`, which writes a brief". After D5 it writes nothing.

## Verification

- `npm ci` in `projectos/core` and `projectos/agent`; `npm run build` in core.
- `npx tsc --noEmit -p .` (agent): clean. `npm run typecheck:tests`: clean.
- Full agent suite, `npx vitest run`: 98 files, 2701 of 2702 pass (2700 of 2700 at `ae4f54c`). The one failure, `pinnedValidators.test.ts` "a pin whose blob git cannot show fails, and leaves no directory behind", counts `projectos-pinned-*` directories in the shared temp directory while other test files create pins in parallel; it passes alone (11 of 11), and that code is untouched here.
- Each validator's `run()` returned `[]`: `val-projectos-boot-continue1a` (10 named mutations killed),
  `val-projectos-technical-continuation1a`, `val-projectos-work-record-not-authority1a`,
  `val-projectos-kernel-role-review1a`, `val-projectos-kernel-cost-cap1a`, `val-projectos-kernel-platform-stop1a`.
  Also `val-projectos-gate-decision-evidence1a`, `val-projectos-live-gate-owner-floor1a`,
  `val-projectos-host-review-path1a` and `val-projectos-gatekeeper-contract1a`, which read the touched turn.
  `validate-no-secrets`: PASS.
- The platform-stop checks (`platformStopRefusal` in `runner.ts` and `run.ts`) are untouched.
  `val-projectos-kernel-platform-stop1a` passes with all its named mutations.
- `git diff --stat` equals `git diff --stat --ignore-cr-at-eol` for both commits: line endings are
  preserved, and `run.ts` stays CRLF.

## Carried forward

- **To the Stage 1 follow-up phase:** D3's wiring in `closure.ts` (flip TR-7) and broker enforcement; D9's
  closure route (`closure.ts`, `closureWait.ts`, core `GATEKEEPER_PROVENANCES`, ZT-4); the two stale texts above.
- **Reviews.** ECC CODE review of `ae4f54c`/`eee7708`: APPROVE as a partial delivery, 0 CRITICAL, 0 HIGH.
  Its two MEDIUMs (the duplicate `TESTS` key; D3's false assurance) and four LOWs (stale comments,
  route-precedence tests, the TR-3 message, this record's statement of delivery) are fixed in the
  follow-up commit; the out-of-grant comments are listed above.
