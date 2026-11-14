import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGES_PER_PAIR,
  MAX_TOMBSTONES_PER_PROJECT,
  MESSAGE_WINDOW_MS,
  admitAgentMessage,
  admitDelegation,
  claimItem,
  deepSnapshot,
  emptyDelegationBook,
  emptyMessageLedger,
  emptyQueueControl,
  exportDelegationBook,
  newQueueItem,
  pruneSettledDelegations,
  recordDelegateSpend,
  registerRoot,
  restoreDelegationBook,
  restoreQueueItem,
  runDelegated,
  settleDelegation,
  snapshotEnvelope,
  type AgentBook,
  type DelegationBook,
  type MessageLedger,
  type QueueContext,
} from '../src/agents/index.js';
import type { TaskEnvelope } from '../src/taskEnvelope.js';
import { LEAD, NOW, WORKER, bookOf, childEnvelope, clockAt, committedRegistry, contextOf, fakeTimer, polygo, rootEnvelope, withRoot } from './agents-support.js';

const home = polygo();
const GOAL = 'Run the validators for the changed files and report each failure by name.';
const CHAIN = ['mid', 'leaf'].map((agentId) => ({ recordId: `AGT-${agentId}`, agentId, mayDelegate: true, grants: ['read-repository'] }));
const team = (): AgentBook => bookOf(home, [LEAD, WORKER, ...CHAIN]);
const verified = () => true;

