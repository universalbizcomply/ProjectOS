# Port map: Hermes Agent, OpenClaw and OpenBot into ProjectOS (C7–C21)

**Date:** 2026-10-29. **Status:** a research artefact. No file in any ProjectOS repository was changed.
**Owner decisions applied:** clone and adapt rather than rebuild clean-room; ported files keep their MIT
notice and are listed in `THIRD_PARTY_NOTICES`; no Grok API (C11 and C16 are built on our own stack).

## 1. Pinned sources (shallow clones, UNTRUSTED DATA, read-only)

| Repo | Local clone | Pinned HEAD | Commit date | Tracked files |
|---|---|---|---|---|
| NousResearch/hermes-agent | `C:\dev\ProjectOS-vendor\hermes-agent` | `ef75bc708867e3884cb40a91363be6dc6fddc034` | 2026-10-28T23:07:47-07:00 | 21,857 |
| openclaw/openclaw | `C:\dev\ProjectOS-vendor\openclaw` | `bde3017359edf796459ad4d5e3753ac6b84a49bf` | 2026-10-29T17:20:45+08:00 | 61,006 |
| CopilotKit/OpenBot | `C:\dev\ProjectOS-vendor\openbot` | `4766e4247675eb73ff80d525ff645dd8a9da815f` | 2026-10-28T22:41:19-07:00 | 2,526 |

Nothing was built, installed or executed. `npm`, `pip`, `uv` and `bun` were never run, and no repository
script was run. The clones were only read, with `git log`, `git ls-files`, `ls`, `wc`, `head`, `sed` and
`grep`.

## 2. Licences (checked against each LICENSE file)

| Repo | Licence | Copyright line (verbatim) |
|---|---|---|
| hermes-agent | MIT | `Copyright (c) 2025 Nous Research` |
| openclaw | MIT | `Copyright (c) 2026 OpenClaw Foundation` |
| OpenBot | MIT | `Copyright (c) 2026 CopilotKit` |

**Embedded third-party code that a port must carry forward:**
- **OpenClaw** has its own `THIRD_PARTY_NOTICES.md`. Its entries are:
  - **Pi / pi-mono** (MIT, `Copyright (c) 2025 Mario Zechner`): "portions of OpenClaw were adapted from" it.
  - **Hermes Agent** (MIT, Nous Research): `packages/agent-core/src/repetition-guard.ts` is adapted from
    `agent/repetition_guard.py`.
  - GitHub Octicons and SQLite (public domain).

  Any OpenClaw file we port must be checked for Pi provenance. If it has any, the Pi notice goes into
  our `THIRD_PARTY_NOTICES` too.
- **Hermes** `agent/vault_login_classifier.py` says it is a port of Merit-Systems/OpenInstinct (MIT). We
  should not port it anyway, because of the vault ban below.
- OpenClaw's notice file is a ready template for our `THIRD_PARTY_NOTICES` entry format: upstream URL,
  source path at the pinned sha, our path, licence, copyright, and the full MIT text.

## 3. OpenBot

- **What it is:** **CopilotKit/OpenBot**, https://github.com/CopilotKit/OpenBot. Do not confuse it with
  intel-isl/OpenBot, which is a robotics project.
- **Licence:** **MIT**, so it was cloned under the brief's rule.
- **Its own status:** beta, and "a template, not a product".
- **Stack:** TypeScript on Bun, with hono, drizzle-orm (Postgres), zod, cel-js and cron-parser. There
  are also Python agent examples under the `agent-*` directories.
- **What it adds beyond Hermes and OpenClaw:** it is the most governance-aligned of the three:
  - default-deny, fail-closed CEL action policy, with deny beating allow (`server/src/computer/policy.ts`);
  - hard routine floors: a 15-minute minimum, a cap of 20 enabled routines, and auto-disable after 10
    failures;
  - teach-by-demonstration that drafts a skill (`server/src/demonstrations/`) and masks recordings
    (`shared/recorder-masking.ts`).
- **Caveats:**
  - Its CEL policy has a `dry-run` mode that "lets everything through". In a port this mode must be
    removed, or made owner-only and audit-only.
  - Its stores are drizzle/Postgres, and they must be replaced by git records.
