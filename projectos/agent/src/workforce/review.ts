/**
 * Review independence.
 *
 * - The project leader is never accepted as the final independent reviewer of its own team.
 * - A specialist that contributed to the work never satisfies an independent-review requirement for
 *   that same work, and neither does panel output.
 * - The gatekeeper, the code and security reviews and the owner gates stay OUTSIDE the workforce: no
 *   workforce result satisfies any of them. They are named in the plan's `requiredReviews` and owner
 *   gates, and those are matched only against their own records, never against workforce events.
 */
import type { WorkforceEvent } from './eventStore.js';

export interface ReviewEvidence {
  readonly reviewerRoleId: string;
  readonly taskId: string;
  readonly status: string;
  readonly panelId: string | null;
  /** The recorded results the review task was given (by digest). A review of nothing reviews nothing. */
  readonly reviewedResults: readonly string[];
}

export interface IndependenceVerdict {
  readonly satisfied: boolean;
  readonly reasons: readonly string[];
}

/** Does this evidence satisfy the WORKFORCE-INTERNAL independent-review requirement of the team? */
export function independentReviewSatisfied(
  team: readonly { readonly roleId: string; readonly assignment: string }[],
  evidence: ReviewEvidence,
  leaderId: string,
): IndependenceVerdict {
  const reasons: string[] = [];
  if (evidence.reviewerRoleId === leaderId || evidence.reviewerRoleId.startsWith('project-leader')) {
    reasons.push('the project leader is never the final independent reviewer of its own team');
  }
  const member = team.find((m) => m.roleId === evidence.reviewerRoleId);
  if (member === undefined) reasons.push(`'${evidence.reviewerRoleId}' is not on the team`);
  else if (member.assignment !== 'independent-review') {
    reasons.push(`'${evidence.reviewerRoleId}' contributed to this work, so it cannot review it independently`);
  }
  if (evidence.panelId !== null) reasons.push('panel output never satisfies an independent-review requirement');
  if (evidence.reviewedResults.length === 0) reasons.push('the review task named no recorded contributor result, so it reviewed nothing');
  if (evidence.status !== 'completed') reasons.push(`the review result's status is '${evidence.status}', not completed`);
  return { satisfied: reasons.length === 0, reasons };
}

/** Review evidence as recorded, for a task. */
export function reviewEvidenceFor(events: readonly WorkforceEvent[], taskId: string): ReviewEvidence | null {
  const e = events.find((x) => x.type === 'result-recorded' && x.payload['taskId'] === taskId);
  if (e === undefined) return null;
  const grant = events.find((x) => x.type === 'grant-issued' && x.payload['taskId'] === taskId);
  const reviewed = grant?.payload['inputResults'];
  return {
    reviewerRoleId: String(e.payload['roleId']),
    taskId,
    status: String(e.payload['status']),
    panelId: typeof e.payload['panelId'] === 'string' ? (e.payload['panelId'] as string) : null,
    reviewedResults: Array.isArray(reviewed) ? reviewed.map(String) : [],
  };
}

/** The review authorities that remain outside the workforce. */
export const EXTERNAL_REVIEW_AUTHORITIES = ['gatekeeper', 'ECC CODE review', 'ECC SECURITY review', 'owner gate', 'Claude self-review'] as const;

/**
 * Can workforce evidence satisfy a plan-required review or gate? Never. The answer does not depend on
 * the name: a specialist's opinion is evidence FOR a reviewer, not the review.
 */
export function workforceSatisfiesRequiredReview(requiredReview: string): IndependenceVerdict {
  return {
    satisfied: false,
    reasons: [`'${requiredReview}' is satisfied only by its own authority's record; the workforce supplies evidence to reviewers and replaces none of them`],
  };
}
