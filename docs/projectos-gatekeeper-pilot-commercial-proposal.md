# OpenAI gatekeeper pilot — commercial decision

**Status: DECIDED by the owner on 2026-08-17.** This document was written as a proposal; the owner's
ruling has been recorded into it, so the figures below are the authority, not a recommendation. What
the owner approved is the LIMITS. No API key exists yet, no billing is active, no credit has been
bought, and nothing in ProjectOS can call a paid endpoint today.

Prepared by the implementer in `PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A`.

## 0. The owner's ruling, as given

| Setting | Value |
|---|---|
| Initial prepaid credit | **USD $5** |
| Auto-recharge | **OFF** — and it must stay off |
| Project warning threshold | **USD $2** |
| Project hard monthly limit | **USD $5** |
| Automatic limit increase | **None.** Any increase needs a new owner decision |

Model policy for the pilot — **a simple two tier, with no dynamic routing**:

| Tier | Model | Used for |
|---|---|---|
| Routine | **GPT-5.6 Luna** | evidence review, ordinary correction |
| Strong | **GPT-5.6 Terra** | security, architecture, closure, genuine ambiguity |
| — | GPT-5.6 Sol | **not part of the default pilot route** |

The ruling approves commercial limits only. It does not instruct the implementer to create, print,
read or expose credential material, and the implementer stops at the point where a real
billing or key-provisioning action is required.

---

## 1. The decision being asked for

Whether to open an OpenAI API account for ProjectOS governance, fund it with a small initial credit,
and create one project-scoped API key for the unattended gatekeeper — under a hard spend limit set by
the owner.

That is the whole ask. Everything else in this phase has been built without it.

## 2. What already exists, built without spending anything

The governance around the reviewer is complete and proven; the reviewer itself is the missing part.

| Built | What it does |
|---|---|
| Decision contract | Verdicts on a closed vocabulary, bound to project, phase, subject commit and request digest; replayed, stale, foreign or self-approved decisions refused |
| Transport abstraction | One configured route, structurally read-only, no vendor hard-wired, no silent fallback to a second transport |
| Cost ledger | Per-request estimate, per-phase, per-project and monthly totals; warning threshold and hard stop; a replayed call counted once |
| Degraded mode | The owner's explicit risk acceptance, bounded and non-replayable, which cannot carry any owner-only authority |
| Reconciliation | Unreviewed work recorded as a debt that blocks the next major gate until each item is reviewed |
| Thread binding | One governance conversation per project, keyed on an opaque provider id — never a title |
| Bridge authority | The owner-interface operation allowlist, with prose and unknown operations refused |
| Stop routing | Which stops a reviewer may answer, and which remain the owner's |

All of it is unit-tested and mutation-proven, and a rehearsal cycle runs the whole chain end to end
with no network and no money.

**What is therefore unproven is the transport — and, honestly, more than the transport.** These are
contracts and a rehearsal, not a running loop: the agent loop still ends at its stop rather than
routing that stop to a reviewer, so nothing here is exercised by a real run yet. The governance is
built and proven in isolation; wiring it into the loop is the next step and needs the live reviewer
to be worth doing.

## 3. Measured volume, not guessed

Token volumes were measured from this repository's real artefacts, not estimated from experience:

| Artefact | Tokens |
|---|---:|
| Approved plan | 4,870 |
| Closure evidence | 3,563 |
| Evidence report | 3,528 |
| Validation output | 3,538 |
| **Full review context** | **17,088** |
| Worker evidence pack (incremental review) | 1,506 |

Output volume is **not** measured — no live decision has been produced. The worked example below
assumes 800 output tokens per decision, which is the size of the structured decision record the
contract requires. It is an estimate and is labelled as one.

## 4. Cost model

Cost per decision is:

```
(input tokens × input rate) + (cached input tokens × cached rate) + (output tokens × output rate)
```

**The rate card is configuration, never code.** `gatekeeperCostLedger.ts` hardcodes no price, because
a hardcoded price goes stale silently and then under-reports what was spent. The rates in force on the
day of purchase must be entered when the account is opened.

Computed earlier in this phase from the published rate card then in force:

- **Two-tier policy** — a cheap model for routine evidence review and corrections, a strong model for
  security, architecture and closure reviews: **$0.0062 per decision**, or **$6.21 per month at 1,000
  decisions**.
- **Cheapest model everywhere**: **$0.49 per month at 1,000 decisions**.
- Cached input is billed at roughly a tenth of fresh input, and a governance thread re-sends the same
  plan and phase context every turn, so caching applies to most of the volume.

