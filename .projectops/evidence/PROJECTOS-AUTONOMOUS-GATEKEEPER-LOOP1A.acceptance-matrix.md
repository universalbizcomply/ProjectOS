# PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A — 17-criterion acceptance matrix

**Head** `fd55bac` · **Branch** `projectos-post-v3-selfhost-pilot1a` · **Regenerated** 2026-08-19
**RECONCILED TO 17/17** — gatekeeper ruling, PROJECTOS — AUTONOMOUS SELF-HOSTING FINAL CLOSURE, 2026-08-25.
Full reconciliation detail and per-criterion citations for everything that changed since this document's
last regeneration (7, 9, 11, 12, 13, 15) are in the closure evidence pack:
`.projectops/evidence/PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.programme-closure.json`. Sections 1-6, 8, 10,
14, 16, 17 below are unchanged and still authoritative for those criteria.

**Active plan** `plan-35316a7a7ad3acd6-36e79927c769`
**Plan digest** `sha256:36e79927c769bc21b7c12dc37fe7ff98ee8d5a8efc113858c36b8fa1ef19a550`
**Owner decision** `PROJECTOS-AUTONOMOUS-SELF-HOSTING-PLAN-APPROVAL-DECISION1E`, consumed 2026-08-19T00:29:20Z

Criteria are quoted from the ACTIVE approved plan record named above — not from the source document,
not from a superseded plan, and not paraphrased. This document supersedes the version prepared at
`f02fb65`, which quoted the pre-amendment Criterion 10 and mis-scored Criterion 14.

**Classification used**

| Label | Meaning |
|---|---|
| **LIVE-PROVEN** | Exercised against the real OpenAI API, real credential, real network |
| **PROVEN BY REFUSAL** | The guard was exercised and refused; nothing was sent, by design |
| **PROVEN DETERMINISTICALLY** | Contract + tests + mutation battery; no live exercise needed or possible |
| **NOT YET PROVEN** | The evidence does not carry it — none remain as of this reconciliation |

---

## Summary

**17 of 17 satisfied. 0 remain.**

| | Criteria |
|---|---|
| **PROVEN** | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17 |
| **REMAINING** | none |

Criteria 7, 9, 11, 12, 13, 15 moved from REMAINING to PROVEN since the 2026-08-19 regeneration; see the
closure evidence pack for what each was proven by. This section's individual write-ups below (### 7, ### 9,
### 11, ### 12, ### 13, ### 15) describe the PRE-reconciliation state and are retained as history — read
the closure pack for the current status of those six.

**What moved since the `f02fb65` version, and why.**

- **Criterion 10 → PROVEN.** The evidence did not change; the criterion did. The original wording
  required the independent reviewer to return an amendment authorising correction. Two genuine live
  runs on materially different evidence both returned `AWAITING_OWNER`. A criterion satisfiable only
  by a verdict ProjectOS does not control, and must not shop for, is unprovable by construction. The
  owner approved a post-freeze correction to its wording; the corrected criterion describes what two
  live runs actually proved. The authorised-correction limb remains deterministic, not live.
- **Criterion 14 → PROVEN.** It was wrongly recorded as PARTIAL. The owner's screen observation
  proving it was already committed at `b00fbb4` before the earlier matrix was written.
- **Criterion 15 → still remaining, but reclassified.** It was recorded as a conditional that could
  not be evaluated. Per the corrected Criterion 14 the condition is SATISFIED: the tunnel is
  available. The bridge is required work, not a branch that might never apply.
- **Criterion 7 → still remaining.** The earlier version counted it satisfied while listing an
  unclosed gap against it in its own closure table. Applied as written, "durable" is unmet.

The six remaining share three causes: no cycle has started from a fresh objective (9, 12);
degraded-mode continuation has never been exercised (7, 11); and worker-binding isolation and the
MCP bridge have not been built or tested (13, 15).

---

## The matrix

### 1. Unattended transport behind an abstraction — **PROVEN** (live)
> "A supported unattended OpenAI transport is implemented behind an abstraction, and unattended operation never depends on a browser window, a desktop app window, a focused tab or a conversation name"

4 live calls from a headless Node process. No browser, no window, no tab. The governance thread is
keyed on an opaque provider id (`gatekeeperThread.ts`), and a conversation-title-shaped id is refused.
Evidence: `live-gatekeeper-proof.json` scenarios 1, 5, 6, 13. Two further live chains since
(`criterion10-live-proof.json`, `-2.json`) ran the same way.

**Valid after the amendment:** yes — untouched by it.

