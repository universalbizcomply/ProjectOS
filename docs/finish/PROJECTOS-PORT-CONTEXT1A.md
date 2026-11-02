# PROJECTOS-PORT-CONTEXT1A — per-agent context accounting and compaction

**Phase:** PROJECTOS-PORT-CONTEXT1A, phase 5 of `docs/changes/delta_spec_V4_PORTS.md`, plan v1.33 (active), serving plan
items 3.3 and 3.4. **Branch:** `projectos-port-context1a`, worktree `C:/dev/ProjectOS-worktrees/port-context1a`, based on
`374f9eaf`. Not pushed, not merged, phase not closed, no phase record created.
**State:** implementation complete, and one review round applied at the lead's direction (see "Reviews and dispositions").
Full `validate-all` is the lead's and was not run here.

Nothing was run from a vendor folder, and `openbot-lower` was not opened. This feature is on the list built without that
project: the builder worked from the delta's feature table and the Hermes source only.

## Delivered

Pure core under `projectos/core/src/context/`, exported from `core/src/index.ts`. No provider call and no wiring into the
run loop. Eight files carry a Hermes credit and five are original. The credit on `compaction.ts` is the review's ruling, and
the same re-check added `prompt.ts` and `fence.ts`.

| Item | File | Credit | Result |
|---|---|---|---|
| Rough count | `estimate.ts` | Translated | Text and turn estimates |
| Accounting | `accounting.ts` | Translated | One immutable account per agent, trigger, growth since a reading, strikes, summary budget |
| Window | `window.ts` | Translated | Head, tail budget, backward walk, whole tool exchanges |
| Redaction | `redact.ts` | Translated | Secrets and hidden characters kept from the summariser |
| Draft screen | `draftScreen.ts` | Translated | What may stand as a summary, on a draft and whenever a thread is read |
| Compaction | `compaction.ts` | Adapted | Plan, draft judgement, apply |
| Prompt | `prompt.ts` | Adapted | Ranked sections, stale flag, summariser input |
| Fence | `fence.ts` | Adapted | The fence, and what each part costs as it is sent |
| Turn | `turn.ts` | Original | Roles, origins, trust worked out from origin, text key |
| Provenance | `provenance.ts` | Original | Sealed compaction record, marks, carried origins and sources |
| Thread | `thread.ts` | Original | Decisions, exact-copy tripwire, whole-thread check |
| Refusals, barrel | `refusal.ts`, `index.ts` | Original | Closed refusal codes, exports |
| Credit | `THIRD_PARTY_NOTICES` | | 12 entries for the 8 credited files; every file marked |
| Validator | `projectos/validators/val-projectos-port-context1a.cjs` | | 18 rules, 320 named mutations; registered in both runners |

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| Compaction triggers before the limit, tested at the boundary | `context-accounting.test.ts`, PX-1. With an input window of 9,000 and a trigger of 6,750, 6,749 does nothing and 6,750 fires. 6,650 with 99 arriving does nothing, and with 100 fires. A sweep holds the trigger under the window at every size and ratio. A 120-turn run against a provider that counts 25% more than the estimate, plus a floor it cannot see, never reaches the limit |
| A compacted summary keeps every approved decision and its source, and never replaces one, tested | PX-6, PX-7. Decisions sit in their own list, through repeated rounds, and show in the prompt with their ledger reference. A summary contradicting one changes nothing. A thread that loses or swaps one after a compaction is refused by name |
| Current source and approved decisions outrank any summary | PX-8. Kept turns and decisions are charged first, and the summary gets what is left under the trigger. No room is refused by name, and nothing protected is dropped. The fence says what outranks it, and a source that has since changed is named on the summary |
| Source text in a compacted thread stays marked untrusted, tested | PX-9, PX-10. Trust comes from an origin the kernel assigns, and a summary is never a turn: that is the defence. A summary's trust and authority are literals, a draft cannot set them, and origins and sources ride every later round. It is sent at a model's role, never the system role. An exact copy of known untrusted text coming back as the owner or the kernel is a tripwire and refused by name |
| The compaction records its provenance | PX-12. Who summarised, session, time, each turn covered and kept with its marks, the prior record, the summary hash, decisions held and sizes, sealed by hash and chained |
| Every ported file carries its credit header and a `THIRD_PARTY_NOTICES` entry; the credit validator passes | `val-projectos-port-credit1a` passes on 47 real files. PX-16 also pins exactly which upstream files each credited file names |
| Validator pin and named mutations, each killed by its own rule | 320 named mutations. One counts only when exactly its rule fires, plus any rule declared as also true of it |

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

