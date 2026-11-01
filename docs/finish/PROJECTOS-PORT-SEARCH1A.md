# PROJECTOS-PORT-SEARCH1A — cited document and session search (C8, C10)

**Phase:** PROJECTOS-PORT-SEARCH1A, phase 2 of `docs/changes/delta_spec_V4_PORTS.md`, plan v1.31 (active).
**Branch:** `projectos-port-search1a`, worktree `C:/dev/ProjectOS-worktrees/port-search1a`, based on
`projectos-port-foundation1a`. Not pushed, not merged, phase not closed, no phase record created.
**State:** review round answered at the commits below. ECC CODE and ECC SECURITY have not re-reviewed it. Full
`validate-all` is the lead's and was not run here. `docs/06_Plan.md` is not edited. This branch was not rebased: the
lead rebases at stacking.

Nothing was run from a vendor folder, and `openbot-lower` was not opened.

## Delivered

| Item | Path | Result |
|---|---|---|
| Ported, pure | `projectos/core/src/search/{hybrid,mmr,temporalDecay,lexer,keywordQuery,markdownChunks,textBudget}.ts` | Seven files from ten upstream files, each credited |
| Original, pure | `projectos/core/src/search/{citation,citedSearch,chunkRecords,ftsMatch,sensitiveContent,untrustedExcerpt,index}.ts` | The refusals, the secret screen, the fence, the FTS5 compiler and the seam |
| Original, agent | `projectos/agent/src/search/{localIndex,documentSources,index}.ts` | The index on `node:sqlite` and FTS5, and the document walk |
| Exports | `projectos/core/src/index.ts` | One line |
| Notices | `THIRD_PARTY_NOTICES` | 10 entries, written by script from each file's own header |
| Tests | `projectos/core/test/search-{citation,retrieval,sensitive}.test.ts`, `projectos/agent/test/searchIndex.test.ts` | 203 core, 66 agent |
| Validator | `projectos/validators/val-projectos-port-search1a.cjs` | 30 rules plus PS-T, 113 text and 25 behavioural mutations, in both runners |

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| Every hit gives file and line range; a result with no source is refused | `admitSearchResult` is the door, and `CitedSearchHit` is a convention, not a brand. 33 refusal cases in core, and rows corrupted in a real database refused in the agent and in the validator's run, with the good row as positive control. PS-9, PS-11, PS-25 |
| The index is rebuildable and records its project | A deleted database rebuilds to identical answers. `project` is NOT NULL and a bound parameter, and no search spans projects. PS-10, PS-16, PS-17 |
| Indexed content is untrusted data, tested with an injection fixture | Forged citation, forged close, SQL and FTS5 syntax in one document. It changes no citation, creates no project and cannot close the fence. PS-13, PS-14, PS-15 |
| Credit header and notices entry on every ported file | PS-2 pins the exact upstream files; PS-4 runs the credit judgement on every file; PS-30 proves each is tracked. See the credit result below |
| Validator pin and named mutations, each killed by its own rule | 138 mutations. One counts only if its rule fires and no rule it did not declare |

## Credit result: red on this branch, green when stacked

On this branch the validator is foundation's first version, so its self-test still fails 11 times on fixtures: 9 "the
entry is stale" and 2 "the entry is duplicated". Foundation's current validator holds real entries out of the fixture.

**Rehearsed in a scratch repository, with no branch touched:** foundation's tree at `projectos-port-foundation1a`, this
branch's committed files laid over it by `git archive`, and this branch's entries under foundation's PORTED FILES:

```text
tracked search files 14 on disk 14
tsc core, clean checkout: exit 0
val-projectos-port-search1a: PASS (17 real files judged; 113 text and 25 behavioural mutations killed)
val-projectos-port-credit1a: PASS (17 real file(s) judged; 128 fixture and 58 record mutations killed)
```

**The same rehearsal on `8b1efbf3`, as the negative control,** fails as the reviews said: `tsc` exit 2 with TS2307 for
`./tokenize.js`, PS-1 for the missing file, PC-10 on `core/src/search/index.ts` and PC-23 on this validator. No rule was
loosened. The upstream name left the original barrel, and the validator now reads the Pi line from the notices file.

**After the lead's rebase, the conflict to expect is the end of `THIRD_PARTY_NOTICES`.** Keep foundation's text, with
this branch's entries under PORTED FILES. Then re-run the credit validator on the rebased tree.

## Pi / pi-mono provenance

