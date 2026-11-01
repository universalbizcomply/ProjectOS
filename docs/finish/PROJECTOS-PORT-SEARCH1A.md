# PROJECTOS-PORT-SEARCH1A — cited document and session search (C8, C10)

**Phase:** PROJECTOS-PORT-SEARCH1A, phase 2 of `docs/changes/delta_spec_V4_PORTS.md`, plan v1.31 (active).
**Branch:** `projectos-port-search1a`, worktree `C:/dev/ProjectOS-worktrees/port-search1a`, based on
`projectos-port-foundation1a`. Not pushed, not merged, phase not closed, no phase record created.
**State:** implementation complete. The required reviews (ECC SECURITY, ECC CODE) are the lead's and have not happened.
Full `validate-all` is the lead's and was not run here. `docs/06_Plan.md` is not edited.

Nothing was run from a vendor folder, and `openbot-lower` was not opened.

## Delivered

| Item | Path | Result |
|---|---|---|
| Ported, pure | `projectos/core/src/search/{hybrid,mmr,temporalDecay,tokenize,keywordQuery,markdownChunks,textBudget}.ts` | Seven files from ten upstream files, each credited |
| Original, pure | `projectos/core/src/search/{citation,citedSearch,chunkRecords,ftsMatch,untrustedExcerpt,index}.ts` | The refusals, the fence, the FTS5 compiler and the seam |
| Original, agent | `projectos/agent/src/search/{localIndex,documentSources,index}.ts` | The index on `node:sqlite` and FTS5, and the document walk |
| Exports | `projectos/core/src/index.ts` | One line |
| Notices | `THIRD_PARTY_NOTICES` | 10 entries, written by script from each file's own header |
| Tests | `projectos/core/test/search-{citation,retrieval}.test.ts`, `projectos/agent/test/searchIndex.test.ts` | 137 core, 45 agent |
| Validator | `projectos/validators/val-projectos-port-search1a.cjs` | 23 rules plus PS-T, 99 named mutations, in both runners |

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| Every hit gives file and line range; a result with no source is refused | `admitSearchResult` is the only maker of a `CitedSearchHit`. 24 refusal cases in core, and rows corrupted in a real database refused in the agent, with the good row as positive control. PS-9, PS-11 |
| The index is rebuildable and records its project | A deleted database rebuilds to identical answers. `project` is NOT NULL and a bound parameter, and no search spans projects. PS-10, PS-16, PS-17 |
| Indexed content is untrusted data, tested with an injection fixture | Forged citation, forged close, SQL and FTS5 syntax in one document. It changes no citation, creates no project and cannot close the fence. PS-13, PS-14, PS-15 |
| Credit header and notices entry on every ported file | PS-2 pins the exact upstream files; PS-4 runs the credit judgement on every file. See the credit result below |
| Validator pin and named mutations, each killed by its own rule | 99 mutations. One counts only if its rule fires and no rule it did not declare |

## Credit result: expected failure, not this phase's

`val-projectos-port-credit1a` judges the real tree clean: no real file and no real entry is refused. Its self-test then
fails 11 times, on fixtures, with 9 "the entry is stale" and 2 "the entry is duplicated". Both come from one cause:
`selfTest` appends fixture entries to the live notices file, so once a real entry exists it looks for those files in the
fixture tree, and `projectos/core/src/search/hybrid.ts` collides with the fixture of the same name.

The coordinator reported this defect as known and being fixed, and told this phase not to loosen, edit or work around
it, so this branch rebases onto the fix. Nothing here changes that validator: it is outside this phase's `writePaths`.
**Re-run it after the rebase.** Until then this acceptance line is open.

## Pi / pi-mono provenance

Searched every upstream file used, ten in all, for `pi-mono`, `mario`, `zechner`, `earendil`, `@mariozechner`,
`copyright` and `spdx`: zero matches, and none imports a Pi package. No upstream file carries a notice of its own, so
there was none to keep. OpenClaw's `THIRD_PARTY_NOTICES.md` says portions were adapted from Pi and does not say which.
So this search does not rule Pi out, and each file carries `Also-Credits: pi-mono` as ADR-P1 §3 requires.

## What changed from upstream

The brief named six files. Four more were needed and are credited:

- `packages/normalization-core/src/cjk-chars.ts` and `utf16-slice.ts`, the chunker's budget helpers, in `textBudget.ts`.
- `packages/normalization-core/src/string-coerce.ts` and `string-normalization.ts`, one-line helpers inlined in
  `tokenize.ts` and `keywordQuery.ts`. They are trivial, and credit costs nothing.

