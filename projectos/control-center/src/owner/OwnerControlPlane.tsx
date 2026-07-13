/**
 * Owner Control Plane — the single canonical owner surface.
 *
 * One screen answers, for the selected project: where you are, plan status, completion, decisions
 * required, risks, blockers, the one safe next action, owner-only restricted actions, and the live
 * safety state. Plain language, one primary emphasis per region, responsive, accessible. Local-only:
 * driven entirely by a static snapshot — no backend, no provider request.
 * Created in PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A.
 */
import { useMemo, useState } from 'react';
import { OWNER_MODELS, PROJECTOS_V3 } from './ownerSnapshot';
import { buildOwnerControlView, type OwnerControlModel, type OwnerBadge } from './ownerModel';

function Badge({ badge }: { badge: OwnerBadge }) {
  return <span className={`ocp-badge ${badge.tone}`}>{badge.label}</span>;
}

export function OwnerControlPlane() {
  const [projectId, setProjectId] = useState<string>(PROJECTOS_V3.projectId);
  const model: OwnerControlModel =
    OWNER_MODELS.find((m) => m.projectId === projectId) ?? PROJECTOS_V3;
  const view = useMemo(() => buildOwnerControlView(model), [model]);

  return (
    <section className="ocp" aria-labelledby="ocp-title">
      <div className="head">
        <div>
          <h1 id="ocp-title">Owner Control</h1>
          <p>{view.whereYouAre}</p>
        </div>
        <label className="ocp-select">
          <span className="ocp-select-label">Project</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            aria-label="Select project"
          >
            {OWNER_MODELS.map((m) => (
              <option key={m.projectId} value={m.projectId}>
                {m.projectName}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Status + completion */}
      <div className="ocp-status">
        <span className={`ocp-badge lg ${view.statusTone}`} aria-label={`Plan status ${view.planStatus}`}>
          {view.planStatus}
        </span>
        <div className="ocp-meter" role="group" aria-label="Programme completion">
          <div className="ocp-meter-track">
            <div
              className="ocp-meter-fill"
              style={{ width: `${view.completionPercent}%` }}
              role="progressbar"
              aria-valuenow={view.completionPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <div className="ocp-meter-label">{view.completionLabel}</div>
        </div>
      </div>

      {/* Decision required — the highest-priority region */}
      <div className={`ocp-panel decisions${view.hasDecisions ? ' active' : ''}`}>
        <h2>Decisions required</h2>
        {view.hasDecisions ? (
          <ul className="ocp-decisions">
            {view.decisionsRequired.map((d) => (
              <li key={d.id} className={`ocp-decision ${d.severity}`}>
                <div className="ocp-decision-title">{d.title}</div>
                <div className="ocp-decision-detail">{d.detail}</div>
                <div className="ocp-decision-actions">
                  <button type="button" className="ocp-btn primary" disabled aria-disabled="true">Approve</button>
                  <button type="button" className="ocp-btn" disabled aria-disabled="true">Return for correction</button>
                  <button type="button" className="ocp-btn danger" disabled aria-disabled="true">Reject</button>
                  <span className="ocp-preview-tag" role="note">Preview — record approvals in the ProjectOS desktop app.</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ocp-empty">No decisions are waiting for you. Nothing is blocked on your approval.</p>
        )}
      </div>

      {/* Next safe action */}
      <div className="ocp-panel next">
        <h2>Next safe action</h2>
        <p className="ocp-next">{view.nextSafeAction}</p>
      </div>

      {/* Risks + blockers */}
      <div className="ocp-grid2">
        <div className="ocp-panel">
          <h2>Risks</h2>
          {view.risks.length ? (
            <ul className="ocp-list">{view.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
          ) : (
            <p className="ocp-empty">No current risks recorded.</p>
          )}
        </div>
        <div className="ocp-panel">
          <h2>Blockers</h2>
          {view.blockers.length ? (
            <ul className="ocp-list warn">{view.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
          ) : (
            <p className="ocp-empty">No blockers.</p>
          )}
        </div>
      </div>

      {/* Safety state */}
      <div className="ocp-panel">
        <h2>Safety state</h2>
        <div className="ocp-badges">
          {view.safetyBadges.map((b, i) => <Badge key={i} badge={b} />)}
        </div>
      </div>

      {/* Restricted (owner-only) actions */}
      <div className="ocp-panel">
        <h2>Owner-only actions</h2>
        <p className="ocp-sub">These actions require your explicit approval. ProjectOS and Claude cannot perform them.</p>
        <div className="ocp-chips">
          {view.restrictedActions.map((a, i) => <span key={i} className="ocp-chip">{a}</span>)}
        </div>
      </div>
    </section>
  );
}
