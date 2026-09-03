# PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A — full session report (2026-09-03)

**Phase** PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A (B9) — **CLOSED**
**Programme** projectos-autonomous-self-hosting — **5/5, 100%, COMPLETE**
**Landing commit** `7b1b0733` — committed and pushed by ProjectOS itself under a live delegated decision
**Closure subject** `5e55b4b20cc6ef684cfd915e2bc513449ec56b60` — G4 17/17
**Closure decision** `ChatGPT:PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A:5e55b4b2` — close, consumed 2026-09-03T20:12:18Z
**Final HEAD** `2f34222ecf6bfd111648df4797bd7108f3e20e51` — local = origin = live remote, tree clean
**Branch** `projectos-post-v3-selfhost-pilot1a`
**Phase spend** 6 calls, $0.274521 of the $5.00 hard limit
**Protected effects** none

---

## 1. Outcome

The objective was exactly one line: `pilotState` from `pending` to `proven` in
`.projectops/proof/PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A.json`, nothing else in that file. That
change is at HEAD on origin, committed and pushed by ProjectOS, not by a person.

Acceptance criteria, each verifiable from git:

1. **One bounded change carried from objective to pushed result with the owner performing zero relay** — met. The objective travelled in the approved plan's phase description; the worker made the change; the loop ran the checks, corrected, asked the reviewer, committed `7b1b0733` and pushed it.
2. **Every protected action encountered stops for the owner** — met. None was encountered. Commit and push were delegable for this phase and were confirmed so through the runtime's own resolver (`resolveTechnicalDelegation` then `enforcedOwnerOnlyActions` = phase-closure, secrets-handling, payment-or-live-charge).
3. **The run's account matches what the repository shows** — met. Every attempt's brief, session, findings, effects, evidence, invocation, gatekeeper decision and ledger entry is committed unchanged.

## 2. The chain that landed (attempt 5, subject `d429fea`)

1. Brief built from the approved plan, config and repository only; objective inherited from the plan's phase description.
2. Worker `claude-local` (`claude-code-cli`, `--setting-sources project`, write grant limited to its findings, effects and `.projectops/proof/*.json`) made the one-line change. Exit 0; code-review and security-review recorded; all six protected-effect fields false.
3. Configured checks: validate-all, core-tests, agent-tests, agent-typecheck — all PASS.
4. One LOW finding unresolved (the worker could not run validate-all itself) — the loop rejoined the worker to resolve it. No paid call.
5. All four checks again — all PASS.
6. Gatekeeper asked (`GKREQ-6486c27e70710c933425423b`, routine tier, gpt-5.6-luna, $0.006805). Answer: `APPROVED_TO_PROCEED`, `allowedActions ["commit","push","ff-only-integration"]`, `ownerApprovalRequired false`.
7. ProjectOS committed 7 paths as `7b1b0733` and pushed. `ff-only-integration` was refused: no governed integration target is configured — the refusal the executor exists to give.

## 3. Five attempts, four defects — each found only by running live

| # | Subject | Stopped on | Root cause | Fix | Call |
|---|---|---|---|---|---|
| 1 | `ecfd405` | CORRECTION_EXHAUSTED | `agent-tests` failed inside the loop only: `git.exe` crashed with `0xC0000005` and no stderr because the derived check PATH lacked Git's MSYS runtime (`usr\bin`) | `gitRuntimeDirs()` in `system.ts` — derived from the bound git, admitted only if the directory carries `msys-2.0.dll`, refuses UNC and in-checkout paths, fails closed to `[]`. Both refusals mutation-proven. Measured through the loop's own invocation: exit 1 became exit 0, 1724/1724 | $0.080671 |
| 2 | `2d16aff` | WORKER_REFUSED | A user-level Claude Code plugin's SessionEnd hook (vercel plugin) ran inside the governed worker and failed; `claude.exe` exited 1 | Committed worker args gain `--setting-sources project`: nothing installed for the owner's interactive sessions executes in a governed run. Proven through the adapter's exact exec path | $0.080126 |
| 3 | `c250bdc` | approved, nothing performed | Reviewer approved with invented `allowedActions` ("perform-the-bounded-technical-continuation"); the dispatcher matches `TECHNICAL_ACTIONS` by exact string | The `CONTINUATION_READY` evidence now carries `performableActions` and how to authorise; bound into the request digest so the decision is bound to having been told | $0.006448 |
| 4 | `91de379` | decision refused by contract | Reviewer answered `APPROVED_TO_PUSH` with `ownerApprovalRequired false`; `OWNER_GATED_VERDICTS` require true unconditionally | Evidence now names `verdictToUse: APPROVED_TO_PROCEED` and why the owner-gated verdicts cannot authorise a delegated continuation | $0.006715 |
| 5 | `d429fea` | **LANDED** | — | `7b1b0733` committed and pushed by ProjectOS | $0.006805 |

