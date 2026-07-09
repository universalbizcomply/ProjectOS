import { useEffect, useState } from 'react';
import type { ProjectRow } from './data/projects';
import { listPhases, createPhaseRow, advancePhaseRow, nextStatuses, type PhaseRow } from './data/db';
import type { PhaseStatus } from '@projectos/core';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  prompted: 'Prompted',
  implementing: 'Implementing',
  validating: 'Validating',
  evidence: 'Evidence',
  awaiting_review: 'Awaiting review',
  awaiting_closure: 'Awaiting closure',
  closed: 'Closed',
  closed_as_blocked: 'Closed (blocked)',
  rolled_back: 'Rolled back',
};

export function ProjectDetail({ project, onBack }: { project: ProjectRow; onBack: () => void }) {
  const [phases, setPhases] = useState<readonly PhaseRow[]>([]);
  const [id, setId] = useState('');
  const [objective, setObjective] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setPhases(await listPhases(project.id));
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function onCreate() {
    setError(null);
    if (id.trim() === '') return setError('Give the phase an id.');
    setBusy(true);
    const { error } = await createPhaseRow(project.id, id.trim(), objective.trim());
    setBusy(false);
    if (error) return setError(error);
    setId('');
    setObjective('');
    await reload();
  }

  async function onAdvance(row: PhaseRow, to: PhaseStatus) {
    setError(null);
    setBusy(true);
    const owned = to === 'closed' || to === 'closed_as_blocked';
    const { error } = await advancePhaseRow(row, to, new Date().toISOString(), owned ? 'Owner action' : undefined);
    setBusy(false);
    if (error) return setError(error);
    await reload();
  }

  return (
    <>
      <div className="head">
        <div>
          <span className="back" onClick={onBack}>← Projects</span>
          <h1>{project.name}</h1>
          <p>{project.repo} · run phases below</p>
        </div>
        <span className="pill">owner session</span>
      </div>

      <div className="section">
        <h2>New phase</h2>
        <div className="phaseform">
          <input placeholder="Phase id (e.g. LOGIN1A)" value={id} onChange={(e) => setId(e.target.value)} />
          <input placeholder="Objective" value={objective} onChange={(e) => setObjective(e.target.value)} />
          <button onClick={() => void onCreate()} disabled={busy}>Create phase</button>
        </div>
        {error && <div className="login-error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      <div className="section">
        <h2>Phases</h2>
        {phases.length === 0 ? (
          <p className="note">No phases yet. Create one above.</p>
        ) : (
          <div className="flow">
            {phases.map((p) => {
              const nexts = nextStatuses(p.status);
              return (
                <div className="phase-row" key={p.phaseId}>
                  <div className="phase-main">
                    <b>{p.phaseId}</b>
                    <span className="phase-obj">{p.objective}</span>
                  </div>
                  <span className={`tag ${p.status.startsWith('closed') ? 'ok' : 'mut'}`}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                  <div className="phase-actions">
                    {nexts.length === 0 && <span className="note">terminal</span>}
                    {nexts.map((to) => {
                      const gated = to === 'closed' || to === 'closed_as_blocked';
                      return (
                        <button
                          key={to}
                          className={gated ? 'btn-gated' : 'btn-step'}
                          disabled={busy}
                          onClick={() => void onAdvance(p, to)}
                        >
                          {gated ? `${STATUS_LABEL[to]} 🔒` : `→ ${STATUS_LABEL[to]}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="note">
          Transitions follow the ProjectOS state machine. 🔒 = owner-gated closure — you're signed in as owner.
        </p>
      </div>
    </>
  );
}
