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
import { useGovernedProjects, useLifecycle, useGovernedState } from '../daemon/DaemonProvider';
import type { LiveLifecycle } from '../daemon/types';
import { ownerModelFromGoverned } from './governedOwnerModel';
import { GovernedActions } from './GovernedActions';
import { GatekeeperStatus } from './GatekeeperStatus';
import { OwnerActionInbox } from './OwnerActionInbox';
import { ObjectiveIntake } from './ObjectiveIntake';
import { ProjectSelector } from './ProjectSelector';
import { RegisterProjectGuide } from './RegisterProjectGuide';
import { ProtectedOperationConfirmation } from './confirmation/ProtectedOperationConfirmation';
import { SYNTHETIC_CONFIRMATION, SYNTHETIC_NOW_MS } from './confirmation/ownerConfirmationFixture';
import {
  reduceHostEvent,
  reduceIntent,
  type ConfirmationState,
  type RendererIntent,
} from './confirmation/ownerConfirmationModel';

function Badge({ badge }: { badge: OwnerBadge }) {
  return <span className={`ocp-badge ${badge.tone}`}>{badge.label}</span>;
}

/** Pre-ready = the host owns the truth and there is no live worker yet. */
function isPreReady(lifecycle: LiveLifecycle | null): lifecycle is LiveLifecycle {
  return lifecycle !== null && !lifecycle.readOnlyAvailable;
}

/** A crashed/blocked/failed worker is a problem the owner must not miss; other pre-ready states inform. */
function lifecycleTone(state: LiveLifecycle['state']): 'crit' | 'warn' {
  return state === 'BLOCKED' || state === 'CRASHED' ? 'crit' : 'warn';
}

/**
 * The authoritative worker-lifecycle banner. It renders ONLY before the local worker is ready, as
 * the page's primary emphasis, so the owner sees recovery/blocked status on this default landing
 * surface instead of the (project-planning) seed content below — which would otherwise mask a
 * failed or still-recovering worker. The message is the host's own `nextSafeAction`, verbatim.
 */
function LifecycleBanner({ lifecycle }: { lifecycle: LiveLifecycle }) {
  // `data-testid` so its own tests can assert THIS element is the live status region, rather than
  // asserting it is the only one on the page — which stopped being true the moment the project
  // selector above it gained its own (required) live regions.
  return (
    <div
      className={`ocp-panel ocp-lifecycle ${lifecycleTone(lifecycle.state)}`}
      role="status"
      aria-live="polite"
      data-testid="lifecycle-banner"
    >
      <h2>Local worker</h2>
      <p className="ocp-lifecycle-msg">{lifecycle.nextSafeAction}</p>
    </div>
  );
}