### 2. Structurally read-only gatekeeper — **PROVEN** (deterministic)
> "The gatekeeper is structurally read-only: it reviews, reasons and decides, and it cannot modify source, commit, push, deploy, mutate a database, transmit an external message, make a payment, or reach credential material"

`FORBIDDEN_GATEKEEPER_CAPABILITIES` refuses any transport declaring a mutating capability; the
reviewer is an HTTP request returning JSON and has no tool surface. Validator property 1 pins the
purity of the contracts. Not "live-proven" because there is nothing to observe: the reviewer's
inability to act is structural, not behavioural.

**Valid after the amendment:** yes.

### 3. Machine-readable bound decisions, refused on mismatch — **PROVEN** (live + refusal)
> "Gatekeeper decisions are machine-readable on a closed vocabulary and bind projectId, phaseId, subject commit and request digest; ProjectOS refuses a decision that mismatches any of them, is unknown, is schema-invalid, is stale or replayed, arrives for another project, or asserts an owner-only authority"

Live: 4 decisions accepted against all four bindings, plus 2 more in the Criterion 10 chains. Refusal:
replay (sc. 8), stale subject (8), another project (9), owner-only grant, unknown verdict,
schema-invalid — the last three deterministically. 18/18 mutations on the decision contract.

**Valid after the amendment:** yes — reinforced. The corrected Criterion 10 now names this binding
explicitly, and the second live chain passed all four again.

### 4. Cost model from measured sizes; four totals recorded — **PROVEN**, with a caveat
> "The cost model is derived from measured ProjectOS artefact sizes rather than guessed, and a per-request estimate, per-phase total, per-project total and monthly total are recorded and visible to the owner"

Sizes measured from real artefacts. All four totals computed by `summariseLedger` and recorded with
real usage: the second chain recorded 31,285 µUSD against `GKREQ-3333daa6bee30db24053eaf8`, with the
month at 44,641 µUSD and a pre-call estimate of ~11,216.

**Caveat, stated rather than claimed:** "visible to the owner" is satisfied by the ledger, evidence
records and reports — **not** by a Control Centre surface. No owner-facing UI shows cost.

**Valid after the amendment:** yes.

### 5. Configurable budget, warning + hard stop, no purchase without owner approval — **PROVEN** (live + refusal)
> "A configurable budget with a warning threshold and a hard stop exists, and no paid API activation, credential creation or purchase happens without a separate owner commercial approval"

Live: budget evaluated before every call. Refusal: at the $5 ceiling the call is refused *before* it
is made (sc. 10). The commercial approval exists as a committed owner gate receipt
(`payment-or-live-charge`), written before any account existed.

**Valid after the amendment:** yes.

### 6. Fail-safe on unavailability, explicit owner choice, no silent fallback — **PROVEN** (refusal)
> "When the gatekeeper is unavailable for any reason the run FAILS SAFE and presents the owner an explicit choice; Claude never becomes its own approver and there is no silent fallback between transports"

Scenarios 10 and 11. The selector takes one transport and has nowhere to put a second. Claude's
self-approval is refused by `checkGatekeeperDecision` even when expectations name it.

**Valid after the amendment:** yes.

### 7. Degraded mode explicit, durable, auditable, fully bound, non-replayable — **NOT YET PROVEN**
> "Owner-risk degraded mode is explicit, durable, auditable, project-bound, phase-bound, subject-bound, decision-bound, scoped and non-replayable, and it cannot authorise any owner-only protected action; commit and push require their own explicit grant"

Every binding and every refusal is proven (sc. 12; 35/35 mutations). A grant naming `push` is refused;
an uncommitted grant is refused.

**Gap:** "durable" is contract-level only. Unlike owner gate receipts, which are read from the git
object store by `ownerGateReceipts.ts`, there is **no committed-read path for degraded-mode grants** —
`readFromCommittedTree` is supplied by the caller, and no real grant file has ever been written.

**Remaining action:** a committed grant, real bounded work under it, then reconciliation.

### 8. Reconciliation prepared; next gate blocked until complete — **PROVEN** (live)
> "When the gatekeeper returns, a reconciliation review of the degraded-mode work is prepared and the next major gate does not proceed as normal until it is complete"

Scenario 13: the gate was blocked, a **live** reconciliation review was performed under
`RECONCILIATION_ASK`, and only an accepted decision cleared it.

**Valid after the amendment:** yes.

### 9. One ordinary end-to-end cycle proven live — **NOT YET PROVEN**
> "One ordinary end-to-end cycle is proven live: objective in, gatekeeper decision, Claude work, evidence back, gatekeeper review, next bounded action, with the owner performing zero OpenAI-to-Claude copy or paste"

