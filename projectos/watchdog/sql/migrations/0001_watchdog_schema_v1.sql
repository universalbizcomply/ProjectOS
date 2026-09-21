-- ProjectOS Watchdog — schema version 1.
--
-- Canonical source: universalbizcomply/ProjectOS projectos/watchdog/sql.
-- Vendored into a product by projectos/scripts/watchdog-sync.cjs and applied
-- through that product's own approved migration route, as a NEW timestamped
-- product migration. Forward-only; replay-safe (safe to apply twice).
--
-- Authority model
--   * All state lives in the private schema `watchdog`. No client role has
--     schema USAGE, table privileges or function EXECUTE on it.
--   * The ONLY entry points are public.watchdog_* functions: SECURITY DEFINER,
--     search_path pinned to '', EXECUTE granted to service_role only, and each
--     one first calls watchdog._assert_trusted_caller(), which refuses any
--     caller whose active role is not service_role (or a direct superuser /
--     migration session). So even if a platform default privilege re-grants
--     EXECUTE to anon/authenticated, a browser still cannot forge PASS, write
--     runs, advance heartbeats, open/resolve incidents or change release
--     identity. The privilege gate (privilege-gate.sql) must still return no
--     rows after every deploy: the guard is defence in depth, not a waiver.
--   * The database re-checks the core's rules: incidents open/observe only
--     with same-run evidence, recovery only with explicit PASS from a
--     committed, non-failed run of the OWNING source, closure only through an
--     accepted recovery notice, retirement only as an audited operation.
--   * Metadata shape is enforced (_metadata_is_safe): short machine tokens,
--     numbers and booleans only.
--
-- Nothing product-specific appears here: no project names, URLs, schedules or
-- business rules. Scheduling (pg_cron) and secrets are product runtime.

create schema if not exists watchdog;

-- ---------------------------------------------------------------------------
-- Schema lock-down. Supabase-style roles may not exist on a plain PostgreSQL
-- test cluster, so role-specific statements are guarded.
-- ---------------------------------------------------------------------------
revoke all on schema watchdog from public;
alter default privileges in schema watchdog revoke all on tables from public;
alter default privileges in schema watchdog revoke all on sequences from public;
alter default privileges in schema watchdog revoke execute on functions from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema watchdog from %I', r);
      execute format('alter default privileges in schema watchdog revoke all on tables from %I', r);
      execute format('alter default privileges in schema watchdog revoke all on sequences from %I', r);
      execute format('alter default privileges in schema watchdog revoke execute on functions from %I', r);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Internal helpers (schema watchdog; never callable by clients).
-- ---------------------------------------------------------------------------
create or replace function watchdog._is_token(v text) returns boolean
language sql immutable set search_path = '' as $$
  select v is not null and v ~ '^[a-z0-9][a-z0-9_.:-]{0,79}$'
$$;

create or replace function watchdog._is_scope_id(v text) returns boolean
language sql immutable set search_path = '' as $$
  select v is not null and v ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
$$;

create or replace function watchdog._is_code(v text) returns boolean
language sql immutable set search_path = '' as $$
  select v is not null and v ~ '^[A-Z0-9_]{1,64}$'
$$;

