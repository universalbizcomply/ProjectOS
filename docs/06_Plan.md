# 06 — Implementation Plan (living checklist)

**Target:** ProjectOS V4.0, "one platform, four product domains, one governed execution system,
strictly separated customer data and permissions". The owner's target architecture of 27 October
2026 is in `docs/vision/ProjectOS_V4_Target_Architecture.png`, with a summary in `01_PRD.md` §V4. It
is a **direction, not an implementation approval**. Each stage below still goes through
`plan draft → decide → activate`.

**Rules:**
- Work top to bottom.
- Tick a box only when its check passed.
- Update this file after every completed step: the date, the commit, and one line of evidence.
- Items marked **[OWNER]** are protected actions or scope decisions and wait for the owner.
- Items marked **[APPROVED: delta]** are covered by the approved `docs/changes/delta_spec.md`.
- Items marked **[SPIKE]** are read-only evaluations: $0, no install into the machine-wide
  environment, and they end in a written decision record (ADR).

## How this plan was optimised

1. **One kernel and no rebuild.** Today's ProjectOS already *is* most of V4's Governance & Security
   layer, and part of its Orchestration layer:
   - policy (write paths, owner-only actions);
   - approvals (gates, closure decisions);
   - secret broker (credential router, installation broker);
   - audit (git-versioned records);
   - per-operation emergency stop (`core/src/execution/controller.ts`);
   - the planning engine;
   - the phase work loop.

   V4 domains become **workflow packs on this kernel**. They never get their own identity, memory,
   approval or orchestration engine.
2. **Dependency order, not feature order.** Every domain needs four things first:
   - role-separated review (Stage 1);
   - a tenant boundary that the database enforces (Stage 2);
   - durable memory (Stage 3);
   - provider-independent workers (Stage 4).

   Building a domain before those means rebuilding it.
3. **The cheapest pilot first.** Business goes before Personal, because the agency project is already
   governed, and Business can run on drafts within today's owner floor. Phone goes last: it is a
   separate real-time plane with carriers, cost and regulation.
4. **Evaluate before build.** Hermes, OpenClaw, LiveKit and code-intelligence tools are $0 spikes
   that run in parallel with Stage 1. Only an ADR can promote one, as an adapter. There is never a
   second central orchestrator.
5. **Each stage ends in one live proof on a real pilot**, as plan v1.15 did. Stage exits are
   measurable.
6. **Cut or defer** what does not serve V4 yet:
   - UI token debt moves to Stage 6;
   - Forge, the signed installer and the dormant Host unattended-review route stay deferred;
   - billing and i18n wait for the first external customer.

**Critical path:** 0 → 1 → 2 → (3 ∥ 4) → 5 → 6 → 7 → 8. The spikes S1–S4 run alongside Stage 1.

**Capability backlog:** `docs/recon/V4_Capability_Recon.md` lists C1–C22, the "same or better"
capabilities to take from Hermes, OpenClaw and OpenBot / Grok Bot, each mapped to a stage below,
plus the patterns ProjectOS refuses to copy.

## What exists versus V4 (gap summary)

