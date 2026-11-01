# Delta Specification — plan v1.28, V4 Stage 2: tenant boundary and connector contract

**Status:** APPROVED by the owner in Plan Mode, 2026-11-01, with the decisions below. **No code is written
until plan v1.28 is decided and activated.** Drafted at `main` = `origin/main` = `6e6db52` (main had not
moved since Stage 1 closed). Revision 2, after independent design review.

The previous delta (plan v1.17, Stage 1, closed) is archived at
`docs/changes/archive/delta_spec_PROJECTOS-KERNEL-V1.17.md`.

**Goal:** the database and the kernel's own routes refuse a cross-tenant read, each provably on its own.
Plus the connector contract every later connector must pass. There are no new domains, no live connector,
and no owner gate is relaxed.

**This is not yet a boundary against a hostile worker.** Workers run as the owner's Windows user, so
stored secrets and files stay reachable outside the kernel (F7). No second party's data or credentials go
on this machine until Stage 4.3 and service custody close that.

## What the audit found (these change the plan)

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| F1 | **Live sign-up is open.** Anyone with a real mailbox can create an account, and `using(true)` then lets that account read and rewrite every row. Anonymous sign-in is off and email is the only provider. | `GET /auth/v1/settings` on `vzbzkziksxvyfqrdrwqx`: `disable_signup=false`, email confirmation on, `anonymous_users=false`. Anon read of `projects` returned `[]`. | Close it today (D1). **Existing accounts survive that**, and existing rows may be stranger-written, so accounts and rows are audited before anything is migrated. |
| F2 | **Nothing reads the cloud tables.** `fetchProjects` has no production caller and no code touches `public.phases`. Only Supabase Auth is used, as the desktop sign-in gate. | Code search; the only other mention is a test mock. | RLS is a low-risk change: no screen breaks. The database boundary is exercised by the harness, not by a product flow, until Stage 5/6. |
| F3 | **Re-running the old SQL reopens the hole.** `interactive.sql` re-creates `using(true)` and is idempotent. `schema.sql` re-seeds rows. | `supabase/interactive.sql:21-32` | Both are retired, not just superseded. |
| F4 | **No envelope exists in code.** ADR-K1 is design only and still Proposed. No `envelopeVersion`, action registry or tenant anywhere in `core` or `agent`. `core/src/execution/controller.ts` is imported by tests only. | Code search; `docs/finish/PROJECTOS-KERNEL-CONTRACT1A.md` | "Stage 2 makes envelope v2 mandatory" really means "Stage 2 builds the envelope". |
| F5 | **Project isolation is real on the session and bridge paths, and absent on the operation path.** `operation-gate.run()` passes `projectId: ref.project`, so the vault compares the reference with itself; the permit binds the same way. No requester identity exists there. | `vault.cjs:204,230`; `mcp/bridge.ts:338`; `operation-gate.cjs:174,185,222` | Fixed in phase 4. A tenant check beside it would inherit the hole. |
| F6 | **Local Postgres and a Supabase-shaped harness already exist.** | scoop `postgresql`; `watchdog/sql/test/pg-harness.cjs` | The database proof runs at $0 with no production touch. It needs an `auth` stub and a non-superuser migration owner. |
| F7 | **Workers can reach everything the owner's Windows user can.** Candidate code runs as the owner in validator checks. Secrets are generic Credential Manager entries readable by any process of that user, including every tenant's secrets and the gatekeeper key. Writes are bound to the plan; reads are not. | `windows-credential-store.ps1:52,75-82`; `docs/finish/PROJECTOS-KERNEL-CODEX-LIVE1A.md`; port map C7 | See "What Stage 2 does not prove" and D4. |
| F8 | **The tenant cannot live in the project, and a commit alone must not move it.** A project's `.projectops/` is writable by that project's work. And the allowlist reader trusts any commit at HEAD. | `projectAllowlist.ts:134-150`; ADR-K1 §4 P3 | The registry is an installation record. Changing it is a P5 action, and the owner must have made its last commit. |
| F9 | **Tenant reach is wider than reference names.** `supabase-access-token` is auto-loaded in `staging-writer`. If that token is account-wide, a worker bypasses RLS entirely with it. | `reference.cjs:41-45`; `session-profiles.cjs:42` | Each credential declares its reach. An account-wide token is never projected into another tenant's session. |

