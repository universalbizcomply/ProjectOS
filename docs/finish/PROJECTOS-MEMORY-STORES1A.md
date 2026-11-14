# PROJECTOS-MEMORY-STORES1A: the memory classes on existing stores, and one proposal door

**Phase:** PROJECTOS-MEMORY-STORES1A, plan v1.36 item 3.1 (Stage 3), row 7 of `docs/changes/delta_spec.md` (revision 2, approved).
**Branch:** `projectos-memory-stores1a`, worktree `C:/dev/ProjectOS-worktrees/memory-stores1a-v136`, based on `841f3286`.
Not pushed, not merged, phase not closed, `docs/06_Plan.md` not edited. `validate-all` is the lead's and was not run here.

**State:** built and self-checked. No review has seen it yet (ECC SECURITY is the one this phase owes). Everything below is what
was run and seen in this worktree; where a check could not run as written, it says so.

## What was asked and what exists

Nothing here calls the new code from a route: the context manager (3.4) and the loop wiring (Stage 4.1) are the first callers.
Two things that Stage 3 needs are **not wired by this phase, because the file that has to change is outside its write paths or
PROTECTED**: the check-step refusal and the call to the door. Both are shipped as pure code with tests, and the exact edit is in
"Out-of-path edits needed" below.

## Existing code found (B1, before any change)

| Where | What it was | Used how |
|---|---|---|
| `core/src/memory/{store,admission,proposal,prompt,threatScan,refusal,hashPinned}.ts` | The capped store, the hash-pinned proposal, the one render path, the threat scan | Extended: `prompt.ts`, `threatScan.ts`, `refusal.ts`. Nothing replaced |
| `agent/src/memory/{memoryFiles,proposalQueue}.ts` | The memory files and the only code that writes a store | `loadMemoryBlock` extended. The door calls `proposeMemoryWrite`; it adds no queue |
| `agent/src/skills/skillQueue.ts`, `core/src/skills/*` | The skill proposal queue and promotion | Read-only. The door calls `proposeSkill` and `listPendingSkillProposals` |
| `core/src/search/*`, `agent/src/search/{localIndex,documentSources}.ts` | One FTS table for every project; `node:fs` and `Date.now()` in the walk and the index | Extended: bound to one owner, ports for the clock and file system |
| `core/src/tenant.ts` | `isTenantId`, `isProjectId` | Read-only, for the file name and the owner check |
| `core/src/context/fence.ts` | A caller of `renderMemoryBlock` with no credential screen | Not touched (outside paths). See residuals |
| `agent/src/loop/session.ts` (`readFindings`) | Reads `reviews` and `findings` and ignores any `proposals` entry | Not touched (outside paths) |
| `agent/src/loop/observation.ts`, `runner.ts` (`runChecks`, about line 1900), `verification.ts` | The loop's observation (`dirtyPaths`) and check step | Not touched. `verification.ts` is PROTECTED |
| `agent/src/system.ts` | The `System` port: no `lstat`, a string `now()` | Not touched (outside paths) |
| `projectos/security/action-registry.json` | The seven O1 entries, committed in `dc09fb13` | Read only, by the validator (MS-1) |

## What was built

| Item | Path | Result |
|---|---|---|
| The six classes | `docs/architecture/memory-classes.md` | Each class to its existing store, owner and retention. **The list is reconstructed**: see the note below |
| Index key | `core/src/search/indexKey.ts` | `idx-<sha256 of the JSON pair>.sqlite`; each id checked against the registry's shapes first |
| Per-project index | `agent/src/search/{localIndex,projectIndex}.ts` | An index file is bound to one tenant and one project, recorded in a `search_owner` row; schema version 2 (a version 1 file is dropped and rebuilt on open) |
| Ports | `agent/src/search/{ports,nodeHost}.ts` | `SearchClock`, `DocumentSystem`, `DocumentFs`, `EntryProbe`; `nodeHost.ts` is the only module that reaches `node:fs` |
| Walks through ports | `agent/src/search/{documentSources,storeSources}.ts` | The document walk and the store walk read through a `DocumentFs`; plan memory, execution records and findings are collected and the index rebuilds from them |
| Sensitive path | `core/src/search/{sensitiveContent,chunkRecords}.ts` | `.projectops` opens a citation only as the first segment and only for a `memory` or `sessions` source |
| Credential screen | `core/src/memory/prompt.ts`, `agent/src/memory/memoryFiles.ts` | Core takes an injected screen and stays pure; the loader injects the agent's `containsSecret` |
| Rendered cap | `core/src/memory/prompt.ts`, `refusal.ts` | The rendered body is held to twice the store cap, refused (`MEMORY_RENDERED_OVER_LIMIT`), never cut |
| Hidden text | `core/src/memory/threatScan.ts` | `[x]: <>`, `[x]: # '...'`, `[ // ]: #`, a link title, and U+2800 |
| The door, pure | `core/src/memory/proposalDoor.ts` | `readFindingsProposals`: one read, from a copy |
| The door, on `System` | `agent/src/memory/proposalDoor.ts` | `openProposalDoor`: pending proposals through the existing queues |
| Direct-write refusal | `core/src/memory/directWrite.ts` | `checkNoDirectStoreWrites`: pure |
| Validator | `validators/val-projectos-memory-stores1a.cjs` | 18 rules, 178 text and 77 behavioural named mutations; registered in both runners before `connector-contract1a` |
| Updated validators | `val-projectos-port-search1a.cjs`, `val-projectos-port-memory1a.cjs` | Stale pins updated truthfully; no rule loosened |

