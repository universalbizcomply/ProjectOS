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
- [x] 0.3 (2026-10-29, owner: "Keep the current key". Stage 1 has since ended, so rotating it is the owner's
      act when convenient.) **[OWNER]** Key decision, which V4 now decouples from "completion". Either:
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
- [x] **Exit proof** (2026-10-30, `d068422`, closed `120a8b7`; agency `d6c50f5`: SEO-AGENCY-SITE-CHECK3A closed from one
  `continue` with zero owner acts, Claude implementing and Codex (OpenAI) reviewing, `providerDistinct: true`; the cap
  refused a call before it was made in run 1; four runs, three fix phases, $0.0076): one Develop phase closes from one
  `continue`, where the reviewer's provider differs from the implementer's, and a deliberately low cap is shown to
  refuse a call. **Stage 1 complete.**

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

- [x] 2.1 (2026-11-01, on the owner's "Yes, apply it now (Recommended)": 0001, 0002, membership and 0003 applied live;
      post-check passed; anon refused, owner sees 12 projects, a made-up account sees nothing; evidence in
      `docs/finish/PROJECTOS-TENANT-RLS1A.md`) **[OWNER]** Supabase RLS. Replace `using(true)` on `public.projects` and `public.phases`
      with `auth.uid()`-bound owner and tenant policies, and close open sign-up. This is a production
      database mutation.
- [x] 2.2 (2026-11-03, `967c7b86`, plan v1.35 32/35: the tenant is derived from the committed registry and a typed
      receipt, never from agent text, flags or environment; the owner typed the receipt for blob `8f7b7437…`; evidence in
      `docs/finish/PROJECTOS-TENANT-PRINCIPAL1A.md`) Principal model: tenant and domain come from the authenticated
      context. A tenant id in agent text is never authority.
- [x] 2.3 (2026-11-03, `967c7b86`, plan v1.35 33/35: release is asked of a kernel-issued run handle, and a tenant-class
      credential never crosses tenants; operation release fails closed until the owner commits and receipts a grant;
      evidence in `docs/finish/PROJECTOS-TENANT-CREDENTIALS1A.md`) Per-tenant credential references in the credential
      router. Personal and business secrets are never shared.
- [x] 2.4 (2026-11-02, `b29ac72e`, plan v1.33 29/35: the CSP was proved in a real WebView2 and the bundle scan runs in the
      build; evidence in `docs/finish/PROJECTOS-TENANT-CSP1A.md`) **[OWNER]** A Tauri CSP (currently `null`).
- [x] **Exit proof** (2026-11-03, `7e136b48`, plan v1.35 35/35: the database shows 174 assertions and 43 of 43 mutations
  failing, plus live read-only checks; the kernel shows 25 rule removals, 23 killed and 2 masked as declared; a post-merge
  check on the real installation passed the registry and receipt rules; evidence in
  `docs/finish/PROJECTOS-TENANT-EXIT-PROOF1A.md`) Two tenants on one machine (owner-personal and agency-business). A
  cross-tenant read is refused by the database **and** by the kernel, and both are tested. Also CONNECTOR-CONTRACT1A
  closed (`967c7b86`, 34/35): connector rules with zero live connectors.

## Stage 3 — Memory and context fabric (in parallel with Stage 4)

Goal: the continuity problem is solved. Six logical classes map onto existing stores first.

- [x] 3.1 Programme and project memory = the existing `.projectops` plan memory. Execution memory =
      runs and checkpoints. Document and complete the existing stores; do not replace them.
      **Done 2026-11-14** as PROJECTOS-MEMORY-STORES1A, closed owner-direct, subject `c4994542` (code `f07f6807`), persist `e3ba8008`;
      validator 19 rules (186 text and 82 behavioural mutations killed, plus MS-19), ECC SECURITY (1 HIGH, 6 MEDIUM) + recheck (1 new HIGH ReDoS)
      + final round + a stack fix (core browser-pure), re-verified by the lead; main receives the stack's merge commits by fast-forward.
      Ships unwired: the runner and session wiring and the six-class list confirmation are carried (finish doc).
- [x] 3.2 Skills: versioned procedures that pass a validator before adoption.
      **Done 2026-11-15** as PROJECTOS-SKILLS-ADOPT1A, closed owner-direct, subject `1edb76ca` (code `feda7a59`), persist `0bc7d9e1`;
      validator 24 rules, 234 named mutations killed; the kernel sets a skill origin, promotion needs the validator + a verifier-backed independent review + a hash pin,
      the loader reads committed pinned bytes only and shows a skill as fenced authority-none data; ECC SECURITY (4 MEDIUM) + fix round + ECC recheck (1 MEDIUM)
      + final round, re-verified by the lead. Ships with no production review verifier, so no skill loads yet (owner decision: what answers for the reviewer).
