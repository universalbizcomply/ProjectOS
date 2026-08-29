/**
 * CONNECTIONS — ONE IMPLEMENTATION, THREE PROJECTIONS.
 *
 * The product had three copies of the same job: `ConnectionsTab` (the workspace tab),
 * `ConnectionsPanel`'s `AddCredential` (Owner Control) and the Add Project wizard's storing loop.
 * The first two rendered the same credential metadata with different labels, different status
 * mappings in places, and two separate paths into the SAME native write. That is exactly the
 * "Connections / Connections 2" split the architecture forbids, so there is one component now and
 * the surfaces choose a PROJECTION of it:
 *
 *   manage    — Settings. The owner's place to set up or replace a key.
 *   status    — Health. What is on file, in the owner's words. No control of any kind.
 *   technical — Advanced. The same rows plus the reference, the risk class and the fingerprint.
 *
 * One model, one status mapping, one write. The wizard keeps its own storing loop because it runs
 * before the project exists and there is no projection to read — but it calls the same native
 * command with the same reference grammar.
 *
 * ── WHY THE WRITE IS NOT A GOVERNED VERB, AND WHY THAT IS RIGHT ─────────────────────────────────
 *
 * `set_credential` is a native Tauri command and deliberately not one of the sixteen. The governed
 * channel is a closed vocabulary of NON-SECRET arguments whose values are echoed into action
 * messages and evidence; a secret on it would be one refactor away from a report. The value instead
 * goes renderer → Tauri IPC → native host → the child's ENVIRONMENT BLOCK → the existing credential
 * router → Windows Credential Manager. It is never an argv element, never a file, never logged and
 * never returned. See `src-tauri/src/set_credential.rs`.
 *
 * That makes it a LOCAL DEVICE capability — it configures this installation, not a project's
 * execution — so it belongs in Settings, not in the project verb system.
 *
 * ── WHAT WAS WRONG, AND WHAT THIS FIXES ────────────────────────────────────────────────────────
 *
 * The device authority was sound; the OWNER CONFIRMATION was not.
 *
 *  1. NO CONFIRMATION BEFORE AN OVERWRITE. Both old surfaces called the native write on a single
 *     click. Replacing a stored credential destroys the previous value irrecoverably — ProjectOS
 *     cannot read it back to restore it — so a mis-click on the wrong row was unrecoverable and
 *     silent. Every write now states what it is about to do and waits for a second, explicit press.
 *  2. A REPLACE LABELLED AS AN ADD. `ConnectionsTab` sent `replace: true` unconditionally behind a
 *     button reading "Add connection". An owner adding what they believed was a new key silently
 *     overwrote an existing one. `replace` is now derived from the row's own status, and the
 *     confirmation says which of the two is about to happen.
 *  3. A HARD-WIRED ENVIRONMENT. It built its reference with the literal `'development'` while the
 *     rows above it showed credentials from every environment the project has. An owner looking at
 *     a `production` row and typing into the form beneath it wrote to `development` — a silent
 *     wrong-target write. The reference now comes from the ROW for a replacement, and for a new
 *     connection the environment is shown on screen and named in the confirmation.
 *
 * NO CREDENTIAL VALUE REACHES THIS COMPONENT FROM THE ENGINE, and none can: `state.connections` is
 * metadata — a reference, a status, a risk class and a non-reversible fingerprint. The one value
 * that exists here is the one the owner is typing, and it is cleared on every path out.
 *
 * Created in PROJECTOS-CONTROL-CENTER-UX-ARCHITECTURE1A (Stage 8).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { tauriBridge } from '../daemon/tauriBridge';
import type { GovernedConnectionView, GovernedProjection } from '../governed/types';
import { CONNECTION_CATALOGUE, credentialReference } from '../owner/addProjectModel';
import { connectionStandIn, connectionStatus, dotColour } from '../owner/workspaceModel';

export type ConnectionsMode = 'manage' | 'status' | 'technical';

/**
 * ProjectOS has no verb that deletes a stored credential — not in `GOVERNED_VERBS`, not in the
 * host's native command surface. Said plainly rather than drawn as a control that must refuse.
 */
export const REMOVE_UNAVAILABLE =
  'ProjectOS cannot remove a stored key. Replace it here, or remove it in Windows Credential Manager.';

/** The catalogue's display name where ProjectOS knows the service; the raw key otherwise. */
function providerLabel(provider: string): string {
  return CONNECTION_CATALOGUE.find((k) => k.id === provider)?.label ?? provider;
}

/**
 * Which environments this project actually has, read from the credentials on file.
 *
 * There is no environment list on the projection, and inventing one would be a claim about the
 * project that nothing here can support. Where nothing is on file yet the wizard's own default is
 * the only environment that exists, and it is DISPLAYED rather than assumed silently.
 */
function environmentsOf(connections: readonly GovernedConnectionView[]): readonly string[] {
  const seen = [...new Set(connections.map((c) => c.environment))].sort();
  return seen.length > 0 ? seen : ['development'];
}

