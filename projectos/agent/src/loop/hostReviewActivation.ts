/**
 * WHETHER THIS PROJECT'S UNATTENDED REVIEWS GO TO PROJECTOSHOST — read from the COMMITTED configuration.
 *
 * THE RULE, AND WHY IT IS THIS STRICT. Composing ANY Host route moves an unattended turn past its free
 * `TRANSPORT_NOT_CONFIGURED` refusal and into spend admission, which writes a reservation. So a route is
 * composed only when the owner's COMMITTED gatekeeper configuration names one: an absent block wires
 * nothing (the turn still refuses before spend and creates no ledger file), a working-copy edit cannot
 * switch it on, and a block that is present but malformed is a REFUSAL rather than a silent "off" —
 * running unreviewed because the reviewer was misconfigured is the failure this loop exists to prevent.
 *
 * WHAT THE BLOCK CARRIES. The five facts of the Host's request binding that the agent cannot derive for
 * itself. Every one of them is a CLAIM: the Host resolves its own facts and refuses, with nothing run
 * and nothing spent, unless the agent's claim equals them byte for byte. Nothing here is a credential,
 * and nothing here is authority — a wrong value buys a refusal, never a review.
 *
 * Created in PROJECTOS-HOST-REVIEW-PATH1A.
 */
import { join } from 'node:path';
import type { System } from '../system.js';
import { readCommittedJson } from '../planApproval.js';
import { GATEKEEPER_CONFIG_REL } from './gatekeeperConfig.js';

/** The ONE transport name a committed configuration may use. There is no second Host route. */
export const HOST_REVIEW_TRANSPORT = 'projectos-host-local-ipc';

export interface HostReviewActivation {
  readonly transport: typeof HOST_REVIEW_TRANSPORT;
  /** The repository identity the owner's delegation names (e.g. `github.com/org/repo`). */
  readonly repository: string;
  /** The Host's approved-plan reference. */
  readonly planRef: string;
  /** The validated phase-definition digest of that plan, 32 bytes as lower-case hex. */
  readonly planDigest: string;
  /** The approved baseline commit of the governed phase: exactly 40 lower-case hex characters. */
  readonly baselineCommit: string;
  /** The owner programme delegation the request names, 32 bytes as lower-case hex. */
  readonly delegationId: string;
  readonly modelPolicy: string;
  /** A credential REFERENCE — the name the Host resolves. Never a credential. */
  readonly credentialRef: string;
  /** How long to wait for the Host's answer, in seconds. Bounded. */
  readonly responseTimeoutSeconds: number;
}

export type HostReviewActivationLoad =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid'; readonly reasons: readonly string[] }
  | { readonly kind: 'active'; readonly activation: HostReviewActivation };

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const KEYS = ['transport', 'repository', 'planRef', 'planDigest', 'baselineCommit', 'delegationId', 'modelPolicy', 'credentialRef', 'responseTimeoutSeconds'];
const DEFAULT_RESPONSE_TIMEOUT_SECONDS = 300;
const MAX_RESPONSE_TIMEOUT_SECONDS = 900;

function bounded(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '' && v.length <= 256 && v === v.trim();
}

function parse(block: Record<string, unknown>): HostReviewActivationLoad {
  const reasons: string[] = [];
  for (const k of Object.keys(block)) if (!KEYS.includes(k)) reasons.push(`hostReview carries an unknown field '${k}'`);
  if (block['transport'] !== HOST_REVIEW_TRANSPORT) {
    reasons.push(`hostReview.transport must be '${HOST_REVIEW_TRANSPORT}'; there is no other Host route`);
  }
  for (const k of ['repository', 'planRef', 'modelPolicy', 'credentialRef']) {
    if (!bounded(block[k])) reasons.push(`hostReview.${k} is not a usable bounded string`);
  }
  for (const k of ['planDigest', 'delegationId']) {
    const v = block[k];
    if (typeof v !== 'string' || !HEX64.test(v)) reasons.push(`hostReview.${k} is not 32 bytes of lower-case hex`);
  }
  // THE APPROVED BASELINE COMMIT (PROJECTOS-HOST-REVIEW-PATH1B). An EXACT commit and nothing else - a
  // branch, `HEAD` or a remote-tracking reference would let the point a candidate is measured from
  // move. It is the agent's CLAIM: the Host takes its baseline from its own durable approved-plan
  // record, and a disagreement surfaces as an attestation the agent refuses.
  const baseline = block['baselineCommit'];
  if (typeof baseline !== 'string' || !HEX40.test(baseline)) {
    reasons.push('hostReview.baselineCommit is not an exact 40-character lower-case commit id');
  }
  const t = block['responseTimeoutSeconds'] ?? DEFAULT_RESPONSE_TIMEOUT_SECONDS;
  if (typeof t !== 'number' || !Number.isSafeInteger(t) || t < 1 || t > MAX_RESPONSE_TIMEOUT_SECONDS) {
    reasons.push(`hostReview.responseTimeoutSeconds must be a whole number of seconds in 1..${MAX_RESPONSE_TIMEOUT_SECONDS}`);
  }
  if (reasons.length > 0) return { kind: 'invalid', reasons };
  return {
    kind: 'active',
    activation: {
      transport: HOST_REVIEW_TRANSPORT,
      repository: block['repository'] as string,
      planRef: block['planRef'] as string,
      planDigest: block['planDigest'] as string,
      baselineCommit: baseline as string,
      delegationId: block['delegationId'] as string,
      modelPolicy: block['modelPolicy'] as string,
      credentialRef: block['credentialRef'] as string,
      responseTimeoutSeconds: t as number,
    },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Read the activation from the COMMITTED gatekeeper configuration, and require the working copy to say
 * the same thing. `absent` when the committed configuration names no Host route.
 */
export function loadHostReviewActivation(sys: System, root: string): HostReviewActivationLoad {
  const committed = readCommittedJson(sys, root, GATEKEEPER_CONFIG_REL);
  const committedBlock = committed === null ? undefined : committed['hostReview'];

  let working: unknown;
  try {
    const text = sys.readText(join(root, ...GATEKEEPER_CONFIG_REL.split('/')));
    const parsed: unknown = text === null ? null : JSON.parse(text);
    working = isObject(parsed) ? parsed['hostReview'] : undefined;
  } catch {
    working = undefined;
  }

  if (committedBlock === undefined) {
    // NOTHING COMMITTED NAMES A HOST ROUTE. A working-copy block on its own activates nothing — and is
    // said out loud, because an owner who added one and sees no Host route deserves to know why.
    return working === undefined
      ? { kind: 'absent' }
      : { kind: 'invalid', reasons: ['hostReview is present in the working copy but not COMMITTED; an uncommitted edit cannot activate the Host route'] };
  }
  if (!isObject(committedBlock)) return { kind: 'invalid', reasons: ['the committed hostReview block is not an object'] };
  if (JSON.stringify(working) !== JSON.stringify(committedBlock)) {
    return { kind: 'invalid', reasons: ['the working-copy hostReview block differs from the COMMITTED one; the committed value is the one the owner reviewed'] };
  }
  return parse(committedBlock);
}