- [x] 3.3 Provenance and freshness: current source and approved decisions outrank recollection. A
      summary never overwrites a decision. Retention and deletion apply per class.
      **Done 2026-11-14** as PROJECTOS-MEMORY-PROVENANCE1A, closed owner-direct, subject `278f9b71` (code `dc5b3d12`), persist `69c85881`;
      validator 204 text and 125 behavioural mutations killed, ECC SECURITY (1 HIGH forged proof) + fix round + recheck (2 MEDIUM) + final round,
      re-verified by the lead; main receives the stack's merge commits by fast-forward. Ships unwired (owner verifier and call sites carried to Stage 4.1).
- [x] 3.4 Context manager: authorised retrieval per task envelope (from 1.4). Uses the S1 and S3
      ADRs.
      **Done 2026-11-15** as PROJECTOS-CONTEXT-MANAGER1A, closed owner-direct, subject `f0d253d9` (code `0a50a319`), persist `80abce0f`;
      validator 21 rules, 285 named mutations killed; the only protected edit is the `run.ts` import plus `runEnvelope: admittedRunEnvelopeOf(ctx)`;
      ECC SECURITY (1 HIGH ledger in the tree) + Agency multi-agent-systems-architect + fix round + ECC recheck + final round, re-verified by the lead;
      stack: core 4719, agent 4017, control-center 952, validate-all 175/176 (only the known Stage 4 carry). Taint enforcement, the PX-12 compaction
      label and the owner verifier carried to Stage 4.1 (finish doc).

**Port phases** (`docs/changes/delta_spec_V4_PORTS.md`, owner "Approved" 2026-11-01; in plan v1.31). Each goes through
the `docs/recon/V4_Port_Map.md` §4 gates and carries the credit in `docs/adr/ADR-P1-port-ownership-and-credit.md`.

- [x] 3.5 (2026-11-01, `e5940a4e`, credit validator passing; closed, nothing wired in) PROJECTOS-PORT-FOUNDATION1A: notices file, file header, credit validator, ADR-P1; older records
      lined up with ADOPT. Ports no upstream code.
- [x] 3.6 (2026-11-01, `2f759e87`, validator and suites passing; closed, not wired in) PROJECTOS-PORT-SEARCH1A: hybrid search and chunker for cited document and session search (C8, C10).
      OpenClaw. Serves 3.4.
- [x] 3.7 (2026-11-01, `06e83225`, validator and suites passing; closed, not wired in) PROJECTOS-PORT-MEMORY1A: capped memory store and threat scan; every write is a proposal (C8). Hermes,
      with oh-my-hermes rules. Serves 3.3.
- [x] 3.8 (2026-11-02, `cf457b67`, validator 440 mutations; closed, not wired in) PROJECTOS-PORT-SKILLS1A: skill linter, audit and frontmatter; promotion through a validator (C9). Hermes.
      Serves 3.2.
- [x] 3.9 (2026-11-02, `72a8ef3c`, validator 320 mutations; closed, not wired in) PROJECTOS-PORT-CONTEXT1A: per-agent context monitoring and compaction. Hermes. Serves 3.3 and 3.4.
- [x] 3.10 (2026-11-01, `06dc092d`, validator and suites passing; closed, not wired in) PROJECTOS-PORT-APPROVALS1A: approval core, taint tracking and "evidence before done" receipts. Rakazo,
      oh-my-hermes.
- **Exit proof:** a fresh session resumes a half-done phase with zero manual context relay.
  **Done 2026-11-15** as PROJECTOS-MEMORY-EXIT-PROOF1A, closed owner-direct, subject `62609743`, persist `99c3eec7`. LIVE on the agency pilot: the phase
  SEO-AGENCY-MEMORY-PROOF1A was killed after the worker wrote 1 of 3 files, then ONE fresh `continue --execute` (no session, no text) carried it to closed in 108 s
  (Codex APPROVE, gatekeeper, closure authority); the loop ledger shows the cut-off state and loop-observed dirty path shown as execution records ranked below the committed decision;
  metered broker spend 6,580 micro-USD of $1.50. Validator 9 rules, 276 named mutations killed over 26 manifest-pinned evidence files; ECC SECURITY + ECC CODE + fix round + recheck + final round.
  It proves what the worker was SHOWN, not that it read it; no no-resume control. Evidence: `docs/finish/PROJECTOS-MEMORY-EXIT-PROOF1A.md`.

