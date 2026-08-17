# ProjectOS Autonomous Self-Hosting — plan document

projectId: projectos

> **What this document is.** The owner's autonomous-self-hosting directive of 2026-08-17, transcribed
> into the repository by the implementer so that ProjectOS can read it as a planning source instead of
> it living only in a chat message. It is the INPUT to planning and it authorises nothing on its own:
> no phase may start until ProjectOS produces a draft from it and the recorded plan-approval authority
> approves that exact draft.
>
> Owner: Murad. Gatekeeper / delegated technical authority: ChatGPT. Implementer: Claude Code.
>
> **This is a NEW programme.** ProjectOS Operational Recovery is CLOSED at 6/6, 100%, and is not
> reopened, renumbered or rewritten by anything here. Its closed phases stay closed.
>
> **Why it exists.** Today the owner is the message bus. He copies reports from Claude to ChatGPT and
> decisions from ChatGPT back to Claude. Everything else in ProjectOS is automated; this one human
> relay is what stops the loop closing. This programme removes that relay and nothing else.

## Statement of intent

Vision: ProjectOS coordinates OpenAI governance and Claude implementation by itself, so the owner sets direction and approves protected actions instead of carrying messages between two models.

Definition of complete: one objective entered once by the owner runs through gatekeeper decision, Claude implementation, evidence return, gatekeeper review and a bounded correction, plus a proven gatekeeper-unavailable owner choice, degraded-mode continuation, reconciliation, restart and multi-project isolation, with the owner performing no copy or paste between OpenAI and Claude and unresolved CRITICAL and HIGH findings at zero.

Success standard: the owner can say "continue ProjectOS" and the system safely advances the work on its own, stopping only at genuine owner-protected gates.

## Architecture

Three surfaces, with ProjectOS as the authority router in the middle:

```
            MURAD  ──►  CHATGPT (human oversight, strategy, questions)
                              │
                 OpenAI Secure MCP Tunnel (outbound only)
                              │
                  small private ProjectOS MCP bridge
                              ▼
                        P R O J E C T O S
              state · routing · evidence · gates · cost
                   /                         \
                  ▼                           ▼
        OPENAI GATEKEEPER                   CLAUDE
      unattended review, READ-ONLY      implementation worker
       (Responses API, primary)          (Claude Code worker)
                  \                           /
                   └──────  PROJECTOS  ──────┘

        optional secondary transport: subscription Codex
```

Claude and the OpenAI gatekeeper never communicate directly. Both talk only to ProjectOS.

**The owner interface does not require exposing ProjectOS to the internet.** OpenAI's Secure MCP
Tunnel is an outbound-only HTTPS connection from a `tunnel-client` running beside the private MCP
server; the client long-polls OpenAI for queued work, forwards requests to the local server and
returns responses through the same tunnel. The documented properties are that the private MCP server
"does not need a public listener" and its address "stays private and is used only from inside the
environment where `tunnel-client` runs". ChatGPT selects it via Plugins, the plus button, then
**Tunnel** under **Connection**. The tunnel is usable from ChatGPT, Codex and the Responses API, and
its stated limitation — no public plugin submission or distribution — does not apply to a private
owner interface.

Two consequences are recorded honestly. First, `tunnel-client` needs a runtime OpenAI API key, so the
owner interface depends on the same commercial gate as the primary gatekeeper and cannot be built
before it. Second, whether this account actually exposes Developer mode is a fact to be verified on
the owner's own screen, not assumed from documentation.

This preserves, rather than replaces, the principle already recorded in
`docs/architecture/projectos-automatic-bridge-architecture.md`: *"Wrong: ChatGPT -> Claude -> ChatGPT.
Right: ChatGPT -> ProjectOS -> Claude Code -> ProjectOS -> ChatGPT."* That document also already
defines the reviewer as a worker that **never touches the machine**. What it lacks — and all this
programme adds — is a machine transport, because it currently says review material is *"delivered to
ChatGPT by the owner (copy/paste)"*.

## Environments

- local — production freeze: yes

Local development only. No staging, no production. Non-production, reversible, local-only work.

## Approved scope

- A supported unattended OpenAI gatekeeper transport, behind a transport abstraction so no single
  vendor route is hard-wired.
- Machine-readable gatekeeper decisions on a closed decision vocabulary, bound to project, phase,
  subject commit and request digest, non-replayable, modelled on the existing closure-decision
  contract rather than a new invention.
- A per-project governance thread/state binding, keyed on an opaque provider identifier held in
  governed project state — never on a conversation title, tab or window.
- An API cost ledger: per-request estimate, per-phase total, per-project total, monthly total,
  owner-visible status, with a configurable warning threshold and hard stop.
- Fail-safe behaviour when the gatekeeper is unavailable, presenting the owner with an explicit
  choice and never continuing silently.
- An owner-risk degraded mode that is explicit, durable, auditable, bound to project, phase, subject
  and decision, non-replayable, and which cannot grant any owner-only protected authority.
- Reconciliation review when the gatekeeper returns after degraded-mode work.
- Reuse of the existing worker loop, invocation provenance, evidence records, project registry,
  authority schemas and Control Centre surfaces.