## Design in one page

- **Principal.** The principal is the Windows operator, plus the kernel-bound work context (which project
  this run or session is for). **A Supabase identity carries no kernel authority**: sign-in reaches the
  cloud tables only. The owner holds both tenants, so one owner JWT and one owner desktop see both by
  membership; that is not a cross-tenant breach, and cross-tenant refusal applies to work bound to a project.
- **Tenant** = whose data and authority. **Domain** = Develop / Business / Personal / Phone. Each project
  has exactly one tenant and one domain; a tenant can hold several domains.
- **Authority stays in git.** `projectos/security/tenant-registry.json` binds
  `projectId@repository@governedRoot` to a tenant and a domain. It is read from committed bytes, validated
  **whole** before any match (duplicates and wildcards refuse the file), and an unlisted project is refused
  by name. Changing it is the P5 action `tenant-registry-change`: the owner must have made its last commit.
  Authorship stays spoofable until signed commits exist, and the ADR says so. ADR-T1 rules on linked
  worktrees, because governed runs use them.
- **Tenant is derived, never supplied.** Worker text, argv, environment variables and route text are
  ignored (R2). A child envelope must equal its parent's tenant, domain, project and environment (R3).
- **Envelope scope for Stage 2:** minted where a tenant can be crossed: run start, credential release,
  broker call, Control Center project selection, MCP bridge read. Each is recorded at admission, and a
  refusal that cannot be recorded fails closed (R4). Today's `appendRefusal` drops silently when locked and
  vault audit is in memory; both are fixed. Other operations are stated as not yet enveloped, for Stage 4.
- **Credentials.** The five-segment format stays, so no stored secret is re-entered. Three classes:
  - **Project:** inherits its project's tenant.
  - **Tenant:** the reserved project segment `tenant.<tenantId>`, for example the agency's Google account.
    Matched case-insensitively, because Windows target names may be. A real project id may not start with
    `tenant.`.
  - **Platform:** the gatekeeper key. Serves every tenant through the broker; released to none.

  `run()` and the vault take a kernel-minted requester context, branded like `liveGrants`; plain strings
  are refused. `provision`, `remove` and `present` are bound too.
- **Database.**
  - `tenants`, `tenant_members`; `tenant_id` on `projects` and `phases`; primary key `(tenant_id, id)` so a
    global id cannot reveal another tenant's row; composite foreign key so a phase cannot point at another
    tenant's project.
  - **Table grants are the first wall.** All privileges revoked from `public`, `anon`, `authenticated`.
    `authenticated` gets select on `tenants` and `tenant_members`; select, insert and delete on `projects`
    and `phases`, plus `update` only on columns that omit `tenant_id`, `id` and `project_id`.
  - Members read, tenant owners write, policies `to authenticated`. `tenant_members` shows a user only their
    own rows and has no client write path, so nobody can add themselves.
  - Helpers live in a `private` schema, `stable`, `search_path ''`, no user argument, execute revoked from
    `public` and granted to `authenticated` only. Policies use
    `tenant_id in (select private.my_tenant_ids())`.
  - All four tables are removed from the `supabase_realtime` publication, because delete events are not
    RLS-filtered.
  - Backfill comes from an explicit project-to-tenant map and **raises on any unmapped row**; the column has
    no default. The migration ends with an in-transaction check, so a bad apply rolls back.

## Phases (appended to the active plan; v1.28)

Same route as Stage 1: parallel worktrees where files do not overlap, one combined review per phase with
at most one recheck, LOWs carried.

