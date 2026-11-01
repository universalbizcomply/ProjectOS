# Delta Specification — V4 ports: Hermes, OpenClaw and OpenBot capabilities in ProjectOS

**Status:** APPROVED by the owner, 2026-11-01: "Approved". Phases 1 to 6 are carried by the active plan, from v1.30; phases 7 to 12 enter a later plan once
Stage 2 has settled what they build on. It sits beside `docs/changes/delta_spec.md`, which stays the active delta for Stage 2.
Open owner items: the legal name on original ProjectOS code, and the product name.

**Goal:** ProjectOS gains the capabilities of these projects as its own features, on the kernel's gates, in the
stage order of `docs/06_Plan.md`. The detailed file map is `docs/recon/V4_Port_Map.md`, which this plan builds on.

## The ownership rule

Owner, 2026-11-01: "i want to claim it's mine with giving credits to the due".

ProjectOS is the owner's product. The owner may brand it, rename everything in it, change any of it, sell it and
say "this is my product". Code taken from open-source projects is credited, every time, and that credit is not
optional or removable:

| Rule | Detail |
|---|---|
| Keep the licence | The upstream copyright line and licence text go into `THIRD_PARTY_NOTICES` |
| Mark the file | Each ported file carries a header: upstream project, source path, pinned commit, licence, "modified for ProjectOS" |
| Apache-2.0 | Also carries the upstream `NOTICE` and states the change, as the licence requires |
| Their names and logos | Never used as ProjectOS branding or to imply endorsement |
| Claims | Say "ProjectOS is my product, and it includes credited open-source components". Do not say the owner wrote the upstream code |

Original ProjectOS code and every change we make are the owner's, subject to naming the legal holder (an open owner
item). The credit validator enforces the licence, header, notices and denied-source rows. It cannot prove a file marked
original really is, catch an upstream name inside an identifier, or police what is claimed in public: ADR-P1 §8 lists
what stays with reviewers and the owner.

## Sources

| Source | Licence | Pin | Use |
|---|---|---|---|
| NousResearch/hermes-agent | MIT, © 2025 Nous Research | `d3e586881eacb132595edcbe4c170be8381e40c5` | Port |
| openclaw/openclaw | MIT, © 2026 OpenClaw Foundation | `c5b56f2505c4f6a5803125d2923e2934c5f750af` | Port. Check each file for Pi/pi-mono provenance; that notice carries too |
| CopilotKit/OpenBot | MIT, © 2026 CopilotKit | `c396a5f68c817043846f1ca3c2b42061ee73ceb5` | Port |
| Rakazo, oh-my-hermes, isl-org OpenBot | Apache-2.0 or as recorded | As vendored 2026-10-29 | Port under the owner's earlier yes; each licence is re-read when its phase starts |
| nightly-labs/openbot | **PolyForm Noncommercial 1.0.0**, © 2026 Synthetify Labs | `7ef25fbcc6f71a5a1888485ef0a6f3d2d5c8b5dd` | **Never a code source.** See below |

Pins are the commits inside the owner's downloads of 2026-11-01, in `C:\dev\ProjectOS-vendor\incoming-2026-11-01\`.
Port-list files match the earlier pins, except OpenBot `server/src/computer/policy-network.ts`, reviewed in its phase.

## nightly-labs OpenBot: features yes, code no

Owner: "I need you to copy the skills, code, features of openbot." Its licence forbids commercial use, so its code,
prompts, skills, UI and assets are not copied, translated or closely paraphrased. A credit does not cure that. The
**features** are ideas, and ProjectOS gets all of them, built from MIT sources and our own code:

| Feature | How ProjectOS gets it | Source | Stage |
|---|---|---|---|
| Create and edit agents from a prompt | Agent records proposed through plan review | Our code; Hermes profiles for reference | 4 |
| Persistent agents on Codex, Claude, Gemini, Cursor, Cline and OpenCode | Provider broker by role | OpenClaw `llm-core`; Hermes fallback | 4 |
| Custom OpenAI-compatible endpoints; local model detection | Provider registry entries | OpenClaw `model-catalog-core` | 4 |
| Per-agent context monitoring and automatic compaction | Context manager, summaries never overwrite decisions | Hermes context code; plan 3.3 | 3 |
| Crash-safe per-agent message queues with pause and resume | Task ledger below phase level | Our `core/execution`; OpenClaw for reference | 4 |
| Agent-to-agent messages and file transfer | Same-tenant only, enveloped; cross-tenant stays P5 | OpenClaw `src/routing`; Hermes delegation | 4 |
| Shared channels with one task owner and delegation | Control Center view over the task ledger | Our code; OpenClaw `src/channels` | 6 |
| Embedded browser agents can drive | Sandboxed browser per agent; never the owner's signed-in profile | OpenClaw `extensions/browser`; CopilotKit `server/src/browser` | 4.3 |
| Computer use on Windows, macOS and Linux | Governed action policy | OpenClaw `extensions/cua-computer`; CopilotKit `server/src/computer` | 4.3 |
| Per-agent settings and state | Records per agent | Our code | 4 |
| Privacy-safe diagnostics export | Redacted export | Our `security/redaction` | 6 |
| Optional accounts | Supabase Auth, already in place | Our code | 6 |

**Build rule.** The builder works from this table and the MIT sources. It is not given that repository. Nobody opens
its `src`, and `DO-NOT-PORT.txt` stays in its folder. Its name and branding are not used.

**Not taken from any source:** a mode that runs agents with full access and no approvals, which breaks the owner
floor. Only the Grok *API* stays out, by the owner's standing decision. Grok-like capabilities are in, below.

**If the owner wants its actual code,** the only route is a commercial licence from Synthetify Labs,
`licenses@openbot.run`.

## Grok-like capabilities

Owner: "I want no API from GROK, what I need is GROK like capabilities". So no xAI provider, adapter or key. Each
capability runs on ProjectOS's own models and the MIT sources. Grok Bot itself is closed software and is not copied.

| Grok capability | ProjectOS version | Port ID | Source | Phase | Stage |
|---|---|---|---|---|---|
| Deep research with citations | Step-capped research loop; every answer cites its source | C16 | OpenClaw, Hermes | 11 | 4 |
| Real-time web search | Search provider we run or choose, such as SearXNG or Brave | C16 | OpenClaw | 11 | 4 |
| Real-time X search | **Only** through the official X API, as a paid connector, if the owner chooses it | C16 | Our connector | Later | 5 |
| Chat over your documents | Local index; every answer names file and line; an uncited answer is refused | C10 | OpenClaw | 2 | 3 |
| Memory across conversations | Capped memory; every write is a proposal the owner can see | C8 | Hermes | 3 | 3 |
| Chief-of-staff running a team of agents | Coordinator with child agents, each held to the parent's limits | C12 | Hermes, CopilotKit | 9 | 4 |
| Scheduled tasks | Routines with floors and auto-disable | C13 | CopilotKit | 7 | 4 |
| A computer per agent | Sandboxed browser, shell and workspace for each agent | C14 | OpenClaw, CopilotKit | 10 | 4.3 |
| Check-ins before consequential actions | Existing owner gates; thresholds never loosen by learning | C3 | Already built | — | 1 |
| Mobile approvals and desktop continuity | Approve a real gate from the phone | C18 | OpenClaw | Later | 6 |
| Teach by demonstration | A recorded routine becomes a *proposed* skill | C21 | CopilotKit | Later | 7 |
| Voice | Speech in and out; a spoken "approve" is never an approval | C20 | OpenClaw, Hermes | Later | 8 |

**Left out on purpose, as already recorded in `V4_Capability_Recon.md`:** companions and personalities, approval thresholds
that drift by learning, and always-on autonomy with no gates.

## Phases

Each phase goes through the gates in `V4_Port_Map.md` §4. Every port carries tests, a validator pin with named
mutations, and one independent review. The gstack review joins ECC and Agency reviews as an additional check.

