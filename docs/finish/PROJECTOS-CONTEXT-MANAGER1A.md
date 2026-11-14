# PROJECTOS-CONTEXT-MANAGER1A: the context manager, retrieval keyed on the admitted run envelope, handed over by reference

**Phase:** PROJECTOS-CONTEXT-MANAGER1A, plan v1.36 item 3.4 (Stage 3), row 9 of `docs/changes/delta_spec.md` (revision 2, approved).
**Branch:** `projectos-context-manager1a`, worktree `C:/dev/ProjectOS-worktrees/context-manager1a-v136`, based on `c71adc16`.
Not pushed, not merged, phase not closed, `docs/06_Plan.md` not edited. `validate-all` is the lead's and was not run here.

**State:** built and self-checked. No review has seen it yet (ECC SECURITY and Agency `multi-agent-systems-architect` are the two this phase owes).
This is the first phase that wires stored context into the run loop, so it is the most security-sensitive of Stage 3. Everything below is what was run
and seen in this worktree; where a check could not run as written, it says so.

## What was asked and what exists

A `projectos run --execute` now hands its worker the notes, decisions and search hits stored for **its own project**, by reference: the brief names
one file, the runner writes that file for each dispatch from its own copy, removes it the moment the worker returns, and records everything shown in a
loop-written ledger and in the run evidence. With no admitted run envelope nothing is retrieved and the run behaves exactly as it did. `run.ts`
changes by one option and the import it needs, and nothing else.

## Existing code found (B1, before any change)

| Where | What it was | Used how |
|---|---|---|
| `core/src/context/{accounting,compaction,thread,turn,prompt,fence,draftScreen,provenance,window,estimate}.ts` (PORT-CONTEXT1A) | Immutable accounts, the plan and draft rules, the thread with approved decisions, the fence, the screen, the sealed record | **Called, unchanged**: `openContextAccount`, `contextPressure`, `planCompaction`, `applyCompaction`, `noteContextCompaction`, `noteCompactionRefused`, `withApprovedDecision`, `renderContextPrompt`, `renderedTurnText`, `summaryCostTokens`. The manager is the one non-core caller (PX-17 now says so) |
| `core/src/memory/{provenance,committedBytes,committedProof,memoryShapes,threatScan,store,proposal,directWrite}.ts` (PROVENANCE1A, STORES1A) | Ranking with proofs minted by a committed read, the judge of committed bytes, the one-read record, the strict threat scan, `checkNoDirectStoreWrites` | **Called, unchanged**: `rankByProvenance`, `isCommittedProof`, `plainRecordOf`/`plainListOf`, `scanForThreats`, `memoryEntryHash`, `isMemoryEntryProvenance`, `checkNoDirectStoreWrites` |
| `agent/src/memory/{committedBytes,memoryFiles,storeDigest}.ts` | The committed reader on a git port and a file-system port, `readMemoryStore`, `snapshotMemoryStores` / `checkStoreUnchanged` | **Called, unchanged** (the reader, the store read, the digest). The wiring notes in `PROJECTOS-MEMORY-STORES1A.md` and `PROJECTOS-MEMORY-PROVENANCE1A.md` ("Out-of-path edits needed") are what this phase carries out |
| `agent/src/search/{projectIndex,localIndex,ports,nodeHost}.ts` (STORES1A) | One index file per tenant and project, the clock, git and file-system ports | **Called, unchanged**: `openProjectSearchIndex`, `projectIndexLocation`, `gitRunnerOver`, `searchClockOver`, `searchHeadOver`, `documentFsOver`, `nodeEntryProbe` |
| `core/src/search/{citation,untrustedExcerpt}.ts` | The citation shape, its freshness mark | Read: `citationFreshnessOfValue`, `citationFreshnessMarkOf` |
| `core/src/approvals/taint.ts` (PORT-APPROVALS1A) | "A tool result taints a run unless the kernel names it an own-state confined read" | **Called**: `toolResultTaintsRun` with an empty own-state list, from one file |
| `core/src/taskEnvelope.ts`, `core/src/tenant.ts` | `parseEnvelope` (R1), `envelopeExpired`, `ENVELOPE_FIELDS`, `isTenantId`, `isProjectId`, `DOMAINS` | Read-only (PROTECTED, untouched). `admittedRunEnvelopeOf` is `governedContext.ts:662`, called from `run.ts` and defined nowhere new |
| `agent/src/loop/{runner,brief,session,candidateIdentity,observation}.ts`, `loop/adapters/claudeCodeCli.ts` | The loop, the brief and its provenance walk, the record paths, the candidate's changed-path set, the worker instruction | **Extended** (runner, brief, the one adapter, additively). `session.ts`, `candidateIdentity.ts`, `observation.ts`, `verification.ts` are not touched |
| `agent/src/loop/adapters/codexCli.ts` | A reviewer kind only; start and rejoin refuse | **Not changed**: an independent reviewer judges the candidate, and gets no stored notes |
| `projectos/security/action-registry.json` | `context-write` (P2, local) is registered for "the loop writing a session's fenced context file" | Read: the file this phase writes is exactly that action; no new entry, no crossing is minted |

## What was built

