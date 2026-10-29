# PROJECTOS-KERNEL-ROLE-REVIEW1A — D11, role-separated independent review

**Phase:** PROJECTOS-KERNEL-ROLE-REVIEW1A, phase 11 of 16 of plan v1.17 (PLANDEC-5fb44adb067b3d368f744369,
activation `04bcd4a`), V4 Stage 1.1.
**Scope authority:** "D11 approved as written in 06_Plan 1.1" (owner, 2026-10-28).
**Route:** owner-direct closure, under the owner's grant ("You have full authority"; "You are running on
Admin mode, continue work without me."). No gatekeeper closure ruling was obtained, and none is claimed.

## The defect

A required review was satisfied when its name appeared in the findings record. The worker that did the
work writes that record, so an implementer could certify itself. That is how SEO-AGENCY-SITE-CHECK2A
closed with its own acceptance criteria unmet (plan v1.15).

## Delivered

| Commit | Content |
|---|---|
| `d500f82` | Rules R1–R5 (`loop/reviewRoles.ts`); loop-dispatched reviewer and loop-written record (`loop/independentReview.ts`); runner wiring; certification rule (`outcome.ts`); approval refusal (`planApproval.ts`); `execution.reviewerWorkerId` (`workers.ts`); adapter `review()`; validator |
| `bdd8a86` | Review round 1 fixes: a rejection never approvable; completion guard; untrusted framing; owner reviews not worker-creditable; full grant parsing; reviewer deny-by-default; reviewer-config candidates refused |
| `6d7faf1` | D11-C1: closure G4-9 credits independent reviews only from the reviewer record bound by the runner's `reviewerSha256` (`commands/closure.ts`) |
| `359c037` | Review round 2 fixes: ambiguous grants, authority flags, no partial review, brief re-verified, fail-closed evidence of reading |
| `3eef861` | Code-review fixes: seal-time candidate binding, rule-body pins, anchored review names, slim gatekeeper summary, CRLF restored on two files |

**Protected-file change.** `commands/closure.ts` was PROTECTED in plan v1.17. The owner approved the D11-C1
change on 2026-10-29: "go for it". Closure authority, the eligibility predicates and the decision path
are unchanged. Recorded in `docs/changes/delta_spec.md` Zone 2.

## Acceptance criteria

1. **A phase whose recorded reviewer is the implementer, or is missing, cannot reach awaiting_closure;
   tested.** Met.
   - No reviewer configured: stops at REVIEW_OUTSTANDING.
   - Reviewer is the implementer: refused at config time, and at review time when chosen by `--worker`.
   - Completion guard: a run cannot end COMPLETE with an independent review outstanding.
   - Tests are in `loopRunner.test.ts`, under "D11: role-separated independent review inside the loop".
2. **The reviewer verdict is a record written before the gatekeeper request and bound to the candidate
   commit.** Met, with one stated limit.
   - The record is written before `evidenceFor` asks the gatekeeper, and a summary of it is in that
     evidence.
   - It is bound to the base HEAD, the reviewed content digest and a per-dispatch nonce.
   - The digest is re-checked twice: after the reviewer runs, and again immediately before the candidate
     is sealed for the gatekeeper. It excludes only the two records the loop writes after the review.
   - Closure re-binds the record through the runner's `reviewerSha256`.
   - The interactive route has no commit at review time. The candidate is therefore named by base commit
     plus content digest: the same binding the gatekeeper decision already uses.
3. **A plan declaring only a worker self-review is refused at plan decide or at closure; tested.** Met
   at three points:
   - plan approval (`materialisePlan`);
   - certification (`decideContinuation`);
   - closure G4-9, which is false with no independent review.
4. **Every new rule has a validator pin and a named mutation killed by that rule.** Met.
   `val-projectos-kernel-role-review1a` has 17 rules and 37 named mutations. Each is applied in memory
   and counted only when its own rule fires (verified by calling `run()`, not by exit code).
   - RR-18 pins the rule bodies behind the call sites, after the code review showed that call-site pins
     survive a gutted function.
   - The pins are source-text checks, as in every validator here. The behavioural proof is in the tests.

## Verification

- Agent suite: 2579 of 2580 pass; the single failure is pre-existing (below). Typecheck clean.
- `val-projectos-kernel-role-review1a` PASS; `val-projectos-boot-continue1a` PASS; `validate-no-secrets`
  PASS.
- **Code scan carried from KERNEL-CONTRACT1A: no deploy, send or merge path.**
  - Merge: the only merge is `ff-only-integration` (fast-forward only, refused with no governed target; none is configured). `merge` is owner-only.
  - Deploy: no client code; one descriptor row in `plugin-catalog.ts`.
  - Mail, SMS, messaging, webhooks: none.
  - Network: one `fetch`, used only by the gatekeeper transport.

## Reviews

