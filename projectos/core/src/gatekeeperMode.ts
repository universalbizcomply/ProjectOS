/**
 * HYBRID GATEKEEPER ROUTING — the two ways a gatekeeper decision may be obtained, and the provenance
 * each one leaves behind.
 *
 * ONE WORKFLOW, TWO ACQUISITION PATHS. A project runs its phases the same way whichever mode it is in:
 * the same phase record, the same evidence pack, the same decision contract (`checkGatekeeperDecision`),
 * the same owner-only floor, the same technical-continuation executor and the same closure machinery.
 * The only thing the mode changes is HOW the gatekeeper's answer reaches the loop:
 *
 *   interactive  the owner is working with the ChatGPT gatekeeper. ProjectOS writes the question down,
 *                the owner carries it to ChatGPT, and ChatGPT's bound decision is handed back. Nothing
 *                here automates a browser, a cookie or a chat session.
 *   unattended   ProjectOSHost asks an independent provider and ATTESTS what it returned. The loop never
 *                calls a provider itself in this mode.
 *
 * PROVENANCE IS DECIDED BY THE ROUTE, NEVER BY THE RECORD. A decision record says what was decided; it
 * does not get to say how it was obtained. The route that received it stamps the provenance, and an
 * interactively supplied record that carries any field claiming a provenance or an attestation is
 * refused outright — so interactive evidence cannot be relabelled as Host-independent evidence by
 * writing a field into it.
 *
 * NO FALLBACK IN EITHER DIRECTION. A mode that cannot obtain a decision WAITS and reports; it never
 * tries the other mode and it never lets the implementer answer its own question.
 *
 * WHAT THIS CANNOT PROMISE, stated plainly. ProjectOS remains `MANUAL_GOVERNANCE_APPROVAL` with
 * `tamperProof: false`. The Host attestation is checked here for BINDING — that it answers this exact
 * request, agrees with the decision it accompanies, and states a known cost — not for a signature,
 * because none crosses into this process. Its cryptographic weight lives on the Host side, in
 * `projectos/host/gatekeeper-attestation`, where the attestation is minted only after the signed
 * execution closure verified.
 *
 * Created in PROJECTOS-HYBRID-GATEKEEPER-ROUTING1A.
 */
import { createHash } from 'node:crypto';
import {
  GATEKEEPER_VERDICTS,
  type GatekeeperDecisionRecord,
  type GatekeeperRequest,
  type GatekeeperVerdict,
} from './gatekeeperDecision.js';
import type { GatekeeperUnavailabilityCause } from './gatekeeperTransport.js';

/** The two gatekeeper modes. CLOSED: a third value is a configuration error, not a new mode. */
export const GATEKEEPER_MODES = ['interactive', 'unattended'] as const;
export type GatekeeperMode = (typeof GATEKEEPER_MODES)[number];

/** The mode of a project that has configured no gatekeeper at all — the owner relaying to ChatGPT. */
export const DEFAULT_GATEKEEPER_MODE: GatekeeperMode = 'interactive';

export function isGatekeeperMode(value: unknown): value is GatekeeperMode {
  return typeof value === 'string' && (GATEKEEPER_MODES as readonly string[]).includes(value);
}

/**
 * The two evidence classes a gatekeeper decision may carry. Downstream handling of ALLOW and REFUSE is
 * shared; the class is never erased.
 */
export const GATEKEEPER_PROVENANCES = [
  'InteractiveGatekeeperDecision',
  'HostIndependentProviderAttestation',
] as const;
export type GatekeeperProvenance = (typeof GATEKEEPER_PROVENANCES)[number];

/**
 * What the route that obtained a decision stamps onto its evidence. Never read from the record itself.
 * `hostAttestationId` is present exactly when the class is `HostIndependentProviderAttestation`.
 */
export interface DecisionProvenanceStamp {
  readonly kind: GatekeeperProvenance;
  readonly hostAttestationId?: string;
}

