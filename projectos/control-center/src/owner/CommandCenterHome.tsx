/**
 * Command Centre — the default landing surface.
 *
 * It answers three questions and nothing else: what is happening, does the owner need to do
 * anything, and what happens next (PROJECTOS-PRODUCT-COMPLETION1A §3, §8). Everything it states is
 * derived by `buildHomeModel` from the canonical projection, so this file renders and does not
 * decide — the one line that matters most, MURAD ACTION REQUIRED, cannot be authored here.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never shows plan ids, digests, request ids, grant ids or work
 * ids in its default view. Those are real and they matter, but an owner should not have to learn
 * them to run a project; the detailed surfaces below still carry them in full.
 */
import { useGovernedRun, useGovernedState } from '../daemon/DaemonProvider';
import { buildHomeModel, type OwnerActionItem } from './homeModel';
import { requestGovernedCommand } from '../governed/governedClient';
import { tauriBridge } from '../daemon/tauriBridge';
import { useState } from 'react';

function ActionCard({ item }: { item: OwnerActionItem }) {
  return (
    <li className={`cc-action ${item.severity}`}>
      <div className="cc-action-title">{item.title}</div>
      <div className="cc-action-detail">{item.detail}</div>
    </li>
  );
}

export function CommandCenterHome({ onOpenDetail }: { onOpenDetail: () => void }) {
  const governed = useGovernedState();
  const run = useGovernedRun();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<readonly string[]>([]);

  // NOT LIVE IS ITS OWN SCREEN. Rendering a home page full of confident numbers from a recorded
  // snapshot is exactly how an owner comes to believe a stopped system is running.
  if (governed === null || !governed.connected) {
    return (
      <section className="ocp cc" aria-labelledby="cc-title">
        <div className="head">
          <h1 id="cc-title">Command Centre</h1>
        </div>
        <div className="ocp-panel warn" role="status">
          <h2>ProjectOS is not reporting yet</h2>
          <p className="ocp-empty">
            {governed !== null && !governed.connected
              ? governed.detail
              : 'Waiting for the local ProjectOS runtime to report. Nothing is shown here until it does, because a recorded position is not live state.'}
          </p>
        </div>
      </section>
    );
  }

  const home = buildHomeModel(governed);
  const phase = governed.activePhase ?? governed.nextStartablePhase;

  async function send(verb: 'run.start' | 'run.stop', description: string): Promise<void> {
    if (phase === null) return;
    setBusy(true);
    setOutcome([`Asking ProjectOS to ${description}…`]);
    const result = await requestGovernedCommand(tauriBridge, verb, { phaseId: phase.phaseId });
    setBusy(false);
    setOutcome(result.lines);
  }

  return (
    <section className="ocp cc" aria-labelledby="cc-title">
      <div className="head">
        <div>
          <h1 id="cc-title">{home.projectName}</h1>
          <p>
            {home.phaseId === null
              ? 'No phase is running.'
              : `Working on ${home.phaseId} · ${home.phaseStatus}`}
          </p>
        </div>
        <span className={`ocp-badge lg ${home.ownerActionRequired ? 'warn' : 'ok'}`}>
          {home.ownerActionRequired ? 'Your input needed' : 'Nothing needs you'}
        </span>
      </div>

      {/* THE HEADLINE ANSWER, stated plainly and derived, never authored. */}
      <div
        className={`ocp-panel cc-verdict ${home.ownerActionRequired ? 'active' : ''}`}
        role="status"
        aria-live="polite"
      >
        <h2>Does anything need you?</h2>
        {home.ownerActionRequired ? (
          <ul className="cc-actions">
            {home.ownerActions.map((item) => (
              <ActionCard key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <p className="ocp-empty">
            No. Nothing is waiting on your approval, the plan is ready, and no limit has been
            reached.
          </p>
        )}
      </div>

      {/* Where things stand. */}
      <div className="cc-facts">
        <div className="cc-fact">
          <div className="cc-fact-label">Progress</div>
          <div className="cc-fact-value">{home.completionPercent}%</div>
          <div className="cc-fact-sub">{home.completionLabel}</div>
        </div>
        <div className="cc-fact">
          <div className="cc-fact-label">Plan</div>
          <div className="cc-fact-value">{home.planReady ? 'Ready' : 'Not ready'}</div>
          <div className="cc-fact-sub">{home.planStatus}</div>
        </div>
        <div className="cc-fact">
          <div className="cc-fact-label">Production</div>
          <div className="cc-fact-value">{home.productionFrozen ? 'Frozen' : 'LIVE'}</div>
          <div className="cc-fact-sub">
            {home.productionFrozen ? 'Nothing can reach production' : 'Production is reachable'}
          </div>
        </div>
        <div className="cc-fact">
          <div className="cc-fact-label">Reviewer cost</div>
          <div className="cc-fact-value">{home.spendLabel ?? 'Not set up'}</div>
          <div className="cc-fact-sub">
            {home.budgetStatus === null ? 'No budget configured' : `Budget ${home.budgetStatus}`}
          </div>
        </div>
      </div>

      {/* What ProjectOS will do next, in its own words. */}
      <div className="ocp-panel next">
        <h2>What happens next</h2>
        <p className="ocp-next">{home.nextSafeAction}</p>
      </div>

      {/* The few controls that belong on a landing screen. Everything else lives in Owner Control. */}
      <div className="ocp-panel">
        <h2>Run</h2>
        <div className="ocp-actionrow">
          {phase !== null && !run.active && (
            <button
              type="button"
              className="ocp-btn primary"
              disabled={busy || !home.planReady}
              title={home.planReady ? undefined : 'The plan must be ready before work can start.'}
              onClick={() => void send('run.start', 'start work')}
            >
              ▶ Start work
            </button>
          )}
          {phase !== null && run.active && (
            <button
              type="button"
              className="ocp-btn danger"
              disabled={busy}
              onClick={() => void send('run.stop', 'stop work')}
            >
              ■ Stop
            </button>
          )}
          <button type="button" className="ocp-btn" onClick={onOpenDetail}>
            Open Owner Control
          </button>
        </div>
        <p className="ocp-note">
          {run.active
            ? 'Work is running. ProjectOS asks the reviewer automatically when it needs to — you are not the messenger.'
            : 'Stopping keeps the session, so work can be picked up again from where it stopped.'}
        </p>
        {run.lines.length > 0 && (
          <pre className="ocp-run-output" role="log" aria-live="polite" aria-label="Work output">
            {run.lines.map((l) => `${l.stream === 'stderr' ? '! ' : ''}${l.line}`).join('\n')}
          </pre>
        )}
        {outcome.length > 0 && (
          <p className="ocp-actionmsg" role="status" aria-live="polite">
            {outcome.join(' ')}
          </p>
        )}
      </div>

      {home.blockers.length > 0 && (
        <div className="ocp-panel">
          <h2>Blockers</h2>
          <ul className="ocp-list warn">
            {home.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
