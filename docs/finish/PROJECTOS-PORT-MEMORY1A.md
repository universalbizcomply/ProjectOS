# PROJECTOS-PORT-MEMORY1A — capped memory with proposals and a threat scan

**Phase:** PROJECTOS-PORT-MEMORY1A, phase 3 of `docs/changes/delta_spec_V4_PORTS.md`, plan v1.31 (active), port C8.
**Branch:** `projectos-port-memory1a`, worktree `C:/dev/ProjectOS-worktrees/port-memory1a`, based on
`projectos-port-foundation1a` at `44e7ef2c`. Not pushed, not merged, phase not closed, no phase record created.
**State:** implementation complete and one review round applied, with one required validator red for a known reason (see
"The credit validator"). Full `validate-all` is the lead's and was not run here.

Nothing was run from a vendor folder, and `openbot-lower` was not opened.

## Delivered

| Item | File | Result |
|---|---|---|
| Threat scan | `projectos/core/src/memory/threatScan.ts` | 39 patterns, 37 translated and 2 added. Pure |
| Capped store rules | `projectos/core/src/memory/store.ts` | 2,200 and 1,375 character caps, §-delimited entries, entry hash. Pure |
| Admission rules | `projectos/core/src/memory/admission.ts` | Instruction screen, exact duplicate key, relative-time phrase. Pure |
| Proposals | `projectos/core/src/memory/proposal.ts` | Build, check, decide, apply, record validation. Pure |
| Prompt block | `projectos/core/src/memory/prompt.ts` | The one way memory reaches a prompt. Pure |
| Shared type | `projectos/core/src/memory/hashPinned.ts` | `HashPinnedProposal`, `HashPinnedDecision`, `HashPinnedOutcome`, for this phase and PORT-APPROVALS1A |
| Files | `projectos/agent/src/memory/memoryFiles.ts` | Strict reads, atomic writes, a create-if-absent lock, on the `System` port |
| Queue | `projectos/agent/src/memory/proposalQueue.ts` | Propose, list, approve, reject. The only code that writes a store |
| Credit | `THIRD_PARTY_NOTICES` | 11 entries. Seven translated files carry headers; four are marked original |
| Validator | `projectos/validators/val-projectos-port-memory1a.cjs` | 20 rules, 197 named mutations; registered in both runners |

**The shared type's path.** `hashPinned.ts` imports nothing from memory, but it sits under `core/src/memory/`, because
that is this phase's write path. A neutral file would be outside it. It stays here, and the lead unifies at stacking.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| A memory write is a proposal; nothing lands without approval, and approval goes stale when the entry changes, tested | `core/test/memory-proposal.test.ts`, `agent/test/memoryQueue.test.ts`. PM-5 and PM-7, with positive controls |
| An over-limit write is refused, and a threat-pattern hit is refused by name, tested with a positive control | PM-1 and PM-4. Exactly 2,200 passes and 2,201 is refused. Every one of the 39 patterns has a sample and its own mutation under PM-3 |
| A summary can never overwrite an approved decision, tested | PM-10. It holds at approval, against the owner's own summary, and against an agent relabelling the text as a fact or a decision |
| Every ported file carries its credit header and a `THIRD_PARTY_NOTICES` entry; the credit validator passes | **Partly.** The credit rules judge 11 real files with 0 refusals. The validator's self-test fails on a known defect, below |
| Validator pin and named mutations, each killed by its own rule | 197 named mutations. One counts only when exactly its rule fires, plus any rule declared as also true of it |

## Reviews and dispositions