/** The provenance each mode produces. One route, one class. */
export function provenanceOfMode(mode: GatekeeperMode): GatekeeperProvenance {
  return mode === 'interactive' ? 'InteractiveGatekeeperDecision' : 'HostIndependentProviderAttestation';
}

/**
 * Fields an interactively supplied decision may never carry.
 *
 * Each would let the record describe how it was obtained, which is the route's to say. Matched
 * case-insensitively over own property names, for the reason `gatekeeperBridge.ts` gives: an exact-case
 * denylist over keys the far end chooses is not a denylist.
 */
export const PROVENANCE_CLAIM_FIELDS: readonly string[] = [
  'provenance',
  'hostAttestation',
  'attestation',
  'attestationId',
  'hostAttestationId',
  'providerResponseId',
];

/** The provenance-claiming fields present on this record, or `[]`. */
export function provenanceClaimsIn(record: unknown): readonly string[] {
  if (record === null || typeof record !== 'object') return [];
  const forbidden = PROVENANCE_CLAIM_FIELDS.map((f) => f.toLowerCase());
  return Object.getOwnPropertyNames(record).filter((k) => forbidden.includes(k.toLowerCase()));
}

// -------------------------------------------------------------------------------------------------
// HOST-INDEPENDENT PROVIDER ATTESTATION
// -------------------------------------------------------------------------------------------------

/**
 * The closed verdicts the Host normalises a provider answer into — `ReviewVerdict` in
 * `projectos/host/gatekeeper-attestation/src/operation.rs`, spelt as its variants are.
 */
export const HOST_REVIEW_VERDICTS = ['ApprovedToProceed', 'OwnerApprovalRequired', 'ChangesRequired'] as const;
export type HostReviewVerdict = (typeof HOST_REVIEW_VERDICTS)[number];

/**
 * Which Host verdict a gatekeeper verdict must travel with.
 *
 * EXHAUSTIVE BY TYPE, so a verdict added to the vocabulary without a Host counterpart is a compile
 * error rather than a silently unmatched attestation. Every owner-gated verdict maps to
 * `OwnerApprovalRequired`: an attestation cannot turn a recommendation into a permission.
 */
export const HOST_VERDICT_FOR: { readonly [V in GatekeeperVerdict]: HostReviewVerdict } = {
  APPROVED_TO_PROCEED: 'ApprovedToProceed',
  AMENDMENT_REQUIRED: 'ChangesRequired',
  DO_NOT_PROCEED: 'ChangesRequired',
  AWAITING_OWNER: 'OwnerApprovalRequired',
  APPROVED_TO_COMMIT: 'OwnerApprovalRequired',
  APPROVED_TO_PUSH: 'OwnerApprovalRequired',
  APPROVED_FOR_CLOSURE: 'OwnerApprovalRequired',
};

/**
 * The Host attestation as it reaches this process — the read-only accessors of the Rust
 * `HostAttestation`, rendered as JSON. Every field is untrusted until `checkHostAttestation` accepts it.
 */
export interface HostAttestationSummary {
  readonly schemaVersion?: unknown;
  readonly attestationId?: unknown;
  readonly requestCorrelation?: unknown;
  readonly providerResponseId?: unknown;
  readonly provider?: unknown;
  readonly model?: unknown;
  readonly verdict?: unknown;
  readonly allowedActions?: unknown;
  readonly ownerApprovalRequired?: unknown;
  /** REVISION 1 ONLY. The historical records' cost field; revision 1 keeps its schema. */
  readonly costMicroUsd?: unknown;
  /**
   * REVISION 2 ONLY. What the Host ADMITTED against the budget for this review - the owner-signed
   * amount it reserved. It is NOT a provider cost: the Host has no rate card, so revision 2 states no
   * accounted or billed figure at all, and a revision 2 attestation carrying `costMicroUsd` is refused.
   */
  readonly admittedCostMicroUsd?: unknown;
  readonly attestedAtEpochS?: unknown;
}

