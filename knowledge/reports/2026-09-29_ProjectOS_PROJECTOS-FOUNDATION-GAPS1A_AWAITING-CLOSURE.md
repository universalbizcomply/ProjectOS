# PROJECTOS-FOUNDATION-GAPS1A — Evidence Pack

> Status: AWAITING-CLOSURE. The gatekeeper (ChatGPT) ACCEPTED this phase FOR CLOSURE and Murad gave phase-specific,
> non-reusable authority to record the owner closure. This report records the evidence that decision rests on. It
> closes nothing; the governed `phase advance --as owner` transition does, against a committed owner decision.

1. **Project:** ProjectOS
2. **Plan:** v1.7 `plan-b6f70f1ebc656030-b23611e2240f` — phase 1 of 1
3. **Phase:** PROJECTOS-FOUNDATION-GAPS1A
4. **Branch:** `projectos-foundation-gaps1a` (worktree `C:\dev\ProjectOS-worktrees\host-review-path1b`)
5. **Baseline:** `f4dcfac8778b1b2c78f7a9e8e166ecd3b9f7109d` (plan v1.7 activation head)
6. **Evidence subject:** `624ad21a33299a716106493c6acdfe437d4c9db2` — one commit, 8 paths, 0 Rust, 0 Cargo manifest;
   pushed by a normal fast-forward and remote-verified (0/0, diff empty).

## What was delivered

- **Unit one — the Projects screen shows the portfolio summary.** A project that is not selected now shows plan status,
  accepted/total phases, active phase, first blocker or none, whether a decision waits on the owner, next safe action,
  and liveness (RUNNING shown as running, UNKNOWN as not known, never idle). An unreadable project shows the daemon's own
  detail; a row without a summary keeps "Open to see what is happening here". Plain text only; rendering starts nothing.
  Selection is refused while governed work runs, so before this the owner could see nothing about any other project
  during a run. Portfolio validator rule 7 pins the summary being handed to the render.
- **Unit two — where windows-client-admission may be enabled.** A Cargo manifest scanner pins the accepted placement:
  in no default list and no fixture graph; one enable edge (windows-local-ipc `windows-live-ipc`); `windows-live-ipc`
  enabled only by service-host and the Control Center native crate. It enumerates every tracked manifest, reads every
  dependency table, and fails closed on untracked or absolute path dependencies, any workspace, or a vacuous scan.

## Validation at the subject

- Control Center 890/890; focused Projects screen tests 12/12; Control Center typecheck clean.
- Required validators PASS: val-projectos-portfolio-read-only1a, val-windows-service-identity-proof-3kideb,
  val-windows-local-ipc-capability-b3, validate-no-secrets.
- Named mutation battery (off-tree): 14/14 killed by their own named rule, 2/2 negative controls clean, byte-for-byte
  restore, git status unchanged.
- validate-all: 145 registered, 143 PASS, 2 FAIL — only the accepted historical non-passes validate-desktop-e2e and
  val-cd-b4-sealed-expected-window-facts1a, messages unchanged.

## Reviews

- ECC CODE: WARN (one MEDIUM, one LOW) → APPROVE.
- ECC SECURITY: APPROVE (five confirmations) with one MEDIUM → WARN (one MEDIUM) → APPROVE.
- Three MEDIUMs fixed with named fail-closed refusals, each proven by a killed mutation; LOW on rule 7 accepted.
- Open: 0 CRITICAL, 0 HIGH, 0 MEDIUM.

## Owner statement (owner gate 6), verbatim

"If any credential or token rotation is required, it will be completed after ProjectOS project completion."

## Carried forward

LOW: rule 7 checks the render call, not the rendered text (render tests carry it); the scanner could move from the 3kideb
validator to validators/lib; case-mismatched path spellings fail closed; workspace inheritance is refused, not modelled;
projectsModel.ts header comment is stale. The plan v1.7 deferrals stand, each with its trigger. Rotation: per the owner
statement above.

## Protected effects

None: no production, provider, spend, credential, messaging, payment, database, service, ACL, registry, force push or
merge. No live specialist. Autonomy Bootstrap not started.
