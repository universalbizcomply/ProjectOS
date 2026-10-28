# 05 — Schema

ProjectOS has **three data layers**. Only the first is authority.

1. **Governed JSON records** in git (`.projectops/`): the system of record for governance.
2. **Control Center cloud tables** (Supabase Postgres, optional): `public.projects`, `public.phases`.
3. **Watchdog** (Postgres, optional): schema `watchdog`.

## 1. Relational: Control Center cloud (`projectos/control-center/supabase/`)

### `public.projects` (`schema.sql`)

| Column | Type | Constraints |
|---|---|---|
| `id` | text | **PK** |
| `name` | text | not null |
| `repo` | text | not null, default `'none'` |
| `install_status` | text | not null, default `'installed'` |
| `production_freeze` | boolean | not null, default `true` |
| `open_phases` | integer | not null, default `0` |

### `public.phases` (`interactive.sql`)

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | **PK**, default `gen_random_uuid()` |
| `project_id` | text | not null, **FK → `public.projects(id)` on delete cascade** |
| `phase_id` | text | not null |
| `objective` | text | not null, default `''` |
| `status` | text | not null, default `'draft'` |
| `history` | jsonb | not null, default `'[]'` |
| `advisor_note` | text | not null, default `''` |
| `created_at` | timestamptz | not null, default `now()` |
| — | — | **unique `(project_id, phase_id)`** |

**Indexes:** the primary keys and the unique constraint only.

**RLS:** enabled on both tables. The policies:
- `"projects authenticated read"`: select, `to authenticated`, `using (true)`;
- `"projects authenticated write"`: all, `to authenticated`, `using (true) with check (true)`;
- `"phases authenticated all"`: all, `to authenticated`, `using (true) with check (true)`.

> **Risk (baseline §5.1):** any authenticated account can read and write every row. The policies
> should bind to the owner's `auth.uid()`. Owner decision needed. `PROTECTED` until then.

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
  Supabase email/password ──▶ JWT (authenticated role) ──▶ RLS policies on public.projects/phases
  watchdog: service_role only, via SECURITY DEFINER functions
```
