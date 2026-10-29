# Vendor provenance report: code ProjectOS plans to port

**Date:** 2026-10-29. **Purpose:** homework for legal review before ProjectOS copies and adapts code from six
open-source projects. **This is not legal advice.** It records what the files say. The questions only a
lawyer can answer are listed in §10.

**Inputs:**
- the port plans:
  - `C:\dev\ProjectOS-worktrees\host-review-path1b\docs\recon\V4_Port_Map.md` (C7–C21);
  - `…\scratchpad\port-map-addendum.md` (C8–C25);
- the extracted sources under `C:\dev\ProjectOS-vendor\`.

**Method (read-only):**
- Files were only read: `cat`, `grep`, `find`, `git rev-parse` and `git log`, plus `unzip -z` on the
  archives to read the commit comment. Nothing was built, installed or executed, and no repository was
  changed.
- Network use was limited to GitHub API metadata reads (`gh api repos/<owner>/<repo>`), to confirm the
  licences of upstream repos named in comments and to check for NOTICE files.
- **Marker scan:** every path the two port plans list was grepped, case-insensitively, for:
  - `copyright`, `SPDX-License-Identifier`, `licensed under`;
  - `adapted from`, `derived from`, `ported from`, `port of`, `borrowed from`, `copied from`, `taken from`;
  - `GPL`, `LGPL`, `AGPL`, `Creative Commons`, `CC-BY`, `public domain`, `Apache License`, `BSD-n`,
    `MIT License`;
  - `stackoverflow.com`, `unlicense`, `all rights reserved`, `proprietary`.
- **Asset scan:** the same paths were listed for images, fonts, audio and model files.
- The scripts and raw hit lists are in `…\scratchpad\legal\work\`: `scan.sh`, `assets.sh`, `paths-*.txt`
  and `*.txt`.

**Limits:**
- The three git clones are **shallow** (`--is-shallow-repository = true`), so per-file history and
  authorship could not be traced.
- A grep finds declared provenance only. It cannot detect code that was copied without a marker.

## 1. Summary table

| Project | Licence | Copyright line (verbatim) | LICENSE location | NOTICE file | Pinned commit | Source form | Upstream URL | CLA / DCO | Patent grant |
|---|---|---|---|---|---|---|---|---|---|
| **Hermes Agent** | MIT | `Copyright (c) 2025 Nous Research` | `C:\dev\ProjectOS-vendor\hermes-agent\LICENSE` | **None at root.** One nested NOTICE outside the port paths (§2.1) | `ef75bc708867e3884cb40a91363be6dc6fddc034` (2026-10-28T23:07:47-07:00) | shallow `git clone` | https://github.com/NousResearch/hermes-agent | No CLA. Inbound = outbound: "By contributing, you agree that your contributions will be licensed under the MIT License" (`CONTRIBUTING.md:1039`) | None express (MIT) |
| **OpenClaw** | MIT | `Copyright (c) 2026 OpenClaw Foundation` | `C:\dev\ProjectOS-vendor\openclaw\LICENSE` (same text in `packages/{ai,gateway-client,gateway-protocol}/LICENSE`) | **None.** Has `THIRD_PARTY_NOTICES.md` (quoted in §3.1) | `bde3017359edf796459ad4d5e3753ac6b84a49bf` (2026-10-29T17:20:45+08:00) | shallow `git clone` | https://github.com/openclaw/openclaw | None found | None express (MIT) |
| ↳ **Pi / pi-mono** (inside OpenClaw) | MIT | `Copyright (c) 2025 Mario Zechner` | Quoted in OpenClaw `THIRD_PARTY_NOTICES.md`; matches upstream `LICENSE` (checked via GitHub API) | None | n/a (inherited) | — | https://github.com/earendil-works/pi-mono → now `earendil-works/pi` | — | None express (MIT) |
| **OpenBot (CopilotKit)** | MIT | `Copyright (c) 2026 CopilotKit` | `C:\dev\ProjectOS-vendor\openbot\LICENSE` | **None** | `4766e4247675eb73ff80d525ff645dd8a9da815f` (2026-10-28T22:41:19-07:00) | shallow `git clone`. `OpenBot-main.zip` is byte-identical (addendum §2.2) | https://github.com/CopilotKit/OpenBot | None found (no CONTRIBUTING) | None express (MIT) |
| **oh-my-hermes** | MIT | `Copyright (c) 2026 oh-my-hermes contributors` | `C:\dev\ProjectOS-vendor\oh-my-hermes\oh-my-hermes-main\LICENSE` | **None at root.** Toolkit-level notices (§5.1) | `612a1cd9c44a19ecddcd263865e40e8c3910a514` (2026-10-29T13:46:02Z) | no `.git`. Archive `oh-my-hermes-main.zip`, 55,352,038 bytes, SHA-256 `2055af1e7853d8c05ba891087edf579f3a3dd8762d50b02cd97ed04bc86f1913`, downloaded 2026-10-29 | https://github.com/rlaope/oh-my-hermes | **DCO sign-off required** (`CONTRIBUTING.md:74–116`). No CLA | None express (MIT) |
| **OpenBot (Intel ISL)** | MIT, plus embedded Apache-2.0 and BSD-3-Clause | `Copyright (c) 2020 Intel ISL (Intel Intelligent Systems Lab)` | `C:\dev\ProjectOS-vendor\openbot-master\OpenBot-master\LICENSE` | **None.** Has `DISCLAIMER.md` with extra use terms (§6.4) | `c5f05271a067ca83d3de38e5976fa07bcec74b6e` (2026-10-25T03:05:27Z) | no `.git`. Archive `OpenBot-master.zip`, 199,792,652 bytes, SHA-256 `91b3b57467cbe414cb37d48a0d4f805aa7e0e72d94a527c95150be5163f67043`, downloaded 2026-10-29 | https://github.com/ob-f/OpenBot (`intel-isl/OpenBot` and `isl-org/OpenBot` redirect here) | None found | None from Intel (MIT). Apache-2.0 §3 grant covers the embedded TensorFlow and Google files only |
| **Rakazo** | **Apache-2.0** | `Copyright 2026 Rakazo contributors` | `C:\dev\ProjectOS-vendor\rakazo\rakazo-main\LICENSE` (178 lines; terms identical to canonical Apache-2.0 after whitespace normalisation) | **None** | `bf78ebd7961a28a8b437c605319c47b59edadc1c` (2026-10-29T13:41:43Z) | no `.git`. Archive `rakazo-main.zip`, 27,042,471 bytes, SHA-256 `01a955e678b5c335ef6f7636b3cb8cb5d458493a6ff75409e6c10e324f20d75b`, downloaded 2026-10-29 | https://github.com/elie222/rakazo | None. `CONTRIBUTING.md` is silent, so Apache-2.0 §5 applies by default | **Yes**: Apache-2.0 §3, with defensive termination |

The archives sit in `C:\Users\murad\Downloads\`. Each commit sha comes from the zip's archive comment
(`unzip -z`). The commit dates come from the GitHub API.

**Flag summary** (details in each project section):

| Severity | Item | Project | In a planned port? |
|---|---|---|---|
| **HIGH** | YOLOv5 model weights are AGPL-3.0 (Ultralytics), listed in the model catalogue `config.json` | isl OpenBot | Only if C25 perception adopts the model list. Exclude them |
| **HIGH** | Fragment "ported from lobehub/lobehub#19329" falls under the **LobeHub Community License** (Apache-2.0 plus "a commercial license must be obtained … to develop and distribute a derivative work") | Hermes `tools/terminal_tool_result.py:82` | Hermes C14 is REFERENCE. Do not translate this fragment |
| **MEDIUM** | Pi / pi-mono provenance is declared for "portions of OpenClaw" but no file list is given | OpenClaw | Every OpenClaw port. Carry the Pi notice on all of them |
| **MEDIUM** | `DISCLAIMER.md` adds use conditions beyond MIT ("Misuse … strictly prohibited"; "By using … you … agreed to the terms") | isl OpenBot | Every isl port |
| **MEDIUM** | Unclear provenance or licence: Yuanbao sticker catalogue (upstream licence "Other"/none); "WideLee's qqbot-agent-sdk v1.2.2" (repo not identified) | Hermes `plugins/platforms/{yuanbao,qqbot}` | Not selected (C19 uses OpenClaw). Do not port |
| **MEDIUM** | Unclear provenance: 22 audio files with no source record | Rakazo `apps/mobile/assets/sounds/*.m4a` | C18 mobile fork. Replace them |
| **MEDIUM** | Third-party logos whose artwork licence is unclear (ag2, agno, langroid "vendor's own published artwork") | CopilotKit `shared/marks/` | Not needed. Do not port |
| LOW | Apache-2.0 §4(d): OpenAI Codex has a NOTICE; one Hermes rule is a "Port of openai/codex#33464" | Hermes `tools/approval_detection.py:240` | C14 Hermes is REFERENCE. Carry the NOTICE only if translated |
| LOW | GPL-3.0 `piper1-gpl` is referenced as an external TTS tool (invoked, not vendored) | Hermes `tools/tts_tool_local.py:111` | C20. Do not bundle Piper without GPL review |
| LOW | GPL, LGPL, AGPL and unlicensed upstreams are listed as "concepts only / invoked not vendored" | oh-my-hermes `docs/SKILL-SOURCES.md` | No code involved. Do not follow the links to copy |
| LOW | Third-party build binaries fetched at build time with unverified licences (Wroup, usbserial `.aar`) | isl OpenBot `robot/android/comlib/download.gradle` | Not ported |
| LOW | Three Material icon vector drawables, likely Google Material Symbols (Apache-2.0), with no attribution | Rakazo `apps/mobile/assets/material-icons/*.xml` | C18. Attribute or redraw |
| — | No GPL, LGPL, AGPL, CC-BY-NC or "no licence" **source code** inside any planned port path | all | — |

## 2. Hermes Agent (NousResearch/hermes-agent)

### 2.1 Licence and notices
- **Licence:** `LICENSE` at the root: MIT, `Copyright (c) 2025 Nous Research`.
- **NOTICE:** none at the root.
- **Nested licence files, all outside the planned port paths and not needed for the port:**
  - `plugins/security-guidance/NOTICE` plus `LICENSE` (Apache-2.0). The NOTICE says the plugin "includes
    work originally published in the claude-plugins-official repository by Anthropic, PBC., licensed
    under the Apache License, Version 2.0".
  - MIT `LICENSE` files in:
    - `apps/desktop/src/plugins/hermes-bots/` (Nous Research);
    - `plugins/hermes-achievements/` ("Hermes Achievements contributors");
    - `skills/productivity/{pdf,microsoft-office}/` (Nous Research);
    - `skills/creative/humanizer/` (Siqi Chen, 2025);
    - several `optional-skills/*/LICENSE*` (not read individually).

### 2.2 Embedded third-party code in planned port paths
- **No third-party copyright or SPDX header** appears in any planned path. The paths checked are listed
  in `work\paths-hermes.txt`:
  - memory: `tools/memory_tool*`, `threat_patterns`, `write_approval`, `hermes_state_fts/search`;
  - skills: `tools/skill*`, `skills_guard`, `skills_ast_audit`, `agent/skill_utils`, `curator`;
  - providers, delegation, cron;
  - terminal and approvals, browser, MCP, web, clarify, gateway, platforms, voice.

  **The three recommended first Hermes ports have no third-party markers at all:** the memory store plus
  threat scan, the skill linter/AST audit/frontmatter parser, and `skills_guard.py`.
- **Fragments credited to other repositories** (comment markers). The upstream licences were checked via
  the GitHub API on 2026-10-29:

| File:line | Comment says | Upstream licence | Note |
|---|---|---|---|
| `tools/terminal_tool_result.py:82` | ported from `lobehub/lobehub#19329` | **LobeHub Community License** (Apache-2.0 + commercial-derivative restriction; `NOASSERTION` on GitHub) | **FLAG**. The fragment is a model-facing warning string and its behaviour. Rewrite from scratch; do not translate |
| `tools/terminal_tool_result.py:99` | ported from `Kilo-Org/kilocode#12698` | MIT | Credit if translated |
| `tools/environments/docker.py:356` | Ported from `nanocoai/nanoclaw#2748` | MIT | |
| `tools/approval.py:121` | Ported from `qwibitai/nanoclaw#2832` (now `nanocoai/nanoclaw`) | MIT | |
| `tools/approval_detection.py:240` | Port of `openai/codex#33464` | Apache-2.0, **with a NOTICE** ("OpenAI Codex / Copyright 2025 OpenAI"; also credits Ratatui, MIT) | §4(d) applies if translated (THIRD_PARTY_NOTICES C.4) |
| `tools/approval_detection.py:612` | Adapted from embwl0x's work in Hermes PR #76063 | Hermes (MIT, inbound = outbound) | Covered by the Hermes notice |
| `tools/approval_floors.py:134` | Port of `can1357/oh-my-pi#7553` | MIT | oh-my-pi is a Pi derivative |
| `tools/mcp_tool.py:230`, `mcp_tool_health.py:79`, `mcp_tool_errors.py:64`, `mcp_tool_transport.py:165,678`, `mcp_tool_handlers.py:615` | Ported from `anomalyco/opencode` (several PRs) | MIT | C15 "translate ideas" |
| `tools/mcp_tool_content.py:42` | Ported from `MoonshotAI/kimi-code#2600` | MIT | |
| `tools/mcp_tool_server_run.py:457` | Ported from Kilo Code's MCP resilience | MIT | |
| `gateway/platforms/base.py:230` | Ported from `nearai/ironclaw#2304` | MIT OR Apache-2.0 (dual) | |
| `plugins/platforms/telegram/adapter.py:4070` | ported from `openclaw/openclaw#72038` | MIT | |
| `plugins/platforms/qqbot/{chunked_upload,keyboards}.py` | Ported from "WideLee's qqbot-agent-sdk v1.2.2" | **Unclear**: the repo was not identified (`tencent-connect/qqbot-agent-sdk` is MIT) | **FLAG**. Not selected; do not port |
| `plugins/platforms/yuanbao/yuanbao_sticker.py:2,18` | Ported from `yuanbao-openclaw-plugin` and its `builtin-stickers.json` | **Unclear**: `Tencent/yuanbao-openclaw-plugin` reports "Other"; `YuanbaoTeam/…` has none | **FLAG**. Not selected; do not port |
| `agent/vault_login_classifier.py:220` | Ported from OpenInstinct | MIT (Merit-Systems) | REFUSED by the port map anyway |
| `tools/tts_tool_local.py:111` | points users to `OHF-Voice/piper1-gpl` | GPL-3.0 (external program) | Invoked, not vendored. Bundling Piper is a GPL question |
| `tools/skills_hub_github.py:229` | "some GPL; KEGG is commercial for non-academic use" | n/a | About hub-installed skills; hub install is REFUSED |

