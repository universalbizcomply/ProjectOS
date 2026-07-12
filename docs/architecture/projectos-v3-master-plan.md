# ProjectOS V3 — Owner-Controlled Autonomous Delivery System

**Master E2E Delivery Plan**

- **Plan ID:** `projectos-v3-master-plan`
- **Plan Version:** `1.0`
- **Plan Status:** `PLAN READY`
- **Owner:** Murad
- **Gatekeeper:** ChatGPT
- **Implementer:** Claude Code
- **Approved by:** Murad — **approval binding:** `MANUAL_GOVERNANCE_APPROVAL` (human-gated; `tamperProof: false`; not cryptographically bound — see §3)
- **Baseline commit:** `1aa36b9d05942b7e5168a2e878de775cc0159701` (repository state the plan was created from — does **not** itself contain the plan document)
- **Plan persistence commit:** _(null — pending; set only after an authorised commit; never fabricated in advance)_
- **Baseline branch:** `projectos-v3`
- **Supersedes:** _(none — first approved version)_

> This document is the **authoritative human-readable source of truth** for ProjectOS V3
> (source-of-truth hierarchy level 1). The machine-readable plan-memory instance at
> `projectos/state/projectos-v3.plan.json` is the operational representation (level 2). Where the
> two differ, this document governs the business and programme intent; the JSON instance governs
> the operational fields ProjectOS consumes. ProjectOS memory must never silently diverge from or
> weaken this plan.

---

## 1. Project Vision

ProjectOS is a **Universal Project Delivery OS**: a local, owner-controlled system that plans,
governs, executes and proves software delivery end-to-end across many projects, without depending
on any external metered AI orchestration API.

ProjectOS V3 extends the closed V2 foundation into an **owner-controlled autonomous delivery
system**: the owner approves a plan, and ProjectOS drives controlled, gated execution against that
plan while every irreversible or outward-facing action remains owner-gated.

## 2. Definition of Complete

ProjectOS V3 is complete when, for an owner-approved project:

- a project vision, plan, execution plan and definition-of-complete are recorded and approved;
- ProjectOS can drive a phased delivery roadmap under deterministic governance;
- every phase is validated, reviewed and evidenced before closure;
- production, database, external-send and payment actions are gated to the owner;
- no external AI-agent API is required at any point;
- the owner can start, pause, gate and close autonomous execution from a single control surface.

This phase (`PROJECTOS-V3-MASTER-PLAN-MEMORY1A`) delivers the **plan-governance foundation** only.
It does not deliver the autonomous execution engine, UI, secret vault, or provider operations.

## 3. Governance

| Role | Authority |
| --- | --- |
| **Owner (Murad)** | Approves plans, approves closures, authorises owner-only actions, holds final closure authority. |
| **Gatekeeper (ChatGPT)** | Reviews and gates work; accepts or rejects commit/push/closure decisions. |
| **Implementer (Claude Code)** | Implements and validates. **Cannot** approve a plan, set `PLAN READY`, supersede a plan version, or close a phase. |

**Owner-only actions:** plan approval, plan-version supersession approval, phase closure, commit
decision, push decision, production deploy, database mutation, external sends, payments, provider
credential access.

**Forbidden actions (all roles, this programme unless a later owner-approved phase enables them):**
OpenAI API use, Anthropic API use, any metered AI-agent API use, provider credential access, storing
real secrets, modifying `projectos-v2-core`, modifying V2 closure records, modifying PolyGo,
force-push.

**Approval-binding truth.** Each plan records `approvalBinding`, `tamperProof` and `approvalAuthority`.
The current binding is `MANUAL_GOVERNANCE_APPROVAL` with `tamperProof: false` and `approvalAuthority:
owner`. `PLAN READY` therefore relies on **Murad's explicit external approval**, **ChatGPT's
gatekeeper review**, the **controlled commit gate**, and **repository evidence**. It does **not** yet
rely on cryptographic signatures, a hardware-backed identity, a secret-vault owner token, or a secure
out-of-band approval channel. A free-text `approvedBy` field is **not** claimed to independently prove
owner identity; `tamperProof` must not be `true` while binding is manual, and `SECURE_OWNER_APPROVAL`
cannot be claimed without secure-evidence fields. Cryptographic binding is an accepted carry-forward.

## 4. No-API Policy

ProjectOS V3 uses **no OpenAI API, no Anthropic API, and no metered AI-agent API**. There is no
external AI orchestration dependency. The ChatGPT↔Claude relay is a manual or partially automated
owner-mediated relay over a git-repo bus; an automated local loop is **not yet implemented**. The
system must **not** be described as fully autonomous.

## 5. PLAN READY Rule

A project may not begin autonomous E2E execution until it holds an owner-approved plan-memory record
whose status is `PLAN READY`. `PLAN READY` is **calculated from evidence**, never set by writing the
status string. The implementer (Claude) cannot cause `PLAN READY`.

