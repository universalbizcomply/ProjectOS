# PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A — closure evidence

**Phase** PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A (Programme B6, autonomy bootstrap)
**Subject** `d673d489b09c477fbce9f64d6578746c5df85986`
**Branch** `projectos-post-v3-selfhost-pilot1a`
**Plan** `plan-98675c78dc8b3175-786d909d1ccb` v1.1, PLAN READY
**Status at writing** `awaiting_closure`

This report is evidence. It closes nothing; the decision is the gatekeeper's and is recorded at
`.projectops/closure/decisions/PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A.json`.

---

## What the phase set out to do

Let ProjectOS take a validated live gatekeeper decision about finished work and perform exactly the
bounded technical continuation that decision authorises — so the owner stops carrying commit, push
and integration by hand once the reviewer has answered.

## What it actually built

**A closed technical action vocabulary.** `commit`, `push`, `ff-only-integration`, and nothing else.
Not a command, not a script, not a shell. There is no parameter anywhere in the executor through
which a command, flag, branch, remote or refspec can arrive from a model, a worker, a checkpoint or a
stored record. `--force`, `--force-with-lease`, `--amend`, `--tags`, `--delete`, `reset --hard`,
`rebase`, tags and releases are not guarded against — they are not expressible.

**A candidate identity, and the binding that was missing.** A gatekeeper decision binds project,
phase, `subjectCommit` and `requestDigest`. `subjectCommit` is HEAD — the *base* the work sits on —
and the work itself is uncommitted, so HEAD named none of it. The evidence the reviewer read carried
failing checks, findings and effects, and no diff, no changed-path list and no content digest at all.
An approval to commit was an approval of bytes the reviewer had provably never seen.

The candidate is now named by `git hash-object` over every changed path, without `-w` so nothing is
written to the object store, canonically encoded with mode and present-or-deleted state. One byte, a
file appearing, a file disappearing, a rename, a mode change or a changed boundary each move the
digest. It binds *transitively* — into the evidence text, whose digest is one of `evidenceDigests`,
which `gatekeeperRequestDigest` covers, which the decision must match — so no new gate field was
needed for a property the contract could already carry.

**A four-authority conjunction**, of which no three suffice: a live decision that passed
`checkGatekeeperDecision`; a committed owner delegation carrying `technical-continuation`; that
decision naming the action; and the action being one ProjectOS can perform. Project, phase, base
commit, branch, remote and candidate bindings are all re-checked at the moment of acting, and the
candidate is re-derived again after the network round trip.

**A conditional owner-only floor.** The floor previously said one thing about five actions: never.
That conflated two different claims — "production must never be deployed by a machine" is about the
blast radius of the act; "no machine may commit" was about there being nobody trustworthy to ask.
`ABSOLUTE_OWNER_ONLY` (`phase-closure`, `secrets-handling`, `payment-or-live-charge`) never yields.
`CONDITIONALLY_DELEGABLE_TECHNICAL` (`commit`, `push`) yields only to a proven delegation. The
relaxation is opt-in *by argument*, so degraded mode and reconciliation — which pass one argument —
keep today's restrictive behaviour, unedited. Degraded mode is precisely the state in which no
reviewer looked, and a delegation is not a reviewer.

**The success stop the loop never had.** Every gatekeeper-routable stop was a failure state.
Completed work returned `proceed` — the loop's way of ending having asked nobody anything — so the
executor was unreachable by any real run. `CONTINUATION_READY` is that question: gatekeeper audience,
the existing `evidence-review` ask, and the four answerable verdicts. `OWNER_GATE` is untouched.

---

## Verification at this subject

| | |
|---|---|
| Agent suite | **1536 / 1536**, 56 files |
| Core suite | **645 / 645**, 23 files |
| Typecheck | clean, `@projectos/agent` and `@projectos/core` |
| Validators | **validate-all 140 / 140, 0 FAIL** — recorded at `.projectops/validation/d673d489b09c477fbce9f64d6578746c5df85986.json`, `workingTreeCleanAtRunStart: true` |
| Provider calls | **zero** — every reviewer reply in these proofs is a local HTTP fixture |
| Spend | **$0** |

