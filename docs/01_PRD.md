# 01 — Product Requirements (ProjectOS)

Status: describes the product as built and accepted through plan v1.15 (`2baff14`). Read with
`00_Baseline_State.md`.

## Core problem

An owner running several software projects with AI coding agents faces three problems:
- the agents act without durable governance;
- every step needs the owner to copy, paste, approve or commit;
- nothing reliably stops an agent from closing its own work, spending money or touching production.

The owner wants work carried end to end while keeping every protected action.

## Target persona

**Murad, the owner-operator.** He runs many small products (agency, finance, compliance and game
projects) on one Windows 11 machine. He is not reviewing code line by line. He wants:
- to say what he wants;
- to approve plans;
- to see truthful status;
- to keep production, money, credentials and messaging in his own hands.

Secondary persona: **an AI implementer** (Claude Code), which must find unambiguous rules in the repo.

## MVP user stories (accepted)

1. **Plan.** As the owner, I state an objective and receive a plan proposal with phases, write paths,
   validators and owner gates. Nothing runs until I approve it.
2. **Run.** As the owner, I type one `projectos continue`. The approved plan's next phase is
   implemented by the worker, within its approved write paths only.
3. **Check.** Each phase's required validators run from the phase's base commit. A phase that changes
   one of its own required validators is also judged by its new copy.
4. **Review.** The ChatGPT gatekeeper reviews the evidence with no copy-paste from me. It goes through
   the trusted installation broker, which holds the key; the agent never does.
5. **Commit.** On an approved review, ProjectOS commits and pushes the reviewed candidate and its own
   records, under a technical delegation I committed.
6. **Close.** ChatGPT decides closure on G4 evidence.
   - Where I granted `closure-decision-commit`, ProjectOS commits that decision itself.
   - Otherwise I commit it with one commit.
7. **Floor.** Phase closure (unless delegated), secrets handling, payment and live charges,
   production deployment, external sends, force pushes and merges always stop for me.
8. **Truth.** Every refusal names its cause. Evidence, spend and decisions are recorded in git.
9. **Multi-project.** The same runtime governs any project that has `.projectops/` installed.
10. **Desktop.** The Control Center shows projects, execution, plans, health and settings, and sends
    only a closed set of governed verbs.

## Success metrics (as measured live)

| Metric | Target | Achieved (EXTERNAL-PROOF3A, agency project) |
|---|---|---|
| Owner acts per phase, with delegated closure | 0 | 0 |
| `continue` invocations from phase start to closed | 1 | 1 |
| Owner relays to ChatGPT | 0 | 0 |
| Gatekeeper spend per phase | under $0.05 | $0.006 ($0.0194 across three phases) |
| Unresolved CRITICAL/HIGH findings in ProjectOS at phase closure | 0 | 0 |
| validate-all | no new failure beyond the two accepted ones | 145/147 |

## Out of scope (non-goals)

- Production deployment, domain purchase or DNS, and any external send (email, SMS, social posts).
- Payments, refunds and live charges.
- Credential disclosure. The owner rotates credentials after ProjectOS completion.
- Host-attested unattended review activation (the dormant Host review route), the signed installer,
  Forge (Programme C) and the Control Center redesign. All deferred by the owner on 2026-10-25.
- Dead Aisle and PolyGo as proof projects (owner decision, 2026-10-25).
- A second orchestrator, decision store, work queue or execution engine.
- Running the vendored agency toolkits, especially `autosocial`.
- An independent code and security reviewer inside the loop (D11). Recorded; needs an owner scope
  decision.
- Any relational database for ProjectOS's own governance state. Its state is git-versioned JSON. The
  two SQL schemas are optional satellites (cloud Control Center data, watchdog).

## V4 — target direction (owner, 27 October 2026; a proposal, not an implementation approval)

Source: `docs/vision/ProjectOS_V4_Target_Architecture.png`.

**Principle:** one platform, four product domains, one governed execution system, and strictly
separated customer data and permissions.

**The four domains:**
- **Personal:** life, productivity, devices.
- **Develop:** autonomous software delivery. This is today's product.
- **Business:** operations, AI employees, customers.
- **Phone:** voice, telephony, mobile.

**Shared layers:** access (web, desktop, mobile, voice, API), intelligence and orchestration,
governance and security, execution, and data and memory. Multi-tenancy, privacy, monitoring, billing,
reliability and security by design cut across all of them.

**Rules carried from V3 into V4:**
- Intelligence decides *what*; authority decides *what is permitted*. AI confidence is never
  permission.
- Real sends and payments stay owner-gated. A delegated-authority model for routine business work
  needs its own governance design and approval.
- Providers are replaceable workers bound to roles. An implementer never manufactures the
  gatekeeper's decision.
- Tenant and domain boundaries are enforced by the application and the database, not by
  instructions to the AI.
- The non-goals above still hold for today's build. `06_Plan.md` says the stage at which each one
  is revisited.