### 2.3 Trademarks and brand items in port paths
- **Names:**
  - "Hermes" and "Hermes Agent" are Nous Research product names; "Nous Research" is the company;
  - `~/.hermes`, `HERMES_HOME` and `hermes_cli` identifiers.

  About 3,000 matching lines in the port paths; rename them on port.
- **Images, fonts and audio:** none in the planned port paths.
- **Third-party names:** messaging platform names (Telegram, Slack, Discord and others) appear only in
  nominative, identifying use.

### 2.4 Other
- **Patents:** MIT has no express patent grant.
- **Export control:** no export-control statement.
- **Data:** `optional-mcps/` (56 server manifests) is port-map "data only". It describes third-party
  servers whose own licences and terms were not reviewed.

## 3. OpenClaw (openclaw/openclaw)

### 3.1 Licence and notices
- **Licence:** `LICENSE` at the root: MIT, `Copyright (c) 2026 OpenClaw Foundation`.
  `packages/ai`, `packages/gateway-client` and `packages/gateway-protocol` each carry the same MIT
  `LICENSE`.
- **NOTICE:** none at the root.
- **`THIRD_PARTY_NOTICES.md` at the root.** Content, condensed; the full text is in the clone:
  - **SQLite:** public domain. It is bundled only in macOS standalone builds.
  - **Pi / pi-mono:** "Portions of OpenClaw were adapted from Pi / pi-mono, and OpenClaw also depends on
    `@earendil-works/pi-tui` for terminal UI rendering." Upstream
    https://github.com/earendil-works/pi-mono, MIT, `Copyright (c) 2025 Mario Zechner`, full MIT text.
  - **GitHub Octicons:** MIT, `Copyright (c) 2026 GitHub Inc.`; two icon paths in the Control UI.
  - **Hermes Agent:** "OpenClaw's live repetition guard adapts the bounded streaming checks, repeated
    text detection, and sampled exact-period expansion from Hermes Agent". Source
    `agent/repetition_guard.py@acc3cada0da86c81efc8aa6c5a291989549ca900`, OpenClaw source
    `packages/agent-core/src/repetition-guard.ts`, MIT, `Copyright (c) 2025 Nous Research`.
