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
 * There is intentionally no approve/activate control. Turning a proposal into an executable plan is
 * an authority-creating step and it is not built yet; offering a button that looked like it would do
 * that is precisely the kind of thing this pilot exists to stop.
 *
 * Created in the post-V3 self-hosting pilot (F3 / F10).
 */
import { useState } from 'react';
import { requestGovernedCommand } from '../governed/governedClient';
import { tauriBridge } from '../daemon/tauriBridge';
import { MAX_OBJECTIVE_LENGTH } from '../governed/governedCommands';

/** Mirrors the runtime's own minimum, so the UI never composes something it will then refuse. */
const MIN_OBJECTIVE_LENGTH = 20;

interface Outcome {
  readonly busy: boolean;
  readonly lines: readonly string[];
  readonly failed: boolean;
}

export function ObjectiveIntake({ projectName, repository }: { projectName: string; repository: string }) {
  const [objective, setObjective] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ busy: false, lines: [], failed: false });

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
        Anything ProjectOS proposes is a suggestion until you approve it. Approving a plan is a
        separate decision and is not offered on this screen.
      </p>
    </div>
  );
}
