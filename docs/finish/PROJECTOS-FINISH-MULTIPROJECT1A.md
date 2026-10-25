# PROJECTOS-FINISH-MULTIPROJECT1A — evidence

Phase 2 of 3 of plan v1.10 (v1.9 amended). Implemented by Claude (lead) directly on the owner's grant of
2026-10-25 ("I give you full authority now"); not dispatched to a governed worker. No ChatGPT gatekeeper
ruling is claimed for this phase.

## What changed

1. **Closure for any governed project.** G4-1 used to accept only the project id `projectos`. It now
   requires the governed project id (from the canonical configuration) to be known and equal to the
   active plan's project id; a plan for another project, or an unknown id, refuses.
2. **ProjectOS commits its own records.** A new executor (`commitOwnRecords` / `commitOwnRecordsFor`,
   `technicalContinuation.ts`) commits and pushes ProjectOS's OWN records, and only when:
   - the phase's owner gates and the constitutional floor leave `commit` and `push` delegated (the same
     rule as the technical continuation, from the committed delegation);
   - EVERY uncommitted path is one of the caller's records (no directory entry, rename or quoted path);
   - HEAD equals its upstream after a fetch (0 ahead, 0 behind), the commit's parent is that head, and the
     push is an ordinary same-branch push verified by read-back against `refs/remotes/...`;
   - paths are staged and committed with literal pathspecs, and every ProjectOS commit is authored
     `ProjectOS implementer`, an identity the owner-commit check refuses outright.
3. **`run()` folds the run's records** after an approved technical continuation only (no stop, not
   degraded, HEAD moved by the run's own commit). The foldable records are the writers' exact shapes:
   execution `<session>.(brief|session|evidence|invocation).json`, the gate decision record, the
   interactive question and answer, the work record, the thread pointer, the spend ledger, this phase's
   record and the governed current state. Never the worker's findings or effects, a degraded-use record,
   any closure or authority record, or a directory.
4. **`closure prepare` commits exactly its three records** (closure evidence, validation record, report)
   through the same executor when every check passed and commit/push are delegated; otherwise it only
   generates them for the owner, as before. `closure request` and `closure resume` commit nothing. The
   closure DECISION is never committed by ProjectOS.

## Acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | G4-1 by the governed project's own id; mismatched ids refused | core `closure-eligibility` C6/C6b; E2E "generates evidence … G4 accepts" now fully eligible for project id `e2e`; live proof on project id `disposable-proof` closed both phases |
| 2 | No uncommitted run record after an approved technical continuation, through run() | E2E "the run's own records are committed and pushed, and the tree holds none" (calls `foldRunRecords`, the step `run()` takes); live proof through the real `projectos continue` → `run()`: a "the run's own records" commit by ProjectOS after each technical continuation; validator MP-4 pins the `run()` wiring |
| 3 | closure prepare commits/pushes exactly its three records when delegated; refuses any other path; only generates when a gate is reserved | E2E "ProjectOS commits and pushes EXACTLY those three"; E2E "without a proven technical delegation … only GENERATES"; `ownRecordsCommit.test.ts` (foreign path, ahead/behind, reserved, nested repo, rename, push rejected) |
| 4 | Live disposable two-phase proof with the interactive gatekeeper: per phase two relays and one owner commit, restart recovered | See below |
| 5 | Validator pins + named mutations; tests green; validate-all; ECC reviews | agent 2508/2508, core 766/766, typecheck clean; validate-all 145/147 (known 2); section (11) MP-1..MP-7; 17/17 named mutations killed by the named rule, 11/17 also by a test; reviews below |

## Live proof (reported separately from the synthetic tests)

Harness `C:/dev/ProjectOS-candidate-backups/finish-multiproject1a/live/proof.mjs` (the BOOT-CONTINUE1A
harness adapted: project id `disposable-proof`, phases carry `writePaths`). Real Claude Code CLI worker,
interactive gatekeeper, localhost-only git remote, labelled test identities DISPOSABLE-TEST-OWNER and
DISPOSABLE-TEST-GATEKEEPER (never the owner). Run `2026-10-25T18-56-57-860Z`, after the fix round:

- 2 phases closed; programme complete; remote 0/0.
- 4 relays (per phase: the technical review and the closure question).
- **2 owner commits — one per phase, each exactly the closure decision.** BOOT-CONTINUE1A's run needed 6.
- 1 forced restart (killed while the second closure question waited), recovered through
  `--supersede-stale-request`.