A project reaches `PLAN READY` only when all applicable checks pass:

- repository identity verified; expected Git remote verified;
- plan sources identified and classified; material conflicts resolved;
- current state reconciled;
- business vision, definition-of-complete, approved scope and excluded scope recorded;
- execution phases generated with valid dependencies and acceptance criteria;
- environments mapped; provider references mapped where applicable;
- safety gates configured; critical locks recorded where applicable;
- validators mapped; owner-only actions recorded;
- plan linked to a source commit; machine-readable plan valid; plan version recorded;
- **owner approval recorded** (approver is the owner, not Claude);
- no raw secret present; no unresolved blocking condition.

`PLAN READY` means the plan is ready for controlled execution — **not** that every planned capability
has already been implemented.

## 6. New-Project Start Constraint

> **No approved plan in memory → no autonomous project start.**

A new project is not eligible for E2E execution until it has a project vision, project plan, execution
plan, definition-of-complete, phased roadmap, environment model, risk model, approval model, an
owner-approved plan-memory record, and `PLAN READY` status. This phase implements the underlying
validation decision the future Start-E2E UI and runner will consume; it does not implement that UI.

## 7. Source-of-Truth Hierarchy

1. **Owner-approved human-readable plan** — this document. Authoritative business and programme plan.
2. **Versioned machine-readable plan memory** — `projectos/state/projectos-v3.plan.json`. Structured
   operational representation.
3. **Current project state** — `projectos/state/projectos-v3.current-state.json`. Continuously updated
   factual delivery state. May change as work progresses; must not alter the approved plan.
4. **Active execution session** — `projectos/state/projectos-v3.session.json`. Temporary current-run
   state.
5. **Reports and evidence** — `knowledge/reports/**`. Proof of implementation and gate decisions.

## 8. Memory Model

Three separate records, never conflated:

- **Project plan** (`project-plan.schema.json`) — identity, vision/scope, repository, plan sources,
  delivery model (phases + dependencies + acceptance + autonomy + validators + reviews + gates),
  environments/providers, governance, approval, staleness, security. Immutable once approved except
  by owner-approved supersession.
- **Current project state** (`current-project-state.schema.json`) — active plan pointer, status,
  completion, phase progress, branch/HEAD/remote, risks, blockers, next recommended phase.
- **Active execution session** (`active-execution-session.schema.json`) — one run's transient state,
  including explicit proof that no raw secret is stored and no forbidden side-effect occurred.

## 9. Plan Status Model

Deterministic, validated statuses:

`NO PLAN` · `PLAN DISCOVERED` · `PLAN CONFLICT` · `PLAN DRAFTED` · `AWAITING OWNER APPROVAL` ·
`PLAN READY` · `PLAN STALE` · `PLAN BLOCKED`.

Transitions are deterministic. Claude cannot set `PLAN READY` by writing the string; the gate
computes it from evidence.

## 10. Plan Versioning

Approved plan versions are immutable. A material amendment creates a new version that identifies the
superseded version and retains approval metadata, source documents and commit references. Previous
versions remain readable. Ordinary current-state progress does not create a new plan version. Claude
cannot approve or supersede a plan version.

## 11. Plan Staleness

A plan becomes `PLAN STALE` on material change: authoritative plan document changed; execution plan
materially changed; expected repository remote changed; protected-branch policy changed; provider
identity changed; environment identity changed; business vision changed; definition-of-complete
changed; approved scope changed; critical architecture changed; owner-controlled gates changed;
critical locks changed.

Ordinary implementation progress does **not** stale a plan: HEAD advancing through approved phase
commits, a phase completing, current-state memory changing, reports/evidence being added, or normal
generated-state updates.

## 12. Autonomy Levels

Per-phase permitted autonomy is recorded on each phase (`autonomyLevel`). Levels used in V3:

- `read-only` — inspection only.
- `local-safe` — local file creation/validation; no external effects. (This phase.)
- `gated-execution` — controlled execution with owner gates on irreversible/outward actions.

No phase is fully autonomous. Every irreversible or outward-facing action requires an owner gate.

## 13. Secret-Access Model

No raw secret values are stored anywhere in plan memory, current state, active sessions, reports or
prompts. Providers are referenced by **name only**. `rawSecretValuesForbidden` is asserted on every
record. Redaction is required for any sensitive value. The secret vault and secret-operation broker
are **not** implemented in this phase.

## 14. Environments and Providers

Environments are defined by identity only; production is frozen (no deploy in this programme phase).
Providers are referenced by reference name (e.g. `provider:<name>`) with **no raw credentials**. The
provider-reference collection is **legitimately empty** when a project has no applicable configured
provider — a provider identity is never invented merely to satisfy the schema. ProjectOS V3 currently
declares **no** provider (`providers: []`). PolyGo is a separate future pilot project (see §15); it is
**not** a ProjectOS provider context and must not be represented as one.

