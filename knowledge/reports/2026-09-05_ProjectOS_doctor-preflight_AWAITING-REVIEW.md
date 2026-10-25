# doctor-preflight — Evidence Pack

> Status: IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure is owner-gated.

1. **Project:** ProjectOS
2. **Phase:** doctor-preflight
3. **Date:** 2026-09-05
4. **Branch / HEAD:** `projectos-post-v3-selfhost-pilot1a` — evidence subject `6c829a296269bcef4143f3cf606fdc77cae28b18`, local and origin reconciled. The implementation landed at `96fceb4` (ordinary development) and `d3c8e29` (the loop's own approved continuation).
5. **Files changed:** `projectos/agent/src/doctor.ts` (new), `projectos/agent/src/commands/doctor.ts` (new), `projectos/agent/test/doctor.test.ts` (new); `loop/runner.ts`, `loop/outcome.ts`, `loop/gatekeeperRouting.ts`, `loop/gatekeeperTurn.ts`, `cli.ts`; tests `loopRunner.test.ts`, `loopGatekeeperRouting.test.ts`.
6. **Summary:** Doctor answers one question in under ten seconds — if ProjectOS starts a worker, pays a reviewer, or commits and pushes on its own, will it be doing that on a machine where those things can actually work? Measured **46ms** against the plan's 10,000ms budget.

## Acceptance criteria

1. **≤10 seconds.** 46ms measured on the reference environment; each check reports its own cost so a slow one can be found rather than guessed at.
2. **Mandatory contexts blocked when the preflight fails.** Gated at four points, each at the moment of action rather than inherited from the run's start: autonomous execution (before a worker is even resolved, so nothing is half-done to undo), paid gatekeeper dispatch, automatic technical continuation, and the correction retry — which review correctly identified as a dispatch the original design had left covered only by the opening preflight.
3. **Browsing and read-only stay advisory.** `MANDATORY_CONTEXTS` is a closed constant of exactly three; a context cannot become mandatory by being added to a caller. The Control Center's read-only verbs reach the agent commands directly and never touch Doctor — confirmed by review against `sidecar/host.mjs`.
4. **Configured suites and validate-no-secrets.** `.projectops/validation/6c829a29….json` records **141 of 141 modules PASS** from a clean tree at this subject, including the required `validate-no-secrets`. All five configured checks passed in the landed run.
5. **No protected action performed or authorised.** Doctor writes nothing and spends nothing. `safeToActAutonomously` is only ever read as `if (!x) refuse` — it substitutes for no gate, and the accepted decision, reviewed candidate, delegation and owner gates are all still required unchanged. `DOCTOR_PREFLIGHT_FAILED` routes to the owner with an **empty verdict list**, so a broken machine can never be sent to a paid reviewer and approved past.

7. **Validators:** 141/141 PASS, `0 FAIL`, clean tree at the subject. Required validator `validate-no-secrets` passed.
8. **Secrets used?** No. Effects attestation records every protected effect false.
9. **Gated actions performed?** Commit and push only, under gatekeeper approval `GKREQ-2221113ffed95a730dbf97e5` (routine tier, 17,981 micro-USD).
10. **Risks / carry-forward:** unchanged from validation-cache — provider estimate under-reserve, free re-ask unproven, no native producer for `.projectops/closure/<phase>.json`. None blocks this phase.
11. **Decision needed:** owner/advisor review + closure.

## What review caught, and what it cost to keep

Two ECC reviewers, independently:

- **HIGH, both of them:** the first version wrote a probe file into `.projectops`. That path is not excluded from the reviewed candidate, and `doCommit` stages the candidate's own entries — so a probe surviving a crash could have been committed into governed history. Worse, a *stale* probe was read as a PASS and never cleaned up, so Doctor would have reported a clean bill of health over the exact residue that later refuses closure at G4-13. Doctor now writes nothing at all, which is what its own header always claimed.
- **MEDIUM:** the check-runner gate skipped bare-name commands while still reporting "N commands resolve" — a blocking gate claiming to have verified commands it never looked at. It now applies the rule `verification.ts` already applied.
- **MEDIUM:** criterion 2 had no test that could fail. All three enforcement sites were deletable with the suite green. There is now an integration test driving the real loop against a git that cannot answer, asserting no worker starts.
- **Found while fixing:** a regex whose backslash did not survive being written as a string would have failed an ordinary Windows path as "not an absolute path" — a blocking failure on a legitimate command. Replaced with a character comparison that cannot be mis-escaped.

**1810 agent tests. ECC code and security review: 0 CRITICAL, 0 HIGH.**

## The reviewer outage

The first run reached `CONTINUATION_READY` with every check passing and stopped: the gatekeeper returned HTTP 429, `credit_balance_exhausted`. The loop did the right thing — it named the owner's three choices and refused to proceed. Claude did not self-review. The owner restored credits and the run resumed to approval and landing without any further change to the work.

## Final status
**doctor-preflight — AWAITING-REVIEW.**
