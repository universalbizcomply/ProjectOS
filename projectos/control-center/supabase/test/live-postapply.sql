-- ProjectOS Control Center: read-only post-apply check for the migrations through 0003_default_privileges.sql.
--
-- ONE SELECT statement, nothing else. Run it as supabase_read_only_user after the owner's live apply and
-- the membership step. Each row is (section, item, ok, detail); ok is null for a plain listing. The apply
-- stands only if the final row reads POSTAPPLY, all, true. Before 0003 it fails on its two default rows.
--
-- The CTEs from client_roles to findings are privilege-gate.sql, byte for byte, and the validator holds
-- them equal. has_*_privilege answers for any role, so this needs no writes and no role change.
-- It does not cover sign-up being off, which is an Auth setting and not in the database.

with client_roles as (
  select rolname from pg_roles where rolname in ('anon', 'authenticated')
),
rels as (
  select c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity, n.nspname,
         quote_ident(n.nspname) || '.' || quote_ident(c.relname) as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
),
tables as (
  select * from rels where relkind <> 'S'
),
cols as (
  select t.oid, t.relname, t.nspname, t.name, a.attnum, a.attname, a.attacl
    from tables t join pg_attribute a on a.attrelid = t.oid
   where a.attnum > 0 and not a.attisdropped
),
fns as (
  select p.oid, p.proname, p.proowner, p.proacl, p.provolatile, p.pronargs, p.proconfig, p.prosecdef, n.nspname,
         p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
),
allowed_table(rolname, nspname, relname, priv) as (values
  ('authenticated', 'public', 'tenants', 'SELECT'),
  ('authenticated', 'public', 'tenant_members', 'SELECT'),
  ('authenticated', 'public', 'projects', 'SELECT'),
  ('authenticated', 'public', 'projects', 'INSERT'),
  ('authenticated', 'public', 'projects', 'DELETE'),
  ('authenticated', 'public', 'phases', 'SELECT'),
  ('authenticated', 'public', 'phases', 'INSERT'),
  ('authenticated', 'public', 'phases', 'DELETE')
),
allowed_update(relname, attname) as (values
  ('projects', 'name'), ('projects', 'repo'), ('projects', 'install_status'),
  ('projects', 'production_freeze'), ('projects', 'open_phases'),
  ('phases', 'phase_id'), ('phases', 'objective'), ('phases', 'status'),
  ('phases', 'history'), ('phases', 'advisor_note')
),
allowed_helper(proname) as (values ('my_tenant_ids'), ('my_owned_tenant_ids')),
member_expr(expr) as (values ('(tenant_id IN ( SELECT private.my_tenant_ids() AS my_tenant_ids))')),
owner_expr(expr) as (values ('(tenant_id IN ( SELECT private.my_owned_tenant_ids() AS my_owned_tenant_ids))')),
allowed_policy(relname, polname, qual, with_check) as (
  select 'tenants', 'tenants member read', '(id IN ( SELECT private.my_tenant_ids() AS my_tenant_ids))', null
  union all
  select 'tenant_members', 'tenant_members self read', '(user_id = ( SELECT auth.uid() AS uid))', null
  union all
  select t.relname, t.relname || ' member read', m.expr, null
    from (values ('projects'), ('phases')) t(relname) cross join member_expr m
  union all
  select t.relname, t.relname || ' owner insert', null, o.expr
    from (values ('projects'), ('phases')) t(relname) cross join owner_expr o
  union all
  select t.relname, t.relname || ' owner update', o.expr, o.expr
    from (values ('projects'), ('phases')) t(relname) cross join owner_expr o
  union all
  select t.relname, t.relname || ' owner delete', o.expr, null
    from (values ('projects'), ('phases')) t(relname) cross join owner_expr o
),
boundary(relname) as (values ('tenants'), ('tenant_members'), ('projects'), ('phases')),
findings as (
  -- Table-level privileges a client role holds beyond the approved set.
  select r.rolname as grantee, 'table' as object_type, t.name as object, p.priv as privilege
    from client_roles r cross join tables t
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p(priv)
   where has_table_privilege(r.rolname, t.oid, p.priv)
     and not exists (select 1 from allowed_table a
                      where a.rolname = r.rolname and a.nspname = t.nspname and a.relname = t.relname and a.priv = p.priv)
  union all
  -- Column-level privileges: reads and inserts follow the table grant; UPDATE only on the approved columns.
  select r.rolname, 'column', c.name || '.' || quote_ident(c.attname), p.priv
    from client_roles r cross join cols c
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p(priv)
   where has_column_privilege(r.rolname, c.oid, c.attnum, p.priv)
     and not exists (select 1 from allowed_table a
                      where a.rolname = r.rolname and a.nspname = c.nspname and a.relname = c.relname and a.priv = p.priv)
     and not (r.rolname = 'authenticated' and p.priv = 'UPDATE' and c.nspname = 'public'
              and exists (select 1 from allowed_update u where u.relname = c.relname and u.attname = c.attname))
  union all
  select r.rolname, 'sequence', s.name, p.priv
    from client_roles r cross join rels s cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) p(priv)
   where s.relkind = 'S' and has_sequence_privilege(r.rolname, s.oid, p.priv)
  union all
  select 'PUBLIC', 'table', t.name, a.privilege_type
    from rels t cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a
   where a.grantee = 0
  union all
  select 'PUBLIC', 'column', c.name || '.' || quote_ident(c.attname), a.privilege_type
    from cols c cross join lateral aclexplode(c.attacl) a
   where a.grantee = 0
  union all
  -- Functions: nothing in public is callable by a client; in private, only the helpers, by authenticated.
  select r.rolname, 'function', f.sig, 'EXECUTE'
    from client_roles r cross join fns f
   where has_function_privilege(r.rolname, f.oid, 'EXECUTE')
     and not (r.rolname = 'authenticated' and f.nspname = 'private'
              and exists (select 1 from allowed_helper h where h.proname = f.proname))
  union all
  select 'service_role', 'function', f.sig, 'EXECUTE'
    from fns f
   where f.nspname = 'private' and has_function_privilege('service_role', f.oid, 'EXECUTE')
  union all
  select 'PUBLIC', 'function', f.sig, 'EXECUTE'
    from fns f
   where exists (select 1 from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  union all
  select 'nobody', 'helper_unexpected', f.sig, 'NOT_APPROVED'
    from fns f
   where f.nspname = 'private' and not exists (select 1 from allowed_helper h where h.proname = f.proname)
  union all
  select 'nobody', 'helper_missing', h.proname, 'NOT_FOUND'
    from allowed_helper h
   where not exists (select 1 from fns f where f.nspname = 'private' and f.proname = h.proname)
  union all
  select 'nobody', 'helper_shape', f.sig, 'NOT_STABLE_INVOKER_NOARG_EMPTY_PATH'
    from fns f
   where f.nspname = 'private'
     and (f.provolatile <> 's' or f.pronargs <> 0 or f.prosecdef or f.proconfig is distinct from array['search_path=""'])
  union all
  -- Schemas.
  select r.rolname, 'schema', 'private', p.priv
    from client_roles r cross join pg_namespace n cross join unnest(array['USAGE', 'CREATE']) p(priv)
   where n.nspname = 'private'
     and has_schema_privilege(r.rolname, n.oid, p.priv)
     and not (r.rolname = 'authenticated' and p.priv = 'USAGE')
  union all
  select r.rolname, 'schema', 'public', 'CREATE'
    from client_roles r
   where has_schema_privilege(r.rolname, 'public', 'CREATE')
  union all
  select 'PUBLIC', 'schema', n.nspname, a.privilege_type
    from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
   where n.nspname in ('public', 'private') and a.grantee = 0
     and not (n.nspname = 'public' and a.privilege_type = 'USAGE')
  union all
  -- Client roles stay roles, not logins, and never bypass row level security.
  select rolname, 'role', rolname, 'LOGIN'
    from pg_roles where rolname in ('anon', 'authenticated', 'service_role') and rolcanlogin
  union all
  select rolname, 'role', rolname, 'BYPASSRLS'
    from pg_roles where rolname in ('anon', 'authenticated') and rolbypassrls
  union all
  -- Ownership drift: everything the boundary rests on belongs to the migration owner.
  select pg_get_userbyid(t.relowner), 'owner_drift', t.name, 'OWNER'
    from tables t join boundary b on b.relname = t.relname
   where t.nspname = 'public' and pg_get_userbyid(t.relowner) <> 'postgres'
  union all
  select pg_get_userbyid(f.proowner), 'owner_drift', f.sig, 'OWNER'
    from fns f
   where f.nspname = 'private' and pg_get_userbyid(f.proowner) <> 'postgres'
  union all
  select pg_get_userbyid(n.nspowner), 'owner_drift', n.nspname, 'OWNER'
    from pg_namespace n
   where n.nspname = 'private' and pg_get_userbyid(n.nspowner) <> 'postgres'
  union all
  -- Row level security and policies, on every table in public.
  select 'nobody', 'rls_off', t.name, 'RLS_DISABLED'
    from tables t
   where t.nspname = 'public' and t.relkind in ('r', 'p') and not t.relrowsecurity
  union all
  select case when p.polroles = array[0::oid] then 'public'
              else (select string_agg(pg_get_userbyid(o), ',') from unnest(p.polroles) o) end,
         'policy', t.name || ' ' || quote_ident(p.polname), 'NOT_TO_AUTHENTICATED'
    from pg_policy p join tables t on t.oid = p.polrelid
   where p.polroles <> array[(select oid from pg_roles where rolname = 'authenticated')]
  union all
  select 'nobody', 'policy', t.name || ' ' || quote_ident(p.polname), 'NOT_APPROVED'
    from pg_policy p join tables t on t.oid = p.polrelid
   where not exists (select 1 from allowed_policy a where a.relname = t.relname and a.polname = p.polname)
  union all
  select 'nobody', 'policy', t.name || ' ' || quote_ident(p.polname), 'ALWAYS_TRUE'
    from pg_policy p join tables t on t.oid = p.polrelid
   where pg_get_expr(p.polqual, p.polrelid) = 'true' or pg_get_expr(p.polwithcheck, p.polrelid) = 'true'
  union all
  select 'nobody', 'policy', t.name || ' ' || quote_ident(p.polname), 'EXPRESSION_DIFFERS'
    from pg_policy p join tables t on t.oid = p.polrelid
    join allowed_policy a on a.relname = t.relname and a.polname = p.polname
   where pg_get_expr(p.polqual, p.polrelid) is distinct from a.qual
      or pg_get_expr(p.polwithcheck, p.polrelid) is distinct from a.with_check
  union all
  -- Realtime delete events are not filtered by row level security.
  select 'supabase_realtime', 'publication', t.schemaname || '.' || t.tablename, 'PUBLISHED'
    from pg_publication_tables t join boundary b on b.relname = t.tablename
   where t.schemaname = 'public'
),
open_policy as (
  select t.relname, p.polname
    from pg_policy p join tables t on t.oid = p.polrelid
    left join allowed_policy a on a.relname = t.relname and a.polname = p.polname
   where t.nspname = 'public'
     and (a.polname is null
          or pg_get_expr(p.polqual, p.polrelid) is distinct from a.qual
          or pg_get_expr(p.polwithcheck, p.polrelid) is distinct from a.with_check
          or p.polroles <> array[(select oid from pg_roles where rolname = 'authenticated')])
),
postgres_defaults as (
  select d.defaclobjtype::text as kind, d.defaclnamespace, a.grantee, a.privilege_type
    from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
   where pg_get_userbyid(d.defaclrole) = 'postgres'
     and d.defaclobjtype::text in ('r', 'S', 'f')
     and d.defaclnamespace in (0, (select oid from pg_namespace where nspname = 'public'))
),
rows_out(seq, section, item, ok, detail) as (
  select 10, 'identity', 'server', null::boolean, version()
  union all
  select 11, 'identity', 'current_user', null, current_user::text
  union all
  -- The gate, on effective privileges.
  select 20, 'gate', 'the privilege gate reports nothing', not exists (select 1 from findings),
         (select count(*)::text || ' finding(s)' from findings)
  union all
  select 21, 'gate', grantee || ' ' || object_type || ' ' || object || ' ' || privilege, null, 'finding'
    from findings
  union all
  -- No public table has a policy other than the approved text, for authenticated alone.
  select 30, 'policies', 'no public table has an open policy', not exists (select 1 from open_policy),
         (select string_agg(relname || ': ' || polname, '; ' order by relname, polname) from open_policy)
  union all
  select 31, 'policies', t.name || ': ' || p.polname, null,
         format('cmd=%s using=%s check=%s', p.polcmd::text,
                coalesce(pg_get_expr(p.polqual, p.polrelid), '-'), coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-'))
    from pg_policy p join tables t on t.oid = p.polrelid
  union all
  select 40, 'policies', 'row level security is on for every public table',
         not exists (select 1 from tables t where t.nspname = 'public' and t.relkind in ('r', 'p') and not t.relrowsecurity),
         (select string_agg(t.name, ', ' order by t.name) from tables t
           where t.nspname = 'public' and t.relkind in ('r', 'p') and not t.relrowsecurity)
  union all
  -- Realtime.
  select 50, 'realtime', 'the four tables are out of every publication',
         not exists (select 1 from pg_publication_tables t join boundary b on b.relname = t.tablename where t.schemaname = 'public'),
         (select string_agg(t.pubname || ': ' || t.tablename, ', ' order by t.tablename)
            from pg_publication_tables t join boundary b on b.relname = t.tablename where t.schemaname = 'public')
  union all
  select 51, 'realtime', t.pubname || ': ' || t.schemaname || '.' || t.tablename, null, 'published'
    from pg_publication_tables t
   where t.schemaname = 'public'
  union all
  -- Default privileges for future objects. Every row is listed so the whole state is seen.
  select 60, 'default acl', 'for ' || pg_get_userbyid(d.defaclrole) || ' on ' || d.defaclobjtype::text
         || ' in ' || coalesce(n.nspname, 'every schema'), null, d.defaclacl::text
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
  union all
  select 61, 'default acl', 'postgres default ACL in public gives anon and authenticated nothing',
         not exists (select 1 from postgres_defaults e join pg_roles r on r.oid = e.grantee
                      where r.rolname in ('anon', 'authenticated')),
         (select string_agg(r.rolname || ' ' || e.kind || ' ' || e.privilege_type, ', ' order by r.rolname, e.kind, e.privilege_type)
            from postgres_defaults e join pg_roles r on r.oid = e.grantee where r.rolname in ('anon', 'authenticated'))
  union all
  select 62, 'default acl', 'new postgres functions give PUBLIC nothing',
         exists (select 1 from postgres_defaults e where e.kind = 'f' and e.defaclnamespace = 0)
         and not exists (select 1 from postgres_defaults e where e.grantee = 0),
         null
  union all
  -- A known limit, not a pass: postgres cannot alter these, so an object supabase_admin makes in public
  -- stays exposed. If one exists, the gate above reports it and this check fails.
  select 63, 'default acl', 'known limit: objects made by supabase_admin in public stay exposed', null,
         (select string_agg(d.defaclobjtype::text || ' ' || d.defaclacl::text, '; ' order by d.defaclobjtype::text)
            from pg_default_acl d
           where pg_get_userbyid(d.defaclrole) = 'supabase_admin'
             and d.defaclnamespace = (select oid from pg_namespace where nspname = 'public'))
  union all
  -- The public schema's own ACL.
  select 70, 'public schema', coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC'), null,
         string_agg(a.privilege_type, ', ' order by a.privilege_type)
    from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
   where n.nspname = 'public'
   group by a.grantee
  union all
  select 71, 'public schema', 'no client can create in schema public',
         not has_schema_privilege('anon', 'public', 'CREATE')
         and not has_schema_privilege('authenticated', 'public', 'CREATE')
         and not exists (select 1 from pg_namespace n
                          cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                          where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'CREATE'),
         null
),
verdict as (
  select 999 as seq, 'POSTAPPLY' as section, 'all' as item, bool_and(ok) as ok,
         coalesce(string_agg(item, '; ' order by seq) filter (where ok is false), 'nothing failed') as detail
    from rows_out where ok is not null
)
select section, item, ok, detail from (
  select seq, section, item, ok, detail from rows_out
  union all
  select seq, section, item, ok, detail from verdict
) r
order by seq, item;
