// Origin: original ProjectOS code
/**
 * Messages between agents, inside one tenant and one project.
 *
 * A MESSAGE STAYS WHERE ITS SENDER IS. The recipient is looked up in the tenant and project of the binding, never in the
 * tenant a message names. A message that names another tenant or project is refused by name; a recipient this tenant and
 * project do not hold is refused without saying whether another tenant holds it. Cross-tenant access is a P5 action of its
 * own and never a message.
 *
 * THE SENDER IS THE BOOK'S, NOT THE CALLER'S. A message names the envelope of the run it comes from, and the delegation book
 * says whose run that is: the sender's agent, tenant, project and envelope are read from the node the book holds for it, and
 * a request has no field that says who is sending. The node must be live, its envelope unexpired and its agent record the one
 * it started under.
 *
 * MESSAGING IS OFF UNTIL A RECORD ALLOWS IT, AND A GRANT HOLDS IT. The source lets any agent message any other by default.
 * Here the sender's own record must list the recipient in `messageAllow`, an empty list, the default, allows none, and the
 * run itself must hold the `send_message` grant under any spelling, which no delegate can: it is a blocked grant. An agent
 * never messages itself.
 *
 * A MESSAGE IS ENVELOPED AND CARRIES NO AUTHORITY. Its envelope must be a child of the sender's envelope, judged by
 * `checkChildEnvelope` on a plain copy taken once, so the tenant, domain, project, environment and principal equal the
 * sender's and nothing is widened. It must act at P2 or below and spend nothing: a message asks no one for a grant and no
 * one for money. What the recipient receives is data, labelled untrusted, with an idempotency key derived from the tenant, the
 * project and the message id.
 *
 * A CONVERSATION ENDS. A ledger the caller threads through records every message, keyed by tenant, project and message id. A
 * message id is admitted once. A reply names the message it answers, which must have been sent to the replier, and the hop
 * count is the ledger's, not the request's, and has a cap. One pair of agents may exchange a bounded number of messages. A
 * full ledger refuses and never forgets an old entry.
 *
 * WHAT THIS MODULE CANNOT PROVE. That the caller is the run the sender envelope id names is the wiring's, as is keeping the
 * ledger durable. Pure: no I/O.
 */
import { createHash } from 'node:crypto';
import { classAtMost, resolveAction, type ActionRegistry } from '../actionRegistry.js';
import { checkChildEnvelope, deriveIdempotencyKey, envelopeExpired, type TaskEnvelope } from '../taskEnvelope.js';
import { isDerivedBinding, type TenantBinding } from '../tenant.js';
import { findAgent, isAgentBook, scopeKey, type AgentBook } from './agentBook.js';
import { readClock, type Clock } from './clockGuard.js';
import { delegationNodeAt, isDelegationBook, type DelegationBook } from './delegation.js';
import { MAX_MESSAGES_PER_PAIR, MAX_MESSAGE_CHARS, MAX_MESSAGE_HOPS, MAX_MESSAGE_LEDGER_ENTRIES } from './delegationLimits.js';
import { normalizeGrantName } from './delegationToolsets.js';
import { snapshotEnvelope } from './envelopeSnapshot.js';

/** The highest class a message's envelope may carry. */
export const MESSAGE_CLASS_CEILING = 'P2';

const MESSAGE_ID = /^MSG-[A-Za-z0-9-]{1,60}$/;
const SEND_GRANT = normalizeGrantName('send_message');

interface LedgerEntry {
  readonly from: string;
  readonly to: string;
  readonly hops: number;
  readonly scope: string;
}

/** An opaque ledger of the messages admitted so far. */
export interface MessageLedger {
  readonly size: number;
}

const LEDGERS = new WeakMap<MessageLedger, ReadonlyMap<string, LedgerEntry>>();

function ledgerOf(entries: ReadonlyMap<string, LedgerEntry>): MessageLedger {
  const ledger: MessageLedger = Object.freeze({ size: entries.size });
  LEDGERS.set(ledger, entries);
  return ledger;
}

export const emptyMessageLedger = (): MessageLedger => ledgerOf(new Map());

