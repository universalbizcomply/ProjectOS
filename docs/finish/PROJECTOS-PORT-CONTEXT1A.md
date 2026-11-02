# PROJECTOS-PORT-CONTEXT1A — per-agent context accounting and compaction

**Phase:** PROJECTOS-PORT-CONTEXT1A, phase 5 of `docs/changes/delta_spec_V4_PORTS.md`, plan v1.33 (active), serving plan
items 3.3 and 3.4. **Branch:** `projectos-port-context1a`, worktree `C:/dev/ProjectOS-worktrees/port-context1a`, based on
`374f9eaf`. Not pushed, not merged, phase not closed, no phase record created.
**State:** implementation complete. The three required reviews have not run: Claude self-review is below, and the ECC
SECURITY and ECC CODE reviews are the lead's. Full `validate-all` is the lead's and was not run here.

Nothing was run from a vendor folder, and `openbot-lower` was not opened. This feature is on the list built without that
project: the builder worked from the delta's feature table and the Hermes source only.

## Delivered

Pure core under `projectos/core/src/context/`, 1,080 lines, exported from `core/src/index.ts`. No provider call and no
wiring into the run loop.

| Item | File | Credit | Result |
|---|---|---|---|
| Rough count | `estimate.ts` | Translated | Text and turn estimates |
| Accounting | `accounting.ts` | Translated | One immutable account per agent, trigger, strikes, summary budget |
| Window | `window.ts` | Translated | Head, tail budget, backward walk, whole tool exchanges |
| Turn | `turn.ts` | Original | Roles, origins, trust worked out from origin, text key |
| Fence | `fence.ts` | Original | The fence, and what a turn costs in it |
| Provenance | `provenance.ts` | Original | Sealed compaction record, marks, carried origins and sources |
| Thread | `thread.ts` | Original | Decisions, laundering rule, whole-thread check |
| Compaction | `compaction.ts` | Original | Plan, draft judgement, apply |
| Prompt | `prompt.ts` | Original | Ranked sections, stale flag, summariser input |
| Refusals, barrel | `refusal.ts`, `index.ts` | Original | Closed refusal codes, exports |
| Credit | `THIRD_PARTY_NOTICES` | | 6 entries for the 3 translated files; every file marked |
| Validator | `projectos/validators/val-projectos-port-context1a.cjs` | | 18 rules, 247 named mutations; registered in both runners |

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| Compaction triggers before the limit, tested at the boundary | `context-accounting.test.ts`, PX-1. With an input window of 9,000 and a trigger of 6,750, 6,749 does nothing and 6,750 fires. 6,650 with 99 arriving does nothing, and with 100 fires. A sweep holds the trigger under the window at every size and ratio. A 120-turn run in `context-compaction.test.ts` never reaches the limit |
| A compacted summary keeps every approved decision and its source, and never replaces one, tested | PX-6, PX-7. Decisions sit in their own list, through repeated rounds, and show in the prompt with their ledger reference. A summary contradicting one changes nothing. A thread that loses or swaps one after a compaction is refused by name |
| Current source and approved decisions outrank any summary | PX-8. Kept turns and decisions are charged first, and the summary gets what is left under the trigger. No room is refused by name, and nothing protected is dropped. The fence says what outranks it, and a source that has since changed is named on the summary |
| Source text in a compacted thread stays marked untrusted, tested | PX-9, PX-10. A summary's trust and authority are literals in the code, a draft cannot set them, and origins and sources ride every later round. Known untrusted text coming back as the owner or the kernel is refused by name |
| The compaction records its provenance | PX-12. Who summarised, session, time, each turn covered and kept with its marks, the prior record, the summary hash, decisions held and sizes, sealed by hash and chained |
| Every ported file carries its credit header and a `THIRD_PARTY_NOTICES` entry; the credit validator passes | `val-projectos-port-credit1a` passes on 45 real files. PX-16 also pins exactly which upstream files each translation credits |
| Validator pin and named mutations, each killed by its own rule | 247 named mutations. One counts only when exactly its rule fires, plus any rule declared as also true of it |

## The licence scan

