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

---

# Plan v1.37 (draft) — Stage 4, first phase: PROJECTOS-WORKER-CODEX-IMPLEMENTER1A (plan 4.1a)

**Status:** DRAFT, not approved. Drafted 2026-11-17 at `main` = `ef473593` (plan v1.36 47/47). No code until the owner approves in Plan Mode.

**Why this phase first:** the Stage 4 exit proof is "the same phase runs with the implementer and reviewer providers swapped, and no code change". Today only Claude can implement, and Claude or Codex can review, so the swap is impossible. This is the smallest slice that removes that wall; 4.2 and 4.3 build on it.

## Existing code found (B1)

| What | Where | Consequence |
|---|---|---|
| Claude implements AND reviews; the loop never touches VS Code (the only `.vscode` mention is a never-writable path) | `agent/src/loop/adapters/claudeCodeCli.ts` | The "no VS Code dependency" half of 4.1 is already true. This phase pins it with a validator rule instead of rebuilding it. |
| Codex is a REVIEWER kind only; `start` and `rejoin` refuse; fixed read-only sandbox; closed argument allowlist; credential scrub; out-of-checkout command and secret-reply heuristics | `agent/src/loop/adapters/codexCli.ts` (561 lines) | Stays untouched. Its "never an implementer" guarantee is pinned by `codexCliAdapter.test.ts` and its validator. The implementer is a separate kind. |
| Adapter registry `BUILT_IN_ADAPTERS` ("a new KIND is a new entry here; a new WORKER is configuration only") | `claudeCodeCli.ts:321` | One new entry. Not a protected file. |
| Worker roles, write grants, `roleBindingProblems`, `reviewerWorkerId` | `agent/src/loop/workers.ts` (PROTECTED), `reviewRoles.ts` | Unchanged. The existing post-run grant check stays the authority on what was written. |
| **CORRECTION (2026-11-17, found while reading `runner.ts` before building).** Write scope for a Claude worker is PREVENTATIVE: the loop composes per-path `--allowedTools Edit(path)` grants onto the worker's argv (`runner.ts` `writeGrant`, `withCorrectionGrants`, `argvGrants`/`grantedPaths` in `workers.ts`). There is NO post-run check that the changed paths lie inside the plan's `writePaths` (only git-ignored content, hook/settings dirs, the memory and skill stores, and resume dirty paths are judged after the worker). My first draft said the loop checked the resulting diff; that was wrong. | `runner.ts:1890-1904`, `workers.ts:376-415`, `candidateIdentity.ts` | A Codex worker has no per-path grant (its workspace-write sandbox covers the whole checkout), so for Codex the scope check does not exist unless this phase adds it. See FR-003 and Rule 3, now rewritten. |
| Provider choice per role | `.projectops/project-config.json` `execution.workers` (`claude-local`, `claude-reviewer`) | A swap becomes a config edit by the owner: a `codex-local` implementer and a Claude reviewer. |
| Provider broker, retry, pricing, fallback (4.5) | `core/src/modelBroker/`, `agent/src/modelBroker/`, unwired | Not this phase. That is 4.2. |

## User stories

- **P1 (MVP slice).** As the owner, I configure a Codex worker as the implementer of a phase and the loop runs it headless, in the phase worktree, under the same brief, write grants, evidence, independent review and gatekeeper path as a Claude worker. *Given* a plan whose worker is of kind `codex-implementer-cli`, *when* `run --execute` dispatches it, *then* Codex runs headless from the brief path with a fixed instruction, and any write outside the plan's `writePaths` is refused by the existing check.
- **P2.** As the owner, a Claude reviewer reviews a Codex implementer (`providerDistinct` true), and a Codex reviewer reviews a Claude implementer, with no code change between the two.
- **P3.** As the owner, a Codex implementer cannot be started as a reviewer, and the reviewer-only Codex kind cannot be started as an implementer.

Edge cases: Codex not installed or not logged in (refuse with a named reason, no retry loop); Codex exits non-zero; reply carries a credential-shaped string; a configured argument tries to widen the sandbox; the worker is cut off mid-run (a fresh worker with retrieved state, per the Stage 3 design; no Codex session rejoin).

## Functional requirements

- FR-001 The system MUST provide a worker kind `codex-implementer-cli` whose `start` runs `codex exec` headless, from the brief path and one fixed instruction sentence, with the checkout as working directory.
- FR-002 The sandbox MUST be set by the adapter only, never by configuration, MUST be Codex's workspace-write sandbox confined to the checkout, and the argument allowlist MUST be closed (no `danger-full-access`, no bypass flag, no `--add-dir`, no `-c` except the adapter's own Windows sandbox pair, no profile). The only configured arguments accepted are model selection, the same three switches as the reviewer, and `--allowedTools <grants>` (record grants, consumed by the adapter, never forwarded).
- FR-003 (rewritten) The adapter MUST enforce write scope itself, after the run, because Codex cannot be given per-path grants. It reads the `Edit(...)`/`Write(...)` grants the loop puts on `worker.args` (the configured worker-owned records, plus the plan's `writePaths` on the first dispatch and any correction grants), MUST NOT pass `--allowedTools` to Codex, takes the candidate identity (`computeCandidateIdentity`, read-only import) before and after the run, and MUST return `refused` naming every path that changed outside the grants. The check is DETECTIVE, not preventative: an out-of-scope write has already happened and is left in the tree for the owner; the run stops (`WORKER_REFUSED`) and nothing is certified.
- FR-003a A candidate identity that cannot be read before or after the run MUST refuse the run (a blind check is not a check).
- FR-004 `rejoin` MUST refuse with "start a fresh worker"; `review` MUST be absent. `codex-cli` (reviewer) keeps refusing `start`.
- FR-005 The spawn MUST use the same scrubbed environment, argument-credential refusal and bounded timeout as every worker spawn, and MUST pass no key, token or login material.
- FR-006 A reply or event stream carrying credential-shaped content MUST be withheld and reported as a refusal, never written to a record or stop detail.
- FR-007 A validator MUST pin: the scope check and its refusal; no VS Code API or `code` binary use anywhere in `agent/src/loop`; both Codex kinds present in `BUILT_IN_ADAPTERS`; each kind's role refusals.
- FR-008 Two role-swap fixtures (Claude implements / Codex reviews, Codex implements / Claude reviews) MUST run through the same loop code with fake spawn ports and differ only in committed worker config.

SC-001 Both swap fixtures pass with no source difference. SC-002 Every named mutation (widen the sandbox, let `codex-implementer-cli` review, let `codex-cli` implement, drop the credential scrub, let `rejoin` run) is killed by its own rule.

No blocking `[NEEDS CLARIFICATION]`. Defaults chosen: fresh worker instead of Codex session resume; no live Codex call in this phase (the live swap is the Stage 4 exit proof; it spends provider money, so it asks the owner first).

## Zone 1 — ADDED

- `projectos/agent/src/loop/adapters/codexImplementer.ts` (the new kind; reuses the parser, scrub and denial helpers by import from `codexCli.ts`, never by copy).
- `projectos/agent/src/loop/writeScope.ts` (as built: the scope snapshot and rule, kept out of the adapters directory so the adapter has exactly one spawn) and `projectos/agent/test/writeScopeRealGit.test.ts` (real git, temporary repository).
- `projectos/agent/test/codexImplementerAdapter.test.ts` and `projectos/agent/test/workerRoleSwap.test.ts` (fake spawn port, no network, no real Codex).
- `projectos/validators/val-projectos-worker-codex-implementer1a.cjs` with named mutations (SC-002).
- `docs/finish/PROJECTOS-WORKER-CODEX-IMPLEMENTER1A.md`.

## Zone 2 — MODIFIED (smallest change)

- `projectos/agent/src/loop/adapters/claudeCodeCli.ts`: one import and one line in `BUILT_IN_ADAPTERS`; nothing else.
- `projectos/agent/src/loop/adapters/codexCli.ts`: add `export` to `WINDOWS_SANDBOX`, `commandProblem` and `inert` only (as built) (no logic change; `val-projectos-kernel-followup1a` pins by substring, re-run to confirm). If any logic has to change, the phase stops and asks.
- `projectos/validators/val-projectos-worker-lifecycle-bounded1a.cjs`: `KNOWN_ADAPTERS` gains `codexImplementer.ts`, so the new file is held to the same bound rules (every spawn carries `timeoutMs`, a worker without a bound is refused). Extending a closed list, not loosening a rule.
- `projectos/validators/validate-all.cjs`, `projectos/speed/cached-runner.cjs`: registration only, lists kept identical. `validate-all.cjs` is PROTECTED; this delta asks for the registration-only edit, as plan v1.36 did.
- `docs/06_Plan.md`: tick with evidence. `docs/04_TRD.md`: unchanged (no new dependency; Codex is a local CLI the owner logs into).

## Zone 3 — PROTECTED (do not touch)

Everything in `00_Baseline_State.md` §4. In particular: `loop/workers.ts` (grants, `roleBindingProblems`), `verification.ts`, `pinnedValidators.ts`, `candidateIdentity.ts`; `commands/run.ts`; the broker, credential router and `credentialResolver.ts`; `.projectops/project-config.json` (the owner edits worker config; this phase ships no config change and no worker entry); `taskEnvelope.ts`, `actionRegistry.ts`, `action-registry.json`; `projectos/host/**`; the SQL. `codexCli.ts` behaviour, its test and its validator stay as they are.

## Rules (each becomes a test)

1. A worker of kind `codex-implementer-cli` may implement and never review; a worker of kind `codex-cli` may review and never implement.
2. The Codex sandbox is chosen by the adapter and is never configurable.
3. What a Codex implementer may write is the loop's grants (the plan's `writePaths` and the worker-owned records), judged by the adapter on the candidate before and after the run; Codex's sandbox is not the boundary, and the check detects a breach, it does not prevent it.
4. No credential, key or login material crosses the command line or the environment, and a credential-shaped reply is withheld.
5. Resuming a cut-off Codex run starts a fresh worker; there is no Codex session rejoin.
6. Swapping which provider implements and which reviews is a committed-config change only.
7. Nothing in the loop depends on VS Code.