export function OwnerControlPlane() {
  // WHICH PROJECT the recorded fallback should describe — taken from the authoritative selection,
  // not hardcoded. Hardcoding it meant this page could render the selector saying "Working on Dead
  // Aisle" directly above a "where you are" line beginning "ProjectOS", which is a plain-text
  // contradiction of itself on the one page that owns the selector.
  const inventory = useGovernedProjects();
  const projectId = inventory?.selectedProjectId ?? PROJECTOS_V3.projectId;
  const lifecycle = useLifecycle();
  // Live canonical state when the runtime has reported; otherwise the last RECORDED position, which
  // the header labels as such. The surface never presents a record as if it were live.
  const governed = useGovernedState();
  const live = governed !== null && governed.connected ? governed : null;
  // A RECORDED model exists only for the projects the snapshot knows. For any other registered
  // project there is no recorded position at all, and substituting ProjectOS's would describe a
  // different project under this one's name.
  const recorded = OWNER_MODELS.find((m) => m.projectId === projectId) ?? null;
  const model: OwnerControlModel =
    live !== null ? ownerModelFromGoverned(live) : (recorded ?? PROJECTOS_V3);
  const noRecordedPosition = live === null && recorded === null;
  const view = useMemo(() => buildOwnerControlView(model), [model]);

  // Synthetic owner-confirmation preview state (Option C1). No authority, no Windows ceremony: a
  // DecisionSubmitting is echoed to the host-authoritative WindowsVerificationRequired state purely to
  // demonstrate the flow. The renderer can never mint a verified/ready/expired/invalidated state.
  const [confirmState, setConfirmState] = useState<ConfirmationState>(SYNTHETIC_CONFIRMATION.hostState);
  const handleConfirmIntent = (intent: RendererIntent) => {
    setConfirmState((prev) => {
      const next = reduceIntent(prev, intent, {
        summary: SYNTHETIC_CONFIRMATION,
        state: prev,
        nowMs: SYNTHETIC_NOW_MS,
        hostAvailable: true,
        revisionChanged: false,
      });
      return prev !== 'DecisionSubmitting' && next === 'DecisionSubmitting'
        ? reduceHostEvent(next, 'DecisionAccepted')
        : next;
    });
  };

  return (
    <section className="ocp" aria-labelledby="ocp-title">
      <div className="head">
        <div>
          <h1 id="ocp-title">Owner Control</h1>
          <p>{view.whereYouAre}</p>
          <p className="ocp-source" data-testid="ocp-source">
            {live !== null ? (
              <>
                <span className="ocp-badge ok">Live</span> Canonical runtime state · plan{' '}
                {live.plan.planVersion} ·{' '}
                {live.plan.ready ? 'PLAN READY (recomputed)' : 'plan NOT ready (recomputed)'} ·{' '}
                {live.plan.planPath}
              </>
            ) : (
              <>
                <span className="ocp-badge mut">Not live</span>{' '}
                {governed !== null && !governed.connected
                  ? governed.detail
                  : 'No ProjectOS runtime has reported yet. Showing the last recorded position, not live state.'}
              </>
            )}
          </p>
        </div>
      </div>

      {/* WHICH PROJECT. First, and above everything that acts on one, so the owner can never read a
          plan or press a governed action without seeing which project it belongs to. It lists only
          the projects the installed host validated against the protected registry, and it submits a
          project ID — there is no path input here, and no route by which one could be supplied. */}
      <ProjectSelector />
      <RegisterProjectGuide />

      {noRecordedPosition && (
        <div className="ocp-panel warn" role="status" data-testid="ocp-no-recorded-position">
          <h2>Nothing to show yet</h2>
          <p>
            No runtime has reported for this project, and there is no earlier position on record for
            it. What follows is not about this project — start the local worker to see its real
            state.
          </p>
        </div>
      )}

      {/* Worker lifecycle — the primary emphasis while the local worker is not yet ready. */}
      {isPreReady(lifecycle) && <LifecycleBanner lifecycle={lifecycle} />}

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
              </li>
            ))}
          </ul>
        ) : (
          <p className="ocp-empty">No decisions are waiting for you. Nothing is blocked on your approval.</p>
        )}
      </div>

      {/* Owner action inbox — every PENDING approval, real Approve/Reject wired to approval.decide. */}
      {live !== null && <OwnerActionInbox state={live} />}

      {/*
        Protected-action owner confirmation (Option C1) — the universal confirmation surface.
        It has NO real producer yet, so the only thing that can drive it here is fixture data.

        It used to render open, unconditionally, immediately under "No decisions are waiting for
        you" — so the owner home screen simultaneously said nothing needed them AND "ProjectOS
        needs your approval / Apply a database migration / against the live production database /
        This cannot be undone", with live-looking Approve and Refuse buttons. The synthetic banner
        was present and honest, and it was still the most alarming thing on the screen.

        It is now behind explicit owner intent and named as an example before it can be opened.
        Nothing about the component or its 32 tests changes; only whether the owner is shown a
        fabricated production decision they never asked to see.
      */}
      <details className="ocp-panel preview">
        <summary>
          Show an example approval screen
          <span className="ocp-example-tag">Example only — not a real request</span>
        </summary>
        <p className="ocp-empty">
          This is a demonstration of what ProjectOS shows when a protected action genuinely needs
          your approval. Nothing here is pending, and nothing it offers can execute.
        </p>
        <ProtectedOperationConfirmation
          summary={SYNTHETIC_CONFIRMATION}
          state={confirmState}
          nowMs={SYNTHETIC_NOW_MS}
          onIntent={handleConfirmIntent}
        />
      </details>

      {/* Next safe action */}
      <div className="ocp-panel next">
        <h2>Next safe action</h2>
        <p className="ocp-next">{view.nextSafeAction}</p>
      </div>

      {/* Gatekeeper status + real cost. Only ever shown against live runtime state. */}
      {live !== null && <GatekeeperStatus state={live} />}

      {/* Governed actions — only ever shown against live runtime state. */}
      {live !== null && <GovernedActions state={live} />}

      {/* Objective intake. Only against a LIVE runtime: without one there is nothing to submit to,
          and an input box that silently does nothing is worse than no input box. */}
      {live !== null && (
        <ObjectiveIntake projectName={live.projectName} repository={live.repository.repo} />
      )}

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
