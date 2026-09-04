/**
 * THE EXECUTION WORKSPACE — one screen an owner can run a project from.
 *
 * WHAT IT REPLACES. Answering "how is this going?" meant Overview for status, Plans for the steps,
 * Activity for what happened, Health for spend and Advanced for anything technical — five screens to
 * assemble one answer. This shows the whole programme at once: the plan and where it has got to, what
 * the current step must satisfy, what is running, what has finished, and the one decision — if any —
 * that is actually the owner's.
 *
 * IT IS A VIEW. Every value comes from `buildExecutionView`, which derives from records the runtime
 * already writes. This file adds no lifecycle, no cached state and no second source of truth; where
 * a fact is not in the records, it says UNKNOWN rather than filling the gap. The only things it can
 * cause are the governed verbs behind Approve, Send back and Direction, each of which was already
 * reachable and none of which is widened by being reachable from here.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW. Decision ids, evidence paths, phase-state internals and raw
 * logs are behind Details. The default surface is what an owner needs to decide; the rest is one
 * click away and never in the way.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GovernedProjection } from '../governed/types';
import type { GovernedRunState } from '../daemon/types';
import { buildExecutionView, type StepView, type Requirement, type StepState } from './executionModel';
import { resolveIntent, type Intent } from './controlCenterModel';
import { requestGovernedCommand } from '../governed/governedClient';
import { tauriBridge } from '../daemon/tauriBridge';
import { OwnerActionInbox } from '../owner/OwnerActionInbox';

/** How long the live feed keeps on screen without opening Details. */
const FEED_LINES = 8;

function clean(line: string): string {
  const kept: string[] = [];
  for (const ch of line) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) continue;
    if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0x200e || c === 0x200f || c === 0x061c) continue;
    kept.push(ch);
  }
  return kept.length > 300 ? `${kept.slice(0, 300).join('')}…` : kept.join('');
}

/**
 * The loop prints for engineers; this says the same thing for an owner.
 *
 * A line it does not recognise is shown as it was written rather than dropped — hiding output because
 * it did not match a pattern is how a surface stops being a record of what happened.
 */
export function friendlyLine(raw: string): { readonly tag: string; readonly text: string } {
  const line = clean(raw).trim();
  const lower = line.toLowerCase();
  if (lower.startsWith('pass ')) return { tag: 'ok', text: `${line.slice(5)} — passed` };
  if (lower.startsWith('fail ')) return { tag: 'fail', text: `${line.slice(5)} — failed` };
  if (lower.includes('gatekeeper request')) return { tag: 'check', text: 'Asking the independent reviewer' };
  if (lower.includes('attempt') && lower.includes('started')) return { tag: 'agent', text: line };
  if (lower.startsWith('worker:')) return { tag: 'agent', text: line };
  if (lower.startsWith('stopped') || lower.includes('awaiting') || lower.includes('approval')) {
    return { tag: 'gate', text: line };
  }
  if (lower.startsWith('starting') || lower.startsWith('brief') || lower.startsWith('invocation')) {
    return { tag: 'agent', text: line };
  }
  return { tag: 'info', text: line };
}

