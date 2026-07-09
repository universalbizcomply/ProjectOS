/**
 * Auth helpers over Supabase Auth (email + password). The dashboard is gated: without a
 * session the app shows the login screen; the `projects` table is readable only by
 * authenticated users (see supabase/schema.sql RLS). Uses the public anon key only.
 */
import type { Session } from '@supabase/supabase-js';
import { getClient } from './supabase';

export async function getSession(): Promise<Session | null> {
  const c = getClient();
  if (c === null) return null;
  const { data } = await c.auth.getSession();
  return data.session;
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const c = getClient();
  if (c === null) return () => {};
  const { data } = c.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string): Promise<{ error: string | null }> {
  const c = getClient();
  if (c === null) return { error: 'Supabase is not configured' };
  const { error } = await c.auth.signInWithPassword({ email, password });
  return { error: error ? error.message : null };
}

export async function signOut(): Promise<void> {
  const c = getClient();
  if (c !== null) await c.auth.signOut();
}

/** Update the signed-in user's password and clear the must-change flag. */
export async function updatePassword(newPassword: string): Promise<{ error: string | null }> {
  const c = getClient();
  if (c === null) return { error: 'Supabase is not configured' };
  const { error } = await c.auth.updateUser({
    password: newPassword,
    data: { must_change_password: false },
  });
  return { error: error ? error.message : null };
}

/** True when the account was flagged to change its password on first login. */
export function mustChangePassword(session: Session | null): boolean {
  return session?.user?.user_metadata?.['must_change_password'] === true;
}
