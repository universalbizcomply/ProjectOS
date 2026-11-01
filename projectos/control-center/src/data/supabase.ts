/**
 * Optional Supabase client for the Control Center.
 *
 * Uses ONLY the public anon key (safe in a frontend) from Vite env:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 * When those are absent `getClient` returns null. No service_role key or PAT is ever used here.
 * Today only Supabase Auth is used, as the desktop sign-in gate: no screen reads the cloud tables.
 * Access to those tables is decided in the database: supabase/migrations/ holds the intended
 * schema, and the live project changes only at the owner's apply.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

/** The shared Supabase client (or null when unconfigured). Used for auth. */
export function getClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (client === null) client = createClient(url as string, anonKey as string);
  return client;
}
