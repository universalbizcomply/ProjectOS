# PROJECTOS-SKILLS-ADOPT1A — skill adoption: validator, independent review, hash pin (plan 3.2)

**Phase:** PROJECTOS-SKILLS-ADOPT1A, plan v1.36 item 3.2, Delta spec rev 2 row 10. Depends on CONTEXT-MANAGER1A and PORT-SKILLS1A.
**Branch:** `projectos-skills-adopt1a`, worktree `C:/dev/ProjectOS-worktrees/skills-adopt1a-v136`, based on `e269e5c5`. Three commits (`959973f4`, the review-round-1 commit `8564dbe9`, then the review-round-2 commit), not pushed, not
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
| A 70-character path before `.env` evaded `py_read_secrets_file` and `js_read_secrets_file` (the bound was 64, before and after the name) | The path bound is the line cap (4,096: a longer line is refused unread, so no path hides). The name's tail is asked in a lookaround. (Review round 1 took the tail back from 1,024 to the original 64: see M3a below.) The write exemption (`'w'`, `mode='a'`) is kept and tested at 300 characters |
| `sed` with 5 or more arguments before `-i` evaded the critical `agent_config_mod_shell` | CLOSED in review round 2 (the form in the first fix commit, a scan that stopped at the next `sed` word, let that word hide the write). `sed` is judged per LINE, from the line's start, with three independent lookaheads (the word `sed`, an in-place flag after whitespace, the file), each over the 4,096-character line. No count of arguments and no word between them matters; the cost is three linear scans per line. `-i.bak`, `-ni`, `--in-place=.bak` are in place too. TRADED: the three may come in any order, so a line that mentions all three is a finding (a false positive, never a miss) |

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

REVIEW ROUND 1 added: `agent/src/skills/skillMint.ts`, `core/test/skills-round1.test.ts`, `agent/test/skillRound1.test.ts`, and changed `skillOrigin.ts`, `skillReview.ts`, `promotion.ts`, `prompt.ts`, `committedSkill.ts`, `hiddenText.ts`, `guardPatterns.ts`, `refusal.ts`, `index.ts` (core and agent), `skillQueue.ts`, `skillContext.ts`, both validators and the finish doc.

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
the same neighbours (`PREVIOUS_VALIDATOR`, `NEXT_VALIDATORS` at its top). SA-13 now accepts `val-projectos-connector-contract1a` OR `val-projectos-resume1a` as the successor, so the lead moves nothing here whichever registers next. The CM validator was not edited, and it otherwise passes (21 rules, 285 mutations) with this branch.

## Converge (B9)

- **Unbuilt, by decision:** a production `SkillReviewVerifier` (none can be honest until the reviewer is kernel-issued or the pin is signed); an export of the skills queue from `agent/src/index.ts` (outside the write paths, as before); a CLI for `importSkill` and `reviewAndPromoteSkill`; the ledger recording a shown skill (below).
- **Drift:** none found. `contextStoreGuard.ts`, `run.ts`, `runner.ts`, `taskEnvelope.ts`, `actionRegistry.ts`, `tenant.ts`, `action-registry.json` are untouched. CM validator 21 rules and 285 mutations hold except CM-15.
- **PROTECTED untouched:** `git diff --stat` lists no file of `docs/00_Baseline_State.md` §4 and none of the delta spec; `docs/06_Plan.md` is not edited.
- **No model call, no new dependency:** SA-12 compares `dependencies` and `devDependencies` of core and agent with `e269e5c5`.
- **Browser purity:** core's barrel bundled for the browser with esbuild (platform browser, tree-shaking off, `node:crypto` and `node:buffer` stubbed as control-center does) and evaluated with no Node global: OK. The only `node:` import in the new core files is `node:crypto`.

## Review round 1 (ECC security review of `959973f4`)

Fixed in one new commit on top of `959973f4` (not amended). Each finding has its own rule and named mutations in `val-projectos-skills-adopt1a` (SA-16 to SA-22) and tests in `core/test/skills-round1.test.ts` and `agent/test/skillRound1.test.ts`.

