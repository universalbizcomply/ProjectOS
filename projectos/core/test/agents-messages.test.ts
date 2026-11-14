import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_CHARS,
  admitAgentMessage,
  emptyDelegationBook,
  settleDelegation,
  type AgentBook,
  type DelegationBook,
  type MessageRequest,
} from '../src/agents/index.js';
import type { TaskEnvelope } from '../src/taskEnvelope.js';
import type { TenantBinding } from '../src/tenant.js';
import { LEAD, MINUTE, NOW, WORKER, agency, bookOf, childEnvelope, clockAt, committedRegistry, contextOf, nextEnvelopeId, polygo, projectos, rootEnvelope, withRoot } from './agents-support.js';

const home = polygo();
const held = (): AgentBook => bookOf(home, [{ ...LEAD, messageAllow: ['worker'] }, { ...WORKER, messageAllow: [] }, { recordId: 'AGT-other', agentId: 'other' }]);

/** A sender run the delegation book holds, for the lead agent unless a test says another. */
function run(envelope: TaskEnvelope = rootEnvelope(home), agentId = 'lead', agents: AgentBook = held()): { readonly envelope: TaskEnvelope; readonly delegations: DelegationBook } {
  return { envelope, delegations: withRoot(home, agents, envelope, agentId) };
}

function message(sender: TaskEnvelope, over: Partial<MessageRequest> & { envelope?: Record<string, unknown> } = {}): MessageRequest {
  const { envelope, ...rest } = over;
  return {
    messageId: 'MSG-0001',
    senderEnvelopeId: sender.envelopeId,
    toAgentId: 'worker',
    envelope: childEnvelope(sender, { action: 'request_review', actionClass: 'P2', budget: 0, ...(envelope ?? {}) }),
    body: 'Please review the changed validator and reply with the failures.',
    ...rest,
  };
}

interface Setup {
  readonly book?: AgentBook;
  readonly binding?: TenantBinding;
  readonly ms?: number;
  readonly delegations: DelegationBook;
}

const admit = (req: MessageRequest, setup: Setup) =>
  admitAgentMessage(setup.book ?? held(), { binding: setup.binding ?? home, registry: committedRegistry(), clock: clockAt(setup.ms ?? NOW), delegations: setup.delegations }, req);
const code = (result: ReturnType<typeof admit>): string => (result.ok ? 'ok' : result.code);

describe('a message stays inside its tenant and project', () => {
  it('admits the same message within the tenant: the positive control', () => {
    const { envelope, delegations } = run();
    expect(code(admit(message(envelope), { delegations }))).toBe('ok');
  });

  it('refuses a message that names an agent of another tenant as its recipient', () => {
    const { envelope, delegations } = run();
    const theirs = bookOf(agency(), [{ recordId: 'AGT-worker-v1', agentId: 'worker' }], held());
    expect(code(admit(message(envelope, { toTenant: 'agency-business', toProject: 'seo-agency' }), { delegations, book: theirs }))).toBe('CROSS_TENANT');
  });

  it('refuses a message to another project of the same tenant', () => {
    const { envelope, delegations } = run();
    expect(code(admit(message(envelope, { toTenant: 'owner-personal', toProject: 'projectos' }), { delegations }))).toBe('CROSS_PROJECT');
  });

  it('admits a message that names its own tenant and project as the destination: the control', () => {
    const { envelope, delegations } = run();
    expect(code(admit(message(envelope, { toTenant: 'owner-personal', toProject: 'polygo' }), { delegations }))).toBe('ok');
  });

  it('refuses a message whose envelope is in another tenant, through checkChildEnvelope', () => {
    const { envelope, delegations } = run();
    expect(code(admit(message(envelope, { envelope: { tenant: 'agency-business', domain: 'business' } }), { delegations }))).toBe('ENVELOPE_R3');
  });

  it('refuses a message whose envelope names another parent than the sender run', () => {
    const { envelope, delegations } = run();
    expect(code(admit(message(envelope, { envelope: { parentEnvelopeId: nextEnvelopeId() } }), { delegations }))).toBe('ENVELOPE_R3');
  });

  it('refuses a recipient this tenant and project do not hold, without saying whose it is', () => {
    const { envelope, delegations } = run();
    const book = bookOf(agency(), [{ recordId: 'AGT-agency-only', agentId: 'agency-only' }], bookOf(home, [{ ...LEAD, messageAllow: ['agency-only'] }, WORKER]));
    const result = admit(message(envelope, { toAgentId: 'agency-only' }), { delegations, book });
    expect(result).toMatchObject({ ok: false, code: 'RECIPIENT_UNKNOWN' });
    expect(result.ok ? '' : result.message).not.toContain('agency');
  });
});