/**
 * The 16-byte correlation the Host's authority wire carries for this request, as lower-case hex.
 *
 * DERIVED FROM THE REQUEST ID, NEVER ALLOCATED, for the reason the request id itself is derived: a
 * restart re-derives the same correlation, so the Host's one-shot inbox refuses a second asking of the
 * same question instead of paying for it twice.
 */
export function hostCorrelationFor(requestId: string): string {
  return createHash('sha256').update(`projectos-host-correlation-v1:${requestId}`, 'utf8').digest('hex').slice(0, 32);
}

const HEX64 = /^[0-9a-f]{64}$/;

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Why this attestation does not vouch for this decision, or `[]` when it does. Pure — no I/O.
 *
 * WHAT IS CHECKED IS AGREEMENT, and every disagreement refuses. The attestation must answer THIS
 * request (correlation), and must say the same thing as the decision it accompanies: the same verdict
 * class, the same permitted actions, the same owner-approval flag. An attestation that vouches for a
 * different answer than the one being applied is not evidence for it. A cost nobody can state is
 * refused rather than read as free — the Host's own rule, restated at this boundary.
 */
export function checkHostAttestation(
  attestation: HostAttestationSummary | null,
  expect: { readonly requestId: string; readonly record: GatekeeperDecisionRecord },
): readonly string[] {
  const verdict = expect.record.decision;
  const expected =
    typeof verdict === 'string' && (GATEKEEPER_VERDICTS as readonly string[]).includes(verdict)
      ? HOST_VERDICT_FOR[verdict as GatekeeperVerdict]
      : null;
  const decided = Array.isArray(expect.record.allowedActions) ? expect.record.allowedActions.map(String) : null;
  return hostAttestationProblems(attestation, expect.requestId, {
    verdict,
    expectedHostVerdict: expected,
    allowedActions: decided,
    ownerApprovalRequired: expect.record.ownerApprovalRequired,
  });
}

/**
 * The checks every Host attestation shares, whatever contract its answer belongs to: bound to THIS
 * request, and agreeing with the answer it accompanies on verdict class, permitted actions and the
 * owner-approval flag, at a stated cost. Exported so the closure contract (`closureTransport.ts`)
 * applies these exact checks rather than a copy.
 */
