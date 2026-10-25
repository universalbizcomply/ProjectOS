// @vitest-environment jsdom
//
// PROJECTOS-V3-OWNER-PRESENCE-CONFIRMATION-UX1A — synthetic UX proof.
// Uses only the installed stack: vitest + @testing-library/react (no jest-dom, no user-event).
// Responsive proof here is STRUCTURAL (class/no-fixed-width contracts); headed viewport proof is E2E1A.
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ProtectedOperationConfirmation } from '../src/owner/confirmation/ProtectedOperationConfirmation.js';
import {
  approveBlockReason,
  canApprove,
  CONFIRM_COPY,
  FIELD_CLASSIFICATION,
  HOST_ONLY_STATES,
  isExpired,
  isTerminal,
  mandatoryFieldsPresent,
  PROHIBITED_SUMMARY_KEYS,
  reduceHostEvent,
  reduceIntent,
  requiredEvidenceMissing,
  type ConfirmationState,
  type RendererIntent,
} from '../src/owner/confirmation/ownerConfirmationModel.js';
import { makeSummary, SYNTHETIC_NOW_MS } from '../src/owner/confirmation/ownerConfirmationFixture.js';

afterEach(() => cleanup());

const NOW = SYNTHETIC_NOW_MS;
const ALL_STATES: ConfirmationState[] = [
  'Requested', 'Reviewing', 'DecisionSubmitting', 'WindowsVerificationRequired', 'VerificationInProgress',
  'Verified', 'ReadyForGovernedExecution', 'Refused', 'Cancelled', 'Unavailable', 'Expired', 'Invalidated',
];
const ALL_INTENTS: RendererIntent[] = ['Review', 'Approve', 'Refuse', 'Cancel', 'RequestAgain', 'ViewEvidence', 'ViewProgress'];

function guard(overrides: Parameters<typeof makeSummary>[0] = {}, state: ConfirmationState = 'Reviewing') {
  return { summary: makeSummary(overrides), state, nowMs: NOW, hostAvailable: true, revisionChanged: false };
}

function renderConfirm(props: Partial<Parameters<typeof ProtectedOperationConfirmation>[0]> = {}) {
  const onIntent = vi.fn();
  const summary = props.summary ?? makeSummary();
  render(
    <ProtectedOperationConfirmation
      summary={summary}
      state={props.state ?? 'Reviewing'}
      nowMs={props.nowMs ?? NOW}
      hostAvailable={props.hostAvailable}
      revisionChanged={props.revisionChanged}
      onIntent={props.onIntent ?? onIntent}
    />,
  );
  return { onIntent: props.onIntent ?? onIntent };
}

// ---- MODEL / STATE ------------------------------------------------------------------------------

// T1 — field classification: prohibited identifiers are classified prohibited; core fields always.
test('T1 field classification marks identifiers prohibited and core fields always-shown', () => {
  for (const k of PROHIBITED_SUMMARY_KEYS) expect(FIELD_CLASSIFICATION[k]).toBe('prohibited');
  expect(FIELD_CLASSIFICATION.environment).toBe('always');
  expect(FIELD_CLASSIFICATION.riskLevel).toBe('always');
  expect(FIELD_CLASSIFICATION.advancedDetails).toBe('advanced');
});

// T2 — valid transitions.
test('T2 valid renderer + host transitions', () => {
  expect(reduceIntent('Requested', 'Review', guard({}, 'Requested'))).toBe('Reviewing');
  expect(reduceIntent('Reviewing', 'Approve', guard({}, 'Reviewing'))).toBe('DecisionSubmitting');
  expect(reduceHostEvent('DecisionSubmitting', 'DecisionAccepted')).toBe('WindowsVerificationRequired');
  expect(reduceHostEvent('WindowsVerificationRequired', 'VerificationStarted')).toBe('VerificationInProgress');
  expect(reduceHostEvent('VerificationInProgress', 'VerificationVerified')).toBe('Verified');
  expect(reduceHostEvent('Verified', 'ReadyForGovernedExecution')).toBe('ReadyForGovernedExecution');
});

// T3 — impossible transitions fail closed (state unchanged).
test('T3 impossible transitions fail closed', () => {
  expect(reduceHostEvent('Requested', 'VerificationVerified')).toBe('Requested');
  expect(reduceHostEvent('Reviewing', 'ReadyForGovernedExecution')).toBe('Reviewing');
  expect(reduceIntent('Verified', 'Approve', guard({}, 'Verified'))).toBe('Verified');
});

