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
 * APPROVAL AND ACTIVATION ARE TWO DIFFERENT ACTS, and this screen keeps them apart.
 *
 * APPROVE / REJECT record the owner's answer to one exact proposal. The screen sends a draft id and
 * the word `approve` or `reject`; that is all it can send. Every field that carries authority — the
 * project, the repository, the branch, the base commit, the plan digest, and above all WHO is
 * entitled to decide — is derived by the runtime from committed records, and the resulting decision
 * is COMMITTED. Under this programme's `tamperProof: false` model the commit is what makes the
 * decision real and a forged one a visible diff in the owner's own history. A page cannot forge that,
 * and nothing here claims a role: a role claimed by a renderer would be a claim, not a control.
 *
 * ACTIVATION is separate and unchanged: asking the runtime to materialise the plan a committed
 * decision has already approved. Whether that decision is real, committed, unconsumed, for this
 * project, this repository, this branch, this draft and this exact plan material is decided by
 * `approvePlan`, and this screen cannot influence any of it.
 *
 * WHY THERE USED TO BE NO APPROVE CONTROL. Not squeamishness — there was nothing to press. The
 * runtime could CHECK a plan-approval decision and consume one, and nothing anywhere could WRITE
 * one, so the only honest control was Activate and the only honest badge was "No decision yet". The
 * verb behind these two buttons is what changed; the argument about what a web page may assert did
 * not.
 *
 * A DECISION IS ASKED TWICE, AND THAT IS THE WHOLE OF THE CONFIRMATION.
 *
 * One decision per proposal, in either direction, with no undo — so a mis-click is permanent. The
 * confirmation is deliberately NOT the protected-operation ceremony this codebase uses for
 * production effects: a plan decision is not a protected action, it grants no authority by itself,
 * and dressing it as one would teach the owner that the two are the same weight. It is a plain
 * second question in the owner's own words, and Cancel, Escape and simply leaving it all do nothing.
 *
 * Created in the post-V3 self-hosting pilot (F3 / F10); decisions added in
 * PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A.
 */
import { useEffect, useRef, useState } from 'react';
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

/**
 * What the owner is asked, in their own words.
 *
 * NO GIT, NO JSON, NO DIGEST, NO BRANCH, NO `.projectops`. The owner is being asked whether they mean
 * it — not to understand how it is recorded. The technical record is one disclosure away for anyone
 * who wants it.
 */