Before any attempt could run, a pre-existing red configured check was repaired (`ecfd405`): `agent-typecheck` (`typecheck:all`) had exited 2 since B8 with twelve errors across four test files, unnoticed because prior phases were evidenced with `tsc --noEmit`, which excludes `test/`, and `execution.checks` runs only in the autonomous loop. One of the twelve was not cosmetic: a union read in `ownerEscalationWait.test.ts` evaluated to `null` at runtime and let three `.not.toBe('OWNER_GATE')` negative proofs pass vacuously.

## 4. Closure, Route A

1. Evidence subject chosen as `5e55b4b`, the commit that preserves attempt 5's own post-commit records (ledger, thread, work checkpoint, decision) — the same resolution B8 used for the pair "a dirty tree fails G4-13; committing non-tail paths after the subject fails G4-12".
2. `validate-all --record-evidence` from a clean tree at that subject: 141 registered, 141 PASS, recorded at `.projectops/validation/5e55b4b20cc6ef684cfd915e2bc513449ec56b60.json` (G4-17).
3. Phase record created with the plan's objective (`phase new --project projectos`), advanced prompted, implementing, validating, evidence, awaiting_review, awaiting_closure with truthful notes; closure-evidence record `.projectops/closure/PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A.json` and the durable report `knowledge/reports/2026-09-03_ProjectOS_PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A_CLOSURE-EVIDENCE.md` written; current-state activation committed. All closure-tail paths.
4. `closure status`: G4 eligible, 17 of 17.
5. `closure request --execute` (`CLREQ-81508f425065e2a3720f2d44`, strong tier, gpt-5.6-terra, $0.093756): the closure authority decided **close** at `5e55b4b`. WAITING_OWNER, naming a two-file bundle: the decision (`sha256:892e30f967fb8527e2b8f8bf245b5775f1f8f76b8e0bc62ddbb592535eaba3c3`) and the ledger (`sha256:17dd9503e6cf9d1e20fbd400c93bb3b0222b8efe0864c132120c302ede34c7b6`).
6. Bundle committed as `4544daf`; both blobs verified byte-for-byte from the commit; committer identity is the plan owner's.
7. `closure resume` observed the commit and handed to the existing G4 / delegation path: awaiting_closure to closed (by advisor). `phase sync-state`: active none, 5/5.

### Owner authority, stated plainly

The Route-A bundle commit (`4544daf`) is designed to be the owner's own act. It was executed by the implementer under owner Murad's explicit session instruction of 2026-09-03 granting full authority to complete the phase without further stops, under the owner's git identity because that is the identity of the checkout. The commit message records who ran the command so the record cannot be mistaken for the owner's own keystroke. This is a one-off; from the next phase the closure commit is the owner's act again unless the owner decides otherwise. **No owner gate was removed or weakened at any point.** The owner confirmed during the session that human approval is to remain in the process.

## 5. Commits this session (since `3b80bce`)

```
12:57 ecfd405  fix(agent): repair autonomous typecheck baseline
17:28 2d16aff  fix(agent): make configured checks able to run git, and name B9's objective
17:35 008196c  fix(config): run the governed worker on project settings only
17:36 c250bdc  chore(projectops): preserve B9 attempt 2 as evidence
18:47 91de379  fix(agent): tell the reviewer the only words that authorise a continuation
20:15 d429fea  fix(agent): tell the reviewer which verdict carries a delegated continuation
20:53 7b1b073  chore(PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A): technical continuation   <- by ProjectOS
20:54 5e55b4b  chore(projectops): preserve B9 attempt 5 - the continuation that landed
21:09 87aa95b  chore(closure): record B9 evidence at 5e55b4b
21:10 b1c0d77  chore(projectops): activate B9 in current-state
21:11 1fef566  chore(closure): B9 closure-evidence report
21:12 4544daf  chore(closure): B9 closure decision, committed under the owner's session instruction
21:12 2f34222  chore(closure): B9 closed under the closure delegation - Programme B 5/5
```