**The six classes are reconstructed, and the owner should confirm them.** Plan 3.1 names two, plans 3.2 and 3.3, the Stage 3 recon
and ADR-S3 name the rest, and the owner's V4 text that may list all six was truncated and is not on disk. The list is: (1) programme
and project memory, (2) execution memory, (3) curated memory, (4) skills, (5) retrieval index, (6) code-intelligence memory.

### The `System` port

`system.ts` has no `lstat` and is outside this phase's write paths, so it was **not edited**. The walk needs an `lstat`, to see a
link and to size a file before reading it. So there is a narrow local port, `EntryProbe` in `agent/src/search/ports.ts`. A real
`System` satisfies `DocumentSystem` (`readText`, `listDir`, `now`) structurally, and `documentFsOver(system, probe)` joins it to
the probe. `nodeEntryProbe` in `nodeHost.ts` is the probe. When `System` gains `lstat`, the probe and `nodeHost.ts`'s stat go,
and nothing else changes. The clock port is `searchClockOver(system)`: it reads `System.now()`, never goes backwards, and
throws on no time.

### What the door refuses, beyond core's own rules

A worker's entry may not name its author, role, session, time, state, hash, id or a skill's origin: an unknown field refuses the
entry. A `decision` kind is refused (worker-written text is never passed on as one). A caller in the owner's role is refused,
because the findings record is the worker's. The record is size-capped before it is parsed, at most ten entries are read, and an
entry already pending comes back as a duplicate, not a second proposal.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| The registry holds the O1 entries; the validator refuses if any is missing | MS-1: all seven ids with their class and `local`. Mutations `an-o1-entry-is-missing`, `a-delete-is-not-owner-only`, `a-retrieval-is-a-write` |
| Two projects get separate index files, and one project's statistics do not change the other's ranking, tested | `agent/test/searchStores.test.ts` ("two projects get separate index files": file names, the ranking test, and the premise test that one FTS table does share statistics), `core/test/search-index-key.test.ts`, `agent/test/searchIndex.test.ts` ("records its owner..."). MS-3 runs it |
| `loadMemoryBlock` refuses a secret and a rendered body over the cap, tested | `core/test/memory-prompt.test.ts`, `agent/test/memoryStores.test.ts` (the 300-decision case, 84,603 characters rendered against a cap of 2,200, is refused). MS-6, MS-7, MS-8 |
| A `proposals` entry becomes a pending, hash-pinned proposal; a worker's direct write is refused at the check step, tested | `core/test/memory-proposal-door.test.ts`, `core/test/memory-direct-write.test.ts`, `agent/test/memoryStores.test.ts`. MS-9, MS-10. **The refusal is tested as a pure function; it is not yet called at the check step** (below) |
| `memory-classes.md` maps each of the six classes to its store, owner and retention | The file; MS-2 parses the table (six rows, five columns, none empty, the first four naming a store under `.projectops`) |
| Validator pin and named mutations, each killed by its own rule | The mutation table below |

## Mutations

Each mutation is applied and counts only when its own rule fires, and no rule it did not declare. A behavioural mutation changes
a copy of the source that runs against real SQLite and an in-memory file system, and counts only when exactly its own rule's
probes fail. The unmutated tree passing every pin and probe is the positive control.

