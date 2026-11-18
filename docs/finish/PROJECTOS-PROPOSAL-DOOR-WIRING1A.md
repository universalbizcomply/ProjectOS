# PROJECTOS-PROPOSAL-DOOR-WIRING1A

Stage 3 carry-forward C (plan v1.38). `openProposalDoor` had no caller, so a worker's `proposals` entry in its findings record was ignored. The loop now calls it, once per attempt, so each accepted entry becomes one pending proposal the owner decides with the memory commands.

**STATUS: built and verified in this worktree on top of plan branch head `91c47584` (plan v1.42 merged in); every check below was run and passed, except the one pre-existing typecheck error named under Checks. Not pushed, not merged into the plan branch, plan not ticked (the lead does both at close; `validate-all` is the lead's single run on the merged stack).**

Two edits outside the phase's own files, both named here so they are not a surprise: (1) the two `.gitignore` lines are a LEAD edit that was already in the WIP; a worker is not granted `.gitignore`, so it is kept as the lead made it. (2) `val-projectos-port-skills1a.cjs`: ONE line (the PK-16 mutation `the-proposal-door-no-longer-proposes`, `from` text), edited under the owner approval of 2026-11-18 recorded in plan v1.42; nothing else in that file was touched.

## Existing code found (extended, not rebuilt)

| What | Where | Used for |
|---|---|---|
| `openProposalDoor`, `DoorEntryOutcome`, the dedupe | `agent/src/memory/proposalDoor.ts` | extended with an optional `state`; no second door |
| `proposeMemoryWrite`, `proposeSkill(..., state?)`, `recordSkillMint`, `SkillStatePorts` | `memory/proposalQueue.ts`, `skills/skillQueue.ts`, `skills/skillMint.ts` | the queues are unchanged; `state` was already a parameter of `proposeSkill` that no caller passed |
| `beginStoreGuard`, `endStoreGuard`, `StoreGuardBefore` | `context/contextStoreGuard.ts` | `endStoreGuard` is untouched; `rebaseStoreGuard` is added beside it and reuses `beginStoreGuard` |
| `snapshotMemoryStores` (digest of both store trees, directories included) | `memory/storeDigest.ts` | what still sees a write when git ignores the directories |
| `checkoutIdentityOf`, `contextPorts.checkout`, `options.contextStateDir ?? nodeInstallationStateDir()` | `context/contextCheckout.ts`, `loop/runner.ts` | the two halves of `SkillStatePorts` |
| `store.readFindings`, `store.findingsPath` | `loop/session.ts` | the loop's own judgement of a readable findings record |
| `SUMMARISER_KINDS`, `applyCompaction`, `deterministicDraft` | `core/src/context/provenance.ts`, `compaction.ts`, `agent/src/context/contextManager.ts` | PX-12 gains a kind; no new compaction path |
| The in-memory loop world | `test/loopContext.test.ts` | copied to `test/support/loopWorld.ts` (a test file cannot import another without running it); the original is untouched |

## What changed

- `loop/runner.ts` (+24 lines): one door call per attempt, after the post-checks store judgement and before the evidence; `let storeGuardCurrent = storeGuardBaseline;` (the `const` line CM-10/SA-11 pin is kept); `doorState` = `{checkout, stateDir}`.
- `context/proposalDoorStep.ts` (new, small): `doorCreatedPaths`, `doorOutcomeLines` (codes, indexes, ids, hashes; bounded), `afterProposalDoor`.
- `context/contextStoreGuard.ts`: `rebaseStoreGuard` (new function; `endStoreGuard` unchanged). It re-takes the baseline after the door and absorbs only the added files the door reported (shape `.projectops/(memory|skills)/proposals/(mem|skl)-<24 hex>.json`) and the store root and `proposals` directory above them; a changed or removed entry, anything else added, a baseline that cannot be taken, or git that cannot say, keeps the OLD baseline so the next judgement refuses with `MEMORY_STORE_CHANGED`. It does not exempt `proposals/`.
- `memory/proposalDoor.ts`: optional fifth parameter `state?: SkillStatePorts`, passed to the one `proposeSkill` call.
- `context/proposalBudget.ts` (new, fix round, DW-12): `PROPOSALS_BUDGET_BYTES` (6 MiB), `PROPOSAL_FILE_OVERHEAD_BYTES` (64 KiB), `storeBytesNow` (the size of every file under both store roots, summed from `stat.size` the way `storeDigest` sums it; a link, an unreadable entry or more entries or depth than the digest reads is `null`), and `proposalBudgetOf(fs, root)`, which measures again for every entry and answers whether `used + a bound on that entry's file` stays under the budget. `loop/runner.ts` hands it to the door (one more argument on the one call, one more import) over the same file system the guard reads. `memory/proposalDoor.ts`: an optional sixth parameter `budget`, asked once per entry that would be a NEW proposal (after the duplicate test, before anything is written), refused with the closed code `PROPOSAL_DOOR_BUDGET` (printed as a code only, DW-11).
- `memory/proposalDoor.ts` (fix round, LOW-1): the duplicate test also compares the target: the ledger reference, and the entry a replace names (a held proposal keeps the whole entry its `oldText` resolved to, so a request names the same one when its `oldText` is found in it).
- `core/src/context/provenance.ts`: kind `deterministic-selection`; `context/contextManager.ts`: `summariserKindOf(ports.drafter)` records it when no drafter port exists, `agent-model` otherwise.
- `.gitignore`: `.projectops/memory/proposals/`, `.projectops/skills/proposals/`.
- Validators: new `val-projectos-proposal-door-wiring1a.cjs` (77 named mutations after the fix round), registered in both runners directly before the memory stores entry. Pins moved with their rules, none deleted: `val-projectos-port-context1a.cjs` (PX-12 list and 3 mutations, +1 new), `val-projectos-memory-stores1a.cjs` (MS-9 text and its behavioural mutation gain `, state`), `val-projectos-context-manager1a.cjs` (CM-6 summariser pin and mutation, CM-10 judgement line, CM-20 checkout pin and mutation, +2 mutations).
- `val-projectos-port-skills1a.cjs`: the PK-16 mutation's `from` text follows DW-1's added argument (`{ files: one.files }, state);`). Owner-approved, one line.
- Tests: `test/proposalDoorWiring.test.ts` (54 tests: the WIP's 41, with the DW-8 refused-worker test hardened into two cases, DW-9 gaining three, and the fix round adding three for the duplicate key and six for DW-12), `test/support/loopWorld.ts`, `core/test/context-hardening.test.ts` (+1, 1 moved). The validator's pinned test titles moved with the renamed and added tests.

## Rule, test, mutation

Every test was written before the code and seen failing (module absent, kind absent, `.gitignore` lines absent). Under hand mutations of the runner the tests fail as expected (no re-baseline: 4 failures; no state: 1 failure).

| Rule | Tests (`proposalDoorWiring.test.ts`) | Named mutations (validator rule) |
|---|---|---|
| DW-1 state to `proposeSkill` | mint recorded with state, none without, a run mints under the state dir not the tree | `the-door-drops-the-state`, `the-door-forgets-to-pass-state-on`, `the-runner-passes-no-state`, `the-state-names-no-checkout`, `the-state-names-no-state-directory` |
| DW-2 once, after judgement, before evidence | write order proposal then evidence; check code writing a store stops before the door; memory and skill entries | `the-door-runs-before-the-checks`, `the-door-runs-after-the-evidence`, `the-door-is-called-twice-an-attempt` |
| DW-3 one entry, one proposal | corrections keep one proposal; second attempt says duplicate | `the-memory-duplicate-is-queued-again`, `the-skill-duplicate-is-queued-again`, `the-skill-entry-is-not-compared-by-its-files` |
| DW-4 caller from the kernel | provenance is worker id, implementer, session; an entry claiming owner is refused | `the-caller-is-the-owner`, `the-author-comes-from-the-record`, `the-session-is-not-this-one` |
| DW-5 a worker write to `proposals/` is refused | git-ignored (digest) for memory and skill; git-visible (path rule); real repo | `proposals-are-exempt-from-the-path-rule`, `the-digest-skips-proposals`, `the-direct-write-rule-is-dropped` |
| DW-6 re-baseline for exactly the door's files | next attempt not refused (visible and ignored); a worker file beside the door's refused (memory, skill, visible, ignored); 7 `rebaseStoreGuard` unit tests | 11 mutations on runner, guard and step (`the-baseline-is-not-retaken`, `the-rebase-absorbs-a-worker-file-beside-the-door`, `the-rebase-ignores-a-removal`, ...) |
| DW-7 `.gitignore` | exact lines; a real git repo is clean after a real door, `MEMORY.md` and `skills/promoted` still show; digest still watches the ignored dirs | 6 mutations (`the-whole-memory-store-is-ignored`, `promoted-skills-are-ignored`, ...) |
| DW-8 no door on refused worker, dry run, unreadable record | refused worker (two forms: non-zero exit and an outright refusal; each asserts the run STOPPED at `WORKER_REFUSED` with that detail, one start, and no proposal line or file), dry run, not JSON, loop-rejected findings, absent record | `the-door-reads-an-unreadable-record`, `the-door-runs-for-a-refused-worker`, `the-door-runs-in-a-dry-run`, `the-findings-are-not-read-before-the-door` |
| DW-9 deterministic kind | `summariserKindOf`; core kind list and positive control; a REAL compaction through `assembleRunContext` (12 committed decisions, no drafter) whose draft is read where it reaches the kernel's `applyCompaction` (a pass-through spy on `@projectos/core`) and is `deterministic-selection`, the kernel accepting it; the same compaction with a drafter port is `agent-model`; nothing is drafted when everything fits. Seen failing with `summariserKindOf` forced to `agent-model` (2 failures) | `the-deterministic-kind-is-not-known`, `a-deterministic-run-is-recorded-as-a-model`, `the-kind-is-not-asked-of-the-ports`, `the-deterministic-name-is-another` |
| DW-10 runner only | source scan for callers; runner imports | `a-second-caller-of-the-door`, `the-runner-imports-a-propose-entry`, `the-runner-imports-an-approve-entry` |
| DW-3 (fix round) the target is part of the duplicate key | two replaces with the same content and different targets are two proposals; the same replace twice is one; two adds with different ledger references are two | `the-memory-duplicate-ignores-the-target`, `the-duplicate-ignores-the-ledger-reference`, `the-duplicate-ignores-which-entry-is-replaced`, `an-add-is-a-duplicate-of-a-replace` |
| DW-12 the proposals cannot grow the stores past the digest bound | ten ~1 MB skill records with NO budget leave a store the digest refuses (the lock-out, reproduced); with the budget the first N are accepted and the rest refused with `PROPOSAL_DOOR_BUDGET`, nothing written for a refused one, the stores stay under the budget and the guard's next judgement (against the baseline after the door) is `ok`; in a real run a refused skill beside an accepted memory entry leaves the next attempt unrefused; a memory entry is refused too; a store the check cannot measure refuses; the measure is every file under both roots and nothing else; a duplicate costs nothing | 19 mutations (`the-door-takes-no-budget`, `a-memory-entry-is-not-asked-of-the-budget`, `a-skill-entry-is-not-asked-of-the-budget`, `the-skill-is-proposed-before-the-budget-is-asked`, `the-runner-gives-the-door-no-budget`, `the-budget-is-at-the-digest-bound`, `the-entry-size-is-not-counted`, `an-unmeasurable-store-counts-as-empty`, `the-skills-store-is-not-measured`, `a-link-in-a-store-is-measured-as-a-file`, `the-stores-are-measured-once`, ...), each fires DW-12 and no other rule (checked with a throw-away script that lists the rules each mutation fires) |
| DW-11 no worker text | a canary in accepted and refused entries never reaches the output; line builder; bound | `the-line-quotes-the-door-message`, `the-lines-are-unbounded`, `the-runner-prints-more-than-the-lines` |
| DW-R registration | (validator) | 4 mutations |

## Checks (all run in THIS worktree)

AGENT RUNS WERE ALIAS RUNS: the agent's `@projectos/core` junction points at another worktree, so vitest and tsc used an alias to this worktree's `projectos/core/dist` (config files kept outside the repo and not committed).

Plan branch `projectos-autonomy-bootstrap1a` (head `91c47584`, plan v1.42) was merged into this branch first: clean automatic merge, merge commit `4bf6dd7f`. No conflict markers; BOTH `validate-all.cjs` and `cached-runner.cjs` list, in this order directly before `val-projectos-memory-stores1a`: `...worker-codex-implementer1a`, `memory-owner-commands1a`, `proposal-door-wiring1a`, then `memory-stores1a` (comment line and entry identical in the two files; the entries from the plan branch kept).

Core was rebuilt in this worktree (`tsc -p tsconfig.json`, no output) and the agent was checked and tested against that build through the uncommitted alias configs.

| Check | Command (from the worktree) | Result |
|---|---|---|
| agent source typecheck | `tsc -p tsconfig.alias.json` | clean |
| agent source + tests typecheck | `tsc -p tsconfig.alias.test.json` | ONE error, PRE-EXISTING and not touched: `test/skillLoad.test.ts(128,26): error TS2339: Property 'sort' does not exist on type 'readonly string[]'` |
| door wiring tests | `vitest run -c vitest.alias.config.ts test/proposalDoorWiring.test.ts` | 54 passed (45 before the fix round) |
| core hardening | `vitest run test/context-hardening.test.ts` (core) | 105 passed |
| whole core suite | `vitest run` (core) | 115 files, 5007 tests passed |
| context manager and guard | `contextManager`, `contextReviewRound1`, `contextReviewRound2`, `contextStoreGuard`, `loopContext`, `memoryStores` tests, with the door tests (fix round, one run) | 7 files, 241 passed |
| every other agent test importing a changed file | `closureGate`, `continuationEndToEnd`, `degradedMode`, `hostReviewPath.e2e`, `hybridVerticalSlice`, `loopRunner`, `ownerEscalationWait`, `planDecision`, `platformStop`, `resumeRun`, `resumeState`, `sessionRecovery1a`, `skillLoad`, `workforceRun` | 14 files, 746 passed |
| this phase's validator | `node projectos/validators/val-projectos-proposal-door-wiring1a.cjs` | PASS (77 named mutations killed; the 23 added in the fix round each fire their own rule and no other) |
| `val-projectos-port-skills1a` | after the PK-16 pin edit | PASS (21 rules; 448 named mutations killed) |
| `val-projectos-port-context1a` | | PASS (18 rules; 327 named mutations killed) |
| `val-projectos-memory-stores1a` | | PASS (9 new and 12 changed files judged; 198 text and 84 behavioural mutations killed) |
| `val-projectos-context-manager1a` | | PASS (21 rules; 287 named mutations killed) |
| `val-projectos-port-memory1a` | | PASS (20 rules; 213 named mutations killed) |
| `val-projectos-memory-provenance1a` | | PASS (8 new and 9 changed files judged; 204 text and 125 behavioural mutations killed) |
| `val-projectos-memory-owner-commands1a` | | PASS (120 named mutations killed) |
| `val-projectos-resume1a` | | PASS (14 rules; 171 named mutations killed) |
| `val-projectos-kernel-followup1a` | | PASS (88 named mutations killed) |
| `validate-no-secrets` | | PASS |
| `val-projectos-skills-adopt1a` (slow, detached) | | PASS (24 rules; 234 named mutations killed; 179 s) |
| other validators whose source names a touched file | `memory-exit-proof1a` (276 mutations), `agent-workforce1a`, `boot-continue1a` (18), `kernel-platform-stop1a` (101), `kernel-role-review1a` (44), `port-approvals1a` (83 scenarios), `port-providers1a` (221 text, 89 behavioural), `port-research1a` (205 text, 165 behavioural), `technical-continuation1a`, `work-record-not-authority1a`, `worker-lifecycle-bounded1a` | all PASS |

`validate-all` was not run (the lead runs it once on the merged stack).

FIX ROUND (independent ECC review, verdict approve with changes): HIGH-1 and LOW-1 below. Re-run after it, in this worktree, one suite at a time: `tsc -p tsconfig.alias.json` clean; `tsc -p tsconfig.alias.test.json` only the known `skillLoad.test.ts(128,26)`; door wiring + context/guard + `memoryStores` tests 241 passed (7 files); core `context-hardening` 105 passed (core unchanged in the fix round); the 14 other agent files importing the runner or the door 746 passed; validators (all PASS): `proposal-door-wiring1a` 77 mutations, `port-skills1a` 448, `memory-stores1a` 198 text + 84 behavioural, `context-manager1a` 287, `memory-owner-commands1a` 120, `validate-no-secrets`, `port-memory1a` 213, `memory-provenance1a` 204 text + 125 behavioural, `resume1a` 171, `kernel-followup1a` 88, `memory-exit-proof1a` 276, `agent-workforce1a`, `boot-continue1a` 18, `kernel-platform-stop1a` 101, `kernel-role-review1a` 44, `port-approvals1a` 83 scenarios, `port-providers1a` 221 text + 89 behavioural, `technical-continuation1a`, `work-record-not-authority1a`, `worker-lifecycle-bounded1a`, `port-context1a` 327 (331 s), `port-research1a` 205 text + 165 behavioural (124 s), `skills-adopt1a` 234 (123 s; run because it reads the door and the runner). Behavioural mutations by hand: with both budget asks removed from the door, 3 DW-12 tests fail; with the target removed from the duplicate test, 2 DW-3 tests fail.

Defects found and fixed in the first verification round: (a) the validator's pinned test titles (`DW-T`) failed after the DW-8 test was hardened and renamed; the pins moved with the tests, none removed. Nothing else was red.

## Converge

Spec: last section of `docs/changes/delta_spec.md` (rules DW-1..DW-11). The fix round adds DW-12 (the budget) and extends DW-3 (the duplicate key) in the code, the tests and the validator only; the spec file is not edited here, so the lead may want to add both rules to it at close. Code against spec after this round: DW-1..DW-11 each have a test, a validator pin and named mutations (table above), all passing. The two weaknesses the audit found are closed: DW-9 now goes through the context manager's real compaction path and asserts the kind the kernel receives (deterministic when no drafter, `agent-model` with one), and DW-8's refused-worker test now proves the run stopped at the refusal itself (`WORKER_REFUSED` and its detail, one start, no proposal line or file) in both refusal forms. PROTECTED files untouched: `commands/run.ts`, `loop/workers.ts`, `val-projectos-port-memory1a.cjs`, `agent/src/index.ts`; `val-projectos-port-skills1a.cjs` has only the one owner-approved line. The spec file itself was not edited.

## Protected-validator edit (was "Stopped on")

`val-projectos-port-skills1a.cjs` pinned the exact old door text in its mutation `the-proposal-door-no-longer-proposes` (PK-16). DW-1 passes `state`, so the text no longer existed. The owner approved the one-line edit on 2026-11-18 (plan v1.42 write list); it is made, and the validator passes (21 rules; 448 named mutations killed). No other line of that file changed.

## DW-12: the budget, and why it is what it is

The lock-out was real: the door writes through the legitimate path, and the store digest (`MAX_STORE_DIGEST_TOTAL_BYTES`, 8 MiB) refuses a bigger tree, after which `rebaseStoreGuard` keeps the old baseline and every later run is refused until files are deleted by hand. The test `the lock-out this prevents` reproduces it (ten ~1 MB skill records through the door with no budget; `snapshotMemoryStores` then returns `MEMORY_STORE_TOO_LARGE`).

- **Where the check sits.** `proposalBudgetOf` is built by the loop and handed to the door as one more argument; the door asks it for every entry that would be a new proposal, after the duplicate test (a duplicate writes nothing and costs nothing) and before `proposeMemoryWrite` / `proposeSkill` write anything. It is measured again for each entry, so the entries of one record and of every later attempt of a run all count.
- **How it measures.** The sum of `stat.size` of every file under `.projectops/memory` and `.projectops/skills`, the same sum the digest uses (same depth and entry bounds; a link or an unreadable entry is not measurable and refuses, never counts as empty). The entry's own cost is an upper bound: its text as pretty-printed JSON (escapes included) plus 64 KiB for what a proposal file adds around it (schema, hashes, provenance, the validation report).
- **Why 6 MiB.** It is 2 MiB under the digest bound. The estimate is an upper bound but not exact, and other writes (an approved memory file, a promoted skill, a decision the owner makes while a run is going) can land between two measurements; a budget at the bound would leave none of that room. Everything the door accepts leaves the stores at or under 6 MiB at the moment of the check, so the guard's digest still reads them.
- **What a refusal does.** The entry is answered `PROPOSAL_DOOR_BUDGET` (a closed code, printed with its index and class only, no worker text, DW-11). Nothing is written for it, the attempt's result is not flipped, and the entries that were accepted in the same record are still absorbed into the guard's baseline (`afterProposalDoor` only absorbs files the door reported making). The next judgement of the guard is `ok`: pinned by `with the budget the first are accepted ... and the guard still clears` and, through a real two-attempt run, by `a refused entry does not stop an accepted one ...`.
- **Deviation from the review's example.** A findings record is capped at 1 MiB (`MAX_FINDINGS_RECORD_CHARS`), so nine ~1 MiB skill entries cannot arrive in ONE record. The lock-out takes several attempts or runs (the per-author cap of ten pending bounds it at about ten packages, which is enough to pass 8 MiB), so the tests drive ten records, one per door call, which is the same path an attempt takes.
- **Not done on purpose.** No change to `storeDigest.ts`, `skillQueue.ts` or core. The author cap and the 1 MiB package size stay as they were; the budget is the only new bound. The budget is not the owner's tool for clearing a full queue: once the owner decides what is waiting, the room is back.

## Carry-forwards (from the independent review; NOT fixed in this phase)

- MEDIUM-1: a proposal the owner REJECTS is re-proposed under a new id on every later attempt of the same session (decided proposals are not matched; capped at 10 per author, so it is owner fatigue and not a flood).
- MEDIUM-2: `.gitignore` is a lead edit in the commit diff but not in the phase's `writePaths` (the lead keeps it; the owner-direct closer does not check `writePaths`).
- LOW-2: the door runs even when the attempt's checks FAILED and before the effects attestation (matches DW-2, wider than DW-8's wording).
- LOW-3: `rebaseStoreGuard` absorbs by path, not by content (the same window as the existing guard).
- LOW-4: an owner decision during a multi-attempt run changes the digest and the guard blames the worker (fails closed).
- LOW-5: `contextManager.ts:593` records the ledger `compactor: 'deterministic-selection'` even when a drafter wrote it (production passes no drafter).
- LOW-6: the findings file is read three times without a byte cap before the door's 1 MiB check (pre-existing).
- LOW-8: weak tests at `proposalDoorWiring.test.ts` lines 112, 402 and 409 (as numbered in the review).
- Skill proposals can now be minted and reviewed, so independent review is the only barrier, and `reviewAndPromoteSkill` has no product caller yet.

## Residuals

- A skill proposal made through the door is pending and minted, but waits until a command decides it: `memory approve/reject` covers memory only, and no command promotes a skill yet (owner decision 3).
- The two `.gitignore` lines belong to this repository only. They must join project onboarding (a project without them sees each proposal as an untracked file, which `isFoldableRunRecord` in `commands/run.ts` refuses at closure). The guard is correct either way: the rebase also absorbs the file into the git-visible baseline.
- The mint is written before the proposal file, in the installation state. A crash between the two leaves a mint with no proposal (harmless).
- `rebaseStoreGuard` that cannot absorb (an unexpected store change during the door) keeps the old baseline: the run stops at the next judgement with `MEMORY_STORE_CHANGED`, naming the paths. That is fail-closed, not a retry.
- The test world is a copy (`support/loopWorld.ts`); folding the two together is a later cleanup.
- `npm run typecheck:tests` reports one error in `test/skillLoad.test.ts(128,26)` (`.sort` on a readonly array) in a file this phase did not touch.
