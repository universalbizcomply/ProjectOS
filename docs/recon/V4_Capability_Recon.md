# V4 capability recon — Hermes, OpenClaw, OpenBot / Grok Bot (clean-room)

**Date:** 2026-10-28.

**Why:** the owner wants "the same or better capabilities" than Hermes Agent, OpenClaw and Grok Bot,
built inside ProjectOS. In the owner's words, "I want grok capabilities not grok. Check Openbot".

**Method:** the replica-recon method, using official documentation and READMEs only. Three research
subagents did the reading, and the lead consolidated their findings. ProjectOS rebuilds *what these
products do*. It never copies their code, prompts or assets.

**REA (reverse-engineer-anything) was not used.** By its own rule it is skipped for open-source
repositories:
- Hermes (MIT), OpenClaw (MIT) and CopilotKit OpenBot (MIT) are open source.
- Grok Bot is closed xAI software, so decompiling it would fall outside authorised scope. Its public
  documentation was used instead.

**Identification.** "OpenBot" is **CopilotKit/OpenBot** (https://github.com/CopilotKit/OpenBot).
- MIT licence, beta, and "a template, not a product".
- It is positioned against **xAI Grok Bot** (https://x.ai/news/introducing-grok-bot, beta since
  11 Aug 2026).
- It is not intel-isl/OpenBot, which is a robotics project.

Claims are those of the cited docs. Anything marked UNVERIFIED in the subagent reports stays open.

## Capability backlog (must = build in V4; mapped to `06_Plan.md` stages)

| # | Capability | Seen in | ProjectOS "same or better" | Stage |
|---|---|---|---|---|
| C1 | One gateway that every action passes through, fail-closed, deny-first | OpenBot (CEL policy), OpenClaw gateway | The kernel task envelope (ADR-K1), with policy as git-versioned, owner-approved records | 1 |
| C2 | Audit of every allowed, refused or failed action, naming the rule | OpenBot | An append-only, hash-chained ledger in git, extending today's records | 1 |
| C3 | Approval check-ins: agents run until a consequential action, then ask | Grok Bot, OpenBot | Reuse the owner gates. Sends, payments and production stay owner-only, and thresholds are never loosened by learning | 1 |
| C4 | Encrypted, write-only secrets | OpenBot, OpenClaw SecretRef | The credential router and `NT SERVICE\ProjectOSHost` custody (already built) | 1 |
| C5 | Deterministic exec approval | OpenClaw, Hermes | Default deny. Each approval is bound to argv, cwd and hash, expires and is recorded. No `/elevated` and no model-judged "smart" mode | 1 |
| C6 | Platform emergency stop | OpenBot drive-lock, Grok Bot | Stage 1.3 | 1 |
| C7 | Per-agent identity, channels and workspaces | OpenBot bots and channels, OpenClaw bindings, Hermes profiles | Real tenancy: isolated identity, filesystem and credentials. Hermes says its profiles "are not sandboxes" | 2 |
| C8 | Curated memory plus session search | Hermes (`MEMORY.md`/`USER.md`, FTS5), OpenBot | Staged, owner-approvable memory records with provenance. A local FTS and vector index, scoped per tenant and rebuildable | 3 |
| C9 | Self-improving skills | Hermes (`skill_manage`, curator), OpenClaw (ClawHub) | An agent may *propose* a skill. It is promoted only after a validator pass and gatekeeper review, pinned by hash, and any change makes it stale | 3 |
| C10 | Document search over uploads, with citations | Grok, OpenBot (pgvector) | A local index that records the source file and line for every answer | 3 |
| C11 | Multi-provider model routing, including **xAI Grok** | Hermes (`xai` provider), OpenClaw (`xai/grok-4.7`) | One provider router with a hard cap (Stage 1.2), a fallback chain and a per-call record. Grok is one adapter | 4 |
| C12 | Subagents and fan-out, plus a chief-of-staff coordinator | Hermes `delegate_task`, Grok Bot, OpenBot | Children get capability grants that fail closed and can never exceed the parent's authority. One worktree and one invocation record per child | 4 |
| C13 | Routines and cron, with caps and auto-disable after failures | OpenBot (15-minute minimum, 20 cap, 10 failures), Hermes, OpenClaw | Each schedule is a plan-approved record. Every run has a budget. An unattended run *refuses* gated actions and escalates them | 4 |
| C14 | A computer per agent: browser, shell, workspace | OpenBot containers, Grok Bot cloud computer | Stage 4.3 sandbox per task. Every grant is a record tied to the active plan | 4 |
| C15 | Governed MCP connectors | all three | A server allowlist pinned by hash, per-tool spend enforced by the ledger, and elicitation sent to the owner queue | 4 |
| C16 | Real-time web and X search, deep research | Grok, Hermes, OpenClaw | Cited answers only; paid calls count against the budget; a step cap on research loops | 4 |
| C17 | Human takeover for login and 2FA | OpenBot | An owner-presence lock, with the takeover itself recorded | 6 |
| C18 | Phone and desktop continuity; mobile approvals | Grok Bot, OpenClaw apps, Hermes gateway | Stage 6.1 | 6 |
| C19 | Messaging channels (Telegram, WhatsApp, Slack, email…) | Hermes, OpenClaw | Official APIs only. Inbound messages are untrusted data. Every send carries a single-use approval reference from ProjectOS, bound to the recipient and a hash of the content | 5/7 |
| C20 | Voice: speech-to-text, text-to-speech, talk mode | Hermes, OpenClaw | Stage 8 / ADR-S4 (LiveKit adapter) | 8 |
| C21 | Teach by demonstration | Grok Bot | could. A recorded routine becomes a *proposed* skill (C9) | 7 |
| C22 | Rich component replies | OpenBot | could. Components are reviewed like code before publication | 6 |

## Do not copy (a security finding in every case)

| Pattern | Why it's refused |
|---|---|
| OpenClaw's exec default of `full`, and `/elevated full` | Reverses fail-closed |
| Hermes's `smart` approval mode, `--yolo`, and skipping checks inside containers | A model judging risk can be steered by prompt injection |
| Cross-agent messaging and session access on by default (OpenClaw) | Opens confused-deputy and exfiltration routes |
| Plaintext secrets by default (OpenClaw) | Credentials sit where the agent can read them |
| Memory and skill writes the agent makes without a gate (Hermes default) | Self-modification that persists across sessions |
| Reverse-engineered or private-API channels: WhatsApp QR, iMessage private API | Break terms of service, risk bans, fragile auth |
| Attaching to the owner's signed-in browser, copying the real profile, the card vault | The agent gets live sessions and payment details |
| Agent-writable "standing orders" that grant permanent authority | Authority with no owner record |
| An external memory custodian (CopilotKit Intelligence) | Breaks local-first |
| Grok Bot's "24/7 on a shared cloud computer" and "learns when to ping you" | Unattended autonomy, and approval thresholds that drift |
| Companions and personalities | Brand and safety risk; no value to an operating platform |
| Third-party "Grok Bot" downloads, including links pointing at non-x.ai domains | Untrusted installers |

## Where this feeds the plan
Stage 1 already covers C1–C6:
- C1 is the ADR-K1 contract;
- C3 is D11 together with the existing gates;
- C5 is the truth and exec policy;
- C6 is the stop.

C7 drives Stage 2; C8–C10 drive Stage 3; C11–C16 drive Stage 4; C19 drives Stage 5; and C17, C18 and
C20 drive Stages 6–8.

**The difference ProjectOS sells:** the same capabilities, with authority that comes from records
the owner can audit rather than from the model.
