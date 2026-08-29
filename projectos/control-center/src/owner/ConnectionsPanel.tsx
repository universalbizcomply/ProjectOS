/**
 * Owner Control's connections panel — the TECHNICAL projection, and no longer a second place to
 * manage a key.
 *
 * WHAT THIS FILE USED TO BE. It carried its own `AddCredential`: a password field and a Store /
 * Replace button behind a `<details>`, calling the native `set_credential` on a single click. That
 * made two owner-facing credential-management workflows — this one and the workspace's connections
 * tab — over one native write, with two sets of labels and two sets of copy to keep true. Stage 8
 * ruled one management home: Settings. Advanced shows the evidence.
 *
 * WHAT IT IS NOW. A thin projection of the ONE Connections component. It renders the same rows from
 * the same model with the same status mapping, plus the technical identity of each credential — the
 * reference, the environment, the risk class, the fingerprint and any recorded expiry. There is no
 * control on it. Nothing here can write.
 *
 * `OwnerControlPlane` is unchanged: it renders `<ConnectionsPanel state={live} />` exactly as
 * before, and the frozen core keeps its contract.
 */
import type { GovernedProjection } from '../governed/types';
import { Connections } from '../ux/Connections';

export function ConnectionsPanel({ state }: { state: GovernedProjection }) {
  return (
    <div className="ocp-panel ocp-connections">
      <h2>Connections</h2>
      <p className="ocp-sub">
        What identifies each credential ProjectOS knows about. Set one up or replace it in Settings.
      </p>

      <Connections state={state} mode="technical" />

      <p className="ocp-sub">
        ProjectOS never shows a stored secret, and never puts one in a report, a prompt or a log. The
        fingerprint identifies a credential without revealing it.
      </p>
    </div>
  );
}