/** What a pending write is about to do, in the words the confirmation uses. */
interface PendingWrite {
  readonly reference: string;
  readonly replace: boolean;
  readonly provider: string;
  readonly environment: string;
}

/**
 * The one credential write in the product's owner UX.
 *
 * CONFIRM, THEN COMMIT. Typing a value arms nothing; the first press asks; only the second press
 * calls the host. The value is held in one state slot, never leaves this component except as the
 * argument to the native command, and is cleared on success, on failure and on cancel.
 */
function CredentialWriter({
  pending,
  onDone,
  onCancel,
}: {
  pending: PendingWrite;
  onDone: (message: string, failed: boolean) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  /*
   * ONE WRITE PER CONFIRMATION, GUARDED BY A REF RATHER THAN BY STATE.
   *
   * `disabled={busy}` only takes effect once React has re-rendered, so two presses inside one tick
   * — a double-click, or a held Enter — both passed the check and both reached the host. The same
   * correction the plan-decision surface already carries.
   */
  const inFlight = useRef(false);
  /** One id per writer instance, so two open writers could never describe each other's question. */
  const askId = useId();

  /*
   * THE QUESTION TAKES THE KEYBOARD WITH IT.
   *
   * Pressing Replace REMOVES that button and renders the confirmation in its place, so focus fell
   * back to `<body>`: a keyboard owner had just been asked a question they would have had to tab
   * from the top of the page to answer, and Escape — bound on the wrapper — no longer reached
   * anything. An `alertdialog` nobody is focused inside is worse than no dialog at all.
   */
  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
  }, [confirming]);

  async function commit(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await tauriBridge.invoke('set_credential', {
        reference: pending.reference,
        value,
        replace: pending.replace,
      });
      onDone(
        result === 'REPLACED'
          ? `Replaced. Windows is holding the new key for ${providerLabel(pending.provider)}.`
          : `Stored. Windows is holding the key for ${providerLabel(pending.provider)}.`,
        false,
      );
    } catch (error) {
      // The host's message, which is written to be actionable and carries no value or digest of it.
      onDone(typeof error === 'string' ? error : 'Nothing was stored.', true);
    } finally {
      // Cleared on EVERY path, including failure — a value that did not store is still a secret.
      setValue('');
      setBusy(false);
      setConfirming(false);
      inFlight.current = false;
    }
  }

  function cancel(): void {
    setValue('');
    setConfirming(false);
    onCancel();
  }

  const verb = pending.replace ? 'Replace' : 'Store';

  return (
    <div
      className="ux-credwrite"
      // Escape leaves without writing, from the field and from the confirmation alike.
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel();
      }}
    >
      <label className="ux-credfield">
        <span className="os-fieldlabel">
          {verb} the key for {providerLabel(pending.provider)} ({pending.environment})
        </span>
        <input
          className="os-input"
          type="password"
          value={value}
          disabled={busy || confirming}
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste it here"
          onChange={(e) => setValue(e.target.value)}
        />
      </label>

      {!confirming && (
        <div className="ux-credrow">
          <button
            type="button"
            className="os-pri"
            disabled={value === ''}
            onClick={() => setConfirming(true)}
          >
            {verb}
          </button>
          <button type="button" className="os-ghost" onClick={cancel}>Cancel</button>
        </div>
      )}

      {/*
        NOT MODAL, AND NOT PRETENDING TO BE. `aria-modal` stays at its default false because nothing
        is trapped: the owner can still read the rows behind this. Focus moves in, and
        `aria-describedby` points at the question itself, so a screen reader announces WHAT is being
        asked rather than only the label of the thing doing the asking.
      */}
      {confirming && (
        <div
          className="ux-credconfirm"
          role="alertdialog"
          aria-label={`Confirm ${verb.toLowerCase()}`}
          aria-describedby={askId}
        >
          <p className="ux-credask" id={askId}>
            {pending.replace ? (
              <>
                Replace the {providerLabel(pending.provider)} key for <b>{pending.environment}</b>?
                The key currently on file is overwritten and ProjectOS cannot get it back.
              </>
            ) : (
              <>
                Store this key for {providerLabel(pending.provider)} in <b>{pending.environment}</b>?
                Windows holds it. ProjectOS never shows it again.
              </>
            )}
          </p>
          <div className="ux-credrow">
            <button ref={confirmButton} type="button" className="os-pri" disabled={busy} onClick={() => void commit()}>
              {busy ? 'Storing…' : `Yes, ${verb.toLowerCase()}`}
            </button>
            <button type="button" className="os-ghost" disabled={busy} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Connections({ state, mode }: { state: GovernedProjection; mode: ConnectionsMode }) {
  const { connections, available: readable, detail } = state.connections;
  /** Which row (by reference) or new service (by `new:<id>`) the owner opened a writer on. */
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const [service, setService] = useState(CONNECTION_CATALOGUE[0]?.id ?? 'github');
  const [environment, setEnvironment] = useState<string | null>(null);

  const manage = mode === 'manage';
  const desktop = tauriBridge.isTauri();
  const environments = environmentsOf(connections);
  const chosenEnvironment = environment ?? environments[0] ?? 'development';

  const kind = CONNECTION_CATALOGUE.find((c) => c.id === service) ?? CONNECTION_CATALOGUE[0];
  const field = kind?.fields.find((f) => f.kind === 'secret') ?? kind?.fields[0] ?? null;

  function finish(text: string, failed: boolean): void {
    setMessage({ text, failed });
    setOpen(null);
  }

  return (
    <section>
      <div className="os-connrows">
        {!readable && <div className="os-emptyline">{detail}</div>}
        {readable && connections.length === 0 && (
          <div className="os-emptyline">
            {manage
              ? 'Nothing connected yet. Add a key below only when this project needs one.'
              : 'Nothing connected yet.'}
          </div>
        )}

        {connections.map((c) => {
          const status = connectionStatus(c);
          const writing = manage && open === c.reference;
          return (
            <div className="os-connrow ux-connrow" key={c.reference}>
              <div className="ux-connmain">
                <span
                  className="os-dot"
                  style={{ width: 8, height: 8, background: dotColour(status.state) }}
                  aria-hidden="true"
                />
                <span className="svc">{providerLabel(c.provider)}</span>
                <span className="masked">{connectionStandIn(c)}</span>
                {/* The status WORD sits beside the dot — state is never colour alone. */}
                <span className="used">{status.label}</span>
                {manage && !writing && (
                  <button
                    type="button"
                    className="os-sec ux-connbtn"
                    onClick={() => { setMessage(null); setOpen(c.reference); }}
                  >
                    {c.status === 'MISSING' ? 'Set it up' : 'Replace'}
                  </button>
                )}
              </div>

              {/*
                TECHNICAL EVIDENCE, NOT A SECOND WORKFLOW. Advanced shows what identifies a
                credential — never a value, and the fingerprint is a salted digest rather than the
                last characters of the key, so printing it reveals nothing about the secret.
              */}
              {mode === 'technical' && (
                <dl className="ux-conntech">
                  <div><dt>Reference</dt><dd>{c.reference}</dd></div>
                  <div><dt>Environment</dt><dd>{c.environment}</dd></div>
                  <div><dt>Risk</dt>
                    <dd>{c.risk === 'operation' ? 'needs your approval each time it is used' : c.risk}</dd>
                  </div>
                  <div><dt>Fingerprint</dt><dd>{c.fingerprint ?? 'none recorded'}</dd></div>
                  <div><dt>Expires</dt><dd>{c.expiresAt ?? 'no expiry recorded'}</dd></div>
                </dl>
              )}

              {writing && desktop && (
                <CredentialWriter
                  pending={{
                    // THE ROW'S OWN REFERENCE — the project, environment, provider and credential
                    // the owner is actually looking at, never a rebuilt guess at them.
                    reference: c.reference,
                    replace: c.status !== 'MISSING',
                    provider: c.provider,
                    environment: c.environment,
                  }}
                  onDone={finish}
                  onCancel={() => setOpen(null)}
                />
              )}
              {writing && !desktop && (
                <p className="os-connintro" style={{ margin: 0 }}>
                  Changing a key needs the installed ProjectOS desktop application.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {manage && (
        <div className="os-connadd">
          <h3>Add a connection</h3>
          {!desktop ? (
            <p className="os-connintro" style={{ margin: 0 }}>
              Adding a key needs the installed ProjectOS desktop application.
            </p>
          ) : open === `new:${service}` && kind !== undefined && field !== null ? (
            <CredentialWriter
              pending={{
                reference: credentialReference(state.projectId, chosenEnvironment, kind.id, field.key),
                // A NEW connection never replaces. If one already exists for this service and
                // environment it has a row above with its own Replace, which says so.
                replace: false,
                provider: kind.id,
                environment: chosenEnvironment,
              }}
              onDone={finish}
              onCancel={() => setOpen(null)}
            />
          ) : (
            <>
              <div className="os-two">
                <label>
                  <span className="os-fieldlabel">Service</span>
                  <select
                    className="os-select"
                    value={service}
                    onChange={(e) => { setService(e.target.value); setOpen(null); }}
                  >
                    {CONNECTION_CATALOGUE.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="os-fieldlabel">Environment</span>
                  {/*
                    ALWAYS ON SCREEN, never assumed. With one environment this is a single fixed
                    option rather than a hidden constant, because the owner has to be able to see
                    which one a key is about to be written to before they write it.
                  */}
                  <select
                    className="os-select"
                    value={chosenEnvironment}
                    disabled={environments.length === 1}
                    onChange={(e) => { setEnvironment(e.target.value); setOpen(null); }}
                  >
                    {environments.map((e) => (
                      <option key={e} value={e}>{e}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                type="button"
                className="os-pri"
                onClick={() => { setMessage(null); setOpen(`new:${service}`); }}
              >
                Add connection
              </button>
            </>
          )}
          <p className="os-connintro ux-connfoot">{REMOVE_UNAVAILABLE}</p>
        </div>
      )}

      {message !== null && (
        <p className={`os-refusal${message.failed ? ' failed' : ''}`} role="status" aria-live="polite">
          {message.text}
        </p>
      )}
    </section>
  );
}