describe('the sender is the delegation book\'s, not the caller\'s', () => {
  it('refuses a sender envelope the delegation book does not hold', () => {
    const stranger = rootEnvelope(home);
    expect(code(admit(message(stranger), { delegations: run().delegations }))).toBe('SENDER_UNKNOWN');
    expect(code(admit(message(stranger), { delegations: emptyDelegationBook() }))).toBe('SENDER_UNKNOWN');
  });

  it('refuses a sender run held for another tenant, even under the same envelope id', () => {
    const theirs = rootEnvelope(agency());
    const delegations = withRoot(agency(), bookOf(agency(), [LEAD]), theirs, 'lead');
    expect(code(admit(message(theirs), { delegations }))).toBe('SENDER_UNKNOWN');
    expect(code(admit(message(theirs), { delegations, book: bookOf(agency(), [{ ...LEAD, messageAllow: ['worker'] }, WORKER]), binding: agency() }))).toBe('ok');
  });

  it('takes the sending agent from the run, so a request that names another agent changes nothing', () => {
    const { envelope, delegations } = run(rootEnvelope(home), 'worker');
    const lie = { ...message(envelope, { toAgentId: 'lead' }), fromAgentId: 'lead' } as MessageRequest;
    expect(code(admit(lie, { delegations }))).toBe('NOT_ALLOWED');
  });

  it('refuses a sender run that has ended', () => {
    const { envelope, delegations } = run();
    const ended = settleDelegation(delegations, contextOf(home, held()), envelope.envelopeId, 'completed');
    if (!ended.ok) throw new Error('the control run was not settled');
    expect(code(admit(message(envelope), { delegations: ended.book }))).toBe('SENDER_NOT_LIVE');
  });

  it('refuses a sender run whose envelope has expired by the injected clock', () => {
    const sender = rootEnvelope(home, { expiry: '2026-11-14T12:30:00.000Z' });
    const { delegations } = run(sender);
    expect(code(admit(message(sender, { envelope: { expiry: '2026-11-14T12:30:00.000Z' } }), { delegations, ms: NOW + 31 * MINUTE }))).toBe('SENDER_EXPIRED');
  });

  it('does not let another tenant\'s binding reach this tenant\'s runs', () => {
    const { envelope, delegations } = run();
    expect(code(admit(message(envelope), { delegations, binding: agency() }))).toBe('SENDER_UNKNOWN');
  });

  it('refuses a sender whose agent record is no longer in the book', () => {
    const { envelope, delegations } = run();
    expect(code(admit(message(envelope), { delegations, book: bookOf(home, [WORKER]) }))).toBe('SENDER_UNKNOWN');
  });
});

describe('messaging between agents is off until a record allows it', () => {
  it('refuses a message to an agent that is not on the sender\'s allowlist', () => {
    const { envelope, delegations } = run();
    expect(code(admit(message(envelope, { toAgentId: 'other' }), { delegations }))).toBe('NOT_ALLOWED');
  });

  it('refuses every message from an agent whose record allows none', () => {
    const { envelope, delegations } = run(rootEnvelope(home), 'worker');
    expect(code(admit(message(envelope, { toAgentId: 'lead' }), { delegations }))).toBe('NOT_ALLOWED');
  });

  it('refuses a message from an agent to itself', () => {
    const book = bookOf(home, [{ ...LEAD, messageAllow: ['lead'] }]);
    const { envelope, delegations } = run(rootEnvelope(home), 'lead', book);
    expect(code(admit(message(envelope, { toAgentId: 'lead' }), { delegations, book }))).toBe('SELF_MESSAGE');
  });
});

