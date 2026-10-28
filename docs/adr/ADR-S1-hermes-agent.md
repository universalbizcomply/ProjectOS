# ADR-S1 — Hermes Agent (Nous Research): REFERENCE

**Status:** Decided by the spike, 2026-10-28 (V4 plan Stage 1, spike S1). It is research only. Nothing
was installed, cloned or run. A research subagent drafted it from primary sources and the lead
recorded it. The cited claims were not re-verified one by one, and anything marked UNVERIFIED is
still open.

## Question
Can Hermes's memory and skill-learning framework sit under the ProjectOS kernel as an adapter
without becoming a second orchestrator?

## Findings
- **The product.** A Python "self-improving agent" (run with `uv`; Node for its UI). It ships
  messaging gateways, cron and subagents. MIT licence. About 258k stars, and v0.22.5 came out
  22–23 Oct 2026 after five releases in nine days.
  ([repo](https://github.com/NousResearch/hermes-agent),
  [releases](https://github.com/NousResearch/hermes-agent/releases))
- **Memory.** `~/.hermes/memories/MEMORY.md` (2,200-character cap) and `USER.md` (1,375), plain
  text, plus SQLite FTS5 sessions. The agent writes memory itself, including from a background
  self-review after turns. Entries carry **no author, timestamp, session or hash provenance**.
  ([memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory))
- **Skills.** `SKILL.md` files with YAML frontmatter (the agentskills.io format), written by the
  agent through `skill_manage` and loaded in three stages.
  ([skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills))
- **Coupling.** Memory and skills are tools inside Hermes's own loop. `MemoryManager` and the tool
  registry drive them, so they are not standalone libraries.
  ([architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture))
- **Gating.** An optional `write_approval` stages writes for Hermes's own `/memory approve`, not for
  an owner-approved record.
- **Security.** The `local` backend has no isolation. The default `smart` approval lets an
  auxiliary LLM auto-approve. Secrets sit in `~/.hermes/.env`. Its own docs say the denylists are
  "not a sandbox". ([security](https://hermes-agent.nousresearch.com/docs/user-guide/security))

## Decision: REFERENCE
Its memory and skill writes come from its own loop and its own approve command, and the entries
carry no provenance. An adapter would either import a second orchestrator or need a rewrite.

**Adopt natively in ProjectOS (Stage 3):**
- capped curated memory that refuses over-limit writes;
- staged writes pinned to the entry they target, refused if it changed;
- a pending/approve/reject queue for agent-proposed memory and skills;
- three-stage skill loading;
- a scan of content before it reaches a prompt;
- `SKILL.md` as an *exchange* format.

**Narrowest boundary, if ever revisited:** read-only import of `SKILL.md` files as data, accepted
into git only through an owner-approved plan. No Hermes process runs.
