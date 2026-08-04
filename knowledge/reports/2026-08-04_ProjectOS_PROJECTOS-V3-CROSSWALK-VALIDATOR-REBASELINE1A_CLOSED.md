# ProjectOS — PROJECTOS-V3-CROSSWALK-VALIDATOR-REBASELINE1A

**Date:** 2026-08-04
**Project:** ProjectOS
**Repository:** C:\dev\ProjectOS
**Branch:** projectos-v3
**Parent commit:** 4d36eea110b120c1043d65a19fb8814cf381f268
**Status:** CLOSED
**Gatekeeper decision:** CLOSED — ChatGPT technical closure gate, 2026-08-04

---

## 0. Closure record

**Phase:** PROJECTOS-V3-CROSSWALK-VALIDATOR-REBASELINE1A
**Status:** **CLOSED**
**Closure authority:** ChatGPT technical closure gate, 2026-08-04
**Accepted commit:** `626828b27aa22a3320b67184f0b917ad04731f43` (parent `4d36eea110b120c1043d65a19fb8814cf381f268`)

**Closure basis**

- The exact four stale failures were reproduced against clean HEAD `4d36eea` with expected and actual
  values recorded for each.
- The overloaded baseline constant was split three ways — the frozen `CD-B4-PRODUCTION-IPC-PROVIDER1A`
  closure commit, the crosswalk's document provenance, and the accepted programme head — each named
  and documented with its own lifetime.
- The numbered ratio is now validated against the authoritative record instead of by regex over
  crosswalk prose, and split into five independent assertions including a derived-percentage check.
- Phase 13 closure and uniqueness are asserted: the phase matrix must carry exactly one row 13 and it
  must read CLOSED.
- `currentRemoteHead` reconciliation and `completedPhases` agreement checks were added.
- `86ae19c` and `a43898d` must still read OPEN and not CLOSED.
- Seven mutations were applied one at a time and every one was killed or confirmed load-bearing; all
  touched files were restored byte-identically, verified with `cmp`.
- The target validator returns PASS, exit 0.
- Pushed normally and remotely reconciled 0/0 with exactly one commit after `4d36eea`.
- No programme fact changed — `acceptedPhaseCount` 4 / 19, `completionPercentage` 21.1, Phase 13
  CLOSED, `EXECUTION_READY` false, `installationAuthority` NotAuthorised.
- No credential-router interference: the feature branch and its worktree were inspected read-only and
  remain unchanged.

**Carry-forward (recorded; none blocks this closure)**

1. `validate-v3.2-ai-provider-independence` carries a stale `nextRecommendedPhase` expectation — it
   still expects the Windows adapter preflight.
2. **Gatekeeper ruling:** `PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A` remains the next programme
   phase; `current-state` is correct and must not be changed to the Windows adapter preflight.
3. `validate-desktop-e2e.cjs` selects the first `index-*.js` chunk and can therefore inspect the wrong
   Vite bundle.
4. Both defects require one separate narrow validator-coherence phase before credential-router
   integration.

---

## 1. Sources read

