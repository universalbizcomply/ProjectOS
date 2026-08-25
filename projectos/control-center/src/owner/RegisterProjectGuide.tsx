/**
 * Add a project — the owner's registration surface.
 *
 * Registration writes to an ACL-protected machine location, so it needs elevation. It used to
 * require an Administrator terminal, a copied digest and a typed confirmation phrase; the owner
 * rejected that as the normal experience (PROJECTOS-PRODUCT-COMPLETION1A §11), so this asks the
 * native host to do it and the host raises a real Windows UAC prompt.
 *
 * THIS COMPONENT HAS NO AUTHORITY AND CANNOT REGISTER ANYTHING. It collects four values and asks.
 * Everything that decides whether a registration may happen lives outside the WebView:
 *
 *   - the Tauri host validates the values again, then shows the exact proposal in a NATIVE dialog
 *     and requires an explicit Yes — a WebView is the least trustworthy place to record consent, so
 *     the confirmation deliberately does not live here;
 *   - Windows then raises its own UAC prompt, which this application cannot suppress or pre-answer;
 *   - the elevated helper re-plans from the registry and repository as they actually are and
 *     re-verifies everything before writing.
 *
 * So this file names no command, builds no command line, and carries no confirmation phrase. It
 * cannot: an invariant test in the registration crate fails the build if a renderer source mentions
 * any of them.
 *
 * The Administrator-terminal route still exists and is unchanged, for anyone who prefers it.
 */
import { useState } from 'react';
import { tauriBridge } from '../daemon/tauriBridge';

const ENVIRONMENTS = ['development', 'staging', 'production'] as const;

/** What the host reported. `null` while nothing has been attempted. */
interface Outcome {
  readonly busy: boolean;
  readonly message: string | null;
  readonly failed: boolean;
}

export function RegisterProjectGuide() {
  const [id, setId] = useState('');
  const [root, setRoot] = useState('');
  const [envs, setEnvs] = useState<readonly string[]>(['development']);
  const [frozen, setFrozen] = useState(true);
  const [outcome, setOutcome] = useState<Outcome>({ busy: false, message: null, failed: false });

  const ready = id.trim() !== '' && root.trim() !== '' && envs.length > 0;
  const available = tauriBridge.isTauri();

  function toggleEnv(name: string) {
    setEnvs((prev) => (prev.includes(name) ? prev.filter((e) => e !== name) : [...prev, name]));
  }

  async function register(): Promise<void> {
    setOutcome({ busy: true, message: 'Waiting for you to confirm, then for Windows permission…', failed: false });
    try {
      const result = await tauriBridge.invoke('register_project', {
        projectId: id.trim(),
        repositoryRoot: root.trim(),
        environments: [...envs],
        productionFrozen: frozen,
      });
      // The host answers with a short token for the cases it can state positively, and throws a
      // ready-to-read sentence for everything else. Neither is reworded here.
      if (result === 'REGISTERED') {
        setOutcome({ busy: false, message: `${id.trim()} is registered. It will appear in Projects.`, failed: false });
        setId('');
        setRoot('');
      } else if (result === 'ALREADY_REGISTERED') {
        setOutcome({ busy: false, message: 'That project is already registered exactly like this. Nothing was changed.', failed: false });
      } else if (result === 'DECLINED') {
        setOutcome({ busy: false, message: 'Cancelled. Nothing was written.', failed: false });
      } else {
        setOutcome({ busy: false, message: 'ProjectOS could not confirm what happened. Check the Projects list.', failed: true });
      }
    } catch (error) {
      setOutcome({
        busy: false,
        message: typeof error === 'string' ? error : 'Registration did not complete. Nothing was written.',
        failed: true,
      });
    }
  }

  return (
    <details className="ocp-panel preview">
      <summary>
        Add a project
        <span className="ocp-example-tag">Needs Windows permission</span>
      </summary>
      <p className="ocp-empty">
        ProjectOS keeps the list of projects it may govern in a protected place an ordinary session
        cannot write to, on purpose. Adding one asks Windows for administrator permission — you will
        see exactly what is being added, and then a Windows prompt. Nothing is written unless you
        approve both.
      </p>

      <div className="ocp-regform">
        <label>
          <span>Project ID</span>
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. my-app" disabled={outcome.busy} />
        </label>
        <label>
          <span>Project folder (full path)</span>
          <input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="C:\dev\my-app" disabled={outcome.busy} />
        </label>
        <fieldset className="ocp-regform-envs">
          <legend>Environments</legend>
          {ENVIRONMENTS.map((name) => (
            <label key={name} className="ocp-regform-check">
              <input type="checkbox" checked={envs.includes(name)} onChange={() => toggleEnv(name)} disabled={outcome.busy} />
              <span>{name}</span>
            </label>
          ))}
        </fieldset>
        <label className="ocp-regform-check">
          <input type="checkbox" checked={frozen} onChange={(e) => setFrozen(e.target.checked)} disabled={outcome.busy} />
          <span>Production frozen (recommended)</span>
        </label>
      </div>

      {!available && (
        <p className="ocp-sub">
          Adding a project needs the installed ProjectOS desktop application — a browser preview
          cannot ask Windows for permission.
        </p>
      )}

      <div className="ocp-actionrow">
        <button
          type="button"
          className="ocp-btn primary"
          disabled={!ready || outcome.busy || !available}
          onClick={() => void register()}
        >
          {outcome.busy ? 'Waiting…' : 'Register project'}
        </button>
      </div>

      {!ready && available && (
        <p className="ocp-sub">Fill in a project ID, a folder and at least one environment.</p>
      )}

      {outcome.message !== null && (
        <p className={`ocp-actionmsg${outcome.failed ? ' crit' : ''}`} role="status" aria-live="polite">
          {outcome.message}
        </p>
      )}
    </details>
  );
}