## Plan, tasks, risk (trimmed)

Constitution check: no PROTECTED file edited beyond the registration-only lists; no new table, money rule or login change. The approval gate applies because this adds a second write-capable provider (a security boundary) and edits a protected registration file.

**Reviews:** ECC `security-reviewer` mandatory and independent; Agency `application-security-engineer` additive (security and external-api routes); max 2 builders; one recheck.

- [ ] T001 Tests first: sandbox allowlist, role refusals, credential scrub, withheld reply (`test/codexImplementerAdapter.test.ts`).
- [ ] T002 Adapter `codexImplementer.ts` to pass T001.
- [ ] T003 Registry entry (`claudeCodeCli.ts`) and swap fixtures (`test/workerRoleSwap.test.ts`).
- [ ] T004 Validator with named mutations; register in both lists; credit and no-secrets validators; every validator that reads a touched file.
- [ ] T005 Independent security review, fix round, recheck; lead verification; finish doc; tick plan.

**Residuals to state, not hide:** Codex runs as the owner's Windows user (D4 stands until 4.3); a workspace-write sandbox blocks writes outside the checkout, not reads, so the credential heuristics are fail-closed signals, not proof.

**Not in this phase:** making the Codex implementer a context-pointable kind (`CONTEXT_POINTABLE_KINDS`, pinned by `val-projectos-context-manager1a` CM-20): until then a run that has stored context REFUSES for a Codex implementer (`CONTEXT_NOT_POINTABLE`), truthfully, and the exit proof on a project with stored context needs that follow-up (put it in the Stage 3 carry-forwards phase); 4.2 role broker wiring; 4.3 isolation and idempotency keys; the Stage 3 carry-forwards (proposal door, taint enforcement, index directory, owner verifier; their own next phase); `val-cd-b4` (Rust host, protected, owner approval); the live swap proof.

**As built (2026-11-17).** The scope check does not use `computeCandidateIdentity`: the independent review showed it cannot see ignored paths, the gatekeeper asking records or non-ASCII names, so `writeScope.ts` takes its own snapshot (see `docs/finish/PROJECTOS-WORKER-CODEX-IMPLEMENTER1A.md`). FR-003 stands as rewritten; the instrument changed, not the rule.

---

# Plan v1.37 (draft) — Stage 3 carry-forwards, phases A and B

**Status:** APPROVED by the owner 2026-11-17 ("Approved all, build A and B in parallel"). Drafted at plan branch `fe125030`. The carry-forward
items were collected read-only from the Stage 3 finish docs and checked in code; the full item table is in the finish docs of these phases.
Owner answers recorded (all as recommended): proposals will live in git-ignored `proposals/` directories (phase C, not here); the production
reviewer and verifier is a typed terminal confirmation by the owner; the deletion ledger is anchored by the owner committing it; PX-12 may move
for a deterministic summariser kind (phase C); taint enforcement is deferred to the 4.2 work.

Phase C (PROPOSAL-DOOR-WIRING1A: the door call in `runner.ts`, `SkillStatePorts`, `.gitignore`, PX-12) waits for B and has its own section later.

## Phase A — PROJECTOS-CONTEXT-CODEX1A

**Why:** a Codex implementer is refused whenever a run has stored context (`CONTEXT_NOT_POINTABLE`), so the Stage 4 exit proof cannot run on a
project that has memory. This makes the kind context-pointable.

**Existing code found.** `CONTEXT_POINTABLE_KINDS = [CLAUDE_CODE_CLI]` and `contextPointerPathOf` (`agent/src/loop/adapters/claudeCodeCli.ts`); the
instruction builders already take a `contextPath`; `InstructionBuilders` and the refusal of a brief naming `records.contextPath`
(`adapters/codexImplementer.ts`); the runner gate (`runner.ts`, `CONTEXT_NOT_POINTABLE`); pins CM-20 (`val-projectos-context-manager1a.cjs`) and
WI-3 (`val-projectos-worker-codex-implementer1a.cjs`).

**ADDED.** Tests only: the pointer is on the Codex command line as a project-relative path; no pointer for a path outside the root; the correction
sentence carries it; one loop-context case with kind `codex-implementer-cli`. No new source file, no new validator.

**MODIFIED.**
- `adapters/claudeCodeCli.ts`: the list becomes `[CLAUDE_CODE_CLI, CODEX_IMPLEMENTER]`, and the registry entry passes `contextPointerPathOf` to the factory.
- `adapters/codexImplementer.ts`: `InstructionBuilders` gains the pointer-path function (injected, so the file still imports nothing from the Claude
  adapter); the refusal is removed; both sentences receive the pointer.
- `val-projectos-context-manager1a.cjs` (CM-20 pin and its mutation) and `val-projectos-worker-codex-implementer1a.cjs` (the `contextRefused` pin
  becomes a pin on the pointer being passed, with mutations): moved with the rule, never deleted.
- `agent/test/codexImplementerAdapter.test.ts`, `agent/test/loopContext.test.ts`; `docs/finish/PROJECTOS-WORKER-CODEX-IMPLEMENTER1A.md` (item 6 struck).

**PROTECTED (untouched).** Baseline §4 in full; `workers.ts`, `candidateIdentity.ts`, `verification.ts`, `commands/run.ts`; `validate-all.cjs` and
`cached-runner.cjs` (nothing is registered); `codexCli.ts`, `writeScope.ts`, the context ledger logic.

**Rules.**
1. A Codex implementer is told where the stored-context file is.
2. The path on the command line is project-relative and under `.projectops/execution/`.
3. A path outside the root puts no pointer on the command line.
4. The correction sentence carries the pointer too.
5. A worker kind not in the list is still refused before the retrieval is recorded.
6. The write-scope check still runs with context present, and the placed context file is never counted as a breach or as the worker's change.
7. The adapter imports nothing from the Claude adapter.

**Reviews:** ECC `security-reviewer` (independent). One recheck at most.

## Phase B — PROJECTOS-MEMORY-OWNER-COMMANDS1A

**Why:** Stage 3 shipped the memory rules with no command the owner can run: nothing builds the search index, nothing deletes, nothing lists or
decides a proposal, and the owner verifier is a port with no production implementation.

**Existing code found (extend, never rebuild).** `rebuildProject`, `collectDocumentSources`, `collectStoreSources`, `openProjectSearchIndex` (search);
`deleteMemoryItem`, `deleteDerivedIndex`, `readCommittedDecisionTexts`, `gitRunnerOver`, `checkoutIdentityOf`, the deletion ledger
(`.projectops/memory-deletions`); `approveMemoryProposal` and the proposal queue; the typed TTY confirmation pattern used for the tenant receipt
(`agent/src/commands/tenant.ts`); the installation index directory already chosen in `runner.ts` (`<state>/search-index`). None has a production caller.

**ADDED.**
- `projectos/agent/src/commands/memory.ts`: `projectos memory index rebuild`, `memory delete`, `memory proposals`, `memory approve`, `memory reject`.
- `projectos/agent/src/memory/ownerTerminalVerifier.ts`: the production owner verifier. Both streams must be a TTY; the owner types a confirmation
  bound to the item, its hash, the tenant and the project; it answers exactly `true` or refuses. Passed as a parameter, never read from context.