- **Other nested notice files, all outside the planned port paths (not read in detail):**
  - `apps/macos/Sources/OpenClaw/Resources/{DeviceModels,ProviderIcons}/NOTICE.md`;
  - `packages/mermaid-renderer/native/NOTICE.txt`;
  - `extensions/facetime/{LICENSE,THIRD_PARTY_NOTICES.md}`;
  - `extensions/knowledge/THIRD_PARTY_NOTICES.md`. It covers gbrain (MIT) and also contains Apache-2.0
    text. `extensions/knowledge` is reference only;
  - `extensions/typesafe/LICENSE`;
  - `apps/swabble/LICENSE`;
  - `apps/android/THIRD_PARTY_LICENSES/`, `apps/ios/Resources/Licenses/`, `apps/ios/THIRD_PARTY_FONTS.md`
    (SIL OFL 1.1 fonts: Inter, JetBrains Mono, Red Hat Display);
  - `.agents/skills/update-team-server/controller/THIRD_PARTY_NOTICES.md`.

### 3.2 Embedded third-party code in planned port paths
(The paths are listed in `work\paths-openclaw.txt`.)

| File | Embedded licence | Original author | Action |
|---|---|---|---|
| `packages/terminal-core/src/ansi.ts` | MIT ("derived from ansi-regex and strip-ansi"; full MIT block in the file) | Sindre Sorhus | Keep the block; notice C.1 |
| `packages/gateway-protocol/src/compiled/sender-identity.js`, `src/compiled/protocol.generated/predicates.js` | MIT (generated TypeBox validators) | Haydn Paterson (TypeBox) | Notice C.2 if ported. Better: regenerate them, or depend on TypeBox |
| `extensions/slack/skills/_vendor/slack-skills-plugin.LICENSE` (+ `.json`) | MIT | Slack Technologies, LLC (2020-) | Notice C.3 if ported |
| `packages/agent-core/src/repetition-guard.ts` | MIT ("Adapted from Hermes Agent") | Nous Research | Not in the plan. Covered by the Hermes notice if ported |
| `extensions/{brave,duckduckgo,searxng,telegram,slack,msteams,signal}/assets/activity.svg` | CC0-1.0 (`simple-icons@16.31.0`) | Simple Icons contributors | No copyright duty, but these are **trademarks**; do not port |
| `extensions/{exa,tavily,firecrawl,azure-speech}/assets/activity.svg` | MIT (`@lobehub/icons-static-svg@1.95.0`) | LobeHub (2023) | Trademarks; do not port |
| `extensions/{perplexity,deepgram,elevenlabs}/assets/activity.svg` | MIT ("Adapted from OpenClaw ui/public/provider-icons…") | **Peter Steinberger** (2026) | Trademarks; do not port. Note the copyright holder is an individual, not the Foundation (§10 Q7) |

