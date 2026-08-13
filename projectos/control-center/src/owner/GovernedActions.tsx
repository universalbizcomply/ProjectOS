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
import { requestGovernedCommand } from '../governed/governedClient';
import type { GovernedCommandArgs, GovernedVerb } from '../governed/governedCommands';
import type { GovernedProjection, GovernedPhaseView } from '../governed/types';

/**
 * The next lifecycle step for a phase, in plain language. Derived, never authored per-button.
 *
 * EVERY ENTRY HERE RECORDS A STAGE CHANGE AND NOTHING ELSE. Each dispatches `phase.advance` to the
 * next status; not one of them executes, collects or sends anything.
 *
 * The whole map used to be written in the imperative — "Run validation", "Collect evidence", "Send
 * for review" — and every one of those was a claim about work the button does not do. "Run
 * validation" was the one caught live: the phase entered the `validating` stage, no validator ran,
 * and no route from this surface to one exists (there is no validation verb in GOVERNED_VERBS at
 * all; `projectos validate` is a separate CLI command). Fixing that label alone would have left five
 * siblings making the same promise, so the map is stated uniformly as what it is: moving a recorded
 * stage. `STAGE_ONLY_NOTE` says the rest, once, wherever any of these is shown.
 *
 * The destinations are unchanged. This is a correction to what the owner is told, not to what the
 * runtime is asked.
 */
const NEXT_STEP: Readonly<Record<string, { readonly to: string; readonly label: string }>> = {
  draft: { to: 'prompted', label: 'Record prompt ready' },
  prompted: { to: 'implementing', label: 'Move to implementation' },
  implementing: { to: 'validating', label: 'Move to validation' },
  validating: { to: 'evidence', label: 'Move to evidence' },
  evidence: { to: 'awaiting_review', label: 'Move to review' },
  awaiting_review: { to: 'awaiting_closure', label: 'Move to closure review' },
};

/** Shown beside whichever stage-transition button is offered, and referenced as its description. */
const STAGE_ONLY_NOTE =
  'This only changes the recorded phase stage. It does not perform the work or send anything.';
const STAGE_ONLY_NOTE_ID = 'ocp-stage-only-note';

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
    // Wait for what the RUNTIME decided, not merely for the request to be dispatched. Reporting
    // dispatch as though it were the outcome is how a G4 refusal used to reach the owner as
    // "Sent to the runtime" — the action refused, and nothing said so.
    const outcome = await requestGovernedCommand(tauriBridge, verb, args);
    // The runtime's own words, verbatim, whether it agreed or refused. No optimistic update: the
    // sidecar re-emits governed state after every command, so the state below repaints from re-read
    // durable truth on its own.
    setAction({ busy: false, lines: outcome.lines, failed: !outcome.ok });
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
              // The note is the button's accessible description, so a screen-reader user is told what
              // the action does NOT do at the same moment a sighted user reads it — not afterwards.
              aria-describedby={STAGE_ONLY_NOTE_ID}
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
                // The request carries NO role and NO identity. The runtime resolves the delegate
                // from the approved plan, so this surface cannot nominate the authority it is asking
                // to act. The name shown on the button is display only.
                void send('phase.close', { phaseId: phase.phaseId }, `close ${phase.phaseId}`)
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

      {/* Adjacent to the stage-transition action and referenced by it via aria-describedby. Rendered
          whenever any mapped transition is offered, because every one of them is stage-only — a note
          attached to a single label would imply the others do more. */}
      {state.plan.ready && phase !== null && next !== undefined && (
        <p className="ocp-note" id={STAGE_ONLY_NOTE_ID}>
          {STAGE_ONLY_NOTE}
        </p>
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
