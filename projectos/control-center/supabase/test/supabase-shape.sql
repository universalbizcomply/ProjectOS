-- Test fixture: a plain PostgreSQL cluster shaped like the live Supabase project. Run as the cluster
-- superuser, which here is `supabase_admin`, as on Supabase. Mirrors the read-only audit of 2026-11-01:
-- `postgres` is not a superuser, `service_role` bypasses row level security, auth.users belongs to
-- supabase_auth_admin, and the default privileges hand every client role everything on new objects.

create role postgres login nosuperuser createrole bypassrls;
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit;
create role supabase_auth_admin nologin noinherit;
create role supabase_read_only_user login bypassrls;
grant anon, authenticated, service_role to authenticator;
grant pg_read_all_data to supabase_read_only_user;

alter schema public owner to postgres;
grant usage on schema public to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to postgres, anon, authenticated, service_role;

-- supabase_admin has its own entries, which postgres cannot alter.
alter default privileges for role supabase_admin in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all on functions to postgres, anon, authenticated, service_role;

-- The auth stub. auth.uid() reads the claims the way Supabase's does.
create schema auth;
create table auth.users (
  id         uuid primary key,
  created_at timestamptz not null default now()
);
alter table auth.users owner to supabase_auth_admin;

create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
alter function auth.uid() owner to supabase_auth_admin;

grant usage on schema auth to postgres, anon, authenticated, service_role, supabase_auth_admin;
grant select on auth.users to postgres with grant option;
grant references on auth.users to postgres;
