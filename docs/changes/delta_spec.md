# Delta Specification — plan v1.36: port phases 7-12, then V4 Stage 3 (memory and context)

**Status:** APPROVED by the owner in Plan Mode, 2026-11-03, revision 2. No code is written until plan v1.36 is
decided and activated. Revision 2 came after an Agency `multi-agent-systems-architect` design challenge, verdict BLOCK on
revision 1; findings F1-F11 verified in code and folded in, see "Design challenge"), for the owner's approval in Plan
Mode. K7 ruled by the owner 2026-11-03: "Keep the receipt (Recommended)". No code is written until plan v1.36 is
decided and activated. Drafted at `main` = `origin/main` = `e4f39a94` (Stage 2 complete, plan v1.35 35/35).

The previous delta (plan v1.28, Stage 2, complete) is archived at
`docs/changes/archive/delta_spec_PROJECTOS-TENANT-V1.28.md`. The port delta
`docs/changes/delta_spec_V4_PORTS.md` (owner "Approved", 2026-11-01) stays the authority for what each port
takes and how it is credited; this file sequences its phases 7-12 and adds Stage 3.

**Goal, in two parts:**
1. **Ports 7-12** land the Stage 4 capabilities as credited, tested, *unwired* code, exactly as ports 1-6 did:
   routines, the model broker, agents, the agent computer's approval and policy rules, cited research, and
   governed MCP connectors. Nothing reaches a live provider, the network, a shell or a browser in this plan.
2. **Stage 3** wires memory, skills and context into the product, so a fresh session resumes a half-done
   phase with zero manual context relay. That is the Stage 3 exit proof, run live on the agency pilot.

