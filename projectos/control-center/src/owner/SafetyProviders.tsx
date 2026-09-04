/**
 * Safety & Providers — read-only Control Centre surface over the governed chain (Phases 4–11).
 *
 * Shows, per project: the owner approval queue (items + status), the provider-guard decisions
 * (ALLOW / OWNER_GATED / REFUSED with reasons), and the live safety state. Snapshot-driven and inert —
 * owner-only actions are not performed here; this surface only displays what the backend decided.
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */
import { useMemo } from 'react';
import { PROJECTOS_V3, OWNER_MODELS } from './ownerSnapshot';
import { chainFor, decisionTone } from './governedChain';
import { buildOwnerControlView } from './ownerModel';
import { useGovernedProjects, useGovernedState } from '../daemon/DaemonProvider';
import { SelectedProjectIdentity } from './SelectedProjectIdentity';
import { OwnerActionInbox } from './OwnerActionInbox';
import { ownerModelFromGoverned } from './governedOwnerModel';

export function SafetyProviders() {
  // WHICH PROJECT, decided by the ONE authoritative selection and never by this page.
  //
  // Its own `<select>` over `GOVERNED_CHAINS` is gone. A safety surface that could be pointed at a
  // different project from the one Owner Control is acting on is a safety surface that can reassure
  // the owner about the wrong thing. There is no setter here now, so nothing on this page can
  // override, shadow or locally remember a selection.
  const inventory = useGovernedProjects();
  const projectId = inventory?.selectedProjectId ?? PROJECTOS_V3.projectId;
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
  // The provider-guard table below still comes from the recorded chain, which knows only the
  // projects the snapshot shipped with. For any other registered project there is no chain, and
  // showing ProjectOS's would put one project's decisions under another project's name. The
  // approval queue no longer reads from it at all - it reads the live one.
  const chainDescribesThisProject = chain.projectId === projectId;
  // A projection that does not report a queue is not a projection with an empty one; both read as
  // "nothing to answer here", and neither may throw.
  const waitingApprovals = live?.pendingApprovals ?? [];

  return (
    <section className="ocp" aria-labelledby="sp-title">
      <div className="head">
        <div>
          <h1 id="sp-title">Safety &amp; Providers</h1>
          <p>What the governed chain decided for this project — approvals, provider guards, and safety. Read-only.</p>
        </div>
        <SelectedProjectIdentity />
      </div>

      {!chainDescribesThisProject && (
        <div className="ocp-panel warn" role="status" data-testid="sp-no-chain">
          <h2>Nothing recorded for this project</h2>
          <p>
            No approvals or provider decisions have been recorded for this project yet, so the
            sections below are empty rather than borrowed from another one.
          </p>
        </div>
      )}

      {/* Safety state. Announced as a group: everything in it changes when the project does. */}
      <div className="ocp-panel" role="status" aria-live="polite">
        <h2>Safety state</h2>
        <div className="ocp-badges">
          {safetyBadges.map((b, i) => <span key={i} className={`ocp-badge ${b.tone}`}>{b.label}</span>)}
        </div>
      </div>

      {/*
        THE REAL QUEUE, ANSWERED WHERE IT IS ANSWERED.
        This panel used to list a FIXTURE chain's approval items and offer three permanently disabled
        buttons under them — a queue that was not the project's, and controls that could never do
        anything. Both are replaced by the live pending approvals and the one component that decides
        them: it names each request and asks a second question before recording an answer. Rather than
        a second, weaker copy of the same controls.
      */}
      <div className={`ocp-panel decisions${waitingApprovals.length > 0 ? ' active' : ''}`}>
        <h2>
          Owner approval queue
          {waitingApprovals.length > 0 ? ` · ${waitingApprovals.length} pending` : ''}
        </h2>
        {live === null ? (
          <p className="ocp-empty">
            ProjectOS is not reporting on this project, so its approval queue cannot be read from here.
          </p>
        ) : waitingApprovals.length === 0 ? (
          <p className="ocp-empty">No items are waiting for your approval.</p>
        ) : (
          <OwnerActionInbox state={live} />
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
