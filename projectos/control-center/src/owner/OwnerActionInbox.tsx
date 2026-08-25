/**
 * Owner Action Inbox — every PENDING `.projectops/approvals/<id>.json` record, with real
 * Approve/Reject buttons wired to `approval.decide`.
 *
 * This is the route Product Completion required and none existed: `approval.decide` was already a
 * governed verb the runtime honoured end-to-end, but the only buttons in the app that looked like
 * they decided an approval (in Safety) were permanently `disabled` and backed a synthetic fixture.
 * An owner clicking them got nothing, silently. This panel reads the same canonical records the CLI
 * reads and decides the same way the CLI decides — through the governed command channel, never a
 * direct write.
 *
 * Deliberately NOT here: any optimistic update. A decision re-emits governed state from the sidecar,
 * so the list repaints from re-read durable truth, same discipline as GovernedActions.
 */
import { useState } from 'react';
import { tauriBridge } from '../daemon/tauriBridge';
import { requestGovernedCommand } from '../governed/governedClient';
import type { GovernedApprovalView, GovernedProjection } from '../governed/types';

interface DecisionState {
  readonly busyId: string | null;
  readonly lines: readonly string[];
  readonly failed: boolean;
}

export function OwnerActionInbox({ state }: { state: GovernedProjection }) {
  const [decision, setDecision] = useState<DecisionState>({ busyId: null, lines: [], failed: false });
  const items = state.pendingApprovals;

  async function decide(item: GovernedApprovalView, outcome: 'approved' | 'rejected') {
    setDecision({ busyId: item.id, lines: [`Asking the runtime to ${outcome === 'approved' ? 'approve' : 'reject'} ${item.action}…`], failed: false });
    const result = await requestGovernedCommand(tauriBridge, 'approval.decide', {
      approvalId: item.id,
      decision: outcome,
      role: 'implementer',
    });
    setDecision({ busyId: null, lines: result.lines, failed: !result.ok });
  }

  return (
    <div className="ocp-panel ocp-inbox">
      <h2>Action inbox</h2>
      {items.length === 0 ? (
        <p className="ocp-empty">Nothing is waiting for your decision.</p>
      ) : (
        <ul className="ocp-inbox-list">
          {items.map((item) => (
            <li key={item.id} className={`ocp-inbox-item${item.prohibited ? ' crit' : ''}`}>
              <div className="ocp-inbox-head">
                <span className="ocp-inbox-action">{item.action}</span>
                <span className={`ocp-badge ${item.prohibited ? 'crit' : item.gated ? 'warn' : 'mut'}`}>
                  {item.risk || 'risk unrecorded'}
                </span>
              </div>
              <p className="ocp-sub">
                Requested by {item.requestedBy || 'unknown'}
                {item.requestedAt !== '' ? ` · ${item.requestedAt}` : ''}
              </p>
              {item.prohibited ? (
                <p className="ocp-empty">
                  This action is prohibited and cannot be approved from here. It requires you to act
                  outside ProjectOS.
                </p>
              ) : (
                <div className="ocp-actionrow">
                  <button
                    type="button"
                    className="ocp-btn primary"
                    disabled={decision.busyId === item.id}
                    onClick={() => void decide(item, 'approved')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="ocp-btn danger"
                    disabled={decision.busyId === item.id}
                    onClick={() => void decide(item, 'rejected')}
                  >
                    Reject
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {decision.lines.length > 0 && (
        <p className={`ocp-actionmsg${decision.failed ? ' crit' : ''}`} role="status" aria-live="polite">
          {decision.lines.join(' ')}
        </p>
      )}
    </div>
  );
}