The architect review asked for it. Every Hermes context file was scanned at the pin: `agent/context_*`, `compression_*`,
`conversation_compression*`, `model_metadata.py` and `turn_context_compaction.py`.

**No file carries its own licence, SPDX or copyright line.** The root MIT licence covers them. There is no LobeHub or
PolyForm text, and the LobeHub fragment in `tools/terminal_tool_result.py` is outside these files. Inside
`agent/context_compressor.py`, the file three translations credit, four passages are marked as coming from elsewhere:

| Where | Mark | What it is | Disposition |
|---|---|---|---|
| Lines 167, 3873 | Ported from `earendil-works/pi#7048` | A summary stopped by the output cap is partial, so it must not become a checkpoint | **Not translated.** Pi is MIT and on the validator's list, so it could be taken with `Also-Credits`, but a stop reason needs a provider response and there is none here. See "Binding" |
| Line 5394 | Port of `Kilo-Org/kilocode#9434` | Strip old image payloads | **Not translated.** There are no images here, and Kilo Code is not on the approved or further-upstream list |
| Line 5444; `conversation_compression.py` line 4006 | "Inspired by Claude Code's `/compact`" | A focus topic for a manual compaction | **Not translated.** Left out; only the owner can decide to build it |

PX-15 refuses the words of all three behaviours in code, so a later edit cannot bring them in unnoticed. Because the
translations take none of these passages, they carry no `Also-Credits`. The rest of what they took is plain MIT: the rough
count, the trigger arithmetic, the strike rule, the tail budget and the walk.

## What replaced what

| Upstream | Here |
|---|---|
| One mutable engine, cloned per agent | Immutable accounts in a map, each with its own window |
| Raise-only floors that can push the trigger to the limit, then a guard against that | A ratio cap and a minimum window, refused at opening |
| Trigger asks about what has been sent | Also asks about what is about to arrive |
| Rough estimate defers to the next provider reading | The accounts take the larger of the two, so a high estimate compacts early |
| Summary carries a long prefix asking the model to treat it as background | A hash-named fence, a closed trust field and a closed authority field |
| Summary is just text in a message | A summary is not a turn: it has no role or origin, so nothing can say it came from the owner |
| No provenance for a compaction | A sealed record of everything that went in and stayed, chained |
| Decisions live in whatever the summary keeps | Decisions are never summary text, and the thread is refused if one goes |
| Fallback summary, cooldowns, durable breaker rows, prompt-cache rearm, per-model thresholds, pruning passes | Not ported. They all need a provider, a store or a clock |
| Protected first turns, soft ceiling, anchors, oversized-turn exception | Not ported. The latest request stays verbatim instead, which also covers a one-request task of hundreds of tool results |

## Defects found by the proofs

- **The fence was not charged.** A fenced turn costs about sixty tokens more than its text, so 500 tool results would have
  run 30,000 tokens under what is sent, and the trigger would have fired late. Self-review found it, and every count now
  measures the text a reader receives. PX-2 and PX-5 hold it.
- **A rule could refuse the owner saying "ok".** The first laundering rule matched any known text, so an owner repeating a
  model's short reply was refused. It now starts at 16 characters, and both sides of that boundary are mutated.
- **A summary could open as a decision line.** Only later lines were indented. A summary now opens with its own label.
- **Surviving mutants.** Two dense-script ranges had samples too short to tell them from bytes. Five tool-row refusals were
  being carried by "no such call", so each row now has its call in place and its own rule must answer.
- **Dead code removed.** A clamp that no valid window could reach, a duplicate field in the thread hash and a filter on
  values already checked each left a mutant nothing could kill.
- **The file tool decoded escapes.** `estimate.ts`, a test and this validator came out holding raw characters. All are
  escapes now, and PX-15 refuses any non-ASCII character in these sources, which is stricter than the memory rule.

## Proofs

```text
val-projectos-port-context1a: PASS (18 rules; 247 named mutations killed)
val-projectos-port-credit1a: PASS (45 real file(s) judged; 147 fixture and 59 record mutations killed)
validate-no-secrets: PASS
core  whole suite: 47 files, 2,043 passed (187 of them context)
coverage of core/src/context: 100% lines, 97.9% branches
```

