/**
 * THE COMMAND-CENTRE HUD — JARVIS presentation only.
 *
 * Two rails of read-only panels either side of the operator, so the Control Center reads as a
 * command centre rather than a dark form. Everything here is a PROJECTION of data that already has
 * an owner elsewhere in the product: nothing is fetched, nothing is decided, and there is not one
 * control on it. The composer below remains the only place an owner can tell ProjectOS to act.
 *
 * IT IS NOT RENDERED IN STANDARD. Like `.os-operator`, the whole rail is `display: none` outside
 * Command appearance — the appearance owns the composition, and Standard is untouched.
 *
 * WHERE THE REFERENCE WAS NOT FOLLOWED, AND WHY. The owner's reference carries CPU, memory, network
 * and disk gauges and a roster of AI agents marked ACTIVE. ProjectOS measures none of those and has
 * no agent registry, so a gauge here would look exactly the same whether it were true or invented —
 * which is the one thing this product has refused to do throughout. The telemetry panel therefore
 * states that it is NOT INSTRUMENTED, and the agent roster is replaced by the real safety record:
 * what ProjectOS will not do without asking. See `commandHudModel` for every source.
 *
 * Created in PROJECTOS-JARVIS-VISUAL-RESTORATION1A.
 */
import { useEffect, useState } from 'react';
import type { GovernedProjectsInventory, GovernedState } from '../governed/types';
import { buildCommandHud, type CommandHud, type HudStat } from './commandHudModel';
import type { LiveRunFact } from './healthModel';
import type { HealthTone } from './healthModel';

const TONE: Record<HealthTone, string> = {
  ok: 'var(--ok)',
  attention: 'var(--warn)',
  problem: 'var(--crit)',
  unknown: 'var(--faint)',
};

/** Status is never colour alone — the value itself is the word beside the dot. */
function StatRow({ stat }: { stat: HudStat }) {
  return (
    <div className="ux-hudrow">
      <span className="ux-huddot" style={{ background: TONE[stat.tone] }} aria-hidden="true" />
      <span className="ux-hudlabel2">{stat.label}</span>
      <span className="ux-hudvalue">{stat.value ?? 'Not recorded'}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ux-hudpanel">
      <div className="ux-hudhead">
        <span>{title}</span>
        <span className="rule" />
      </div>
      {children}
    </section>
  );
}

/** The system clock. Browser local time, presentation only — it claims nothing about the project. */
function SystemTime() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="ux-hudclock">
      <span className="ux-hudclock-label">system time</span>
      <strong>{now.toTimeString().slice(0, 8)}</strong>
      <span className="ux-hudclock-date">{now.toDateString().toUpperCase()}</span>
    </div>
  );
}

export function CommandHudLeft({ hud }: { hud: CommandHud }) {
  return (
    <aside className="ux-hud ux-hud-left" aria-label="System status">
      <Panel title="system status">
        {hud.status.map((s) => <StatRow key={s.label} stat={s} />)}
      </Panel>

      <Panel title="active projects">
        {hud.projectsNote !== null && <p className="ux-hudnote">{hud.projectsNote}</p>}
        {hud.projects.map((p) => (
          <div className="ux-hudproj" key={p.name} data-selected={p.selected ? '1' : '0'}>
            <span className="ux-hudprojname">{p.name}</span>
            {/*
              A BAR IS A CLAIM ABOUT PROGRESS. It is drawn only for the project ProjectOS is actually
              reporting on; every other row says what is known instead. The reference fills six bars,
              which would mean inventing five numbers.
            */}
            {p.percent === null ? (
              <span className="ux-hudprojnote">{p.note}</span>
            ) : (
              <>
                <span className="ux-hudbar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, p.percent))}%` }} /></span>
                <span className="ux-hudprojpct">{p.percent}%</span>
              </>
            )}
          </div>
        ))}
      </Panel>

      <Panel title="governed capabilities">
        {hud.capabilities.map((s) => <StatRow key={s.label} stat={s} />)}
      </Panel>
    </aside>
  );
}

export function CommandHudRight({ hud }: { hud: CommandHud }) {
  return (
    <aside className="ux-hud ux-hud-right" aria-label="Mission and activity">
      <Panel title="mission overview">
        {hud.mission.map((m) => <p className="ux-hudmission" key={m}>{m}</p>)}
        {hud.missionContext.map((s) => <StatRow key={s.label} stat={s} />)}
      </Panel>

      <Panel title="recorded activity">
        {hud.feedNote !== null && <p className="ux-hudnote">{hud.feedNote}</p>}
        {hud.feed.map((f, i) => (
          <div className="ux-hudfeed" key={`${i}-${f.at}`}>
            <span className="ux-hudtime">{f.at}</span>
            <span className="ux-huddot" style={{ background: TONE[f.tone] }} aria-hidden="true" />
            <span className="ux-hudfeedtext">{f.text}</span>
          </div>
        ))}
      </Panel>

      <Panel title="ai usage">
        {hud.usage.length === 0
          ? <p className="ux-hudnote">Not reporting.</p>
          : hud.usage.map((s) => <StatRow key={s.label} stat={s} />)}
        {/* Said in words. A gauge here would look identical whether it were measured or invented. */}
        <p className="ux-hudnote ux-hudnotinst">{hud.telemetryNote}</p>
      </Panel>

      <Panel title="runtime">
        {hud.runtime.map((s) => <StatRow key={s.label} stat={s} />)}
      </Panel>
    </aside>
  );
}

/** Both rails plus the clock, derived once. */
export function useCommandHud(
  governed: GovernedState | null,
  inventory: GovernedProjectsInventory | null,
  liveRun: LiveRunFact | null = null,
): CommandHud {
  return buildCommandHud(governed, inventory, liveRun);
}

export { SystemTime };
