# ProjectOS V3.2 — AI Provider Independence Amendment

- **Document ID:** PROJECTOS-V3.2-AI-PROVIDER-INDEPENDENCE
- **Version:** 3.2 (versioned amendment; directional)
- **Owner:** Murad
- **Status:** APPROVED DIRECTIONAL AMENDMENT — PLANNED, NOT YET AUTHORISED FOR IMPLEMENTATION
- **Date:** 2026-07-30
- **Approved plan reference:** ProjectOS V3 Master Plan v1.0 (source commit `1aa36b9`) — immutable.
- **Crosswalk reference:** `docs/architecture/projectos-v3.1-crosswalk.md`.

> **WARNING — NOT A NEW PLAN VERSION.** This amendment records an owner-approved *directional* change to the
> roadmap. It does **not** replace, amend or version the approved ProjectOS V3 Master Plan v1.0, which
> remains **byte-unchanged and immutable** at v1.0 (`1aa36b9`). Historical numbered V3 phases 0–18 are
> **not renumbered**. Directional approval is **not** implementation authority; every phase below still
> requires its own owner/gatekeeper gate. No overall completion percentage is published.

---

## A. Product position

- **ProjectOS = the primary project-delivery and AI-governance environment.**
- **Claude, Codex and future AI providers = governed, replaceable workers.**
- **VS Code = an optional specialist editor, debugger and extension host — not a mandatory runtime
  dependency.**

ProjectOS must operate Claude, Codex and future AI providers **without a mandatory VS Code dependency**.

## B. Track D rename

- **From:** "Track D — Claude worker and project-session control."
- **To:** "Track D — AI provider, worker and project-session control."

Track D now covers a provider-neutral broker and multiple governed AI workers, not a single Claude worker.

## C. Phase 7 amendment — Project Session Launcher (`PROJECTOS-V3-PROJECT-SESSION-LAUNCHER1A`)

The Project Session Launcher must:
- resolve the project and governed worktree;
- launch or reconnect provider sessions **without VS Code**;
- support **Claude and Codex**;
- retain an **optional Open in VS Code**;
- preserve project and repository isolation.

## D. Phase 8 amendment — Claude Desktop Bridge (`PROJECTOS-V3-CLAUDE-DESKTOP-BRIDGE1A`)

`PROJECTOS-V3-CLAUDE-DESKTOP-BRIDGE1A` keeps its historical name but becomes the **Claude-specific
local-runtime adapter under the provider broker**. It is **not** the universal provider architecture.

## E. Phase 12 amendment — Control Centre integration (`PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A`)

The Control Centre must include: **AI Accounts**; provider connected state; provider session health;
implementer/reviewer selection; per-phase agent-role assignment; streamed task status;
pause/stop/revoke; and an **optional Open in VS Code**.

## F. Phase 13 amendment — Desktop E2E (`PROJECTOS-V3-DESKTOP-E2E-PROOF1A`)

Desktop E2E must prove: **Claude works without VS Code**; **Codex works without VS Code**; credentials
remain **provider-owned**; project and worktree isolation; ProjectOS governance and approvals; and
**optional** VS Code interoperability.

## G. Phase 16 amendment — PolyGo pilot (`PROJECTOS-V3-POLYGO-PILOT1A`)

The PolyGo pilot must use: **Claude as governed implementer**; **Codex as governed independent reviewer**;
ProjectOS as policy and evidence authority; and **VS Code as optional only**.

## H. Credential policy

- ProjectOS **must not read or import credentials from VS Code extensions**.
- Provider authentication remains **owned by the official provider runtime or the operating-system
  credential store**.
- ProjectOS receives only safe connection and capability state — never raw tokens, keys or secrets.

## I. IDE scope

- ProjectOS provides the governed delivery workspace.
- A **full VS Code replacement is explicitly outside the first-release scope**; ProjectOS does not claim to
  replace the full VS Code IDE or rebuild its extension ecosystem.

---

## J. New Track D subphases (not numbered replacements for V3 0–18)

**Minimum pre-PolyGo provider-independence slice:**
1. `PROJECTOS-AI-PROVIDER-ARCHITECTURE-PREFLIGHT1A`
2. `PROJECTOS-AI-PROVIDER-BROKER1A`
3. `PROJECTOS-CLAUDE-CODE-LOCAL-ADAPTER1A`
4. `PROJECTOS-CODEX-APP-SERVER-ADAPTER1A`
5. `PROJECTOS-AGENT-CREDENTIAL-CAPABILITY-GUARD1A`
6. `PROJECTOS-AI-ACCOUNTS-CONTROL-CENTRE1A`
7. `PROJECTOS-DUAL-AGENT-LOCAL-PROOF1A`

