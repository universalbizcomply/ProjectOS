# PROJECTOS-PORT-APPROVALS1A — approval binding, taint tracking and evidence receipts

**Phase:** PROJECTOS-PORT-APPROVALS1A, phase 6 of `docs/changes/delta_spec_V4_PORTS.md`, plan v1.31 (active).
**Branch:** `projectos-port-approvals1a`, worktree `C:/dev/ProjectOS-worktrees/port-approvals1a`, based on
`projectos-port-foundation1a` at `44e7ef2c`. Not pushed, not merged, phase not closed, no phase record created.
**State:** implementation complete and one review round applied. Full `validate-all` is the lead's and was not run
here. `val-projectos-port-credit1a` fails on this branch, as expected: see below.

Nothing is wired into the run loop. No gate was loosened or replaced. No model-judged approval and no no-approval
mode was ported. Nothing was run from a vendor folder.

## BINDING on the phase that wires this in

These are conditions of wiring, decided in the review round. Owner proof was deliberately not attempted in core.

1. `decidedBy` must become a Host-authenticated owner proof, not a role string.
2. An approval names its envelope, with action = tool and subjectHash = argumentHash.
3. Unmediated CLI workers start tainted, with taint recorded before the model reads, because taint is sound only under
   complete mediation.
4. The kernel runs receipt checks itself and pins definition hashes.
5. The owner sees canonical bytes and taint sources, never model summaries.

Two more follow from the code. An approval can never answer the envelope grant port: the door decides P3 and P5 on its
own grants, and `ToolApproval` says so on the type. And the tool must run the `canonicalArguments` a clear result
returns, not the object it was handed, or the binding says nothing about what ran.

## Reviews

- ECC SECURITY: APPROVE WITH CHANGES. It reproduced items 1 to 4 below by probe.
- Agency application-security-engineer: APPROVE WITH CHANGES.

| # | Finding | Disposition |
|---|---|---|
| 1 | Replay: the spent list and generation belonged to one guard, so attempt 2 or a second `startRunGuard` passed a spent approval | **Fixed.** A kernel-supplied lineage token stamps the chain, approvals carry it and the check compares it. Spent state and the count live on the lineage. A second guard never starts clean. AP-36, both routes |
| 2 | Lost taint: a result recorded on a retired guard was dropped | **Fixed.** A dead-handle write throws, and counts on the lineage first. A cleared call leaves a result pending, and the next check refuses until it is recorded. AP-37 |
| 3 | Receipts: the required list came from the claim, and command and scope were not compared | **Fixed.** `declarePlanChecks` issues the requirements, and a claim has no field for them. Command and scope compare exactly. A receipt records `observedBy`, and an observer equal to the implementer is refused. AP-38, AP-39 |
| 4 | Shared-reference expansion took 18 s at depth 22 | **Fixed.** Node and byte budgets, counted as the walk goes. AP-40. The finish note on blank ids is corrected below |
| 5 | `passed` read as permission | **Fixed.** Renamed `taintClear`. A test shows a clean P5 cleared here with an approval in hand, and refused by the door. The type comment states the grant-port rule |
| 6 | Tighten | **Fixed.** A future `decidedAt` is refused, the lifetime is capped at one hour (AP-41), own-state entries must be registered P1 local actions with an exact match (AP-42), and mint functions are off the public barrel (AP-32) |
| 6 | Review `bridge-read` and `run_validators` | **Found they can carry content off the machine, and they no longer skip approval.** See below |

**What the P1 review found.** `bridge-read` answers a conversation on the far side of the tunnel: `mcp/bridge.ts` says
its far end is a ChatGPT conversation, so every answer leaves the machine although the registry says `local`.
`run_validators` runs repository scripts as the owner's user, with the network. `perform_review`, `architect_phase` and
`recommend_closure` hand content to a reviewer. All five are P1 `local` and all five now need a fresh approval once
tainted. Only `project-selection` stays free, and `CONFINED_READS` names it by hand, so a new P1 local action is
steerable until someone shows otherwise.

**The registry is still wrong about `bridge-read`.** `local` under-declares it. Fixing that is a change to
`projectos/security/action-registry.json`, which is a P5 `action-registry-change` and outside this phase. The fix is one
word, `production`, by the owner or a phase that holds that grant, and `val-projectos-tenant-contract1a` pins the
table, so its `ACTION_TABLE` moves with it. The taint rule does not depend on it.

