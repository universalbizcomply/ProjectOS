# 05 — Schema

ProjectOS has **three data layers**. Only the first is authority.

1. **Governed JSON records** in git (`.projectops/`): the system of record for governance.
2. **Control Center cloud tables** (Supabase Postgres, optional): `public.tenants`, `public.tenant_members`,
   `public.projects`, `public.phases`.
3. **Watchdog** (Postgres, optional): schema `watchdog`.

## 1. Relational: Control Center cloud (`projectos/control-center/supabase/`)

The schema is defined by the forward-only migrations `migrations/0001_baseline.sql` and
`migrations/0002_tenant_boundary.sql`. `schema.sql` and `interactive.sql` are retired, hold no SQL and
do nothing when run. These tables are not authority, and a Supabase identity carries no kernel authority.

> **Live state:** this section is the migrations. They are proved on a local cluster
> (`docs/finish/PROJECTOS-TENANT-RLS1A.md`). Until the owner's live apply, the live project still has the
> old shape: two tables with `using (true)` policies.

### `public.tenants`

| Column | Type | Constraints |
|---|---|---|
| `id` | text | **PK**; the tenant slug the registry uses: `owner-personal`, `agency-business` |
| `name` | text | not null |
| `created_at` | timestamptz | not null, default `now()` |

### `public.tenant_members`

| Column | Type | Constraints |
|---|---|---|
| `tenant_id` | text | not null, **FK → `public.tenants(id)`** |
| `user_id` | uuid | not null, **FK → `auth.users(id)` on delete cascade** |
| `role` | text | not null, check `owner` or `member` |
| `created_at` | timestamptz | not null, default `now()` |
| — | — | **PK `(tenant_id, user_id)`** |

### `public.projects`

| Column | Type | Constraints |
|---|---|---|
| `id` | text | not null |
| `name` | text | not null |
| `repo` | text | not null, default `'none'` |
| `install_status` | text | not null, default `'installed'` |
| `production_freeze` | boolean | not null, default `true` |
| `open_phases` | integer | not null, default `0` |
| `tenant_id` | text | not null, **no default**, **FK → `public.tenants(id)`** |
| — | — | **PK `(tenant_id, id)`**, so an id cannot reveal another tenant's row |

### `public.phases`

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | not null, default `gen_random_uuid()` |
| `project_id` | text | not null |
| `phase_id` | text | not null |
| `objective` | text | not null, default `''` |
| `status` | text | not null, default `'draft'` |
| `history` | jsonb | not null, default `'[]'` |
| `created_at` | timestamptz | not null, default `now()` |
| `advisor_note` | text | not null, default `''` |
| `tenant_id` | text | not null, **no default** |
| — | — | **PK `(tenant_id, id)`** |
| — | — | **FK `(tenant_id, project_id)` → `public.projects(tenant_id, id)` on delete cascade**, so a phase cannot point at another tenant's project |
| — | — | **unique `(tenant_id, project_id, phase_id)`** |

**Indexes:** the keys above, which lead with `tenant_id`, plus `tenant_members_user_id_idx (user_id)` for
the helper path.

**Grants (the first wall).** All privileges are revoked from `public`, `anon` and `authenticated`.

| Role | `tenants`, `tenant_members` | `projects` | `phases` |
|---|---|---|---|
| `anon` | nothing | nothing | nothing |
| `authenticated` | select | select, insert, delete; update of `name`, `repo`, `install_status`, `production_freeze`, `open_phases` | select, insert, delete; update of `phase_id`, `objective`, `status`, `history`, `advisor_note` |

No client role holds `TRUNCATE`, and no client can update `tenant_id`, `id` or `project_id`.
`service_role` keeps its Supabase defaults and bypasses RLS (ADR-T1). Supabase's default privileges still
apply to any future object in `public`, so a new table or function must revoke them itself.

