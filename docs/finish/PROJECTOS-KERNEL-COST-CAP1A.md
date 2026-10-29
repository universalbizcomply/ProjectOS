# PROJECTOS-KERNEL-COST-CAP1A — hard per-phase and per-day spend caps

**Phase:** PROJECTOS-KERNEL-COST-CAP1A, phase 12 of 16 of plan v1.17 (PLANDEC-5fb44adb067b3d368f744369,
activation `04bcd4a`), V4 Stage 1.2.
**Route:** owner-direct closure, under the owner's grant: "You have full authority" and "You are
running on Admin mode, continue work without me." No gatekeeper closure ruling was obtained, and none
is claimed.

## What was actually missing (the plan text was half stale)

The plan said "today's reservation is not a bound; it was 21.9× under". That measurement was real, but
it was fixed in `daa9c00` (2026-09): the whole request body is priced before dispatch, and the review is
stateless. The monthly hard stop already refused, before dispatch, the call that would cross it.

Two things were genuinely missing:
1. **Per-phase and per-day bounds.** Without them, one runaway phase or one bad night could spend the
   whole month before anything refused.
2. **Committed-only reading.** The budget was read from the working copy. An unreviewed edit could raise
   the stop, up to the pilot ceiling.

## Delivered

| Commit | Content |
|---|---|
| `f0efaec` | `gatekeeperCostLedger.ts`: required per-phase and per-day caps; every bound checked, every crossed cap named with its total; an unreadable total is refused; day totals. `gatekeeperConfig.ts`: caps read from the committed file only, and missing caps refused. The admission and both turns pass the day. Tests and validator |
| `e684abe` | `.projectops/gatekeeper.json`: $1.00 per phase, $2.00 per day, under the $5.00 month. Owner: "Confirm" (2026-10-29) |
| `ff94653` | Security review round 1: committed-only prices and validated rate cards (H1), strict ledger reader (H2), UTC periods and canonical request time (M1), Control Center display restored (M3), production-path admission tests (M5), committed raise authority (L1) |
| `6187eae` | Recheck residuals: failed read refused (R1), unattributed entries refused (R2), UTC instant stored, no non-finite settlement, fallback counts all spend |
| `d9d7892` | Per-phase cap raised to $1.50. Owner: "Raise to $1.50" (2026-10-29), because one past phase spent $1.43 |
| `6991790` | Rust Host spend ledger enforces both caps. Owner: "Update it now" (2026-10-29) |
| `2eff5e7` | Host follow-ups: cross tests fail closed under CI; amounts above 2^53 − 1 refused |

## Acceptance criteria

1. **A call whose cap would be exceeded is refused before any network request; tested with a counting
   transport.** Met.
   - `gatekeeperTurn.test.ts`, "KERNEL-COST-CAP1A: hard per-phase and per-day caps".
   - A crossed per-phase cap, a crossed per-day cap and a missing cap each leave the counting fake
     transport with zero requests.
   - The existing month case and the closure-turn case still hold.
2. **The cap is read from committed configuration only, and a missing cap is a refusal, not
   unlimited.** Met.
   - A working-copy cap that differs from HEAD is refused.
   - A committed budget with no per-day cap is refused.
   - `policyProblems` refuses any unusable cap.
   - Tests are in `gatekeeperDelegationAuthority.test.ts` ("[COST-CAP] …") and `gatekeeperTurn.test.ts`.
   - ProjectOS's real config was loaded through `loadGatekeeperConfig`. There were no budget refusals,
     and the policy handed to the loop was `{warn $2, month $5, phase $1, day $2}`.
3. **Validator pin and named mutations.** Met.
   - `val-projectos-kernel-cost-cap1a` has 13 rules and 26 named mutations, each applied in memory and
     counted only when its own rule fires.
   - Verified by calling `run()`.

## Verification

- Core: 780 of 780 pass.
- Agent: 2596 of 2597 pass. The one failure is pre-existing, from plan v1.17's KERNEL-HYGIENE1A
  writePaths, and is repaired by the v1.18 amendment.
- Rust: gatekeeper-ledger 78 + 10 (the cross-implementation tests RAN) + 1; windows-local-ipc 369 + 11 +
  6 + 39. Clippy and fmt are clean.
- Control Center: `tsc --noEmit` is clean.
- Typecheck is clean.
- Validators: `val-projectos-kernel-cost-cap1a`, `val-projectos-kernel-role-review1a`,
  `val-projectos-boot-continue1a` and `validate-no-secrets` all PASS.

## Reviews

