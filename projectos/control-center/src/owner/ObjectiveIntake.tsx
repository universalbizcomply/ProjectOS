/**
 * "What do you want ProjectOS to achieve?" — the owner's way in, without a terminal.
 *
 * The pilot's headline finding was that ProjectOS could refuse an unapproved phase but could not
 * ACCEPT a new objective at all, so no new work could ever be authorised. `plan draft` fixed that in
 * the runtime; this is the surface, and it is deliberately the thinnest possible one.
 *
 * NO PLANNING HAPPENS HERE. React collects a sentence and renders whatever the runtime says back,
 * verbatim. Discovery, reconciliation, conflict detection, provenance and the draft itself all
 * happen in the canonical engine behind the governed-command channel — there is no second planner in
 * the renderer, and nothing on this screen can create a phase, an approval or execution authority.
 *
 * ACTIVATION IS NOT APPROVAL, and this screen is careful about the difference.
 *
 * There is no approve control, because approving is an authority-creating act and a web page must
 * never perform one. What there IS, is activation: asking the runtime to materialise the plan that a
 * COMMITTED approval decision has already approved elsewhere. The two identifiers it sends name
 * WHICH proposal and WHICH decision; they are data. Whether that decision is real, committed,
 * unconsumed, for this project, this repository, this branch, this draft and this exact plan
 * material — and whether the person who took it was entitled to — is decided by `approvePlan`
 * against records in the repository, and this screen cannot influence any of it.
 *
 * So the button says "Activate approved plan", never "Approve". If no valid decision exists, the
 * runtime refuses and its refusal is shown verbatim. A button that looked like it conferred approval
 * is precisely the kind of thing this pilot exists to stop.
 *
 * Created in the post-V3 self-hosting pilot (F3 / F10).
 */
import { useState } from 'react';
import { requestGovernedCommand } from '../governed/governedClient';
import { tauriBridge } from '../daemon/tauriBridge';
import { MAX_OBJECTIVE_LENGTH } from '../governed/governedCommands';
import type { GovernedPlanDraftView } from '../governed/types';

/** Mirrors the runtime's own minimum, so the UI never composes something it will then refuse. */
const MIN_OBJECTIVE_LENGTH = 20;

interface Outcome {
  readonly busy: boolean;
  readonly lines: readonly string[];
  readonly failed: boolean;
}

/** Plain-language label + badge tone for a draft's decision state. */
const DECISION_LABEL: Record<GovernedPlanDraftView['decisionState'], { readonly text: string; readonly tone: string }> = {
  none: { text: 'No decision yet', tone: 'mut' },
  approved: { text: 'Approved — ready to activate', tone: 'ok' },
  refused: { text: 'Decision does not approve this draft', tone: 'warn' },
  consumed: { text: 'Already activated', tone: 'mut' },
};