| # | Phase | Delivers | Runs | Independent review (mandatory) |
|---|---|---|---|---|
| 1 | PROJECTOS-TENANT-CONTRACT1A | ADR-T1; `tenant-registry.json`; `action-registry.json` (both vocabularies, plus `cross-tenant-access` and `tenant-registry-change` as P5); pure `core` tenant, envelope and registry code with R1–R5 tests; docs truth sync | First | ECC SECURITY; Agency `software-architect` on the ADR |
| 2 | PROJECTOS-TENANT-RLS1A | Forward-only migrations; read-only live preflight; harness with `auth` stub, non-superuser migration owner, watchdog privilege gate; old SQL retired; dead `fetchProjects` removed; false comments corrected. **Local only** | Parallel with 1 | ECC DATABASE and ECC SECURITY; Agency `ai-generated-code-security-auditor` additive |
| 3 | PROJECTOS-TENANT-PRINCIPAL1A | Registry reader with whole-file validation and owner-last-commit check; envelope minted and recorded at the boundaries above; fail-closed refusal recording; `TENANT_UNKNOWN`, `TENANT_MISMATCH`; `projectos tenant show` | After 1 | ECC SECURITY; Agency `identity-access-engineer` |
| 4 | PROJECTOS-TENANT-CREDENTIALS1A | Requester context on the operation path; tenant and platform classes; credential `reach` declaration; bound mutators; tenant check at broker, router and bridge | After 3 | ECC SECURITY; Agency `secrets-credential-hygiene-engineer` |
| 5 | PROJECTOS-TENANT-CSP1A | Strict Tauri CSP and `devCsp`; capability review; proven in a real webview, not only by reading config | Parallel | ECC SECURITY |
| 6 | PROJECTOS-CONNECTOR-CONTRACT1A | Connector registry schema; release gate validator; execution receipt and error vocabulary, including `outcome_unknown`. **Zero live connectors** | After 4 | ECC SECURITY, ECC CODE |
| 7 | PROJECTOS-TENANT-EXIT-PROOF1A | The proof below; `docs/finish` evidence | Last | ECC DATABASE, ECC SECURITY |

**Live database apply** is an owner act between phases 2 and 7, using the exact bytes phase 2 proved, and
only after the preflight passes: postgres owns both tables; the new names are absent; complete policy,
grant, publication and dependency listing; every row and project id in the map; no orphan phases;
`auth.users` is the owner only; a fresh export of both tables exists.

