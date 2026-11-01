-- ProjectOS Control Center: lock default privileges, owner decision D9, plan v1.29.
--
-- Supabase's default privileges hand anon and authenticated everything on any new table, sequence or
-- function that postgres creates in public. This stops that for future objects, so a new object starts
-- closed and each migration grants what it means to. Nothing that exists changes: default privileges apply
-- only to objects created later, so the four tables keep their exact grants. service_role keeps its
-- defaults. Transactional, forward-only and safe to re-run. Run it as `postgres`, after 0002.
--
-- Not covered: supabase_admin's own default privileges in public. postgres cannot alter them, so an
-- object made by supabase_admin in public stays exposed. Nor postgres's rows for schema storage.

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

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- PUBLIC EXECUTE on a new function comes from the built-in global default, and a per-schema entry can
-- only add to the global one, never take away from it. So this one must be the global form. It covers
-- functions postgres creates in EVERY schema: outside public, only the owner can call a new function
-- until a migration grants it, and schema storage keeps its own per-schema grants to anon and authenticated.
alter default privileges for role postgres
  revoke execute on functions from public;

-- Judges what pg_default_acl now says, not what this file meant to do. Any finding rolls everything back.
do $check$
declare
  problems text[];
begin
  with
  kinds(kind, label, service_role_privileges) as (
    values ('r', 'tables', 8), ('S', 'sequences', 3), ('f', 'functions', 1)
  ),
  entries as (
    select d.defaclobjtype::text as kind, d.defaclnamespace, n.nspname, a.grantee, a.privilege_type
      from pg_catalog.pg_default_acl as d
      left join pg_catalog.pg_namespace as n on n.oid = d.defaclnamespace
     cross join lateral pg_catalog.aclexplode(d.defaclacl) as a
     where pg_catalog.pg_get_userbyid(d.defaclrole) = 'postgres'
  ),
  clients as (
    select r.oid, r.rolname::text as rolname from pg_catalog.pg_roles as r where r.rolname in ('anon', 'authenticated')
    union all
    select 0::pg_catalog.oid, 'PUBLIC'
  ),
  findings(problem) as (
    select 'a client keeps a default: ' || c.rolname || ' ' || e.privilege_type || ' on ' || k.label
      from entries as e
      join kinds as k on k.kind = e.kind
      join clients as c on c.oid = e.grantee
     where e.nspname = 'public' or e.defaclnamespace = 0
    union all
    select 'new functions still default to PUBLIC EXECUTE'
     where not exists (select 1 from entries as e where e.kind = 'f' and e.defaclnamespace = 0)
    union all
    select 'service_role lost a default on ' || k.label
      from kinds as k
     where (select count(*) from entries as e
             where e.kind = k.kind and e.nspname = 'public'
               and e.grantee = (select r.oid from pg_catalog.pg_roles as r where r.rolname = 'service_role'))
           <> k.service_role_privileges
  )
  select array_agg(f.problem order by f.problem) into problems from findings as f;

  if problems is not null then
    raise exception 'TENANT_DEFAULT_PRIVILEGES_CHECK_FAILED: %', pg_catalog.array_to_string(problems, '; ');
  end if;
end
$check$;

commit;
