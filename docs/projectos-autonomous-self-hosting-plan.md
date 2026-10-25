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
Scope: One OpenAI gatekeeper transport adapter, a machine-readable gatekeeper decision contract, per-project governance-thread binding, a cost ledger with budget policy, a fail-safe unavailability path, an owner-risk degraded mode with reconciliation, and the validators and tests that hold those honest. Implementation may also modify projectos/agent/src/loop/runner.ts only to connect validated correction authority to the existing worker invocation, and projectos/agent/src/closureGate.ts only to recognise the governed canonical current-state location in programme-state drift checks; neither path is writable by the autonomous correction worker.
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
- One automatic bounded correction-decision cycle is proven live, driven by a real mandatory check failure and the gatekeeper's own decision rather than by a human: when the current worker cannot correct the failure ProjectOS consults the live gatekeeper once, without futile retries, and binds and enforces the returned decision against projectId, phaseId, subject commit and request digest exactly; a verdict authorising correction grants only the already-bounded correction authority, holds the correction worker inside its permitted path boundary, keeps the correction budget bounded and returns evidence for re-review; AWAITING_OWNER or any other non-correction verdict mints no correction authority, edits no source, consumes no correction budget and stops at the owner gate; and no retry may be used to obtain a different verdict, so the criterion never requires the independent gatekeeper to return a predetermined one
- One gatekeeper-unavailable owner decision, one degraded-mode bounded continuation and one return-to-gatekeeper reconciliation are each proven
- Restart and resume are proven mid-objective without duplicating a decision, a Claude run, a commit or a cost entry
- Multi-project isolation is proven: distinct project ids, repository roots, thread bindings and worker bindings, with deliberately mismatched bindings refused and no cross-project leakage of prompt, evidence, decision, session or repository facts
- Whether ChatGPT Developer mode and the Secure MCP Tunnel are available on the owner's own account is established as a fact from the owner's screen before the bridge is built, and recorded; the phase does not claim a capability it has not seen
- If they are available, a small private ProjectOS MCP bridge is proven from ChatGPT over the outbound-only tunnel with no public listener and no exposure of the local address, reusing existing ProjectOS contracts, and the owner interface keeps working when the primary gatekeeper transport is unavailable
- Every bridge operation passes through ProjectOS authority, so the bridge cannot deploy, mutate a database, run an arbitrary command, transmit an external message, make a payment, reach credential material or sign anything however a conversation phrases the request, and a refusal is recorded rather than silently dropped
- Reviews cover prompt injection across the model boundary and across the owner interface, evidence poisoning, cross-project leakage, stale decision replay, subject drift, credential leakage, model escalation abuse, cost runaway, duplicate calls after restart, self-approval, override replay, degraded-mode escalation, reconciliation bypass and any direct gatekeeper-to-Claude bypass, with unresolved CRITICAL and HIGH at zero
Required validators: validate-all
Required reviews: code-review, security-review
Owner gates: secrets-handling, payment-or-live-charge

### PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A — Carry out the technical continuation a decision authorises

