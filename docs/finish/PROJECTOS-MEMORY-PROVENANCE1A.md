# PROJECTOS-MEMORY-PROVENANCE1A: provenance and freshness ranking, committed bytes only, stale citations, retention and recorded deletion

**Phase:** PROJECTOS-MEMORY-PROVENANCE1A, plan v1.36 item 3.3 (Stage 3), row 8 of `docs/changes/delta_spec.md` (revision 2, approved).
**Branch:** `projectos-memory-provenance1a`, worktree `C:/dev/ProjectOS-worktrees/memory-provenance1a-v136`, based on `7fc020da`.
Not pushed, not merged, phase not closed, `docs/06_Plan.md` not edited. `validate-all` is the lead's and was not run here.

**State:** built and self-checked. No review has seen it yet (ECC SECURITY is the one this phase owes). Everything below is what was
run and seen in this worktree; where a check could not run as written, it says so.

## What was asked and what exists

Nothing calls the new code from a route. The context manager (3.4) and the loop wiring (Stage 4.1) are the first callers. Everything
here is pure code in core with tests, plus two agent files that take their git and file system as injected ports.

## Existing code found (B1, before any change)

| Where | What it was | Used how |
|---|---|---|
| `agent/src/closureGate.ts` (`readCommittedDecision`), `agent/src/installation/tenantRegistry.ts` (`committedBytes`), `agent/src/installation/projectAllowlist.ts` (`installationAllowsProject`, `blobNameOf`) | The host already reads authority records from git objects, not the working tree: `git show HEAD:./<path>` after a `diff` check, the bytes hashed back to the blob name, `--no-replace-objects` | **Extended in kind**: the same discipline for memory files. `blobNameOf` is imported, not copied. What those do not need and this does: the tree entry (so a symlink, a submodule and a tree are refused by mode), and a working-tree comparison that refuses instead of choosing a side |
| `agent/src/search/{ports,localIndex,projectIndex,storeSources}.ts`, `nodeHost.ts` | STORES1A's ports (`SearchClock`, `DocumentFs`, `EntryProbe`), the per-project index, the store walk | Extended: `ports.ts` gains `GitRunner`, `SearchHead`, `gitRunnerOver`, `searchHeadOver`; `localIndex.ts` records the commit; `projectIndex.ts` passes the head. `DocumentFs` is the working-tree port of the committed read. Nothing replaced |
| `core/src/search/{citation,citedSearch,untrustedExcerpt,index}.ts` | The citation door, the ranked search, the fence | Extended: a citation carries a freshness, the ranked search sets it, the fence shows it |
| `core/src/memory/*`, `core/src/tenant.ts`, `core/src/execution/evidence.ts` (`canonicalStringify`, `sha256Hex`) | The store, the proposal, the tenant and project id shapes, the hash and the canonical JSON | Read-only. The new core files import `tenant.ts` and `evidence.ts` and nothing else outside the memory directory |
| `projectos/security/action-registry.json` | The seven O1 entries, committed in `dc09fb13` | Read only, by the validator (MP-1). `actionRegistry.ts` has no floor for `memory-delete`, so the validator is the pin |
| `docs/architecture/memory-classes.md` | The six classes and their retention | The retention table in `retention.ts` uses that list, in that order, under those names; MP-5 parses the doc and compares |
| `agent/src/memory/{proposalQueue,storeDigest,proposalDoor}.ts` | STORES1A's queue, digest and door | Not touched. Deleting approved memory is not a proposal: it is its own owner-only action |
| `agent/src/system.ts` (`removeFile`, `createExclusive`, `exec`) | The `System` port | Not touched. The deletion files port and the git runner are narrow structural subsets a real `System` satisfies (`gitRunnerOver(system, root)`) |

## Which action covers which deletion (the decision, stated)

The registry (O1) has exactly two entries that touch deletion, and no weaker one:

| Entry | Class | Registered for |
|---|---|---|
| `memory-delete` | **P5**, owner only, every time | "approved memory or anything a decision cites" |
| `memory-index-rebuild` | P2, local | "derived indexes only" |
| `memory-propose` | P2 | a worker asking for a memory write: it creates a pending proposal, it deletes nothing |
| `context-write` | P2, local | the loop writing a session's fenced context file: a write, not a deletion |

So, in `core/src/memory/retention.ts` and `agent/src/memory/memoryDeletion.ts`:

- **Classes 1 to 4 are ALL `memory-delete` (P5, owner only).** Approved memory and what a committed decision cites are named by the
  registry. Everything else in those stores (a pending or rejected proposal, an execution record no decision cites, a finding, a
  promoted skill) has **no entry of its own**, so this module gives it the **strictest** entry instead of none. It over-covers on
  purpose: the cost is an owner prompt to remove an uncited execution record, and a lighter entry for those is the owner's to
  register. Whether a decision cites the item is recorded (`citedByDecision`: `true`, `false` or `unknown` when the decisions could
  not be read) and never lowers the bar.
- **Class 5, the retrieval index, is `memory-index-rebuild` (P2, local, no owner).** `deleteDerivedIndex` removes only the one file
  that `searchIndexFileName` names from the owner by hash, so a request cannot aim it at another path.
- **Class 6** has no store and no entry: a deletion there is not representable.
- **Owner question 3 of STORES1A (who deletes a promoted skill?) is not answered, only failed closed:** a skill is `memory-delete`
  until the owner registers something else.

## What was built