- **ECC security-reviewer, round 1** (`f0efaec`+`e684abe`): 0 CRITICAL, 2 HIGH, 5 MEDIUM, 9 LOW.
  Criterion 1 PARTIAL.
  - H1: prices were read from the working copy and never validated, so a $0 estimate defeated every cap.
  - H2: an unreadable ledger read as empty, which reset the caps and was then overwritten.
  - M1 (timestamps), M3 (a Control Center regression I introduced), M5 (production-path tests) and L1
    (raise authority): all fixed in `ff94653`.
- **ECC security-reviewer, round 2** (recheck of `ff94653`): 0 CRITICAL, 0 HIGH.
  - H1, M1, M3, M5 and L1: CLOSED. H2: PARTIAL, with residuals R1 (a failed read treated as absent) and
    R2 (an unattributed entry excluded from totals).
  - R1, R2, L-b (store the UTC instant), L-c (no non-finite settlement) and L-e (the fallback with a bad
    time counts everything): fixed in `6187eae`.
  - Final verdicts: criteria 1, 2 and 3 MET for the gatekeeper, closure and reconcile paths this phase
    governs.

- **Rust Host spend ledger (M4), owner-approved ("Update it now", 2026-10-29).**
  - What changed: in `6991790` the Host's twin admission enforces the per-phase and per-day caps.
  - Cross-implementation driver: it is like-for-like, and its tests RAN rather than skipped.
  - Test fixtures: `windows-local-ipc` fixtures were updated.
  - Test results: gatekeeper-ledger 73 + 10 + 1 and windows-local-ipc 369 + 11 + 6 + 39, all passing.
  - Independent Rust review: **APPROVE WITH WARNINGS**.
    - Instants: 517k instants were checked against the real TypeScript `utcInstant` with 0 holes.
    - Cap literals: 32 cap literals with 0 holes.
    - Mutants: all killed.
    - Fixed in `2eff5e7`: cross tests fail closed under `CI` or `PROJECTOS_REQUIRE_CROSS=1`, and amounts
      above 2^53 − 1 are refused.

## Must close before the Host service is started (owner-visible)

The Host service is not running against a live checkout today, so neither item is live.

- **The Host reads the WORKING-COPY `gatekeeper.json`.**
  - The canonical admission reads committed bytes only, so a one-line uncommitted edit would make the Host
    admit what TypeScript refuses. That includes self-raising the month stop through a working-copy raise
    authority.
  - Severity: MEDIUM today, HIGH once the service runs.
  - Fix: about 15 lines. Resolve the policy from the committed bytes, which the composition already has a
    reader for, and refuse when the working copy disagrees.
- **Phase labels differ between the two writers.**
  - The production Host adapter writes digest labels, and the agent writes names.
  - So a per-phase cap is counted per lane. The day and month caps are account-wide and hold.
  - Fix: resolve names in the adapter, or document the cap as per lane, and add a cross row using the
    adapter's labels.

## Carried forward

- **M2: authoring ports.** `brokeredAuthorPort` with `admitSpend` omitted, and the unmetered
  `openAiAuthorPort`, are fail-open by construction but unwired in the live composition today.
  `planAuthoring.ts` is outside this phase's grant.
- **M4: Rust Host ledger and cross-implementation driver.**
  - They do not know the per-phase and per-day caps.
  - The driver passes a two-field policy, so its cross-check would fail once `agent/dist` is built. Today
    it skips silently.
  - `projectos/host/**` is protected. This is an owner decision.
- **LOW:**
  - L-a: a price floor against unit typos.
  - L-d: settle and resolve skip an unreadable ledger without signalling the owner.
  - L-f: the ledger, and so the caps, are per checkout.
  - L-g: the Control Center shows NaN for an unreadable ledger.
  - The round-1 items carried as LOW: L2–L9, including the UTC day boundary and phase-id-scoped caps.
- **Owner note on the $1.00 per-phase cap.** The real ledger shows `validation-cache` at $1.43 lifetime,
  so a phase of that size would be stopped partway under this cap.

## Scope notes

- **Worker calls.** These run through the owner's local Claude Code CLI, which has no metered per-call
  price. The caps govern the metered provider calls that pass through `authoriseRequestSpend`: the
  gatekeeper, closure and reconciliation calls.
- **`reconciliation.ts`.** It is outside this phase's write grant and unchanged. Its fallback pre-check
  names no day, so the day total counts the whole month. That fallback can only refuse more, never less.
  When a durable ledger exists, the binding check is the serialised admission, which passes the exact
  day.
