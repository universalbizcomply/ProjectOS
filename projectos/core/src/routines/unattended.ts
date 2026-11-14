// Origin: original ProjectOS code
/**
 * An unattended routine run is held to P2 and below. Anything above is refused and handed to the owner.
 *
 * Hermes and OpenClaw run a cron job in the agent's own process with the agent's full authority. A routine
 * here has nobody watching, so it gets the actions the registry calls P2 or lower, and nothing that needs
 * an owner's yes: a commit or a push (P3), an approval, a payment or a credential (P5) is refused, and
 * the request is put on the owner's queue to decide in person.
 *
 * THE CLASS IS THE REGISTRY'S, NOT THE CALLER'S. `resolveAction` answers the class, and an action the
 * registry does not know is P5, so a routine cannot name its way round the ceiling with a new word.
 *
 * REFUSED EITHER WAY. The refusal does not depend on the owner's queue taking the item. If the queue is full
 * or down, the action is still refused, and the result says it was not escalated, so the wiring can log it.
 *
 * Pure: the owner queue is a port the caller supplies. Nothing here reaches a queue itself.
 */
import { classAtMost, isActionName, resolveAction, type ActionClass, type ActionRegistry } from '../actionRegistry.js';

/** The most dangerous class a routine runs with nobody watching. */
export const UNATTENDED_CEILING: ActionClass = 'P2';

export interface UnattendedRequest {
  readonly routineId: string;
  readonly occurrenceId: string;
  readonly action: string;
}

export interface OwnerQueueEscalation {
  readonly kind: 'unattended-gated-action';
  readonly routineId: string;
  readonly occurrenceId: string;
  readonly action: string;
  readonly actionClass: ActionClass;
  readonly reason: string;
}

/** Puts one item on the owner queue. It was taken only if the answer is true. */
export type OwnerQueuePort = (escalation: OwnerQueueEscalation) => boolean;

export type UnattendedResult =
  | { readonly ok: true; readonly actionClass: ActionClass }
  | { readonly ok: false; readonly code: 'UNATTENDED_BAD_ACTION'; readonly message: string }
  | {
      readonly ok: false;
      readonly code: 'UNATTENDED_GATED_ACTION';
      readonly actionClass: ActionClass;
      readonly escalated: boolean;
      readonly message: string;
    };

/** Put one item on the queue. It counts only if the port answers `true`: a Promise, a number or a throw is not a yes. */
function putOnQueue(escalate: OwnerQueuePort, item: OwnerQueueEscalation): boolean {
  try {
    return escalate(item) === true;
  } catch {
    return false;
  }
}

export function admitUnattendedAction(request: UnattendedRequest, registry: ActionRegistry, escalate: OwnerQueuePort): UnattendedResult {
  if (!isActionName(request.action)) {
    return { ok: false, code: 'UNATTENDED_BAD_ACTION', message: 'the action is not one plain word, so it cannot be classed' };
  }
  const { actionClass } = resolveAction(registry, request.action);
  if (classAtMost(actionClass, UNATTENDED_CEILING)) return { ok: true, actionClass };
  const reason = `an unattended routine run asked for '${request.action}', which is ${actionClass}; only ${UNATTENDED_CEILING} and below run without the owner`;
  const escalated = putOnQueue(escalate, {
    kind: 'unattended-gated-action',
    routineId: request.routineId,
    occurrenceId: request.occurrenceId,
    action: request.action,
    actionClass,
    reason,
  });
  return { ok: false, code: 'UNATTENDED_GATED_ACTION', actionClass, escalated, message: reason };
}