function ask(parent: TaskEnvelope, agentId = 'worker', change: Record<string, unknown> = {}) {
  return { parentEnvelopeId: parent.envelopeId, childAgentId: agentId, childEnvelope: childEnvelope(parent, change), grants: ['read-repository'], goal: GOAL };
}

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`a control call was refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

describe('N1: a snapshot is copied once, deeply, and the copy is what is verified and restored', () => {
  const honest = () => {
    const agents = team();
    const root = rootEnvelope(home, { budget: 1000 });
    const spent = must(recordDelegateSpend(withRoot(home, agents, root), contextOf(home, agents), root.envelopeId, 400));
    const first = must(admitDelegation(spent.book, contextOf(home, agents), ask(root, 'worker', { budget: 100 })));
    return { agents, root, book: first.book, child: first.node };
  };

  it('restores exactly what the verifier was shown, even when the nodes array answers differently the second time', () => {
    const { agents, book } = honest();
    const snapshot = JSON.parse(JSON.stringify(exportDelegationBook(book, home))) as { lastSeen: number; nodes: Record<string, unknown>[]; tombstones: unknown[] };
    const forgedNodes = snapshot.nodes.map((node) => (node['parentEnvelopeId'] === null ? { ...node, spent: 0 } : node));
    const reads = new Map<string, number>();
    const hostile = new Proxy(snapshot.nodes, {
      getOwnPropertyDescriptor(target, key) {
        const seen = (reads.get(String(key)) ?? 0) + 1;
        reads.set(String(key), seen);
        const source = seen === 1 ? target : forgedNodes;
        return Reflect.getOwnPropertyDescriptor(source, key);
      },
      get(target, key) {
        const seen = (reads.get(`get:${String(key)}`) ?? 0) + 1;
        reads.set(`get:${String(key)}`, seen);
        return Reflect.get(seen === 1 ? target : forgedNodes, key);
      },
    });
    let shown: { nodes: { spent: number; parentEnvelopeId: string | null }[] } | null = null;
    const result = restoreDelegationBook(contextOf(home, agents), { ...snapshot, nodes: hostile }, (copy) => {
      shown = copy as typeof shown;
      return true;
    });
    const seenRoot = (shown as unknown as { nodes: { spent: number; parentEnvelopeId: string | null }[] }).nodes.find((node) => node.parentEnvelopeId === null);
    expect(result.ok).toBe(true);
    const restored = result.ok ? exportDelegationBook(result.book, home) : null;
    const root = restored?.nodes.find((node) => node['parentEnvelopeId'] === null);
    expect(seenRoot?.spent).toBe(400);
    expect(root?.['spent']).toBe(400);
  });

  it('refuses a snapshot that holds an accessor, a symbol key, an odd prototype or a hole', () => {
    const { agents, book } = honest();
    const snapshot = JSON.parse(JSON.stringify(exportDelegationBook(book, home))) as { nodes: Record<string, unknown>[] };
    const withGetter = { ...snapshot, nodes: snapshot.nodes.map((node) => ({ ...node })) };
    Object.defineProperty(withGetter.nodes[0] as object, 'spent', { enumerable: true, get: () => 0 });
    expect(restoreDelegationBook(contextOf(home, agents), withGetter, verified)).toMatchObject({ ok: false, code: 'SNAPSHOT_SHAPE' });
    const withSymbol = { ...snapshot, nodes: snapshot.nodes.map((node) => ({ ...node, [Symbol('x')]: 1 })) };
    expect(restoreDelegationBook(contextOf(home, agents), withSymbol, verified)).toMatchObject({ ok: false, code: 'SNAPSHOT_SHAPE' });
    expect(restoreDelegationBook(contextOf(home, agents), Object.assign(Object.create({ inherited: 1 }), snapshot), verified)).toMatchObject({ ok: false, code: 'SNAPSHOT_SHAPE' });
    const holey = { ...snapshot, nodes: [...snapshot.nodes] };
    holey.nodes.length = holey.nodes.length + 1;
    expect(restoreDelegationBook(contextOf(home, agents), holey, verified)).toMatchObject({ ok: false, code: 'SNAPSHOT_SHAPE' });
  });

  it('copies deeply and once: a nested accessor, a deep structure and a long array are refused', () => {
    expect(deepSnapshot({ a: [1, { b: 'x' }] })).toEqual({ a: [1, { b: 'x' }] });
    expect(Object.isFrozen(deepSnapshot({ a: [1] }))).toBe(true);
    const nested = { a: { b: {} } };
    Object.defineProperty(nested.a.b, 'c', { enumerable: true, get: () => 1 });
    expect(deepSnapshot(nested)).toBeUndefined();
    let deep: unknown = 1;
    for (let level = 0; level < 20; level += 1) deep = { deep };
    expect(deepSnapshot(deep)).toBeUndefined();
    expect(deepSnapshot(new Array(10_000).fill(1))).toBeUndefined();
    expect(deepSnapshot({ f: () => 1 })).toBeUndefined();
    expect(deepSnapshot({ n: Number.NaN })).toBeUndefined();
  });

  it('reads the length of a list once: a Proxy that answers a new length each time cannot make the copy run on', () => {
    let lengthReads = 0;
    const hostile = new Proxy(['docs/'], {
      get(target, key) {
        if (key === 'length') {
          lengthReads += 1;
          return lengthReads === 1 ? 1 : 1e9;
        }
        return Reflect.get(target, key);
      },
    });
    expect(deepSnapshot(hostile)).toEqual(['docs/']);
    expect(lengthReads).toBe(1);
    lengthReads = 0;
    const real = rootEnvelope(home);
    const plain = snapshotEnvelope({ ...real, scope: hostile });
    expect(plain?.['scope']).toEqual(['docs/']);
    expect(lengthReads).toBe(1);
  });

  it('re-checks on restore: a blocked grant on a delegate, a reservation past the budget, a negative spend', () => {
    const { agents, book, child } = honest();
    const snapshot = JSON.parse(JSON.stringify(exportDelegationBook(book, home))) as { nodes: Record<string, unknown>[] };
    const tweak = (change: (nodes: Record<string, unknown>[]) => void) => {
      const copy = JSON.parse(JSON.stringify(snapshot)) as { nodes: Record<string, unknown>[] };
      change(copy.nodes);
      return restoreDelegationBook(contextOf(home, agents), copy, verified);
    };
    const find = (nodes: Record<string, unknown>[], id: string) => nodes.find((node) => node['envelopeId'] === id) as Record<string, unknown>;
    expect(tweak((nodes) => { find(nodes, child.envelopeId)['grants'] = ['send_message']; })).toMatchObject({ ok: false, code: 'SNAPSHOT_INVARIANT' });
    expect(tweak((nodes) => { find(nodes, child.envelopeId)['grants'] = ['Send-Message']; })).toMatchObject({ ok: false });
    expect(tweak((nodes) => { (nodes.find((node) => node['parentEnvelopeId'] === null) as Record<string, unknown>)['reserved'] = 2000; })).toMatchObject({ ok: false, code: 'SNAPSHOT_INVARIANT' });
    expect(tweak((nodes) => { (nodes.find((node) => node['parentEnvelopeId'] === null) as Record<string, unknown>)['spent'] = -1; })).toMatchObject({ ok: false, code: 'SNAPSHOT_SHAPE' });
    expect(tweak((nodes) => { find(nodes, child.envelopeId)['lineage'] = ['lead', 'lead']; })).toMatchObject({ ok: false });
  });
});

describe('N2: a timer that does not work fails closed before the work starts', () => {
  const setup = () => {
    const agents = team();
    const root = rootEnvelope(home);
    return { agents, root, holder: { book: withRoot(home, agents, root) } };
  };

  it('refuses to run, and admits nothing, when the timer throws', async () => {
    const { agents, root, holder } = setup();
    let ran = 0;
    const before = holder.book;
    const answer = await runDelegated(holder, contextOf(home, agents), ask(root), async () => {
      ran += 1;
      return 1;
    }, () => {
      throw new Error('no timer');
    });
    expect(answer).toMatchObject({ ok: false, code: 'NO_TIMER' });
    expect(ran).toBe(0);
    expect(holder.book).toBe(before);
  });

  it('refuses to run when the timer returns no way to cancel it, or one that is not a function', async () => {
    const { agents, root, holder } = setup();
    for (const bad of [undefined, 5, null]) {
      const answer = await runDelegated(holder, contextOf(home, agents), ask(root), async () => 1, (() => bad) as never);
      expect(answer).toMatchObject({ ok: false, code: 'NO_TIMER' });
    }
    expect(holder.book.size).toBe(1);
  });

  it('keeps the slot of work that outlives its deadline: a timer that fires, or one whose cancel throws, frees nothing', async () => {
    const { agents, root, holder } = setup();
    const clock = fakeTimer();
    let id = '';
    const pending = runDelegated(holder, contextOf(home, agents), ask(root), (node) => {
      id = node.envelopeId;
      return new Promise<number>(() => undefined);
    }, (ms, fire) => {
      clock.timer(ms, fire);
      return () => {
        throw new Error('cancel failed');
      };
    });
    await Promise.resolve();
    clock.fire(0);
    expect(await pending).toMatchObject({ ok: false, code: 'LAPSED' });
    const settled = settleDelegation(holder.book, contextOf(home, agents), id, 'completed');
    expect(settled).toMatchObject({ ok: false, code: 'ALREADY_SETTLED' });
  });

  it('still returns the value when the cancel throws after the work finished in time', async () => {
    const { agents, root, holder } = setup();
    const answer = await runDelegated(holder, contextOf(home, agents), ask(root), async () => 7, () => () => {
      throw new Error('cancel failed');
    });
    expect(answer).toMatchObject({ ok: true, value: 7 });
  });
});

describe('N3: roots and children are pruned, and what was pruned cannot be admitted again', () => {
  const agents = team();
  const rootsAtCap = (count: number): { book: DelegationBook; roots: TaskEnvelope[] } => {
    let book = emptyDelegationBook();
    const roots: TaskEnvelope[] = [];
    for (let index = 0; index < count; index += 1) {
      const root = rootEnvelope(home);
      book = must(registerRoot(book, contextOf(home, agents), { agentId: 'lead', envelope: root })).book;
      roots.push(root);
    }
    return { book, roots };
  };
  const endAll = (book: DelegationBook, roots: TaskEnvelope[]): DelegationBook =>
    roots.reduce((held, root) => must(settleDelegation(held, contextOf(home, agents), root.envelopeId, 'completed')).book, book);

  it('prunes settled roots, so a project that reached the node cap is not full for ever', () => {
    const { book, roots } = rootsAtCap(60);
    expect(registerRoot(book, contextOf(home, agents), { agentId: 'lead', envelope: rootEnvelope(home) })).toMatchObject({ ok: false, code: 'BOOK_FULL' });
    const pruned = must(pruneSettledDelegations(endAll(book, roots), contextOf(home, agents)));
    expect(pruned.pruned).toBe(60);
    expect(registerRoot(pruned.book, contextOf(home, agents), { agentId: 'lead', envelope: rootEnvelope(home) }).ok).toBe(true);
  });

  it('refuses a pruned root registered again, and a pruned child admitted again, without spending fan-out or reservation', () => {
    const root = rootEnvelope(home, { budget: 1000 });
    const first = must(admitDelegation(withRoot(home, agents, root), contextOf(home, agents), ask(root, 'worker', { budget: 600 })));
    const ended = must(settleDelegation(first.book, contextOf(home, agents), first.node.envelopeId, 'completed')).book;
    const pruned = must(pruneSettledDelegations(ended, contextOf(home, agents)));
    expect(pruned.pruned).toBe(1);
    const replay = { parentEnvelopeId: root.envelopeId, childAgentId: 'worker', childEnvelope: first.node.envelope, grants: ['read-repository'], goal: GOAL };
    expect(admitDelegation(pruned.book, contextOf(home, agents), replay)).toMatchObject({ ok: false, code: 'DUPLICATE_ENVELOPE' });
    const stillThere = exportDelegationBook(pruned.book, home)?.nodes.find((node) => node['envelopeId'] === root.envelopeId);
    expect(stillThere).toMatchObject({ children: 1, reserved: 600 });
    const wholeTree = must(pruneSettledDelegations(must(settleDelegation(pruned.book, contextOf(home, agents), root.envelopeId, 'completed')).book, contextOf(home, agents)));
    expect(registerRoot(wholeTree.book, contextOf(home, agents), { agentId: 'lead', envelope: root })).toMatchObject({ ok: false, code: 'DUPLICATE_ENVELOPE' });
  });

  it('prunes a whole ended subtree together, and none of it while anything beneath is unknown', () => {
    const root = rootEnvelope(home, { budget: 1000 });
    const one = must(admitDelegation(withRoot(home, agents, root), contextOf(home, agents), ask(root, 'mid')));
    const two = must(admitDelegation(one.book, contextOf(home, agents), ask(one.node.envelope, 'leaf')));
    const lost = must(settleDelegation(two.book, contextOf(home, agents), two.node.envelopeId, 'unknown')).book;
    const stopped = must(settleDelegation(must(settleDelegation(lost, contextOf(home, agents), one.node.envelopeId, 'completed')).book, contextOf(home, agents), root.envelopeId, 'completed')).book;
    expect(must(pruneSettledDelegations(stopped, contextOf(home, agents))).pruned).toBe(0);
    const clean = must(settleDelegation(must(settleDelegation(must(settleDelegation(two.book, contextOf(home, agents), two.node.envelopeId, 'completed')).book, contextOf(home, agents), one.node.envelopeId, 'completed')).book, contextOf(home, agents), root.envelopeId, 'completed')).book;
    expect(must(pruneSettledDelegations(clean, contextOf(home, agents))).pruned).toBe(3);
  });

  it('refuses to prune when the pruned ids are full, forgets none of them, and frees them once their envelopes have expired', () => {
    const round = (start: DelegationBook): { book: DelegationBook; roots: TaskEnvelope[] } => {
      let held = start;
      const roots: TaskEnvelope[] = [];
      for (let index = 0; index < 60; index += 1) {
        const root = rootEnvelope(home);
        held = must(registerRoot(held, contextOf(home, agents), { agentId: 'lead', envelope: root })).book;
        roots.push(root);
      }
      return { book: endAll(held, roots), roots };
    };
    let book = emptyDelegationBook();
    for (let rounds = 0; rounds * 60 + 60 <= MAX_TOMBSTONES_PER_PROJECT; rounds += 1) book = must(pruneSettledDelegations(round(book).book, contextOf(home, agents))).book;
    const last = round(book);
    expect(pruneSettledDelegations(last.book, contextOf(home, agents))).toMatchObject({ ok: false, code: 'TOMBSTONES_FULL' });
    expect(last.book.size).toBe(60);
    const afterExpiry = Date.parse('2026-11-14T19:00:00.000Z');
    expect(pruneSettledDelegations(last.book, contextOf(home, agents, afterExpiry))).toMatchObject({ ok: true, pruned: 60 });
  });

  it('refuses a child whose own envelope has already expired', () => {
    const root = rootEnvelope(home, { budget: 1000 });
    const book = withRoot(home, agents, root);
    expect(admitDelegation(book, contextOf(home, agents), ask(root, 'worker', { expiry: '2026-11-14T11:00:00.000Z' }))).toMatchObject({ ok: false, code: 'CHILD_EXPIRED' });
  });

  it('exports the pruned ids and restores them, so a restored book still refuses a replay', () => {
    const root = rootEnvelope(home, { budget: 1000 });
    const first = must(admitDelegation(withRoot(home, agents, root), contextOf(home, agents), ask(root)));
    const ended = must(settleDelegation(first.book, contextOf(home, agents), first.node.envelopeId, 'completed')).book;
    const pruned = must(pruneSettledDelegations(ended, contextOf(home, agents))).book;
    const snapshot = JSON.parse(JSON.stringify(exportDelegationBook(pruned, home)));
    const restored = must(restoreDelegationBook(contextOf(home, agents), snapshot, verified));
    const replay = { parentEnvelopeId: root.envelopeId, childAgentId: 'worker', childEnvelope: first.node.envelope, grants: ['read-repository'], goal: GOAL };
    expect(admitDelegation(restored.book, contextOf(home, agents), replay)).toMatchObject({ ok: false, code: 'DUPLICATE_ENVELOPE' });
  });
});

describe('N4: the message caps are a rate over a window, and the ledger stays bounded', () => {
  const agents = bookOf(home, [{ ...LEAD, messageAllow: ['worker'] }, WORKER]);
  const world = () => {
    const root = rootEnvelope(home, { budget: 1000 });
    return { root, delegations: withRoot(home, agents, root) };
  };
  const send = (root: TaskEnvelope, delegations: DelegationBook, ledger: MessageLedger, id: string, ms: number) =>
    admitAgentMessage(agents, { binding: home, registry: committedRegistry(), clock: clockAt(ms), delegations, ledger }, {
      messageId: id, senderEnvelopeId: root.envelopeId, toAgentId: 'worker', envelope: childEnvelope(root, { action: 'request_review', actionClass: 'P2', budget: 0 }), body: 'ping',
    });

  it('refuses the pair cap inside the window and admits again once the window has passed, with the old entries forgotten', () => {
    const { root, delegations } = world();
    let ledger = emptyMessageLedger();
    for (let count = 0; count < MAX_MESSAGES_PER_PAIR; count += 1) ledger = must(send(root, delegations, ledger, `MSG-A${count}`, NOW)).ledger;
    expect(send(root, delegations, ledger, 'MSG-over', NOW + MESSAGE_WINDOW_MS - 1)).toMatchObject({ ok: false, code: 'PAIR_CAP' });
    const later = must(send(root, delegations, ledger, 'MSG-over', NOW + MESSAGE_WINDOW_MS));
    expect(later.ledger.size).toBe(1);
  });

  it('admits a message id again after the window, and not inside it', () => {
    const { root, delegations } = world();
    const first = must(send(root, delegations, emptyMessageLedger(), 'MSG-1', NOW));
    expect(send(root, delegations, first.ledger, 'MSG-1', NOW + 1)).toMatchObject({ ok: false, code: 'DUPLICATE_MESSAGE' });
    expect(send(root, delegations, first.ledger, 'MSG-1', NOW + MESSAGE_WINDOW_MS).ok).toBe(true);
  });

  it('refuses a clock that reads earlier than the latest message in the ledger', () => {
    const { root, delegations } = world();
    const first = must(send(root, delegations, emptyMessageLedger(), 'MSG-1', NOW + 5));
    expect(send(root, delegations, first.ledger, 'MSG-2', NOW + 1)).toMatchObject({ ok: false, code: 'CLOCK' });
  });
});

describe('N5: a root is the kernel\'s run envelope of its own agent', () => {
  it('refuses to register a root for an agent other than the actor the kernel named', () => {
    const agents = team();
    const root = rootEnvelope(home, { agent: 'claude-code-cli' });
    expect(registerRoot(emptyDelegationBook(), contextOf(home, agents), { agentId: 'lead', envelope: root })).toMatchObject({ ok: false, code: 'ROOT_AGENT_MISMATCH' });
    const named = rootEnvelope(home, { agent: 'lead' });
    expect(registerRoot(emptyDelegationBook(), contextOf(home, agents), { agentId: 'lead', envelope: named }).ok).toBe(true);
  });

  it('refuses a kernel-admitted envelope that is not a run', () => {
    const agents = team();
    const notARun = rootEnvelope(home, { action: 'implement' });
    expect(registerRoot(emptyDelegationBook(), contextOf(home, agents), { agentId: 'lead', envelope: notARun })).toMatchObject({ ok: false, code: 'ROOT_NOT_A_RUN' });
  });
});

describe('N6: a stored item that has started comes back only when the store vouches for it', () => {
  const at = (verifyItem?: (record: Readonly<Record<string, unknown>>) => boolean): QueueContext => ({ binding: home, clock: clockAt(NOW + 10), ...(verifyItem === undefined ? {} : { verifyItem }) });
  const fresh = () => must(newQueueItem({ binding: home, clock: clockAt(NOW) }, 'ITEM-1')).item;
  const running = () => must(claimItem({ binding: home, clock: clockAt(NOW) }, emptyQueueControl(), fresh(), 0)).item;
  const status = (result: { ok: boolean } & Record<string, unknown>): string => (result.ok ? String((result['item'] as { status: string }).status) : String(result['code']));

  it('restores an unstarted queued item with no verifier: nothing was done to it', () => {
    expect(status(restoreQueueItem(at(), { ...fresh() }))).toBe('queued');
  });

  it('refuses a completed, running, paused or attempted item with no verifier, or with one that does not answer exactly true', () => {
    const done = { ...running(), status: 'completed', leaseExpiresAt: null };
    const attempted = { ...fresh(), attempts: 2 };
    for (const stored of [done, { ...running() }, attempted]) {
      expect(status(restoreQueueItem(at(), stored))).toBe('ITEM_UNVERIFIED');
      expect(status(restoreQueueItem(at(() => false), stored))).toBe('ITEM_UNVERIFIED');
      expect(status(restoreQueueItem(at(() => 'true' as unknown as boolean), stored))).toBe('ITEM_UNVERIFIED');
      expect(status(restoreQueueItem(at(() => { throw new Error('no'); }), stored))).toBe('ITEM_UNVERIFIED');
      expect(status(restoreQueueItem(at(verified), stored))).not.toBe('ITEM_UNVERIFIED');
    }
  });

  it('shows the verifier the item it is about to restore', () => {
    let shown: Readonly<Record<string, unknown>> | null = null;
    const stored = { ...fresh(), attempts: 1 };
    restoreQueueItem(at((record) => { shown = record; return true; }), stored);
    expect((shown as unknown as { attempts: number }).attempts).toBe(1);
  });
});