function elapsed(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

const REQ_MARK: Record<Requirement['state'], string> = { MET: '✓', OPEN: '○', FAILED: '!', UNKNOWN: '?' };

function StateChip({ state }: { state: StepState }) {
  return <span className={`xw-chip xw-chip-${state.toLowerCase()}`}>{state}</span>;
}

function StepRow({ step, expanded, onToggle }: { step: StepView; expanded: boolean; onToggle: () => void }) {
  return (
    <li className={`xw-step${step.isCurrent ? ' xw-step-current' : ''}`}>
      <button
        type="button"
        className="xw-stephead"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`Step ${step.number}, ${step.title}, ${step.state}`}
      >
        <span className="xw-stepnum">{String(step.number).padStart(2, '0')}</span>
        <span className="xw-steptext">
          <span className="xw-steptitle">{step.title}</span>
          <span className="xw-stepmeta">
            {step.performedBy}
            {step.taskTotal > 0 ? ` · ${step.taskDone}/${step.taskTotal} checks` : ''}
            {step.blockedReason === null ? '' : ` · ${step.blockedReason}`}
          </span>
        </span>
        <span className="xw-stepstate">
          <StateChip state={step.state} />
          <span className="xw-steptrack" aria-hidden="true">
            <span className="xw-stepfill" style={{ width: `${step.percent}%` }} />
          </span>
        </span>
      </button>
      {expanded && step.findings.length > 0 && (
        <ul className="xw-findings">
          {step.findings.map((f) => (
            <li key={f.id} className="xw-finding">
              <span className="xw-findingsev">{f.severity}</span>
              <span className="xw-findingtext">{f.summary}</span>
            </li>
          ))}
        </ul>
      )}
      {expanded && step.requirements.length > 0 && (
        <ul className="xw-tasks">
          {step.requirements.map((r) => (
            <li key={r.id} className={`xw-task xw-task-${r.state.toLowerCase()}`}>
              <span className="xw-taskmark" aria-hidden="true">{REQ_MARK[r.state]}</span>
              <span className="xw-tasklabel">{r.label}</span>
              <span className="xw-tasktag">{r.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ExecutionWorkspace({
  state,
  liveRun,
  now,
  onOpenEvidence,
  onNavigate,
  onStartObjective,
}: {
  readonly state: GovernedProjection;
  readonly liveRun: GovernedRunState | null;
  readonly now: number;
  /** Where the technical detail lives. This screen never becomes that. */
  readonly onOpenEvidence: () => void;
  /** Direction can ask to go somewhere; without these it could only CLAIM to have gone. */
  readonly onNavigate: (to: 'plans' | 'activity' | 'projects' | 'health') => void;
  readonly onStartObjective: () => void;
}) {
  const view = useMemo(
    () => buildExecutionView(state, liveRun === null ? null : { active: liveRun.active, phaseId: liveRun.phaseId, startedAt: liveRun.startedAt, lines: liveRun.lines.map((l) => l.line) }, now),
    [state, liveRun, now],
  );
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [rawFeed, setRawFeed] = useState(false);
  const [direction, setDirection] = useState('');
  const [said, setSaid] = useState<readonly { who: 'you' | 'projectos'; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * THE SENTENCE THAT IS WAITING FOR A SECOND, DELIBERATE ANSWER.
   *
   * Every consequential verb this resolver produces arrives with a confirmation question, and the
   * first version of this box answered it by telling the owner to "ask again" — which re-parsed the
   * same words into the same unconfirmed intent, so nothing could ever be dispatched at all. The
   * confirmation is now a real one: a named button that sends exactly the intent it was shown for.
   */
  const [awaiting, setAwaiting] = useState<{ readonly intent: Extract<Intent, { kind: 'command' }>; readonly question: string } | null>(null);
  const feed = useRef<HTMLDivElement | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The current step is the one worth reading, so it opens itself — and stays wherever the owner
  // subsequently puts it.
  const current = view.currentStep;
  const expandedId = openStep ?? current?.phaseId ?? null;

  const lines = (liveRun?.lines ?? []).slice(-FEED_LINES);
  useEffect(() => {
    if (feed.current !== null) feed.current.scrollTop = feed.current.scrollHeight;
  }, [liveRun?.lines]);

  /** Send an already-confirmed command, and show the runtime's own answer. */
  async function dispatch(intent: Extract<Intent, { kind: 'command' }>): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setSaid((s) => [...s, { who: 'projectos', text: intent.say }]);
    try {
      const r = await requestGovernedCommand(tauriBridge, intent.verb, intent.args);
      if (mounted.current) setSaid((s) => [...s, { who: 'projectos', text: r.lines.join(' ') }]);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  /**
   * DIRECTION IS RESOLVED, NEVER OBEYED. The same resolver the Control Center uses maps a sentence
   * onto one of the verbs that already exist, onto navigation, or onto a refusal that says what
   * would have to change. It cannot produce a verb this channel does not have, and anything
   * consequential still answers to the runtime on the trusted side.
   */
  async function send(): Promise<void> {
    const text = direction.trim();
    if (text === '' || inFlight.current) return;
    const intent = resolveIntent(text, state);
    setSaid((s) => [...s, { who: 'you', text }]);
    setDirection('');
    setAwaiting(null);
    if (intent.kind === 'answer' || intent.kind === 'refusal') {
      setSaid((s) => [...s, { who: 'projectos', text: intent.lines.join(' ') }]);
      return;
    }
    // SAY IT, THEN DO IT. Both of these move the owner somewhere; announcing the move without
    // making it was a screen claiming an action it had not taken.
    if (intent.kind === 'navigate') {
      setSaid((s) => [...s, { who: 'projectos', text: intent.say }]);
      onNavigate(intent.to);
      return;
    }
    if (intent.kind === 'objective') {
      setSaid((s) => [...s, { who: 'projectos', text: intent.say }]);
      onStartObjective();
      return;
    }
    // A COMMAND FROM FREE TEXT IS ALWAYS CONFIRMED, WHATEVER THE RESOLVER SAID.
    //
    // Every verb this channel can produce today carries its own confirmation question, but that is a
    // convention held in another file — and a convention is what failed the first time this screen
    // dispatched something on the owner's behalf. A verb that arrives here with no question of its
    // own gets a generic one rather than going straight out.
    if (intent.confirm === null) {
      const question = `Send "${intent.verb}" to ProjectOS?`;
      setSaid((s) => [...s, { who: 'projectos', text: question }]);
      setAwaiting({ intent, question });
      return;
    }
    if (intent.confirm !== null) {
      const question = intent.confirm;
      setSaid((s) => [...s, { who: 'projectos', text: question }]);
      setAwaiting({ intent, question });
      return;
    }
    await dispatch(intent);
  }

  const gate = view.ownerGate;

  return (
    <div className="xw">
      {/* ── command bar ─────────────────────────────────────────────────────────────────────── */}
      <header className="xw-bar">
        <div className="xw-barid">
          <span className="xw-kicker">Execution</span>
          <span className="xw-project">{view.projectName}</span>
          <span className="xw-sep">/</span>
          <span className="xw-programme">{view.programmeLabel}</span>
        </div>
        <div className="xw-barprogress">
          <span className="xw-barlabel">Overall completion</span>
          <span className="xw-bigbar" aria-hidden="true">
            <span className="xw-bigbarfill" style={{ width: `${view.percentComplete}%` }} />
          </span>
          <span className="xw-pct">{view.percentComplete}%</span>
          <span className="xw-steps">
            {view.stepsAccepted} of {view.stepsTotal} steps
          </span>
        </div>
        <div className="xw-barright">
          {view.working && (
            <span className="xw-elapsed" title="Closing this window stops the job. You can pick it up again from where it stopped.">
              <span className="xw-workingdot" aria-hidden="true" />
              Running {elapsed(view.elapsedMs)} · keep this window open
            </span>
          )}
          <span className={`xw-owneraction${gate === null ? '' : ' xw-owneraction-held'}`}>{view.ownerAction}</span>
        </div>
      </header>

      {/* ── the owner's decision, when there is one ──────────────────────────────────────────── */}
      {gate !== null && (
        <section className="xw-gate" aria-labelledby="xw-gate-title">
          <h2 className="xw-gatetitle" id="xw-gate-title">
            {gate.stepNumber === null ? 'A step' : `Step ${String(gate.stepNumber).padStart(2, '0')}`} is held — your decision is needed
          </h2>
          <dl className="xw-gategrid">
            <div>
              <dt>What ProjectOS wants to do</dt>
              <dd>{gate.wants}</dd>
            </div>
            <div>
              <dt>Why you are being asked</dt>
              <dd>{gate.why}</dd>
            </div>
            <div>
              <dt>Risk</dt>
              <dd>{gate.risk}</dd>
            </div>
          </dl>
          <p className="xw-gatenote">{gate.ownerMustDo}</p>
          {/*
            THE REAL INBOX, NOT A SECOND ONE. Each pending request names what it permits and asks a
            second question before it is recorded. This screen must never nominate a request on the
            owner's behalf: an approval record carries no link to a phase, so "the first pending one"
            can be a different decision entirely from the step being read.
          */}
          {gate.hasPendingApprovals && <OwnerActionInbox state={state} />}
        </section>
      )}

      <div className="xw-grid">
        {/* ── left: the plan ────────────────────────────────────────────────────────────────── */}
        <section className="xw-panel xw-plan" aria-labelledby="xw-plan-title">
          <div className="xw-panelhead">
            <h2 id="xw-plan-title">Plan</h2>
            <span className="xw-panelmeta">
              {view.tasksDone} of {view.tasksTotal} checks · {view.stepsTotal} steps
            </span>
          </div>
          <ul className="xw-steplist">
            {view.steps.map((s) => (
              <StepRow
                key={s.phaseId}
                step={s}
                expanded={s.phaseId === expandedId}
                onToggle={() => setOpenStep(s.phaseId === expandedId ? '' : s.phaseId)}
              />
            ))}
          </ul>
          {view.steps.length === 0 && <p className="xw-empty">No approved plan is active for this project yet.</p>}
        </section>

        {/* ── right column ──────────────────────────────────────────────────────────────────── */}
        <div className="xw-side">
          <section className="xw-panel" aria-labelledby="xw-req-title">
            <div className="xw-panelhead">
              <h2 id="xw-req-title">Requirements</h2>
              <span className="xw-panelmeta">
                {current === null
                  ? 'no step in play'
                  : `${current.requirements.filter((r) => r.state === 'MET').length} of ${current.requirements.length} met`}
              </span>
            </div>
            {current === null ? (
              <p className="xw-empty">Nothing is in play, so there is nothing to satisfy.</p>
            ) : (
              <ul className="xw-reqlist">
                {current.requirements.map((r) => (
                  <li key={r.id} className={`xw-req xw-req-${r.state.toLowerCase()}`}>
                    <span className="xw-reqmark" aria-hidden="true">{REQ_MARK[r.state]}</span>
                    <span className="xw-reqlabel">
                      {r.label}
                      {r.detail === null ? null : <span className="xw-reqdetail">{r.detail}</span>}
                    </span>
                    <span className="xw-reqstate">{r.state}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="xw-panel" aria-labelledby="xw-cap-title">
            <div className="xw-panelhead">
              <h2 id="xw-cap-title">Who is doing the work</h2>
            </div>
            <ul className="xw-caplist">
              {view.capabilities.map((c) => (
                <li key={c.id} className="xw-cap">
                  <span className="xw-caplabel">
                    {c.label}
                    <span className="xw-capdetail">{c.detail}</span>
                  </span>
                  <span className={`xw-chip xw-chip-${c.state.toLowerCase()}`}>{c.state}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="xw-panel" aria-labelledby="xw-done-title">
            <div className="xw-panelhead">
              <h2 id="xw-done-title">Completed</h2>
              <span className="xw-panelmeta">{view.completed.length} entries</span>
            </div>
            {view.completed.length === 0 ? (
              <p className="xw-empty">Nothing has finished yet.</p>
            ) : (
              <ul className="xw-donelist">
                {view.completed.map((c, i) => (
                  <li key={`${c.at}-${i}`} className="xw-done">
                    <span className="xw-donetime">{c.at.slice(11, 19) || '—'}</span>
                    <span className="xw-donelabel">{c.label}</span>
                    <span className="xw-donewho">{c.who}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="xw-grid xw-grid-bottom">
        {/* ── live work ─────────────────────────────────────────────────────────────────────── */}
        <section className="xw-panel xw-live" aria-labelledby="xw-live-title">
          <div className="xw-panelhead">
            <h2 id="xw-live-title">Live work</h2>
            <span className="xw-panelmeta">
              {view.working ? 'running' : gate === null ? 'idle' : 'held'}
              <button type="button" className="xw-linkish" onClick={() => setRawFeed(!rawFeed)}>
                {rawFeed ? 'Plain' : 'Details'}
              </button>
            </span>
          </div>
          {lines.length === 0 ? (
            <p className="xw-empty">Nothing is running. When ProjectOS works, you will see it here.</p>
          ) : (
            <div className="xw-feed" ref={feed} role="log" aria-label="What ProjectOS is doing">
              {lines.map((l, i) => {
                const f = friendlyLine(l.line);
                return (
                  <p className={`xw-feedline xw-feed-${f.tag}`} key={`${i}-${l.line.slice(0, 20)}`}>
                    <span className="xw-feedtag">[{f.tag}]</span>
                    {rawFeed ? clean(l.line) : f.text}
                  </p>
                );
              })}
            </div>
          )}
        </section>

        {/* ── direction ─────────────────────────────────────────────────────────────────────── */}
        <section className="xw-panel xw-direction" aria-labelledby="xw-dir-title">
          <div className="xw-panelhead">
            <h2 id="xw-dir-title">Direction</h2>
            <button type="button" className="xw-linkish" onClick={onOpenEvidence}>
              Evidence
            </button>
          </div>
          <div className="xw-said">
            {said.length === 0 ? (
              <p className="xw-empty">
                Tell ProjectOS what you want. For example: “Why is this blocked?”, “Continue”, or “Hold after this step”.
              </p>
            ) : (
              said.map((m, i) => (
                <p key={`${i}-${m.text.slice(0, 20)}`} className={`xw-msg xw-msg-${m.who}`}>
                  {m.text}
                </p>
              ))
            )}
          </div>
          {awaiting !== null && (
            <div className="xw-confirm" role="group" aria-label="Confirm before this is sent">
              <p className="xw-confirmq">{awaiting.question}</p>
              <div className="xw-confirmactions">
                <button type="button" className="os-sec" onClick={() => setAwaiting(null)} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="os-pri"
                  onClick={() => { const a = awaiting; setAwaiting(null); void dispatch(a.intent); }}
                  disabled={busy}
                >
                  Yes, do it
                </button>
              </div>
            </div>
          )}
          <div className="xw-compose">
            <input
              type="text"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send();
              }}
              placeholder="Instruct, question, or hold the plan…"
              aria-label="Tell ProjectOS what you want"
              disabled={busy}
            />
            <button type="button" className="os-pri" onClick={() => void send()} disabled={busy || direction.trim() === ''}>
              Send
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
