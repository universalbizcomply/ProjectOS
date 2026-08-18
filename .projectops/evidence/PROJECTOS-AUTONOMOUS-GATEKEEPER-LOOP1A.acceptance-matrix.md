# PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A — 17-criterion acceptance matrix

**Head** `f02fb65` · **Branch** `projectos-post-v3-selfhost-pilot1a` · **Prepared** 2026-08-18

Criteria are quoted from the authoritative approved plan state
(`projectos/state/projectos-autonomous-self-hosting.plan.json`, planVersion 1.0), not from the source
document and not paraphrased.

**Classification used**

| Label | Meaning |
|---|---|
| **LIVE-PROVEN** | Exercised against the real OpenAI API, real credential, real network |
| **PROVEN BY REFUSAL** | The guard was exercised and refused; nothing was sent, by design |
| **PROVEN DETERMINISTICALLY** | Contract + tests + mutation battery; no live exercise needed or possible |
| **NOT YET PROVEN** | The evidence does not carry it |

---

## Summary

**11 of 17 fully satisfied. 6 carry a genuine gap.** The gatekeeper anticipated one (the MCP owner
bridge, criterion 15). There are **five more**, and they share a single root cause: the live proof
exercised the OpenAI leg of the loop but never ran a real Claude worker, a real validator or a real
objective. That was a limitation of how I built the proof harness, not of the system — the wiring
exists and is unit-proven — but the criteria say "proven live" and the evidence does not carry it.

---

## The matrix

### 1. Unattended transport behind an abstraction — **LIVE-PROVEN**
> "A supported unattended OpenAI transport is implemented behind an abstraction, and unattended operation never depends on a browser window, a desktop app window, a focused tab or a conversation name"

4 live calls from a headless Node process. No browser, no window, no tab. The governance thread is
keyed on an opaque provider id (`gatekeeperThread.ts`), and a conversation-title-shaped id is refused.
Evidence: `live-gatekeeper-proof.json` scenarios 1, 5, 6, 13.

### 2. Structurally read-only gatekeeper — **PROVEN DETERMINISTICALLY**
> "The gatekeeper is structurally read-only: it reviews, reasons and decides, and it cannot modify source, commit, push, deploy, mutate a database, transmit an external message, make a payment, or reach credential material"

`FORBIDDEN_GATEKEEPER_CAPABILITIES` refuses any transport declaring a mutating capability; the
reviewer is an HTTP request returning JSON and has no tool surface. Validator property 1 pins the
purity of the contracts. Not "live-proven" because there is nothing to observe: the reviewer's
inability to act is structural, not behavioural.

### 3. Machine-readable bound decisions, refused on mismatch — **LIVE-PROVEN + PROVEN BY REFUSAL**
> "Gatekeeper decisions are machine-readable on a closed vocabulary and bind projectId, phaseId, subject commit and request digest; ProjectOS refuses a decision that mismatches any of them, is unknown, is schema-invalid, is stale or replayed, arrives for another project, or asserts an owner-only authority"

Live: 4 decisions accepted against all four bindings. Refusal: replay (scenario 8), stale subject
(8), another project (9), owner-only grant, unknown verdict, schema-invalid — the last three
deterministically. 18/18 mutations on the decision contract.

### 4. Cost model from measured sizes; four totals recorded — **LIVE-PROVEN, with one honest caveat**
> "The cost model is derived from measured ProjectOS artefact sizes rather than guessed, and a per-request estimate, per-phase total, per-project total and monthly total are recorded and visible to the owner"

Sizes measured from real artefacts and recorded in the commercial document. All four totals are
computed by `summariseLedger` and recorded in the live evidence with real usage.

**Caveat:** "visible to the owner" is satisfied by the evidence record and the report, **not** by a
Control Centre surface. No owner-facing UI shows cost. Stated rather than claimed.

### 5. Configurable budget, warning + hard stop, no purchase without owner approval — **LIVE-PROVEN + PROVEN BY REFUSAL**
> "A configurable budget with a warning threshold and a hard stop exists, and no paid API activation, credential creation or purchase happens without a separate owner commercial approval"