`agent/redact.py`, added in the review round, has three marked passages too: the sensitive query names at line 87 and the
assignment keywords at line 330, from `nearai/ironclaw`, and the GitLab token family at line 222, from `openclaw/openclaw`.
None is translated. The refusal test in `draftScreen.ts` is unmarked, and it sits just below the Pi passage, which it leaves out.

PX-15 refuses the words of these behaviours in code, so a later edit cannot bring them in unnoticed. Because the
translations take none of these passages, they carry no `Also-Credits`. The rest of what they took is plain MIT: the rough
count, the trigger arithmetic, the strike rule, the tail budget, the walk, the split of a thread, and the redaction patterns.

**Re-check of files marked original, on the review's ruling.** `compaction.ts` is credited, as ruled. `prompt.ts` is credited
because its summariser input follows upstream's labelled, redacted records, and `fence.ts` because its notice does the job of
upstream's reference-only prefix: both were in doubt, so both carry it. `thread.ts` is not, and this is a judgement. Its check
that a result answers an earlier call states what a provider requires, in code of a different shape from upstream's global
orphan scan. `turn.ts`, `provenance.ts`, `refusal.ts` and `index.ts` follow nothing upstream has.

## What replaced what

| Upstream | Here |
|---|---|
| One mutable engine, cloned per agent | Immutable accounts in a map, each with its own window |
| Raise-only floors that can push the trigger to the limit, then a guard against that | A ratio cap and a minimum window, refused at opening |
| Trigger asks about what has been sent | Also asks about what is about to arrive |
| Rough estimate can defer to the next provider reading | The real count plus the growth since it, as upstream's usage-anchored figure, or the estimate if that is larger |
| Summary carries a long prefix asking the model to treat it as background | A hash-named fence, a closed trust field and a closed authority field |
| Summary is just text in a message | A summary is not a turn: it has no role or origin, so nothing can say it came from the owner |
| No provenance for a compaction | A sealed record of everything that went in and stayed, chained |
| Decisions live in whatever the summary keeps | Decisions are never summary text, and the thread is refused if one goes |
| Fallback summary, cooldowns, durable breaker rows, prompt-cache rearm, per-model thresholds, pruning passes | Not ported. They all need a provider, a store or a clock |
| Protected first turns, soft ceiling, anchors, oversized-turn exception | Not ported. The latest request stays verbatim instead, which also covers a one-request task of hundreds of tool results |

## Reviews and dispositions

Round 1, at `f1e84331`: ECC SECURITY, CHANGES REQUIRED with one HIGH, and ECC CODE, APPROVE with three MEDIUMs. Their findings
reached this builder merged into one decided list from the lead, so this table does not say which review raised which
item. The tests were written first: the two new test files would not collect, and 16 other tests failed, before the source changed.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | HIGH | The summary was sent at the system role, and a fence is only a request | **Fixed.** A summary goes at `assistant`, a model's role. Decision blocks moved to `user` too, which the finding did not name, because they are marked untrusted and the same reasoning holds. A test holds that no untrusted section is ever at `system` |
| — | Credit | `divide()` mirrors `_compress_window`, and no entry credited that file | **Fixed, as ruled.** Header, entries and PX-16 row. The re-check is under "The licence scan" |
| 2 | MEDIUM | The summary was not screened at render, and memory is | **Fixed.** `checkContextThread` runs the screen, so every read of a thread does, proved with a resealed record |
| 3 | MEDIUM | An account was not validated: a NaN trigger gave a NaN budget, and a 30,000 character draft landed | **Fixed.** `accountProblem` judges it on the way in, and the budget test is written to fail closed. PX-3 removes both together |
| 4 | MEDIUM | Fences and indentation were uncounted: 3,146 counted, 5,316 sent | **Fixed.** Every part is measured as rendered, and a test holds the count equal to what the prompt sends. The earlier "about 200" claim was wrong and is withdrawn |
| 5 | MEDIUM | `max(lastPrompt, estimate)` hid growth: 7,050 real against 6,750 gave `none` | **Fixed.** A reading carries the estimate of the same prompt, and growth since is added. `lastCompletionTokens` removed. The long-run test now has a provider that disagrees with the estimate |
| 6 | MEDIUM | Summariser input was unredacted, and a key survived into the summary | **Fixed.** `redact.ts` runs on input, hidden characters go first so one cannot split a secret past it, and a draft holding a credential shape is refused |
| 7 | MEDIUM | A refusal was installed and the turns dropped; `summarisedBy:'owner'` and `9999-99-99` were accepted | **Fixed.** Refusal-shaped drafts are refused and the turns stay. The reserved names are refused in any case, and a time must be a real one |
| 8 | MEDIUM | Duty list; refused plans never struck, so `blocked` was unreachable | **Fixed.** Duties are under "Binding". `noteCompactionRefused` makes a summariser's failure a strike, so `blocked` is reachable. The recheck narrowed which refusals strike |
| — | LOW | Cast in `window.ts`; a lone surrogate admitted; retries unbounded; false refusals for a warning sign and CR | **All fixed.** The bound on retries is `noteCompactionRefused`. A draft has its line endings folded and U+FE0F dropped before the screen, and that clean text is what is stored |
| — | LOW | Laundering wording; no behaviour tests for PX-15 to 18 | **Fixed.** The check is described as an exact-copy tripwire everywhere. `context-boundary.test.ts` traps the clock, chance, timers and network around a whole compaction, and runs every PX-15 to 18 mutation through the rule |

