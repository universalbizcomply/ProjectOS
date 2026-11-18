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
- `core/src/context/provenance.ts`: kind `deterministic-selection`; `context/contextManager.ts`: `summariserKindOf(ports.drafter)` records it when no drafter port exists, `agent-model` otherwise.
- `.gitignore`: `.projectops/memory/proposals/`, `.projectops/skills/proposals/`.
- Validators: new `val-projectos-proposal-door-wiring1a.cjs` (54 named mutations), registered in both runners directly before the memory stores entry. Pins moved with their rules, none deleted: `val-projectos-port-context1a.cjs` (PX-12 list and 3 mutations, +1 new), `val-projectos-memory-stores1a.cjs` (MS-9 text and its behavioural mutation gain `, state`), `val-projectos-context-manager1a.cjs` (CM-6 summariser pin and mutation, CM-10 judgement line, CM-20 checkout pin and mutation, +2 mutations).
- `val-projectos-port-skills1a.cjs`: the PK-16 mutation's `from` text follows DW-1's added argument (`{ files: one.files }, state);`). Owner-approved, one line.
- Tests: `test/proposalDoorWiring.test.ts` (45 tests: the WIP's 41, with the DW-8 refused-worker test hardened into two cases and DW-9 gaining three), `test/support/loopWorld.ts`, `core/test/context-hardening.test.ts` (+1, 1 moved). The validator's pinned test titles moved with the renamed and added tests.

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
| door wiring tests | `vitest run -c vitest.alias.config.ts test/proposalDoorWiring.test.ts` | 45 passed |
| core hardening | `vitest run test/context-hardening.test.ts` (core) | 105 passed |
| whole core suite | `vitest run` (core) | 115 files, 5007 tests passed |
| context manager and guard | `contextManager`, `contextReviewRound1`, `contextReviewRound2`, `contextStoreGuard`, `loopContext` tests | 5 files, 147 passed |
| every other agent test importing a changed file | `closureGate`, `continuationEndToEnd`, `degradedMode`, `hostReviewPath.e2e`, `hybridVerticalSlice`, `loopRunner`, `ownerEscalationWait`, `planDecision`, `platformStop`, `resumeRun`, `resumeState`, `sessionRecovery1a`, `skillLoad`, `workforceRun` | 14 files, 746 passed |
| this phase's validator | `node projectos/validators/val-projectos-proposal-door-wiring1a.cjs` | PASS (54 named mutations killed, each by its own rule) |
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

Defects found and fixed in this round: (a) the validator's pinned test titles (`DW-T`) failed after the DW-8 test was hardened and renamed; the pins moved with the tests, none removed. Nothing else was red.

## Converge

Spec: last section of `docs/changes/delta_spec.md` (rules DW-1..DW-11). Code against spec after this round: DW-1..DW-11 each have a test, a validator pin and named mutations (table above), all passing. The two weaknesses the audit found are closed: DW-9 now goes through the context manager's real compaction path and asserts the kind the kernel receives (deterministic when no drafter, `agent-model` with one), and DW-8's refused-worker test now proves the run stopped at the refusal itself (`WORKER_REFUSED` and its detail, one start, no proposal line or file) in both refusal forms. PROTECTED files untouched: `commands/run.ts`, `loop/workers.ts`, `val-projectos-port-memory1a.cjs`, `agent/src/index.ts`; `val-projectos-port-skills1a.cjs` has only the one owner-approved line. The spec file itself was not edited.

## Protected-validator edit (was "Stopped on")

`val-projectos-port-skills1a.cjs` pinned the exact old door text in its mutation `the-proposal-door-no-longer-proposes` (PK-16). DW-1 passes `state`, so the text no longer existed. The owner approved the one-line edit on 2026-11-18 (plan v1.42 write list); it is made, and the validator passes (21 rules; 448 named mutations killed). No other line of that file changed.

## Residuals

- A skill proposal made through the door is pending and minted, but waits until a command decides it: `memory approve/reject` covers memory only, and no command promotes a skill yet (owner decision 3).
- The two `.gitignore` lines belong to this repository only. They must join project onboarding (a project without them sees each proposal as an untracked file, which `isFoldableRunRecord` in `commands/run.ts` refuses at closure). The guard is correct either way: the rebase also absorbs the file into the git-visible baseline.
- The mint is written before the proposal file, in the installation state. A crash between the two leaves a mint with no proposal (harmless).
- `rebaseStoreGuard` that cannot absorb (an unexpected store change during the door) keeps the old baseline: the run stops at the next judgement with `MEMORY_STORE_CHANGED`, naming the paths. That is fail-closed, not a retry.
- The test world is a copy (`support/loopWorld.ts`); folding the two together is a later cleanup.
- `npm run typecheck:tests` reports one error in `test/skillLoad.test.ts(128,26)` (`.sort` on a readonly array) in a file this phase did not touch.