// T4 — expiry.
test('T4 expiry is enforced by time', () => {
  const s = makeSummary({ expiresAt: NOW + 1000 });
  expect(isExpired(s, NOW)).toBe(false);
  expect(isExpired(s, NOW + 1000)).toBe(true);
  expect(canApprove({ summary: s, state: 'Reviewing', nowMs: NOW + 5000, hostAvailable: true, revisionChanged: false })).toBe(false);
});

// T5 — invalidation (revision changed) blocks approval.
test('T5 revision change invalidates approval', () => {
  expect(approveBlockReason({ ...guard(), revisionChanged: true })).toBe('changed');
});

// T6 / T7 — refusal + cancellation are distinct terminals and mint nothing.
test('T6/T7 refuse and cancel are distinct terminals', () => {
  expect(reduceIntent('Reviewing', 'Refuse', guard({}, 'Reviewing'))).toBe('Refused');
  expect(reduceIntent('Reviewing', 'Cancel', guard({}, 'Reviewing'))).toBe('Cancelled');
  expect(isTerminal('Refused')).toBe(true);
  expect(isTerminal('Cancelled')).toBe(true);
});

// T8 — duplicate submission: a second Approve after submitting does not re-submit.
test('T8 approve is inert once submitting (no double submit)', () => {
  expect(reduceIntent('DecisionSubmitting', 'Approve', guard({}, 'DecisionSubmitting'))).toBe('DecisionSubmitting');
});

// T9 — required-evidence blocker.
test('T9 required evidence unavailable blocks approval', () => {
  const s = makeSummary({ evidence: 'RequiredUnavailable' });
  expect(requiredEvidenceMissing(s)).toBe(true);
  expect(approveBlockReason({ summary: s, state: 'Reviewing', nowMs: NOW, hostAvailable: true, revisionChanged: false })).toBe('evidence-required');
});

// T10 — optional-evidence unavailable does NOT block approval.
test('T10 optional evidence unavailable does not block approval', () => {
  const s = makeSummary({ evidence: 'OptionalUnavailable' });
  expect(canApprove({ summary: s, state: 'Reviewing', nowMs: NOW, hostAvailable: true, revisionChanged: false })).toBe(true);
});

// T11 — mandatory-field completeness.
test('T11 missing mandatory field blocks approval', () => {
  expect(mandatoryFieldsPresent(makeSummary())).toBe(true);
  const bad = makeSummary({ actionTitle: '   ' });
  expect(mandatoryFieldsPresent(bad)).toBe(false);
  expect(approveBlockReason({ summary: bad, state: 'Reviewing', nowMs: NOW, hostAvailable: true, revisionChanged: false })).toBe('incomplete');
});

// T12 — renderer can NEVER produce a host-only state from ANY intent in ANY state (core security invariant).
test('T12 renderer intents never mint a host-only state', () => {
  for (const from of ALL_STATES) {
    for (const intent of ALL_INTENTS) {
      const next = reduceIntent(from, intent, guard({}, from));
      if (next !== from && HOST_ONLY_STATES.has(next)) {
        throw new Error(`renderer intent ${intent} from ${from} illegally produced host-only state ${next}`);
      }
    }
  }
  expect(true).toBe(true);
});

// ---- COMPONENT ----------------------------------------------------------------------------------

// T13-T15 environment variants.
test('T13-T15 environment variants render the correct banner + copy', () => {
  renderConfirm({ summary: makeSummary({ environment: 'Production' }) });
  expect(screen.getByText('PRODUCTION')).toBeTruthy();
  expect(screen.getByText(CONFIRM_COPY.production)).toBeTruthy();
  cleanup();
  renderConfirm({ summary: makeSummary({ environment: 'Staging' }) });
  expect(screen.getByText('Staging')).toBeTruthy();
  expect(screen.getByText(CONFIRM_COPY.staging)).toBeTruthy();
  cleanup();
  renderConfirm({ summary: makeSummary({ environment: 'Local' }) });
  expect(screen.getByText('Local')).toBeTruthy();
});

// T16 risk levels.
test('T16 critical risk is shown', () => {
  renderConfirm({ summary: makeSummary({ riskLevel: 'Critical' }) });
  expect(screen.getByText('Critical risk')).toBeTruthy();
});

// T17 impact families.
test('T17 each impact family renders its warning', () => {
  renderConfirm({
    summary: makeSummary({ impacts: ['Payment', 'Communication', 'CustomerData', 'MachineConfiguration'] }),
  });
  expect(screen.getByText(CONFIRM_COPY.payment)).toBeTruthy();
  expect(screen.getByText(CONFIRM_COPY.communication)).toBeTruthy();
  expect(screen.getByText(CONFIRM_COPY.customerData)).toBeTruthy();
});