| Finding | What changed | Proof |
|---|---|---|
| **M1** a forged stored proposal file was promoted | A file is not a mint. The queue records the hash of every proposal it makes in the INSTALLATION state, `<state>/skill-mint/mint-<hash of tenant and project>/<proposal hash hex>.json` (`agent/src/skills/skillMint.ts`), created exclusively and BEFORE the proposal file. A review of a proposal whose hash the kernel did not record is refused with the new code `SKILL_NOT_MINTED` and the fix "the owner re-proposes it through the door". What is read back must equal the bytes the queue writes. Nothing lands in the project tree, and the mint functions are not on the agent barrel | the reviewer's `t1b` forgery as an agent test, a positive control, a mint keyed by tenant and project, a truncated or planted file, a real `nodeSystem` plus real `git init` showing the mint adds nothing to `git status`; SA-16, 8 mutations |
| **M2** a getter defeats the mark | Every field is read once. An actor (and a reviewer) is snapshotted by own data descriptors into a frozen copy: an accessor, an inherited field, a class instance, a list and a throwing Proxy are refused (`SKILL_PROVENANCE`), and the doors mint from the snapshot. `buildSkillProposal` destructures its input once, and the queue reads `request.files` once from its data property | tests: role `implementer` then `owner`, origin read once, a reviewer that is a getter or is changed after the decision; SA-17, 6 mutations |
| **M3a** the guard was slow | The `sed` alternative was made linear (see review round 2 for the form it ended as). The name tail is back to 64 (`959973f4` made it 1,024). Re-timed cold (first execution, which is what a run pays) on 262 KB of the reviewer's shapes; the guard tests hold every pattern this phase changed to 100 ms, and a regression test over a fragment corpus shows nothing blocked before now passes | `skills-guard.test.ts`; SA-18 (a 262 KB clock probe, 250 ms bound, because the validator runs loaded) |
| **M3b** the validator ran before the verifier | `loadCommittedSkill` is staged: shape, pin shape, caps and the package hash, then the name, the binding, THEN the verifier, then the validator, then the render. No verifier means no regex work. One run reads at most 524,288 characters of record text through the loader (`MAX_SKILL_RUN_WORK_CHARS`); the rest are placeholders by code | tests: a record that would fail the validator is refused for the missing verifier first, a hostile 200 KB record costs almost nothing without one; SA-18 |
| **M4** the record named no project | Tenant and project are in the proposal hash and the pin, and the claim carries origin, rules version and the time of the review (frozen). At load the pin is compared with the checkout's binding (`SKILL_NOT_THIS_CHECKOUT`, fix named) BEFORE anyone is asked; the proposal hash is worked out again from the pin, the record and the validator's advisories (a mismatch is `SKILL_TAMPERED`); a rules version that moved is `SKILL_STALE`. A proposal made with no checkout is pending and readable but cannot be reviewed or promoted | tests: a record promoted in project A and committed into B, an edit of the author or the time of proposal; SA-19, 8 mutations |
| **L1** codes with no fix | `SKILL_FIXES` in `skillContext.ts` has a who-does-what sentence for every code a skill can be withheld with (the committed reader's, the gate's, the listing's, the loader's, and the queue's refusals the loader can give); `skillAdviceOf` reads it | a test walks every closed list; SA-20 reads the lists from source, 4 mutations |
| **L2** "a person reviewed" | The section note and the block say a skill is "recorded as reviewed and promoted, and a verifier answered true". Nothing asserts a person | tests; SA-21 |
| **L3** the fence and the headings | The fence-tag check reads the NFKC fold, any dash, space or full-width bracket, and covers all four fences; a line that starts as a heading of the context file is a blocking finding (`section-heading-forgery`); a listed file name is shown at most 48 characters long | tests (12 spellings of the tag, 9 headings); SA-21, 5 mutations |
| **L5** | `renderSkillBlock`, `renderCheckedSkill`, `checkPromotedSkillCheaply` and `finishPromotedSkill` are not on core's barrel, and `loadPromotedSkill` is not on the agent's. SA-22 also scans every product source and refuses either name outside `prompt.ts` and `skillQueue.ts` | tests; SA-22, 5 mutations |
| **L6** | `proposeSkill(sys, root, caller, null)` (and `undefined`, a string, a list, a getter `files`) is `SKILL_FAILED_VALIDATION` named `not-a-package`, never a throw | tests; SA-22 |

### Not fixed, and why

- **The name tail is 64 again.** `open('.env.<more than 64 characters>')` evades `py_read_secrets_file` once more. `959973f4` raised the tail to 1,024, and that was a large part of why the guard was slow; no cheap form kept both. On this one input the guard is as narrow as it was before this phase.
- (Closed in review round 2: a bare `sed` word between `sed` and the file no longer hides the write.)
- **Still slow, and not changed by this phase (carried):** `env_exfil_curl`, `curl_pipe_*` and `read_secrets_file` take about 150 to 190 ms cold on 262 KB of their worst shape. They were slow before. A 262 KB hostile `sed -i ` package costs about 267 ms over every pattern together, against 173 ms before this phase; the three `sed` patterns are each under 100 ms.
- **L4, carried, and the guard is advisory.** `ANY` is 512 elsewhere (`curl ... $SECRET` and `cat ... .env` with 513 or more characters between), `cp` and `mv` to a config file keep their 64 and 40, `open('.env').read()` is not matched, and `mode='a'` later on a line is exempted. The denylist misses `perl -pi`, `awk -i inplace` and `gsed`. None of this is a boundary. The guard is a screen that a determined author evades; the boundary is the review, the verifier and the committed pin.
- **L7.** `judgeCommittedSkillRead` is attestation by its caller. That the text is the blob at HEAD is established by the git blob hash check (`blobNameOf` in `agent/src/installation/projectAllowlist.ts`) in the agent's reader; core's judge trusts the facts it is handed.
- **L8.** HEAD is read twice in a run (the manager's read, then the skill listing's). The listing refuses a HEAD that moved between them (`SKILL_STALE`), so a move is refused and not mixed, but they are two reads, not one.
- **L9.** The proposal queue writes `.projectops/skills/proposals/<id>.json` into the PROJECT tree. That is not this phase's change and it was not moved. A run that happens after a proposal is written sees an untracked file that `isFoldableRunRecord` in the protected `run.ts` does not list (Stage 4.1). The mint this round adds is NOT in the project tree; the real `git init` test shows it adds nothing beside the proposal file.
- **The proposal door** (`projectos/agent/src/memory/proposalDoor.ts`, outside the write paths) still calls `proposeSkill` with four arguments. A worker's skill proposal through it is therefore pending, names no project and cannot be promoted until the door passes a `SkillStatePorts` (`{ checkout, stateDir }`, the values the context manager already has). That fails closed. The lead makes the one-line change when the door is next opened.
- **A transparent Proxy** as an actor is read through its traps; core has no port to prove otherwise (named in `skillOrigin.ts`).
- Residual 1 (no production verifier, so no production state directory wiring for the review command) is unchanged.

## Review round 2 (ECC recheck of `8564dbe9`, the last bounded round)

One more commit on top of `8564dbe9`, not amended. No CRITICAL or HIGH was open; the MEDIUM and the LOWs below were fixed or written down. Each has its own validator rule and named mutations (SA-23, SA-24 are new; SA-15, 16, 18, 20, 21 were extended) and its own tests.

| Item | What changed | Proof |
|---|---|---|
| **MEDIUM-1** the `sed` stop let a bare `sed` word hide the write | The stop is gone. Each `sed` alternative of the three config patterns is `^(?=[^\n]{0,4096}\bsed\b)(?=[^\n]{0,4096}(?<=\s)<in-place flag>)(?=[^\n]{0,4096}<file>(?!\.?\w))`: line-anchored, three independent lookaheads, reach the whole 4,096-character line. `sed -i 's,sed,x,' CLAUDE.md`, `sed -i -e 's/a/b/' -e 'sed' CLAUDE.md` and `sed -i sed CLAUDE.md` are blocked again. The reviewer's 60,000-input regression corpus (`t6m.mjs`, run against the base `e269e5c5` patterns) now shows **0 inputs blocked at the base and passed now** (it was 312), with 2,025 inputs newly blocked. Re-timed on every changed pattern over the reviewer's hostile shapes (t6, t6e, t6g, t6i): the three `sed` patterns are at most 14 ms on 262 KB; the guard tests hold them to BUDGET 100 ms | `skills-guard.test.ts` (corpus now holds the inner-word fragments; the three inputs; order test); SA-23 with a corpus probe and 3 mutations, SA-10 mutations re-aimed |
| **L-1** a package whose record the loader never reads | `land()` works out the exact record (`JSON.stringify(record, null, 2)` plus a newline) in UTF-8 bytes and refuses a promotion over `MAX_COMMITTED_SKILL_RECORD_BYTES` with the new code `SKILL_RECORD_TOO_LARGE` and the fix "the author shrinks the package (shorter references, fewer files) or splits it into two skills, and proposes again". Nothing is written and the proposal stays pending | agent test: two 150 KB references refused with nothing written and the proposal pending, one 150 KB reference promoted (control); SA-24, 4 mutations |
| **L-2** the work cap | `SKILL_CONTEXT_WORK_CAP` is its own code, with the fix "the owner retires the promoted skills the project does not use (fewer promoted skills per project), then runs again". `SKILL_CONTEXT_OVER_BUDGET` keeps the budget fix. The text is counted when it is handed to the loader, whatever the loader then answers: that hand-over is the work being bounded | agent test (two records read, two withheld by the new code, the advice names the true fix); the L1 closed-code test lists the new code; SA-18, SA-20 |
| **L-4** the mint read through a link | The `System` port has no way to ask whether a path is a link, so it cannot be refused. The header comment no longer claims it is; it says a link to exactly the right bytes is read through, and that planting it needs write access to the installation state, which is already the trust for writing the mint | SA-16 (the header may not claim a link is refused) |
| **L-5** more spellings | A heading is also refused as a setext heading (a title line followed by a line of `=` or `-`), with emphasis or escapes inside the title (`## **Committed decisions**`), with 1 to 6 hashes, behind a list marker or a quote (`- ## ...`, `> ## ...`). The fence-tag gap is 32 characters, not 4, and numeric, hexadecimal and the common named character references (`&#60;`, `&#x3c;`, `&lt;`, `&sol;`, decoded twice) are read as the characters they stand for. Every step is bounded by the line | tests (8 tag spellings, 10 ATX forms, 5 setext forms, a 262 KB linear-time test over nine hostile shapes: under 150 ms); SA-21, 5 mutations |
| `decided()` guard | The `SKILL_NOT_MINTED` message now also says "if this checkout names no tenant and project, the owner first runs ProjectOS from the registered checkout", so a request that falls through the binding guard still gets the right fix | read; not separately mutated |

### Residuals written down, not coded

- **L-3.** The mint is not consulted at load. A hand-written record with a self-consistent hash loads if the injected `reviewVerifier` answers `true`. The load path trusts the verifier alone, and there is no production verifier. **A future production `SkillReviewVerifier` MUST check the installation-state mint and promotion record (the `<state>/skill-mint/` files this phase writes, and a promotion record it should add), or an allowlist of promoted proposal hashes, before it answers `true`.** Until it does, the pin is a hash and not an authorization. The finish doc's residual 6 says the same from the other side.
- **L-6.** (Pre-existing.) A forged pending proposal file counts toward the queue's caps (`SKILL_QUEUE_FULL`), because the queue counts files and a file is not a mint. The owner can reject them (`rejectSkillProposal` needs no mint). Not changed: counting only minted proposals would need a state read per pending file, and the cap is a bound on work, not a security boundary.
- **The sed order is traded.** A line that holds `sed`, an in-place flag and the config file in any order is a finding. That is a false positive on prose such as "CLAUDE.md is not for sed -i", and never a miss.
- **The name tail is still 64** (round 1), and `ANY` is still 512 in the other patterns (round 1, L4).

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
| core `npx vitest run` (after review round 2) | 114 files, **4,942 passed**, none failed (the round-1 timing flake did not recur) |
| core `npm run -s build` | clean |
| agent `tsc` through the alias config (`@projectos/core` to this worktree's `core/dist`) | clean |
| agent `vitest run`, alias config, the whole suite (after review round 2) | 132 files: 131 passed, **1 failed to load: `tenantSidecar.test.ts`, the known alias artefact**; **4,084 passed**, 10 skipped; no timing test failed |
| agent `skillsQueue`, `skillLoad`, `skillRound1` | the round-1 file has 26 tests; the three pass |
| `val-projectos-skills-adopt1a` | PASS, **24 rules, 234 named mutations killed** (22 and 216 after round 1; 15 and 171 in the first commit) |
| `val-projectos-port-skills1a` | PASS, 21 rules, **448 named mutations killed** (10 mutations repaired for the new text, one probe added, none removed) |
| `val-projectos-context-manager1a` | 21 rules and 285 mutations hold; the only failure is CM-15 (successor pin), which is the lead's one-line change above |
| `val-projectos-port-credit1a` | PASS, 193 real files judged (after `git add`: it judges tracked files) |
| `val-projectos-memory-provenance1a`, `memory-stores1a`, `port-memory1a`, `port-context1a`, `port-approvals1a`, `port-mcp1a`, `port-providers1a`, `port-research1a`, `port-search1a`, `tenant-contract1a`, `tenant-principal1a`, `validate-no-secrets` | all PASS |
| browser purity of core's barrel | OK (esbuild, platform browser, tree-shaking off, no Node global) |
| `validate-all` | **not run** (the lead's) |

How the agent tests ran: a temporary `vitest.alias.config.ts` and `tsconfig.alias.json` inside `projectos/agent` aliased `@projectos/core` to this worktree's
`core/dist`, because the agent's `node_modules/@projectos/core` junction points at another worktree. Both are untracked and **not committed**.
The validators run the real sources, so the alias does not apply to them. Whoever merges builds `core` before the agent tests.

`val-projectos-skills-adopt1a`'s exported `run()` is synchronous and returns an array (checked the way `validate-all` calls it). No name this phase
exports equals a name another port's validator guards (`importSkill`, `loadCommittedSkill`, `judgeCommittedSkillRead`, `proposedSkillOrigin` and the rest are new).

