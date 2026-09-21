-- Test fixture: a plain PostgreSQL cluster shaped like Supabase for privilege
-- testing. Reproduces the hazard that bit JD three times: default privileges
-- that grant EXECUTE on new public functions (and tables) to client roles.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Minimal pg_cron shape for scheduler-presence checks.
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, active boolean not null default true);
insert into cron.job (jobname, active) values ('present-job', true), ('disabled-job', false);