| Rule | Says | Text | Behavioural |
|---|---|---|---|
| MS-1 | an action is unregistered | 3 | 0 |
| MS-2 | a memory class is not mapped | 6 | 0 |
| MS-3 | the index is not per project | 16 | 8 |
| MS-4 | the clock is not injected | 10 | 4 |
| MS-5 | the index reads outside its ports | 25 | 10 |
| MS-6 | a credential reaches a prompt | 9 | 5 |
| MS-7 | the rendered body is not capped | 9 | 5 |
| MS-8 | hidden text reaches a prompt | 9 | 9 |
| MS-9 | the proposal door is not the door | 27 | 15 |
| MS-10 | a direct store write passes | 19 | 11 |
| MS-11 | a second route writes or approves | 6 | 0 |
| MS-12 | core is not pure | 7 | 0 |
| MS-13 | stored text is read as authority | 5 | 0 |
| MS-14 | a file has no statement of origin | 5 | 0 |
| MS-15 | not registered | 4 | 0 |
| MS-16 | the proof does not run | 3 | 0 |
| MS-17 | a file is not tracked | 1 | 0 |
| MS-18 | a write to an ignored store passes (fix round 1) | 14 | 10 |
| **Total** | | **178** | **77** |

The stale pins in the two older validators were updated, not loosened. `val-projectos-port-search1a`: the walk reads through
`fs.stat` and `stat.kind` instead of `lstatSync`; schema version 2 and the owner table; the boundary passes the source kind; the
index and the key and the ports are in its file listing; its probes open an index for one owner with a clock; PS-10 is now
"an index holds one project", and a behavioural mutation for each of its two guards replaced the one that assumed many projects
in one file. `val-projectos-port-memory1a`: the two new core files are loaded so the barrel resolves, two threat samples and
the Braille cell were added, and three mutation texts follow the changed lines.

## Checks, with counts (read from the exit codes, not from a doc)

| Check | Result |
|---|---|
| core `npm run -s build` | exit 0 |
| core `npx vitest run` | 103 files, 4,308 tests, all pass |
| core tests type-checked (alias tsconfig over `src` and the six test files this phase touched) | exit 0, no output |
| agent typecheck, **alias**: `tsc` over `agent/src` with `@projectos/core` mapped to this worktree's `core/dist` | exit 0, no output |
| agent tests, **alias**: vitest with `@projectos/core` aliased to this worktree's `core/dist` | 116 files; 115 pass, 3,622 tests pass, 10 skipped. See the one failure below |
| agent new and changed tests, type-checked through the alias | exit 0, no output |
| `val-projectos-memory-stores1a` | PASS: 9 new and 12 changed files judged; 178 text and 77 behavioural mutations killed. Also run as validate-all runs it: `Array.isArray(run())` is `true` |
| `val-projectos-port-search1a` | PASS: 22 real files; 113 text and 26 behavioural mutations killed |
| `val-projectos-port-memory1a` | PASS: 20 rules; 199 named mutations killed |
| `val-projectos-port-credit1a` | PASS: 177 real files; 157 fixture and 59 record mutations killed |
| `validate-no-secrets` | PASS |
| Validators that read a touched file (a grep for the touched paths, `validate-all`, `cached-runner` and the core barrel) | See "Other validators" |

**The one agent failure is the alias, not the code.** `test/tenantSidecar.test.ts` builds the agent with its own `tsconfig.json`
in `beforeAll`, and the agent's `@projectos/core` junction points at the plan worktree, whose `core/dist` does not have the new
exports. `tsc` therefore stops, and the file's 10 tests are skipped. The same compile through the alias config (above) passes.
Run in the merged stack, where the junction resolves to the merged core, it will compile.

### Other validators

