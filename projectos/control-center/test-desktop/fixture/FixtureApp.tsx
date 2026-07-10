/**
 * FixtureApp — the isolated Mission Control desktop fixture surface.
 *
 * TEST-ONLY. It renders fixture-only chrome (isolation markers, static safety matrix, governance
 * language, a scenario switcher, a blocked-action card) around the REAL production
 * `LiveMissionControl`, fed by an injected DaemonClient over the synthetic FixtureTransport. The
 * Mission Control UI is reused, not copied. The markers and switcher exist ONLY here — never in
 * the normal application.
 */
import { useMemo, useState } from 'react';
import { DaemonProvider } from '../../src/daemon/DaemonProvider';
import { LiveMissionControl } from '../../src/daemon/LiveMissionControl';
import { DaemonClient } from '../../src/daemon/daemonClient';
import { realScheduler } from '../../src/daemon/realScheduler';
import { FixtureTransport } from './FixtureTransport';
import { SCENARIOS, SCENARIO_ORDER, SAFETY_MATRIX, type ScenarioId } from './fixtureData';

function initialScenario(): ScenarioId {
  const q = new URLSearchParams(window.location.search).get('scenario');
  return q && q in SCENARIOS ? (q as ScenarioId) : 'connected';
}

export function FixtureApp() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>(initialScenario);
  const scenario = SCENARIOS[scenarioId];
  const client = useMemo(
    () => new DaemonClient(new FixtureTransport(scenario), realScheduler),
    [scenario],
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <b>ProjectOS</b>
          <span>Fixture</span>
        </div>
        <nav className="fixture-scenarios" data-testid="fixture-scenarios" aria-label="Fixture scenarios">
          {SCENARIO_ORDER.map((id) => (
            <button
              type="button"
              key={id}
              data-testid={`scenario-${id}`}
              className={`navitem${id === scenarioId ? ' active' : ''}`}
              aria-current={id === scenarioId ? 'page' : undefined}
              onClick={() => setScenarioId(id)}
            >
              <span className="dot" />
              {SCENARIOS[id].label}
            </button>
          ))}
        </nav>
        <div className="sidefoot">Isolated test fixture — synthetic data only. No production connection.</div>
      </aside>
      <main className="main">
        <div className="fixture-banner" data-testid="fixture-marker">
          <b>ISOLATED DESKTOP FIXTURE</b>
          <span data-testid="fixture-synthetic">SYNTHETIC DATA</span>
          <span data-testid="fixture-noprod">NO PRODUCTION CONNECTION</span>
        </div>
        <div className="fixture-gov" data-testid="governance">
          Owner (Murad) decides · ChatGPT gates · <b>Claude cannot approve</b> · <b>Claude cannot close</b> · read-only visibility
        </div>
        <div className="fixture-safety" data-testid="safety-matrix">
          {SAFETY_MATRIX.map(([k, v]) => (
            <div
              className="safety-cell"
              data-testid={`safety-${k.replace(/\s+/g, '-').toLowerCase()}`}
              key={k}
            >
              <span className="sk">{k}</span>
              <span className={`sv${v === 'NO' || v === 'ABSENT' || v === 'BLOCKED' ? ' good' : ''}`}>{v}</span>
            </div>
          ))}
        </div>
        {scenario.blocked && (
          <div className="fixture-blocked" data-testid="blocked-action">
            <b>Blocked action:</b> {scenario.blocked.action}
            <div className="reason">{scenario.blocked.reason}</div>
            <span className="tag warn" data-testid="blocked-owner">
              Requires owner approval — Claude cannot approve
            </span>
          </div>
        )}
        <DaemonProvider key={scenarioId} client={client}>
          <LiveMissionControl />
        </DaemonProvider>
      </main>
    </div>
  );
}
