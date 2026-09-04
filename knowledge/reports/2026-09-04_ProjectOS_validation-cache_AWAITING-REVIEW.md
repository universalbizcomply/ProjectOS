# validation-cache — Evidence Pack

> Status: IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure is owner-gated.

1. **Project:** ProjectOS
2. **Phase:** validation-cache
3. **Date:** 2026-09-04 (evidence established 2026-09-05)
4. **Branch / HEAD:** `projectos-post-v3-selfhost-pilot1a` — evidence subject `db220a873534e8cdfef209c1d20d3a2c7a873659`, local and `origin/projectos-post-v3-selfhost-pilot1a` reconciled. The work itself landed at `e7c242b`, committed and pushed by the loop; `db220a8` reconciles the records that commit produced.
5. **Files changed:** 23 paths in `e7c242b` — the speed/validation-cache implementation under `projectos/speed/`, its validator `projectos/validators/validate-speed-validation-cache.cjs`, the benchmark evidence under `docs/speed/`, and the phase's own execution records.
6. **Summary:** Local, repository-scoped validation caching that accelerates routine validation without reducing correctness. Measured: cold 753s, warm 15s, warm-unchanged 43ms against a 2000ms target. Cache deletion reduces performance and never correctness — an induced failure still FAILS through the cache rather than returning a stale pass.

7. **Validators:** `.projectops/validation/db220a873534e8cdfef209c1d20d3a2c7a873659.json` records **141 of 141 registered modules PASS**, `0 FAIL`, from a clean working tree at this exact subject. The one validator this phase requires — `validate-no-secrets` — is recorded `passed: true, errorCount: 0`.

   Configured checks in the landed run: `validate-no-secrets`, `core-tests`, `agent-tests`, `agent-typecheck`, `speed-benchmark` — all PASS.

8. **Secrets used?** No. The effects attestation for the landed run records `productionTouched`, `deploymentOccurred`, `databaseMutationOccurred`, `externalSendOccurred`, `paymentOccurred` and `rawSecretStored` all false.

9. **Gated actions performed?** Commit and push only, both under a recorded gatekeeper approval of `CONTINUATION_READY` (`GKREQ-1c9c82b507d7d91c0a76e809`, routine tier). No production deploy, no database mutation, no external send, no payment, no signing, no installer activity, no force push.

10. **Risks / carry-forward:**
    - **Provider estimate under-reserve (carry-forward).** One review on this phase estimated 26,856 micro-USD and billed 214,228 — 168,142 input tokens on strong tier. The evidence pack drives the cost, not the answer. Separately, the free local re-ask that exists to avoid paying for a missing local record did not activate on that run; the built runtime contains the code, and the executed path is not yet proven. Both are provider-cost concerns, deliberately not fixed inside this phase.
    - **Closure evidence has no producer.** `.projectops/closure/<phase>.json` is only ever read by the runtime, never written by it. This one was authored under explicit owner authorisation from records other governed steps produced.

11. **Decision needed:** owner/advisor review + closure.

## What this phase had to survive

Three defects were found and fixed while getting here, each caught by the system refusing rather than by inspection:

- **The loop never wrote the phase record.** A completed phase left no lifecycle trace, so `selectNextPhase` would have re-run the same finished step forever. Fixed; the lifecycle in this phase's record was earned by the run, not reconciled by hand.
- **A hand-reconciled record could not be closed.** The first attempt at this phase was reconciled manually from a run whose evidence belonged to a different session. The gate refused it — correctly — because nothing bound it to a subject commit. The record was reset and the work re-run so the evidence would be genuine.
- **The reviewed candidate was mutated after it was frozen.** `AWAITING_GATE` was reported after `evidenceFor` had sealed the candidate, so the lifecycle write landed 250ms inside the reviewed window and every continuation refused with "the candidate changed after the gatekeeper reviewed it". Proven from write timestamps, fixed by moving the report ahead of the freeze — not by excluding the records from review. ECC code and security review of that boundary: 0 CRITICAL, 0 HIGH after two findings of their own were fixed.

Two findings this phase originally carried, `F11-EXECUTION-DENIED` (HIGH) and `F10-PROOF-DATA-GAP`, were resolved by running the benchmark, not by restating them. The latest findings record lists six findings, all resolved, zero unresolved CRITICAL or HIGH.

## Final status
**validation-cache — AWAITING-REVIEW.**