describe('a message carries no authority', () => {
  it('refuses an envelope above P2: a message asks nothing that needs a grant', () => {
    const { envelope, delegations } = run(rootEnvelope(home, { action: 'approve' }));
    expect(code(admit(message(envelope, { envelope: { action: 'commit', actionClass: 'P3' } }), { delegations }))).toBe('MESSAGE_CLASS');
  });

  it('refuses an envelope with a budget: a message spends nothing', () => {
    const { envelope, delegations } = run();
    expect(code(admit(message(envelope, { envelope: { budget: 5 } }), { delegations }))).toBe('MESSAGE_BUDGET');
  });

  it('refuses a message past the character limit, and one that is not text', () => {
    const { envelope, delegations } = run();
    expect(code(admit(message(envelope, { body: 'x'.repeat(MAX_MESSAGE_CHARS + 1) }), { delegations }))).toBe('MESSAGE_SHAPE');
    expect(code(admit(message(envelope, { body: 5 as never }), { delegations }))).toBe('MESSAGE_SHAPE');
    expect(code(admit(message(envelope, { messageId: 'bad id' }), { delegations }))).toBe('MESSAGE_SHAPE');
  });

  it('hands the recipient the body as untrusted data, with the sender, the scope and a key', () => {
    const { envelope, delegations } = run();
    const result = admit(message(envelope), { delegations });
    expect(result).toMatchObject({
      ok: true,
      message: { trust: 'untrusted-data', tenant: 'owner-personal', project: 'polygo', from: 'lead', to: 'worker', messageId: 'MSG-0001' },
    });
    expect(result.ok && result.message.idempotencyKey).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('derives the key from the tenant, the project and the message, so another tenant\'s same id is another key', () => {
    const mine = run();
    const sibling = projectos();
    const siblingBook = bookOf(sibling, [{ ...LEAD, messageAllow: ['worker'] }, WORKER]);
    const siblingEnvelope = rootEnvelope(sibling);
    const delegations = withRoot(sibling, siblingBook, siblingEnvelope, 'lead');
    const a = admit(message(mine.envelope), { delegations: mine.delegations });
    const b = admit(message(siblingEnvelope), { delegations, book: siblingBook, binding: sibling });
    expect(a.ok && b.ok && a.message.idempotencyKey !== b.message.idempotencyKey).toBe(true);
  });

  it('reads the recipient\'s tenant from the sender\'s scope, never from the message', () => {
    const { envelope, delegations } = run();
    const result = admit({ ...message(envelope), tenant: 'agency-business', project: 'seo-agency' } as MessageRequest, { delegations });
    expect(result).toMatchObject({ ok: true, message: { tenant: 'owner-personal', project: 'polygo' } });
  });
});

describe('time and the books of a message', () => {
  it('refuses a clock that gives no time', () => {
    const { envelope, delegations } = run();
    const result = admitAgentMessage(held(), { binding: home, registry: committedRegistry(), clock: () => Number.NaN, delegations }, message(envelope));
    expect(result).toMatchObject({ ok: false, code: 'CLOCK' });
  });

  it('refuses a clock that reads earlier than one the delegation book has seen', () => {
    const { envelope, delegations } = run();
    expect(code(admit(message(envelope), { delegations, ms: NOW - 1 }))).toBe('CLOCK');
  });

  it('refuses a binding that resolveTenant did not produce, and books this module did not build', () => {
    const { envelope, delegations } = run();
    expect(code(admit(message(envelope), { delegations, binding: { ...home } }))).toBe('BINDING');
    expect(code(admit(message(envelope), { delegations, book: { size: 1 } as unknown as AgentBook }))).toBe('AGENT_BOOK');
    expect(code(admit(message(envelope), { delegations: { size: 1, lastSeen: 0 } as unknown as DelegationBook }))).toBe('DELEGATION_BOOK');
  });
});
