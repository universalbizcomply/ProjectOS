/**
 * Protected actions requested by the project leader or a specialist — routed to the ProjectOS gate
 * that ALREADY owns each one. The workforce adds no gate of its own and weakens none.
 *
 * The leader acts inside the existing `implementer` governance role and never holds owner or gatekeeper
 * authority. So:
 * - deploy / production database / live communication / payment / credential / external service /
 *   force push go through the approval engine (`requestApproval` + `decide`): they are gated or
 *   prohibited, only the owner can decide them, and nothing proceeds without an owner-decided approval
 *   for exactly that action;
 * - payment, credential, commit, push and phase closure are also on the constitutional owner floor
 *   (`enforcedOwnerOnlyActions`);
 * - phase closure is refused by `authoriseClosure` (the implementer can never close);
 * - merge is not an action ProjectOS can execute (`isTechnicalAction`);
 * - scope expansion and risk acceptance are owner stops (`routeStop`: SCOPE_DECISION / OWNER_GATE;
 *   an unresolved CRITICAL or HIGH also blocks closure at G4-10);
 * - governance and workforce-configuration changes are read only from the owner-accepted commit, so
 *   nothing the leader writes is ever read (`governance.ts`);
 * - minting authority and going around a gate have no route at all.
 */
import {
  authoriseClosure,
  decide,
  enforcedOwnerOnlyActions,
  isApproved,
  isTechnicalAction,
  requestApproval,
  type ApprovalRequest,
} from '@projectos/core';
import { routeStop } from '../loop/gatekeeperRouting.js';

export type ProtectedActionClass =
  | 'production-deployment'
  | 'production-database-mutation'
  | 'live-communication'
  | 'payment-or-refund'
  | 'credential-use'
  | 'external-service-call'
  | 'force-push'
  | 'commit'
  | 'push'
  | 'merge'
  | 'phase-closure'
  | 'self-approval'
  | 'governance-change'
  | 'workforce-configuration-change'
  | 'scope-expansion'
  | 'risk-acceptance'
  | 'authority-mint'
  | 'gate-bypass';

export const PROTECTED_ACTION_CLASSES: readonly ProtectedActionClass[] = [
  'production-deployment',
  'production-database-mutation',
  'live-communication',
  'payment-or-refund',
  'credential-use',
  'external-service-call',
  'force-push',
  'commit',
  'push',
  'merge',
  'phase-closure',
  'self-approval',
  'governance-change',
  'workforce-configuration-change',
  'scope-expansion',
  'risk-acceptance',
  'authority-mint',
  'gate-bypass',
];

/** The canonical action text the approval engine classifies for each approval-gated class. */
const APPROVAL_TEXT: Partial<Record<ProtectedActionClass, string>> = {
  'production-deployment': 'production deploy',
  'production-database-mutation': 'production database mutation',
  'live-communication': 'send email message to a customer',
  'payment-or-refund': 'payment refund',
  'credential-use': 'use secret credential',
  'external-service-call': 'call external service api',
  'force-push': 'force push',
  'self-approval': 'production deploy',
};

/** Owner-floor names for the classes on the constitutional floor. */
const FLOOR: Partial<Record<ProtectedActionClass, string>> = {
  'payment-or-refund': 'payment-or-live-charge',
  'credential-use': 'secrets-handling',
  commit: 'commit',
  push: 'push',
  'phase-closure': 'phase-closure',
};

export interface ProtectedActionRequest {
  readonly actionClass: ProtectedActionClass;
  readonly requestedBy: 'project-leader' | 'specialist';
  readonly at: string;
  /** An approval record, if the requester claims one. Only an owner-decided approval of THIS action counts. */
  readonly approval?: ApprovalRequest;
}

export interface ProtectedActionVerdict {
  readonly authorised: false;
  readonly actionClass: ProtectedActionClass;
  /** The gate that refused, named as the codebase names it. */
  readonly gate: string;
  readonly reasons: readonly string[];
  readonly escalateTo: 'owner' | 'gate';
}

/**
 * Ask the owning gate. In this phase no workforce request can be authorised: the approval engine
 * requires an owner decision for every gated class, the owner floor holds the rest, and the classes
 * with no gate route have no route. The return type says so — there is no `authorised: true`.
 */
