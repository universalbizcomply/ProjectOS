import { describe, expect, it } from 'vitest';
import {
  DELEGATION_LEASE_MS,
  MAX_DELEGATE_OUTPUT_CHARS,
  MAX_DELEGATION_NODES_PER_PROJECT,
  MAX_LEASE_RENEWALS,
  MAX_LIVE_DELEGATES_PER_ROOT,
  MAX_MESSAGES_PER_PAIR,
  MAX_MESSAGE_HOPS,
  MAX_MESSAGE_LEDGER_ENTRIES,
  admitAgentMessage,
  admitDelegation,
  childGrantProblem,
  claimItem,
  delegateOutput,
  delegationNodeAt,
  emptyDelegationBook,
  emptyMessageLedger,
  emptyQueueControl,
  exportDelegationBook,
  isBlockedGrant,
  newQueueItem,
  pruneSettledDelegations,
  recordDelegateSpend,
  recoverAbandoned,
  registerRoot,
  releaseDelegation,
  renewLease,
  resolveUnknown,
  restoreDelegationBook,
  restoreQueueItem,
  settleDelegation,
  QUEUE_LEASE_MS,
  type AgentBook,
  type DelegationBook,
  type MessageLedger,
  type MessageRequest,
  type QueueContext,
  type QueueItem,
} from '../src/agents/index.js';
import type { TaskEnvelope } from '../src/taskEnvelope.js';
import {
  LEAD,
  MINUTE,
  NOW,
  PLAN_DIGEST,
  WORKER,
  bookOf,
  childEnvelope,
  clockAt,
  committedRegistry,
  contextOf,
  polygo,
  rootEnvelope,
  withRoot,
} from './agents-support.js';

const home = polygo();
const GOAL = 'Run the validators for the changed files and report each failure by name.';
const CHAIN = ['mid', 'leaf'].map((agentId) => ({ recordId: `AGT-${agentId}`, agentId, mayDelegate: true, grants: ['read-repository'] }));
const team = (): AgentBook => bookOf(home, [LEAD, WORKER, ...CHAIN]);

