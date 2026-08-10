import { useEffect, useState } from 'react';
import type { ProjectRow } from './data/projects';
import { listPhases, createPhaseRow, advancePhaseRow, saveAdvisorNote, nextStatuses, type PhaseRow } from './data/db';
import { buildAdvisorPrompt, openChatGPT } from './data/chatgpt';
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
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [openAdvisor, setOpenAdvisor] = useState<string | null>(null);

  async function reload() {
    setPhases(await listPhases(project.id));
  }

  function askChatGPT(p: PhaseRow) {
    void openChatGPT(
      buildAdvisorPrompt({ project: project.name, phaseId: p.phaseId, objective: p.objective, status: p.status }),
    );
  }

  async function onSaveNote(p: PhaseRow) {
    setBusy(true);
    const { error } = await saveAdvisorNote(project.id, p.phaseId, notes[p.phaseId] ?? '');
    setBusy(false);
    if (error) return setError(error);
    await reload();
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
          <button type="button" className="linkbtn back" onClick={onBack}>← Projects</button>
          <h1>{project.name}</h1>
          <p>{project.repo} · run phases below</p>
        </div>
        <span className="pill">owner session</span>
      </div>

      <div className="section">
        <h2>New phase</h2>
        <form className="phaseform" onSubmit={(e) => { e.preventDefault(); void onCreate(); }}>
          <label className="vh" htmlFor="ph-id">Phase id</label>
          <input id="ph-id" placeholder="Phase id (e.g. LOGIN1A)" value={id} onChange={(e) => setId(e.target.value)} />
          <label className="vh" htmlFor="ph-obj">Objective</label>
          <input id="ph-obj" placeholder="Objective" value={objective} onChange={(e) => setObjective(e.target.value)} />
          <button type="submit" disabled={busy}>Create phase</button>
        </form>
        {error && <div className="login-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      <div className="section">
        <h2>Phases</h2>
        {phases.length === 0 ? (
          <p className="note">No phases yet. Create one above.</p>
        ) : (
          <div className="flow">
            {phases.map((p) => {
              const nexts = nextStatuses(p.status);
              const advisorOpen = openAdvisor === p.phaseId;
              return (
                <div className="phase-item" key={p.phaseId}>
                  <div className="phase-row">
                    <div className="phase-main">
                      <b>{p.phaseId}</b>
                      <span className="phase-obj">{p.objective}</span>
                    </div>
                    <span className={`tag ${p.status.startsWith('closed') ? 'ok' : 'mut'}`}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                    <div className="phase-actions">
                      <button
                        className="btn-chat"
                        onClick={() => {
                          askChatGPT(p);
                          setOpenAdvisor(p.phaseId);
                          setNotes((n) => ({ ...n, [p.phaseId]: n[p.phaseId] ?? p.advisorNote }));
                        }}
                      >
                        💬 Ask ChatGPT
                      </button>
                      {nexts.length === 0 && <span className="note">terminal</span>}
                      {nexts.map((to) => {
                        const gated = to === 'closed' || to === 'closed_as_blocked';
                        // Closure is NOT offered here. This surface advanced phases by passing
                        // `by: 'owner'` straight into the core state machine, so its Close button
                        // closed a phase with no G4 gate, no delegation check and no gatekeeper
                        // decision. Offering a control that must always refuse is worse than not
                        // offering it: it invites the click and teaches the operator to ignore the
                        // refusal. Closure lives in the governed runtime.
                        if (gated) {
                          return (
                            <span key={to} className="note" title="Closure requires the G4 gate and a committed gatekeeper decision, through the governed runtime.">
                              closure is governed elsewhere
                            </span>
                          );
                        }
                        return (
                          <button key={to} className="btn-step" disabled={busy} onClick={() => void onAdvance(p, to)}>
                            {`→ ${STATUS_LABEL[to]}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {(advisorOpen || p.advisorNote) && (
                    <div className="advisor-panel">
                      <div className="advisor-hint">
                        ChatGPT opened with the advisor prompt (also copied to clipboard). Paste its reply here:
                      </div>
                      <textarea
                        value={notes[p.phaseId] ?? p.advisorNote}
                        placeholder="Paste ChatGPT's advice / review…"
                        onChange={(e) => setNotes((n) => ({ ...n, [p.phaseId]: e.target.value }))}
                      />
                      <div className="advisor-actions">
                        <button className="btn-step" onClick={() => askChatGPT(p)}>Re-open ChatGPT</button>
                        <button className="btn-new" disabled={busy} onClick={() => void onSaveNote(p)}>Save advisor note</button>
                      </div>
                    </div>
                  )}
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
