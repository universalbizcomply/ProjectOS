-- ProjectOS Control Center: baseline schema, PROJECTOS-TENANT-RLS1A.
--
-- Records the two tables exactly as they stand live (column order included: advisor_note was added
-- after created_at), so a fresh cluster and the live project reach the same shape before 0002.
-- Idempotent: on the live project and on any re-run it changes nothing. It holds no policy and no seed;
-- access is decided by 0002 alone. Row level security is on, so with no policy nothing is readable.

begin;

set local lock_timeout = '10s';

create table if not exists public.projects (
  id                text primary key,
  name              text not null,
  repo              text not null default 'none',
  install_status    text not null default 'installed',
  production_freeze boolean not null default true,
  open_phases       integer not null default 0
);

create table if not exists public.phases (
  id           uuid primary key default gen_random_uuid(),
  project_id   text not null references public.projects(id) on delete cascade,
  phase_id     text not null,
  objective    text not null default '',
  status       text not null default 'draft',
  history      jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  advisor_note text not null default '',
  unique (project_id, phase_id)
);

alter table public.projects enable row level security;
alter table public.phases enable row level security;

commit;