- A SMALL private owner interface: a minimal ProjectOS MCP bridge reachable from ChatGPT over the
  Secure MCP Tunnel, included only if Developer mode and the tunnel are genuinely available on the
  owner's account. It exposes the smallest useful governed operations and reuses existing ProjectOS
  contracts and command names rather than inventing a parallel surface. Read: project state, active
  phase, pending gate, evidence, worker status, cost and budget status. Governance and control: record
  a bound decision, record an owner decision, continue already-authorised work, stop work.

## Excluded scope

- No paid API activation, credential creation, billing setup or credit purchase. Those are a separate
  owner commercial gate, and this programme must reach that gate with evidence before any spend.
- No GUI, browser, mouse, keyboard or window automation, and no scraping of any chat interface.
- No production deployment, database mutation, real email, SMS or WhatsApp, payment or refund.
- No new orchestration framework, no second ProjectOS, no Forge rebuild, no Control Centre redesign,
  no delivery of the wider product roadmap. This programme builds only the bridge that lets ProjectOS
  deliver that roadmap itself.
- No large ChatGPT application, no public plugin submission or distribution, and no owner-interface
  operation that reaches past ProjectOS authority. The bridge may never offer production deployment,
  database mutation, arbitrary shell execution, an external send, a payment or refund, credential
  access or signing, whatever a conversation asks of it.
- No plan-approval delegation is created during this bootstrap; the owner approves this plan
  personally, and delegation policy is designed separately once the loop is proven.
- No local model substituted for the OpenAI governance layer. A local model may rehearse transport
  plumbing only and can never be the accepted gatekeeper.

## Phases

### PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A — Close the OpenAI/Claude governance loop

Purpose: Let ProjectOS coordinate OpenAI governance and Claude implementation by itself, so the owner supplies an objective once and never again carries a prompt, report or gate decision between them.
Scope: One OpenAI gatekeeper transport adapter, a machine-readable gatekeeper decision contract, per-project governance-thread binding, a cost ledger with budget policy, a fail-safe unavailability path, an owner-risk degraded mode with reconciliation, and the validators and tests that hold those honest.
Depends on:
Risk: high
Autonomy: gated-execution
Browser proof: no
Acceptance criteria:
- A supported unattended OpenAI transport is implemented behind an abstraction, and unattended operation never depends on a browser window, a desktop app window, a focused tab or a conversation name
- The gatekeeper is structurally read-only: it reviews, reasons and decides, and it cannot modify source, commit, push, deploy, mutate a database, transmit an external message, make a payment, or reach credential material
- Gatekeeper decisions are machine-readable on a closed vocabulary and bind projectId, phaseId, subject commit and request digest; ProjectOS refuses a decision that mismatches any of them, is unknown, is schema-invalid, is stale or replayed, arrives for another project, or asserts an owner-only authority
- The cost model is derived from measured ProjectOS artefact sizes rather than guessed, and a per-request estimate, per-phase total, per-project total and monthly total are recorded and visible to the owner
- A configurable budget with a warning threshold and a hard stop exists, and no paid API activation, credential creation or purchase happens without a separate owner commercial approval
- When the gatekeeper is unavailable for any reason the run FAILS SAFE and presents the owner an explicit choice; Claude never becomes its own approver and there is no silent fallback between transports
- Owner-risk degraded mode is explicit, durable, auditable, project-bound, phase-bound, subject-bound, decision-bound, scoped and non-replayable, and it cannot authorise any owner-only protected action; commit and push require their own explicit grant
- When the gatekeeper returns, a reconciliation review of the degraded-mode work is prepared and the next major gate does not proceed as normal until it is complete
- One ordinary end-to-end cycle is proven live: objective in, gatekeeper decision, Claude work, evidence back, gatekeeper review, next bounded action, with the owner performing zero OpenAI-to-Claude copy or paste
- One automatic bounded correction cycle is proven, driven by a real validator failure and a gatekeeper correction decision rather than by a human
- One gatekeeper-unavailable owner decision, one degraded-mode bounded continuation and one return-to-gatekeeper reconciliation are each proven
- Restart and resume are proven mid-objective without duplicating a decision, a Claude run, a commit or a cost entry
- Multi-project isolation is proven: distinct project ids, repository roots, thread bindings and worker bindings, with deliberately mismatched bindings refused and no cross-project leakage of prompt, evidence, decision, session or repository facts
- Whether ChatGPT Developer mode and the Secure MCP Tunnel are available on the owner's own account is established as a fact from the owner's screen before the bridge is built, and recorded; the phase does not claim a capability it has not seen
- If they are available, a small private ProjectOS MCP bridge is proven from ChatGPT over the outbound-only tunnel with no public listener and no exposure of the local address, reusing existing ProjectOS contracts, and the owner interface keeps working when the primary gatekeeper transport is unavailable
- Every bridge operation passes through ProjectOS authority, so the bridge cannot deploy, mutate a database, run an arbitrary command, transmit an external message, make a payment, reach credential material or sign anything however a conversation phrases the request, and a refusal is recorded rather than silently dropped
- Reviews cover prompt injection across the model boundary and across the owner interface, evidence poisoning, cross-project leakage, stale decision replay, subject drift, credential leakage, model escalation abuse, cost runaway, duplicate calls after restart, self-approval, override replay, degraded-mode escalation, reconciliation bypass and any direct gatekeeper-to-Claude bypass, with unresolved CRITICAL and HIGH at zero
Required validators: validate-all
Required reviews: code-review, security-review
Owner gates: commit, push, phase-closure, secrets-handling, payment-or-live-charge