- **Agency `identity-access-engineer`** (AMBER, corpus `ad9264e3`, governed route): CONCERNS, 3 HIGH /
  2 MEDIUM / 1 LOW.
  - F1 (bare/variadic grants) and F2 (reviewer loads candidate config): confirmed and fixed.
  - F3 (same-user TOCTOU): confirmed, carried.
  - F4, F5: carried.
  - F6: accepted as documented.
  - `history.tsv` row appended and the workforce rebuilt.
- **ECC security-reviewer, round 1** (`d500f82`): 0 CRITICAL, 2 HIGH, 6 MEDIUM, 5 LOW.
  - H1, H2, M4, M5 and L1: fixed in `bdd8a86`.
  - M3: fixed in `6d7faf1`.
  - M1, M6 and per-criterion evidence: carried.
- **ECC security-reviewer, round 2** (recheck of `bdd8a86`): 0 CRITICAL, 0 HIGH. H1 and M4 CLOSED.
  - New N1–N4 (MEDIUM) and N5, N6 (LOW): fixed in `359c037`.
  - N7: by design.
  - N8 (no behavioural test for the completion guard): carried.
  - N9: documented.
- **ECC code-reviewer** (`f53aa57..6d7faf1`, run from `git archive` exports): **APPROVE**, 0 CRITICAL,
  0 HIGH, 6 MEDIUM, 11 LOW. Criteria 1 and 3 MET; 2 and 4 PARTIAL.
  - M1 (no seal-time binding): fixed in `3eef861`.
  - M2 (pins on call sites only; 24 of 25 extra mutations survived): fixed in `3eef861` with RR-18 body pins.
  - M3: fixed in `359c037`, and `--tools` in `3eef861`.
  - M4: fixed in part. The regex is anchored and the detail is clearer. Owner-recorded crediting is
    carried.
  - M5: owner action, below.
  - M6: the authority is recorded in the closure decision record.
  - L1 (CRLF→LF on two files): restored.
  - L3, L5, L7, L9, L10, L11: fixed.
  - L2, L4, L6, L8: carried, or accepted as defence in depth.

## Owner action before the next loop run (ECC CODE M5)

D11 is fail-closed. ProjectOS's committed `.projectops/project-config.json` names no `reviewerWorkerId`.
Until it does, every remaining v1.17 phase that requires an ECC or Agency review stops at
REVIEW_OUTSTANDING when run through the loop. Owner-direct closures are unaffected. Configuring a reviewer
is a committed `execution` change, which is the owner's. Proposed: a second worker entry,
`claude-reviewer`, with
`--allowedTools Read,Grep,Glob --setting-sources project --model sonnet` and `"reviewerWorkerId":
"claude-reviewer"`. The exit proof additionally needs a reviewer of a different provider.

## Carried forward

- **Owner-named reviews** (ECC CODE M4): "Owner review of …" and similar can be satisfied by no loop
  route, so such a phase ends at REVIEW_OUTSTANDING and closes by the owner route. Crediting them from a
  committed owner record, as owner-gate receipts work, is a later phase.
- **Stale reviewer file across a killed resume** (ECC CODE L2): the exotic case where a resumed session
  is killed between dispatch and the evidence write.
- **Closure branch tests** (ECC CODE L6): base or session mismatch, and a REJECT record at closure.
- **Paraphrased review names** (ECC CODE L8): an APPROVE that paraphrases the requested names credits
  nothing, and the stop detail does not yet say why.

- **Same-user TOCTOU** (IAM F3, ECC M6): a descendant of a check process can outlive it and race the
  review window. Needs a kill-on-close job object around checks and reviewer.
- **Git-quoted paths** (ECC M1, pre-existing): `porcelainPaths` does not unescape git's quoting, so a
  non-ASCII file name falls outside the candidate digest. This affects the gatekeeper binding too.
  Use `git status -z`.
- **Review-name to reviewer binding** (IAM F4): any configured reviewer may perform any requested review
  name.
- **ADR-K1 fields** (IAM F5): the record has no structured `actor`/`principal`/`envelopeId`. Stage 2.
- **Completion-guard behavioural test** (ECC N8): pinned by the validator only.
- **Provider distinctness:** `providerDistinct` is recorded and not refused, because one worker kind is
  built in. The Stage 1 exit proof requires it to be true.
- **Pre-existing red test:** `loopToolGrants` "Every plan v1.9 phase carries writePaths" fails on plan
  v1.17's KERNEL-HYGIENE1A writePaths (`projectos/validators/`, bare `package.json`, bare
  `rust-toolchain.toml`). It has failed since activation `04bcd4a` and needs a plan amendment before
  HYGIENE1A runs.
- **Validator registration:** `val-projectos-kernel-role-review1a` is not in `validate-all.cjs`, which is
  outside this phase's grant. Registration falls to KERNEL-HYGIENE1A.