**Proven:** gatekeeper decision → next bounded action → evidence back → gatekeeper review with zero
owner relay (sc. 1, 3, 4, 5); and, since the earlier matrix, **a real Claude worker did run** — the
second Criterion 10 chain invoked `runLoop` with worker `claude-local`, which performed both
plan-required reviews and wrote its own findings and a complete six-field effects attestation.

**Not proven:** *objective in*. No cycle has started from a fresh objective intake. The gap has
narrowed from "no worker, no validator, no objective" to this one leg.

**Remaining action:** one `runLoop --execute` begun from an objective, with the live gatekeeper.

### 10. Automatic bounded correction-decision cycle — **PROVEN** (live)
> "One automatic bounded correction-decision cycle is proven live, driven by a real mandatory check failure and the gatekeeper's own decision rather than by a human: when the current worker cannot correct the failure ProjectOS consults the live gatekeeper once, without futile retries, and binds and enforces the returned decision against projectId, phaseId, subject commit and request digest exactly; a verdict authorising correction grants only the already-bounded correction authority, holds the correction worker inside its permitted path boundary, keeps the correction budget bounded and returns evidence for re-review; AWAITING_OWNER or any other non-correction verdict mints no correction authority, edits no source, consumes no correction budget and stops at the owner gate; and no retry may be used to obtain a different verdict, so the criterion never requires the independent gatekeeper to return a predetermined one"

Two authorised live chains, both preserved. Neither is a rehearsal.

**FIRST CHAIN** (`criterion10-live-proof.json`) — a real mandatory check failed and drove the loop:
`agent-tests` FAIL on all four attempts while `validate-all` (130/130), `core-tests` and
`agent-typecheck` passed. A real Claude worker ran four times. Live OpenAI review
`GKREQ-e73eabbb036d4faec79b99f4`, `gpt-5.6-terra`, 6,834 in / 515 out, 13,693 µUSD. Verdict
`AWAITING_OWNER`, applied correctly through the routing table.

**SECOND AND FINAL CHAIN** (`criterion10-live-proof-2.json`, 2026-08-18 15:24) — run after the
consult-first correction, on a genuinely green baseline:

- `agent-tests` FAIL again, real, with `validate-all` 130/130, `core-tests` and `agent-typecheck`
  passing beside it;
- the reviewer was consulted on the FIRST failing check — `attempts: 0`, one worker start, one
  gatekeeper call. The three futile retries are gone;
- live review `GKREQ-3333daa6bee30db24053eaf8`, `gpt-5.6-terra`, 20,468 in / 570 out, 31,285 µUSD;
- every binding passed: project, phase, subject commit, request digest;
- verdict **`AWAITING_OWNER`** — a valid verdict for `CORRECTION_EXHAUSTED`;
- consequently: no amendment, no correction authority minted, no correction-worker source edit,
  correction budget **0 of 3**, stopped at the owner gate, fixture restored by the harness;
- **no third attempt was made.** Per the owner's instruction the chain stopped rather than asking a
  second question of the same reviewer.

That is the criterion's non-correction branch, proven live, twice, on materially different evidence.

**The authorised-correction limb is PROVEN DETERMINISTICALLY, not live.** No
`AMENDMENT_REQUIRED → Claude fix → PASS` has occurred and nothing here claims one. The bounded
authority, the permitted path boundary and the budget ceiling are proven by `correctionBoundary` and
`runner` tests. Carried forward for a future real workload where an independent gatekeeper genuinely
authorises correction.

**Valid after the amendment:** this IS the amendment. The evidence is unchanged; the criterion was
corrected to describe what the evidence proves rather than a verdict ProjectOS cannot command.

### 11. Unavailable decision + degraded continuation + reconciliation each proven — **NOT YET PROVEN**
> "One gatekeeper-unavailable owner decision, one degraded-mode bounded continuation and one return-to-gatekeeper reconciliation are each proven"

Reconciliation: **live-proven**. Unavailable path: **proven by refusal**. Degraded-mode bounded
continuation: **not proven** — no owner decision record was created and consumed, and no work was
carried out under a grant.

**Remaining action:** as criterion 7.

### 12. Restart/resume without duplicating decision, Claude run, commit or cost — **NOT YET PROVEN**
> "Restart and resume are proven mid-objective without duplicating a decision, a Claude run, a commit or a cost entry"

**Proven:** no duplicate *decision* (replay refused, sc. 8) and no duplicate *cost entry* (same
derived request id, duplicate ignored, sc. 7).

**Not proven:** no duplicate *Claude run* and no duplicate *commit* — neither has been exercised
across a restart.

