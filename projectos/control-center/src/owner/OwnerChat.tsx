/**
 * Owner Chat — a plain-language Q&A panel over the local project snapshot.
 *
 * Fully offline and deterministic: every answer is produced by `answerOwnerQuestion` from the selected
 * project's OwnerControlModel. No AI model, no network, no metered API. Owner-only actions are never
 * performed here — the responder explains them but routes authorisation back to the owner.
 * Created in PROJECTOS-V3-OWNER-CHAT1A.
 */
import { useRef, useState } from 'react';
import { OWNER_MODELS, PROJECTOS_V3 } from './ownerSnapshot';
import { answerOwnerQuestion, BASE_SUGGESTIONS, type ChatAnswer } from './ownerChatModel';
import type { OwnerControlModel } from './ownerModel';

interface ChatTurn {
  readonly id: number;
  readonly role: 'owner' | 'projectos';
  readonly text: string;
}

function greeting(model: OwnerControlModel): ChatTurn {
  return { id: 0, role: 'projectos', text: answerOwnerQuestion(model, 'hello').answer };
}

export function OwnerChat() {
  const [projectId, setProjectId] = useState<string>(PROJECTOS_V3.projectId);
  const model: OwnerControlModel = OWNER_MODELS.find((m) => m.projectId === projectId) ?? PROJECTOS_V3;

  const [turns, setTurns] = useState<readonly ChatTurn[]>(() => [greeting(model)]);
  const [draft, setDraft] = useState('');
  const nextId = useRef(1);

  const suggestions = BASE_SUGGESTIONS;

  function reset(nextProjectId: string) {
    const next = OWNER_MODELS.find((m) => m.projectId === nextProjectId) ?? PROJECTOS_V3;
    setProjectId(nextProjectId);
    nextId.current = 1;
    setTurns([greeting(next)]);
  }

  function ask(question: string) {
    const q = question.trim();
    if (!q) return;
    const answer: ChatAnswer = answerOwnerQuestion(model, q);
    const ownerTurn: ChatTurn = { id: nextId.current++, role: 'owner', text: q };
    const reply: ChatTurn = { id: nextId.current++, role: 'projectos', text: answer.answer };
    setTurns((prev) => [...prev, ownerTurn, reply]);
    setDraft('');
  }

  return (
    <section className="ocp ochat" aria-labelledby="ochat-title">
      <div className="head">
        <div>
          <h1 id="ochat-title">Owner Chat</h1>
          <p>Ask about this project. Answers come only from its current status — no external calls.</p>
        </div>
        <label className="ocp-select">
          <span className="ocp-select-label">Project</span>
          <select value={projectId} onChange={(e) => reset(e.target.value)} aria-label="Select project">
            {OWNER_MODELS.map((m) => (
              <option key={m.projectId} value={m.projectId}>{m.projectName}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="ochat-log" role="log" aria-live="polite" aria-label="Conversation">
        {turns.map((t) => (
          <div key={t.id} className={`ochat-turn ${t.role}`}>
            <span className="ochat-who">{t.role === 'owner' ? 'You' : 'ProjectOS'}</span>
            <div className="ochat-bubble">{t.text}</div>
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
