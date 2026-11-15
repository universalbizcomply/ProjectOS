# PROJECTOS-RESUME1A - a new worker continues a half-done phase from retrieved state

Plan v1.36, item 3.x (resume). Delta spec row 11 (approved rev 2). Depends on PROJECTOS-CONTEXT-MANAGER1A (closed). Branch
`projectos-resume1a`, based on `e269e5c5`. Core plus agent; no vendor source; no model call; no new dependency.

## What this is

A worker that ran out of time, or was killed, leaves a work record, a session and some changed files. The next worker is started with
no `--session` (nothing to rejoin; selection and `run.ts` are not touched), so it learns what the first one left through the context
manager's one file: fenced, untrusted, hash-named fence, capped, gated, ranked by provenance and recorded in the retrieval ledger like
every other stored item. Four items are added to that file for a run that continues an in-progress phase:

| Item id | What it holds | Where it comes from | Ranked as | Ledger `source` |
|---|---|---|---|---|
| `resume:cut-off-attempt` | state, last stop code, subject commit, session: CLOSED-vocabulary values only | the work record, read through a port | execution record (tier 2) | `working-tree` |
| `.projectops/execution/<session>.findings.json` | the cut-off attempt's findings, labelled "worker-authored, from a cut-off attempt" | that worker's own file, bounded and parsed | finding (tier 2) | `working-tree` |
| `.projectops/execution/<session>.evidence.json` | check ids and outcomes and a count, labelled the same way | the loop-written record in a worker-writable folder | execution record (tier 2) | `working-tree` |
| `resume:dirty-paths` | every uncommitted path and a sha256 of its content | `git status` and the files, read by the LOOP through its own ports | execution record (tier 2) | `loop-observed` |

A dirty path that the phase does not grant REFUSES the run before any worker, brief or context file exists, and the refusal says who must
do what. After HEAD moves, the cut-off attempt's items are marked `stale:head-moved` by the search index's own freshness rule.

## Existing code found (B1, before any code)

Everything below was read first and extended; nothing is a parallel copy except where named under Residuals.

- `agent/src/context/contextManager.ts` `assembleRunContext`: the one place stored text is gated, ranked, fenced, compacted and recorded.
  Extended by one optional request field, one header mark, one call and one merge into the existing ranking.
- `agent/src/context/contextRetrieval.ts` `ContextRead`: the shape of a stored item. Extended by two sources and one optional label.
- `agent/src/context/contextRun.ts` `prepareRunContext`: the loop's handle (record, place, retire). Passes the request through.
- `agent/src/context/contextStoreGuard.ts` `porcelainZPaths`: the null-separated `git status` parse (both sides of a rename). Reused as is.
- `agent/src/loop/workRecord.ts` `readWorkRecord`, `WORK_STATES`, `WORK_RECORD_REL`; `agent/src/loop/outcome.ts` `LoopStopCode`: the
  record and the closed vocabularies. The vocabularies are the loop's own and are handed to core as parameters; core keeps no copy.
- `core/src/memory/provenance.ts` `rankByProvenance`, `provenanceKindOfPath` (tiers: an execution record or a finding is tier 2, below a
  committed decision at tier 0 and approved or plan memory at tier 1): used by the manager, unchanged.
- `core/src/search/citation.ts` `citationFreshnessOf`, `citationFreshnessMarkOf`, `isCommitName`: the stale-mark machinery of
  MEMORY-PROVENANCE1A, used for the earlier attempt's items against the head the manager read now.
- `core/src/context/managerLedger.ts` (`CONTEXT_LEDGER_SOURCES`): the ledger vocabulary. Extended by two sources.
- `agent/src/loop/runner.ts`: `readWorkRecord` was already imported (the owner-wait report), `writeGrant.paths` is the phase's grant,
  `WORKER_TIMED_OUT` already ends an attempt as a stop. A retry is a new `projectos run` with a fresh session id (phase, head and an
  invocation discriminator), so nothing in the runner refuses it; the dirty records a timed-out run leaves are what could.
- `agent/src/commands/run.ts` `isFoldableRunRecord` (PROTECTED, not edited): the shapes of the records the loop writes. Mirrored (see
  Residuals) because it cannot be imported from `loop/` without a cycle.
- `agent/src/loop/workers.ts` `writePathGrants` / `judgeWritePath`: the forms a grant takes (`dir/**`, `./file`, `dir/file`).
- `val-projectos-work-record-not-authority1a` (unchanged, passes) and `val-projectos-context-manager1a` (see "CM-15" below).

## ADDED / MODIFIED / PROTECTED