| Item | Path | Result |
|---|---|---|
| Provenance ranking | `core/src/memory/provenance.ts` | Seven kinds in four tiers: committed decision, then approved and plan memory, then execution record and finding, then summary and recollection. Rank is computed from `{ id, kind, timeMs, committed?, contradicts? }`; an item carrying text or any other field is refused. A claim to tier 0 or 1 needs `committed: { commit, blob }`, else it ranks as a recollection and says `unverifiedClaim`. A proven decision outranks anything that names it in `contradicts`, which is marked `overruledBy`. Order does not decide (duplicates keep the higher tier; NFKC + lower-case ids) |
| A summary never replaces a decision | `provenance.ts` (`provenanceReplacementProblem`) | A machine-readable code: `PROVENANCE_SUMMARY_CANNOT_REPLACE_DECISION`, `PROVENANCE_DECISION_NOT_REPLACEABLE`, `PROVENANCE_LOWER_RANK_CANNOT_REPLACE`. Null is **not** an approval |
| Committed bytes, judged | `core/src/memory/committedBytes.ts` | `judgeCommittedRead(facts)`: one-spelling path in a decision, plan-memory or approved-memory shape; HEAD a commit name; the tree entry a regular blob (symlink, submodule, tree and odd modes each refused by code); bytes within 256 KiB counted in UTF-8; a working copy that is absent, a link, not a file, unreadable or **different** is refused (LF/CRLF compared as LF, nothing else forgiven). Returns the committed text with the proof |
| Committed bytes, asked | `agent/src/memory/committedBytes.ts` | `readCommittedMemoryFile(ports, root, path)`: path judged first (git is asked nothing for a bad path), one `rev-parse`, `ls-tree -z <commit> -- <path>` for the exact entry, `cat-file -s`, `cat-file blob <oid>` hashed back with `blobNameOf`, then the working tree through `DocumentFs` (every directory on the way asked, a link never followed, the exact name in the listing). `readCommittedDecisionTexts(git)` lists decisions at HEAD, or null (unknown) |
| Stale citations | `core/src/search/citation.ts`, `citedSearch.ts`, `untrustedExcerpt.ts` | `citationFreshnessOf(builtAt, head)`: fresh only when both are commit names and equal; stale with `head-moved`, `head-unknown` or `built-commit-unknown`. A value on the citation, set by the ranked search, shown in the fence header (`freshness=stale:head-moved`) and in the fence id, judged again by the renderer. A hit nobody judged carries none and claims none |
| The index records its commit | `agent/src/search/{localIndex,projectIndex,ports}.ts` | `built_at_commit` beside the build time; HEAD asked at build and at every search through `SearchHead`; no head port, or a head that throws or is not a commit name, marks every citation stale. Schema version stays 2: the column is additive and added in place to an older file |
| Retention per class | `core/src/memory/retention.ts` | `MEMORY_RETENTION`: the six classes of `memory-classes.md`, each with store, retention, `autoDelete: false`, delete action and class, owner required |
| Recorded deletion | `retention.ts`, `core/src/memory/deletionLedger.ts`, `agent/src/memory/memoryDeletion.ts` | `judgeMemoryDeletion` (owner port answering exactly `true`, frozen claim bound to hash, tenant, project, path and reason, asked once, hash must equal the item's now); the append-only ledger (numbered files, exclusive create, hash chain); `deleteMemoryItem` and `deleteDerivedIndex` |
| Shared shapes | `core/src/memory/memoryShapes.ts` | `plainRecordOf` (one read into a frozen null-prototype copy; accessors, symbol keys, `__proto__`/`constructor`/`prototype` and unlisted fields refused), `isGitObjectId`, `memoryPathShapeProblem` |
| Core barrel | `core/src/index.ts` | Five lines. The new modules are exported here and **not** through `memory/index.ts`, so `port-memory1a`'s copy of that barrel is unchanged |
| Validator | `validators/val-projectos-memory-provenance1a.cjs` | 14 rules; 156 text and 83 behavioural named mutations; registered in both runners after `memory-stores1a` and before `connector-contract1a` |

### What the deletion does, in order

1. Read the request once; a request that cannot be read has no tenant and project to key an entry under, so it is refused and **not recorded** (`recorded: false`).
2. Ask the clock (injected, whole milliseconds, refuse NaN / negative / fractional) and read the whole ledger, verifying its chain. A broken chain or a foreign file refuses the deletion.
3. Look at the item without following a link (every directory on the way); a link, a directory or an item over 1 MiB is `DELETE_ITEM_NOT_REGULAR`.
4. Judge: class from the path, absent, hash, then the owner. Any refusal is appended as `refused` with its code, the requested item hash and the reason.
5. Append `authorised`. If that cannot be written, **nothing is removed**.
6. Read the item's hash again. If it changed after the owner said yes, refuse (`DELETE_HASH_MISMATCH`, recorded). Otherwise remove it, and append `deleted` or `delete-failed`. If only the closing entry cannot be written the deletion stands and says `recorded: false`.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| A committed decision ranks above any memory or summary that contradicts it, and a summary cannot replace a decision | `core/test/memory-provenance.test.ts` ("a committed decision ranks above a newer memory or summary that contradicts it, which is marked as overruled", "a summary never replaces a decision"; the file has 55 tests), `agent/test/memoryCommittedBytes.test.ts` ("turns into a ranking item that outranks a newer summary that contradicts it"). MP-2 |
| A memory or decision file whose working-tree bytes differ from HEAD is refused | `core/test/memory-committed-bytes.test.ts` ("a file whose working-tree bytes differ from HEAD is refused"; the file has 64 tests), `agent/test/memoryCommittedBytes.test.ts` (38 tests: a fake git, and 5 against a real git repository in a temp directory: edited, deleted, uncommitted, staged-only, committed symlink). MP-3 |
| A citation from an index built before HEAD is marked stale | `core/test/search-freshness.test.ts` (30), `agent/test/searchFreshness.test.ts` (25, with SQLite: moved head, no head, unreadable head, rebuild, migration, render). MP-4 |
| Deleting approved memory without the owner is refused; every deletion is recorded | `core/test/memory-retention.test.ts` (44), `core/test/memory-deletion-ledger.test.ts` (10), `agent/test/memoryDeletion.test.ts` (34: refused with no verifier or a verifier that does not say exactly true, recorded with item hash and reason; authorised then deleted in one chain; ledger down stops the deletion; changed after the owner said yes). MP-5, MP-6, MP-7 |
| Validator pin and named mutations, each named after the rule body and killed by its own rule | The mutation table. MP-1 pins `memory-delete` as P5 from the registry JSON and refuses if any of the seven O1 entries is missing |

### Failing test first, with the red run captured

Every core rule and every agent rule had its test written against a stub that exported the right names and threw. The first run was
red, before any implementation. From the captured runs (names are in the appendix):

| Test file | Red run (against the stub) |
|---|---|
| `core/test/memory-provenance.test.ts` | 55 failed |
| `core/test/memory-committed-bytes.test.ts` | 63 failed |
| `core/test/memory-retention.test.ts` | 42 failed |
| `core/test/memory-deletion-ledger.test.ts` | 9 failed |
| `core/test/search-freshness.test.ts` | 29 failed, 1 passed (the premise "a hit made with no freshness has none", true before the change) |
| `agent/test/memoryCommittedBytes.test.ts` | 38 failed (after a syntax error in the test file itself was fixed: a legacy octal escape, not a code failure) |
| `agent/test/memoryDeletion.test.ts` | 32 failed |
| `agent/test/searchFreshness.test.ts` | 23 failed, 1 passed (the premise "a head that throws while the index is built still rebuilds", true before the change) |
| **Total** | **291 failed, 2 premises passed** |

Tests added after that run were each seen red on their own before the code: `committedSize` (core committed bytes), `memoryDeletionRequestOf`
(core retention), `memoryClass: null` in a ledger entry (core ledger). The tests below were **not** red first, and say so:

- The three migration tests in `agent/test/searchFreshness.test.ts` ("keeps schema version 2...", "a file made before the column existed...",
  "a rebuild that stops before the commit is recorded...") and the "ledger is not a memory item" test in `memoryDeletion.test.ts` and its path in
  `memory-retention.test.ts` were written with, or after, the change that made them true. The migration rule is covered by two named
  mutations that fail only when the code runs (`an-old-file-is-not-migrated`, `the-migration-is-not-run-when-run`).
- Two assertions in `agent/test/searchIndex.test.ts` (a pre-existing file) changed to include `freshness: { state: 'stale', reason: 'head-unknown' }`:
  an index opened with no head port is stale by design.
- The validator is not red-first: its proof is the mutations.

## Mutations

Each mutation is applied and counts only when its own rule fires, and no rule it did not declare. A behavioural mutation changes a copy of
the source that runs against real SQLite, a fake git and an in-memory file system, and counts only when exactly its own rule's probes fail
(plus the rules it declares: a few retention or ledger mutations break an owner or a record probe too, and say so in the validator). The
unmutated tree passing every pin and every probe is the positive control.

| Rule | Says | Text | Behavioural |
|---|---|---|---|
| MP-1 | an action is unregistered or not owner-only | 6 | 0 |
| MP-2 | recollection outranks a decision | 18 | 14 |
| MP-3 | a working-tree copy is read as authority | 23 | 21 |
| MP-4 | a stale citation reads as fresh | 22 | 16 |
| MP-5 | a class is retained or deleted by the wrong action | 13 | 7 |
| MP-6 | memory is deleted without the owner | 12 | 10 |
| MP-7 | a deletion is not recorded, or removes more than it says | 20 | 15 |
| MP-8 | core is not pure or not browser-safe | 9 | 0 |
| MP-9 | the agent reaches a process, a clock or a file around its ports | 7 | 0 |
| MP-10 | stored text is read as authority | 6 | 0 |
| MP-11 | a file has no statement of origin | 4 | 0 |
| MP-12 | not registered: a runner or the core barrel does not name this phase | 9 | 0 |
| MP-13 | the proof does not run | 4 | 0 |
| MP-14 | a file is not tracked | 3 | 0 |
| **Total** | | **156** | **83** |

Rules named after the body: MP-3 holds the path shape (alternate stream, dot segment, trailing dot or space, control character, no bound,
an execution record read as committed), the judge (differing copy, symlink, submodule, linked copy, absent copy, byte cap, missing head,
path not judged first, the working copy returned instead of the committed bytes) and the agent's reader (blob not hashed, git asked before
the path is judged, another path read as this one, a case variant, a followed link, a linked or unhashed decision). MP-8 pins no `node:`
import in core under `memory/` or `search/` other than the three files that already imported `node:crypto`, no clock, no environment, and a
closed import list for the five new core files. The mutation that adds `node:fs` to `provenance.ts`, `node:util` to the committed read,
`node:crypto` to `retention.ts`, `node:os` to the citation and `node:buffer` to the fence are each killed by MP-8.