export function requestProtectedAction(req: ProtectedActionRequest): ProtectedActionVerdict {
  const reasons: string[] = [];
  const floorName = FLOOR[req.actionClass];
  if (floorName !== undefined && enforcedOwnerOnlyActions([]).includes(floorName)) {
    reasons.push(`owner floor (enforcedOwnerOnlyActions): '${floorName}' is owner-only and no workforce role holds owner authority`);
  }
  const text = APPROVAL_TEXT[req.actionClass];
  if (text !== undefined) {
    const request = requestApproval(`workforce-${req.actionClass}`, text, 'implementer', req.at);
    if (!request.gated && !request.prohibited) {
      // A gated class the engine no longer classifies is a broken invariant, not permission.
      reasons.push(`approval engine: '${text}' was not classified as gated — refusing rather than treating that as permission`);
    }
    // The requester's claimed approval counts only if the OWNER decided exactly this action.
    const claimed = req.approval;
    const ownerDecided =
      claimed !== undefined && isApproved(claimed) && claimed.decidedBy === 'owner' && claimed.action === text && claimed.gate === request.gate;
    // What the leader would get if it tried to decide the approval itself: the engine's own refusal.
    const selfDecision = decide(request, 'approved', 'implementer', req.at);
    if (!selfDecision.ok) reasons.push(`approval engine (decide): ${selfDecision.error}`);
    if (!ownerDecided) reasons.push(`approval engine: no owner-decided approval exists for '${text}'`);
  }
  switch (req.actionClass) {
    case 'phase-closure': {
      // The leader and every specialist act inside the implementer role, whatever identity they claim.
      const verdict = authoriseClosure({
        governedProjectId: 'workforce',
        planProjectId: 'workforce',
        owner: 'owner',
        implementer: 'implementer',
        closureAuthority: 'owner',
        delegation: null,
        actorRole: 'implementer',
        actorIdentity: req.requestedBy,
        scope: 'phase-closure',
      });
      if (!verdict.ok) reasons.push(`closure authority (authoriseClosure): ${verdict.error}`);
      return refuse(req, 'closureAuthority.authoriseClosure', reasons, 'owner');
    }
    case 'merge':
      if (!isTechnicalAction('merge')) reasons.push("technical continuation: 'merge' is not an action ProjectOS can execute (TECHNICAL_ACTIONS); merge is owner-only");
      return refuse(req, 'technicalContinuation.TECHNICAL_ACTIONS', reasons, 'owner');
    case 'scope-expansion':
      return refuse(req, 'gatekeeperRouting.SCOPE_DECISION', [...reasons, ownerStop('SCOPE_DECISION')], 'owner');
    case 'risk-acceptance':
      return refuse(
        req,
        'gatekeeperRouting.OWNER_GATE + closureEligibility G4-10',
        [...reasons, ownerStop('OWNER_GATE'), 'an unresolved CRITICAL or HIGH finding blocks closure (G4-10) unless the owner accepts it'],
        'owner',
      );
    case 'governance-change':
    case 'workforce-configuration-change':
      return refuse(
        req,
        'owner commit gate (governance read only from the owner-accepted commit)',
        [...reasons, 'governance and workforce configuration are read only from the owner-accepted commit; a leader or specialist edit is never read'],
        'owner',
      );
    case 'authority-mint':
      return refuse(req, 'core capability brands (no workforce mint route)', [...reasons, 'every ProjectOS authority token is minted only by its owning core module; the workforce has no mint route'], 'owner');
    case 'gate-bypass':
      return refuse(req, 'no route', [...reasons, 'there is no route around a ProjectOS gate'], 'owner');
    default:
      return refuse(req, text !== undefined ? 'approval engine (requestApproval/decide)' : 'owner floor', reasons, 'owner');
  }
}

function ownerStop(code: 'SCOPE_DECISION' | 'OWNER_GATE'): string {
  const route = routeStop({ code, detail: 'raised by the workforce' } as Parameters<typeof routeStop>[0]);
  return `${code} routes to the ${route.audience} with ${route.applicableVerdicts.length} applicable reviewer verdicts: ${route.rationale}`;
}

function refuse(req: ProtectedActionRequest, gate: string, reasons: readonly string[], escalateTo: 'owner' | 'gate'): ProtectedActionVerdict {
  return {
    authorised: false,
    actionClass: req.actionClass,
    gate,
    reasons: reasons.length > 0 ? reasons : ['refused'],
    escalateTo,
  };
}

/** Which protected class, if any, a free-text action request names. Unknown text is not permission. */
export function classifyRequestedAction(action: string): ProtectedActionClass | null {
  return PROTECTED_ACTION_CLASSES.includes(action as ProtectedActionClass) ? (action as ProtectedActionClass) : null;
}
