# PROJECTOS-SKILLS-ADOPT1A — skill adoption: validator, independent review, hash pin (plan 3.2)

**Phase:** PROJECTOS-SKILLS-ADOPT1A, plan v1.36 item 3.2, Delta spec rev 2 row 10. Depends on CONTEXT-MANAGER1A and PORT-SKILLS1A.
**Branch:** `projectos-skills-adopt1a`, worktree `C:/dev/ProjectOS-worktrees/skills-adopt1a-v136`, based on `e269e5c5`. One commit, not pushed, not
merged. `docs/06_Plan.md` is not edited. No phase record. `validate-all` was not run (the lead's).

## Existing code found (B1) and what was extended

| Found | Used how |
|---|---|
| `core/src/skills/*` (linter, audit, guard patterns, `promotion.ts`, `prompt.ts`) | Extended in place. The validator pass, the pin, the hash and the fence are PORT-SKILLS1A's and are called, not copied |
| `agent/src/skills/skillQueue.ts` (propose, review, promote, lock, atomic write) | Extended: the two origin doors, a verifier and a checkout on the review. The one writer of `promoted/` is unchanged |
| `core/src/memory/committedProof.ts`, `provenance.ts` (a registered frozen object bound to its facts) | The shape of `skillOrigin.ts`, `committedSkill.ts`'s minted read and `skillReview.ts`'s attestation registry |
| `core/src/memory/committedBytes.ts`, `agent/src/memory/committedBytes.ts` (committed bytes at HEAD) | The discipline of `judgeCommittedSkillRead` and `skillCommitted.ts`. Their judge refuses any path that is not a memory file, so a skill record needs its own; their git helpers are private and outside the write paths, so about 60 lines are repeated (see Residuals) |
| `core/src/memory/retention.ts` `OwnerDeletionVerifier` (a port that answers exactly `true`, none in production) | The shape of `SkillReviewVerifier` |
| `agent/src/context/contextManager.ts`, `contextRetrieval.ts`, `contextRun.ts`, `contextPorts.ts`, `contextStoreGuard.ts` | The seams. The loader joins through `sourcesOf`, one new section and one evidence field. The store guard is untouched and already wired in the runner |
| `core/src/context/managerItems.ts` `gateContextItemText` | The one gate a skill block passes, through the manager's own screen port |
| Registry O1 entries `skill-load` (P1), `skill-propose` (P2) and `approve` (P5) in `security/action-registry.json` | Named, not edited. The validator pins their classes |

## What was built

| Item | File | Result |
|---|---|---|
| Kernel-set origin | `core/src/skills/skillOrigin.ts` | `proposedSkillOrigin(actor)` and `importedSkillOrigin(actor)` (owner only) mint a frozen mark bound to the author, registered by identity. Neither takes an origin. A string, a plain object, a copy, a JSON round-trip, a `structuredClone` and an inheriting object are refused (`SKILL_ORIGIN_NOT_KERNEL`). `buildSkillProposal` reads the author from the mark and from nothing beside it |
| Queue doors | `agent/src/skills/skillQueue.ts` | `proposeSkill` (always `proposed`) and `importSkill` (owner). A request that carries an `origin`, by value, getter or throwing Proxy, is refused at both |
| Independent review port | `core/src/skills/skillReview.ts` | `SkillReviewVerifier`, a port that answers exactly `true` over a frozen claim: action `approve` P5, tenant, project, name, package hash, proposal hash, author and session, reviewer, role and session. A throw, a Promise, `1`, `"true"`, an object and a missing verifier are refusals. The author is never asked about. **There is no production verifier**, and nothing here pretends there is |
| Promotion | `core/src/skills/promotion.ts`, queue | `promoteSkill` needs the approval this module made AND an attestation the verifier answered `true` for, for this review of this package. Promotion is a proposal until then |
| Committed loader (core) | `core/src/skills/committedSkill.ts` | `judgeCommittedSkillRead` (regular blob at HEAD, working tree equal, caps in UTF-8 bytes, one path spelling per name) mints a read; `loadCommittedSkill` refuses a non-minted read, a moved head, JSON that is not a record, an unpinned record (`SKILL_NOT_PINNED`), a changed package (`SKILL_STALE`), a name that is not the path's, then asks the verifier again (`purpose: load`) and renders |
| Committed loader (agent) | `agent/src/context/skillCommitted.ts` | Gathers the facts through the injected `GitRunner` and `DocumentFs`: HEAD once, the directory listing, the tree entry, a blob that hashes to its name, the working tree by `lstat`. Reads no script, writes nothing |
| Skill section | `agent/src/context/skillContext.ts` | `loadSkillSection`: bound to the checkout before git is asked, keyed on the envelope's pair, gated with `gateContextItemText`, never cut, at most 4 skills and 8,000 characters and a quarter of the window, counted, each refusal a withheld id and code with the fix named |
| Manager wiring | `contextManager.ts` | Skills render after every decision, under `## Promoted skills (loaded, authority none)`, are never ranked, the thread is compacted under the window minus their cost, a withheld skill is a non-blocking failure |
| Evidence | `contextRun.ts` | `StoredContextEvidence.skills`: name, package hash, block hash, size, commit, blob, other file names |
| Block | `core/src/skills/prompt.ts` | Names the other files in a package as "listed only", says nothing in `scripts/` is ever run, never reads their text; the fence is a hash of everything inside it |
| Evasions | `core/src/skills/guardPatterns.ts` | See "Bounded-repeat evasions" |
| Validator | `validators/val-projectos-skills-adopt1a.cjs` | 15 rules (SA-1 to SA-15), 171 named mutations, in both runners |

## Acceptance criteria

| Criterion | Tests | Validator |
|---|---|---|
| A skill whose origin is supplied by a caller is refused | `skills-promotion.test.ts` (string, plain object, copy, clone, legacy fields beside a mark), `skillsQueue.test.ts` (request origin at both doors, getter, Proxy, naming the owner on the request) | SA-1, 13 mutations; PK-12 |
| A skill changed by one byte after promotion is refused by the loader | `skills-committed.test.ts` (a byte, a trailing newline, CRLF, a BOM, an added file), `skillLoad.test.ts` (committed, and uncommitted, and through real `git`) | SA-4, SA-5 |
| Promotion without a validator pass and an independent review is refused | `skills-review.test.ts`, `skillsQueue.test.ts` (no verifier, each non-`true` answer, another project, a bad checkout, the author) | SA-2, SA-3 |
| The bounded-repeat evasions are refused; nothing runs from `scripts/` | `skills-guard.test.ts`, `skills-committed.test.ts`, `skillLoad.test.ts` | SA-10, SA-8 |
| Validator pin and named mutations, each killed by its own rule | | SA-1 to SA-15 |
| Direct writes to `.projectops/skills` stay refused | `contextStoreGuard.test.ts` (unchanged) | SA-11 pins the guard and its wiring |
| Nothing the loop writes lands untracked in the project tree | `skillLoad.test.ts`: real `git init`, `git status --porcelain --untracked-files=all` empty before and after a load | SA-11 |

## Bounded-repeat evasions (PORT-SKILLS1A carry-forward)

Both listed evasions were reproduced first, then closed.

| Evasion | Fix |
|---|---|
| A 70-character path before `.env` evaded `py_read_secrets_file` and `js_read_secrets_file` (the bound was 64, before and after the name) | The path bound is the line cap (4,096: a longer line is refused unread, so no path hides). The name's tail is asked in a lookaround (1,024, far past a file name), so it adds and does not multiply. The write exemption (`'w'`, `mode='a'`) is kept and tested at 300 characters |
| `sed` with 5 or more arguments before `-i` evaded the critical `agent_config_mod_shell` | `sed` is judged by two lookaheads from its own start: an in-place flag within 512 characters and the file within 512. No count of arguments matters. `-i.bak`, `-ni`, `--in-place=.bak` are now in place too (the old pattern needed whitespace after the flag) |

Also widened with one wide repeat and no product: the redirect and `tee` path bound 256 to 4,096. Costs, measured: the worst case is `Path('` followed by `.env` repeated, 94 ms on 262 KB; both new shapes are in the clock tests and in SA-10.
`the-fix-is-quadratic` (two wide repeats in `sed`) is killed by the clock.

## Reviews not run here

`requiredReviews` is Claude self-review and ECC SECURITY, which are the lead's. Self-review found, and fixed, before the commit: the redundant
build-time origin checks were removed (the door is the one place: a second check made two mutations unkillable); `loadSkillBlock`, a route to a prompt
that skipped the committed loader and the verifier, was removed from the agent (PK-13 now says the queue offers none).

## Decisions made and why

- **The loader asks the verifier again.** The pin is a hash and not a signature, and the PORT-SKILLS1A BINDING says no loader may read a hand-written promoted record. The committed record plus the injected verifier is the signing, until an owner-presence verifier exists. **Consequence: in production no skill loads yet**, because `nodeContextPorts` supplies `skills: {}`. A committed skill is withheld `SKILL_REVIEW_VERIFIER_MISSING` and the run's advice says who supplies the verifier. This is the intended fail-closed state, the same as memory deletion.
- **The origin is minted, not checked twice.** The build step trusts a mark; only two doors make one.
- **Skills are not a provenance kind.** `core/src/memory/provenance.ts` is closed and outside the write paths, so skills render in their own section from the manager, never through `rankByProvenance`.
- **The promoted record is a working-tree file that the owner commits**, as approved memory is. The loader reads only HEAD. The loop writes nothing into the tree: the evidence is in the run record and the ledger stays under the installation.

## Files touched

`git diff --stat` at the commit (the lead merges against RESUME1A):

EXISTING FILES TOUCHED (the lead merges these):
- `projectos/agent/src/context/contextManager.ts` — `sourcesOf` loads skills, one `skills` field on the ready result, one parameter and one line in `fileTextOf`, the window the thread is compacted under, the estimate, `adviceOf` returns memory advice plus `skillAdviceOf`
- `projectos/agent/src/context/contextPorts.ts` — optional `skills` port, `portsProblem` checks it, `nodeContextPorts` returns `skills: {}` (its signature is pinned by CM-13 and is unchanged)
- `projectos/agent/src/context/contextRun.ts` — `StoredContextEvidence.skills` and one line in `evidence()`
- `projectos/agent/src/skills/skillQueue.ts`, `index.ts` — the doors, the ports, `loadSkillBlock` removed
- `projectos/core/src/skills/promotion.ts`, `prompt.ts`, `refusal.ts`, `index.ts`, `guardPatterns.ts`
- `projectos/validators/val-projectos-port-skills1a.cjs`, `validate-all.cjs`, `projectos/speed/cached-runner.cjs`
- tests: `core/test/skillFixtures.ts`, `skills-promotion.test.ts`, `skills-prompt.test.ts`, `skills-guard.test.ts`, `agent/test/skillsQueue.test.ts`

ADDED: `core/src/skills/{skillOrigin,skillReview,committedSkill}.ts`, `agent/src/context/{skillContext,skillCommitted}.ts`, `core/test/{skills-review,skills-committed}.test.ts`, `agent/test/skillLoad.test.ts`, `agent/test/support/skillWorld.ts`, `validators/val-projectos-skills-adopt1a.cjs`, this doc.

## Narrowing of `val-projectos-port-skills1a` (truthful, none loosened)

| Change | Why |
|---|---|
| PK-16 counts `importSkill` as a skill entry point; its call-site table is untouched (CM-19 pins that line) | A new door is a new entry point |
| PK-13 says the queue offers no way to a prompt, and renders from `loadPromotedSkill` | `loadSkillBlock` is gone |
| PK-12 probes the kernel-set origin: a string, a copy and a request field are refused, the doors set it | The origin is no longer a request field |
| PK-15 "and again at the prompt" and two mutations moved | The prompt-time credential screen is now `gateContextItemText` through the manager's screen port, in `agent/src/context`, which this validator cannot load. SA-7 pins it, and `skillLoad.test.ts` proves it |
| PK-17: the core import allow-list gained `../memory/memoryShapes.js`, and a new check holds that file to no import and no impurity | The committed-skill judge needs `plainRecordOf` and `isGitObjectId`, which are pure |
| Harness: origin through the doors, review through the verifier, `memoryShapes.ts` copied into the scratch | The API changed |
| Mutations updated where the lines moved (11), two removed, six added | Names unchanged where the guarantee is unchanged |

## For the lead: the pin to move

`val-projectos-context-manager1a` CM-15 pins its successor. Registering this validator immediately after it, in both lists, makes CM-15 fail with
"not between ... and val-projectos-connector-contract1a". The one-line change in `projectos/validators/val-projectos-context-manager1a.cjs`
(line 449): the successor `"val-projectos-connector-contract1a"` becomes `"val-projectos-skills-adopt1a"` (and the message text with it). This validator's own SA-13 pins
the same neighbours (`PREVIOUS_VALIDATOR`, `NEXT_VALIDATOR` at its top), and the lead moves `NEXT_VALIDATOR` if RESUME1A registers between them. The CM validator was not edited, and it otherwise passes (21 rules, 285 mutations) with this branch.

## Converge (B9)

- **Unbuilt, by decision:** a production `SkillReviewVerifier` (none can be honest until the reviewer is kernel-issued or the pin is signed); an export of the skills queue from `agent/src/index.ts` (outside the write paths, as before); a CLI for `importSkill` and `reviewAndPromoteSkill`; the ledger recording a shown skill (below).
- **Drift:** none found. `contextStoreGuard.ts`, `run.ts`, `runner.ts`, `taskEnvelope.ts`, `actionRegistry.ts`, `tenant.ts`, `action-registry.json` are untouched. CM validator 21 rules and 285 mutations hold except CM-15.
- **PROTECTED untouched:** `git diff --stat` lists no file of `docs/00_Baseline_State.md` §4 and none of the delta spec; `docs/06_Plan.md` is not edited.
- **No model call, no new dependency:** SA-12 compares `dependencies` and `devDependencies` of core and agent with `e269e5c5`.
- **Browser purity:** core's barrel bundled for the browser with esbuild (platform browser, tree-shaking off, `node:crypto` and `node:buffer` stubbed as control-center does) and evaluated with no Node global: OK. The only `node:` import in the new core files is `node:crypto`.

## Residuals and carry-forwards

1. **No production verifier, so no skill loads in production.** Intended. To turn it on: supply `ContextSkillPorts.reviewVerifier` (wrap `nodeContextPorts`'s result) and a `SkillPromotionPorts` to the review command. An owner decision on what answers for the reviewer.
2. **The ledger has no field for a shown skill.** `ContextLedgerBody` is in `core/src/context` (RESUME1A's write path). Withheld skills are in the ledger by id and code; shown skills are in the run evidence (`storedContext.skills`) and the ledger's `fileHash` covers their text. A later phase adds `skills` to the ledger body.
3. **About 60 lines of git reading are repeated** in `agent/src/context/skillCommitted.ts` because `agent/src/memory/committedBytes.ts` is outside the write paths and its helpers are private. Fold them when that file is next opened.
4. **Other bounded gaps remain.** `ANY` is 512 everywhere else: `curl ... <513 characters> $SECRET` and `cat <513 characters> .env` still evade, and `cp`/`mv` to a config file keeps its 64 and 40. A script of more than 512 characters between `sed` and the file, or a `-i` more than 512 characters after `sed`, evades. Raising `ANY` multiplies with the second repeat in most patterns and needs the lookaround form used here, pattern by pattern.
5. **Skills outside the compaction.** The thread is compacted under the window minus the skills' cost, but a skill block is not itself compacted: over its bound it is a placeholder.
6. **The pin is still a hash.** Anyone who can write the committed record and answer for the verifier can promote. The verifier is what closes that, and it has no implementation yet.
7. **An imported skill by the owner still needs a second owner actor to review it** (PORT-SKILLS1A Limits). Unchanged.
8. **A committed skill the working tree has touched is refused for everyone** until it is committed or restored. That is the memory rule and it is loud on purpose.

## Checks

### Red run (tests first)

The source files this phase changed were put back to `e269e5c5` (the new files stayed, the barrels did not export them), the tests were run, then the
source was restored from a backup and the same tests run again. Before: core `skills-review`, `skills-committed`, `skills-promotion`, `skills-prompt`,
`skills-guard`: **123 failed, 216 passed of 339**; agent `skillsQueue`: **11 failed of 56**, and `skillLoad.test.ts` did not load (the loader did not exist).
After: the same files, **515 core and 95 agent skill tests pass** (see below). The restore was checked by `git diff` against the index: empty.

### Counts (read from the runs, not from this doc)

| Check | Result |
|---|---|
| core `npx vitest run` | 113 files, **4,858 passed** (skills: 10 files, **515** passed; PORT-SKILLS1A left 376) |
| core `npm run -s build` | clean |
| agent `tsc` through the alias config (`@projectos/core` to this worktree's `core/dist`) | clean |
| agent `vitest run`, alias config, the whole suite | 131 files: 130 passed, **1 failed: `tenantSidecar.test.ts`, the known alias artefact**; **4,055 passed**, 10 skipped |
| agent `skillsQueue` 56 passed, `skillLoad` 39 passed | 95 |
| `val-projectos-skills-adopt1a` | PASS, 15 rules, **171 named mutations killed** (about 80 s) |
| `val-projectos-port-skills1a` | PASS, 21 rules, **448 named mutations killed** (was 440) |
| `val-projectos-context-manager1a` | 21 rules and 285 mutations hold; the only failure is CM-15 (successor pin), which is the lead's one-line change above |
| `val-projectos-port-credit1a` | PASS, 192 real files judged (after `git add`: it judges tracked files) |
| `val-projectos-memory-provenance1a`, `memory-stores1a`, `port-memory1a`, `port-context1a`, `port-approvals1a`, `port-mcp1a`, `port-providers1a`, `port-research1a`, `port-search1a`, `tenant-contract1a`, `tenant-principal1a`, `validate-no-secrets` | all PASS |
| browser purity of core's barrel | OK (esbuild, platform browser, tree-shaking off, no Node global) |
| `validate-all` | **not run** (the lead's) |

How the agent tests ran: a temporary `vitest.alias.config.ts` and `tsconfig.alias.json` inside `projectos/agent` aliased `@projectos/core` to this worktree's
`core/dist`, because the agent's `node_modules/@projectos/core` junction points at another worktree. Both are untracked and **not committed**.
The validators run the real sources, so the alias does not apply to them. Whoever merges builds `core` before the agent tests.

`val-projectos-skills-adopt1a`'s exported `run()` is synchronous and returns an array (checked the way `validate-all` calls it). No name this phase
exports equals a name another port's validator guards (`importSkill`, `loadCommittedSkill`, `judgeCommittedSkillRead`, `proposedSkillOrigin` and the rest are new).

