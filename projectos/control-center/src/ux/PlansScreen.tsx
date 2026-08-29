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
const CONFIRM: Record<'approve' | 'reject', { title: string; body: readonly string[]; action: string }> = {
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
}: {
  state: GovernedProjection;
  onOpenPlan: (planId: string) => void;
}) {
  const model = buildPlansModel(state);

  const [outcome, setOutcome] = useState<Outcome>(IDLE);
  /** Which row is mid-command, so only that row's controls are disabled. */
  const [busyRow, setBusyRow] = useState<string | null>(null);
  /** The question asked but not yet answered. Null means nothing is pending. */
  const [pending, setPending] = useState<{ id: string; verdict: 'approve' | 'reject' } | null>(null);
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

  async function decide(): Promise<void> {
    const asked = pending;
    if (asked === null || inFlight.current) return;
    inFlight.current = true;
    setPending(null);
    setBusyRow(asked.id);
    setOutcome({
      busy: true,
      lines: [asked.verdict === 'approve' ? 'Recording your approval…' : 'Recording your rejection…'],
      failed: false,
    });
    try {
      const result = await requestGovernedCommand(tauriBridge, 'plan.decide', {
        draftId: asked.id,
        decision: asked.verdict,
      });
      setOutcome({ busy: false, lines: result.lines, failed: !result.ok });
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
                          disabled={!a.enabled || busyRow === row.id}
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
