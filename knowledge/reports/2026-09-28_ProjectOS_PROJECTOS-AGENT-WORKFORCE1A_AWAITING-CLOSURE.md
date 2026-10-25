# PROJECTOS-AGENT-WORKFORCE1A — Evidence Pack

> Status: AWAITING-CLOSURE. The gatekeeper (ChatGPT) ACCEPTED this phase FOR CLOSURE and Murad gave phase-specific,
> non-reusable authority to record the owner closure. This report records the evidence that decision rests on. It
> closes nothing; the governed `phase advance --as owner` transition does, against a committed owner decision.

1. **Project:** ProjectOS
2. **Plan:** v1.6 `plan-01053932764c573b-68d21d6830c1` — phase 3 of 3
3. **Phase:** PROJECTOS-AGENT-WORKFORCE1A
4. **Branch:** `projectos-agent-workforce1a` (worktree `C:\dev\ProjectOS-worktrees\host-review-path1b`)
5. **Baseline:** `69fb141522f1d4c57870ee166048cb51d4036ae7` (PATH1A + PATH1B closure tip)
6. **Evidence subject:** `8f7c326d8643ba1fb478c8265c422538d2f34e83`.
   - Ancestry `69fb141 → 5d68070 → 8f7c326`, linear, single-parent.
   - `5d68070` builds the workforce; `8f7c326` closes the pre-push review findings.
   - Pushed by a normal push to a new branch and remote-verified (remote = local = `8f7c326`, diff empty).
7. **Engineering evidence:** `docs/speed/agent-workforce1a-evidence.md` at the subject (reconciliation table, every
   review finding and its disposition, residuals).
8. **Closure evidence:** `.projectops/closure/PROJECTOS-AGENT-WORKFORCE1A.json`.

## What was delivered

- Owner → ProjectOS governance → exactly ONE project leader per governed project → the minimum specialist team
  ProjectOS selects. All 279 pinned agents are registered; 17 are fixture-eligible, 6 restricted, 256 ineligible.
- Leader identity is separate from its model; lease-bound takeover by ProjectOS only; generation voiding.
- Deterministic team selection from governed facts (phase risk, required reviews, browser proof, every path the
  scope names and the candidate changed); the leader may only raise risk.
- Least-privilege per-task grants; protected actions refused by the gates that own them; no peer-to-peer channel;
  governance read only from the owner-accepted commit on `origin`; call/cost ceiling; hash-chained, byte-bounded log.
- `projectos run` selects the team automatically; `projectos workforce roster|team|check-update|acquire|evaluate`.
- Nothing is activated: fixture engines only, `liveExecutionActivated: false`.

## Validation at the subject

- The 6 plan-required validators PASS by name: val-projectos-agent-workforce1a, val-projectos-trust-boundary1a,
  val-projectos-gatekeeper-contract1a, val-projectos-live-gate-owner-floor1a, val-projectos-worker-lifecycle-bounded1a,
  validate-no-secrets.
- validate-all 145 registered, 143 PASS, 2 FAIL outside this phase (validate-desktop-e2e environmental;
  val-cd-b4-sealed-expected-window-facts1a, PATH1B carry-forward). The aggregate is not claimed as passing.
- Workforce validator mutation battery v2: 90/90 killed by the named rule.
- Agent tests 2341/2341; workforce tests 159/159; typecheck:all PASS; core 765/765 (core unchanged).

## Reviews

- ECC CODE: 5d68070 WARN (1 HIGH) → 8f7c326 **APPROVE** (0 findings).
- ECC SECURITY: 5d68070 APPROVE (3 LOW) → 8f7c326 **APPROVE** (1 LOW, accepted residual).
- Multi-agent systems architecture recheck: BLOCK → fixed before 5d68070; CONCERNS on 5d68070 (N1 HIGH) → fixed.
- application-security-engineer: CONCERNS on 5d68070 (5 MEDIUM) → fixed or stated pre-activation.
- Agency round-2 rechecks of 8f7c326: NOT DELIVERED (wrapper hand-back limitation); accepted by the gatekeeper as a
  non-blocking tooling limitation.
- Unresolved: 0 CRITICAL, 0 HIGH.

## Catalogue acquisition (criterion 34)

- Refused by the Agency guard from the assistant session, as the plan requires; run once by Murad in his own terminal.
- Verified from provenance metadata only: commit `ad9264e309bd5e5422c04784372d7841b1e5d604`, 279 agents, 18 divisions,
  MIT, catalogue digest `56ad321263748be61c4255f4af70d041381fffacd73eef027db6ea6f2c9be2ba` (recorded = recomputed =
  registry), 0 per-agent mismatches, 281 read-only files, no links. The developer tool's agent directory is unchanged.
- No upstream code executed, no model or provider called, no specialist activated.

## Mandatory before live specialist execution or autonomy-bootstrap certification

B2 and B5 (windows-client-admission non-default, and outside the ipc test-fixtures graph), both mutation-proven; an
owner-governed route for escalated contradictions plus ledger checkpointing; ProjectOS-assembled prompts with every
external or free-text input framed; live engines outside the store lock; Host custody of the call/cost ceiling before
spend; detect a `--cache` inside another worktree; repair the agency-specialist report hand-back. Also retained: stale
no-production-mint comments, B15 admitted-cost wording, F5/F6, the packaged-Git pin, credential/token rotation where
genuinely required, the sealed-window validator correction, the acquisition link-check/read LOW residual.

## Protected effects

None: no production, provider, spend, credential, messaging, payment, database, service, ACL, registry, force push or
merge. The one write outside the repository was the owner-run read-only acquisition into the approved quarantined cache.
