/**
 * SCREEN 5 — THE UNIVERSAL CONTROL CENTER. One place the owner tells ProjectOS what they want.
 *
 * IT ABSORBS, RATHER THAN JOINS. The product had three ways to begin work — a composer pinned under
 * the workspace, a standalone "Start something new" destination, and the objective panel inside
 * Owner Control. This is the one surface, and the others stop being destinations. The mental model
 * is: Projects choose what I work on, Plans manage what is planned, Control Center tells ProjectOS
 * what I want, Activity shows what happened, Health shows whether ProjectOS itself is well.
 *
 * ITS INPUT RESOLVES TO A VERB OR TO A REFUSAL. See `controlCenterModel.ts`: every utterance
 * becomes one of the sixteen governed verbs, a piece of navigation, an answer read from state, or a
 * refusal that says what would have to change. Nothing here can invent a capability, and the two
 * consequential paths — a plan decision and starting an objective — ask a second question first.
 *
 * VOICE AND UPLOAD ARE DRAWN AND DISABLED. The accepted architecture gives them a position; the
 * product has no governed seam for either. They are shown as unavailable, with the reason, because
 * a control that silently does nothing is worse than one that says it cannot.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import { useEffect, useRef, useState } from 'react';
import { requestGovernedCommand } from '../governed/governedClient';
import { tauriBridge } from '../daemon/tauriBridge';
import type { GovernedProjection } from '../governed/types';
import type { GovernedVerb, GovernedCommandArgs } from '../governed/governedCommands';
import { buildPlansModel } from './planStateModel';
import { resolveIntent } from './controlCenterModel';
import { ActivityFeed } from './ProjectHome';
import { VOICE_UNAVAILABLE } from '../owner/speech';
import { OperatorAside } from '../owner/Hologram';

export interface ControlCenterEntry {
  readonly id: string;
  /** What the owner typed, or what ProjectOS answered. */
  readonly who: 'owner' | 'projectos';
  readonly lines: readonly string[];
  readonly failed: boolean;
}