ADDED: `core/src/context/resumePaths.ts`, `resumeRecord.ts`, `resumeRender.ts`; `agent/src/context/resumeState.ts`; tests
`core/test/context-resume.test.ts`, `agent/test/resumeState.test.ts`, `agent/test/resumeRun.test.ts`,
`agent/test/support/resumeLoopWorld.ts`; `validators/val-projectos-resume1a.cjs`; this document.

MODIFIED (existing files touched, for the merge; every edit is minimal and behaviour is identical when no resume state exists):

| File | Edit |
|---|---|
| `projectos/agent/src/context/contextManager.ts` | `import` of `resumeReadsOf`; optional `resume` on `RunContextRequest`; one header mark for the label; one call after the decisions are readable; the resumed reads and failures merged into the existing ranking and withheld list |
| `projectos/agent/src/context/contextRetrieval.ts` | `ContextRead.source` widened by `working-tree` and `loop-observed`; optional `note` |
| `projectos/agent/src/context/contextRun.ts` | optional `resume` on `PrepareRunContextInput`, passed to the manager |
| `projectos/agent/src/loop/runner.ts` | one `resume: { ... }` line in the existing `prepareRunContext` call (3 lines with its comment) |
| `projectos/core/src/context/managerLedger.ts` | `CONTEXT_LEDGER_SOURCES` gains `working-tree`, `loop-observed` (one line) |
| `projectos/core/src/index.ts` | three barrel lines |
| `projectos/validators/validate-all.cjs`, `projectos/speed/cached-runner.cjs` | one registration each, immediately before `val-projectos-connector-contract1a`, after `val-projectos-context-manager1a` |

PROTECTED (untouched): `agent/src/commands/run.ts`, `loop/selection.ts`, `loop/workRecord.ts`, `taskEnvelope.ts`, `actionRegistry.ts`,
`tenant.ts`, every authority record, `docs/00_Baseline_State.md` section 4, `docs/06_Plan.md`, `val-projectos-context-manager1a.cjs`,
`val-projectos-work-record-not-authority1a.cjs`.

**PROTECTED files.** `git diff --stat` of the staged phase (alias test configs are not committed):

```
 docs/finish/PROJECTOS-RESUME1A.md               |  (this file)
 projectos/agent/src/context/contextManager.ts   |  11 +-
 projectos/agent/src/context/contextRetrieval.ts |   5 +-
 projectos/agent/src/context/contextRun.ts       |   5 +-
 projectos/agent/src/context/resumeState.ts      | 417 +++
 projectos/agent/src/loop/runner.ts              |   3 +
 projectos/agent/test/resumeRun.test.ts          | 282 +++
 projectos/agent/test/resumeState.test.ts        | 478 +++
 projectos/agent/test/support/resumeLoopWorld.ts | 203 +++
 projectos/core/src/context/managerLedger.ts     |   2 +-
 projectos/core/src/context/resumePaths.ts       |  96 +++
 projectos/core/src/context/resumeRecord.ts      | 110 +++
 projectos/core/src/context/resumeRender.ts      | 128 +++
 projectos/core/src/index.ts                     |   3 +
 projectos/core/test/context-resume.test.ts      | 238 +++
 projectos/speed/cached-runner.cjs               |   2 +
 projectos/validators/val-projectos-resume1a.cjs | 593 +++
 projectos/validators/validate-all.cjs           |   2 +
```

`git diff --stat e269e5c5 -- projectos/agent/src/commands/run.ts projectos/agent/src/loop/selection.ts projectos/agent/src/loop/workRecord.ts
projectos/core/src/taskEnvelope.ts projectos/core/src/actionRegistry.ts projectos/core/src/tenant.ts docs/00_Baseline_State.md docs/06_Plan.md`
prints nothing.

## Rules, tests, mutations

Each acceptance criterion is a rule of `val-projectos-resume1a` (14 rules, 122 named mutations; a mutation counts only when its own
rule fires, and it must fire exactly the rules its row names). Mutations are named after the body of the rule they break.