The checks were run directly rather than through a governed worker invocation, because this phase's
work *was* the loop machinery and no separate worker run produced it.

## End-to-end proof

Five cases through the **canonical `runLoop`**, against a real temporary repository and a real local
bare remote, each asserted against the repository afterwards rather than against the loop's account
of itself:

| case | result | HEAD | durable state |
|---|---|---|---|
| reviewed candidate, commit + push approved | committed exactly the reviewed path; `origin/work == HEAD`, 0/0 | advanced | `COMPLETE` |
| one material byte changed after the decision | refused | unmoved | `BLOCKED` |
| origin moved under the run mid-decision | refused, nothing merged or rebased | unmoved | `BLOCKED` |
| owner-only action approved | decision rejected outright; no verdict applied | unmoved | `BLOCKED` |
| deployment approved (checker accepts it) | refused by the closed vocabulary | unmoved | `BLOCKED` |

The last two are the same guarantee at two different layers, proven separately: resting it on either
alone would be a hole.

## Reviews

Both by **ChatGPT, the gatekeeper**, independently, against this subject:

- **code-review** — CRITICAL 0, HIGH 0
- **security-review** — CRITICAL 0, HIGH 0

Recorded here as the reviewer's decision. Claude did not certify its own work, and that distinction
earned its keep: the gatekeeper's review of the preceding subject `e520be7` found a genuine HIGH that
Claude's self-review had missed — `runContinuation` returned `void`, so a refused continuation
established no stop and the durable work state was written `COMPLETE` for a phase whose commit had
just been refused. Fixed at this subject; reverting the propagation reproduces
`expected 'COMPLETE' to be 'BLOCKED'`.

## Findings

**Unresolved CRITICAL: 0. Unresolved HIGH: 0.**

One **MEDIUM carried forward** by the gatekeeper's direction, not resolved here: the terminal
checkpoint's `subjectCommit` can retain the originally observed HEAD after a technical continuation
has moved it. Non-authoritative — the checkpoint grants nothing and is never read back as permission
— and it belongs to **B8**, which owns repository and checkpoint reconciliation.

## Protected effects

**NONE.** No production deployment, database mutation, external send, payment, credential or signing
operation. No provider call, no spend. Every protected action remains the owner's and is unreachable
from the machinery this phase built.

## Two things stated rather than left to be found

**The lifecycle was advanced early.** The phase record was moved `draft → … → awaiting_closure` in
one governed sequence *before* the HIGH above was known. `PHASE_TRANSITIONS` allows
`awaiting_closure → closed | closed_as_blocked` and nothing else, so there was no legal path back to
`implementing` once the correction became necessary. The record is truthful today — the work is
complete and reviewed — but it was advanced sooner than it should have been.

**The clean tree was reached by excluding, not hiding.** G4-13 reads `git status --porcelain`, which
honours ignore rules. Two long-standing local-only files — `CLAUDE.md` and
`Design Scoping Questions.zip` — were added by exact name to `.git/info/exclude`, a local-only file
that is neither tracked nor in history. Neither file was deleted, modified or committed, and the rule
was inspected before anything was changed.

## What this phase proved, in one sentence

ProjectOS can take a live gatekeeper decision about finished work and carry out the exact bounded
technical continuation it authorises — bound to the precise bytes the reviewer saw, refusing on any
drift, on any protected action, and on any authority it cannot establish, and recording truthfully
whichever of those happened.

## Carry-forward

- **MEDIUM** — terminal checkpoint `subjectCommit` staleness after a continuation → **B8**
- `commands/reconcile.ts` passes the floor without the phase-declared gates
- The delegable-scope vocabulary is duplicated in `validate-projectos-recovery-plan-authority1a.cjs`,
  which cannot import the runtime it validates
- No governed integration target parameter exists, so `ff-only-integration` refuses for want of one
- A stray `error: No such remote 'origin'` on stderr during full agent runs, unattributed; all tests pass