## Delivered

| Item | File | Origin |
|---|---|---|
| Effect key: run, tool, argument hash, budgets | `projectos/core/src/approvals/effectKey.ts` | Ported, Apache-2.0 |
| Taint and the lineage of a run | `projectos/core/src/approvals/taint.ts` | Ported, Apache-2.0 |
| Evidence receipts, plan checks and the done claim | `projectos/core/src/approvals/evidenceReceipt.ts` | Ported, MIT |
| The owner's approval and the check a call must clear | `projectos/core/src/approvals/toolApproval.ts` | Original |
| Strict instant parsing | `projectos/core/src/approvals/instant.ts` | Original |
| Barrel: checks only, no minting | `projectos/core/src/approvals/index.ts` | Original |
| Core export | `projectos/core/src/index.ts` | One line |
| Credit | `THIRD_PARTY_NOTICES` | Seven entries |
| Validator | `projectos/validators/val-projectos-port-approvals1a.cjs` | 42 rules, registered in both runners |
| Tests | `projectos/core/test/approvals-*.test.ts` | Three files |

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| An approval is refused when the run, tool or argument hash changes by one byte | `approvals-tool-binding.test.ts` walks every character of the run, the tool and the canonical arguments. AP-1 to AP-3 remove each field from the key and require the refused call to go through |
| After untrusted content enters a run, an action it could steer is refused without a fresh approval, with an untainted control | `approvals-taint.test.ts`: every action refused once tainted clears on an untainted run. AP-12 and AP-13 |
| A phase claiming done without its evidence receipt is refused | `approvals-evidence.test.ts`, beside a control that is ready. AP-20 |
| Every ported file carries its credit header and a `THIRD_PARTY_NOTICES` entry; the credit validator passes | Every header and entry is written. The rules pass on the real tree, and the validator's own self-test fails: see below |
| Validator pin and named mutations, each killed by its own rule | 134 named mutations: 77 behaviour over 78 scenarios, and 57 text |

## How the proofs work

A proof counts only if removing its rule makes it fail, so the behaviour rules, AP-1 to AP-26 and AP-36 to AP-42, are
not text pins. The validator compiles the real source in memory, runs every scenario on its own run, removes one rule,
and runs them all again. A refusal scenario counts as killed only when the refused call now goes through. Refused under
another name is not a kill, because that would be a fail-closed default standing behind the rule. Every other scenario
must stay as it was, unless the mutation declares it, and a declared side effect must really move. The two budget
scenarios are expensive and walk only the serializer, so they run for mutations of `effectKey.ts` alone.

AP-27 to AP-35 are about the text of the tree, so they are pinned and mutated in memory, and each mutation counts only
when its own rule fires.

**Rules with no kill.** By the owner's rule these are tested and not proved. The depth limit in `effectKey.ts` has a
fail-closed default behind it: removed, a cycle overflows the stack and the catch refuses it anyway. These have a named
test and no mutation: the non-JSON branch in `serialize`, the `BAD_DECISION` checks, the receipt's field checks other
than `source`, and the plan's field checks.

**Corrected.** An earlier version of this record listed the blank run and tool checks in `deriveToolEffect` among rules
with something else refusing behind them. That was wrong: nothing else refused a blank id. Both now have a scenario and
a kill, AP-1 and AP-2.

## Upstream defaults replaced

| Upstream | Here | Why |
|---|---|---|
| The upstream key was `run:tool:digest` | A hash over a JSON array | The run `a:b` with the tool `c` shared a key with the run `a` with the tool `b:c` |
| `JSON.stringify` of `-0`, large integers, `Object.keys` | Each refused | Each collapses two values into one hash, or drops what the hash should cover |
| Taint is a sticky boolean in mutable run state | A count on a lineage, with one live guard per run | An approval can name the generation it was given at, a kept clean value is dead, and a late write still counts |
| Memory, history and skill reads never taint | A list passed in by kernel code, of registered local reads only, and empty today | A tainted run could write a note that a later run reads clean |
| Reads on a connector already used stay free | Anything but a named confined read needs a fresh approval | The arguments of a read are the leak |
| An empty required list reads as ready | Refused | A gate an empty list clears proves nothing |

## Not ported, on purpose