| # | Phase | Delivers | Source | Stage | Runs |
|---|---|---|---|---|---|
| 1 | PORT-FOUNDATION1A | `THIRD_PARTY_NOTICES`; file header format; credit validator; vendor re-pin; `V4_Capability_Recon.md`, ADR-S1 and ADR-S2 brought into line with ADOPT | — | 3 | First; parallel with Stage 2 |
| 2 | PORT-SEARCH1A | Hybrid keyword and vector search, chunker: cited document search and session search (C8, C10) | OpenClaw, ~1.1k lines | 3 | After 1 |
| 3 | PORT-MEMORY1A | Capped memory store and threat scan; writes are proposals (C8) | Hermes, ~0.9k | 3 | After 1 |
| 4 | PORT-SKILLS1A | Skill linter, audit and frontmatter; promotion through a validator (C9) | Hermes, ~1.3k | 3 | After 3 |
| 5 | PORT-CONTEXT1A | Per-agent context monitoring and compaction | Hermes | 3 | After 3 |
| 6 | PORT-APPROVALS1A | Approval core and taint tracking; "evidence before done" receipts | Rakazo, oh-my-hermes | 3 | After 1 |
| 7 | PORT-ROUTINES1A | Routine floors: 15-minute minimum, 20 enabled, auto-disable after 10 failures (C13) | CopilotKit | 4 | After Stage 2 |
| 8 | PORT-PROVIDERS1A | Provider broker, retries, pricing, custom endpoints, local models (C11) | OpenClaw, Hermes | 4 | After Stage 2 |
| 9 | PORT-AGENTS1A | Persistent agents, queues, delegation, same-tenant messages (C7, C12) | OpenClaw, Hermes, ours | 4 | After 8 |
| 10 | PORT-COMPUTER1A | Per-agent browser, computer use, exec approval binding, action policy (C14) | OpenClaw, CopilotKit | 4.3 | After 9 |
| 11 | PORT-RESEARCH1A | Web search and cited research (C16) | OpenClaw, Hermes | 4 | After 8 |
| 12 | PORT-MCP1A | Governed connectors on the connector contract (C15) | OpenClaw, Hermes | 4 | After Stage 2 |

Later, each in its own delta, in the existing stage: channels (C19, Stage 5, Telegram first), human takeover and
mobile approvals (C17, C18, Stage 6), teach by demonstration (C21, Stage 7), voice (C20, Stage 8).

**Order rule.** Phases 1 to 6 touch no tenant boundary and can overlap Stage 2 phases 3 to 7. Anything per-tenant, or
that releases a credential or spends, waits for PRINCIPAL1A and CREDENTIALS1A. Agents that run other people's data
wait for Stage 4 isolation, under D4 and D11.

## Zone 1 — ADDED
- `THIRD_PARTY_NOTICES`, `projectos/validators/val-projectos-port-credit1a.cjs`.
- New modules under `projectos/core/src/` and `projectos/agent/src/`, named per phase; tests beside their peers.
- `docs/adr/ADR-P1-port-ownership-and-credit.md`, `docs/finish/<phase>.md`.

## Zone 2 — MODIFIED
- `docs/recon/V4_Capability_Recon.md`, `docs/adr/ADR-S1*`, `ADR-S2*`: line up with ADOPT.
- `docs/04_TRD.md`: record each approved dependency at its exact version when added.
- `docs/06_Plan.md`: expand Stages 3 and 4.
- `projectos/validators/validate-all.cjs`, `projectos/speed/cached-runner.cjs`: registration only.
- Later phases name exact files in their plan entries.

## Zone 3 — PROTECTED
Everything protected in `00_Baseline_State.md` §4, and the Stage 2 delta's Zone 3. No port may change closure
authority, the owner floor, gatekeeper composition, write grants or the credential custody model. `core` stays pure.
Vendor folders stay read-only: no `npm`, `pip`, `uv` or `bun` inside them, and no code is run from them.

## Refused, whatever the source
Autonomous memory consolidation; agents writing their own skills directly; model-judged approvals and yolo modes;
agent-held credentials, vault autofill and TOTP; attaching to the owner's signed-in browser; internet skill
auto-install; unofficial WhatsApp or iMessage routes; remote execution on a paired phone; dry-run modes that pass
everything.

## Owner decisions this plan needs
1. Approve this delta, so phases can go into a plan.
2. Confirm the first group: phases 1 to 6 now, alongside Stage 2 phases 3 to 7.
3. Choose a legal name for the copyright line on original ProjectOS code. The IP pack proposes RBT Systems Limited,
   and the name "ProjectOS" has a US trademark conflict to resolve before sale.

## Risk
- **Licences:** the credit validator refuses a marked port with no recorded source and any port directory file git ignores. A pasted file marked original is the residual risk; reviewers check it.
- **Security:** upstream code is untrusted until reviewed; every port replaces its unsafe defaults (`V4_Port_Map.md` §5).
- **Scope:** twelve phases of real work. Each is a separate commit series and reverts alone.
- **Disk:** C: has 26 GB free. Vendor folders hold about 2 GB and the older snapshots can go once ports are re-pinned.
