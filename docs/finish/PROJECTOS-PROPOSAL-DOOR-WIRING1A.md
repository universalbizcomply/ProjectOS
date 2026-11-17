# PROJECTOS-PROPOSAL-DOOR-WIRING1A

Stage 3 carry-forward C (plan v1.38). `openProposalDoor` had no caller, so a worker's `proposals` entry in its findings record was ignored. The loop now calls it, once per attempt, so each accepted entry becomes one pending proposal the owner decides with the memory commands.

**STATUS: built, tested and committed on the branch; NOT mergeable until one protected validator line is amended (see "Stopped on").**

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
- Tests: `test/proposalDoorWiring.test.ts` (41 tests), `test/support/loopWorld.ts`, `core/test/context-hardening.test.ts` (+1, 1 moved).

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
| DW-8 no door on refused worker, dry run, unreadable record | refused worker, dry run, not JSON, loop-rejected findings, absent record | `the-door-reads-an-unreadable-record`, `the-door-runs-for-a-refused-worker`, `the-door-runs-in-a-dry-run`, `the-findings-are-not-read-before-the-door` |
| DW-9 deterministic kind | `summariserKindOf`; core kind list and positive control; the existing manager compaction tests now pass through core with the new kind | `the-deterministic-kind-is-not-known`, `a-deterministic-run-is-recorded-as-a-model`, `the-kind-is-not-asked-of-the-ports`, `the-deterministic-name-is-another` |
| DW-10 runner only | source scan for callers; runner imports | `a-second-caller-of-the-door`, `the-runner-imports-a-propose-entry`, `the-runner-imports-an-approve-entry` |
| DW-11 no worker text | a canary in accepted and refused entries never reaches the output; line builder; bound | `the-line-quotes-the-door-message`, `the-lines-are-unbounded`, `the-runner-prints-more-than-the-lines` |
| DW-R registration | (validator) | 4 mutations |

## Checks (all run in THIS worktree)

AGENT RUNS WERE ALIAS RUNS: the agent's `@projectos/core` junction points at another worktree, so vitest and tsc used an alias to this worktree's `projectos/core/dist` (config files kept outside the repo and not committed).

CHECKS_PLACEHOLDER

## Converge

CONVERGE_PLACEHOLDER

## Stopped on (needs the owner)

**`val-projectos-port-skills1a.cjs` (PROTECTED) pins the exact old door text.** Its mutation `the-proposal-door-no-longer-proposes` (line 1660) matches `proposeSkill(... { files: one.files });`. DW-1 must pass `state`, so that text no longer exists, and the validator reports `PK-M: mutation 'the-proposal-door-no-longer-proposes' no longer applies`. I did not edit it. The fix is one line: in that mutation, `from` becomes `...{ files: one.files }, state);`. I proved it on a throw-away copy (deleted): with that one change `val-projectos-port-skills1a` passes (21 rules, 448 named mutations killed). Who: the owner, by approving an edit to that protected file (and adding it to plan v1.38's write list). Cost: one line. Cheaper alternatives were rejected: a second `proposeSkill(` call breaks MS-11 (exactly one place), aliasing the import breaks the MS-9 import pin, and hiding state in `sys` is implicit global state.

## Residuals

- A skill proposal made through the door is pending and minted, but waits until a command decides it: `memory approve/reject` covers memory only, and no command promotes a skill yet (owner decision 3).
- The two `.gitignore` lines belong to this repository only. They must join project onboarding (a project without them sees each proposal as an untracked file, which `isFoldableRunRecord` in `commands/run.ts` refuses at closure). The guard is correct either way: the rebase also absorbs the file into the git-visible baseline.
- The mint is written before the proposal file, in the installation state. A crash between the two leaves a mint with no proposal (harmless).
- `rebaseStoreGuard` that cannot absorb (an unexpected store change during the door) keeps the old baseline: the run stops at the next judgement with `MEMORY_STORE_CHANGED`, naming the paths. That is fail-closed, not a retry.
- The test world is a copy (`support/loopWorld.ts`); folding the two together is a later cleanup.
- `npm run typecheck:tests` reports one error in `test/skillLoad.test.ts(128,26)` (`.sort` on a readonly array) in a file this phase did not touch.