| Criterion | Rule | Test (file: title) | Named mutations |
|---|---|---|---|
| free text never reaches the file, tested with a planted instruction | RS-1 | `core/test/context-resume.test.ts`: never carries a free-text field: a planted instruction in every one of them appears nowhere in the result or its rendering; `agent/test/resumeState.test.ts`: a planted instruction in every free-text field of the record is in no part of the file, the ledger body or the withheld list | 13 (a free-text field is read, a stop code or state outside the list is accepted, a record with a getter is read, ...) |
| findings labelled worker-authored, never above a decision | RS-2 | `resumeState.test.ts`: labels them as a worker authored them in a cut-off attempt; ranks them as a finding and an execution record, below a committed decision and approved memory, whatever they say; shows no finding in the committed section | 9 (a finding claims to be a committed decision, the label is gone, a resumed item skips the ranking, ...) |
| dirty path outside writePaths refuses; inside is listed with its hash | RS-3 | `resumeState.test.ts`: lists a path inside the write paths with the hash of its content; refuses with a code and a fix that names the owner; the shape table (climb, root, drive, backslash, stream, case, width); refuses a granted path that is a link, or sits under one; `resumeRun.test.ts`: stops with a named code and a fix, starts no worker...; a real repository (hash of real bytes, junction refused) | 24 |
| the list and hashes are the loop's own observation | RS-4 | `resumeState.test.ts`: takes the list from git and the hash from the files, and never from the record, the findings or the evidence | 6 |
| after HEAD moves, earlier evidence is stale | RS-5 | `resumeState.test.ts`: marks them stale once HEAD is another commit...; judges the evidence at the commit it was collected at; `resumeRun.test.ts`: marks the earlier state stale once HEAD has moved | 5 |
| a retry after a recorded worker timeout at the same HEAD is admitted | RS-6 | `resumeRun.test.ts`: runs a second worker, started fresh with no session, and hands it what the timed-out attempt left (a real timed-out first run, then the retry); a context file a killed earlier run left does not refuse the next run | 11 |
| work record stays non-authority; selection and run.ts unchanged | RS-7 | `resumeRun.test.ts`: a record that says the gate is approved and a commit may be made changes no stop, no attempt and no call; never writes the work record itself; a record for another project or phase shows nothing. `val-projectos-work-record-not-authority1a` passes unchanged. | 13 |
| stored text is gated, ranked, fenced, capped; no model, no write | RS-8 | `resumeState.test.ts`: withholds a finding that is a threat or a credential by code; hidden text; the hostile and the large-but-valid cases | 9 |
| every resumed item is named in the ledger | RS-9 | `resumeRun.test.ts`: names every resumed item in the ledger and in the run evidence, by id and hash | 6 |
| bound to the checkout, read after it | RS-10 | `resumeState.test.ts`: a forged envelope for another project reads no work record, asks git nothing and refuses | 5 |
| bounded reads | RS-11 | `resumeState.test.ts`: a record file that is a link, a directory or too large is not read; a thousand granted paths; 262 KB hostile input | 9 |
| files, tracking, core purity | RS-12 | (validator) | 8 |
| registered | RS-13 | (validator) | 2 |
| proofs present | RS-14 | (validator) | 2 |

## Red run (failing test first)

The tests were written against the manager and runner seams first. With the four existing-file edits reverted
(`git apply -R` of the six modified source files) and the four new source files moved out, the same test files gave:

- `core/test/context-resume.test.ts`: file failed to load (no `resumePaths`, `resumeRecord`, `resumeRender`): 0 tests ran.
- `agent/test/resumeState.test.ts`: file failed to load (no `resumeState`): 0 tests ran.
- `agent/test/resumeRun.test.ts`: 8 failed, 6 passed (the three retry tests, the refusal test, the listing test and the three real
  repository tests failed; the "nothing changes when there is no record" tests passed, as they must).
- `val-projectos-resume1a`: 4 errors (the four new source files missing).

The files were then restored and every run below was made on the restored tree.

## Checks and counts (read from the output, not from this document)

Agent tests were run through an alias config (vitest `resolve.alias` and a `tsconfig` `paths` entry, both placed temporarily inside
`projectos/agent`, deleted before the commit) because the agent's `@projectos/core` junction points at another worktree.

| Check | Result |
|---|---|
| core `npx vitest run` | 112 files, 4,765 tests passed |
| core `npm run -s build`, `tsc --noEmit` | clean |
| agent typecheck (alias), agent typecheck of the tests (alias) | clean |
| agent `npx vitest run` (alias) | 132 files: 131 passed, 1 failed to load; 4,074 tests passed, 10 skipped. The one file is `tenantSidecar.test.ts`, which runs `tsc -p agent/tsconfig.json` against the agent's `@projectos/core` junction (another worktree) and fails only under the alias, as the brief says. The 67 resume tests in `resumeState.test.ts` and `resumeRun.test.ts` are in the passing set, with the existing 744-test context and loop subset |
| core browser load (esbuild, platform browser, tree-shaking off, evaluated with no Node global; the way `coreBrowserLoad.test.ts` does) | loads; `grep "from 'node:'" core/src/context/resume*.ts` lists nothing |
| `val-projectos-resume1a` | PASS (14 rules; 122 named mutations killed); `run()` is synchronous and returns an array |
| `val-projectos-work-record-not-authority1a` | PASS, unchanged |
| `val-projectos-context-manager1a` | 285 mutations killed; its CM-15 fails by design, see below |
| `val-projectos-boot-continue1a`, `-agent-workforce1a`, `-kernel-followup1a`, `-kernel-platform-stop1a`, `-kernel-role-review1a`, `-technical-continuation1a`, `-tenant-contract1a`, `-worker-lifecycle-bounded1a` | PASS |
| `val-projectos-memory-provenance1a`, `-memory-stores1a`, `-port-context1a`, `-port-memory1a`, `-port-skills1a`, `-port-approvals1a`, `-port-search1a`, `-port-mcp1a`, `-port-providers1a`, `-port-research1a`, `-port-credit1a` | PASS |
| `validate-no-secrets` | PASS |

