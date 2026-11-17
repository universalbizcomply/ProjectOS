# PROJECTOS-WORKER-SCRATCH-CHECKOUT1A — finish record (plan 4.3a)

Branch `projectos-worker-scratch-checkout1a`, based on `ed0f43ac`. Spec: `docs/changes/delta_spec.md`, last section, "PROJECTOS-WORKER-SCRATCH-CHECKOUT1A (plan 4.3a)"
(owner-approved 2026-11-17). Closes residuals 3, 4 and 5 of `docs/finish/PROJECTOS-WORKER-CODEX-IMPLEMENTER1A.md`; residual 2 (reads) stays open.

## What it delivers

The Codex implementer used to run `codex exec` in the governed checkout and only DETECT writes outside its grants afterwards. It now runs in a scratch copy of the
checkout (a fresh temporary directory) and only changes inside the write grants are copied back. Anything else refuses the whole copy-back, and the real tree is
byte-identical after a refusal. The before/after snapshot of the real root stays as the backstop for a write that reaches the real tree by another route.

## Existing code found (reused, nothing rebuilt)

- `writeScope.ts`: `grantScopes`, `pathInGrants`, `isAgentControlPath`, `candidateSnapshot`, `scopeBreaches` (all unchanged in behaviour) and the isolated-git
  pattern (`isolatedGit`, `core.fsmonitor=false`, filter neutralisers, `-z`). The pattern is now ONE exported helper, `isolatedGitRunner(sys, root)`, that
  `candidateSnapshot` itself calls and the scratch export calls; the pinned lines moved into it unchanged (WI-12 still passes).
- `adapters/codexImplementer.ts` `start` (order: bound, head, context pointer, instruction, argv, scopes, before snapshot, exec, after snapshot, breaches, outcome),
  `outcomeFrom`, `codexImplementerArgv`.
- `brief.ts` `WorkerBrief` (absolute real-root paths in `repository.root` and `records.*`), read only.
- `system.ts` `System` (only `exec`, `exists`, `readText`, ... — no lstat, binary read, mkdir or recursive remove), not edited. The file walk and copy therefore use `node:fs` in the
  new module behind a small injected port, as `localCandidateCommit.ts` does for its temporary directories (that file is untouched).
- `runner.ts` (read only): the loop runs its checks and candidate identity in the real root after the adapter returns, places the stored-context file before `start` and
  retires it after, so the copy-back is all the loop sees.

## Design

