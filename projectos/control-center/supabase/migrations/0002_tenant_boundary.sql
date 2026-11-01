-- ProjectOS Control Center: tenant boundary, PROJECTOS-TENANT-RLS1A.
--
-- Replaces the using(true) policies with tenant-bound access. Forward-only and transactional: the
-- check at the end raises inside the transaction, so a bad apply leaves the database as it was.
-- Re-running it changes nothing. It must run as the table owner, `postgres`, which on Supabase is not a
-- superuser: objects made by anyone else would be unreadable to it. Owner membership is a separate step
-- (test/live-owner-membership.sql) so these bytes hold no personal identifier.

begin;

set local lock_timeout = '10s';
set local search_path = '';

do $role$
begin
  if current_user <> 'postgres' then
    raise exception 'TENANT_BOUNDARY_WRONG_ROLE: run this as postgres, not %', current_user;
  end if;
end
$role$;

-- ---- 1. Tenants and their members --------------------------------------------------------------

create table if not exists public.tenants (
  id         text primary key,
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_members (
  tenant_id  text not null references public.tenants(id),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

insert into public.tenants (id, name) values
  ('owner-personal', 'Owner personal'),
  ('agency-business', 'Agency business')
on conflict (id) do nothing;

-- ---- 2. tenant_id, backfilled from an explicit map --------------------------------------------
-- A row the map does not name is not guessed at: it stops the migration. Sign-up was open, so a known id
-- is not enough: a row whose content differs from the seed is not mapped either. The column has no
-- default, so nothing can land in a tenant by accident.

alter table public.projects add column if not exists tenant_id text;
alter table public.phases add column if not exists tenant_id text;

update public.projects as p
   set tenant_id = m.tenant_id
  from (values
    ('bizcomply-v2',  'owner-personal', 'BizComply V2',     'universalbizcomply/opsoft-ios-lab',   'installed', true,  0),
    ('boithok-khana', 'owner-personal', 'Boithok Khana',    'none',                                'installed', true,  0),
    ('brik',          'owner-personal', 'Brik',             'universalbizcomply/brik',             'installed', true,  0),
    ('coverdrive',    'owner-personal', 'Coverdrive',       'coverdrivemanchester-art/Coverdrive', 'installed', true,  0),
    ('criclocal',     'owner-personal', 'CricLocal',        'muraddevbuild-maker/criclocal',       'installed', true,  0),
    ('erp-system',    'owner-personal', 'ERP System',       'none',                                'installed', true,  0),
    ('firm-flow',     'owner-personal', 'Firm Flow',        'none',                                'installed', true,  0),
    ('jd-testing',    'owner-personal', 'JD Testing',       'jdonlinetesting/JDtesting',           'installed', true,  0),
    ('polygo',        'owner-personal', 'PolyGo',           'polygonia-apres/polygo',              'installed', true,  0),
    ('projectos',     'owner-personal', 'ProjectOS (self)', 'universalbizcomply/ProjectOS',        'installed', false, 12),
    ('tkn',           'owner-personal', 'TKN',              'none',                                'installed', true,  0),
    ('trading-bot',   'owner-personal', 'Trading Bot',      'none',                                'installed', true,  0)
  ) as m(project_id, tenant_id, name, repo, install_status, production_freeze, open_phases)
 where p.id = m.project_id
   and p.name = m.name
   and p.repo = m.repo
   and p.install_status = m.install_status
   and p.production_freeze = m.production_freeze
   and p.open_phases = m.open_phases
   and p.tenant_id is null;

do $unmapped$
declare
  unmapped text;
begin
  select string_agg(id, ', ' order by id) into unmapped from public.projects where tenant_id is null;
  if unmapped is not null then
    raise exception 'TENANT_BACKFILL_UNMAPPED: no tenant for projects: %', unmapped;
  end if;
end
$unmapped$;

update public.phases as ph
   set tenant_id = p.tenant_id
  from public.projects as p
 where p.id = ph.project_id
   and ph.tenant_id is null;

do $orphans$
begin
  if exists (select 1 from public.phases where tenant_id is null) then
    raise exception 'TENANT_BACKFILL_UNMAPPED: a phase has no tenant';
  end if;
end
$orphans$;

alter table public.projects
  alter column tenant_id drop default,
  alter column tenant_id set not null;
alter table public.phases
  alter column tenant_id drop default,
  alter column tenant_id set not null;

-- ---- 3. Keys ----------------------------------------------------------------------------------
-- Keys are per tenant, so an id cannot reveal that another tenant holds the same id, and the composite
-- foreign key means a phase cannot point at another tenant's project even for a user who owns both.
-- Keys that already match are left alone: a re-run is a true no-op, and it cannot fail because a later
-- object has come to depend on one of them.

do $keys$
begin
  if (select count(*)
        from pg_catalog.pg_constraint as c
        join (values
          ('public.projects', 'projects_pkey', 'PRIMARY KEY (tenant_id, id)'),
          ('public.projects', 'projects_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)'),
          ('public.phases', 'phases_pkey', 'PRIMARY KEY (tenant_id, id)'),
          ('public.phases', 'phases_tenant_project_fkey',
            'FOREIGN KEY (tenant_id, project_id) REFERENCES public.projects(tenant_id, id) ON DELETE CASCADE'),
          ('public.phases', 'phases_tenant_project_phase_key', 'UNIQUE (tenant_id, project_id, phase_id)')
        ) as k(relname, conname, condef)
          on c.conrelid = k.relname::pg_catalog.regclass
         and c.conname = k.conname
         and pg_catalog.pg_get_constraintdef(c.oid) = k.condef) = 5 then
    return;
  end if;

  alter table public.phases
    drop constraint if exists phases_project_id_fkey,
    drop constraint if exists phases_tenant_project_fkey,
    drop constraint if exists phases_project_id_phase_id_key,
    drop constraint if exists phases_tenant_project_phase_key,
    drop constraint if exists phases_pkey;
  alter table public.projects
    drop constraint if exists projects_tenant_id_fkey,
    drop constraint if exists projects_pkey;

  alter table public.projects
    add constraint projects_pkey primary key (tenant_id, id),
    add constraint projects_tenant_id_fkey foreign key (tenant_id) references public.tenants(id);

  alter table public.phases
    add constraint phases_pkey primary key (tenant_id, id),
    add constraint phases_tenant_project_fkey foreign key (tenant_id, project_id)
      references public.projects(tenant_id, id) on delete cascade,
    add constraint phases_tenant_project_phase_key unique (tenant_id, project_id, phase_id);
end
$keys$;

-- The policy paths on projects and phases are served by the keys above, which lead with tenant_id.
create index if not exists tenant_members_user_id_idx on public.tenant_members (user_id);

-- ---- 4. Helpers -------------------------------------------------------------------------------
-- Security invoker on purpose. tenant_members answers a user with their own rows through a policy
-- that never calls these helpers, so there is no recursion, and no definer rights are needed.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;

create or replace function private.my_tenant_ids()
returns setof text
language sql
stable
security invoker
set search_path = ''
as $helper$
  select m.tenant_id from public.tenant_members as m where m.user_id = (select auth.uid());
$helper$;

create or replace function private.my_owned_tenant_ids()
returns setof text
language sql
stable
security invoker
set search_path = ''
as $helper$
  select m.tenant_id from public.tenant_members as m
   where m.user_id = (select auth.uid()) and m.role = 'owner';
$helper$;

revoke all on function private.my_tenant_ids() from public, anon, service_role;
revoke all on function private.my_owned_tenant_ids() from public, anon, service_role;
grant execute on function private.my_tenant_ids() to authenticated;
grant execute on function private.my_owned_tenant_ids() to authenticated;

-- ---- 5. Policies: members read, tenant owners write --------------------------------------------

alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.projects enable row level security;
alter table public.phases enable row level security;

drop policy if exists "projects public read" on public.projects;
drop policy if exists "projects authenticated read" on public.projects;
drop policy if exists "projects authenticated write" on public.projects;
drop policy if exists "phases authenticated all" on public.phases;

drop policy if exists "tenants member read" on public.tenants;
create policy "tenants member read" on public.tenants
  for select to authenticated
  using (id in (select private.my_tenant_ids()));

-- A user sees only their own membership rows. There is no write policy and no write grant, so nobody
-- can add themselves from a client.
drop policy if exists "tenant_members self read" on public.tenant_members;
create policy "tenant_members self read" on public.tenant_members
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "projects member read" on public.projects;
create policy "projects member read" on public.projects
  for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));