Each ran in its own process, one at a time, and the exit code was read: all **exit 0 and PASS** (the credit validator was first run
before the new files were committed and failed `PC-24 not tracked`, then passed after the commit):
`val-projectos-connector-contract1a` (293 mutations), `val-projectos-kernel-followup1a` (88), `val-projectos-port-agents1a`,
`-approvals1a`, `-computer1a`, `-context1a` (320), `-mcp1a`, `-providers1a`, `-research1a`, `-routines1a`, `-skills1a` (440),
`val-projectos-tenant-contract1a` (346), `-credentials1a`, `-csp1a`, `-principal1a`, `-rls1a`, `val-projectos-validator-scratch-lifecycle1a`,
`validate-speed-validation-cache`, `validate-v2-closure-evidence`, `val-projectos-v3-validation-evidence1a`. That is every validator the grep found except `validate-all` (the lead's) and the files that are libraries, not validators
(`plan-discovery-engine`, `plan-governance-engine`, `speed/benchmark`, `speed/cached-runner`, `speed/validation-cache`).
`validate-all` itself was not run.

## Converge (B9)

**Unbuilt on purpose.**
- The direct-write refusal is not called at the check step, and the door is not called after the findings are read. See below.
- No caller reads the index, the loader or the door: the context manager (3.4) is the first. `agent/src/index.ts` is unchanged.
- No ranking by provenance, no committed-bytes read, no stale-citation marking, no retention or deletion (3.3).
- The installation's index directory is not chosen. `openProjectSearchIndex(directory, ...)` takes it from the caller.
- Code-intelligence memory (class 6) has no store.

**Drift.** None found. The delta row asked for: the classes mapped (done), per-project index files (done), `documentSources`
through the `System` port (done as a local port, because `system.ts` has no `lstat`), plan memory, execution records and findings
indexed and rebuildable (done, tested by deleting the file and rebuilding), `containsSecret` and the rendered cap on the loader
(done), the one proposal door (done as code, not wired), and the direct-write refusal (done as code, not wired).

**PROTECTED files untouched.** `git diff --stat 841f3286..HEAD` lists only: `docs/architecture/memory-classes.md`,
`docs/finish/PROJECTOS-MEMORY-STORES1A.md`, files under `projectos/core/src/{memory,search}/`, `projectos/core/test/`,
`projectos/agent/src/{memory,search}/`, `projectos/agent/test/`, and the validators and runners the brief names
(`val-projectos-memory-stores1a`, `val-projectos-port-search1a`, `val-projectos-port-memory1a`, `validate-all.cjs`,
`cached-runner.cjs`). No `taskEnvelope.ts`, `actionRegistry.ts`, `tenant.ts`, `action-registry.json`, `run.ts`, `verification.ts`,
`workers.ts`, `session.ts`, `observation.ts`, `system.ts`, `.gitignore`, `THIRD_PARTY_NOTICES` or `docs/06_Plan.md`. The new
files import `core/src/tenant.ts` and `core/src/execution/evidence.ts` read-only.

## Out-of-path edits needed (Stage 4.1 wires these; none is made here)

1. **Refuse a direct write at the check step.** The loop observes the tree in `agent/src/loop/observation.ts` (`dirtyPaths`)
   and runs checks in `agent/src/loop/runner.ts` (`runChecks(...)`, about line 1900). The edit is one call, after the worker
   finishes and **before** the door writes its own proposal files: `checkNoDirectStoreWrites(observation.dirtyPaths)`, and on
   `ok: false` treat it as a failed check with code `MEMORY_DIRECT_WRITE`. Ordering matters: after the door, the kernel's own
   proposal files are in the set. `verification.ts` is PROTECTED, so the edit is in `runner.ts` or a new module it calls, with
   the owner's approval. **Wiring must pass BOTH sides of a rename.** `porcelainPaths` in `observation.ts` keeps only the new
   path of `R old -> new`, so `git mv .projectops/memory/approved.json moved.json` reaches the check as `moved.json`. The check
   judges a string containing ` -> ` on both sides (and whole), so the wiring has to hand it the raw porcelain path or both
   paths. `observation.ts` is outside this phase's paths and was not edited.
1a. **Take a store digest before and after the worker, regardless of git** (fix round 1, M7). `snapshotMemoryStores(root, fs)`
   before the worker runs and again after, then `checkStoreUnchanged(before, after)`; a difference or a snapshot that could not
   be taken refuses the run. This is the check that still works when `.projectops/memory/` is git-ignored. The same ordering
   applies: take the second digest before the door writes its proposal files, because those files are inside the digested
   roots. The edit is in `runner.ts`, beside item 1, and needs the owner's approval for the same reason.
2. **Call the door.** After `readFindings` in the run (`agent/src/loop/session.ts` ignores `proposals`), read the findings text
   with `sys.readText(findingsPath(root, sessionId))` and call `openProposalDoor(sys, root, caller, text)`. The caller comes from
   the kernel and must not be the owner's role. Record the outcome in the run's records (`memory-propose` and `skill-propose`
   are P2 and local, registered by O1). `agent/src/index.ts` should export `openProposalDoor`.
3. **Pass the credential screen from the context manager.** `core/src/context/fence.ts` calls `renderMemoryBlock` with no screen.
   It still gets the rendered cap and the hidden-text refusal, but not the credential screen. Pass `{ secretScreen }` from the agent.
4. **`System.lstat`** (outside `system.ts` paths): removes `EntryProbe` and the `node:fs` in `nodeHost.ts`.
5. **`.gitignore`**: see the next section. Not before item 1a is wired.

## Residuals and owner questions

- **Owner question 1: confirm or rename the six classes.** The list is reconstructed from plan and recon text.
- **Owner question 2: `.projectops/memory/` and `.projectops/skills/` are not git-ignored.** A cloned or PR-borne store reads as
  approved, because its provenance file can say anything and the hash detects a change but is not a signature. `.gitignore` is
  outside this phase's write paths, so it was not edited. The loader cannot tell a clone-borne store from a local one without a
  signature or a local attestation, so **it was not made to distrust one**: that needs owner proof, not a check in this file.
  **Ignoring the directory is acceptable only together with the digest check (item 1a).** Once the stores are ignored,
  `git status` stops listing a worker's write to them, and the path-based refusal (item 1) sees nothing. The digest does not
  read git, so it still sees the write. The wiring edit needed is item 1a in `runner.ts`. Memory then no longer travels with a
  clone. Signing the records is the real answer and belongs with owner proof.
- **A copied index file with its `search_owner` row deleted is adopted by the next owner that opens it** (fix round 1, L4; no
  code change). `bindOwner` writes the owner into a file that has none. It needs write access to the index directory, which is
  the same trust as the stores themselves, and the file's contents are derived and rebuilt on the first `rebuildProject`. Named,
  not fixed.
- **The digest hashes decoded text** (fix round 1, M7). `readText` decodes UTF-8, so two files that differ only in bytes that
  decode to the same replacement characters, at the same size, hash alike. And it sees the stores at two moments, not a write that
  was made and undone between them.
- **The store walks see an `lstat` of each directory on the way and refuse a link,** but not a link that appears between the stat
  and the read (a race).
- **The credential vocabulary is the union of two lists that are still two lists.** The agent's `containsSecret` lives in
  `authoringEvidence.ts`, outside this phase's paths, so the loader asks both and does not share one. Core's list gained
  `sb_secret_`, `sb_publishable_`, `vcp_` and `re_` (see the `re_` note above: a name is not a token).
- **The hidden-reference patterns are looser than a renderer.** A definition whose destination or title is on the next line,
  or inside a quote or list marker, is refused when empty, `#` or titled; a plain `[x]: destination` still passes, because a
  capped note may hold a reference. A line that looks like `[note]: see "this"` is refused.
- **Wiring must run `git status --porcelain --untracked-files=all`** (final round, N4). With the default, a fresh clone whose
  `.projectops/` is new prints `?? .projectops/`, which the parent-of-a-store rule (H1) now refuses, so every run would be refused.
  With `--untracked-files=all` the files are listed one by one.
- **The digest cannot see an alternate-data-stream write** (`MEMORY.md:evil` on NTFS): `readText` reads the main stream. Nor does it
  see a write that was made and undone between the two snapshots.
- **A findings record with a `constructor`, `prototype` or `__proto__` key is refused whole** (L1), not trimmed.
- **Shapes only.** An entity-spelled secret (`&#115;k-ant-...`) and a secret split by zero-width characters are not recognised by the
  credential screens; zero-width characters are refused by the threat scan as invisible text, which covers the second at proposal,
  and entity-spelled secrets are the stated shapes-only limit.
- **The `re_` shape needs upper case, lower case and a digit** (final round, N2), so a Resend-style key that is all lower case is
  not recognised, in exchange for not refusing snake_case names. `sb_secret_`, `sb_publishable_` and `vcp_` need a digit in the
  first 64 characters of a tail of 20 or more.
- **Owner question 3: who deletes a promoted skill?** `memory-delete` covers approved memory and anything a decision cites. A skill
  is neither, so its deletion has no registered action.
- **The rendered cap is twice the store cap, a judgment.** An ordinary full store of decisions with long references (a few
  hundred characters each) could pass the store cap and fail the rendered one, and it is then refused, not cut. The factor is one
  constant (`MEMORY_RENDERED_CAP_FACTOR`).
- **The credential screen is the agent's vocabulary.** A credential with no known shape passes it, as at proposal and approval.
- **Hidden text is a pattern list.** `[x]: #foo` (a plain anchor reference with no space) is refused as a comment by the same
  pattern, which can refuse a legitimate anchor. Memory is a capped note, so the cost is small.
- **The direct-write check does not see a short (8.3) name or a link that resolves into a store.** A path it cannot judge is
  refused, but one it reads as outside the roots is passed.
- **`.projectops` is accepted as the first path segment for a `memory` or `sessions` source by name.** The index boundary does not
  know what the source is; a caller that hands in `sessions` with a `.projectops/` path is trusted to be code. A document cannot
  claim it, and a dot segment below the root and a credential name are still refused.
- **Execution and findings text is worker-authored.** It is indexed and comes back as untrusted data, with no ranking by
  provenance. Plan 3.3 owns that.
- **The skill door dedupes by package and author, the memory door by target, op, kind, content and author.** A `remove` has no
  dedupe, because the entry it selects is not known until the queue resolves it. The queues' own caps (50 pending, 10 per author for
  skills) still bound the queue.
