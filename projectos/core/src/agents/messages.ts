// Origin: original ProjectOS code
/**
 * Messages between agents, inside one tenant and one project.
 *
 * A MESSAGE STAYS WHERE ITS SENDER IS. The recipient is looked up in the tenant and project of the binding, never in the
 * tenant a message names. A message that names another tenant or project is refused by name; a recipient this tenant and
 * project do not hold is refused without saying whether another tenant holds it. Cross-tenant access is a P5 action of its
 * own and never a message.
 *
 * MESSAGING IS OFF UNTIL A RECORD ALLOWS IT. The source lets any agent message any other by default. Here the sender's own
 * record must list the recipient in `messageAllow`, and an empty list, the default, allows none. An agent never messages
 * itself.
 *
 * THE SENDER IS THE BOOK'S, NOT THE CALLER'S. A message names the envelope of the run it comes from, and the delegation book
 * says whose run that is: the sender's agent, tenant, project and envelope are read from the node the book holds for it, and
 * a request has no field that says who is sending. The node must be live and its envelope unexpired.
 *
 * A MESSAGE IS ENVELOPED AND CARRIES NO AUTHORITY. Its envelope must be a child of the sender's envelope, judged by
 * `checkChildEnvelope`, so the tenant, domain, project, environment and principal equal the sender's and nothing is widened.
 * It must act at P2 or below and spend nothing: a message asks no one for a grant and no one for money. What the recipient
 * receives is data, labelled untrusted, with an idempotency key derived from the tenant, the project and the message id.
 *
 * WHAT THIS MODULE CANNOT PROVE. That the sender's envelope came from the kernel is the caller's, as for a delegation, and
 * so is refusing a message id already seen: the key is what the receiving queue deduplicates on. Pure: no I/O.
 */
import { createHash } from 'node:crypto';
import { classAtMost, resolveAction, type ActionRegistry } from '../actionRegistry.js';
import { checkChildEnvelope, deriveIdempotencyKey, envelopeExpired, type TaskEnvelope } from '../taskEnvelope.js';
import { isDerivedBinding, type TenantBinding } from '../tenant.js';
import { findAgent, isAgentBook, type AgentBook } from './agentBook.js';
import { readClock, type Clock } from './clockGuard.js';
import { delegationNodeAt, isDelegationBook, type DelegationBook } from './delegation.js';
import { MAX_MESSAGE_CHARS } from './delegationLimits.js';

/** The highest class a message's envelope may carry. */
export const MESSAGE_CLASS_CEILING = 'P2';

const MESSAGE_ID = /^MSG-[A-Za-z0-9-]{1,60}$/;

export interface MessageContext {
  readonly binding: TenantBinding;
  readonly registry: ActionRegistry;
  readonly clock: Clock;
  /** Says whose run each envelope is. The sender is read from here. */
  readonly delegations: DelegationBook;
}

export interface MessageRequest {
  readonly messageId: string;
  /** The envelope id of the run the message comes from. It names no agent: the delegation book knows whose run it is. */
  readonly senderEnvelopeId: string;
  readonly toAgentId: string;
  /** What the message claims about its destination. Read only to refuse a claim that is not this tenant and project. */
  readonly toTenant?: string;
  readonly toProject?: string;
  readonly envelope: unknown;
  readonly body: string;
}

export type MessageCode =
  | 'BINDING'
  | 'AGENT_BOOK'
  | 'DELEGATION_BOOK'
  | 'CLOCK'
  | 'MESSAGE_SHAPE'
  | 'SENDER_UNKNOWN'
  | 'SENDER_NOT_LIVE'
  | 'SENDER_EXPIRED'
  | 'CROSS_TENANT'
  | 'CROSS_PROJECT'
  | 'SELF_MESSAGE'
  | 'RECIPIENT_UNKNOWN'
  | 'NOT_ALLOWED'
  | 'ENVELOPE_R1'
  | 'ENVELOPE_R2'
  | 'ENVELOPE_R3'
  | 'MESSAGE_CLASS'
  | 'MESSAGE_BUDGET';

export interface AdmittedMessage {
  readonly trust: 'untrusted-data';
  readonly tenant: string;
  readonly project: string;
  readonly from: string;
  readonly to: string;
  readonly messageId: string;
  readonly body: string;
  readonly envelope: TaskEnvelope;
  readonly idempotencyKey: string;
}

