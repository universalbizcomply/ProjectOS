# ProjectOS — PROJECTOS-V3-VALIDATOR-COHERENCE-CORRECTION1A

**Date:** 2026-08-04
**Project:** ProjectOS
**Repository:** C:\dev\ProjectOS
**Branch:** projectos-v3
**Parent commit:** 3720facadd83ef004a77a2e7b51f6f74f9b1dc09
**Status:** AWAITING-REVIEW
**Decision requested:** ACCEPTED FOR CLOSURE — or DO NOT CLOSE — VALIDATOR DEFECT REMAINS

---

## 1. Sources read

| Source | Classification | Finding |
|---|---|---|
| `projectos/state/projectos-v3.current-state.json` | SOURCE-BACKED FACT | `nextRecommendedPhase = PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A`; 4 / 19; 21.1 — no source conflict, so the gate's stop condition did not trigger |
| `docs/architecture/projectos-v3.1-crosswalk.md` | SOURCE-BACKED FACT | v1.4, Phase 13 CLOSED, `86ae19c` / `a43898d` OPEN |
| `knowledge/ProjectOS Reports Index.md` | SOURCE-BACKED FACT | Rebaseline row CLOSED; no row yet for this phase |
| Rebaseline CLOSED report | SOURCE-BACKED FACT | Records both defects as carry-forward for exactly this phase |
| `validate-v3.2-ai-provider-independence.cjs` | SOURCE-BACKED FACT | Tracked path confirmed; registered at `validate-all.cjs:85` |
| `validate-desktop-e2e.cjs` | SOURCE-BACKED FACT | Tracked path confirmed; registered at `validate-all.cjs:22` |
| Tests / fixtures / helpers for either | UNSUPPORTED / NOT FOUND | Neither validator has any test, fixture or helper module |
| `validate-all.cjs` | SOURCE-BACKED FACT | 112 registered modules; each runs and aggregates errors |
| Vite production output | SOURCE-BACKED FACT | 4 chunks in `dist/assets`; inventory in §5 |
| `git show 626828b`, `3720fac` | SOURCE-BACKED FACT | Chain intact; rebaseline then its closure |
| `projectos-v3-credential-router1a` | SOURCE-BACKED FACT | `f52a5d5…`, worktree clean, read-only inspection only |

## 2. Baseline reproduction (A1)

Measured directly at clean HEAD `3720fac`, before any edit:

```
validate-v3.2-ai-provider-independence  → exit 1, 1 failure
  V13 current-state nextRecommendedPhase is not the Windows adapter preflight:
  PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A

validate-desktop-e2e                    → exit 1, 3 failures
  check 5: production bundle missing owner surface 'Owner Control'
  check 5: production bundle missing owner surface 'Owner Chat'
  check 5: production bundle missing owner surface 'Safety &'

validate-v3.1-crosswalk                 → PASS
```

Also: `validate:v3plan` 8/8 PASS · `validate:secrets` PASS · `validate:reporter` 4/4 PASS ·
`git diff --check` clean · working tree clean · **112 registered validator modules**.

**Honest limitation on the aggregate baseline.** An aggregate `npm run validate` was started before
editing, but the run takes roughly fifteen minutes and my edits landed while it was still reading
files, so its result would have mixed pre- and post-change bytes. It was discarded rather than quoted.
The per-validator baselines above were measured directly on unmodified bytes, and a clean aggregate
was run after the change (§7). The aggregate baseline is therefore stated as **4 failures across 2
modules out of 112**, carried forward from the immediately preceding phase's measured aggregate at the
same two modules, not re-derived here.

## 3. Validator contracts

**`validate-v3.2-ai-provider-independence`** — from its header: proves the V3.2 amendment "is
persisted correctly and cannot silently: mutate the immutable v1.0 master plan, renumber historical
phases, make VS Code mandatory, drop a required provider phase, allow VS Code credential extraction,
reorder the PolyGo pilot before the dual-agent proof, authorise provider implementation, enable
EXECUTION_READY, claim a full VS Code IDE replacement, or publish an overall percentage."