Purpose: Let ProjectOS perform the ordinary technical continuation an already-checked live gatekeeper decision authorises, so the owner no longer has to carry commit, push and integration by hand once the reviewer has answered.
Scope: A closed technical action vocabulary, a deterministic candidate-byte identity bound transitively through the existing gatekeeper request digest, an owner-recorded technical-continuation delegation scope with its reader, a conditional owner-only floor separating absolutely protected actions from ordinary source-control ones, a bounded executor for commit, ordinary push and fast-forward-only integration, and the wiring that reaches it from the canonical run loop. It introduces no second gatekeeper, no second executor, no second closure mechanism and no arbitrary command execution.
Depends on: PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A
Risk: high
Autonomy: gated-execution
Browser proof: no
Acceptance criteria:
- A technical continuation requires all of a live decision that passed checkGatekeeperDecision, a valid committed delegation carrying the technical-continuation scope, that decision naming the action, and the action being one of a closed set ProjectOS can perform; no subset is sufficient and an unknown action is refused rather than attempted
- The exact bytes a commit would record are named deterministically and bound to the evidence the gatekeeper read, so a decision is about those bytes; a one-byte change, a file added, a file removed, a rename or a changed candidate boundary after the decision each prevent the commit
- The candidate identity is re-derived immediately before acting, after any network reconciliation, and a difference stops the action
- Operational parameters come from governed runtime context only; no command, argument, flag, branch, remote or refspec may arrive from model text, worker output, a checkpoint or a stored record
- Force push, force-with-lease, arbitrary refspecs, tags, releases, ref deletion, rebase, amend, reset and shell execution are not expressible by the executor
- Absolutely protected actions never yield to a technical delegation, and ordinary commit and push yield only to a proven one; the default with no delegation supplied remains the full owner-only floor
- Degraded mode never yields commit or push, because continuing without a reviewer is the state the floor exists for
- A phase that declares commit or push among its own required owner gates keeps them owner-only regardless of any delegation
- Persisted decision evidence, the work checkpoint and implementer text authorise nothing, and no reader turns any of them into permission
- An ordinary continuation is proven end to end against a disposable repository and a local bare remote: reviewed candidate, checked decision, bounded commit, ordinary push, local and origin reconciled
- Candidate drift after approval and a protected action requested under an otherwise complete conjunction are each proven refused
Required validators: validate-all
Required reviews: code-review, security-review
Owner gates: secrets-handling, payment-or-live-charge

### PROJECTOS-OWNER-ESCALATION-WAIT1A — Wait for the owner durably, and resume safely

Purpose: Let ProjectOS stop for an owner decision and resume from it without losing what it knew, so a protected question does not end the work and a returning owner does not restart it.
Scope: Durable owner-wait state, the escalation record that names what is being asked and why, and the safe resume that continues from it. No new authority, no new executor and no relaxation of any protected action.
Depends on: PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A
Risk: medium
Autonomy: gated-execution
Browser proof: no
Acceptance criteria:
- A run that stops for the owner records what was asked, at which commit, and what would follow each answer
- Resuming continues from the recorded position without replaying a decision, a worker run, a commit or a cost entry
- An owner wait never becomes an approval by elapsing, and no default answer is inferred from silence
- Protected actions remain owner-only throughout
Required validators: validate-all
Required reviews: code-review, security-review
Owner gates: secrets-handling, payment-or-live-charge

### PROJECTOS-SESSION-RECOVERY1A — Reconcile what actually happened after a crash

Purpose: Let ProjectOS establish the truth about an interrupted run from the repository and its own records, so a crash leaves a question it can answer rather than a state nobody can trust.
Scope: Startup reconciliation of the work checkpoint against real git and project state, orphaned-run detection, and the decision about the configured-check timeout carried forward from the worker-lifecycle work. It owns restart recovery; earlier phases deliberately do not.
Depends on: PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A
Risk: medium
Autonomy: gated-execution
Browser proof: no
Acceptance criteria:
- Startup establishes from git and the governed records what the previous run actually completed, rather than believing a checkpoint
- A historical decision is never replayed as authority after a restart; a fresh gate is required where one is needed
- An interrupted run is reported truthfully, including the cases where the answer is that it cannot be determined
- The unbounded configured-check timeout carried forward from the worker-lifecycle phase is decided and recorded
Required validators: validate-all
Required reviews: code-review, security-review
Owner gates: secrets-handling, payment-or-live-charge

### PROJECTOS-AUTONOMOUS-SELF-CHANGE-PILOT1A — Prove one bounded self-change without a human relay

Purpose: Prove that ProjectOS can carry one bounded change to itself from objective to pushed result without the owner relaying anything between Claude and the gatekeeper.
Scope: One real bounded self-change exercised through the existing loop, gate, delegation and continuation machinery, with its evidence. It builds no new mechanism.
Depends on: PROJECTOS-OWNER-ESCALATION-WAIT1A, PROJECTOS-SESSION-RECOVERY1A
Risk: high
Autonomy: gated-execution
Browser proof: no
Acceptance criteria:
- One bounded change to ProjectOS itself is carried from objective to pushed result with the owner performing zero relay between the reviewer and the implementer
- Every protected action encountered stops for the owner rather than proceeding
- The run's account of what it did matches what the repository shows
Required validators: validate-all
Required reviews: code-review, security-review
Owner gates: secrets-handling, payment-or-live-charge
