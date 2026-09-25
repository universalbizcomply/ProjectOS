/**
 * THE ONE PLACE the production Host review client is composed — for `run`, `reconcile` and `closure`.
 *
 * WIRE IT ONLY WHEN THE OWNER'S COMMITTED CONFIGURATION NAMES THE ROUTE. An unattended turn with NO Host
 * port refuses `TRANSPORT_NOT_CONFIGURED` before spend admission and creates no ledger file; composing
 * any port — even one that would refuse — moves the turn past that free refusal and into a reservation.
 * So absence wires nothing, and a block that is present but broken is a refusal, never a silent "off".
 *
 * THERE IS NO OTHER ROUTE TO COMPOSE. No provider client, no interactive fallback, no self-review: when
 * this returns `none`, an unattended project WAITS for its owner exactly as it did before this file
 * existed.
 *
 * Created in PROJECTOS-HOST-REVIEW-PATH1A.
 */
import type { HostClosureReviewPort, HostReviewPort } from '@projectos/core';
import { resolveBoundGit, type System } from '../system.js';
import { candidateEvidenceSource, nodeGitBytes, type CandidateEvidenceSource } from './hostCandidateEvidence.js';
import { loadHostReviewActivation } from './hostReviewActivation.js';
import { hostReviewClient } from './hostReviewClient.js';
import { nodeHostIpcTransport, type HostIpcTransport } from './transports/hostIpcTransport.js';

export type ComposedHostReview =
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly lines: readonly string[] }
  | { readonly kind: 'composed'; readonly port: HostReviewPort & HostClosureReviewPort };

/**
 * `transport` exists for the isolated proofs, which drive THIS composition over a test endpoint. The
 * commands pass none, and so always get the installed Host's fixed endpoint.
 */
export function composeHostReview(
  sys: System,
  root: string,
  transport?: HostIpcTransport,
  candidateEvidence?: CandidateEvidenceSource,
): ComposedHostReview {
  const loaded = loadHostReviewActivation(sys, root);
  if (loaded.kind === 'absent') return { kind: 'none' };
  if (loaded.kind === 'invalid') {
    return {
      kind: 'refused',
      lines: [
        'REFUSED (HOST_REVIEW_MISCONFIGURED): a ProjectOSHost review route is configured but cannot be used.',
        ...loaded.reasons.map((r) => `  - ${r}`),
        '',
        'Nothing was asked and nothing was spent.',
      ],
    };
  }
  // THE AGENT'S OWN EVIDENCE SOURCE (PROJECTOS-HOST-REVIEW-PATH1B). Production reads the governed root
  // with the ONE bound git executable the rest of the runtime uses; with no bound git there is no way
  // to check an attestation, and a route that cannot check its answers is refused, not composed.
  let evidence = candidateEvidence;
  if (evidence === undefined) {
    const git = resolveBoundGit();
    if (git === null) {
      return {
        kind: 'refused',
        lines: [
          'REFUSED (HOST_REVIEW_MISCONFIGURED): a ProjectOSHost review route is configured but no bound git',
          'executable is available, so the agent could not check an attestation against its own evidence of',
          'the candidate.',
          '',
          'Nothing was asked and nothing was spent.',
        ],
      };
    }
    evidence = candidateEvidenceSource(nodeGitBytes(git, root));
  }
  return {
    kind: 'composed',
    port: hostReviewClient({ activation: loaded.activation, transport: transport ?? nodeHostIpcTransport(), candidateEvidence: evidence }),
  };
}
