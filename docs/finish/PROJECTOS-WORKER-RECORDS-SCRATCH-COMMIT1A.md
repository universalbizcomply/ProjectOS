# PROJECTOS-WORKER-RECORDS-SCRATCH-COMMIT1A — finish record (plan v1.44)

Branch `projectos-worker-records-scratch-commit1a`, based on `a2f97ba3`. Spec: `docs/changes/delta_spec.md`, section "Plan v1.44 — PROJECTOS-WORKER-RECORDS-SCRATCH-COMMIT1A"
(owner-approved 2026-11-18; the exact instruction text, the two files the v1.43 delta lists as PROTECTED, fail closed on a refused scratch commit, no real sha in the message).
T008 (live Codex probe) was skipped by the owner. T009 and T010 are not part of this phase. No live provider call was made. Nothing was pushed or merged.

## Why

The Stage 4 live exit proof stopped config B at `CORRECTION_EXHAUSTED`: a Codex worker wrote two unresolved findings about the LOOP's own business ("independent code review remains
outstanding", MEDIUM; "the checkout has no readable Git HEAD", LOW). A worker can resolve neither; `outcome.ts` sends every unresolved MEDIUM or LOW back to the worker, so it was re-run three
times and the run ended before the independent reviewer. This phase tells both providers what a finding is, and gives the scratch checkout one initial commit.

## Existing code found (reused; extended, not forked)

- `loop/adapters/claudeCodeCli.ts`: `RECORDS_CLAUSE` is appended by both `pointerInstruction` and `correctionInstruction`; the Codex adapter receives those builders by injection and builds no
  sentence of its own. One constant appended to `RECORDS_CLAUSE` reaches both providers on both paths.
- `loop/scratchCheckout.ts` `exportScratch`: files git lists, minus control paths, then `git init -q --template=` and nothing else; `manifestOf` skips the scratch's top-level `.git`.
- `loop/writeScope.ts` `isolatedGitRunner(sys, root)` (shared; not edited): isolated environment (system/user config = null device, hooks path = null device, fixed identity, `LC_ALL=C`),
  `core.fsmonitor=false`, `core.useReplaceRefs=false`, `protocol.allow=never`, every filter driver neutralised. The commit goes through it: no second isolation path.
- `system.ts` `isolatedGitEnv` / `HOOKS_OFF_ENV` (not edited) supply the fixed identity `ProjectOS local candidate <local-candidate@projectos.invalid>` and close the hook directory.

## What changed

| File | Change |
|---|---|
| `projectos/agent/src/loop/adapters/claudeCodeCli.ts` (CRLF file, line endings kept) | new constant `FINDINGS_CLAUSE` (the six approved sentences, plain literals) defined above `RECORDS_CLAUSE`; `RECORDS_CLAUSE` now ends `... cannot be certified. ' + FINDINGS_CLAUSE`. Builders, registry and the pinned correction sentence are untouched. |
| `projectos/agent/src/loop/scratchCheckout.ts` | `commitScratchBaseline(sys, root)` (add, then commit, through `isolatedGitRunner`), `SCRATCH_BASELINE_MESSAGE`, `SCRATCH_COMMIT_REFUSED`, `NULL_DEVICE`; one call after the unchanged `git init` refusal line: `if (!commitScratchBaseline(sys, root)) return fail(SCRATCH_COMMIT_REFUSED)`. Header comment updated ("Nothing is committed in it" is gone). No other function changed. |
| `projectos/agent/test/scratchCheckout.test.ts` | rule-2 test: its last two lines moved to the opposite (status empty, HEAD resolves); 13 new tests (S1-S8, below) incl. the hostile configuration. |
| `projectos/agent/test/codexImplementerScratch.test.ts` | S9. |
| `projectos/agent/test/codexImplementerAdapter.test.ts` | W7. |
| `projectos/agent/test/loopBrief.test.ts`, `loopWorkers.test.ts` | W1-W5, W9 and W6. |
| `projectos/agent/test/support/findingsClause.ts` (new) | the owner-approved text as literals, one export per sentence, so a test fails when the source drifts from what was approved. |
| `projectos/validators/val-projectos-worker-codex-implementer1a.cjs` | WI-33 and WI-34, 30 new named mutations (185 -> 215; 223 after the fix round below), TESTS needles for every new test. |