## 15. Approved Programme Phases

| # | Phase ID | Description | Depends on | Autonomy | Status |
| --- | --- | --- | --- | --- | --- |
| 0 | `PROJECTOS-V3-BASELINE-RECONCILE1A` | Read-only V3 baseline & plan-start reconciliation. | — | `read-only` | COMPLETE |
| — | `PROJECTOS-DESKTOP-ICON-FINALISE1A` | Pre-V3 maintenance: desktop icon finalise. | — | `local-safe` | COMPLETE |
| 1 | `PROJECTOS-V3-MASTER-PLAN-MEMORY1A` | Plan persistence, plan-memory model, PLAN READY gate. | Phase 0 | `local-safe` | IN PROGRESS |
| 2 | `PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A` | Discover and import existing project plans into plan memory. | Phase 1 | `local-safe` | PLANNED |

**PolyGo pilot dependency (separate track, do not auto-start):**
`PROJECTOPS-POLYGO-BASELINE-RECONCILE1A`, `PROJECTOPS-POLYGO-INSTALL1A-REENTRY`.

## 16. Phase Dependencies

Each phase declares `dependsOn` referencing earlier phase IDs only. No cycles. A phase may not be
eligible for execution until its dependencies are recorded complete and the plan is `PLAN READY`.

## 17. Completion Calculation

Until a weighted completion engine is formally implemented, completion uses the **temporary
accepted-phase method**, recorded explicitly in current-state memory
(`completionMethod`, `acceptedPhaseCount`, `totalPhaseCount`, `completionPercentage`):

```
completionPercentage = acceptedPhaseCount / totalPhaseCount × 100   (rounded to 1 dp)
```

- `acceptedPhaseCount` counts only **formally accepted** V3 phases.
- It **excludes** the active unaccepted phase, merely-implemented-but-unaccepted work, and the pre-V3
  maintenance phase (`PROJECTOS-DESKTOP-ICON-FINALISE1A`).
- `totalPhaseCount` = the approved V3 roadmap phases 0..18 = **19**.

Current value: `1 / 19 = 5.3%` (only `PROJECTOS-V3-BASELINE-RECONCILE1A` is accepted;
`PROJECTOS-V3-MASTER-PLAN-MEMORY1A` is active and not yet accepted). Completion never mutates the
approved plan and never, by itself, stales the plan.

## 17a. Commit Semantics

Three distinct commit references are tracked so no single field overloads meaning:

- **`baselineCommit`** — the repository state the plan was created from. It does **not** contain the
  plan document.
- **`planPersistenceCommit`** — the commit that persists the plan into the repository. It is `null`
  before commit and a 40-character commit hash after; the future hash is never fabricated in advance.
- **`lastVerifiedCommit`** (under `staleness`) — the repository state against which the plan's
  material inputs were last checked.

The link between the plan and its human-readable source document is the **source-document checksum**
(`sha256:…`), not a commit hash.

## 18. Owner-Controlled Actions

Start E2E, pause, resume, approve plan, approve closure, approve commit, approve push, authorise
production deploy, authorise database mutation, authorise external send, authorise payment, authorise
provider access. All are owner-only and out of scope for autonomous execution.

## 19. Success Standard

ProjectOS V3 succeeds when the owner can approve a plan once and then supervise controlled,
evidenced, gated delivery of a real project to its definition-of-complete — with no external AI API,
no ungated irreversible action, and a complete audit trail — while retaining single-click authority
to start, pause, gate and close.

## 20. ProjectOS V3 Initial State (as of this phase)

- Plan version `1.0`, approved by Murad (`MANUAL_GOVERNANCE_APPROVAL`, `tamperProof: false`).
- Baseline commit `1aa36b9d05942b7e5168a2e878de775cc0159701`; plan persistence commit `null` (pending).
- Baseline branch `projectos-v3`.
- Completion: `1 / 19 = 5.3%` (accepted-phase method; only `PROJECTOS-V3-BASELINE-RECONCILE1A` accepted).
- Providers: none declared (`providers: []`).
- ProjectOS V2 status: **CLOSED**.
- Current V3 phase: `PROJECTOS-V3-MASTER-PLAN-MEMORY1A` (active, not yet accepted).
- Completed/accepted V3 phases: `PROJECTOS-V3-BASELINE-RECONCILE1A`.
- Pre-V3 maintenance completed (not counted toward completion): `PROJECTOS-DESKTOP-ICON-FINALISE1A`.
- Next planned phase: `PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A`.
- Autonomy truth: the current ChatGPT/Claude relay is manual or partially automated; the automated
  local loop is not yet implemented. The system is **not** fully autonomous.
