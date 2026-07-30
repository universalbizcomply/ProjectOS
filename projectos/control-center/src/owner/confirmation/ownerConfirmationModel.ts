/**
 * Protected-operation owner-confirmation — pure, deterministic model + fail-closed state machine.
 *
 * PROJECTOS-V3-OWNER-PRESENCE-CONFIRMATION-UX1A (Option C1). The ONE universal confirmation contract
 * through which the owner understands, approves, refuses or cancels an exact protected operation BEFORE
 * any Windows user verification (which happens later, host-side, in a separately authorised phase).
 *
 * Security model: the renderer is UNTRUSTED. It may display host-supplied SAFE summary data and collect
 * an Approve/Refuse/Cancel intent; it may NEVER mint authority, claim verification succeeded, or advance
 * itself to a verified/ready/expired/invalidated state. Only host-authoritative events produce those.
 * In this phase those host events are SYNTHETIC preview/test events — no real ceremony, no authority.
 *
 * The renderer payload carries NO nonce, SID, proof id, operation digest, summary digest, credential,
 * token, biometric material, clock-provider internals, or runtime/IPC private identifiers.
 */

export type Environment = 'Local' | 'Staging' | 'Production';
export type Reversibility = 'Reversible' | 'PartiallyReversible' | 'Irreversible';
export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type ImpactFamily =
  | 'MachineConfiguration'
  | 'CustomerData'
  | 'Communication'
  | 'Payment'
  | 'SecurityConfiguration'
  | 'ExternalSystem';
export type EvidencePolicy =
  | 'NotRequired'
  | 'OptionalAvailable'
  | 'OptionalUnavailable'
  | 'RequiredAvailable'
  | 'RequiredUnavailable';

/** Renderer-visible lifecycle state. Fail-closed: unknown transitions never advance authority. */
export type ConfirmationState =
  | 'Requested'
  | 'Reviewing'
  | 'DecisionSubmitting'
  | 'WindowsVerificationRequired'
  | 'VerificationInProgress'
  | 'Verified'
  | 'ReadyForGovernedExecution'
  | 'Refused'
  | 'Cancelled'
  | 'Unavailable'
  | 'Expired'
  | 'Invalidated';

/** Intents the (untrusted) renderer may emit. */
export type RendererIntent =
  | 'Review'
  | 'Approve'
  | 'Refuse'
  | 'Cancel'
  | 'RequestAgain'
  | 'ViewEvidence'
  | 'ViewProgress';

/** Events only the (synthetic, in this phase) host-authoritative controller may apply. */
export type HostEvent =
  | 'DecisionAccepted'
  | 'DecisionRejected'
  | 'VerificationRequired'
  | 'VerificationStarted'
  | 'VerificationVerified'
  | 'VerificationRefused'
  | 'VerificationCancelled'
  | 'VerificationUnavailable'
  | 'RequestExpired'
  | 'RequestInvalidated'
  | 'ReadyForGovernedExecution'
  | 'HostUnavailable';

/**
 * The immutable, host-built SAFE summary the owner sees. Every field is display-only; the host owns the
 * authoritative digest/nonce/identity which never appear here.
 */
export interface ProtectedOperationSummary {
  readonly requestId: string;
  readonly projectName: string;
  readonly repositoryLabel?: string;
  readonly environment: Environment;
  readonly phaseId: string;
  readonly actionTitle: string;
  readonly actionDescription: string;
  readonly affectedResource: string;
  readonly expectedResult: string;
  readonly reversibility: Reversibility;
  readonly riskLevel: RiskLevel;
  readonly impacts: readonly ImpactFamily[];
  readonly reason: string;
  readonly requesterLabel: string;
  readonly expectedDurationLabel: string;
  /** Monotonic-ish preview timestamp (ms) after which the request is expired. Host-authoritative. */
  readonly expiresAt: number;
  readonly evidence: EvidencePolicy;
  readonly advancedDetails?: string;
  /** Host-authoritative current lifecycle state carried alongside the summary. */
  readonly hostState: ConfirmationState;
  /** True in this phase: a synthetic preview that can never create authority or execute an action. */
  readonly syntheticPreview: boolean;
}

/** Field-visibility classification (§ operation-summary contract). */
export type FieldClass = 'always' | 'conditional' | 'advanced' | 'prohibited';

export const FIELD_CLASSIFICATION: Readonly<Record<string, FieldClass>> = {
  projectName: 'always',
  environment: 'always',
  actionTitle: 'always',
  actionDescription: 'always',
  affectedResource: 'always',
  reversibility: 'always',
  riskLevel: 'always',
  expiresAt: 'always',
  reason: 'always',
  requesterLabel: 'always',
  expectedResult: 'always',
  impacts: 'conditional',
  repositoryLabel: 'conditional',
  evidence: 'conditional',
  expectedDurationLabel: 'conditional',
  advancedDetails: 'advanced',
  // Never renderable — the model type deliberately has no such field; listed so the validator can prove
  // none leaks into the payload.
  nonce: 'prohibited',
  sid: 'prohibited',
  proofId: 'prohibited',
  operationDigest: 'prohibited',
  summaryDigest: 'prohibited',
  credential: 'prohibited',
  token: 'prohibited',
  biometric: 'prohibited',
};

