# PROJECTOS-KERNEL-PLAN-HISTORY1A — D11 at plan approval: closed phases are history

**Phase:** PROJECTOS-KERNEL-PLAN-HISTORY1A, plan v1.22 (activation `2f69d7e`). Owner, 2026-10-30, verbatim:
"Fix ProjectOS properly (Recommended)" — approving the change to the protected
`projectos/agent/src/planApproval.ts`.
**Branch:** `projectos-autonomy-bootstrap1a` (worktree `host-review-path1b`).
**Exclusions honoured:** no relaxation for any phase that is not both in the active approved plan and closed
by a committed phase record; no owner gate, closure predicate or `ownerOnlyActions` changed.

## What was wrong

Setting up the Stage 1 exit proof, the agency's plan v1.4 (adding `SEO-AGENCY-SITE-CHECK3A`) was refused:

> REFUSED (PLAN_INCOMPLETE): phase SEO-AGENCY-WEBSITE1A declares only Claude self-review; D11 requires at
> least one review by someone other than the implementer … (and the same for SEO-AGENCY-SITE-CHECK1A and
> SEO-AGENCY-SITE-CHECK2A)

All three phases CLOSED before D11 existed (`4a43c3d`). The planning engine carries every active-plan phase
into each new plan, so R5 re-judged history no review could now be added to, and a pre-D11 project could
never plan again.

## Delivered

| # | Item | Tests / pins |
|---|---|---|
| 1 | `closedHistoryPhases(sys, root, activePlan)`: a phase is history only when it is in the ACTIVE approved plan AND its record as COMMITTED at HEAD (`git show HEAD:`) names the same `phaseId`, has `status: closed`, and a history whose last step is into `closed`. Ids are judged by the phase store's own `isSafePhaseId`, so nothing path-shaped is read. | 4 unit tests: closed / open / mismatched id / unplanned / `closed_as_blocked` / no history / hand-edited history / uncommitted / store-unsafe ids; a working-tree-only record |
| 2 | `materialisePlan` skips R5 for such a phase **only while the candidate declares exactly the reviews the active plan approved for it** (trimmed, as a set). A closed id carrying a changed definition is judged by R5 again; a new phase beside it is still refused. R5 at certification (`loop/outcome.ts`, `loop/runner.ts`) is unchanged, and `closed` is terminal. | 2 tests; RR-6 with 7 named mutations; test names are validator needles |

## Reviews

- **Claude self-review** (lead).
- **ECC SECURITY review** (independent) at `e73c9f7`: **APPROVE WITH CHANGES**, no CRITICAL/HIGH. Confirmed the
  exemption cannot get unreviewed work executed or certified (runtime R5 unchanged; `closed` terminal; the
  active plan and the record are both read from the commit). MEDIUM 1 (the waiver keyed on the id alone, so
  a closed id could carry a new self-review-only definition) fixed in `8e2be81` by the unchanged-reviews
  rule; LOW 2 (provenance) partly fixed (last step into closed); LOW 3 (id rule) fixed; LOW 4 (tests,
  needles) fixed. No second round: every change after the review only tightens and is pinned.

## Verification

- Agent: `tsc` and `typecheck:tests` clean; `kernelRoleReview.test.ts` 28/28; full suite 2882/2882.
- `val-projectos-kernel-role-review1a`: PASS, 44 named mutations killed by their own rules.
- `validate-all` at `8e2be81`: 152/155 PASS (the 2 known baseline failures, plus AG-5 from the owner-approved TEMPORARY seo-agency allowlist entry for the exit proof, by design).
- `validate-no-secrets`: PASS. No provider call.

## Carried forward

- **LOW 2 remainder:** any commit that puts a well-formed closed record at HEAD counts (no committer-identity
  gate; the loop's own post-close commits use the "ProjectOS implementer" identity, so the owner cannot be
  required). Impact is bounded: a phase forged as closed never runs, and runtime R5 applies if it is
  reverted. The approval output does not list waived ids (the CLI is outside this phase's write paths).
- Nothing yet checks that closed-phase entries are carried into a new plan unchanged beyond their reviews.