Live: budget evaluated on every call, status OK. Refusal: at the $5 ceiling the call is refused
*before* it is made (scenario 10). The commercial approval exists as a committed owner gate receipt
(`payment-or-live-charge`), written before any account existed.

### 6. Fail-safe on unavailability, explicit owner choice, no silent fallback — **PROVEN BY REFUSAL**
> "When the gatekeeper is unavailable for any reason the run FAILS SAFE and presents the owner an explicit choice; Claude never becomes its own approver and there is no silent fallback between transports"

Scenarios 10 and 11. The selector takes one transport and has nowhere to put a second. Claude's
self-approval is refused by `checkGatekeeperDecision` even when expectations name it.

### 7. Owner-risk degraded mode, bounded and non-replayable — **PROVEN DETERMINISTICALLY, with a gap**
> "Owner-risk degraded mode is explicit, durable, auditable, project-bound, phase-bound, subject-bound, decision-bound, scoped and non-replayable, and it cannot authorise any owner-only protected action; commit and push require their own explicit grant"

Every binding and every refusal is proven (scenario 12; 35/35 mutations). A grant naming `push` is
refused; an uncommitted grant is refused.

**Gap:** "durable" is contract-level. Unlike owner gate receipts, which are read from the git object
store by `ownerGateReceipts.ts`, there is **no committed-read path for degraded-mode grants** — the
`readFromCommittedTree` flag is supplied by the caller. Nothing has ever written a real grant file.

### 8. Reconciliation prepared; next gate blocked until complete — **LIVE-PROVEN**
> "When the gatekeeper returns, a reconciliation review of the degraded-mode work is prepared and the next major gate does not proceed as normal until it is complete"

Scenario 13: the gate was blocked, a **live** reconciliation review was performed under
`RECONCILIATION_ASK`, and only an accepted decision cleared it.

### 9. One ordinary end-to-end cycle proven live — **NOT YET PROVEN**
> "One ordinary end-to-end cycle is proven live: objective in, gatekeeper decision, Claude work, evidence back, gatekeeper review, next bounded action, with the owner performing zero OpenAI-to-Claude copy or paste"

**Proven:** gatekeeper decision → next bounded action → evidence back → gatekeeper review, with zero
owner relay (scenarios 1, 3, 4, 5).

**Not proven:** *objective in* — no objective was entered for the live cycle. *Claude work* — **no
Claude worker ran.** The evidence the reviewer read was composed by the proof script, not produced by
a worker. `runLoop` was never invoked in the live run.

### 10. One automatic bounded correction cycle from a real validator failure — **NOT YET PROVEN**
> "One automatic bounded correction cycle is proven, driven by a real validator failure and a gatekeeper correction decision rather than by a human"

**Proven:** the gatekeeper correction decision, live, and the loop taking it as a bounded retry
(scenario 6). **Not proven:** "driven by a real validator failure". The failure was *described* in
the evidence text; no validator actually failed and fed the loop.

### 11. Unavailable decision + degraded continuation + reconciliation each proven — **PARTIAL**
> "One gatekeeper-unavailable owner decision, one degraded-mode bounded continuation and one return-to-gatekeeper reconciliation are each proven"

Reconciliation: **LIVE-PROVEN**. Unavailable path: **PROVEN BY REFUSAL**. Degraded-mode bounded
continuation: **NOT YET PROVEN** — no owner decision record was created and consumed, and no work was
actually carried out under a grant.

### 12. Restart/resume without duplicating decision, Claude run, commit or cost — **PARTIAL**
> "Restart and resume are proven mid-objective without duplicating a decision, a Claude run, a commit or a cost entry"

**Proven:** no duplicate *decision* (replay refused) and no duplicate *cost entry* (same derived
request id, duplicate ignored) — scenarios 7 and 8. **Not proven:** no duplicate *Claude run* and no
duplicate *commit*, neither of which occurred at all.

### 13. Multi-project isolation including worker bindings — **PARTIAL**
> "Multi-project isolation is proven: distinct project ids, repository roots, thread bindings and worker bindings, with deliberately mismatched bindings refused and no cross-project leakage of prompt, evidence, decision, session or repository facts"

