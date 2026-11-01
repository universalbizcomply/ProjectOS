-- ProjectOS Control Center: read-only live preflight for 0002_tenant_boundary.sql.
--
-- ONE SELECT statement, nothing else: it can change nothing, and a tool that returns only the last
-- result still returns all of it. Run it as supabase_read_only_user before the owner's live apply.
-- Each row is (section, item, ok, detail); ok is null for a plain listing. The apply may proceed only if
-- the final row reads PREFLIGHT, all, true.
--
-- It reads raw ACLs and catalogues, never information_schema: on live, role_table_grants came back
-- EMPTY to this role although the grants exist. It does not cover the owner's other two checks: sign-up
-- switched off, and a fresh export of both tables taken. Those happen outside the database.

with
seed(id, tenant, name, repo, install_status, production_freeze, open_phases) as (values
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
),
owner_account(id) as (values ('cd2e8678-1e00-4264-95bb-7d75738a1f50'::uuid)),
targets as (
  select c.oid, c.relname, c.relowner, c.relacl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('projects', 'phases') and c.relkind = 'r'
),
known_policy(relname, polname) as (values
  ('projects', 'projects public read'),
  ('projects', 'projects authenticated read'),
  ('projects', 'projects authenticated write'),
  ('phases', 'phases authenticated all')
),
live_policy as (
  select t.relname, p.polname, p.polcmd::text as polcmd,
         coalesce(pg_get_expr(p.polqual, p.polrelid), '-') as qual,
         coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-') as with_check,
         case when p.polroles = array[0::oid] then 'public'
              else (select string_agg(pg_get_userbyid(o), ',') from unnest(p.polroles) o) end as roles
    from pg_policy p join targets t on t.oid = p.polrelid
),
dependents as (
  select pg_describe_object(d.classid, d.objid, d.objsubid) as what, t.relname, d.classid::regclass::text as kind
    from pg_depend d join targets t on t.oid = d.refobjid
   where d.refclassid = 'pg_class'::regclass
     and d.classid::regclass::text in ('pg_rewrite', 'pg_proc')
  union
  select pg_describe_object('pg_trigger'::regclass, tg.oid, 0), t.relname, 'pg_trigger'
    from pg_trigger tg join targets t on t.oid = tg.tgrelid
   where not tg.tgisinternal
  union
  select pg_describe_object('pg_constraint'::regclass, c.oid, 0), t.relname, 'pg_constraint'
    from pg_constraint c join targets t on t.oid = c.confrelid
   where c.contype = 'f' and c.conrelid not in (select oid from targets)
  union
  select 'function ' || p.oid::regprocedure::text || ' names the table in its body', '-', 'pg_proc'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~* '\m(projects|phases)\M'
),
rows_out(seq, section, item, ok, detail) as (
  select 10, 'identity', 'server', null::boolean, version()
  union all
  select 11, 'identity', 'current_user', null, current_user::text
  union all
  -- Ownership and what the apply will need.
  select 20, 'owner', 'both tables exist', count(*) = 2, string_agg(relname, ', ' order by relname) from targets
  union all
  select 21, 'owner', 'postgres owns both tables',
         count(*) filter (where pg_get_userbyid(relowner) = 'postgres') = 2,
         string_agg(relname || '=' || pg_get_userbyid(relowner), ', ' order by relname) from targets
  union all
  select 22, 'owner', 'postgres is the expected non-superuser',
         coalesce((select not rolsuper and rolbypassrls from pg_roles where rolname = 'postgres'), false),
         (select format('rolsuper=%s rolbypassrls=%s rolcreaterole=%s', rolsuper, rolbypassrls, rolcreaterole) from pg_roles where rolname = 'postgres')
  union all
  select 23, 'owner', 'postgres can create schema private', has_database_privilege('postgres', current_database(), 'CREATE'), null
  union all
  select 24, 'owner', 'postgres can reference auth.users',
         has_schema_privilege('postgres', 'auth', 'USAGE') and has_table_privilege('postgres', 'auth.users', 'REFERENCES'), null
  union all
  select 25, 'owner', 'client roles exist',
         (select count(*) = 3 from pg_roles where rolname in ('anon', 'authenticated', 'service_role')), null
  union all
  -- The new names must not exist yet.
  select 30, 'new names', 'public.tenants is absent', to_regclass('public.tenants') is null, null
  union all
  select 31, 'new names', 'public.tenant_members is absent', to_regclass('public.tenant_members') is null, null
  union all
  select 32, 'new names', 'schema private is absent', not exists (select 1 from pg_namespace where nspname = 'private'), null
  union all
  select 33, 'new names', 'no tenant_id column on either table',
         not exists (select 1 from pg_attribute a join targets t on t.oid = a.attrelid where a.attname = 'tenant_id' and not a.attisdropped), null
  union all
  -- Rows. Sign-up was open, so a row is trusted only if it is byte-equal to the known seed.
  select 40, 'rows', 'every row is in the map',
         not exists (select 1 from public.projects p where not exists (select 1 from seed s where s.id = p.id)),
         (select string_agg(p.id, ', ' order by p.id) from public.projects p where not exists (select 1 from seed s where s.id = p.id))
  union all
  select 41, 'rows', 'every id in the map is a row',
         not exists (select 1 from seed s where not exists (select 1 from public.projects p where p.id = s.id)),
         (select string_agg(s.id, ', ' order by s.id) from seed s where not exists (select 1 from public.projects p where p.id = s.id))
  union all
  select 42, 'rows', 'every row is byte-equal to the seed',
         not exists (select 1 from public.projects p join seed s on s.id = p.id
                      where (p.name, p.repo, p.install_status, p.production_freeze, p.open_phases)
                            is distinct from (s.name, s.repo, s.install_status, s.production_freeze, s.open_phases)),
         (select string_agg(p.id, ', ' order by p.id) from public.projects p join seed s on s.id = p.id
           where (p.name, p.repo, p.install_status, p.production_freeze, p.open_phases)
                 is distinct from (s.name, s.repo, s.install_status, s.production_freeze, s.open_phases))
  union all
  select 43, 'rows', 'no orphan phases',
         not exists (select 1 from public.phases ph where not exists (select 1 from public.projects p where p.id = ph.project_id)), null
  union all
  select 44, 'rows', 'phases is still empty, as audited',
         not exists (select 1 from public.phases),
         (select count(*)::text || ' row(s)' from public.phases)
  union all
  -- Accounts.
  select 50, 'accounts', 'auth.users is the owner only',
         (select count(*) = 1 from auth.users) and exists (select 1 from auth.users u join owner_account o on o.id = u.id),
         (select count(*)::text || ' account(s)' from auth.users)
  union all
  -- Policies: 0002 drops only names it knows, and its final check refuses any other.
  select 60, 'policies', 'every policy is one 0002 will replace',
         not exists (select 1 from live_policy l where not exists (select 1 from known_policy k where k.relname = l.relname and k.polname = l.polname)),
         (select string_agg(l.polname, ', ' order by l.polname) from live_policy l where not exists (select 1 from known_policy k where k.relname = l.relname and k.polname = l.polname))
  union all
  select 61, 'policies', relname || ': ' || polname, null,
         format('cmd=%s roles=%s using=%s check=%s', polcmd, roles, qual, with_check)
    from live_policy
  union all
  -- Grants, from the raw ACLs.
  select 70, 'grants', t.relname || ': ' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC'), null,
         string_agg(a.privilege_type, ', ' order by a.privilege_type)
    from targets t cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a
   group by t.relname, a.grantee
  union all
  select 71, 'grants', 'column ' || t.relname || '.' || c.attname || ': ' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC'), null,
         string_agg(a.privilege_type, ', ' order by a.privilege_type)
    from targets t join pg_attribute c on c.attrelid = t.oid
    cross join lateral aclexplode(c.attacl) a
   group by t.relname, c.attname, a.grantee
  union all
  select 72, 'grants', 'default ACL for ' || pg_get_userbyid(d.defaclrole) || ' on ' || d.defaclobjtype::text
         || ' in ' || coalesce(n.nspname, 'every schema'), null, d.defaclacl::text
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
  union all
  select 73, 'grants', 'public schema: ' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC'), null,
         string_agg(a.privilege_type, ', ' order by a.privilege_type)
    from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
   where n.nspname = 'public'
   group by a.grantee
  union all
  select 74, 'grants', 'no client can create in schema public',
         not has_schema_privilege('anon', 'public', 'CREATE')
         and not has_schema_privilege('authenticated', 'public', 'CREATE')
         and not exists (select 1 from pg_namespace n
                          cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                          where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'CREATE'),
         null
  union all
  -- Publications.
  select 80, 'publication', 'supabase_realtime can be emptied of these tables',
         coalesce((select not p.puballtables from pg_publication p where p.pubname = 'supabase_realtime'), true),
         (select format('owner=%s puballtables=%s', pg_get_userbyid(p.pubowner), p.puballtables) from pg_publication p where p.pubname = 'supabase_realtime')
  union all
  select 81, 'publication', t.pubname || ': ' || t.schemaname || '.' || t.tablename, null, 'published'
    from pg_publication_tables t
   where t.schemaname = 'public'
  union all
  -- Dependencies. The expected one is phases on projects, which 0002 replaces.
  select 90, 'dependencies', 'nothing else depends on these tables',
         not exists (select 1 from dependents),
         (select string_agg(what, '; ' order by what) from dependents)
  union all
  select 91, 'dependencies', kind || ': ' || what, null, 'on ' || relname from dependents
  union all
  -- Event triggers fire during the apply. The local harness does not model Supabase's.
  select 92, 'dependencies', 'event trigger ' || e.evtname, null,
         format('event=%s enabled=%s function=%s', e.evtevent, e.evtenabled::text, e.evtfoid::regprocedure::text)
    from pg_event_trigger e
),
verdict as (
  select 999 as seq, 'PREFLIGHT' as section, 'all' as item, bool_and(ok) as ok,
         coalesce(string_agg(item, '; ' order by seq) filter (where ok is false), 'nothing failed') as detail
    from rows_out where ok is not null
)
select section, item, ok, detail from (
  select seq, section, item, ok, detail from rows_out
  union all
  select seq, section, item, ok, detail from verdict
) r
order by seq, item;