| Source | Classification | Finding |
|---|---|---|
| `docs/architecture/projectos-v3.1-crosswalk.md` | SOURCE-BACKED FACT | v1.4; provenance `fdee3d34…`; phase-13 row **CLOSED**; `86ae19c` and `a43898d` rows read **OPEN**; only percentage token is `97.5%` |
| `projectos/state/projectos-v3.current-state.json` | SOURCE-BACKED FACT | 4 / 19, 21.1, 4 `completedPhases` incl. Phase 13; heads recorded `fb203c6…` (stale by one accepted closure) |
| `knowledge/ProjectOS Reports Index.md` | SOURCE-BACKED FACT | Supporting row and Phase 13 row both CLOSED; CD-B4 ledger row present and CLOSED |
| Supporting CLOSED report | SOURCE-BACKED FACT | Status CLOSED; accepted commits `1fcf416` + `fb203c6` |
| Phase 13 report | SOURCE-BACKED FACT | Closure record present, points at the supporting report |
| `projectos/validators/validate-v3.1-crosswalk.cjs` | SOURCE-BACKED FACT | Exact tracked path confirmed by `git ls-files`; registered in `validate-all.cjs` |
| Focused tests / fixtures for it | UNSUPPORTED / NOT FOUND | None exist — the validator is standalone, run by `validate-all` |
| `git show fb203c6`, `5e22b35`, `4d36eea` | SOURCE-BACKED FACT | Accepted chain intact; `5e22b35` carries the rename, `4d36eea` the record content |
| `projectos-v3-credential-router1a` | SOURCE-BACKED FACT | Separate worktree `C:/dev/ProjectOS-worktrees/credential-router1a` at `f52a5d5`; read-only inspection only |

No source disagreement was found on `acceptedPhaseCount`, `completionPercentage`, Phase 13 status, HEAD semantics or validator purpose.

## 2. Validator contract discovered

From the validator's own header (lines 1–7), not inferred:

> *Fails closed. Proves the V3.1 status crosswalk + refreshed current-state + CD-B4 closure ledger stay internally consistent and cannot silently: renumber a historical phase, drop a CD-B4 closure, mark Forge formally closed, publish a merged overall percentage, enable EXECUTION_READY, or stale the head.*

It is a **frozen accepted-baseline validator with cross-file consistency checks**. The existing model was preserved; nothing was redesigned.

One house-pattern fact settled the head semantics (A3). `projectos/validators/validate-plan-staleness.cjs` explicitly asserts that an advancing `currentHead` is **ordinary progress that must not stale the plan**. So `currentHead` is not meant to track live HEAD commit-by-commit; it records the last **accepted** baseline. The crosswalk validator's head check is rebaselined to the accepted Phase 13 closure head, not to whatever HEAD happens to be.

## 3. Exact baseline failures reproduced (A1)

Against clean HEAD `4d36eea`, working tree clean, `node projectos/validators/validate-v3.1-crosswalk.cjs` → **exit 1, exactly 4 failures**:

```
FAIL: crosswalk version is not 1.0
FAIL: crosswalk source baseline is not the accepted HEAD
FAIL: current-state currentHead is not the accepted baseline: fb203c6a9add2ae9b4f8de15c7bd2dccfaed8ebc
FAIL: current-state numbered ratio drifted from 3/19 (15.8)
```

| # | Expected (stale) | Actual (accepted) |
|---|---|---|
| 1 | crosswalk `Version: 1.0` | `Version: 1.4` |
| 2 | provenance `e1749cc…` | `fdee3d34…` |
| 3 | `currentHead == e1749cc…` | `fb203c6…` |
| 4 | `3 / 19` and `15.8` | `4 / 19` and `21.1` |

Other baseline measurements: `validate:v3plan` 8/8 PASS · `validate:secrets` PASS · `validate:reporter` 4/4 PASS · `git diff --check` clean · working tree clean · **112 registered validator modules** (counted from the string entries in `validate-all.cjs`).

## 4. Root cause

Two distinct defects, only one of which is "stale literals".

**A. One constant served three different meanings.** `BASELINE = e1749cc…` was used simultaneously as

1. the accepted commit for `CD-B4-PRODUCTION-IPC-PROVIDER1A` in the closure ledger (a permanently frozen historical fact),
2. the crosswalk document's declared provenance, and
3. the accepted repository head.

These three drift independently. Rebaselining the head would silently have rewritten a CD-B4 **closure-ledger assertion** — the validator would have started demanding a different accepted commit for a closed phase. That is the real defect; the visible failures were a symptom.