For scale: 1,000 decisions a month is roughly 33 governance decisions every day, which is well above
the rate this repository has ever produced.

**The honest conclusion is that cost is not the risk here.** The risk is an unattended process calling
a paid endpoint in a loop, which is a control problem, not a price problem — see below.

## 5. What bounds the spend

Two independent limits, deliberately, because each fails in a way the other does not.

1. **ProjectOS hard stop** (built, proven). The ledger refuses the call that *would* cross the monthly
   limit, checked against the estimate before the call rather than against spend after it. It is
   ProjectOS's own control and needs no external service to work.
2. **OpenAI project spend limit** (available, not yet configured). A hard limit set per project on the
   account returns `429 organization_spend_limit_exceeded` / `project_spend_limit_exceeded`. It holds
   even if ProjectOS is bypassed, modified or run from elsewhere.

Neither is sufficient alone: the first can be edited by anything that can edit this repository, and
the second is documented as **not instantaneous**, so spend can slightly overshoot the limit. Together
they bound both the ordinary case and the case where ProjectOS itself is wrong.

**Settings as decided:** a **$5 prepaid credit with auto-recharge OFF**, a **$5/month hard spend
limit** on the OpenAI project, a matching **$5/month hard stop** in ProjectOS, and a **$2/month
warning threshold**. At the two-tier figure that is roughly 800 decisions a month.

Auto-recharge being off is the more important of the two limits. A hard limit stops spending at a
number; auto-recharge off means the account cannot spend money that was never put into it, which
holds even if a limit is misconfigured. If the limit is ever reached the correct response is to look
at why, not to raise it — and raising it needs a new owner decision, not an edit.

## 6. What the money buys, and what stops without it

**With it**, the loop closes: the owner sets an objective once, and ProjectOS carries reports to the
reviewer and decisions back without a person copying anything. Nine of the phase's acceptance criteria
are about that live behaviour and cannot be satisfied by rehearsal — the live cycle, the automatic
bounded correction, the unavailability path exercised against a real outage, restart mid-objective,
and the owner interface over the tunnel.

**Without it**, everything already built stays useful — the contracts, the refusals, the ledger, the
routing — but the relay stays manual, and this phase cannot reach closure. That is a legitimate
outcome. It is not a reason to proceed.

## 7. What is NOT being requested

Stated explicitly so approval of this proposal cannot be read as approval of any of it:

- No ChatGPT plan change, and no purchase other than the API credit above.
- No Secure MCP Tunnel credential activation. The owner interface needs a runtime key of its own and is
  a separate decision, after the reviewer is proven.
- No production deployment, database change, real message, payment or refund.
- No credential stored anywhere but the owner's chosen secret store; ProjectOS configuration holds a
  credential *reference*, and the transport contract refuses configuration containing key-shaped
  material.
- No GUI or browser automation, no scraping of any chat interface.
- No standing authority. The commercial gate covers the pilot; a later expansion is a later decision.

## 8. Residual risks, stated rather than implied

- **Spend can slightly overshoot** the OpenAI limit; enforcement is documented as not instantaneous.
- **ProjectOS is `MANUAL_GOVERNANCE_APPROVAL`, `tamperProof: false`** throughout. Anything that can
  write these files can write a decision record. The backstop is the owner's commit and push gate,
  where every record is a visible diff. The hard stop is a control against runaway automation, not
  against a determined edit.
- **A reviewer can be wrong.** The contract bounds what a decision may *authorise*, never whether its
  reasoning is sound. Owner-only actions stay owner-only precisely because of this.
- **Developer mode is ENABLED and "Enforce CSP in developer mode" is ENABLED**, visually verified by
  the owner in ChatGPT settings. This is recorded as established fact and is not to be reported as
  unknown again. It does **not** prove the Secure MCP Tunnel: whether a tunnel connection actually
  works from this account remains a credentialed live-pilot acceptance item, because the tunnel client
  needs a runtime key that does not yet exist.

## 9. The decision, and what happens next

**Approved at the lower level**: $5 credit, auto-recharge off, $5/month hard limit on both sides,
$2/month warning. Two-tier model policy, no dynamic routing.

The account, the billing and the key are established by the **owner**, not by the implementer. The
implementer stops at that interaction and supplies plain instructions for the settings screens. The
key is never pasted into ChatGPT, into Claude, into a prompt, into a report or into repository text;
ProjectOS configuration holds only a credential *reference*, and the transport contract refuses
configuration containing key-shaped material.
