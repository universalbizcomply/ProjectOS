-- ProjectOS Control Center — Supabase schema.
-- A single read-only `projects` table exposed to the public (anon) role via RLS.
-- Run this in the Supabase SQL editor (or via the MCP apply_migration) after creating the
-- project. No secrets here; the anon key only ever gets SELECT.

create table if not exists public.projects (
  id                text primary key,
  name              text not null,
  repo              text not null default 'none',
  install_status    text not null default 'installed',
  production_freeze boolean not null default true,
  open_phases       integer not null default 0
);

alter table public.projects enable row level security;

-- Public, read-only access for the dashboard (anon + authenticated).
drop policy if exists "projects public read" on public.projects;
create policy "projects public read"
  on public.projects for select
  using (true);

insert into public.projects (id, name, repo, install_status, production_freeze, open_phases) values
  ('brik',          'Brik',            'universalbizcomply/brik',            'installed', true,  0),
  ('bizcomply-v2',  'BizComply V2',    'universalbizcomply/opsoft-ios-lab',  'installed', true,  0),
  ('coverdrive',    'Coverdrive',      'coverdrivemanchester-art/Coverdrive','installed', true,  0),
  ('criclocal',     'CricLocal',       'muraddevbuild-maker/criclocal',      'installed', true,  0),
  ('jd-testing',    'JD Testing',      'jdonlinetesting/JDtesting',          'installed', true,  0),
  ('polygo',        'PolyGo',          'polygonia-apres/polygo',             'installed', true,  0),
  ('boithok-khana', 'Boithok Khana',   'none',                               'installed', true,  0),
  ('erp-system',    'ERP System',      'none',                               'installed', true,  0),
  ('firm-flow',     'Firm Flow',       'none',                               'installed', true,  0),
  ('tkn',           'TKN',             'none',                               'installed', true,  0),
  ('trading-bot',   'Trading Bot',     'none',                               'installed', true,  0),
  ('projectos',     'ProjectOS (self)','universalbizcomply/ProjectOS',       'installed', false, 12)
on conflict (id) do update set
  name = excluded.name,
  repo = excluded.repo,
  install_status = excluded.install_status,
  production_freeze = excluded.production_freeze,
  open_phases = excluded.open_phases;