- Tests in `projectos/agent/test/`; validator `projectos/validators/val-projectos-memory-owner-commands1a.cjs` with named mutations;
  `docs/finish/PROJECTOS-MEMORY-OWNER-COMMANDS1A.md`.

**MODIFIED.**
- `projectos/agent/src/cli.ts`: one `memory` case and its help lines.
- `projectos/agent/src/index.ts`: export the new agent names, keeping the PM-16 / PK-16 writer bans as they are.
- `projectos/validators/validate-all.cjs`, `projectos/speed/cached-runner.cjs`: registration only, both lists identical, appended at the end.
  `validate-all.cjs` is PROTECTED; registration-only, approved as before.
- Any Stage 3 validator that forbids these call sites is narrowed to the exact new call site with a named mutation, never deleted. If a rule cannot
  be narrowed that way, the phase stops and asks.

**PROTECTED (untouched).** Baseline §4 in full. In particular `commands/run.ts`, `loop/workers.ts`, `action-registry.json` and `actionRegistry.ts`
(`memory-delete` stays P5, `memory-index-rebuild` P2, approving a proposal stays the existing P5 `approve`), credential custody, the broker, the host,
the SQL. No change to `runner.ts` in this phase (the proposal door is phase C).

**Rules.**
1. No memory command decides anything without the owner at a terminal: a piped or redirected stream refuses, and so does any answer that is not the exact typed confirmation.
2. The confirmation is bound to the item, its content hash, the tenant and the project; a confirmation for another item approves nothing.
3. `memory delete` refuses an item a committed decision cites, and refuses when the committed decisions cannot be read.
4. Every deletion appends to the deletion ledger before the item is removed, and the command prints the ledger head for the owner to commit.
5. `memory index rebuild` writes only the per-project derived index under the installation state directory, records the commit it was built at, and never writes inside the project tree.
6. `memory approve` turns a pending proposal into approved memory only through the existing approval rule and the provenance replacement check; `memory reject` removes nothing but the pending proposal.
7. A project is identified from the installation's tenant registry for the checkout, never from an argument.
8. Every command prints a refusal with its reason and the next step; none prints stored text unfenced.

**Reviews:** ECC `security-reviewer` (independent, mandatory: deletion and owner proof). One recheck at most.

**Not in A or B:** the proposal door wiring, the skill reviewer verifier's use in skill promotion, taint enforcement, PX-12.

---

# Plan v1.37 (draft) — PROJECTOS-WORKER-SCRATCH-CHECKOUT1A (plan 4.3a)

**Status:** APPROVED by the owner 2026-11-17 ("Approved all"). Drafted at plan branch `d6529fb2`.
Owner answers recorded (all as recommended): the scratch is built from the working tree, not HEAD only, so a correction sees earlier work; the
scratch holds no `node_modules` (Codex cannot run the tests; the loop's own checks decide); deleting a granted file is refused in this slice;
reads of the real checkout by absolute path stay open until container or VM isolation, so D4 is not retired.

**Why:** the Codex implementer's write scope is detective only (see `docs/finish/PROJECTOS-WORKER-CODEX-IMPLEMENTER1A.md`, "What this does NOT
prove", items 2 to 5). Running the worker in a scratch copy and copying back only granted paths makes the scope preventative and leaves the real
tree byte-identical after a refusal.

**Existing code found.** The detective check (`agent/src/loop/writeScope.ts`: `grantScopes`, `pathInGrants`, `isAgentControlPath`,
`candidateSnapshot`, `scopeBreaches`) stays as the backstop. The adapter (`adapters/codexImplementer.ts`) runs Codex with `--cd root` and
`cwd: root`. The loop runs its checks, evidence and candidate identity in the real root AFTER the adapter returns (`runner.ts`), so a scratch
inside the adapter changes nothing else: the copy-back is all the loop sees. The brief carries absolute real-root paths (`brief.ts`
`repository.root`, `records.*`). Nothing in `agent/src` creates a worktree; a recursive copy of a worktree's `.git` mutates the real repository,
so `.git` is never copied.

**Options considered.** `git worktree add` (rejected: shares the real `.git` config, hooks and refs); `git clone --local` (rejected: keeps a remote
pointing at the real repository and loses uncommitted correction work); container or VM (deferred: high cost; the only option that also closes
reads by absolute path). Chosen: an adapter-local scratch export.

**ADDED.**
- `projectos/agent/src/loop/scratchCheckout.ts`: `exportScratch` (a fresh temp directory; the files git lists as tracked or untracked-not-ignored,
  never `.git`, never an ignored file; then a standalone `git init` there with no remote), `manifestOf` (walks without following links; records file
  hash, directory or link), `copyBack` (judges every difference first, writes nothing unless all are allowed).
- Tests in `projectos/agent/test/` (real temp directories and real git, no worker, no provider).

**MODIFIED.**
- `adapters/codexImplementer.ts`: build the scratch; write a copy of the brief into it whose `repository.root` and record paths point into the
  scratch, and place the existing evidence, findings, effects and stored-context files there; run Codex with `--cd` and `cwd` at the scratch and the
  scratch brief path in the sentence; copy back; keep the existing real-root before/after snapshot as the backstop; remove the scratch in a `finally`.
- `projectos/validators/val-projectos-worker-codex-implementer1a.cjs`: new rules with named mutations (no new validator, so no protected registration edit).
- `docs/finish/PROJECTOS-WORKER-CODEX-IMPLEMENTER1A.md` (residuals 3 to 5) and its own finish doc.

**PROTECTED (untouched).** Baseline §4 in full; `workers.ts`, `verification.ts`, `candidateIdentity.ts`, `localCandidateCommit.ts`,
`pinnedValidators.ts`, `commands/run.ts`, `validate-all.cjs`, `cached-runner.cjs`; `runner.ts` is not edited either.

**Rules.**
1. The scratch never contains `.git`, a git-ignored file, or anything under an agent control path.
2. The scratch is a standalone repository with no remote and no link to the real `.git`.
3. A changed file outside the grants refuses the whole copy-back, and nothing is written to the real tree.
4. A changed file under an agent control path is refused even beneath a directory grant.
5. A new or changed symlink or junction anywhere in the scratch refuses.
6. A file that became a directory, or a directory that became a file, refuses.
7. A copy-back whose real destination passes through a link refuses.
8. Deleting a granted file refuses in this slice.
9. A write made and undone in the scratch leaves no trace in the real tree.
10. A refused run leaves the real tree byte-identical to before.
11. The worker-owned records (findings, effects) written in the scratch are copied back under the same rule as any granted path.
12. The scratch is removed on every path, including a refusal, a timeout and a thrown error.

**Reviews:** ECC `security-reviewer` (independent, mandatory); one recheck at most.

**Not proven by this phase, and to say so:** whether Codex's Windows sandbox accepts a temp directory and a freshly initialised repository (needs a
live Codex probe, which spends provider money and asks the owner first); copy time on a large repository; reads by absolute path stay open.

---

# Plan v1.37 — PROJECTOS-PROVIDER-ROLES1A (plan 4.2, first slice)

**Status:** APPROVED by the owner 2026-11-17 ("Approved all"); in activated plan v1.37. Drafted at plan branch `3db082ae`.
Owner answers recorded (all as recommended): the plan's `WAITING_GATEKEEPER` is the state the code calls `AWAITING_GATEKEEPER`, and no second
name is added; `broker-call` (P3) stays the class for every model call, with no registry change; prices for providers outside the committed
gatekeeper rate cards wait for the later broker slice.

**Why:** plan 4.2 asks for a provider broker by role with a capability and cost registry. The ported model broker has no roles or capabilities and
nothing committed to read, and the trusted broker cannot carry a second provider as it stands. The first useful slice is selection and recording
only: no new network path, no credential, no money rule.

**Existing code found.** Worker roles come from `.projectops/project-config.json` `execution.workers`, `defaultWorkerId`, `reviewerWorkerId`
(`agent/src/loop/workers.ts`, PROTECTED: `authorisedWorkers`, `resolveWorker`, `resolveReviewer`). The gatekeeper route and its `rateCards` and
`budget` are in `.projectops/gatekeeper.json` (`loop/gatekeeperConfig.ts`, PROTECTED). The cost side exists (`RateCard`, the spend ledger, the
budget caps). The model broker (`core/src/modelBroker/`, `agent/src/modelBroker/committedConfig.ts` with its committed-bytes reader) is unwired and
fenced by `val-projectos-port-providers1a` (PP-24: no importer outside the module). `broker-call` is already a registered P3 action.