**Upserts.** A client upsert whose `SET` lists `tenant_id` or `id` fails with `permission denied`, by design:
Postgres checks the `UPDATE` column grant before it knows whether a conflict will happen. `supabase-js`
`.upsert()` builds that `SET` from every column in the payload, so it hits this with a normal row. Do not fix
that by granting `tenant_id`: that grant is the wall that stops a user who owns both tenants moving a row
between them. When Stage 5/6 first writes these tables, it should use a plain insert for new rows and an update
that names only the granted columns and filters on `tenant_id` and `id`. If a flow really needs one atomic
upsert, make it a reviewed server-side function in a new migration whose `SET` omits `tenant_id` and `id`.

**RLS:** enabled on all four, not forced. Every policy is `to authenticated`.

| Table | Read | Write |
|---|---|---|
| `tenants` | `id in (select private.my_tenant_ids())` | none |
| `tenant_members` | `user_id = (select auth.uid())`: a user sees only their own rows | none, so nobody can add themselves |
| `projects`, `phases` | `tenant_id in (select private.my_tenant_ids())` | insert, update and delete: `tenant_id in (select private.my_owned_tenant_ids())` |

**Helpers:** schema `private`, `private.my_tenant_ids()` and `private.my_owned_tenant_ids()`: stable,
security invoker, `search_path ''`, no argument. Usage of `private` and execute are granted to
`authenticated` only. There is no RLS recursion because the `tenant_members` policy does not call them.

**Realtime:** all four tables are out of `supabase_realtime`, because delete events are not RLS-filtered.

**Backfill:** `0002` maps the 12 existing projects to `owner-personal` by an explicit list of their seed values
and raises on any row the list does not name or whose content differs. It refuses to run as anyone but
`postgres`. Owner membership is a separate step, `test/live-owner-membership.sql`, so the migrations hold no
personal identifier.

**Live checks:** `test/live-preflight.sql` before the apply and `test/live-postapply.sql` after it. Both are one
read-only SELECT.

## 2. Relational: Watchdog (`projectos/watchdog/sql/migrations/0001_watchdog_schema_v1.sql`)

All tables live in schema `watchdog`. Validation helpers (`_is_token`, `_is_scope_id`, `_is_code`,
`_metadata_is_safe`) back the CHECK constraints.

| Table | Key columns | PK / FK / unique | Indexes |
|---|---|---|---|
| `schema_migrations` | `version int (≥1)`, `applied_at` | PK `version` | — |
| `meta` (singleton) | `project`, `environment`, `installed_core_version (semver)`, `configured_at`, `updated_at` | PK `singleton boolean default true check(singleton)` | — |
| `run` | `run_id uuid`, `project`, `environment`, `source`, `status ('STARTED','SUCCEEDED','FAILED')`, `started_at`, `results_committed_at`, `completed_at`, `failure_stage`, `expected_check_count`, `actual_check_count`, `watchdog_core_version`, `schema_version` | PK `run_id`; checks: STARTED ⇔ `completed_at` null; SUCCEEDED ⇒ results committed | `run_source_started_idx (source, started_at desc)`; `run_finished_started_idx (started_at) where status <> 'STARTED'` |
| `check_result` | `id bigint identity`, `run_id`, `check_id`, `scope_type`, `scope_id`, `status ('PASS','INFO','WARN','CRITICAL','ERROR')`, `reason_code`, `metadata jsonb (safe)`, `recorded_at` | PK `id`; **FK `run_id → run` cascade**; unique `(run_id, check_id, scope_type, scope_id)` | `check_result_recorded_idx (recorded_at)` |
| `incident` | `incident_id uuid`, identity (`project`, `environment`, `source`, `check_id`, `scope_type`, `scope_id`), `state ('OPEN','RESOLVED','RETIRED')`, `severity ('WARN','ERROR','CRITICAL')`, timing and notification fields, `retired_*` | PK `incident_id`; **FK `opening_run_id → run`**, **FK `resolution_run_id → run`**; state-consistency checks | **unique `incident_one_open_per_identity (project, environment, source, check_id, scope_type, scope_id) where state = 'OPEN'`** |
| `notification` | `id bigint identity`, `run_id`, `incident_id`, `kind ('INITIAL','ESCALATION','REMINDER','RECOVERY')`, `outcome ('ACCEPTED','FAILED')`, `provider_code`, `attempted_at` | PK `id`; **FK `run_id → run` set null**; **FK `incident_id → incident` cascade** | `notification_attempted_idx (attempted_at)` |
| `job` | `job_id`, `scheduler_name`, `expected_interval_s`, `stale_after_s (≥ interval)`, `max_run_s`, `failure_threshold`, `last_*` timestamps, `consecutive_failures`, `last_run_id` | PK `job_id` | — |
| `release_identity` | `component`, `release_sha (7–40 hex)`, `deployment_id`, `deployed_at`, `watchdog_core_version`, `schema_version`, `recorded_at` | PK `component` | — |
| `sentinel_liveness` (singleton) | `created_at`, `last_authenticated_probe_at` | PK `singleton` | — |
| `config` | `key` (one of four retention keys), `value int > 0` | PK `key` | — |

