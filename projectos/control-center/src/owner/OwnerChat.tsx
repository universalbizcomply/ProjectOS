/**
 * Owner Chat — a plain-language Q&A panel over the project's governed state.
 *
 * Fully offline and deterministic: every answer is produced by `answerOwnerQuestion` from an
 * OwnerControlModel. No AI model, no network, no metered API. Owner-only actions are never
 * performed here — the responder explains them but routes authorisation back to the owner.
 * Created in PROJECTOS-V3-OWNER-CHAT1A.
 *
 * IT ANSWERS FROM THE SAME SOURCE OWNER CONTROL RENDERS FROM. This panel used to read
 * `OWNER_MODELS` unconditionally, which is the offline fallback: the last RECORDED position of the
 * closed V3 programme. Owner Control had already been taught to prefer the live runtime, so the two
 * surfaces answered from different sources at the same moment — Owner Control showed the recovery
 * plan IN EXECUTION at 4 of 6, while this panel told the owner the plan was COMPLETE at 19 of 19 and
 * that no runtime was running. A status surface that contradicts the canonical one is worse than no
 * status surface, so the selection below is deliberately the same expression Owner Control uses.
 */
import { useMemo, useRef, useState } from 'react';
import { OWNER_MODELS, PROJECTOS_V3 } from './ownerSnapshot';
import { answerOwnerQuestion, BASE_SUGGESTIONS, type ChatAnswer } from './ownerChatModel';
import { matchActionIntent, type ChatAction } from './ownerChatActions';
import { useGovernedProjects, useGovernedRun, useGovernedState } from '../daemon/DaemonProvider';
import { SelectedProjectIdentity } from './SelectedProjectIdentity';
import { ownerModelFromGoverned } from './governedOwnerModel';
import { requestGovernedCommand } from '../governed/governedClient';
import { tauriBridge } from '../daemon/tauriBridge';
import type { OwnerControlModel } from './ownerModel';

type TurnActionStatus = 'offered' | 'busy' | 'done';

interface ChatTurn {
  readonly id: number;
  readonly role: 'owner' | 'projectos';
  readonly text: string;
  /** A suggested governed command this turn's reply carries, if any — never dispatched by itself. */
  readonly action?: ChatAction;
  readonly actionStatus?: TurnActionStatus;
}

function greeting(model: OwnerControlModel): ChatTurn {
  return { id: 0, role: 'projectos', text: answerOwnerQuestion(model, 'hello').answer };
}

export function OwnerChat() {
  // WHICH PROJECT, decided by the ONE authoritative selection and never by this page.
  //
  // It used to hold its own `useState` over a static fixture list, so the owner could put this panel
  // on a different project from the one Owner Control was acting on — and answer questions about it
  // in the first person. There is no setter here now: the project cannot be overridden, shadowed or
  // locally remembered. `PROJECTOS_V3` remains only as the RECORDED position to answer from while
  // nothing is selected, which is the same fallback this panel has always used.
  const inventory = useGovernedProjects();
  const projectId = inventory?.selectedProjectId ?? PROJECTOS_V3.projectId;
  const governed = useGovernedState();
  const live = governed !== null && governed.connected ? governed : null;
  const run = useGovernedRun();
  const model: OwnerControlModel = useMemo(
    () =>
      live !== null
        ? ownerModelFromGoverned(live)
        : (OWNER_MODELS.find((m) => m.projectId === projectId) ?? PROJECTOS_V3),
    [live, projectId],
  );

  const [turns, setTurns] = useState<readonly ChatTurn[]>(() => [greeting(model)]);
  const [draft, setDraft] = useState('');
  const nextId = useRef(1);

  // WHAT THE ANSWERS CAME FROM. Answers already on screen were produced from whichever model was in
  // force when they were asked, so when the source changes underneath them they become stale claims
  // about a project the panel is no longer describing. The runtime connects asynchronously, so this
  // is the normal path, not an edge case: the greeting is rendered before the daemon reports. Reset
  // the log rather than leave recorded-position answers sitting above live ones.
  const sourceKey = live !== null ? `live:${model.projectId}` : `recorded:${projectId}`;
  const [answeredFrom, setAnsweredFrom] = useState(sourceKey);
  if (answeredFrom !== sourceKey) {
    setAnsweredFrom(sourceKey);
    nextId.current = 1;
    setTurns([greeting(model)]);
  }

  const suggestions = BASE_SUGGESTIONS;

  function ask(question: string) {
    const q = question.trim();
    if (!q) return;
    const answer: ChatAnswer = answerOwnerQuestion(model, q);
    // Recognised only against LIVE governed state — the recorded fallback names no real phase or
    // decision to act on, so there is nothing safe to suggest doing anything with.
    const action = live !== null ? (matchActionIntent(q, live, run.active) ?? undefined) : undefined;
    const ownerTurn: ChatTurn = { id: nextId.current++, role: 'owner', text: q };
    const reply: ChatTurn = {
      id: nextId.current++,
      role: 'projectos',
      text: answer.answer,
      action,
      actionStatus: action !== undefined ? 'offered' : undefined,
    };
    setTurns((prev) => [...prev, ownerTurn, reply]);
    setDraft('');
  }

  async function runAction(turnId: number, action: ChatAction) {
    setTurns((prev) => prev.map((t) => (t.id === turnId ? { ...t, actionStatus: 'busy' } : t)));
    const result = await requestGovernedCommand(tauriBridge, action.verb, action.args);
    setTurns((prev) => [
      ...prev.map((t) => (t.id === turnId ? { ...t, actionStatus: 'done' as const } : t)),
      { id: nextId.current++, role: 'projectos', text: result.lines.join('\n') },
    ]);
  }

  return (
    <section className="ocp ochat" aria-labelledby="ochat-title">
      <div className="head">
        <div>
          <h1 id="ochat-title">Owner Chat</h1>
          <p>Ask about this project. Answers come only from its current status — no external calls.</p>
        </div>
        {/* Always shown, not conditionally. The old control was hidden while a runtime was live,
            because offering a CHOICE there would have answered about a project the runtime was not
            reporting on. Stating which project the answers are about has the opposite property: it
            is most useful exactly when there is a live runtime to be wrong about. */}
        <SelectedProjectIdentity />
      </div>

      <div className="ochat-log" role="log" aria-live="polite" aria-label="Conversation">
        {turns.map((t) => (
          <div key={t.id} className={`ochat-turn ${t.role}`}>
            <span className="ochat-who">{t.role === 'owner' ? 'You' : 'ProjectOS'}</span>
            <div className="ochat-bubble">{t.text}</div>
            {t.action !== undefined && t.actionStatus !== 'done' && (
              <div className="ochat-action">
                <button
                  type="button"
                  className="ocp-btn primary"
                  disabled={t.actionStatus === 'busy'}
                  onClick={() => void runAction(t.id, t.action as ChatAction)}
                >
                  {t.actionStatus === 'busy' ? 'Working…' : `▶ ${t.action.label}`}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="ochat-suggest" aria-label="Suggested questions">
        {suggestions.map((s) => (
          <button type="button" key={s} className="ocp-chip ochat-chip" onClick={() => ask(s)}>{s}</button>
        ))}
      </div>

      <form
        className="ochat-input"
        onSubmit={(e) => { e.preventDefault(); ask(draft); }}
      >
        <label className="ochat-input-label" htmlFor="ochat-field">Your question</label>
        <input
          id="ochat-field"
          type="text"
          value={draft}
          placeholder="e.g. What decisions need me?"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="ocp-btn primary" disabled={!draft.trim()}>Ask</button>
      </form>
    </section>
  );
}
