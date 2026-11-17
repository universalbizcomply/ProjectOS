# PROJECTOS-MEMORY-OWNER-COMMANDS1A

Stage 3 shipped the memory rules with no command the owner can run. This phase adds `projectos memory ...` and the production owner verifier (a typed terminal confirmation), by calling the functions that already existed. Spec: `docs/changes/delta_spec.md`, "Phase B". Branch `projectos-memory-owner-commands1a`, based on `c16af007`. Not pushed, not merged.

## Existing code found (extended, not rebuilt)

| What | Where | Used for |
|---|---|---|
| `deleteMemoryItem`, `deleteDerivedIndex`, `readDeletionLedger`, the deletion ledger | `agent/src/memory/memoryDeletion.ts`, `core/src/memory/deletionLedger.ts`, `retention.ts` | `memory delete`, `memory index delete`, the ledger head |
| `readCommittedDecisionTexts`, `gitRunnerOver` | `agent/src/memory/committedBytes.ts`, `agent/src/search/ports.ts` | the committed decisions a deletion is checked against |
| `approveMemoryProposal`, `rejectMemoryProposal`, `loadMemoryProposal`, `listPendingMemoryProposals`, `readMemoryStore` | `agent/src/memory/proposalQueue.ts`, `memoryFiles.ts` | `memory approve`, `reject`, `proposals` |
| `provenanceReplacementProblem` | `core/src/memory/provenance.ts` | the rank check before an approval |
| `openProjectSearchIndex`, `rebuildProject`, `collectDocumentSources`, `collectStoreSources`, `searchHeadOver`, `searchClockOver` | `agent/src/search/` | `memory index rebuild` |
| `checkoutIdentityOf` | `agent/src/context/contextCheckout.ts` | the tenant and project of the checkout (rule 7) |
| The installation index directory `<state>/search-index` | `agent/src/loop/runner.ts` (line ~686), `nodeInstallationStateDir` | where the index file goes |
| The typed TTY confirmation (`TenantReceiptTerminal`, `nodeTerminal`) | `agent/src/commands/tenant.ts` | the one prompt mechanism, reused |
| `deletionOwnerClaimOf` / `claimHash` | `core/src/memory/retention.ts` | what the typed code is bound to for a deletion |

## What was added

- `projectos/agent/src/commands/memory.ts` (the five commands, plus `memory index delete`), `projectos/agent/src/memory/ownerTerminalVerifier.ts` (the verifier, the proposal claim, the fence).
- `projectos/agent/test/memoryOwnerCommands.test.ts` (57 tests), validator `projectos/validators/val-projectos-memory-owner-commands1a.cjs` (68 named mutations).
- `cli.ts`: the `memory` case, its help line, and the platform-stop classification (only `memory proposals` is read-only). `index.ts`: exports.

### Commands and their refusals

| Command | Needs | Refusal codes it can print (each with a plain `next:` line) |
|---|---|---|
| `memory index rebuild` | the checkout named by the registry | `MEMORY_CHECKOUT_*`, `MEMORY_INDEX_NO_STATE_DIRECTORY`, `MEMORY_INDEX_UNAVAILABLE` |
| `memory index delete [--reason]` | the same; no owner (P2) | the above, `DELETE_*`, `DELETION_LEDGER_UNAVAILABLE` |
| `memory delete --path --reason [--hash]` | a terminal, the typed code | `MEMORY_OWNER_NEEDS_A_TERMINAL`, `DELETE_OWNER_NOT_VERIFIED`, `MEMORY_DELETE_CITED_BY_DECISION`, `MEMORY_DELETE_DECISIONS_UNREADABLE`, every `DELETE_*` |
| `memory proposals [--id]` | read-only | `MEMORY_*` for a bad id |
| `memory approve --id` | a terminal, the typed code | `MEMORY_OWNER_NEEDS_A_TERMINAL`, `MEMORY_OWNER_NOT_CONFIRMED`, `PROVENANCE_*`, every `MEMORY_*` |
| `memory reject --id` | a terminal, the typed code | as approve, without `PROVENANCE_*` |

`NEXT_STEP` in `memory.ts` is typed over the closed code sets (`MemoryDeletionRefusal`, `MemoryDeletionCode`, `MemoryRefusalCode`, `ProvenanceReplacementCode` and the local codes), so a code added to core is a compile error until it has a next step.

## Rule, test, mutation

Every test was written before `commands/memory.ts` existed and was seen failing (the module was absent). `ownerTerminalVerifier.ts` was written before its own tests (see Converge); its tests are in the same file and its mutations are named below.