`projectos/agent/src/loop/scratchCheckout.ts` (new, 652 lines after the review fixes; in `loop/`, not `loop/adapters/`, so the lifecycle validator's closed adapter list is untouched).

- **Port.** `ScratchFs` (lstat-based `stat`, `list`, streamed `hashFile`, `copyFile`, `makeDir`, `makeTempDir`, `realPath`, `writeText`, `removeFile`, `removeDir`, `removeTree`) with a node
  implementation, and `ScratchHost` (`open`) injected into the adapter as a second, defaulted argument of `codexImplementerAdapterWith`, so the registry line is unchanged.
- **Export.** Files are `git ls-files -z --cached --others --exclude-standard` through the shared isolated runner, minus `.git*` and any agent control path, minus anything that is
  not a plain file now (a deleted tracked file, a link, a submodule directory). A name that is not a plain relative path refuses the export. Bounds: 100,000 files, 1 GiB.
  The scratch must not overlap the checkout (compared by real path). Then `git init -q --template=` there: standalone, no remote, no hooks, nothing committed.
- **Manifest.** `manifestOf` walks the scratch with `lstat`, never entering a link, recording file -> SHA-256 (streamed), directory, link, or other. The scratch's own top-level `.git` is
  left out and never run again (the worker owns it).
- **Judgement.** `judgeChanges(before, after, scopes)` is pure and covers EVERY difference: unsafe name, link or reparse point, oddity, file<->directory, deletion, agent control path,
  outside the grants. `destinationProblem` checks the real destination (every existing component a plain directory, the target a plain file). `inspect` runs both and writes nothing.
- **Copy-back.** Only what `inspect` found clean is copied. Each file is backed up (or noted as new), copied, and hashed at its destination; a mismatch or any error undoes every write
  and says whether the tree was restored. A refused or never-inspected scratch copies nothing.
- **Adapter.** After the unchanged checks and the unchanged real-root `before` snapshot: open the scratch; write a copy of the brief whose `repository.root` and `records.*` point into
  it; place the evidence, findings, effects and stored-context files that exist; record the baseline; run Codex with `--cd`, `cwd` and the sentence at the scratch (commands are judged against
  the scratch root); take the real-root `after` snapshot (breach -> refused); inspect; copy back unless the run itself was refused (steered, failed turn, overflow: nothing copied);
  dispose in a `finally`. A failed removal is said on the outcome (`stderr` of a completed or timed-out run, the detail of a refusal). A timed-out run keeps its granted work, as before.
- **One spawn, no disk in the adapter.** `codexImplementer.ts` still has exactly one `sys.exec(` and imports no `node:fs`; every git call is in `scratchCheckout.ts` or `writeScope.ts`.

## Rule -> test -> named mutation

Tests: `SC` = `test/scratchCheckout.test.ts` (real directories, real git), `AD` = `test/codexImplementerAdapter.test.ts` (fake spawn, scripted scratch), `IN` = `test/codexImplementerScratch.test.ts`
(real scratch wired to the real adapter, Codex as a function). Mutations are in `val-projectos-worker-codex-implementer1a.cjs`; each is killed only by its own rule.

| Rule | Test | Rule id: named mutations |
|---|---|---|
| 1 no `.git`, ignored file or control path | SC "rule 1" (two tests) | WI-15: `ignored-files-listed-too`, `agent-control-paths-copied`, `links-and-directories-copied-as-files`, `the-scratch-git-dir-walked`, `unsafe-listed-path-copied`, `list-read-without-the-shared-runner`; WI-25: `scratch-uses-its-own-isolation`, `snapshot-builds-its-own-runner` |
| 2 standalone repository, no remote | SC "rule 2" | WI-16: `scratch-is-a-worktree`, `scratch-is-a-clone-with-a-remote`, `scratch-keeps-the-default-template`, `init-failure-ignored`, `scratch-may-overlap-the-checkout` |
| 3 outside the grants refuses the whole copy-back | SC "rule 3" (two), AD "rule 3", IN "rule 3 and 10" | WI-17: `changes-compared-by-kind-only`, `files-not-hashed`, `hash-reads-a-bounded-prefix-only`, `refusals-dropped-from-the-judgement`, `refused-judgement-forgotten`, `destinations-not-rechecked-before-writing`; WI-18: `path-outside-the-grants-allowed`; WI-23: `refused-judgement-copied-anyway`, `scratch-never-judged`, `unreadable-scratch-accepted` |
| 4 control path refused under a directory grant | SC "rule 4" (7 paths) | WI-18: `agent-control-path-allowed-under-a-directory-grant` |
| 5 new or changed link refuses | SC "rule 5" (junction, symlink, junction into the real tree) | WI-18: `link-allowed`, `oddity-allowed`, `links-followed`, `links-entered-by-the-walk` |
| 6 file<->directory refuses | SC "rule 6" | WI-18: `file-directory-swap-allowed` |
| 7 destination through a link refuses | SC "rule 7" (two) | WI-20: `link-in-the-destination-path-ignored`, `link-at-the-destination-allowed`, `destinations-not-judged` |
| 8 deleting a granted file refuses | SC "rule 8" | WI-18: `deletion-allowed` |
| 9 write made and undone leaves no trace | SC "rule 9" | The comparison is manifest equality by hash (WI-17 `files-not-hashed`, `changes-compared-by-kind-only`); a write log, the thing that would leave a trace, has no natural text mutation |
| 10 refused run leaves the real tree byte-identical | SC "rule 10", AD "rule 10", IN "rule 3 and 10", IN steered run | WI-23: `refused-run-copied-back`; WI-17: `refused-scratch-copied-anyway`, `uninspected-scratch-copied` |
| 11 worker-owned records copy back like any granted path | SC "rule 11" (two), IN "rule 3 and 11" | WI-14: `records-not-placed`, `brief-not-placed-where-the-worker-reads`; WI-18: `path-outside-the-grants-allowed` |
| 12 removed on every path | SC "rule 12" (three), AD "rule 12" (two), IN "removes the scratch when the worker throws" | WI-22: `scratch-left-behind`, `cleanup-failure-swallowed`, `cleanup-failure-lost-on-a-refusal`, `dispose-failure-swallowed`, `refused-export-leaves-a-directory`, `removal-gives-up-at-the-first-lock` |

Also added: WI-14 (runs in the scratch: `worker-runs-in-the-real-checkout`, `worker-argv-names-the-real-root`, `sentence-names-the-real-brief`, `brief-copy-keeps-the-real-root`,
`brief-copy-keeps-the-real-record-paths`, `commands-judged-against-the-real-root`, `record-outside-the-checkout-accepted`, `scratch-refusal-to-open-ignored`, `unreadable-baseline-accepted`),
WI-19 (paths never trusted: `unsafe-name-allowed`, `parent-segment-allowed`, `colon-allowed-in-a-name`, `drive-letter-allowed`, `absolute-path-allowed`, `escaping-destination-allowed`),
WI-21 (copy verified and undone: `copy-not-verified-at-the-destination`, `failed-copy-not-undone`, `restoration-always-claimed`, `existing-files-not-backed-up`, `new-files-not-noted-for-undo`),
WI-23 (`failed-copy-treated-as-success`, `partial-copy-not-said`, `copy-back-before-the-backstop`), WI-24 (`adapter-reads-the-disk`, `adapter-runs-git`).

Failing test first, seen: `scratchCheckout.test.ts` failed to load (no module) before `scratchCheckout.ts` existed; `codexImplementerAdapter.test.ts` showed 20 failed / 79 passed before the adapter changed.

## Existing tests changed, with the reason

- `codexImplementerAdapter.test.ts`: the module-level adapter now takes a scripted scratch host (a scratch needs a real directory; the fake checkout `C:/dev/candidate` has none). Four assertions that named the real root
  as the worker's `--cd`, `cwd` and brief path now name the scratch (`FAKE_SCRATCH_ROOT`, the scratch brief path). Every other existing test is unchanged and passes, including all real-root breach tests (they play "a write that reached the real tree").
- `workerRoleSwap.test.ts`: the registry it resolves from replaces only the `codex-implementer-cli` entry with the same adapter given a scripted scratch host; all other entries and the registration are the real ones.
- New support file `test/support/fakeScratchHost.ts`.
- `val-projectos-worker-codex-implementer1a.cjs`: pins `scrub` (no longer includes `cwd`, which WI-14 pins), `startPointed`, `correctionPointed` (the sentences are now one closure over the path) and four mutations moved with them.

## Checks (as run in the worktree; exit codes read)

- `npx tsc -p tsconfig.json --noEmit` (projectos/agent): exit 0.
- Targeted vitest (seven files: the three new ones plus `codexImplementerAdapter`, `workerRoleSwap`, `writeScopeRealGit`, `loopContext`, `codexCliAdapter`): 7 files, 313 tests passed, exit 0.
- Whole agent suite, run once at the end: 139 files, 4343 tests passed, 10 skipped; 1 file failed to start: `test/tenantSidecar.test.ts` (its `beforeAll` runs `tsc -p projectos/control-center/tsconfig.node.json`, which fails in this worktree; the control-center is not touched by this phase). Every file this phase touched passed.
- `val-projectos-worker-codex-implementer1a`: PASS, 149 named mutations killed (was 79; WI-14 to WI-25 added), exit 0.
- `val-projectos-context-manager1a` PASS (21 rules; 285 mutations), `val-projectos-kernel-followup1a` PASS (88), `val-projectos-worker-lifecycle-bounded1a` PASS, `val-projectos-kernel-role-review1a` PASS (44), `validate-no-secrets` PASS; all exit 0.
- Every other validator that mentions `src/loop` (agent-workforce, boot-continue, closure-transport, gate-decision-evidence, kernel-cost-cap, kernel-platform-stop, live-gate-owner-floor, port-agents, port-approvals, port-computer, port-credit, port-memory, port-providers, technical-continuation, trust-boundary, work-record-not-authority): PASS, exit 0.
  `val-projectos-resume1a` exits 1 on RS-13 (its own registration-order check of `validate-all.cjs` and `cached-runner.cjs`, files this phase does not touch): not from this phase.
  NOT COMPLETED: six slow validators that scan for importers of unwired ports (`port-context1a`, `port-mcp1a`, `port-research1a`, `port-routines1a`, `port-skills1a`, `skills-adopt1a`) hit their 100 s timeout under load (`port-context1a` also at 550 s) and were stopped. They do not read any file this phase touched (they mutate `runner.ts`, `observation.ts` and similar in memory), and this phase adds no import of a port; but I did not see them pass, so the lead should run them.
- `tsc -p tsconfig.test.json`: one error outside this phase (`test/skillLoad.test.ts(128,26)`).
- `validate-all` was not run (the lead runs it on the merged stack).

## Converge

PROTECTED files untouched: `git diff --name-only ed0f43ac` contains none of `workers.ts`, `verification.ts`, `candidateIdentity.ts`, `localCandidateCommit.ts`, `pinnedValidators.ts`, `commands/run.ts`,
`validate-all.cjs`, `cached-runner.cjs`, `codexCli.ts`, `runner.ts`, `system.ts`, `docs/06_Plan.md`, or anything under `.projectops/` (grep exit 1 = no match). `val-projectos-worker-codex-implementer1a.cjs` is
not in the Baseline section 4 list. Code diff against the base (before this commit, which also adds the two finish documents and the new files):

```
 .../agent/src/loop/adapters/codexImplementer.ts    | 163 +++++++++---
 projectos/agent/src/loop/writeScope.ts             |  18 +-
 .../agent/test/codexImplementerAdapter.test.ts     | 199 ++++++++++++++-
 projectos/agent/test/workerRoleSwap.test.ts        |  19 +-
 .../val-projectos-worker-codex-implementer1a.cjs   | 280 ++++++++++++++++++++-
 5 files changed, 628 insertions(+), 51 deletions(-)
```

New files: `scratchCheckout.ts`, `test/scratchCheckout.test.ts`, `test/codexImplementerScratch.test.ts`, `test/support/fakeScratchHost.ts`.

## Residuals (read before configuring a live Codex implementer)

1. **No live Codex run.** Unproven: that Codex accepts a temporary-directory scratch repository with no commit, and that its Windows sandbox (`windows.sandbox="elevated"`) allows a workspace there. A live probe
   spends provider money and asks the owner first. If Codex insists on a trusted repository with history, the scratch would need an initial commit (not built).
2. **Reads by absolute path stay open.** The scratch hides nothing from a worker that reads `C:\...` directly (the real checkout, `.env`, the owner's home). `plan.path` in the brief is still the real path.
   Container or VM isolation is the only fix; D4 is not retired. A command naming the real root is flagged by the existing out-of-checkout tripwire, which is a heuristic.
3. **Copy time on a large repository.** The export copies every listed file and the manifest hashes the whole scratch twice (streamed). Bounded at 100,000 files and 1 GiB, which refuses rather than fills a disk; not measured on a large repository.
4. **What the worker cannot see.** `.gitignore`, `.github`, `CLAUDE.md`, `AGENTS.md`, `.claude`, `.codex`, `.husky`, `.vscode`, every ignored file and `node_modules` are not in the scratch, so Codex cannot run the tests; the loop's own checks decide.
5. **Narrower detective remainder.** A write that reaches the real tree another way (absolute path, link) is still found only afterwards by the real-root snapshot and left for the owner. A reparse point node reports as a plain directory or file is not recognised as a link.
6. **A deletion refuses the run** (this slice), so a worker that legitimately removes a granted file is refused. New empty directories are not copied. A worker process that outlives its run could still write the scratch; every copied file is hashed again at its destination to catch that.
7. **Cleanup can fail** (a lingering handle on Windows). It retries three times, then is reported on the outcome; the directory is left in the temporary directory.
8. `tsc -p tsconfig.test.json` has one error that is not from this phase (`test/skillLoad.test.ts(128,26)`, `sort` on a readonly array); `tsc -p tsconfig.json` is clean.
9. The independent review (ECC `security-reviewer`) returned BLOCK on `001822c4`; the fix round below answers it. One recheck at most, per the spec.
10. **Untracked, non-ignored secret files ARE exported.** Only git-ignored files are kept out of the scratch. A file such as `.env.local` that is neither tracked nor ignored is listed by git and copied, so the worker can read it. Keep secrets git-ignored.
11. **The worker's descendants are not owned by the spawn** (`system.ts` is not edited): a process the worker started may outlive the run and still write in the scratch during the copy-back. The guards are the hash of every copied file at its destination and the rollback, not a prevention.
12. **Names refused by shape.** Any path segment with a tilde and a digit (`~1`) or a Windows device name is refused in a copy-back; an export skips tilde-digit names (and records them in `skipped`) and refuses a checkout that lists a device name. A hard-linked file is never copied back.

## Fix round for the independent review (`fix(worker): close the review findings on the scratch checkout`)

Verdict on `001822c4` was BLOCK: four findings reproduced with real directories and real git. Each has a real-directory test that FAILED first (14 of the 16 new tests failed before the fix; the
other two were already green), then the fix, then validator pins and named mutations, and a TESTS needle in the validator so deleting the test fails it (WI-T). The reviewer's point stands: text pins and logic tests had
passed while all four were live, so the validator pins the code and the tests prove it; the pins are not evidence on their own.

| Finding | Fix | Real-directory test (scratchCheckout.test.ts unless noted) | Validator |
|---|---|---|---|
| F1 HIGH: 8.3 short names (`GITIGN~1`, `AGENTS~1.MD`, `CLAUDE~1/...`, `HUSKY~1/...`) passed the control-path judgement and overwrote the real `.gitignore`, `.gitattributes`, `AGENTS.override.md`, `.claude/settings.json`, `.husky/pre-commit` | (a) a segment with a tilde and a digit is not a plain path; (b) the deepest existing destination is canonicalised with `realpath.native` and must equal the expected root-joined path exactly (this also refuses another case on a case-insensitive volume); (c) the real-root `after` snapshot is now taken AFTER the copy-back, so the backstop judges what landed | "F1: a short-name alias of a real control file is refused ... not overwritten" (8.3 is ON for `C:` here; a companion test checks the aliases really resolve, and skips only if 8.3 is off), "F1: a destination that exists under another spelling", IN "review F1(c): a write that lands in the real tree with the copy-back is seen by the backstop", AD "review F1(c) ..." | WI-26 (`short-name-shape-allowed`, `short-name-not-part-of-a-plain-path`, `short-name-files-exported`, `destination-alias-allowed`, `canonical-root-not-used`); WI-23 reordered (`backstop-taken-before-the-copy-back`, `second-copy-back-added`) |
| F2 MEDIUM: `NUL`, `CON.txt`, `aux`, `COM1`, `LPT1.log`, `CONIN$` were copied into the real tree | Every segment is refused if its part before the first dot, case-insensitively, is CON, PRN, AUX, NUL, COM0-9, LPT0-9 (and the superscript 1, 2, 3 forms), CONIN$, CONOUT$ or CLOCK$ | "F2: every reserved name is refused ..." and "F2: real files with reserved names made in a scratch" (made with `\\?\` paths, removed in a `finally`) | WI-27 (`device-names-allowed`, `nul-not-reserved`, `superscript-ports-not-reserved`, `device-extension-not-stripped`) |
| F3 MEDIUM: the export followed an untracked junction out of the root (`jl/secret.txt`, `docs/jd/secret.txt` landed in the scratch) | Every parent component of a listed path is `lstat`ed from the root down; the path is copied only below plain directories and as a plain file. Skipped paths are on `ScratchCheckout.skipped` (at most 200 named) | "F3: files that git lists beneath an untracked junction are not exported, and are reported as skipped" (real junctions) | WI-28 (`parents-not-checked`, `junction-parent-treated-as-plain`, `skipped-paths-not-recorded`) |
| F4 MEDIUM: `holder/backup` was predictable and only `makeDir`'d, so a planted junction there received a pre-image | No backup location exists until copy-back time. It is made then with `mkdtemp` in its own directory (not under the holder the worker's cwd lives in), is used only while an empty plain directory (`lstat`), and is removed by `dispose` with the scratch | "F4: a junction planted where the backup used to be is never written through" (junctions at `backup`, `backups`, `staging`, `tmp`), "F4: the backup directory is made at copy time ...", "F4: a staging directory that is a link, or is not empty, is refused" | WI-29 (`backup-beside-the-worker`, `backup-used-unchecked`, `linked-backup-accepted`, `non-empty-backup-accepted`) |

LOW items fixed: `.cursor`, `.cursorrules`, `.windsurf`, `.windsurfrules` and `.mcp.json` are agent control paths (`writeScope.ts`; `.github` was already covered by `.git*`; WI-10 mutation `cursor-and-windsurf-files-in-scope`, adapter
and scratch tests); a file with a hard-link count above one is refused when it would be copied back (real `linkSync` test; WI-30); what is judged in the scratch after the run is bounded by the export's own `maxFiles`
and `maxBytes` (plus a small allowance for the records placed afterwards) and refused above them (WI-30); refusal text goes through `plainName`, a helper of this module that escapes control, bidirectional-override and
other Unicode format characters (`codexCli.ts` and `inert` are unchanged; WI-30 `format-characters-shown-raw`, `refusal-paths-shown-raw`, `breach-paths-shown-raw`).

## Final round after the recheck (`fix(worker): final round after the recheck on the scratch checkout`)

The recheck verdict was APPROVE WITH CHANGES (F1 to F4 and the LOWs CLOSED). Each item below has a test that failed first, then the fix, a pin and a named mutation (validator now 185 mutations).

| Item | Fix | Test | Validator |
|---|---|---|---|
| N1 MEDIUM: an honest edit refused when git's index case differs from the disk case (committed `Docs/file.md`, directory renamed to `docs` on disk, grant `Docs`) | On Windows `destinationProblem` accepts a difference in CASE only between the canonical and the expected path; anything that differs by more than case stays refused (the tilde-digit rule blocks short names; the control-path judgement is case-insensitive, so accepting case opens nothing) | SC "N1: an honest edit is accepted when git's index case differs ... lands on the existing file" (real repo, one `docs` directory afterwards, content updated), SC "F1: a destination that exists under another spelling (a different name) is refused; only a case difference is accepted" | WI-26 (`case-difference-refused-again`, `any-difference-accepted`) |
| N3: a real-root breach or an unreadable `after` snapshot discarded the copy-back result (a "MAY HOLD PART OF THE COPY" warning was lost, and nothing said a clean copy-back had landed) | `settleScratch` returns the outcome and a plain copy note (`the copy-back landed N path(s)`, `nothing was copied back`, or `the copy-back failed: ...; the checkout was restored` / `THE CHECKOUT MAY HOLD PART OF THE COPY`); both refusals append it | AD "recheck N3": breach and unreadable root, each after a clean copy, a rolled-back failure, a partial failure and a refused judgement, plus a refused run | WI-32 (`breach-refusal-hides-the-copy-back`, `unreadable-root-refusal-hides-the-copy-back`, `failed-copy-note-lost`, `partial-copy-reported-as-restored`) |
| N4 LOW: bidirectional and other format characters allowed in a copied-back path and printed raw | A segment with a control, format or separator character (`\p{Cc}`, `\p{Cf}`, `\p{Zl}`, `\p{Zp}`: U+202A-202E, U+2066-2069, U+200B-200F, U+2028/2029, U+FEFF, tag characters) is not a plain path; the copy-step and bytes messages go through `plainName` too | SC "N4: a bidi override, zero-width ... is not a plain path segment" and "N4: a real file named with a right-to-left override in a scratch is refused, never copied, and shown escaped"; AD "recheck N4" | WI-31 (`format-characters-allowed-in-a-path`, `format-class-narrowed`, `copy-step-shows-the-raw-path`, `bytes-message-shows-the-raw-path`) |
| N5 LOW: more agent control files | `.gemini`, `.opencode`, `.kiro`, `.roo`, `.roorules`, `.clinerules`, `.continue`, `.aider.conf.yml`, `.aiderignore`, `.codeium` are control paths (`writeScope.ts`) | SC "N5: each is a control path under a directory grant"; AD `treats %s as out of scope` (nine more rows) | WI-10 (`more-agent-control-files-in-scope`) |
| N6 LOW: no pin on `owned.push(staging)` (deleting it leaves `projectos-backup-*` pre-images in the temp directory) | Pin `owned.push(staging);` in WI-22 and a named mutation; the existing test that checks the backup directory is gone after `dispose` stays and is a TESTS needle ("F4: the backup directory is made at copy time, outside the scratch holder, and removed with the scratch") | the same F4 test | WI-22 (`backup-location-not-owned`) |

**Stated limits (not fixed, N2 and unexercised cases).**
- A tilde followed by a digit ANYWHERE in a name is over-broad: a file such as `a~1b.md` is skipped at export (and recorded in `skipped`) and refused on write, although it is not a short name. It was kept because a precise short-name test needs the volume's own alias table.
- Paths over 260 characters, `subst` drives and a UNC temporary directory were not exercised by any test.

LOW stated, not fixed: item 11 above (descendants not owned). Rule 9 (a write made and undone) now has a behavioural scenario test ("rule 9 as a scenario") besides the first one; the validator pins the comparison (manifest equality by hash), not the scenario.

Checks for the fix round: `tsc -p tsconfig.json --noEmit` exit 0; `vitest run` on `scratchCheckout`, `codexImplementerScratch`, `codexImplementerAdapter`, `workerRoleSwap`, `writeScopeRealGit`, `loopContext`: 6 files, 199 tests passed, 0 skipped
(the Windows-only tests ran: this is Windows with 8.3 on for `C:`); `val-projectos-worker-codex-implementer1a` PASS (173 named mutations killed, was 149), `context-manager1a` PASS (285), `worker-lifecycle-bounded1a` PASS,
`kernel-followup1a` PASS (88), `kernel-role-review1a` PASS (44), `validate-no-secrets` PASS. No temporary directory or junction was left behind by the tests (checked in the temp directory afterwards).
