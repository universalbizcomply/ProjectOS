/**
 * Settings — README §Screens 9. Three plates and nothing else.
 *
 * APPEARANCE CHANGES NOTHING BUT LOOKS, and the plate says so in the copy the handoff approved. The
 * five approval rows below it are LOCKED, and the design is explicit that this is deliberate: they
 * are the product's own gates, and a settings screen that could switch them off would be the single
 * most dangerous control in it. There is no control here that writes to them — only text.
 */
import { CORE_VERSION } from '@projectos/core';
import { useGovernedProjects, useGovernedState } from '../daemon/DaemonProvider';
import type { ShellTheme } from './ShellTheme';
import { IconBack, IconLock } from './icons';

/** The five things that always ask, worded as the handoff approved them. */
const APPROVALS: ReadonlyArray<{ k: string; v: string }> = [
  { k: 'Changing the live site', v: 'Always asks' },
  { k: 'Sending real emails or messages', v: 'Always asks' },
  { k: 'Taking a real payment', v: 'Always asks' },
  { k: 'Using a live key or secret', v: 'Always asks' },
  { k: 'Finishing and closing work', v: 'Only you can' },
];

export function SettingsScreen({
  projectName,
  theme,
  setTheme,
  calm,
  setCalm,
  onBack,
  onAdvanced,
  onSignOut,
  onChangePassword,
}: {
  projectName: string;
  theme: ShellTheme;
  setTheme: (next: ShellTheme) => void;
  calm: boolean;
  setCalm: (next: boolean) => void;
  onBack: () => void;
  onAdvanced: () => void;
  onSignOut: () => void;
  /** Kept per IMPLEMENTATION_ORDER §2, which names change-password among the things not to drop. */
  onChangePassword: (() => void) | null;
}) {
  const inventory = useGovernedProjects();
  const governed = useGovernedState();
  const live = governed !== null && governed.connected ? governed : null;
  const keys = live === null ? null : live.connections.connections.length;

  return (
    <div className="os-stack">
      <div>
        <button type="button" className="os-ghost" onClick={onBack} style={{ marginBottom: 18, fontSize: '13.5px' }}>
          <IconBack />
          Back to {projectName}
        </button>
        <h1 className="os-h1">Settings</h1>
      </div>

      <section className="os-plate-sm os-glass os-hud">
        <div className="os-hudlabel">
          <span>appearance</span><span className="rule" /><span>{theme === 'command' ? 'command centre' : 'standard'}</span>
        </div>
        <h2 className="os-h2" style={{ marginBottom: 8 }}>Appearance</h2>
        <p className="os-set-sub">
          Changes how ProjectOS looks. It does not change your projects, what you are allowed to do,
          or what needs your approval. Remembered next time you open it.
        </p>
        <div className="os-preview-cards" role="radiogroup" aria-label="Appearance">
          <button
            type="button"
            className="os-preview"
            role="radio"
            aria-checked={theme === 'standard'}
            onClick={() => setTheme('standard')}
          >
            <span className="os-swatch standard" aria-hidden="true"><i /><b /></span>
            <span className="os-preview-body">
              <span className="os-preview-title">Standard</span>
              <span className="os-preview-note">Light, calm, minimal</span>
            </span>
          </button>
          <button
            type="button"
            className="os-preview"
            role="radio"
            aria-checked={theme === 'command'}
            onClick={() => setTheme('command')}
          >
            <span className="os-swatch command" aria-hidden="true"><i /><b /></span>
            <span className="os-preview-body">
              <span className="os-preview-title">Command Centre</span>
              <span className="os-preview-note">Dark, layered, illuminated</span>
            </span>
          </button>
        </div>
        <div className="os-calmrow">
          <span id="os-calm-label">Softer motion — turns off drift, blinking and sweeps</span>
          <button
            type="button"
            className="os-switch"
            role="switch"
            aria-checked={calm}
            aria-labelledby="os-calm-label"
            onClick={() => setCalm(!calm)}
          >
            <i aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="os-plate-sm os-glass os-hud">
        <div className="os-hudlabel"><span>approvals</span><span className="rule" /><span>always asks</span></div>
        <h2 className="os-h2" style={{ marginBottom: 8 }}>What always asks you first</h2>
        <p className="os-set-sub">
          These cannot be switched off here, in either appearance. That is deliberate.
        </p>
        <div className="os-lockrows">
          {APPROVALS.map((a) => (
            <div className="os-lockrow" key={a.k}>
              <IconLock />
              <span className="k">{a.k}</span>
              <span className="v">{a.v}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="os-plate-sm os-glass os-hud">
        <div className="os-hudlabel"><span>this computer</span><span className="rule" /><span>read only</span></div>
        <h2 className="os-h2" style={{ marginBottom: 20 }}>This computer</h2>
        <dl className="os-machine">
          <dt>Projects on this computer</dt>
          <dd>{inventory === null ? 'Not known yet' : `${inventory.projects.length} registered`}</dd>
          <dt>Keys held by Windows</dt>
          <dd>{keys === null ? 'Not known yet' : `${keys} held for this project`}</dd>
          <dt>Live site</dt>
          <dd>
            {live === null
              ? 'Not known yet'
              : live.safety.productionFreeze
                ? 'Frozen for this project'
                : 'NOT frozen for this project'}
          </dd>
          <dt>ProjectOS</dt>
          <dd>core v{CORE_VERSION} · governed projection · owner-gated closure</dd>
        </dl>
        <div className="os-setactions">
          <button type="button" className="os-sec" onClick={onAdvanced}>Advanced and technical details</button>
          {onChangePassword !== null && (
            <button type="button" className="os-ghost" onClick={onChangePassword}>Change password</button>
          )}
          <button type="button" className="os-ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </section>
    </div>
  );
}