Edited-or-not report for the four neighbour validators the phase was granted: `val-projectos-context-manager1a.cjs`, `val-projectos-kernel-followup1a.cjs`,
`val-projectos-kernel-role-review1a.cjs`, `val-projectos-worker-lifecycle-bounded1a.cjs` are **UNTOUCHED** (no pin on the changed region; all four pass). No pin outside the write list moved.
`docs/06_Plan.md` is not edited (the lead ticks at close). `docs/changes/delta_spec.md` gained only the owner-chosen semicolon in the approved clause text (fix round).

The two commit commands, exactly as built (every `-c` before the verb; none contains the text `core.fsmonitor`, which WI-25 forbids in this file):
`add` with `-c core.autocrlf=false -c core.safecrlf=false -c core.attributesFile=<null device> -c core.excludesFile=<null device>` and `--all --force -- .`;
`commit` with `-c commit.gpgSign=false -c gc.auto=0 -c gc.autoDetach=false -c maintenance.auto=false` and `-q --no-verify --no-gpg-sign --allow-empty -m <fixed message>`.

## Rule -> test -> mutation

Test ids: S1-S9 = scratch tests (`scratchCheckout.test.ts`, S9 in `codexImplementerScratch.test.ts`); W1-W9 = wording tests. "Test mutation" = the mutation was applied to the source, only the named tests were run,
and the file was restored (results in the next section). "Validator" = the named mutation in `val-projectos-worker-codex-implementer1a.cjs` (WI-33 / WI-34), killed only by its own rule.