| Rule | Tests (`memoryOwnerCommands.test.ts`) | Named mutations (validator rule) |
|---|---|---|
| 1 no decision without the owner at a terminal | `rule 1` block: piped input, redirected output, wrong answers, no answer, `--as owner` ignored, approve/reject without a terminal, the verifier answers `true` only | OC-1: `one-stream-is-enough`, `any-answer-confirms`, `a-prefix-confirms`, `no-terminal-is-asked-anyway`, `a-throwing-terminal-confirms`, `a-second-prompt-mechanism`, `the-tenant-terminal-goes-private`, `deletion-without-a-terminal-check`, `the-answer-is-truthy-not-true`, `role-from-a-flag`, `the-verifier-is-left-off-the-ports`, `the-owner-role-is-a-guest-role` |
| 2 bound to item, hash, tenant, project | `rule 2` block: a code typed for another proposal, hash, tenant, project or checkout; a forged claim hash; a deletion confirmed for another item | OC-2: `code-is-the-whole-hash-prefix-of-nothing`, `claim-hash-not-over-every-field`, `handed-over-claim-trusted`, `claim-gate-dropped`, `claim-leaves-out-the-project`, `claim-leaves-out-the-hash`, `deletion-request-for-another-project`, `approval-over-an-unread-hash` |
| 3 cited or unreadable decisions refuse | `rule 3` block (path, hash, unreadable, owner never asked, positive control) | OC-3: `cited-item-goes-to-the-owner`, `unreadable-decisions-go-to-the-owner`, `the-decliner-is-not-used`, `cited-refusal-reads-as-a-typo`, `decisions-assumed-none`, `a-throwing-decision-read-is-none` |
| 4 ledger before removal; head printed | `rule 4` block: the `authorised` entry exists when the file is removed; the printed head is the last entry's hash; a refusal is recorded; an unwritable ledger removes nothing | OC-4: `ledger-head-not-printed`, `item-removed-by-the-command`, `deletion-skips-the-recorded-rule`, `ledger-not-printed-for-an-index` |
| 5 index only under the state directory, at the commit | `rule 5` block: nothing written under the project root, fresh then stale, no HEAD, no state directory, per-project file | OC-5: `head-taken-after-the-sources`, `build-commit-not-recorded`, `index-opened-for-another-owner`, `index-kept-in-the-project`, `index-handle-leaked`, `no-state-directory-writes-anyway` |
| 6 approve through the rule and the replacement check; reject only the proposal | `rule 6` block | OC-6: `approval-lands-text-itself`, `replacement-check-after-the-ask`, `replacement-check-asks-nothing`, `every-replacement-passes`, `a-summary-is-ranked-as-a-fact`, `reject-writes-a-store`, `unloaded-proposal-decided` |
| 7 project from the registry | `rule 7` block: flags not read, every command refuses for each registry cause, a throwing identity | OC-7: `tenant-from-an-argument`, `project-from-a-flag-index`, `identity-not-the-registry`, `identity-asked-after-the-command`, `identity-not-validated` |
| 8 reason + next step; no unfenced stored text | `rule 8` block: every refusal has a code, reason and `next:`; fenced, capped, visible; the delete prompt fences the item; the statement on every decision | OC-8: `refusal-without-a-next-step`, `next-steps-not-exhaustive`, `decision-without-the-statement`, `refusal-reason-printed-raw`, `proposal-text-printed-raw`, `item-text-printed-raw`, `fence-lines-not-prefixed`, `fence-uncapped`, `control-characters-not-visible`, `bidirectional-characters-pass`, `escape-character-passes` |
| reachable; stop allows only the read | last block, `platformStop.test.ts` rows | OC-9 (5), OC-10 (2), OC-11 (2) |

The validator reads the sources, strips comments, pins exact code substrings, applies each mutation in memory and counts it killed only when its own rule fires; a mutation that no longer applies is an error. `run()` is synchronous and returns an array.

## Existing validators narrowed (named, not deleted)

`val-projectos-port-memory1a.cjs`, PM-16 ("nothing outside the port CALLS its entry points but the call sites a phase adds"): the owner commands are added as a second constant, `OWNER_COMMAND_CALL_SITES`, for exactly `commands/memory.ts` and exactly five entry points (`approveMemoryProposal`, `rejectMemoryProposal`, `listPendingMemoryProposals`, `loadMemoryProposal`, `readMemoryStore`). It may not call `proposeMemoryWrite` or a store writer. `MEMORY_CALL_SITES` is untouched, so `val-projectos-context-manager1a` CM-19 (which pins that literal) still holds. Three new mutations there: `the-owner-commands-propose-a-write`, `the-owner-commands-write-the-store`, `the-owner-commands-no-longer-decide`. No other Stage 3 validator forbade a call site this phase adds (`deleteMemoryItem`, `rebuildProject`, `openProjectSearchIndex` have no caller rule).