export interface MessageContext {
  readonly binding: TenantBinding;
  readonly registry: ActionRegistry;
  readonly clock: Clock;
  /** Says whose run each envelope is. The sender is read from here. */
  readonly delegations: DelegationBook;
  readonly ledger: MessageLedger;
}

export interface MessageRequest {
  readonly messageId: string;
  /** The envelope id of the run the message comes from. It names no agent: the delegation book knows whose run it is. */
  readonly senderEnvelopeId: string;
  readonly toAgentId: string;
  /** The message this one answers, if any. The hop count comes from the ledger. */
  readonly inReplyTo?: string;
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
  | 'LEDGER'
  | 'CLOCK'
  | 'MESSAGE_SHAPE'
  | 'SENDER_UNKNOWN'
  | 'SENDER_NOT_LIVE'
  | 'SENDER_EXPIRED'
  | 'SENDER_RECORD_CHANGED'
  | 'SENDER_NO_GRANT'
  | 'CROSS_TENANT'
  | 'CROSS_PROJECT'
  | 'SELF_MESSAGE'
  | 'RECIPIENT_UNKNOWN'
  | 'NOT_ALLOWED'
  | 'DUPLICATE_MESSAGE'
  | 'REPLY_UNKNOWN'
  | 'HOP_CAP'
  | 'PAIR_CAP'
  | 'LEDGER_FULL'
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
  readonly hops: number;
  readonly body: string;
  readonly envelope: TaskEnvelope;
  readonly idempotencyKey: string;
}

export type MessageResult =
  | { readonly ok: true; readonly message: AdmittedMessage; readonly ledger: MessageLedger }
  | { readonly ok: false; readonly code: MessageCode; readonly message: string };

const no = (code: MessageCode, message: string): MessageResult => ({ ok: false, code, message });

function shapeProblem(request: MessageRequest): string | null {
  if (typeof request.messageId !== 'string' || !MESSAGE_ID.test(request.messageId)) return 'the message id must be MSG- and one plain word';
  if (typeof request.body !== 'string' || request.body === '' || request.body.length > MAX_MESSAGE_CHARS) return `the body must be text of 1 to ${MAX_MESSAGE_CHARS} characters`;
  if (typeof request.senderEnvelopeId !== 'string' || typeof request.toAgentId !== 'string') return 'the sender envelope and the recipient must be ids';
  if (request.inReplyTo !== undefined && (typeof request.inReplyTo !== 'string' || !MESSAGE_ID.test(request.inReplyTo))) return 'a reply names the MSG- id it answers';
  return null;
}

const ledgerKey = (tenant: string, project: string, messageId: string): string => JSON.stringify([tenant, project, messageId]);
const pairKey = (a: string, b: string): string => JSON.stringify([a, b].sort());