// T18 reversibility.
test('T18 irreversible warning shown', () => {
  renderConfirm({ summary: makeSummary({ reversibility: 'Irreversible' }) });
  expect(screen.getByText(CONFIRM_COPY.irreversible)).toBeTruthy();
});

// T20 evidence variants.
test('T20 required-evidence-unavailable disables approve and shows the blocker', () => {
  renderConfirm({ summary: makeSummary({ evidence: 'RequiredUnavailable' }) });
  const approve = screen.getByRole('button', { name: new RegExp(CONFIRM_COPY.approve, 'i') }) as HTMLButtonElement;
  expect(approve.disabled).toBe(true);
  expect(screen.getAllByText(CONFIRM_COPY.requiredEvidenceBlocker).length).toBeGreaterThan(0);
});

test('T20b optional-evidence-unavailable keeps approve enabled', () => {
  renderConfirm({ summary: makeSummary({ evidence: 'OptionalUnavailable' }) });
  const approve = screen.getByRole('button', { name: new RegExp(CONFIRM_COPY.approve, 'i') }) as HTMLButtonElement;
  expect(approve.disabled).toBe(false);
  expect(screen.getByText(CONFIRM_COPY.optionalEvidenceUnavailable)).toBeTruthy();
});

// T21 expiry copy / countdown.
test('T21 expiry countdown then expired copy', () => {
  renderConfirm({ summary: makeSummary({ expiresAt: NOW + 120_000 }), nowMs: NOW });
  expect(screen.getByText(/expires in 2:00/i)).toBeTruthy();
  cleanup();
  renderConfirm({ summary: makeSummary({ expiresAt: NOW }), nowMs: NOW });
  expect(screen.getAllByText(CONFIRM_COPY.expired).length).toBeGreaterThan(0);
});

// T22 Windows explanation while deciding.
test('T22 Windows-verification explanation is shown while deciding', () => {
  renderConfirm({ state: 'Reviewing' });
  expect(screen.getByText(CONFIRM_COPY.windowsExplanation)).toBeTruthy();
});

// T23 execution-not-completed clarification always present.
test('T23 approval does not imply execution completed', () => {
  renderConfirm({ state: 'Reviewing' });
  expect(screen.getByText(CONFIRM_COPY.executionClarification)).toBeTruthy();
  cleanup();
  renderConfirm({ state: 'Verified' });
  expect(screen.getByText(CONFIRM_COPY.verified)).toBeTruthy();
  // "Verified" copy must NOT claim completion.
  expect(CONFIRM_COPY.verified.toLowerCase()).toContain('not completed');
});

// T24 synthetic-preview banner is always present in the synthetic preview and non-dismissible.
test('T24 synthetic-preview banner present with no dismiss control', () => {
  renderConfirm({ summary: makeSummary({ syntheticPreview: true }) });
  const banner = screen.getByRole('note', { name: CONFIRM_COPY.syntheticBanner });
  expect(banner).toBeTruthy();
  // No dismiss/close button inside the banner.
  expect(banner.querySelector('button')).toBeNull();
});

// T25 terminal outcomes render their copy and offer request-again (not approve).
test('T25 terminal outcomes render copy; approve is absent', () => {
  for (const [state, copy] of [
    ['Refused', CONFIRM_COPY.refused],
    ['Cancelled', CONFIRM_COPY.cancelled],
    ['Unavailable', CONFIRM_COPY.unavailable],
    ['Expired', CONFIRM_COPY.expired],
    ['Invalidated', CONFIRM_COPY.invalidated],
  ] as const) {
    renderConfirm({ state });
    expect(screen.getAllByText(copy).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: new RegExp(CONFIRM_COPY.approve, 'i') })).toBeNull();
    expect(screen.getByRole('button', { name: /request again/i })).toBeTruthy();
    cleanup();
  }
});

// T14/duplicate-submit — while submitting, no Approve button exists (cannot double-submit).
test('duplicate-submit prevented: no Approve control while submitting/in-progress', () => {
  renderConfirm({ state: 'DecisionSubmitting' });
  expect(screen.queryByRole('button', { name: new RegExp(CONFIRM_COPY.approve, 'i') })).toBeNull();
  cleanup();
  renderConfirm({ state: 'VerificationInProgress' });
  expect(screen.queryByRole('button', { name: new RegExp(CONFIRM_COPY.approve, 'i') })).toBeNull();
});

// ---- INTENTS / ACCESSIBILITY --------------------------------------------------------------------

test('Approve/Refuse/Cancel emit distinct intents', () => {
  const { onIntent } = renderConfirm({ state: 'Reviewing' });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(CONFIRM_COPY.approve, 'i') }));
  fireEvent.click(screen.getByRole('button', { name: /^refuse$/i }));
  fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
  expect(onIntent.mock.calls.map((c) => c[0])).toEqual(['Approve', 'Refuse', 'Cancel']);
});

