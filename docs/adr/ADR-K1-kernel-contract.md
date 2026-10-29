# ADR-K1 — Kernel contract: task envelope, permission classes and grants

**Status:** PROPOSED in phase PROJECTOS-KERNEL-CONTRACT1A (plan v1.17, V4 Stage 1). Revision 2,
2026-10-29, after the independent architecture review: Agency `software-architect`, corpus
`ad9264e3`, verdict CONCERNS, 5 HIGH / 4 MEDIUM, all accepted (see §5). **Only the owner marks an ADR
Accepted.**

**Context:** every V4 domain runs on one kernel (`docs/06_Plan.md`). This ADR fixes the contract each
domain must use:
- a **task envelope** that every operation carries;
- a canonical **action registry** that binds each action to a **class**, saying how dangerous it is;
- **grants**, saying who may authorise it.

It is mapped onto what ProjectOS enforces today, so the gaps are explicit. Capability backlog items
C1–C6 in `docs/recon/V4_Capability_Recon.md` depend on it.

## 1. Action registry (the source of class and environment)

- **One canonical registry, owner-approved and versioned in git.** It maps every executable action to
  its class (§3) and its target environment. Both are declared **when the executing capability or
  adapter is registered**, never by the caller.
- **Caller labels are ignored.** An action not in the registry is P5 (R5).
- **The registry unifies today's two vocabularies:**
  - `GovernanceAction` (`core/src/permissions.ts:11-27`), for example `close_phase`;
  - the owner-only action names (`core/src/ownerOnlyActions.ts:56,71,80-86`), for example
    `phase-closure`.

  Each entry names both spellings.

## 2. Task envelope

| Field | Meaning | Source of truth today | Exists? |
|---|---|---|---|
| `envelopeVersion` | Contract version | None | **New**. Stage-1 envelopes are v1, where `tenant` = `owner` and `domain` = `develop`, both *derived* by the kernel. From Stage 2, v2 makes both mandatory |
| `envelopeId` / `parentEnvelopeId` | Identity and lineage | Gatekeeper request ids `GKREQ-*` / `CLREQ-*`; phase and run records | **New**. Minted by the kernel at admission |
| `principal` | The role acting | `Role` = owner / implementer / advisor (`core/src/types.ts:10`, `permissions.ts`). Owner acts are bound by **committed** records. The Host uses peer capture and authentication over the named pipe | Partial. The CLI `--as` is a claim; authority comes from committed records |
| `actor` | Which agent, provider and model | The worker invocation record (B4) | **New**, as an envelope field. D11 checks implementer ≠ reviewer ≠ gatekeeper *by actor* |
| `tenant` | Whose data and authority | None | **New**. Derived from authenticated context; never from agent text |
| `domain` | Develop / Business / Personal / Phone | None | **New**. Derived |
| `project` | Which governed project | `projectId` plus the allowlist identity `projectId@repository@governedRoot` (AG-5) | Yes |
| `environment` | local / staging / production | None formal | **New**. Taken from the registry entry of the executing capability, never from the caller |
| `actionClass` | P1–P6 | Implied today | **New**. Looked up in the registry (§1) |
| `subjectHash` | What exactly is being acted on | The candidate commit SHA; the closure evidence subject | Partial. **New**: a payload hash for non-git actions, such as a message body plus its recipient |
| `scope` | What may be touched | Phase `writePaths`, the plan's `approvedScope`, `exclusions` | Yes for code. **New** for connectors, channels and records |
| `budget` | Maximum spend for this envelope | None. The reservation is not a bound | **New**, as its own field (PROJECTOS-KERNEL-COST-CAP1A). A missing budget on a paid action is a refusal |
| `expiry` | When authority lapses | The closure `decidedAt` window; gate timeouts | Partial. **New**: every grant expires |
| `idempotencyKey` | The same effect never happens twice | Host durable replay (§10C); the GKREQ and CLREQ ids | Partial. **Minted by the kernel at admission** and carried to every non-git side effect |

## 3. Classes: how dangerous an action is (never lowered)

| # | Class | Examples |
|---|---|---|
| P1 | Read-only | Inspect code, run validators, review |
| P2 | Local reversible | Edit inside a phase worktree, run tests, draft. `rollback` (`permissions.ts:27,36`) is declared but has no execution path today; the registry must give it one before it is usable |
| P3 | Technical gate | `commit`, `push`, **paid provider calls**. A provider call is irreversible spend and sends data to a third party, so it is not P2 |
| P4 | Business operation | Booking, CRM update, customer reply |
| P5 | Protected | Phase closure, secrets handling, payment or live charge, production deployment, production DB mutation, external sends, service install, ACL/registry/ProgramData changes, force push, merge |
| P6 | Prohibited | Credential disclosure, reading another tenant's data, wildcard allowlists, self-granting authority, loosening a gate by learning |

## 4. Grants: who may authorise an action of a class

