/**
 * Gatekeeper status + real cost — structurally absent from the Control Center before this.
 *
 * Every number here comes straight from `state.gatekeeperStatus`, itself a pure re-summarisation
 * of the SAME cost ledger `projectos run` writes to and enforces against (see
 * `governedProjection.ts`'s `gatekeeperStatusOf`). Nothing here estimates, guesses or duplicates
 * the budget arithmetic — it reuses the runtime's own `summariseLedger`/`evaluateBudget`.
 *
 * Created in PROJECTOS-PRODUCT-COMPLETION1A.
 */
import type { GovernedProjection } from '../governed/types';

/** Micro-USD as an owner-readable amount. Mirrors `formatMicroUsd` in the core cost ledger. */
function formatSpend(microUsd: number): string {
  const usd = Math.max(0, microUsd) / 1_000_000;
  return usd < 0.01 && usd > 0 ? `$${usd.toFixed(6)}` : `$${usd.toFixed(2)}`;
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function GatekeeperStatus({ state }: { state: GovernedProjection }) {
  const gk = state.gatekeeperStatus;

  return (
    <div className="ocp-panel ocp-gatekeeper">
      <h2>Gatekeeper</h2>

      {!gk.configured && (
        <p className="ocp-empty">
          No gatekeeper is configured for this project. {state.authority.gatekeeper} cannot review
          it automatically — every stop here waits for you instead.
        </p>
      )}

      {gk.configured && (
        <>
          <div className="ocp-gk-row">
            <span className="ocp-gk-label">Reviewer</span>
            <span>{state.authority.gatekeeper}</span>
          </div>

          <div className="ocp-gk-row">
            <span className="ocp-gk-label">Last contacted</span>
            <span>
              {gk.lastCall === null
                ? 'Never'
                : `${relativeTime(gk.lastCall.at)} · ${gk.lastCall.model} · ${formatSpend(gk.lastCall.costMicroUsd)}`}
            </span>
          </div>

          <div className="ocp-gk-row">
            <span className="ocp-gk-label">This phase / project</span>
            <span>
              {formatSpend(gk.spentThisPhaseMicroUsd)} / {formatSpend(gk.spentThisProjectMicroUsd)}
              {gk.callCount > 0 && ` (${gk.callCount} call${gk.callCount === 1 ? '' : 's'})`}
            </span>
          </div>

          {gk.budget === null && (
            <p className="ocp-note">No usable monthly budget is configured, so spend is tracked but not gated.</p>
          )}

          {gk.budget !== null && (
            <div className={`ocp-gk-budget ocp-gk-budget-${gk.budget.status.toLowerCase()}`}>
              <span className="ocp-badge">{gk.budget.status}</span>
              <span>
                {formatSpend(gk.budget.spentThisMonthMicroUsd)} spent this month · {formatSpend(gk.budget.remainingMicroUsd)}{' '}
                remaining of {formatSpend(gk.budget.hardStopAtMicroUsd)}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
