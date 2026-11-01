# PROJECTOS-PORT-APPROVALS1A — approval binding, taint tracking and evidence receipts

**Phase:** PROJECTOS-PORT-APPROVALS1A, phase 6 of `docs/changes/delta_spec_V4_PORTS.md`, plan v1.31 (active).
**Branch:** `projectos-port-approvals1a`, worktree `C:/dev/ProjectOS-worktrees/port-approvals1a`, based on
`projectos-port-foundation1a` at `44e7ef2c`. Not pushed, not merged, phase not closed, no phase record created.
**State:** implementation complete. The required reviews are the lead's and have not happened. Full `validate-all`
is the lead's and was not run here. `val-projectos-port-credit1a` fails on this branch, as expected: see below.

Nothing is wired into the run loop. No gate was loosened or replaced. No model-judged approval and no no-approval
mode was ported. Nothing was run from a vendor folder.

## Delivered

| Item | File | Origin |
|---|---|---|
| Effect key: run, tool, argument hash | `projectos/core/src/approvals/effectKey.ts` | Ported, Apache-2.0 |
| Taint on a run guard | `projectos/core/src/approvals/taint.ts` | Ported, Apache-2.0 |
| Evidence receipts and the done claim | `projectos/core/src/approvals/evidenceReceipt.ts` | Ported, MIT |
| The owner's approval and the check a call passes | `projectos/core/src/approvals/toolApproval.ts` | Original |
| Strict instant parsing | `projectos/core/src/approvals/instant.ts` | Original |
| Barrel | `projectos/core/src/approvals/index.ts` | Original |
| Core export | `projectos/core/src/index.ts` | One line |
| Credit | `THIRD_PARTY_NOTICES` | Seven entries |
| Validator | `projectos/validators/val-projectos-port-approvals1a.cjs` | 35 rules, registered in both runners |
| Tests | `projectos/core/test/approvals-*.test.ts` | Three files |

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| An approval is refused when the run, tool or argument hash changes by one byte | `approvals-tool-binding.test.ts` walks every character of the run, the tool and the canonical arguments. AP-1 to AP-3 remove each field from the key and require the refused call to go through |
| After untrusted content enters a run, an action it could steer is refused without a fresh approval, with an untainted control | `approvals-taint.test.ts`: five actions refused once tainted, each passing on the same run untainted. AP-12 and AP-13 |
| A phase claiming done without its evidence receipt is refused | `approvals-evidence.test.ts`, beside a control that passes. AP-20 |
| Every ported file carries its credit header and a `THIRD_PARTY_NOTICES` entry; the credit validator passes | Every header and entry is written. The rules pass on the real tree, and the validator's own self-test fails: see below |
| Validator pin and named mutations, each killed by its own rule | 96 named mutations: 51 behaviour over 51 scenarios, and 45 text. Each behaviour mutation must move its named scenario and nothing undeclared, and each declared side effect must really move |

## How the proofs work

A proof counts only if removing its rule makes it fail, so AP-1 to AP-26 are not text pins. The validator compiles the
real source in memory, runs every scenario, removes one rule, and runs them all again. A refusal scenario counts as
killed only when the refused call now goes through. Refused under another name is not a kill, because that would be a
fail-closed default standing behind the rule. Every other scenario must stay as it was, unless the mutation declares it.

AP-27 to AP-35 are about the text of the tree, so they are pinned and mutated in memory, and each mutation counts only
when its own rule fires.

**Rules with no kill.** By the owner's rule these are tested and not proved, because something else refuses behind
them. The depth limit in `effectKey.ts`: with it removed, a cycle overflows the stack and the catch refuses it anyway.
The non-JSON branch in `serialize`, the blank-field checks in `deriveToolEffect`, the `BAD_DECISION` checks, and the
receipt's field checks other than `source`: each has a named test and no mutation.

## Upstream defaults replaced

| Upstream | Here | Why |
|---|---|---|
| The upstream key was `run:tool:digest` | A hash over a JSON array | The run `a:b` with the tool `c` shared a key with the run `a` with the tool `b:c` |
| `JSON.stringify` of `-0`, large integers, `Object.keys` | Each refused | Each collapses two values into one hash, or drops what the hash should cover |
| Taint is a sticky boolean in mutable run state | A counted generation on a frozen guard, retired by each move | An approval can name the generation it was given at, and a kept clean value is dead |
| Memory, history and skill reads never taint | The list is passed in by kernel code and starts empty | A tainted run could write a note that a later run reads clean |
| Reads on a connector already used stay free | Any action that leaves the machine needs a fresh approval | The arguments of a read are the leak |
| An empty required list reads as ready | Refused | A gate an empty list passes proves nothing |

## Not ported, on purpose

- `planActionGate`, `ApprovalMode`, `applyJudgeDecision`, the auto-review judge and the rule engine: the refused list in
  the delta. The `never` mode and the `judge` result are the things refused, and neither has a field here.
- `src/quality/completion_integrity.py` was not ported, although it is the natural home of "evidence before done". Its
  docstring and `docs/SKILL-SOURCES.md` say its placeholder evidence values and its negative-case vocabulary follow an
  upstream under the Sustainable Use License 1.0. That licence is not on the approved list, a credit would not cure it
  (ADR-P1 §5), and AP-31 refuses the file and that vocabulary. Receipts are structural here, so no word list is needed.

## What this does not prove

- **The call sites.** `decidedBy`, `ownerStarted`, the receipt's `source` and every call that records outside content
  are handed in by kernel code. Provenance stops a worker's JSON from being an approval, a guard or a receipt. It
  cannot stop kernel code calling these for the wrong reason, and there are no call sites yet.
- **Persistence.** A guard, an approval and a receipt live in one process. A restart is a later attempt, which begins
  tainted, so that is safe for taint and approvals. A receipt needs a read-back design from the phase that wires it in.
- **The tool's own bytes.** A pass returns `canonicalArguments`. The binding covers what ran only if the wiring runs
  those bytes rather than the object it was handed.
- **A number's raw text.** Two decimals that parse to the same double are one value here, as the owner would see them.
- **An untainted run.** On a clean run `checkToolCall` passes a P3 action with no approval. That is the kernel's gates'
  job, and a pass here grants nothing.

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
val-projectos-port-approvals1a: PASS (51 scenarios; 51 behaviour and 45 text mutations killed)
core suite: 34 files, 1301 tests passed, 115 of them in approvals-*.test.ts
tsc --noEmit: clean
```

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
