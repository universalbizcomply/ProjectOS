/**
 * Safety & Providers — read-only Control Centre surface over the governed chain (Phases 4–11).
 *
 * Shows, per project: the owner approval queue (items + status), the provider-guard decisions
 * (ALLOW / OWNER_GATED / REFUSED with reasons), and the live safety state. Snapshot-driven and inert —
 * owner-only actions are not performed here; this surface only displays what the backend decided.
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */
import { useMemo, useState } from 'react';
import { PROJECTOS_V3, OWNER_MODELS } from './ownerSnapshot';
import { chainFor, decisionTone, statusTone, GOVERNED_CHAINS } from './governedChain';
import { buildOwnerControlView } from './ownerModel';
import { useGovernedState } from '../daemon/DaemonProvider';
import { ownerModelFromGoverned } from './governedOwnerModel';

export function SafetyProviders() {
  const [projectId, setProjectId] = useState<string>(PROJECTOS_V3.projectId);
  const chain = chainFor(projectId);

  // SAFETY IS A CLAIM ABOUT WHAT THE RUNTIME HAS DONE, so it comes from the runtime whenever there
  // is one. Read unconditionally from the recorded snapshot, these badges asserted "Production
  // frozen · No provider contacted · No secret used · No AI API used" from a hardcoded literal —
  // reassuring, unfalsifiable, and exactly the shape of claim that must never be stale. Owner Chat
  // failed the same way against the same constant.
  //
  // Only when the live projection describes THE SELECTED PROJECT. The selector below is driven by
  // GOVERNED_CHAINS, which is deliberately left alone: pairing this project's live safety with
  // another project's approval chain would trade a stale badge for an incoherent screen.
  const governed = useGovernedState();
  const live = governed !== null && governed.connected && governed.projectId === projectId ? governed : null;
  const model = useMemo(
    () =>
      live !== null
        ? ownerModelFromGoverned(live)
        : (OWNER_MODELS.find((m) => m.projectId === projectId) ?? PROJECTOS_V3),
    [live, projectId],
  );
  const safetyBadges = buildOwnerControlView(model).safetyBadges;
  const pending = chain.approvalItems.filter((i) => i.status === 'pending').length;

  return (
    <section className="ocp" aria-labelledby="sp-title">
      <div className="head">
        <div>
          <h1 id="sp-title">Safety &amp; Providers</h1>
          <p>What the governed chain decided for this project — approvals, provider guards, and safety. Read-only.</p>
        </div>
        <label className="ocp-select">
          <span className="ocp-select-label">Project</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Select project">
            {GOVERNED_CHAINS.map((c) => (
              <option key={c.projectId} value={c.projectId}>{c.projectName}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Safety state */}
      <div className="ocp-panel">
        <h2>Safety state</h2>
        <div className="ocp-badges">
          {safetyBadges.map((b, i) => <span key={i} className={`ocp-badge ${b.tone}`}>{b.label}</span>)}
        </div>
      </div>

      {/* Approval queue */}
      <div className={`ocp-panel decisions${pending > 0 ? ' active' : ''}`}>
        <h2>Owner approval queue{pending > 0 ? ` · ${pending} pending` : ''}</h2>
        {chain.approvalItems.length ? (
          <ul className="ocp-decisions">
            {chain.approvalItems.map((item) => (
              <li key={item.id} className="ocp-decision">
                <div className="ocp-decision-title">
                  {item.summary} <span className={`ocp-badge ${statusTone(item.status)}`}>{item.status}</span>
                </div>
                <div className="ocp-decision-detail">{item.kind} · {item.id}</div>
                {item.status === 'pending' && (
                  <div className="ocp-decision-actions">
                    <button type="button" className="ocp-btn primary" disabled aria-disabled="true">Approve</button>
                    <button type="button" className="ocp-btn" disabled aria-disabled="true">Return</button>
                    <button type="button" className="ocp-btn danger" disabled aria-disabled="true">Reject</button>
                    <span className="ocp-preview-tag" role="note">Preview — record approvals in the ProjectOS desktop app.</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ocp-empty">No items are waiting for your approval.</p>
        )}
      </div>

      {/* Provider guard decisions */}
      <div className="ocp-panel">
        <h2>Provider guard decisions</h2>
        <div className="sp-table" role="table" aria-label="Provider guard decisions">
          <div className="sp-row sp-head" role="row">
            <span role="columnheader">Provider</span>
            <span role="columnheader">Action</span>
            <span role="columnheader">Decision</span>
            <span role="columnheader">Reason</span>
          </div>
          {chain.providerDecisions.map((d, i) => (
            <div className="sp-row" role="row" key={i}>
              <span role="cell">{d.provider}</span>
              <span role="cell">{d.action}</span>
              <span role="cell"><span className={`ocp-badge ${decisionTone(d.decision)}`}>{d.decision}</span></span>
              <span role="cell" className="sp-reason">{d.reason}</span>
            </div>
          ))}
        </div>
        <p className="ocp-sub">Provider access defaults to refused. Nothing here contacts a provider — decisions are classified locally and gated actions route to the approval queue.</p>
      </div>
    </section>
  );
}