**B. The ratio was asserted by regex over prose.** Checks `if (!/3\/19/)` and `if (/[124-9]\/19/)` scanned the whole crosswalk. The crosswalk legitimately retains historical `3 / 19` text inside its superseded v1.2 and v1.3 change notes, so a prose scan cannot distinguish a historical quotation from the live figure. Those two checks happened not to fire only by accident of wording.

## 5. Exact correction

`projectos/validators/validate-v3.1-crosswalk.cjs` only.

**Constants split three ways**, each documented with its lifetime:

```js
const CD_B4_IPC_PROVIDER_COMMIT = "e1749ccd2ca7a6348c5ece7bc97b18643de4e8ee"; // closure-ledger fact, frozen forever
const CROSSWALK_PROVENANCE      = "fdee3d341e0c43ae2d62a256e0b755196599139b"; // what the document declares
const ACCEPTED_HEAD             = "4d36eea110b120c1043d65a19fb8814cf381f268"; // accepted programme baseline
const ACCEPTED_PHASE_COUNT = 4, TOTAL_PHASE_COUNT = 19;
const ACCEPTED_PERCENTAGE = Math.round((ACCEPTED_PHASE_COUNT / TOTAL_PHASE_COUNT) * 1000) / 10; // derived, never hand-written
const CROSSWALK_VERSION = "1.4";
const PHASE_13_ID = "PROJECTOS-V3-DESKTOP-E2E-PROOF1A";
const OPEN_CD_B4 = ["86ae19c", "a43898d"];
```

**Checks rebaselined:** crosswalk version `1.0 → 1.4`; provenance now compared against `CROSSWALK_PROVENANCE` with a message naming provenance rather than "the accepted HEAD"; the CD-B4 ledger entry now uses `CD_B4_IPC_PROVIDER_COMMIT`.

**Ratio moved from prose to the authoritative record**, and strengthened from one combined assertion to five independent ones: `acceptedPhaseCount === 4`; `totalPhaseCount === 19`; `completionPercentage === 21.1`; `completionPercentage === round(accepted/total*1000)/10`; `completedPhases.length === acceptedPhaseCount`.

**Checks added:** `currentRemoteHead === ACCEPTED_HEAD` (local/remote reconciliation); `completedPhases` contains Phase 13; the phase matrix has **exactly one** row 13 and it reads `**CLOSED**`; `86ae19c` and `a43898d` rows still read `OPEN` and not `CLOSED`.

**Records reconciled** (`projectos/state/projectos-v3.current-state.json`): `currentHead` and `currentRemoteHead` `fb203c6… → 4d36eea…`, and the validator-drift carry-forward entry rewritten as RESOLVED. **No programme fact changed** — `acceptedPhaseCount` 4, `totalPhaseCount` 19, `completionPercentage` 21.1, `completedPhases` and Phase 13 status all untouched; 25 keys before and after.

## 6. Assertion inventory — before / after (A4)

