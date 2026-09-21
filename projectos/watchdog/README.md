# ProjectOS Watchdog

Watchdog is a first-class ProjectOS capability: **centrally managed, distributed execution.**
ProjectOS owns the canonical source, versioning, templates, sync tooling, conformance and
the outer-sentinel configuration. Each product runs its own Watchdog runtime, with its own
database state, incidents, credentials, recipients and alerts. No product ever calls
ProjectOS at build time or runtime.

Phase: PROJECTOS-WATCHDOG-CORE1A (P2). Watchdog Core `0.1.0`, schema `1`. Nothing in this
directory is deployed to any product by this phase.

## Layout

| Path | What it is |
|---|---|
| `core/src/` | Watchdog Core. Dependency-free TypeScript (erasable syntax only), runs unchanged in Deno (Supabase Edge Functions) and Node 24. |
| `core/test/` | Core tests (`node --test`). Not shipped to products. |
| `sql/migrations/NNNN_*.sql` | Schema template, forward-only. `NNNN` = schema version. |
| `sql/privilege-gate.sql` | Mandatory gate: must return zero rows in every product after deploy. |
| `sql/test/` | Live PostgreSQL harness (throwaway local cluster) and assertions. Not shipped. |
| `sentinel/` | Outer sentinel runner + workflow template + example registry. Canonical source only; executed later from a generated repository under `universalbizcomply`. |
| `templates/` | Product adapter skeleton and profile template. |
| `../schemas/watchdog-*.schema.json` | Profile, lock and sentinel-registry contracts. |
| `../scripts/watchdog-sync.cjs` | Sync a reviewed release into a product (vendored copy + lock). |
| `../scripts/watchdog-sentinel-registry.cjs` | Generate / verify the sentinel registry. |
| `../validators/val-watchdog-core1a.cjs` | Canonical-source validator (in `validate-all`). |
| `../validators/val-watchdog-conformance.cjs` | Product conformance (definition of done), `--target <product>`. |

Commands: `npm run watchdog:test`, `npm run watchdog:test:sql`, `npm run validate:watchdog`,
`npm run watchdog:sync -- --target <dir> --tag watchdog-core/vX.Y.Z`,
`npm run watchdog:conformance -- --target <dir>`.

## Responsibilities

| Watchdog Core owns | Product adapter / runtime owns |
|---|---|
| Run lifecycle and run truth (STARTED / SUCCEEDED / FAILED, SUCCEEDED written last) | Business checks (booking, payment, invoice, order, POS, device rules) |
| Status contract PASS / INFO / WARN / CRITICAL / ERROR | Provider-specific health logic |
| Incident identity, ownership, severity, deduplication | Thresholds that are genuinely domain-specific |
| Positive recovery | Scheduling (pg_cron), secrets, recipients |
| Notification planning and retry truth (transport abstract) | Local database state and local incidents |
| Typed / allowlisted metadata | Site, device and component scopes |
| Scheduled-job health model | Its health / release endpoints (from P4) |
| Release-identity model, version and schema compatibility | |

## Contracts (v0.1.0)

- **Status.** `ERROR` = the check could not establish health. It is never PASS, never recovery
  and never absence. A check that threw, returned an invalid result or did not report is recorded
  as `ERROR` (`PACK_FAILED` / `INVALID_RESULT` / `NOT_REPORTED`), never omitted. `INFO` never
  opens or recovers an incident.
- **Run.** `run_id, project, environment, source, started_at, completed_at, status, failure_stage,
  expected_check_count, actual_check_count, watchdog_core_version, schema_version`. Results must
  be committed (database read-back) before anything can be opened or recovered. Scheduler
  invocation alone is never success.
- **Incident identity.** `project + environment + source + check_id + scope_type + scope_id`; one
  open incident per exact identity (enforced by a partial unique index).
- **Ownership and positive recovery.** A source resolves only its own incidents, only on explicit
  `PASS` for the same identity from a committed, non-failed run. Missing, `ERROR`, `INFO`, failed
  or uncommitted runs never recover. Recovery evidence is withdrawn when a later committed run
  shows ERROR, INFO or no result, and the database closes an incident only when the run sending
  the RECOVERY notice itself shows PASS. The JD reference behaviour "run did not report X, so
  delete X" is removed. Removed checks are closed only by the audited `watchdog_incident_retire`.
- **Failure isolation inside a run.** Each incident action and each notification mark is attempted
  independently; one refused incident never blocks the alerts of the others, and the run then
  FAILS truthfully. A runner given `selfJobId` records its own job STARTED / SUCCEEDED / FAILED,
  so a runner that keeps failing becomes a stale job for the separate watchdog source even when
  it can no longer notify anything itself.
