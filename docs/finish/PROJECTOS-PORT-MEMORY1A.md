# PROJECTOS-PORT-MEMORY1A — capped memory with proposals and a threat scan

**Phase:** PROJECTOS-PORT-MEMORY1A, phase 3 of `docs/changes/delta_spec_V4_PORTS.md`, plan v1.31 (active), port C8.
**Branch:** `projectos-port-memory1a`, worktree `C:/dev/ProjectOS-worktrees/port-memory1a`, based on
`projectos-port-foundation1a` at `44e7ef2c`. Not pushed, not merged, phase not closed, no phase record created.
**State:** implementation complete, with one required validator red for a known reason (see "The credit validator").
The required reviews are the lead's and have not happened. Full `validate-all` is the lead's and was not run here.

Nothing was run from a vendor folder, and `openbot-lower` was not opened.

## Delivered

| Item | File | Result |
|---|---|---|
| Threat scan | `projectos/core/src/memory/threatScan.ts` | 37 patterns, translated. Pure |
| Capped store rules | `projectos/core/src/memory/store.ts` | 2,200 and 1,375 character caps, §-delimited entries, entry hash. Pure |
| Admission rules | `projectos/core/src/memory/admission.ts` | Instruction screen, exact duplicate key, relative-time phrase. Pure |
| Proposals | `projectos/core/src/memory/proposal.ts` | Build, check, decide, apply. Pure |
| Prompt block | `projectos/core/src/memory/prompt.ts` | The one way memory reaches a prompt. Pure |
| Shared type | `projectos/core/src/memory/hashPinned.ts` | `HashPinnedProposal`, `HashPinnedDecision`, `HashPinnedOutcome`, for this phase and PORT-APPROVALS1A |
| Files | `projectos/agent/src/memory/memoryFiles.ts` | Strict reads, atomic writes, a create-if-absent lock, on the `System` port |
| Queue | `projectos/agent/src/memory/proposalQueue.ts` | Propose, list, approve, reject. The only code that writes a store |
| Credit | `THIRD_PARTY_NOTICES` | 11 entries. Seven translated files carry headers; three are marked original |
| Validator | `projectos/validators/val-projectos-port-memory1a.cjs` | 20 rules, 161 named mutations; registered in both runners |

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| A memory write is a proposal; nothing lands without approval, and approval goes stale when the entry changes, tested | `core/test/memory-proposal.test.ts`, `agent/test/memoryQueue.test.ts`. PM-5 and PM-7, with positive controls |
| An over-limit write is refused, and a threat-pattern hit is refused by name, tested with a positive control | PM-1 and PM-4. Exactly 2,200 passes and 2,201 is refused. Every one of the 37 patterns has a sample and its own mutation under PM-3 |
| A summary can never overwrite an approved decision, tested | PM-10. It holds at approval, against the owner's own summary, and against an agent relabelling the text as a fact or a decision |
| Every ported file carries its credit header and a `THIRD_PARTY_NOTICES` entry; the credit validator passes | **Partly.** The credit rules judge 11 real files with 0 refusals. The validator's self-test fails on a known defect, below |
| Validator pin and named mutations, each killed by its own rule | 161 named mutations. One counts only when exactly its rule fires, plus any rule declared as also true of it |

## What replaced what

| Upstream | Here |
|---|---|
| `write_approval` boolean, off by default, so writes are free | No boolean. Every write is a proposal |
| Background self-review writes memory | Not ported. PM-16 refuses the words and any timer |
| Auto-safe approval of a clean capture | Not ported. Only the owner approves |
| `expected_revision` optional | `reviewedHash` required |
| Instruction screen only on the model's path, with `procedure` exempt | Screens every author who is not the owner, with no exemption by kind |
| Entry starting `[BLOCKED:` skips the scan at load | No skip |
| Over-limit store rides into the prompt with a warning | Refused, not truncated |
| Scan drops text past 65,536 characters and passes it | Refused, unread |
| Failed stage logs and reports success | The caller is told |
| No provenance | Author, role, session, time, hash, and who approved |

**Not ported, on purpose:** `patch` (a proposal carries the whole entry), batches and the consolidation retry cap
(consolidation is refused), the drift backup (a remove now shows the reviewer the whole entry it would delete), the
similar-wording hint (it needs stemming), and record TTLs. Plain `§` files stay, plus a provenance file beside each.

## Defects found by the proofs

- **An entry ending in a bare `§` line.** It read back fine while it was last, then split the store on the next add,
  after which every write was refused. My first check missed it, and PM-2 failed on the first run. The round trip now
  judges the last entry as if another follows.