**RLS and privileges:**
- RLS is enabled on all ten tables, with **no policies**, so a mis-granted client reads nothing.
- All privileges are revoked from `public`, `anon`, `authenticated` and `service_role`.
- Access is only through `public.watchdog_*` SECURITY DEFINER functions (`search_path ''`):
  - configure and status: `watchdog_schema_version`, `watchdog_configure`, `watchdog_status`;
  - runs: `watchdog_run_start`, `watchdog_run_record_results`, `watchdog_run_commit`,
    `watchdog_run_finish`;
  - incidents: `watchdog_incidents_open`, `watchdog_incident_open`, `watchdog_incident_observe`,
    `watchdog_incident_mark_recovered`, `watchdog_incident_clear_recovery`,
    `watchdog_incident_notified`;
  - and others.
- Execute is granted to `service_role` only. `_assert_trusted_caller()` refuses other roles.

## 3. Governed JSON records (`.projectops/`, system of record)

**Tracked** in git unless marked *ignored*. Authority counts **only when committed** and is read via
`git show HEAD:`.

| Record | Key fields | Writer → reader |
|---|---|---|
| `project-config.json` | `projectId`, `owner`, `repo`, `planMemory.{planPath,currentStatePath}`, `execution.workers`, `forbiddenActions`, `approvalGates` | owner → `governedContext.ts` |
| `plan-<objective>-<digest>.json` | `planId`, `programmeId`, `phases[]` (`phaseId`, `writePaths`, `requiredValidators`, `requiredReviews`, `requiredOwnerGates`, `dependsOn`, `acceptanceCriteria`), `governance{owner, gatekeeper, closureAuthority, closureDelegation, ownerOnlyActions}`, `repository.planSourceBranch` | `planApproval.ts` → selection, grants, closure |
| `current-state-*.json` | `completedPhases`, `activePhase`, `acceptedPhaseCount`, `currentStatus` | `currentStateStore.ts` → selection, UI |
| `phases/<PHASE>.json` | `status`, `history[{from,to,by,at,note}]` | `phaseStore.ts` → governed context |
| `objectives/<id>.json`, `drafts/<id>.json` (*ignored*) | `authoritative:false`, `baseHead`, `planDigest` | `planIntake.ts` → decide/activate |
| `plan-decisions/PLANDEC-*.json` | `draftId`, `planDigest`, `baseHead`, `decidedBy`, `consumedAt` | `planDecision.ts` → `approvePlan` |
| `plan-withdrawals/*.json` | `retiresPlans`, `withdrawnPhases`, `ownerWords` | owner → plan discovery engine |
| `execution/<session>.brief/.session/.invocation/.evidence.json` | brief: plan, phase, boundaries. Evidence: `baseHead`, `currentHead`, `changedFiles`, `checks[]` (incl. `<name>@phase-copy`) | runner → closure gate |
| `execution/<session>.findings/.effects.json` | `reviews`, `findings`; six effect booleans | worker (its only grants) → runner |
| `gatekeeper.json` | `mode`, `route`, `transport.credentialRef`, `budget`, `rateCards`, `modelPolicy`, `threadBinding` | owner → mode resolution, broker |
| `gatekeeper-ledger.json` | `entries[{requestId, projectId, phaseId, model, usage, costMicroUsd, at}]` | locked admission → budget, replay |
| `gatekeeper-decisions/GKDEC-GKREQ-*.json` | `decision`, `allowedActions`, `subjectCommit`, `requestDigest`, `decidedAt` | create-only evidence (never authority) |
| `gatekeeper-interactive/GKREQ-*.{request,decision,consumed}.json` | handoff question and answer | interactive port |
| `validation/<sha>.json` | `subjectHead`, `aggregatePassed`, `results` | validate-all / prepare → G4-17 |
| `closure/<PHASE>.json` | `evidenceSubjectHead`, `baselineCommit`, `validatorsPass`, `checksPass`, `reviewsComplete`, `unresolvedHighIds`, `protectedEffects` | prepare (or hand-written for owner-direct closures) → G4 |
| `closure/decisions/<PHASE>.json` | `decisionId` (CLDEC-* or owner-closure id), `scope`, `decidedBy`, `decidedAt` (window-checked), `evidenceSubjectHead`, `decision`, `ownerAcceptedFindings`, `requestDigest`, `consumedAt` | closure turn → owner or ProjectOS commit → `phase advance` |
| `closure/waits/<PHASE>.json` (*ignored*) | `bundle[{path,sha256}]`, `headAtRequest`, `requestId`, `provenance`, `state` | `closure request` → `closure resume` |
| `authority/closure-delegation.json` | `delegatedBy`, `delegatedTo`, `delegatedScope[]`, `programmeScope`, `excludesProtectedActions`, `notes` | owner → `resolveDelegatedDecider` |
| `authority/plan-genesis.json`, `plan-approval-delegation.json`, `plan-authoring-permission.json`, degraded grants | owner identity and scopes | owner → plan approval, broker |
| `gates/<PHASE>.<gate>.json` | `gateName`, `ownerChoice (APPROVE\|REFUSE)`, `evidenceSubjectHead`, `consumedAt` | owner → owner-gate receipts, broker |
| `work.v1.json` | `state`, `gateDecisionId`, `nextCandidateAction` (explicitly not authority) | `workRecord.ts` → UI |
| `projectos/security/tenant-registry.json` (installation record, not `.projectops/`) | `tenants[{tenantId, name}]`, `projects[{projectId, repository, governedRoot, tenant, domain}]`; schema `tenant-registry.schema.json` | owner (P5 `tenant-registry-change`) → `parseTenantRegistry`, `resolveTenant` |
| `projectos/security/action-registry.json` (installation record, not `.projectops/`) | `actions[{id, governanceAction, ownerOnlyAction, class, environment}]` | owner → `parseActionRegistry`, `resolveAction` |

