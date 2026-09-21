-- ProjectOS Watchdog schema v1 — behavioural assertions on a live cluster.
-- Run by pg-harness.cjs after the migration has been applied TWICE.
-- Any failed assertion raises and stops psql (ON_ERROR_STOP).

\set ON_ERROR_STOP 1

-- ---- helpers (created as the cluster superuser) ------------------------------
create schema if not exists wdtest;
create or replace function wdtest.expect_error(p_sql text, p_like text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_ERROR_NOT_RAISED: %', p_sql;
exception when others then
  if sqlerrm like 'EXPECTED_ERROR_NOT_RAISED%' then raise; end if;
  if p_like is not null and sqlerrm not ilike p_like then
    raise exception 'WRONG_ERROR for [%]: %', p_sql, sqlerrm;
  end if;
end $$;
create or replace function wdtest.ok(p_cond boolean, p_msg text) returns void
language plpgsql as $$ begin if p_cond is not true then raise exception 'ASSERTION FAILED: %', p_msg; end if; end $$;
grant usage on schema wdtest to anon, authenticated, service_role;
grant execute on all functions in schema wdtest to anon, authenticated, service_role;

-- ---- 1. client roles cannot reach anything ---------------------------------------
set role anon;
select wdtest.expect_error($$select public.watchdog_configure('x','production','0.1.0')$$, '%permission denied%');
select wdtest.expect_error($$select public.watchdog_run_start(gen_random_uuid(),'runner',1,'0.1.0')$$, '%permission denied%');
select wdtest.expect_error($$select public.watchdog_incident_mark_recovered(gen_random_uuid(), gen_random_uuid())$$, '%permission denied%');
select wdtest.expect_error($$select public.watchdog_sentinel_probe_record()$$, '%permission denied%');
select wdtest.expect_error($$select public.watchdog_release_record('app','abcdef1',null,null)$$, '%permission denied%');
select wdtest.expect_error($$select count(*) from watchdog.run$$, '%permission denied%');
select wdtest.expect_error($$insert into watchdog.check_result (run_id, check_id, scope_type, scope_id, status) values (gen_random_uuid(),'c','global','global','PASS')$$, '%permission denied%');
reset role;
set role authenticated;
select wdtest.expect_error($$select public.watchdog_status()$$, '%permission denied%');
select wdtest.expect_error($$select public.watchdog_job_event('j','SUCCEEDED',null)$$, '%permission denied%');
select wdtest.expect_error($$update watchdog.incident set state = 'RESOLVED'$$, '%permission denied%');
reset role;

-- ---- 2. defence in depth: even a mis-granted EXECUTE is refused by the guard ----
grant execute on function public.watchdog_run_start(uuid, text, integer, text) to anon;
grant execute on function public.watchdog_sentinel_probe_record() to authenticated;
set role anon;
select wdtest.expect_error($$select public.watchdog_run_start(gen_random_uuid(),'runner',1,'0.1.0')$$, '%role anon may not call watchdog functions%');
reset role;
set role authenticated;
select wdtest.expect_error($$select public.watchdog_sentinel_probe_record()$$, '%role authenticated may not call watchdog functions%');
reset role;
revoke execute on function public.watchdog_run_start(uuid, text, integer, text) from anon;
revoke execute on function public.watchdog_sentinel_probe_record() from authenticated;

-- ---- 3. service_role lifecycle ---------------------------------------------------
set role service_role;

select public.watchdog_configure('demo', 'production', '0.1.0');
select wdtest.ok(public.watchdog_schema_version() = 1, 'schema version 1');
select wdtest.ok((public.watchdog_status()->>'project') = 'demo', 'status project');
select wdtest.expect_error($$select public.watchdog_configure('Bad Name','production','0.1.0')$$, '%check constraint%');

-- run r1 (runner): db CRITICAL at site-a, db PASS at site-b, api ERROR
select public.watchdog_run_start('11111111-0000-4000-8000-000000000001', 'runner', 2, '0.1.0');
select wdtest.expect_error($$select public.watchdog_run_finish('11111111-0000-4000-8000-000000000001','SUCCEEDED',null)$$, '%no committed results%');
select wdtest.ok(public.watchdog_run_record_results('11111111-0000-4000-8000-000000000001', '[
  {"check_id":"db","scope_type":"site","scope_id":"site-a","status":"CRITICAL","metadata":{"age_s":900}},
  {"check_id":"db","scope_type":"site","scope_id":"site-b","status":"PASS","metadata":{}},
  {"check_id":"api","scope_type":"global","scope_id":"global","status":"ERROR","reason_code":"NOT_REPORTED","metadata":{}}
]'::jsonb) = 3, 'three results recorded');
select wdtest.expect_error($$select public.watchdog_run_commit('11111111-0000-4000-8000-000000000001', 4)$$, '%persisted 3 results, runtime reported 4%');
select wdtest.ok((public.watchdog_run_commit('11111111-0000-4000-8000-000000000001', 3)->>'actual_check_count')::int = 1, 'synthesised ERROR not counted as executed');
select wdtest.expect_error($$select public.watchdog_run_record_results('11111111-0000-4000-8000-000000000001', '[]')$$, '%not accepting results%');

-- metadata guard: customer data / free text / nested payloads refused
select public.watchdog_run_start('11111111-0000-4000-8000-0000000000aa', 'runner', 0, '0.1.0');
select wdtest.expect_error($$select public.watchdog_run_record_results('11111111-0000-4000-8000-0000000000aa', '[{"check_id":"x","scope_type":"global","scope_id":"global","status":"PASS","metadata":{"email":"jon@example.com"}}]')$$, '%check_result_metadata_check%');
select wdtest.expect_error($$select public.watchdog_run_record_results('11111111-0000-4000-8000-0000000000aa', '[{"check_id":"x","scope_type":"global","scope_id":"global","status":"PASS","metadata":{"note":"Customer Name"}}]')$$, '%check_result_metadata_check%');
select wdtest.expect_error($$select public.watchdog_run_record_results('11111111-0000-4000-8000-0000000000aa', '[{"check_id":"x","scope_type":"global","scope_id":"global","status":"PASS","metadata":{"payload":{"a":1}}}]')$$, '%check_result_metadata_check%');
select wdtest.expect_error($$select public.watchdog_run_record_results('11111111-0000-4000-8000-0000000000aa', '[{"check_id":"x","scope_type":"global","scope_id":"global","status":"FAIL","metadata":{}}]')$$, '%check_result_status_check%');
select public.watchdog_run_finish('11111111-0000-4000-8000-0000000000aa', 'FAILED', 'record_results');

-- incidents need same-run evidence of the claimed severity
select wdtest.expect_error($$select public.watchdog_incident_open('11111111-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000009','db','site','site-b','CRITICAL')$$, '%no committed CRITICAL evidence%');
select public.watchdog_incident_open('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'db', 'site', 'site-a', 'CRITICAL');
select public.watchdog_incident_open('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'api', 'global', 'global', 'ERROR');
-- one open incident per exact identity
select wdtest.expect_error($$select public.watchdog_incident_open('11111111-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000003','db','site','site-a','CRITICAL')$$, '%incident_one_open_per_identity%');
select public.watchdog_run_finish('11111111-0000-4000-8000-000000000001', 'SUCCEEDED', null);
select wdtest.expect_error($$select public.watchdog_run_finish('11111111-0000-4000-8000-000000000001','FAILED','x')$$, '%is not running%');

-- run r2 (runner): site-a missing, api ERROR again -> no recovery possible
select public.watchdog_run_start('11111111-0000-4000-8000-000000000002', 'runner', 1, '0.1.0');
select public.watchdog_run_record_results('11111111-0000-4000-8000-000000000002', '[{"check_id":"api","scope_type":"global","scope_id":"global","status":"ERROR","metadata":{}}]');
select public.watchdog_run_commit('11111111-0000-4000-8000-000000000002', 1);
select wdtest.expect_error($$select public.watchdog_incident_mark_recovered('11111111-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001')$$, '%no owned PASS evidence%');  -- missing
select wdtest.expect_error($$select public.watchdog_incident_mark_recovered('11111111-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000002')$$, '%no owned PASS evidence%');  -- ERROR
select public.watchdog_run_finish('11111111-0000-4000-8000-000000000002', 'SUCCEEDED', null);

-- run r3 (runner): PASS for site-a but the run FAILED -> no recovery
select public.watchdog_run_start('11111111-0000-4000-8000-000000000003', 'runner', 1, '0.1.0');
select public.watchdog_run_record_results('11111111-0000-4000-8000-000000000003', '[{"check_id":"db","scope_type":"site","scope_id":"site-a","status":"PASS","metadata":{}}]');
select public.watchdog_run_commit('11111111-0000-4000-8000-000000000003', 1);
select public.watchdog_run_finish('11111111-0000-4000-8000-000000000003', 'FAILED', 'notify');
select wdtest.expect_error($$select public.watchdog_incident_mark_recovered('11111111-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000001')$$, '%no owned PASS evidence%');

-- uncommitted run with PASS -> no recovery
select public.watchdog_run_start('11111111-0000-4000-8000-000000000004', 'runner', 1, '0.1.0');
select public.watchdog_run_record_results('11111111-0000-4000-8000-000000000004', '[{"check_id":"db","scope_type":"site","scope_id":"site-a","status":"PASS","metadata":{}}]');
select wdtest.expect_error($$select public.watchdog_incident_mark_recovered('11111111-0000-4000-8000-000000000004','aaaaaaaa-0000-4000-8000-000000000001')$$, '%no owned PASS evidence%');
select public.watchdog_run_finish('11111111-0000-4000-8000-000000000004', 'FAILED', 'commit_results');

-- another source's PASS for the same check/scope -> no recovery (ownership)
select public.watchdog_run_start('22222222-0000-4000-8000-000000000001', 'watchdog', 1, '0.1.0');
select public.watchdog_run_record_results('22222222-0000-4000-8000-000000000001', '[{"check_id":"db","scope_type":"site","scope_id":"site-a","status":"PASS","metadata":{}}]');
select public.watchdog_run_commit('22222222-0000-4000-8000-000000000001', 1);
select wdtest.expect_error($$select public.watchdog_incident_mark_recovered('22222222-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001')$$, '%no owned PASS evidence%');
select public.watchdog_run_finish('22222222-0000-4000-8000-000000000001', 'SUCCEEDED', null);

-- recovery notice cannot close without recovery evidence
select wdtest.expect_error($$select public.watchdog_incident_notified('11111111-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001','RECOVERY')$$, '%without recovery evidence%');

-- initial notice advances the watermark; failed notice changes nothing
select public.watchdog_notification_failed('11111111-0000-4000-8000-000000000002', array['aaaaaaaa-0000-4000-8000-000000000001']::uuid[], 'http_503');
reset role;
select wdtest.ok((select last_notified_at is null from watchdog.incident where incident_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'failed delivery does not advance state');
select wdtest.ok((select count(*) = 1 from watchdog.notification where outcome = 'FAILED'), 'failed delivery audited');
set role service_role;
select public.watchdog_incident_notified('11111111-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'INITIAL');

-- run r5 (runner): explicit PASS for site-a, committed, not failed -> recovered, still OPEN
select public.watchdog_run_start('11111111-0000-4000-8000-000000000005', 'runner', 1, '0.1.0');
select public.watchdog_run_record_results('11111111-0000-4000-8000-000000000005', '[{"check_id":"db","scope_type":"site","scope_id":"site-a","status":"PASS","metadata":{}}]');
select public.watchdog_run_commit('11111111-0000-4000-8000-000000000005', 1);
select public.watchdog_incident_mark_recovered('11111111-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001');
reset role;
select wdtest.ok((select state = 'OPEN' and recovered_at is not null and resolution_run_id = '11111111-0000-4000-8000-000000000005'
                    from watchdog.incident where incident_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'positive recovery recorded, incident still open');
set role service_role;
select public.watchdog_incident_notified('11111111-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', 'RECOVERY');
select public.watchdog_run_finish('11111111-0000-4000-8000-000000000005', 'SUCCEEDED', null);
reset role;
select wdtest.ok((select state = 'RESOLVED' from watchdog.incident where incident_id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'accepted recovery notice resolves');
select wdtest.ok((select state = 'OPEN' from watchdog.incident where incident_id = 'aaaaaaaa-0000-4000-8000-000000000002'), 'ERROR incident untouched');
set role service_role;

-- a new incident for the same identity may open after resolution
select public.watchdog_run_start('11111111-0000-4000-8000-000000000006', 'runner', 1, '0.1.0');
select public.watchdog_run_record_results('11111111-0000-4000-8000-000000000006', '[{"check_id":"db","scope_type":"site","scope_id":"site-a","status":"WARN","metadata":{}}]');
select public.watchdog_run_commit('11111111-0000-4000-8000-000000000006', 1);
select public.watchdog_incident_open('11111111-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000004', 'db', 'site', 'site-a', 'WARN');
select public.watchdog_run_finish('11111111-0000-4000-8000-000000000006', 'SUCCEEDED', null);

-- recovery evidence withdrawn by a non-PASS run; closure needs PASS in the notifying run
select public.watchdog_run_start('11111111-0000-4000-8000-000000000008', 'runner', 1, '0.1.0');
select public.watchdog_run_record_results('11111111-0000-4000-8000-000000000008', '[{"check_id":"db","scope_type":"site","scope_id":"site-a","status":"PASS","metadata":{}}]');
select public.watchdog_run_commit('11111111-0000-4000-8000-000000000008', 1);
select public.watchdog_incident_mark_recovered('11111111-0000-4000-8000-000000000008', 'aaaaaaaa-0000-4000-8000-000000000004');
select public.watchdog_run_finish('11111111-0000-4000-8000-000000000008', 'SUCCEEDED', null);
select public.watchdog_run_start('11111111-0000-4000-8000-000000000009', 'runner', 1, '0.1.0');
select public.watchdog_run_record_results('11111111-0000-4000-8000-000000000009', '[{"check_id":"db","scope_type":"site","scope_id":"site-a","status":"ERROR","metadata":{}}]');
select public.watchdog_run_commit('11111111-0000-4000-8000-000000000009', 1);
select wdtest.expect_error($$select public.watchdog_incident_notified('11111111-0000-4000-8000-000000000009','aaaaaaaa-0000-4000-8000-000000000004','RECOVERY')$$, '%without PASS in run%');
select wdtest.expect_error($$select public.watchdog_incident_clear_recovery('22222222-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000004')$$, '%clear_recovery refused%');
select public.watchdog_incident_clear_recovery('11111111-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000004');
select public.watchdog_run_finish('11111111-0000-4000-8000-000000000009', 'SUCCEEDED', null);
reset role;
select wdtest.ok((select state = 'OPEN' and recovered_at is null and resolution_run_id is null
                    from watchdog.incident where incident_id = 'aaaaaaaa-0000-4000-8000-000000000004'), 'recovery evidence withdrawn, incident still open');
set role service_role;

-- audited retirement
select wdtest.expect_error($$select public.watchdog_incident_retire('aaaaaaaa-0000-4000-8000-000000000002','check removed','owner')$$, '%check constraint%');
select public.watchdog_incident_retire('aaaaaaaa-0000-4000-8000-000000000002', 'CHECK_REMOVED', 'owner');
select wdtest.ok((public.watchdog_incidents_open('runner')->0->>'incident_id') = 'aaaaaaaa-0000-4000-8000-000000000004', 'only the new incident is open');

-- jobs + scheduler presence
select public.watchdog_job_register('present', 'present-job', 300, 900, 120, 3);
select public.watchdog_job_register('disabled', 'disabled-job', 300, 900, null, 3);
select public.watchdog_job_register('gone', 'gone-job', 300, 900, null, 3);
select public.watchdog_job_register('worker', null, 60, 300, null, 3);
select wdtest.expect_error($$select public.watchdog_job_register('bad', null, 300, 60, null, 3)$$, '%check constraint%');
select public.watchdog_job_event('present', 'STARTED', null);
select public.watchdog_job_event('present', 'SUCCEEDED', null);
select public.watchdog_job_event('worker', 'FAILED', null);
select wdtest.expect_error($$select public.watchdog_job_event('nope','STARTED',null)$$, '%unknown job%');
select wdtest.ok((select string_agg(x->>'job_id' || '=' || (x->>'scheduler'), ',' order by x->>'job_id')
                    from jsonb_array_elements(public.watchdog_job_states()->'jobs') x)
                 = 'disabled=disabled,gone=missing,present=present,worker=not_applicable', 'scheduler presence');

-- release identity + sentinel liveness
select public.watchdog_release_record('app', '0123456789abcdef0123456789abcdef01234567', 'dpl_1', now());
select wdtest.expect_error($$select public.watchdog_release_record('app','NOT-A-SHA',null,null)$$, '%check constraint%');
select wdtest.ok((public.watchdog_release_identity()->'components'->0->>'schema_version')::int = 1, 'release identity carries schema version');
select wdtest.ok((public.watchdog_sentinel_state()->>'last_authenticated_probe_at') is null, 'sentinel not yet probed');
select public.watchdog_sentinel_probe_record();
select wdtest.ok((public.watchdog_sentinel_state()->>'last_authenticated_probe_at') is not null, 'authenticated probe recorded');

-- retention: refused until configured, then bounded and safe for open incidents
select wdtest.expect_error($$select public.watchdog_purge()$$, '%not configured%');
select public.watchdog_config_set('retention_check_result_days', 1);
select public.watchdog_config_set('retention_run_days', 1);
select public.watchdog_config_set('retention_notification_days', 1);
select public.watchdog_config_set('retention_closed_incident_days', 1);
select wdtest.expect_error($$select public.watchdog_config_set('retention_forever', 1)$$, '%check constraint%');
reset role;
update watchdog.check_result set recorded_at = now() - interval '3 days';
update watchdog.run set started_at = now() - interval '3 days';
update watchdog.incident set resolved_at = now() - interval '3 days' where state = 'RESOLVED';
update watchdog.incident set retired_at = now() - interval '3 days' where state = 'RETIRED';
set role service_role;
select public.watchdog_purge();
reset role;
select wdtest.ok((select count(*) = 1 from watchdog.incident where state = 'OPEN'), 'open incident survives purge');
select wdtest.ok((select count(*) = 0 from watchdog.check_result), 'old results purged');
select wdtest.ok(exists (select 1 from watchdog.run where run_id = '11111111-0000-4000-8000-000000000006'), 'run referenced by open incident kept');

-- run retention shorter than result retention must not cascade-delete results early
set role service_role;
select public.watchdog_config_set('retention_check_result_days', 10);
select public.watchdog_run_start('11111111-0000-4000-8000-000000000010', 'runner', 1, '0.1.0');
select public.watchdog_run_record_results('11111111-0000-4000-8000-000000000010', '[{"check_id":"api","scope_type":"global","scope_id":"global","status":"PASS","metadata":{}}]');
select public.watchdog_run_commit('11111111-0000-4000-8000-000000000010', 1);
select public.watchdog_run_finish('11111111-0000-4000-8000-000000000010', 'SUCCEEDED', null);
reset role;
update watchdog.run set started_at = now() - interval '2 days' where run_id = '11111111-0000-4000-8000-000000000010';
update watchdog.check_result set recorded_at = now() - interval '2 days' where run_id = '11111111-0000-4000-8000-000000000010';
set role service_role;
select wdtest.ok((public.watchdog_purge()->>'runs')::int = 0, 'run with results inside retention is not purged');
reset role;
select wdtest.ok((select count(*) = 1 from watchdog.check_result where run_id = '11111111-0000-4000-8000-000000000010'), 'results kept for their own retention period');

drop schema wdtest cascade;
select 'ASSERTIONS PASSED' as result;
