/**
 * The Connections tab — README §Screens 7.
 *
 * NO CREDENTIAL VALUE REACHES THIS COMPONENT, and none can: `state.connections` is built from
 * credential METADATA — a reference, a presence flag, a risk class and a non-reversible fingerprint.
 *
 * TWO PLACES WHERE THE ENGINE AND THE DESIGN DO NOT MEET, AND NEITHER IS PAPERED OVER:
 *
 *  1. The design shows a MASKED VALUE (`••••••••••••4f1a`). There is no value here to mask, and the
 *     fingerprint is a salted digest, not the last four characters of the key — printing it behind
 *     dots would tell the owner those characters came from their secret. The slot instead carries
 *     the fingerprint, labelled as an id. See `connectionStandIn`.
 *  2. The design offers REMOVE. ProjectOS has no verb that deletes a stored credential — not in
 *     `GOVERNED_VERBS`, not in the host's command surface. The control keeps its designed place and
 *     is disabled with the reason on it, the same treatment the handoff prescribes for voice.
 *     Raised to the gatekeeper rather than quietly dropped or quietly faked.
 */
import { useState } from 'react';
import { tauriBridge } from '../daemon/tauriBridge';
import type { GovernedProjection } from '../governed/types';
import { CONNECTION_CATALOGUE, credentialReference } from './addProjectModel';
import { connectionStandIn, connectionStatus, dotColour } from './workspaceModel';
import { IconClose } from './icons';

export const REMOVE_UNAVAILABLE =
  'ProjectOS cannot remove a stored key yet. Replace it here, or remove it in Windows Credential Manager.';

export function ConnectionsTab({
  state,
  readOnly = false,
}: {
  state: GovernedProjection;
  /**
   * STATUS ONLY — no way to change anything, for surfaces that observe rather than manage.
   *
   * Health is a report, and reading a report must have no side effect. Rendering this component
   * whole put a key field and a "Add connection" button on it, one disclosure away; a `<details>`
   * hid them from the eye but not from the page, and not from the keyboard. In this mode the
   * mutation surface is NOT RENDERED AT ALL rather than disabled, because Health is not Settings —
   * a disabled configuration form still teaches the owner that this is where keys are managed.
   *
   * The status mapping, the labels and the fingerprint stand-in are the same ones in both modes;
   * nothing about how a connection reads is duplicated for this.
   */
  readOnly?: boolean;
}) {
  const [service, setService] = useState(CONNECTION_CATALOGUE[0]?.id ?? 'github');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const available = tauriBridge.isTauri();
  const { connections, available: readable, detail } = state.connections;

  const kind = CONNECTION_CATALOGUE.find((c) => c.id === service) ?? CONNECTION_CATALOGUE[0];
  // Which field of that service this single box stores: its secret, or its first field.
  const field = kind?.fields.find((f) => f.kind === 'secret') ?? kind?.fields[0] ?? null;

  async function add(): Promise<void> {
    if (kind === undefined || field === null) return;
    setBusy(true);
    setMessage(null);
    try {
      // Straight to the native command, exactly as ConnectionsPanel does. The value never enters
      // the governed channel, never enters state that outlives this call, and is cleared on every
      // path including failure.
      const result = await tauriBridge.invoke('set_credential', {
        reference: credentialReference(state.projectId, 'development', kind.id, field.key),
        value,
        replace: true,
      });
      setMessage({
        text: result === 'REPLACED' ? 'Replaced. Windows is holding the new value.' : 'Stored. Windows is holding it.',
        failed: false,
      });
    } catch (error) {
      setMessage({ text: typeof error === 'string' ? error : 'Nothing was stored.', failed: true });
    } finally {
      setValue('');
      setBusy(false);
    }
  }

  return (
    <section>
      {!readOnly && (
        <>
          <h2 className="os-h2">Connections and keys</h2>
          <p className="os-connintro">
            Windows holds these, not ProjectOS. They never appear in reports, and using a live one
            always asks you first.
          </p>
        </>
      )}

      <div className="os-connrows">
        {!readable && <div className="os-emptyline">{detail}</div>}
        {readable && connections.length === 0 && (
          <div className="os-emptyline">
            {readOnly
              ? 'Nothing connected yet.'
              : 'Nothing connected yet. Add a key below only when this project needs one.'}
          </div>
        )}
        {connections.map((c) => {
          const status = connectionStatus(c);
          return (
            <div className="os-connrow" key={c.reference}>
              <span className="os-dot" style={{ width: 8, height: 8, background: dotColour(status.state) }} aria-hidden="true" />
              {/* The catalogue's display label where ProjectOS knows the service, so the row reads
                  "GitHub" rather than the router's lowercase key. Unknown providers print as sent. */}
              <span className="svc">
                {CONNECTION_CATALOGUE.find((k) => k.id === c.provider)?.label ?? c.provider}
              </span>
              <span className="masked">{connectionStandIn(c)}</span>
              {/* The status WORD sits beside the dot — state is never colour alone. */}
              <span className="used">{status.label}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="os-ghost"
                  disabled
                  aria-label={REMOVE_UNAVAILABLE}
                  title={REMOVE_UNAVAILABLE}
                >
                  <IconClose size={15} width={1.6} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
      <div className="os-connadd">
        <h3>Add a connection</h3>
        {!available ? (
          <p className="os-connintro" style={{ margin: 0 }}>
            Adding a key needs the installed ProjectOS desktop application.
          </p>
        ) : (
          <>
            <div className="os-two">
              <label>
                <span className="os-fieldlabel">Service</span>
                <select className="os-select" value={service} onChange={(e) => setService(e.target.value)}>
                  {CONNECTION_CATALOGUE.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="os-fieldlabel">Key or token</span>
                <input
                  className="os-input"
                  type="password"
                  value={value}
                  disabled={busy}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste it here"
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
            </div>
            <button type="button" className="os-pri" disabled={busy || value === ''} onClick={() => void add()}>
              {busy ? 'Storing…' : 'Add connection'}
            </button>
          </>
        )}
        {message !== null && (
          <p className={`os-refusal${message.failed ? ' failed' : ''}`} role="status" aria-live="polite">
            {message.text}
          </p>
        )}
      </div>
      )}

    </section>
  );
}