## Checks

All run from this worktree; counts are what was printed. `validate-all` was not run (the lead runs it once on the merged stack). The agent's `@projectos/core` junction points at `host-review-path1b`; nothing in `projectos/core/src` changed, so no alias run was needed.

| Check | Result |
|---|---|
| `tsc -p tsconfig.json --noEmit` (agent) | exit 0 |
| `tsc -p tsconfig.test.json --noEmit` | one error, `test/skillLoad.test.ts(128)` (`.sort` on a readonly array), present at the base commit and not touched here; none from the new files |
| `vitest run test/memoryOwnerCommands.test.ts` | 57 passed |
| Memory, search, context, platform-stop and tenant tests (`platformStop`, `tenantPrincipal`, `memoryDeletion`, `memoryQueue`, `memoryStores`, `memoryCommittedBytes`, `searchIndex`, `searchStores`, `contextPorts`) | 502 passed, 1 failed on the first run: `platformStop.test.ts` "classifies every command cli.ts dispatches" (no row for `memory`); fixed by adding the rows, see Converge |
| Whole agent suite, once, at the end | 137 of 138 files passed; 4340 tests passed, 10 skipped. The one failing file, `test/tenantSidecar.test.ts`, fails to load: it runs `tsc -p projectos/control-center/tsconfig.node.json`, and this worktree has no `control-center/node_modules` (`Cannot find module '@projectos/bridge-daemon'`). Environmental, not this change |
| `val-projectos-memory-owner-commands1a` | PASS (68 named mutations killed); `run()` is synchronous and returns an array (`true`) |
| `val-projectos-kernel-followup1a` | PASS (88 named mutations killed): the two registration lists are identical |
| `validate-no-secrets` | PASS |
| `val-projectos-port-credit1a` | before the commit: 1 error, PC-24 "not tracked by git" for the new verifier file (a clean-checkout rule); after the commit: see the line below |
| `val-projectos-port-memory1a` | PASS (20 rules; 209 named mutations killed) |
| `val-projectos-memory-stores1a` | PASS (198 text and 84 behavioural mutations) |
| `val-projectos-memory-provenance1a` | PASS (204 text and 125 behavioural mutations) |
| `val-projectos-context-manager1a` | PASS (21 rules; 285 named mutations) |
| `val-projectos-port-search1a` | PASS (22 real files judged) |
| `val-projectos-port-mcp1a`, `kernel-platform-stop1a`, `tenant-principal1a` (they read `cli.ts`, `index.ts` or `tenant.ts`) | PASS (14 files and 388 mutations; 101; 210) |
| `val-projectos-connector-contract1a` | PASS (38 rules; 293 named mutations) |
| `val-projectos-memory-exit-proof1a` | FAILS EP-9 (4 messages) on this branch, and fails the same way at the base commit: `val-projectos-worker-codex-implementer1a` is registered after it here (`c16af007` lists it last), and EP-9 pins itself last. The entry added here is before `connector-contract1a`, as the coordinator instructed, so on the merged stack the order is `..., owner-commands, connector-contract, exit-proof` once the codex entry sits before connector-contract. The lead resolves it at merge |

After the commit (the new files tracked): `val-projectos-port-credit1a` PASS (197 real files judged; 157 fixture and 59 record mutations killed); `kernel-followup1a`, `memory-owner-commands1a` and `validate-no-secrets` re-run and PASS.

## Converge

### Drifted from the spec, and why

