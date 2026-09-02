# PROJECTOS-OWNER-ESCALATION-WAIT1A — closure evidence

**Phase** PROJECTOS-OWNER-ESCALATION-WAIT1A (Programme B7, autonomy bootstrap)
**Subject** `b87c2fa374261d0c3711f95f96e89100fa3b5915`
**Parent** `eba53f979a00a9cf8db6e04d057040faaa890a87`
**Branch** `projectos-post-v3-selfhost-pilot1a`
**Plan** `plan-98675c78dc8b3175-786d909d1ccb` v1.1, PLAN READY
**Status at writing** `awaiting_closure`

This report is evidence. It closes nothing; the decision is the gatekeeper's and is recorded at
`.projectops/closure/decisions/PROJECTOS-OWNER-ESCALATION-WAIT1A.json`.

---

## What the phase set out to do

Make owner waiting truthful, durable and resumable, so that Murad is stopped for only genuinely
protected work — and so that when he answers, the work actually continues.

## What was already there, and what was actually missing

The owner-receipt mechanism was **complete**: a deterministic gate instance bound to phase, gate and
subject commit; bytes read from the git object store rather than the working tree; the implementer
and every model name refused as the decider; replay refused both by a spent marker and by an
already-consumed list. `WorkRecord` already carried `WAITING_OWNER` and `ownerRequired`, and the
entrypoint already persisted it.

What was missing was a **consumer**. A grep for `readCommittedReceipts|unsatisfiedOwnerGates|
checkOwnerGateReceipt|ownerGateState` across `projectos/agent/src` returned one comment. So a phase
that reserved an action to the owner waited for ever, even after Murad had recorded his decision and
committed it. The wait was durable and the resume did not exist. This is the third time this
programme has found a complete mechanism with no production caller.

## What it built

**A resume bound to the right subject.** A receipt binds to the subject at which `OWNER_GATE` was
raised and counts only once committed — but that very commit moves HEAD. The waiting subject is now
recovered from the durable work record, captured **once** before the run writes its own state over
it, and admitted only when the record names this project and phase with `lastStopCode: 'OWNER_GATE'`,
the live head's **first parent** is the recorded subject, and the live head is the commit that most
recently touched a pending gate's receipt. Every other outcome falls back to the live head, where a
receipt bound to the old subject cannot validate.

**Consumption as a precondition of satisfaction.** A gate is satisfied only once its receipt has been
provably spent: written, read back, and `receiptIsCommitted` re-asked and required to be false. The
whole read-check-write-verify runs under an exclusive lock taken with `createExclusive`, with the
`consumedAt` check **inside** it. A spend that cannot be proven leaves the gate standing and costs
the owner nothing — the receipt is untouched and still answers once the checkout is writable.

**Payment only when the gate is what blocks.** The decision is taken first against gates this run has
already paid for; only if the answer is `OWNER_GATE` is a receipt validated and spent, and then the
decision is taken again. A turn about to retry a failing check no longer spends single-use authority.

**Context, never authority.** Four fields of the work record are read — `lastStopCode`, `projectId`,
`phaseId`, `subjectCommit` — and nothing that could let a written record stand in for a decision.
Whatever subject it names, a receipt must still be committed there, decided by the plan's owner (read
from the committed plan), bound to this project, phase and gate, unspent, and provably spendable. A
forged record points at a passage that does not exist.

---

## Verification at this subject

| | |
|---|---|
| Agent suite | **1576 / 1576**, 57 files |
| This phase's proofs | **40 / 40**, of which 8 drive the canonical `runLoop` |
| Core suite | not run — **Core unchanged**, no `projectos/core` path in the boundary |
| Typecheck | clean, `@projectos/agent` |
| Validators | **validate-all 140 / 140, 0 FAIL** — recorded at `.projectops/validation/b87c2fa374261d0c3711f95f96e89100fa3b5915.json`, `workingTreeCleanAtRunStart: true` |
| Provider calls | **zero** |
| Spend | **$0** |