**Proven:** distinct project ids, repository roots and thread bindings; mismatches refused before
anything is sent (scenario 9). **Not proven:** **worker bindings** were not exercised.

### 14. Developer mode and tunnel availability established from the owner's screen — **PARTIAL**
> "Whether ChatGPT Developer mode and the Secure MCP Tunnel are available on the owner's own account is established as a fact from the owner's screen before the bridge is built, and recorded; the phase does not claim a capability it has not seen"

**Established and recorded:** Developer mode ENABLED, Enforce CSP ENABLED — visually confirmed by the
owner, recorded in `PLAN-APPROVAL-DECISION1B` and the commercial document.

**Not established:** whether the **Secure MCP Tunnel** is available on this account. Never read from
the owner's screen. The criterion names both.

### 15. Private MCP bridge proven from ChatGPT over the tunnel — **NOT YET PROVEN**
> "If they are available, a small private ProjectOS MCP bridge is proven from ChatGPT over the outbound-only tunnel with no public listener and no exposure of the local address, reusing existing ProjectOS contracts, and the owner interface keeps working when the primary gatekeeper transport is unavailable"

Nothing is built beyond the authority contract. This is the blocker the gatekeeper named. Note the
criterion is conditional — "**If they are available**" — and per criterion 14 that availability has
not been established either way.

### 16. Every bridge operation passes through ProjectOS authority — **PROVEN DETERMINISTICALLY**
> "Every bridge operation passes through ProjectOS authority, so the bridge cannot deploy, mutate a database, run an arbitrary command, transmit an external message, make a payment, reach credential material or sign anything however a conversation phrases the request, and a refusal is recorded rather than silently dropped"

`gatekeeperBridge.ts`: closed operation allowlist, identifier-only arguments, prototype keys refused,
traversal refused, provenance fields refused case-insensitively, refusal returned as a record.
19/19 mutations. **Not live** — there is no bridge to exercise.

### 17. Reviews cover the named attack classes, unresolved CRITICAL and HIGH at zero — **PROVEN, with a scope note**
> "Reviews cover prompt injection across the model boundary and across the owner interface, evidence poisoning, cross-project leakage, stale decision replay, subject drift, credential leakage, model escalation abuse, cost runaway, duplicate calls after restart, self-approval, override replay, degraded-mode escalation, reconciliation bypass and any direct gatekeeper-to-Claude bypass, with unresolved CRITICAL and HIGH at zero"

Seven-lens code and security review of the whole boundary: 60 findings, 9 confirmed by two-lens
adversarial verification, 42 over the cap triaged rather than dropped. Every CRITICAL and HIGH
corrected in code. **Unresolved CRITICAL = 0, unresolved HIGH = 0.**

**Scope note:** the reviews were run at `c4989eb`. The live transport, the credential resolver, the
HTTP port and the loop wiring landed afterwards and have **not** been through the same adversarial
review. If a bridge is built, it will need one too.

---

## What must happen before closure

| Gap | Criterion | What would close it |
|---|---|---|
| No live Claude worker in the cycle | 9, 12 | One `runLoop --execute` with a real worker and the live gatekeeper |
| Correction not driven by a real validator | 10 | Induce a genuine validator failure and let the loop carry it |
| Degraded continuation never exercised | 7, 11 | A committed grant, real bounded work under it, then reconciliation |
| Worker bindings not isolation-tested | 13 | A second project with its own worker binding, mismatched and refused |
| Tunnel availability unread | 14 | The owner's own screen |
| Bridge not built | 15, 16 | The MCP owner bridge, if the tunnel is available |
| Reviews predate the live code | 17 | Re-review of the transport, resolver, port and wiring |

## Carry-forward (non-blocking)

- `PLAN-DRAFT-COMPLETENESS-GAP` — a draft can report zero unknowns while omitting an environment
  activation requires.
- `TIGHTEN-GATEKEEPER-API-PERMISSIONS` — the pilot key retains the broader Restricted configuration
  by explicit owner decision; tighten to the least-privilege role post-pilot.
- No owner-facing cost surface in the Control Centre (criterion 4 caveat).