## Stage 4 — Runtime and provider independence (in parallel with Stage 3)

- [ ] 4.1 Headless Claude and Codex workers, with no VS Code dependency (the V3.2 direction).
      **Partly done 2026-11-18**: PROJECTOS-WORKER-CODEX-IMPLEMENTER1A (4.1a) closed owner-direct, subject `5785b504`, persist `2466459d`: a Codex implementer kind, its write-scope check and the committed-config role swap; PROJECTOS-CONTEXT-CODEX1A (persist `7164bbaa`) points it at stored context. ECC SECURITY BLOCK on the first build, fix round, recheck, final round. **No live Codex implementer run yet**: that is the Stage 4 exit proof (phase 55).
- [ ] 4.2 Provider broker by role, with a capability and cost registry. `WAITING_GATEKEEPER` is a
      truthful state, never an auto-approval.
      **First slice done 2026-11-18**: PROJECTOS-PROVIDER-ROLES1A closed owner-direct, subject `5785b504`, persist `f482c58d`: a committed role registry and a read-only `roles` report, 141 named mutations; ECC APPROVE WITH CHANGES, two fix rounds, recheck APPROVE. Nothing consults the registry to choose a worker yet.
- [ ] 4.3 Isolated execution: worktree → container or VM sandbox per task. Idempotency keys for every
      non-git side effect.
      **4.3a done 2026-11-18**: PROJECTOS-WORKER-SCRATCH-CHECKOUT1A closed owner-direct, subject `5785b504`, persist `047d0352`: the Codex implementer runs in a scratch checkout and only granted paths are copied back; ECC BLOCK (8.3 short names), fix round, recheck, final round. Container or VM isolation and idempotency keys are not done; reads by absolute path stay open (D4).
      Also closed 2026-11-18 under Stage 4: PROJECTOS-MEMORY-OWNER-COMMANDS1A (persist `bcc35c5f`) and PROJECTOS-PROPOSAL-DOOR-WIRING1A (persist `ac56dbe1`), the Stage 3 carry-forwards; PROJECTOS-HOST-SESSION-DIGEST-SEAL1A (persist `bc6d5caa`), which clears the `val-cd-b4` failure carried since plan v1.34.
      Also closed 2026-11-19 under Stage 4 (plan v1.44, 56/57), the two fix phases from the live exit proof stop: PROJECTOS-HOST-REQUEST-STORE-SEAL1A (persist `1cc2a3b7`; the sealed `RequestAdmissionStore` trait no longer returns a session digest, ECC security and rust reviewers APPROVE) and PROJECTOS-WORKER-RECORDS-SCRATCH-COMMIT1A (persist `06cacfd3`; both providers are told what a finding is, the Codex scratch checkout gets one baseline commit, every scratch git call is bounded by 120 s; validator 223 named mutations killed, three reviews of the baseline, a fix round, one ECC recheck APPROVE WITH LOW). Subject `8715ec0f`; validate-all 183 registered, 183 PASS, 0 FAIL, 2 retired; agent 4687/4687. Neither fixes the exit proof by itself: PROJECTOS-STAGE4-EXIT-PROOF1A stays open until config B is re-run live.

**Port phases** (same delta). These enter a later plan once Stage 2 has settled what they build on. Anything
per-tenant, or that releases a credential or spends, waits for PRINCIPAL1A and CREDENTIALS1A.

- [x] 4.4 PORT-ROUTINES1A: routine floors of a 15-minute minimum, 20 enabled and auto-disable after 10 failures (C13).
      CopilotKit OpenBot. **Done 2026-11-14**, closed owner-direct, subject `e77c4acf` (code `460499df`), persist `12aad11b`; core 3523, validator 109 scenarios / 191 mutations killed, ECC SECURITY + one recheck + final round, floor bypass fixed.
- [x] 4.5 PORT-PROVIDERS1A: provider broker, retries, pricing, custom endpoints and local models (C11). OpenClaw,
      Hermes. Serves 4.2. **Done 2026-11-14**, closed owner-direct, subject `e77c4acf` (code `2f0acd52`), persist `ccf0942d`; validator 221 text / 89 behavioural mutations killed, ECC SECURITY + Agency api-platform-engineer + recheck, budget floor and single flight fixed.