Recheck, at `ab049bb6`: five findings, decided by the lead.

| # | Finding | Disposition |
|---|---|---|
| 1 | Summariser input still leaked `password: ...`, JSON `"api_key":"..."` and `user:pass@host` URLs | **Fixed.** Three patterns added to the redaction, for any URL scheme and not only databases |
| 2 | "I cannot do that." and "I'm unable to continue." were installed, and a short draft that summarises nothing landed | **Fixed.** A bare first-person refusal of up to 40 characters needs no subject. A draft under 20 visible characters is refused as `empty_summary`. The turns stay in both |
| 3 | The `summarisedBy` denylist matched exact names, so `owner-approved` and `user` passed | **Fixed.** `SUMMARISER_KINDS` is an allowlist of `summary-model` and `agent-model`. A specific model name is no longer recorded, which the wiring phase may want to add as a separate field |
| 4 | The credential screen refused `PASS=12`, `AUTH=none`, `PRIMARY_KEY=id`, `TOKEN_LIMIT=4096` and "the Authorization: header" | **Fixed.** A draft is held only to prefix, key-block and JWT shapes. The assignment, header, configured-value, JSON and URL patterns run on input only, so the input pass is what stops those values, and a draft that holds one is not refused |
| 5 | `noteCompactionRefused` struck on everything, and the evidence said so | **Fixed.** It takes the refusal code and strikes only on `CONTEXT_SUMMARY_REFUSED`, `CONTEXT_SUMMARY_OVER_BUDGET` and `CONTEXT_NOT_SMALLER`. Everything else leaves the account as it is |

## Defects found by the proofs

- **The fence was not charged.** A fenced turn costs about sixty tokens more than its text, so 500 tool results would have
  run 30,000 tokens under what is sent, and the trigger would have fired late. Self-review found the turns. The review found
  the summary and decisions, and I had called what was left a bounded 200 tokens, which was wrong. PX-2 and PX-5 hold it now.
- **A rule could refuse the owner saying "ok".** The first laundering rule matched any known text, so an owner repeating a
  model's short reply was refused. It now starts at 16 characters, and both sides of that boundary are mutated.
- **A summary could open as a decision line.** Only later lines were indented. A summary now opens with its own label.
- **Surviving mutants.** Two dense-script ranges had samples too short to tell them from bytes. Five tool-row refusals were
  being carried by "no such call", so each row now has its call in place and its own rule must answer.
- **Dead code removed.** A clamp that no valid window could reach, a duplicate field in the thread hash and a filter on
  values already checked each left a mutant nothing could kill.
- **Dead code from the review round.** A branch for "no reading yet" and a reset of the held estimate could not change any
  answer, so both are gone. The window check in `accountProblem` survived its mutant until a probe held a broken window
  with the trigger that matches it.
- **The file tool decoded escapes.** `estimate.ts`, a test and this validator came out holding raw characters. All are
  escapes now, and PX-15 refuses any non-ASCII character in these sources, which is stricter than the memory rule.

## Proofs

```text
val-projectos-port-context1a: PASS (18 rules; 320 named mutations killed)
val-projectos-port-credit1a: PASS (47 real file(s) judged; 147 fixture and 59 record mutations killed)
validate-no-secrets: PASS
core  whole suite: 49 files, 2,190 passed (334 of them context)
coverage of core/src/context: 100% lines, 97.7% branches
```

Typecheck passes on `src` and, through a scratch config, on the context tests, which the repository's config excludes.