- **A version 1 index file is dropped and rebuilt on first open.** It is derived, so nothing is lost.
- **`node:sqlite` is experimental** in Node 24.14.1 and prints a warning when an index opens.
- **The validator is 1,171 lines,** over the 800 the style rule names, like its siblings (1,089 to 1,377). It is one file because its
  pins, mutations and probe share their names.
- **The behavioural copy is not the build.** It runs under type stripping with a local shim for `@projectos/core`, and a stand-in for
  `authoringEvidence` and for the skill queue. `tsc` and the suites cover the real build. The skill queue has its own suite; what
  is proved here is that the door reaches it, as a proposal, with no origin of the worker's choosing.
- **Failing-test-first.** For the core door, the direct-write rule and the key, the tests and the code were written in the same
  pass, so a red run was not captured. Each is covered by a named mutation that the validator applies and sees killed, which is
  the evidence that the test fails without the rule. The threat-scan, prompt and sensitive-path changes did show red first.

## Fix round 1 (ECC security review): item, test, mutation

Failing test first for each; each test was seen red before the code changed (the core and agent suites below were run after).
Every rule has named mutations in `val-projectos-memory-stores1a`, applied and killed by its own rule (text) and, where code runs,
by its own probes (behavioural, suffix `-when-run`).

| Item | What it was | Test | Mutations (rule) |
|---|---|---|---|
| H1 | A parent of a store root (`.projectops/`, `.projectops`, `.`) passed, and `git status` prints `?? .projectops/` for a new directory | `core/test/memory-direct-write.test.ts` "a parent of a store root hides the store" | `a-parent-of-a-store-passes`, `the-parent-reason-is-not-consulted` (MS-10) |
| M2 | `.projectops/execution` was listed with no `lstat`; a junction leaked outside files into the index | `agent/test/searchStores.test.ts` "a store directory that is a link is not walked" | `a-linked-store-directory-is-walked`, `the-directories-on-the-way-are-not-asked`, `a-store-directory-that-is-a-file-is-listed` (MS-5) |
| M3 | The secret screen was literal-only: `\u0073k-ant-...` in a findings record was indexed; no `sb_`, `vcp_`, `re_` shapes | `core/test/search-sensitive.test.ts` "an escaped secret, and the newer shapes"; `agent/test/searchStores.test.ts` "an escaped secret in a store record is skipped" | `the-escape-normaliser-is-not-run`, `the-normaliser-stops-after-one-pass`, one per new shape (MS-5) |
| M4 | `loadMemoryBlock` used the agent's narrower vocabulary: Google, Slack, npm, webhook, AWS session and Azure keys were shown | `agent/test/memoryStores.test.ts` "the loader refuses on the union of both credential screens" | `the-loader-asks-one-vocabulary`, `the-loader-never-asks-cores-vocabulary` (MS-6) |
| M5 | Hidden-reference variants still admitted: next-line destination or title, quote and list prefixes, entities, escaped label, a label over two lines, an angle destination with a space | `core/test/memory-threat-scan.test.ts` "the hidden reference forms the first round still admitted", plus a linear-time test on hostile input | `entities-are-not-decoded`, `an-invisible-entity-is-not-decoded`, `the-entity-passes-are-one`, `quote-and-list-prefixes-are-not-markers`, `a-destination-on-the-next-line-is-missed`, `an-escaped-bracket-ends-the-label` (MS-8) |
| M6 | `porcelainPaths` keeps only the new path of a rename, so a moved store file passed | `core/test/memory-direct-write.test.ts` "a rename is judged on both sides" | `a-rename-is-judged-whole-only`, `a-quoted-side-is-not-unquoted`, `an-unjudgeable-side-is-dropped` (MS-10) |
| M7 | Git-ignoring the store would blind the path check | `agent/test/memoryStoreDigest.test.ts` (15 tests) | the ten `MS-18` pins and ten behavioural mutations: links refused, files hashed with their text, bounds, a refused snapshot clears nothing, both stores covered |
| L1 | A JSON `__proto__` key set the copy's prototype and was accepted | `core/test/memory-proposal-door.test.ts` "a key that would reach the prototype is refused" | `a-prototype-key-is-copied`, `the-copy-has-a-prototype` (MS-9) |
| L2 | Dedupe compared untrimmed content, and one author filled all 50 slots | `agent/test/memoryStores.test.ts` "the door dedupes on a canonical form and caps one author" | `a-duplicate-is-compared-literally`, `an-author-may-fill-the-queue`, `the-author-cap-is-unbounded` (MS-9) |
| L3 | The rendered cap counted code points: 2,150 emoji rendered 8.9 KB | `core/test/memory-prompt.test.ts` "the rendered body is capped in UTF-8 bytes as well" | `the-byte-cap-is-off`, `the-byte-cap-counts-characters`, `a-byte-is-forty-per-character` (MS-7) |
| L4 | A copied index file with its owner row deleted is adopted | none (recorded only) | none: a residual above |

