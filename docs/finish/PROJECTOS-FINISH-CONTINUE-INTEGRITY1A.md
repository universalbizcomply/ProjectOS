# PROJECTOS-FINISH-CONTINUE-INTEGRITY1A — evidence

Phase 7 of 8 of plan v1.15 (`f2a987b`). It fixes two defects the live proof EXTERNAL-PROOF2A found.
Claude (lead) implemented it directly, on the owner's grant ("I have given you full authority") and the
owner's direction of 2026-10-26: "What is next? Why aren't you clear of what's next?". It was not
dispatched to a governed worker, and this document claims no ChatGPT gatekeeper ruling for it.

## What changed

1. **One `continue` reaches the closure question (D7).**
   - When `continue` (or `run --continue`) hands a finished phase to closure preparation, and the
     preparation succeeds, it routes once more from the records as they now stand.
   - If the route is now `closure request` (records generated and committed, so a clean tree), it asks
     the closure question in the same call (`dispatchContinueRoute`, `commands/run.ts`).
   - A failed preparation, or records left for the owner to commit, stop exactly as before.
   - A re-route that refuses is shown, not dropped.
   - The route table, the hand-off doc and the dry-run line now say that preparation carries on.
2. **A phase cannot grade its own new check with the old one (D8).**
   - When a phase's approved write paths name one of its own required validators (an exact file;
     the grant refuses any directory over `projectos/validators/`), the checks also run the phase's own
     copy of that validator against the subject, under the id `<name>@phase-copy`
     (`phaseCopyChecks`, `loop/verification.ts`).
   - It runs in both the run (`loop/runner.ts`) and closure preparation (`commands/closure.ts`), so the
     two check sets stay identical.
   - The copy is **added**: the pinned base copy still runs and must still pass, so the phase copy
     can only add a failure.
   - **Bounded and contained (ECC SECURITY M1, M2).** The phase copy is worker-written code run before
     review, so:
     - it runs through the pinned `VALIDATOR_RUNNER` with a 10-minute bound;
     - `runPhaseCopyChecks` compares `git status --porcelain --ignored --untracked-files=all` before and
       after each copy, and fails the copy on any difference.

## Acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | A continue that runs a preparation which commits its records asks the closure question in the same call; one that only generates, or fails, stops | E2E "one continue carries on from a preparation that committed its records into the closure request" (the request is shown to run: "interactive closure request … for <phase>"); "a preparation that only GENERATES its records (no technical delegation) stops there, as before"; validator CI-1, including the clean-tree route condition |
| 2 | A phase granted its own required validator runs both copies, reported separately, failing if either fails; otherwise pinned only; prepare runs the same set | E2E "… that BREAKS it fails on the phase copy, though the base copy passes" (the run stops; HEAD unmoved); "… that CHANGES it and keeps it passing runs BOTH copies, in the run and in closure preparation"; unit tests in `continueIntegrity.test.ts` (exact file, `./` prefix, no directory, not covered, unsafe names, a missing copy, the pinned runner and bound, a copy that changed the checkout fails); validator CI-2, CI-3 |
| 3 | Pins, mutations, suites, validate-all, reviews | Validator section (14) CI-1..CI-3 (FW-3a/FW-3b updated); 12/12 named mutations killed by their rule, 11 also by a test (`C:/dev/ProjectOS-candidate-backups/finish-continue-integrity1a/tools`); agent 96 files / 2544, core 772, typecheck:all clean; validate-all 145/147 (the two known: `validate-desktop-e2e`, `val-cd-b4-sealed-expected-window-facts1a`); reviews below |

## Reviews

- **ECC CODE: APPROVE**, 0 CRITICAL, 0 HIGH, 3 MEDIUM, 4 LOW.
  - MEDIUMs: two weak test assertions, and stale route docs.
  - LOWs: a dead directory branch; constant placement; a swallowed refused re-route; a test that
    never changed the validator.
  - All fixed.
- **ECC SECURITY: APPROVE WITH WARNINGS**, 0 CRITICAL, 0 HIGH, 2 MEDIUM, 4 LOW.
  - It found no flaw in D7: it uses the same gates as a second `continue`, the same phase, no loop,
    and nothing is spent before G4.
  - **M1:** the phase copy runs worker-written code unsandboxed, with no tree-change guard on the run
    path. Fixed by the short bound and the tree comparison.
  - **M2:** the runner was unpinned. Fixed with CI-2 and a test assertion.
  - **LOW1/LOW2:** pins added. **LOW4:** fixed.
  - **Round 2: one new HIGH**, now fixed.
    - The checkout picture read in the tree guard used the 1 MiB spawn default. On this repository the
      full picture is 3,611,969 bytes, so every phase copy would have failed closed with "git could not
      say".
    - Fixed: `--no-optional-locks` and `maxOutputBytes: PHASE_COPY_PICTURE_MAX_BYTES` (256 MiB), with a
      test asserting the option on both calls, a CI-3 pin and mutation C12.
  - **Round 3: APPROVE**, 0 CRITICAL, 0 HIGH, 0 MEDIUM, 3 LOW (carried below).

## Carried forward

- **The checkout picture is path-only** (SECURITY round 2, LOW). A phase copy that rewrites a file
  already modified, untracked or ignored, or that writes inside `.git/` or outside the tree, is not
  seen. The configured test suites share this exposure.
- **The clean-tree condition inside `closurePrepared`** (`run.ts`) is not pinned on its own. CI-1 pins
  the route line, and G4 re-checks a clean tree before any spend.

- **A validator a phase reaches only through another validator** (for example a helper required by
  `validate-all`) is judged by its base copy only. The phase-copy rule follows the plan's named
  required validators (SECURITY L3).
- **`run --continue --execute` can now reach the paid closure question in one call**, as `continue` can.
  The closure question is still admitted only after G4 and under the phase's committed receipt.

## Verification commands

    npx vitest run                         (projectos/agent, projectos/core)
    npm run typecheck:all                  (projectos/agent)
    node projectos/validators/val-projectos-boot-continue1a.cjs
    node -e "console.log(require('./projectos/validators/val-projectos-closure-transport1a.cjs').run())"
    node projectos/validators/validate-no-secrets.cjs
    node projectos/validators/validate-all.cjs
    node C:/dev/ProjectOS-candidate-backups/finish-continue-integrity1a/tools/mutation_battery.cjs --behaviour
