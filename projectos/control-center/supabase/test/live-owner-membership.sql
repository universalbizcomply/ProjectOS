-- Adds the owner's Supabase account as owner of both tenants. Run ONLY at the owner's live apply, as a
-- separate step AFTER migrations/0002_tenant_boundary.sql, as `postgres`. It is kept out of the
-- migrations so the migration bytes hold no personal identifier. Holds a user id and no email.
-- Re-running it changes nothing. The harness exercises these exact bytes against a stub user.

begin;

set local search_path = '';

do $precondition$
begin
  if not exists (select 1 from auth.users where id = 'cd2e8678-1e00-4264-95bb-7d75738a1f50') then
    raise exception 'OWNER_MEMBERSHIP_UNKNOWN_USER: the owner account is not in auth.users';
  end if;
end
$precondition$;

insert into public.tenant_members (tenant_id, user_id, role) values
  ('owner-personal',  'cd2e8678-1e00-4264-95bb-7d75738a1f50', 'owner'),
  ('agency-business', 'cd2e8678-1e00-4264-95bb-7d75738a1f50', 'owner')
on conflict (tenant_id, user_id) do update set role = excluded.role;

do $check$
begin
  if (select count(*) from public.tenant_members
       where user_id = 'cd2e8678-1e00-4264-95bb-7d75738a1f50' and role = 'owner') <> 2 then
    raise exception 'OWNER_MEMBERSHIP_CHECK_FAILED: expected owner of exactly two tenants';
  end if;
end
$check$;

commit;