Round 1, at `c08fd5d4`: ECC SECURITY (one HIGH) and ECC CODE. Their findings reached this builder merged into one
decided list from the lead, so this table does not say which review raised which item. The fixes are in the commits below.
The tests were written first: 53 core and 57 agent tests failed before the source changed. The agent figure includes every
test that calls the new signature.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | HIGH | Control, default-ignorable and separator characters and keyword-free comments passed admission, so an escape sequence could hide text from a terminal reviewer | **Fixed.** Refuses `Cc` except newline and tab, `Cf`, default-ignorable, U+2028, U+2029, `<!--` and `[//]:`. The cap is asked before the scan, at proposal and at approval |
| 2 | MEDIUM | A fact could render as a decision line | **Fixed.** Every entry opens with its real kind, and later lines are indented. This also covers a forged first line, which the finding did not name |
| 3 | MEDIUM | `authorRole` was self-asserted, and claiming owner skipped the screen and decision protection | **Fixed.** `MemoryCaller` comes from the kernel and overrides the request. No role skips any screen. It stays caller-asserted, see Limits |
| 4 | MEDIUM | `ledgerRef` unbounded and unscanned; 4 of 11 record fields checked | **Fixed.** `isMemoryEntryProvenance` checks all 11, with a 256-character cap, at the file and again at the prompt |
| 5 | MEDIUM | A file marked approved could be landed | **Fixed.** Only a pending file is read. `APPROVED_HERE` holds the objects `decideMemoryProposal` approved, so a copy or a file lands nothing |
| 6 | MEDIUM | `return` in `finally` replaced the result, and a test accepted it | **Fixed.** The answer is returned with a `warning` beside it, and the test now requires that |
| 7 | MEDIUM | A failure after the store moved said "stays pending" | **Fixed.** `MEMORY_LANDED_INCOMPLETE`. A failed prune no longer skips marking the proposal |
| 8 | MEDIUM | CRLF text was refused as splitting | **Fixed.** Line endings fold before the trim |
| 9 | MEDIUM | Evidence claims too strong; the render skipped the screen | **Fixed in part, as decided.** The render has the instruction screen. Both gaps are stated in Limits |
| — | LOW | File name against proposal id; `startsWith`; casts; JSON wording; pending cap | **All fixed.** The cap is 50. `MemoryRefused` removes the casts |
| — | CARRY | Injection split across entries; base64 and look-alikes | **Carried**, see Limits |

## What replaced what

| Upstream | Here |
|---|---|
| `write_approval` boolean, off by default, so writes are free | No boolean. Every write is a proposal |
| Background self-review writes memory | Not ported. PM-16 refuses the words and any timer |
| Auto-safe approval of a clean capture | Not ported. Only the owner approves |
| `expected_revision` optional | `reviewedHash` required |
| Instruction screen only on the model's path, with `procedure` exempt | Screens every author, the owner included, with no exemption, at proposal, approval and prompt |
| Entry starting `[BLOCKED:` skips the scan at load | No skip |
| Over-limit store rides into the prompt with a warning | Refused before it is read, not truncated |
| Scan drops text past 65,536 characters and passes it | Refused, unread |
| Failed stage logs and reports success | The caller is told |
| No provenance | Author, role, session, time, hash, and who approved |

**Not ported, on purpose:** `patch` (a proposal carries the whole entry), batches and the consolidation retry cap
(consolidation is refused), the drift backup (a remove now shows the reviewer the whole entry it would delete), the
similar-wording hint (it needs stemming), and record TTLs. Plain `§` files stay, plus a provenance file beside each.

## Defects found by the proofs

- **An entry ending in a bare `§` line.** It read back fine while it was last, then split the store on the next add,
  after which every write was refused. PM-2 failed on the first run. The round trip now judges the last entry as if
  another follows.
- **Raw invisible characters in the source.** The file tool decoded `\uXXXX` escapes, so `admission.ts`, `store.ts`,
  `memoryFiles.ts` and four test files held raw zero-width, byte-order-mark and replacement characters. In a threat
  scanner that is the attack class it looks for, and no reader could see it. All are escapes now, and PM-3 refuses a raw one.
- **Proofs that proved nothing.** Each of these survived or passed for the wrong reason, and each is fixed: "a remove is
  never refused for size" left the store under the cap; my first "last entry" mutation changed nothing; a ledger-reference
  test was being refused by the hash, not its own rule; and a test named for the cap at approval only hit the hash.
  The last two now seal a forgery by hand.
- **Dead code.** The mutation on the byte-order-mark removal survived, because `trim` already removes it. The line is gone.
- **Equivalent mutants.** Content, pin and provenance hash are each held twice, so removing one check proves nothing.
  Those mutations now remove both.

## Proofs

```text
val-projectos-port-memory1a: PASS (20 rules; 197 named mutations killed)
val-projectos-port-credit1a: 10 error(s)        (expected, see below)
validate-no-secrets: PASS
core  whole suite: 36 files, 1,465 passed (279 of them memory)
agent memory tests: 1 file, 69 passed
```