- ProjectOS's commits per phase, authored `ProjectOS implementer`: technical continuation, the run's own
  records, closure records.

**Finding (MEDIUM, carried):** after a phase closes, the persisted close — the closed phase record, the
current state and the decision's `consumedAt` stamp — stays uncommitted. Mid-programme it rides into the
next phase's reviewed technical-continuation candidate (pre-existing behaviour: the candidate is
everything dirty); after the last phase it needs an owner commit. ProjectOS does not commit it because one
of the files is the closure decision. Fix route: persist the close through an exact-path step that commits
the phase record and state but leaves the stamped decision to the owner, or stop stamping the decision in
place — both outside this phase's paths (`phase.ts`, `closureWait.ts`).

## Reviews

- **ECC CODE** — WARNING: 0 CRITICAL, 1 HIGH (the spend ledger was not foldable, so unattended runs always
  fell back to an owner commit), 7 MEDIUM, 3 LOW.
- **ECC SECURITY** — 0 CRITICAL, 1 HIGH (H1: the fold ran after EVERY ok run — stopped, refused, degraded —
  and its prefix rule admitted worker-written findings/effects, degraded-use records and nested
  repositories), 2 MEDIUM, 5 LOW.
- **One fix round:** fold gated to an approved technical continuation; exact record shapes (ledger in,
  findings/effects/degraded-use/directories out); directory entries refused; literal pathspecs;
  `ProjectOS implementer` identity on every ProjectOS commit (also the technical continuation); push
  carries exactly the records commit on qualified remote refs; "committed locally, NOT pushed" reported
  with the push command; closure prepare commits only passing records; stale invariants and G4-1 comments
  corrected; validator MP-2b..MP-7 added or tightened (MP-5 no longer vacuous). Both reviews ran on
  snapshot `candidate-r1`; the security reviewer confirmed the tree unchanged.

## Carried forward, each with its trigger

- **Post-close records** (above). Trigger: before EXTERNAL-PROOF1A counts owner acts, record the last
  phase's extra owner commit as its cause.
- **Delegation record vs behaviour** (SECURITY M1): the committed delegation's notes say the technical
  scope is not by itself permission to act; this phase's approved criteria authorise committing
  ProjectOS's own records under it. The owner should ratify that in the delegation notes (an authority
  record — owner-only edit).
- **Candidate sweeps authority-shaped files** (SECURITY M2, pre-existing): `doCommit` stages every
  candidate path, so a stamped decision rides a reviewed technical commit. Mitigated now by the
  `ProjectOS implementer` identity (a ProjectOS-committed decision fails the owner check). Trigger: before
  unattended operation, deny `.projectops/closure/decisions/`, `gates/`, `authority/`, `plan-decisions/`,
  config and plan in the candidate.
- **Doctor preflight not run before the records commit** (CODE M4): its own fetch, reconcile and
  read-back verification cover the remote; git, config and runner were exercised by the run just before.
- **Duplicated derivations** (CODE M5): owner-gate classification and the phase/branch/programme lookup
  are re-derived in `technicalContinuation.ts`; `brief.ts` is outside this phase's paths.
- LOW: `commitOwnRecords` remains exported (tests drive it; production callers use
  `commitOwnRecordsFor`); state-tail nomination accepts any `.projectops/*.json` the committed config
  names; `closure prepare` and the fold do not re-run `verifyExecutionContext`; `closure.ts` exceeds the
  800-line guideline; the fold's `run()` wiring is pinned by validator and the live proof, not a unit test.

## Verification commands

    npx vitest run                         (projectos/agent, projectos/core)
    npm run typecheck:all                  (projectos/agent)
    node projectos/validators/val-projectos-boot-continue1a.cjs
    node projectos/validators/val-projectos-technical-continuation1a.cjs
    node -e "console.log(require('./projectos/validators/val-projectos-closure-transport1a.cjs').run())"
    node projectos/validators/validate-all.cjs
    node C:/dev/ProjectOS-candidate-backups/finish-multiproject1a/tools/mutation_battery.cjs --behaviour
    node C:/dev/ProjectOS-candidate-backups/finish-multiproject1a/live/proof.mjs