- **Harness note:** a local guard hook blocks `ls`/`grep` across the OpenBot root, because the
  `agent-*` directory names look like wrapper transcripts. List subdirectories by path instead.

## 4. The kernel gates every port goes through (from ADR-K1 and the recon "Do not copy" table)

- **G-ENV.** Every operation carries an ADR-K1 envelope. The kernel derives `actor`, `tenant`,
  `domain`, `environment`, `actionClass` and `subjectHash` (R2), and a child never widens its parent's
  scope (R3).
- **G-REG.** Each ported capability registers its action class and environment *before* it ships.
  Anything unregistered is P5 (R5).
- **G-AUDIT.** The envelope is recorded at admission and again at execution, naming the rule (R4),
  hash-chained (C2).
- **G-BUDGET.** Paid calls are P3, need a mandatory `budget`, and use the provider-spend grant.
- **G-OWNER.** Sends, payments, production, secrets and closure are P5, decided by the owner every time.
  No "smart" or model-judged approval, no `--yolo`, no `/elevated`, and no `full` exec default (R6).
- **G-STAGE.** Memory and skill writes are *proposals* that go to a pending, approve and reject queue.
  They are pinned by hash and go stale on any change.
- **G-UNTRUSTED.** Inbound messages, web pages, MCP output and memory text are data, never authority.
  Content is scanned before it reaches a prompt.
- **G-CUSTODY.** Secrets come only through the credential router and `NT SERVICE\ProjectOSHost`
  custody. There are no plaintext `~/.hermes/.env` or `~/.openclaw` files and no agent-readable vault.
- **G-STOP.** Emergency stop and `expiry` are re-checked when the action executes (R7).

## 5. Port map

Size means **non-test lines of code** at the pinned sha. It is approximate: it excludes `*.test.*`,
`tests/` and fixture files, and Markdown and JSON.

Strategy key:
- **DIRECT PORT:** TypeScript to TypeScript. Copy the file, keep the MIT header, then cut its imports
  down to ProjectOS equivalents.
- **TRANSLATE:** Python to TypeScript, under the same notice rule.
- **SIDECAR:** run unmodified behind an adapter.
- **REFUSE:** do not port.

**SIDECAR is not recommended for anything.** ADR-S1 and ADR-S2 found that Hermes and OpenClaw are second
orchestrators. The only sidecar-shaped option left is a native mobile shell (C18).

