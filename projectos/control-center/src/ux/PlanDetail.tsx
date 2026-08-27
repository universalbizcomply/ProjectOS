/**
 * SCREEN 4 — THE PLAN AS A LIVE OBJECT, not a report about one.
 *
 * WHAT A STEP IS. A step IS a phase: the real `project → plan record → phases → run sessions`
 * relationship, with no second execution model laid over it. Completed, current and future come
 * from `planStateOf`, the mapping the accepted branch already uses — reused rather than rewritten,
 * so the plan list, the workspace and this screen cannot drift apart about the same phase.
 *
 * WHAT COUNTS AS EVIDENCE. Only what the projection actually carries: the phase's own recorded
 * transitions and the sessions run against it. There is no separate evidence artefact in the
 * contract, so none is drawn — the disclosure shows the record, and says so plainly when the record
 * is empty. Nothing here fabricates progress, execution, a blocker or a decision.
 *
 * ACTIONS COME FROM THE MODEL. `planStateModel` produces an action only where a governed verb
 * exists, complete with the arguments that verb requires. This file dispatches what it is given and
 * can invent nothing.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { useMemo, useRef, useState } from 'react';
import { requestGovernedCommand } from '../governed/governedClient';
import { tauriBridge } from '../daemon/tauriBridge';
import type { GovernedPhaseView, GovernedProjection } from '../governed/types';
import { planStateOf, planNoteOf, planStateInk, relativeTime, type PlanStateWord } from '../owner/workspaceModel';
import { buildPlansModel, type PlanAction } from './planStateModel';

/** The marker beside a step. Never colour alone — the word is always printed with it. */
function marker(word: PlanStateWord): string {
  if (word === 'Done') return '✓';
  if (word === 'Now') return '▶';
  if (word === 'Blocked') return '!';
  return '○';
}