## Checks, with counts (read from the exit codes, not from a doc)

| Check | Result |
|---|---|
| core `npm run -s build` | exit 0 |
| core `npx vitest run` | 108 files, 4,571 tests, all pass |
| core `src` and the new core tests type-checked (temporary tsconfig) | exit 0, no output. (`test/search-citation.test.ts`, which this phase did not touch, already had one type error at line 317 under a strict test config: not mine, not changed) |
| agent typecheck, **alias**: `tsc` over `agent/src` with `@projectos/core` mapped to this worktree's `core/dist` | exit 0, no output |
| agent `src` and the five new or changed tests type-checked through the alias (`tsconfig.test.json` extended) | exit 0, no output |
| agent tests, **alias**: vitest with `@projectos/core` aliased to this worktree's `core/dist` | 120 files; 119 pass, 3,761 tests pass, 10 skipped. The one failing file is `tenantSidecar.test.ts`, the alias artefact described below |
| esbuild browser bundle of this worktree's `core/src/index.ts` (control-center's esbuild, `platform: 'browser'`, `node:crypto` and `node:buffer` aliased as `coreBrowserLoad.test.ts` does), evaluated in a bare context | exit 0, 851,516 bytes; a top-level `Buffer` beside the barrel fails as the positive control; `grep "from 'node:" core/src/memory core/src/search` lists only `prompt.ts`, `proposal.ts` and `store.ts`, all `node:crypto` and all there before this phase |
| `val-projectos-memory-provenance1a` | PASS, exit 0, about 32 s: 7 new and 9 changed files judged; 156 text and 83 behavioural mutations killed. Also run as validate-all runs it: `Array.isArray(run())` is `true` |
| `val-projectos-memory-stores1a` | **3 errors, none a defect of the code**: see "Out-of-path edits" |
| `val-projectos-port-search1a` | PASS: 22 real files; 113 text and 26 behavioural mutations killed |
| `val-projectos-port-memory1a` | PASS: 20 rules; 199 named mutations killed |
| `val-projectos-port-credit1a` | PASS: 185 real files judged; 157 fixture and 59 record mutations killed, exit 0 |
| `val-projectos-port-skills1a`, `val-projectos-port-context1a` (they read the scan and the memory barrel) | `port-skills1a` PASS (21 rules; 440 mutations, exit 0, 49 s); `port-context1a` PASS (18 rules; 320 mutations, exit 0, 248 s) |
| `validate-no-secrets` | PASS, exit 0 |

**The one agent failure under the alias is the alias, not the code.** `test/tenantSidecar.test.ts` builds the agent with its own `tsconfig.json`
in `beforeAll`, and the agent's `@projectos/core` junction points at another worktree whose `core/dist` does not have the new exports, so its
`tsc` stops and the file's 10 tests are skipped. Run on the merged stack, where the junction resolves to the merged core, it compiles.

### Other validators