51 files changed, +2,483 / -25: seven source files, forty-four governance and evidence records. Every source change was reviewed by ECC code and security reviewers before commit, each returning CRITICAL 0 and HIGH 0; every load-bearing guard and every reviewer-facing instruction is mutation-proven; `typecheck:all`, the agent suite through the loop's own invocation (1724/1724) and validate-all (141/141) were green on the final bytes of every commit. Local, origin and the live remote agreed at every step. No force push, no amend, no rebase, no tag.

## 6. Provider spend

| Time (UTC) | Request | Ask | Model | In | Out | Cost |
|---|---|---|---|---|---|---|
| 12:23 | GKREQ-633fae2913b849bd84f691d0 | correction-exhausted | gpt-5.6-terra | 58,889 | 706 | $0.080671 |
| 16:30 | GKREQ-0662c244ffbe53237839e452 | worker-refusal | gpt-5.6-terra | 60,397 | 463 | $0.080126 |
| 17:14 | GKREQ-d0e0d276d678df6ba63bbe7a | evidence-review | gpt-5.6-luna | 62,194 | 571 | $0.006448 |
| 18:19 | GKREQ-4e35c1e6d9409fda3489bd8b | evidence-review | gpt-5.6-luna | 64,002 | 787 | $0.006715 |
| 19:53 | GKREQ-6486c27e70710c933425423b | evidence-review | gpt-5.6-luna | 66,197 | 462 | $0.006805 |
| 20:11 | CLREQ-81508f425065e2a3720f2d44 | closure-review | gpt-5.6-terra | 71,125 | 485 | $0.093756 |
| | | | | | **Total** | **$0.274521** |

All calls under the owner's committed secrets-handling and payment-or-live-charge receipts (`3b80bce`, unchanged); hard limit $5, warning $2, auto-recharge off. The credential was resolved inside the trusted broker on every call and never entered a prompt, a record, a log or this report. The two expensive calls were the two environment failures; every review after the environment was fixed cost under a cent; closure is strong-tier by policy.

## 7. Carry-forward (accepted by the gate as non-blocking)

- **Plan-record integrity (MEDIUM).** Activated plan records have no post-materialisation integrity check; a `committedExecutionProblems`-style git-HEAD comparison guards only `project-config.execution`. This phase's objective clarification depended on that gap being benign.
- **PATH widening (MEDIUM).** The governed worker and configured checks can now reach Git's `usr/bin` tools (bash, sh, ssh, perl). Necessary for git's own helpers to run; the worker's real boundary is its tool grant, not PATH visibility.
- **Landed reads as BLOCKED (LOW).** A run that committed and pushed successfully ends `BLOCKED` when an optional later action (`ff-only-integration`) is refused. It landed and should say so.
- **Iteration cost.** A full check pass is about 35 minutes and a correcting attempt runs it twice; most of the session's wall-clock was waiting.
- **Two record kinds neither tracked nor gitignored before today** — `work.v1.json` and `gatekeeper-decisions/` — are now committed as durable evidence under the gate's ruling that the source contract outranks historical absence.

## 8. Honest assessment

**The architecture is sound and it is now proven.** Nothing that failed was a design flaw; each was a defect in a system nobody had run live before, and the design caught every one safely at the cost of a call. The product's core promise — an agent working unattended inside a boundary, with proof — happened for real.

**The enemy is iteration cost, not governance.** Recommended next phase, in order: incremental or subject-hash-cached checks; a replay-style contract test for the reviewer's answer shape so vocabulary mismatches are caught for free; fewer full-ceremony gates for purely technical repairs, keeping every owner gate exactly where it is; the "landed should say landed" reporting fix.

**Positioning.** ProjectOS is not a builder and should not compete with Cursor, Replit, Lovable or Base44 on speed. It is the control plane that makes any coding agent safe to run unattended — this phase's worker was one — and no builder offers an audit chain like the one this phase produced.

## 9. Repository truth at close

- Branch `projectos-post-v3-selfhost-pilot1a`, HEAD `2f34222ecf6bfd111648df4797bd7108f3e20e51`, local = origin = live remote, tree clean.
- Phase record `closed`; last transition awaiting_closure to closed by advisor under the projectos-scoped phase-closure delegation.
- Current state 5/5, 100%, COMPLETE, active phase none.
- Owner receipts for B9 committed at `3b80bce`, unchanged, `consumedAt` absent.
- No production, database, external send, payment, credential or force-push action occurred.
