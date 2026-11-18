# PROJECTOS-WORKER-CODEX-IMPLEMENTER1A — finish record (plan 4.1a)

Stage 4, first phase. Owner approval of the delta spec: 2026-11-17 ("Approved: build PROJECTOS-WORKER-CODEX-IMPLEMENTER1A as drafted. Commit the delta spec alone first, then proceed.").
Delta spec: `docs/changes/delta_spec.md`, section "Plan v1.37 (draft)", commits `47c7f3d6` (as approved) and `4bfdb318` (FR-003 correction, see below).

## What it delivers

A second implementer kind, `codex-implementer-cli`. Which provider implements and which reviews is now a committed-config choice
(`execution.workers`, `execution.reviewerWorkerId`). Before this phase only Claude could implement, so the Stage 4 exit proof
("the same phase runs with the implementer and reviewer providers swapped, and no code change") could not run.

- `projectos/agent/src/loop/adapters/codexImplementer.ts`: runs `codex exec` headless from the brief path and the loop's own fixed sentence; the adapter sets the one
  `workspace-write` sandbox and a closed argument allowlist; no credential in, credential-shaped text withheld on the way out; never reviews; never resumes
  (a cut-off run starts a fresh worker).
- `projectos/agent/src/loop/writeScope.ts`: the write-scope check for a worker that cannot be given per-path grants.
- `BUILT_IN_ADAPTERS` gains one entry. `codexCli.ts` (the reviewer kind) gained three `export`s and no logic change.
- Nothing is configured: this repository's `project-config.json` has no Codex implementer worker. The kind does nothing until the owner adds one.

## A correction to the approved delta, made before building

The approved draft said the loop checks changed paths against the plan's `writePaths` after a worker. It does not. A Claude worker's scope is enforced
**before** the write, by per-path `--allowedTools Edit(path)` grants the loop puts on its argv. Codex has no per-path grant: its sandbox covers the whole
checkout, `.projectops/authority/` included. So this phase had to add the check. FR-003 and Rule 3 were rewritten in `4bfdb318`, committed alone before any code.

**Review fix round (`fix(worker): close the review findings on the scratch checkout`):** the control-path set now also holds `.cursor`, `.cursorrules`, `.windsurf`, `.windsurfrules` and `.mcp.json` (`.github` is covered by `.git*`); the real-root
snapshot that this document describes is taken AFTER the scratch copy-back, so it judges what landed. Residual 2 (reads) is unchanged, and a worker's leftover descendants (not owned by the spawn) could still write the scratch during a copy-back.
See `PROJECTOS-WORKER-SCRATCH-CHECKOUT1A.md`, "Fix round".

**Final round (`fix(worker): final round after the recheck on the scratch checkout`):** the control-path set also holds `.gemini`, `.opencode`, `.kiro`, `.roo(rules)`, `.clinerules`, `.continue`, `.aider.conf.yml`, `.aiderignore` and `.codeium`; a refusal that follows
the copy-back now says what the copy-back did. Stated limits: a tilde and a digit anywhere in a name is over-broad (`a~1b.md` is skipped at export and refused on write); paths over 260 characters, `subst` drives and a UNC temp directory were not exercised.
See `PROJECTOS-WORKER-SCRATCH-CHECKOUT1A.md`, "Final round".

**Update (PROJECTOS-WORKER-SCRATCH-CHECKOUT1A):** the scope is now PREVENTATIVE on the route this phase built. Codex runs in a scratch copy and only granted changes are
copied back; see `docs/finish/PROJECTOS-WORKER-SCRATCH-CHECKOUT1A.md`. The text below is what this phase built, and the snapshot it describes stays as the backstop.

The check is **detective, not preventative**. The adapter reads the grants from the argv the loop composed, never forwards them to Codex, snapshots the
checkout before and after the run, and refuses the run naming every path that changed outside the grants. The write has already happened; the paths are
left in the tree for the owner and nothing is certified.

## What the snapshot compares

