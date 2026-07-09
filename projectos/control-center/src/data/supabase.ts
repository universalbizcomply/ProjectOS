/**
 * Optional Supabase data source for the Control Center.
 *
 * Uses ONLY the public anon key (safe in a frontend) from Vite env:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 * When those are absent the app falls back to the static seed, so the UI always renders.
 * No service_role key or PAT is ever used here — this reads a public `projects` table
 * protected by row-level security (public read-only).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PROJECTS, type ProjectRow } from './projects';

const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;
function getClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (client === null) client = createClient(url as string, anonKey as string);
  return client;
}

interface ProjectsRowDb {
  id: string;
  name: string;
  repo: string;
  install_status: ProjectRow['installStatus'];
  production_freeze: boolean;
  open_phases: number;
}

/** Fetch projects from Supabase; fall back to the static seed on any error/absence. */
export async function fetchProjects(): Promise<{ rows: readonly ProjectRow[]; source: 'supabase' | 'seed' }> {
  const c = getClient();
  if (c === null) return { rows: PROJECTS, source: 'seed' };
  try {
    const { data, error } = await c
      .from('projects')
      .select('id,name,repo,install_status,production_freeze,open_phases')
      .order('name');
    if (error || !data) return { rows: PROJECTS, source: 'seed' };
    const rows: ProjectRow[] = (data as ProjectsRowDb[]).map((d) => ({
      id: d.id,
      name: d.name,
      repo: d.repo,
      installStatus: d.install_status,
      productionFreeze: d.production_freeze,
      openPhases: d.open_phases,
    }));
    return { rows, source: 'supabase' };
  } catch {
    return { rows: PROJECTS, source: 'seed' };
  }
}