const CONFIRM: Record<'approve' | 'reject', { readonly title: string; readonly body: readonly string[]; readonly action: string }> = {
  approve: {
    title: 'Approve this plan?',
    body: [
      'This permanently records your decision for this exact proposal.',
      'It does not start the work.',
    ],
    action: 'Confirm Approve',
  },
  reject: {
    title: 'Reject this plan?',
    body: [
      'This permanently records your rejection.',
      'You can create a revised proposal afterwards.',
    ],
    action: 'Confirm Reject',
  },
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
  const [decision, setDecision] = useState<Outcome>({ busy: false, lines: [], failed: false });
  /** Which draft is mid-decision, so only that row's controls are disabled. */
  const [deciding, setDeciding] = useState<string | null>(null);
  /** The question the owner has been asked but not yet answered. Null means nothing is pending. */
  const [pending, setPending] = useState<{ readonly draftId: string; readonly verdict: 'approve' | 'reject' } | null>(
    null,
  );
  /**
   * A synchronous latch against a double submission.
   *
   * `busy` STATE IS NOT ENOUGH. Two clicks landing in the same tick both read the pre-render value and
   * both dispatch — and because the runtime refuses a second decision for a proposal, the owner would
   * see a success and a confusing DECISION_EXISTS refusal for one deliberate act. A ref is written and
   * read synchronously, so the second click has nothing to do.
   */
  const inFlight = useRef(false);

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

  /**
   * Record the owner's answer to one proposal.
   *
   * TWO IDENTIFIERS AND A WORD. There is deliberately no field here for the decider, the digest, the
   * project or a path: the runtime derives every one of them, so there is nothing this screen could
   * assert even if it wanted to. What comes back is the runtime's own words, verbatim — including a
   * refusal, which is a governed answer rather than an error to smooth over.
   */
  async function decide(): Promise<void> {
    // ONLY A PENDING, CONFIRMED QUESTION REACHES THE RUNTIME. This function is not reachable from a
    // first click; it is the answer to a question already on screen.
    const asked = pending;
    if (asked === null || inFlight.current) return;
    inFlight.current = true;
    setPending(null);
    setDeciding(asked.draftId);
    setDecision({
      busy: true,
      lines: [asked.verdict === 'approve' ? 'Recording your approval…' : 'Recording your rejection…'],
      failed: false,
    });
    try {
      const result = await requestGovernedCommand(tauriBridge, 'plan.decide', {
        draftId: asked.draftId,
        decision: asked.verdict,
      });
      // The runtime's own words, verbatim — including a refusal, which is a governed answer rather
      // than an error to smooth over.
      setDecision({ busy: false, lines: result.lines, failed: !result.ok });
    } finally {
      setDeciding(null);
      inFlight.current = false;
    }
  }

  /**
   * Escape answers nothing.
   *
   * Bound while a question is pending and removed when it is not, so this screen adds no listener it
   * is not using. Cancelling and closing are the same act: the pending question is forgotten and no
   * command is sent.
   */
  useEffect(() => {
    if (pending === null) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPending(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending]);

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
        Anything ProjectOS proposes is a suggestion until you approve it. Approving is a separate,
        recorded decision, and it is yours alone to make.
      </p>

      <h2>Review plan</h2>
      <p className="ocp-empty">
        Read what ProjectOS has proposed, then approve it or reject it. Approving records your
        decision against this exact proposal — it does not start any work. Once a plan is approved
        you can activate it, and only then can any work begin.
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
                {/*
                  VIEW DETAILS — the technical record, behind a disclosure.
                  The owner never needs any of this to approve or reject: the plain-language summary
                  above and the two buttons below are the whole normal path. It is here because an
                  owner who wants the evidence should not have to open a terminal to see it, and
                  because a governance surface that hides its own record is asking to be trusted
                  rather than checked. Every field is one the read model already carries — nothing was
                  added to the projection to fill this in.
                */}
                <details className="ocp-panel preview">
                  <summary>
                    View details
                    <span className="ocp-example-tag">Advanced</span>
                  </summary>
                  <dl className="ocp-kv">
                    <dt>Proposal</dt>
                    <dd>{d.draftId}</dd>
                    <dt>Produced by</dt>
                    <dd>
                      {d.origin === 'authored'
                        ? 'authoring from your objective'
                        : 'importing what this repository already describes'}
                    </dd>
                    <dt>Status</dt>
                    <dd>{d.planStatus || 'unrecorded'}</dd>
                    <dt>Decision</dt>
                    <dd>{d.decisionId ?? 'none recorded'}</dd>
                  </dl>
                </details>
                {/*
                  REVIEW PLAN — the owner's two answers, shown only while there is something to answer.
                  A decision is not revisable, so once one exists these disappear and the badge above
                  says what was decided. Approve does not activate; it records.
                */}
                {d.decisionState === 'none' &&
                  (pending !== null && pending.draftId === d.draftId ? (
                    <div className="ocp-confirm" role="group" aria-label={CONFIRM[pending.verdict].title}>
                      <p className="ocp-confirm-title">{CONFIRM[pending.verdict].title}</p>
                      {CONFIRM[pending.verdict].body.map((line) => (
                        <p key={line} className="ocp-sub">
                          {line}
                        </p>
                      ))}
                      <div className="ocp-actionrow">
                        <button
                          type="button"
                          className="ocp-btn primary"
                          disabled={decision.busy}
                          onClick={() => void decide()}
                        >
                          {CONFIRM[pending.verdict].action}
                        </button>
                        {/* Cancel answers nothing, exactly as Escape and leaving the question do. */}
                        <button type="button" className="ocp-btn" onClick={() => setPending(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="ocp-actionrow">
                      <button
                        type="button"
                        className="ocp-btn primary"
                        disabled={decision.busy}
                        onClick={() => setPending({ draftId: d.draftId, verdict: 'approve' })}
                      >
                        {deciding === d.draftId && decision.busy ? 'Working…' : 'Approve Plan'}
                      </button>
                      <button
                        type="button"
                        className="ocp-btn"
                        disabled={decision.busy}
                        onClick={() => setPending({ draftId: d.draftId, verdict: 'reject' })}
                      >
                        {deciding === d.draftId && decision.busy ? 'Working…' : 'Reject'}
                      </button>
                    </div>
                  ))}
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

      {decision.lines.length > 0 && (
        <pre
          className={`ocp-actionmsg${decision.failed ? ' failed' : ''}`}
          role="status"
          aria-live="polite"
        >
          {decision.lines.join('\n')}
        </pre>
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
