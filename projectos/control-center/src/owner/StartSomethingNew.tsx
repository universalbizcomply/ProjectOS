/**
 * Start something new — README §Screens 5.
 *
 * NO PLANNING HAPPENS HERE. This collects a sentence and hands it to `plan.draft`; discovery,
 * reconciliation, conflict detection and the draft itself all happen in the canonical engine behind
 * the governed-command channel. The handoff's five-step plan is illustrative demonstration data and
 * is not reproduced — the real plan is whatever the runtime writes.
 *
 * THE RUNTIME'S ANSWER IS SHOWN VERBATIM, AND THAT DECIDES WHAT HAPPENS NEXT. The design lands the
 * owner on the Plan tab after submitting. A real runtime can REFUSE, and navigating away would hide
 * the refusal that explains why nothing was proposed — so the answer is printed here first and the
 * move to the Plan tab becomes the next thing to press. On a refusal there is nothing to go and see.
 */
import { useState } from 'react';
import { requestGovernedCommand } from '../governed/governedClient';
import { tauriBridge } from '../daemon/tauriBridge';
import { MAX_OBJECTIVE_LENGTH } from '../governed/governedCommands';
import { useVoiceInput } from './speech';
import { IconBack } from './icons';

/** Mirrors the runtime's own minimum, so this never composes something it will then refuse. */
const MIN_OBJECTIVE_LENGTH = 20;

const EXAMPLES: readonly string[] = [
  'Remind customers the day before their booking',
  'Make the sign-up page work on phones',
  'Tell me what broke this week',
];

const AFTER: ReadonlyArray<{ n: string; title: string; note: string }> = [
  { n: '1', title: 'ProjectOS writes a plan', note: 'Plain steps, in the order it will do them' },
  { n: '2', title: 'You approve it', note: 'Nothing runs before you do' },
  { n: '3', title: 'It works through the steps', note: 'You can pause or stop at any point' },
  { n: '4', title: 'It stops and asks', note: 'Any step that reaches customers, payments or the live site waits for you' },
];

/**
 * The two things an owner can ask for, which are the SAME operation.
 *
 * Asking for a change to an existing plan and asking for something new both end in `plan.draft`
 * proposing a plan the owner then approves. Giving the change case its own screen would have meant a
 * second form, a second dispatch and a second place for the rules to drift; giving it its own verb
 * would have meant a second mutation authority for a flow the existing one already expresses. So this
 * differs only in what it SAYS — the operation underneath is byte-identical.
 *
 * WHAT THE CHANGE WORDING HAS TO PROMISE. An owner asking to change a plan is entitled to know their
 * current plan is not being edited underneath them. Nothing here touches it: the draft is a proposal,
 * and the existing plan stays authoritative until the owner approves AND activates a replacement.
 */
const COPY = {
  new: {
    heading: 'Start something new',
    lede: 'Say what you want in your own words. You will see the plan before anything happens.',
    field: 'What should happen?',
    hud: 'plan first',
    submit: 'Make a plan',
  },
  change: {
    heading: 'Request a change',
    lede: 'Say what should be different. Your current plan stays active until you approve and start a replacement.',
    field: 'What should change?',
    hud: 'current plan unchanged',
    submit: 'Propose the change',
  },
} as const;