/** Identifier keys that must never appear in the renderer-visible summary. */
export const PROHIBITED_SUMMARY_KEYS: readonly string[] = [
  'nonce',
  'sid',
  'proofId',
  'operationDigest',
  'summaryDigest',
  'credential',
  'token',
  'biometric',
];

/** Mandatory fields that must be present for the summary to be approvable. */
const MANDATORY_FIELDS: readonly (keyof ProtectedOperationSummary)[] = [
  'requestId',
  'projectName',
  'environment',
  'phaseId',
  'actionTitle',
  'actionDescription',
  'affectedResource',
  'expectedResult',
  'reversibility',
  'riskLevel',
  'reason',
  'requesterLabel',
  'expiresAt',
  'evidence',
];

const TERMINAL_STATES: ReadonlySet<ConfirmationState> = new Set<ConfirmationState>([
  'Verified',
  'ReadyForGovernedExecution',
  'Refused',
  'Cancelled',
  'Unavailable',
  'Expired',
  'Invalidated',
]);

/** States the renderer must NEVER produce on its own — only a host event may. */
export const HOST_ONLY_STATES: ReadonlySet<ConfirmationState> = new Set<ConfirmationState>([
  'WindowsVerificationRequired',
  'VerificationInProgress',
  'Verified',
  'ReadyForGovernedExecution',
  'Expired',
  'Invalidated',
  'Unavailable',
]);

