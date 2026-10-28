# ADR-S2 — OpenClaw (gateway, channels, device nodes): REFERENCE

**Status:** Decided by the spike, 2026-10-28 (V4 plan Stage 1, spike S2). It is research only.
Nothing was installed, cloned or run. A research subagent drafted it from primary sources and the
lead recorded it. The cited claims were not re-verified one by one, and anything marked UNVERIFIED
is still open.

## Question
Can OpenClaw provide messaging channels, device nodes or gateway connectivity as an adapter, with
no second orchestrator and every real send owner-gated?

## Findings
- **The product.** TypeScript (Node 24), MIT licence, about 393k stars, with releases several times
  a week. The Gateway is "the local control plane for sessions, tools, events, and channel
  connections". It covers 20+ channels (WhatsApp, Telegram, Slack, Teams, Signal, iMessage and
  others). ([repo](https://github.com/openclaw/openclaw),
  [protocol](https://docs.openclaw.ai/gateway/protocol))
- **Orchestration.** Using any part of it means running the Gateway, which owns sessions, agents,
  tools and approvals. Whether a headless send that skips the agent exists is **UNVERIFIED**.
  ([cli/message](https://docs.openclaw.ai/cli/message))
- **Outbound gating.** By default an agent with the message tool "can send across conversations and
  providers". The plugin `message_sending` hook can cancel a send. Its fail-open or fail-closed
  behaviour, and whether it covers every send path, are **not documented**.
  ([tool permissions](https://docs.openclaw.ai/gateway/security/tool-permissions),
  [hooks](https://docs.openclaw.ai/plugins/hooks/messages.md))
- **Credentials.** Plaintext files under `~/.openclaw`, with no DPAPI or keychain support.
  ([secrets](https://docs.openclaw.ai/gateway/security/secrets-and-storage))
- **Windows.** It runs as a Scheduled Task with an S4U principal, not as a service.
  ([windows](https://docs.openclaw.ai/platforms/windows))
- **Security record.** Hundreds of GitHub advisories; the latest batch (11 Sep 2026) had 2 High.
  Its trust model is a single trusted operator: anyone who can message an agent shares its tool
  authority. It calls prompt injection "not a solved problem".
  ([advisories](https://github.com/openclaw/openclaw/security/advisories),
  [trust model](https://docs.openclaw.ai/gateway/security/trust-model)) The count is an estimate,
  and the CVE details are UNVERIFIED.

## Decision: REFERENCE
OpenClaw is a second orchestrator by design, and its send gate cannot be shown to be fail-closed.
Its plaintext credentials and paired-node remote execution conflict with ProjectOS custody.

**Worth borrowing:**
- the channel pairing and allowlist UX;
- the node role, scope and handshake model;
- the exec-approval binding (a command cannot be edited after it is approved);
- its layered prompt-injection guidance.

**Revisit only if** a later spike proves both a headless, agent-free send path and a fail-closed hook
that covers every send. Even then, the boundary would be a separate instance under its own OS user,
with agents and tools disabled. It would only send messages carrying a ProjectOS-minted approval
reference. Inbound messages would be untrusted data, and nodes would never be paired.
