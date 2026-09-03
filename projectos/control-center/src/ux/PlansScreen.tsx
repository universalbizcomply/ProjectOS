/**
 * SCREEN 3 — PLANS. Every plan this project has, grouped by what the owner can do about it.
 *
 * THE DECISION IS THE FROZEN ONE. Approve and Reject dispatch `plan.decide`, the governed verb the
 * frozen core added, with the SAME shape the core's own intake panel uses: ask a second question,
 * commit exactly once, guard against a second dispatch while one is in flight, and let Escape
 * cancel. No second decision mechanism exists here and no authority is implemented in this
 * renderer — approving records a decision, it does not start anything, and `plan.activate` still
 * refuses everything it refused before.
 *
 * EVERY ACTION CARRIES ITS VERB. The buttons are not chosen here; they come from `planStateModel`,
 * which produces an action only where a governed path exists. This file cannot invent one.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { useEffect, useRef, useState } from 'react';
import { requestGovernedCommand } from '../governed/governedClient';
import { tauriBridge } from '../daemon/tauriBridge';
import type { GovernedProjection } from '../governed/types';
import {
  buildPlansModel,
  PLAN_GROUPS,
  type PlanAction,
  type PlanRow,
} from './planStateModel';

/** The second question, in the same words and the same weight as the frozen core asks it. */
type Verdict = 'approve' | 'reject' | 'approve-start';

const CONFIRM: Record<Verdict, { title: string; body: readonly string[]; action: string }> = {
  'approve-start': {
    title: 'Approve this plan and let ProjectOS start?',
    body: [
      'ProjectOS will record your approval, make this the active plan, and begin the first step.',
      'It does the ordinary technical work itself and stops to ask you before anything protected: ' +
        'nothing reaches customers, payments, credentials or the live site without a separate decision.',
      'Each of the three steps is recorded on its own, and ProjectOS stops at the first one it refuses.',
    ],
    action: 'Confirm Approve & Start',
  },
  approve: {
    title: 'Approve this plan?',
    body: ['This permanently records your decision for this exact proposal.', 'It does not start the work.'],
    action: 'Confirm Approve',
  },
  reject: {
    title: 'Reject this plan?',
    body: ['This permanently records your rejection.', 'You can create a revised proposal afterwards.'],
    action: 'Confirm Reject',
  },
};

interface Outcome {
  readonly busy: boolean;
  readonly lines: readonly string[];
  readonly failed: boolean;
}

const IDLE: Outcome = { busy: false, lines: [], failed: false };

