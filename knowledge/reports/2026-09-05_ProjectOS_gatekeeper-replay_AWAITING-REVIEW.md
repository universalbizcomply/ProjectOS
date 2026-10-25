# gatekeeper-replay — Evidence Pack

> Status: IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure is owner-gated.

1. **Project:** ProjectOS
2. **Phase:** gatekeeper-replay
3. **Date:** 2026-09-05
4. **Branch / HEAD:** `projectos-post-v3-selfhost-pilot1a`. Implementation landed at `97f1731`; the loop's approved continuation at `bc212aa`, local and origin reconciled. Evidence subject is the records-reconciliation commit that follows this report.
5. **Files changed:** `projectos/agent/test/replay/gatekeeperReplay.test.ts` (new), `projectos/agent/test/replay/deriveFixtures.mjs` (new), `projectos/agent/test/replay/fixtures/*.json` (12 new). **No production source is touched by this phase.**
6. **Summary:** The gatekeeper contract can now be exercised end to end offline, deterministically, for nothing. Until now the only way to test `checkGatekeeperDecision` against a real decision shape was to buy an answer.

## Acceptance criteria

1. **≤2 seconds, zero provider spend.** Replay executes in **75ms**. Reported without rounding in our favour: a *cold* `vitest run` of this file alone measures **2.68s** wall, of which ~2.0s is the vitest runner's own startup and transform. Replay is a member of the existing agent suite, where its marginal cost is the 75ms figure. Zero spend is **structural, not promised**: the suite's import set is asserted exactly — `@projectos/core`, `node:fs`, `node:path`, `node:url`, `vitest` — so no transport, credential or broker is reachable by anything this file can call.
2. **Minimum redacted contract data, B9 coverage, synthetic adversarial cases.** 12 fixtures derived from 15 committed decision records through a closed `CONTRACT_FIELDS` allowlist, so unlisted fields are structurally excluded rather than remembered-to-be-removed. **All four committed B9 records (`PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A`) have their contract shape represented** — verified record by record, not assumed: two map to `accepted-01`/`accepted-04`, two to `refused-02`/`refused-03`. Adversarial cases are synthetic, built in the test, and labelled as constructed evidence.
3. **No credentials, secrets, raw prompts, or full provider responses.** Provider prose is *substituted*, never scrubbed — a redactor would have to be right every time against text nobody controls; substitution cannot be wrong that way. Every fixture is scanned.
4. **Configured suites + `validate-no-secrets`.** All five configured checks PASS on both worker attempts: `validate-no-secrets`, `core-tests`, `agent-tests`, `agent-typecheck`, `speed-benchmark`. Full validator suite **141/141 PASS, 0 FAIL** from a clean tree at the subject.
5. **Paid dispatch still Doctor-gated and owner-gated.** Unchanged and untouched — this phase adds test-only files and modifies no production source, so nothing in the dispatch path moved.

## What review caught, and what it cost to keep

Two ECC reviewers ran before the governed run. Security returned **0 CRITICAL / 0 HIGH**. Code review returned **3 HIGH, blocking**. All three were the same failure wearing different clothes: **the suite was green about things it never tested.**

- **HIGH — the owner-only floor under test was invented.** Both the test and the derivation hardcoded `['merge','force-push','deploy','phase-closure']`. The constitution's list is `ALWAYS_OWNER_ONLY = ['commit','push','phase-closure','secrets-handling','payment-or-live-charge']`. The invented list omits `commit` and `push`, so replay classified every fixture under a **laxer rule than the runtime enforces**, and the single property this contract exists for — *a gatekeeper may recommend a commit and may never grant one* — had no coverage at all. Two of the three refused fixtures grant `commit` and `push` outright; under the private list that defect was invisible. Both sites now import the constant, and a containment assertion fails if an action is ever removed from the floor.
- **HIGH — the continuation branch had zero coverage.** Every captured decision is `AWAITING_OWNER`, because every one was taken in a run that stopped for the owner. Nine fixtures therefore proved only what happens when nothing continues. Synthetic continuing decisions now cover `APPROVED_TO_PROCEED` / `AMENDMENT_REQUIRED` and the owner-gated-verdict consistency rule.
- **HIGH — six checker rules were deletable with the suite green:** `consumedAt`, `decidedAt`, `reason`, `forbiddenActions` array-ness, `ownerApprovalRequired` boolean-ness, and the closed verdict vocabulary. Each now has an adversarial case.

### Found while fixing — a secret scan that could never fire

The fixture secret scan matched nothing, ever. The `\b` in `/\bsk-…/` had not survived being written through a shell heredoc: the file held a literal **BACKSPACE byte (0x08)**, so the pattern only matched a control character followed by `sk-`. **A secret scan that cannot fire is worse than none, because it reports a clean result.** It is now written with no backslash escape to lose — the word boundary is spelled as an explicit character class, which is the same lesson as the `isAbsoluteCommand` fix in doctor-preflight.

It also carried the opposite defect, which the security review flagged: requiring 20 straight alphanumerics after `sk-` cannot match **any** modern key shape, because `sk-proj-`, `sk-ant-`, `sk-svcacct-` and `sk-admin-` all break the run well before 20 characters. And the scan covered only `accepted-` fixtures, skipping three committed files for no reason but which block they sat in. Both corrected.