export function isTerminal(state: ConfirmationState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isExpired(summary: ProtectedOperationSummary, nowMs: number): boolean {
  return nowMs >= summary.expiresAt;
}

export function isProduction(summary: ProtectedOperationSummary): boolean {
  return summary.environment === 'Production';
}

export function isCritical(summary: ProtectedOperationSummary): boolean {
  return summary.riskLevel === 'Critical';
}

export function mandatoryFieldsPresent(summary: ProtectedOperationSummary): boolean {
  return MANDATORY_FIELDS.every((k) => {
    const v = summary[k];
    return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
  });
}

/** Required evidence that is unavailable is a hard, host-authoritative approval blocker. */
export function requiredEvidenceMissing(summary: ProtectedOperationSummary): boolean {
  return summary.evidence === 'RequiredUnavailable';
}

export interface ApprovalGuardInput {
  readonly summary: ProtectedOperationSummary;
  readonly state: ConfirmationState;
  readonly nowMs: number;
  readonly hostAvailable: boolean;
  readonly revisionChanged: boolean;
}

/** Why Approve is disabled, or null if it is enabled. Fail-closed: any doubt disables. */
export function approveBlockReason(input: ApprovalGuardInput): string | null {
  const { summary, state, nowMs, hostAvailable, revisionChanged } = input;
  if (!hostAvailable) return 'unavailable';
  if (isTerminal(state)) return 'terminal';
  if (state === 'DecisionSubmitting' || state === 'VerificationInProgress') return 'in-progress';
  if (state === 'WindowsVerificationRequired') return 'awaiting-verification';
  if (isExpired(summary, nowMs)) return 'expired';
  if (revisionChanged) return 'changed';
  if (requiredEvidenceMissing(summary)) return 'evidence-required';
  if (!mandatoryFieldsPresent(summary)) return 'incomplete';
  return null;
}

export function canApprove(input: ApprovalGuardInput): boolean {
  return approveBlockReason(input) === null;
}

/**
 * Apply a renderer intent. The renderer can ONLY move toward submitting a decision or abandoning —
 * it can never mint a verified/ready/expired/invalidated state. Guarded and fail-closed: an intent that
 * is not valid for the current state (or is blocked) returns the state unchanged.
 */
export function reduceIntent(
  state: ConfirmationState,
  intent: RendererIntent,
  guard: ApprovalGuardInput,
): ConfirmationState {
  switch (intent) {
    case 'Review':
      return state === 'Requested' ? 'Reviewing' : state;
    case 'Approve':
      // Only from an active review, and only when every guard passes.
      return (state === 'Requested' || state === 'Reviewing') && canApprove(guard)
        ? 'DecisionSubmitting'
        : state;
    case 'Refuse':
      return state === 'Requested' || state === 'Reviewing' ? 'Refused' : state;
    case 'Cancel':
      // Cancel abandons the interaction from any non-terminal, pre-verification state.
      return isTerminal(state) || state === 'VerificationInProgress' ? state : 'Cancelled';
    case 'RequestAgain':
      return isTerminal(state) ? 'Requested' : state;
    case 'ViewEvidence':
    case 'ViewProgress':
      return state; // no state change
    default:
      return state; // fail closed
  }
}

/** Apply a host-authoritative event. In this phase these are synthetic preview/test events only. */
export function reduceHostEvent(state: ConfirmationState, event: HostEvent): ConfirmationState {
  // Expiry / invalidation / host-unavailable may interrupt from any non-terminal state (fail closed).
  if (event === 'RequestExpired') return isTerminal(state) ? state : 'Expired';
  if (event === 'RequestInvalidated') return isTerminal(state) ? state : 'Invalidated';
  if (event === 'HostUnavailable') return isTerminal(state) ? state : 'Unavailable';
  switch (event) {
    case 'DecisionAccepted':
      return state === 'DecisionSubmitting' ? 'WindowsVerificationRequired' : state;
    case 'DecisionRejected':
      return state === 'DecisionSubmitting' ? 'Refused' : state;
    case 'VerificationRequired':
      return state === 'DecisionSubmitting' ? 'WindowsVerificationRequired' : state;
    case 'VerificationStarted':
      return state === 'WindowsVerificationRequired' ? 'VerificationInProgress' : state;
    case 'VerificationVerified':
      return state === 'VerificationInProgress' ? 'Verified' : state;
    case 'VerificationRefused':
      return state === 'VerificationInProgress' ? 'Refused' : state;
    case 'VerificationCancelled':
      return state === 'VerificationInProgress' ? 'Cancelled' : state;
    case 'VerificationUnavailable':
      return state === 'WindowsVerificationRequired' || state === 'VerificationInProgress'
        ? 'Unavailable'
        : state;
    case 'ReadyForGovernedExecution':
      return state === 'Verified' ? 'ReadyForGovernedExecution' : state;
    default:
      return state; // fail closed
  }
}

/** Canonical, non-technical copy. One source shared by the component, tests and validator. */
export const CONFIRM_COPY = {
  title: 'ProjectOS needs your approval',
  production: 'This affects the LIVE production environment.',
  staging: 'This affects the staging environment.',
  irreversible: 'This cannot be undone.',
  payment: 'This can move money.',
  communication: 'This can send messages to other people.',
  customerData: 'This can change or expose customer data.',
  machineConfiguration: 'This changes system or security configuration on this machine.',
  securityConfiguration: 'This changes system or security configuration on this machine.',
  externalSystem: 'This can affect an external system.',
  expiry: 'This approval expires in {time}. After that, you will need to approve again.',
  windowsExplanation:
    'Next, Windows will confirm it is really you using Windows Hello or your PIN. ProjectOS never receives your PIN or biometric information.',
  approve: 'Approve this action',
  refuse: 'Refuse',
  cancel: 'Cancel',
  inProgress: 'Waiting for Windows to confirm it is you…',
  verified: 'Your identity was confirmed. The action has not completed yet.',
  ready: 'Approved. ProjectOS can now continue under governance.',
  refused: 'You refused this action. Nothing was changed.',
  cancelled: 'Cancelled. Nothing was changed.',
  unavailable: 'Windows could not verify you right now. Nothing was changed.',
  expired: 'This request expired. Nothing was changed.',
  invalidated: 'The action changed, so a new approval is required.',
  executionClarification:
    'Approving does not mean the action is complete. ProjectOS will run it under governance and show its progress separately.',
  requiredEvidenceBlocker: 'Required evidence is unavailable. This action cannot be approved yet.',
  optionalEvidenceUnavailable: 'Supporting evidence is currently unavailable.',
  syntheticBanner: 'Synthetic UX preview — no authority or action will be created.',
} as const;

/** Impact-family → warning copy. */
export function impactCopy(impact: ImpactFamily): string {
  switch (impact) {
    case 'Payment':
      return CONFIRM_COPY.payment;
    case 'Communication':
      return CONFIRM_COPY.communication;
    case 'CustomerData':
      return CONFIRM_COPY.customerData;
    case 'MachineConfiguration':
      return CONFIRM_COPY.machineConfiguration;
    case 'SecurityConfiguration':
      return CONFIRM_COPY.securityConfiguration;
    case 'ExternalSystem':
      return CONFIRM_COPY.externalSystem;
    default:
      return '';
  }
}

/** Risk → badge tone (reuses the ocp badge tones). */
export function riskTone(risk: RiskLevel): 'ok' | 'warn' | 'crit' {
  if (risk === 'Critical' || risk === 'High') return 'crit';
  if (risk === 'Medium') return 'warn';
  return 'ok';
}

export function environmentTone(env: Environment): 'ok' | 'warn' | 'crit' {
  if (env === 'Production') return 'crit';
  if (env === 'Staging') return 'warn';
  return 'ok';
}