**CSP target** (exact host, because a wildcard would let injected script post data to any Supabase
project): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
font-src 'self'; connect-src 'self' ipc: http://ipc.localhost https://vzbzkziksxvyfqrdrwqx.supabase.co
wss://vzbzkziksxvyfqrdrwqx.supabase.co; object-src 'none'; base-uri 'none'; form-action 'none';
frame-ancestors 'none'`. Phase 5 tightens `style-src` if the app runs without `'unsafe-inline'`. The
installed app gets it only after an MSI rebuild.

## Connector blueprint: what is in Stage 2 and what is not

Memory filed these gaps under Stage 4. Stage 2 takes the parts that define the tenant boundary; anything
that needs a running connector stays later.

| Blueprint gap | Stage | Why |
|---|---|---|
| Connector registry (tenant, scopes, secret reference, data categories, idempotency, last acceptance date) | **2** | "Bind tenant and resource" and ADR-K1 G-REG must exist before the first connector is written |
| Release checklist as an enforced gate | **2** | A connector without a passing record cannot register |
| Acceptance scenarios (§10) | **2 defines; 5 runs** | Cross-tenant denial is proved in Stage 2. The other eight need a real connector to exercise |
| Execution receipt, error vocabulary, `outcome_unknown` | **2** | Small and pure; every connector returns it |
| Task ledger below phase level (`awaiting_approval`, `outcome_unknown` states) | 4 | Belongs with the provider broker; `core/execution` is the candidate to wire |
| Webhooks and events | 4/5 | Needs a public inbound endpoint and a hosting decision that does not exist yet |
| Channel and mail/file adapters | 5+ | Owner order stands: Telegram → Email → Slack → Discord → WhatsApp (official API only) → phone app |
| Per-tenant spend limits | 4 | Ledgers are per checkout today (COST-CAP L-f); the provider broker is the right home |

## Stage 1 carry-forwards

| Carried item | Decision | Reason |
|---|---|---|
| ADR-K1 still Proposed | **In** (owner act, D3) | Stage 2 builds on it |
| Envelope, registry, R1–R5 are design only | **In** (phases 1, 3) | Named as Stage 2 work in CONTRACT1A |
| TRD says "no `engines`"; baseline counts stale; plan 0.3 unticked though answered ("Keep the current key") | **In** (phase 1 docs sync) | Cheap, and they mislead the next reader |
| Agency: validate-site bypasses (plan 1.8), empty-`Expires:` fixture | **Out**, to an agency-plan phase before Stage 5 | Agency repo, not the tenant boundary. Plan 1.7 and 1.8 stayed unticked when Stage 1 was called complete; the plan will say where they went |
| Signed authority commits (plan 1.7) | **Out**, revisit before Stage 5 | Signing would stop the transcribed-decision commits that keep owner acts near zero. Until then the owner-last-commit check rests on a git name, and the ADR says so |
| Host committed-bytes policy, phase-label parity, Windows Hello lift | **Out**, stay bound to Host service start | Stage 2 starts no service |
| Codex can read `~/.codex`; UNC gaps; reading rule | **Out**, to Stage 4.3 | Same root cause as F7; revisit before untrusted code |
| Durable rejected-review record; correction budget per resume | **Out**, to Stage 4 | Real but not tenancy; `verification.ts` stays protected here |
| `.txt` in `pathsNamedIn`; production correction maximum; owner-named reviews route | **Out** | Owner design items with no current need |
| Authoring ports fail-open (M2) | **Out**, to Stage 4.2 | Unwired today |
| `projectos stop` never tried in a real terminal | **Out**, owner's one-minute check when convenient | Not a Stage 2 dependency |

## Zone 1 — ADDED

| File | Phase | Purpose |
|---|---|---|
| `docs/adr/ADR-T1-tenant-boundary.md` | CONTRACT | Principal, tenant versus domain, registry trust basis, worktree rule, credential classes, owner-sees-both, service-role bypass, account-wide `stop-work` accepted for one owner, the one-user limit |
| `projectos/security/tenant-registry.json`, `projectos/security/action-registry.json` | CONTRACT | Installation records, committed-bytes only |
| `projectos/schemas/tenant-registry.schema.json`, `connector-registry.schema.json` | CONTRACT, CONNECTOR | New schemas; no existing schema changes |
| `projectos/core/src/tenant.ts`, `taskEnvelope.ts`, `actionRegistry.ts`, `connectorContract.ts` | CONTRACT, CONNECTOR | Pure rules, no I/O |
| `projectos/agent/src/installation/tenantRegistry.ts` | PRINCIPAL | Committed-bytes reader; validates the whole file first |
| `projectos/agent/src/commands/tenant.ts` | PRINCIPAL | `tenant show`, read-only |
| `projectos/control-center/supabase/migrations/0003_default_privileges.sql` | RLS | Owner decision D7: new objects in `public` start locked. Existing objects keep their grants |
| `projectos/control-center/supabase/migrations/0001_baseline.sql`, `0002_tenant_boundary.sql` | RLS | Forward-only, transactional. `0001` holds no policies and no seed |
| `projectos/control-center/supabase/test/` (harness, `auth` stub, assertions, privilege gate, `live-preflight.sql`) | RLS | Throwaway local cluster, adapted from the watchdog harness |
| `projectos/connectors/registry.json` | CONNECTOR | Empty list, schema-valid, so the first connector has a home |
| `projectos/validators/val-projectos-tenant-contract1a.cjs`, `-tenant-rls1a`, `-tenant-principal1a`, `-tenant-credentials1a`, `-tenant-csp1a`, `-connector-contract1a` | each | One rule per pin, each with named mutations |
| Tests under `projectos/core/test/`, `agent/test/`, `control-center/test/` | each | Behavioural tests beside their peers |
| `docs/finish/<phase>.md` and closure records | each | Evidence |

## Zone 2 — MODIFIED (several are PROTECTED in `00_Baseline_State.md` §4; approving this delta approves exactly these)

| File(s) | Phase | Why |
|---|---|---|
| **Protected** `projectos/control-center/supabase/schema.sql`, `interactive.sql` | RLS | Retired to a header pointing at `migrations/`, so a re-run cannot reopen `using(true)` (F3) |
| **Protected** `projectos/credentials/vault.cjs`, `reference.cjs`, `operation-gate.cjs`, `credential-metadata.cjs`, `projectos/scripts/projectos-credential-router.cjs` | CREDENTIALS | Requester context; tenant and platform classes; case-insensitive reserved segment; bound mutators; `reach` declaration; durable audit |
| `projectos/session-router/router.cjs`, `session-profiles.cjs` | CREDENTIALS | Pass the derived tenant; refuse a mismatch or a too-wide reach |
| **Protected** `projectos/security/gatekeeper-transport-broker.cjs`, `trust-boundary.json` | CREDENTIALS, CONTRACT | Broker admission carries the derived tenant; the two new records are listed in the trust boundary |
| **Protected** `projectos/control-center/sidecar/host.mjs` | PRINCIPAL | Envelope at project selection and governed verbs |
| **Protected** `projectos/agent/src/commands/run.ts` (one entry refusal only; `composeGatekeeper` and route logic untouched) | PRINCIPAL | `TENANT_UNKNOWN` before a worker starts. Same pattern as the platform stop |
| `projectos/agent/src/governedContext.ts`, `projectos/agent/src/mcp/bridge.ts` (holds `appendRefusal`), `projectos/agent/src/cli.ts` | PRINCIPAL | Derive tenant; bridge checks tenant as well as `boundProjectIds`; wire `tenant`; refusals fail closed |
| `projectos/control-center/src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json` | CSP | **[OWNER]** The CSP; capability review |
| `projectos/control-center/src/data/supabase.ts`, `src/data/auth.ts`, `test/authBootstrap.test.tsx` | RLS | Remove dead `fetchProjects` and its silent seed fallback; correct false "public read-only" comments |
| **Protected, added after the Plan Mode approval; approved only by `plan decide` for v1.28** `projectos/validators/val-projectos-credential-vault1a.cjs`, `val-projectos-credential-router-adversarial1a.cjs`, `val-projectos-session-router1a.cjs` | CREDENTIALS | The operation path gains a requester argument, so these pins must learn the new call shape. No existing rule is weakened |
| `projectos/core/src/index.ts` | CONTRACT, CONNECTOR | Barrel exports for the new pure modules |
| **Protected** `projectos/validators/validate-all.cjs`, plus `projectos/speed/cached-runner.cjs` | each | Registration only |
| `docs/00_Baseline_State.md`, `01_PRD.md`, `04_TRD.md`, `05_Schema.md`, `06_Plan.md`, `docs/adr/ADR-K1-kernel-contract.md` (status only) | CONTRACT, all | Record the model; expand Stage 2 in the plan; tick boxes with evidence |

## Zone 3 — PROTECTED (do not touch in v1.28)

- **Closure authority:** `core/src/closureAuthority.ts`, `closureEligibility.ts`, `closureDecision.ts`,
  `closureTransport.ts`; `agent/src/closureGate.ts`, `closureWait.ts`, `commands/closure.ts`,
  `commands/phase.ts`.
- **Owner floor:** `core/src/ownerOnlyActions.ts`, `permissions.ts`, `phase.ts`, `ownerGateReceipt.ts`,
  `technicalContinuation.ts`, `gatekeeperDecision.ts`, `gatekeeperMode.ts`, `gatekeeperTransport.ts`.
- **Gatekeeper composition and spend:** everything in `commands/run.ts` except the one entry refusal
  above; `loop/gatekeeperConfig.ts`, `gatekeeperHandoff.ts`, `technicalContinuation.ts`.
- **Write grants and judges:** `loop/workers.ts`, `pinnedValidators.ts`, `verification.ts`,
  `correctionBoundary.ts`, `candidateIdentity.ts`, `localCandidateCommit.ts`.
- **Governance engines and existing schemas:** `planApproval.ts`, `planDecision.ts`, `governanceEngines.ts`,
  `validators/plan-*-engine.cjs`, `project-plan.schema.json`, `current-project-state.schema.json`.
- **Allowlist and spend:** `security/installation-project-allowlist.json`, `.projectops/gatekeeper.json`.
  The exit proof spends nothing, so no temporary entry is needed.
- **Elsewhere:** `credentials/windows-credential-store.*`, `projectos/host/**`, `projectos/watchdog/**` (the
  harness is copied from, not changed), every existing `.projectops/` authority record, the agency repo,
  root `CLAUDE.md`.

## Exit proof

Three real projects, spend $0: `projectos` and one more in `owner-personal`, `seo-agency` in
`agency-business`. The second same-tenant project is what makes the proof able to fail.

**Each claim is a named test with a named mutation. A proof counts only if removing that rule makes it
fail. A refusal that another rule or a fail-closed default would produce anyway does not count.**

**Database, on a throwaway local cluster, exact migration bytes, applied twice by a non-superuser owner,
both tenants seeded:**
- A member of A sees A's rows (positive control) and zero of B's, in all four tables.
- Update and delete of B's rows change nothing. Insert with B's `tenant_id`, stealing a B row to A, and
  pointing a phase at B's project are refused.
- A non-owner member cannot write. Clients cannot write `tenants` or `tenant_members`. `TRUNCATE` is refused.
- A user who owns **both** tenants still cannot change `tenant_id`, so the column grant is what is tested.
- `anon`, an authenticated non-member and null-claims `authenticated` read nothing.
- The ported privilege gate reports nothing, judged on effective privileges.
- Mutations that must fail the harness: `using(true)`; `auth.uid() is not null`; a `to public` policy; USAGE
  on `private` granted to `anon`; an added public function.

**Live, read-only, after the owner's apply:** sign-up disabled; no permissive policy on any public table;
tables out of realtime; anon reads nothing.

**Kernel, against the real committed registry:**
- A tenant secret is released to a second project in the same tenant (positive control) and refused across
  tenants. Only the tenant rule can decide this.
- With the project check disabled by mutation, a session and a bridge read across tenants are still refused.
- A child envelope naming the same project and another tenant is refused (R3).
- A tenant named in agent text, argv or environment changes nothing (R2).
- The operation path refuses a requester outside the reference's project. This fails on today's code.
- An account-wide token is not projected into another tenant's session.
- An unlisted project, a duplicate registry entry and a non-owner last commit are each refused by name.
- A refusal that cannot be recorded stops the operation.

## What Stage 2 does not prove

Stated in ADR-T1 and in the evidence:
- **A worker can still reach any tenant's secrets and files** outside the kernel, as the owner's Windows user
  (F7). Stage 2 stops the kernel's routes and the database. The real fixes are Host service custody for
  secrets and Stage 4.3 isolation for files. **No second party's data or credentials go on this machine
  until both are done.**
- **The registry's owner check rests on a git name** until signed commits exist.
- **No product flow uses the tenant tables yet** (F2). The database boundary is proved by the harness.
- **Eight of the nine connector scenarios** are defined here and first run in Stage 5.
- **One owner sees both tenants**, by membership.

## Design review disposition

Reviews of revision 1, before any code. Agency corpus `ad9264e3`.

- **`ecc:database-reviewer`:** design sound, proof not. All accepted: 1 CRITICAL (backfill could bless
  stranger-written rows), HIGH (table grants including `TRUNCATE`, helper grants, realtime, harness blind
  spots), MEDIUM (performance, ordering, global id oracle, ADR caveats). FORCE RLS not used, as it advised.
- **`identity-access-engineer`:** advisory BLOCK as drafted. All accepted, verified by the lead:
  - F1 CRITICAL, unearned goal: confirmed from the credential store source and CODEX-LIVE1A. Not run live.
  - F2 operation path: confirmed at `operation-gate.cjs:174,185,222`.
  - F3 undiscriminating proof: confirmed; the proof is rebuilt around it.
  - F4 token reach: projection confirmed in code; Supabase token scope is not confirmed live, so it is
    declared per credential rather than assumed.
  - F5 no joined principal: confirmed at `host.mjs:746`.
  - F6 registry forgeable by commit: confirmed at `projectAllowlist.ts:134-150`.
  - F7 existing accounts: confirmed; anonymous sign-in and other providers checked live, both off.
  - F8–F11: accepted. Windows target case behaviour is a phase 4 test, not yet verified.

## Owner decisions (2026-11-01, answered in Plan Mode, verbatim)

1. **D1 — Sign-up:** "Yes, today (Recommended)". The owner switches sign-up off and checks the Users list.
   **Live apply:** "Connect the plugin (Recommended)". Applied only after the owner's yes and a passed preflight.
2. **D2 — Tenants:** "Agency apart, rest mine (Recommended)". `agency-business` holds the SEO agency;
   `owner-personal` holds ProjectOS, PolyGo and all the others. PolyGo is the second project in the proof; its
   repo is not touched.
3. **D3 — ADR-K1:** "Accept it (Recommended)".
4. **D4 — Worker reach:** "Accept for now, with a rule (Recommended)". No other party's data or credentials on
   this machine until Stage 4 isolation and service-held secrets are done.
5. **D5 — Connectors:** "Rules now, connectors later (Recommended)".
6. **D6 — CSP:** "Approve strict policy (Recommended)".

7. **D7 — Live route (2026-11-01, plan v1.28 decision):** "Not mcp but use the PAT". The Management API replaces the plugin.
8. **D8 — Live apply (2026-11-01):** "Yes, apply it now (Recommended)". Applied the same day from the reviewed bytes, preflight and
   post-check passed. Sign-up was found still open; on the owner's "Yes, switch it off (Recommended)" it was closed through the same route.
9. **D9 — New objects (2026-11-01):** "Yes, lock by default (Recommended)". Adds `0003_default_privileges.sql` through plan v1.29.
10. **D10 — ADR-T1 (2026-11-01):** "Accept it (Recommended)", with projectos and polygo in Develop and seo-agency in Business.
11. **D11 — Agency client data (2026-11-01):** asked whether SEO agency client data counts as other party's data under D4, the owner answered "No for now". Revisit before Stage 5.

Owner acts still to come: switch sign-up off and check Users; run `/mcp` to sign in to Supabase; `plan decide`
for v1.28; yes to the live apply; adding the owner's Supabase account to the tenants, because the login email
is not stored in the repo.

## Impact and risk

- **Risk is high.** This touches credentials, the broker, the sidecar and production RLS. Mitigations: one
  rule per validator pin, ECC DATABASE and ECC SECURITY reviews, and the live apply stays the owner's.
- **Behaviour change.** An unlisted project is refused until it is added to the registry; the Add Project
  wizard is not changed until Stage 6, so a new project needs one owner commit. An account-wide token stops
  auto-loading into other tenants' sessions. A wrong CSP can blank the app, which is why it is proved in a
  real webview.
- **Disk.** C: has 30.6 GB free. A Tauri release build for the CSP proof needs several GB; use the debug
  bundle unless the MSI is being rebuilt.
- **Reversibility.** Code phases revert per phase. The live migration is forward-only and transactional, the
  rows are few and exported first, and undoing it is a new migration.
