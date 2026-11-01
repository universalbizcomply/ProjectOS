-- Test fixture: the LIVE-SHAPED starting state. Run as the cluster superuser on a copy of the shaped
-- database. The old tables, policies and grants as the audit of 2026-11-01 found them, plus the 12
-- seed rows. Tables are created by `postgres`, so the default privileges give anon, authenticated and
-- service_role arwdDxtm on both, TRUNCATE included, exactly as live. Without this start the proof
-- would be kinder than production.

insert into auth.users (id) values ('cd2e8678-1e00-4264-95bb-7d75738a1f50');

set role postgres;

create table public.projects (
  id                text primary key,
  name              text not null,
  repo              text not null default 'none',
  install_status    text not null default 'installed',
  production_freeze boolean not null default true,
  open_phases       integer not null default 0
);
alter table public.projects enable row level security;

create table public.phases (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references public.projects(id) on delete cascade,
  phase_id    text not null,
  objective   text not null default '',
  status      text not null default 'draft',
  history     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  unique (project_id, phase_id)
);
alter table public.phases add column advisor_note text not null default '';
alter table public.phases enable row level security;

create policy "projects authenticated read" on public.projects
  for select to authenticated using (true);
create policy "projects authenticated write" on public.projects
  for all to authenticated using (true) with check (true);
create policy "phases authenticated all" on public.phases
  for all to authenticated using (true) with check (true);

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
  ('projectos',     'ProjectOS (self)','universalbizcomply/ProjectOS',       'installed', false, 12);

-- On live this publication exists, is not FOR ALL TABLES, and holds no public table.
create publication supabase_realtime;

reset role;