| V4 layer | Exists today | Main gap |
|---|---|---|
| Users & environments | One owner | Users, tenants, roles |
| Product domains | Develop (built and live-proven) | Business, Personal, Phone packs |
| Access | Windows desktop (Tauri), CLI; Supabase web satellite | Web portal, mobile approvals, voice, public API |
| Orchestration | Planning engine, phase loop, durable request replay, objective-to-plan authoring, evidence reports | Role-based provider broker, independent reviewer (D11), skills, context manager |
| Governance | Policy, approvals, secret broker, git audit, per-operation emergency stop | Tenant identity, a **hard** cost cap (today's reservation is not a bound), platform-wide stop |
| Execution | Claude worker, git and CI, installation broker | Headless multi-provider workers, isolated computers, tool gateway, voice, device bridge |
| Data & memory | Git JSON records (authority and audit ledger); Postgres satellites | Tenant-scoped operational store with enforced RLS, memory store, search index, object storage, backups |
| Cross-cutting | Watchdog and health | Multi-tenancy, privacy/GDPR, billing, i18n |

**Architecture decision carried forward:** git-versioned records stay the authority and audit ledger.
Postgres holds tenant operational data only, and never authority.

---

## Stage 0 — Close the V3 finish programme (plan v1.16, ACTIVE)

- [x] 0.1 Plan v1.16 (PROJECTOS-COMPLETION1A) drafted, decided and activated. 2026-10-28, `3448395`,
      PLANDEC-af4f9b82af55880c783a5ee5.
- [x] 0.2 **[APPROVED: delta]** Retire the temporary `seo-agency` entry from
      `projectos/security/installation-project-allowlist.json` and update validator AG-5 to match. A
      V4 tenant must be granted explicitly; it must not be a leftover proof entry. 2026-10-28,
      `737bccc`: AG-5 FAIL before the pin edit, PASS after; the reader refuses `seo-agency`; ECC
      SECURITY APPROVE; suites 2544/772 unchanged.
- [ ] 0.3 **[OWNER]** Key decision, which V4 now decouples from "completion". Either:
      - revoke the pasted key, store a new one through the hidden prompt and set a provider-side
        spend cap; **or**
      - keep the current key until Stage 1 ends.

      Every stage after this needs a gatekeeper key.
- [ ] 0.4 **[APPROVED: delta]** Agency `.projectops/gatekeeper.json` `enabled: false`. Only if 0.3
      revokes without a replacement.
- [x] 0.5 Completion record `docs/finish/PROJECTOS-COMPLETION1A.md`: "V3 finish programme complete;
      V4 baseline". Then owner-direct closure on the owner's word. 2026-10-28: record `ec652ee`,
      closed `41460c5`. Plan v1.16 is 9/9; validate-all 145/147 (the two known failures).

## Stage 1 — Kernel hardening (Develop is the reference domain)

Goal: the kernel is safe to share across domains. Independent reviewer: ECC security-reviewer. The
architecture ADR goes to `software-architect`.

- [x] 1.1 (2026-10-29, `d500f82`..`3eef861`: loop-dispatched independent reviewer, loop-written record bound
      to the candidate and a nonce; closure G4-9 bound by `reviewerSha256`; ECC SECURITY 2 rounds and ECC CODE
      APPROVE, 0 CRITICAL/HIGH open; validator 17 rules / 37 mutations) **[OWNER: scope]** D11, the role-based review. The implementer, reviewer and gatekeeper
      roles are bound to *different* providers or agents. An implementer can never author a reviewer
      or gatekeeper decision. The reviewer is recorded before the gatekeeper is asked. A plan with
      only a worker self-review cannot close.
- [x] 1.2 (2026-10-29, `f0efaec`..`2eff5e7`: per-phase $1.50 / per-day $2 / month $5 caps refused before
      dispatch, read from the committed config only; prices committed-only and validated; strict ledger;
      the Rust Host twin enforces both caps; ECC SECURITY 2 rounds, Rust review APPROVE WITH WARNINGS)
      A hard cost cap: a per-phase and per-day spend bound that refuses the call before it is made.
      (The "21.9× under" reservation was already fixed in `daa9c00`; the missing parts were the per-phase
      and per-day bounds and committed-only reading.)
- [x] 1.3 (2026-10-29, `d77f20a`..`f3690e4`: deny-by-default stop at every entry point incl. the Control Center;
      typed-confirmation owner lift; ECC SECURITY round + recheck, Agency IAM; 101 mutations) A platform-wide emergency stop: one owner command halts every loop, suspends delegations
      and refuses new operations. It states honestly that it cannot undo sends or payments already
      made.
- [x] 1.4 (2026-10-29, `aa1353b`: ADR-K1 revision 3.1; Agency software-architect review APPROVE
      after 3 rounds, 18/18 findings accepted; the ADR stays Proposed until the owner accepts it)
      Kernel contract ADR: the domain-neutral task envelope `{principal, tenant, domain, project,
      environment, action class, scope, expiry, idempotency key}`, and the six permission classes
      (read-only, local reversible, technical gate, business operation, protected, prohibited)
      mapped onto today's gates.
- [x] 1.5 (2026-10-29, `dd1c1f7`..`eb2bf8e`: 3 of 5 delivered; the closure-route halves of D3 and D9 are carried to
      the Stage 1 follow-up; ECC CODE APPROVE) Small truth fixes, in one batch:
      - the run loop's "STOPPED … closure is never continued through" wording;
      - the broker as a positive provenance class (D9);
      - `continue --dry-run` writes no briefs (D5);
      - machine-readable receipt scope (D3);
      - pin the clean-tree condition inside `closurePrepared`.
- [x] 1.6 (2026-10-29, `426bcbc`..`aefd3b0`: 153 registered, 3 retired with reasons, registry check; Node 24 and
      Rust 1.96.1 pinned; ECC CODE APPROVE) Register or retire the six unregistered validators. Add `engines` (Node 24) and
      `rust-toolchain.toml` (1.96.1).
- [ ] 1.7 **[OWNER]** Signed commits for the authority paths (`.projectops/authority`, `gates`,
      `plan-decisions`), so the audit ledger is tamper-evident.
- [ ] 1.8 Agency follow-up: close the residual `validate-site` bypasses, with the independent review
      declared in its plan.
- **Exit proof:** one Develop phase closes from one `continue`, where the reviewer's provider differs
  from the implementer's, and a deliberately low cap is shown to refuse a call.

**Parallel [SPIKE]s: DONE 2026-10-28, `60aab03` (`docs/adr/ADR-S1..S4`):**
- S1 Hermes: ADOPT (owner 2026-10-29: clone the code and adapt it; MIT notices kept). Was REFERENCE.
- S2 OpenClaw: ADOPT (owner 2026-10-29, as S1). Was REFERENCE.
- S3 SCIP + `cargo metadata`: ADAPTER, never authority, with a tree-sitter fallback. A live Windows
  probe is still needed.
- S4 LiveKit: ADAPTER, for Stage 8 only.

**Original spike list ($0):**
- S1 Hermes Agent: memory and skills as an adapter versus native.
- S2 OpenClaw: gateway and device nodes as an adapter only.
- S3 Code intelligence (symbols and dependency graph) for the Develop context manager.
- S4 LiveKit: the real-time voice plane.

Each spike ends in an ADR: adopt as adapter, reference only, or reject.

## Stage 2 — Identity, tenancy and the data boundary (the V4 §6 gate)

Goal: no domain ships to a second party until this passes. Independent reviewers (mandatory):
ECC database-reviewer and security-reviewer.

- [ ] 2.1 **[OWNER]** Supabase RLS. Replace `using(true)` on `public.projects` and `public.phases`
      with `auth.uid()`-bound owner and tenant policies, and close open sign-up. This is a production
      database mutation.
- [ ] 2.2 Principal model: tenant and domain come from the authenticated context. A tenant id in
      agent text is never authority.
- [ ] 2.3 Per-tenant credential references in the credential router. Personal and business secrets
      are never shared.
- [ ] 2.4 **[OWNER]** A Tauri CSP (currently `null`).
- **Exit proof:** two tenants on one machine (owner-personal and agency-business). A cross-tenant
  read is refused by the database **and** by the kernel, and both are tested.

## Stage 3 — Memory and context fabric (in parallel with Stage 4)

Goal: the continuity problem is solved. Six logical classes map onto existing stores first.

- [ ] 3.1 Programme and project memory = the existing `.projectops` plan memory. Execution memory =
      runs and checkpoints. Document and complete the existing stores; do not replace them.
- [ ] 3.2 Skills: versioned procedures that pass a validator before adoption.
- [ ] 3.3 Provenance and freshness: current source and approved decisions outrank recollection. A
      summary never overwrites a decision. Retention and deletion apply per class.
- [ ] 3.4 Context manager: authorised retrieval per task envelope (from 1.4). Uses the S1 and S3
      ADRs.
- **Exit proof:** a fresh session resumes a half-done phase with zero manual context relay.

## Stage 4 — Runtime and provider independence (in parallel with Stage 3)

- [ ] 4.1 Headless Claude and Codex workers, with no VS Code dependency (the V3.2 direction).
- [ ] 4.2 Provider broker by role, with a capability and cost registry. `WAITING_GATEKEEPER` is a
      truthful state, never an auto-approval.
- [ ] 4.3 Isolated execution: worktree → container or VM sandbox per task. Idempotency keys for every
      non-git side effect.
- **Exit proof:** the same phase runs with the implementer and reviewer providers swapped, and no
  code change.

## Stage 5 — ProjectOS Business pilot (one tenant: the agency)

- [ ] 5.1 Business workflow pack: enquiry triage, drafted replies, weekly reports. **Drafts only.**
      Sends and payments stay owner-gated; the constitution is unchanged.
- [ ] 5.2 Tool-gateway adapters to the existing CRM and booking systems (orchestrate, not replace).
- [ ] 5.3 **[OWNER: governance design]** A delegated-authority model for narrowly defined routine
      business operations. Separate design, separate approval.
- **Exit proof:** one week of agency operations drafted by AI workers. Every send was
  owner-approved, and the audit is complete.

## Stage 6 — Experience layer

- [ ] 6.1 Mobile approvals and notifications: approve a gate from the phone.
- [ ] 6.2 Web portal on the Stage 2 tenant boundary.
- [ ] 6.3 Control Center UI debt:
      - undefined CSS variables;
      - hard-coded colours moved onto tokens;
      - `.ocp-btn` dedupe and `os-primary` styling;
      - README view list.

      Plus an accessibility review.
- **Exit proof:** the owner approves a real gate from a phone.

## Stage 7 — ProjectOS Personal

- [ ] 7.1 Personal tenant: calendar, reminders and files through connectors, with privacy and
      consent controls.
- **Exit proof:** a personal agent cannot read the business tenant, and a business agent cannot read
  the personal one (tested both ways).

## Stage 8 — ProjectOS Phone

- [ ] 8.1 A separate real-time voice plane (per the S4 ADR).
- [ ] 8.2 **[OWNER]** Telephony provider and number provisioning (cost, recording consent).
- [ ] 8.3 Inbound business call handling first: answer, summarise, escalate. Outbound calls are
      owner-gated. The Android companion comes later; dedicated hardware is out of scope.
- **Exit proof:** a test number is answered, summarised and escalated.

## Deferred until the first external customer

Billing and subscriptions, i18n and multi-region, the GDPR data-processing agreement **[OWNER/legal]**,
Forge, the signed installer, and the Host unattended-review route.

## Log

- 2026-10-28: context architecture written (00 to 06, delta spec). No application code changed.
- 2026-10-28: plan v1.16 activated (`3448395`). This plan was re-sequenced toward the V4.0 target
  (owner direction: "This is what I want to achieve from this. Now optimise the plan."). The earlier
  Phase 1–4 items are folded into Stages 0, 1, 2 and 6.
- 2026-10-29: PROJECTOS-KERNEL-ROLE-REVIEW1A (D11) implemented, `d500f82`..`3eef861`. The owner approved the
  `commands/closure.ts` change ("go for it"). Owner action open: commit a `reviewerWorkerId` before the next
  loop run (`docs/finish/PROJECTOS-KERNEL-ROLE-REVIEW1A.md`).
- 2026-10-29: PROJECTOS-KERNEL-COST-CAP1A implemented, `f0efaec`..`2eff5e7`. Owner decisions: caps "Confirm",
  then "Raise to $1.50"; Host ledger "Update it now". Must close before the Host service starts: committed-bytes
  policy in the Host, and phase-label parity (`docs/finish/PROJECTOS-KERNEL-COST-CAP1A.md`).
- 2026-10-29: plan v1.18 activated (`e1e1e72`). PLATFORM-STOP1A, TRUTH1A and HYGIENE1A built in parallel worktrees,
  each with one combined review (owner: "Faster, keep safety"), stacked and verified together: agent 2729/2729,
  validate-all 151/153 (the 2 baseline failures). Carried to a Stage 1 follow-up: the closure-route halves of D3/D9,
  the registry-rule pin, the cached-runner resync and the validate-claude-worker inv50 repair.
- 2026-10-29: plan v1.19 (`841f38b`) added PROJECTOS-KERNEL-FOLLOWUP1A (owner: "Yes, add and do it"; reviewer
  "Codex CLI (OpenAI)"); v1.20 (`3c1c073`) repaired its writePaths. Delivered `3f5bdee`..`69062f3`: closure-route D9
  (broker class stamped, legacy unstamped waits fail closed) and D3 (funding line from the committed receipt);
  registry pin, cached-runner resync, validate-claude-worker repair; a read-only Codex CLI REVIEWER adapter. ECC
  SECURITY review + recheck, APPROVE WITH CHANGES, all required items fixed; HIGH 1 (reviewer can read the owner's
  Codex login) mitigated by tripwires, its residual and a live sandbox probe carried as EXIT-PROOF1A preconditions.
  Agent 2857/2857. Evidence: `docs/finish/PROJECTOS-KERNEL-FOLLOWUP1A.md`.
- 2026-10-29: plan v1.21 (`37af3b7`) added PROJECTOS-KERNEL-CODEX-LIVE1A from the EXIT-PROOF1A precondition probe: the Codex
  reviewer could run no command without a fixed Windows sandbox mode and misread its PowerShell wrapper. Fixed in
  `b350f2d`, `65c42d6` (fixed elevated mode as the one override; inner-command judging; fetch/decode tripwire). Live:
  writes blocked inside and outside the checkout, internet blocked, loopback open, profile readable (owner-accepted
  residual). ECC SECURITY APPROVE WITH CHANGES, all LOWs fixed. Evidence: `docs/finish/PROJECTOS-KERNEL-CODEX-LIVE1A.md`.
- 2026-10-30: plan v1.22 (`2f69d7e`) added PROJECTOS-KERNEL-PLAN-HISTORY1A: the agency plan v1.4 (exit-proof phase) was refused
  because D11 R5 re-judged three agency phases that closed before D11. R5 now skips a phase only when it is in the active
  approved plan, closed by its COMMITTED record (last step into closed) and still declaring the reviews the active plan
  approved (`e73c9f7`, `8e2be81`; owner: "Fix ProjectOS properly"). ECC SECURITY APPROVE WITH CHANGES, items fixed.
  Evidence: `docs/finish/PROJECTOS-KERNEL-PLAN-HISTORY1A.md`.
- 2026-10-30: plan v1.23 (`f3f2a9e`) added PROJECTOS-KERNEL-CODEX-UNC1A: the exit proof's first run had its Codex review
  refused; a traced re-run showed the only denial was the UNC tripwire reading the string `"\\nExpires` in a reviewer probe
  script as a network path. A UNC path now needs a host and a separator (`fd2fe55`). ECC SECURITY reviewed.
  Evidence: `docs/finish/PROJECTOS-KERNEL-CODEX-UNC1A.md`.