function Step({
  phase,
  index,
  activePhaseId,
  sessions,
  now,
}: {
  phase: GovernedPhaseView;
  index: number;
  activePhaseId: string | null;
  sessions: GovernedProjection['sessions'];
  now: number;
}) {
  const word = planStateOf(phase, activePhaseId);
  const note = planNoteOf(phase);
  const mine = sessions.filter((s) => s.phaseId === phase.phaseId);
  const latest = mine.reduce<(typeof mine)[number] | null>(
    (best, s) => (best === null || s.startedAt > best.startedAt ? s : best),
    null,
  );
  const isCurrent = word === 'Now';

  return (
    <li className="ux-step" data-current={isCurrent ? '1' : '0'}>
      <div className="ux-stephead">
        <span className="ux-stepmark" aria-hidden="true">{marker(word)}</span>
        <span className="ux-stepnum">{index + 1}</span>
        <span className="ux-stepname">{phase.description === '' ? phase.phaseId : phase.description}</span>
        <span className="ux-stepstate" style={{ color: planStateInk(word) }}>{word}</span>
      </div>

      {note !== '' && <p className="ux-stepnote">{note}</p>}

      {/* WHAT IS IN THE WAY, from the phase's own record and nowhere else. */}
      {phase.unmetDependencies.length > 0 && (
        <p className="ux-stepnote">
          Waiting for {phase.unmetDependencies.join(', ')} to finish first.
        </p>
      )}

      {phase.requiredOwnerGates.length > 0 && (
        <p className="ux-stepnote">This step asks you before it does anything protected.</p>
      )}

      {/* THE LATEST MEANINGFUL THING, only where a session records one. */}
      {latest !== null && (
        <p className="ux-stepnote">
          {latest.state === 'exited'
            ? latest.exitCode === 0
              ? `Last run finished ${relativeTime(latest.startedAt, now)}.`
              : `Last run stopped without finishing, ${relativeTime(latest.startedAt, now)}.`
            : `Running since ${relativeTime(latest.startedAt, now)}.`}
        </p>
      )}

      {/*
        EVIDENCE, BEHIND A DISCLOSURE, and only what is really recorded. The projection carries a
        phase's transitions and its sessions; there is no other evidence artefact in the contract,
        so nothing else is offered and an empty record says it is empty.
      */}
      <details className="ux-evidence">
        <summary>Evidence</summary>
        {phase.history.length === 0 && mine.length === 0 ? (
          <p className="os-set-sub">Nothing has been recorded against this step yet.</p>
        ) : (
          <>
            {phase.history.length > 0 && (
              <ul className="ux-evidencelist">
                {phase.history.map((h, i) => (
                  <li key={`${h.at}-${i}`}>
                    {h.from} → {h.to} · {h.by} · {h.at}
                    {h.note === undefined || h.note === '' ? '' : ` · ${h.note}`}
                  </li>
                ))}
              </ul>
            )}
            {mine.length > 0 && (
              <ul className="ux-evidencelist">
                {mine.map((s) => (
                  <li key={s.sessionId}>
                    session {s.sessionId} · {s.kind} · {s.state}
                    {s.exitCode === null ? '' : ` · exit ${s.exitCode}`}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </details>
    </li>
  );
}

export function PlanDetail({
  state,
  now,
  onBack,
  planId,
}: {
  state: GovernedProjection;
  now: number;
  onBack: () => void;
  /**
   * WHICH plan was opened. Null means the active one.
   *
   * Without it this screen always rendered the active plan, whichever row the owner clicked — so a
   * proposal's own "Open" led to somebody else's plan, or to "there is no active plan" while a plan
   * was plainly on the screen.
   */
  planId?: string | null;
}) {
  const model = useMemo(() => buildPlansModel(state), [state]);
  const asked = planId === undefined || planId === null ? null : model.rows.find((r) => r.id === planId) ?? null;
  const active = asked ?? model.rows.find((r) => r.kind === 'active') ?? null;

  const [outcome, setOutcome] = useState<{ busy: boolean; lines: readonly string[]; failed: boolean }>({
    busy: false,
    lines: [],
    failed: false,
  });
  const inFlight = useRef(false);

  async function press(action: PlanAction): Promise<void> {
    if (action.verb === null || inFlight.current) return;
    inFlight.current = true;
    setOutcome({ busy: true, lines: ['Asking ProjectOS…'], failed: false });
    try {
      const result = await requestGovernedCommand(tauriBridge, action.verb, action.args);
      setOutcome({ busy: false, lines: result.lines, failed: !result.ok });
    } finally {
      inFlight.current = false;
    }
  }

  if (active === null) {
    return (
      <div className="os-plate">
        <h2 className="os-h2">There is no active plan</h2>
        <p className="os-set-sub">
          A plan becomes active once you approve a proposal and start it.
        </p>
        <button type="button" className="os-sec" onClick={onBack}>Back to plans</button>
      </div>
    );
  }

  const activePhaseId = state.activePhase?.phaseId ?? null;

  return (
    <div className="os-stack">
      <div className="os-advanced-back">
        <button type="button" className="os-ghost" onClick={onBack} style={{ fontSize: '13.5px' }}>
          ← Back to plans
        </button>
      </div>

      <section className="os-plate">
        <div className="ux-planhead">
          <h2 className="os-h2" style={{ margin: 0 }}>{active.name}</h2>
          <span className="ux-planstate">{active.state}</span>
        </div>

        {/* The objective, in the runtime's own words. Never restated or embellished here. */}
        <p className="os-set-sub">{state.nextSafeAction}</p>

        {active.stepLabel !== null && <p className="ux-planline">{active.stepLabel}</p>}
        {active.progress !== null && (
          <p className="ux-planline">
            {active.progress.done} of {active.progress.total} steps accepted
          </p>
        )}

        {active.needsOwnerDecision && (
          <p className="ux-planline" role="status">This plan is waiting on a decision from you.</p>
        )}

        {active.reasons.length > 0 && (
          <ul className="ux-planreasons">
            {active.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}

        <div className="ux-planactions">
          {active.actions
            .filter((a) => a.verb !== null)
            .map((a) => (
              <button
                key={a.id}
                type="button"
                className="os-pri"
                disabled={!a.enabled || outcome.busy}
                title={a.disabledReason ?? undefined}
                onClick={() => void press(a)}
              >
                {outcome.busy ? 'Working…' : a.label}
              </button>
            ))}
        </div>

        {active.actions.some((a) => !a.enabled) && (
          <p className="ux-planline" role="status">
            {active.actions.find((a) => !a.enabled)?.disabledReason}
          </p>
        )}
      </section>

      <section aria-labelledby="ux-steps-title">
        <h2 className="os-h2 ux-grouphead" id="ux-steps-title">Steps</h2>
        {/*
          A PROPOSAL HAS NO STEPS OF ITS OWN. Its phases do not exist until it is approved and
          activated, so showing the ACTIVE plan's steps underneath a proposal would attribute one
          plan's work to another.
        */}
        {active.kind === 'draft' ? (
          <p className="os-empty">
            This is a proposal. Its steps are created when you approve it and start it.
          </p>
        ) : state.phases.length === 0 ? (
          <p className="os-empty">This plan has no steps recorded.</p>
        ) : (
          <ol className="ux-steplist">
            {state.phases.map((p, i) => (
              <Step
                key={p.phaseId}
                phase={p}
                index={i}
                activePhaseId={activePhaseId}
                sessions={state.sessions}
                now={now}
              />
            ))}
          </ol>
        )}
      </section>

      {outcome.lines.length > 0 && (
        <div className="os-plate" role={outcome.failed ? 'alert' : 'status'}>
          {outcome.lines.map((line, i) => (
            <p className="os-set-sub" key={`${i}-${line}`}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
