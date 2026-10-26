# PROJECTOS-FINISH-ZERO-TOUCH-CLOSURE1A — evidence

Phase 5 of 6 of plan v1.13, amended by v1.14 (`de6dd61`). The owner approved v1.13 on 2026-10-26 in
answer to the proposal that ProjectOS commit a delegated closure decision itself: "I have given you full
authority". Claude (lead) implemented it directly, without dispatching a governed worker. This document
claims no ChatGPT gatekeeper ruling for this phase.

## What changed

1. **A new owner-granted delegation scope, `closure-decision-commit`** (`core/src/closureAuthority.ts`).
   It is delegable but is not a closure scope, so on its own it closes, decides and names nothing.
2. **The grant counts only when the owner made it.** `resolveClosureCommitDelegation`
   (`agent/src/loop/gatekeeperConfig.ts`) reads the committed delegation with the same reader and
   checker as every other scope. It then requires the last commit touching
   `.projectops/authority/closure-delegation.json` to pass the owner-commit identity rule, with no
   exception allowed. A delegation that ProjectOS committed, for example an implementer edit riding a
   reviewed technical commit, grants nothing (ECC SECURITY H1).
3. **ProjectOS commits the delegate's decision, but only for an answer produced in its own call.**
   - When the grant holds, the mode is unattended (broker or Host route), and the phase's owner gates
     leave commit and push delegated, `closure request` commits and pushes exactly the presented
     bundle (the decision and the ledger entry) as `ProjectOS implementer`. It then runs
     `closure resume` itself.
   - An interactive answer is a file that any process able to write the checkout can place. So it
     stays the owner's to commit, grant or not (ECC SECURITY C1).
4. **Resume accepts that one identity, and only then.**
   - `closure resume` passes exactly the ProjectOS commit identity (name and email) to the owner-commit
     check, and only under the grant and for an answer produced in the call. That is checked
     against an allowlist: the committed mode is unattended, and the wait is either Host-attested, or
     carries no provenance (the broker route stamps none) on a project whose committed configuration
     opts in to the broker (ECC SECURITY round 2, M1).
   - Byte matching, bundle bounding and the refusal of every other implementer-shaped identity are
     unchanged.
   - After the existing delegated phase advance closes the phase, ProjectOS commits the post-close
     records: the decision's `consumedAt`, the phase record and the governed state. This fixes D2
     from EXTERNAL-PROOF1A for granted projects.
   - The output and the durable history say whose commit was accepted.
5. **A closure answer's `decidedAt` must be a time it could have been given** (D1 from
   EXTERNAL-PROOF1A).
   - It must be a full ISO-8601 instant with a zone.
   - It must be no later than the longest gate wait (240 minutes) plus a 10-minute skew after the
     question.
   - An answer produced in the call may not predate the question by more than the skew.
   - The closure prompt now tells the authority the question time and this form, so a real answer
     can meet it, in both the priced body and the sent body (ECC CODE H1 and SECURITY M1). That
     required plan v1.14, which adds `transports/closureResponses.ts` to the phase's paths.
6. **Without the grant nothing changes.** The owner commits the decision under the existing identity
   check.

## The agency governance item (D6 from EXTERNAL-PROOF1A): resolved as documentation

The agency's `forbiddenActions` (`use-openai-api`, `use-secrets`) and `noApiPolicy: true` govern the
worker, meaning what the project's own code and its implementer may do. They do not govern the
gatekeeper.
- The project plan template forbids `use-openai-api` for every project
  (`templates/project-plan.template.json`).
- The plan evaluator requires `noApiPolicy: true` for every plan.
- So refusing the brokered gatekeeper on those declarations would make the gatekeeper impossible for
  every project.
- The gatekeeper's provider use is governed separately, by the committed `gatekeeper.json` (commercial
  approval and the budget hard stop), the broker opt-in, the installation allowlist and the phase's
  secrets-handling receipt.

No code change was made for D6.

## Acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | The scope is delegable, closes nothing alone, and is judged by the same checker and reader | Validator ZT-1; `gatekeeperDelegationAuthority` J (the scope list is exactly the union; not in CLOSURE_SCOPES); ZT-2 (the one reader, plus the owner's own commit of the delegation) |
| 2 | Granted and delegated: the bundle is committed by ProjectOS, the phase closes, the post-close records are committed; otherwise the owner commit is required | E2E "ProjectOS commits the decision, the phase closes and the close is persisted — no owner act" (unattended, Host route: 2 ProjectOS commits, tree clean, remote in sync). E2E "without the grant…", "a delegation ProjectOS committed itself grants nothing", "with the grant but no technical delegation…". Unit tests in `zeroTouchClosure.test.ts` (reserved commit and push, absent or invalid grant, a foreign dirty path) |
| 3 | Resume accepts the ProjectOS identity only under the scope, and still refuses other identities, byte mismatches and extra paths | `zeroTouchClosure.test.ts` identity tests; E2E: resume refuses a ProjectOS-identity commit without the grant, and for an interactive wait with the grant; the existing byte and bounding tests unchanged |
| 4 | An invalid or out-of-window `decidedAt` is refused | Core `closure-transport` window tests (the live agency value `2025-02-15T00:00:00Z` refused); `closureTurn` "refuses an invented decision time"; the request sent names the question time. **Deviation, recorded:** an interactive answer has no lower bound beyond its form, because it may have been saved while an earlier run waited, and an interactive answer is never committed by ProjectOS, so the owner reads it |
| 5 | Pins and mutations; suites; validate-all; reviews | Validator section (13) ZT-1..ZT-6, MP-6 and MP-7 updated; 17/17 named mutations killed by their rule, 11 also by a test (`C:/dev/ProjectOS-candidate-backups/finish-zero-touch-closure1a/tools`); agent 95 files / 2532, core 772, typecheck:all clean; validate-all 145/147 (the two known: `validate-desktop-e2e`, `val-cd-b4-sealed-expected-window-facts1a`); reviews below |

