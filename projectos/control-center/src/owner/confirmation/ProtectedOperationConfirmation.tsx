/**
 * ProtectedOperationConfirmation — the ONE universal, no-training owner-confirmation surface.
 *
 * PROJECTOS-V3-OWNER-PRESENCE-CONFIRMATION-UX1A (Option C1). Presentational + untrusted: it renders a
 * host-supplied SAFE summary, collects an Approve/Refuse/Cancel intent, and reflects host-authoritative
 * state. It NEVER mints authority, claims Windows verification succeeded, or advances itself to a
 * verified/ready/expired/invalidated state. All state transitions come from the parent via props; the
 * renderer only emits intents. In this phase the driving state is SYNTHETIC preview state.
 */
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import {
  approveBlockReason,
  CONFIRM_COPY,
  environmentTone,
  impactCopy,
  isExpired,
  isTerminal,
  riskTone,
  type ConfirmationState,
  type ProtectedOperationSummary,
  type RendererIntent,
} from './ownerConfirmationModel';

interface Props {
  readonly summary: ProtectedOperationSummary;
  readonly state: ConfirmationState;
  readonly nowMs: number;
  readonly hostAvailable?: boolean;
  readonly revisionChanged?: boolean;
  readonly onIntent: (intent: RendererIntent) => void;
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

/** The plain-language outcome message for a host-authoritative state, or null while still deciding. */
function outcomeMessage(state: ConfirmationState): string | null {
  switch (state) {
    case 'DecisionSubmitting':
    case 'VerificationInProgress':
      return CONFIRM_COPY.inProgress;
    case 'WindowsVerificationRequired':
      return CONFIRM_COPY.windowsExplanation;
    case 'Verified':
      return CONFIRM_COPY.verified;
    case 'ReadyForGovernedExecution':
      return CONFIRM_COPY.ready;
    case 'Refused':
      return CONFIRM_COPY.refused;
    case 'Cancelled':
      return CONFIRM_COPY.cancelled;
    case 'Unavailable':
      return CONFIRM_COPY.unavailable;
    case 'Expired':
      return CONFIRM_COPY.expired;
    case 'Invalidated':
      return CONFIRM_COPY.invalidated;
    default:
      return null;
  }
}

function disabledNote(reason: string): string {
  switch (reason) {
    case 'evidence-required':
      return CONFIRM_COPY.requiredEvidenceBlocker;
    case 'expired':
      return CONFIRM_COPY.expired;
    case 'changed':
      return CONFIRM_COPY.invalidated;
    case 'unavailable':
      return CONFIRM_COPY.unavailable;
    default:
      return '';
  }
}

export function ProtectedOperationConfirmation({
  summary,
  state,
  nowMs,
  hostAvailable = true,
  revisionChanged = false,
  onIntent,
}: Props) {
  const titleId = useId();
  const impactsId = useId();
  // Focus restoration: when the flow reaches an outcome that offers a next control, move focus to it so
  // a keyboard/screen-reader user is taken to the actionable result rather than left on a stale control.
  const outcomeControlRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (outcomeControlRef.current) outcomeControlRef.current.focus();
  }, [state]);
  const guard = { summary, state, nowMs, hostAvailable, revisionChanged };
  const blockReason = approveBlockReason(guard);
  const approveDisabled = blockReason !== null;
  const deciding = state === 'Requested' || state === 'Reviewing';
  const terminal = isTerminal(state);
  const outcome = outcomeMessage(state);
  const expired = isExpired(summary, nowMs);
  const envTone = environmentTone(summary.environment);
  const rTone = riskTone(summary.riskLevel);

  // Escape maps ONLY to Cancel, and never approves — and never from a terminal/in-progress state.
  function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape' && !terminal && state !== 'VerificationInProgress') {
      e.stopPropagation();
      onIntent('Cancel');
    }
  }

  return (
    <section
      className="ocp-panel ocp-confirm"
      aria-labelledby={titleId}
      onKeyDown={handleKeyDown}
    >
      {/* 1. Synthetic-preview banner — persistent, non-dismissible, announced. */}
      {summary.syntheticPreview && (
        <div className="ocp-confirm-synthetic" role="note" aria-label={CONFIRM_COPY.syntheticBanner}>
          {CONFIRM_COPY.syntheticBanner} No Windows verification is performed and no protected action can
          execute.
        </div>
      )}

      {/* 2. Environment + risk banner — production/critical can never be hidden. */}
      <div className="ocp-confirm-riskbar">
        <span className={`ocp-badge lg ${envTone}`} aria-label={`Environment ${summary.environment}`}>
          {summary.environment === 'Production'
            ? 'PRODUCTION'
            : summary.environment === 'Staging'
              ? 'Staging'
              : 'Local'}
        </span>
        <span className={`ocp-badge ${rTone}`} aria-label={`Risk ${summary.riskLevel}`}>
          {summary.riskLevel} risk
        </span>
        {summary.environment === 'Production' && (
          <span className="ocp-confirm-envnote crit">{CONFIRM_COPY.production}</span>
        )}
        {summary.environment === 'Staging' && (
          <span className="ocp-confirm-envnote warn">{CONFIRM_COPY.staging}</span>
        )}
      </div>

      {/* 3. Title */}
      <h2 id={titleId} className="ocp-confirm-title">
        {CONFIRM_COPY.title}
      </h2>

      {/* 4. Requested action */}
      <p className="ocp-confirm-action">{summary.actionTitle}</p>
      <p className="ocp-confirm-desc">{summary.actionDescription}</p>

      {/* 5. Project + resource */}
      <dl className="ocp-confirm-facts">
        <div>
          <dt>Project</dt>
          <dd>{summary.projectName}</dd>
        </div>
        {summary.repositoryLabel && (
          <div>
            <dt>Repository</dt>
            <dd className="mono">{summary.repositoryLabel}</dd>
          </div>
        )}
        <div>
          <dt>Affected resource</dt>
          <dd>{summary.affectedResource}</dd>
        </div>
        <div>
          <dt>Expected result</dt>
          <dd>{summary.expectedResult}</dd>
        </div>
        {/* 6. Reversibility */}
        <div>
          <dt>Reversible?</dt>
          <dd className={summary.reversibility === 'Irreversible' ? 'crit' : ''}>
            {summary.reversibility === 'Irreversible'
              ? CONFIRM_COPY.irreversible
              : summary.reversibility === 'PartiallyReversible'
                ? 'Partially reversible.'
                : 'Reversible.'}
          </dd>
        </div>
        {/* 8. Reason + requester */}
        <div>
          <dt>Reason</dt>
          <dd>{summary.reason}</dd>
        </div>
        <div>
          <dt>Requested by</dt>
          <dd>{summary.requesterLabel}</dd>
        </div>
        <div>
          <dt>Expected duration</dt>
          <dd>{summary.expectedDurationLabel}</dd>
        </div>
      </dl>

      {/* 7. Impact warnings */}
      {summary.impacts.length > 0 && (
        <ul className="ocp-confirm-impacts" aria-labelledby={impactsId}>
          <li className="ocp-confirm-impacts-h" id={impactsId} aria-hidden="true">
            This action can:
          </li>
          {summary.impacts.map((impact) => (
            <li key={impact} className="ocp-confirm-impact">
              {impactCopy(impact)}
            </li>
          ))}
        </ul>
      )}

      {/* 9. Expiry countdown (plain text; the host-authoritative outcome region below is the live region) */}
      <p className="ocp-confirm-expiry">
        {expired
          ? CONFIRM_COPY.expired
          : CONFIRM_COPY.expiry.replace('{time}', formatRemaining(summary.expiresAt - nowMs))}
      </p>

      {/* 10. Evidence */}
      {summary.evidence !== 'NotRequired' && (
        <div className="ocp-confirm-evidence">
          {(summary.evidence === 'OptionalAvailable' || summary.evidence === 'RequiredAvailable') && (
            <button type="button" className="ocp-btn" onClick={() => onIntent('ViewEvidence')}>
              View supporting evidence{summary.evidence === 'RequiredAvailable' ? ' (required)' : ''}
            </button>
          )}
          {summary.evidence === 'OptionalUnavailable' && (
            <p className="ocp-confirm-note">{CONFIRM_COPY.optionalEvidenceUnavailable}</p>
          )}
          {summary.evidence === 'RequiredUnavailable' && (
            <p className="ocp-confirm-note crit">{CONFIRM_COPY.requiredEvidenceBlocker}</p>
          )}
        </div>
      )}

      {/* 11. What happens after approval */}
      <p className="ocp-confirm-clarify">{CONFIRM_COPY.executionClarification}</p>
      {(deciding || state === 'WindowsVerificationRequired') && (
        <p className="ocp-confirm-windows">{CONFIRM_COPY.windowsExplanation}</p>
      )}

      {/* Outcome / status — host-authoritative, announced. */}
      {outcome && (
        <p
          className={`ocp-confirm-outcome ${state === 'Unavailable' || state === 'Expired' || state === 'Invalidated' ? 'crit' : ''}`}
          role="status"
          aria-live="polite"
        >
          {outcome}
        </p>
      )}

      {/* 12. Decision controls */}
      <div className="ocp-confirm-actions">
        {deciding && (
          <>
            <button
              type="button"
              className="ocp-btn primary"
              disabled={approveDisabled}
              aria-disabled={approveDisabled}
              onClick={() => onIntent('Approve')}
            >
              {CONFIRM_COPY.approve}
            </button>
            <button type="button" className="ocp-btn" onClick={() => onIntent('Refuse')}>
              {CONFIRM_COPY.refuse}
            </button>
            <button type="button" className="ocp-btn" onClick={() => onIntent('Cancel')}>
              {CONFIRM_COPY.cancel}
            </button>
            {approveDisabled && disabledNote(blockReason ?? '') && (
              <p className="ocp-confirm-blocked" role="status">
                {disabledNote(blockReason ?? '')}
              </p>
            )}
          </>
        )}
        {(state === 'DecisionSubmitting' ||
          state === 'WindowsVerificationRequired' ||
          state === 'VerificationInProgress') && (
          <button type="button" className="ocp-btn" onClick={() => onIntent('Cancel')}>
            {CONFIRM_COPY.cancel}
          </button>
        )}
        {state === 'ReadyForGovernedExecution' && (
          <button
            type="button"
            className="ocp-btn primary"
            ref={outcomeControlRef}
            onClick={() => onIntent('ViewProgress')}
          >
            View progress
          </button>
        )}
        {terminal && state !== 'Verified' && state !== 'ReadyForGovernedExecution' && (
          <button
            type="button"
            className="ocp-btn"
            ref={outcomeControlRef}
            onClick={() => onIntent('RequestAgain')}
          >
            Request again
          </button>
        )}
      </div>

      {/* 13. Advanced technical details — never hides production/critical (those are above). */}
      {summary.advancedDetails && (
        <details className="ocp-confirm-advanced">
          <summary>Advanced details</summary>
          <p>{summary.advancedDetails}</p>
        </details>
      )}
    </section>
  );
}
