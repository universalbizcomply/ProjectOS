# ADR-K1 — Kernel contract: task envelope and permission classes

**Status:** PROPOSED in phase PROJECTOS-KERNEL-CONTRACT1A (plan v1.17, V4 Stage 1, 2026-10-28). An
independent architecture review is required before closure.

**Context:** every V4 domain (Develop, Business, Personal, Phone) runs on one kernel
(`docs/06_Plan.md`). This ADR fixes the contract each domain must use:
- one **task envelope** that every operation carries;
- six **permission classes** that every action falls into.

It is mapped onto what ProjectOS enforces *today*, so the gaps are explicit. Capability backlog
items C1–C6 in `docs/recon/V4_Capability_Recon.md` depend on it.

## 1. Task envelope

| Field | Meaning | Source of truth today | Exists? |
|---|---|---|---|
| `principal` | Who is acting | `Role` = owner / implementer / advisor (`core/src/permissions.ts`). Transitions record `--as`. Owner acts are bound by **committed** records: decision files, and delegation commits authored by the owner. The Host route uses kernel peer capture and peer authentication over the named pipe | Partial. The CLI `--as` is a claim; authority comes from committed records, never from the flag |
| `tenant` | Whose data and authority | None. One owner, one machine | **New**, Stage 2. It must come from authenticated context and never from agent text |
| `domain` | Develop / Business / Personal / Phone | None; implicitly Develop | **New**, Stage 2 |
| `project` | Which governed project | `.projectops/project-config.json` `projectId`, plus the installation allowlist identity `projectId@repository@governedRoot` (AG-5) | Yes |
| `environment` | local / staging / production | None formal. Production deployment has no capability in the agent at all | **New**. Production is protected even once modelled |
| `actionClass` | One of the six classes below | Implied by `GovernanceAction`, `ALWAYS_OWNER_ONLY` and the plan's `requiredOwnerGates` | **New** explicit field. It is *derived* by the kernel, never declared by the caller |
| `scope` | What may be touched | Phase `writePaths` (a structured grant, v1.9), the plan's `approvedScope`, and phase `exclusions` | Yes for code. **New** for non-code resources such as connectors, channels and records |
| `expiry` | When authority lapses | The closure decision's `decidedAt` window, and owner-wait gate timeouts | Partial. **New** general rule: every grant expires |
| `idempotencyKey` | The same request never runs twice | Host durable request replay (§10C); gatekeeper request ids `GKREQ-*` and `CLREQ-*`; the candidate commit SHA | Partial. **New** rule: every non-git side effect carries a key |

**Rules:**
- **R1.** A missing or unparseable field is a refusal, not a default.
- **R2.** `tenant`, `domain` and `actionClass` are derived from authenticated state and the action.
  Text from a worker or model is never authority.
- **R3.** An envelope cannot widen when handed down. A child task's scope, expiry and class are
  each at most its parent's (C12).
- **R4.** Every envelope that reaches execution is recorded, whether the outcome is allowed, refused
  or failed. A refusal names the rule (C2).

## 2. Permission classes

| # | Class | Examples | Who authorises today | Enforced by |
|---|---|---|---|---|
| P1 | Read-only | Inspect code, run validators, review | Within the role (`run_validators`, `perform_review`) | `permissions.ts` roles |
| P2 | Local reversible | Edit inside a phase worktree, run tests, draft | The approved plan's `writePaths` and the pinned validators | Write-path grant; after-attempt scan of new files |
| P3 | Technical gate | `commit`, `push` | Owner-committed technical delegation **and** the gatekeeper's approval | `CONDITIONALLY_DELEGABLE_TECHNICAL`, `technicalDelegationCondition` (capability token) |
| P4 | Business operation | Booking, CRM update, customer reply | **No capability exists today**, so it is treated as P5 | Gap. Needs the Stage 5.3 delegated-authority design and owner approval |
| P5 | Protected | Phase closure (unless the owner granted `closure-decision-commit`), secrets handling, payment or live charge, production deployment, production DB mutation, external sends, service install, ACL/registry/ProgramData changes, force push, merge | The owner, explicitly, every time | `ABSOLUTE_OWNER_ONLY` covers phase-closure, secrets-handling and payment-or-live-charge in code. **The rest are enforced by having no capability**: the agent has no deploy, send or merge path. Gap: as Stage 5 adds capabilities, each must enter `ABSOLUTE_OWNER_ONLY` (or P4 under a design) *before* it ships |
| P6 | Prohibited (for any non-owner principal) | Credential disclosure, reading another tenant's data, wildcard allowlists, self-granting authority, loosening a gate by learning | Nobody | Credential router and broker (the agent never holds the key); the allowlist reader refuses wildcards. Gap: tenant isolation (Stage 2) |

**Rules:**
- **R5.** The default class for an unknown action is **P5**, never P2.
- **R6.** No setting, flag, environment variable or model judgement can move an action to a lower
  class. Only an owner-approved plan, recorded in git, can, and P5 actions stay at P5 even then.
- **R7.** Emergency stop (Stage 1.3) suspends P2–P4 for every principal except the owner. It cannot
  undo P5 effects that have already happened, and the UI must say so.

## 3. Consequences
- **D11** (PROJECTOS-KERNEL-ROLE-REVIEW1A): the reviewer and the gatekeeper are principals distinct
  from the implementer, and their verdicts are records keyed to the candidate SHA.
- **Cost cap** (PROJECTOS-KERNEL-COST-CAP1A): every provider call becomes P2 with a budget
  `scope`. A missing cap is a refusal (R1).
- **Stage 2:** `tenant` and `domain` become mandatory; `scope` extends to non-code resources.
- **Stage 5:** P4 cannot be used until its own design is approved; until then every business action
  is P5.

## 4. Alternatives rejected
- **A model-judged risk class** (Hermes's `smart` mode). It can be steered by prompt injection.
- **Per-domain permission systems.** They break "one kernel".
- **Declaring `actionClass` in the request.** A caller could under-declare it, which breaks R2 and
  R5.