- [x] 4.6 PORT-AGENTS1A: persistent agents, queues, delegation and same-tenant messages (C7, C12). OpenClaw, Hermes,
      our code. After 4.5. **Done 2026-11-14**, closed owner-direct, subject `ba1f7644` (code `4c9b9ec9`), persist `bcf5823c`; validator 157 scenarios / 132 behaviour and 65 text mutations killed, ECC SECURITY + Agency multi-agent-systems-architect + recheck + final round re-verified by the lead; main receives the stack's merge commits by fast-forward, not as rebased copies.
- [x] 4.7 PORT-COMPUTER1A: per-agent browser, computer use, exec approval binding and action policy (C14). OpenClaw,
      CopilotKit OpenBot. Serves 4.3, after 4.6. **Done 2026-11-14**, closed owner-direct, subject `ba1f7644` (code `6302b124`), persist `d3da77f3`; validator 345 scenarios / 306 behaviour and 120 text mutations killed, ECC SECURITY (3 HIGH) + Agency application-security-engineer (2 HIGH) + fix round + ECC recheck + final round re-verified by the lead; main receives the stack's merge commits by fast-forward, not as rebased copies. Registry rows for exec-command and computer-* are still an owner-gated change (every action reads P5 until then).
- [x] 4.8 PORT-RESEARCH1A: web search and cited research (C16). OpenClaw, Hermes. After 4.5. **Done 2026-11-14**, closed owner-direct, subject `ba1f7644` (code `e6bc2445`), persist `e4d98684`; validator 205 text / 165 behavioural mutations killed, ECC SECURITY + Agency application-security-engineer + recheck + final round re-verified by the lead; main receives the stack's merge commits by fast-forward, not as rebased copies.
- [x] 4.9 PORT-MCP1A: governed connectors on the connector contract (C15). OpenClaw, Hermes. **Done 2026-11-14**, closed owner-direct, subject `e77c4acf` (code `8f116942`), persist `b48d2d7b`; validator 281 text / 107 behavioural mutations killed, ECC SECURITY + Agency application-security-engineer + recheck, tenant agreement and spend bound fixed.
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
- 2026-10-30: plan v1.24 (`aef3d07`) added PROJECTOS-KERNEL-REVIEW-READONLY1A: the exit proof's second run had its Codex
  review refused again; traces showed the reviewer's own probe scripts trip the tripwires. The reviewer now reviews by
  reading, a refusal names its denials, and a MEDIUM-only rejection carries its findings (`434cbc1`). ECC SECURITY reviewed.
  Evidence: `docs/finish/PROJECTOS-KERNEL-REVIEW-READONLY1A.md`.
- 2026-10-30: plans v1.25-v1.27 (`a5d5b32`, `18055ac`, `9001de4`) added PROJECTOS-KERNEL-CORRECTION-PATHS1A: the exit proof's
  third run got a clean cross-provider REJECT that had no fix route. On the owner's "Claude fixes, re-review", a rejection now
  re-dispatches the implementer with the phase's approved write grant inside the 3-correction budget and is reviewed again;
  the protected rule BC-8n is reworded to state that one exception (owner: "Yes, reword it"; it supersedes BC-8n's earlier
  wording for this route only). The gatekeeper is told to name files by path (`9077c4a`). ECC SECURITY reviewed, one recheck.
  Evidence: `docs/finish/PROJECTOS-KERNEL-CORRECTION-PATHS1A.md`.
- 2026-10-30: **Stage 1 exit proof CLOSED** (PROJECTOS-KERNEL-EXIT-PROOF1A). Agency SEO-AGENCY-SITE-CHECK3A closed from ONE
  `continue` with zero owner acts (run 4, agency `d6c50f5`): Claude implemented, Codex (OpenAI) reviewed by reading and
  rejected twice, Claude corrected twice, Codex approved (`providerDistinct: true`), ChatGPT closed. Run 1 proved the cap
  refusal before any network call (`GKREQ-4bfc24adceb5683ac1d2a326`). It took four runs and three fix phases
  (CODEX-UNC1A, REVIEW-READONLY1A, CORRECTION-PATHS1A). Phase spend $0.0076. TEMPORARY seo-agency allowlist entry removed
  (`381acb1`). Evidence: `docs/finish/PROJECTOS-KERNEL-EXIT-PROOF1A.md`.
- 2026-11-01: **Stage 2 delta approved** by the owner in Plan Mode (`docs/changes/delta_spec.md` revision 2; six decisions
  recorded there; v1.17 delta archived). Audit found live Supabase sign-up open (`disable_signup=false`), and no envelope in
  code. Reviewed before any code: `ecc:database-reviewer`, Agency `identity-access-engineer`. No code written; plan v1.28
  still needs `plan decide`.
