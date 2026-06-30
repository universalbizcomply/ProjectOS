# ProjectOS — Universal Project Delivery OS

ProjectOS is a universal, reusable project-delivery operating system for Murad's projects
(PolyGo, JD Testing, BizComply/OPSoft, CricLocal, Airbus tooling, Coverdrive, TKN, ERP System,
and future SaaS / product builds).

**The process is universal. The configuration is project-specific.**

This repository is the **master framework folder**. It is NOT any product repo, and it does not
install itself into any product repo by itself.

## Role model

- **Murad** — owner, commercial decision-maker, final approver.
- **ChatGPT** — consultant, reviewer, decision-maker, prompt-maker, governance layer.
- **Claude** — implementer, tester, reporter, script runner. Not the owner, not the approver, not the closure authority.

## Phase model

Every unit of work is a **phase** with: an id, a type, an objective, an explicit scope
(allowed/forbidden paths and actions), required validators, required evidence, approval gates,
a rollback plan, closure criteria, and a report. Phases move:

`prompt -> implement -> local validate -> evidence pack -> owner/advisor review -> closure`.

Claude implements and reports. Only Murad/ChatGPT approve closure.

## Owner approval model

These actions are **always gated** and require explicit owner approval:

- production deploy
- production database mutation
- real email / SMS / WhatsApp send
- payment / live charge / refund
- secrets handling
- closure of a phase

Always prohibited unless the owner explicitly overrides: force push, committing raw secrets,
service_role keys / access tokens / PATs / Vercel tokens in prompts or reports.

## Folder model

```
C:\dev\ProjectOS
  README.md            <- this file
  package.json         <- local validator runner (Node built-ins only)
  .gitignore
  projectos\
    schemas\           <- JSON schema-style definitions
    templates\         <- placeholder-only templates
    validators\        <- local-only validators (.cjs)
    scripts\           <- local-only helper scripts (.cjs)
    adapters\          <- inert adapter stubs (no API calls yet)
    examples\          <- inert demo examples
    docs\              <- architecture + governance docs
  knowledge\           <- current-state knowledge pack + reports (from KNOWLEDGE-PACK1A)
```

## Universal framework vs per-project installation

- The **universal framework** (this repo) defines schemas, templates, validators, docs and the
  governance model once.
- **Per-project installation** (a future, separately-approved phase) will place a project-specific
  `.projectops` folder inside each product repo, holding that project's config + phase manifests.
  No product installation happens in this phase.

## Safety gates

See `projectos/schemas/safety-gates.schema.json` and `projectos/docs/safety-gates.md`. Validators
fail loudly if forbidden-action language or secret patterns are missing/violated in framework files.

## How to run local validators

```
npm run validate            # run all validators
npm run validate:schemas    # schema-shape checks
npm run validate:examples   # demo example checks
npm run validate:forbidden  # forbidden-action presence checks
npm run report:check        # evidence/report template + index checks
```

All validators are local-only, use Node built-in modules, call no external services, and only read
files inside `C:\dev\ProjectOS`.

## What this phase (PROJECTOPS-UNIVERSAL1A) created

- Root `README.md`, `package.json`, `.gitignore`.
- `projectos/schemas` (project-config, phase-manifest, evidence-pack, safety-gates).
- `projectos/templates` (config, phase manifest, evidence pack, closure report, pre-push review pack,
  Claude phase prompt, per-project install README).
- `projectos/validators` (7 local validators).
- `projectos/scripts` (framework summary, file lister, report skeleton).
- `projectos/adapters` (inert stubs only).
- `projectos/examples` (inert demo configs / manifest / evidence pack).
- `projectos/docs` (architecture, governance, lifecycle, safety gates, evidence standard,
  per-project install model, future roadmap).
- A phase report under `knowledge/reports/` + a Reports Index row.

## What is NOT included yet

- No real per-project `.projectops` installation.
- No external adapters that make API calls (GitHub/Vercel/Supabase/Stripe/Resend/Twilio).
- No GitHub Actions / CI.
- No deploy wrappers, no DB tooling, no send/payment tooling.
- No production, security-risk, payment, real-send or closure decisions (owner-gated).