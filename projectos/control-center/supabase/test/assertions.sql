-- ProjectOS Control Center: behavioural assertions for the tenant boundary.
--
-- Run by pg-harness.cjs inside one transaction that is always rolled back, once clean and once per
-- named mutation. It does not stop at the first failure: every assertion records a result, so a
-- mutation shows which rule caught it. The harness reads FAILED, TOTAL and COMPLETE.
--
-- A refusal counts only with a control. Reads: the same role sees rows when it should. Writes: the same
-- statement changes a row for the role allowed to make it. Errors are matched by their real text, so a
-- refusal from some other rule fails the assertion.

\set ON_ERROR_STOP 1
\set a_owner  'aaaaaaaa-0000-4000-8000-000000000001'
\set a_member 'aaaaaaaa-0000-4000-8000-000000000002'
\set b_owner  'bbbbbbbb-0000-4000-8000-000000000001'
\set b_member 'bbbbbbbb-0000-4000-8000-000000000002'
\set stranger 'cccccccc-0000-4000-8000-000000000001'
\set both     'cd2e8678-1e00-4264-95bb-7d75738a1f50'

-- ---- helpers (test-only, gone with the rollback) --------------------------------------------------

create schema rlstest;
create table rlstest.result (seq bigserial primary key, id text not null, ok boolean not null, detail text);

create function rlstest._record(p_id text, p_ok boolean, p_detail text) returns void
language sql security definer set search_path = '' as $$
  insert into rlstest.result (id, ok, detail) values (p_id, coalesce(p_ok, false), p_detail)
$$;

create function rlstest.ok(p_id text, p_cond boolean, p_detail text) returns void
language sql as $$ select rlstest._record(p_id, p_cond, p_detail) $$;

create function rlstest.expect_count(p_id text, p_sql text, p_expected bigint) returns void
language plpgsql as $$
declare
  n bigint;
begin
  begin
    execute p_sql into n;
  exception when others then
    perform rlstest._record(p_id, false, 'raised: ' || sqlerrm);
    return;
  end;
  perform rlstest._record(p_id, n = p_expected, format('count %s, expected %s', n, p_expected));
end $$;

-- Asserts the statement is refused with this error. Anything it did is always undone.
create function rlstest.expect_error(p_id text, p_sql text, p_like text) returns void
language plpgsql as $$
declare
  msg text;
begin
  begin
    execute p_sql;
    raise exception 'rlstest_no_error';
  exception when others then
    msg := sqlerrm;
  end;
  perform rlstest._record(p_id, msg <> 'rlstest_no_error' and msg ilike p_like, msg);
end $$;

-- Asserts how many rows the statement touched, then undoes it.
create function rlstest.expect_rows(p_id text, p_sql text, p_rows bigint) returns void
language plpgsql as $$
declare
  n bigint;
  msg text;
begin
  begin
    execute p_sql;
    get diagnostics n = row_count;
    raise exception 'rlstest_rollback';
  exception when others then
    msg := sqlerrm;
  end;
  if msg <> 'rlstest_rollback' then
    perform rlstest._record(p_id, false, 'raised: ' || msg);
  else
    perform rlstest._record(p_id, n = p_rows, format('rows %s, expected %s', n, p_rows));
  end if;
end $$;

