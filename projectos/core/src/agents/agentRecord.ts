// Origin: original ProjectOS code
/**
 * The agent record, and the reader that admits it.
 *
 * A RECORD NAMES A PLAN DECISION; THIS READER CHECKS ITS FORM, NOT THE DECISION. An agent is proposed, never self-made: the
 * record must carry a `planReview` that names a `PLANDEC-` id, says `decidedBy: 'owner'` and carries a plan digest. Those
 * are claims the record makes about itself. Nothing here looks up the decision, so "admitted" means well-formed and within
 * the limits, and does not mean approved.
 *
 * THE RECORD NAMES NO TENANT. `tenant`, `domain` and `project` are stamped from a binding only `resolveTenant` can produce,
 * so an agent cannot say whose it is. A record that carries any of them is refused as a whole, as is a field the reader does
 * not know, so a depth, a budget or a class cannot ride along in a file.
 *
 * GRANTS ARE AN ALLOWLIST OF WORDS. No wildcard, no pattern, no repeat; a grant is one tool name. `mayDelegate` and the
 * list of agents this one may message are explicit and default to nothing: an agent that does not say it may delegate
 * cannot, and one with no recipients can message no one.
 *
 * WHAT THIS MODULE CANNOT PROVE. It reads the shape of a review, not the review: that `decisionId` names a committed owner
 * decision with this plan digest is for the wiring to check against the committed plan-decision records. Until that wiring
 * exists, a record that names a decision is only as trustworthy as the file it was read from. Pure: no I/O.
 */
import { createHash } from 'node:crypto';
import { isDerivedBinding, type Domain, type TenantBinding } from '../tenant.js';
import { MAX_AGENT_GRANTS, MAX_MESSAGE_RECIPIENTS } from './delegationLimits.js';
import { snapshotOf } from './plainRecords.js';

export type AgentRefusalCode = 'AGENT_SHAPE' | 'AGENT_NO_PLAN_DECISION' | 'AGENT_GRANTS' | 'AGENT_BINDING';

export interface AgentRefusal {
  readonly code: AgentRefusalCode;
  readonly message: string;
}

/** What a record says about its own review. The reader checks its form only. */
export interface AgentPlanReview {
  readonly decisionId: string;
  readonly decidedBy: 'owner';
  readonly planDigest: string;
}

export interface AgentRecord {
  readonly recordId: string;
  readonly agentId: string;
  readonly tenant: string;
  readonly domain: Domain;
  readonly project: string;
  /** The tools this agent may hold, sorted, one word each. */
  readonly grants: readonly string[];
  readonly mayDelegate: boolean;
  /** The agents this one may message, in its own tenant and project. Empty: none. */
  readonly messageAllow: readonly string[];
  readonly planReview: AgentPlanReview;
  /** A SHA-256 over every field above, so another version of an agent is another record. */
  readonly recordHash: string;
}

export type AgentRecordResult =
  | { readonly ok: true; readonly record: AgentRecord }
  | { readonly ok: false; readonly refusals: readonly AgentRefusal[] };