- `planActionGate`, `ApprovalMode`, `applyJudgeDecision`, the auto-review judge and the rule engine: the refused list in
  the delta. The `never` mode and the `judge` result are the things refused, and neither has a field here.
- `src/quality/completion_integrity.py` was not ported, although it is the natural home of "evidence before done". Its
  docstring and `docs/SKILL-SOURCES.md` say its placeholder evidence values and its negative-case vocabulary follow an
  upstream under the Sustainable Use License 1.0. That licence is not on the approved list, a credit would not cure it
  (ADR-P1 §5), and AP-31 refuses the file and that vocabulary. Receipts are structural here, so no word list is needed.

## What this does not prove

- **The call sites.** See the binding terms. `decidedBy`, `ownerStarted`, the lineage token, `observedBy`, the
  implementer and every call that records content are handed in by kernel code. Provenance stops a worker's JSON from
  being an approval, a guard, a receipt or a plan. It cannot stop kernel code calling these for the wrong reason, and
  there are no call sites yet.
- **Complete mediation.** The pending state catches a call site that forgets a result. It does not catch a tool that
  never passed `checkToolCall`.
- **Persistence.** The lineage lives in one process. A guard, an approval and a receipt do not survive a restart. A
  restart is a later attempt, which begins tainted, so that is safe for taint and approvals. A receipt needs a read-back
  design from the phase that wires it in.
- **One call at a time.** A pending result blocks the next check, so a run's tool calls are serial. A dead-handle write
  stops the run until a new guard is started. Both are deliberate, and parallel tool calls would need a pending set.
- **Memory.** The module keeps one guard per run for the life of the process, with no eviction: evicting one would let a
  second guard start clean. A long-lived Host needs a decision on this.
- **A number's raw text.** Two decimals that parse to the same double are one value here, as the owner would see them.
- **An untainted run.** On a clean run `checkToolCall` clears a P3 action with no approval. That is the door's job, and
  `taintClear` is not permission.
- **Actor spelling.** `observedBy` and `implementer` compare exactly, so both must come from the same invocation record.

## The credit validator

`node projectos/validators/val-projectos-port-credit1a.cjs` fails on this branch, and that is expected. The coordinator
confirmed the defect and is fixing it, and this phase rebases onto the fix. This phase did not edit that file, which is
outside its `writePaths`, and no header or entry was bent to get past it.

**Cause.** `selfTest` appends its fixture entries to the real notices, so the first real entry is judged against the
fixture tree and fails the positive control: PC-16, stale for a real file and duplicated for `effectKey.ts`.

**Evidence that only the self-test is affected,** from a scratch script that calls the validator's exported functions
and edits nothing, with the real entries cut from the text handed to `selfTest`:

```text
real tree: 6 file(s) judged, 0 refusal(s)
records: 0 problem(s)
self-test with the real entries removed: 0 error(s)
mutations: 75 fixture, 44 record
```

The approvals validator also runs `judgeFile` over all six files, so the credit rules hold it to the same text.

## Shapes to reconcile at stacking

`ToolApproval` is this phase's proposal-with-hash shape: `argumentHash` and `effectKey`, issued in `toolApproval.ts`. It
is deliberately independent of the shape PORT-MEMORY1A defines, and the lead can unify them at stacking.

## Proofs

```text
val-projectos-port-approvals1a: PASS (78 scenarios; 77 behaviour and 57 text mutations killed)
core suite: 34 files, 1366 tests passed, 180 of them in approvals-*.test.ts
tsc --noEmit: clean
```

The review-round tests were written first and failed before the fixes: 93 of 180.

Validators reading a touched file, run directly:

| Validator | Result |
|---|---|
| `val-projectos-port-approvals1a` | PASS |
| `val-projectos-kernel-followup1a` | PASS |
| `validate-speed-validation-cache` | PASS |
| `val-projectos-tenant-contract1a` | PASS |
| `val-projectos-tenant-rls1a` | PASS |
| `val-projectos-v3-validation-evidence1a` | PASS |
| `val-projectos-validator-scratch-lifecycle1a` | PASS |
| `validate-v2-closure-evidence` | PASS |
| `validate-no-secrets` | PASS |
| `val-projectos-port-credit1a` | FAIL, 8 errors, all the PC-16 self-test defect above. Expected until the rebase |
