-- One sorted line per catalogue fact the migrations decide. Two applies are the same only if these are
-- byte-equal. ACLs are exploded and sorted, because their stored order is not significant.

with rels as (
  select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relowner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
facts(line) as (
  select 'table ' || r.relname || ' rls=' || r.relrowsecurity || ' force=' || r.relforcerowsecurity
         || ' owner=' || pg_get_userbyid(r.relowner)
    from rels r
  union all
  select 'column ' || r.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
         || ' notnull=' || a.attnotnull || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-')
    from rels r join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = r.oid and d.adnum = a.attnum
  union all
  select 'constraint ' || r.relname || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
    from rels r join pg_constraint c on c.conrelid = r.oid
  union all
  select 'index ' || i.indexrelid::regclass::text || ' ' || pg_get_indexdef(i.indexrelid)
    from rels r join pg_index i on i.indrelid = r.oid
  union all
  select 'policy ' || r.relname || ' ' || p.polname || ' cmd=' || p.polcmd::text
         || ' roles=' || p.polroles::regrole[]::text
         || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '-')
         || ' check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '-')
    from rels r join pg_policy p on p.polrelid = r.oid
  union all
  select 'acl ' || r.relname || ' ' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ' ' || a.privilege_type
    from rels r cross join lateral aclexplode(coalesce(r.relacl, acldefault('r', r.relowner))) a
  union all
  select 'column-acl ' || r.relname || '.' || c.attname || ' ' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ' ' || a.privilege_type
    from rels r join pg_attribute c on c.attrelid = r.oid
    cross join lateral aclexplode(c.attacl) a
  union all
  select 'helper ' || p.oid::regprocedure::text || ' ' || pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
  union all
  select 'helper-acl ' || p.proname || ' ' || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ' ' || a.privilege_type
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where n.nspname = 'private'
  union all
  select 'default-acl ' || pg_get_userbyid(d.defaclrole) || ' ' || d.defaclobjtype::text || ' ' || coalesce(n.nspname, '*') || ' '
         || coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ' ' || a.privilege_type
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
)
select line from facts order by line;