function ask(parent: TaskEnvelope, agentId = 'worker', change: Record<string, unknown> = {}) {
  return { parentEnvelopeId: parent.envelopeId, childAgentId: agentId, childEnvelope: childEnvelope(parent, change), grants: ['read-repository'], goal: GOAL };
}

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`a control call was refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

describe('H3: an unknown item leaves unknown only on a bound, verified record', () => {
  const at = (ms: number, verify?: (record: Readonly<Record<string, unknown>>) => boolean): QueueContext => ({ binding: home, clock: clockAt(ms), ...(verify === undefined ? {} : { verifyResolution: verify }) });
  const unknown = (id = 'ITEM-1'): QueueItem => {
    const queued = must(newQueueItem(at(NOW), id)).item;
    const running = must(claimItem(at(NOW), emptyQueueControl(), queued, queued.revision)).item;
    return must(recoverAbandoned(at(NOW + QUEUE_LEASE_MS), running, running.revision)).item;
  };
  const record = (item: QueueItem, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    decisionId: 'PLANDEC-0123456789abcdef', decidedBy: 'owner', planDigest: PLAN_DIGEST, outcome: 'requeue', itemId: item.itemId, tenant: item.tenant, project: item.project, revision: item.revision, ...over,
  });
  const later = NOW + QUEUE_LEASE_MS + 1;
  const status = (result: { ok: boolean } & Record<string, unknown>): string => (result.ok ? String((result['item'] as QueueItem).status) : String(result['code']));

  it('resolves on a record bound to the item, its tenant, project and revision, that the port verifies: the control', () => {
    const item = unknown();
    expect(status(resolveUnknown(at(later, () => true), item, record(item), item.revision))).toBe('queued');
  });

  it('refuses a record with no verifier, or a verifier that does not answer exactly true', () => {
    const item = unknown();
    for (const verify of [undefined, () => false, () => 'true' as unknown as boolean, () => 1 as unknown as boolean, () => { throw new Error('no'); }]) {
      expect(status(resolveUnknown(at(later, verify), item, record(item), item.revision))).toBe('RESOLUTION_UNVERIFIED');
    }
  });

  it('refuses a record bound to another item, another tenant or project, or another revision', () => {
    const item = unknown('ITEM-1');
    const other = unknown('ITEM-2');
    for (const over of [{ itemId: other.itemId }, { tenant: 'agency-business' }, { project: 'projectos' }, { revision: item.revision + 1 }]) {
      expect(status(resolveUnknown(at(later, () => true), item, record(item, over), item.revision))).toBe('RESOLUTION');
    }
  });

  it('cannot use one record for two items, or twice for one item', () => {
    const a = unknown('ITEM-1');
    const b = unknown('ITEM-2');
    const forA = record(a);
    expect(status(resolveUnknown(at(later, () => true), b, forA, b.revision))).toBe('RESOLUTION');
    const requeued = must(resolveUnknown(at(later, () => true), a, forA, a.revision)).item;
    const claimed = must(claimItem(at(later + 1, () => true), emptyQueueControl(), requeued, requeued.revision)).item;
    const lostAgain = must(recoverAbandoned(at(later + 1 + QUEUE_LEASE_MS, () => true), claimed, claimed.revision)).item;
    expect(status(resolveUnknown(at(later + 2 + QUEUE_LEASE_MS, () => true), lostAgain, forA, lostAgain.revision))).toBe('RESOLUTION');
  });

  it('refuses to restore a formerly unknown item as queued without its verified resolution', () => {
    const item = unknown();
    const requeued = must(resolveUnknown(at(later, () => true), item, record(item), item.revision)).item;
    const stored = { ...requeued };
    expect(status(restoreQueueItem(at(later + 1, () => true), stored))).toBe('queued');
    expect(status(restoreQueueItem(at(later + 1), stored))).toBe('RESOLUTION_UNVERIFIED');
    expect(status(restoreQueueItem(at(later + 1, () => false), stored))).toBe('RESOLUTION_UNVERIFIED');
    expect(status(restoreQueueItem(at(later + 1, () => true), { ...stored, resolution: null }))).toBe('ITEM_SHAPE');
    expect(status(restoreQueueItem(at(later + 1, () => true), { ...stored, wasUnknown: false }))).toBe('ITEM_SHAPE');
    expect(status(restoreQueueItem(at(later + 1, () => true), { ...stored, resolution: { ...(stored.resolution as object), itemId: 'ITEM-9' } }))).toBe('RESOLUTION');
  });

  it('restores an unknown item with no resolution, and refuses one that claims a resolution it was never given', () => {
    const item = unknown();
    expect(status(restoreQueueItem(at(later), { ...item }))).toBe('unknown');
    expect(status(restoreQueueItem(at(later), { ...item, wasUnknown: false }))).toBe('ITEM_SHAPE');
  });
});

describe('M2: a stale revision is refused, and a long run renews its lease', () => {
  const at = (ms: number): QueueContext => ({ binding: home, clock: clockAt(ms) });
  const running = () => {
    const queued = must(newQueueItem(at(NOW), 'ITEM-1')).item;
    return must(claimItem(at(NOW), emptyQueueControl(), queued, queued.revision)).item;
  };

  it('refuses a move that names a revision the item is no longer at', () => {
    const item = running();
    expect(recoverAbandoned(at(NOW + 1), item, item.revision - 1)).toMatchObject({ ok: false, code: 'STALE_REVISION' });
    expect(claimItem(at(NOW), emptyQueueControl(), must(newQueueItem(at(NOW), 'ITEM-2')).item, 5)).toMatchObject({ ok: false, code: 'STALE_REVISION' });
  });

  it('bumps the revision on every move', () => {
    const item = running();
    expect(item.revision).toBe(1);
    expect(must(renewLease(at(NOW + 1), item, item.revision)).item.revision).toBe(2);
  });

  it('renews a lease that is still held, and does not then call the run lost at its old lease end', () => {
    const item = running();
    const renewed = must(renewLease(at(NOW + 10 * MINUTE), item, item.revision)).item;
    expect(renewed.leaseExpiresAt).toBe(NOW + 10 * MINUTE + QUEUE_LEASE_MS);
    expect(must(recoverAbandoned(at(NOW + QUEUE_LEASE_MS), renewed, renewed.revision))).toMatchObject({ recovered: false });
  });

  it('refuses to renew a lease that has ended, a lease past the renewal cap, or an item that is not running', () => {
    const item = running();
    expect(renewLease(at(NOW + QUEUE_LEASE_MS), item, item.revision)).toMatchObject({ ok: false, code: 'RENEWAL_REFUSED' });
    let current = item;
    for (let count = 0; count < MAX_LEASE_RENEWALS; count += 1) current = must(renewLease(at(NOW + (count + 1) * MINUTE), current, current.revision)).item;
    expect(renewLease(at(NOW + 99 * MINUTE), current, current.revision)).toMatchObject({ ok: false, code: 'RENEWAL_REFUSED' });
    const queued = must(newQueueItem(at(NOW), 'ITEM-3')).item;
    expect(renewLease(at(NOW), queued, queued.revision)).toMatchObject({ ok: false, code: 'BAD_TRANSITION' });
  });
});

describe('H4: a message needs the send_message grant, under any spelling', () => {
  it('names a blocked grant under any spelling, case or separator', () => {
    for (const name of ['send_message', 'send-message', 'Send_Message', 'send.message', ' SEND MESSAGE ', 'delegate.task', 'Delegate-Task', 'CRONJOB_MANAGE', 'memory']) {
      expect(isBlockedGrant(name)).toBe(true);
    }
    expect(isBlockedGrant('read-repository')).toBe(false);
  });

  it('refuses a delegate that asks for a blocked grant under another spelling, even when the parent and its record hold it', () => {
    expect(childGrantProblem(['send-message'], ['send-message'], ['send-message'])).toMatchObject({ code: 'GRANT_BLOCKED' });
    expect(childGrantProblem(['delegate.task'], ['delegate.task'], ['delegate.task'])).toMatchObject({ code: 'GRANT_BLOCKED' });
    expect(childGrantProblem([], [], ['Send_Message'])).toMatchObject({ code: 'GRANT_BLOCKED' });
  });

  const world = () => {
    const agents = bookOf(home, [{ ...LEAD, messageAllow: ['worker'] }, { ...WORKER, messageAllow: ['lead'] }]);
    const root = rootEnvelope(home, { budget: 1000 });
    const first = must(admitDelegation(withRoot(home, agents, root), contextOf(home, agents), ask(root)));
    return { agents, root, book: first.book, delegate: first.node.envelope };
  };
  const send = (book: AgentBook, delegations: DelegationBook, sender: TaskEnvelope, to: string, over: Partial<MessageRequest> = {}, ledger: MessageLedger = emptyMessageLedger()) =>
    admitAgentMessage(book, { binding: home, registry: committedRegistry(), clock: clockAt(NOW), delegations, ledger }, {
      messageId: 'MSG-0001', senderEnvelopeId: sender.envelopeId, toAgentId: to, envelope: childEnvelope(sender, { action: 'request_review', actionClass: 'P2', budget: 0 }),
      body: 'please review the change', ...over,
    });

  it('refuses a delegate that has a messageAllow list: it cannot hold the grant', () => {
    const { agents, book, delegate } = world();
    expect(send(agents, book, delegate, 'lead')).toMatchObject({ ok: false, code: 'SENDER_NO_GRANT' });
  });

  it('refuses a root whose record lacks the grant, and admits one that holds it under another spelling', () => {
    const noGrant = bookOf(home, [{ ...LEAD, grants: ['read-repository'], messageAllow: ['worker'] }, WORKER]);
    const root = rootEnvelope(home);
    expect(send(noGrant, withRoot(home, noGrant, root), root, 'worker')).toMatchObject({ ok: false, code: 'SENDER_NO_GRANT' });
    const spelled = bookOf(home, [{ ...LEAD, grants: ['read-repository', 'send-message'], messageAllow: ['worker'] }, WORKER]);
    const other = rootEnvelope(home);
    expect(send(spelled, withRoot(home, spelled, other), other, 'worker').ok).toBe(true);
  });
});

describe('M4: ending a parent ends what is live beneath it, and an orphan cannot message', () => {
  it('marks the live children of a settled parent unknown, and refuses their messages', () => {
    const agents = bookOf(home, [{ ...LEAD, messageAllow: ['worker'] }, WORKER, ...CHAIN]);
    const root = rootEnvelope(home, { budget: 1000 });
    const one = must(admitDelegation(withRoot(home, agents, root), contextOf(home, agents), ask(root, 'mid')));
    const two = must(admitDelegation(one.book, contextOf(home, agents), ask(one.node.envelope, 'leaf')));
    const ended = must(settleDelegation(two.book, contextOf(home, agents), root.envelopeId, 'completed'));
    expect(delegationNodeAt(ended.book, 'owner-personal', 'polygo', one.node.envelopeId, NOW)).toMatchObject({ state: 'unknown' });
    expect(delegationNodeAt(ended.book, 'owner-personal', 'polygo', two.node.envelopeId, NOW)).toMatchObject({ state: 'unknown' });
    const result = admitAgentMessage(agents, { binding: home, registry: committedRegistry(), clock: clockAt(NOW), delegations: ended.book, ledger: emptyMessageLedger() }, {
      messageId: 'MSG-0001', senderEnvelopeId: one.node.envelopeId, toAgentId: 'worker', envelope: childEnvelope(one.node.envelope, { action: 'request_review', actionClass: 'P2', budget: 0 }), body: 'hello',
    });
    expect(result).toMatchObject({ ok: false, code: 'SENDER_NOT_LIVE' });
  });

  it('ends the live children of a lapsed delegate too', () => {
    const agents = team();
    const root = rootEnvelope(home, { budget: 1000 });
    const one = must(admitDelegation(withRoot(home, agents, root), contextOf(home, agents), ask(root, 'mid')));
    const two = must(admitDelegation(one.book, contextOf(home, agents), ask(one.node.envelope, 'leaf')));
    const later = NOW + DELEGATION_LEASE_MS;
    expect(delegationNodeAt(two.book, 'owner-personal', 'polygo', two.node.envelopeId, later)).toMatchObject({ state: 'unknown' });
  });
});

describe('M5: the parent\'s own spend is held against what it reserved', () => {
  it('lets a child have only what is left after the parent\'s spend, and refuses spend past the budget', () => {
    const root = rootEnvelope(home, { budget: 1000 });
    const book = withRoot(home, team(), root);
    const spent = must(recordDelegateSpend(book, contextOf(home, team()), root.envelopeId, 700));
    expect(admitDelegation(spent.book, contextOf(home, team()), ask(root, 'worker', { budget: 301 }))).toMatchObject({ ok: false, code: 'OVER_BUDGET' });
    expect(admitDelegation(spent.book, contextOf(home, team()), ask(root, 'worker', { budget: 300 })).ok).toBe(true);
    expect(recordDelegateSpend(spent.book, contextOf(home, team()), root.envelopeId, 301)).toMatchObject({ ok: false, code: 'OVER_BUDGET' });
  });

  it('counts what a parent reserved for children against its own spend', () => {
    const root = rootEnvelope(home, { budget: 1000 });
    const reserved = must(admitDelegation(withRoot(home, team(), root), contextOf(home, team()), ask(root, 'worker', { budget: 900 })));
    expect(recordDelegateSpend(reserved.book, contextOf(home, team()), root.envelopeId, 101)).toMatchObject({ ok: false, code: 'OVER_BUDGET' });
  });

  it('refuses a spend that is not a whole positive amount, and a node that is not live', () => {
    const root = rootEnvelope(home);
    const book = withRoot(home, team(), root);
    for (const bad of [0, -5, 1.5, Number.NaN, '5' as unknown as number]) expect(recordDelegateSpend(book, contextOf(home, team()), root.envelopeId, bad)).toMatchObject({ ok: false, code: 'SPEND_SHAPE' });
    const ended = must(settleDelegation(book, contextOf(home, team()), root.envelopeId, 'completed'));
    expect(recordDelegateSpend(ended.book, contextOf(home, team()), root.envelopeId, 5)).toMatchObject({ ok: false, code: 'ALREADY_SETTLED' });
  });
});

describe('M6: a node pins the agent record it started under', () => {
  it('refuses a delegation when the book now holds a different record for the parent', () => {
    const root = rootEnvelope(home);
    const book = withRoot(home, team(), root);
    const swapped = bookOf(home, [{ ...LEAD, grants: ['read-repository', 'search-repository', 'run-sandbox-tests', 'send_message', 'draft-proposal'] }, WORKER, ...CHAIN]);
    expect(admitDelegation(book, contextOf(home, swapped), ask(root))).toMatchObject({ ok: false, code: 'RECORD_CHANGED' });
  });

  it('refuses a message when the sender\'s record has changed mid-run', () => {
    const agents = bookOf(home, [{ ...LEAD, messageAllow: ['worker'] }, WORKER]);
    const root = rootEnvelope(home);
    const delegations = withRoot(home, agents, root);
    const swapped = bookOf(home, [{ ...LEAD, messageAllow: ['worker', 'lead2'] }, WORKER]);
    const result = admitAgentMessage(swapped, { binding: home, registry: committedRegistry(), clock: clockAt(NOW), delegations, ledger: emptyMessageLedger() }, {
      messageId: 'MSG-0001', senderEnvelopeId: root.envelopeId, toAgentId: 'worker', envelope: childEnvelope(root, { action: 'request_review', actionClass: 'P2', budget: 0 }), body: 'hello',
    });
    expect(result).toMatchObject({ ok: false, code: 'SENDER_RECORD_CHANGED' });
  });
});

describe('M7: a conversation ends', () => {
  const agents = bookOf(home, [
    { ...LEAD, messageAllow: ['worker', 'other', 'third'] },
    { ...WORKER, messageAllow: ['lead'] },
    { recordId: 'AGT-other', agentId: 'other' },
    { recordId: 'AGT-third', agentId: 'third' },
  ]);
  const runs = () => {
    const lead = rootEnvelope(home);
    const worker = rootEnvelope(home);
    const book = must(registerRoot(withRoot(home, agents, lead, 'lead'), contextOf(home, agents), { agentId: 'worker', envelope: worker })).book;
    return { lead, worker, book };
  };
  const send = (delegations: DelegationBook, sender: TaskEnvelope, to: string, ledger: MessageLedger, id: string, inReplyTo?: string) =>
    admitAgentMessage(agents, { binding: home, registry: committedRegistry(), clock: clockAt(NOW), delegations, ledger }, {
      messageId: id, senderEnvelopeId: sender.envelopeId, toAgentId: to, ...(inReplyTo === undefined ? {} : { inReplyTo }),
      envelope: childEnvelope(sender, { action: 'request_review', actionClass: 'P2', budget: 0 }), body: 'ping',
    });
  const code = (result: ReturnType<typeof send>): string => (result.ok ? 'ok' : result.code);

  it('admits a message id once', () => {
    const { lead, book } = runs();
    const first = must(send(book, lead, 'worker', emptyMessageLedger(), 'MSG-1'));
    expect(code(send(book, lead, 'worker', first.ledger, 'MSG-1'))).toBe('DUPLICATE_MESSAGE');
  });

  it('counts the hops of a reply chain from the ledger, and stops at the cap', () => {
    const { lead, worker, book } = runs();
    let ledger = emptyMessageLedger();
    let last = must(send(book, lead, 'worker', ledger, 'MSG-1'));
    expect(last.message.hops).toBe(1);
    ledger = last.ledger;
    for (let hop = 2; hop <= MAX_MESSAGE_HOPS; hop += 1) {
      const fromWorker = hop % 2 === 0;
      last = must(send(book, fromWorker ? worker : lead, fromWorker ? 'lead' : 'worker', ledger, `MSG-${hop}`, `MSG-${hop - 1}`));
      expect(last.message.hops).toBe(hop);
      ledger = last.ledger;
    }
    const fromWorker = (MAX_MESSAGE_HOPS + 1) % 2 === 0;
    expect(code(send(book, fromWorker ? worker : lead, fromWorker ? 'lead' : 'worker', ledger, 'MSG-X', `MSG-${MAX_MESSAGE_HOPS}`))).toBe('HOP_CAP');
  });

  it('refuses a reply to a message the replier never received, or one that does not exist', () => {
    const { lead, worker, book } = runs();
    const first = must(send(book, lead, 'worker', emptyMessageLedger(), 'MSG-1'));
    expect(code(send(book, lead, 'worker', first.ledger, 'MSG-2', 'MSG-1'))).toBe('REPLY_UNKNOWN');
    expect(code(send(book, worker, 'lead', first.ledger, 'MSG-2', 'MSG-404'))).toBe('REPLY_UNKNOWN');
  });

  it('caps the messages one pair exchanges, and the size of a ledger, and forgets nothing', () => {
    const { lead, book } = runs();
    let ledger = emptyMessageLedger();
    for (let count = 0; count < MAX_MESSAGES_PER_PAIR; count += 1) ledger = must(send(book, lead, 'worker', ledger, `MSG-A${count}`)).ledger;
    expect(code(send(book, lead, 'worker', ledger, 'MSG-A-over'))).toBe('PAIR_CAP');
    for (let count = 0; count < MAX_MESSAGE_LEDGER_ENTRIES - MAX_MESSAGES_PER_PAIR; count += 1) {
      ledger = must(send(book, lead, count % 2 === 0 ? 'other' : 'third', ledger, `MSG-B${count}`)).ledger;
    }
    expect(ledger.size).toBe(MAX_MESSAGE_LEDGER_ENTRIES);
    expect(code(send(book, lead, 'other', ledger, 'MSG-full'))).toBe('LEDGER_FULL');
    expect(code(send(book, lead, 'third', ledger, 'MSG-full2'))).toBe('LEDGER_FULL');
  });

  it('refuses a ledger this module did not build', () => {
    const { lead, book } = runs();
    expect(code(send(book, lead, 'worker', { size: 0 } as unknown as MessageLedger, 'MSG-1'))).toBe('LEDGER');
  });
});

describe('M3: a book is pruned, exported and restored under the rules', () => {
  const full = () => {
    const agents = team();
    const root = rootEnvelope(home, { budget: 10_000 });
    let book = withRoot(home, agents, root);
    const ids: string[] = [];
    for (let count = 0; count < 3; count += 1) {
      const result = must(admitDelegation(book, contextOf(home, agents), ask(root, 'mid', { budget: 100 })));
      book = result.book;
      ids.push(result.node.envelopeId);
    }
    return { agents, root, book, ids };
  };
  const verified = () => true;

  it('prunes ended delegates with nothing beneath them, and leaves the parent\'s count and reservation alone', () => {
    const { agents, root, book, ids } = full();
    const ended = must(settleDelegation(book, contextOf(home, agents), ids[0] as string, 'completed')).book;
    const result = pruneSettledDelegations(ended, contextOf(home, agents));
    expect(result).toMatchObject({ ok: true, pruned: 1 });
    const kept = result.ok ? result.book : ended;
    expect(delegationNodeAt(kept, 'owner-personal', 'polygo', ids[0] as string, NOW)).toBeNull();
    expect(delegationNodeAt(kept, 'owner-personal', 'polygo', root.envelopeId, NOW)).toMatchObject({ children: 3, reserved: 300 });
  });

  it('does not prune a live or an unknown delegate, or a root, so a spent budget cannot be reset by registering again', () => {
    const { agents, root, book, ids } = full();
    const unknown = must(settleDelegation(book, contextOf(home, agents), ids[1] as string, 'unknown')).book;
    const result = pruneSettledDelegations(unknown, contextOf(home, agents));
    expect(result).toMatchObject({ ok: true, pruned: 0 });
    const ended = must(settleDelegation(unknown, contextOf(home, agents), root.envelopeId, 'completed')).book;
    const pruned = pruneSettledDelegations(ended, contextOf(home, agents));
    expect(registerRoot(pruned.ok ? pruned.book : ended, contextOf(home, agents), { agentId: 'lead', envelope: root })).toMatchObject({ ok: false, code: 'DUPLICATE_ENVELOPE' });
  });

  it('frees node cap by pruning: the cap is not a lifetime cap', () => {
    const agents = team();
    let book = emptyDelegationBook();
    const root = rootEnvelope(home, { budget: 100_000 });
    book = must(registerRoot(book, contextOf(home, agents), { agentId: 'lead', envelope: root })).book;
    let created = 1;
    while (created < MAX_DELEGATION_NODES_PER_PROJECT) {
      book = must(registerRoot(book, contextOf(home, agents), { agentId: 'lead', envelope: rootEnvelope(home) })).book;
      created += 1;
    }
    expect(registerRoot(book, contextOf(home, agents), { agentId: 'lead', envelope: rootEnvelope(home) })).toMatchObject({ ok: false, code: 'BOOK_FULL' });
  });

  it('exports a book as plain data and restores it when the verifier answers exactly true', () => {
    const { agents, book } = full();
    const snapshot = exportDelegationBook(book, home);
    expect(snapshot).not.toBeNull();
    const restored = restoreDelegationBook(contextOf(home, agents), JSON.parse(JSON.stringify(snapshot)), verified);
    expect(restored.ok).toBe(true);
    expect(restored.ok && restored.book.size).toBe(book.size);
  });

  it('refuses a snapshot with no verifier, or one the verifier does not vouch for', () => {
    const { agents, book } = full();
    const snapshot = exportDelegationBook(book, home);
    for (const verify of [undefined, () => false, () => 'true' as unknown as boolean, () => { throw new Error('no'); }]) {
      expect(restoreDelegationBook(contextOf(home, agents), snapshot, verify)).toMatchObject({ ok: false, code: 'SNAPSHOT_UNVERIFIED' });
    }
  });

  it('refuses a snapshot whose tree the rules could not have produced', () => {
    const { agents, book, ids } = full();
    const snapshot = JSON.parse(JSON.stringify(exportDelegationBook(book, home))) as { nodes: Record<string, unknown>[] };
    const tweak = (change: (nodes: Record<string, unknown>[]) => void) => {
      const copy = JSON.parse(JSON.stringify(snapshot)) as { lastSeen: number; nodes: Record<string, unknown>[] };
      change(copy.nodes);
      return restoreDelegationBook(contextOf(home, agents), copy, verified);
    };
    const rootNode = (nodes: Record<string, unknown>[]) => nodes.find((node) => node['parentEnvelopeId'] === null) as Record<string, unknown>;
    expect(tweak((nodes) => { rootNode(nodes)['reserved'] = 0; })).toMatchObject({ ok: false, code: 'SNAPSHOT_INVARIANT' });
    expect(tweak((nodes) => { rootNode(nodes)['children'] = 1; })).toMatchObject({ ok: false, code: 'SNAPSHOT_INVARIANT' });
    expect(tweak((nodes) => { (nodes.find((node) => node['envelopeId'] === ids[0]) as Record<string, unknown>)['depth'] = 2; })).toMatchObject({ ok: false, code: 'SNAPSHOT_INVARIANT' });
    expect(tweak((nodes) => { nodes.splice(nodes.indexOf(rootNode(nodes)), 1); })).toMatchObject({ ok: false, code: 'SNAPSHOT_INVARIANT' });
    expect(tweak((nodes) => { (nodes[0] as Record<string, unknown>)['tenant'] = 'agency-business'; })).toMatchObject({ ok: false, code: 'SNAPSHOT_SHAPE' });
    expect(tweak((nodes) => { nodes.push({ ...(nodes[1] as object) }); })).toMatchObject({ ok: false });
    expect(tweak((nodes) => { (nodes[1] as Record<string, unknown>)['recordHash'] = `sha256:${'0'.repeat(64)}`; })).toMatchObject({ ok: false, code: 'SNAPSHOT_SHAPE' });
    expect(tweak((nodes) => { (nodes[1] as Record<string, unknown>)['surprise'] = 1; })).toMatchObject({ ok: false, code: 'SNAPSHOT_SHAPE' });
  });

  it('refuses a snapshot older than the clock allows, and a binding or agent book this module did not build', () => {
    const { agents, book } = full();
    const snapshot = exportDelegationBook(book, home);
    expect(restoreDelegationBook(contextOf(home, agents, NOW - 1), snapshot, verified)).toMatchObject({ ok: false, code: 'CLOCK' });
    expect(restoreDelegationBook({ ...contextOf(home, agents), binding: { ...home } }, snapshot, verified)).toMatchObject({ ok: false, code: 'BINDING' });
    expect(exportDelegationBook(book, { ...home })).toBeNull();
  });

  it('releases a lapsed delegate\'s slot on a verified record bound to it, once, and keeps its budget reserved', () => {
    const { agents, root, book, ids } = full();
    const unknown = must(settleDelegation(book, contextOf(home, agents), ids[0] as string, 'unknown')).book;
    const record = (id: string) => ({ decisionId: 'PLANDEC-0123456789abcdef', decidedBy: 'owner', planDigest: PLAN_DIGEST, envelopeId: id, tenant: 'owner-personal', project: 'polygo' });
    expect(releaseDelegation(unknown, contextOf(home, agents), ids[0] as string, record(ids[0] as string), undefined)).toMatchObject({ ok: false, code: 'RELEASE_UNVERIFIED' });
    expect(releaseDelegation(unknown, contextOf(home, agents), ids[0] as string, record(ids[1] as string), verified)).toMatchObject({ ok: false, code: 'RELEASE_UNVERIFIED' });
    expect(releaseDelegation(unknown, contextOf(home, agents), ids[1] as string, record(ids[1] as string), verified)).toMatchObject({ ok: false, code: 'NOT_RELEASABLE' });
    const freed = must(releaseDelegation(unknown, contextOf(home, agents), ids[0] as string, record(ids[0] as string), verified));
    expect(delegationNodeAt(freed.book, 'owner-personal', 'polygo', ids[0] as string, NOW)).toMatchObject({ state: 'unknown', released: true });
    expect(releaseDelegation(freed.book, contextOf(home, agents), ids[0] as string, record(ids[0] as string), verified)).toMatchObject({ ok: false, code: 'NOT_RELEASABLE' });
    expect(delegationNodeAt(freed.book, 'owner-personal', 'polygo', root.envelopeId, NOW)).toMatchObject({ reserved: 300 });
  });
});

describe('LOW: caps, surrogate pairs and a time that cannot be trusted', () => {
  it('holds a per-root cap on delegates that hold a slot', () => {
    const agents = team();
    const root = rootEnvelope(home, { budget: 100_000 });
    let book = withRoot(home, agents, root);
    const mids: TaskEnvelope[] = [];
    for (let count = 0; count < 5; count += 1) {
      const result = must(admitDelegation(book, contextOf(home, agents), ask(root, 'mid', { budget: 1000 })));
      book = result.book;
      mids.push(result.node.envelope);
    }
    for (let count = 0; count < MAX_LIVE_DELEGATES_PER_ROOT - 5; count += 1) book = must(admitDelegation(book, contextOf(home, agents), ask(mids[0] as TaskEnvelope, 'leaf', { budget: 100 }))).book;
    expect(admitDelegation(book, contextOf(home, agents), ask(mids[0] as TaskEnvelope, 'leaf', { budget: 100 }))).toMatchObject({ ok: false, code: 'ROOT_CAP' });
  });

  it('does not cut a surrogate pair when it cuts a delegate\'s output', () => {
    const agents = team();
    const root = rootEnvelope(home);
    const first = must(admitDelegation(withRoot(home, agents, root), contextOf(home, agents), ask(root)));
    const text = `${'x'.repeat(MAX_DELEGATE_OUTPUT_CHARS - 1)}\u{1F600}tail`;
    const out = must(delegateOutput(first.book, contextOf(home, agents), first.node.envelopeId, text)).output;
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBe(MAX_DELEGATE_OUTPUT_CHARS - 1);
    expect(/[\ud800-\udbff]$/.test(out.text)).toBe(false);
  });

  it('answers no node for a time that is not whole, is not finite, or is behind the book', () => {
    const agents = team();
    const root = rootEnvelope(home);
    const book = withRoot(home, agents, root);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, NOW - 1]) expect(delegationNodeAt(book, 'owner-personal', 'polygo', root.envelopeId, bad)).toBeNull();
    expect(delegationNodeAt(book, 'owner-personal', 'polygo', root.envelopeId, NOW)).not.toBeNull();
  });
});