New code: `agent/src/memory/storeDigest.ts` (`snapshotMemoryStores`, `checkStoreUnchanged`); `decodeThreatEntities` in
`core/src/memory/threatScan.ts`; `normaliseEscapedText` in `core/src/search/sensitiveContent.ts`;
`memoryRenderedByteLimit` in `core/src/memory/prompt.ts`; `MAX_PENDING_MEMORY_PER_AUTHOR` in the agent door. The older validators
were updated, not loosened: `val-projectos-port-search1a` pins the new `sensitiveContentProblem` line, and
`val-projectos-port-memory1a` follows the loader's renamed screen and gives its copy a stand-in for core's index vocabulary.

### Fix-round checks, with counts

| Check | Result |
|---|---|
| core `npm run -s build` | exit 0 |
| core `npx vitest run` | 103 files, 4,308 tests, all pass |
| core tests and `src` type-checked (alias tsconfig) | exit 0, no output |
| agent typecheck, **alias**, over `agent/src` | exit 0, no output |
| agent new and changed tests type-checked through the alias | exit 0, no output |
| agent tests, **alias** | 117 files; 116 pass, 3,664 tests pass, 10 skipped. The one failing file is `tenantSidecar.test.ts`, for the same reason as in the first round: it runs the agent's own `tsc` against the junction'd old core. Its 10 tests are skipped, not failed |
| `val-projectos-memory-stores1a` | PASS: 9 new and 12 changed files judged; 178 text and 77 behavioural mutations killed; `Array.isArray(run())` is `true` |
| `val-projectos-port-search1a` | PASS: 22 real files; 113 text and 26 behavioural mutations killed |
| `val-projectos-port-memory1a` | PASS: 20 rules; 199 named mutations killed |
| `val-projectos-port-credit1a` | PASS: 178 real files judged |
| `validate-no-secrets` | PASS |
| `val-projectos-port-skills1a`, `val-projectos-port-context1a` (they read the scan and the memory barrel) | PASS (440 and 320 mutations) |