drop policy if exists "projects owner insert" on public.projects;
create policy "projects owner insert" on public.projects
  for insert to authenticated
  with check (tenant_id in (select private.my_owned_tenant_ids()));

drop policy if exists "projects owner update" on public.projects;
create policy "projects owner update" on public.projects
  for update to authenticated
  using (tenant_id in (select private.my_owned_tenant_ids()))
  with check (tenant_id in (select private.my_owned_tenant_ids()));

drop policy if exists "projects owner delete" on public.projects;
create policy "projects owner delete" on public.projects
  for delete to authenticated
  using (tenant_id in (select private.my_owned_tenant_ids()));

drop policy if exists "phases member read" on public.phases;
create policy "phases member read" on public.phases
  for select to authenticated
  using (tenant_id in (select private.my_tenant_ids()));

drop policy if exists "phases owner insert" on public.phases;
create policy "phases owner insert" on public.phases
  for insert to authenticated
  with check (tenant_id in (select private.my_owned_tenant_ids()));

drop policy if exists "phases owner update" on public.phases;
create policy "phases owner update" on public.phases
  for update to authenticated
  using (tenant_id in (select private.my_owned_tenant_ids()))
  with check (tenant_id in (select private.my_owned_tenant_ids()));

drop policy if exists "phases owner delete" on public.phases;
create policy "phases owner delete" on public.phases
  for delete to authenticated
  using (tenant_id in (select private.my_owned_tenant_ids()));