**The rules are run, not read**, as in the memory phase: Node 24 strips the types, the validator copies the real source to
scratch, and a mutation changes that source and reloads it.

**Validators that read a touched file.** A search for `validate-all`, `cached-runner`, `THIRD_PARTY`, the core barrel and
walkers of `core/src` or `core/test` found 61. All 61 ran in their own processes at `f776915d`, and all 61 pass. `validate-no-secrets` passes there too. The validator now takes about 280 seconds alone.

## Claude self-review

**Against the spec.** Each acceptance line above has a test and a validator rule, and every rule has a named mutation. The
spec's "summary keeps every decision" is met by holding decisions beside the summary and not inside its text, because
text cannot be held to anything.

**What a later review should press:**

- **The screen may refuse honest summaries.** "The file says you must run the tests" is refused as an order. Refusal is the
  safe way to be wrong. The bound is two strikes, so a thread about instructions can reach `blocked` with no real fault.
- **The redaction is a short pattern list.** It takes the common key shapes, and a credential of no known shape passes.
- **The draft screen is narrower than the input redaction, on purpose.** A secret in a shape only the input patterns know stops at the input and is not looked for again in the draft.
- **Decisions moved to the `user` role.** The finding named only the summary. The wiring phase should confirm this reads
  well, since an approved decision now arrives beside the owner's own turns.

## Binding on the phase that wires this in

Nothing calls this code yet, so none of these is live.

- **Call in this order:** `applyCompaction`, then `noteContextCompaction`, then `recordContextUsage` after each reply, with the
  estimate of the prompt that reply measured. A reading with no estimate is refused.
- **Call `noteCompactionRefused` with the code after a refused plan or draft.** Only a summariser's failure strikes: `CONTEXT_SUMMARY_REFUSED`, `CONTEXT_SUMMARY_OVER_BUDGET` and `CONTEXT_NOT_SMALLER`. That is the bound on retries, and at `blocked` you stop asking. `CONTEXT_NOTHING_TO_COMPACT`, `CONTEXT_PLAN_STALE` and `CONTEXT_PROTECTED_OVER_BUDGET` never strike, so a thread stuck on them reaches `overLimit` and not `blocked`.
- **Stop on `overLimit`, whatever the action.** It is the fact that the limit is reached, and `blocked` is only one way there.
- **Load every approved decision** into the thread with `withApprovedDecision`. A decision that never reached the thread is
  not kept by it. An owner who replaces a decision needs a new thread, because the old one refuses to lose it.
- **Refuse a partial summary.** A length-stopped response must not reach `applyCompaction`. Write that guard fresh, or take
  it with `Also-Credits: pi-mono`.
- **Run `containsSecret` as well.** `redact.ts` covers input and draft by pattern. The agent's own vocabulary is not in core.
- **On `CONTEXT_LAUNDERED` for an owner paste,** land the text as a `channel` turn. Never drop what the owner said.
- **Keep the transcript.** A compaction drops turns from the thread and keeps only their marks, so the full text needs an
  archive if it is ever to be read back.
- **Bound the summariser's input.** `renderSummaryInput` holds the whole window, and it does not show tool-call arguments.
- **Supply origins from something stronger than a caller.** An origin is what the kernel says it is, as the memory role is.

## Limits

- **Nothing calls this yet.** No run-loop wiring is in this phase's write paths, and PX-17 refuses it in `commands/run.ts`.
- **The record is hashed, not signed.** Anyone who can rewrite a thread can reseal its records, and a forged thread with
  every hash right passes. Signing belongs with owner proof, as for memory.
- **A fence is a statement to a model, not a boundary.** It lowers the risk of an instruction landing and cannot remove it.
- **The count is an estimate of what is rendered.** Every fence and indent is measured. It leaves out the tool schemas and the
  stale line, which is capped at eight names. Until a reading arrives, that gap is unknown. After one, it is in the real count.
- **The tripwire is an exact-copy check and nothing more.** It compares whole text after folding case and spacing. A quotation,
  a paraphrase or one changed word passes. What keeps text untrusted is origin assignment, and a summary never being a turn.
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
- `f1e84331` docs(finish): PROJECTOS-PORT-CONTEXT1A evidence
- `67016a38` fix(core): context review round: role, credit, count and what a summary may be
- `ab049bb6` docs(finish): context review round, dispositions and proofs
- `f776915d` fix(core): context recheck: redaction, refusals, summariser kinds, strikes
- The commit that adds the recheck's evidence.