- **Pi / pi-mono.** No Pi marker (`pi-mono`, `Mario Zechner`, `badlogic`, `earendil`, `oh-my-pi`) appears in
  any planned path. The files that do reference Pi are under `src/tui/`, `src/agents/sessions/` and
  `src/agents/modes/`; these are imports of the `@earendil-works/pi-tui` dependency and are outside the
  plan.
  - **Why that does not settle it:** the notice says "portions … were adapted" with no file list, and
    the clone is shallow.
  - **Packages that look like Pi's architecture:** `packages/ai` ("model provider adapters and streaming
    runtime"; 37k LOC, reference only), `packages/agent-core` and `packages/llm-core`. Pi's own packages
    are `pi-ai`, `pi-agent-core` and `pi-tui`.
  - **Recommendation:** credit Pi on **every** OpenClaw-derived file. It costs one line, so we do not
    have to prove a negative.
- **No Apache, GPL or other non-MIT code** in the planned paths.

### 3.3 Trademarks and brand items in port paths
- **Names:**
  - "OpenClaw" and "ClawHub";
  - "Clawd" and "Clawdbot". `docs/start/lore.md:18` records that the project was renamed in January
    2026 after "Anthropic sent a polite email asking for a name change (trademark stuff)";
  - `openclaw` identifiers, about 16,900 matching lines in the port paths;
  - `ai.openclaw.app` Kotlin packages under `apps/android/…/node`.