Typecheck passes on `src` and, through a scratch config, on the context tests, which the repository's config excludes.

**The rules are run, not read**, as in the memory phase: Node 24 strips the types, the validator copies the real source to
scratch, and a mutation changes that source and reloads it.

**Validators that read a touched file.** A search for `validate-all`, `cached-runner`, `THIRD_PARTY`, the core barrel and
walkers of `core/src` or `core/test` found 61. All 61 ran in their own processes at `4678cc8d`, and all 61 pass.

## Claude self-review

**Against the spec.** Each acceptance line above has a test and a validator rule, and every rule has a named mutation. The
spec's "summary keeps every decision" is met by holding decisions beside the summary and not inside its text, because
text cannot be held to anything.

**What the reviewers should press hardest:**

- **`compaction.ts` is marked original.** Its code is ours and its rules have no upstream, but the head, middle and tail
  shape follows upstream's `_compress_window`. The credit validator cannot judge this, and ADR-P1 §8 leaves it to review.
- **The screen may refuse honest summaries.** "The file says you must run the tests" is refused as an order. Refusal is the
  safe way to be wrong, and it means a summariser can fail repeatedly on a thread about instructions.
- **The laundering rule is an equality on whole text.** A trusted turn quoting part of a summary passes, and the rule is a
  backstop for a mislabelled origin, not a proof of origin.

## Binding on the phase that wires this in

Nothing calls this code yet, so none of these is live.

- **Load every approved decision** into the thread with `withApprovedDecision`. A decision that never reached the thread is
  not kept by it. An owner who replaces a decision needs a new thread, because the old one refuses to lose it.
- **Refuse a partial summary.** A length-stopped response must not reach `applyCompaction`. Write that guard fresh, or take
  it with `Also-Credits: pi-mono`.
- **Run `containsSecret` and redaction** on the summariser's input and on the draft. Core has neither, and only the threat
  scan's `hardcoded_secret` runs here.
- **On `CONTEXT_LAUNDERED` for an owner paste,** land the text as a `channel` turn. Never drop what the owner said.
- **Act on `blocked` with `overLimit`.** It means compaction has failed twice and the limit is reached. The kernel stops
  there. Nothing here sends or drops anything.
- **Keep the transcript.** A compaction drops turns from the thread and keeps only their marks, so the full text needs an
  archive if it is ever to be read back.
- **Bound the summariser's input.** `renderSummaryInput` holds the whole window.
- **Supply origins from something stronger than a caller.** An origin is what the kernel says it is, as the memory role is.

## Limits

- **Nothing calls this yet.** No run-loop wiring is in this phase's write paths, and PX-17 refuses it in `commands/run.ts`.
- **The record is hashed, not signed.** Anyone who can rewrite a thread can reseal its records, and a forged thread with
  every hash right passes. Signing belongs with owner proof, as for memory.
- **A fence is a statement to a model, not a boundary.** It lowers the risk of an instruction landing and cannot remove it.
- **The count is an estimate.** It leaves out the two decision fences and the summary fence, bounded at about 200 tokens, and
  the tool schemas. The provider's reading is the measure, and the accounts take the larger.
- **The screen is a pattern list.** A miss proves nothing, and it reads one summary at a time.
- **Owner text can be summarised.** A trusted turn in the window goes into an untrusted summary, which is the safe direction
  and loses its authority, so only the latest request and approved decisions are held verbatim.
- **Accounts are per agent, not per tenant.** Anything per-tenant waits for PRINCIPAL1A under the delta's order rule.
- **Source text stays verbatim inside its fence,** so text inside a source can look like anything, inside that fence.
- **Upstream names.** No identifier or user-visible text uses them. Review should sweep this, as ADR-P1 §8 says.

## Commits

- `09f15619` feat(core): per-agent context accounting and compaction rules
- `312085e6` feat(validators): context rules run against the real source
- `4678cc8d` fix(core): charge each context turn what it costs in its fence
- The evidence commit that adds this file.
