-- Interactive Control Center: phases table + write access for signed-in owner.
-- Run in Supabase SQL editor or via the Management API. Authenticated = the owner.

create table if not exists public.phases (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references public.projects(id) on delete cascade,
  phase_id    text not null,
  objective   text not null default '',
  status      text not null default 'draft',
  history     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  unique (project_id, phase_id)
);

alter table public.phases enable row level security;

drop policy if exists "phases authenticated all" on public.phases;
create policy "phases authenticated all"
  on public.phases for all
  to authenticated
  using (true) with check (true);

-- Let the signed-in owner create/update projects from the UI (read stays authenticated too).
drop policy if exists "projects authenticated write" on public.projects;
create policy "projects authenticated write"
  on public.projects for all
  to authenticated
  using (true) with check (true);