- **Notification truth.** Notifications are derived from incident state (INITIAL, ESCALATION
  ignoring cooldown, REMINDER after the per-severity cooldown, RECOVERY). Only an accepted
  delivery advances state; recovery closes the incident only when its notice is accepted. A
  failed delivery fails the run and is retried next run: duplicates are possible, lost alerts
  are not. Email content is bounded (no metadata).
- **Metadata.** Each check declares allowlisted keys and types (integer, number, boolean,
  timestamp, uuid, code, enum). No free text, so no customer data, addresses, payment identities,
  payloads, stack traces or credentials. The database enforces the same shape.
- **Job health.** `job_id, expected_interval_s, stale_after_s, max_run_s, failure_threshold`,
  plus `last_started / last_success / last_failure / running_since / consecutive_failures`.
  Detects not registered, schedule missing / disabled (pg_cron), hung, never succeeded, stale,
  repeated failure.
- **Release identity.** Internal: `project, environment, release_sha, deployment_id?,
  deployed_at?, watchdog_core_version, schema_version`. Public: `{status, service, environment,
  release (7-char), watchdog}` only; coarse monitor state only if a product's security review
  allows it. Product endpoints arrive in P4, not P2.
- **Versions.** `WATCHDOG_CORE_VERSION` (semver) and `REQUIRED_SCHEMA_VERSION` (integer) are
  independent. v0.1.0 requires exactly schema 1 and refuses (truthfully, before starting a run)
  a missing, older or newer schema, or an installed core of another 0.x minor.

## Security model (schema template)