- **Logos:**
  - the red lobster mascot (`ui/public/favicon.svg`; native plugin icons reuse it);
  - `extensions/browser/chrome-extension/icons/icon{16,32,48,128}.png`;
  - `extensions/*/assets/icon.png`, 54 image files across the planned extension paths.
- `extensions/ICON_SOURCES.md` states: "Third-party marks remain their owners' property and identify their
  integrations; attribution does not grant trademark rights."
- **Recommendation:** port no image assets from OpenClaw at all.

### 3.4 Other
- **CLA:** none found in `CONTRIBUTING.md`.
- **Patents:** MIT, no express grant.
- **xAI:** the `extensions/xai` paths are excluded by owner decision (no Grok API).

## 4. OpenBot (CopilotKit/OpenBot)

### 4.1 Licence and notices
- **Licence:** `LICENSE` at the root: MIT, `Copyright (c) 2026 CopilotKit`. The root, `server` and `shared`
  `package.json` files say `MIT`; `mobile/package.json` has no `license` field.
- **NOTICE:** none, and no third-party notice file in the planned paths.
- The extracted `OpenBot-main.zip` (`C:\dev\ProjectOS-vendor\openbot-main\OpenBot-main`) is the same
  commit, and the addendum found it byte-identical.

### 4.2 Embedded third-party code in planned port paths
- `server/src/{computer,routines,demonstrations,recorder,approvals,browser,memory}`, `shared/` and `mobile/`
  contain **no third-party licence or provenance markers**.
- `shared/marks/` (16 files) holds vendored **brand logos**. Its `README.md` says that most come from
  `@lobehub/icons-static-svg` (MIT). Three are "the vendor's own published artwork":
  - `ag2.svg`, from `ag2ai/ag2`, verbatim;
  - `agno.svg`, a PNG from `agno-agi/docs`;
  - `langroid.svg`, a PNG from `langroid/langroid`.

  These three have **no licence stated for the artwork**, so their copyright position is unclear. The
  README also says: "Each mark is its owner's trademark." **Do not port `shared/marks/`.**

### 4.3 Trademarks and brand items
- **Names:** "OpenBot" and "CopilotKit". The mobile app name is "OpenBot", with bundle id and package
  `ai.openbot.mobile` and scheme `openbotmobile`.
- **Name clash:** "OpenBot" is also the name of the unrelated Intel ISL project in §6. Do not use the
  name for anything in ProjectOS.
- **Third-party marks in `shared/marks/`:** Anthropic, OpenAI, Google ADK, Microsoft Agent Framework,
  CrewAI, LangGraph, LlamaIndex, Mastra, Pydantic AI, Strands, AG2, Agno, Langroid, Antigravity and
  Claude Agent SDK.

### 4.4 Other
- **CLA:** none.
- **Patents:** none (MIT).
- **Hosted service:** an "Intelligence" service with an entitlement check (`server/src/intelligence-*`,
  `shared/intelligence-key.ts`). It runs under CopilotKit's service terms, not the code licence, and is
  refused by the port map ("no external memory custodian").

## 5. oh-my-hermes (rlaope/oh-my-hermes)

### 5.1 Licence and notices
- **Licence:** `LICENSE` at the root: MIT, `Copyright (c) 2026 oh-my-hermes contributors`.
- **NOTICE:** none at the root.
- **Toolkit-level notices.** Each exists in three copies, under `src/skills/*_toolkit/`, `skills/omh-*/toolkit/`
  and `agent-skills/omh-*/toolkit/`:

| Toolkit | File | Licence and copyright |
|---|---|---|
| show-reel | `LICENSE.upstream` | MIT, `Copyright (c) 2026 Minho Hwang (revfactory)` |
| ai-job-search | `LICENSE.upstream` | MIT, `Copyright (c) 2026 Mads Lorentzen` |
| geospatial-analysis, sprite-forge | `LICENSE.upstream` | MIT, OMH contributors (manifest classification `original_omh`) |
| molecular-docking | `NOTICE.md` | MIT, OMH contributors: "original OMH work, not copied AutoDock Vina or ToolUniverse code" |
| biomedical-evidence | `upstream-manifest.json` | references BioMCP: MIT, `Copyright (c) 2025 Ian Maurer` ("audited dependency, not authorship"; "provider data rights separate") |

The toolkits are executable and are **not imported** (addendum C9). If a skill pack's directory is
imported as test data, its `LICENSE.upstream` or `NOTICE.md` goes with it.

### 5.2 Embedded third-party code in planned port paths
- Planned paths: `src/plugin_bundle/omh/*` (memory governance, safety, DAG, todo-evidence, receipts),
  `src/workflows/external_effect_receipts.py`, `src/quality/evidence_records.py`, `src/capabilities/`,
  `src/catalogs/model_chain_table.py`, `src/commands/model_chains.py` and `src/coding/model_routing.py`.
  They contain **no third-party licence or provenance markers**.