export function StartSomethingNew({
  projectName,
  projectId,
  onBack,
  onSeePlan,
  mode = 'new',
}: {
  projectName: string;
  projectId: string;
  onBack: () => void;
  onSeePlan: () => void;
  /** Copy only. Both modes dispatch the same `plan.draft`; neither edits the current plan. */
  mode?: 'new' | 'change';
}) {
  const copy = COPY[mode];
  const [objective, setObjective] = useState('');
  const [lines, setLines] = useState<readonly string[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const voice = useVoiceInput((text) => setObjective(objective === '' ? text : `${objective} ${text}`));

  const trimmed = objective.trim();
  const hasNewline = /[\r\n]/.test(objective);
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_OBJECTIVE_LENGTH;
  const tooLong = trimmed.length > MAX_OBJECTIVE_LENGTH;
  const blocked = trimmed.length === 0 || tooShort || tooLong || hasNewline;
  const proposed = lines.length > 0 && !failed;

  async function submit(): Promise<void> {
    setBusy(true);
    setFailed(false);
    setLines(['Asking ProjectOS to look at the project and propose a plan…']);
    const result = await requestGovernedCommand(tauriBridge, 'plan.draft', { objective: trimmed });
    setBusy(false);
    setLines(result.lines);
    setFailed(!result.ok);
  }

  return (
    <div className="os-stack">
      <div>
        <button type="button" className="os-ghost" onClick={onBack} style={{ marginBottom: 18, fontSize: '13.5px' }}>
          <IconBack />
          Back to {projectName}
        </button>
        <h1 className="os-h1">{copy.heading}</h1>
        <p className="os-lede">{copy.lede}</p>
      </div>

      <section className="os-plate os-glass os-hud">
        <div className="os-hudlabel"><span>objective // {projectId}</span><span className="rule" /><span>{copy.hud}</span></div>
        <label style={{ display: 'block' }}>
          <span className="os-fieldlabel" style={{ marginBottom: 10 }}>{copy.field}</span>
          <textarea
            className="os-textarea"
            style={{ minHeight: 132 }}
            value={objective}
            disabled={busy}
            placeholder="Customers should get a reminder the day before their booking."
            onChange={(e) => setObjective(e.target.value)}
            aria-describedby="os-objective-help"
          />
        </label>
        <div className="os-examples">
          {EXAMPLES.map((text) => (
            <button type="button" className="os-example" key={text} onClick={() => setObjective(text)}>
              {text}
            </button>
          ))}
        </div>
        <div className="os-newactions">
          <button type="button" className="os-pri" disabled={blocked || busy} onClick={() => void submit()}>
            {busy ? 'Working…' : copy.submit}
          </button>
          <button
            type="button"
            className="os-ghost"
            onClick={voice.toggle}
            disabled={!voice.supported}
            title={voice.supported ? undefined : voice.unavailableReason}
          >
            Say it instead
          </button>
        </div>
        <div id="os-objective-help" className="os-composernote">
          {hasNewline
            ? 'Please write this as a single paragraph — line breaks are not accepted here.'
            : tooShort
              ? `A little more detail, please — at least ${MIN_OBJECTIVE_LENGTH} characters.`
              : tooLong
                ? `That is too long — please keep it under ${MAX_OBJECTIVE_LENGTH} characters.`
                : `${trimmed.length} characters. Nothing is started by sending this.`}
        </div>
        {voice.listening && (
          <div className="os-listenrow" role="status">
            <span className="os-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
            <span className="t">Listening — just say what you want.</span>
            <button type="button" className="os-sec" onClick={voice.stop}>Done</button>
          </div>
        )}
        {!voice.supported && <p className="os-composernote" role="note">{voice.unavailableReason}</p>}
        {lines.length > 0 && (
          <p className={`os-refusal${failed ? ' failed' : ''}`} role="status" aria-live="polite">
            {lines.join('\n')}
          </p>
        )}
        {proposed && !busy && (
          <div className="os-newactions" style={{ marginTop: 18 }}>
            <button type="button" className="os-pri" onClick={onSeePlan}>See the plan</button>
          </div>
        )}
        <p className="os-wiznote">
          Nothing reaches customers, payments or the live site without your approval — not even while
          a plan is running.
        </p>
      </section>

      <section>
        <h3 className="os-h3" style={{ marginBottom: 12 }}>What happens after this</h3>
        <ol className="os-afterlist">
          {AFTER.map((a) => (
            <li className="os-afterrow" key={a.n}>
              <span className="os-afternum">{a.n}</span>
              <span>
                <span className="os-aftertitle">{a.title}</span>
                <span className="os-afternote">{a.note}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