`validate-all` was not run. The 20 other validators that read a touched file were run after the first round and are unchanged
by this one, except that the two above were re-run because the scan and the renderer changed.

### Converge after the fix round

- **Unbuilt on purpose, now also:** the digest is not taken by the loop (item 1a above), the rename arrow is judged by the
  check but `porcelainPaths` still drops the old side (item 1), and the credential vocabulary is two lists asked together.
- **Drift:** none. Every item stayed in `core/src/{memory,search}`, `agent/src/{memory,search}`, their tests, the three
  validators, the finish doc and the two runners (not touched this round).
- **PROTECTED files untouched:** `git diff --stat 841f3286..HEAD` still lists no PROTECTED file, no `observation.ts`,
  `session.ts`, `runner.ts`, `system.ts`, `.gitignore`, `THIRD_PARTY_NOTICES` or `docs/06_Plan.md`.

## Final round (ECC recheck): N1 to N4

| Item | What it was | Test | Mutations |
|---|---|---|---|
| N1 (HIGH) | `REF_GAP` was `[ \t]*\n?[ \t]*`: two adjacent quantifiers over the same characters, so 60,000 spaces after `[x]:` took 12 to 15 seconds, reachable through `admitMemoryContent` and the door | `core/test/memory-threat-scan.test.ts` "every pattern is linear on hostile input, one input at a time": 28 inputs (spaces, tabs, bracket, quote, marker, entity and escape runs, one megabyte), each under 2,000 ms. Seen red first: three inputs took 2.7 to 3.5 s | `the-gap-is-two-adjacent-quantifiers`, `the-angle-comment-is-two-adjacent-quantifiers`, `a-title-separator-is-two-quantifiers` (text, MS-8); `the-gap-is-two-adjacent-quantifiers-when-run` restores the old regex and the probe takes the 60,000 spaces over its bound (MS-8) |
| N2 (MEDIUM) | `re_`, `sb_publishable_`, `sb_secret_`, `vcp_` flagged snake_case names | `core/test/search-sensitive.test.ts` "ordinary snake_case is not a credential, real tokens still are": seven false-positive inputs now pass, six real shapes still refused, eight hostile inputs under 2,000 ms. Seen red first | `a-resend-name-needs-no-mixed-case`, `a-supabase-name-needs-no-digit`, `the-shape-lookahead-is-unbounded`, one per shape (text); the first two also when run (MS-5) |
| N3 (LOW) | `[x]: &lt;a\&gt; b&gt; "hidden"` returned nothing, and a 600-character label escaped the 512 bound | `core/test/memory-threat-scan.test.ts` "the last hidden-title evasions". Seen red first | `an-escaped-angle-destination-is-not-allowed`, `the-label-bound-is-512` (text and when run, MS-8) |
| N4 (doc only) | Residuals | this section and "Residuals" above | none |