| Assertion | Before | After |
|---|---|---|
| Document ID | ✓ | ✓ unchanged |
| Crosswalk version | ✓ `1.0` | ✓ rebaselined `1.4` |
| Authoritative-status wording | ✓ | ✓ unchanged |
| Approved-plan v1.0 + `1aa36b9` | ✓ | ✓ unchanged |
| Crosswalk provenance commit | ✓ (as "accepted HEAD") | ✓ rebaselined, meaning corrected |
| Non-plan self-statement | ✓ | ✓ unchanged |
| All 19 historical phase IDs | ✓ | ✓ unchanged |
| Ratio present in prose | ✓ regex `3/19` | **replaced** by five authoritative-record assertions |
| No other `N/19` in prose | ✓ regex | **replaced** as above (could not distinguish historical quotations) |
| Ratio scoped to "numbered" | ✓ | ✓ unchanged |
| 5 CD-B4 closures + commits | ✓ | ✓ unchanged, now on a dedicated constant |
| Forge not formally closed | ✓ | ✓ unchanged |
| Tracks A–G present | ✓ | ✓ unchanged |
| Track A–G authority wording | ✓ | ✓ unchanged |
| `EXECUTION_READY = false`, not true | ✓ | ✓ unchanged |
| `Installation authority = NotAuthorised` | ✓ | ✓ unchanged |
| Both NOT YET CALCULABLE | ✓ | ✓ unchanged |
| Only `97.5%` permitted | ✓ | ✓ unchanged |
| `currentHead` | ✓ frozen `e1749cc` | ✓ rebaselined `4d36eea` |
| `currentRemoteHead` | ✗ absent | **added** |
| `acceptedPhaseCount` | ✓ combined | ✓ **split out**, `=== 4` |
| `totalPhaseCount` | ✓ combined | ✓ **split out**, `=== 19` |
| `completionPercentage` accepted value | ✓ combined | ✓ **split out**, `=== 21.1` |
| `completionPercentage` derived | ✗ absent | **added** |
| `completedPhases.length` agreement | ✗ absent | **added** |
| Phase 13 in `completedPhases` | ✗ absent | **added** |
| Phase 13 row CLOSED | ✗ absent | **added** |
| Exactly one phase-13 row | ✗ absent | **added** |
| `86ae19c` / `a43898d` still OPEN | ✗ absent | **added** |
| `activePlanVersion === "1.0"` | ✓ | ✓ unchanged |
| CD-B4 ledger contents + CLOSED | ✓ | ✓ unchanged |
| Reports Index ledger row CLOSED | ✓ | ✓ unchanged |

Nothing was deleted, skipped, commented out or made unconditional. Two prose-regex checks were **replaced by stronger assertions on the authoritative record**; net assertion count rose.

## 7. Mutation evidence

Each mutation applied alone, then restored and verified byte-identical with `cmp`.

| # | Mutation | Expected | Result |
|---|---|---|---|
| M1 | `acceptedPhaseCount` 4 → 3 | fail | **KILLED** — 3 failures (accepted value, derived percentage, list-length agreement) |
| M2 | `completionPercentage` 21.1 → 15.8 | fail | **KILLED** — 2 failures (accepted value, derived value) |
| M3 | Phase 13 `CLOSED` → `OPEN` | fail | **KILLED** — 1 failure |
| M4 | accepted head → unrelated commit `1aa36b9…` | fail | **KILLED** — 1 failure |
| M5 | remove the new Phase-13 CLOSED comparison, then reopen Phase 13 | proof fails | **CONFIRMED LOAD-BEARING** — validator exits 0 on a reopened Phase 13 once the comparison is removed |
| M6 | duplicate the phase-13 row | fail | **KILLED** — "2 rows for phase 13 (expected exactly 1)" |
| M7 | `86ae19c` OPEN → CLOSED | fail | **KILLED** — "no longer records 86ae19c as OPEN" |

Restoration verified: validator, crosswalk and current-state all byte-identical afterwards; validator returns **PASS, exit 0**. Mutation baseline copies were kept in the session scratchpad, never in the repository, and deleted afterwards.

## 8. Validation before / after

| Check | Before | After |
|---|---|---|
| `validate-v3.1-crosswalk` | **exit 1, 4 failures** | **PASS, exit 0** |
| `validate:v3plan` | 8/8 PASS | 8/8 PASS |
| `validate:secrets` | PASS | PASS |
| `validate:reporter` | 4/4 PASS | 4/4 PASS |
| `git diff --check` | clean | clean |
| current-state JSON parses, 25 keys | ✓ | ✓ |

### Aggregate `npm run validate` after the change

**110 modules PASS · 4 FAIL lines across 2 modules · `validate-v3.1-crosswalk` PASS.** The four target
crosswalk failures are cleared. Neither remaining module is caused by this phase, and both are
outside its authorised boundary, so both are reported rather than fixed.

**1. `validate-v3.2-ai-provider-independence` — 1 failure.**

```
V13 current-state nextRecommendedPhase is not the Windows adapter preflight:
PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A
```