## What the audit found (these change the plan)

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| A1 | **Ports 1-5 are used by nothing.** Each is re-exported from the core barrel only; the brief, runner and `run.ts` reach none of them. | `core/src/index.ts:38,46-49`; no importer outside each module's own dir and tests | Stage 3 is wiring, not porting. |
| A2 | **A fresh worker knows nothing of earlier attempts.** `continue --execute` picks the in-progress phase but starts a new session from a plan-only brief: no findings, work record, decisions or memory. Rejoining needs a typed `--resume --session <id>`. `resumeProblems` has no caller. | `run.ts:699,765-800`; `runner.ts:452-464`; `brief.ts:254-307`; `workRecord.ts:239` | The exit-proof gap is context, not session rejoin. A new worker with retrieved state meets it without changing routing. |
| A3 | **The brief refuses free text it cannot trace**, and is capped at 16,000 characters. Paths are exempt. | `brief.ts:93,352,364-412`; `runner.ts:481` | Context goes in a separate fenced file *referenced* from the brief's `records`, so the provenance walk is not loosened. |
| A4 | **Four port validators forbid the wiring Stage 3 needs.** PX-17 (context names in `run.ts`), AP-29 (approvals names in any `src`), PM-16 and PK-16 (writer exports from the agent barrel). | `val-projectos-port-context1a.cjs:109,950`; `val-projectos-port-approvals1a.cjs:109,763` | Each wiring phase narrows the rule it must cross to the exact call site it adds, with a named mutation, never deletes it. |
| A5 | **Binding carry-forwards from ports 2-6 must land before any prompt reads a store**: `containsSecret` on load, rendered-body cap (84,603 rendered against 2,200), per-project index files (BM25 statistics leak), `documentSources` off the `System` port, kernel-set `origin`, signed or kernel-issued skill pins, unmediated workers start tainted. | `docs/finish/PROJECTOS-PORT-{SEARCH,MEMORY,SKILLS,CONTEXT,APPROVALS}1A.md` | Each is an acceptance criterion in the phase that first reads that store. |
| A6 | **No memory, search, skill or retrieval action is registered.** Unregistered means P5, and changing `action-registry.json` is the P5 action `action-registry-change`. | `projectos/security/action-registry.json` | One owner act (O1) commits all Stage 3 entries at once, before the first wiring phase. Ports 7-12 add none, because they ship unwired. |
| A7 | **All vendor paths for ports 7-12 are present** at the 2026-11-01 pins. OpenClaw exec approval has no single "binding" file (about 60 `exec-approval*` files), so COMPUTER1A names its exact subset. | `C:\dev\ProjectOS-vendor\incoming-2026-11-01\` | No re-download. |
| A8 | **Name collisions.** `core/src/execution/providers/`, `projectos/providers/`, `core/src/search/` and `agent/src/mcp/` exist. | Directory listing | New dirs: `modelBroker/`, `research/`, `mcpConnectors/`. |
| A9 | **No new dependency is needed for ports 7-12 unwired.** OpenBot's schedule validator parses five-field cron itself; the action policy can ship as a typed default-deny table. | `server/src/routines/schedule.ts`; `server/src/computer/policy.ts` | `cron-parser` and `cel-js` stay approved-for-later (TRD §1) and come with Stage 4 wiring. `core` stays dependency-free. |

## Design in one page

- **Ports 7-12 follow the ports 1-6 shape.** Pure rules in `core/src/<dir>/`; any I/O in `agent/src/<dir>/` behind
  an injected port (transport, spawn, fetch) with fakes in tests; credit header on every ported file and a
  `THIRD_PARTY_NOTICES` entry; one validator with named mutations, each killed by its own rule. Closed, not wired in.
  Wiring belongs to Stage 4.1-4.3 (headless workers, role broker, isolation), in a later plan.
- **Stage 3 keys every retrieval on the run's envelope.** `(tenant, domain, project)` from `admittedRunEnvelopeOf(ctx)`,
  filtered by `scope` and fresh against `subjectHash` (HEAD). Never from worker text, flags or environment (R2), and
  never re-derived a second time inside the loop. `runLoop` does not receive the context today (`run.ts:517`), so
  phase 9 makes **one owner-approved edit to PROTECTED `run.ts`**: pass `runEnvelope: admittedRunEnvelopeOf(ctx)` as
  one more option, nothing else. Retrievals are recorded in a loop-written ledger in the session's records, not as
  kernel crossings, so `actionRegistry.ts` (`RUN_LINKED_ACTIONS`) is not touched.
- **Only committed bytes become context.** Decisions, plan memory and approved memory are read with `git show HEAD:`;
  a working-tree copy that differs is refused. From the work record only closed-vocabulary fields render (state,
  `lastStopCode`, `subjectCommit`); its free-text fields are worker-writable and excluded from the candidate, so they
  are never passed on. Earlier findings render under "worker-authored, from a cut-off attempt", never ranked as decisions.
- **A cut-off attempt's leftovers are named, not inherited silently.** The context file lists the dirty paths and
  hashes the loop observed. The run refuses if any falls outside the phase's `writePaths`.
- **Taint is evidence in Stage 3, not a gate.** The worker's own CLI tools are unmediated, so a taint "gate" would be a
  label. Instead the evidence records exactly which stored context the worker read, and the independent reviewer and
  the gatekeeper see it. Taint-driven fresh approvals wait for Stage 4, when headless workers mediate tools.
- **Compaction is deterministic in Stage 3:** selection and truncation only, no model call, so no unbudgeted spend.
- **Authority outranks recollection.** Committed plan, records and approved decisions rank above memory and
  summaries; a summary never overwrites a decision; a stale citation (index older than HEAD) is marked stale, not served
  as current.
- **Memory and skill writes stay proposals.** The agent proposes; the owner approves memory; a skill is promoted only
  through its validator, an independent review (D11) and a hash pin. Nothing writes itself.
- **Context reaches the worker by reference.** The runner writes `.projectops/execution/<session>.context.md` (fenced,
  untrusted, secret-scanned, capped) and the brief names it as `records.contextPath` (a `*Path` key, so the provenance
  walk exempts it as it does every record path; `BriefRecordPaths` gains the field). The worker instruction says to read
  it as data. `.projectops/execution/` is not git-ignored, so the file is committed with the run's records as an audit
  copy of what the worker was shown; it must never count toward the candidate.
- **Proposals have one door.** A worker asks for a memory or skill write by adding a `proposals` entry to its findings
  record; the loop turns it into a pending proposal pinned by hash. A worker writing `.projectops/memory/` or
  `skills/` directly is detected and refused at the check step (under D4 nothing stops the write itself).
- **Resume = new worker plus retrieved state.** No `--session`, no human-written text, no change to phase selection
  or to `run.ts`'s routing (its only edit is phase 9's one option). The work record stays non-authority: it informs the worker, it never selects or advances a phase.

## Phases (plan v1.36, appended after the 35 closed phases)

Ports run first, as the owner asked. Stage 3 phases do not depend on ports 7-12, so they may overlap in separate
worktrees once O1 is done (pace rule: parallel worktrees, one review per phase, one recheck at most).

| # | Phase | Delivers | Source | Depends on | Reviews (besides self-review) |
|---|---|---|---|---|---|
| 1 | PROJECTOS-PORT-ROUTINES1A | Routine records and floors: five-field cron, 15-minute minimum over 200 occurrences, 20 enabled, auto-disable after 10 failures; each run has its own budget; an unattended run refuses P3+ and escalates; occurrence-scoped idempotency key; prompt scan (C13) | CopilotKit OpenBot `server/src/routines/{schedule,runner}.ts`; Hermes `cronjob_prompt_scan`, `cron/occurrences.py` | Stage 2 | ECC SECURITY |
| 2 | PROJECTOS-PORT-PROVIDERS1A | Model broker: provider registry, retry with a backoff floor, committed pricing feeding `RateCard`, fallback chain and cooldown, custom OpenAI-compatible endpoint records, loopback-only local model detection; every call P3 with a mandatory budget (C11) | OpenClaw `packages/{llm-core,retry,model-catalog-core}`, `src/model-catalog/pricing.ts`; Hermes `provider_registry`, `fallback_cooldown`, `usage_pricing` | Stage 2 | ECC SECURITY, Agency `api-platform-engineer` |
| 3 | PROJECTOS-PORT-AGENTS1A | Pure rules only: agent records (proposed through plan review), queue-state rules (pause, resume, crash recovery) as functions the existing `agent/src/workforce/` dispatch can adopt in Stage 4, delegation with allowlist grants at most the parent's, depth and fan-out caps under the parent budget, same-tenant messages enveloped through `checkChildEnvelope`; cross-tenant refused. **No second queue or dispatcher:** workforce stays the only one (PRD non-goal) (C7, C12) | OpenClaw `src/routing` model; Hermes `delegate_tool*` | 2 | ECC SECURITY, Agency `multi-agent-systems-architect` |
| 4 | PROJECTOS-PORT-COMPUTER1A | Exec-approval binding (argv, cwd, hash, expiry, single use; an approved command cannot be edited), allowlist patterns, typed default-deny action policy, kill-tree runner behind an injected spawn port; browser and computer-use interfaces that refuse `SANDBOX_NOT_AVAILABLE` until Stage 4.3 (C14) | OpenClaw `src/infra/exec-allowlist-pattern.ts` and a named `exec-approval*` subset, `src/process`; CopilotKit OpenBot `server/src/computer/policy.ts` | 3 | ECC SECURITY, Agency `application-security-engineer` |
| 5 | PROJECTOS-PORT-RESEARCH1A | SSRF guard and website policy, readability extraction, step-capped research loop, cited answers only (reusing search's `admitCitedAnswer`), fetched content untrusted and threat-scanned; SearXNG and Brave adapters behind an injected fetch, no live call (C16) | OpenClaw `src/web-search`, `src/web-fetch`, `extensions/{web-readability,searxng,brave}`, `src/security/external-content.ts`; Hermes `url_safety`, `website_policy` | 2 | ECC SECURITY, Agency `application-security-engineer` |
| 6 | PROJECTOS-PORT-MCP1A | MCP client lifecycle behind an injected spawn port, on `connectorContract`: server allowlist pinned by hash, sampling off, elicitation to the owner queue, per-tool spend, output untrusted; zero live connectors (CC-25 stands) (C15) | OpenClaw `src/mcp`, `extensions/mcp-relay`; Hermes `mcp_tool_{costs,scope,sampling}` | Stage 2 | ECC SECURITY, Agency `application-security-engineer` |
| O1 | **[OWNER]** Stage 3 action entries | One committed change to `action-registry.json`, prepared by the lead, covering everything Stage 3 hits so no second registry act is needed: `memory-retrieve` (P1), `skill-load` (P1), `memory-propose` (P2), `skill-propose` (P2), `context-write` (P2, local), `memory-index-rebuild` (P2, local, derived indexes only), `memory-delete` (P5: approved memory and anything a decision cites). Approving a memory proposal or promoting a skill stays the existing P5 `approve`. | — | — | ECC SECURITY reads the diff before the owner commits |
| 7 | PROJECTOS-MEMORY-STORES1A | Plan 3.1. The six memory classes mapped onto existing stores (`docs/architecture/memory-classes.md`); per-project index files; `documentSources` through the `System` port; plan memory, execution records and findings indexed and rebuildable; `containsSecret` and the rendered-body cap on `loadMemoryBlock`; the one proposal door (findings `proposals` entry → pending proposal); direct writes to `.projectops/memory/` or `skills/` detected and refused at the check step | Ours, on ports 2-3 | O1 | ECC SECURITY |
| 8 | PROJECTOS-MEMORY-PROVENANCE1A | Plan 3.3. Provenance and freshness ranking; committed bytes only (a differing working-tree copy is refused); summary never overwrites a decision; stale-citation marking; retention and deletion per class, each deletion recorded, `memory-delete` P5 | Ours, on ports 3, 5 | 7 | ECC SECURITY |
| 9 | PROJECTOS-CONTEXT-MANAGER1A | Plan 3.4. The one-option `run.ts` edit (`runEnvelope`); retrieval keyed on it; the loop-written retrieval ledger; `records.contextPath` and the fenced context file; deterministic compaction in the carried call order, stop on `overLimit`, refuse a partial summary; approved decisions always loaded; the evidence names the stored context read; PX-17, AP-29, PM-16, PK-16 narrowed to the new call sites, each with a named mutation | Ours, on ports 2-6 | 8 | ECC SECURITY, Agency `multi-agent-systems-architect` |
| 10 | PROJECTOS-SKILLS-ADOPT1A | Plan 3.2. Kernel-set `origin`; promotion through the skill validator, an independent review and a hash pin; the loader (`skill-load`) adds promoted skills to the context file and refuses an unpinned or changed skill; the bounded-repeat evasions closed; nothing runs from a skill's `scripts/` | Ours, on port 4 | 9 | ECC SECURITY |
| 11 | PROJECTOS-RESUME1A | A new worker on an in-progress phase receives, through the context manager: the work record's closed-vocabulary fields, earlier findings and evidence labelled worker-authored, approved decisions and memory; the cut-off attempt's dirty paths and hashes, refusing any outside `writePaths`; a moved HEAD marks old evidence stale. Selection unchanged; the work record stays non-authority; no `--session` | Ours | 9 | ECC SECURITY |
| 12 | PROJECTOS-MEMORY-EXIT-PROOF1A | **Stage 3 exit proof, live on the agency pilot.** A run is killed partway; a fresh process runs one `continue --execute`; the phase reaches closed with zero manual context relay; a ledger validator in the style of `validate-zero-relay-continuity` proves the new worker used retrieved state and no human text, and that worker-authored text never ranked as a decision. Spend inside the $1.50 phase cap | Ours | 11 | ECC SECURITY, ECC code-reviewer |

Every port validator (phases 1-6) also forbids any importer outside the module's own tests and, for phases 4 and 6,
any import of `node:child_process`: "unwired" is enforced, not just stated.

## Zone 1 — ADDED
- `projectos/core/src/{routines,modelBroker,agents,computer,research,mcpConnectors}/` and their tests in `projectos/core/test/`.
- `projectos/agent/src/{routines,modelBroker,agents,computer,research,mcpConnectors,context}/` and tests in `projectos/agent/test/`.
- Validators: `val-projectos-port-{routines,providers,agents,computer,research,mcp}1a.cjs`,
  `val-projectos-memory-{stores,provenance}1a.cjs`, `val-projectos-skills-adopt1a.cjs`,
  `val-projectos-context-manager1a.cjs`, `val-projectos-resume1a.cjs`, `val-projectos-memory-exit-proof1a.cjs`.
- `docs/architecture/memory-classes.md`; `docs/finish/<phase>.md` for each phase.

## Zone 2 — MODIFIED (exact files and why)
- `projectos/core/src/index.ts`, `projectos/agent/src/index.ts`: barrel exports for new modules (agent barrel keeps the
  PM-16/PK-16 writer bans).
- `./THIRD_PARTY_NOTICES`: one entry per ported upstream file group.
- `projectos/validators/validate-all.cjs`, `projectos/speed/cached-runner.cjs`: **registration only**, both lists kept
  identical (FU-6). `validate-all.cjs` is PROTECTED; registration-only edits were approved this way for ports 1-6 and
  this delta asks for the same approval.
- `projectos/agent/src/search/{localIndex,documentSources}.ts`, `agent/src/memory/memoryFiles.ts`,
  `agent/src/skills/skillQueue.ts`, and the matching `core/src/{search,memory,skills,context}/` files: the A5 carry-forwards.
- **`projectos/agent/src/commands/run.ts` (PROTECTED, owner approval asked here):** phase 9 only, one added option
  `runEnvelope: admittedRunEnvelopeOf(ctx)` in the `runLoop` call (`run.ts:517`). No other line changes; the phase's
  validator pins that the diff to this file is that one option.
- `projectos/agent/src/loop/brief.ts`: one `records.contextPath` field and the `BriefRecordPaths` type (phase 9). Pinned
  in part by `val-projectos-boot-continue1a.cjs` (PROTECTED); the edit stays outside the pinned text, and if a pin must
  move, the phase stops and asks.
- `projectos/agent/src/loop/runner.ts`: accept `runEnvelope`; write the context file and retrieval ledger before the
  worker starts (phases 9-11). Not protected;
  `val-projectos-work-record-not-authority1a.cjs` still forbids it naming `resumeProblems` or selecting from the work record.
- `projectos/agent/src/loop/adapters/claudeCodeCli.ts`, `codexCli.ts`: the pointer instruction names the context file.
- `val-projectos-port-{context,approvals,memory,skills}1a.cjs`: PX-17, AP-29, PM-16, PK-16 narrowed to exact call sites.
- `docs/06_Plan.md`: tick and log each step. `docs/04_TRD.md`: unchanged (no new dependency).

## Zone 3 — PROTECTED (do not touch)
Everything in `00_Baseline_State.md` §4, unless named above with its reason. In particular, no phase in this plan changes:
closure authority; the owner floor and `permissions.ts`; gatekeeper composition, `run.ts` (outside phase 9's one option) and `gatekeeperConfig.ts`;
`loop/workers.ts`, `verification.ts`, `candidateIdentity.ts` and write grants; the broker, the credential router,
`credentialResolver.ts` and credential custody; `taskEnvelope.ts`, `actionRegistry.ts` and `tenant.ts`; `action-registry.json`
(outside O1, which the owner commits); `connectors/registry.json` (stays empty); `projectos/host/**`; the SQL.
Vendor folders stay read-only: nothing installed or run from them; `openbot-lower` (nightly-labs, PolyForm Noncommercial)
is never opened. No xAI path is ported.

## Owner decisions
1. **K7: decided** 2026-11-03, "Keep the receipt (Recommended)". The typed blob receipt stays the registry's owner
   check; the "non-owner last commit" clause of the Stage 2 delta is retired. Signed commits (plan 1.7) remain the real
   fix. No phase.
2. Approve this delta, including: the registration-only edits to `validate-all.cjs`; the one-option edit to PROTECTED
   `run.ts` (phase 9); the `brief.ts` field.
3. O1: commit the seven Stage 3 action entries when the lead presents the diff.

## Design challenge (Agency `multi-agent-systems-architect`, corpus `ad9264e3`, on revision 1)
Verdict BLOCK. Every finding was checked in code by the lead before acceptance.

| # | Finding | Verified | Disposition |
|---|---|---|---|
| F1 | Retrieval keyed on the run envelope, but `runLoop` never receives it and rev. 1 promised no `run.ts` change | `run.ts:517` | One owner-approved option in `run.ts`, phase 9 |
| F2 | "Recorded as a crossing" fails: `mintCrossing` takes only the hardcoded `RUN_LINKED_ACTIONS` | `actionRegistry.ts:59`, `taskEnvelope.ts:425` | Loop-written retrieval ledger; `actionRegistry.ts` untouched |
| F3 | A `records.context` key fails the provenance walk | `brief.ts:353` (`endsWith('Path')`) | Named `contextPath` |
| F4 | Work-record free text and earlier findings are worker-writable, so one worker could instruct the next | `candidateIdentity.ts:110`; `workRecord.ts:19-20` | Committed bytes only; closed-vocabulary work-record fields; findings labelled worker-authored |
| F5 | A new worker silently inherits a cut-off attempt's dirty edits | design inference; brief carries HEAD only | Dirty paths listed; outside `writePaths` refuses |
| F6 | "Starts tainted" is either a mid-run approval wall or a label | `core/src/approvals/taint.ts` has no call site | Taint is evidence in Stage 3; gating waits for Stage 4 |
| F7 | Compaction would need an unbudgeted model call | `core/src/context/compaction.ts:7` | Deterministic compaction only |
| F8 | O1 missed index rebuild, deletion, skill load, and the proposal channel | delta text | O1 completed; one proposal door |
| F9 | AGENTS1A's queue would duplicate workforce dispatch (PRD non-goal) | `agent/src/workforce/orchestrator.ts` | Pure rules only; workforce stays the only queue |
| F10 | SKILLS lengthened the critical path to CONTEXT | delta order | CONTEXT depends on 8; SKILLS after CONTEXT |
| F11 | "Unwired" ports need an enforced fence | — | Validators forbid outside importers and `child_process` |

Carried into the phases as checks: whether the context file can ever join the candidate (it must not), and whether a
retry after a recorded worker timeout at the same HEAD is admitted (`governedContext.ts:703` uses
`retryUnsettled: true`, so it should be).

## Still carried, not in this plan
Cross-tenant release with a live requester on the real installation, and the released half (owner grant); `val-cd-b4`
(`host/core/src/ipc_session.rs:693` public, Stage 4); Stage 4.1-4.3 and the Stage 4 exit proof (next plan); key
rotation and PAT revocation at project completion (owner); legal name and product name (owner).

## Risk
- **Wiring a prompt to stored text** is the main new attack surface: memory, skills and fetched pages are untrusted.
  Each load is threat-scanned, secret-scanned, capped and fenced, and every worker that reads it starts tainted.
- **Scope:** twelve phases plus one owner act. Ports revert alone; Stage 3 phases stack in order.
- **Spend:** only phase 12 calls the gatekeeper and the Codex reviewer, inside the committed $1.50 per-phase cap.
- **A green exit proof does not lift D4.** Workers still run as the owner's Windows user until Stage 4.3 and service
  custody.