**The audit.** Every regex added in round 1 was read for adjacent or nested quantifiers over the same characters. The label
`(?:\\[\s\S]|[^\]\\]){0,999}` has disjoint alternatives and a bound. The marker prefix consumes a marker on every iteration. The
title's destination alternatives are bounded (`{0,2048}`), its separator is `[ \t]+(?:\n[ \t]*)?|\n[ \t]*`, and the gap and the angle
comment each consume a run of spaces one way only. The entity pattern and the escape normaliser are single alternations with
bounded passes. The secret shapes' lookaheads are bounded at 64 characters, because an unbounded one over `sb_secret_a-sb_secret_a-...`
would rescan the rest of the text from every start. The hostile-input table covers each pattern; a row for the angle form alone
does not separate the old form from the new one on this Node, so only the gap has a behavioural mutation for time.

### Final-round checks, with counts

| Check | Result |
|---|---|
| core `npm run -s build` | exit 0 |
| core `npx vitest run` | 103 files, 4,360 tests, all pass |
| agent tests, **alias** | 117 files; 116 pass, 3,664 tests pass, 10 skipped (`tenantSidecar.test.ts`, the alias artefact described above) |
| agent new and changed tests type-checked through the alias | exit 0, no output |
| `val-projectos-memory-stores1a` | PASS: 9 new and 12 changed files judged; 186 text and 82 behavioural mutations killed (about 45 s) |
| `val-projectos-port-search1a` | PASS, exit 0, 26 s |
| `val-projectos-port-memory1a` | PASS: 20 rules; 199 mutations, exit 0, 40 s |
| `val-projectos-port-credit1a` | PASS: 178 real files, exit 0, 22 s |
| `val-projectos-port-skills1a` | PASS: 21 rules; 440 mutations, exit 0, 143 s |
| `val-projectos-port-context1a` | PASS: 18 rules; 320 mutations, exit 0, **276 s** (about 4.6 minutes, run alone on a loaded machine) |
| `validate-no-secrets` | PASS, exit 0, 2 s |

The coordinator's note that `context1a` might be slow because of the ReDoS was withdrawn: it takes the same four to five minutes
as in the first round (233 s then, 276 s now), so the long run is the validator's own size.

### Converge after the final round

Nothing new is unbuilt. No file outside the write paths was touched, no PROTECTED file is in `git diff --stat 841f3286..HEAD`, and
`validate-all` was not run.

## Commits

- `f720153c` feat(memory): core rules for the proposal door, direct-write refusal, rendered cap and index key
- `5d9876bd` feat(memory): per-project index files, ports for the clock and file system, one agent door
- The commit that adds the validator, the two validator updates, the runners, the classes doc and this file.
- `fb3af05d` docs(finish): state exactly which validators were run
- `d37aa323` fix(memory): ECC security review round 1 for MEMORY-STORES1A
- `43d758ab` docs(finish): fix round 1 checks and converge
- The final-round commit (N1 to N4) that adds this section.