export function ObjectiveIntake({
  projectName,
  repository,
  drafts,
}: {
  projectName: string;
  repository: string;
  drafts: readonly GovernedPlanDraftView[];
}) {
  const [objective, setObjective] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ busy: false, lines: [], failed: false });
  const [draftId, setDraftId] = useState('');
  const [decisionId, setDecisionId] = useState('');
  const [activation, setActivation] = useState<Outcome>({ busy: false, lines: [], failed: false });

  const trimmed = objective.trim();
  // A newline would smuggle a second request into the sidecar's per-line protocol, so the runtime
  // refuses one. Saying so here — before submitting — is kinder than a refusal after the fact.
  const hasNewline = /[\r\n]/.test(objective);
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_OBJECTIVE_LENGTH;
  const tooLong = trimmed.length > MAX_OBJECTIVE_LENGTH;
  const blocked = trimmed.length === 0 || tooShort || tooLong || hasNewline;

  async function submit(): Promise<void> {
    setOutcome({ busy: true, lines: ['Asking ProjectOS to look at the project and propose a plan…'], failed: false });
    const result = await requestGovernedCommand(tauriBridge, 'plan.draft', { objective: trimmed });
    // The runtime's own words, whether it proposed or refused. Never reworded, never summarised.
    setOutcome({ busy: false, lines: result.lines, failed: !result.ok });
  }

  const activationBlocked = draftId.trim() === '' || decisionId.trim() === '' || activation.busy;

  async function activate(useDraftId: string, useDecisionId: string): Promise<void> {
    setActivation({ busy: true, lines: ['Asking ProjectOS to activate the approved plan…'], failed: false });
    const result = await requestGovernedCommand(tauriBridge, 'plan.activate', {
      draftId: useDraftId.trim(),
      decisionId: useDecisionId.trim(),
    });
    // Verbatim again. A refusal here is the governed answer, not an error to be smoothed over, and
    // there is deliberately no optimistic local state that could claim success the runtime withheld.
    setActivation({ busy: false, lines: result.lines, failed: !result.ok });
  }

  return (
    <div className="ocp-panel intake">
      <h2>What do you want ProjectOS to achieve?</h2>
      <p className="ocp-empty">
        Describe the outcome in your own words. ProjectOS will read {projectName} ({repository}),
        work out what it already knows, and propose a plan for you to review. It will not start
        anything.
      </p>

      <label className="vh" htmlFor="ocp-objective">
        Objective
      </label>
      <textarea
        id="ocp-objective"
        className="ocp-objective"
        rows={4}
        value={objective}
        disabled={outcome.busy}
        placeholder="e.g. Make the booking flow reliable enough that staff need no training to use it."
        onChange={(e) => setObjective(e.target.value)}
        aria-describedby="ocp-objective-help"
      />

      <div id="ocp-objective-help" className="ocp-objective-help">
        {hasNewline
          ? 'Please write this as a single paragraph — line breaks are not accepted here.'
          : tooShort
            ? `A little more detail, please — at least ${MIN_OBJECTIVE_LENGTH} characters.`
            : tooLong
              ? `That is too long — please keep it under ${MAX_OBJECTIVE_LENGTH} characters.`
              : `${trimmed.length} characters. Nothing is started by sending this.`}
      </div>

      <div className="ocp-actionrow">
        <button
          type="button"
          className="ocp-btn primary"
          disabled={blocked || outcome.busy}
          onClick={() => void submit()}
        >
          {outcome.busy ? 'Working…' : 'Propose a plan'}
        </button>
      </div>

      {outcome.lines.length > 0 && (
        <pre
          className={`ocp-actionmsg${outcome.failed ? ' failed' : ''}`}
          role="status"
          aria-live="polite"
        >
          {outcome.lines.join('\n')}
        </pre>
      )}

      <p className="ocp-empty">
        Anything ProjectOS proposes is a suggestion until it is approved. Approving is a separate,
        recorded decision — it is not something this screen can do.
      </p>

      <h2>Plan drafts</h2>
      <p className="ocp-empty">
        Once a plan-approval decision has been recorded and committed, ProjectOS can turn a
        proposal into the active plan. This does not approve anything: it asks ProjectOS to act on
        a decision that already exists. If there is no valid committed decision, ProjectOS will say
        so.
      </p>

      {drafts.length === 0 ? (
        <p className="ocp-empty">No plan has been proposed for this project yet.</p>
      ) : (
        <ul className="ocp-draftlist">
          {drafts.map((d) => {
            const label = DECISION_LABEL[d.decisionState];
            return (
              <li key={d.draftId} className="ocp-draftitem">
                <div className="ocp-draftitem-head">
                  <span className="ocp-draftitem-id">{d.draftId}</span>
                  <span className={`ocp-badge ${label.tone}`}>{label.text}</span>
                </div>
                <p className="ocp-sub">
                  {d.planStatus || 'status unrecorded'}
                  {d.generatedAt !== '' ? ` · proposed ${d.generatedAt}` : ''}
                </p>
                {d.decisionState === 'approved' && d.decisionId !== null && (
                  <div className="ocp-actionrow">
                    <button
                      type="button"
                      className="ocp-btn primary"
                      disabled={activation.busy}
                      onClick={() => void activate(d.draftId, d.decisionId as string)}
                    >
                      {activation.busy ? 'Working…' : 'Activate this plan'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <details className="ocp-panel preview">
        <summary>
          Activate by id instead
          <span className="ocp-example-tag">Advanced</span>
        </summary>
        <label className="vh" htmlFor="ocp-draft-id">
          Draft
        </label>
        <input
          id="ocp-draft-id"
          className="ocp-objective"
          type="text"
          value={draftId}
          disabled={activation.busy}
          placeholder="Which proposal (draft id)"
          onChange={(e) => setDraftId(e.target.value)}
        />

        <label className="vh" htmlFor="ocp-decision-id">
          Decision
        </label>
        <input
          id="ocp-decision-id"
          className="ocp-objective"
          type="text"
          value={decisionId}
          disabled={activation.busy}
          placeholder="Which recorded decision (decision id)"
          onChange={(e) => setDecisionId(e.target.value)}
        />

        <div className="ocp-actionrow">
          <button
            type="button"
            className="ocp-btn"
            disabled={activationBlocked}
            onClick={() => void activate(draftId, decisionId)}
          >
            {activation.busy ? 'Working…' : 'Activate approved plan'}
          </button>
        </div>
      </details>

      {activation.lines.length > 0 && (
        <pre
          className={`ocp-actionmsg${activation.failed ? ' failed' : ''}`}
          role="status"
          aria-live="polite"
        >
          {activation.lines.join('\n')}
        </pre>
      )}
    </div>
  );
}