**Remaining action:** interrupt and resume a live cycle mid-objective.

### 13. Multi-project isolation including worker bindings — **NOT YET PROVEN**
> "Multi-project isolation is proven: distinct project ids, repository roots, thread bindings and worker bindings, with deliberately mismatched bindings refused and no cross-project leakage of prompt, evidence, decision, session or repository facts"

**Proven:** distinct project ids, repository roots and thread bindings; mismatches refused before
anything is sent (sc. 9).

**Not proven:** **worker bindings** were never exercised.

**Remaining action:** a second project with its own worker binding, deliberately mismatched and
refused.

### 14. Developer mode and tunnel availability established from the owner's screen — **PROVEN**
> "Whether ChatGPT Developer mode and the Secure MCP Tunnel are available on the owner's own account is established as a fact from the owner's screen before the bridge is built, and recorded; the phase does not claim a capability it has not seen"

Both halves the criterion names are established and recorded, before any bridge work — which is what
the criterion requires.

Evidence: `.projectops/evidence/PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.owner-screen-fact.json`,
observed by Murad at 2026-08-18T02:41:00+01:00 against subject commit `b9619f7cc845`, committed at
`b00fbb4`. It records, from the owner's own screen: ChatGPT Developer mode ENABLED, Enforce CSP
ENABLED, OpenAI Platform Organization → **Tunnels AVAILABLE**, tunnel-client download AVAILABLE,
Create tunnel AVAILABLE, ChatGPT New Plugin AVAILABLE, connection modes `Server URL` and `Tunnel`,
tunnel selectable.

The record carries the owner's observation, not the implementer's: ProjectOS cannot see the owner's
account screens, and the record says so. It grants nothing — it is an observation, not an authority.

**Correction recorded:** the `f02fb65` matrix scored this PARTIAL on the grounds that tunnel
availability had "never been read from the owner's screen". That was wrong when written; the
observation was already committed. The owner is not asked to repeat it.

**Consequence:** no tunnel has been created and no tunnel credential exists. That remains a separate
owner gate.

### 15. Private MCP bridge proven from ChatGPT over the tunnel — **NOT YET PROVEN**
> "If they are available, a small private ProjectOS MCP bridge is proven from ChatGPT over the outbound-only tunnel with no public listener and no exposure of the local address, reusing existing ProjectOS contracts, and the owner interface keeps working when the primary gatekeeper transport is unavailable"

Nothing is built beyond the authority contract. This is the blocker the gatekeeper itself named.

**Reclassified.** The earlier matrix treated the conditional — "*If they are available*" — as
unevaluable. Per criterion 14 the condition is **satisfied**: the tunnel is available on the owner's
account. This is therefore genuine outstanding work, not a branch that might never apply.

**Remaining action:** build and live-prove the minimal MCP owner bridge over the tunnel.

### 16. Every bridge operation passes through ProjectOS authority — **PROVEN** (deterministic)
> "Every bridge operation passes through ProjectOS authority, so the bridge cannot deploy, mutate a database, run an arbitrary command, transmit an external message, make a payment, reach credential material or sign anything however a conversation phrases the request, and a refusal is recorded rather than silently dropped"

`gatekeeperBridge.ts`: closed operation allowlist, identifier-only arguments, prototype keys refused,
traversal refused, provenance fields refused case-insensitively, refusal returned as a record.
19/19 mutations.

**Not live** — there is no bridge to exercise, on the same basis as criterion 2. When the bridge of
criterion 15 is built, this contract must be re-proven against the running bridge rather than
inherited.

### 17. Reviews cover the named attack classes, unresolved CRITICAL and HIGH at zero — **PROVEN**, with a scope note
> "Reviews cover prompt injection across the model boundary and across the owner interface, evidence poisoning, cross-project leakage, stale decision replay, subject drift, credential leakage, model escalation abuse, cost runaway, duplicate calls after restart, self-approval, override replay, degraded-mode escalation, reconciliation bypass and any direct gatekeeper-to-Claude bypass, with unresolved CRITICAL and HIGH at zero"

Seven-lens code and security review of the whole boundary: 60 findings, 9 confirmed by two-lens
adversarial verification, 42 over the cap triaged rather than dropped. Every CRITICAL and HIGH
corrected in code. **Unresolved CRITICAL = 0, unresolved HIGH = 0.**

The live worker's own review of the correction wiring added 8 findings, all MEDIUM or LOW, 6 fixed
and 2 accepted as carry-forward (below).

