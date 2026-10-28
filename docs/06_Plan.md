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
- [ ] 0.2 **[APPROVED: delta]** Retire the temporary `seo-agency` entry from
      `projectos/security/installation-project-allowlist.json` and update validator AG-5 to match. A
      V4 tenant must be granted explicitly; it must not be a leftover proof entry.
- [ ] 0.3 **[OWNER]** Key decision, which V4 now decouples from "completion". Either:
      - revoke the pasted key, store a new one through the hidden prompt and set a provider-side
        spend cap; **or**
      - keep the current key until Stage 1 ends.

      Every stage after this needs a gatekeeper key.
- [ ] 0.4 **[APPROVED: delta]** Agency `.projectops/gatekeeper.json` `enabled: false`. Only if 0.3
      revokes without a replacement.
- [ ] 0.5 Completion record `docs/finish/PROJECTOS-COMPLETION1A.md`: "V3 finish programme complete;
      V4 baseline". Then owner-direct closure on the owner's word.

## Stage 1 — Kernel hardening (Develop is the reference domain)

Goal: the kernel is safe to share across domains. Independent reviewer: ECC security-reviewer. The
architecture ADR goes to `software-architect`.

- [ ] 1.1 **[OWNER: scope]** D11, the role-based review. The implementer, reviewer and gatekeeper
      roles are bound to *different* providers or agents. An implementer can never author a reviewer
      or gatekeeper decision. The reviewer is recorded before the gatekeeper is asked. A plan with
      only a worker self-review cannot close.
- [ ] 1.2 A hard cost cap: a per-phase and per-day spend bound that refuses the call before it is
      made. Today's reservation is not a bound; it was 21.9× under.
- [ ] 1.3 A platform-wide emergency stop: one owner command halts every loop, suspends delegations
      and refuses new operations. It states honestly that it cannot undo sends or payments already
      made.
- [ ] 1.4 Kernel contract ADR: the domain-neutral task envelope `{principal, tenant, domain, project,
      environment, action class, scope, expiry, idempotency key}`, and the six permission classes
      (read-only, local reversible, technical gate, business operation, protected, prohibited)
      mapped onto today's gates.
- [ ] 1.5 Small truth fixes, in one batch:
      - the run loop's "STOPPED … closure is never continued through" wording;
      - the broker as a positive provenance class (D9);
      - `continue --dry-run` writes no briefs (D5);
      - machine-readable receipt scope (D3);
      - pin the clean-tree condition inside `closurePrepared`.
- [ ] 1.6 Register or retire the six unregistered validators. Add `engines` (Node 24) and
      `rust-toolchain.toml` (1.96.1).
- [ ] 1.7 **[OWNER]** Signed commits for the authority paths (`.projectops/authority`, `gates`,
      `plan-decisions`), so the audit ledger is tamper-evident.
- [ ] 1.8 Agency follow-up: close the residual `validate-site` bypasses, with the independent review
      declared in its plan.
- **Exit proof:** one Develop phase closes from one `continue`, where the reviewer's provider differs
  from the implementer's, and a deliberately low cap is shown to refuse a call.

**Parallel [SPIKE]s (start now, $0):**
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
