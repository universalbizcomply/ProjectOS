/**
 * Connections & secrets — what this project needs to reach, and whether it can.
 *
 * NO CREDENTIAL VALUE REACHES THIS COMPONENT, and none can. Everything rendered here comes from
 * `state.connections`, which the projection builds from credential METADATA: a reference (a name),
 * a presence flag, a risk class, and a non-reversible fingerprint. There is no prop, no field and no
 * code path by which a secret could arrive, so there is nothing here to accidentally render, log or
 * put in an evidence pack.
 *
 * THE FINGERPRINT IS SHOWN ON PURPOSE. It is a salted-domain SHA-256 truncation — it cannot be
 * reversed and it is not a prefix of the value. Showing it lets an owner tell two credentials apart,
 * and confirm a replacement actually changed something, without ever seeing either.
 *
 * "Could not ask" is rendered differently from "nothing configured". An installation that cannot
 * reach the credential router knows nothing about this project's credentials, and reporting that as
 * "no connections" would be a claim it has not earned.
 *
 * Created in PROJECTOS-PRODUCT-COMPLETION1A §12–18.
 */
import type { GovernedConnectionView, GovernedProjection } from '../governed/types';

/** Plain-language label and tone per status. The owner should not have to learn these words. */
const STATUS: Readonly<Record<GovernedConnectionView['status'], { label: string; tone: string }>> = {
  STORED: { label: 'Connected', tone: 'ok' },
  MISSING: { label: 'Not set up', tone: 'warn' },
  EXPIRED: { label: 'Expired', tone: 'crit' },
  UNMANAGED: { label: 'Set up outside ProjectOS', tone: 'mut' },
};

export function ConnectionsPanel({ state }: { state: GovernedProjection }) {
  const { available, detail, connections } = state.connections;

  return (
    <div className="ocp-panel ocp-connections">
      <h2>Connections</h2>

      {!available && <p className="ocp-empty">{detail}</p>}

      {available && connections.length === 0 && (
        <p className="ocp-empty">
          This project has no external connections set up. That is fine until something needs one —
          ProjectOS will say so when it does.
        </p>
      )}

      {available && connections.length > 0 && (
        <ul className="ocp-conn-list">
          {connections.map((c) => {
            const status = STATUS[c.status];
            return (
              <li key={c.reference} className="ocp-conn-item">
                <div className="ocp-conn-head">
                  <span className="ocp-conn-provider">{c.provider}</span>
                  <span className={`ocp-badge ${status.tone}`}>{status.label}</span>
                </div>
                <p className="ocp-sub">
                  {c.credential} · {c.environment}
                  {c.risk === 'operation' && ' · needs your approval each time it is used'}
                </p>
                {(c.fingerprint !== null || c.expiresAt !== null) && (
                  <p className="ocp-sub ocp-conn-meta">
                    {c.fingerprint !== null && <>id {c.fingerprint}</>}
                    {c.fingerprint !== null && c.expiresAt !== null && ' · '}
                    {c.expiresAt !== null && <>expires {c.expiresAt}</>}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="ocp-sub">
        ProjectOS never shows a stored secret, and never puts one in a report, a prompt or a log. The
        short id above identifies a credential without revealing it.
      </p>
    </div>
  );
}