- 2026-11-01: plan v1.28 decided and activated (PLANDEC-25f09a6edce2d4833b602095, `f2d2ec9`; owner: "I approve plan v1.28,
  draft 4de16599e4604e47, including the three credential validators"). Live audit, read-only: one account (the owner's), 12
  project rows equal to the seed, 0 phases, so nothing stranger-written. Sign-up was still open despite the owner's report;
  closed by the lead on the owner's yes (`disable_signup=true`, confirmed from two sources; the only field changed).
- 2026-11-01: PROJECTOS-TENANT-CONTRACT1A and PROJECTOS-TENANT-RLS1A built in parallel worktrees and stacked on branch
  `projectos-tenant-stack2`, NOT pushed and NOT closed. Reviews: ECC SECURITY on CONTRACT, no HIGH open after one recheck, then a final bounded round
  read by the lead; ECC SECURITY on RLS APPROVE WITH CHANGES; ECC DATABASE on RLS recheck APPROVE. Agency reports hit a
  guard that blocks the wrapper's handback: software-architect was recovered from its task output, and
  ai-generated-code-security-auditor was not delivered and is open. core 1161, agent 2921, control-center 890, validate-all
  155/157 (the 2 known baseline failures). Evidence: `docs/finish/PROJECTOS-TENANT-CONTRACT1A.md`,
  `docs/finish/PROJECTOS-TENANT-RLS1A.md`.
- 2026-11-01: **tenant boundary LIVE.** Owner: "Yes, apply it now (Recommended)", "Yes, lock by default (Recommended)", "Accept it
  (Recommended)" for ADR-T1. Plan v1.29 (`89b5f0f`, PLANDEC-f39515528b11588f3afdd66d) added `0003_default_privileges.sql`. All three
  migrations and the owner's membership applied; preflight and post-check passed; ECC DATABASE APPROVE on 0003. The personal
  access token was pasted in chat and reaches the whole account. Owner decision, 2026-11-01: it stays until the project is
  completed, then the owner revokes it. It is not stored in the repo or in memory.
- 2026-11-01: PROJECTOS-TENANT-CONTRACT1A and PROJECTOS-TENANT-RLS1A **CLOSED** owner-direct on "Close and push", evidence subject
  `7f52f838`, `c0bfa875`, plan v1.29 24/29. The Agency reviews arrived after the owner changed the guard. An added `gstack-review` pass
  found two defects other reviewers missed, one fixed and one disposed with reasons. core 1186, agent 2921, control-center 890,
  validate-all 155/157 (the 2 known baseline failures). Next on the plan: PRINCIPAL1A, then CREDENTIALS1A; CSP1A can run in parallel.
- 2026-11-01: `docs/changes/delta_spec_V4_PORTS.md` written, PROPOSED, for the owner's approval (owner: "Yes, write the port plan"
  and "i want to claim it's mine with giving credits to the due"). The owner's fresh downloads are pinned there. nightly-labs/openbot is
  PolyForm Noncommercial, so it is never a code source; its features are built from MIT sources and our own code.
