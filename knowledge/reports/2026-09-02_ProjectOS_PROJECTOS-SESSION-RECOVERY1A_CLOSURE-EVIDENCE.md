# PROJECTOS-SESSION-RECOVERY1A — closure evidence

**Phase** PROJECTOS-SESSION-RECOVERY1A (Programme B8, autonomy bootstrap)
**Subject** `8187aef313e1ebeffc7891685f5baec80a328753`
**Parent** `531500ffa947a905d91c08d61bad6fa9dda9a24b`
**Branch** `projectos-post-v3-selfhost-pilot1a`
**Plan** `plan-98675c78dc8b3175-786d909d1ccb` v1.1, PLAN READY
**Status at writing** `awaiting_closure`

This report is evidence. It closes nothing; the decision is the gatekeeper's and is recorded at
`.projectops/closure/decisions/PROJECTOS-SESSION-RECOVERY1A.json`.

---

## What the phase set out to do

Let ProjectOS establish the truth about an interrupted run from the repository and its own records,
so a crash leaves a question it can answer rather than a state nobody can trust.

## What was already there, and what was actually missing

Reconciliation found more built than expected. `--resume --session <id>` already refused an unnamed
session, an absent one, an unreadable one and one belonging to another worker. `COMPLETE` is written
at exactly one site after the loop ends, so **a crash cannot manufacture it**. The lock convention was
deliberate and correct. `resumeProblems` was complete and uncalled.

**One reconciliation finding of mine was wrong, and the ECC planner caught it.** I read
`resumeProblems`' absence as the same no-consumer gap the three preceding phases each turned out to
be, and proposed wiring it. Two things make that wrong: a validator and a test written **in B7 by me**
forbid it appearing in `runner.ts` at all; and it reports *"the repository moved"* for exactly the
state B7's owner resume exists to serve, so gating resume on it would have refused every legitimate
owner resume. It stays uncalled by design.

What was genuinely missing was narrower and sharper than the framework I first imagined.

## What it built

**A resume must describe the run it claims to continue.** Only `workerId` was compared, and the
session record written afterwards then overwrote the phase and brief it found — so the evidence of
which run it had been was destroyed by adopting it. All five identities are now checked before
anything is rejoined: `sessionId`, `phaseId`, worker `kind`, `briefId`, and the existing `workerId`.
Because `briefId` is `phaseId@head`, **the same phase at a moved head refuses too** — the case a
phase comparison alone cannot see.

**Nothing durable is written before the refusals.** `store.writeBrief` ran before the session was
even read, so a resume about to be refused had already overwritten the historical brief. It now runs
only after every refusal has been passed.

**The lock says which failure happened.** `createExclusive` swallows every error, so "held" and "this
location cannot be written" arrived identically — and on a permissions failure ProjectOS blamed a
process that did not exist and named no file. The convention is unchanged (no timeout, no PID, no
automatic deletion); the two-branch message makes its operator remedy reachable.

**What the last run left behind is reported.** Built from the read B7 already performs, naming only
project, phase, state, subject, stop code and session, and distinguishing an unreadable record from
an absent one. It decides nothing.

---

## Verification at this subject

| | |
|---|---|
| Agent suite | **1588 / 1588**, 58 files |
| This phase's proofs | **12 / 12** |
| Core suite | not run — **Core unchanged** |
| Typecheck | clean, `@projectos/agent` |
| Validators | **validate-all 140 / 140, 0 FAIL** — recorded at `.projectops/validation/8187aef313e1ebeffc7891685f5baec80a328753.json`, `workingTreeCleanAtRunStart: true` |
| Provider calls / spend | **zero / $0** |

## Proof, and the mutation that failed nothing

Real repositories, real git, real commits moving the head.

| case | result |
|---|---|
| session for another phase | refused; nothing rejoined or started; brief intact |
| foreign phase with a truthful-looking brief | refused **by the phase check alone** |
| same phase, head moved by a real commit | refused; "the repository has moved" |
| another `workerId` / another `kind` / laundered `sessionId` | refused |
| everything agrees | **rejoin**, never a substituted fresh start |
| lock exists | refused, names the exact lock path, receipt unspent |
| lock cannot be created | refused, says the location cannot be written, never blames a process |
| forged `GATE_APPROVED` + `gateDecisionId` record | reported, obeyed in no way |
| malformed record | reported as malformed, not as absence |

Removing the phase comparison **broke nothing at first**: `briefId` embeds `phaseId`, so the brief
check caught the wrong-phase fixture instead. A guard whose proof another guard also satisfies is not
proven, so a laundered record was built to isolate it. All four mutations now fail their own proof
and no other — and the ordering mutation fails four proofs at once, which is what makes the ordering
load-bearing rather than incidental.

## Reviews

**By ChatGPT, the gatekeeper**, against the pushed commit on GitHub: **code-review CRITICAL 0, HIGH
0** · **security-review CRITICAL 0, HIGH 0**.

Before the push, the **ECC `code-reviewer`** (CRITICAL/HIGH/MEDIUM/LOW all 0) and
**`security-reviewer`** (CRITICAL/HIGH/MEDIUM 0, one LOW) were run read-only against the changed
paths. Claude did not certify its own work in either case.

## Configured-check timeout — decided, not silently deferred

The plan's fourth acceptance criterion requires this to be **decided and recorded**.

`runCheck` passes no `timeoutMs`, and `sys.exec` applies one only when given, so a configured
validator that hangs holds the ProjectOS process indefinitely. Output is bounded; execution time is
not. Confirmed still true at this subject by reading current source, not by trusting the earlier note.

**Decision: DEFER as explicit technical debt.** A correct fix needs a governed execution and
configuration timeout contract — a committed field beside the worker configuration, gated by the same
committed-execution check — not an ad-hoc constant introduced inside session recovery. No partial
mechanism is introduced here. A hang is the *absence* of an interruption, which is the opposite of
what this phase recovers from; it is not authority bypass, data corruption, protected-action leakage
or false recovery, and under the phase-extension law it does not block closure.

## Findings

**Unresolved CRITICAL: 0. Unresolved HIGH: 0.**

## Protected effects

**NONE.** No production deployment, database mutation, external send, payment, credential or signing
operation. No provider call, no spend. The two actions performed — one bounded commit of exactly four
paths and one ordinary push — were each explicitly approved beforehand.

## The boundary grew to four paths, and it was reported

Three fixtures in the already-accepted `loopRunner.test.ts` carried placeholder `briefId` values
chosen when nothing compared them. Under the stronger invariant those read as a moved repository, so
those runs correctly refuse. Only the placeholder values were corrected — **no assertion changed** —
and the test whose subject is a laundered `briefPath` keeps its laundered `briefPath`.

## Carry-forward

- **LOW** — owner-lock diagnostic TOCTOU can choose imperfect wording; both branches refuse and spend nothing.
- **Deferred debt** — `runCheck` configured-check execution remains unbounded (decided above).
- **B6** — terminal checkpoint `subjectCommit` may retain a pre-continuation observation.
- **Structural / accepted** — a committed current-state record cannot perfectly describe the commit containing it; git remains live repository truth.
- **LOW** — unanchored `*token*` ignore rule; agent `tsconfig` excludes `test/` from typecheck.

## What this phase proved, in one sentence

A resume must describe the run it claims to continue — same session, phase, worker, kind and brief,
so the same phase at a moved head is refused too — a refused resume no longer damages the record it
failed to recover, the owner-receipt lock says which of its two failures happened so its operator
remedy is reachable, and what the last run left behind is reported truthfully, including when the
answer is that it cannot be determined, while remaining evidence that decides nothing.