const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const AGENT_ID = /^[a-z][a-z0-9_-]{1,31}$/;
export const GRANT_NAME = /^[a-z][a-z0-9_.-]{1,47}$/;
const DECISION_ID = /^PLANDEC-[A-Za-z0-9-]{1,64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const FIELDS = ['recordId', 'agentId', 'grants', 'mayDelegate', 'messageAllow', 'planReview'] as const;
const REVIEW_FIELDS = ['decisionId', 'decidedBy', 'planDigest'] as const;

const ADMITTED = new WeakSet<object>();

const refusal = (code: AgentRefusalCode, message: string): AgentRefusal => ({ code, message });

/** Did the reader admit this record? A copy of one, built by hand, was not admitted. */
export function isAdmittedAgentRecord(value: unknown): value is AgentRecord {
  return typeof value === 'object' && value !== null && ADMITTED.has(value);
}

function reviewOf(raw: unknown): { readonly review: AgentPlanReview } | { readonly refusal: AgentRefusal } {
  const no = (message: string) => ({ refusal: refusal('AGENT_NO_PLAN_DECISION', message) });
  const value = snapshotOf(raw, REVIEW_FIELDS);
  if (value === null) return no('an agent record needs a planReview that names a plan decision, as plain fields');
  const { decisionId, decidedBy, planDigest } = value;
  if (typeof decisionId !== 'string' || !DECISION_ID.test(decisionId)) return no('the planReview does not name a plan decision');
  if (decidedBy !== 'owner') return no('the planReview does not say the owner decided');
  if (typeof planDigest !== 'string' || !DIGEST.test(planDigest)) return no('the planReview does not name the plan digest it was decided against');
  return { review: Object.freeze({ decisionId, decidedBy: 'owner' as const, planDigest }) };
}

/** A list of unique words, sorted, within a cap; `null` when it is anything else. */
function wordList(value: unknown, pattern: RegExp, cap: number): readonly string[] | null {
  if (!Array.isArray(value) || value.length > cap) return null;
  const words: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'string' || !pattern.test(entry) || words.includes(entry)) return null;
    words.push(entry);
  }
  return Object.freeze(words.sort());
}

const hashOf = (record: Omit<AgentRecord, 'recordHash'>): string =>
  `sha256:${createHash('sha256')
    .update(
      JSON.stringify([
        record.recordId,
        record.agentId,
        record.tenant,
        record.domain,
        record.project,
        record.grants,
        record.mayDelegate,
        record.messageAllow,
        record.planReview.decisionId,
        record.planReview.planDigest,
      ]),
      'utf8',
    )
    .digest('hex')}`;

/** Read an agent record from parsed JSON for the checkout `binding` names, and admit it or refuse it with every reason found. */
export function admitAgentRecord(raw: unknown, binding: TenantBinding): AgentRecordResult {
  if (!isDerivedBinding(binding)) {
    return { ok: false, refusals: [refusal('AGENT_BINDING', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim')] };
  }
  const fields = snapshotOf(raw, FIELDS);
  if (fields === null) {
    return { ok: false, refusals: [refusal('AGENT_SHAPE', 'an agent record is one object of plain fields this reader knows, with no tenant, no limit and no getters')] };
  }
  const refusals: AgentRefusal[] = [];
  for (const field of ['recordId', 'agentId'] as const) {
    const value = fields[field];
    const pattern = field === 'recordId' ? RECORD_ID : AGENT_ID;
    if (typeof value !== 'string' || !pattern.test(value)) refusals.push(refusal('AGENT_SHAPE', `'${field}' must be one plain word`));
  }
  if (fields['mayDelegate'] !== true && fields['mayDelegate'] !== false) refusals.push(refusal('AGENT_SHAPE', "'mayDelegate' must be exactly true or false"));
  const messageAllow = wordList(fields['messageAllow'], AGENT_ID, MAX_MESSAGE_RECIPIENTS);
  if (messageAllow === null) refusals.push(refusal('AGENT_SHAPE', `'messageAllow' must be a list of at most ${MAX_MESSAGE_RECIPIENTS} different agent ids`));
  const grants = wordList(fields['grants'], GRANT_NAME, MAX_AGENT_GRANTS);
  if (grants === null) refusals.push(refusal('AGENT_GRANTS', `'grants' must be a list of at most ${MAX_AGENT_GRANTS} different tool words, with no wildcard`));
  const review = reviewOf(fields['planReview']);
  if ('refusal' in review) refusals.push(review.refusal);
  if (refusals.length > 0 || 'refusal' in review || grants === null || messageAllow === null) return { ok: false, refusals };

  const body = {
    recordId: fields['recordId'] as string,
    agentId: fields['agentId'] as string,
    tenant: binding.tenant,
    domain: binding.domain,
    project: binding.projectId,
    grants,
    mayDelegate: fields['mayDelegate'] as boolean,
    messageAllow,
    planReview: review.review,
  };
  const record: AgentRecord = Object.freeze({ ...body, recordHash: hashOf(body) });
  ADMITTED.add(record);
  return { ok: true, record };
}