- 2026-11-01: the port delta approved ("Approved"). Plans v1.30 to v1.32 (`25f431a0`, `b0768486`, `14fa45b8`) added the six port phases, a write-path repair, and a Control Center build repair. Owner: "Now use as many as agents possible to complete this project" and "You have full authority".
- 2026-11-01: PORT-FOUNDATION1A, SEARCH1A, MEMORY1A and APPROVALS1A **CLOSED** owner-direct on that grant, evidence subject `cf5a316d`, `06dc092d`, plan v1.32 28/35. core 1856, agent 3056, control-center 890, validate-all 159/161. None of the ported code is wired into a route yet. Reviews found real defects, fixed: a source file hidden by `.gitignore`, an approval replay, terminal escapes passing a threat scan.
- 2026-11-01: the Control Center production build has failed since 2026-09-25, hidden behind a known-failure label for `validate-desktop-e2e`. Found by TENANT-CSP1A, repaired there, not yet closed.
- 2026-11-02: plan v1.33 (`374f9eaf`) repaired reviewed write paths. PROJECTOS-TENANT-CSP1A **CLOSED** owner-direct, `b29ac72e`, 29/35; `validate-desktop-e2e` passes on a real bundle once `npm run build` has run.
- 2026-11-02: plan v1.34 (`cb3979f5`) added PRINCIPAL1A core test paths. PORT-SKILLS1A and PORT-CONTEXT1A **CLOSED** owner-direct, evidence subject `f5c4b43f`, `cf457b67`, `72a8ef3c`, 31/35. core 2575, agent 3103, control-center 952, validate-all 163/164. The one failure is `val-cd-b4`: `AdmittedRequest::session_digest` is public at `host/core/src/ipc_session.rs:693`, carried to Stage 4.
- 2026-11-02: PRINCIPAL1A reviewed APPROVE on branch `projectos-tenant-principal1a`, HELD. Merging it before the owner runs `tenant receipt --blob 8f7b7437c648defc54d8d2005ab76691f51948fb` would refuse runs, selection and acting verbs.
- 2026-11-02: CREDENTIALS1A review BLOCKED the lead's decision to treat a phase's `secrets-handling` gate record as a credential grant: it was too coarse and scoped to another key. Decision withdrawn. Plan v1.35 (`70ffbca8`) widens the phase's paths and adds the criterion that a release needs a committed grant naming project, exact references, action and expiry. Fix round running.
- 2026-11-03: the owner typed the tenant receipt for registry blob `8f7b7437…` (10:05 UTC). The exit proof's two reviews (ECC DATABASE and ECC SECURITY, both APPROVE WITH CHANGES) were answered. Removal round 4 gave 23 killed, 2 masked, 0 other; round 3's two unexpected rows were a script fault. The stack was fast-forwarded (`967c7b86`) with core 2882, agent 3424, control-center 952 and validate-all 166/167 (`val-cd-b4` only). PRINCIPAL1A, CREDENTIALS1A, CONNECTOR-CONTRACT1A and TENANT-EXIT-PROOF1A **CLOSED** owner-direct, last `b6baa838`, **plan v1.35 35/35: Stage 2 complete.** Still open, carried: cross-tenant release with a live requester on the real installation, and the released half, which needs an owner grant. The K7 "non-owner last commit" refusal was replaced by the receipt as a lead decision and shown to the owner, with no ruling yet. Next: the port plan's phases 7-12, then Stages 3-8.
- 2026-11-03: **K7 ruled** by the owner: "Keep the receipt (Recommended)"; the Stage 2 delta's "non-owner last commit" clause is retired. **Plan v1.36 delta approved** in Plan Mode (`docs/changes/delta_spec.md` revision 2; Stage 2 delta archived). An Agency `multi-agent-systems-architect` design challenge blocked revision 1 with 11 findings, all verified in code and folded in (chief: one owner-approved option in PROTECTED `run.ts`; worker-written text never passed on as a decision). Source `bf94cb3b`; draft `6ca89e08c59cac54` (sha256:ea7b4ee5…); PLANDEC-8ca38e43a41a11d7aad2fa34 on the owner's "Yes, decide and activate (Recommended)"; activated `b5073c1a`, 47 phases, 35/47. Twelve new phases: ports ROUTINES, PROVIDERS, AGENTS, COMPUTER, RESEARCH, MCP (unwired), then Stage 3 MEMORY-STORES, MEMORY-PROVENANCE, CONTEXT-MANAGER, SKILLS-ADOPT, RESUME and the exit proof. Owner act O1 (seven Stage 3 action entries) comes before MEMORY-STORES. `continue --dry-run` selects PORT-ROUTINES1A with exactly its approved grant.
- 2026-11-14: PORT-ROUTINES1A, PORT-PROVIDERS1A and PORT-MCP1A built in parallel worktrees, reviewed (ECC SECURITY on all three, Agency api-platform-engineer on PROVIDERS and application-security-engineer on MCP; each had one fix round, one recheck and a final bounded round the lead re-verified with its own runs and scratch reproductions), stacked on the plan worktree at `e77c4acf` and **CLOSED** owner-direct on the owner's "Full authority stands." and "Work on your own, you have the full autonomy permission", plan v1.36 38/47. Battery on the stack: core 3523, agent 3529, control-center 952, validate-all 169/170 (the one known `val-cd-b4` failure, carried to Stage 4). Two shared credit-directory commits (`86f18e23`, `44d27a63`) replaced per-phase edits to the credit validator. AGENTS, RESEARCH and COMPUTER are built or building and in review. Owner act O1 is prepared in the handoff folder and not committed.
- 2026-11-14: PORT-AGENTS1A, PORT-COMPUTER1A and PORT-RESEARCH1A built in parallel worktrees, reviewed (ECC SECURITY on all three; Agency multi-agent-systems-architect on AGENTS, application-security-engineer on COMPUTER and RESEARCH; fix rounds, one recheck and a final bounded round each, re-verified by the lead with its own runs and scratch reproductions), merged with the owner act O1 commit (`dc09fb13`: seven Stage 3 action rows and their pins) onto the plan worktree and **CLOSED** owner-direct (39, 40 and 41 of 47). The stack found two defects no branch run could show, fixed in `a6ac6543` and `ba1f7644`: a barrel name clash on `SpendRequest` (RESEARCH vs MCP), a name clash between COMPUTER's `canonicalJsonOf` and MCP's MC-19 guard, and two validators with an async `run()` that validate-all counts as a crash. Battery at `ba1f7644`: core 4132, agent 3573, control-center 952, validate-all 172/173 (only the known `val-cd-b4-sealed-expected-window-facts1a`, a Stage 4 carry). **Plan v1.36 is at 41/47**; next is MEMORY-STORES1A (Stage 3).
- 2026-11-14: PROJECTOS-MEMORY-STORES1A (plan 3.1) built by one builder in its own worktree after O1 (`dc09fb13`), reviewed (ECC SECURITY: 1 HIGH parent-path bypass, 6 MEDIUM, 4 LOW; recheck: one new HIGH ReDoS and a re_ false-positive; final round), merged onto the plan worktree and **CLOSED** owner-direct (42 of 47). The merged stack found one defect no branch run could show, fixed in `f07f6807`: core/src/memory/proposalDoor.ts imported node:util, which broke control-center's coreBrowserLoad test (core must stay browser-pure; the Proxy test is now an injected fail-closed port, builder-brief lesson 13). Battery at `c4994542`: core 4368, agent 3675, control-center 952, validate-all 173/174 (only the known `val-cd-b4-sealed-expected-window-facts1a`, a Stage 4 carry). **Plan v1.36 is at 42/47**; next is MEMORY-PROVENANCE1A (Stage 3).
- 2026-11-14: PROJECTOS-MEMORY-PROVENANCE1A (plan 3.3) built by one builder in its own worktree, reviewed (ECC SECURITY: 1 HIGH forged committed proof, 3 MEDIUM, 5 LOW; fix round; recheck: 2 MEDIUM; final round), the lead updated three stores1a validator pins it changed on purpose (`de9e7b01`), merged onto the plan worktree and **CLOSED** owner-direct (43 of 47). Battery at `278f9b71`: core 4642, agent 3793, control-center 952, validate-all 174/175 (only the known `val-cd-b4-sealed-expected-window-facts1a`, a Stage 4 carry). **Plan v1.36 is at 43/47**; next is CONTEXT-MANAGER1A (Stage 3).
- 2026-11-15: PROJECTOS-CONTEXT-MANAGER1A (plan 3.4) built by one builder in its own worktree, reviewed (ECC SECURITY: 1 HIGH ledger in the project tree broke the run-record fold, 4 MEDIUM, 5 LOW; Agency multi-agent-systems-architect: 3 HIGH, 5 MEDIUM; fix round; ECC recheck found 4 MEDIUM and 5 LOW in the fixes; final round), the lead updated one provenance1a pin (MP-12), merged on the plan worktree (stack core 4719, agent 4017, control-center 952, validate-all 175/176, only the known Stage 4 carry), closed owner-direct (subject f0d253d9, persist 80abce0f), plan v1.36 44/47. Three left: SKILLS-ADOPT1A, RESUME1A, MEMORY-EXIT-PROOF1A.
- 2026-11-15: PROJECTOS-SKILLS-ADOPT1A (plan 3.2) and PROJECTOS-RESUME1A (resume, serves the Stage 3 exit proof; no separate checkbox) built by one builder each in parallel worktrees, each reviewed (ECC SECURITY: SKILLS 4 MEDIUM, RESUME 1 HIGH + 2 MEDIUM; fix round; ECC recheck; final round), merged on the plan worktree in the order context-manager, skills-adopt, resume, connector-contract (conflicts were pure unions; CM-15 and SA-7 pins moved truthfully, `5cc1139d`, `1edb76ca`; stack core 5005, agent 4199, control-center 952, validate-all 176/178 with the known Stage 4 carry plus SA-7 fixed), closed owner-direct (45 and 46 of 47; persist `0bc7d9e1` and `555d2f70`). **Plan v1.36 is at 46/47**; the last is MEMORY-EXIT-PROOF1A, which spends provider money and needs the owner's explicit yes first.
- 2026-11-15: PROJECTOS-MEMORY-EXIT-PROOF1A (Stage 3 exit proof, plan v1.36 47/47) run LIVE on the agency pilot after the owner's "yes, run the exit-proof pilot, $1.50 cap": agency plan v1.5 activated (setup by the lead under the owner's words), run 1 killed mid-phase, run 2 one fresh `continue --execute` to closed; validator built by one builder, reviewed (ECC SECURITY 3 MEDIUM + ECC CODE 5 MEDIUM, no CRITICAL/HIGH; fix round; recheck: one MEDIUM flaky timing bound; final round), the lead moved two neighbour registration pins (`1704d050`), merged `62609743`, validate-all 178/179 (only the known Stage 4 carry), **CLOSED** owner-direct (persist `99c3eec7`). A builder ran `taskkill /F /IM node.exe` and killed every node process on the machine (recorded; briefs now forbid it). **Plan v1.36 complete, 47/47.** Next: Stage 4.
- 2026-11-18: Stage 4 (plan v1.42, 54/55): PROJECTOS-WORKER-CODEX-IMPLEMENTER1A (4.1a), PROJECTOS-CONTEXT-CODEX1A, PROJECTOS-MEMORY-OWNER-COMMANDS1A, PROJECTOS-HOST-SESSION-DIGEST-SEAL1A, PROJECTOS-WORKER-SCRATCH-CHECKOUT1A (4.3a), PROJECTOS-PROVIDER-ROLES1A (4.2 first slice) and PROJECTOS-PROPOSAL-DOOR-WIRING1A, built one builder per worktree, each reviewed by ECC SECURITY, then a fix round, one recheck and a final round re-verified by the lead; plan amendments v1.37 to v1.42 (v1.39 to v1.41 lead-recorded mechanical corrections, v1.42 owner-approved: phase C may change one pin in `val-projectos-port-skills1a.cjs`); stack merged on the plan worktree and verified at `c2eec705`: core 5091/5091, agent 4659/4659, control-center 952/952, validate-all 183 registered, 183 PASS, 0 FAIL, 2 retired (the `val-cd-b4` carry is gone); closure subject `5785b504` is that head plus the digest-seal finish doc. **CLOSED** owner-direct on the owner's "Full authority stands." (persist `2466459d`, `7164bbaa`, `bcc35c5f`, `bc6d5caa`, `047d0352`, `f482c58d`, `ac56dbe1`), plan v1.42 54/55. Next: PROJECTOS-STAGE4-EXIT-PROOF1A (live; owner approved the spend cap on 2026-11-18).
- 2026-11-18: PROJECTOS-STAGE4-EXIT-PROOF1A ran live (plan v1.43; delta spec `d4771156`): **NOT PROVEN, phase stays open, plan v1.43 54/55**. Config A closed (A2, Claude implements, Codex reviews, reviewer APPROVE, closure authority closed it); attempt A1 stopped on my own phase text (an acceptance sentence the loop cannot evidence, fixed in BASE2) and is kept as evidence. Config B (B1, Codex implements, Claude reviews) ran the Codex implementer live for the first time: correct write, scope held, validate-site passed, but the worker's own two unresolved findings ("independent review outstanding", "no readable Git HEAD" in the commit-less scratch checkout) made the loop stop CORRECTION_EXHAUSTED before the Claude reviewer ran. Metered spend 20,034 micro-USD of the 3,000,000 cap. Evidence `docs/finish/PROJECTOS-STAGE4-EXIT-PROOF1A/`, record `docs/finish/PROJECTOS-STAGE4-EXIT-PROOF1A.md`. Cheapest fix is a new plan phase (shared worker instruction wording, and a scratch checkout with one commit), then re-run B (and A for a clean pair).
- 2026-11-19: Plan v1.44 fix phases for the Stage 4 exit proof built and closed owner-direct on the owner's "Full authority stands." (plan v1.44 56/57): PROJECTOS-HOST-REQUEST-STORE-SEAL1A (Rust, persist `1cc2a3b7`) and PROJECTOS-WORKER-RECORDS-SCRATCH-COMMIT1A (TypeScript, persist `06cacfd3`). TS phase: baseline review by an Agency specialist and two ECC reviewers (no CRITICAL or HIGH; two MEDIUMs, untimed scratch git and unpinned exit and override handling, fixed), fix round with the owner's semicolon wording, one independent recheck APPROVE WITH LOW, the recheck's correction (the wording change also dropped the word "so") recorded in the finish doc. Merged on the plan worktree as `8715ec0f`; ONE validate-all on that stack: 183 registered, 183 PASS, 0 FAIL, 2 retired. Next: re-run config B of PROJECTOS-STAGE4-EXIT-PROOF1A live (needs the owner's words, new attempt ids and a fresh secrets-handling receipt per attempt); the dubious-ownership cause of the live F2 finding stays unproven until then.
