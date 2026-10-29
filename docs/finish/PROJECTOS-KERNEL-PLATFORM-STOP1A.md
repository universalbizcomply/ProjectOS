# PROJECTOS-KERNEL-PLATFORM-STOP1A — platform emergency stop

**Phase:** PROJECTOS-KERNEL-PLATFORM-STOP1A, phase 13 of 16 of plan v1.18 (PLANDEC-cf8eafee0ef2759c4e8efadb,
activation `e1e1e72`), V4 Stage 1.3.
**Scope authority:** "Full stop, all files (Recommended)" (owner, 2026-10-29). The lift design is the owner's
"Typed confirmation now" (2026-10-29).
**Route:** owner-direct closure under the owner's grant ("You have full authority"; "continue work without me").
No gatekeeper closure ruling was obtained, and none is claimed.

## Delivered

| Commit | Content |
|---|---|
| `d77f20a` | The stop record outside every repository, one check that never runs git, and a deny-by-default CLI gate. Checks at every runner site, in closure, plan, reconcile and phase, in delegations and spend admission, in the technical continuation, and in the Control Center sidecar. `projectos stop` and a two-step owner lift. |
| `8cbd784` | Review fixes. The typed-confirmation lift (interactive terminal, retyped stop id, single-file commit, bound to its project). The stop is never dropped. The state directory comes from the operating system. A re-check runs before every commit, push and fast-forward. Messages are honest. The test suite is isolated. |
| `f3690e4` | Recheck residuals. A rename cannot pass the single-file check (`--no-renames`). The binding is to the installation project. The statement names the same-account residual. There is no injectable confirmation in production. |

## How it behaves

- **Engaging** needs no authority: `projectos stop`, the MCP `stop-work` tool, or the Control Center.
- **While engaged,** only read-only commands run. Everything that can start work, spend, commit, push, close,
  or change a plan or phase is refused. That includes dry runs and in-process calls from the Control Center.
- **Delegations** are suspended at their one resolver, and no committed record is edited.
- **Lifting** takes two steps.
  1. `stop lift --stop <id>` writes a lift record.
  2. The owner commits exactly that one file.
  3. A second `stop lift` in an interactive terminal asks for the stop id to be retyped. It checks the commit
     identity against the plan's owner and the binding against the recorded project.
- **Every output** states the following:
  - completed external effects are not reversed;
  - a worker that is already running is not interrupted, only stopped at its run's next check;
  - anything running as this Windows account can remove or rewrite the record, or type the confirmation;
  - the stop restrains ProjectOS commands, not git or agents run directly.

## Acceptance criteria

1. **With the stop engaged, every listed entry point refuses before any worker, provider, commit or push call;
   tested with counting fakes.** Met. This covers:
   - entry gates;
   - re-checks before commit, push and fast-forward;
   - real-git tests with HEAD and origin unchanged;
   - counting fakes for the worker, gatekeeper and spend.
2. **Delegations are suspended without editing any committed record; tested.** Met. The test compares the
   committed bytes and checks the tree is clean.
3. **Only the owner can lift, proven by an owner-authored commit, never by a flag or the implementer identity;
   tested.** Met as an **owner-intent check**, which is the design the owner chose.
   - A flag, the ProjectOS implementer identity, a sweep commit, a rename, a foreign repository, a missing
     terminal and a wrong typed id are all refused.
   - Accepted residual until Windows Hello: a program running as the same account can delete the record or type
     the confirmation.
4. **Every stop output carries the statement.** Met.
5. **Validator pin and named mutations.** Met. `val-projectos-kernel-platform-stop1a` kills 101 named
   mutations, verified via `run()`.

## Verification

- Agent suite on the stacked branch (stop, then TRUTH1A, then HYGIENE1A): **2729 of 2729 pass**. Typecheck is clean.
- `validate-all` on the stacked branch: 153 registered, 151 pass. The 2 failures are the baseline ones
  (`validate-desktop-e2e`, `val-cd-b4-sealed-expected-window-facts1a`).
- No stop record exists in the real `%LOCALAPPDATA%`; the tests used an isolated directory.

## Reviews

- **ECC security-reviewer, round 1** (`d77f20a`): 0 CRITICAL, 2 HIGH (H1: lift not owner-bound; H2: a standing
  stop dropped on a failed re-engage), 6 MEDIUM. All addressed in `8cbd784`.
- **Agency `identity-access-engineer`** (AMBER, corpus `ad9264e3`): BLOCK, on the specific claim "owner-only,
  in person". This was resolved by the owner's decision to treat the lift as an owner-intent check with the
  typed confirmation, and by relabelling the wording.
- **ECC security-reviewer, recheck** (`8cbd784`): no new CRITICAL or HIGH. H2, M1, M4, M5 and the LOW items are
  CLOSED. H1 is PARTIAL; its two residual MEDIUM items (rename and binding) were fixed in `f3690e4`, together
  with the statement wording and mid-act tests.

## Carried forward

- **Windows Hello lift.** The lift will verify owner presence through the Host service. This means moving custody
  of the stop record to the service, with a ProgramData ACL, and a lift signed by a Windows Hello KeyCredential.
  It needs the Host service running.
- **The real terminal prompt has not yet been exercised in an interactive terminal.** The owner should try
  `projectos stop` and then `stop lift` once in Windows Terminal.
- **Rebuild needed.** The agent's built output must be rebuilt before the Control Center starts, because the
  sidecar imports `platformStopRefusal` and `controlCenterVerbRefusal`.
- **Platform reach.** On POSIX, a disagreeing `XDG_STATE_HOME` reads as stopped.