export function PlansScreen({
  state,
  onOpenPlan,
  onRequestChange,
}: {
  state: GovernedProjection;
  onOpenPlan: (planId: string) => void;
  /**
   * Ask for a revision of the plan the owner is looking at.
   *
   * IT LIVES HERE BECAUSE THIS IS WHERE THE ANSWER APPEARS. A revision is proposed, decided and
   * started on this screen, so the request belongs beside them rather than on a home page the owner
   * would have to navigate back from. It opens the SAME objective panel `Start something new` opens
   * and dispatches the SAME `plan.draft`; nothing here edits the current plan, which stays
   * authoritative until a replacement is approved AND started.
   */
  onRequestChange: () => void;
}) {
  const model = buildPlansModel(state);

  const [outcome, setOutcome] = useState<Outcome>(IDLE);
  /** Which row is mid-command, so only that row's controls are disabled. */
  const [busyRow, setBusyRow] = useState<string | null>(null);
  /** The question asked but not yet answered. Null means nothing is pending. */
  const [pending, setPending] = useState<{ id: string; verdict: Verdict } | null>(null);
  /**
   * THE LATEST PROJECTION, readable from inside a multi-step await. `state` is a prop and a closure
   * captured at press time would never see the decision id the runtime writes a moment later.
   */
  const latest = useRef(state);
  latest.current = state;
  /**
   * WHETHER THIS SCREEN IS STILL ON SCREEN. The orchestration below spans real time and real governed
   * commands; if the owner switches tab or project mid-way the screen unmounts, and a chain that kept
   * dispatching would start a paid run nobody can see. Every step checks this first and stops. What
   * has already been recorded stands, and the Overview offers the next step from the runtime's own
   * records - nothing is lost, and nothing happens off-screen.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /**
   * ONE DISPATCH PER DELIBERATE ACT. A plan decision is committed and a second press would ask the
   * runtime to decide something already decided, so the guard is a ref rather than state: it is
   * read and set in the same turn, before React has any chance to re-render.
   */
  const inFlight = useRef(false);

  /** Escape answers nothing and cancels the question. Bound only while one is open. */
  useEffect(() => {
    if (pending === null) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPending(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);

  /**
   * Wait for the runtime's next projection to show a fact, or give up. The runtime re-emits governed
   * state after every command; this only READS that, it never asserts it. Bounded so a runtime that
   * never answers leaves a truthful "did not appear" rather than a spinner.
   */
  async function until<T>(read: (s: GovernedProjection) => T | null, ms = 20_000): Promise<T | null> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const found = read(latest.current);
      if (found !== null) return found;
      await new Promise((r) => setTimeout(r, 250));
    }
    return read(latest.current);
  }

  async function decide(): Promise<void> {
    const asked = pending;
    if (asked === null || inFlight.current) return;
    inFlight.current = true;
    setPending(null);
    setBusyRow(asked.id);
    const verdict = asked.verdict === 'reject' ? 'reject' : 'approve';
    setOutcome({
      busy: true,
      lines: [verdict === 'approve' ? 'Recording your approval…' : 'Recording your rejection…'],
      failed: false,
    });
    try {
      const decided = await requestGovernedCommand(tauriBridge, 'plan.decide', {
        draftId: asked.id,
        decision: verdict,
      });
      // ALREADY DECIDED IS NOT A FAILURE OF THIS PRESS. If the approval committed but the previous
      // press timed out before activation, the runtime refuses the second decide with DECISION_EXISTS.
      // That refusal is the record we wanted; carry on to read it back rather than stranding the owner
      // on a button that can no longer progress. Any other refusal still stops here, verbatim.
      const alreadyDecided = !decided.ok && decided.lines.some((l) => l.includes('DECISION_EXISTS'));
      if (asked.verdict !== 'approve-start' || (!decided.ok && !alreadyDecided)) {
        setOutcome({ busy: false, lines: decided.lines, failed: !decided.ok });
        return;
      }
      // ORCHESTRATION, NOT A NEW VERB. Three governed commands the owner could press one by one, in
      // the order the owner would press them, each answered by the runtime in its own words, and
      // the whole thing stopping at the first refusal. Between steps this waits for the runtime's own
      // projection to show the record the previous step wrote - never for a value this screen made up.
      const said = [...decided.lines, 'Approval recorded. Making this the active plan…'];
      setOutcome({ busy: true, lines: said, failed: false });
      if (!mounted.current) return;
      const decisionId = await until((s) => {
        const d = s.planDrafts.find((x) => x.draftId === asked.id);
        return d !== undefined && d.decisionState === 'approved' && d.decisionId !== null ? d.decisionId : null;
      });
      if (decisionId === null) {
        setOutcome({
          busy: false,
          lines: [...said, 'The approval was recorded, but ProjectOS has not yet shown it as approved. Press "Start this plan" when it does.'],
          failed: true,
        });
        return;
      }
      if (!mounted.current) return;
      const activated = await requestGovernedCommand(tauriBridge, 'plan.activate', { draftId: asked.id, decisionId });
      if (!activated.ok) {
        setOutcome({ busy: false, lines: [...said, ...activated.lines], failed: true });
        return;
      }
      const said2 = [...said, ...activated.lines, 'Plan is active. Starting the first step…'];
      setOutcome({ busy: true, lines: said2, failed: false });
      const ready = await until((s) => (s.plan.ready && s.nextStartablePhase !== null ? s.nextStartablePhase.phaseId : null));
      if (ready === null) {
        setOutcome({
          busy: false,
          lines: [...said2, 'The plan is active, but ProjectOS has not yet shown a step it can start. Press Continue on the Overview when it does.'],
          failed: true,
        });
        return;
      }
      if (!mounted.current) return;
      // The step the runtime itself says is next - a correlator for the run's events, not authority.
      const started = await requestGovernedCommand(tauriBridge, 'run.start', { phaseId: ready });
      setOutcome({
        busy: false,
        lines: [...said2, ...started.lines, ...(started.ok ? ['ProjectOS is working. It will stop and ask you if your authority is needed.'] : [])],
        failed: !started.ok,
      });
    } finally {
      setBusyRow(null);
      inFlight.current = false;
    }
  }

  async function activate(row: PlanRow): Promise<void> {
    if (row.decisionId === null || inFlight.current) return;
    inFlight.current = true;
    setBusyRow(row.id);
    setOutcome({ busy: true, lines: ['Starting this plan…'], failed: false });
    try {
      const result = await requestGovernedCommand(tauriBridge, 'plan.activate', {
        draftId: row.id,
        decisionId: row.decisionId,
      });
      setOutcome({ busy: false, lines: result.lines, failed: !result.ok });
    } finally {
      setBusyRow(null);
      inFlight.current = false;
    }
  }

  async function run(row: PlanRow, action: PlanAction): Promise<void> {
    if (action.verb === null || inFlight.current) return;
    inFlight.current = true;
    setBusyRow(row.id);
    setOutcome({ busy: true, lines: ['Asking ProjectOS…'], failed: false });
    try {
      // The ARGUMENTS COME FROM THE MODEL, which resolved them from real records. `run.resume`
      // requires a session id and the channel refuses without one, so a renderer that sent an empty
      // argument set here would have produced a button that could never work.
      const result = await requestGovernedCommand(tauriBridge, action.verb, action.args);
      setOutcome({ busy: false, lines: result.lines, failed: !result.ok });
    } finally {
      setBusyRow(null);
      inFlight.current = false;
    }
  }

  function press(row: PlanRow, action: PlanAction): void {
    if (action.id === 'open' || action.id === 'evidence') return onOpenPlan(row.id);
    if (action.id === 'approve-start') return setPending({ id: row.id, verdict: 'approve-start' });
    if (action.id === 'approve') return setPending({ id: row.id, verdict: 'approve' });
    if (action.id === 'reject') return setPending({ id: row.id, verdict: 'reject' });
    if (action.id === 'activate') return void activate(row);
    return void run(row, action);
  }

  if (model.empty) {
    return (
      <div className="os-plate">
        <h2 className="os-h2">No plans yet</h2>
        <p className="os-set-sub">
          Tell ProjectOS what you want to achieve and it will propose one. Nothing starts until you
          approve it.
        </p>
      </div>
    );
  }

  return (
    <div className="os-stack">
      {/*
        THE ONE PLACE A REVISION IS ASKED FOR, BESIDE WHERE THE ANSWER APPEARS.

        It dispatches nothing itself. It opens the same objective panel `Start something new` opens,
        which sends the same `plan.draft` — so there is one drafting path, not a separate revision
        engine. The sentence under it is the promise the owner is owed: asking for a change does not
        change anything yet.
      */}
      <section className="ux-screenhead">
        <button type="button" className="os-sec" onClick={onRequestChange}>
          Request a change
        </button>
        <p className="os-composernote">
          Your current plan stays active. A change is proposed first, and you approve and start it
          yourself.
        </p>
      </section>
      {PLAN_GROUPS.map((group) => {
        const rows = model.rows.filter((r) => r.group === group.id);
        if (rows.length === 0) return null;
        return (
          <section key={group.id} aria-labelledby={`ux-plangroup-${group.id}`}>
            <h2 className="os-h2 ux-grouphead" id={`ux-plangroup-${group.id}`}>{group.label}</h2>
            <ul className="ux-planlist">
              {rows.map((row) => (
                <li key={row.id} className="ux-planrow">
                  <div className="ux-planhead">
                    <span className="ux-planname">{row.name}</span>
                    <span className="ux-planstate">{row.state}</span>
                  </div>

                  {row.stepLabel !== null && <p className="ux-planline">{row.stepLabel}</p>}

                  {/* A count, never a percentage the engine cannot defend. */}
                  {row.progress !== null && (
                    <p className="ux-planline">
                      {row.progress.done} of {row.progress.total} steps accepted
                    </p>
                  )}

                  {row.origin !== undefined && (
                    <p className="ux-planline">
                      {row.origin === 'authored'
                        ? 'Written from your objective.'
                        : 'Built from what the repository already describes.'}
                    </p>
                  )}

                  {/* What this proposal is FOR — without it two proposals read as the same row. */}
                  {row.summary !== undefined && <p className="ux-planline ux-plansummary">{row.summary}</p>}
                  {row.steps !== undefined && (
                    <p className="ux-planline">
                      {row.steps.length} {row.steps.length === 1 ? 'step' : 'steps'}
                      {row.ownerDecisions !== undefined && row.ownerDecisions.length > 0
                        ? ` \u00b7 ${row.ownerDecisions.length} ${row.ownerDecisions.length === 1 ? 'decision' : 'decisions'} it will ask you for`
                        : ''}
                    </p>
                  )}

                  {row.reasons.length > 0 && (
                    <ul className="ux-planreasons">
                      {row.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}

                  {pending !== null && pending.id === row.id ? (
                    <div className="ocp-confirm" role="group" aria-label={CONFIRM[pending.verdict].title}>
                      <p className="ocp-confirm-title">{CONFIRM[pending.verdict].title}</p>
                      {CONFIRM[pending.verdict].body.map((line) => (
                        <p className="os-set-sub" key={line}>{line}</p>
                      ))}
                      <div className="ux-planactions">
                        <button type="button" className="os-sec" onClick={() => setPending(null)}>
                          Cancel
                        </button>
                        <button type="button" className="os-pri" onClick={() => void decide()}>
                          {CONFIRM[pending.verdict].action}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="ux-planactions">
                      {row.actions.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className={a.id === 'open' ? 'os-sec' : 'os-pri'}
                          disabled={!a.enabled || (busyRow !== null && a.id !== 'open')}
                          title={a.disabledReason ?? undefined}
                          onClick={() => press(row, a)}
                        >
                          {busyRow === row.id && outcome.busy && a.id !== 'open' ? 'Working…' : a.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {row.actions.some((a) => !a.enabled) && (
                    <p className="ux-planline" role="status">
                      {row.actions.find((a) => !a.enabled)?.disabledReason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

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