Searched every upstream file used, ten in all, for `pi-mono`, `mario`, `zechner`, `earendil`, `@mariozechner`,
`copyright` and `spdx`: zero matches, and none imports a Pi package. No upstream file carries a notice of its own, so
there was none to keep. OpenClaw's `THIRD_PARTY_NOTICES.md` says portions were adapted from Pi and does not say which.
So this search does not rule Pi out, and each file carries `Also-Credits: pi-mono` as ADR-P1 §3 requires.

## What changed from upstream

The brief named six files. Four more were needed and are credited:

- `packages/normalization-core/src/cjk-chars.ts` and `utf16-slice.ts`, the chunker's budget helpers, in `textBudget.ts`.
- `packages/normalization-core/src/string-coerce.ts` and `string-normalization.ts`, one-line helpers inlined in
  `lexer.ts` and `keywordQuery.ts`. They are trivial, and credit costs nothing.

Cut, each stated in that file's `CHANGED:` line: project-affinity ranking, exact-path tiers, media handling and LIKE
recall, because no ProjectOS index produces them; language keyword expansion; the trigram lane; per-entry chunking;
embedding input and provenance; all `fs.stat` reads, so decay takes each source's recorded time from the caller. Upstream mutation became new objects.

**`lexer.ts` is upstream's `tokenize.ts`.** The header's `Source-Path` stays true. Spare-capacity selection in `hybrid.ts`
is written as filters, and keeps upstream's one row per line range, which the first version had dropped.

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

**Tests failed first.** Before any fix: 72 core and 32 agent tests failed, the agent count including the handle test.
After the fixes: core 34 files, 1389 tests, all pass, 203 of them search. Agent `searchIndex.test.ts`, 66 of 66, through
the alias config below. `tsc --noEmit` is clean in core, and clean for `agent/src/search` and its test with that alias.

**The code runs inside the validator.** Reviewers found the 99 mutations pinned text only. `behaviour` now copies this
phase's TypeScript into one scratch directory and runs it under Node's type stripping, against real SQLite and a real
tree: 31 probes. The unmutated copy passing all 31 is the positive control. Each of 25 `B` mutations changes the copy
and counts only when exactly its rule's probes fail. `a-row-with-no-path-is-served` also declares PS-11, because that
probe goes through the same door.

```text
val-projectos-port-search1a: PASS (17 real files judged; 113 text and 25 behavioural mutations killed)
```

**What the behavioural run found.** `a-rebuild-adds-to-the-old-rows` survived: with `deleteChunks` removed, FTS rows still
went, so search looked right while orphan rows piled up. The probe now counts both tables, and the agent test
`a rebuild leaves no row behind, in either table` is pinned. Two text mutations also survived until their pins were
added: `the-render-trusts-a-hand-made-hit` and `the-index-claims-the-stored-range`.

**First round, guards removed from the source.** A scratchpad harness took 38 guards out one at a time and ran the
tests: 37 killed. The survivor was `refused vectors reach the merge`, and its test was added. Those guards and strings
have since moved, so that harness was not re-run; the `B` mutations are the committed successor.

**Validators that read a touched file.** The same 57, plus `validate-no-secrets`, each in its own process at `a920a502`:
**57 of 58 PASS.** The one failure is the first-version credit self-test, which passes in the stack rehearsal above.

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

## Review round at `8b1efbf3`