create or replace function watchdog._metadata_is_safe(m jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select m is not null
     and jsonb_typeof(m) = 'object'
     and octet_length(m::text) <= 2048
     and (select count(*) from jsonb_each(m)) <= 16
     and not exists (
       select 1 from jsonb_each(m) e
        where e.key !~ '^[a-z][a-z0-9_]{0,62}$'
           or jsonb_typeof(e.value) not in ('number', 'boolean', 'string')
           or (jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') !~ '^[A-Za-z0-9_.:+-]{1,64}$')
     )
$$;

create or replace function watchdog._severity_rank(s text) returns integer
language sql immutable set search_path = '' as $$
  select case s when 'WARN' then 1 when 'ERROR' then 2 when 'CRITICAL' then 3 else 0 end
$$;

-- Refuses every caller except service_role (PostgREST sets role) and a
-- session that has not SET ROLE at all (migrations, pg_cron, superuser tests).
-- The `role` setting keeps the caller's SET ROLE inside SECURITY DEFINER
-- functions, unlike current_user.
create or replace function watchdog._assert_trusted_caller() returns void
language plpgsql stable set search_path = '' as $$
declare r text := current_setting('role', true);
begin
  if r is null or r = 'none' or r = 'service_role' then
    return;
  end if;
  raise exception 'watchdog: role % may not call watchdog functions', r using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------
-- Tables.
-- ---------------------------------------------------------------------------
create table if not exists watchdog.schema_migrations (
  version     integer primary key check (version >= 1),
  applied_at  timestamptz not null default now()
);

create table if not exists watchdog.meta (
  singleton               boolean primary key default true check (singleton),
  project                 text not null check (watchdog._is_token(project)),
  environment             text not null check (watchdog._is_token(environment)),
  installed_core_version  text not null check (installed_core_version ~ '^\d+\.\d+\.\d+$'),
  configured_at           timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table if not exists watchdog.run (
  run_id                 uuid primary key,
  project                text not null check (watchdog._is_token(project)),
  environment            text not null check (watchdog._is_token(environment)),
  source                 text not null check (watchdog._is_token(source)),
  status                 text not null default 'STARTED' check (status in ('STARTED', 'SUCCEEDED', 'FAILED')),
  started_at             timestamptz not null default now(),
  results_committed_at   timestamptz,
  completed_at           timestamptz,
  failure_stage          text check (failure_stage is null or watchdog._is_token(failure_stage)),
  expected_check_count   integer not null check (expected_check_count >= 0),
  actual_check_count     integer not null default 0 check (actual_check_count >= 0),
  watchdog_core_version  text not null check (watchdog_core_version ~ '^\d+\.\d+\.\d+$'),
  schema_version         integer not null check (schema_version >= 1),
  check ((status = 'STARTED') = (completed_at is null)),
  check (status <> 'SUCCEEDED' or results_committed_at is not null)
);
create index if not exists run_source_started_idx on watchdog.run (source, started_at desc);
create index if not exists run_finished_started_idx on watchdog.run (started_at) where status <> 'STARTED';

create table if not exists watchdog.check_result (
  id           bigint generated always as identity primary key,
  run_id       uuid not null references watchdog.run (run_id) on delete cascade,
  check_id     text not null check (watchdog._is_token(check_id)),
  scope_type   text not null check (watchdog._is_token(scope_type)),
  scope_id     text not null check (watchdog._is_scope_id(scope_id)),
  status       text not null check (status in ('PASS', 'INFO', 'WARN', 'CRITICAL', 'ERROR')),
  reason_code  text check (reason_code is null or watchdog._is_code(reason_code)),
  metadata     jsonb not null default '{}'::jsonb check (watchdog._metadata_is_safe(metadata)),
  recorded_at  timestamptz not null default now(),
  unique (run_id, check_id, scope_type, scope_id)
);
create index if not exists check_result_recorded_idx on watchdog.check_result (recorded_at);

create table if not exists watchdog.incident (
  incident_id             uuid primary key,
  project                 text not null check (watchdog._is_token(project)),
  environment             text not null check (watchdog._is_token(environment)),
  source                  text not null check (watchdog._is_token(source)),
  check_id                text not null check (watchdog._is_token(check_id)),
  scope_type              text not null check (watchdog._is_token(scope_type)),
  scope_id                text not null check (watchdog._is_scope_id(scope_id)),
  state                   text not null default 'OPEN' check (state in ('OPEN', 'RESOLVED', 'RETIRED')),
  severity                text not null check (severity in ('WARN', 'ERROR', 'CRITICAL')),
  first_seen              timestamptz not null default now(),
  last_seen               timestamptz not null default now(),
  occurrence_count        integer not null default 1 check (occurrence_count >= 1),
  opened_at               timestamptz not null default now(),
  opening_run_id          uuid not null references watchdog.run (run_id),
  last_notified_at        timestamptz,
  last_notified_severity  text check (last_notified_severity is null or last_notified_severity in ('WARN', 'ERROR', 'CRITICAL')),
  notify_count            integer not null default 0 check (notify_count >= 0),
  recovered_at            timestamptz,
  resolution_run_id       uuid references watchdog.run (run_id),
  resolved_at             timestamptz,
  retired_at              timestamptz,
  retired_reason          text check (retired_reason is null or watchdog._is_code(retired_reason)),
  retired_by              text check (retired_by is null or watchdog._is_token(retired_by)),
  check ((recovered_at is null) = (resolution_run_id is null)),
  check (state <> 'RESOLVED' or (resolved_at is not null and recovered_at is not null)),
  check (state <> 'RETIRED' or (retired_at is not null and retired_reason is not null and retired_by is not null)),
  check (state <> 'OPEN' or (resolved_at is null and retired_at is null))
);
create unique index if not exists incident_one_open_per_identity
  on watchdog.incident (project, environment, source, check_id, scope_type, scope_id) where state = 'OPEN';

create table if not exists watchdog.notification (
  id             bigint generated always as identity primary key,
  run_id         uuid references watchdog.run (run_id) on delete set null,
  incident_id    uuid not null references watchdog.incident (incident_id) on delete cascade,
  kind           text not null check (kind in ('INITIAL', 'ESCALATION', 'REMINDER', 'RECOVERY')),
  outcome        text not null check (outcome in ('ACCEPTED', 'FAILED')),
  provider_code  text not null check (provider_code ~ '^[a-z0-9_]{1,64}$'),
  attempted_at   timestamptz not null default now()
);
create index if not exists notification_attempted_idx on watchdog.notification (attempted_at);

create table if not exists watchdog.job (
  job_id                text primary key check (watchdog._is_token(job_id)),
  scheduler_name        text check (scheduler_name is null or watchdog._is_token(scheduler_name)),
  expected_interval_s   integer not null check (expected_interval_s > 0),
  stale_after_s         integer not null check (stale_after_s >= expected_interval_s),
  max_run_s             integer check (max_run_s is null or max_run_s > 0),
  failure_threshold     integer not null default 3 check (failure_threshold > 0),
  created_at            timestamptz not null default now(),
  last_started_at       timestamptz,
  last_success_at       timestamptz,
  last_failure_at       timestamptz,
  running_since         timestamptz,
  consecutive_failures  integer not null default 0 check (consecutive_failures >= 0),
  last_run_id           uuid
);

create table if not exists watchdog.release_identity (
  component              text primary key check (watchdog._is_token(component)),
  release_sha            text not null check (release_sha ~ '^[0-9a-f]{7,40}$'),
  deployment_id          text check (deployment_id is null or deployment_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  deployed_at            timestamptz,
  watchdog_core_version  text not null check (watchdog_core_version ~ '^\d+\.\d+\.\d+$'),
  schema_version         integer not null check (schema_version >= 1),
  recorded_at            timestamptz not null default now()
);

create table if not exists watchdog.sentinel_liveness (
  singleton                     boolean primary key default true check (singleton),
  created_at                    timestamptz not null default now(),
  last_authenticated_probe_at   timestamptz
);

create table if not exists watchdog.config (
  key    text primary key check (key in (
           'retention_check_result_days', 'retention_run_days',
           'retention_notification_days', 'retention_closed_incident_days')),
  value  integer not null check (value > 0)
);

-- RLS on everything, no policies: even a mis-granted client role reads nothing.
-- (Not FORCE: the entry points run as the table owner, which RLS exempts.)
do $$
declare t text; r text;
begin
  foreach t in array array['schema_migrations', 'meta', 'run', 'check_result', 'incident', 'notification',
                           'job', 'release_identity', 'sentinel_liveness', 'config'] loop
    execute format('alter table watchdog.%I enable row level security', t);
    execute format('revoke all on table watchdog.%I from public', t);
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on table watchdog.%I from %I', t, r);
      end if;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Entry points: public.watchdog_*  (SECURITY DEFINER, search_path '').
-- ---------------------------------------------------------------------------

create or replace function public.watchdog_schema_version() returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  perform watchdog._assert_trusted_caller();
  return (select max(version) from watchdog.schema_migrations);
end $$;

create or replace function public.watchdog_configure(p_project text, p_environment text, p_core_version text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform watchdog._assert_trusted_caller();
  insert into watchdog.meta (singleton, project, environment, installed_core_version)
  values (true, p_project, p_environment, p_core_version)
  on conflict (singleton) do update
     set project = excluded.project, environment = excluded.environment,
         installed_core_version = excluded.installed_core_version, updated_at = now();
  insert into watchdog.sentinel_liveness (singleton) values (true) on conflict (singleton) do nothing;
end $$;

create or replace function public.watchdog_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m watchdog.meta;
begin
  perform watchdog._assert_trusted_caller();
  select * into m from watchdog.meta where singleton;
  return jsonb_build_object(
    'project', m.project,
    'environment', m.environment,
    'installed_core_version', m.installed_core_version,
    'schema_version', (select max(version) from watchdog.schema_migrations),
    'db_now', now());
end $$;

create or replace function public.watchdog_run_start(p_run_id uuid, p_source text, p_expected integer, p_core_version text)
returns void
language plpgsql security definer set search_path = '' as $$
declare m watchdog.meta;
begin
  perform watchdog._assert_trusted_caller();
  select * into m from watchdog.meta where singleton;
  if not found then raise exception 'watchdog: not configured'; end if;
  insert into watchdog.run (run_id, project, environment, source, expected_check_count, watchdog_core_version, schema_version)
  values (p_run_id, m.project, m.environment, p_source, p_expected, p_core_version,
          (select max(version) from watchdog.schema_migrations));
end $$;

create or replace function public.watchdog_run_record_results(p_run_id uuid, p_results jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare r watchdog.run; n integer;
begin
  perform watchdog._assert_trusted_caller();
  select * into r from watchdog.run where run_id = p_run_id for update;
  if not found or r.status <> 'STARTED' or r.results_committed_at is not null then
    raise exception 'watchdog: run % is not accepting results', p_run_id;
  end if;
  if jsonb_typeof(p_results) <> 'array' then raise exception 'watchdog: results must be an array'; end if;
  insert into watchdog.check_result (run_id, check_id, scope_type, scope_id, status, reason_code, metadata)
  select p_run_id, x->>'check_id', x->>'scope_type', x->>'scope_id', x->>'status',
         nullif(x->>'reason_code', ''), coalesce(x->'metadata', '{}'::jsonb)
    from jsonb_array_elements(p_results) x;
  get diagnostics n = row_count;
  return n;
end $$;

-- Read-back: every declared check has a row and the row count matches what the
-- runtime reported. Returns the executed (non-synthesised) check count.
create or replace function public.watchdog_run_commit(p_run_id uuid, p_reported integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r watchdog.run; rows_n integer; distinct_n integer; actual_n integer;
begin
  perform watchdog._assert_trusted_caller();
  select * into r from watchdog.run where run_id = p_run_id for update;
  if not found or r.status <> 'STARTED' or r.results_committed_at is not null then
    raise exception 'watchdog: run % cannot be committed', p_run_id;
  end if;
  select count(*), count(distinct check_id),
         count(distinct check_id) filter (where reason_code is null
                                            or reason_code not in ('NOT_REPORTED', 'PACK_FAILED', 'INVALID_RESULT'))
    into rows_n, distinct_n, actual_n
    from watchdog.check_result where run_id = p_run_id;
  if rows_n <> p_reported then
    raise exception 'watchdog: persisted % results, runtime reported %', rows_n, p_reported;
  end if;
  if distinct_n < r.expected_check_count then
    raise exception 'watchdog: % of % declared checks have a result', distinct_n, r.expected_check_count;
  end if;
  update watchdog.run set results_committed_at = now(), actual_check_count = actual_n where run_id = p_run_id;
  return jsonb_build_object('actual_check_count', actual_n, 'db_now', now());
end $$;

create or replace function public.watchdog_run_finish(p_run_id uuid, p_status text, p_failure_stage text)
returns void
language plpgsql security definer set search_path = '' as $$
declare r watchdog.run;
begin
  perform watchdog._assert_trusted_caller();
  select * into r from watchdog.run where run_id = p_run_id for update;
  if not found or r.status <> 'STARTED' then raise exception 'watchdog: run % is not running', p_run_id; end if;
  if p_status = 'SUCCEEDED' then
    if r.results_committed_at is null then raise exception 'watchdog: run % has no committed results', p_run_id; end if;
    update watchdog.run set status = 'SUCCEEDED', completed_at = now() where run_id = p_run_id;
  elsif p_status = 'FAILED' then
    update watchdog.run set status = 'FAILED', completed_at = now(),
           failure_stage = coalesce(p_failure_stage, 'unknown') where run_id = p_run_id;
  else
    raise exception 'watchdog: invalid run status %', p_status;
  end if;
end $$;

create or replace function public.watchdog_incidents_open(p_source text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform watchdog._assert_trusted_caller();
  return coalesce((select jsonb_agg(to_jsonb(i) order by i.opened_at)
                     from watchdog.incident i where i.state = 'OPEN' and i.source = p_source), '[]'::jsonb);
end $$;

-- Evidence helper: the run is committed, not failed, belongs to p_source, and
-- has a result with p_status for exactly this identity.
create or replace function watchdog._has_evidence(p_run_id uuid, p_source text, p_check text, p_scope_type text, p_scope_id text, p_status text)
returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from watchdog.run r
      join watchdog.check_result c on c.run_id = r.run_id
     where r.run_id = p_run_id and r.source = p_source
       and r.results_committed_at is not null and r.status <> 'FAILED'
       and c.check_id = p_check and c.scope_type = p_scope_type and c.scope_id = p_scope_id
       and c.status = p_status)
$$;

create or replace function public.watchdog_incident_open(
  p_run_id uuid, p_incident_id uuid, p_check_id text, p_scope_type text, p_scope_id text, p_severity text)
returns void
language plpgsql security definer set search_path = '' as $$
declare r watchdog.run;
begin
  perform watchdog._assert_trusted_caller();
  select * into r from watchdog.run where run_id = p_run_id;
  if not found or not watchdog._has_evidence(p_run_id, r.source, p_check_id, p_scope_type, p_scope_id, p_severity) then
    raise exception 'watchdog: no committed % evidence for this identity in run %', p_severity, p_run_id;
  end if;
  insert into watchdog.incident (incident_id, project, environment, source, check_id, scope_type, scope_id, severity, opening_run_id)
  values (p_incident_id, r.project, r.environment, r.source, p_check_id, p_scope_type, p_scope_id, p_severity, p_run_id);
end $$;

create or replace function public.watchdog_incident_observe(p_run_id uuid, p_incident_id uuid, p_severity text)
returns void
language plpgsql security definer set search_path = '' as $$
declare i watchdog.incident;
begin
  perform watchdog._assert_trusted_caller();
  select * into i from watchdog.incident where incident_id = p_incident_id and state = 'OPEN' for update;
  if not found or not watchdog._has_evidence(p_run_id, i.source, i.check_id, i.scope_type, i.scope_id, p_severity) then
    raise exception 'watchdog: observe refused for incident %', p_incident_id;
  end if;
  update watchdog.incident
     set severity = p_severity, last_seen = now(), occurrence_count = occurrence_count + 1,
         recovered_at = null, resolution_run_id = null,
         last_notified_severity = case
           when last_notified_severity is not null
            and watchdog._severity_rank(p_severity) < watchdog._severity_rank(last_notified_severity)
           then p_severity else last_notified_severity end
   where incident_id = p_incident_id;
end $$;

-- Positive recovery: explicit PASS, same identity, committed non-failed run of
-- the owning source. Idempotent (keeps the first recovery evidence).
create or replace function public.watchdog_incident_mark_recovered(p_run_id uuid, p_incident_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare i watchdog.incident;
begin
  perform watchdog._assert_trusted_caller();
  select * into i from watchdog.incident where incident_id = p_incident_id and state = 'OPEN' for update;
  if not found or not watchdog._has_evidence(p_run_id, i.source, i.check_id, i.scope_type, i.scope_id, 'PASS') then
    raise exception 'watchdog: recovery refused for incident % (no owned PASS evidence)', p_incident_id;
  end if;
  update watchdog.incident set recovered_at = now(), resolution_run_id = p_run_id
   where incident_id = p_incident_id and recovered_at is null;
end $$;

-- Withdraw earlier recovery evidence when a committed run of the owning source
-- did not confirm health again (ERROR, INFO or missing result).
create or replace function public.watchdog_incident_clear_recovery(p_run_id uuid, p_incident_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare i watchdog.incident; r watchdog.run;
begin
  perform watchdog._assert_trusted_caller();
  select * into i from watchdog.incident where incident_id = p_incident_id and state = 'OPEN' for update;
  select * into r from watchdog.run where run_id = p_run_id;
  if i.incident_id is null or r.run_id is null or r.source <> i.source or r.results_committed_at is null then
    raise exception 'watchdog: clear_recovery refused for incident %', p_incident_id;
  end if;
  update watchdog.incident set recovered_at = null, resolution_run_id = null where incident_id = p_incident_id;
end $$;

-- Accepted delivery. RECOVERY closes the incident; anything else advances the
-- notified watermark. Called ONLY after the provider accepted.
create or replace function public.watchdog_incident_notified(p_run_id uuid, p_incident_id uuid, p_kind text)
returns void
language plpgsql security definer set search_path = '' as $$
declare i watchdog.incident;
begin
  perform watchdog._assert_trusted_caller();
  select * into i from watchdog.incident where incident_id = p_incident_id and state = 'OPEN' for update;
  if not found then raise exception 'watchdog: incident % is not open', p_incident_id; end if;
  if p_kind = 'RECOVERY' then
    if i.recovered_at is null then raise exception 'watchdog: recovery notice without recovery evidence'; end if;
    -- The notifying run itself must show PASS for this identity: an incident is
    -- never closed on a run whose latest result for it was not healthy.
    if not watchdog._has_evidence(p_run_id, i.source, i.check_id, i.scope_type, i.scope_id, 'PASS') then
      raise exception 'watchdog: recovery notice without PASS in run %', p_run_id;
    end if;
    update watchdog.incident set state = 'RESOLVED', resolved_at = now() where incident_id = p_incident_id;
  elsif p_kind in ('INITIAL', 'ESCALATION', 'REMINDER') then
    update watchdog.incident
       set last_notified_at = now(), last_notified_severity = severity, notify_count = notify_count + 1
     where incident_id = p_incident_id;
  else
    raise exception 'watchdog: invalid notification kind %', p_kind;
  end if;
  insert into watchdog.notification (run_id, incident_id, kind, outcome, provider_code)
  values (p_run_id, p_incident_id, p_kind, 'ACCEPTED', 'accepted');
end $$;

-- Failed delivery: audit only, no state change (the next run retries).
create or replace function public.watchdog_notification_failed(p_run_id uuid, p_incident_ids uuid[], p_code text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform watchdog._assert_trusted_caller();
  insert into watchdog.notification (run_id, incident_id, kind, outcome, provider_code)
  select p_run_id, i.incident_id,
         case when i.recovered_at is not null then 'RECOVERY'
              when i.last_notified_at is null then 'INITIAL'
              else 'REMINDER' end,
         'FAILED', left(lower(regexp_replace(coalesce(p_code, 'unknown'), '[^A-Za-z0-9_]', '_', 'g')), 64)
    from watchdog.incident i where i.incident_id = any (p_incident_ids);
end $$;

-- Audited retirement of an incident whose check no longer exists. Never
-- automatic; reason and actor are machine tokens, not free text.
create or replace function public.watchdog_incident_retire(p_incident_id uuid, p_reason text, p_actor text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform watchdog._assert_trusted_caller();
  update watchdog.incident
     set state = 'RETIRED', retired_at = now(), retired_reason = p_reason, retired_by = p_actor
   where incident_id = p_incident_id and state = 'OPEN';
  if not found then raise exception 'watchdog: incident % is not open', p_incident_id; end if;
end $$;

-- ---- jobs --------------------------------------------------------------------

create or replace function public.watchdog_job_register(
  p_job_id text, p_scheduler_name text, p_expected_interval_s integer, p_stale_after_s integer,
  p_max_run_s integer, p_failure_threshold integer)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform watchdog._assert_trusted_caller();
  insert into watchdog.job (job_id, scheduler_name, expected_interval_s, stale_after_s, max_run_s, failure_threshold)
  values (p_job_id, p_scheduler_name, p_expected_interval_s, p_stale_after_s, p_max_run_s, p_failure_threshold)
  on conflict (job_id) do update
     set scheduler_name = excluded.scheduler_name, expected_interval_s = excluded.expected_interval_s,
         stale_after_s = excluded.stale_after_s, max_run_s = excluded.max_run_s,
         failure_threshold = excluded.failure_threshold;
end $$;

create or replace function public.watchdog_job_event(p_job_id text, p_event text, p_run_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform watchdog._assert_trusted_caller();
  if p_event = 'STARTED' then
    update watchdog.job set last_started_at = now(), running_since = now(), last_run_id = p_run_id where job_id = p_job_id;
  elsif p_event = 'SUCCEEDED' then
    update watchdog.job set last_success_at = now(), running_since = null, consecutive_failures = 0, last_run_id = p_run_id
     where job_id = p_job_id;
  elsif p_event = 'FAILED' then
    update watchdog.job set last_failure_at = now(), running_since = null,
           consecutive_failures = consecutive_failures + 1, last_run_id = p_run_id
     where job_id = p_job_id;
  else
    raise exception 'watchdog: invalid job event %', p_event;
  end if;
  if not found then raise exception 'watchdog: unknown job %', p_job_id; end if;
end $$;

-- Job states plus scheduler presence. When pg_cron is installed, a job with a
-- scheduler_name is checked against cron.job (missing / disabled).
create or replace function public.watchdog_job_states() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare has_cron boolean := to_regclass('cron.job') is not null; out jsonb;
begin
  perform watchdog._assert_trusted_caller();
  if has_cron then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
               'job_id', j.job_id, 'created_at', j.created_at, 'last_started_at', j.last_started_at,
               'last_success_at', j.last_success_at, 'last_failure_at', j.last_failure_at,
               'running_since', j.running_since, 'consecutive_failures', j.consecutive_failures,
               'scheduler', case when j.scheduler_name is null then 'not_applicable'
                                 when c.jobname is null then 'missing'
                                 when not c.active then 'disabled' else 'present' end)), '[]'::jsonb)
        from watchdog.job j left join cron.job c on c.jobname = j.scheduler_name
    $q$ into out;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'job_id', j.job_id, 'created_at', j.created_at, 'last_started_at', j.last_started_at,
             'last_success_at', j.last_success_at, 'last_failure_at', j.last_failure_at,
             'running_since', j.running_since, 'consecutive_failures', j.consecutive_failures,
             'scheduler', case when j.scheduler_name is null then 'not_applicable' else 'missing' end)), '[]'::jsonb)
      into out from watchdog.job j;
  end if;
  return jsonb_build_object('db_now', now(), 'jobs', out);
end $$;

-- ---- release identity ----------------------------------------------------------

create or replace function public.watchdog_release_record(p_component text, p_release_sha text, p_deployment_id text, p_deployed_at timestamptz)
returns void
language plpgsql security definer set search_path = '' as $$
declare m watchdog.meta;
begin
  perform watchdog._assert_trusted_caller();
  select * into m from watchdog.meta where singleton;
  if not found then raise exception 'watchdog: not configured'; end if;
  insert into watchdog.release_identity (component, release_sha, deployment_id, deployed_at, watchdog_core_version, schema_version)
  values (p_component, p_release_sha, p_deployment_id, p_deployed_at, m.installed_core_version,
          (select max(version) from watchdog.schema_migrations))
  on conflict (component) do update
     set release_sha = excluded.release_sha, deployment_id = excluded.deployment_id, deployed_at = excluded.deployed_at,
         watchdog_core_version = excluded.watchdog_core_version, schema_version = excluded.schema_version, recorded_at = now();
end $$;

create or replace function public.watchdog_release_identity() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform watchdog._assert_trusted_caller();
  return jsonb_build_object(
    'project', (select project from watchdog.meta where singleton),
    'environment', (select environment from watchdog.meta where singleton),
    'components', coalesce((select jsonb_agg(to_jsonb(r) order by r.component) from watchdog.release_identity r), '[]'::jsonb));
end $$;

-- ---- sentinel liveness -----------------------------------------------------------
-- Advanced ONLY by a product endpoint after it verified the product-scoped
-- sentinel credential (P4+). A public health endpoint must never call this.
create or replace function public.watchdog_sentinel_probe_record() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform watchdog._assert_trusted_caller();
  update watchdog.sentinel_liveness set last_authenticated_probe_at = now() where singleton;
  if not found then raise exception 'watchdog: not configured'; end if;
end $$;

create or replace function public.watchdog_sentinel_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform watchdog._assert_trusted_caller();
  return (select jsonb_build_object('created_at', created_at, 'last_authenticated_probe_at', last_authenticated_probe_at, 'db_now', now())
            from watchdog.sentinel_liveness where singleton);
end $$;

-- ---- retention -------------------------------------------------------------------
-- Periods are product configuration (watchdog.config), not frozen here. Purge
-- refuses to run until every period is configured. Open incidents and the runs
-- they reference are never purged.
create or replace function public.watchdog_config_set(p_key text, p_value integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform watchdog._assert_trusted_caller();
  insert into watchdog.config (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
end $$;

create or replace function public.watchdog_purge() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d_results integer; d_runs integer; d_notes integer; d_incidents integer;
  n_results integer; n_runs integer; n_notes integer; n_incidents integer;
begin
  perform watchdog._assert_trusted_caller();
  select value into d_results from watchdog.config where key = 'retention_check_result_days';
  select value into d_runs from watchdog.config where key = 'retention_run_days';
  select value into d_notes from watchdog.config where key = 'retention_notification_days';
  select value into d_incidents from watchdog.config where key = 'retention_closed_incident_days';
  if d_results is null or d_runs is null or d_notes is null or d_incidents is null then
    raise exception 'watchdog: retention periods are not configured';
  end if;

  delete from watchdog.check_result where recorded_at < now() - make_interval(days => d_results);
  get diagnostics n_results = row_count;
  delete from watchdog.notification where attempted_at < now() - make_interval(days => d_notes);
  get diagnostics n_notes = row_count;
  delete from watchdog.incident
   where state in ('RESOLVED', 'RETIRED')
     and coalesce(resolved_at, retired_at) < now() - make_interval(days => d_incidents);
  get diagnostics n_incidents = row_count;
  delete from watchdog.run r
   where r.status <> 'STARTED' and r.started_at < now() - make_interval(days => d_runs)
     and not exists (select 1 from watchdog.incident i where i.opening_run_id = r.run_id or i.resolution_run_id = r.run_id)
     and not exists (select 1 from watchdog.job j where j.last_run_id = r.run_id)
     -- never cascade-delete results still inside their own retention period
     and not exists (select 1 from watchdog.check_result c where c.run_id = r.run_id);
  get diagnostics n_runs = row_count;
  return jsonb_build_object('check_results', n_results, 'runs', n_runs, 'notifications', n_notes, 'incidents', n_incidents);
end $$;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing for PUBLIC / anon / authenticated; entry points
-- for service_role only. Applied to EVERY watchdog function after creation,
-- because platform default privileges may have granted EXECUTE on creation.
-- ---------------------------------------------------------------------------
do $$
declare f record; r text;
begin
  for f in
    select p.oid::regprocedure as sig, n.nspname as ns
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'watchdog' or (n.nspname = 'public' and p.proname like 'watchdog\_%')
  loop
    execute format('revoke all on function %s from public', f.sig);
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f.sig, r);
      end if;
    end loop;
    if f.ns = 'public' and exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;

insert into watchdog.schema_migrations (version) values (1) on conflict (version) do nothing;