**Id formats:** PLANDEC-<24hex>, GKREQ-<24hex>, CLREQ-<24hex>, CLDEC-<same hash>, PAREQ-* (authoring).

## 4. Auth flow

```
Governed runtime (authority)
  owner = active plan governance.owner ──▶ owner acts are git commits judged by ownerCommitIdentityProblems
  committed authority/closure-delegation.json ──▶ scopes (phase-closure, …, closure-decision-commit*)
        * only if the owner made the last commit to that file
  committed gates/<PHASE>.secrets-handling.json + installation allowlist + broker opt-in ──▶ broker may spend
  agent process: unprovisionedResolver (no key)  ·  broker: Windows Credential Manager ──▶ OpenAI

Host IPC (dormant review route)
  local named pipe, PIPE_REJECT_REMOTE_CLIENTS ──▶ client token SID must equal the enrolled owner SID

Control Center cloud (optional, non-authority)
  Supabase email/password ──▶ JWT (authenticated role, grants no kernel authority)
    ──▶ table grants ──▶ tenant RLS on public.tenants, tenant_members, projects, phases
        (once the owner has applied the migrations; until then, the old policies)
  tenant membership: public.tenant_members, no client write path
  service_role bypasses RLS and is never used by the Control Center
  watchdog: service_role only, via SECURITY DEFINER functions
```