export function ControlCenter({
  state,
  now,
  onNavigate,
  onStartObjective,
  objectiveOpen,
  objectivePanel,
  entries,
  setEntries,
}: {
  state: GovernedProjection | null;
  now: number;
  onNavigate: (to: 'plans' | 'activity' | 'projects' | 'health') => void;
  /**
   * Opening the objective panel — IN PLACE, not somewhere else.
   *
   * "Start something new" used to be its own destination, which made two places to begin work. The
   * journey lives here now: the same intake component is rendered below the composer, so the owner
   * never leaves the surface they are commanding from.
   */
  onStartObjective: () => void;
  objectiveOpen: boolean;
  /** The intake component itself, supplied by the shell so this file owns no drafting logic. */
  objectivePanel: React.ReactNode;
  /**
   * THE TRANSCRIPT LIVES ABOVE THIS COMPONENT, and that is the point.
   *
   * What the owner asked and what ProjectOS answered must survive a heartbeat lapse, a transient
   * disconnect and a remount of this screen. Holding it in local state would lose all of it the
   * moment the projection went null and the shell re-rendered — which is exactly the failure the
   * frozen core fixed for authored results. The shell owns it; this only appends.
   */
  entries: readonly ControlCenterEntry[];
  /**
   * A FUNCTIONAL UPDATE, and it has to be. One submit appends twice — what the owner said, then
   * what ProjectOS answered — and a setter that took a finished array would compute the second from
   * the same stale prop as the first, silently discarding the owner's own line.
   */
  setEntries: (update: (prev: readonly ControlCenterEntry[]) => readonly ControlCenterEntry[]) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  /** The consequential utterance waiting for a second answer. Null means nothing is pending. */
  const [pending, setPending] = useState<{ verb: GovernedVerb; args: GovernedCommandArgs; say: string; question: string } | null>(null);
  const inFlight = useRef(false);
  /*
   * SEEDED FROM WHAT IS ALREADY THERE. The transcript outlives this component by design, but a
   * plain counter starts again at zero on every remount — so leaving and returning produced a
   * second entry keyed `e1` beside the first, a real React key collision.
   */
  const seq = useRef(entries.length);

  useEffect(() => {
    if (pending === null) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPending(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);

  const append = (who: 'owner' | 'projectos', lines: readonly string[], failed = false): void => {
    seq.current += 1;
    const id = `e${seq.current}`;
    setEntries((prev) => [...prev, { id, who, lines, failed }]);
  };

  async function dispatch(verb: GovernedVerb, args: GovernedCommandArgs, say: string): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await requestGovernedCommand(tauriBridge, verb, args);
      seq.current += 1;
      const n = seq.current;
      setEntries((prev) => [
        ...prev,
        { id: `s${n}`, who: 'projectos', lines: [say], failed: false },
        { id: `r${n}`, who: 'projectos', lines: result.lines, failed: !result.ok },
      ]);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  function submit(): void {
    const said = text.trim();
    if (said === '' || busy || pending !== null) return;
    setText('');
    append('owner', [said]);

    const intent = resolveIntent(said, state);
    if (intent.kind === 'answer') return append('projectos', intent.lines);
    if (intent.kind === 'refusal') return append('projectos', intent.lines, true);
    if (intent.kind === 'navigate') {
      append('projectos', [intent.say]);
      return onNavigate(intent.to);
    }
    if (intent.kind === 'objective') {
      append('projectos', [intent.say]);
      return onStartObjective();
    }
    /*
     * A SENTENCE IS NOT A PRESS. Every governed command the resolver can produce is consequential —
     * a decision that commits, a run that spends, a stop that force-kills — so each carries the
     * question it must ask, and nothing is dispatched until it is answered.
     */
    return setPending({
      verb: intent.verb,
      args: intent.args,
      say: intent.say,
      question: intent.confirm ?? 'Go ahead?',
    });
  }

  const model = state === null ? null : buildPlansModel(state);
  const active = model?.rows.find((r) => r.kind === 'active') ?? null;
  const waiting = state?.pendingApprovals.length ?? 0;

  return (
    <section className="os-stack" aria-labelledby="ux-cc-title">
      {/*
        THE OPERATOR SITS BESIDE THE CONTEXT, NOT OVER IT.
        
        The accepted JARVIS identity lived on the Command Centre dashboard, which was removed for
        being a second command surface. The projection belongs here instead — this is the one place
        the owner and ProjectOS talk. It is presentation and nothing else: no route, no card, no
        workflow, no authority, and every layer inside it is `aria-hidden` apart from the head's alt
        text. `.os-operator` is `display: none` outside Command mode, so Standard is untouched by
        this without a single line of mode logic.
        
        It is rendered only when there IS a projection: the aside prints "LINK STABLE", and printing
        that over a runtime that is not answering would be the one kind of decoration this product
        does not allow.
      */}
      <div className="ux-cchead">
        <div className="ux-ccheadmain">
          <h1 className="os-h1" id="ux-cc-title">Control Center</h1>

      {/* CONTEXT, NOT A DASHBOARD. Four facts on one line; the command surface stays primary. */}
      <p className="ux-context">
        {state === null ? (
          'No project is reporting yet'
        ) : (
          <>
            <span>{state.projectName}</span>
            {active !== null && <span> · {active.name}</span>}
            {active?.stepLabel !== null && active !== null && <span> · {active.stepLabel}</span>}
            {active !== null && <span> · {active.state}</span>}
            {waiting > 0 && <span className="ux-contextneeds"> · {waiting} waiting for you</span>}
          </>
        )}
      </p>
        </div>

        {state !== null && (
          <OperatorAside
            speaking={false}
            label={active === null ? 'standing by' : active.state.toLowerCase()}
            readout={active?.stepLabel ?? state.projectName}
          />
        )}
      </div>

      <div className="ux-transcript" role="log" aria-label="Conversation">
        {entries.length === 0 ? (
          <div className="os-plate">
            <p className="os-set-sub">Tell ProjectOS what you want. For example:</p>
            <ul className="ux-planreasons">
              <li>Continue this plan</li>
              <li>Why is this blocked?</li>
              <li>Show me what happened</li>
              <li>Start something new</li>
            </ul>
          </div>
        ) : (
          entries.map((e) => (
            <div className={`ux-turn ux-turn-${e.who}`} key={e.id} role={e.failed ? 'alert' : undefined}>
              {e.lines.map((l, i) => (
                <p key={`${e.id}-${i}`}>{l}</p>
              ))}
            </div>
          ))
        )}
      </div>

      {pending !== null && (
        <div className="ocp-confirm" role="group" aria-label="Confirm">
          <p className="ocp-confirm-title">{pending.question}</p>
          <div className="ux-planactions">
            <button type="button" className="os-sec" onClick={() => setPending(null)}>Cancel</button>
            <button
              type="button"
              className="os-pri"
              onClick={() => {
                const p = pending;
                setPending(null);
                void dispatch(p.verb, p.args, p.say);
              }}
            >
              Yes, go ahead
            </button>
          </div>
        </div>
      )}

      {objectiveOpen && <div className="ux-objective">{objectivePanel}</div>}

      <div className="ux-composer">
        <label className="os-vh" htmlFor="ux-cc-input">Tell ProjectOS what you want</label>
        <input
          id="ux-cc-input"
          className="ux-composerinput"
          value={text}
          placeholder="Type a message…"
          disabled={busy || pending !== null}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        {/*
          DRAWN AND DISABLED, WITH THE REASON. No governed verb carries a file, and speech is not
          available in this shell. The position is the accepted one; the capability is stated as
          absent rather than mimed.
        */}
        <button type="button" className="os-iconbtn" disabled title="ProjectOS cannot take files yet." aria-label="Attach a file — not available yet">
          📎
        </button>
        <button type="button" className="os-iconbtn" disabled title={VOICE_UNAVAILABLE} aria-label="Talk to ProjectOS — not available yet">
          🎙
        </button>
        <button
          type="button"
          className="os-pri"
          disabled={busy || pending !== null || text.trim() === ''}
          onClick={submit}
        >
          {busy ? 'Working…' : 'Send'}
        </button>
      </div>

      {state !== null && (
        <section aria-labelledby="ux-cc-feed">
          <h2 className="os-h2 ux-grouphead" id="ux-cc-feed">What has been happening</h2>
          {/* THE SAME FEED COMPONENT the project's Activity tab renders, context-filtered. */}
          <ActivityFeed state={state} now={now} limit={5} />
        </section>
      )}
    </section>
  );
}