Changed, untracked and deleted paths by status and raw content (including the loop's own gatekeeper asking records); both paths of a rename; ignored paths
by name, an ignored file by content, everything under `.projectops/` file by file; the repository's local configuration; HEAD; index flags that hide a
change; `.git/info/exclude`. Git runs isolated, with every configured filter driver switched off and content hashed with `--no-filters`.
`.git*`, `.claude`, `.codex`, `.agents`, `CLAUDE.md` and `AGENTS(.override).md` are out of scope under any grant.

## Evidence

- Tests: `codexImplementerAdapter.test.ts` (fake spawn and fake git), `workerRoleSwap.test.ts` (both directions through `resolveWorker`, `resolveReviewer`,
  `roleBindingProblems` and the real adapters, differing only in worker config), `writeScopeRealGit.test.ts` (real git in a temporary repository: every
  case the independent review reproduced, including a filter driver that must not run; that test fails when the neutralisation is removed).
- Validator `val-projectos-worker-codex-implementer1a`: rules WI-1 to WI-13, 76 named mutations, each counted killed only when its own rule fires.
- Validators that read a touched file, all passing: `kernel-followup1a` (88), `worker-lifecycle-bounded1a`, `kernel-role-review1a` (44),
  `context-manager1a` (285), `port-credit1a`, `validate-no-secrets`.
- Counts and the stack battery are in `docs/06_Plan.md` beside the tick.

## Reviews

- ECC `security-reviewer` (independent, mandatory): BLOCK on the first build `d2a358ec`. Reproduced with real git: ignored paths invisible; a worker-written
  filter driver ran inside the check; non-ASCII names mangled; a rename origin, a commit, a skip-worktree flag and an exclude pattern each hid a change;
  asking records not compared; stderr unfiltered.
- Agency `application-security-engineer` (corpus `ad9264e3`, AMBER, advisory): BLOCK for the exit proof. F1 ignored paths, F2 asking records, F3 reads are
  unconstrained, F4 failure text unfiltered, F5 Codex control paths under a directory grant, F6 detect-then-leave, F7 filter drivers, F8 `.cmd` shim.
- Fix round `33396e7f`, then one ECC recheck: **APPROVE WITH CHANGES**. Findings 1 to 5 CLOSED and 6 PARTLY, each replayed against real git in throwaway repositories; no ReDoS in the tripwire.
  New: N1 a submodule's own filter driver ran inside `git status`; N2 a modified submodule made the snapshot unreadable; N3 failure text was cut to 300 characters before the credential check; N4 a pre-set `status.showUntrackedFiles=no` hid new ignored files.
- Final round (no further review, by the one-recheck rule): N1 and N2 by `--ignore-submodules=dirty` on every status call; N3 by judging the whole text; N4 by `--untracked-files=normal`. Lead re-ran the suites and validators.
  Carried (N5, LOW): an edit to a file that already carried an index flag before the run, a retargeted dangling symlink, and files inside an existing nested untracked repository are not seen. The tripwire does not name `*.pem`, `*.key`, `secrets.json`, `os.environ` or a bare `env`.

Accepted and fixed: ECC 1 to 6, Agency F1, F2, F4, F5, F7. Not fixed, stated below: Agency F3 (reads), F6 (the tree is left as it is), F8.

## What this does NOT prove (read before configuring a Codex implementer)

1. **No live Codex run was made.** Everything is fakes plus real git. The command and credential tripwires are heuristics on text; they may refuse an
   honest run, and they can be dodged.
2. **Reads are not constrained.** A workspace-write sandbox restricts writes. A Codex implementer can read anything the owner's Windows user can read,
   in or out of the checkout (D4). Do not run it on a checkout that holds another party's data or secrets.
3. **A run that creates build output is refused** (a new `dist/` or `coverage/` is a new ignored path outside the grants). **A write inside an existing ignored directory outside `.projectops/` is not seen** (an existing `node_modules/`). Planted code there would be loaded
   by the loop's own checks.
4. **A write made and undone during the run is not seen**, nor a path under `.git` other than configuration, HEAD, index flags and `info/exclude`.
   Whether Codex's Windows sandbox makes `.git` read-only was not verified.
5. **After a refusal the tree is left as the worker left it.** The owner restores it; nothing does so automatically.

   **Residuals 3 to 5, status after PROJECTOS-WORKER-SCRATCH-CHECKOUT1A:** CLOSED for every write made inside the scratch: the scratch holds no `node_modules`, so there is no existing ignored
   directory to plant in; a write made and undone leaves the same manifest and no trace; the scratch's `.git` is never copied and never run again; and after a refusal the real tree is
   byte-identical (the owner has nothing to restore). STILL TRUE, narrower: a new `dist/` or any new file outside the grants still refuses the run (now harmlessly, in the scratch);
   and a write that reaches the REAL tree by another route (an absolute path, a link the sandbox allows) is still only detected by the real-root snapshot, after the fact, and left for the owner.
   Residual 2 (reads) is NOT closed: the worker can still read anything the owner's user can read by absolute path, so D4 stands until container or VM isolation.
6. ~~**Stored context is not handed to a Codex implementer.** The kind is not in `CONTEXT_POINTABLE_KINDS` (pinned by `val-projectos-context-manager1a`
   CM-20), so a run that has stored context refuses for it. The exit proof on a project with stored context needs that follow-up.~~
   CLOSED by PROJECTOS-CONTEXT-CODEX1A (see `docs/finish/PROJECTOS-CONTEXT-CODEX1A.md`): the kind is context-pointable and both sentences name the file.
7. **The worker executable should be `codex.exe`, not the npm `.cmd` shim.**

The real fix for 2 to 5 was to run the worker in a scratch checkout and copy back only granted paths: built in PROJECTOS-WORKER-SCRATCH-CHECKOUT1A (plan 4.3a). It closes 3 to 5 as stated above; it does not close 2.

## Owner decisions this leaves

- Whether a live Codex implementer may run before Stage 4.3 isolation, with residuals 2 to 5 accepted for one bounded proof, or only after it.
- Order of the next two phases: the Stage 3 carry-forwards (which should include item 6) and the 4.2 role broker wiring. Both can be built; at most two builders at a time.
- `val-cd-b4-sealed-expected-window-facts1a` is still the one known `validate-all` failure (public `session_digest` in the dormant Rust host, protected).