The plan-discovery correction went through a three-lens adversarial review — governance-safety,
correctness, proportionality — which found 4 defects in the first implementation. All 4 were fixed
before it shipped: a trust inversion that ranked undeclared content above the approved baseline; a
one-activation-only fix that would have reinstated the defect; a phase-ordering regression that broke
the dependency rule; and a draft assembled from two revisions.

**Scope note:** the seven-lens battery ran at `c4989eb`. The live transport, credential resolver, HTTP
port, loop wiring, plan-discovery correction and activation-identity correction all post-date it and
have not been through that same battery. If the bridge is built it will need one too.

---

## What must happen before closure

| Gap | Criterion | What would close it |
|---|---|---|
| No cycle begun from an objective | 9, 12 | One `runLoop --execute` from objective intake with the live gatekeeper |
| Degraded continuation never exercised | 7, 11 | A committed grant, real bounded work under it, then reconciliation |
| Worker bindings not isolation-tested | 13 | A second project with its own worker binding, mismatched and refused |
| Bridge not built | 15 | The MCP owner bridge — now known to be required, not conditional |
| Bridge authority not live-proven | 16 | Re-prove the contract against the running bridge |
| Reviews predate the live code | 17 | Re-review of transport, resolver, port, wiring, discovery and activation identity |

## Disposition of the live runs' findings

**Unresolved CRITICAL = 0, unresolved HIGH = 0** — every finding was MEDIUM or LOW.

| Finding | Severity | Disposition | Reason |
|---|---|---|---|
| `CORR-STALE-DECISION-ID` | MEDIUM | **FIXED** | Real defect. A spent amendment stayed set, so a later stop could authorise a correction against an instruction the reviewer never gave for it. Both fields are now cleared on every path out of the branch, and a missing decision id refuses instead of passing as `''`. |
| `CHECK-AGENT-TESTS-FIXTURE` | MEDIUM | **FIXED (by design)** | The worker correctly diagnosed the deliberately mutated proof fixture. It is the proof target; the harness restores it. |
| `CORR-EXTENSION-WHITELIST-INVISIBLE` | MEDIUM | **FIXED (documented)** | The behaviour was already correct and fail-safe; only its invisibility was the defect. `pathsNamedIn` now states its extension list and why widening it is a governed decision. |
| `SEC-EMPTY-SUBJECT-COMMIT` | LOW | **FIXED** | Genuine hole: both sides derived from `head ?? ''`, so an unbound run passed the subject binding by being absent. Now refused explicitly, with two tests. |
| `CODE-GRANTS-NOT-REVALIDATED` | LOW | **FIXED (documented)** | The reviewer judged the design correct and the silence about it not. The call site now says why `toolGrantProblems` must not be re-run over authorised correction grants. |
| `CODE-SCOPE-ABSENT-BYPASS` | LOW | **FIXED (documented)** | Correct backward-compatible behaviour; `runner.ts` now states that the veto is inert for a phase carrying no scope. |
| `SEC-CHECK-OUTPUT-PROVENANCE` | LOW | **ACCEPTED — CARRY-FORWARD** | Every path in the reviewer's reply is checked against the approved maximum, so untrusted check output cannot authorise anything. A provenance wrapper would reduce prompt-injection surface but is not required for a safe run. |
| `SEC-PERCENT-ENCODED-PATHS` | LOW | **ACCEPTED — CARRY-FORWARD** | The chain already fails safely: `within()` compares literal strings and no encoded form matches a real path prefix. An explicit rejection is tidier, not safer. |

## Carry-forward (non-blocking)

- `SEC-CHECK-OUTPUT-PROVENANCE` and `SEC-PERCENT-ENCODED-PATHS` — as above.
- `PLAN-DRAFT-COMPLETENESS-GAP` — a draft can report zero unknowns while omitting an environment
  activation requires.
- `TIGHTEN-GATEKEEPER-API-PERMISSIONS` — the pilot key retains the broader Restricted configuration
  by explicit owner decision; tighten to least privilege post-pilot.
- No owner-facing cost surface in the Control Centre (criterion 4 caveat).
- `supersedesPlanVersion` is hard-coded `null` in `planApproval.ts`. Supersession is mechanical —
  pointer moved, superseded record retained as a planning source, decision consumed — but the plan
  record does not name the digest it supersedes.
- `draft.authoritativeSource` still names the derived record via `selectAuthoritative`. Pre-existing;
  it does not affect phase content or the cited source document.
- `projectos/state/projectos-autonomous-self-hosting.plan.json` — a retired derived plan record still
  reaching CURRENT_PLANNING by self-asserting `PLAN READY`. Correctly classed as a baseline so it
  cannot shadow anything; worth retiring from the corpus.
- Criterion 10's authorised-correction limb — live exercise on a future real workload.