V13 had two clauses: current-state's `nextRecommendedPhase` must equal the Windows adapter preflight,
and the amendment must record that phase ID. Deciding which contract V13 enforces (frozen historical
sequence vs. agreement with current-state) needed evidence: **no house pattern exists** — a repository
grep shows this is the *only* validator that reads `nextRecommendedPhase` at all. So the contract was
read from intent: the header's sequencing concerns are all about the amendment's own content, and the
phase ID it names is a *carry-forward item*, not a licence to dictate the live programme pointer.
current-state is the authoritative record of what comes next, so the validator yields to it.

**`validate-desktop-e2e`** — proves the Control Centre is a real Tauri desktop app. Checks 1–4 are
static over committed files; check 5 asserts the production bundle carries the owner surfaces.

## 4. Root causes and corrections

### Defect A — stale sequencing literal

`st.nextRecommendedPhase !== "CD-B4-WINDOWS-USER-VERIFICATION-ADAPTER-PREFLIGHT1A"` froze the next
phase as it stood when the amendment was written. The owner/gatekeeper has since sequenced the
credential router first, so the literal contradicted the authoritative record.

**Correction.** Two named constants with documented lifetimes:

```js
const ACCEPTED_NEXT_PHASE      = "PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A";
const WINDOWS_ADAPTER_PREFLIGHT = "CD-B4-WINDOWS-USER-VERIFICATION-ADAPTER-PREFLIGHT1A";
```

V13 now asserts current-state equals `ACCEPTED_NEXT_PHASE`, **and separately** that the amendment
still records `WINDOWS_ADAPTER_PREFLIGHT`. Resequencing therefore cannot quietly drop the adapter. The
comment states the authority source and expected lifetime. `a43898d` is not closed, no windows-future
dependency authority is inferred, and every other provider-independence assertion (V1–V12, V14, V15,
the pinned master-plan hash) is untouched.

### Defect B — wrong chunk inspected

```js
const mainBundle = fs.readdirSync(distAssets).find((f) => /^index-.*\.js$/.test(f));
```

`readdirSync` returns alphabetical order and Vite emits **two** `index-*.js` chunks, so `find`
selected `index-DzjvTP6P.js` — a 343-byte bootstrap stub — and reported the owner surfaces missing
from a bundle that contained all three.

**Correction.** Every `.js` chunk in `dist/assets` is read, and each label is required **somewhere
across the combined corpus**. Failure messages now name the chunk count, the directory and every
chunk inspected, so the next person sees what was actually read. No dependency added.

**Deliberate behaviour change, flagged for your decision.** Check 5 previously *skipped* when `dist/`
was absent, so a fresh checkout stayed green. Mutation M8 requires it to fail closed, and it now does:
absent, empty or unreadable production output is a failure. The header was rewritten to say so. **The
cost: `npm run validate` on a fresh clone now fails until the Control Centre is built.** That is a real
workflow change for CI and for anyone cloning the repository, and it is the one item here I would not
have chosen unprompted.

## 5. Production bundle discovery

Inventory at the time of measurement:

| Chunk | Bytes | Owner Control | Owner Chat | Safety & |
|---|---:|---|---|---|
| `core-BEOw45JP.js` | 195 | — | — | — |
| `event-lmqrH_TB.js` | 1,145 | — | — | — |
| `index-DzjvTP6P.js` | 343 | — | — | — |
| `index-tQ8AAcGw.js` | 441,440 | **2** | **1** | **1** |

All three labels live only in the 441 KB chunk. The old rule picked the 343-byte stub because `D`
sorts before `t`.

## 6. Mutation evidence

Each mutation applied alone; every file restored and verified.

| # | Mutation | Expected | Result |
|---|---|---|---|
| M1 | `nextRecommendedPhase` → unrelated phase | AI validator fails | **KILLED** |
| M2 | restore the stale Windows-preflight-only expectation | regression detected | **KILLED** — validator then rejects the authoritative record |
| M3 | add `index-AAAAAAAA.js` stub sorting before the real bundle | desktop validator still passes | **RESILIENT — exit 0** |
| M4 | remove `Owner Control` from every chunk | fails | **KILLED** |
| M5 | remove `Owner Chat` from every chunk | fails | **KILLED** |
| M6 | remove `Safety &` from every chunk | fails | **KILLED** |
| M7 | inspect only the first matching index chunk | killed / proof fails | **KILLED** — reproduces the original defect exactly, "1 inspected … index-DzjvTP6P.js" |
| M8 | remove production `dist` | fails closed | **KILLED** — "no production bundle … build the Control Centre before validating" |