One further defect found in passing: the import-allowlist test extracted modules **per line**, so a multi-line import made it blind — a real dependency would have vanished from the allowlist while the check still passed. It now matches import statements.

## Proof that the new tests can fail

An eleven-mutation harness patched the **built** checker — the artefact the suite actually imports — ran replay, and restored. **11/11 mutations caught.** The harness earned its keep by finding a twelfth gap nothing covered: if the conditional half of `enforcedOwnerOnlyActions` were dropped, `commit` and `push` would leave the floor **even with no delegation at all**, and not one test failed. The un-delegated floor is now asserted directly — it is the path degraded mode and reconciliation take, and it must be the strictest, not merely different.

**51 replay tests, 75ms. 1861 agent tests. 141/141 validators. `typecheck:tests` clean** — run against `tsconfig.test.json`, because the default project excludes `test/` and would have typechecked none of this.

## The run that stopped, and why it is recorded here

The first governed run stopped `EFFECTS_NOT_ATTESTED`. The cause was not idleness: the worker was **permission-blocked**. Its `--allowedTools` grant covers Write/Edit on six path patterns and **no Bash at all**, so every command it attempted was refused; it concluded it could not perform the two required reviews, declined to write findings it could not stand behind, asked for approval it had no channel to receive, and exited 0. Reading its transcript before retrying cost nothing and prevented a paid guess.

No configuration was changed in response. The grant list is closed — `workers.ts` refuses any pattern outside the six it enumerates — so shell access is a governance change and an owner's call, and it was not needed: the workers for `validation-cache` and `doctor-preflight` wrote both records under this same allowlist. The retry's worker did too, and the loop then **self-corrected without owner involvement**: attempt 1 left one unresolved MEDIUM, the loop rejoined the same session, attempt 2 resolved it, and all five checks passed again.

**Worker findings: 4, all resolved — 0 CRITICAL, 0 HIGH.** The MEDIUM (`F1-FIXTURE-DEDUP-SHAPE-KEY-COMPLETENESS`) was a genuine observation about the fixture dedup key, resolved with a correspondence table mapping each keyed field to the checker branch it covers and naming the maintenance rule. Its only code change is comment-only.

## Cost, reported plainly

| Run | Request | Tier / model | Estimated | Actual | Ratio |
|---|---|---|---|---|---|
| 1 (stopped) | `GKREQ-a0057e482a37fedc6168d8de` | strong / `gpt-5.6-terra` | 27,125 µUSD | **229,095 µUSD** | **8.4×** |
| 2 (approved) | `GKREQ-5552a9f7919bf02ac96187c3` | routine / `gpt-5.6-luna` | 1,342 µUSD | **18,461 µUSD** | **13.8×** |

Two things the owner should see rather than have buried:

- **The estimator is materially wrong, not slightly.** The standing carry-forward records a ~33% under-reserve (3.006 vs 4 bytes/token). These are 8.4× and 13.8×. Programme spend is now **$2.394 of $5** — at this rate the ceiling is roughly a dozen more calls, not hundreds.
- **The stopped run paid $0.229 to be told a file was missing.** `EFFECTS_NOT_ATTESTED` is mechanically detectable with zero provider spend — the record is present or it is not. Routing it to a paid reviewer bought a referral back to the owner, which is what the stop code already implied.

Neither blocks this phase. Both are recorded as carry-forward.

## Also found: the same mangled-escape defect in two tracked validators — deliberately NOT fixed here

`projectos/validators/val-projectos-worker-lifecycle-bounded1a.cjs:255` and `projectos/validators/val-cd-b4-elevated-installer-composition1a.cjs:338` contain the same literal 0x08 byte in place of `\b`. **Both regexes can never match, so both checks are vacuous while reporting PASS.** The first even carries a comment warning about this exact mangling two lines above where it falls to it.

They are excluded from this candidate on purpose: they are pre-existing, unrelated to this phase's subject, and folding them in would widen a review boundary for convenience — the thing candidate integrity exists to prevent. They are fixed immediately after this phase closes, as a separate change. Their vacuity does not weaken this phase's evidence: neither is the validator this phase requires, and both would report PASS with or without this work.

7. **Validators:** 141/141 PASS, `0 FAIL`, clean tree at the subject. Required validator `validate-no-secrets` passed.
8. **Secrets used?** No. The effects attestation records every protected effect false.
9. **Gated actions performed?** Commit and push only, under gatekeeper approval `GKDEC-GKREQ-5552a9f7919bf02ac96187c3`, bound to reviewed candidate `sha256:18cc32e3…`.
10. **Risks / carry-forward:** provider estimate under-reserve (now measured at 8.4× and 13.8×, materially worse than recorded); free re-ask unproven; no native producer for `.projectops/closure/<phase>.json`; paid dispatch for a mechanically-decidable stop code; two vacuous validators pending immediate follow-on. None blocks this phase.
11. **Decision needed:** owner/advisor review + closure.

## Final status
**gatekeeper-replay — AWAITING-REVIEW.**
