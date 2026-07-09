/**
 * Interactive data layer: create projects + run phases from the UI, backed by Supabase.
 * The governance rules come from @projectos/core (legal transitions, owner-gated closure),
 * so the browser enforces the same state machine the CLI does. The signed-in owner acts as
 * role 'owner'. Uses the public anon client (RLS restricts writes to authenticated users).
 */
import { getClient } from './supabase';
import {
  createPhase as coreCreatePhase,
  transitionPhase,
  PHASE_TRANSITIONS,
  type Phase,
  type PhaseStatus,
} from '@projectos/core';

export interface PhaseRow {
  readonly projectId: string;
  readonly phaseId: string;
  readonly objective: string;
  readonly status: PhaseStatus;
  readonly history: Phase['history'];
  readonly advisorNote: string;
}

function rowToPhase(r: PhaseRow): Phase {
  return { phaseId: r.phaseId, project: r.projectId, objective: r.objective, status: r.status, history: r.history };
}

/** Valid next statuses from the current one (for rendering advance buttons). */
export function nextStatuses(status: PhaseStatus): readonly PhaseStatus[] {
  return PHASE_TRANSITIONS[status];
}

export async function createProject(p: {
  id: string;
  name: string;
  repo: string;
  type: string;
}): Promise<{ error: string | null }> {
  const c = getClient();
  if (c === null) return { error: 'not configured' };
  const { error } = await c.from('projects').insert({
    id: p.id,
    name: p.name,
    repo: p.repo || 'none',
    install_status: 'installed',
    production_freeze: true,
    open_phases: 0,
  });
  return { error: error ? error.message : null };
}

export async function listPhases(projectId: string): Promise<readonly PhaseRow[]> {
  const c = getClient();
  if (c === null) return [];
  const { data, error } = await c
    .from('phases')
    .select('project_id,phase_id,objective,status,history,advisor_note')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((d) => ({
    projectId: d['project_id'] as string,
    phaseId: d['phase_id'] as string,
    objective: (d['objective'] as string) ?? '',
    status: d['status'] as PhaseStatus,
    history: (d['history'] as Phase['history']) ?? [],
    advisorNote: (d['advisor_note'] as string) ?? '',
  }));
}

/** Save ChatGPT's reply as the phase's advisor note. */
export async function saveAdvisorNote(
  projectId: string,
  phaseId: string,
  note: string,
): Promise<{ error: string | null }> {
  const c = getClient();
  if (c === null) return { error: 'not configured' };
  const { error } = await c
    .from('phases')
    .update({ advisor_note: note })
    .eq('project_id', projectId)
    .eq('phase_id', phaseId);
  return { error: error ? error.message : null };
}

export async function createPhaseRow(
  projectId: string,
  phaseId: string,
  objective: string,
): Promise<{ error: string | null }> {
  const c = getClient();
  if (c === null) return { error: 'not configured' };
  const p = coreCreatePhase({ phaseId, project: projectId, objective });
  const { error } = await c.from('phases').insert({
    project_id: projectId,
    phase_id: phaseId,
    objective,
    status: p.status,
    history: p.history,
  });
  await refreshOpenPhases(projectId);
  return { error: error ? error.message : null };
}

/** Advance a phase to `to`, acting as the owner. Enforces the core state machine. */
export async function advancePhaseRow(
  row: PhaseRow,
  to: PhaseStatus,
  at: string,
  note?: string,
): Promise<{ error: string | null }> {
  const c = getClient();
  if (c === null) return { error: 'not configured' };
  const r = transitionPhase(rowToPhase(row), to, 'owner', at, note);
  if (!r.ok) return { error: r.error };
  const { error } = await c
    .from('phases')
    .update({ status: r.value.status, history: r.value.history })
    .eq('project_id', row.projectId)
    .eq('phase_id', row.phaseId);
  await refreshOpenPhases(row.projectId);
  return { error: error ? error.message : null };
}

/** Recompute the project's open-phase count (non-terminal phases). */
async function refreshOpenPhases(projectId: string): Promise<void> {
  const c = getClient();
  if (c === null) return;
  const phases = await listPhases(projectId);
  const open = phases.filter((p) => p.status !== 'closed' && p.status !== 'closed_as_blocked').length;
  await c.from('projects').update({ open_phases: open }).eq('id', projectId);
}