Pre-existing at the parent commit, not introduced here: `git show 4d36eea:…current-state.json` already
records `nextRecommendedPhase = PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A`. That value was set by the
Phase 13 closure gate, which instructed it explicitly. This phase did not touch the field. Two
validators therefore disagree about what the next phase should be, and reconciling them needs an
owner ruling plus authority over `validate-v3.2-ai-provider-independence.cjs`.

**2. `validate-desktop-e2e` — 3 failures, and a genuine second validator defect.**

```
check 5: production bundle missing owner surface 'Owner Control'
check 5: production bundle missing owner surface 'Owner Chat'
check 5: production bundle missing owner surface 'Safety &'
```

The labels **are** present in the built bundle — `Owner Control` ×2, `Owner Chat` ×1, `Safety &` ×1 in
`dist/assets/index-tQ8AAcGw.js` (441 KB). The check is looking at the wrong file:

```js
const mainBundle = fs.readdirSync(distAssets).find((f) => /^index-.*\.js$/.test(f));
```

Vite currently emits **two** matching chunks, and `readdirSync` returns them in alphabetical order, so
`find` selects `index-DzjvTP6P.js` — a 343-byte stub — instead of the real main bundle. The check then
correctly reports that the stub carries no owner surfaces. This has nothing to do with the crosswalk
rebaseline; `dist/` is gitignored build output and this phase changed no Control Centre file. Fixing it
means selecting the largest matching chunk, or scanning all of them, in
`projectos/validators/validate-desktop-e2e.cjs` — an executable path outside this boundary.

## 9. Exact changed paths

```
projectos/validators/validate-v3.1-crosswalk.cjs                 (modified — the correction)
projectos/state/projectos-v3.current-state.json                  (modified — heads reconciled, carry-forward resolved)
knowledge/ProjectOS Reports Index.md                             (modified — one new row)
knowledge/reports/2026-08-04_ProjectOS_PROJECTOS-V3-CROSSWALK-VALIDATOR-REBASELINE1A_CLOSED.md  (new; renamed from _AWAITING-REVIEW.md at closure)
```

Four of the five authorised paths. No focused test/fixture path was needed — M5 proves load-bearing behaviour directly against the validator, so adding a test file would have been unused weight.

## 10. Carry-forward

**Removed:** the validator-drift carry-forward, replaced in `current-state` with a RESOLVED entry naming this phase, the root cause and the new assertions.

**Retained unchanged:** `PROJECTOS-V3-FINAL-RUNTIME-E2E1A`; `PROJECTOS-V3-EXECUTION-READY-RULING1A`; `86ae19c` closure review OPEN; `a43898d` windows-future dependency decision OPEN; the accepted two-commit desktop closure (C1); credential-router integration as a separate gate (C2).

**New, honest limitation.** The frozen-baseline model means the next accepted head or crosswalk version bump will stale this validator again. That is the model's design, not a defect introduced here — but the constants are now named and documented so the next rebaseline is a two-line edit rather than an archaeology exercise.

## 11. Credential-router non-interference

Branch `projectos-v3-credential-router1a` at `f52a5d5` in worktree `C:/dev/ProjectOS-worktrees/credential-router1a` was inspected **read-only** via `git worktree list` and `git log`. No file in that worktree was read for content, modified, staged, merged, rebased or integrated. No credential was entered. No provider was contacted.

## 12. Frozen programme position

```
acceptedPhaseCount = 4         totalPhaseCount = 19       completionPercentage = 21.1
Phase 13 = CLOSED              EXECUTION_READY = false    installationAuthority = NotAuthorised
86ae19c = OPEN                 a43898d = OPEN
```

Unchanged by this phase. No phase reopened, no count altered, no readiness enabled.

## 13. Decision requested

**ACCEPTED FOR CLOSURE** — or **DO NOT CLOSE — VALIDATOR DEFECT REMAINS**.