1. **`agent/src/commands/tenant.ts`: one word, `export` on `nodeTerminal`.** Not in the MODIFIED list. The brief said to reuse the tenant receipt's prompt and not invent a second; `nodeTerminal` was the private function that reads the real terminal. It is not in Baseline section 4 (only `core/src/tenant.ts` is), and no validator pins its text (`tenant-principal1a` and `kernel-platform-stop1a` still pass). Pinned by OC-1 (`the-tenant-terminal-goes-private`).
2. **`agent/test/platformStop.test.ts`: six rows.** Its test "classifies every command cli.ts dispatches" failed without a row for `memory`. Five refused-under-stop rows and one read-only row.
3. **`val-projectos-port-memory1a.cjs`: narrowed as the spec allows** (see above). `val-projectos-context-manager1a` was not edited.
4. **`memory index delete` is added** beside the five commands the ADDED list names. The goal line lists `delete` beside `index`, and `deleteDerivedIndex` has no other caller. It is P2, needs no owner, and is recorded in the ledger.
5. **`ownerTerminalVerifier.ts` was written before its tests.** The command tests were written first and failed (module absent); the verifier is exercised by the same test file and by the validator's OC-1, OC-2 and OC-8 mutations.
6. **Rule 3 is stricter than the deletion rule.** `judgeMemoryDeletion` lets the owner delete a cited item; the spec's rule 3 says the command refuses. The refusal is made inside the ask (a wrapping verifier), so the ledger records `refused` with `citedByDecision` and the owner is never asked. The code printed is `MEMORY_DELETE_CITED_BY_DECISION` or `MEMORY_DELETE_DECISIONS_UNREADABLE`; the ledger code is `DELETE_OWNER_NOT_VERIFIED`.
7. **What "the provenance replacement check" means for a proposal** (the spec does not say). `provenanceReplacementProblem(writer, target)` is asked before the owner is, for replace and remove only. Writer: `summary` if the proposal's kind is summary, else `recollection`. Target: `committed-decision` if the entry's recorded kind is `decision` or there is no record, else `approved-memory`. The owner's own non-summary proposal is not a stand-in and skips it (the existing decision rule already treats it that way). Effect: a proposal authored by a worker, or any summary, can add but cannot replace or remove an entry, even when the owner would type the code. See owner question 1.

### Not built, or uncertain

- **No real-terminal run.** Every test uses a fake terminal. The prompt reads through the tenant receipt's `askTerminal`, which `test/support/conpty.ps1` can drive, but no real console session was run here. It needs the owner once in PowerShell or Windows Terminal: `projectos memory delete --path .projectops/memory/MEMORY.md --reason test`, then type something wrong.
- **The typed code proves a terminal, not a person.** The code is shown on the screen it is asked on, as the tenant receipt's blob prefix is. Every decision answer prints `OWNER_CONFIRMATION_STATEMENT` saying so.
- **The ledger head is printed, not committed.** The owner commits `.projectops/memory-deletions`. A deletion removes the working-tree file only; git still holds the committed bytes until the deletion is committed.
- **The replacement check is outside the memory lock.** It runs before the owner is asked and again, in part, inside `approveMemoryProposal` (the decision-protection rule). A store that changes between the two is judged by the second only. The lock-held `checkMemoryProposal` still refuses a stale pin.
- **`checkoutIdentityOf` ignores `ctx.tenantInstallRoot`** (it reads `tenantSourceOf({})`), so the identity tests inject the identity as a dependency and do not exercise the real registry. Rule 7 is pinned (OC-7) and tested through the injected function, as the context manager's checkout tests are.
- **A proposal the admission scan refuses cannot exist,** so the display of hostile proposal text is tested with fence-forging text, and control characters through `visibleText` and through a deleted item's text.
- **`memory proposals` lists at most 20** and says how many more wait; at most 5 unreadable names are shown.
- **`runner.ts` is untouched** (the proposal door is phase C). No skill reviewer verifier, no taint enforcement, no PX-12.
- **The test and validator files are over 400 lines** (748 and 422); the sources are 548 and 187.

### Protected files

`git diff --stat` before the commit shows exactly: `cli.ts` (+6), `commands/tenant.ts` (+1 -1), `index.ts` (+14), `platformStop.test.ts` (+6), `val-projectos-port-memory1a.cjs` (+11 -2), `validate-all.cjs` (+2), `cached-runner.cjs` (+2), plus the new files. Of the Baseline section 4 files only `validate-all.cjs` is touched, and only by its registration (one comment line and one entry, immediately before `connector-contract1a`; the same two lines in `cached-runner.cjs`). Untouched: `commands/run.ts`, `loop/workers.ts`, `loop/runner.ts`, `action-registry.json`, `actionRegistry.ts`, `taskEnvelope.ts`, `core/src/tenant.ts`, credentials, the broker, `projectos/host`, SQL, `.projectops/`, `docs/06_Plan.md`. Nothing under `projectos/core/src` changed (it stays browser-pure; neither new file imports a `node:` module).

### Owner questions

1. **Should a worker's or a summary's proposal be able to replace or remove approved memory if the owner approves it?** Today the rank rule says no (it can only add), because `provenanceReplacementProblem` ranks a worker's text below approved memory. The alternative is to let the owner's typed approval override the rank for a non-decision entry, which loosens the rule. Say which.
2. **Should the command also refuse deleting a path no decision cites but that a plan cites?** Only committed decisions are checked, as the deletion rule does.
3. **Real-terminal acceptance:** one run in PowerShell, as above, is the proof this was not done with fakes alone.