**The rules are run, not read.** Node 24 runs TypeScript by stripping its types, so the validator copies the real source
to a scratch directory, imports it and calls the real functions. A mutation changes that source and reloads it, so
removing a rule makes its probe fail. It needs no build and no dependency. `authoringEvidence.js` is the one stand-in,
because it drags in the loop's verification chain; PM-15 pins the import, and `memoryQueue.test.ts` uses the real one.

**How the agent tests ran.** In this worktree `agent/node_modules/@projectos/core` is a junction to another worktree's
older build, and `node_modules` was not touched. So the agent tests and typecheck used a scratch config that aliases
the package to this worktree's source. After merge, `core` must be built before the agent tests run.

**Validators that read a touched file.** A grep over `validate-all`, `cached-runner`, `THIRD_PARTY`, the core barrel and walkers of `core/src` or `agent/src` found 42. After the review round, 41 of them ran in their own processes: **40 pass and the credit validator fails as expected.** The other, `val-cd-b4-production-ipc-provider1a`, is a Rust build fixture that takes six minutes, reads none of these files and passed alone in the first round, so it was not repeated.

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
  `agent/src/index.ts` does not export it. The queue is reachable only from code.
- **The role stays caller-asserted until owner proof exists.** `MemoryCaller` is supplied by the kernel and cannot come
  from a request, but nothing proves it. It opens exactly two things: deciding a proposal, and writing over a decision. No
  screen depends on it. Whoever wires this in must supply it from something stronger before a worker can reach it.
- **`.projectops/memory/` is not git-ignored, so a cloned or PR-borne file counts.** A project's work can write
  `.projectops/` too. Anyone who can write these files can write a store, a provenance file with every field valid, or a
  proposal resealed by hand: the hash detects a change, and it is not a signature. Such an entry reads as approved. **The
  fix:** ignore `.projectops/memory/`, one line in `.gitignore`, outside this phase's write paths, at the cost that memory
  no longer travels with a clone. Signing the records is the real answer, and it belongs with owner proof.
- **What holds against a forged file, and what does not.** The threat scan and the instruction screen run at the prompt
  on the entry text. The record is checked for shape, so a ledger reference cannot carry prose. But a forged record can
  still label a clean text `decision`, with a reference of the right shape that says nothing true. The fence and the rule
  that memory grants nothing are what remain.
- **The prompt does not run the credential check.** `containsSecret` runs at proposal and at approval. A file written
  around the queue is not checked for credentials at the prompt, only for the threat scan's `hardcoded_secret`.
- **The state of a proposal is not hashed.** Only what was proposed is. A file changed from `rejected` to `pending` reads
  as pending, and it still needs the owner's decision over its hash, and it still faces the pin.
- **The scan is a pattern list.** A miss proves nothing. It reads one entry at a time, so an injection split across
  entries passes. It does not decode base64 or `\uXXXX` text, and it does not fold cross-script look-alikes. That is why
  memory stays fenced after it passes. Refusing default-ignorable characters also refuses an emoji with a variation
  selector or a joiner.
- **The fence is a statement to a model, not a boundary.**
- **The credential check is the agent's vocabulary**, so a credential with no known shape passes it.
- **A crash can leave spare provenance** for a removed entry until the next write prunes it. A hand re-insertion of that
  exact text would then show as approved, which it once was.
- **A lock left by a killed process blocks** until the named file is removed, as the degraded ledger does.
- **Upstream names.** The patterns still match `.hermes` and `HERMES`, as paths to detect. No identifier or
  user-visible text uses them as branding. Review should sweep this, as ADR-P1 §8 says.

## Commits

- `98838237` feat(core): capped memory rules, threat scan and hash-pinned proposals
- `e52e5f53` feat(agent): the memory proposal queue on the System port
- `3296116b` feat(validators): the memory rules, run against the real source
- `c08fd5d4` docs(finish): PROJECTOS-PORT-MEMORY1A evidence
- `fdac7abb` fix(core): memory review round: what a reviewer cannot see, and who may say so
- `7b171e0d` fix(agent): memory queue takes the caller from the kernel and tells the truth
- `91de6924` test(validators): memory rules follow the review round
- The evidence commit that adds this review round.