-- ---- 6. Grants: the first wall -----------------------------------------------------------------
-- Supabase's default privileges hand anon and authenticated everything on a new table, including
-- TRUNCATE, which row level security does not filter. REVOKE ALL also clears any column grants.

revoke all on table public.projects, public.phases, public.tenants, public.tenant_members
  from public, anon, authenticated;

grant select on table public.tenants, public.tenant_members to authenticated;
grant select, insert, delete on table public.projects, public.phases to authenticated;
grant update (name, repo, install_status, production_freeze, open_phases)
  on table public.projects to authenticated;
grant update (phase_id, objective, status, history, advisor_note)
  on table public.phases to authenticated;

-- ---- 7. Realtime ------------------------------------------------------------------------------
-- Delete events are not filtered by row level security. Tolerates a table being in the publication or
-- not, and the publication not existing at all.

do $realtime$
declare
  member text;
begin
  for member in
    select tablename from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename in ('projects', 'phases', 'tenants', 'tenant_members')
  loop
    execute pg_catalog.format('alter publication supabase_realtime drop table public.%I', member);
  end loop;
end
$realtime$;

-- ---- 8. In-transaction check -------------------------------------------------------------------
-- Judges what the catalogue now says, not what this file meant to do. Any finding rolls everything back.

do $check$
declare
  problems text[];
