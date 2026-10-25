# PROJECTOS-FINISH-WRITEPATHS1A — evidence

Phase 1 of 3 of plan v1.9 (finish ProjectOS on the narrow definition of done). Implemented by Claude
(lead) directly on the owner's grant of 2026-10-25 ("I give you full authority now"); not dispatched to
a governed worker. No ChatGPT gatekeeper ruling is claimed for this phase.

## What changed

1. **Write grants are data.** A plan phase may carry `writePaths`, a list of repository paths. The
   worker's write grant is exactly that list, each entry judged as written by the existing path rules
   (`workers.ts` `phaseWritePaths`, `writePathGrants`, `judgeWritePath`). The phase's `scope` sentence is
   prose and grants nothing; the negation-word list and the path-word parser are deleted. A phase without
   `writePaths` grants only the worker-owned records. A `writePaths` that is not a list, or an entry that
   is not a non-empty path string, refuses the run (`WRITE_PATHS_REFUSED`).
2. **Plan carries it.** The plan schema types `writePaths`; the plan engine carries it exactly as the
   source states (absent stays absent; malformed is carried, not filtered); plan approval projects it into
   the activated plan and refuses a list that is not a list of non-empty strings.
3. **Validators judge from the base commit.** `pinnedValidators.ts` writes the base commit's
   `projectos/validators/**.{js,cjs,json}` to a fresh directory outside the checkout; each required
   validator runs under a generated `--require` loader that compiles the pinned copy in place of the file
   on disk (keeping the real filename, so `__dirname` roots resolve to the checkout) and passes itself to
   child Node processes. `checksFor` cannot build a validator check without a pin. The run pins to the
   brief's base commit; `closure prepare` pins to the run evidence's `baseHead`.
4. **What a worker creates under a grant** (fix round): the after-attempt scan also stops the run on a
   hook or settings directory (`.claude`, `.husky`, `.vscode`), a device name or an agent instruction file
   (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `*.local.md`) created or changed beneath a directory grant, and
   on a file grant the worker turned into a directory. Instruction files are never a write path.

## Acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | Structured `writePaths`; schema, source format, engine accept it; absent grants only worker records | schema + engine (`validate-plan-discovery-import` case (w)); `planAuthoring.test.ts` projection test; `phaseWritePaths` tests; E2E "a scope sentence that names paths, with no writePaths, grants the worker-owned records only" |
| 2 | Grant equals `writePaths` exactly; no prose read; exclusion list retired | `loopToolGrants.test.ts` `writePathGrants` suite (entries never split; non-string refused); FW-1a..d; E2E grant tests |
| 3 | Validators and enforcement run from base commit; a worker edit to a validator under its grant does not change the result | `pinnedValidators.test.ts` (tampered validator, helper, JSON data and child: unpinned passes, pinned fails; fixed subject passes under tampered code; junction root; added validator refused); E2E "closure prepare judges with the run's BASE-COMMIT validator"; enforcement dist is git-ignored and never grantable (`loopToolGrants` real-repo test) |
| 4 | Each rule pinned by a validator and killed by a named mutation; v1.9 phases carry `writePaths` | `val-projectos-boot-continue1a` section (10) FW-1..FW-7; battery 25/25 killed by the named rule, 17/25 also by a behavioural test; FW-6 + `loopToolGrants` check every v1.9 phase |
| 5 | Agent and core tests green; validate-all no new failure; ECC CODE + SECURITY no unresolved CRITICAL/HIGH | agent 2496/2496, core 765/765, `typecheck:all` clean, validate-all 145/147 (the two known: `validate-desktop-e2e`, `val-cd-b4-sealed-expected-window-facts1a`); reviews below |

## Reviews

- **ECC CODE** — APPROVE, 0 CRITICAL / 0 HIGH, 7 MEDIUM, 5 LOW.
- **ECC SECURITY** — 0 CRITICAL, 1 HIGH, 4 MEDIUM, 7 LOW.
- **One fix round** (both reviews ran on snapshot `candidate-r1`; tree verified unchanged by sha256
  manifest afterwards):
  - SECURITY H1 / CODE M1 — pin silently fell back to the working tree when the governed root is reached
    through a junction or link. **Fixed**: loader matches the resolved and the real root; validator code it
    cannot place under the root, and an unpinned entry script, refuse to load. Junction test added.
  - CODE M2 / SECURITY L2 — `pinValidators` could throw and leak its directory. **Fixed**; cleanup tests
    for a failing `git show` and a throwing caller.
  - SECURITY M3 — instruction/settings files beneath a directory grant. **Fixed** (item 4 above).
  - SECURITY M4 — a not-yet-existing file grant could become a directory. **Fixed** (item 4 above).
  - SECURITY L1 — other registered code extensions under the validator directory now refuse to load.
  - CODE M6 — approval comment overclaimed; narrowed. CODE L2/L3/L5 — stale comment, comment-only test
    needle, header caveat: fixed.

## Carried forward (not fixed in this phase), each with its trigger

- **Trust set beyond `projectos/validators/`** (SECURITY M1): schemas and non-validator modules a
  validator loads, and the governance engines a later CLI process loads, come from the working tree; a
  run's edit to a pinned validator becomes the next phase's judge once committed. Control today: the
  reviewer's diff and the owner's closure commit. Trigger: before any unattended or delegated-commit
  operation of a phase whose `writePaths` touch these.
- **A base-pinned validator cannot judge a phase that changes the shapes it pins** (CODE M3 / SECURITY
  M2): by design. This phase is one (the base `val-projectos-boot-continue1a` asserts the retired
  prose-grant shapes), and MULTIPROJECT1A may be. Such phases close by the owner route with the new
  validator run at the subject; or the rule change lands in an owner commit before the phase starts.
- **Objective-led authoring cannot emit `writePaths`** (CODE M4): authored plans grant only the worker
  records. Trigger: before EXTERNAL-PROOF1A, if its Dead Aisle or PolyGo plans are authored rather than
  written as structured JSON sources.
- **Approval checks list shape only** (CODE M6): path rules are judged at dispatch, where a refused entry
  refuses the run.
- **Correction-maximum veto still read from scope prose** (CODE L1): a deny list, not a grant; inert in
  production. **Configured checks (the worker's tests) are not pinned** (SECURITY L6). **In-process
  undo of the loader by code a validator requires** (SECURITY L4). **Child spawned with an explicit
  minimal `env`** (SECURITY L5). **Leaked pin directories after a killed run are not swept; ~160
  `git show` spawns per pin** (SECURITY L3).

## Scope correction

The approved scope text omitted three files the work needs — the plan engine
(`projectos/validators/plan-discovery-engine.cjs`), the new `projectos/agent/src/loop/pinnedValidators.ts`
and `projectos/agent/src/commands/closure.ts` — and named `projectos/core/` and `brief.ts`, which needed no
change. The plan source now states the corrected scope and `writePaths` for every v1.9 phase, file by file
(MULTIPROJECT1A keeps the directory `projectos/core/test/`); it reaches the approved plan only through the
amendment activated after this commit.

## Verification commands

    npx vitest run                         (projectos/agent, projectos/core)
    npm run typecheck:all                  (projectos/agent)
    node projectos/validators/val-projectos-boot-continue1a.cjs
    node projectos/validators/validate-plan-discovery-import.cjs
    node projectos/validators/validate-all.cjs
    node C:/dev/ProjectOS-candidate-backups/finish-writepaths1a/tools/mutation_battery.cjs --behaviour