`validate-all` was not run (the lead runs it once on the stack).

### CM-15, for the lead

`val-projectos-context-manager1a` CM-15 pins `val-projectos-connector-contract1a` as its immediate successor. This phase registers
`val-projectos-resume1a` there, as instructed, so CM-15 fails on this branch and only CM-15. With the one-line pin below applied to a
scratch copy, the validator passes (21 rules, 285 mutations killed), so no other CM rule is affected by the files this phase touches:

```
-      else if (names[at - 1] !== "val-projectos-memory-provenance1a" || names[at + 1] !== "val-projectos-connector-contract1a") E("CM-15", ...
+      else if (names[at - 1] !== "val-projectos-memory-provenance1a" || names[at + 1] !== "val-projectos-resume1a") E("CM-15", ...
```

When the sibling's registration is merged between them, the pin names whichever of the two is first. `val-projectos-resume1a` RS-13
pins only "immediately before `connector-contract1a`, after `context-manager1a`", so the sibling must sit before this validator or
RS-13's neighbour check must be widened at the merge.

## B9 - Converge

Unbuilt: nothing the spec lists is unbuilt. Not built, by design: no resume for a run with no admitted envelope (the manager is keyed on
the envelope) or for a dry run (reads and writes nothing); only the last recorded attempt's findings and evidence (the work record names
one session).

Drift: the spec says the dirty paths are "hashed through the injected git/fs ports"; they are listed through the git port and hashed
through the fs port (text, not raw bytes; see Residuals). The spec's "work record ... closed-vocabulary fields only (state,
lastStopCode, subjectCommit)" gains a fourth closed value, the session name, used only to find that attempt's own findings and evidence
and never shown as text beyond a safe-name check.

PROTECTED untouched: `git diff --stat` above, and the empty diff for the protected list.

## Behaviour that changes, stated plainly

A run with an admitted envelope on a phase whose work record says an attempt was started and not finished (any state except `QUEUED`,
`COMPLETE`, `AWAITING_GATE`, `GATE_APPROVED`, `WAITING_OWNER`) now refuses when `git status` shows a path outside the phase's write paths
that is not a record the loop wrote. This is the spec. It means the owner's unrelated uncommitted edits block a resume of an unfinished
phase until committed, stashed or removed; the refusal names each path and the fix. Owner-wait and gate states keep exactly the
behaviour they had.

## Residuals

1. `isFoldableRunRecord` (protected `run.ts`) is mirrored, not imported, in `core/src/context/resumePaths.ts`: execution records
   `<session>.(brief|session|evidence|invocation|findings|effects|reviewer).json` and a killed run's `<session>.context.md`, this
   phase's own record and the work record. Gatekeeper decision, thread and ledger records, memory proposals under
   `.projectops/memory`, and the plan's state-tail files are NOT listed as loop records, so a resume after a run that wrote them refuses
   naming them until the owner commits them. A later phase may export one predicate from a module `loop/` can import.
2. The findings and evidence are parsed here by a tolerant reader (closed severity list, bounded lengths, check ids by shape) rather than
   by `readFindings`, which needs a whole `System`. The two can drift.
3. A hash is of the file as the fs port reads it (UTF-8 text): deterministic, but not git's blob id for a binary file. A file over 1 MiB,
   or past a 32 MiB budget, is listed with no hash and says why.
4. The dirty list is one ledger item named by id and the hash of its whole text, not one item per path. The text itself is not stored (the
   file is retired), so the ledger proves what was shown by hash, not by list. It is observed once at the start of the run: a later
   correction attempt is shown the same list.
5. Only the single session the work record names is read; earlier cut-offs are not.
6. Observation and read are not atomic (a stat, then a read): a file replaced between them can be hashed as the new content. The store
   guard still judges memory and skill stores around each dispatch.
7. The work record can be rewritten by a worker (it is in the project tree); that is why only closed values are read from it, they are
   labelled unverified, and nothing the record says selects, advances or widens anything. A forged `EXECUTING` record can make a run
   refuse on a dirty path (a nuisance, not an authority) and can show a worker a fake "last stop".
8. No ECC security review was run by this builder (the lead dispatches it); the validator's mutations are this phase's own proof.