create function rlstest.login(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', false);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
end $$;

create function rlstest.login_anon() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', false);
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  perform set_config('role', 'anon', false);
end $$;

create function rlstest.login_claims(p_claims text) returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', false);
  perform set_config('request.jwt.claims', p_claims, false);
  perform set_config('role', 'authenticated', false);
end $$;

create function rlstest.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', false);
  perform set_config('request.jwt.claims', '', false);
end $$;

create function rlstest.snapshot() returns text
language sql as $$
  select md5(string_agg(x, '|' order by x)) from (
    select 'projects:' || t::text as x from public.projects t
    union all select 'phases:' || t::text from public.phases t
    union all select 'tenants:' || t::text from public.tenants t
    union all select 'tenant_members:' || t::text from public.tenant_members t
  ) s
$$;

grant usage on schema rlstest to anon, authenticated;
grant execute on all functions in schema rlstest to anon, authenticated;

-- ---- the truth, read as the cluster superuser --------------------------------------------------

select count(*) as a_projects from public.projects where tenant_id = 'owner-personal' \gset
select count(*) as b_projects from public.projects where tenant_id = 'agency-business' \gset
select count(*) as a_phases from public.phases where tenant_id = 'owner-personal' \gset
select count(*) as b_phases from public.phases where tenant_id = 'agency-business' \gset
select rlstest.snapshot() as snap_before \gset

-- A fixture with an empty tenant would make every "zero rows" below a false pass.
select rlstest.ok('A-FIXTURE-both-tenants-seeded',
  :a_projects > 0 and :b_projects > 0 and :a_phases > 0 and :b_phases > 0,
  format('A %s/%s, B %s/%s', :a_projects, :a_phases, :b_projects, :b_phases));
select rlstest.ok('A-FIXTURE-co-member-exists',
  (select count(*) from public.tenant_members where tenant_id = 'owner-personal') >= 2, 'tenant A has another member to hide');

-- ---- structure ---------------------------------------------------------------------------------

select rlstest.ok('A-MIGRATION-OWNER-NOT-SUPERUSER',
  (select not rolsuper and rolcreaterole and rolbypassrls from pg_roles where rolname = 'postgres'), 'matches live postgres');
select rlstest.ok('A-BACKFILL-SEED-TENANT',
  (select count(*) from public.projects where tenant_id = 'owner-personal' and id in
    ('bizcomply-v2', 'boithok-khana', 'brik', 'coverdrive', 'criclocal', 'erp-system', 'firm-flow',
     'jd-testing', 'polygo', 'projectos', 'tkn', 'trading-bot')) = :expected_seed,
  'every seeded project is in owner-personal');
select rlstest.ok('A-NODEFAULT-projects',
  (select attnotnull and not atthasdef from pg_attribute where attrelid = 'public.projects'::regclass and attname = 'tenant_id'), 'not null, no default');
select rlstest.ok('A-NODEFAULT-phases',
  (select attnotnull and not atthasdef from pg_attribute where attrelid = 'public.phases'::regclass and attname = 'tenant_id'), 'not null, no default');
select rlstest.ok('A-PK-projects',
  (select pg_get_constraintdef(oid) = 'PRIMARY KEY (tenant_id, id)' from pg_constraint where conrelid = 'public.projects'::regclass and contype = 'p'), 'key is per tenant');
select rlstest.ok('A-PK-phases',
  (select pg_get_constraintdef(oid) = 'PRIMARY KEY (tenant_id, id)' from pg_constraint where conrelid = 'public.phases'::regclass and contype = 'p'), 'key is per tenant');
select rlstest.ok('A-UNIQUE-phases',
  exists (select 1 from pg_constraint where conrelid = 'public.phases'::regclass and contype = 'u'
           and pg_get_constraintdef(oid) = 'UNIQUE (tenant_id, project_id, phase_id)'), 'phase ids are unique per tenant');
select rlstest.ok('A-REALTIME-OUT',
  not exists (select 1 from pg_publication_tables where schemaname = 'public'
               and tablename in ('projects', 'phases', 'tenants', 'tenant_members')), 'all four out of every publication');

-- ---- positive controls: the same role sees its own rows ----------------------------------------

select rlstest.login(:'a_owner');
select rlstest.expect_count('A-CTRL-A-projects', $$select count(*) from public.projects$$, :a_projects);
select rlstest.expect_count('A-CTRL-A-phases', $$select count(*) from public.phases$$, :a_phases);
select rlstest.expect_count('A-CTRL-A-tenants', $$select count(*) from public.tenants$$, 1);
select rlstest.expect_count('A-CTRL-A-tenant_members', $$select count(*) from public.tenant_members$$, 1);

select rlstest.login(:'b_owner');
select rlstest.expect_count('A-CTRL-B-projects', $$select count(*) from public.projects$$, :b_projects);
select rlstest.expect_count('A-CTRL-B-phases', $$select count(*) from public.phases$$, :b_phases);
select rlstest.expect_count('A-CTRL-B-tenants', $$select count(*) from public.tenants$$, 1);
select rlstest.expect_count('A-CTRL-B-tenant_members', $$select count(*) from public.tenant_members$$, 1);

select rlstest.login(:'a_member');
select rlstest.expect_count('A-CTRL-MEMBER-projects', $$select count(*) from public.projects$$, :a_projects);
select rlstest.expect_count('A-CTRL-MEMBER-phases', $$select count(*) from public.phases$$, :a_phases);
select rlstest.expect_count('A-CTRL-MEMBER-tenants', $$select count(*) from public.tenants$$, 1);

select rlstest.login(:'both');
select rlstest.expect_count('A-BOTH-CTRL-projects', $$select count(*) from public.projects$$, :a_projects + :b_projects);
select rlstest.expect_count('A-BOTH-CTRL-phases', $$select count(*) from public.phases$$, :a_phases + :b_phases);
select rlstest.expect_count('A-BOTH-CTRL-tenants', $$select count(*) from public.tenants$$, 2);
select rlstest.expect_count('A-BOTH-CTRL-tenant_members', $$select count(*) from public.tenant_members$$, 2);

-- ---- cross-tenant reads ------------------------------------------------------------------------

select rlstest.login(:'a_owner');
select rlstest.expect_count('A-XREAD-projects', $$select count(*) from public.projects where tenant_id = 'agency-business'$$, 0);
select rlstest.expect_count('A-XREAD-phases', $$select count(*) from public.phases where tenant_id = 'agency-business'$$, 0);
select rlstest.expect_count('A-XREAD-tenants', $$select count(*) from public.tenants where id = 'agency-business'$$, 0);
select rlstest.expect_count('A-XREAD-tenant_members', $$select count(*) from public.tenant_members where tenant_id = 'agency-business'$$, 0);
select rlstest.expect_count('A-MEMBERS-SELF-ONLY', $$select count(*) from public.tenant_members where user_id <> (select auth.uid())$$, 0);

select rlstest.login(:'b_owner');
select rlstest.expect_count('A-XREAD-B-projects', $$select count(*) from public.projects where tenant_id = 'owner-personal'$$, 0);
select rlstest.expect_count('A-XREAD-B-phases', $$select count(*) from public.phases where tenant_id = 'owner-personal'$$, 0);
select rlstest.expect_count('A-XREAD-B-tenants', $$select count(*) from public.tenants where id = 'owner-personal'$$, 0);
select rlstest.expect_count('A-XREAD-B-tenant_members', $$select count(*) from public.tenant_members where tenant_id = 'owner-personal'$$, 0);

-- ---- those who may read nothing ----------------------------------------------------------------

select rlstest.login(:'stranger');
select rlstest.expect_count('A-NONMEMBER-projects', $$select count(*) from public.projects$$, 0);
select rlstest.expect_count('A-NONMEMBER-phases', $$select count(*) from public.phases$$, 0);
select rlstest.expect_count('A-NONMEMBER-tenants', $$select count(*) from public.tenants$$, 0);
select rlstest.expect_count('A-NONMEMBER-tenant_members', $$select count(*) from public.tenant_members$$, 0);

select rlstest.login_claims('');
select rlstest.expect_count('A-NULLCLAIMS-projects', $$select count(*) from public.projects$$, 0);
select rlstest.expect_count('A-NULLCLAIMS-phases', $$select count(*) from public.phases$$, 0);
select rlstest.expect_count('A-NULLCLAIMS-tenants', $$select count(*) from public.tenants$$, 0);
select rlstest.expect_count('A-NULLCLAIMS-tenant_members', $$select count(*) from public.tenant_members$$, 0);

select rlstest.login_claims('{"role":"authenticated"}');
select rlstest.expect_count('A-NOSUBCLAIM-projects', $$select count(*) from public.projects$$, 0);
select rlstest.expect_count('A-NOSUBCLAIM-tenant_members', $$select count(*) from public.tenant_members$$, 0);

select rlstest.login_anon();
select rlstest.expect_error('A-ANON-projects', $$select count(*) from public.projects$$, '%permission denied%');
select rlstest.expect_error('A-ANON-phases', $$select count(*) from public.phases$$, '%permission denied%');
select rlstest.expect_error('A-ANON-tenants', $$select count(*) from public.tenants$$, '%permission denied%');
select rlstest.expect_error('A-ANON-tenant_members', $$select count(*) from public.tenant_members$$, '%permission denied%');
select rlstest.expect_error('A-ANON-helper', $$select count(*) from private.my_tenant_ids()$$, '%permission denied%');

-- ---- cross-tenant writes. Each refusal is paired with a control: B's owner, same statement --------

select rlstest.login(:'b_owner');
select rlstest.expect_rows('A-XWRITE-CTRL-update-projects', $$update public.projects set name = 'x' where id = 'fx-beta'$$, 1);
select rlstest.expect_rows('A-XWRITE-CTRL-delete-projects', $$delete from public.projects where id = 'fx-beta'$$, 1);
select rlstest.expect_rows('A-XWRITE-CTRL-update-phases', $$update public.phases set objective = 'x' where project_id = 'fx-beta'$$, 1);
select rlstest.expect_rows('A-XWRITE-CTRL-delete-phases', $$delete from public.phases where project_id = 'fx-beta'$$, 1);

select rlstest.login(:'a_owner');
select rlstest.expect_rows('A-XWRITE-update-projects', $$update public.projects set name = 'x' where id = 'fx-beta'$$, 0);
select rlstest.expect_rows('A-XWRITE-delete-projects', $$delete from public.projects where id = 'fx-beta'$$, 0);
select rlstest.expect_rows('A-XWRITE-update-phases', $$update public.phases set objective = 'x' where project_id = 'fx-beta'$$, 0);
select rlstest.expect_rows('A-XWRITE-delete-phases', $$delete from public.phases where project_id = 'fx-beta'$$, 0);
select rlstest.expect_error('A-XWRITE-insert-projects',
  $$insert into public.projects (tenant_id, id, name) values ('agency-business', 'fx-new', 'x')$$, '%row-level security%');
select rlstest.expect_error('A-XWRITE-insert-phases',
  $$insert into public.phases (tenant_id, project_id, phase_id) values ('agency-business', 'fx-beta', 'P9')$$, '%row-level security%');

-- A shared id reaches only the caller's own row.
select rlstest.expect_rows('A-SHARED-ID-OWN-ROW-ONLY', $$update public.projects set name = 'x' where id = 'fx-shared'$$, 1);

-- Stealing a row: the column grant, not row level security, refuses this.
select rlstest.expect_error('A-STEAL-projects', $$update public.projects set tenant_id = 'owner-personal' where id = 'fx-beta'$$, '%permission denied%');
select rlstest.expect_error('A-STEAL-phases', $$update public.phases set tenant_id = 'owner-personal' where project_id = 'fx-beta'$$, '%permission denied%');

-- Pointing a phase at B's project.
select rlstest.expect_error('A-XFK-insert',
  $$insert into public.phases (tenant_id, project_id, phase_id) values ('owner-personal', 'fx-beta', 'P9')$$, '%foreign key%');
select rlstest.expect_error('A-XFK-update', $$update public.phases set project_id = 'fx-beta' where project_id = 'fx-alpha'$$, '%permission denied%');

-- A global key would refuse this and so reveal that B holds the id.
select rlstest.expect_rows('A-ID-ORACLE', $$insert into public.projects (tenant_id, id, name) values ('owner-personal', 'fx-beta', 'x')$$, 1);

-- ---- an owner writing their own tenant: the control for every member refusal below ----------------

select rlstest.expect_rows('A-OWNWRITE-insert-projects', $$insert into public.projects (tenant_id, id, name) values ('owner-personal', 'fx-new', 'x')$$, 1);
select rlstest.expect_rows('A-OWNWRITE-update-projects', $$update public.projects set name = 'x' where id = 'fx-alpha'$$, 1);
select rlstest.expect_rows('A-OWNWRITE-delete-projects', $$delete from public.projects where id = 'fx-alpha'$$, 1);
select rlstest.expect_rows('A-OWNWRITE-insert-phases', $$insert into public.phases (tenant_id, project_id, phase_id) values ('owner-personal', 'fx-alpha', 'P9')$$, 1);
select rlstest.expect_rows('A-OWNWRITE-update-phases', $$update public.phases set objective = 'x' where project_id = 'fx-alpha'$$, 1);
select rlstest.expect_rows('A-OWNWRITE-delete-phases', $$delete from public.phases where project_id = 'fx-alpha'$$, 1);

-- ---- a non-owner member cannot write --------------------------------------------------------------

select rlstest.login(:'a_member');
select rlstest.expect_count('A-MEMBER-SEES-THE-ROW', $$select count(*) from public.projects where id = 'fx-alpha'$$, 1);
select rlstest.expect_error('A-MEMBER-INSERT-projects', $$insert into public.projects (tenant_id, id, name) values ('owner-personal', 'fx-new', 'x')$$, '%row-level security%');
select rlstest.expect_rows('A-MEMBER-UPDATE-projects', $$update public.projects set name = 'x' where id = 'fx-alpha'$$, 0);
select rlstest.expect_rows('A-MEMBER-DELETE-projects', $$delete from public.projects where id = 'fx-alpha'$$, 0);
select rlstest.expect_error('A-MEMBER-INSERT-phases', $$insert into public.phases (tenant_id, project_id, phase_id) values ('owner-personal', 'fx-alpha', 'P9')$$, '%row-level security%');
select rlstest.expect_rows('A-MEMBER-UPDATE-phases', $$update public.phases set objective = 'x' where project_id = 'fx-alpha'$$, 0);
select rlstest.expect_rows('A-MEMBER-DELETE-phases', $$delete from public.phases where project_id = 'fx-alpha'$$, 0);

-- ---- a user who owns BOTH tenants. Row level security would allow all of this, so only the column
-- ---- grant and the composite foreign key can refuse it. -------------------------------------------

select rlstest.login(:'both');
select rlstest.expect_rows('A-BOTH-WRITES-BOTH', $$update public.projects set name = 'x' where id = 'fx-shared'$$, 2);
select rlstest.expect_error('A-BOTH-TENANT-projects', $$update public.projects set tenant_id = 'agency-business' where id = 'fx-alpha'$$, '%permission denied%');
select rlstest.expect_error('A-BOTH-TENANT-phases', $$update public.phases set tenant_id = 'agency-business' where project_id = 'fx-alpha'$$, '%permission denied%');
select rlstest.expect_error('A-BOTH-UPSERT-TENANT',
  $$insert into public.projects (tenant_id, id, name) values ('owner-personal', 'fx-alpha', 'x')
    on conflict (tenant_id, id) do update set tenant_id = 'agency-business'$$, '%permission denied%');
select rlstest.expect_error('A-BOTH-ID-projects', $$update public.projects set id = 'fx-renamed' where id = 'fx-alpha'$$, '%permission denied%');
select rlstest.expect_error('A-BOTH-ID-phases', $$update public.phases set id = gen_random_uuid() where project_id = 'fx-alpha'$$, '%permission denied%');
select rlstest.expect_error('A-BOTH-PROJECT-phases', $$update public.phases set project_id = 'fx-beta' where project_id = 'fx-alpha'$$, '%permission denied%');
select rlstest.expect_error('A-BOTH-XFK',
  $$insert into public.phases (tenant_id, project_id, phase_id) values ('owner-personal', 'fx-beta', 'P9')$$, '%foreign key%');

-- ---- no client writes tenants or tenant_members, and nobody adds themselves ----------------------

do $do$
declare
  who record;
begin
  for who in select * from (values
    ('owner', 'aaaaaaaa-0000-4000-8000-000000000001'::uuid),
    ('both', 'cd2e8678-1e00-4264-95bb-7d75738a1f50'::uuid),
    ('stranger', 'cccccccc-0000-4000-8000-000000000001'::uuid)
  ) as t(label, uid)
  loop
    perform rlstest.login(who.uid);
    perform rlstest.expect_error('A-NOWRITE-tenants-insert-' || who.label, $$insert into public.tenants (id, name) values ('x', 'x')$$, '%permission denied%');
    perform rlstest.expect_error('A-NOWRITE-tenants-update-' || who.label, $$update public.tenants set name = 'x'$$, '%permission denied%');
    perform rlstest.expect_error('A-NOWRITE-tenants-delete-' || who.label, $$delete from public.tenants$$, '%permission denied%');
    perform rlstest.expect_error('A-NOWRITE-members-update-' || who.label, $$update public.tenant_members set role = 'owner'$$, '%permission denied%');
    perform rlstest.expect_error('A-NOWRITE-members-delete-' || who.label, $$delete from public.tenant_members$$, '%permission denied%');
    perform rlstest.expect_error('A-SELFADD-' || who.label,
      $$insert into public.tenant_members (tenant_id, user_id, role) values ('agency-business', auth.uid(), 'owner')$$, '%permission denied%');
  end loop;
end
$do$;

select rlstest.login(:'a_member');
select rlstest.expect_error('A-SELFPROMOTE', $$update public.tenant_members set role = 'owner' where user_id = auth.uid()$$, '%permission denied%');

-- ---- TRUNCATE, which row level security does not filter -------------------------------------------

select rlstest.login(:'both');
select rlstest.expect_error('A-TRUNCATE-authenticated-projects', $$truncate public.projects$$, '%permission denied%');
select rlstest.expect_error('A-TRUNCATE-authenticated-phases', $$truncate public.phases$$, '%permission denied%');
select rlstest.expect_error('A-TRUNCATE-authenticated-tenants', $$truncate public.tenants$$, '%permission denied%');
select rlstest.expect_error('A-TRUNCATE-authenticated-tenant_members', $$truncate public.tenant_members$$, '%permission denied%');

select rlstest.login_anon();
select rlstest.expect_error('A-TRUNCATE-anon-projects', $$truncate public.projects$$, '%permission denied%');
select rlstest.expect_error('A-TRUNCATE-anon-phases', $$truncate public.phases$$, '%permission denied%');
select rlstest.expect_error('A-TRUNCATE-anon-tenants', $$truncate public.tenants$$, '%permission denied%');
select rlstest.expect_error('A-TRUNCATE-anon-tenant_members', $$truncate public.tenant_members$$, '%permission denied%');

-- ---- helpers answer for the caller alone -----------------------------------------------------------

select rlstest.login(:'a_member');
select rlstest.expect_count('A-HELPER-member-tenants', $$select count(*) from private.my_tenant_ids()$$, 1);
select rlstest.expect_count('A-HELPER-member-owns-none', $$select count(*) from private.my_owned_tenant_ids()$$, 0);
select rlstest.login(:'both');
select rlstest.expect_count('A-HELPER-both-tenants', $$select count(*) from private.my_tenant_ids()$$, 2);
select rlstest.expect_count('A-HELPER-both-owned', $$select count(*) from private.my_owned_tenant_ids()$$, 2);

-- ---- nothing above left a mark -----------------------------------------------------------------------

select rlstest.logout();
select rlstest.ok('A-ROWS-UNCHANGED', rlstest.snapshot() = :'snap_before', 'all four tables are byte-equal to the start');

select 'FAILED|' || id || '|' || coalesce(detail, '') from rlstest.result where not ok order by seq;
select 'TOTAL|' || count(*) from rlstest.result;
select 'COMPLETE';