**ECC CODE: BLOCK. ECC SECURITY: CONDITIONAL.** The findings reached this phase as one list from the coordinator, which
did not say which review raised each, so they are listed together. Neither review has seen the fixes.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | CRITICAL | `tokenize.ts` not committed: `.gitignore` `*token*` hides it, so a clean checkout fails TS2307 | Fixed. Renamed `lexer.ts`, with header, notices and validator updated. No `-f`, `.gitignore` untouched. Proved by `git archive`, with `8b1efbf3` as the negative control. PS-30 now refuses an untracked listed file |
| 2 | HIGH | No secret refusal: `credentials.txt` indexed and returned verbatim | Fixed in `sensitiveContent.ts`: PEM blocks, cloud and API token shapes, credential-style names. `chunkRecordsOf` is the boundary, so a caller past the walk meets it too. Reported in `skipped` by path and reason, with no secret text. Dot-segment refusal is there as well. PS-24 |
| 3 | MEDIUM | Citation covers the whole chunk and the text is cut to 700 characters | Fixed. `excerptOf` ends the citation at the last row shown. Each chunk keeps a source line per row, because remapped lines have gaps and one wide line can fill two rows. PS-25 |
| 4 | MEDIUM | A hostile file name lands in the fence header, and U+2028 and bidi marks pass `\p{Cc}` | Fixed. Path segments are an allowlist, and `=` is out too, so a name cannot forge `lines=`. `renderUntrustedExcerpt` checks again and refuses by a throw that shows nothing. False comment corrected. PS-14 |
| 5 | MEDIUM | `maxResults` -1 is an unbounded LIMIT and NaN throws raw SQLite | Fixed. Integer from 1, held at 50, otherwise refused as `invalid-max-results`. PS-28 |
| 6 | MEDIUM | Handle leak on a failed open, `close()` not idempotent, the test swallowed the error | Fixed, and the swallow is gone from the test. PS-27 |
| 7 | MEDIUM | No schema version | Fixed with `PRAGMA user_version`. On a mismatch the `search_*` tables are dropped by name in one transaction, and other tables stay. PS-26 |
| L | LOW | Unreadable file | Fixed. Goes to `skipped`; an unreadable directory too |
| L | LOW | Case-insensitive directory skip | Fixed, on every platform |
| L | LOW | Total-size cap | Fixed. 256 MiB by default, with what is left out reported as `total-size` |
| L | LOW | Dead `perEntry` and trigram lane, wrong `markdownChunks.ts` header | Removed and corrected. PS-29 keeps them out |
| L | LOW | `citedSearch.ts:72` undefined `mtimeMs` | Fixed. Only rows that know their time speak, and a keyword row's time wins |
| L | LOW | Record the `hybrid.ts` spare-selection change | Recorded in its `CHANGED:` line. Upstream's one row per range was missing, so it is restored and tested |
| L | LOW | Split `openSearchIndex` | Done: `ensureSchema`, `prepareStatements`, `writeProject`, `indexOver` |
| L | LOW | CRLF test | Added in core and agent |
| L | LOW | The fence notice names the closing id | Done |
| V | Foundation | PC-10 on `core/src/search/index.ts`, PC-23 on this validator | Fixed by removing the marks, with no rule loosened. Passes foundation's validator in the rehearsal |
| V | Review | The 99 mutations pinned text only | 31 probes and 25 behavioural mutations added |

## Carried, binding on tenant work

- **BM25 statistics leak between projects.** One FTS table serves every project in a file, so one project's documents
  shift another's scores. Per-project or per-tenant files are needed before tenant binding. `localIndex.ts` says so.
- **`documentSources.ts` and the `Date.now()` fallback bypass the System port.** `system.ts` has no `lstat`, and it is
  outside this phase's write paths.
- **`CitedSearchHit` is a convention, not branded.** `renderUntrustedExcerpt` re-checks a citation for this reason, and
  that check covers citations only: it says nothing about a hit's score or text.

## Limits

- **A citation is as fresh as the last rebuild.** Nothing checks a file against its index at search time. Plan 3.3
  owns freshness.
- **A fence labels text. It does not make a model obey.** What protects ProjectOS is that model output reaches nothing
  without the kernel's gates. `renderUntrustedExcerpt` has no caller yet, and nor does the index: the context manager
  (plan 3.4) is the first, and `agent/src/index.ts` is outside this phase's write paths.
- **The secret screen knows shapes and names.** A password in plain prose has neither, so it is indexed. A false positive
  skips a document and reports it. `docs/secrets-handling.md` would be skipped by name, for example.
- **One secret refuses a whole file,** so the rest of that document is not searchable until the secret is gone.
- **Session search is a seam, not a feature.** The index takes a flattened transcript with a line map. The upstream code
  that flattens JSONL was not in scope, so no caller produces one yet.
- **CJK recall is weak.** `unicode61` reads a CJK run as one token, and the trigram lane is cut. A CJK index needs it back.
- **`node:sqlite` is experimental** in Node 24.14.1 and prints a warning when an index opens.
- **A failed open frees its handle provably only on Windows.** That probe removes the file, and POSIX allows that with
  a handle open, so on another platform it passes either way. The vitest test has the same limit.
- **The behavioural copy is not the build.** It runs under type stripping, with imports rewritten and a local shim for
  `@projectos/core`. `tsc` and the suites cover the real build.
- **The first-round guard harness was not re-run,** as stated under Proofs.

## Commits

- `ced35750` feat(core): port the cited search core from OpenClaw
- `4111b8c8` feat(agent): local search index on node:sqlite with FTS5
- `b647eead` feat(validators): pin cited search with named mutations
- `e15d3642` test(core): a refused vector row changes no score and takes no slot
- `8b1efbf3` docs(finish): PROJECTOS-PORT-SEARCH1A evidence
- `75689e15` fix(core): answer the search review round
- `54faf516` fix(agent): answer the search review round
- `a920a502` feat(validators): run the search code, not only read it
- The evidence commit that adds this section.
