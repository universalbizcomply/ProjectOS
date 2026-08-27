/**
 * The Plan tab — README §Screens 6.
 *
 * Numbered rows in the approved plan's own order, each carrying one of the six approved state
 * words: Done, Now, Needs your yes, Next, Paused, Blocked. The word is derived from the phase
 * record; no row states anything the record does not.
 *
 * ABOUT THE PRIMARY ACTION IN THIS HEADER. The design puts **Approve the plan** here while the plan
 * is unapproved. In this engine approving a plan is an authority-creating act that a web page must
 * never perform: `plan.draft` proposes, a COMMITTED decision recorded outside the renderer approves,
 * and `plan.activate` only materialises what was already approved. So the button keeps the designed
 * slot and treatment, and says what it truthfully does — it offers to ACTIVATE, and only when an
 * approved, unconsumed decision actually exists to activate. A control labelled "Approve" here would
 * be exactly the untruth `ObjectiveIntake` exists to prevent. Raised to the gatekeeper as the one
 * design deviation in this workstream.
 */
import { useState } from 'react';
import { requestGovernedCommand } from '../governed/governedClient';
import { tauriBridge } from '../daemon/tauriBridge';
import type { GovernedProjection } from '../governed/types';
import { planNoteOf, planStateInk, planStateOf } from './workspaceModel';

function noteFor(state: GovernedProjection): string {
  if (state.phases.length === 0) {
    return 'No plan yet. Say what you want below and you will see one before anything runs.';
  }
  return state.plan.ready
    ? 'You approved this plan. Steps marked as needing your yes will stop and wait.'
    : 'Read it over. Nothing runs until you approve it.';
}

export function PlanTab({ state, onStartNew }: { state: GovernedProjection; onStartNew: () => void }) {
  const [outcome, setOutcome] = useState<{ lines: readonly string[]; failed: boolean; busy: boolean }>({
    lines: [],
    failed: false,
    busy: false,
  });

  const activePhaseId = state.activePhase?.phaseId ?? null;
  // The one draft that a committed decision has already approved and that has not been used.
  const activatable = state.planDrafts.find((d) => d.decisionState === 'approved' && d.decisionId !== null) ?? null;
  const pending = !state.plan.ready && activatable !== null;

  async function activate(): Promise<void> {
    if (activatable === null || activatable.decisionId === null) return;
    setOutcome({ lines: ['Asking ProjectOS to activate the approved plan…'], failed: false, busy: true });
    const result = await requestGovernedCommand(tauriBridge, 'plan.activate', {
      draftId: activatable.draftId,
      decisionId: activatable.decisionId,
    });
    // The runtime's own words, verbatim, whether it agreed or refused.
    setOutcome({ lines: result.lines, failed: !result.ok, busy: false });
  }

  return (
    <section>
      <div className="os-planhead">
        <div>
          <h2 className="os-h2">The plan</h2>
          <p className="os-plannote">{noteFor(state)}</p>
        </div>
        {pending && (
          <button type="button" className="os-pri" style={{ height: 42, padding: '0 20px', fontSize: '14.5px', borderRadius: 8 }} disabled={outcome.busy} onClick={() => void activate()}>
            {outcome.busy ? 'Working…' : 'Activate the approved plan'}
          </button>
        )}
      </div>

      {state.phases.length === 0 && (
        <div className="os-planempty">
          <p>No plan yet. Say what you want and ProjectOS writes one before it touches anything.</p>
          <button type="button" className="os-pri" onClick={onStartNew}>Say what you want</button>
        </div>
      )}

      <ol className="os-planlist">
        {state.phases.map((phase, index) => {
          const word = planStateOf(phase, activePhaseId);
          const numBg = word === 'Now' ? 'var(--acc-soft)' : word === 'Needs your yes' ? 'var(--warn-soft)' : 'var(--card-2)';
          const numInk = word === 'Now' ? 'var(--acc)' : word === 'Needs your yes' ? 'var(--warn)' : 'var(--faint)';
          return (
            <li className="os-planrow" key={phase.phaseId}>
              <span className="os-bubblenum" style={{ background: numBg, color: numInk }}>{index + 1}</span>
              <span className="os-planbody">
                {/* The phase DESCRIPTION. Its id is an identifier and lives under Advanced. */}
                <span className="os-plantitle" style={{ color: word === 'Done' ? 'var(--dim)' : 'var(--ink)' }}>
                  {phase.description || 'Step'}
                </span>
                <span className="os-plannote2">{planNoteOf(phase)}</span>
              </span>
              <span className="os-planstate" style={{ color: planStateInk(word) }}>{word}</span>
            </li>
          );
        })}
      </ol>

      {outcome.lines.length > 0 && (
        <p className={`os-refusal${outcome.failed ? ' failed' : ''}`} role="status" aria-live="polite">
          {outcome.lines.join('\n')}
        </p>
      )}
    </section>
  );
}