Cut, each stated in that file's `CHANGED:` line: project-affinity ranking, exact-path tiers, media handling and LIKE
recall, because no ProjectOS index produces them; language keyword expansion; embedding input and provenance; all
`fs.stat` reads, so decay takes each source's recorded time from the caller. Upstream mutation became new objects.

**Two behaviour changes.** A token of underscores alone no longer reaches MATCH: `unicode61` reads it as an empty phrase,
and one empty phrase makes an AND match nothing. When a keyword row and a vector row name one chunk, the keyword
row's citation now wins, because upstream keeps the vector row's path with the keyword row's text.

Scripted comparison with upstream: the Unicode tables, `simpleCaseFold`, the CJK ranges and the MMR loop are identical.

## Findings worth knowing

- **The write tool decoded `\uXXXX` escapes** into literal characters in some files, including the SQLite mark table.
  The tests still passed, because the characters were right, but the source was unreviewable. A scratchpad script put
  the escapes back, and the upstream comparison then read identical. Only two upstream comments keep literal
  non-ASCII text.
- **`node:sqlite` cannot be imported statically under vitest.** Vite strips the `node:` prefix and fails on `sqlite`. It
  is loaded with `process.getBuiltinModule` when an index opens, which also keeps its experimental warning away from
  everything that does not search.
- **A mutation caught a weak rule.** `the-merge-ignores-the-door` survived on the first run, because `\bkeyword,` also
  matched `params.keyword,`. The rule now anchors on the line.
- **Removing a guard caught a missing test.** See the next section.

## Proofs

**Removing each guard from the real source.** A scratchpad harness, not committed, took 38 guards out of the source one
at a time, ran the core and agent search tests, and restored the file from memory. Positive control first: both suites
green with nothing removed. `git status` was clean of source changes afterwards.

Result: 37 killed, 1 survived. The survivor was `refused vectors reach the merge`: the door after ranking hid it, so a
refused vector row could still switch the weights. The test `a refused vector row changes no score and takes no slot`
was added and is pinned by PS-T. That guard, removed again, now fails it: 38 of 38.

**Validator.** `val-projectos-port-search1a: PASS (16 real files judged; 99 named mutations killed)`. A mutation counts
only if its own rule fires and no rule it did not declare. The real tree passing is the positive control.

**Suites.** Core: 33 files, 1323 tests, all pass, 137 of them new. Agent: `searchIndex.test.ts`, 45 of 45, through the
alias config below. `tsc --noEmit` is clean in core, and clean for `agent/src/search` and its test with the same alias.

**Validators that read a touched file.** A grep over the touched paths and over validators that scan source or test
directories found 57, plus `validate-no-secrets`, each in its own process: **57 of 58 PASS**. The one failure is the credit self-test above.
`val-cd-b4-production-ipc-provider1a` was killed by the batch's own 280 s limit while cargo built under load, and
passed alone in 2 min 55 s. That count is from the final code, before the commit that adds this file.

## Running the agent test

**Plain `npx vitest` in `projectos/agent` cannot see this phase's core.** The agent's `node_modules` junction resolves
`@projectos/core` to the `host-review-path1b` worktree, and a core build here does not change that. The agent test and
typecheck therefore ran with a scratchpad config aliasing `@projectos/core` to this worktree's
`projectos/core/src/index.ts`:

```js
export default {
  root: 'C:/dev/ProjectOS-worktrees/port-search1a/projectos/agent',
  resolve: { alias: { '@projectos/core': 'C:/dev/ProjectOS-worktrees/port-search1a/projectos/core/src/index.ts' } },
  test: { include: ['test/**/*.test.ts'], setupFiles: ['test/setup.ts'] },
};
```

After a merge and a core build in the main checkout, the plain command works there.

## Limits

- **A citation is as fresh as the last rebuild.** Nothing checks a file against its index at search time. Plan 3.3
  owns freshness.
- **A fence labels text. It does not make a model obey.** What protects ProjectOS is that model output reaches nothing
  without the kernel's gates. `renderUntrustedExcerpt` has no caller yet, and nor does the index: the context manager
  (plan 3.4) is the first, and `agent/src/index.ts` is outside this phase's write paths.
- **No secret scan of indexed text.** The walk's extension allowlist keeps `.env` and keys out, but a credential pasted
  into a `.md` file is indexed and returned as written.
- **Session search is a seam, not a feature.** The index takes a flattened transcript with a line map. The upstream code
  that flattens JSONL was not in scope, so no caller produces one yet.
- **CJK recall is weak.** `unicode61` reads a CJK run as one token. The trigram plan is ported and tested, and the index
  does not use it.
- **`node:sqlite` is experimental** in Node 24.14.1 and prints a warning when an index opens.
- **The validator pins text.** It proves the guards are present; the tests and the run below prove they work.
