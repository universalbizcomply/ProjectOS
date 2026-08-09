/**
 * Governed actions — the owner's controls, driven by the canonical runtime.
 *
 * ONE OBVIOUS PRIMARY ACTION PER STATE. What the phase is doing decides which single action is
 * offered as primary; everything else is secondary or absent. Nothing here decides authority: the
 * buttons express intent, the runtime decides, and its refusal is shown verbatim.
 *
 * Deliberately NOT here: any optimistic update. After a command the sidecar re-emits governed state,
 * so the panel repaints from re-read durable truth. A button that "worked" is one whose effect is
 * visible in the state below it.
 *
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */
import { useState } from 'react';
import { tauriBridge } from '../daemon/tauriBridge';
import { sendGovernedCommand } from '../governed/governedClient';
import type { GovernedCommandArgs, GovernedVerb } from '../governed/governedCommands';
import type { GovernedProjection, GovernedPhaseView } from '../governed/types';

/** The next lifecycle step for a phase, in plain language. Derived, never authored per-button. */
const NEXT_STEP: Readonly<Record<string, { readonly to: string; readonly label: string }>> = {
  draft: { to: 'prompted', label: 'Prepare the phase prompt' },
  prompted: { to: 'implementing', label: 'Begin implementation' },
  implementing: { to: 'validating', label: 'Run validation' },
  validating: { to: 'evidence', label: 'Collect evidence' },
  evidence: { to: 'awaiting_review', label: 'Send for review' },
  awaiting_review: { to: 'awaiting_closure', label: 'Send for closure' },
};

interface ActionState {
  readonly busy: boolean;
  readonly lines: readonly string[];
  readonly failed: boolean;
}

export function GovernedActions({ state }: { state: GovernedProjection }) {
  const [action, setAction] = useState<ActionState>({ busy: false, lines: [], failed: false });

  const phase: GovernedPhaseView | null = state.activePhase ?? state.nextStartablePhase;

  async function send(verb: GovernedVerb, args: GovernedCommandArgs, description: string) {
    setAction({ busy: true, lines: [`Asking the runtime to ${description}…`], failed: false });
    const outcome = await sendGovernedCommand(tauriBridge, verb, args);
    if (!outcome.ok) {
      setAction({ busy: false, lines: outcome.lines, failed: true });
      return;
    }
    // No optimistic update, and no explicit refresh needed: the sidecar re-emits governed state
    // after every command, so the panel below repaints from re-read durable truth on its own.
    setAction({
      busy: false,
      lines: [`Sent to the runtime. The state below refreshes when it replies.`],
      failed: false,
    });
  }

  const closure = state.authority.closureDelegation;
  const canDelegateClose =
    closure !== null && closure.projectScope === state.projectId && closure.excludesProtectedActions;

  const next = phase === null ? undefined : NEXT_STEP[phase.status];

  return (
    <div className="ocp-panel ocp-actions">
      <h2>What you can do now</h2>

      {!state.plan.ready && (
        <p className="ocp-empty">
          The approved plan does not pass its evidence gate, so no governed action is offered. Nothing
          can proceed until the plan is READY.
        </p>
      )}

      {state.plan.ready && phase === null && (
        <p className="ocp-empty">
          Every approved phase is either finished or waiting on a dependency. There is no safe action
          to take here right now.
        </p>
      )}

      {state.plan.ready && phase !== null && (
        <div className="ocp-actionrow">
          {/* PRIMARY: exactly one, chosen by the phase's real status. */}
          {phase.startable && (
            <button
              type="button"
              className="ocp-btn primary"
              disabled={action.busy}
              onClick={() => void send('phase.start', { phaseId: phase.phaseId }, `start ${phase.phaseId}`)}
            >
              Start {phase.phaseId}
            </button>
          )}

          {next !== undefined && (
            <button
              type="button"
              className="ocp-btn primary"
              disabled={action.busy}
              onClick={() =>
                void send(
                  'phase.advance',
                  { phaseId: phase.phaseId, toStatus: next.to, role: 'implementer' },
                  next.label.toLowerCase(),
                )
              }
            >
              {next.label}
            </button>
          )}

          {phase.status === 'awaiting_closure' && (
            <button
              type="button"
              className="ocp-btn primary"
              disabled={action.busy || !canDelegateClose}
              title={
                canDelegateClose
                  ? `Closure authority: ${state.authority.closureAuthority}`
                  : 'No closure delegation is recorded for this project; closure is owner-only.'
              }
              onClick={() =>
                void send(
                  'phase.close',
                  {
                    phaseId: phase.phaseId,
                    role: 'advisor',
                    identity: state.authority.closureAuthority,
                  },
                  `close ${phase.phaseId}`,
                )
              }
            >
              Close as {state.authority.closureAuthority}
            </button>
          )}

          {/* SECONDARY: only offered while a phase is genuinely in flight. */}
          {phase.status !== 'not-started' && phase.status !== 'rolled_back' && (
            <button
              type="button"
              className="ocp-btn"
              disabled={action.busy}
              onClick={() => void send('phase.stop', { phaseId: phase.phaseId }, `stop ${phase.phaseId}`)}
            >
              Stop
            </button>
          )}
          {phase.status === 'rolled_back' && (
            <button
              type="button"
              className="ocp-btn"
              disabled={action.busy}
              onClick={() => void send('phase.resume', { phaseId: phase.phaseId }, `resume ${phase.phaseId}`)}
            >
              Resume
            </button>
          )}

          <button
            type="button"
            className="ocp-btn"
            disabled={action.busy}
            onClick={() => void send('refresh', {}, 'refresh governed state')}
          >
            Refresh
          </button>
        </div>
      )}

      {action.lines.length > 0 && (
        <p className={`ocp-actionmsg${action.failed ? ' crit' : ''}`} role="status" aria-live="polite">
          {action.lines.join(' ')}
        </p>
      )}

      <p className="ocp-sub">
        These actions ask the ProjectOS runtime to act. It decides — and if it refuses, you see its
        exact words. Protected actions (production, database, send, payment, provider, credential,
        installation) are not available here at all and remain {state.authority.owner}-only.
      </p>
    </div>
  );
}