export type MessageResult =
  | { readonly ok: true; readonly message: AdmittedMessage }
  | { readonly ok: false; readonly code: MessageCode; readonly message: string };

const no = (code: MessageCode, message: string): MessageResult => ({ ok: false, code, message });

function shapeProblem(request: MessageRequest): string | null {
  if (typeof request.messageId !== 'string' || !MESSAGE_ID.test(request.messageId)) return 'the message id must be MSG- and one plain word';
  if (typeof request.body !== 'string' || request.body === '' || request.body.length > MAX_MESSAGE_CHARS) return `the body must be text of 1 to ${MAX_MESSAGE_CHARS} characters`;
  if (typeof request.senderEnvelopeId !== 'string' || typeof request.toAgentId !== 'string') return 'the sender envelope and the recipient must be ids';
  return null;
}

/** May this agent send this message to this other agent? On success the body is handed on as untrusted data. */
export function admitAgentMessage(book: AgentBook, context: MessageContext, input: MessageRequest): MessageResult {
  const { binding, registry } = context;
  if (!isDerivedBinding(binding)) return no('BINDING', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  if (!isAgentBook(book)) return no('AGENT_BOOK', 'the agent book was not built by this module');
  if (!isDelegationBook(context.delegations)) return no('DELEGATION_BOOK', 'the delegation book was not built by this module');
  const now = readClock(context.clock, context.delegations.lastSeen);
  if (now === null) return no('CLOCK', 'the clock gave no usable time, or a time before one the delegation book has already seen');
  // Each field is read once, so what is checked is what is sent.
  const request: MessageRequest = { ...input };
  const shape = shapeProblem(request);
  if (shape !== null) return no('MESSAGE_SHAPE', shape);
  const node = delegationNodeAt(context.delegations, binding.tenant, binding.projectId, request.senderEnvelopeId, now);
  if (node === null) return no('SENDER_UNKNOWN', 'the sender envelope is not a run the delegation book holds for this tenant and project');
  if (node.state !== 'live') return no('SENDER_NOT_LIVE', 'the sender run has ended');
  const from = node.envelope;
  if (envelopeExpired(from, new Date(now).toISOString())) return no('SENDER_EXPIRED', "the sender's envelope has expired");
  const sender = findAgent(book, binding.tenant, binding.projectId, node.agentId);
  if (sender === null) return no('SENDER_UNKNOWN', 'the sender agent is not held by this tenant and project');
  if (request.toTenant !== undefined && request.toTenant !== binding.tenant) return no('CROSS_TENANT', 'a message stays in its tenant; cross-tenant access is not a message');
  if (request.toProject !== undefined && request.toProject !== binding.projectId) return no('CROSS_PROJECT', 'a message stays in its project');
  if (request.toAgentId === sender.agentId) return no('SELF_MESSAGE', 'an agent does not message itself');
  const recipient = findAgent(book, binding.tenant, binding.projectId, request.toAgentId);
  if (recipient === null) return no('RECIPIENT_UNKNOWN', 'the recipient is not held by this tenant and project');
  if (!sender.messageAllow.includes(recipient.agentId)) return no('NOT_ALLOWED', "the recipient is not on the sender's allowlist");
  const checked = checkChildEnvelope(from, request.envelope, registry);
  if (!checked.ok) return no(`ENVELOPE_${checked.rule}` as MessageCode, checked.reasons.join('; '));
  const envelope = checked.envelope;
  if (!classAtMost(resolveAction(registry, envelope.action).actionClass, MESSAGE_CLASS_CEILING)) {
    return no('MESSAGE_CLASS', `a message acts at ${MESSAGE_CLASS_CEILING} at most`);
  }
  if (envelope.budget !== 0) return no('MESSAGE_BUDGET', 'a message spends nothing');
  const idempotencyKey = deriveIdempotencyKey({
    tenant: binding.tenant,
    project: binding.projectId,
    action: envelope.action,
    subjectHash: createHash('sha256').update(request.body, 'utf8').digest('hex'),
    intentScope: request.messageId,
  });
  return {
    ok: true,
    message: {
      trust: 'untrusted-data',
      tenant: binding.tenant,
      project: binding.projectId,
      from: sender.agentId,
      to: recipient.agentId,
      messageId: request.messageId,
      body: request.body,
      envelope,
      idempotencyKey,
    },
  };
}