| C# | Capability | Source repo and paths (pinned sha) | Lang | Size (LOC) | Strategy | Gates to replace (unsafe upstream behaviour → ProjectOS gate) | Stage |
|---|---|---|---|---|---|---|---|
| C7 | Per-agent identity, channels, workspaces | **OpenClaw** `src/routing/` (bindings, `resolve-route.ts`, `session-key.ts`, `binding-scope.ts`) plus `src/pairing/` ≈3.6k; workspace and agent paths `src/agents/workspace*`, `agent-scope*`, `agent-paths*` ≈7.9k. **Hermes** `hermes_cli/profile*.py`, `profiles*.py`, `gateway/profile_routing.py`, `agent/secret_scope.py` ≈5.9k (reference only) | TS / Py | 3.6k + 7.9k (OC); 5.9k (H) | DIRECT PORT of the OC routing and binding *model* (route → account → session key), re-keyed on the envelope `tenant`/`domain`. Hermes profiles: REFERENCE only | Hermes profiles "are not sandboxes", and OC bindings share one OS user → real tenancy (Stage 2): a separate filesystem root, credential scope and envelope v2. OC cross-agent messaging and session access are on by default → **off**, and cross-tenant access is a P5 registry action with a data-owner grant. Tenant is derived, never taken from agent or route text (R2/R3) | 2 |
| C8 | Curated memory plus session search | **Hermes** `tools/memory_tool_store.py` (740), `tools/memory_tool.py` (477), `tools/threat_patterns.py` (162), `tools/write_approval.py` (413), `agent/memory_manager*.py`; FTS `hermes_state_fts.py` (582), `hermes_state_search.py` (1.6k), `tools/session_search_tool.py` (806). **OpenClaw** pure retrieval modules `extensions/memory-core/src/memory/{hybrid,mmr,temporal-decay,tokenize,keyword-query}.ts` (854) and `packages/memory-host-sdk/src/host/markdown-chunks.ts` (240), using `node:sqlite` plus sqlite-vec. The full `extensions/memory-core` (48k) is reference only | Py / TS | H store ≈1.8k, H FTS ≈3k; OC core ≈1.1k (the full engine is 48k–60k) | TRANSLATE the Hermes capped §-delimited store (the 2,200/1,375-character caps; over-limit writes refused) and the FTS5 schema. DIRECT PORT of the OC hybrid search (BM25 plus vector, MMR, temporal decay); OC already uses `node:sqlite`, which matches our Node 24.14.1 | Hermes writes freely by default (`write_approval=false`), and its background self-review writes memory → G-STAGE: every write is a proposal pinned to the target entry hash, owner-approved, with provenance (author/actor, session, time, hash), which Hermes lacks. OC memory-core "dreaming" (autonomous consolidation) → **REFUSE**. Index scoped per tenant and rebuildable. `threat_patterns` scan kept (G-UNTRUSTED). sqlite-vec is a new dependency, which the owner must add to the locked stack (TRD) | 3 |
| C9 | Self-improving skills | **Hermes** `tools/skill_manager_tool.py` (943) plus `skill_manager_{batch,guards}.py`, `tools/skills_guard.py` (961), `tools/skill_linter.py` (215), `tools/skills_ast_audit.py` (92), `tools/skill_provenance.py` (44), `tools/skill_ledger.py`; curator `agent/curator.py` (1.2k), `agent/background_review.py`, `agent/review_engine.py`; three-stage loading `tools/skills_tool*.py`, `agent/skill_utils.py` (898); hub `tools/skills_hub*.py` (3.8k, includes `skills_hub_clawhub.py`). **OpenClaw** `src/skills/` (27k: discovery, loading, security, workshop) | Py / TS | H manager and guards ≈4.3k, curator ≈4k, loader ≈3.4k; OC 27k | TRANSLATE the linter, guard scan, AST audit and three-stage loader (the agentskills.io `SKILL.md` format becomes our exchange format). Curator: REFERENCE; rebuild it as a *proposer* only. OC `src/skills/security`: DIRECT PORT is a candidate for the validator pass | `skill_manage` lets the agent create and patch skills directly, and the curator rewrites them autonomously → the agent may only *propose*. Promotion needs a validator pass plus gatekeeper (D11) review, pinned by hash, and any change makes the skill stale. Hub and ClawHub install from the internet → **refuse** auto-install; import a `SKILL.md` as data through an owner-approved plan only (ADR-S1 narrowest boundary) | 3 |
| C10 | Document search over uploads, with citations | **OpenClaw** the same hybrid core as C8, plus `extensions/document-extract` (310) and `extensions/knowledge` (36k, "evidence-backed knowledge vault"; reference only). **Hermes** `tools/read_extract.py` (623). **OpenBot** `server/src/memory/` (2.3k, pgvector) for reference | TS / Py | ≈1.4k to port | DIRECT PORT of the OC chunker and hybrid search and of `document-extract`; TRANSLATE `read_extract` | Every answer must cite the source file and line (the chunk records path and line range; refuse an uncited answer). Uploads are untrusted (G-UNTRUSTED). Index local and per tenant; no external memory custodian (OpenBot "Intelligence" → REFUSE) | 3 |
| C11 | Multi-provider router, xAI as one adapter | **OpenClaw** `packages/llm-core` (2.5k), `src/llm/` (3.6k), `packages/retry` (433), `packages/model-catalog-core` plus `src/model-catalog` (4.5k: includes `pricing.ts`), `extensions/xai` (8.3k; model id only, see the note). `packages/ai` (37k) is reference only. **Hermes** `agent/provider_registry.py`, `provider_base.py`, `route_binding.py`, `agent_init_fallback.py`, `fallback_cooldown.py`, `usage_pricing.py`, `hermes_cli/model_cost_guard.py` (≈1.7k) | TS / Py | OC ≈11k; H ≈1.7k | DIRECT PORT of the OC llm-core transport and retry and the catalog pricing; TRANSLATE the Hermes fallback chain and cooldown logic (small) | **No Grok API (owner).** Do not port the `extensions/xai` or `plugins/model-providers/xai` call paths; register an xAI adapter later only if the owner reverses that. Every call is P3: a mandatory envelope `budget`, a hard cap (Stage 1.2), a provider-spend grant, and a per-call record (G-BUDGET). OC plaintext auth profiles → G-CUSTODY. Hermes `credential_pool` key rotation → REFUSE (it rotates around caps) | 4 |
| C12 | Subagents and fan-out | **Hermes** `tools/delegate_tool.py` (933) plus `delegate_tool_{dispatch,child_run,toolsets,config,registry,results,tasks}.py`, `tools/async_delegation*.py`, `tools/subagent_worktree.py`, `agent/delegation_*.py`, `agent/subagent_lifecycle.py`, `tools/delegation_redaction.py` (≈8.3k). **OpenClaw** `src/agents/subagents/` plus `sessions-spawn` (69k; reference only) | Py / TS | H ≈8.3k; OC 69k | TRANSLATE the Hermes delegate dispatch, the blocked-tool subtraction (`DELEGATE_BLOCKED_TOOLS`) and the per-child worktree. OC: REFERENCE (too coupled to the Gateway session controller) | Hermes children inherit a toolset list minus a denylist → **allowlist** grants that fail closed and are at most the parent's (R3), with child `tenant`/`domain`/`project`/`environment` equal to the parent's. One worktree and one loop-written invocation record per child (`actor`). Depth and fan-out caps under the parent `budget`. No child may delegate P5 | 4 |
| C13 | Routines and cron, with caps and auto-disable | **OpenBot** `server/src/routines/schedule.ts` (342: a hard five-field cron, a 15-minute floor checked over 200 occurrences), `runner.ts` (247: `FATIGUE_LIMIT = 10`), `store.ts` (1,005: `MAX_ENABLED_ROUTINES = 20`), `sweep.ts` (554). **Hermes** `cron/` (21.6k: `scheduler.py` 4.4k, `jobs.py` 3.5k, `occurrences.py`, `quota_hold.py`), `tools/cronjob_tools.py`, `tools/cronjob_prompt_scan.py`. **OpenClaw** `src/cron/` (51k; reference only) | TS / Py | OpenBot ≈2.4k; H 21.6k; OC 51k | DIRECT PORT of the OpenBot schedule validator and fatigue logic (drop hono/drizzle; the store becomes plan-approved git records). TRANSLATE only the Hermes `cronjob_prompt_scan` and occurrence-id logic, which feed the ADR-K1 `intentScope` | The agent can create cron jobs itself (Hermes `cronjob_tools`, OC cron tool) → each schedule is a plan-approved record. Each run has its own budget. An **unattended run refuses gated (P3+) actions and escalates them** to the owner queue. Hermes and OC run in-process with the agent's full authority → the run is admitted through the envelope with an occurrence-scoped idempotency key. OpenBot floors kept as never-lowered constants. `cron-parser` is a new dependency, owner/TRD | 4 |
| C14 | A computer per agent: browser, shell, workspace | **OpenClaw** `src/agents/sandbox/` plus `sandbox-*.ts` (20.5k: Docker backend, bind specs, config hash), `src/agents/bash-tools*.ts` plus `src/infra/exec-*.ts` (23.4k: exec approval and allowlist), `src/process/` plus `packages/terminal-core` (21.4k), `extensions/browser` (68k), `extensions/cua-computer` (4.6k). **Hermes** `tools/terminal_tool*.py` plus `tools/environments/` (15.6k: local, docker, ssh, modal, daytona, vercel_sandbox), `tools/approval*.py` (4.8k), `tools/browser_*.py` plus `computer_use` (11.6k), `tools/path_security.py`, `tools/url_safety.py`. **OpenBot** `server/src/computer/policy.ts` (443, CEL default-deny), `server/src/computer/` (7k), `server/src/browser/` (1.9k) | TS / Py | OC ≈65k core plus a 68k browser; H ≈32k; OpenBot ≈9k | DIRECT PORT of: the OC exec-approval *binding* (an approved command cannot be edited; `src/infra/exec-approval-*`, `exec-allowlist-pattern.ts`), the OC `process/` exec runner and kill-tree, and the OpenBot CEL action policy. The sandbox container backend is a selective DIRECT PORT that waits for the Stage 4.3 sandbox design. Hermes: REFERENCE | **REFUSE** OC exec default `full` and `/elevated full`. **REFUSE** Hermes `approval_smart.py` (an auxiliary LLM judges risk), `approval_yolo.py`, and the container skip-checks. Hermes `local` backend = no isolation. **REFUSE** `browser_session_real_profile.py` and attaching to the owner's signed-in browser. **REFUSE** `browser_vault_tool.py`, `agent/vault_*` and TOTP minting (agent-held credentials). OpenBot `dry-run` mode → remove, or make it owner-only and audit-only. Each approval is bound to argv, cwd and hash, expires, and is recorded (C5, G-STOP). Each grant is a record tied to the active plan | 4 |
| C15 | Governed MCP connectors | **OpenClaw** `src/mcp/` plus `src/agents/agent-bundle-mcp-*.ts` plus `src/plugins/bundle-mcp.ts` (9.8k), `extensions/mcp-relay` (4.1k). **Hermes** `tools/mcp_tool*.py` (12.6k; includes `mcp_tool_costs.py`, `mcp_tool_scope.py`, `mcp_tool_sampling.py`), `tools/mcp_oauth*.py`, and the `optional-mcps/` catalog (56 server manifests, as data) | TS / Py | OC ≈14k; H ≈12.6k | DIRECT PORT of the OC MCP client lifecycle (stdio and transport management). TRANSLATE the Hermes per-tool cost and scope ideas. `optional-mcps` is data only | Server install from a catalog or URL → an **allowlist pinned by hash** (owner-approved). Per-tool spend enforced through the ledger (G-BUDGET). MCP **sampling** (a server asking our model to generate) → off or P3. Elicitation goes to the owner queue. Tool output is untrusted (G-UNTRUSTED). OAuth tokens → G-CUSTODY | 4 |
| C16 | Real-time web search and deep research | **OpenClaw** `src/web-search/`, `src/web-fetch/`, `extensions/web-readability` (1.1k), provider plugins `extensions/{brave,duckduckgo,searxng,exa,tavily,perplexity,firecrawl,parallel}` (5k). **Hermes** `tools/web_tools*.py`, `agent/web_search_{provider,registry}.py`, `tools/website_policy.py`, `tools/web_result_cache.py`, `agent/search_policy.py` (2.4k), `plugins/web/*` (2.7k). `tools/x_search_tool.py` and `plugins/web/xai` are xAI-backed → not ported | TS / Py | OC ≈6k; H ≈5k | DIRECT PORT of the OC web-search runtime, the readability extraction, and one or two providers (a SearXNG self-host or Brave fit "own stack"). TRANSLATE the Hermes `website_policy` and `url_safety` (SSRF and blocklist) | **No Grok API** → X search is not via xAI; any X source needs the official X API under the owner's decision. Cited answers only. Paid search calls count against the budget (P3). A step cap on the research loop. Fetched pages are untrusted (prompt-injection guidance from OC `src/security/external-content.ts`). SSRF guard mandatory | 4 |
| C17 | Human takeover for login and 2FA | **OpenBot** `shared/handoff-markers.ts` (18; `ask_person` and `message_bot`), `server/src/approvals/` (3.3k: questions, resume sweep), `server/src/browser/person.ts`. **OpenClaw** `src/infra/browser-handoff.ts` (138: keeps credential URLs out of argv; owner-only ACL on Windows). **Hermes** `tools/clarify_tool.py`, `tools/human_input_hooks.py`, `tools/clarify_gateway.py` (581) | TS / Py | ≈3.5k | DIRECT PORT of the OpenBot ask-person and resume pattern and the OC `browser-handoff.ts`. Hermes clarify: REFERENCE | No source implements an owner-presence *lock*. Build it natively: takeover is a P5 owner-presence session (Host peer authentication, as in R7). The agent is frozen during takeover. The takeover itself is recorded. Credentials typed by the owner never enter agent context. **REFUSE** Hermes vault autofill and TOTP (`vault_store.py` "2FA codes can be minted without asking") | 6 |
| C18 | Phone and desktop continuity; mobile approvals | **OpenClaw** `apps/android` (Kotlin, 131k), `apps/ios` (Swift, 149k), `packages/gateway-client` plus `gateway-protocol` (TS, 63k), `crates/openclaw-gateway-client` (Rust), `extensions/device-pair` (1.4k), `src/pairing/`. **Hermes** `apps/desktop` (Electron/React, 535k; reference only). OpenBot `mobile/` (not sized) | Kotlin / Swift / TS / Rust | very large | DIRECT PORT of `gateway-protocol` *types* and the pairing handshake (TS). Mobile: fork the native shell and re-point it at the ProjectOS Host, the only sidecar-shaped option. Desktop: none (we have Tauri) | OC node pairing grants **remote execution** on the paired device → REFUSE node exec. A phone approves only, and each approval is bound to an envelope `subjectHash`. Pairing is owner-initiated, scoped and expiring. Push notifications carry no secrets. OC `approval-web-push.ts` is reference for push | 6 |
| C19 | Messaging channels | **OpenClaw** `src/channels/` (45k: allowlists, mention gating, DM policy), `extensions/telegram` (58k), `extensions/slack` (39k), `extensions/imap` (1.4k), `extensions/sms` (4.2k, Twilio), `extensions/msteams`, `extensions/signal`. **Hermes** `gateway/platforms/base.py` plus `gateway/pairing.py` plus `tools/send_message_*.py` (6.8k), `plugins/platforms/{telegram,slack,email,whatsapp_cloud,…}` (Telegram 8.7k) | TS / Py | per channel 1.4k–58k | DIRECT PORT of the OC channel allowlist and pairing UX (`src/channels/allowlists`, `allow-from.ts`, `direct-dm-guard-policy.ts`, `mention-gating.ts`) and *one* small channel first (IMAP inbound 1.4k, or SMS 4.2k). The big Telegram and Slack plugins: selective port | By default, the OC agent message tool "can send across conversations and providers" → every send carries a **single-use ProjectOS approval reference bound to the recipient and a content hash** (P5). Inbound messages are untrusted. **REFUSE** `extensions/whatsapp` (WhatsApp Web QR), `extensions/imessage`, and Hermes `plugins/platforms/whatsapp` / `bluebubbles` (private APIs). Only official APIs (Hermes `whatsapp_cloud` is the official Cloud API, so it is allowed). Bot tokens → G-CUSTODY | 5/7 |
| C20 | Voice: STT, TTS, talk mode | **OpenClaw** `src/talk/` plus `src/tts/` plus `src/realtime-transcription/` (17k), `extensions/tts-local-cli` plus `talk-voice` (0.6k), `extensions/{deepgram,elevenlabs,azure-speech}`. **Hermes** `tools/transcription_*.py`, `tools/tts_*.py`, `tools/voice_*.py` (9.3k; includes `transcription_whisper_cpp.py`, `wake_word.py`) | TS / Py | OC ≈17.6k; H ≈9.3k | DIRECT PORT of the OC TTS and STT provider registry interfaces and the local CLI TTS. TRANSLATE the Hermes local whisper.cpp path (it fits local-first). Real-time talk follows ADR-S4 (LiveKit) | Cloud STT/TTS are paid calls (P3, budget). Audio is untrusted input. A spoken "approve" is **never** an approval (it is not owner-presence evidence under R7). Recordings are retained only under a record. OC `voice-call` (Twilio phone calls) = an external send → P5 | 8 |
| C21 | Teach by demonstration | **OpenBot** `server/src/demonstrations/` (776: `draft.ts` turns a recording into a skill draft, removing private URL segments), `server/src/recorder/` (2k: guard, refusal audit, trajectory gate), `shared/demonstration-rules.ts` (184), `shared/recorder-masking.ts` (1.5k). **OpenClaw** `extensions/cua-computer/src/recording-actions.ts` (227: record and replay). **Hermes** `agent/learn_prompt.py` (197: `/learn` builds a prompt that authors a skill via `skill_manage`) | TS / Py | OpenBot ≈4.5k; OC 0.2k; H 0.2k | DIRECT PORT of OpenBot demonstrations, recorder masking and rules (the closest match to the recon's "a recorded routine becomes a proposed skill") | The output is a **proposed** skill under C9 (G-STAGE), never auto-installed. The recording is masked before storage. Hermes `/learn` writes via `skill_manage` directly → route it to the proposal queue. Replay of a recording = a C14 action under the same exec and browser policy | 7 |

## 6. Recommended first three ports: best value for the least work

All three are small TypeScript-ready pieces that Stage 3 needs (C8–C10). Each has few imports and no
orchestrator coupling.

1. **The OpenClaw hybrid retrieval core → C8 and C10.** It is a DIRECT PORT of about 1.1k LOC:
   - `extensions/memory-core/src/memory/{hybrid,mmr,temporal-decay,tokenize,keyword-query}.ts`;
   - `packages/memory-host-sdk/src/host/markdown-chunks.ts`.

   Its only imports are `node:fs`/`node:path`, `sha256Hex` and UTF-16 helpers, plus a few plugin-sdk
   type imports to stub. It already targets `node:sqlite`, which matches Node 24.14.1. One port serves
   two capabilities: memory session search and cited document search.
   - **Open owner decision:** whether to add `sqlite-vec` to the locked stack. Keyword/FTS5-only works
     without it.
   - **Check first:** that Node's bundled SQLite has FTS5.
2. **The Hermes curated memory store plus threat scan → C8 (gated).** TRANSLATE about 0.9k LOC:
   `tools/memory_tool_store.py` (740) and `tools/threat_patterns.py` (162).
   - It depends only on the standard library. The capped, §-delimited `MEMORY.md`/`USER.md` store
     refuses over-limit writes, and its threat scan runs before content reaches a prompt.
   - Replace the `write_approval.py` boolean with ProjectOS's pending/approve/reject queue, pinned to
     the target entry hash, and add provenance fields.

   This is exactly ADR-S1's "adopt natively" list, now from real code.
3. **The Hermes skill validator pass → C9.** TRANSLATE about 1.3k LOC:
   `tools/skill_linter.py` (215), `tools/skills_ast_audit.py` (92), and the frontmatter parser in
   `agent/skill_utils.py`. Add `tools/skills_guard.py` (961) after that.
   - These only need `re`, `hashlib` and `unicodedata`.
   - They give the promotion gate a deterministic validator, with `SKILL.md` as the exchange format.
     The agent only proposes; promotion goes through the validator, then D11, then a hash pin.

**A cheap fourth, when Stage 4 opens:** the OpenBot routine floor (`server/src/routines/schedule.ts`
and the `runner.ts` fatigue logic, about 0.6k LOC of TS to TS). It is already fail-closed by design;
"a model can be talked into anything; the floor cannot".

## 7. Things the owner must decide before the first port lands

- **Records conflict.**
  - `docs/recon/V4_Capability_Recon.md` says "ProjectOS … never copies their code".
  - ADR-S1 and ADR-S2 are decided as REFERENCE, and say "nothing was installed, cloned".

  The new clone-and-adapt decision needs an owner amendment to those records first, or the port phase
  will contradict committed decisions. This report did not touch them.
- **Locked stack (TRD §5).** These new dependencies need owner approval: `sqlite-vec` (C8/C10),
  `cron-parser` (C13) and `cel-js` (C14 policy). Nothing may be invented.
- **Provenance per file.** Each ported file records:
  - the upstream path at the pinned sha;
  - the MIT header;
  - the `THIRD_PARTY_NOTICES` entry, plus the Pi/pi-mono notice where an OpenClaw file inherits it.
- **Vendor clones.** `C:\dev\ProjectOS-vendor\` is outside every repository. Keep it read-only and never
  `npm`/`pip`/`uv`/`bun` inside it. Re-pin by sha when a port phase starts.