- The one credit is `src/plugin_bundle/omh/desktop/plugin.js:68` ("Formatters ported from the retired
  Hermes status widget"), which is Hermes MIT and not in the plan.
- All **274 `SKILL.md`** packs declare `license: MIT` in their frontmatter.
- **`docs/SKILL-SOURCES.md`** lists upstreams that were studied but not copied:
  - `plantuml` (GPL-3.0, "external tool, invoked not vendored");
  - `odoo` (LGPL-3.0), `frappe/erpnext` (GPL-3.0) and `twentyhq/twenty` (AGPL-3.0), from which field
    semantics were studied;
  - `ksimback/tech-debt-skill` ("no license published, so link-only reference");
  - `kodustech/awesome-agent-skills` (no licence; an index).

  No code from these is in OMH according to its own records. **Do not follow these links to copy
  anything.**

### 5.3 Trademarks and brand items
- **Names:** "oh-my-hermes", "OMH" and `omh` identifiers (hundreds of lines in the port paths). The
  project also leans on "Hermes", the Nous Research product name.
- **Images:** none in the port paths.
- **xAI:** xAI and Grok rows in `catalogs/model_chain_table.py` and `coding/model_*.py` must be stripped
  (owner decision).

### 5.4 Other
- **DCO:** every commit must carry a Developer Certificate of Origin sign-off (`CONTRIBUTING.md:74–116`).
  This is better provenance hygiene than a bare MIT project. It is not a CLA.
- **Patents:** none (MIT).

## 6. OpenBot (Intel ISL; now ob-f/OpenBot)

### 6.1 Licence and notices
- **Licence:** `LICENSE` at the root: MIT, `Copyright (c) 2020 Intel ISL (Intel Intelligent Systems Lab)`.
- **NOTICE:** none.
- **Upstream URL:** the README links to `github.com/ob-f/OpenBot`. The GitHub API confirms that
  `isl-org/OpenBot` redirects there (MIT).

### 6.2 Embedded third-party code
**Apache-2.0 files.** There are **32 content files**, not 23 as the addendum §2.3 says, plus 2 Gradle
wrapper scripts:

| Copyright line | Files |
|---|---|
| `Copyright 2019 The TensorFlow Authors. All Rights Reserved.` | 18 Java files under `robot/android/app/src/main/java/org/openbot/app/robot/`: `tflite/{Detector,Network}`, `tracking/MultiBoxTracker`, `env/{BorderedText,ImageUtils,Logger,Size}`, `customview/*` (7), `original/*` (4). Also `res/layout/{activity_camera,camera_connection_fragment,camera_connection_fragment_tracking}.xml` |
| `Copyright 2017 The TensorFlow Authors. All Rights Reserved.` | `tflite/DetectorDefault.java` |
| `Copyright 2017 Google Inc. All Rights Reserved.` (ARCore sample code) | `pointGoalNavigation/rendering/{BackgroundRenderer,ObjectRenderer,ShaderUtil,TwoDRenderer}.java`; `assets/shaders/{object,screenquad}.{frag,vert}` |
| `Copyright 2019 Google LLC` (Blockly) | `open-code/src/components/blockly/index.js`, `…/generator/javascriptGenerator.js` |
| (Gradle) | `robot/android/gradlew`, `gradlew.bat`: build tooling, not ported |

**NOTICE status of these Apache upstreams.** `tensorflow/examples`, `tensorflow/tensorflow`,
`google-ar/arcore-android-sdk` and `google/blockly` were each checked via the GitHub API, and none has
a NOTICE file. So §4(d) adds no text. §4(a)–(c) still apply: ship the licence, keep the headers, and mark
the changes.

**BSD-3-Clause.** `policy/openbot/associate_frames.py` carries `Copyright (c) 2013, Juergen Sturm, TUM`.
It is "Modified and extended by Matthias Mueller – Intel ISL – 2020". `policy/` is not in the plan; the
full text is in THIRD_PARTY_NOTICES §6.2 in case it is ever needed.

### 6.3 Model weights and data (separate terms)
- **No model file is in the archive.** `robot/android/app/download.gradle` downloads these at build time
  from `storage.googleapis.com/openbot_models/`:
  - `autopilot_float.tflite`;
  - `ssd_mobilenet_v1_1_metadata.tflite`;
  - `navigation.tflite`;
  - `coco.txt` and `labelmap.txt`.
- **`assets/config.json` also lists optional downloads:** MobileNetV3-320; YoloV4-tiny-224/416 and
  YoloV4-224; **YoloV5s/m/l** (320/640, int8); EfficientDet-Lite0/1/2.

| Model | Likely origin and licence (not verified from the archive) | Flag |
|---|---|---|
| YoloV5s/m/l | Ultralytics YOLOv5: **AGPL-3.0** (GitHub API: `ultralytics/yolov5` = AGPL-3.0) | **HIGH**: AGPL with a network-use clause. Exclude |
| YoloV4 / tiny | Darknet / AlexeyAB: licence varies by fork | Unclear: verify before any use |
| SSD MobileNet V1/V3, EfficientDet-Lite | TensorFlow model zoo / Model Maker: usually Apache-2.0 | Verify the specific checkpoints |
| `autopilot_float`, `navigation` | trained by Intel ISL; **no licence stated for the weights** | Unclear: assume not covered by the MIT code licence until confirmed |
| COCO labels / training data | COCO annotations CC BY 4.0; images under Flickr terms | Attribution if the labels are redistributed |

The addendum's C25 rule ("model files allowlisted by hash; owner-approved") should add one more
requirement: **a recorded weight licence for each model**.

- **Binaries.** `robot/android/comlib/download.gradle` fetches `.aar` binaries (Wroup, usbserial) whose
  licences were not verified. `gradle-wrapper.jar` and `utils/google-java-format-1.7-all-deps.jar` are
  vendored build tools. None of these is ported.
- **Firebase config.** `robot/android/app/src/main/assets/google-services.json` (`project_id`
  "example-project") and `robot/ios/OpenBot/OpenBot/GoogleService-Info.plist` are Firebase
  configuration. Do not port them.

### 6.4 DISCLAIMER (extra terms)
`DISCLAIMER.md` (also in zh-CN, de-DE, fr-FR, es-ES and ko-KR) says, among other things:
- "Misuse of the software for malicious or unethical purposes is strictly prohibited."
- "By using the OpenBot software and hardware designs, you acknowledge that you have read, understood,
  and agreed to the terms of this disclaimer."

These sit beside an MIT licence, which has no use restrictions. **Lawyer question (§10 Q5):** is this
disclaimer binding as an additional term, or advisory only? Either way, keep a copy with any isl-derived
file.

### 6.5 Trademarks and brand items
- **Names:** "OpenBot" (clashes with CopilotKit's project) and "Intel" (a famous mark; do not imply
  endorsement).
- **Logos:**
  - `robot/android/app/src/main/res/drawable*/ic_openbot*.png`;
  - `open-code/src/assets/images/icon/{open-bot-logo,OBplaygroundLogo}.png`;
  - iOS `Assets.xcassets/.../robotInfo.imageset/*logo openbot*.png` and `open_code.imageset/*logo.png`;
  - `docs/images/logo.png`.
- **Hardware:** the `body/` CAD files are the OpenBot hardware design; not ported.

### 6.6 Other
- **Patents:** Intel's MIT code has no express grant. The Apache-2.0 files carry the TensorFlow and
  Google contributors' §3 patent licence for those files only.
- **Export control:** none stated. Robotics and on-device ML are not listed items as such; see §9.
- **CLA:** none (`CONTRIBUTING.md` covers workflow only).

## 7. Rakazo (elie222/rakazo)

### 7.1 Licence and notices
- **Licence:** `LICENSE` at the root: Apache License 2.0. It is 178 lines; the terms (TERMS AND CONDITIONS
  through END OF TERMS) are identical to the canonical text after whitespace normalisation, and the
  usual APPENDIX is replaced by the applied notice `Copyright 2026 Rakazo contributors` plus the standard
  "Licensed under the Apache License…" boilerplate.
- **Package metadata:** 21 of the 25 `package.json` files say `Apache-2.0`. The 4 native modules under
  `apps/mobile/modules/` have no `license` field and fall under the root LICENSE.
- **NOTICE:** none. **Per-file headers:** none in the planned paths.
- **Apache-2.0 §4 duties for ProjectOS:**
  - ship the licence text;
  - mark every modified file with a prominent change notice;
  - keep any existing notices;
  - there is no NOTICE to reproduce.

### 7.2 Embedded third-party code in planned port paths
- `packages/core/src`, `packages/adapters/src`, `packages/contracts` and `apps/mobile` contain **no
  third-party licence or provenance markers**. The one "Port of" comment (`EndpointAllowlist.kt:20`)
  refers to Rakazo's own TypeScript.
- **Pi is a dependency, not copied code.** Rakazo imports `@earendil-works/pi-ai`, `pi-agent-core` and
  `pi-telemetry` 1.3.0 as npm packages (about 115 import sites). Ported adapters that keep those
  imports bring Pi in as a **dependency**, which goes on the dependency notice list.
- **Assets in `apps/mobile/assets/`:**
  - `icon.png`, `adaptive-icon.png`, `splash-icon.png`, `favicon.png`, `notification-icon.png`,
    `monochrome-icon.png` and `icon-background.png`: Rakazo brand. Replace them.
  - `sounds/*.m4a` (22 files: `wait-hollow-01…10`, `wait-wood-01…10`, `warm-start`, `warm-end`): **no
    source or licence record. FLAG.** Replace them, or get provenance from upstream.
  - `material-icons/{grid_view,group,person_add}.xml`: likely Google Material Symbols (Apache-2.0),
    unattributed. Attribute or redraw.

### 7.3 Trademarks and brand items
- **No trademark rights** (Apache-2.0 §6).
- **Brand items in the mobile fork:**
  - app name "Rakazo", slug and scheme `rakazo`;
  - bundle id and package `com.rakazo.app`;
  - Kotlin package `com.rakazo.notifications`;
  - module names `rakazo-*`;
  - `packages/ui-tokens/assets/Rakazo.icon`.

  About 3,700 matching lines in the port paths. All must be renamed for the C18 fork.
- **Outside the port paths:** the marketing site (`apps/www`) uses competitor marks (Grok, Claude Duet
  and others).
- **xAI:** strip xAI and Grok from `adapters/src/pi-models.ts`, `pi-oauth.ts` and `contracts/src/domain.ts`.

### 7.4 Other
- **Patents:** Apache-2.0 §3 gives an express patent licence from each contributor. It ends for ProjectOS
  if ProjectOS sues anyone alleging that Rakazo infringes a patent.
- **CLA:** none. `CONTRIBUTING.md` is silent, so inbound contributions are Apache-2.0 under §5.
- **Store distribution:** forking the mobile app means distributing it through app stores (§10 Q3).

## 8. Corrections to the port map and addendum

1. **isl OpenBot Apache count.** The addendum says 23 files; there are **32** content files. The extras
   are 3 layout XML files, 4 ARCore GLSL shaders and 2 Blockly JS files. The 23 Java files are correct.
2. **isl OpenBot model weights.** The addendum's C25 does not mention licences. **YOLOv5 is AGPL-3.0**,
   and Intel's own weights carry no licence.
3. **isl OpenBot `DISCLAIMER.md`.** It adds use conditions; not mentioned before.
4. **Hermes "ported from" fragments** (§2.2) are not in the port map. One (LobeHub) is under a
   restrictive licence; two (Yuanbao, qqbot) have unclear provenance; one (Codex) carries a NOTICE.
5. **The Pi uncertainty is wider than the port map implies.** The map says "check for Pi provenance". The
   check cannot succeed on a shallow clone with no file list, so credit Pi always.
6. **OpenClaw holds more embedded MIT code than the Pi and Hermes notices show:** Sindre Sorhus, TypeBox
   and Slack (§3.2).
7. **Upstream URL for the Intel project.** It is `ob-f/OpenBot`; the `isl-org` and `intel-isl` URLs
   redirect.

## 9. Export control (summary for the lawyer)

- None of the six projects carries an export-control notice. A search for `ECCN`, `export administration`,
  `5D002` and `Wassenaar` found nothing relevant.
- The ported code is published open source. Under the US EAR, published source code is generally not
  subject to the EAR (15 CFR 734.3(b)(3), 734.7). Since 2021 that also covers publicly available
  encryption source code, except "non-standard cryptography".
- What ProjectOS **ships** is a separate question: an MSI, and an iOS/Android app that uses TLS, passkeys
  and hashing. App Store submission asks the encryption-export questions
  (`ITSAppUsesNonExemptEncryption`, mass-market treatment). No ported file implements custom
  cryptography, based on the files read.

## 10. Questions for the lawyer

1. **ProjectOS's own licence.** `package.json` says `"private": true, "license": "UNLICENSED"`; the code is
   proprietary. MIT and Apache-2.0 both allow inclusion in proprietary software. Confirm:
   - that the obligations trigger on **distribution**: the MSI installer, and any mobile app on the
     stores;
   - that a `THIRD_PARTY_NOTICES.md` in the repository plus an in-app licences screen satisfies "included
     in all copies or substantial portions" (MIT) and §4(a) (Apache).
2. **AGPL-3.0 YOLOv5 weights.** Confirm that excluding them is enough. Confirm whether downloading
   AGPL weights at build time, without shipping them, still creates obligations.
3. **App-store distribution of the Rakazo-derived app** (Apache-2.0) and of any MIT code. Are there any
   conflicts with store terms? Store terms are generally compatible with permissive licences, but please
   confirm.
4. **LobeHub Community License fragment.** Is a short string plus behaviour, credited as "ported from
   lobehub#19329", copyrightable expression whose translation needs a commercial licence? We plan to
   rewrite it from scratch rather than rely on the answer.
5. **isl OpenBot `DISCLAIMER.md`.** Is it an additional binding term on top of MIT? Does it restrict
   ProjectOS's use?
6. **Pi provenance.** Is a blanket Pi credit on every OpenClaw-derived file adequate and safe, given that
   upstream does not identify the files? Should ProjectOS ask OpenClaw for a file list?
7. **Copyright holders.** Some OpenClaw files are © Peter Steinberger, not the OpenClaw Foundation. Is
   there any chain-of-title concern? Both are MIT, and we credit both where they appear.
8. **Contributor terms.** Only OMH has a DCO; Hermes has an inbound=outbound clause; the others have no
   contributor terms (Apache §5 covers Rakazo). Is MIT's lack of an express patent grant acceptable for
   the MIT sources (Hermes, OpenClaw, CopilotKit, OMH, Intel)?
9. **Apache-2.0 §3 defensive termination** (Rakazo, TensorFlow and Google files). Does it raise any concern
   for ProjectOS's patent strategy?
10. **AI-written upstream code.** Several upstream repos are developed heavily with AI coding agents (they
    contain `AGENTS.md`/`CLAUDE.md` files and co-author trailers). Does that change anything? We will
    comply with the licences regardless.
11. **Third-party service terms.** Ported connectors talk to services such as Telegram, Slack, OpenAI and
    Deepgram under those services' API terms, which are separate from the code licences. Should these be
    reviewed per connector before release?
12. **Trademarks.** Is it acceptable to use third-party product **names** nominatively in the UI, for
    example "Telegram channel"? We plan to ship **no** third-party logos and none of the six projects'
    names or logos.

## Appendix A: files produced

- `…\scratchpad\legal\vendor-provenance.md`: this report.
- `…\scratchpad\legal\THIRD_PARTY_NOTICES.draft.md`: a ready-to-commit credits file. The licence texts were
  copied byte-for-byte from the vendor LICENSE files by `work\assemble-notices.sh`.
- `…\scratchpad\legal\porting-convention.md`: the header, register and validator rule.
- `…\scratchpad\legal\work\`: the scan scripts, path lists and raw hits.
