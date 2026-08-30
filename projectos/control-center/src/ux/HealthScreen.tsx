/**
 * SCREEN 6 — HEALTH & USAGE. A support surface, not a fifth dashboard.
 *
 * It answers four questions in seconds — is ProjectOS working, is anything wrong, do I need to do
 * something, is AI usage within limits — and then stops. There are no graphs, no telemetry, no
 * observability vocabulary and no second copy of anything the project screens already say.
 *
 * IT READS; IT NEVER ACTS. Nothing here dispatches a governed command, no control could, and the
 * one thing that used to be an exception is gone: replacing a credential is a WRITE, it belongs to
 * Settings, and Health now renders the shared Connections component in its `status` projection —
 * the same rows and the same status mapping with no mutation surface built at all.
 *
 * Every word comes from `healthModel`, which derives from records the engine already keeps. See its
 * header for why a stored credential is never rendered as a healthy provider.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import type { GovernedState } from '../governed/types';
import { buildHealthModel, type HealthTone, type LiveRunFact } from './healthModel';
import { Connections } from './Connections';

/** Status is never colour alone — every dot sits beside its own word. */
const TONE_WORD: Record<HealthTone, string> = {
  ok: 'Fine',
  attention: 'Needs attention',
  problem: 'Problem',
  unknown: 'Not known',
};

const TONE_COLOUR: Record<HealthTone, string> = {
  ok: 'var(--ok)',
  attention: 'var(--warn)',
  problem: 'var(--crit)',
  unknown: 'var(--faint)',
};

export function HealthScreen({
  governed,
  liveRun = null,
}: {
  governed: GovernedState | null;
  /**
   * LIVENESS COMES FROM THE DAEMON, NOT FROM A RECORD — the run the sidecar actually owns; a
   * session record can only say a run BEGAN. Supplied by the shell exactly as `governed` is, rather
   * than read from context here: this screen is rendered on its own in tests, and a component that
   * reaches for a provider cannot be. Omitted means "no live answer", never "nothing is running".
   */
  liveRun?: LiveRunFact | null;
}) {
  const model = buildHealthModel(governed, liveRun);
  const live = governed !== null && governed.connected ? governed : null;

  return (
    <section className="os-stack" aria-labelledby="ux-health-title">
      <header className="ux-screenhead">
        <h1 className="os-h1" id="ux-health-title">Health</h1>
      </header>

      {/* THE HEADLINE ANSWER, and never better than the worst thing beneath it. */}
      <p className="ux-statusline">
        <span className="ux-feeddot" style={{ background: TONE_COLOUR[model.tone] }} aria-hidden="true" />
        <span>{model.summary}</span>
      </p>

      {model.groups.map((group) => (
        <section className="os-plate" key={group.id} aria-labelledby={`ux-health-${group.id}`}>
          <div className="ux-healthhead">
            <h2 className="os-h2" id={`ux-health-${group.id}`} style={{ margin: 0 }}>{group.title}</h2>
            <span className="ux-healthstate">
              <span className="ux-feeddot" style={{ background: TONE_COLOUR[group.tone] }} aria-hidden="true" />
              {group.headline}
              <span className="os-vh"> — {TONE_WORD[group.tone]}</span>
            </span>
          </div>

          {/* Keyed by position as well as text: two credentials for one provider in different
              environments are two real notes, and must not collapse into one. */}
          {group.notes.map((note, i) => (
            <p className="ux-healthnote" key={`${i}-${note}`}>{note}</p>
          ))}

          {group.facts.length > 0 && (
            <dl className="ux-healthfacts">
              {group.facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  {/* A missing value says so. It is never rendered as 0 or as an empty cell. */}
                  <dd>{fact.value ?? 'Not recorded'}</dd>
                </div>
              ))}
            </dl>
          )}

          {/*
            THE PER-PROVIDER TRUTH, IN STATUS MODE. One Connections implementation serves Health,
            Settings and Advanced; this projection renders rows and status words and nothing else.
            It used to render management behind a disclosure, which hid a key field and a store
            button from the eye but not from the page or the keyboard. Stage 8 ruled where
            management lives: Settings, and only Settings.
          */}
          {group.id === 'connectivity' && live !== null && live.connections.connections.length > 0 && (
            <div className="ux-healthconns">
              <Connections state={live} mode="status" />
            </div>
          )}
        </section>
      ))}
    </section>
  );
}