| Rule | Test | Test-level mutation that failed it | Validator mutation(s) |
|---|---|---|---|
| 1 both instructions carry the clause | W1 (`loopBrief`), W6 (`loopWorkers`), W7 (`codexImplementerAdapter`) | clause not appended to `RECORDS_CLAUSE`; correction without `RECORDS_CLAUSE`; start without `RECORDS_CLAUSE` | findings-clause-not-appended-to-the-records-clause; start-/correction-sentence-without-the-records-clause |
| 2 own defects, true severity, resolved only when fixed | W2 | `OWN` -> `own` | findings-clause-reworded |
| 3 review / checks / closing are ProjectOS's | W3 | sentence dropped | findings-clause-drops-the-closing-of-the-phase |
| 4 no history / other baseline is not a finding | W4 | sentence dropped | findings-clause-calls-a-missing-history-a-finding |
| 5 `reviews` names only the worker's own | W5 | sentence changed to "and the independent review" | findings-clause-lets-the-worker-name-the-independent-review |
| 6 constant, no data | W6 | `process.cwd()` spliced into the clause | findings-clause-carries-data |
| 7 Codex prompt, start and correction | W7 (also S9 end to end) | same three as rule 1 | codex-adapter-builds-its-own-findings-sentence |
| 8 no gate moves | existing `loopOutcome.test.ts` ("sends unresolved LOW and MEDIUM findings back as work", "stops on an unresolved CRITICAL", "stops once LOW/MEDIUM findings resist correction to the bound") and the reviewer-credit tests; **unchanged, all pass**. `outcome.ts`, `reviewRoles.ts`, `runner.ts` are untouched (`git status`). | n/a (no new code on this path) | n/a |
| 9 every pinned fragment still present | W9 (and the unchanged `loopBrief` B, `loopWorkers`, `loopBriefContext` tests) | the three records-clause mutations (W9 fails with them) | the same three |
| 10 exactly one commit, exactly the exported files | S1 ("rule 10 and 13"), "rule 10: nothing to export" | commit not made (12 fail); `--allow-empty` removed (the empty-checkout test fails) | scratch-baseline-commit-not-made; ...-made-before-the-init; ...-empty-checkout-refused |
| 11 blobs equal raw bytes (CRLF, mixed, binary, unicode name) | S2 under a hostile global configuration and a hostile repository configuration planted right after `git init` | `core.autocrlf=false` removed (S2 and the bare-arguments test fail); `core.attributesFile` removed (same two fail); `--force` removed (3 fail) | ...-add-converts-line-endings; ...-reads-an-attributes-file; ...-honours-ignore-patterns |
| 12 no hook, filter, signing program, fsmonitor, no user/system/global config, excludes, attributes | S3 (isolated environment, hostile everything, markers) and S3b (isolation taken away: only the arguments protect) | both signing opt-outs removed (3 fail); `--no-verify` removed (S3b fails); own `sys.exec` instead of the shared runner (8 fail) | ...-may-sign; ...-runs-hooks; ...-runs-the-signing-program; ...-runs-its-own-git; background-gc / detach / maintenance mutations |
| 13 status clean, HEAD resolves right after the open | S1, S9 | commit not made | scratch-baseline-commit-not-made |
| 14 failed add / commit refuses with a fixed reason, no worker, no directory | S4 x4 (add and commit, each ending by exit code and by timeout) | commit failure ignored (4 fail); add failure ignored (2 fail) | ...-commit-failure-ignored; ...-refusal-reason-changed |
| 15 fixed message and identity, nothing from the repository or the worker | S5 (hostile global identity, real HEAD, real path, real repo's configured user must all be absent; exact message) | `' ' + root` appended to the message (fails) | ...-message-reworded; ...-message-carries-data; ...-sets-an-identity; ...-reads-the-real-repository |
| 16 scratch `.git` never compared or copied back; real HEAD, index, refs, status unchanged | S6 (worker commits, makes a branch, edits its `.git/config`; copy-back copies nothing; real facts equal before and after the open) | the `.git` skip in `manifestOf` removed (S6 fails) | the existing `the-scratch-git-dir-walked` (WI-15) plus WI-34's "no real-repository parameter" |
| 17 worker can read HEAD, `git diff` is exactly its edit | S8 (real directories), S9 (the Codex adapter with a function that runs real git in its cwd) | commit not made | scratch-baseline-commit-not-made |
| 18 validator pins rules 1-17 with named mutations | `node val-projectos-worker-codex-implementer1a.cjs`: PASS (215 named mutations killed) | | 30 added |

The control test ("the hostile configuration is live") proves the hostile configuration is not vacuous: a plain git run against it executes the template hook, the filter and the signing program (their marker files appear).

### Test-level mutation results (source mutated, named tests run, file restored; restoration checked by hash)

KILLED: add converts line endings (2 fail); add honours ignore patterns (3); add reads an attributes file (2); commit may sign, both opt-outs removed (3); commit runs hooks, `--no-verify` removed (1);
empty checkout refused (1); commit failure ignored (4); add failure ignored (2); commit not made (12); commit through its own git instead of the shared runner (8); message carries data (1);
scratch `.git` walked (1); wording reworded (4); wording not appended (7); correction without the records clause (10); start without it (11); loop-steps sentence dropped (4); history sentence dropped (4);
reviews sentence dropped (4); wording carries the cwd (3).

SURVIVED, honestly (the validator pins each of these by text, but no test can observe them):
- `core.excludesFile` override removed: `--force` already ignores every exclude pattern, so the two defences are redundant.
- `core.safecrlf=false` removed: with `core.autocrlf=false` in force it has no effect.
- `commit.gpgSign=false` removed alone: `--no-gpg-sign` covers it (removing both is killed).
- the three background-maintenance opt-outs (`gc.auto=0`, `gc.autoDetach=false`, `maintenance.auto=false`): a detached background gc cannot be observed by a test.

## Results of everything run

- Focused files, one at a time while working: `scratchCheckout.test.ts` 65 passed (64 before the empty-checkout test was added: 52 old + 13 new); `codexImplementerScratch.test.ts` 11 passed;
  `loopBrief` + `loopWorkers` + `loopBriefContext` + `codexImplementerAdapter` 212 passed (before W7: all four files passed). RED was seen first for S1-S9 (11 failed against the old code, plus the moved rule-2 assertions), W1-W6, W7 and S9.
- Validators (each run): `val-projectos-worker-codex-implementer1a` PASS (215 named mutations killed); `val-projectos-worker-lifecycle-bounded1a` PASS; `val-projectos-context-manager1a` PASS (21 rules; 287 named mutations killed);
  `val-projectos-kernel-followup1a` PASS (88 named mutations killed); `val-projectos-kernel-role-review1a` PASS (44 named mutations killed); `validate-no-secrets` PASS; `validate-plan-no-secrets` PASS.
  A grep of `projectos/validators` for the touched source files and test files found no other validator naming them. `validate-all` was NOT run (the lead does).
- `npx tsc -p tsconfig.json --noEmit` (agent): clean. `npx tsc -p tsconfig.test.json --noEmit`: one error, the known pre-existing `test/skillLoad.test.ts(128,26): TS2339 'sort' does not exist on type 'readonly string[]'` (not mine, not fixed).
- Whole agent suite, once, `npx vitest run` in `projectos/agent`: **140 files passed, 2 failed; 4670 tests passed, 1 failed, 10 skipped.**
  - `test/contextReviewRound2.test.ts` "stays linear ... inside a tenth of a second": 102.56 ms against a 100 ms bound under the load of the full run (the known load-sensitive timing test). Re-run alone: 43 passed.
  - `test/tenantSidecar.test.ts` (a `beforeAll` failure, no test ran): its `beforeAll` runs `tsc -p projectos/control-center/tsconfig.node.json`, which fails here with `TS2307 Cannot find module '@projectos/bridge-daemon'` and `'@projectos/core'`:
    `projectos/control-center/node_modules` does not exist in this worktree (only the agent's `node_modules` are junctioned into the plan worktree). Environmental; the file does not touch anything this phase changed.
    I did not verify it fails identically on the base commit, and I did not create the junction (outside the write list).

## Residuals and risks (R1-R6 of the spec, stated honestly; plus new ones)

- **R1** the real cause of F2 may be Git's ownership check ("dubious ownership"), not the missing commit, if `windows.sandbox="elevated"` runs commands as another Windows user. NOT resolved: T008 was skipped. The commit may not fix F2; the wording sentence still tells the worker not to record it. The re-run answers it.
- **R2** the scratch HEAD is not the brief's `repository.head`. The clause (rule 4) says so and the message says it is not the governed repository's commit; the real sha is deliberately not in the message.
- **R3** a worker may still record some other caveat with `resolved:false` (for example "validate-site was not run by me"). The clause says to write only defects; a residual is possible. Not provable without the re-run.
- **R4** cost: `git add` hashes and compresses every exported file (bounded at 100,000 files and 1 GiB by the export) and writes loose objects (about the tree's size again on disk). Not measured; the 8-file test tree is instant. FIXED in the fix round (see "Review round and fix round"): the add, the commit and the filter-driver listing now carry a 120 s timeout through a wrapped `exec`, without editing `writeScope.ts`; a hang is a fail-closed refusal.
- **R5** fail closed: a git hiccup (an antivirus lock) refuses the open instead of degrading the run. Chosen by the owner.
- **R6** the identity is the isolated environment's fixed "local candidate" identity; nothing is set. A `-c user.name` could not override it anyway (the environment variables win), so no test-level mutation of the identity exists; the validator pins that none is set.
- **New R7** the brief, evidence, findings, effects and context files are placed in the scratch AFTER the open, so to a worker's git they are untracked files under `.projectops/execution/` (`git status` is clean right after the open, rule 13, but not after the adapter places the records; S9 proves status shows only those). Not changed (outside the spec). Whether a worker records "untracked files" as a finding is part of R3.
- **New R8** a repository-level `.git/info/attributes` with an `eol` attribute would still convert line endings: no switch reaches it. Not reachable today (the fresh `--template=` repository has none and nothing between `init` and `add` writes one); the hostile test plants only the filter variant, which the shared runner neutralises. `post-commit` and `pre-push` are closed only by the shared environment (`core.hooksPath` = null device, WI-25); `--no-verify` does not cover a `post-commit` hook.
- **New R9** one probe (not a committed test) with a worker's git at `core.autocrlf=true` on a scratch with raw CRLF blobs: `git status` empty and `git diff` of an honest CRLF-preserving edit showed only the added line. One data point on one git (2.55.0.windows.3).

## What is NOT proved

- No live provider call was made. Whether the Codex worker still raises a caveat, and whether F2 was "no commit" or "dubious ownership", is shown only by the re-run (T010).
- The instruction text was not tested against a real model: the tests prove the text is present, verbatim and constant on every path, not that it changes a worker's behaviour.
- The scratch commit was proven against the real git on this machine (2.55.0.windows.3) with a temporary home, never the owner's configuration; not against another git version.
- The four background-maintenance opt-outs, the `excludesFile`/`safecrlf` overrides and the single `gpgSign` config key are pinned by text only (survivors above).
- `tenantSidecar.test.ts` was not shown to pass in this worktree (missing `control-center/node_modules`).

## Carry-forwards

1. The independent ECC `security-reviewer` review (T007) is the lead's, after this report; the brief for it: reads by absolute path stay open (D4); the worker owns the scratch `.git`; no gate moved.
2. T010 the re-run, with the owner's words for new attempt ids and a fresh secrets-handling receipt per attempt.
3. Done in the fix round: the timeout for the scratch add and commit (no `writeScope.ts` edit was needed). Still open: the R7 question (the placed records show as untracked files in the scratch).
4. Carried LOW/INFO from the review round, not fixed (listed in the next section).

## Review round and fix round

### Reviews of the baseline commit (the first build, `61b5c155`)

Three independent reviews ran after the first report: an Agency specialist and two ECC reviewers (the security reviewer and a second code reviewer). None found a CRITICAL or HIGH defect.
Two MEDIUM findings were raised and one wording point:

1. **MEDIUM** the scratch `add` and `commit` had no timeout (R4 above): a hung git would hold the open and so the loop.
2. **MEDIUM** the validator did not pin how the exit status of the add and of the commit is handled, nor that every `-c` override comes BEFORE its verb (a `-c` after `add` or `commit` is an argument of the verb, not an override, and the isolation would silently go).
3. **Wording** the loop-steps sentence of the findings clause joined two clauses with a comma ("...happen after you finish, so that they have not happened yet..."), which reads as a purpose clause. The owner chose the semicolon.

Test-coverage gaps the reviews named (no new production risk, only unproved paths): ambient `GIT_*` variables of the calling process; a real tree with tracked `.gitattributes` and `.gitmodules`, a submodule and a nested repository;
the refusal when the shared runner cannot be built (`run === null`); an `exec` that throws.

### What the fix round changed (tests first; each new test seen RED, then GREEN)

| Finding | Change | Where |
|---|---|---|
| 1 | `SCRATCH_GIT_TIMEOUT_MS = 120_000` and `withScratchGitTimeout(sys)`: a derived `System` whose `exec` adds `timeoutMs` and changes nothing else (command, arguments, environment). `commitScratchBaseline` hands it to `isolatedGitRunner`, so the filter-driver listing, the add and the commit are all bounded. A call that runs out of time ends with `failure: 'timeout'`, which the existing `done(r)` test already treats as a failure, so the open is refused with the fixed reason. `writeScope.ts` and the shared runner are NOT edited. | `scratchCheckout.ts` |
| 2 | WI-34 now also pins: the `done` predicate (exit code AND no failure), that the add result and the commit result are both returned through it, that there are exactly two git calls in the function, and that every `'-c'` of each precedes its verb (`overridesBeforeVerb`); and pins the timeout wrapper, the constant being a positive number, and that the runner is given the wrapped system. 8 new named mutations (215 -> 223): add result never checked; exit test ignores a timeout; commit result discarded; override after the add verb; override after the commit verb; timeout removed from the derived exec; runner given the undecorated system; timeout is zero. | `val-projectos-worker-codex-implementer1a.cjs` |
| 3 | `...happen after you finish; that they have not happened yet, or that you did not run them, is not a finding.` Changed in ALL FOUR places that hold the text: `FINDINGS_CLAUSE` (`claudeCodeCli.ts`), the test support constant (`test/support/findingsClause.ts`), the validator's `FINDINGS_EXPECTED`, and the approved text in the v1.44 delta spec (`docs/changes/delta_spec.md`, line 639). Only the one comma became a semicolon; no word changed. | four files |

New tests (`scratchCheckout.test.ts`, 65 -> 71): add exits non-zero / add times out / commit exits non-zero / commit times out (each: fixed reason, no worker, no directory left); every git call carries a timeout; a hung add or commit is a refusal;
the filter drivers cannot be listed (this is the `run === null` path: open refused with the fixed reason, directory removed); an `exec` that throws (generic build-failure reason, directory removed, real tree unchanged);
hostile ambient `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and similar pointing at a real repository (its HEAD, index and status byte-identical, scratch commit right); a real tree with tracked `.gitattributes` (eol, filter, working-tree-encoding), tracked `.gitmodules`,
a submodule gitlink and an untracked nested repository (opens; none of those control paths in the scratch; every blob raw).

Environment: the `projectos/control-center/node_modules` junction was created in this worktree (to the plan worktree's install), so `tenantSidecar.test.ts` no longer fails for the environmental reason recorded above.
The junction is untracked/ignored and is not part of the commit.

### Carried forward, not fixed

- LOW the 120 s bound is a constant, not configuration; a very large export on a very slow disk could be refused where a longer bound would succeed. The refusal is the safe direction and the export is capped at 1 GiB.
- LOW R7, R8 above unchanged.
- INFO `test/skillLoad.test.ts(128,26)` TS2339 in `typecheck:tests` is pre-existing and not part of this phase.

### Results after the fix round

- `scratchCheckout.test.ts` 71 passed. Whole agent suite, once (`npx vitest run` in `projectos/agent`): **142 files passed, 4687 tests passed, 0 failed** (this includes `tenantSidecar.test.ts`, which now runs with the control-center junction, and the timing test that failed under load before).
- `val-projectos-worker-codex-implementer1a` PASS (223 named mutations killed).
- `npx tsc -p tsconfig.json --noEmit` clean; `typecheck:tests` shows only the pre-existing `skillLoad.test.ts(128,26)` error.
- `validate-all` is NOT run here; the lead runs it once on the merged stack for both phases.
