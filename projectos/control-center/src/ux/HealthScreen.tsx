/**
 * SCREEN 6 — HEALTH & USAGE. A support surface, not a fifth dashboard.
 *
 * It answers four questions in seconds — is ProjectOS working, is anything wrong, do I need to do
 * something, is AI usage within limits — and then stops. There are no graphs, no telemetry, no
 * observability vocabulary and no second copy of anything the project screens already say.
 *
 * IT READS; IT NEVER ACTS. Nothing here dispatches a governed command, and there is no control that
 * could: health is a report, and every remedy for what it reports lives on the surface that owns
 * it. The one exception is replacing a stored credential, which is the existing connections
 * component doing what it already did — reused, not rebuilt beside itself.
 *
 * Every word comes from `healthModel`, which derives from records the engine already keeps. See its
 * header for why a stored credential is never rendered as a healthy provider.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A.
 */
import type { GovernedState } from '../governed/types';
import { buildHealthModel, type HealthTone } from './healthModel';
import { ConnectionsTab } from '../owner/ConnectionsTab';

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

export function HealthScreen({ governed }: { governed: GovernedState | null }) {
  const model = buildHealthModel(governed);
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
            THE ONE PLACE THE OWNER MANAGES CONNECTIONS. The existing component, reused as it is —
            Advanced keeps its technical provider evidence, and there is no second implementation.
          */}
          {group.id === 'connectivity' && live !== null && (
            <details className="ux-healthdetail">
              <summary>Manage connections</summary>
              <ConnectionsTab state={live} />
            </details>
          )}
        </section>
      ))}
    </section>
  );
}