**ADDED.**
- `.projectops/provider-roles.json` (committed, schema 1): for each role (`implementer`, `reviewer`, `gatekeeper`) a `workerId` or the gatekeeper
  transport id, `capabilities` from a closed list, and a cost class (`unmetered`, or `metered` naming a model in the committed rate cards).
- `projectos/core/src/modelBroker/roleRegistry.ts` (pure): parse and validate against what is authorised; `selectForRole` returns an entry or nothing.
- `projectos/agent/src/commands/roles.ts`: `projectos roles`, a read-only report from committed bytes; a working-tree copy that differs is flagged.
- Tests in `core/test` and `agent/test`; validator `val-projectos-provider-roles1a.cjs` with named mutations; a finish doc.

**MODIFIED.**
- `agent/src/modelBroker/committedConfig.ts`: one reader for the role registry, reusing the existing committed-bytes read.
- `core/src/modelBroker/index.ts`: export the new file. `agent/src/cli.ts`: one `roles` case and its help line.
- `val-projectos-port-providers1a.cjs` PP-24: narrowed to allow exactly `commands/roles.ts` importing exactly the registry reader, with a named
  mutation for that file importing `callModel`; the rule stays for every other file.
- `validate-all.cjs`, `cached-runner.cjs`: registration only, both lists identical, placed BEFORE `val-projectos-memory-stores1a` (the Stage 3
  validators pin their own positions after it).

**PROTECTED (untouched).** `loop/workers.ts`, `commands/run.ts`, `loop/gatekeeperConfig.ts`, the trusted broker, `credentialResolver.ts`,
`action-registry.json`, `project-config.json`, `gatekeeper.json`, `closureTurn.ts`, `reconciliation.ts`. Nothing consults the registry to choose
a worker in this slice.

**Rules.**
1. A role may name only a worker in the committed `execution.workers`, or the committed gatekeeper transport.
2. A metered cost names a model in the committed rate cards; a zero price is refused.
3. Capabilities come from a closed list; an unknown one is refused.
4. A field named like a key, a credential or an endpoint is refused.
5. The registry is read from committed bytes only; a working-tree-only change is refused.
6. The implementer and reviewer roles may not resolve to the same worker.
7. Selection returns an entry or nothing, never a verdict; a gatekeeper role reports awaiting when no decision exists.
8. Nothing outside `commands/roles.ts` imports the model broker.

**Reviews:** ECC `security-reviewer`. One recheck at most.

# Plan v1.37 — PROJECTOS-HOST-SESSION-DIGEST-SEAL1A

**Status:** APPROVED by the owner 2026-11-17 ("Approved all"), including the edit to a PROTECTED file; in activated plan v1.37.

**Existing code found.** `val-cd-b4-sealed-expected-window-facts1a` (rule V2, since 2026-07-31) requires `session_digest` getters in host core to be
`pub(crate)`. `AdmittedRequest::session_digest` was added `pub` on 2026-09-07 (`693bc75d`), after the rule, and is the validator's one failure in
every full run since. A search of `projectos/host` found no caller of it outside the crate and no Rust test using it.

**MODIFIED.** `projectos/host/core/src/ipc_session.rs`: `pub fn session_digest` on `AdmittedRequest` becomes `pub(crate) fn session_digest`. One line.

**PROTECTED (untouched).** Everything else under `projectos/host`. No service install, start, ACL or registry change.

**Rule.** No sealed binding digest has a public getter in host core.

**Proof.** `cargo test` in `projectos/host/core` (doctests included) and a build and test of `projectos/host/windows-local-ipc`; the validator
passes; every other `val-cd-b4` validator that reads `ipc_session.rs` still passes. If any dependant fails to compile, the phase stops and reports.

**Review:** ECC `security-reviewer` reads the one-line diff and the cargo output.

---

# Plan v1.38 — PROJECTOS-PROPOSAL-DOOR-WIRING1A (Stage 3 carry-forward C)