**Later expansion:**
8. `PROJECTOS-GENERIC-MCP-PROVIDER-ADAPTER1A`
9. `PROJECTOS-MULTI-AGENT-ORCHESTRATOR1A`
10. `PROJECTOS-AGENT-SPECIALIST-ROUTING1A`
11. `PROJECTOS-MULTI-PROVIDER-PORTABILITY-PROOF1A`

These are **Track D subphases**, not renumbered V3 phases.

## K. Dependency order

**Current security chain (first):**
1. Windows user-verification adapter preflight — `CD-B4-WINDOWS-USER-VERIFICATION-ADAPTER-PREFLIGHT1A`.
2. Windows adapter implementation.
3. owner-presence runtime/IPC composition.
4. bounded local C1 proof.
5. secure capability/credential foundation.

**Then minimum provider-independence slice:**
6. provider architecture preflight → 7. provider broker → 8. Claude local adapter → 9. Codex adapter →
10. credential/capability guard → 11. AI Accounts Control Centre → 12. **dual-agent local proof**.

**Then real-project adoption:**
13. PolyGo baseline → 14. PolyGo install and PLAN READY → 15. **PolyGo governed pilot** with Claude + Codex
and optional VS Code.

**Then expansion:**
16. generic MCP providers → 17. advanced multi-agent orchestration → 18. multi-project rollout →
19. reliability, release candidate and final closure.

**The Claude + Codex dual-agent proof (step 12) precedes the PolyGo pilot (step 15).**

**Current immediate technical next phase remains `CD-B4-WINDOWS-USER-VERIFICATION-ADAPTER-PREFLIGHT1A`.**
The provider work is **PLANNED and NOT YET AUTHORISED FOR IMPLEMENTATION**.

## L. Definition-of-complete amendments

**Project session complete when:** the selected project and repository are verified; a provider session
launches **without requiring VS Code**; Claude and Codex may be assigned governed roles; provider
credentials remain hidden; the correct project/worktree is enforced; VS Code may be opened **optionally**
against the same governed state.

**Real-project proof complete when:** PolyGo is selected through ProjectOS; Claude implements through
ProjectOS; Codex independently reviews through ProjectOS; ChatGPT remains gatekeeper; Murad retains owner
authority; VS Code is **not required** for normal phase delivery; optional VS Code use does not bypass
governance.

## M. Role model

- **Murad:** owner and final approver.
- **ChatGPT:** consultant, architecture reviewer, governance layer, gatekeeper and prompt author.
- **ProjectOS:** provider broker, policy enforcer, context loader, evidence collector and approval
  controller.
- **Claude:** default implementer and tester.
- **Codex:** default independent reviewer and alternative implementer.
- **Other AI:** optional governed specialist agents.

Agent roles are **configurable per phase**. No AI may self-approve, self-push protected work, activate
production, or close its own phase.

## N. Governance state

- Historical numbered V3 phases 0–18: unchanged, not renumbered.
- Numbered V3 phase closure: **15 of 19** (2026-08-08). OPEN: **12, 16, 17, 18**. V3 is **not** complete.
- Provider implementation: **NotAuthorised**.
- Programme/local `EXECUTION_READY = true` — ratified 2026-08-08 by `PROJECTOS-V3-EXECUTION-READY-RECORD1A`, **scoped exclusively to governed LOCAL/SYNTHETIC ProjectOS delivery**. It supersedes the v3.2-era record that this flag was **false**, which was correct when written.
- **Execution readiness does not authorise a provider.** It grants no live, production, credential or provider authority, and no C4 owner presence. Provider implementation stays **NotAuthorised** above; no provider adapter may be inferred from this flag. The Rust host/live `EXECUTION_READY` constants are a **different flag** and stay **false**.
- Installation authority: **NotAuthorised**.
- Approved plan version remains **1.0**; this amendment does not bump `planVersion` or
  `current-state.activePlanVersion`.
- **Change scope:** documentation and governance only — no product source, manifest or lockfile — and no overall completion percentage.