## Reviews

- **Round 1.**
  - ECC CODE: WARNING. 2 HIGH (the model was never told the time; interactive answers would become
    self-certifying under the grant), 2 MEDIUM, 5 LOW.
  - ECC SECURITY: NOT approved. 1 CRITICAL (C1, the same interactive self-certification), 1 HIGH
    (H1, ProjectOS could mint its own grant through a reviewed technical commit), 2 MEDIUM (the
    broker would fail closed on real answers; the committed path sets were not pinned), 3 LOW.
- **One fix round:**
  - the unattended-only gate on request and the interactive-provenance gate on resume;
  - the owner's own commit of the delegation required;
  - the question time stated in the prompt (plan v1.14);
  - exact path sets pinned (ZT-4) and the prompt pinned (ZT-6);
  - truthful output and history wording;
  - behavioural tests for each finding;
  - the doc comment moved back.
- **Round 2.**
  - ECC CODE: APPROVE, 0 CRITICAL, 0 HIGH, 0 MEDIUM, 5 LOW.
  - ECC SECURITY: approve, 0 CRITICAL, 0 HIGH, 1 MEDIUM, 2 LOW.
  - The MEDIUM was that the resume gate was a denylist on provenance. It is now the allowlist in point
    4 above. A new test, "a wait whose provenance was stripped …", is refused even under the grant;
    mutation Z17 is killed by that test and by ZT-4.
  - The reviewer's suggested Host-only allowlist was not taken, because the broker route stamps no
    provenance and would never qualify.

## Carried forward

- **A broker answer has no positive provenance class** (CODE round 2, L1). It is accepted as "no
  provenance on a broker-opted unattended project". Inside that class, a hand-edited wait that drops
  a Host stamp is indistinguishable from a broker answer. That is the same forgery class as spoofing
  the owner's git name (`tamperProof: false`). Fix: give the broker route its own provenance value in
  core and allowlist it by name.
- **Git identity environment variables** (SECURITY round 2, L1). `GIT_AUTHOR_*` and
  `GIT_COMMITTER_*` in the environment would override ProjectOS's `-c user.name` on its commits. A
  process that set them could make a ProjectOS commit carry the owner's name. This needs deliberate
  action, so it is again the `tamperProof: false` class. Fix: drop those variables from the
  environment for commit calls (`system.ts`, outside this phase's paths).
- **The owner check compares the name only**, as it always has (SECURITY round 2, L2). The residual
  stays with the owner, as the existing comment records.
- **The brokered route under the grant has no end-to-end test.** The Host route does. The agency live
  run in EXTERNAL-PROOF2A is the brokered proof.
- **A later non-owner commit touching the delegation revokes the grant**, failing closed. A squash or
  merge committer, such as a hosted-forge noreply identity, would do it. Owner runbook: commit the
  delegation directly.
- **A failed zero-touch commit falls back to the owner ask** (SECURITY round 1, L2). A rejected push
  reports the push and `projectos continue`.
- **The 240-minute limit is duplicated** in core and `commands/run.ts`, which is outside this phase's
  paths.
- **File sizes:** `closure.ts`, `gatekeeperConfig.ts` and `hybridClosureReconcile.test.ts` exceed 800
  lines; the first two already did.
- **`validate-projectos-recovery-plan-authority1a.cjs` mirrors the delegable vocabulary** without the
  new scope. It judges only ProjectOS's own delegation, which does not carry it.

## Verification commands

    npx vitest run                         (projectos/agent, projectos/core)
    npm run typecheck:all                  (projectos/agent)
    node projectos/validators/val-projectos-boot-continue1a.cjs
    node -e "console.log(require('./projectos/validators/val-projectos-closure-transport1a.cjs').run())"
    node projectos/validators/val-projectos-live-gate-owner-floor1a.cjs
    node projectos/validators/validate-no-secrets.cjs
    node projectos/validators/validate-all.cjs
    node C:/dev/ProjectOS-candidate-backups/finish-zero-touch-closure1a/tools/mutation_battery.cjs --behaviour