**Status:** APPROVED by the owner 2026-11-17 ("Approve phase C, all three recommendations"). Lands AFTER PROJECTOS-MEMORY-OWNER-COMMANDS1A.
Owner answers (all as recommended): (1) this phase may also edit `val-projectos-context-manager1a.cjs`, because the summariser kind and the guard
re-baseline must move its CM-6 and CM-10 pins (the plan's write list for this phase gains that file: plan v1.38); (2) the kernel's own proposal files are
handled by a re-baseline of the store guard after the door, limited to the files the door made, not by exempting `proposals/` from the guard;
(3) skill proposals simply wait until a command decides them, and the two `.gitignore` lines are added to project onboarding later.

**Why:** `openProposalDoor` has no caller. A worker that asks for a memory or skill write through a `proposals` entry in its findings record is
ignored today. This wires the door so each entry becomes one pending proposal the owner can decide with the memory commands.

**Existing code found.**
- `openProposalDoor(sys, root, caller, findingsText)` (`agent/src/memory/proposalDoor.ts`): no product caller; its one skill call (`proposeSkill`)
  passes no `SkillStatePorts`, so a skill proposal can never be minted for review (`skillQueue.ts` skips `recordSkillMint` without them).
- `runner.ts` already holds both inputs (`checkoutIdentityOf`, `options.contextStateDir ?? nodeInstallationStateDir()`) and the findings record path.
- The store guard (`agent/src/context/contextStoreGuard.ts`: `beginStoreGuard`, `endStoreGuard`) takes ONE baseline per invocation; every later judgement
  compares against it, so a proposal the kernel writes in attempt 1 would be refused as a worker write in attempt 2.
- `commands/run.ts` `isFoldableRunRecord` (PROTECTED) refuses an untracked `proposals/` file at the next closure; `.gitignore` has no entry for either directory.
- `SUMMARISER_KINDS` in `core/src/context/provenance.ts` has no deterministic kind; the agent side records `agent-model` (`context/contextManager.ts`).

**ADDED.**
- `agent/test/proposalDoorWiring.test.ts`; validator `val-projectos-proposal-door-wiring1a.cjs` with named mutations, registered in both runners.
- `rebaseStoreGuard` in `contextStoreGuard.ts`; the summariser kind `deterministic-selection`.
- `.gitignore`: `.projectops/memory/proposals/` and `.projectops/skills/proposals/`.

**MODIFIED.**
- `memory/proposalDoor.ts`: an optional fifth parameter `state?: SkillStatePorts`, passed to the one `proposeSkill` call.
- `loop/runner.ts`: one door call per attempt after the post-checks store judgement and before `writeEvidence`, never on a refused worker, a dry run or an
  unreadable findings record; the caller is `{author: worker id, role: 'implementer', session}` taken from the kernel; outcome lines carry codes, ids and hashes only.
- `core/src/context/provenance.ts` and `agent/src/context/contextManager.ts` (PX-12): the deterministic kind, used when no drafter port exists.
- Pins moved with the rules, never deleted: `val-projectos-port-context1a.cjs` (PX-12 list and mutations), `val-projectos-memory-stores1a.cjs` MS-9 (gains `, state`),
  `val-projectos-context-manager1a.cjs` CM-6 and CM-10, `core/test/context-hardening.test.ts`.
- `validate-all.cjs`, `cached-runner.cjs`: registration only, both lists identical, BEFORE `val-projectos-memory-stores1a`.

**PROTECTED (untouched).** `commands/run.ts`, closure authority and the owner floor, `loop/workers.ts`, the registries, `endStoreGuard`'s refusal logic,
`val-projectos-port-memory1a.cjs`, `val-projectos-port-skills1a.cjs`, `agent/src/index.ts`.

**Rules.** Each is a test, a pin and a named mutation.
1. DW-1 The door passes `state` to `proposeSkill`, so a skill proposal can be minted and reviewed.
2. DW-2 The door runs once per attempt, after the store guard's post-checks judgement and before the evidence is written.
3. DW-3 One entry becomes exactly one pending proposal pinned by hash; an identical entry in a later attempt is a duplicate, not a second proposal.
4. DW-4 The caller is supplied by the kernel; a worker cannot name its own author or role.
5. DW-5 A worker write to a `proposals/` path is still refused (`MEMORY_STORE_CHANGED`) even though git ignores the directory.
6. DW-6 After the door, the guard is re-baselined for exactly the files the door made, so the next attempt is not refused for them, and a worker file placed beside them still is.
7. DW-7 The `.gitignore` lines are present and exact, `git status` is clean after the door, and neither `MEMORY.md` nor `skills/promoted` is ignored.
8. DW-8 No door call on a refused worker, a dry run, or an unreadable findings record.
9. DW-9 A deterministic compaction is recorded under a deterministic kind.
10. DW-10 `runner.ts` is the only caller of `openProposalDoor` and imports no propose or write entry point.
11. DW-11 Outcome lines carry codes, ids and hashes, never worker text.

**Reviews:** ECC `security-reviewer`; one recheck at most.

# Plan v1.43 — PROJECTOS-STAGE4-EXIT-PROOF1A (the Stage 4 exit proof)

**Status:** section committed alone before any run or code, 2026-11-18. Owner approvals (verbatim): run the live exit proof, cap $1.50 per run and $3.00 in total, a new trivial agency phase writing `site/colophon.txt` in `C:/dev/SEOAgency`, the secrets-handling receipt ("Approved", 2026-11-18); plan amendment v1.43 and the agency phase wording "Implementer self-review" plus "Independent code review" ("Yes to both, go ahead", 2026-11-18).

**Why this phase:** Stage 4 builds provider-role swappability. The exit test is: the same phase runs with the implementer and reviewer providers swapped, and no code change. Phases 4.1a (Codex implementer), 4.3a (scratch checkout) and the roles slice make the swap possible; this phase RUNS it live and judges the recorded evidence.

## Existing code found (B1)

| What | Where | Consequence |
|---|---|---|
| The swap is a committed-config change: `execution.workers`, `defaultWorkerId`, `reviewerWorkerId`; both directions are tested with fake spawns | `loop/workers.ts` (PROTECTED), `test/workerRoleSwap.test.ts` | No code change is needed or allowed; the proof differs only in `execution`. |
| The Codex implementer kind: `codex exec --sandbox workspace-write`, closed argument allowlist, record grants read from argv and never forwarded, never reviews, never rejoins | `loop/adapters/codexImplementer.ts` | Never run live before this phase. A refusal is a possible and honest result. |
| Scratch checkout: the worker runs in a copy, only granted paths are copied back, a refusal leaves the real tree byte-identical; the real-root snapshot stays as a backstop | `loop/scratchCheckout.ts`, `loop/writeScope.ts` | The write scope for Codex is preventative on this route; reads by absolute path stay open (D4). |
| The reviewer side: `claude-code-cli` reviews with read-only grants plus a fixed `--disallowedTools` list (no shell); `codex-cli` reviews in a read-only sandbox; `providerDistinct` is `worker.kind !== implementer.kind` | `adapters/claudeCodeCli.ts`, `adapters/codexCli.ts`, `independentReview.ts` | Claude has never reviewed live through this adapter. Distinctness is by kind, not identity. |
| Stage 3 exit proof: the structure, the evidence folder, the manifest, the named-mutation validator | `docs/finish/PROJECTOS-MEMORY-EXIT-PROOF1A.md`, `val-projectos-memory-exit-proof1a.cjs` | Followed one for one. The agency pilot, the throwaway runtime worktree plus a temporary allowlist commit, the localhost remote and the broker-metered gatekeeper are reused. |
| Spend: `.projectops/gatekeeper.json` budget (`phaseHardStopAtMicroUsd` 1,500,000; day 2,000,000; total 5,000,000); Codex and Claude run on the owner's logins and are not metered | agency repo | The $1.50 per run cap is the committed phase cap; the $3.00 total is enforced by the runbook and judged by SP-7. |
| The phase entry for this proof already exists in the plan source | `docs/projectos-finish-phases.json` (`PROJECTOS-STAGE4-EXIT-PROOF1A`) | This section refines it; it adds two dependencies and the registration-neighbour validators (see MODIFIED). |

## ADDED

- `docs/finish/PROJECTOS-STAGE4-EXIT-PROOF1A/` — the evidence: `setup.json`, `runtime.json`, `MANIFEST.json`, and one folder per attempt (`A/`, `B1/`, `B2/` only if declared) holding the run log, the times, the outcome, the source digest, the changed paths and the agency's own records.
- `docs/finish/PROJECTOS-STAGE4-EXIT-PROOF1A.md` and `docs/finish/PROJECTOS-STAGE4-EXIT-PROOF1A-validator-notes.md` (the notes carry the sha256 of every run log, one `attempt <id>: <status>` line per attempt, and the statements "no product code", "no model call", "does not lift D4").
- `projectos/validators/val-projectos-stage4-exit-proof1a.cjs` — rules SP-1 to SP-9 with named mutations, each counted killed only when its own rule fires.
- In the agency (`C:/dev/SEOAgency`, local branches `s4proof-base`, `s4proof-a`, `s4proof-b`, `s4proof-b2` only if needed): one phase `SEO-AGENCY-STAGE4-PROOF1A` (writes `site/colophon.txt`), one plan v1.6 activation per branch, one secrets-handling receipt per branch, one swap commit on the config-B branches. These are agency records, not ProjectOS code.
- In a throwaway runtime worktree of the plan branch: one TEMPORARY allowlist commit for `C:/dev/SEOAgency`. Never merged, never pushed.

## MODIFIED (exact files and why)

- `projectos/validators/validate-all.cjs` and `projectos/speed/cached-runner.cjs`: registration only, the new validator BEFORE `val-projectos-memory-stores1a` with a `// PROJECTOS-STAGE4-EXIT-PROOF1A` comment line above it, the two lists identical (the Stage 3 validators pin their own adjacency after that point, so it must not go last). `validate-all.cjs` is PROTECTED; this delta asks for the registration-only edit, as plans v1.36 and v1.37 did.
- `docs/projectos-finish-phases.json`: this phase's entry gains `PROJECTOS-CONTEXT-CODEX1A` and `PROJECTOS-WORKER-CODEX-IMPLEMENTER1A` in `dependsOn` and the validators that read the two runner lists in `requiredValidators` (plan amendment: `plan draft` -> decide -> activate; run the throwaway `writePathGrants` check on every phase before activating).
- `docs/06_Plan.md`: tick with date, commit and evidence. `docs/changes/delta_spec.md`: this section.
- Every validator that reads `validate-all.cjs` or `cached-runner.cjs` is re-run before `validate-all`: `val-projectos-memory-exit-proof1a` (EP-9 pins itself last), `val-projectos-resume1a`, `val-projectos-connector-contract1a`, `val-projectos-port-computer1a`, `val-projectos-skills-adopt1a` (slow, background), `val-projectos-kernel-followup1a`.

## PROTECTED (do not touch)

Everything in `00_Baseline_State.md` section 4. In particular: `loop/workers.ts` (grants, `roleBindingProblems`, `committedExecutionProblems`), `loop/adapters/*` and `loop/scratchCheckout.ts` / `writeScope.ts` (a defect found by the proof becomes its own plan phase), the runner, `gatekeeperConfig.ts`, the broker and credential router, closure authority and the owner floor, the tenant and action registries, `projectos/security/installation-project-allowlist.json` on every branch except the throwaway one, every existing authority record, and `.projectops/project-config.json` of ProjectOS itself (the swap edits the AGENCY's config, on agency branches only). No worker is granted a `.git*` file or a `.projectops` governance record by this phase (`writePaths` is checked with `writePathGrants`).

## Rules (each becomes a validator rule with named mutations)

1. **SP-1** Every evidence file is covered by a committed manifest of sha256, and a changed, added or missing file fails.
2. **SP-2** Both runs used one runtime that differs from the plan head only by the temporary allowlist file, one pinned phase text, one source tree outside `.projectops/`, and a committed config that differs only in `execution`, `planMemory` and `planSources`.
3. **SP-3** Config A and config B are exactly the pinned worker pairs (Claude implements and Codex reviews; `codex-implementer-cli` implements through an absolute `codex.exe` with record grants only and Claude reviews with read grants only), and each run was one bare `continue --execute` from its own process with nothing relayed.
4. **SP-4** Each closed run's reviewer record shows a reviewer of a different provider and kind than the implementer, an APPROVE with no findings, every requested review performed, and a hash bound to the evidence.
5. **SP-5** Each closed run changed `site/colophon.txt` and otherwise only the loop's own records, the file holds exactly the four requested lines, and the effects record is the six closed fields all false.
6. **SP-6** Each run claimed closed passed both validator copies, got an independent APPROVE, an approved gatekeeper decision and a closure decision from the provider answer through the broker, stopped for the owner only at the loop's own handover, and ended with the phase closed and exit zero.
7. **SP-7** The metered broker calls in each run's ledger are exactly the calls its log printed at the logged cost, each run is under 1,500,000 micro-USD and all attempts together are under 3,000,000, and Codex and Claude spend is stated as unmetered.
8. **SP-8** Every attempt is declared in `setup.json`, has its folder and an outcome that matches what its log shows, is named in the notes, and a refusal can be recorded and never hidden: a closed claim over a refused log fails, and a run with no closed config B attempt is NOT PROVEN, not green.
9. **SP-9** The notes say no product code, no model call and that the proof does not lift D4, this validator only reads files through `fs`, `path` and `crypto`, and it is registered once, before `val-projectos-memory-stores1a`, with a comment line, identically in both runners.

## Plan, tasks, risk (trimmed)

Constitution check: no PROTECTED file edited beyond the two registration lists; no new table, money rule or login change. The approval gate applies: provider spend, a secrets-handling receipt (credential read by the broker for this proof's gatekeeper and closure questions), and a second write-capable provider run live.

**Reviews:** ECC `security-reviewer` mandatory and independent (the proof exercises a write-capable provider and a credential-reading broker); Agency `application-security-engineer` or `platform` route additive for the runbook and the scratch-checkout assumptions; one recheck at most. Brief every reviewer with: reads by absolute path stay open (D4), the validator proves what was recorded, not what the workers read.

- [ ] T001 Commit this delta section alone; owner approves in Plan Mode (spend, receipt, the agency phase text).
- [ ] T002 Preconditions P1 to P9 of the runbook; the throwaway runtime worktree and its allowlist commit; the localhost remote up by PID; `BASE`; branch `s4proof-a` and its dry run.
- [ ] T003 Run A (about $0.007 metered). Collect. Gate: A is closed.
- [ ] T004 Branch `s4proof-b`, the swap commit, its dry run, Run B1. Collect. A refusal is recorded as it is.
- [ ] T005 Validator tuned against the real evidence (the draft's mutation list was never run), registered, passing, plus the neighbour validators.
- [ ] T006 Finish doc stating plainly what was and was not proved; reviews; fix round; one recheck; tick the plan; owner-direct close.

**Residuals to state, not hide:** reads by absolute path stay open under D4 (the Codex implementer can read anything the owner's user can read); the Codex implementer had never run live before this phase; Claude had never reviewed live through this adapter; `providerDistinct` is by worker kind; the evidence is copied by the lead from the agency checkout and the installation state, and a person who re-seals the manifest, notes and records consistently passes every rule; the proof shows what was recorded, not that a worker read or used the brief or the stored context; Codex and Claude spend is unmetered.

**Not in this phase:** any fix to a defect the live run finds (its own plan phase); lifting D4; a no-resume or no-swap control run; the provider broker wiring (4.2 beyond the registry); the Rust `session_digest` follow-up.

# Plan v1.44 — PROJECTOS-WORKER-RECORDS-SCRATCH-COMMIT1A (and PROJECTOS-HOST-REQUEST-STORE-SEAL1A, separate phase)

**Status:** approved by the owner in Plan Mode style questions, 2026-11-18, section committed alone before any code. Answers (verbatim option labels): "Approve as drafted (Recommended)" (the TypeScript fix: the exact instruction text, the two PROTECTED-listed files, fail closed on a refused scratch commit, no real sha in the commit message); "Separate phase, same amendment (Recommended)" (the Rust seal); "Yes, record v1.44 (Recommended)" (the plan amendment); "No, let the re-run answer it (Recommended)" (no live Codex probe, so T008 is skipped). The re-run attempt ids and a fresh secrets-handling receipt per attempt need the owner's words again at that time (approval 8).
Owner decisions this rests on (2026-11-18, verbatim intent, relayed by the lead): fix BOTH the shared worker instruction wording AND give the scratch checkout one initial commit; ALSO seal `RequestAdmissionStore::session_digest`; then re-run the exit proof (A and B). The amendment is a standing ask-first rule.

**Why:** the Stage 4 live exit proof (`docs/finish/PROJECTOS-STAGE4-EXIT-PROOF1A.md`) stopped config B at `CORRECTION_EXHAUSTED`. The Codex worker wrote two unresolved findings about the LOOP's business: F1 MEDIUM "Independent code review remains outstanding" and F2 LOW "The checkout has no readable Git HEAD". `outcome.ts` `correctableFindings` sends every unresolved MEDIUM or LOW back to the worker; a worker cannot resolve either, so the loop re-ran it three times and stopped before the independent reviewer ran. The Claude worker in config A wrote one resolved finding and no such caveat. Both get the same sentence; the sentence never says what a finding is, and the scratch checkout (by design) has no commit.

## Existing code found (B1)

| What | Where | Consequence |
|---|---|---|
| The ONE shared instruction text: `RECORDS_CLAUSE` (the records shape) and `CHECKS_CLAUSE` (who runs checks), both appended by `pointerInstruction` and `correctionInstruction` | `projectos/agent/src/loop/adapters/claudeCodeCli.ts:58-64, 81-85, 120-146` | The new sentences go in this one file. Both builders already include `RECORDS_CLAUSE`, so one appended constant reaches both. |
| The Codex implementer receives the builders by injection (`InstructionBuilders`) and wires them in `BUILT_IN_ADAPTERS`; it builds NO sentence of its own | `adapters/codexImplementer.ts:293-297, 428-430`; `claudeCodeCli.ts:327` | The same text reaches both adapters with no change to `codexImplementer.ts`. |
| The loop: an unresolved LOW or MEDIUM is "work"; CRITICAL or HIGH stops; 3 corrections then `CORRECTION_EXHAUSTED` | `loop/outcome.ts:137-151, 275-300` (`MAX_CORRECTION_ATTEMPTS` 3 at line 24) | NOT changed. No gate is loosened; only what a worker is told to write changes. |
| An implementer's `reviews` list credits ONLY self-reviews; an independent review is credited only from the reviewer record the loop wrote (D11) | `loop/reviewRoles.ts:33-42, 230-240`; `runner.ts:2179-2185, 2210-2229` | A worker that names the independent review in `reviews` credits nothing; telling it not to is safe. |
| The scratch checkout: files git lists, minus `.git*` and agent control paths, then `git init -q --template=` and nothing else; `manifestOf` skips the scratch's own top-level `.git`; "nothing in it is ever run again" | `loop/scratchCheckout.ts:9-13, 224, 624-658` (init at 652-653) | One commit is added right after the init, inside the same export. The manifest, copy-back and real-root snapshot never read the scratch `.git`, so they are unaffected. |
| The isolated git environment: system and user config = null device, system attributes off, hooks path = null device (every git call), a fixed identity, `LC_ALL=C`; plus the shared runner adds `core.fsmonitor=false`, `core.useReplaceRefs=false`, `protocol.allow=never` and neutralises every filter driver | `system.ts:113-161, 582-589`; `loop/writeScope.ts:160-167` | The commit is made through `isolatedGitRunner(sys, scratchRoot)`: no second isolation path (WI-25 pins that). |
| `.gitattributes`, `.gitignore` and every `.git*` path are agent control paths and never copied | `writeScope.ts:54, 86-90`; `scratchCheckout.ts:471` | The scratch has no attributes or ignore file, so the commit cannot run a filter or convert line endings by attribute. |
| Validators and tests pin the touched text | see MODIFIED | The write list below is complete; no new validator is added, so no edit to the protected `validate-all.cjs` / `cached-runner.cjs`. |
| The earlier scratch phase already named this as the fallback: "If Codex insists on a trusted repository with history, the scratch would need an initial commit (not built)" | `docs/finish/PROJECTOS-WORKER-SCRATCH-CHECKOUT1A.md` residual 1 | The commit is the planned fix, not a new design. |

## ADDED

- `FINDINGS_CLAUSE` (a module constant, no code path) in `claudeCodeCli.ts`: the new shared sentences (exact text below).
- A private helper `commitScratchBaseline(run, root)` in `scratchCheckout.ts` that makes the one commit, plus its refusal reason.
- Tests, validator rules WI-33 and WI-34 with named mutations (in the EXISTING validator), a finish doc.

### The exact new instruction text (to approve)

Appended at the END of `RECORDS_CLAUSE`, as one constant `FINDINGS_CLAUSE` defined above it (so the pinned fragments before it do not move):

> A finding is a defect in your OWN work: write down every real defect you find, at its true severity, and mark it resolved only when you have fixed it in this run. The independent code review, the required checks and validators, and the closing of the phase are ProjectOS's own steps and happen after you finish; that they have not happened yet, or that you did not run them, is not a finding. The checkout you work in may have no Git history, or a Git baseline that is not the brief's `repository.head`; ProjectOS prepared it that way, so that is not a finding either, and you need not verify the baseline against it. In `reviews` name only reviews you yourself performed, never the independent review. Write the findings record from what is true now, not by keeping an entry that is not a defect in your own work. If you found no defect, write an empty `findings` list.

It weakens nothing: it still demands every real defect at true severity; the independent review, checks and closure stay with the loop; `decideContinuation` and `creditedReviews` are untouched. It tells the worker to hide nothing. It carries no brief, phase, record or worker data (a constant). It contains none of the words the credential heuristics look for.

## MODIFIED (exact files, and why each change is the smallest possible)

1. `projectos/agent/src/loop/adapters/claudeCodeCli.ts` (PROTECTED per the v1.43 delta: `loop/adapters/*`): add `FINDINGS_CLAUSE`; change `RECORDS_CLAUSE` to end with `+ FINDINGS_CLAUSE`. Nothing else: not the builders, not the registry, not the pinned correction sentence.
2. `projectos/agent/src/loop/scratchCheckout.ts` (PROTECTED per the v1.43 delta): after the unchanged `git init` line (and its unchanged refusal line) in `exportScratch`, obtain `isolatedGitRunner(sys, root)` and run `add` then `commit`; any failure is `fail('git could not record the scratch baseline commit')`, so no worker starts and the directory is removed by the existing `fail` cleanup. Update the header comment ("Nothing is committed in it"). No other function changes.
   The two git calls (after `-c` overrides placed before the verb, none containing the text `core.fsmonitor`, which WI-25 forbids in this file):
   - `add --all --force -- .` with `-c core.autocrlf=false -c core.safecrlf=false -c core.attributesFile=<null device> -c core.excludesFile=<null device>`;
   - `commit -q --no-verify --no-gpg-sign --allow-empty -m <fixed message>` with `-c commit.gpgSign=false -c gc.auto=0 -c gc.autoDetach=false -c maintenance.auto=false`.
   Fixed message, no data from the repository or the worker: `ProjectOS scratch baseline: the working tree of the governed checkout as exported for one worker run. This is not a commit of the governed repository.`
   Identity: the isolated environment's fixed identity (`ProjectOS local candidate`, `local-candidate@projectos.invalid`, `system.ts:123-126`) is used as it is; nothing is set.
3. Tests (all under `projectos/agent/test/`): `scratchCheckout.test.ts` (rule 2 test: its last two lines, which assert `status` is non-empty and `rev-parse HEAD` throws, are the pinned "no commit" behaviour and move to the opposite; new tests S1-S8), `codexImplementerScratch.test.ts` (S9), `codexImplementerAdapter.test.ts` (W7), `loopBrief.test.ts` and `loopWorkers.test.ts` (W1-W6, W9), `loopBriefContext.test.ts` (unchanged unless a clause is placed differently; it only calls the builders).
4. `projectos/validators/val-projectos-worker-codex-implementer1a.cjs`: add WI-33 (instruction clause) and WI-34 (scratch commit) with named mutations, and TESTS needles for each new test. Existing pins stay: `PIN.scInit`, `PIN.scInitRefused`, `PIN.wired` are untouched; the one comment-sensitive pin (WI-25 `/core\.fsmonitor/` absent from `scratchCheckout.ts`) is kept true.
5. Grant only, expected UNTOUCHED (they read `claudeCodeCli.ts` and I found no pin on the changed region; they are in `writePaths` so a pin I could not see does not force a fourth plan amendment; the finish doc reports any that were used): `val-projectos-context-manager1a.cjs`, `val-projectos-kernel-followup1a.cjs`, `val-projectos-kernel-role-review1a.cjs`, `val-projectos-worker-lifecycle-bounded1a.cjs`.
6. `docs/06_Plan.md` (tick, date, commit, evidence), `docs/changes/delta_spec.md` (this section), `docs/finish/` (finish doc).
7. The plan source (lead edit, by `plan draft` -> decide -> activate): this phase is added; `PROJECTOS-STAGE4-EXIT-PROOF1A.dependsOn` gains `PROJECTOS-WORKER-RECORDS-SCRATCH-COMMIT1A`; `PROJECTOS-HOST-REQUEST-STORE-SEAL1A` is added (below). Run the throwaway `writePathGrants` check on every phase before activating.

## PROTECTED (do not touch)

`00_Baseline_State.md` section 4 in full. In particular `loop/workers.ts`, `verification.ts`, `pinnedValidators.ts`, `candidateIdentity.ts`, `localCandidateCommit.ts`, `loop/outcome.ts` and `loop/reviewRoles.ts` (no gate moves), `loop/runner.ts`, `loop/writeScope.ts` (the shared runner is reused, not edited), `adapters/codexImplementer.ts` and `adapters/codexCli.ts` (the same text reaches Codex through the injected builders), `system.ts`, `commands/run.ts`, `validate-all.cjs`, `speed/cached-runner.cjs` (no new validator), the broker and credential router, closure authority and the owner floor, the tenant and action registries, every existing authority record, `projectos/host/**` (a separate phase), and `.projectops/**` governance records. No worker is granted a `.git*` file or a `.projectops` governance record by this phase.

## Rules (each is one plain sentence and becomes a test)

Wording
1. Both worker instructions, the start sentence and the correction sentence, contain the same findings clause.
2. The clause says a finding is a defect in the worker's own work and that every real defect is written at its true severity and marked resolved only when fixed.
3. The clause says the independent code review, the checks and validators, and the closing of the phase are ProjectOS's own steps and are not findings.
4. The clause says a missing Git history, or a Git baseline that differs from the brief's `repository.head`, is not a finding.
5. The clause says `reviews` names only reviews the worker itself performed and never the independent review.
6. The clause is a constant: two different brief paths yield instructions that are identical apart from the path, and neither carries a phase, brief or record field.
7. The Codex implementer's prompt, on a start and on a correction, contains the same clause.
8. No gate moves: an unresolved MEDIUM or LOW finding is still sent back, an unresolved CRITICAL or HIGH still stops, and an implementer's `reviews` still credits no independent review.
9. Every fragment the existing tests and validators pin (the checks clause, the effects shape, "at the TOP LEVEL of that record", the correction's pointer to the reviewer record) is still present.

Scratch commit
10. The scratch repository has exactly one commit, and its tree holds exactly the files the export copied and no other.
11. Every blob in that commit equals the raw bytes of the exported file, including a CRLF file and a binary file, whatever the machine's git configuration.
12. The commit runs no hook, no filter, no signing program, and reads no system, user or global configuration, excludes file or attributes file.
13. Right after the open, `git status` in the scratch reports nothing changed and `git rev-parse HEAD` resolves.
14. A failed add or a failed commit refuses the open with a fixed reason, starts no worker and leaves no directory behind.
15. The commit message and identity are fixed text and carry nothing from the real repository or the worker.
16. The scratch's own `.git`, including a commit the worker makes there, is never compared or copied back, and the real checkout's HEAD, index, refs and status are identical before and after the open.
17. A worker in the scratch can read `HEAD` and `git diff` shows exactly its own edit.
18. The validator pins rules 1 to 17 with named mutations, each counted killed only when its own rule fires.

## Tasks (tests first; each ticks `06_Plan.md` with date, commit and one line of evidence)

- [ ] T001 RED, scratch: new real-git tests S1-S8 in `scratchCheckout.test.ts` (rules 10-16), including a hostile environment (a temporary `USERPROFILE` holding a global config with `core.autocrlf=true`, `commit.gpgsign=true` with a program that writes a marker file, a global excludes file and a global attributes file; a real-repo hook that writes a marker) and the two failure cases (a `System` whose `exec` fails for `add`, then for `commit`). Move the two "no commit" assertions. Run: they fail. (`vitest run test/scratchCheckout.test.ts` only.)
- [ ] T002 RED, adapter: S9 in `codexImplementerScratch.test.ts` (Codex played by a function that runs real `git rev-parse HEAD` and `git diff --name-only` in its cwd) and W7 in `codexImplementerAdapter.test.ts`.
- [ ] T003 RED, wording: W1-W6, W9 in `loopBrief.test.ts` / `loopWorkers.test.ts`.
- [ ] T004 GREEN, `scratchCheckout.ts`: the commit (rules 10-16). Run the three scratch test files.
- [ ] T005 GREEN, `claudeCodeCli.ts`: `FINDINGS_CLAUSE` (rules 1-7, 9). Run the wording tests plus `loopBriefContext`, `workerRoleSwap`, `loopOutcome` (rule 8, unchanged tests).
- [ ] T006 Validator: WI-33, WI-34, TESTS needles, named mutations (each killed only by its rule); the four neighbour validators; `validate-no-secrets`; `tsc -p tsconfig.json --noEmit`; the agent suite once.
- [ ] T007 Independent review (ECC `security-reviewer`, mandatory; brief it: reads by absolute path stay open (D4); the worker owns the scratch `.git`; no gate moved), fix round, one recheck; finish doc; tick the plan.
- [ ] T008 Owner-gated live probe, ONLY IF the owner says yes (a live Codex call on the owner's login, no ProjectOS metering): resolve whether F2 was "no commit" or "dubious ownership" (FINDINGS U1). Skip if the owner prefers to let the re-run answer it.
- [ ] T009 (separate phase `PROJECTOS-HOST-REQUEST-STORE-SEAL1A`, below.)
- [ ] T010 The re-run (plan section 6 of `FINDINGS.md`): refresh the runtime, then A3 and B2 on branches from BASE2, each one bare `continue --execute`. Part of `PROJECTOS-STAGE4-EXIT-PROOF1A`, not of this phase.

## Risks (stated, not hidden)

1. **R1 the real cause of F2 may be Git's ownership check, not the missing commit.** `codexCli.ts:70` runs Codex with `windows.sandbox="elevated"`; if that sandbox runs commands as another Windows user, `git` in a scratch the owner's user created can fail with "dubious ownership", and the worker would report "no readable HEAD" either way. The commit would then not fix F2; the wording sentence still stops the worker from recording it as a finding. Unverified; T008 or the re-run answers it. The loop never relies on the worker's git.
2. **R2 the scratch HEAD is not the brief's `repository.head`.** A worker comparing them could write a new finding. The clause (rule 4) says so; the commit message says the commit is not the governed repository's. The real sha is deliberately NOT put in the message (a worker could chase it; `git show <sha>` fails in a scratch).
3. **R3 a worker may still record some other caveat** (for example "validate-site was not run by me") with `resolved:false`. Claude's A2 wrote exactly that with `resolved:true`. The clause tells it to write only defects; a residual is possible and is a result, not a hidden failure.
4. **R4 cost on a large checkout.** `git add` hashes and zlib-compresses every exported file (bounded at 100,000 files and 1 GiB by the export) and writes loose objects: roughly the size of the tree again on disk, and time that grows with file count (not measured). The agency tree (271 files, 1.6 MiB) is negligible. `gc.auto=0`, `gc.autoDetach=false` and `maintenance.auto=false` stop git from starting a detached background gc that could outlive the run and lock the directory the cleanup must remove.
5. **R5 fail closed on a refused commit** turns a git hiccup (an antivirus lock) into a refused open instead of a degraded run. Chosen on purpose: a silent no-commit run would bring F2 back unseen.
6. **R6 the identity** reuses the "local candidate" identity of the isolated environment; the commit is in a throwaway repository nothing reads again, and the message says what it is.

## Owner approvals needed (ask before the plan is amended)

1. Edit two files the v1.43 delta lists as PROTECTED (`loop/adapters/claudeCodeCli.ts`, `loop/scratchCheckout.ts`): the smallest changes above. (Neither is in Baseline section 4 by name; `loop/adapters/*` and `scratchCheckout.ts` are in the v1.43 delta's PROTECTED list.)
2. The exact instruction text above, since it changes what both providers are told.
3. Fail closed when the scratch commit cannot be made (rule 14), rather than running without one.
4. No real sha in the commit message (R2).
5. Plan amendment v1.44: add `PROJECTOS-WORKER-RECORDS-SCRATCH-COMMIT1A` and `PROJECTOS-HOST-REQUEST-STORE-SEAL1A`; add the first to `PROJECTOS-STAGE4-EXIT-PROOF1A.dependsOn`.
6. The Rust seal as its own phase (below), including the one public-API change in the PROTECTED host: `RequestAdmissionStore` loses the digest-returning method and gains a yes/no one.
7. Optional: the T008 live Codex probe (a provider call on the owner's login, nothing metered by ProjectOS).
8. The re-run (T010): new attempts A3 and B2, a fresh secrets-handling receipt per attempt, the same caps ($1.50 per run, $3.00 in total; $0.02 already spent), and a rebuilt throwaway runtime. Ask for the words again at that time; do not reuse the 2026-11-18 words for new attempt ids without the owner saying so.

---

# PROJECTOS-HOST-REQUEST-STORE-SEAL1A (the Rust follow-up, its own phase in the same amendment)

**Why separate:** a PROTECTED security-boundary file (`projectos/host/**`), a different toolchain (cargo 1.96.1) and reviewer (ECC `security-reviewer`, rust-reviewer), a public-API change to a sealed trait, and zero coupling to the TypeScript runtime the exit proof re-runs. It can be built in parallel in its own worktree and merged or deferred without touching the re-run.

**Existing code found.** `AdmittedRequest::session_digest` (line 693) and `BoundIpcSession::session_digest` (line 312) are already `pub(crate)` (`PROJECTOS-HOST-SESSION-DIGEST-SEAL1A`). The trait `RequestAdmissionStore` (declared line 498, supertrait `sealed::Sealed`) still declares `fn session_digest(&self) -> [u8; 32];` (line 500), implemented at line 571 and called once, at line 749 in `admit_request`. A trait method has no visibility, so the digest of a store is readable by any downstream crate through the trait. No caller outside `ipc_session.rs` was found in `projectos/host` or `control-center`; `windows-local-ipc` uses the trait only as `&mut dyn RequestAdmissionStore` (`host_composition.rs:1142, 1208`).

**Options.** (a) Put the method on the private `sealed::Sealed` supertrait: rejected, `val-cd-b4-ipc-session-authority1a` pins `mod sealed { pub trait Sealed {} }` as empty (line 157), and a method on a supertrait stays callable through a generic bound (not compiled; unverified). (b) Make `admit_request` take the concrete in-memory store: rejected, it removes the trait the durable store is meant to implement and breaks `&mut dyn RequestAdmissionStore`. (c) Replace the value-returning method by a predicate. Chosen.

**MODIFIED.** `projectos/host/core/src/ipc_session.rs` only: the trait declaration (lines 499-500) becomes `fn is_bound_to(&self, session: &BoundIpcSession) -> bool;` with a doc line; the impl (571-573) becomes `self.session_digest == session.session_digest()` (the crate-private getter, in scope inside the crate); line 749 becomes `if !store.is_bound_to(self) { return Err(StoreNotBoundToSession) }`; the compile-fail doctest (lines 478-488) implements `is_bound_to` instead, so it still fails because of the seal and not because a method is missing; one new `compile_fail` doctest proving a downstream generic `s.session_digest()` and a concrete `store.session_digest()` do not compile; one new positive doctest. Also `projectos/host/core/tests/ipc_session_authority.rs`: one test that a store is bound to its own session and not to another. Also `projectos/validators/val-cd-b4-sealed-expected-window-facts1a.cjs`: two NEGATIVES (a generic and a concrete read of a store's digest) beside `neg_ipc_session_digest`. Re-run, not edited: `val-cd-b4-ipc-session-authority1a`, `val-cd-b4-production-ipc-provider1a`, `val-cd-b4-runtime-ipc-permit-integration1a`, `val-cd-b4-owner-presence-integration1a`, `val-cd-b4-provider-authority-seam1a`.

**PROTECTED.** Everything else under `projectos/host`; no service install, start, ACL or registry change; `host_composition.rs` and every other file in `windows-local-ipc` unless a compile error forces a one-line change, in which case the phase STOPS and reports.

**Rules.**
1. No public item of host core returns a store's session digest.
2. A store answers only whether it is bound to a given session, and a store from another session is still refused with `StoreNotBoundToSession`.
3. `RequestAdmissionStore` is still sealed (a downstream type cannot implement it) and still object-safe (`&mut dyn RequestAdmissionStore` compiles in `windows-local-ipc`).
4. `session_digest` stays `pub(crate)` on `BoundIpcSession` and `AdmittedRequest`.

**Verify (toolchain 1.96.1 from `rust-toolchain.toml`).** RED first: the new doctest and test fail or do not compile before the change. Then `cargo test --offline --features test-fixtures` and `cargo test --offline --doc` in `projectos/host/core`; `cargo test --offline` in `projectos/host/windows-local-ipc` (a compile break there means stop); a build of `projectos/host/service-host` if it builds on this machine; the five validators above plus `val-cd-b4-sealed-expected-window-facts1a`; then one `validate-all`. Review: ECC `security-reviewer` mandatory and independent; the builder is never the sole reviewer.
