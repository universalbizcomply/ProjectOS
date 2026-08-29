/**
 * SETTINGS — the things the owner intentionally configures, and nothing else.
 *
 * WHAT BELONGS HERE. A setting is something the owner can actually change through a real, safe
 * seam that exists today. There are exactly two: how ProjectOS looks, and which keys Windows holds
 * for this project. Everything else on this screen is stated as a FACT rather than drawn as a
 * control, and is here because it answers "what has been configured", not "how is it going".
 *
 * WHAT WAS DELIBERATELY NOT ADDED, and why each would have been a lie:
 *   · AI budget — read from the reviewer ledger; no verb and no native command sets it. Health
 *     already reports it, so repeating it here would duplicate a screen AND imply it was editable.
 *   · Notifications — there is no notification system to configure.
 *   · Project defaults — nothing in the engine reads such a thing.
 *   · Voice — there is no governed voice seam. "Enable voice" would be a switch over nothing.
 *
 * WHAT MOVED OUT (Stage 8 duplication pass):
 *   · "Keys held by Windows: N" — a count of the very rows now listed above it in Connections, and
 *     the same number Health prints. Removed; the list itself is the truthful answer.
 *   · "ProjectOS core v…" — platform identity, not owner configuration. It lives in Advanced.
 *   · The "Live site" row — it is not a fact about this computer, it is one of the approvals. It
 *     joins the approvals plate, where its neighbours already are.
 *
 * THE APPROVAL ROWS ARE LOCKED, and that is the design, not an omission: they are the product's own
 * gates, and a settings screen that could switch them off would be the most dangerous control in
 * it. There is no control here that writes to them — only text.
 */
import { useGovernedProjects, useGovernedState } from '../daemon/DaemonProvider';
import { Connections } from '../ux/Connections';
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

      {/*
        CONNECTIONS — THE ONE PLACE A KEY IS SET UP OR REPLACED.
        Health shows the same rows and cannot change them; Advanced shows their technical identity.
        One component, one native write, three projections of it.
      */}
      <section className="os-plate-sm os-glass os-hud" aria-labelledby="os-set-conn">
        <div className="os-hudlabel">
          <span>connections</span><span className="rule" /><span>held by windows</span>
        </div>
        <h2 className="os-h2" id="os-set-conn" style={{ marginBottom: 8 }}>Connections and keys</h2>
        <p className="os-set-sub">
          Windows holds these, not ProjectOS. They never appear in reports, and using a live one
          always asks you first.
        </p>
        {live === null ? (
          <p className="os-set-sub" role="status">
            ProjectOS is not reporting on a project yet, so there are no keys to show or change.
            Open a project first.
          </p>
        ) : (
          <Connections state={live} mode="manage" />
        )}
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
          {/* The live-site gate's ACTUAL state for the open project, beside the rule it belongs to
              rather than filed under this computer's facts. */}
          <div className="os-lockrow">
            <IconLock />
            <span className="k">The live site, right now</span>
            <span className="v">
              {live === null
                ? 'Not known yet'
                : live.safety.productionFreeze
                  ? 'Frozen for this project'
                  : 'NOT frozen for this project'}
            </span>
          </div>
        </div>
      </section>

      <section className="os-plate-sm os-glass os-hud">
        <div className="os-hudlabel"><span>this computer</span><span className="rule" /><span>read only</span></div>
        <h2 className="os-h2" style={{ marginBottom: 20 }}>This computer</h2>
        <dl className="os-machine">
          <dt>Projects on this computer</dt>
          <dd>{inventory === null ? 'Not known yet' : `${inventory.projects.length} registered`}</dd>
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