Private schema `watchdog`; RLS on every table and no policies; no client schema usage, table
privileges or function EXECUTE. The only entry points are `public.watchdog_*`: SECURITY DEFINER,
`search_path = ''`, EXECUTE for `service_role` only, and each calls
`watchdog._assert_trusted_caller()`, which refuses any active role other than `service_role`
(or a session with no SET ROLE: migrations, pg_cron). The database re-checks evidence for
opening, observing and recovering incidents. Every function is sweep-revoked after creation
because platform default privileges can re-grant EXECUTE (the JD lesson); every future migration
that defines a `public.watchdog_*` function must end with the same sweep (enforced by
`val-watchdog-core1a`). **The privilege gate is mandatory after every product deploy**; the guard
is defence in depth, not a waiver. The gate also fails if `anon`, `authenticated` or
`service_role` can log in directly (the guard assumes Supabase's authenticator topology), or if
any Watchdog table or function is owned by a role other than the schema owner (entry points
rely on owner RLS exemption).

Proven on a live throwaway PostgreSQL cluster shaped like Supabase (`sql/test/pg-harness.cjs`):
replay-safe, gate clean, gate detects a re-granted function, anon/authenticated refused even
when mis-granted, ownership, positive recovery, metadata guard, jobs, release identity,
sentinel liveness, retention.

## Versioning, release and product pinning

1. Change `core/` and/or add `sql/migrations/NNNN_*.sql` (never edit a shipped migration).
2. Bump `core/package.json` + `WATCHDOG_CORE_VERSION`; bump `REQUIRED_SCHEMA_VERSION` only when a
   migration is added. A ProjectOS release is not a Watchdog release.
3. Review, then tag `watchdog-core/vX.Y.Z` in `universalbizcomply/ProjectOS` (no tag is created by P2).
4. `watchdog-sync --target <product> --tag watchdog-core/vX.Y.Z` reads the files from the tagged
   commit, writes the vendored copy and `watchdog-core.lock.json`, and reports required schema
   upgrades. It refuses to overwrite a modified vendored copy or foreign files, never touches the
   product adapter, and never commits, deploys or applies migrations.
5. The product reviews the diff, adds any schema upgrade as a new timestamped product migration,
   and deploys through its own approved route. Product CI / conformance re-hashes the vendored files.

Sync is not atomic: if it is interrupted mid-write, the next sync refuses (vendored copy no longer
matches its lock). Restore the install path and lock from the product's git history and re-run.

Products never fetch from ProjectOS or GitHub at build or runtime; no submodules, no registry.
ProjectOS reads each product's lock to show which Watchdog version it runs.

## Onboarding states (profile `onboarding_status`)

`NOT_INTEGRATED -> DISCOVERED -> PARTIAL -> WATCHDOG_INSTALLED -> CONFORMANT -> OUTER_SENTINEL_ACTIVE`.
Requirements tighten per state (see `val-watchdog-conformance.cjs`). Legacy products move one step
at a time; new ProjectOS-created projects must reach CONFORMANT before production acceptance. The
enforceable gate today is the evidence pack for Owner closure.

## Outer sentinel

Source here; execution in a separate private repository under `universalbizcomply` (P3). One job,
sequential probes, per-product isolation (a failure in A never stops B). Registry generated from
ProjectOS-controlled config (`project-config.environments.<env>.url` + the Watchdog profile),
committed through a reviewed change, stamped with source commit and content hash. The sentinel
never calls ProjectOS. Alerts: GitHub's native workflow-failure notification plus one
deduplicated issue per project / environment / check class, closed only on explicit PASS.
P3 probes are public and read-only and write nothing into products; **an unauthenticated probe
can never advance a product's sentinel liveness** (`mayAdvanceSentinelLiveness`). Only from P4,
with a product-scoped sentinel credential, may a product record authenticated probes and raise
`monitoring_sentinel_stale`. Schedule activation is gated on the Actions budget (no paid overage).

## Failure independence

| Failure | Effect |
|---|---|
| ProjectOS offline / its database or UI offline | Product Watchdogs continue; local alerts continue; sentinel continues. |
| Owner PC offline | Products continue; GitHub sentinel continues. |
| GitHub offline | Products continue; outer sentinel unavailable. |
| Product and GitHub down together; internet-wide outage | Not guaranteed to alert (accepted residual). |

## Maintenance contract (interface only; no automation in v1)

Incident reference passed to ProjectOS: `project, environment, source, component, check_id,
scope_type, scope_id, release, run_id, incident_id` (no monitoring payload). `component` maps via
the profile's `components` to `repo_path` and `deploy_target`. Flow: incident -> ProjectOS
MAINTENANCE phase -> bounded read-only evidence -> diagnosis -> Owner authorisation -> change ->
tests -> approved deploy -> explicit Watchdog PASS for that identity at the new release ->
phase closure. Watchdog v1 detects, records, alerts and provides evidence only. No automatic
remediation; payments, customer data, database and configuration changes always need the Owner.

## ProjectOS itself

ProjectOS is an ordinary Watchdog-managed product with no exemption: its hosted surfaces get a
local runtime and a sentinel entry like any product (onboarded in a later phase).

## V2/V3 integration seam

P2 lands on `main` and depends on nothing that exists only on the unmerged V2/V3 branch. After
that branch merges, PROJECTOS-WATCHDOG-V3-RECONCILIATION wires in, without rewriting the core:
`projectos install` (profile + sync during onboarding), the credential router (product-scoped
sentinel and deploy credentials), Mission Control / Control Center (read-only Watchdog view from
locks, sentinel issues and status summaries), new phase types (`WATCHDOG_INTEGRATION`,
`MAINTENANCE`) and project-registry additions.

## Retention

Periods are product configuration (`watchdog_config_set`), not frozen in the core.
`watchdog_purge()` refuses to run until all four are set, and never removes open incidents or
the runs they reference. Production periods are decided before product rollout.

## JD reference (c8f2445) reuse

| JD component | Became |
|---|---|
| `evaluateWatchdog`, stale / repeat / recovery decisions | CORE: `jobs.ts` (job health) + `notifications.ts` |
| `health-monitor-run.ts` stage runner, heartbeat last, read-back count | CORE: `runner.ts` |
| `planNotifications` (new / escalation / cooldown / recovered) | CORE: `notifications.ts` (state-derived, escalation ignores cooldown) |
| `watchdogLivenessFinding` (mutual liveness) | CORE: job-health model for runner and watchdog jobs |
| `sendMonitoringEmail`, `parseRecipients`, `escapeHtml` | CORE: `email.ts` (bounded content, no metadata) |
| `secretMatches` | CORE: `compare.ts` |
| `run_infra_health_checks` (db size, response, cron history) | INFRA CHECK PACK: product SQL pack template (next product phase) |
| `health-monitor/index.ts`, `monitor-watchdog/index.ts`, `createMonitorDb`, cron job, Vault names | PROJECT RUNTIME TEMPLATE (P4) |
| `run_health_checks`, JD branding, `user_roles` admin path, recipients key | JD ADAPTER |
| Static validator, runbook order, ACL gate query, acceptance queries | PROJECTOS CONTROL PLANE: `val-watchdog-*`, `privilege-gate.sql`, onboarding |
| `watchdog_*` columns on the pipeline row; "absent from run -> delete incident" | DISCARD: replaced by owned, scoped incidents with explicit positive recovery |