## End-to-end proof

Through the **canonical `runLoop`**, against real temporary repositories, a real bare remote and real
git, with work state persisted exactly as `run.ts` persists it:

| case | result |
|---|---|
| owner answers at A; the receipt commit makes HEAD B | resumes at A, spends once, gate lifts |
| a third invocation after the spend | `OWNER_GATE` — the passage cannot be re-bought |
| unrelated commit C on top of the receipt commit | refused, unspent — A is still an ancestor of C |
| head carries the receipt but its parent is not A | refused, unspent |
| head is a child of A but carries no decision | refused, and the run does not claim to resume |
| a valid, spendable receipt with a failing check | `CORRECTION_EXHAUSTED`, receipt untouched |
| the checks then pass | gate reached, answered, spent exactly once |
| the receipt path is unwritable | `OWNER_GATE` stands, `NOT satisfied` recorded, unspent |

Every guard has an isolating RED proof: mutating it away fails that proof and no other.

## Reviews

**By ChatGPT, the gatekeeper**, independently, against the pushed commit on GitHub:
**code-review CRITICAL 0, HIGH 0** · **security-review CRITICAL 0, HIGH 0**.

Additionally, before the push, the **ECC `code-reviewer` and `security-reviewer`** agents were run
read-only against the same seven paths. Claude did not certify its own work in either case.

**Four review rounds, four real defects.** A failed durable consumption was reported and resumed on
anyway. The commit that records an owner's answer destroyed that answer. A receipt was spent during
general decision evaluation. Ancestry was accepted where exactness was required. And the mandated ECC
security review found the fifth: the spend was unlocked, so two concurrent runs could each hold a
proven spend of the same decision.

## Findings

**Unresolved CRITICAL: 0. Unresolved HIGH: 0.**

## Protected effects

**NONE.** No production deployment, database mutation, external send, payment, credential or signing
operation. No provider call, no spend. The two actions performed — one bounded commit of exactly
seven paths, and one ordinary push — were each explicitly approved beforehand.

## Two things stated rather than left to be found

**The B6 governed executor did not make this commit.** Its checks did not permit:
`runTechnicalContinuation` requires a decision accepted by `checkGatekeeperDecision` and bound to this
candidate's request digest, and no such record exists because the review reached this runtime through
the owner rather than a provider turn. The gatekeeper ruled that neither manufacturing one
retrospectively nor making a paid call to reproduce the commit was acceptable, and that the complete
autonomous self-change chain belongs to **B9**.

**The boundary grew from five paths to seven, with permission.** The ruling that the work record may
supply context but not authority narrowed a rule that was encoded in its **absolute** form in two
places — `workRecord.test.ts` and `val-projectos-work-record-not-authority1a.cjs`, both asserting the
runner never reads the record at all. Both were repinned on authority and both are **stricter** than
what they replaced.

## Carry-forward

- **LOW** — `.gitignore`'s unanchored `*token*` can silently exclude a future owner-receipt filename
  whose phase or gate name contains "token". Fails safe: the gate never lifts.
- **LOW** — the agent `tsconfig.json` excludes `test/` from typecheck.
- **B8** — terminal checkpoint `subjectCommit` and repository-state reconciliation.
- **B8** — stale owner-receipt lock recovery after process death.
- **B8** — the existing `runCheck` timeout/recovery concern.
- **Accepted behaviour** — a later different stop supersedes the previous owner wait and requires
  fresh owner authority at the new subject.

## What this phase proved, in one sentence

A phase that reserves an action to Murad stops and records the wait durably, and a later run recovers
that wait from its own durable state, validates his committed receipt against the exact subject the
wait was raised at, spends it once under an exclusive lock before treating the gate as satisfied, and
resumes — refusing a stale, foreign, replayed, superseded or unprovable decision, and never letting
the checkpoint that names the wait become the authority that answers it.