begin
  with
  boundary(relname) as (values ('projects'), ('phases'), ('tenants'), ('tenant_members')),
  rels as (
    select c.oid, c.relname, c.relrowsecurity, c.relacl, c.relowner
      from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      join boundary as b on b.relname = c.relname
     where n.nspname = 'public' and c.relkind = 'r'
  ),
  privs(priv) as (
    values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
  ),
  expected_key(relname, conname, condef) as (values
    ('projects', 'projects_pkey', 'PRIMARY KEY (tenant_id, id)'),
    ('projects', 'projects_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)'),
    ('phases', 'phases_pkey', 'PRIMARY KEY (tenant_id, id)'),
    ('phases', 'phases_tenant_project_fkey',
      'FOREIGN KEY (tenant_id, project_id) REFERENCES public.projects(tenant_id, id) ON DELETE CASCADE'),
    ('phases', 'phases_tenant_project_phase_key', 'UNIQUE (tenant_id, project_id, phase_id)')
  ),
  member_expr(expr) as (values ('(tenant_id IN ( SELECT private.my_tenant_ids() AS my_tenant_ids))')),
  owner_expr(expr) as (values ('(tenant_id IN ( SELECT private.my_owned_tenant_ids() AS my_owned_tenant_ids))')),
  expected_policy(relname, polname, polcmd, qual, with_check) as (
    select 'tenants', 'tenants member read', 'r', '(id IN ( SELECT private.my_tenant_ids() AS my_tenant_ids))', null
    union all
    select 'tenant_members', 'tenant_members self read', 'r', '(user_id = ( SELECT auth.uid() AS uid))', null
    union all
    select t.relname, t.relname || ' member read', 'r', m.expr, null
      from (values ('projects'), ('phases')) as t(relname) cross join member_expr as m
    union all
    select t.relname, t.relname || ' owner insert', 'a', null, o.expr
      from (values ('projects'), ('phases')) as t(relname) cross join owner_expr as o
    union all
    select t.relname, t.relname || ' owner update', 'w', o.expr, o.expr
      from (values ('projects'), ('phases')) as t(relname) cross join owner_expr as o
    union all
    select t.relname, t.relname || ' owner delete', 'd', o.expr, null
      from (values ('projects'), ('phases')) as t(relname) cross join owner_expr as o
  ),
  live_policy as (
    select r.relname, p.polname, p.polcmd::text as polcmd, p.polroles,
           pg_catalog.pg_get_expr(p.polqual, p.polrelid) as qual,
           pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as with_check
      from pg_catalog.pg_policy as p
      join rels as r on r.oid = p.polrelid
  ),
  expected_helper(proname) as (values ('my_tenant_ids'), ('my_owned_tenant_ids')),
  live_helper as (
    select p.oid, p.proname, p.provolatile, p.pronargs, p.prosecdef, p.proconfig, p.proacl, p.proowner
      from pg_catalog.pg_proc as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'private'
  ),
  findings(problem) as (
    select 'table is missing: ' || b.relname
      from boundary as b
     where not exists (select 1 from rels as r where r.relname = b.relname)
    union all
    select 'row level security is off on ' || r.relname from rels as r where not r.relrowsecurity
    union all
    select 'tenant_id is nullable, missing or has a default on ' || r.relname
      from rels as r
     where r.relname in ('projects', 'phases')
       and not exists (
         select 1 from pg_catalog.pg_attribute as a
          where a.attrelid = r.oid and a.attname = 'tenant_id' and a.attnotnull and not a.atthasdef)
    union all
    select 'key is missing or different: ' || k.conname
      from expected_key as k
     where not exists (
       select 1 from pg_catalog.pg_constraint as c
        where c.conname = k.conname
          and c.conrelid = (select r.oid from rels as r where r.relname = k.relname)
          and pg_catalog.pg_get_constraintdef(c.oid) = k.condef)
    union all
    select 'policy is missing: ' || e.polname
      from expected_policy as e
     where not exists (
       select 1 from live_policy as l
        where l.relname = e.relname and l.polname = e.polname and l.polcmd = e.polcmd)
    union all
    select 'policy is not expected: ' || l.polname
      from live_policy as l
     where not exists (
       select 1 from expected_policy as e where e.relname = l.relname and e.polname = l.polname)
    union all
    select 'policy is not for authenticated alone: ' || l.polname
      from live_policy as l
     where l.polroles <> array[(select r.oid from pg_catalog.pg_roles as r where r.rolname = 'authenticated')]::pg_catalog.oid[]
    union all
    select 'policy is not bound to its helper: ' || l.polname
      from live_policy as l
      join expected_policy as e on e.relname = l.relname and e.polname = l.polname
     where l.qual is distinct from e.qual
        or l.with_check is distinct from e.with_check
    union all
    select 'not owned by postgres: table ' || r.relname
      from rels as r
     where pg_catalog.pg_get_userbyid(r.relowner) <> 'postgres'
    union all
    select 'not owned by postgres: schema private'
      from pg_catalog.pg_namespace as n
     where n.nspname = 'private' and pg_catalog.pg_get_userbyid(n.nspowner) <> 'postgres'
    union all
    select 'not owned by postgres: helper ' || h.proname
      from live_helper as h
     where pg_catalog.pg_get_userbyid(h.proowner) <> 'postgres'
    union all
    select 'anon holds ' || p.priv || ' on ' || r.relname
      from rels as r cross join privs as p
     where pg_catalog.has_table_privilege('anon', r.oid, p.priv)
    union all
    select 'anon holds a column privilege on ' || r.relname
      from rels as r
     where pg_catalog.has_any_column_privilege('anon', r.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
    union all
    select 'PUBLIC holds ' || a.privilege_type || ' on ' || r.relname
      from rels as r
     cross join lateral pg_catalog.aclexplode(coalesce(r.relacl, pg_catalog.acldefault('r', r.relowner))) as a
     where a.grantee = 0
    union all
    select 'authenticated holds ' || p.priv || ' on ' || r.relname
      from rels as r cross join privs as p
     where pg_catalog.has_table_privilege('authenticated', r.oid, p.priv)
       and not (p.priv = 'SELECT' or (p.priv in ('INSERT', 'DELETE') and r.relname in ('projects', 'phases')))
    union all
    select 'authenticated can update ' || r.relname || '.' || a.attname
      from rels as r
      join pg_catalog.pg_attribute as a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
     where pg_catalog.has_column_privilege('authenticated', r.oid, a.attnum, 'UPDATE')
       and not (r.relname = 'projects' and a.attname in ('name', 'repo', 'install_status', 'production_freeze', 'open_phases'))
       and not (r.relname = 'phases' and a.attname in ('phase_id', 'objective', 'status', 'history', 'advisor_note'))
    union all
    select 'anon can use schema private' where pg_catalog.has_schema_privilege('anon', 'private', 'USAGE')
    union all
    select 'helper is missing: ' || e.proname
      from expected_helper as e
     where not exists (select 1 from live_helper as h where h.proname = e.proname)
    union all
    select 'helper is not stable, argument-free, invoker and search_path empty: ' || h.proname
      from live_helper as h
     where h.provolatile <> 's' or h.pronargs <> 0 or h.prosecdef
        or h.proconfig is distinct from array['search_path=""']
    union all
    select 'anon can execute ' || h.proname
      from live_helper as h
     where pg_catalog.has_function_privilege('anon', h.oid, 'EXECUTE')
    union all
    select 'PUBLIC can execute ' || h.proname
      from live_helper as h
     cross join lateral pg_catalog.aclexplode(coalesce(h.proacl, pg_catalog.acldefault('f', h.proowner))) as a
     where a.grantee = 0
    union all
    select 'table is still in supabase_realtime: ' || t.tablename
      from pg_catalog.pg_publication_tables as t
      join boundary as b on b.relname = t.tablename
     where t.pubname = 'supabase_realtime' and t.schemaname = 'public'
  )
  select array_agg(f.problem order by f.problem) into problems from findings as f;

  if problems is not null then
    raise exception 'TENANT_BOUNDARY_CHECK_FAILED: %', pg_catalog.array_to_string(problems, '; ');
  end if;
end
$check$;

commit;