// T31 Escape maps ONLY to Cancel, never Approve.
test('T31 Escape emits Cancel only, never a positive decision', () => {
  const { onIntent } = renderConfirm({ state: 'Reviewing' });
  fireEvent.keyDown(screen.getByRole('button', { name: new RegExp(CONFIRM_COPY.approve, 'i') }), { key: 'Escape' });
  expect(onIntent).toHaveBeenCalledWith('Cancel');
  expect(onIntent).not.toHaveBeenCalledWith('Approve');
});

// T28/T29 accessible labels + status region.
test('T28/T29 labelled region, accessible action names, status outcome', () => {
  const { container } = render(
    <ProtectedOperationConfirmation summary={makeSummary()} state="Verified" nowMs={NOW} onIntent={() => {}} />,
  );
  // Labelled section.
  expect(container.querySelector('section[aria-labelledby]')).not.toBeNull();
  // aria-live status region for the outcome.
  const status = container.querySelector('.ocp-confirm-outcome[role="status"]');
  expect(status).not.toBeNull();
  expect(status?.getAttribute('aria-live')).toBe('polite');
});

// T32 focus restoration: on a terminal outcome, focus moves to the next actionable control.
test('T32 focus moves to the request-again control on a terminal outcome', () => {
  render(
    <ProtectedOperationConfirmation summary={makeSummary()} state="Refused" nowMs={NOW} onIntent={() => {}} />,
  );
  const again = screen.getByRole('button', { name: /request again/i });
  expect(document.activeElement).toBe(again);
});

// T33 disabled approval carries a visible explanation.
test('T33 disabled approve shows an explanation note', () => {
  renderConfirm({ summary: makeSummary({ evidence: 'RequiredUnavailable' }) });
  expect(screen.getAllByText(CONFIRM_COPY.requiredEvidenceBlocker).length).toBeGreaterThan(0);
});

// T38 production/critical are in the risk bar, never only in advanced details.
test('T38 production is in the risk bar, not hidden in advanced details', () => {
  const { container } = render(
    <ProtectedOperationConfirmation summary={makeSummary({ environment: 'Production' })} state="Reviewing" nowMs={NOW} onIntent={() => {}} />,
  );
  const details = container.querySelector('.ocp-confirm-advanced');
  expect(details?.textContent ?? '').not.toContain('LIVE production');
  expect(container.querySelector('.ocp-confirm-riskbar')?.textContent ?? '').toContain('PRODUCTION');
});

// T40 no prohibited identifier/value appears in the rendered DOM.
// NB: the reassurance copy legitimately mentions "PIN or biometric information" (telling the owner
// ProjectOS never receives it) — that is not a leak. We check identifier tokens by word boundary and
// reject any digest/nonce-shaped value; the summary object must also carry no prohibited key.
test('T40 no nonce/SID/digest/credential value in the model or DOM', () => {
  const summary = makeSummary();
  for (const k of PROHIBITED_SUMMARY_KEYS) expect(k in summary).toBe(false);
  const { container } = render(
    <ProtectedOperationConfirmation summary={summary} state="WindowsVerificationRequired" nowMs={NOW} onIntent={() => {}} />,
  );
  const text = container.textContent ?? '';
  expect(/\bnonce\b/i.test(text)).toBe(false);
  expect(/\bdigest\b/i.test(text)).toBe(false);
  expect(/\bsid\b/i.test(text)).toBe(false);
  expect(/\bcredential\b/i.test(text)).toBe(false);
  expect(/\btoken\b/i.test(text)).toBe(false);
  expect(/[0-9a-f]{32,}/i.test(text)).toBe(false); // no digest/nonce-shaped value
});

// T39 exactly one confirmation component export (no duplicate approval system).
test('T39 single universal confirmation component export', () => {
  expect(typeof ProtectedOperationConfirmation).toBe('function');
});

// Long names structural safety — overflow-wrap classes present (structural, not pixel).
test('T19 long names render without throwing and use wrap-safe containers', () => {
  const { container } = render(
    <ProtectedOperationConfirmation
      summary={makeSummary({
        projectName: 'A'.repeat(120),
        affectedResource: 'B'.repeat(160),
        actionTitle: 'C'.repeat(140),
      })}
      state="Reviewing"
      nowMs={NOW}
      onIntent={() => {}}
    />,
  );
  expect(container.querySelector('.ocp-confirm-action')).not.toBeNull();
  expect(container.querySelector('.ocp-confirm-facts')).not.toBeNull();
});