- **Raw invisible characters in the source.** The file tool decoded `\uXXXX` escapes, so `admission.ts`, `store.ts`,
  `memoryFiles.ts` and four test files held raw zero-width, byte-order-mark and replacement characters. In a threat
  scanner that is the attack class it looks for, and no reader could see it. Two mutations stopped applying, which is
  how it surfaced. All are escapes now, and PM-3 refuses a raw one.
- **A weak proof.** "A remove is never refused for size" left the store under the cap, so the mutation that refused it
  survived. The test and the probe now stay over the cap.
- **Dead code.** The mutation on the byte-order-mark removal survived, because `trim` already removes it. The line is gone.
- **Equivalent mutants.** Content, pin and provenance hash are each held twice, so removing one check proves nothing.
  Those mutations now remove both.

## Proofs

```text
val-projectos-port-memory1a: PASS (20 rules; 161 named mutations killed)
val-projectos-port-credit1a: 10 error(s)        (expected, see below)
validate-no-secrets: PASS
core  whole suite: 36 files, 1,409 passed (223 of them memory)
agent memory tests: 1 file, 52 passed
```

**Validators that read a touched file.** A grep over `validate-all`, `cached-runner`, `THIRD_PARTY`, the core barrel and
walkers of `core/src` or `agent/src` found 42, and each ran in its own process: **41 pass and the credit validator fails
as expected.** `val-cd-b4-production-ipc-provider1a` is a Rust build fixture that hit a 240-second limit with six running
at once, and it passed alone. On the committed tree, this validator, `validate-no-secrets`,
`validate-speed-validation-cache` and `val-projectos-tenant-contract1a` were run again and passed. The agent's other test
files were not run, because no existing agent file changed.

**The rules are run, not read.** Node 24 runs TypeScript by stripping its types, so the validator copies the real source
to a scratch directory, imports it and calls the real functions. A mutation changes that source and reloads it, so
removing a rule makes its probe fail. It needs no build and no dependency. `authoringEvidence.js` is the one stand-in,
because it drags in the loop's verification chain; PM-15 pins the import, and `memoryQueue.test.ts` uses the real one.

**How the agent tests ran.** In this worktree `agent/node_modules/@projectos/core` is a junction to another worktree's
older build, and `node_modules` was not touched. So the agent tests and typecheck used a scratch config that aliases
the package to this worktree's source. After merge, `core` must be built before the agent tests run.

## The credit validator

`val-projectos-port-credit1a` fails, and the lead has said a fix is in hand. It was not edited. It is outside this
phase's write paths, and this branch rebases onto the fix.

- **The cause.** `selfTest` appends its fixture entries to the real notices. Once a real entry exists, the fixture tree
  does not hold that file, so PC-16 calls it stale, and `store.ts` collides with a fixture of the same name.
- **The real tree is clean.** `judgeRoot` on this worktree: 11 files judged, 0 refusals. PM-18 calls the same rules
  directly, and adds what they cannot see: the exact upstream files each translation must credit.
- **A fix that works.** Compiled in memory under the validator's real filename, not written to disk, this passes the
  whole self-test: replace `noticesText + FIXTURE_ENTRIES` with
  `` `${noticesText.split("\nENTRY: ")[0]}\n` + FIXTURE_ENTRIES ``.

## Limits

- **Nothing calls this yet.** No CLI command and no run-loop wiring are in this phase's write paths, and
  `agent/src/index.ts` does not export it. `proposeMemoryWrite`, and the rest, are reachable only from code.
- **"Owner" is the caller's word.** `by: 'owner'` is a claimed role, on the same terms as `projectos approve --as owner`.
  Whoever wires this in must get it from something stronger before a worker can reach it.
- **The files are only files.** A project's work can write `.projectops/`, so a worker with disk access could write the
  store, the provenance file or a resealed proposal directly: the hash detects a mistake or an edit, and it is not a
  signature. What still holds then: the threat scan at render, the fence, and that memory grants nothing.
- **The scan is a pattern list.** A miss proves nothing. It does not fold cross-script look-alikes, and it does not
  decode `\uXXXX` text. That is why memory stays fenced after it passes.
- **The fence is a statement to a model, not a boundary.**
- **The credential check is the agent's vocabulary** (`containsSecret`), so a credential with no known shape passes it.
- **A crash can leave spare provenance** for a removed entry until the next write prunes it. A hand re-insertion of that
  exact text would then show as approved, which it once was.
- **A lock left by a killed process blocks** until the named file is removed, as the degraded ledger does.
- **Upstream names.** The patterns still match `.hermes` and `HERMES`, as paths to detect. No identifier or
  user-visible text uses them as branding. Review should sweep this, as ADR-P1 §8 says.

## Commits

- `98838237` feat(core): capped memory rules, threat scan and hash-pinned proposals
- `e52e5f53` feat(agent): the memory proposal queue on the System port
- `3296116b` feat(validators): the memory rules, run against the real source
- The evidence commit that adds this file.
