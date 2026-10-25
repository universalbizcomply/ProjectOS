# PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A — closure evidence

**Phase** PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A (Programme B9, autonomous self-change pilot)
**Subject** `5e55b4b20cc6ef684cfd915e2bc513449ec56b60`
**Landing commit** `7b1b0733` — committed and pushed by ProjectOS itself under a live delegated decision
**Branch** `projectos-post-v3-selfhost-pilot1a`
**Plan** `plan-98675c78dc8b3175-786d909d1ccb` v1.1, PLAN READY
**Status at writing** `awaiting_closure`

This report is evidence. It closes nothing; the decision is the delegated closure authority's and is
recorded at `.projectops/closure/decisions/PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A.json`.

---

## What the phase set out to do

Prove that ProjectOS can carry one bounded change to itself from objective to pushed result without
the owner relaying anything between Claude and the gatekeeper. The bounded change: set `pilotState`
from `pending` to `proven` in `.projectops/proof/PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A.json`, and change nothing else in that file.

## What happened

Five live attempts. Each of the first four stopped safely on a real defect that only a live run could
find, and each was fixed permanently before the next. The fifth landed.

| Attempt | Subject | Stopped on | Fix |
|---|---|---|---|
| 1 | `ecfd405` | `agent-tests` failed inside the loop: git.exe crashed with 0xC0000005 and no stderr because the derived PATH lacked Git's MSYS runtime | `gitRuntimeDirs()` — marker-gated, fail-closed, mutation-proven |
| 2 | `2d16aff` | worker exited 1: a user-level Claude Code plugin's SessionEnd hook ran inside the governed worker | worker runs on project settings only |
| 3 | `c250bdc` | reviewer approved with invented `allowedActions`; ProjectOS performed nothing | the evidence names the dispatcher's action vocabulary |
| 4 | `91de379` | reviewer used the owner-gated verdict `APPROVED_TO_PUSH` | the evidence names the verdict that carries a delegated continuation |
| 5 | `d429fea` | — | **landed**: `APPROVED_TO_PROCEED` naming commit and push; ProjectOS committed `7b1b0733` and pushed |

Attempt 5 in full: the worker (`claude-code-cli`, project settings only, tool grant limited to its
findings, effects and the proof surface) made exactly the one-line change; the loop ran validate-all,
core-tests, agent-tests and agent-typecheck — all green; it rejoined the worker to resolve one LOW
finding with no paid call; ran all four checks again — all green; asked the delegated reviewer; and on
`APPROVED_TO_PROCEED` with `allowedActions [commit, push, ff-only-integration]` it committed seven
paths as `7b1b0733` and pushed. `ff-only-integration` was refused because no governed integration
target is configured — the refusal the executor exists to give. The owner performed zero relay.

## Evidence, checkable

- **Validators**: `validate-all --record-evidence` ran at `5e55b4b` from a clean tree — 141 registered,
  141 PASS — recorded at `.projectops/validation/5e55b4b20cc6ef684cfd915e2bc513449ec56b60.json`.
- **Checks**: the loop's own evidence for the landing run, committed inside `7b1b0733` at
  `.projectops/execution/PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A-d429fea9f5b8-e55eb6a7.evidence.json`: four checks, all PASS, twice.
- **Reviews**: gatekeeper decision `GKDEC-GKREQ-6486c27e70710c933425423b` (ChatGPT, gpt-5.6-luna);
  the worker's code-review and security-review in its findings record, all resolved. Every ProjectOS
  source change made to reach this run was reviewed by ECC code and security reviewers before commit,
  each returning CRITICAL 0 and HIGH 0.
- **Protected effects**: NONE, attested on every attempt.
- **Provider spend for the phase**: 5 calls, $0.180765, under the owner's committed secrets-handling and
  payment-or-live-charge receipts, within the $5 hard limit; no credential entered any prompt or record.

## Acceptance criteria

1. *One bounded change carried from objective to pushed result with zero relay* — **met**, `7b1b0733`.
2. *Every protected action encountered stops for the owner* — **met**: none was encountered by the
   loop; commit and push were delegable for this phase and were performed under a live decision.
3. *The run's account matches what the repository shows* — **met**: every attempt's brief, session,
   findings, effects, evidence, invocation, decision and ledger entry is committed unchanged, and the
   proof artifact at HEAD reads `proven`.

## Carry-forward, accepted by the gate

- Activated plan records have no post-materialisation integrity check (MEDIUM).
- The governed worker and configured checks can now reach Git's `usr/bin` tools (MEDIUM).
- A run that committed and pushed successfully ends `BLOCKED` when an optional later action is
  refused; it landed and should say so (LOW, reporting).
- Iteration cost: a full check pass is ~35 minutes and a correcting attempt runs it twice.

## Session authority

The implementer's own commits in this phase — the four repairs, the evidence preservation, and the
closure records — were made under the owner's explicit session instruction of 2026-09-03. The
technical continuation that landed the change was ProjectOS's, under the committed delegation.