export function hostAttestationProblems(
  attestation: HostAttestationSummary | null,
  requestId: string,
  answer: {
    readonly verdict: unknown;
    readonly expectedHostVerdict: HostReviewVerdict | null;
    readonly allowedActions: readonly string[] | null;
    readonly ownerApprovalRequired: unknown;
  },
): readonly string[] {
  if (attestation === null || typeof attestation !== 'object') {
    return [
      'no Host attestation accompanied this decision; an unattested answer is not Host-independent ' +
        'evidence and unattended mode does not accept one',
    ];
  }
  const e: string[] = [];
  // REVISION 1 OR 2, AND THIS IS NOT WHERE EVIDENCE IS BOUND. Revision 2 (PROJECTOS-HOST-REVIEW-PATH1B)
  // adds the approved baseline and the candidate-evidence digest. This check reads the SUMMARY, whose
  // shape both revisions share, so it accepts either. The evidence binding is enforced where a real
  // Host answer becomes a summary at all - `readHostResponseRecord`, which requires revision 2 exactly
  // and compares the digest the agent recomputed - so no summary produced from Host bytes reaches this
  // line without it.
  if (attestation.schemaVersion !== 1 && attestation.schemaVersion !== 2) {
    e.push('Host attestation schemaVersion is not a revision this agent knows (1 or 2)');
  }
  if (typeof attestation.attestationId !== 'string' || !HEX64.test(attestation.attestationId)) {
    e.push('Host attestation carries no usable attestationId');
  }
  if (attestation.requestCorrelation !== hostCorrelationFor(requestId)) {
    e.push(`Host attestation answers a different request than ${requestId}`);
  }
  if (!nonEmpty(attestation.providerResponseId)) e.push('Host attestation names no provider response');
  if (!nonEmpty(attestation.provider) || !nonEmpty(attestation.model)) {
    e.push('Host attestation does not name the provider and model that answered');
  }

  if (!(HOST_REVIEW_VERDICTS as readonly unknown[]).includes(attestation.verdict)) {
    e.push('Host attestation carries no recognised verdict');
  } else if (answer.expectedHostVerdict === null || attestation.verdict !== answer.expectedHostVerdict) {
    e.push(
      `Host attested ${String(attestation.verdict)}, which does not match the decision ` +
        `${JSON.stringify(answer.verdict)} it accompanies`,
    );
  }

  const attested = Array.isArray(attestation.allowedActions) ? attestation.allowedActions.map(String) : null;
  const decided = answer.allowedActions;
  if (attested === null || decided === null || [...attested].sort().join('\n') !== [...decided].sort().join('\n')) {
    e.push('Host attestation permits different actions than the decision it accompanies');
  }
  if (attestation.ownerApprovalRequired !== answer.ownerApprovalRequired) {
    e.push('Host attestation disagrees with the decision about whether the owner must still approve');
  }
  // AN ADMITTED AMOUNT IS NOT A COST, AND EACH REVISION SAYS ONLY WHAT IT KNOWS. Revision 1 keeps its
  // schema: a known `costMicroUsd`. Revision 2 states the amount the Host ADMITTED against the budget,
  // under its own name, and must not also carry a cost: the Host has no rate card, so a revision 2
  // attestation that claims one is claiming something nobody measured.
  const known = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (attestation.schemaVersion === 2) {
    if (!known(attestation.admittedCostMicroUsd)) {
      e.push('Host attestation states no admitted amount; an unknown amount is refused, never read as free');
    }
    if (attestation.costMicroUsd !== undefined) {
      e.push('Host attestation revision 2 claims a provider cost; it may state only the amount it admitted');
    }
  } else {
    if (!known(attestation.costMicroUsd)) {
      e.push('Host attestation states no known cost; an unknown cost is refused, never read as free');
    }
    if (attestation.admittedCostMicroUsd !== undefined) {
      e.push('Host attestation revision 1 carries an admitted amount; that field belongs to revision 2');
    }
  }
  const at = attestation.attestedAtEpochS;
  if (typeof at !== 'number' || !Number.isSafeInteger(at) || at <= 0) {
    e.push('Host attestation records no attestation time');
  }
  return e;
}

/**
 * The call the loop makes to reach the Host-attested review. Carries the question, never a credential.
 *
 * `body` is the exact provider request the Host will send; the Host binds it to the digest its
 * authority wire carries before anything is executed (`accept_request_body`).
 */
export interface HostReviewCall {
  readonly request: GatekeeperRequest;
  readonly requestDigest: string;
  readonly correlation: string;
  readonly body: string;
}

export type HostReviewOutcome =
  | {
      readonly kind: 'attested';
      /** The provider's decision as the Host received it. A CANDIDATE until checked. */
      readonly record: GatekeeperDecisionRecord;
      readonly attestation: HostAttestationSummary;
      readonly usage: { readonly inputTokens: number; readonly cachedInputTokens: number; readonly outputTokens: number };
    }
  | {
      readonly kind: 'unavailable';
      /** The material cause. Stable across rewording; an outage identity may bind it. */
      readonly cause: GatekeeperUnavailabilityCause;
      readonly reasons: readonly string[];
      /**
       * THE HOST-AUTHORITATIVE DISPATCH FACT (PROJECTOS-HOST-REVIEW-PATH1A). `false` ONLY where nothing
       * can have reached a provider: the request was never sent, the Host answered `NotRun`, or the
       * Host's own failure record says no provider was called. Absent means "not stated", which every
       * consumer reads as possibly dispatched. It is never inferred from a frame's state.
       */
      readonly providerDispatched?: boolean;
    };

/**
 * The route to ProjectOSHost's `IndependentGatekeeperReview` operation.
 *
 * A PORT, because reaching the Host is an effect and this module has none. The unattended turn has no
 * other way to obtain a decision: with no port composed it refuses, it does not call a provider itself.
 */
export interface HostReviewPort {
  review(call: HostReviewCall): HostReviewOutcome;
}
