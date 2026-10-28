# ADR-S4 — LiveKit for the Stage 8 voice plane: ADAPTER (deferred to Stage 8)

**Status:** Decided by the spike, 2026-10-28 (V4 plan Stage 1, spike S4). It is research only.
Nothing was installed, cloned or run, and no account or number was created. A research subagent
drafted it from primary sources and the lead recorded it. The cited claims were not re-verified one
by one, and anything marked UNVERIFIED is still open. Nothing is built until Stage 8 is planned and
approved.

## Question
Can LiveKit give ProjectOS Phone a real-time voice plane while every action a call takes passes
through ProjectOS policy, and outbound calls stay owner-gated?

## Findings
- **Agents framework.** Python and Node SDKs under Apache-2.0. The server and SIP service are also
  Apache-2.0 and can be self-hosted. The turn-detector model is under the separate **LiveKit Model
  License** and works only with LiveKit Agents; its current text is UNVERIFIED.
  ([agents](https://github.com/livekit/agents), [server](https://github.com/livekit/livekit),
  [turn detector](https://docs.livekit.io/agents/logic/turns/turn-detector))
- **SIP.** Inbound and outbound trunks, DTMF, SRTP and cold transfer (REFER). Warm transfer is Python
  beta and needs an outbound trunk. LiveKit's own numbers are US-only, so UK and EU numbers come
  from a third-party trunk. ([telephony](https://docs.livekit.io/sip/),
  [warm transfer](https://docs.livekit.io/telephony/features/transfers/warm.md))
- **Policy fit.** Every tool handler is our own code, so it can call ProjectOS synchronously.
  `ToolError` returns a denial to the model, and `update_tools()` withdraws tools mid-session. There
  is no framework timeout, so we must set our own. The policy round-trip latency is UNVERIFIED until
  it is measured. ([tools](https://docs.livekit.io/agents/logic/tools/definition.md))
- **Outbound gating.** This is structural: dialling and transfers need the SIP `call` grant, and
  trunk changes need `admin`. If neither the grant nor an outbound trunk is given to the agent, it
  cannot dial. ([SIP API](https://docs.livekit.io/reference/telephony/sip-api.md))
- **Gaps.** There is no consent feature for recording, so we would build the disclosure and capture.
  Recordings have been reported truncated, but those reports are unofficial. The Cloud data region
  is fixed when a project is created, and media pinning needs the Scale tier. Windows support is
  UNVERIFIED for the SIP service, which would run in Docker or WSL.
- **Pricing**, checked 2026-10-28 at [livekit.com/pricing](https://livekit.com/pricing):
  - Build is $0 with 1,000 agent minutes; Ship from $50 a month; Scale from $500 a month.
  - Agent minutes cost about $0.01 each, and US numbers $1–2 a month.
- **Alternatives.** Pipecat (BSD-2, assemble the SIP yourself) and Twilio ConversationRelay
  (Twilio-locked, cannot self-host). Pipecat is the reference fallback.

## Decision: ADAPTER (Stage 8 only)
The boundary is narrow:
- The voice process holds **no real-world credentials**.
- Every tool calls one `projectos.propose(action)` client, which is synchronous, has a timeout and
  fails closed. A denial comes back as `ToolError`.
- The SIP `call` and `admin` grants and the outbound trunk live only inside ProjectOS. Outbound
  dialling and warm transfer are actions ProjectOS executes.
- The agent receives inbound calls only.
- A lint rule enforces that only the policy client may cause side effects.

## Owner decisions this creates (Stage 8)
1. The telephony provider and numbers (UK or EU needs a third-party trunk).
2. The recording policy: whether to record, consent wording, retention, and the lawful basis under
   GDPR and PECR.
3. Cloud or self-hosted: self-hosting needs a public IP, an open UDP range and Redis.
4. The plan tier: region pinning needs Scale.
5. Rules on disclosing that the caller is an AI, and on automated calling (Ofcom, TCPA).