| Class | Default grant | Delegated grant (a named, owner-committed record only) | Enforced today by |
|---|---|---|---|
| P1 | The role | — | `permissions.ts` roles |
| P2 | The approved plan's `writePaths` and the pinned validators | — | Write-path grant; after-attempt scan of new files |
| P3 | **The owner** (`commit` and `push` are in `ALWAYS_OWNER_ONLY`, `ownerOnlyActions.ts:80-86`) | Technical delegation plus gatekeeper approval (`CONDITIONALLY_DELEGABLE_TECHNICAL`, `:71`; capability token `technicalDelegationCondition`, `:113-120`). Provider calls also need a `budget` within the hard cap | As named; the cap is planned |
| P4 | **None exists yet**, so the action cannot run | Only after the Stage 5.3 delegated-authority design is approved | Gap, by design |
| P5 | **The owner, every time** (`ABSOLUTE_OWNER_ONLY`: phase-closure, secrets-handling, payment-or-live-charge, `:56`) | Phase closure only: the `closure-decision-commit` delegation (`closureAuthority.ts:92`), where the owner made the last commit to the delegation file. The class stays P5; only the grant is delegated | phase-closure, secrets and payment in code. **The rest are enforced by having no capability**: the agent has no deploy, send or merge path. Stage 5 must register each new capability as P5 *before* it ships |
| P6 | Nobody, **including the platform owner across tenants**. Crossing tenants needs an explicit, scoped, expiring grant recorded by the *data-owning* tenant | — | Credential router and broker (the agent never holds the key); wildcard refusal in the allowlist reader; tenant isolation is Stage 2 |

The owner-only governance actions `approve`, `reject`, `close_phase` and `override_gate`
(`permissions.ts:49-54`) are P5 actions whose default grant is the owner.

## 5. Rules
- **R1.** A missing or unparseable field is a refusal. Defaults exist only where §2 names a
  kernel-derived value for that envelope version.
- **R2.** `tenant`, `domain`, `environment`, `actionClass`, `envelopeId` and `idempotencyKey` are
  derived or minted by the kernel. Worker or model text is never authority.
- **R3.** No widening downstream. A child's `tenant`, `domain`, `project` and `environment` must
  **equal** its parent's. Its `scope`, `budget`, `expiry` and class must be **at most** its parent's.
- **R4.** Every envelope is recorded **at admission**, refusals included, before any side effect. It
  is recorded again at execution with the outcome: allowed, refused or failed, naming the rule.
- **R5.** An action not in the registry is P5.
- **R6.** Classes are never lowered. Only an owner-committed delegation record can widen a *grant*,
  and only where §4 lists one. No flag, setting, environment variable or model judgement changes a
  class or a grant.
- **R7.** Emergency stop refuses every new or pending operation for every non-owner principal. That
  includes approved-but-not-yet-executed P3–P5 work, such as a pre-approved send or a delegated
  closure. Stop and `expiry` are checked **when the action executes**, not only at admission. The stop
  cannot undo P5 effects that have already happened, and the UI says so.

## 6. Consequences
- **D11:** reviewer and gatekeeper verdicts are records keyed to `subjectHash`, with `actor` different
  from the implementer's.
- **Cost cap:** provider calls are P3 with a mandatory `budget`.
- **Stage 2:** envelope v2 requires `tenant` and `domain`. The R3 equality rule closes cross-tenant
  re-labelling.
- **Stage 5:** every adapter registers its class and environment first. P4 has no grant until its
  design is approved.

## 7. Review disposition (software-architect, corpus `ad9264e3`)
- **F1 HIGH**, caller-chosen class and environment: accepted (§1, R2, R5).
- **F2 HIGH**, the closure delegation versus R6 contradiction: accepted. Class and grant are now
  separate (§3, §4, R6). `ABSOLUTE_OWNER_ONLY` is unchanged.
- **F3 HIGH**, child tenant switching: accepted (R3).
- **F4 HIGH**, the stop missing approved-but-unrun work, and the race: accepted (R7).
- **F5 HIGH**, D11 fields: accepted (`actor`, `envelopeId`, `parentEnvelopeId`, `subjectHash`).
- **F6 MEDIUM**, the mapping omissions: accepted (§1, §4; `rollback` noted).
- **F7 MEDIUM**, provider calls as P2: accepted (now P3, with a `budget` field).
- **F8 MEDIUM**, version, admission refusals, key minting: accepted (`envelopeVersion`, R4, R2).
- **F9 MEDIUM**, the owner across tenants: accepted (§4 P6).
- **Verified by the lead:** `rollback` appears only at `permissions.ts:27,36`. The closure delegation
  is a separate path (`closureAuthority.ts:92`). The claim that no deploy, send or merge path exists
  is carried as an open item to verify in PROJECTOS-KERNEL-ROLE-REVIEW1A's scan.

## 8. Alternatives rejected
- **A model-judged risk class** (Hermes's `smart` mode). It can be steered by prompt injection.
- **Per-domain permission systems.** They break "one kernel".
- **Caller-declared class.** A caller could under-declare it.
- **Removing closure from `ABSOLUTE_OWNER_ONLY` to "fix" F2.** That would weaken the floor.