/** May this agent send this message to this other agent? On success the body is handed on as untrusted data. */
export function admitAgentMessage(book: AgentBook, input: MessageContext, asked: MessageRequest): MessageResult {
  const context = Object.freeze({ ...input });
  const request: MessageRequest = Object.freeze({ ...asked });
  const { binding, registry } = context;
  if (!isDerivedBinding(binding)) return no('BINDING', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  if (!isAgentBook(book)) return no('AGENT_BOOK', 'the agent book was not built by this module');
  if (!isDelegationBook(context.delegations)) return no('DELEGATION_BOOK', 'the delegation book was not built by this module');
  const held = LEDGERS.get(context.ledger);
  if (held === undefined) return no('LEDGER', 'the message ledger was not built by this module');
  const now = readClock(context.clock, context.delegations.lastSeen);
  if (now === null) return no('CLOCK', 'the clock gave no usable time, or a time before one the delegation book has already seen');
  const shape = shapeProblem(request);
  if (shape !== null) return no('MESSAGE_SHAPE', shape);
  const node = delegationNodeAt(context.delegations, binding.tenant, binding.projectId, request.senderEnvelopeId, now);
  if (node === null) return no('SENDER_UNKNOWN', 'the sender envelope is not a run the delegation book holds for this tenant and project');
  if (node.state !== 'live') return no('SENDER_NOT_LIVE', 'the sender run has ended');
  const from = node.envelope;
  if (envelopeExpired(from, new Date(now).toISOString())) return no('SENDER_EXPIRED', "the sender's envelope has expired");
  const sender = findAgent(book, binding.tenant, binding.projectId, node.agentId);
  if (sender === null) return no('SENDER_UNKNOWN', 'the sender agent is not held by this tenant and project');
  if (sender.recordHash !== node.recordHash) return no('SENDER_RECORD_CHANGED', "the sender's agent record is not the one the run started under");
  if (!node.grants.some((grant) => normalizeGrantName(grant) === SEND_GRANT)) return no('SENDER_NO_GRANT', 'this run does not hold the send_message grant');
  if (request.toTenant !== undefined && request.toTenant !== binding.tenant) return no('CROSS_TENANT', 'a message stays in its tenant; cross-tenant access is not a message');
  if (request.toProject !== undefined && request.toProject !== binding.projectId) return no('CROSS_PROJECT', 'a message stays in its project');
  if (request.toAgentId === sender.agentId) return no('SELF_MESSAGE', 'an agent does not message itself');
  const recipient = findAgent(book, binding.tenant, binding.projectId, request.toAgentId);
  if (recipient === null) return no('RECIPIENT_UNKNOWN', 'the recipient is not held by this tenant and project');
  if (!sender.messageAllow.includes(recipient.agentId)) return no('NOT_ALLOWED', "the recipient is not on the sender's allowlist");
  const plain = snapshotEnvelope(request.envelope);
  if (plain === null) return no('ENVELOPE_R1', 'the message envelope is not plain data: an accessor, an unknown field or a symbol key refuses it');
  const checked = checkChildEnvelope(from, plain, registry);
  if (!checked.ok) return no(`ENVELOPE_${checked.rule}` as MessageCode, checked.reasons.join('; '));
  const envelope = checked.envelope;
  if (!classAtMost(resolveAction(registry, envelope.action).actionClass, MESSAGE_CLASS_CEILING)) {
    return no('MESSAGE_CLASS', `a message acts at ${MESSAGE_CLASS_CEILING} at most`);
  }
  if (envelope.budget !== 0) return no('MESSAGE_BUDGET', 'a message spends nothing');

  const key = ledgerKey(binding.tenant, binding.projectId, request.messageId);
  if (held.has(key)) return no('DUPLICATE_MESSAGE', 'this message id was already admitted');
  const answered = request.inReplyTo === undefined ? undefined : held.get(ledgerKey(binding.tenant, binding.projectId, request.inReplyTo));
  if (request.inReplyTo !== undefined && (answered === undefined || answered.to !== sender.agentId)) return no('REPLY_UNKNOWN', 'a reply answers a message this agent received in this tenant and project');
  const hops = answered === undefined ? 1 : answered.hops + 1;
  if (hops > MAX_MESSAGE_HOPS) return no('HOP_CAP', `a reply chain is at most ${MAX_MESSAGE_HOPS} messages long`);
  const scope = scopeKey(binding.tenant, binding.projectId);
  const inScope = [...held.values()].filter((entry) => entry.scope === scope);
  const pair = pairKey(sender.agentId, recipient.agentId);
  if (inScope.filter((entry) => pairKey(entry.from, entry.to) === pair).length >= MAX_MESSAGES_PER_PAIR) return no('PAIR_CAP', `one pair of agents exchanges at most ${MAX_MESSAGES_PER_PAIR} messages`);
  if (inScope.length >= MAX_MESSAGE_LEDGER_ENTRIES) return no('LEDGER_FULL', 'the ledger is full for this project; nothing is forgotten to make room');

  const idempotencyKey = deriveIdempotencyKey({
    tenant: binding.tenant,
    project: binding.projectId,
    action: envelope.action,
    subjectHash: createHash('sha256').update(request.body, 'utf8').digest('hex'),
    intentScope: request.messageId,
  });
  const entry: LedgerEntry = Object.freeze({ from: sender.agentId, to: recipient.agentId, hops, scope });
  return {
    ok: true,
    ledger: ledgerOf(new Map([...held, [key, entry]])),
    message: {
      trust: 'untrusted-data',
      tenant: binding.tenant,
      project: binding.projectId,
      from: sender.agentId,
      to: recipient.agentId,
      messageId: request.messageId,
      hops,
      body: request.body,
      envelope,
      idempotencyKey,
    },
  };
}
