-- Test fixture: both tenants seeded. Run as the cluster superuser after the migrations. `fx-shared`
-- exists in both tenants on purpose, so the assertions can show an id is only unique per tenant.
-- The owner of both tenants is NOT added here: test/live-owner-membership.sql adds them, so those exact
-- bytes are what the assertions exercise.

insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('aaaaaaaa-0000-4000-8000-000000000002'),
  ('bbbbbbbb-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002'),
  ('cccccccc-0000-4000-8000-000000000001'),
  ('cd2e8678-1e00-4264-95bb-7d75738a1f50')
on conflict (id) do nothing;

insert into public.tenant_members (tenant_id, user_id, role) values
  ('owner-personal',  'aaaaaaaa-0000-4000-8000-000000000001', 'owner'),
  ('owner-personal',  'aaaaaaaa-0000-4000-8000-000000000002', 'member'),
  ('agency-business', 'bbbbbbbb-0000-4000-8000-000000000001', 'owner'),
  ('agency-business', 'bbbbbbbb-0000-4000-8000-000000000002', 'member');

insert into public.projects (tenant_id, id, name) values
  ('owner-personal',  'fx-alpha',  'Fixture alpha'),
  ('owner-personal',  'fx-shared', 'Fixture shared, tenant A'),
  ('agency-business', 'fx-beta',   'Fixture beta'),
  ('agency-business', 'fx-shared', 'Fixture shared, tenant B');

insert into public.phases (tenant_id, id, project_id, phase_id, objective) values
  ('owner-personal',  'dddddddd-0000-4000-8000-000000000001', 'fx-alpha',  'P1', 'A alpha'),
  ('owner-personal',  'dddddddd-0000-4000-8000-000000000002', 'fx-shared', 'P1', 'A shared'),
  ('agency-business', 'eeeeeeee-0000-4000-8000-000000000001', 'fx-beta',   'P1', 'B beta'),
  ('agency-business', 'eeeeeeee-0000-4000-8000-000000000002', 'fx-shared', 'P1', 'B shared');