Each ran in its own process and its exit code was read: all **exit 0 and PASS**: `val-projectos-connector-contract1a` (293 mutations),
`-kernel-followup1a` (88), `-port-agents1a` (65 text, 132 behaviour), `-port-approvals1a` (64 text, 81 behaviour), `-port-computer1a`
(120 text, 306 behaviour), `-port-mcp1a` (281 text, 107 behavioural), `-port-providers1a` (221 text, 89 behavioural), `-port-research1a` (205 text,
165 behavioural), `-port-routines1a` (83 text, 108 behaviour), `-tenant-contract1a` (346), `-tenant-credentials1a` (279), `-tenant-csp1a` (106),
`-tenant-principal1a` (210), `-tenant-rls1a` (205 text, 43 database), `-validator-scratch-lifecycle1a`, `validate-speed-validation-cache`,
`validate-v2-closure-evidence`, `val-projectos-v3-validation-evidence1a`. That is every validator a grep of the touched paths found, except
`validate-all` (the lead's) and the files that are libraries. `validate-all` itself was not run.

## Converge (B9)

**Unbuilt on purpose.**
- Nothing calls any of it: not the context manager (3.4), not the loop, not a CLI command. `agent/src/index.ts` is unchanged (outside the write paths).
- The owner verifier is a port. No production verifier exists here; the real one belongs with owner proof.
- No automatic deletion and no retention timer: every class says `autoDelete: false`.
- No code-intelligence memory (class 6).
- The decisions' own writer is not touched: a committed decision is written by the closure machinery and this phase only reads it.
- A decision cites an item by naming its path or hash in text; there is no structured citation field, so `citedByDecision` is a substring match that only ever adds protection.

**Drift.** None. The delta row asked for: ranking by provenance and freshness (done), committed bytes only with a differing working copy refused (done),
a summary never overwrites a decision (done as a refusal code), stale-citation marking (done), retention and deletion per class with each deletion
recorded and `memory-delete` P5 (done).

**PROTECTED files untouched.** `git diff --stat 7fc020da..HEAD` lists only files under `projectos/core/src/{memory,search}/`, `projectos/core/src/index.ts`,
`projectos/core/test/`, `projectos/agent/src/{memory,search}/`, `projectos/agent/test/`, `projectos/validators/val-projectos-memory-provenance1a.cjs`,
`projectos/validators/validate-all.cjs`, `projectos/speed/cached-runner.cjs` and this file. No `taskEnvelope.ts`, `actionRegistry.ts`, `tenant.ts`,
`verification.ts`, `action-registry.json`, `val-projectos-tenant-contract1a.cjs`, `run.ts`, `system.ts`, `docs/06_Plan.md` or any other validator.

## Out-of-path edits needed

**1. Two validators outside this phase's write paths go stale from the change, and were not edited.** Each is a pin on text this phase had to change.

- `val-projectos-memory-stores1a.cjs` fails three rules (MS-15 twice, MS-3 once). Everything else it pins still holds.
  - **MS-15, in `validate-all` and in `cached-runner`**: it pins "this validator is immediately before `val-projectos-connector-contract1a`". The brief put
    `val-projectos-memory-provenance1a` between them, so that pin is false by design. The edit: set its `NEXT_VALIDATOR` to `val-projectos-memory-provenance1a`, and in
    its mutation `the-cached-runner-entry-is-removed` replace the anchor `// PROJECTOS-CONNECTOR-CONTRACT1A` after its entry with the comment that now follows it
    (`// PROJECTOS-MEMORY-PROVENANCE1A`).
  - **MS-3, `projectIndex.ts`**: it pins the text `openSearchIndex(where.location, { owner, clock: deps.clock })`. The call now also passes the head:
    `openSearchIndex(where.location, { owner, clock: deps.clock, ...(deps.head === undefined ? {} : { head: deps.head }) })`. Update the pin and the mutation text that reads it.
- Everything else that would have gone stale was **avoided** rather than reported: the schema version stays 2 (an additive column added in place), the
  `writeProject(..., built.records, now);` line is unchanged (the commit is recorded after the rows), `fenceIdOf`'s `\n${hit.untrustedText}` ending is unchanged
  (the mark goes before the text), `untrustedExcerpt.ts` still reads `const id = fenceIdOf(hit);`, the rank pre-filter line is unchanged, `citation.ts` imports nothing new,
  and `localIndex.ts` and `ports.ts` import only names the search barrel exports, so `port-search1a`'s shim loads them. `port-search1a` and `port-memory1a` pass untouched.

**2. Wiring is Stage 4.1 (named, not made).** The pieces are ready; the call sites are in files outside this phase's paths:

- The context manager (3.4) asks for retrieval items: read decisions, plan memory and approved memory with `readCommittedMemoryFile(ports, root, path)`, turn each read into an item with
  `committedItemOf(read, timeMs, contradicts?)`, add the index's hits (as `execution-record`, `finding` or `summary` items with no proof), and order them with `rankByProvenance`.
  Open the per-project index with `openProjectSearchIndex(directory, owner, { clock, ensureDirectory, head: searchHeadOver(gitRunnerOver(system, root)) })`.
- Whatever lets a model or a worker stand one stored item in for another (the proposal door's approval, a future summary writer) must call `provenanceReplacementProblem(writer, target)` first.
- A deletion command, when there is one, calls `deleteMemoryItem` with a verifier that asks the owner at the console (a port that answers exactly `true`), `deleteDerivedIndex` for an index, and
  `readCommittedDecisionTexts(gitRunnerOver(system, root))` as `committedDecisions`. `agent/src/index.ts` should export the new agent names.
- `docs/architecture/memory-classes.md` still says marking a stale citation and retention are "plan 3.3" (class 5 retention cell). It is outside this phase's paths, and `val-projectos-memory-stores1a` pins that cell's text (MS-2), so it was not edited. A later phase can say "built in 3.3" together with that pin.

## Residuals and owner questions

- **Owner question: a lighter deletion entry.** Deleting an uncited execution record or a rejected proposal is `memory-delete` (P5) here only because the registry has no weaker entry. If the owner wants a P2 entry for those, it is one registry act, and `retention.ts` changes in one place.
- **The owner verifier has no production implementation.** A port answering exactly `true`; the claim is frozen and bound, but a real console prompt is owner-proof work.
- **A malformed deletion request is refused and not recorded.** It has no valid tenant and project to key an entry to. A request with a valid owner and a path the ledger cannot hold is recorded under `unrecordable-path:<sha256>`.
- **The ledger's last entry is not anchored.** The chain finds a changed, removed or foreign entry; it cannot show that the newest entries were cut off, and someone who can write the whole directory can rewrite the whole chain. A head hash kept elsewhere (the closure ledger, a commit) would anchor it.
- **A deletion removes the working-tree file only.** Git still holds a committed decision or memory file in history, so deleting one does not erase its committed bytes: `readCommittedMemoryFile` still reads it at HEAD, and it reads as absent in the working tree, which that function refuses. A deleted decision therefore stops being readable until it is committed as deleted.
- **The item hash is over decoded text,** as the store digest's is, not over raw bytes. Two files that differ only in bytes that decode alike hash alike. Items over 1 MiB are not deleted here.
- **A transparent Proxy is not detected in core** (`plainRecordOf`), as in STORES1A: it needs a port core does not have. The items to rank and the facts to judge are built by the agent's own code, not parsed from a worker's JSON.
- **An index built from a dirty working tree at HEAD reads fresh.** The mark says whether HEAD has moved since the index was built, nothing more. Authority files are protected by the committed read, not by the mark. The documents indexed from the working tree can still be uncommitted.
- **The sources for a rebuild are collected before `rebuildProject` is called,** so HEAD is read at the start of the rebuild, not when the files were read. A commit made in that window is recorded as the build commit.
- **An index record written before this phase has no commit,** so every citation from it is stale (`built-commit-unknown`) until the project is rebuilt, which is the intended direction.
- **Case-folded ids in the ranking.** Two items whose ids differ only by case or width are one item and the lower tier is refused as a duplicate. Git paths are case-sensitive, so two committed files `A.md` and `a.md` would collide; that is a refusal, never a promotion.
- **`citedByDecision` is a substring match** on a decision's text for the item's path or hash. It reads no meaning and can only add protection; a decision that cannot be read (git failed, a link, an unhashed blob, over 500 files or 8 MiB) marks the item `unknown`, which also needs the owner.
- **The validator is 1,046 lines,** over the 800 the style rule names, like its siblings (1,089 to 1,448): its pins, probes and mutations share names. The new core and agent source files are all under 300 lines.
- **The behavioural copy is not the build.** It runs under type stripping with a local shim for `@projectos/core`, a fake git, and the real `blobNameOf` cut out of the installation file. `tsc` and the suites cover the real build.
- **Equivalent mutations dropped from the behavioural set** (kept as text pins): removing the throw in the fence's mark reader (the next line throws on null anyway), and removing the size bound on a ledger entry (a 60,000-character entry fails to parse anyway; the bound only saves the parse).
- **`node:sqlite` is experimental** in Node 24.14.1 and prints a warning when an index opens.

## Commits

- `feat(memory): provenance ranking, committed bytes only, stale citations, retention and recorded deletion`: the core rules, the agent files, their tests, the validator, the registration and this file. One commit on the branch, not pushed.

## Appendix: the failing run, test names (against the stub, before the implementation)

Names are as vitest printed them; names from `it.each` are shown once with a count, and quoted values are replaced by `%s`.

**memory-committed-bytes.test.ts**: 63 failed

- the path of a committed read allows .projectops/memory/MEMORY.md
- the path of a committed read allows .projectops/memory/USER.md
- the path of a committed read allows .projectops/plan-main.json
- the path of a committed read allows .projectops/current-state-main.json
- the path of a committed read allows .projectops/closure/decisions/PROJECTOS-MEMORY-PROVENANCE1A.json
- the path of a committed read refuses %s with COMMITTED_PATH_INVALID
- the path of a committed read refuses %s with COMMITTED_PATH_ESCAPES (x10)
- the path of a committed read refuses %s with COMMITTED_PATH_NOT_A_MEMORY_FILE (x7)
- the path of a committed read refuses %s with COMMITTED_PATH_NOT_NORMAL (x6)
- the path of a committed read refuses what is not a string, and a,000 character path at once
- a file whose working-tree bytes differ from HEAD is refused reads the committed bytes when the working tree is the same: the positive control
- a file whose working-tree bytes differ from HEAD is refused the bytes it returns are the committed bytes, not the working tree, and the result is froz
- a file whose working-tree bytes differ from HEAD is refused a CRLF working copy of the same text is the same bytes, which a Windows checkout needs
- a file whose working-tree bytes differ from HEAD is refused refuses a working copy with one character changed, and returns no text
- a file whose working-tree bytes differ from HEAD is refused refuses a working copy with a line added, and returns no text
- a file whose working-tree bytes differ from HEAD is refused refuses a working copy with emptied, and returns no text
- a file whose working-tree bytes differ from HEAD is refused refuses a working copy with a trailing space, and returns no text
- a file whose working-tree bytes differ from HEAD is refused refuses a working copy with a lone carriage return, and returns no text
- a file whose working-tree bytes differ from HEAD is refused refuses a working copy with a different decision of the same length, and returns no text
- a file whose working-tree bytes differ from HEAD is refused refuses a working tree that is {%s:%s} (x7)
- a file whose working-tree bytes differ from HEAD is refused refuses a working tree that is {%s:%s,%s:5}
- a file whose working-tree bytes differ from HEAD is refused refuses a working tree that is null
- what HEAD holds must be a regular file of the project refuses the HEAD entry {%s:%s,%s:%s,%s:%s} with COMMITTED_SYMLINK
- what HEAD holds must be a regular file of the project refuses the HEAD entry {%s:%s,%s:%s,%s:%s} with COMMITTED_NOT_REGULAR (x4)
- what HEAD holds must be a regular file of the project refuses the HEAD entry {%s:%s,%s:%s,%s:%s} with COMMITTED_FACTS_INVALID (x2)
- what HEAD holds must be a regular file of the project refuses the HEAD entry {%s:%s,%s:%s} with COMMITTED_FACTS_INVALID
- what HEAD holds must be a regular file of the project refuses the HEAD entry %s with COMMITTED_FACTS_INVALID
- what HEAD holds must be a regular file of the project refuses the HEAD entry null with COMMITTED_NOT_IN_HEAD
- what HEAD holds must be a regular file of the project allows an executable regular file
- what HEAD holds must be a regular file of the project refuses a repository with no HEAD, and a HEAD that is not a commit name
- what HEAD holds must be a regular file of the project refuses bytes that could not be read, and bytes over the cap counted in UTF-8 and not in charact
- what HEAD holds must be a regular file of the project judges the path first, so a path that escapes reaches no other rule
- what HEAD holds must be a regular file of the project refuses facts that are not plain data: a getter, a Proxy-shaped accessor, an inherited field

**memory-deletion-ledger.test.ts**: 9 failed

- every deletion and every refused attempt is recorded, with the item hash and the reason writes an entry that carries the item hash, the reason, the ac
- every deletion and every refused attempt is recorded, with the item hash and the reason a refused attempt with no item hash yet (the item was absent) 
- every deletion and every refused attempt is recorded, with the item hash and the reason refuses a record it could not trust: an unknown outcome, a bad
- the record is append-only: a change is found verifies an unbroken chain and names its last hash
- the record is append-only: a change is found finds an entry whose field was changed after it was written
- the record is append-only: a change is found finds an entry removed from the middle, an entry out of order, and an entry from another chain
- the record is append-only: a change is found finds the first entry deleted, because the second no longer follows the genesis
- the record is append-only: a change is found finds an entry whose name and sequence disagree, a name that is not an entry, and text that is not JSON
- the record is append-only: a change is found a chain of,000 characters of text in one entry is refused by size and not parsed

**memory-provenance.test.ts**: 55 failed

- a committed decision outranks recollection orders the seven kinds: decision, then approved and plan memory, then execution and findings, then summarie
- a committed decision outranks recollection a committed decision ranks above a newer memory or summary that contradicts it, which is marked as overrule
- a committed decision outranks recollection an item that is overruled sorts after an item in its own tier that is not
- a committed decision outranks recollection a decision claimed without proof of the committed bytes ranks as a recollection, and says so
- a committed decision outranks recollection a proof that is not a commit and a blob name does not make a decision
- a committed decision outranks recollection the rank comes from provenance fields and never from text: an item carrying text is refused
- a committed decision outranks recollection an id that reads like a decision does not rank like one
- a committed decision outranks recollection inside a tier the newer item ranks first, then the id decides, so the order is the same however the input i
- a committed decision outranks recollection two items with one id keep the higher tier, whichever came first, and the other is refused
- a committed decision outranks recollection ids are compared in one canonical form, so a case or width variant cannot shadow an item
- a committed decision outranks recollection a contradiction names a decision that is there and proven, or it names nothing
- a committed decision outranks recollection a decision is never overruled by what it is said to contradict
- a committed decision outranks recollection refuses an unknown kind, by code, and keeps the rest
- a committed decision outranks recollection refuses a time that is not finite, by code, and keeps the rest
- a committed decision outranks recollection refuses an infinite time, by code, and keeps the rest
- a committed decision outranks recollection refuses a negative time, by code, and keeps the rest
- a committed decision outranks recollection refuses a time as a string, by code, and keeps the rest
- a committed decision outranks recollection refuses an empty id, by code, and keeps the rest
- a committed decision outranks recollection refuses an id with a control character, by code, and keeps the rest
- a committed decision outranks recollection refuses an id with a leading space, by code, and keeps the rest
- a committed decision outranks recollection refuses an id that is not a string, by code, and keeps the rest
- a committed decision outranks recollection refuses a contradiction list that is not a list, by code, and keeps the rest
- a committed decision outranks recollection refuses a contradiction list of, by code, and keeps the rest
- a committed decision outranks recollection refuses a contradiction that is not an id, by code, and keeps the rest
- a committed decision outranks recollection refuses an item that is a list, by code, and keeps the rest
- a committed decision outranks recollection refuses an item that is null, by code, and keeps the rest
- a committed decision outranks recollection refuses an item that is a string, by code, and keeps the rest
- a committed decision outranks recollection refuses a getter, a symbol key, a prototype key and a non-plain prototype, so a second read cannot differ
- a committed decision outranks recollection refuses a list that is not a list, and one over the cap, whole and unread
- a committed decision outranks recollection returns frozen results, and changing the input afterwards changes nothing
- a committed decision outranks recollection an id of,000 characters is refused at once, and hostile text in an id takes no time
- a summary never replaces a decision refuses a summary writing over a decision, with its own code
- a summary never replaces a decision refuses a recollection writing over a decision, with its own code
- a summary never replaces a decision refuses an unproven decision claim writing over a decision, because it is a recollection
- a summary never replaces a decision a decision is not replaceable through this door by anything, a decision included
- a summary never replaces a decision a lower rank never replaces a higher one
- a summary never replaces a decision the same tier or a higher one is not refused here, and that is not an approval
- a summary never replaces a decision a writer or target that cannot be read is refused
- the kind of a stored file comes from where it is, never from what it says .projectops/closure/decisions/PROJECTOS-X.json is committed-decision
- the kind of a stored file comes from where it is, never from what it says .projectops/memory/MEMORY.md is approved-memory
- the kind of a stored file comes from where it is, never from what it says .projectops/memory/USER.md is approved-memory
- the kind of a stored file comes from where it is, never from what it says .projectops/plan-main.json is plan-memory
- the kind of a stored file comes from where it is, never from what it says .projectops/current-state-main.json is plan-memory
- the kind of a stored file comes from where it is, never from what it says .projectops/execution/s1.findings.json is finding
- the kind of a stored file comes from where it is, never from what it says .projectops/execution/s1.evidence.json is execution-record
- the kind of a stored file comes from where it is, never from what it says docs/decision.md is not a stored kind
- the kind of a stored file comes from where it is, never from what it says .projectops/memory/proposals/p1.json is not a stored kind
- the kind of a stored file comes from where it is, never from what it says .projectops/memory/MEMORY.md. is not a stored kind
- the kind of a stored file comes from where it is, never from what it says .Projectops/memory/MEMORY.md is not a stored kind
- the kind of a stored file comes from where it is, never from what it says .projectops/memory/memory.md is not a stored kind
- the kind of a stored file comes from where it is, never from what it says .projectops/closure/decisions/../x.json is not a stored kind
- the kind of a stored file comes from where it is, never from what it says /.projectops/memory/MEMORY.md is not a stored kind
- the kind of a stored file comes from where it is, never from what it says  is not a stored kind
- the kind of a stored file comes from where it is, never from what it says null is not a stored kind
- the kind of a stored file comes from where it is, never from what it says a path of,000 characters is judged at once

**memory-retention.test.ts**: 42 failed

- retention is written down per class, from the six classes of memory-classes.md has the six classes, in order, under the names the classes file gives t
- retention is written down per class, from the six classes of memory-classes.md no class deletes by itself, and every class says how long it keeps what
- retention is written down per class, from the six classes of memory-classes.md deleting in the four stores of record is memory-delete, P5, owner only;
- retention is written down per class, from the six classes of memory-classes.md puts .projectops/plan-main.json in programme-project-memory
- retention is written down per class, from the six classes of memory-classes.md puts .projectops/current-state-main.json in programme-project-memory
- retention is written down per class, from the six classes of memory-classes.md puts .projectops/project-config.json in programme-project-memory
- retention is written down per class, from the six classes of memory-classes.md puts .projectops/closure/decisions/PROJECTOS-X.json in programme-projec
- retention is written down per class, from the six classes of memory-classes.md puts .projectops/execution/s1.findings.json in execution-memory
- retention is written down per class, from the six classes of memory-classes.md puts .projectops/continuity/state.json in execution-memory
- retention is written down per class, from the six classes of memory-classes.md puts .projectops/memory/MEMORY.md in curated-memory
- retention is written down per class, from the six classes of memory-classes.md puts .projectops/memory/proposals/p1.json in curated-memory
- retention is written down per class, from the six classes of memory-classes.md puts .projectops/skills/promoted/review.json in skills
- retention is written down per class, from the six classes of memory-classes.md does not put %s in a class (x8)
- retention is written down per class, from the six classes of memory-classes.md does not put null in a class
- retention is written down per class, from the six classes of memory-classes.md does not put in a class
- deleting approved memory, or what a decision cites, needs the owner is refused with no verifier, and with a verifier that does not answer exactly true
- deleting approved memory, or what a decision cites, needs the owner is allowed as memory-delete, P5, when the verifier answers exactly true
- deleting approved memory, or what a decision cites, needs the owner asks the owner about this item, this hash, this tenant and this project, in a froz
- deleting approved memory, or what a decision cites, needs the owner asks once, and a verifier that answers true the first time and false the second ch
- deleting approved memory, or what a decision cites, needs the owner approved memory is memory-delete, P5, with no owner and with one
- deleting approved memory, or what a decision cites, needs the owner plan memory is memory-delete, P5, with no owner and with one
- deleting approved memory, or what a decision cites, needs the owner a decision is memory-delete, P5, with no owner and with one
- deleting approved memory, or what a decision cites, needs the owner an execution record is memory-delete, P5, with no owner and with one
- deleting approved memory, or what a decision cites, needs the owner a proposal is memory-delete, P5, with no owner and with one
- deleting approved memory, or what a decision cites, needs the owner a promoted skill is memory-delete, P5, with no owner and with one
- deleting approved memory, or what a decision cites, needs the owner an item a decision cites is owner-only whether or not the decision source could be
- deleting approved memory, or what a decision cites, needs the owner refuses what is not a memory item, an item that is not there, and a hash that is n
- deleting approved memory, or what a decision cites, needs the owner asks the owner nothing when the request itself is refused
- deleting approved memory, or what a decision cites, needs the owner refuses a request with a getter or a prototype key, so a second read cannot differ
- deleting approved memory, or what a decision cites, needs the owner a reason of,000 characters is refused at once
- deleting a derived index is memory-index-rebuild, and needs no owner names the action and the class, and asks nobody
- deleting a derived index is memory-index-rebuild, and needs no owner refuses an owner that is not a tenant and a project, and a reason it cannot recor
- an item a committed decision cites is found by its path or its hash finds the path, the hash, and neither
- an item a committed decision cites is found by its path or its hash only ever adds protection: it reads no meaning, and a long text is searched in lin
- an item a committed decision cites is found by its path or its hash an empty path or hash cites nothing rather than everything

**search-freshness.test.ts**: 29 failed, 1 passed (a premise: the mark is a value on the citation, and a hit without one claims nothing a hit made with )

- a citation from an index built before HEAD is marked stale is fresh only when the commit the index was built at is the commit HEAD is at
- a citation from an index built before HEAD is marked stale is stale when HEAD has moved, and says so
- a citation from an index built before HEAD is marked stale is stale, never fresh, when either commit is unknown
- a citation from an index built before HEAD is marked stale does not take %s as a commit, so it is never fresh (x8)
- a citation from an index built before HEAD is marked stale does not take as a commit, so it is never fresh
- a citation from an index built before HEAD is marked stale does not take undefined as a commit, so it is never fresh
- a citation from an index built before HEAD is marked stale does not take {} as a commit, so it is never fresh
- a citation from an index built before HEAD is marked stale two spellings of one commit are not one commit
- a citation from an index built before HEAD is marked stale a-character commit name is a commit name too
- the mark is a value on the citation, and a hit without one claims nothing carries the judged freshness on the citation
- the mark is a value on the citation, and a hit without one claims nothing refuses a freshness it cannot read, {%s:%s,%s:%s}, as no-freshness (x2)
- the mark is a value on the citation, and a hit without one claims nothing refuses a freshness it cannot read, {%s:%s}, as no-freshness (x2)
- the mark is a value on the citation, and a hit without one claims nothing refuses a freshness it cannot read, %s, as no-freshness
- the mark is a value on the citation, and a hit without one claims nothing refuses a freshness it cannot read, null, as no-freshness
- the mark is a value on the citation, and a hit without one claims nothing refuses a freshness it cannot read, {%s:%s,%s:1}, as no-freshness
- the mark is a value on the citation, and a hit without one claims nothing every hit of a ranked search carries the freshness the search was given
- a stale citation is still rendered, with the mark shows the stale mark and the reason in the header, and still shows the text
- a stale citation is still rendered, with the mark shows a fresh mark for a fresh citation, and none for a hit that was never judged
- a stale citation is still rendered, with the mark judges the mark again, so a hand-made hit cannot show a mark it was not given or hide a stale one in
- a stale citation is still rendered, with the mark changing the mark changes the fence, so a stale excerpt cannot be passed off as a fresh one with the

**memoryCommittedBytes.test.ts**: 38 failed

- a memory file whose working-tree bytes differ from HEAD is refused reads the committed bytes, with the commit and the blob that prove it, when the wor
- a memory file whose working-tree bytes differ from HEAD is refused refuses a working copy that was edited, and does not fall back to HEAD: no text com
- a memory file whose working-tree bytes differ from HEAD is refused refuses one flipped character at the same length
- a memory file whose working-tree bytes differ from HEAD is refused accepts a CRLF working copy of the same text, which a Windows checkout produces
- a memory file whose working-tree bytes differ from HEAD is refused refuses a file that is not committed, and a working file that is gone
- a memory file whose working-tree bytes differ from HEAD is refused refuses a working copy that is a link, and a store directory on the way that is a l
- a memory file whose working-tree bytes differ from HEAD is refused refuses a working path that is a directory or another kind of entry
- a memory file whose working-tree bytes differ from HEAD is refused refuses a case variant on disk, which a case-insensitive file system would open as 
- a memory file whose working-tree bytes differ from HEAD is refused refuses a working file over the cap without reading it
- what HEAD holds must be a regular file refuses a symlink
- what HEAD holds must be a regular file refuses a submodule
- what HEAD holds must be a regular file refuses a tree
- what HEAD holds must be a regular file refuses a repository with no HEAD, and one whose git cannot be run
- what HEAD holds must be a regular file refuses bytes that do not hash to the blob git named, so what git showed is not those bytes
- what HEAD holds must be a regular file refuses a blob over the cap by the size git reports, and never asks for its bytes
- what HEAD holds must be a regular file takes the tree entry only when it names exactly the path asked for
- what HEAD holds must be a regular file pins every later call to the one commit and blob it first named, so a HEAD that moves in between changes nothin
- what HEAD holds must be a regular file asks git nothing about %s (x12)
- a committed read is what ranks as a decision turns into a ranking item that outranks a newer summary that contradicts it
- the committed decisions, read for the deletion rule lists every decision at HEAD as text
- the committed decisions, read for the deletion rule is an empty list, and not a failure, for a repository with no decisions
- the committed decisions, read for the deletion rule answers null, which is unknown and not none, when git cannot be asked, a decision is a link, bytes
- against a real git repository reads the committed bytes of a clean file, with the real commit and blob
- against a real git repository refuses an edited working copy, a deleted one, and an uncommitted new one
- against a real git repository refuses a symlink that HEAD holds, committed without needing a link on disk
- against a real git repository follows HEAD: a new commit changes the commit named, and the old edit is no longer what is committed
- against a real git repository lists the decisions at HEAD, and only those at HEAD

**memoryDeletion.test.ts**: 32 failed

- deleting approved memory without the owner is refused, and recorded refuses with no verifier at all, keeps the item, and records the refusal with the 
- deleting approved memory without the owner is refused, and recorded refuses when the verifier answers false, and records it
- deleting approved memory without the owner is refused, and recorded refuses when the verifier answers the string true, and records it
- deleting approved memory without the owner is refused, and recorded refuses when the verifier answers a Promise, and records it
- deleting approved memory without the owner is refused, and recorded refuses when the verifier answers a throw, and records it
- deleting approved memory without the owner is refused, and recorded asks the owner once, about this item, this hash, this tenant and this project
- deleting approved memory without the owner is refused, and recorded with the owner, deletes the item and records an authorisation and then the deletio
- deleting approved memory without the owner is refused, and recorded a decision is memory-delete too: refused with no owner, allowed with one, and reco
- deleting approved memory without the owner is refused, and recorded plan memory is memory-delete too: refused with no owner, allowed with one, and rec
- deleting approved memory without the owner is refused, and recorded an execution record is memory-delete too: refused with no owner, allowed with one,
- deleting approved memory without the owner is refused, and recorded a pending proposal is memory-delete too: refused with no owner, allowed with one, 
- deleting approved memory without the owner is refused, and recorded a promoted skill is memory-delete too: refused with no owner, allowed with one, an
- deleting approved memory without the owner is refused, and recorded records whether a committed decision cites the item, and treats a decision it coul
- every refused attempt is recorded, whatever the refusal a hash that is not the item: refused, the owner is not asked, the item stays
- every refused attempt is recorded, whatever the refusal an item that is not there: refused and recorded, with no hash
- every refused attempt is recorded, whatever the refusal something that is not a memory item (a document): refused and recorded with no class
- every refused attempt is recorded, whatever the refusal a path that is a link, a directory, or lies behind a link: refused and recorded, never removed
- every refused attempt is recorded, whatever the refusal a request that cannot be read has no tenant and project to record it under: refused, and says 
- every refused attempt is recorded, whatever the refusal a clock that gives no time refuses the deletion, because an entry cannot be made without one
- nothing is deleted that is not recorded first a ledger that cannot take an entry stops the deletion before it starts
- nothing is deleted that is not recorded first a ledger whose chain is broken, or that holds a foreign file, is not extended and nothing is deleted
- nothing is deleted that is not recorded first a second attempt extends the same chain, and the first entries are never rewritten or removed
- nothing is deleted that is not recorded first removes only the item: the ledger is created into and never removed from, and no write port exists
- nothing is deleted that is not recorded first when the removal itself fails, the failure is recorded and the outcome says so
- nothing is deleted that is not recorded first when only the closing entry cannot be written, the deletion stands and says it is not fully recorded
- nothing is deleted that is not recorded first an item that changes between the owner saying yes and the removal is not removed: the approval was for o
- deleting a derived index is memory-index-rebuild, needs no owner, and is recorded removes that owner's file and nothing else, asks nobody, and records
- deleting a derived index is memory-index-rebuild, needs no owner, and is recorded cannot be aimed at anything else: the file name comes from the owner
- deleting a derived index is memory-index-rebuild, needs no owner, and is recorded an index that is not there is refused and recorded, not reported as 
- deleting a derived index is memory-index-rebuild, needs no owner, and is recorded a failed removal is recorded, and a ledger that cannot take an entry
- the deletion ledger is read back whole lists its entries in order with the chain verified, and refuses a ledger that was changed
- the deletion ledger is read back whole an empty ledger is a valid ledger of no entries

**searchFreshness.test.ts**: 23 failed, 1 passed (a premise: a citation from an index built before HEAD is marked stale a head that throws while the in)

- a citation from an index built before HEAD is marked stale records the commit the index was built at, and a citation from it is fresh while HEAD has n
- a citation from an index built before HEAD is marked stale marks the citation stale when HEAD has moved, and still returns it with its text
- a citation from an index built before HEAD is marked stale a rebuild at the new HEAD makes it fresh again
- a citation from an index built before HEAD is marked stale asks for HEAD at each search, so a commit made after the first search is seen by the second
- a citation from an index built before HEAD is marked stale an index opened with no head port marks every citation stale, never fresh
- a citation from an index built before HEAD is marked stale an index built when HEAD answered a null is stale, even when HEAD is readable later
- a citation from an index built before HEAD is marked stale an index built when HEAD answered text that is not a commit is stale, even when HEAD is rea
- a citation from an index built before HEAD is marked stale an index built when HEAD answered an upper-case spelling is stale, even when HEAD is readab
- a citation from an index built before HEAD is marked stale an index built when HEAD answered a name with a newline is stale, even when HEAD is readabl
- a citation from an index built before HEAD is marked stale a head that throws, or answers something that is not a commit, marks the citation stale and
- a citation from an index built before HEAD is marked stale every hit of one search carries the same mark
- a citation from an index built before HEAD is marked stale a stale hit is rendered with its mark, and the mark is not in the indexed text
- the index file records the commit, and an older file is rebuilt is schema version, with the build commit beside the build time
- the index file records the commit, and an older file is rebuilt a version file is dropped and rebuilt on open, and answers not-built until it is
- the head port reads HEAD through git, and nothing else asks `rev-parse --verify HEAD` and answers the trimmed commit
- the head port reads HEAD through git, and nothing else answers null when git failed
- the head port reads HEAD through git, and nothing else answers null when no status
- the head port reads HEAD through git, and nothing else answers null when empty output
- the head port reads HEAD through git, and nothing else answers null when output that is not a commit
- the head port reads HEAD through git, and nothing else answers null when two lines
- the head port reads HEAD through git, and nothing else answers null, and does not throw, when git cannot be run at all
- the head port reads HEAD through git, and nothing else runs git with replacement objects off and the root named, with no shell, through the system por
- the head port reads HEAD through git, and nothing else turns a throw from the system into a failed result