| Item | Path | Result |
|---|---|---|
| The run key | `core/src/context/managerKey.ts` | `contextRetrievalKeyOf(envelope, isProxy, nowIso)`: tenant, domain and project of the admitted run envelope, or the reason there is none. The envelope is read once into a frozen copy (getter, symbol key, prototype key, unlisted field refused), a Proxy is refused by an injected port that must answer exactly `false`, `parseEnvelope` (R1) must pass, the action must be `run-start`, the scope must name `project:<its own project>`, and it must not have expired. No envelope is no key |
| The gate | `core/src/context/managerItems.ts` | `gateContextItemText`: a text over 256 KiB is not read; the excerpt (6,000 characters AND 16,000 bytes, cut between code points, marked as an excerpt) is scanned with the strict threat scan (hidden text named apart from a threat) and asked of a credential screen that must answer exactly `false` (and of core's own vocabulary); the hash is of the whole text. A refusal is a code and quotes nothing |
| The ledger rules | `core/src/context/managerLedger.ts` | `sealContextLedgerEntry`, `contextLedgerProblem`, `parseContextLedgerEntry`, file names: an entry names whose run, the commit, each item shown (path, whole-text hash, rank, tier, proof held, excerpt), each item withheld by closed code, what was left out, the decisions held, taint, the hash of the file placed. Numbered, chained by the hash of the entry before, hashed whole, read once into a frozen copy, every list bounded |
| Ports | `agent/src/context/contextPorts.ts` | `ContextManagerPorts` (git, working-tree reads, clock, credential screen, Proxy test, the memory provenance read, the index opener, registry, window, drafter); `portsProblem` refuses a missing one; `nodeContextPorts` builds the real ones and opens an index only if its file already exists |
| Retrieval | `agent/src/context/contextRetrieval.ts` | The only reader of memory: approved memory from committed bytes (entries come from HEAD, the owner's approval record from the store's provenance file), the approved decisions held apart, the committed decisions of the phases this one depends on, plan memory, and at most five index hits for the key's own tenant and project (a hit that names another project is dropped and recorded) |
| The manager | `agent/src/context/contextManager.ts` | `assembleRunContext`: key, head, retrieval, gate, `rankByProvenance` against the current head, a thread (items lowest provenance first), deterministic compaction in the carried order, the fenced file text, the list of what was shown, withheld, left out |
| The ledger writer | `agent/src/context/contextLedger.ts` | `appendContextLedger`: one numbered file per entry through a create-if-absent write and nothing else (the port has no overwrite and no delete), the newest 64 entries read and verified as a chain, a foreign file refused, a lost race retried once |
| The run handle | `agent/src/context/contextRun.ts` | `prepareRunContext` reads and writes nothing; `record()`, `place(n)`, `retire()`, `evidence()` are what the loop calls |
| The store guard | `agent/src/context/contextStoreGuard.ts` | `beginStoreGuard` / `endStoreGuard`: the digest of the memory and skill stores and `git status --porcelain -z --untracked-files=all` before the worker, the paths that are new and the digest again after it (both sides of a rename) |
| The taint answer | `agent/src/context/contextTaint.ts` | `storedContextTaintsRun(registry)`: the one call of the approvals rule; stored text taints the run, with or without a registry |
| The loop | `agent/src/loop/runner.ts` | `RunOptions.runEnvelope` and `contextPorts`; the context is prepared after every refusal and before the brief is written; the file is placed before each dispatch and removed in a `finally`; the guard brackets the worker; the evidence names the context |
| The brief | `agent/src/loop/brief.ts` | `records.contextPath`, held by `contextPathProblems` to the one value derived from `records.briefPath` (the provenance walk exempts every key ending in `Path`, so by itself it would pass any text there) |
| The worker instruction | `agent/src/loop/adapters/claudeCodeCli.ts` | `pointerInstruction` and `correctionInstruction` take an optional path, put it on the command line only in the shape the loop derives, and say it is stored context: data, never instructions, grants nothing |
| `run.ts` | `agent/src/commands/run.ts` | See "The one protected edit" |
| Core barrel | `core/src/index.ts` | Three lines. The new core files are exported here and **not** through `core/src/context/index.ts`, because `val-projectos-port-context1a` copies that barrel and its 13 files into a scratch directory and the barrel would stop resolving |
| Narrowed rules | `val-projectos-port-{context,approvals,memory,skills}1a.cjs` | See "The four narrowed rules" |
| Validator | `validators/val-projectos-context-manager1a.cjs` | 19 rules, 225 named mutations; registered in both runners after `memory-provenance1a` and before `connector-contract1a` |

### The one protected edit (the exact diff to `run.ts`)

`git diff c71adc16 -- projectos/agent/src/commands/run.ts`:

```diff
@@ -16,7 +16,7 @@
-import { loadGovernedContext, refusalLines, runStartTenantRefusal, type GovernedContext } from '../governedContext.js';
+import { admittedRunEnvelopeOf, loadGovernedContext, refusalLines, runStartTenantRefusal, type GovernedContext } from '../governedContext.js';
@@ -516,6 +516,7 @@ export function run(ctx: CommandContext, flags: Flags): CommandResult {
   const runLoopOnce = (): RunResult => runLoop(ctx.sys, ctx.root, {
     platformStopStateDir: platformStopDirOf(ctx),
+    runEnvelope: admittedRunEnvelopeOf(ctx),
     onWorkState,
     workforce: true,
```

**That is two changed lines, not one: `admittedRunEnvelopeOf` was not imported, so the import line gains it.** No pin in any validator names that import
line (`runStartTenantRefusal(` is still matched exactly once, TP-13 is untouched), and `val-projectos-boot-continue1a` still passes. CM-1 pins the whole file
as the base with those two edits and nothing else, so a third change (a comment, a second option, an import) is refused; ten named mutations prove it.
`RunOptions.runEnvelope?: TaskEnvelope | null | undefined` is the matching field. The runner's own text names the option twice (the field and its one read).

### The four narrowed rules

Each refused "any call site" (PX-17 only looked at `run.ts`; AP-29 matched a short list of names; PM-16 and PK-16 looked only inside the port's own files),
and each now says "no call site but the ones this phase adds", naming the file and the name:

| Rule | Allowed, and nothing else | What else it now refuses | Named mutations that add another call site |
|---|---|---|---|
| PX-17 (`port-context1a`) | `agent/src/context/contextManager.ts` may name the 14 rules that run a context rule | every other product source (all of `projectos/*/src`, 400-plus files, read once and remembered by text) | `the-runner-...`, `another-agent-file-...`, `the-core-barrel-...`, `the-context-ports-...`, `the-context-ledger-...`, `a-manager-core-file-...`, and the existing `run-loop-wired-in` |
| AP-29 (`port-approvals1a`) | `agent/src/context/contextTaint.ts` may name `toolResultTaintsRun` and no other approvals rule | the name list also gained `isRunTainted`, `freshApprovalNeeded`, `actionCouldBeSteered`, `RunGuardRefused`, `CHECK_SOURCES`, `MAX_APPROVAL_LIFETIME_MS`, which the old list did not catch | `a-second-file-asks-whether-the-run-is-tainted`, `the-run-loop-names-the-taint-question`, `the-one-call-site-calls-another-rule`, `the-one-call-site-is-gone` |
| PM-16 (`port-memory1a`) | `agent/src/context/contextPorts.ts` may call `readMemoryStore` and no other memory entry point | every product file outside `core/src/memory` and `agent/src/memory`, for a CALL of any of ten entry points (a method of another object is not one) | `the-runner-reads-the-store`, `another-product-file-loads-the-memory-block`, `another-product-file-proposes-a-write`, `the-one-call-site-writes-the-store`, `the-one-call-site-proposes`, `the-retrieval-reads-the-store-around-the-port`, `the-one-call-site-no-longer-reads` |
| PK-16 (`port-skills1a`) | **Nothing is added.** The one existing site, `agent/src/memory/proposalDoor.ts` (STORES1A), may call `listPendingSkillProposals` and `proposeSkill` | every other product file, for a call of any of seven skill entry points | `the-runner-loads-a-skill`, `another-product-file-proposes-a-skill`, `another-product-file-promotes-a-skill`, `the-context-manager-loads-a-skill`, `the-context-ports-list-pending-skills`, `the-proposal-door-promotes`, `the-proposal-door-no-longer-proposes` |

Nothing else in the four was loosened: every pre-existing rule, scenario and mutation is unchanged and still killed. CM-19 pins the four allow-lists and that
each refusal still exists, with eight mutations. The skills rule stays a "none added": skill loading is `PROJECTOS-SKILLS-ADOPT1A`'s, and it moves PK-16 with it.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| The diff to `run.ts` is exactly the `runEnvelope` option, pinned by the validator | CM-1 (`git show c71adc16:` text, expected text computed, equality), ten mutations. The two changed lines are above |
| Retrieval uses the admitted envelope's tenant, domain and project only; another project's or tenant's memory is never retrieved, tested with two projects | `core/test/context-manager-key.test.ts` (17: no envelope, malformed, not a run, wrong scope, expired, getter, prototype key, Proxy port fails closed, a refusal never quotes). `agent/test/contextRetrieval.test.ts` "two projects get two index files, and one project never reads the other": **three real SQLite files** (two projects of one tenant, one project of another), each retrieval sees its own text and none of the others, and an owner with no index sees nothing. "drops a hit that names another project, whatever the index returned". `agent/test/contextManager.test.ts` "opens the index under the envelope's own tenant and project, whatever else the request carries" and "keys two projects apart". CM-2 |
| `records.contextPath` passes the brief provenance walk, and the context file never counts toward the candidate, tested | `agent/test/loopBriefContext.test.ts` (nine spoofed values refused, five non-strings, the derived path passes the walk, an absent path is no problem). `agent/test/loopContext.test.ts` "removes the file as soon as the worker returns: it is never in what the checks judge, and never in the candidate": the fake `git status` is worked out from the live files, so a file left behind would be listed; every status asked after the first dispatch is searched for `.context.md`, and so is the evidence's `changedFiles`. "places the file again for every correction, from its own copy" (a worker that rewrote it finds it restored). CM-8 |
| Approved decisions are always loaded; compaction refuses a partial summary and stops on overLimit; no model is called | `contextManager.test.ts`: "holds each approved decision in its own fenced block", "keeps them when compaction runs", "a decision that a screen would block is still held, and shown as a placeholder"; "refuses a summary that was cut short, and installs nothing" (four offers: incomplete, `length`, `max_tokens`, no answer); "refuses a summary the screen refuses"; "stops on overLimit: when what must stay will not fit, no file is made"; "a summary over its budget is refused by its own code"; "calls no model" (a trapped `fetch` is never called); "is deterministic" (`Date.now` and `Math.random` spied, never called). CM-5, CM-6 |
| The run evidence names every stored item the worker was shown, tested | `contextRun.test.ts` "names the items with their paths, content hashes and provenance rank" (and the withheld, the omitted, the decisions, the file hash, the ledger entry, the attempts placed) and `loopContext.test.ts` "names every stored item the worker was shown in the run evidence: path, hash, rank" (read back from the evidence the runner wrote). CM-9 |
| PX-17, AP-29, PM-16 and PK-16 still refuse any call site other than the ones this phase adds, each with a named mutation | The table above, and CM-19 |
| Validator pin and named mutations, each named after the rule body and killed by its own rule | The mutation table |

## Failing test first, with the red run captured

Every new rule's test was written against a stub that exported the right names and threw (`not built`); the first run was red before any implementation.
The names are in the appendix, grouped by file.

| Test file | Red run (against the stub) |
|---|---|
| `core/test/context-manager-key.test.ts` | 17 failed |
| `core/test/context-manager-items.test.ts` | 25 failed |
| `core/test/context-manager-ledger.test.ts` | 29 failed |
| `agent/test/contextRetrieval.test.ts` | 21 failed |
| `agent/test/contextManager.test.ts` | 27 failed |
| `agent/test/contextLedger.test.ts` | 10 failed |
| `agent/test/contextStoreGuard.test.ts` | 18 failed |
| `agent/test/contextRun.test.ts` | 15 failed |
| `agent/test/loopContext.test.ts` | 14 failed, 1 passed |
| `agent/test/loopBriefContext.test.ts` | 15 failed, 7 passed |
| **Total** | **191 failed, 8 passed (the premises)** |

**What did not fail first, and says so.** Eight tests passed against the stub because their premise was true before the change: "the file is removed as soon as the worker
returns" in `loopContext.test.ts` (a file that was never written is not there), and in `loopBriefContext.test.ts` the three that pin what an absent path and the
derived path do (`{ ...records }` already carried any key, and the walk already exempts `Path` keys, which is precisely why the refusals are red) and the instruction and adapter tests that compare with the old one-argument form. Three of those adapter tests were then **strengthened** (they now also require the path in the command line) after
this run, so they are red now; the table is the run as it was taken. Two tests were added after the run and were not red first: "asks for a hit on any term, and only the first
thousand characters" (the first version asked for every term, which finds nothing for a long description: caught by reading `keywordQuery.ts`) and "takes bounded time on hostile text of 60,000
characters" in the manager. The validator is not red-first: its proof is the mutations.

## Mutations

Each mutation is applied to the real source text and counts only when exactly the rule it names fires (and the rules it declares). Mutations are named after the BODY of the rule.
The unmutated tree passing every pin is the positive control. They are text mutations: this validator does not load the agent code (it imports `@projectos/core`, SQLite and
`node:util`); the behaviour is proved by the suites above, which run it for real.

| Rule | Says | Mutations |
|---|---|---|
| CM-1 | run.ts changes by more than the one option | 10 |
| CM-2 | retrieval is not keyed on the admitted envelope | 19 |
| CM-3 | a stored text is shown ungated | 21 |
| CM-4 | items are not ranked by provenance | 12 |
| CM-5 | an approved decision can be dropped | 8 |
| CM-6 | compaction is not deterministic selection | 16 |
| CM-7 | the retrieval is not recorded by the loop | 20 |
| CM-8 | the context file is a candidate, or its path is free | 17 |
| CM-9 | the evidence does not name what was shown | 19 |
| CM-10 | a direct write to memory or skills passes | 13 |
| CM-11 | a second caller or a write path | 15 |
| CM-12 | core is not pure | 7 |
| CM-13 | the agent reaches around its ports | 12 |
| CM-14 | stored text is read as authority | 8 |
| CM-15 | not registered | 6 |
| CM-16 | proof weakened | 7 |
| CM-17 | a file has no statement of origin | 4 |
| CM-18 | a file is not tracked | 4 |
| CM-19 | a narrowed rule loosened | 8 |
| **Total** | | **225** |

The four narrowed validators went from 320 to 326 mutations (`port-context1a`), 64 to 68 text (`port-approvals1a`), 199 to 206 (`port-memory1a`) and 440 to 447 (`port-skills1a`).

## Checks, with counts (read from the exit codes, not from a doc)

| Check | Result |
|---|---|
| core `npm run -s build` | exit 0 |
| core `npx vitest run` | 111 files, 4,719 tests, all pass |
| core `src` and the three new core tests type-checked (temporary tsconfig) | exit 0, no output |
| agent `src` type-checked through the **alias** (`@projectos/core` mapped to this worktree's `core/dist`) | exit 0, no output |
| agent `src` and the new and touched tests type-checked through the alias | exit 0, no output |
| agent tests, **alias** vitest config (an untracked temporary file, deleted afterwards) | 128 files; first full run 126 pass, 3,911 tests pass, 10 skipped; final full run 126 pass, **3,917 tests pass, 1 failed, 10 skipped**. The one skipped file is `tenantSidecar.test.ts` (the alias artefact below). The one failure in the final run was `pinnedValidators.test.ts > a pin whose blob git cannot show fails`, which ran while a second full suite was running on the same machine; run alone it passes (11 of 11) and it passed in the first full run |
| esbuild browser bundle of `core/src/index.ts` (control-center's esbuild, `platform: 'browser'`, `node:crypto` and `node:buffer` aliased as `coreBrowserLoad.test.ts` does), evaluated in a bare context | exit 0, 863,697 bytes; a top-level `Buffer` beside the barrel fails as the positive control; `grep "from 'node:" core/src/context/manager*.ts` lists nothing |
| `val-projectos-context-manager1a` | PASS, 19 rules, 225 named mutations; `Array.isArray(run())` is `true` (synchronous) |
| `val-projectos-port-context1a` | PASS, exit 0 (18 rules; 326 named mutations; one existing mutation, `closure-reads-context`, now declares PX-17 as also firing, which is true of it) |
| `val-projectos-port-approvals1a` | PASS, exit 0 (83 scenarios; 81 behaviour and 68 text mutations) |
| `val-projectos-port-memory1a` | PASS, exit 0 (20 rules; 206 mutations) |
| `val-projectos-port-skills1a` | PASS, exit 0 (21 rules; 447 mutations) |
| `val-projectos-port-search1a`, `-memory-stores1a` | PASS, exit 0 (113 text and 26 behavioural; 198 text and 84 behavioural) |
| `val-projectos-memory-provenance1a` | **FAILS MP-12 twice**, exit 1, none a defect: see "Out-of-path edits needed" |
| `val-projectos-boot-continue1a`, `-work-record-not-authority1a` | PASS, exit 0 (18 mutations; PASS) |
| `val-projectos-kernel-followup1a`, `-kernel-platform-stop1a`, `-kernel-role-review1a`, `-worker-lifecycle-bounded1a`, `-technical-continuation1a`, `-agent-workforce1a` | PASS, exit 0 (88, 101, 44 mutations; three PASS) |
| `val-projectos-tenant-credentials1a`, `-tenant-principal1a`, `-tenant-contract1a`, `-tenant-csp1a`, `-tenant-rls1a`, `-v3-active-phase-consistency1a`, `-validator-scratch-lifecycle1a`, `-v3-validation-evidence1a` | PASS, exit 0 |
| `val-projectos-connector-contract1a`, `-port-agents1a`, `-port-mcp1a`, `-port-computer1a`, `-port-providers1a`, `-port-research1a`, `-port-routines1a` | PASS, exit 0 |
| `validate-speed-validation-cache`, `validate-v2-closure-evidence`, `validate-no-secrets` | PASS, exit 0 |
| `val-projectos-port-credit1a` | first run failed `PC-24 not tracked` for the three new core files (they were intent-to-add only); re-run after the commit: PASS, exit 0 (189 real files judged; 157 fixture and 59 record mutations) |

**The one agent failure file under the alias is the alias, not the code.** `test/tenantSidecar.test.ts` builds the agent with its own `tsconfig.json` in `beforeAll`, and the agent's `@projectos/core` junction points at another worktree whose `core/dist` lacks the new exports, so its `tsc` stops and its 10 tests are skipped. On the merged stack the junction resolves to the merged core.

**Real-machine smoke (not a test, not kept).** `prepareRunContext` with `nodeContextPorts(nodeSystem, ...)` over this worktree, real git and real file system, an admitted `projectos` envelope and `dependsOn` of two real phases and one that is not a phase: the two closure decisions came back as tier-0 items with proofs (2,475 and 1,992 bytes), the third was silently skipped, 1,588 tokens, no compaction.

`validate-all` was not run.

## Converge (B9)

**Unbuilt on purpose.** The proposal door call, a started taint guard, `recordContextUsage`, a command that builds the index, skill loading, folding the ledger into the run's own records, and exporting the new names from `agent/src/index.ts`: each is named under "Residuals and wiring still open".

**Drift.** One, stated: `run.ts` changes by **two lines**, the option and the import it needs, where the brief said one option (an import line only if `admittedRunEnvelopeOf` was not already imported, and it was not). Nothing pins that import line. Nothing else departs from the delta row 9 and the JSON spec: retrieval keyed on the envelope (done), the one-option edit (done), the loop-written ledger (done), `records.contextPath` and the fenced file (done), deterministic compaction in the carried order with a partial summary refused and a stop on overLimit (done), approved decisions always loaded (done), the evidence naming what was shown (done), the four rules narrowed (done), and the direct-write refusal and store digest wired where they fit inside the write paths (done; nothing had to be stretched).

**PROTECTED files.** `git diff --stat c71adc16` over the working tree and the new files (taken before the commit; `git diff --stat c71adc16..HEAD` lists the same files once committed):

```
docs/finish/PROJECTOS-CONTEXT-MANAGER1A.md         | 228 ++++++
 projectos/agent/src/commands/run.ts                |   3 +-
 projectos/agent/src/context/contextLedger.ts       | 121 ++++
 projectos/agent/src/context/contextManager.ts      | 412 +++++++++++
 projectos/agent/src/context/contextPorts.ts        | 103 +++
 projectos/agent/src/context/contextRetrieval.ts    | 187 +++++
 projectos/agent/src/context/contextRun.ts          | 212 ++++++
 projectos/agent/src/context/contextStoreGuard.ts   | 104 +++
 projectos/agent/src/context/contextTaint.ts        |  34 +
 projectos/agent/src/loop/adapters/claudeCodeCli.ts |  25 +-
 projectos/agent/src/loop/brief.ts                  |  26 +
 projectos/agent/src/loop/runner.ts                 | 123 +++-
 projectos/agent/test/contextLedger.test.ts         | 156 ++++
 projectos/agent/test/contextManager.test.ts        | 325 +++++++++
 projectos/agent/test/contextPorts.test.ts          |  87 +++
 projectos/agent/test/contextRetrieval.test.ts      | 296 ++++++++
 projectos/agent/test/contextRun.test.ts            | 235 ++++++
 projectos/agent/test/contextStoreGuard.test.ts     | 123 ++++
 projectos/agent/test/loopBriefContext.test.ts      | 142 ++++
 projectos/agent/test/loopContext.test.ts           | 356 +++++++++
 projectos/agent/test/support/contextWorld.ts       | 181 +++++
 projectos/core/src/context/managerItems.ts         | 104 +++
 projectos/core/src/context/managerKey.ts           |  84 +++
 projectos/core/src/context/managerLedger.ts        | 265 +++++++
 projectos/core/src/index.ts                        |   3 +
 projectos/core/test/context-manager-items.test.ts  | 116 +++
 projectos/core/test/context-manager-key.test.ts    | 122 ++++
 projectos/core/test/context-manager-ledger.test.ts | 183 +++++
 projectos/speed/cached-runner.cjs                  |   2 +
 .../validators/val-projectos-context-manager1a.cjs | 800 +++++++++++++++++++++
 .../validators/val-projectos-port-approvals1a.cjs  |  27 +-
 .../validators/val-projectos-port-context1a.cjs    |  56 +-
 .../validators/val-projectos-port-memory1a.cjs     |  57 +-
 .../validators/val-projectos-port-skills1a.cjs     |  57 +-
 projectos/validators/validate-all.cjs              |   2 +
 35 files changed, 5336 insertions(+), 21 deletions(-)
```

Of the PROTECTED files, only `projectos/agent/src/commands/run.ts` is in it, and only as the two lines above. `taskEnvelope.ts`, `actionRegistry.ts`, `tenant.ts`, `verification.ts`, `projectos/security/action-registry.json`, the write grants (`workers.ts`), `session.ts`, `observation.ts`, `candidateIdentity.ts`, `system.ts`, `val-projectos-memory-provenance1a.cjs` and `docs/06_Plan.md` are not.

## Out-of-path edits needed

**1. One validator outside this phase's write paths goes stale from the registration the brief asked for, and was not edited.**
`val-projectos-memory-provenance1a.cjs` fails MP-12 twice (in `validate-all` and in `cached-runner`): it pins "this validator is immediately before
`val-projectos-connector-contract1a`", and this phase's validator now sits between them, as the brief said. The edit is **one line**: line 45,
`const NEXT_VALIDATOR = "val-projectos-connector-contract1a";` becomes `"val-projectos-context-manager1a"`. No MP-12 mutation names the next validator
(they anchor on `PREV_VALIDATOR`), so nothing else moves. It is the same kind of edit the lead made for `val-projectos-memory-stores1a` in `de9e7b01`.
Everything else that reads `validate-all` and `cached-runner` passes untouched (see the checks).

**2. Nothing else.** No PROTECTED file is edited except the one `run.ts` option; `session.ts`, `candidateIdentity.ts`, `observation.ts`, `verification.ts`,
`workers.ts`, `system.ts`, `taskEnvelope.ts`, `actionRegistry.ts`, `tenant.ts`, `action-registry.json` and `docs/06_Plan.md` are not in the diff.

## Residuals and wiring still open

### Wiring this phase does not make (Stage 4.1 and the phases beside it)

- **The proposal door is still not called.** `openProposalDoor` (STORES1A) has no caller: nothing turns a worker's `proposals` entry into a pending proposal yet.
  When it is wired it must run **after** `endStoreGuard` and before the checks' own records, or the kernel's proposal files are what the guard refuses.
- **No guard is started for taint.** `storedContextTaintsRun` answers "tainted" and the answer is in the ledger and the evidence, but `startRunGuard` and
  `recordOutsideContent` are not public in `core/src/approvals/index.ts`, so the run's taint is not held by the approvals module. The phase that mediates every tool call owns that.
- **`recordContextUsage` is never called.** It takes a provider's own count of the prompt, and a CLI worker reports none; calling it with the estimate would invent a reading.
  The carried order is therefore plan, draft, apply, note (and `noteCompactionRefused` on a refusal). When a provider count exists, it goes after each reply.
- **No command builds the per-project index.** The manager opens `<installation state>/search-index/idx-<hash>.sqlite` only if that file already exists, and nothing creates it yet
  (STORES1A named this: the installation's index directory is not chosen). Until one does, production retrieval returns committed memory and decisions and no index hits.
- **The run ledger is not folded by `run.ts`.** `.projectops/context-ledger/NNNNNN.json` is untracked after a run, like `.findings.json` and `.effects.json`, so the owner's commit carries it.
  The classifier that commits ProjectOS's own run records (`isFoldableRunRecord` in `run.ts`, PROTECTED) names four shapes and would need a fifth: that is an owner approval, not an edit made here.
- **Skills are not loaded.** `PROJECTOS-SKILLS-ADOPT1A` adds the skill loader to this file and moves PK-16 with it.

### What the design leans on, and where it is weaker than it looks

- **Core cannot prove an envelope was admitted.** The kernel's admitted list is private to `taskEnvelope.ts` (PROTECTED), so core checks what a hand-made object gets wrong (R1 by `parseEnvelope`, the action,
  the scope, the expiry, plain data, a Proxy by a port) and the runner takes its envelope from one option that `run.ts` fills from `admittedRunEnvelopeOf` and from nowhere else. A caller inside the process
  that passed another well-formed `run-start` envelope would get that project's context: the type, not a proof, says it does not.
- **The owner's approval of an entry rests on a working-tree file.** An entry's text is read from COMMITTED bytes (a copy that differs from HEAD is refused), but who approved it, and that it is a decision,
  is read from `MEMORY.provenance.json`, which the committed reader cannot read (its path is not a memory file) and `loadMemoryBlock` reads the same way. A worker cannot write it (the guard), a cloned repository can bring one.
  Closing it needs the sidecar committed and readable by the committed reader, or owner proof, as STORES1A's owner question 2 says.
- **A compaction is recorded as `agent-model`.** The kernel's list of summarisers (`SUMMARISER_KINDS`) is pinned by PX-12 and has no deterministic kind, so the sealed record says `agent-model`; the ledger says
  `deterministic-selection`, which is true. A deterministic kind needs the owner to move PX-12.
- **"Approved decisions" are the memory entries whose record says `decision`.** The committed closure decisions of the phases this one depends on are retrieved as tier-0 items and can be left out for room; the memory
  decisions never can. A project with hundreds of closure decisions is read through `dependsOn`, at most twenty, not by listing.
- **The ledger's chain is verified over its newest 64 entries on each append** (a bound, so a long ledger does not slow a run), and `contextLedgerProblem` verifies the whole chain where an audit reads it.
  A changed entry older than the window, a cut tail and a rewritten directory are not found by the run; a head hash kept elsewhere would anchor it (the same residual as the deletion ledger).
- **The run envelope lasts 12 hours** (`RUN_ENVELOPE_WINDOW_MS`). A `--continue` programme that outlives it is refused at the next phase with `CONTEXT_MANAGER_ENVELOPE_EXPIRED`: it fails closed, and it does say so.
- **The guard runs when the run has an admitted envelope**, which is every `--execute` run (a dry run and an unadmitted run have none). A transparent Proxy, an NTFS alternate data stream, a write made and undone between the two digests,
  and an 8.3 short name are the stated limits of STORES1A's digest and direct-write check, and are unchanged.
- **The worker can also read the committed files directly.** It has read access to the repository, so the context file is a convenience and a record of what ProjectOS chose to show, not a boundary: the boundary is that stored text is data, fenced, scanned and never authority.
- **A fence is a statement to a model, not a boundary.** Core's fence names itself by a hash of what it holds, so text cannot close it early; it lowers the chance of an instruction landing and cannot remove it.
- **Plan memory is read only from paths of the `.projectops/plan-*.json` shape** that the configuration names. This repository's plan memory lives elsewhere, so none is read here.
- **`runner.ts` is 2,344 lines** (it was 2,235 and is over the 800 the style rule names, like the file it was); the new source files are all under 450 and the new validator is 800 lines.
- **The agent barrel `agent/src/index.ts` does not export the new names,** like the memory and search modules: nothing outside the loop calls them.
- **`node:sqlite` is experimental** in Node 24.14.1 and prints a warning when an index opens.

## Commits

- `feat(context): the context manager, retrieval keyed on the admitted run envelope, handed over by reference`: the core rules, the agent files, the loop wiring, the brief and adapter change, the one `run.ts` option, the tests, the validator, the four narrowed rules, the registration and this file. One commit on the branch, not pushed.

## Appendix: the failing run, test names (against the stub, before the implementation)

Names are as vitest printed them (a `%s` is an `it.each` value). 191 failed and 8 passed.

**context-manager-items.test.ts**: 25 failed

- a stored text is data: it is gated before it can be shown > passes an ordinary note through unchanged, with the hash of exactly that text
- a stored text is data: it is gated before it can be shown > caps what is shown by characters AND by bytes, and the hash is of the whole text
- a stored text is data: it is gated before it can be shown > holds the byte cap for text whose characters are wide
- a stored text is data: it is gated before it can be shown > never cuts a character in half
- a stored text is data: it is gated before it can be shown > refuses text it never read: over the source cap is not scanned
- a stored text is data: it is gated before it can be shown > refuses undefined as not text
- a stored text is data: it is gated before it can be shown > refuses null as not text
- a stored text is data: it is gated before it can be shown > refuses 5 as not text
- a stored text is data: it is gated before it can be shown > refuses {} as not text
- a stored text is data: it is gated before it can be shown > refuses a as not text
- a stored text is data: it is gated before it can be shown > refuses Symbol(x) as not text
- a stored text is data: it is gated before it can be shown > refuses empty text ("")
- a stored text is data: it is gated before it can be shown > refuses empty text (" \n\t ")
- a stored text is data: it is gated before it can be shown > refuses hidden text: a zero-width space
- a stored text is data: it is gated before it can be shown > refuses hidden text: a bidi override
- a stored text is data: it is gated before it can be shown > refuses hidden text: a tag character
- a stored text is data: it is gated before it can be shown > refuses hidden text: a Braille blank
- a stored text is data: it is gated before it can be shown > refuses hidden text: a hidden link reference
- a stored text is data: it is gated before it can be shown > refuses text that reads as an attack on the agent, and names it
- a stored text is data: it is gated before it can be shown > asks the credential screen, and an answer that is not exactly false refuses
- a stored text is data: it is gated before it can be shown > fails closed with no screen at all
- a stored text is data: it is gated before it can be shown > also asks core's own credential vocabulary, whatever the screen said
- a stored text is data: it is gated before it can be shown > scans what is shown: a threat past the excerpt does not refuse, and one inside it does
- a stored text is data: it is gated before it can be shown > a refusal quotes none of the text
- a stored text is data: it is gated before it can be shown > is linear on hostile input of 60,000 characters

**context-manager-key.test.ts**: 17 failed

- retrieval is keyed on the admitted run envelope and on nothing else > turns an admitted run envelope into its tenant, domain and project
- retrieval is keyed on the admitted run envelope and on nothing else > gives another project of the same install another key
- retrieval is keyed on the admitted run envelope and on nothing else > fails closed with no envelope (null): nothing is retrieved
- retrieval is keyed on the admitted run envelope and on nothing else > fails closed with no envelope (undefined): nothing is retrieved
- retrieval is keyed on the admitted run envelope and on nothing else > refuses a string as not an envelope
- retrieval is keyed on the admitted run envelope and on nothing else > refuses a number as not an envelope
- retrieval is keyed on the admitted run envelope and on nothing else > refuses a list as not an envelope
- retrieval is keyed on the admitted run envelope and on nothing else > refuses an empty object as not an envelope
- retrieval is keyed on the admitted run envelope and on nothing else > refuses a tenant and project only as not an envelope
- retrieval is keyed on the admitted run envelope and on nothing else > refuses an envelope with a field changed to something that does not parse, and one with an unknown f
- retrieval is keyed on the admitted run envelope and on nothing else > refuses an envelope that is not a run: a crossing or a read does not key retrieval
- retrieval is keyed on the admitted run envelope and on nothing else > refuses a run whose scope does not name its own project
- retrieval is keyed on the admitted run envelope and on nothing else > refuses an expired envelope, and a clock that cannot be read
- retrieval is keyed on the admitted run envelope and on nothing else > reads the envelope once: a getter is refused, not read twice
- retrieval is keyed on the admitted run envelope and on nothing else > refuses a key that would reach the prototype, and an envelope that inherits a field
- retrieval is keyed on the admitted run envelope and on nothing else > is told by an injected port whether the envelope is a Proxy, and fails closed without a clear answer
- retrieval is keyed on the admitted run envelope and on nothing else > a refusal never quotes the envelope

**context-manager-ledger.test.ts**: 29 failed

- every retrieval is recorded in an append-only, hash-chained ledger > seals an entry with its place in the chain and a hash of everything in it
- every retrieval is recorded in an append-only, hash-chained ledger > names each item shown with its hash and rank, and each item withheld with its code
- every retrieval is recorded in an append-only, hash-chained ledger > a different body is a different hash, and so is a different place in the chain
- every retrieval is recorded in an append-only, hash-chained ledger > verifies an unbroken chain, and finds a changed entry, a removed one and a reordered pair
- every retrieval is recorded in an append-only, hash-chained ledger > finds the first entry deleted, because the second no longer follows the start of the chain
- every retrieval is recorded in an append-only, hash-chained ledger > finds an entry whose number does not match its place
- every retrieval is recorded in an append-only, hash-chained ledger > refuses a list that is not a list of entries, and a list too long to walk
- every retrieval is recorded in an append-only, hash-chained ledger > reads the body once: a getter, a prototype key, an unlisted field and a symbol key are refused
- every retrieval is recorded in an append-only, hash-chained ledger > refuses an unknown event
- every retrieval is recorded in an append-only, hash-chained ledger > refuses a session id that is a path
- every retrieval is recorded in an append-only, hash-chained ledger > refuses a tenant that does not parse
- every retrieval is recorded in an append-only, hash-chained ledger > refuses an unknown domain
- every retrieval is recorded in an append-only, hash-chained ledger > refuses a head that is not a commit
- every retrieval is recorded in an append-only, hash-chained ledger > refuses a time that is not an instant
- every retrieval is recorded in an append-only, hash-chained ledger > refuses an attempt that is not a count
- every retrieval is recorded in an append-only, hash-chained ledger > refuses a compactor nobody knows
- every retrieval is recorded in an append-only, hash-chained ledger > refuses a file hash that is not a hash
- every retrieval is recorded in an append-only, hash-chained ledger > refuses a token count that is not whole
- every retrieval is recorded in an append-only, hash-chained ledger > refuses a taint flag that is not a boolean
- every retrieval is recorded in an append-only, hash-chained ledger > refuses an item with a bad hash
- every retrieval is recorded in an append-only, hash-chained ledger > refuses an item with a negative size
- every retrieval is recorded in an append-only, hash-chained ledger > refuses an item with an id of 60,000 characters
- every retrieval is recorded in an append-only, hash-chained ledger > refuses an item with an unknown source
- every retrieval is recorded in an append-only, hash-chained ledger > refuses an item that carries text
- every retrieval is recorded in an append-only, hash-chained ledger > refuses a withheld item with a free-text code
- every retrieval is recorded in an append-only, hash-chained ledger > holds a bound on the items an entry names
- every retrieval is recorded in an append-only, hash-chained ledger > refuses a place in the chain that is not one
- every retrieval is recorded in an append-only, hash-chained ledger > writes and reads an entry back as the same entry, and refuses text over its size before parsing it
- every retrieval is recorded in an append-only, hash-chained ledger > names its files by number, in one spelling

**contextLedger.test.ts**: 10 failed

- the retrieval ledger is appended by the loop, one exclusive file per entry > writes entry 1 with no predecessor, and entry 2 chained to it
- the retrieval ledger is appended by the loop, one exclusive file per entry > writes only through an exclusive create, so an entry is never overwritten
- the retrieval ledger is appended by the loop, one exclusive file per entry > loses a race once and takes the next place, never overwriting the winner
- the retrieval ledger is appended by the loop, one exclusive file per entry > refuses when the create keeps failing, and says nothing was recorded
- the retrieval ledger is appended by the loop, one exclusive file per entry > refuses a body that is not a ledger body, and writes nothing
- the retrieval ledger is appended by the loop, one exclusive file per entry > refuses a directory holding a file it did not write, whatever its name
- the retrieval ledger is appended by the loop, one exclusive file per entry > refuses a ledger whose tail was changed, and one with a gap, and one it cannot read
- the retrieval ledger is appended by the loop, one exclusive file per entry > refuses a file that is over the size of an entry without parsing it
- the retrieval ledger is appended by the loop, one exclusive file per entry > verifies the tail and not the whole history, so a long ledger does not slow a run
- the retrieval ledger is appended by the loop, one exclusive file per entry > refuses when the ledger is full, and on a time too hostile to list

**contextManager.test.ts**: 27 failed

- retrieval is keyed on the admitted run envelope, and fails closed without one > retrieves nothing for a run with no envelope, and touches no store, no git and no index
- retrieval is keyed on the admitted run envelope, and fails closed without one > refuses a run whose envelope is not one, and reads nothing
- retrieval is keyed on the admitted run envelope, and fails closed without one > opens the index under the envelope's own tenant and project, whatever else the request car
- retrieval is keyed on the admitted run envelope, and fails closed without one > keys two projects apart: each run opens its own project index and reads no other
- what the worker is shown: ranked, fenced, named > writes a file that says what it is, with each stored item in a fence named by a hash of what it holds
- what the worker is shown: ranked, fenced, named > names every item shown with its path, the hash of its whole text, its tier and its rank
- what the worker is shown: ranked, fenced, named > shows the highest provenance first, and an index hit claiming to be a decision is a recollection and ranks last
- what the worker is shown: ranked, fenced, named > a text that quotes a closing fence does not end its own fence
- what the worker is shown: ranked, fenced, named > withholds a text that is a threat, a credential, or hides text, and names it by code without quoting it
- what the worker is shown: ranked, fenced, named > asks the credential screen about the whole file as well
- what the worker is shown: ranked, fenced, named > marks an excerpt as one, and keeps the hash of the whole text
- what the worker is shown: ranked, fenced, named > every run is tainted by what it was shown: stored text is outside content, and a registry changes nothing
- what the worker is shown: ranked, fenced, named > is deterministic: the same inputs give the same file, and nothing reads a clock or a random source
- approved decisions are always loaded > holds each approved decision in its own fenced block, with the ledger it cites
- approved decisions are always loaded > keeps them when compaction runs: only stored items are summarised away
- approved decisions are always loaded > a decision that a screen would block is still held, and shown as a placeholder, never as text
- compaction is deterministic selection, in the carried order, and it refuses a partial summary > summarises the lowest-ranked items away by name and hash, and keeps the hi
- compaction is deterministic selection, in the carried order, and it refuses a partial summary > writes the summary as untrusted and grants nothing
- compaction is deterministic selection, in the carried order, and it refuses a partial summary > does nothing when everything fits
- compaction is deterministic selection, in the carried order, and it refuses a partial summary > refuses a summary that was cut short, and installs nothing
- compaction is deterministic selection, in the carried order, and it refuses a partial summary > refuses a summary the screen refuses, with the screen own code
- compaction is deterministic selection, in the carried order, and it refuses a partial summary > stops on overLimit: when what must stay will not fit, no file is made
- compaction is deterministic selection, in the carried order, and it refuses a partial summary > a summary over its budget is refused by its own code, and no file is made
- compaction is deterministic selection, in the carried order, and it refuses a partial summary > calls no model: no network, and no process, whatever the thread
- a missing port fails closed > refuses with no HEAD
- a missing port fails closed > refuses with no credential screen, no Proxy test or no clock
- a missing port fails closed > an expired envelope is refused

**contextRetrieval.test.ts**: 21 failed

- committed memory is read as committed, and the approved decisions are held apart > reads approved memory from the committed bytes, with the proof the read minted
- committed memory is read as committed, and the approved decisions are held apart > holds every approved decision on its own, and does not repeat it inside the memory item
- committed memory is read as committed, and the approved decisions are held apart > does not show an entry that no whole approved record holds, and does not call it a deci
- committed memory is read as committed, and the approved decisions are held apart > takes a decision from the COMMITTED entries: a decision that is only in a working-tree 
- committed memory is read as committed, and the approved decisions are held apart > an unreadable provenance file leaves no decision and no entry shown, and says so
- committed memory is read as committed, and the approved decisions are held apart > a working-tree copy that differs from HEAD is refused: no text, no decision, and the co
- committed memory is read as committed, and the approved decisions are held apart > a file that is simply not in HEAD is nothing to show, and not a failure
- committed memory is read as committed, and the approved decisions are held apart > with no HEAD nothing committed is read, and every file says so
- the committed decisions of the phases this one depends on > reads each one as committed, a tier-0 decision with its proof
- the committed decisions of the phases this one depends on > refuses an id that would name another file, by the committed reader own code, and asks git nothing for it
- the committed decisions of the phases this one depends on > is bounded: only the first twenty ids are read, and the rest are named as not read
- the committed decisions of the phases this one depends on > reads plan memory only from a path of that shape
- the index is opened for this envelope tenant and project, and for no other > opens the index of the key owner, asks the phase query, and closes it
- the index is opened for this envelope tenant and project, and for no other > drops a hit that names another project, whatever the index returned, and records the code
- the index is opened for this envelope tenant and project, and for no other > a hit on a stored record is only a claim: it carries no proof and so cannot outrank a committ
- the index is opened for this envelope tenant and project, and for no other > shows a stale hit as stale
- the index is opened for this envelope tenant and project, and for no other > a hit with no freshness is not read as fresh
- the index is opened for this envelope tenant and project, and for no other > an index that cannot open, a search that refuses and one that throws are failures, and the in
- the index is opened for this envelope tenant and project, and for no other > no index port means no index: nothing is searched
- the index is opened for this envelope tenant and project, and for no other > keeps at most five hits however many come back
- two projects get two index files, and one project never reads the other > retrieves a project own notes, and none of another project or another tenant

**contextRun.test.ts**: 15 failed

- preparing a run context reads, and writes nothing > has no context for a run with no envelope: nothing is read, nothing is written
- preparing a run context reads, and writes nothing > refuses a malformed envelope with a line that names the code, and writes nothing
- preparing a run context reads, and writes nothing > refuses a session id that would not make a safe file name
- preparing a run context reads, and writes nothing > is ready with the path the brief will name, and nothing is on disk yet
- preparing a run context reads, and writes nothing > a refusal that knows whose run it was is recorded in the ledger, best effort
- the loop records what it gathered, and what it placed > records the retrieval in the ledger: whose run, at which commit, each item with its hash and rank
- the loop records what it gathered, and what it placed > places the file for each dispatch, writes it again from its own copy, and records each placement
- the loop records what it gathered, and what it placed > retires the file, so it is never part of what the checks judge
- the loop records what it gathered, and what it placed > says so when the file could not be removed, and when it is still there
- the loop records what it gathered, and what it placed > refuses to place a file it cannot read back as written, and leaves none
- the loop records what it gathered, and what it placed > removes a file it placed when the placement cannot be recorded
- the loop records what it gathered, and what it placed > refuses the run when the retrieval cannot be recorded: no record, no file
- the loop records what it gathered, and what it placed > will not place before it has recorded
- the evidence names every stored item the worker was shown > names the items with their paths, content hashes and provenance rank, and the withheld and omitted ones
- the evidence names every stored item the worker was shown > names the decisions held and any item left out for room

**contextStoreGuard.test.ts**: 18 failed

- porcelain -z paths, with both sides of a rename > lists every path, and both the new and the old name of a rename
- porcelain -z paths, with both sides of a rename > refuses output it cannot read as complete: a rename with no old name, a short entry
- porcelain -z paths, with both sides of a rename > is bounded: a status of more than 100,000 paths is refused unread
- a worker does not write memory or skills: refused where its changes are judged > asks git for every path, untracked files one by one, in the null-separated form
- a worker does not write memory or skills: refused where its changes are judged > passes a run that touched neither store
- a worker does not write memory or skills: refused where its changes are judged > refuses a new memory file
- a worker does not write memory or skills: refused where its changes are judged > refuses an edited memory file
- a worker does not write memory or skills: refused where its changes are judged > refuses a skill file
- a worker does not write memory or skills: refused where its changes are judged > refuses a proposal file written around the door
- a worker does not write memory or skills: refused where its changes are judged > refuses a case variant
- a worker does not write memory or skills: refused where its changes are judged > refuses the new name of a moved store file
- a worker does not write memory or skills: refused where its changes are judged > refuses the old name of a file moved into a store
- a worker does not write memory or skills: refused where its changes are judged > refuses a directory above a store
- a worker does not write memory or skills: refused where its changes are judged > does not blame the worker for a store path that was already changed before it ran, and se
- a worker does not write memory or skills: refused where its changes are judged > sees a write that git does not: an ignored store, by its digest
- a worker does not write memory or skills: refused where its changes are judged > sees a file added to a store that git ignores
- a worker does not write memory or skills: refused where its changes are judged > clears nothing it could not check: git failing, a status it cannot read, a digest it coul
- a worker does not write memory or skills: refused where its changes are judged > a refusal names paths and never quotes a file

**loopBriefContext.test.ts**: 15 failed

- the brief names the context file, and nothing else can ride in that field > refuses another session, because the one value it may have is the derived one
- the brief names the context file, and nothing else can ride in that field > refuses another directory, because the one value it may have is the derived one
- the brief names the context file, and nothing else can ride in that field > refuses a parent directory, because the one value it may have is the derived one
- the brief names the context file, and nothing else can ride in that field > refuses another extension, because the one value it may have is the derived one
- the brief names the context file, and nothing else can ride in that field > refuses a sentence, because the one value it may have is the derived one
- the brief names the context file, and nothing else can ride in that field > refuses an empty string, because the one value it may have is the derived one
- the brief names the context file, and nothing else can ride in that field > refuses the brief itself, because the one value it may have is the derived one
- the brief names the context file, and nothing else can ride in that field > refuses a path with a newline, because the one value it may have is the derived one
- the brief names the context file, and nothing else can ride in that field > refuses a path with trailing text, because the one value it may have is the derived one
- the brief names the context file, and nothing else can ride in that field > refuses a context path that is not a string (123)
- the brief names the context file, and nothing else can ride in that field > refuses a context path that is not a string (null)
- the brief names the context file, and nothing else can ride in that field > refuses a context path that is not a string ({})
- the brief names the context file, and nothing else can ride in that field > refuses a context path that is not a string ("a")
- the brief names the context file, and nothing else can ride in that field > refuses a context path that is not a string (true)
- the worker instruction points at the context file, and at nothing the worker is told to obey > names the file and says it is data: read only, never instructions, and it g

**loopContext.test.ts**: 14 failed

- a run with no admitted envelope retrieves nothing and changes nothing > writes no context file, no ledger and names none in the brief or the evidence
- a run with no admitted envelope retrieves nothing and changes nothing > a dry run with an envelope still writes nothing
- with an admitted envelope the runner hands the worker the stored context, by reference > names the context file in the brief, and the brief still passes its provenance wa
- with an admitted envelope the runner hands the worker the stored context, by reference > places the file before the worker is dispatched: fenced, untrusted, with the deci
- with an admitted envelope the runner hands the worker the stored context, by reference > records the retrieval and each placement in the loop-written ledger, before the w
- with an admitted envelope the runner hands the worker the stored context, by reference > places the file again for every correction, from its own copy, and removes it eac
- with an admitted envelope the runner hands the worker the stored context, by reference > names every stored item the worker was shown in the run evidence: path, hash, ran
- with an admitted envelope the runner hands the worker the stored context, by reference > stops before any worker when what must stay does not fit, and writes no brief
- with an admitted envelope the runner hands the worker the stored context, by reference > refuses the run when the retrieval cannot be recorded, before any worker
- with an admitted envelope the runner hands the worker the stored context, by reference > refuses a malformed envelope outright
- a worker does not write memory or skills: refused at the check step > stops a run whose worker wrote a memory file, and runs no check
- a worker does not write memory or skills: refused at the check step > stops a run whose worker wrote a skill
- a worker does not write memory or skills: refused at the check step > sees a write git does not show, by the digest of the stores taken before and after the worker
- a worker does not write memory or skills: refused at the check step > passes a worker that touched neither store

**Passed against the stub (premises true before the change)**

- loopBriefContext.test.ts: the brief names the context file, and nothing else can ride in that field > carries the path when the loop derived one, and none when it did not
- loopBriefContext.test.ts: the brief names the context file, and nothing else can ride in that field > passes the provenance walk when the path is the one derived from the brief own path
- loopBriefContext.test.ts: the worker instruction points at the context file, and at nothing the worker is told to obey > is unchanged when there is no context file
- loopBriefContext.test.ts: the worker instruction points at the context file, and at nothing the worker is told to obey > puts a path on the command line only in the shape the loop derives
- loopBriefContext.test.ts: the Claude Code adapter hands the path on from the brief, and only from the brief > starts a worker with the context path in its one instruction, when the brief names one
- loopBriefContext.test.ts: the Claude Code adapter hands the path on from the brief, and only from the brief > starts it exactly as before when the brief names none
- loopBriefContext.test.ts: the Claude Code adapter hands the path on from the brief, and only from the brief > rejoins with the same pointer, from the current brief and never from the session record
- loopContext.test.ts: with an admitted envelope the runner hands the worker the stored context, by reference > removes the file as soon as the worker returns: it is never in what the checks judge, and 

