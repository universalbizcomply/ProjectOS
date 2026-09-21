-- ProjectOS Watchdog — privilege gate (mandatory after every product deploy
-- that touches the watchdog schema, and during product integration).
--
-- Returns one row per privilege that a client context HOLDS on Watchdog
-- authority, per client role that can log in directly, and per object whose
-- owner drifted from the schema owner. The gate PASSES only when this query
-- returns ZERO rows.
-- Checks roles anon and authenticated (when present) and PUBLIC (every role).
-- An explicit REVOKE is never trusted on its own: this reads the resulting
-- effective privileges, including any re-granted by default privileges.

with client_roles as (
  select rolname from pg_roles where rolname in ('anon', 'authenticated')
),
fns as (
  select p.oid, p.proowner, p.proacl, p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'watchdog' or (n.nspname = 'public' and p.proname like 'watchdog\_%')
),
tbls as (
  select c.oid, c.relowner, c.relacl, c.oid::regclass::text as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'watchdog' and c.relkind in ('r', 'p', 'v', 'm', 'S')
),
findings as (
  select r.rolname as grantee, 'function' as object_type, f.sig as object, 'EXECUTE' as privilege
    from client_roles r cross join fns f
   where has_function_privilege(r.rolname, f.oid, 'EXECUTE')
  union all
  select 'PUBLIC', 'function', f.sig, 'EXECUTE'
    from fns f
   where exists (select 1 from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  union all
  select r.rolname, 'table', t.name, p.priv
    from client_roles r cross join tbls t
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv)
   where has_table_privilege(r.rolname, t.oid, p.priv)
  union all
  select 'PUBLIC', 'table', t.name, a.privilege_type
    from tbls t cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a
   where a.grantee = 0
  union all
  select r.rolname, 'schema', 'watchdog', p.priv
    from client_roles r cross join unnest(array['USAGE', 'CREATE']) p(priv)
   where exists (select 1 from pg_namespace where nspname = 'watchdog')
     and has_schema_privilege(r.rolname, 'watchdog', p.priv)
  union all
  select 'PUBLIC', 'schema', 'watchdog', a.privilege_type
    from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
   where n.nspname = 'watchdog' and a.grantee = 0
  union all
  -- The trusted-caller guard assumes these roles cannot open a session
  -- directly (Supabase topology: only authenticator logs in and SET ROLEs).
  select rolname, 'role', rolname, 'LOGIN'
    from pg_roles where rolname in ('anon', 'authenticated', 'service_role') and rolcanlogin
  union all
  -- Entry points bypass RLS only as the table owner: every watchdog table and
  -- function must be owned by the schema owner (ownership drift breaks that).
  select pg_get_userbyid(c.relowner), 'owner_drift', c.oid::regclass::text, 'OWNER'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'watchdog' and c.relkind in ('r', 'p') and c.relowner <> n.nspowner
  union all
  select pg_get_userbyid(p.proowner), 'owner_drift', p.oid::regprocedure::text, 'OWNER'
    from pg_proc p join pg_namespace pn on pn.oid = p.pronamespace
    cross join (select nspowner from pg_namespace where nspname = 'watchdog') w
   where (pn.nspname = 'watchdog' or (pn.nspname = 'public' and p.proname like 'watchdog\_%')) and p.proowner <> w.nspowner
)
select grantee, object_type, object, privilege from findings order by 1, 2, 3, 4;