S3 (tokens in source but absent from production output) is covered by M4–M6: the source modules were
never touched, so those runs had the labels present in source and absent from every production chunk,
and the validator failed.

Restoration verified: both validators byte-identical by `cmp`; `dist/assets` byte-identical by
`diff -rq`. Mutation copies lived only in the session scratchpad and were deleted — **zero residue**,
and no tracked build artifact was altered (`dist/` is gitignored).

## 7. Validation before / after

| Check | Before | After |
|---|---|---|
| `validate-v3.2-ai-provider-independence` | exit 1, 1 failure | **PASS** |
| `validate-desktop-e2e` | exit 1, 3 failures | **PASS** |
| `validate-v3.1-crosswalk` | PASS | **PASS** |
| `validate:v3plan` | 8/8 | **8/8** |
| `validate:secrets` | PASS | **PASS** |
| `validate:reporter` | 4/4 | **4/4** |
| `git diff --check` | clean | **clean** |
| Aggregate `npm run validate` | 4 failures / 2 modules of 112 | **112 / 112 modules PASS · 0 failures · `validate-all: ALL PASS`** |

## 8. Review findings

Self-review caught one defect in my own first correction: the new check-5 failure messages called
`path.relative(ROOT, …)`, but `ROOT` is **not defined** in `validate-desktop-e2e.cjs`. The validator
still passed, because those lines only execute on failure — so a genuine missing-surface regression
would have thrown a `ReferenceError` instead of reporting the fault. Replaced with a named
`DIST_ASSETS_REL` constant, `node --check` run, and every failure path then exercised by M4–M8.

Duplication and simplicity: no helper was introduced for a single call site; no dependency added; both
corrections stay inside the validators' existing style.

## 9. Exact changed paths

```
projectos/validators/validate-v3.2-ai-provider-independence.cjs   (modified — V13 + two constants)
projectos/validators/validate-desktop-e2e.cjs                     (modified — check 5 + header)
knowledge/ProjectOS Reports Index.md                              (modified — one new row)
knowledge/reports/2026-08-04_ProjectOS_PROJECTOS-V3-VALIDATOR-COHERENCE-CORRECTION1A_AWAITING-REVIEW.md  (new)
```

Four of the six authorised paths. No focused test or fixture path was needed — the mutation matrix
exercises every new branch directly, so a test file would have added weight without adding proof.

**No programme-state change:** `current-state` and the crosswalk are untouched. `acceptedPhaseCount`
stays 4 / 19, `completionPercentage` 21.1, Phase 13 CLOSED, `EXECUTION_READY` false,
`installationAuthority` NotAuthorised, `86ae19c` and `a43898d` OPEN, `nextRecommendedPhase` unchanged.

## 10. Credential-router non-interference

`projectos-v3-credential-router1a` at `f52a5d53d079e72d7d4ddffed1b5aca119919a89`, worktree
`C:/ProjectOS-worktrees/credential-router1a`: verified clean and unchanged by `git rev-parse` and
`git status`, read-only. Not read for content, modified, merged, rebased or integrated. No credential
entered. No provider contacted. No provider MCP used.

## 11. Remaining risks

1. **Fresh checkouts must build before validating** — the deliberate fail-closed change in check 5.
   If that is unwanted, the alternative is to treat absent `dist/` as a skip and lose M8; it cannot be
   both.
2. **`ACCEPTED_NEXT_PHASE` is a frozen literal** and will need a deliberate one-line rebaseline when
   the programme sequence next moves. That matches the house pattern established by the crosswalk
   validator, and the constant is named and commented for exactly that reason.
3. **Neither validator has a focused test.** Their proof lives in the mutation matrix in this report,
   which is evidence for this change but is not re-run by CI.

## 12. Decision requested

**ACCEPTED FOR CLOSURE** — or **DO NOT CLOSE — VALIDATOR DEFECT REMAINS**.
