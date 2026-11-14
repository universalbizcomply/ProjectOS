import { describe, expect, it } from 'vitest';
import { admitAgentMessage, admitDelegation, emptyDelegationBook, emptyMessageLedger, registerRoot, type DelegationRequest } from '../src/agents/index.js';
import type { TaskEnvelope } from '../src/taskEnvelope.js';
import { LEAD, WORKER, bookOf, childEnvelope, clockAt, committedRegistry, contextOf, polygo, rootEnvelope, withRoot } from './agents-support.js';

const home = polygo();
const agents = () => bookOf(home, [LEAD, WORKER]);
const GOAL = 'Run the validators for the changed files and report each failure by name.';

function asked(parent: TaskEnvelope, child: unknown): DelegationRequest {
  return { parentEnvelopeId: parent.envelopeId, childAgentId: 'worker', childEnvelope: child, grants: ['read-repository'], goal: GOAL };
}

/** A child envelope whose `field` answers `first` the first time it is read and `later` every time after. */
function flipping(parent: TaskEnvelope, field: string, first: unknown, later: unknown): unknown {
  const child = childEnvelope(parent) as unknown as Record<string, unknown>;
  const copy: Record<string, unknown> = { ...child };
  let reads = 0;
  Object.defineProperty(copy, field, { enumerable: true, get: () => (reads++ === 0 ? first : later) });
  return copy;
}

describe('H1: an envelope is read once, and an accessor is refused', () => {
  it.each([
    ['budget', 0, -1e15],
    ['expiry', '2026-11-14T13:00:00.000Z', '2030-01-01T00:00:00.000Z'],
    ['subjectHash', 'a'.repeat(40), 'b'.repeat(40)],
    ['idempotencyKey', `sha256:${'b'.repeat(64)}`, `sha256:${'c'.repeat(64)}`],
  ])('refuses a child envelope whose %s is a getter', (field, first, later) => {
    const parent = rootEnvelope(home);
    const book = withRoot(home, agents(), parent);
    const result = admitDelegation(book, contextOf(home, agents()), asked(parent, flipping(parent, field, first, later)));
    expect(result).toMatchObject({ ok: false, code: 'ENVELOPE_R1' });
  });

  it('refuses a child envelope whose actor is a getter, or whose scope holds one', () => {
    const parent = rootEnvelope(home);
    const book = withRoot(home, agents(), parent);
    const actor = childEnvelope(parent) as unknown as Record<string, unknown>;
    const inner = { ...(actor['actor'] as object) };
    Object.defineProperty(inner, 'model', { enumerable: true, get: () => 'x' });
    expect(admitDelegation(book, contextOf(home, agents()), asked(parent, { ...actor, actor: inner }))).toMatchObject({ ok: false, code: 'ENVELOPE_R1' });
    const scope = ['docs/'];
    Object.defineProperty(scope, 0, { enumerable: true, get: () => 'docs/' });
    expect(admitDelegation(book, contextOf(home, agents()), asked(parent, { ...actor, scope }))).toMatchObject({ ok: false, code: 'ENVELOPE_R1' });
  });

  it('keeps the parent reservation sane even when a budget getter returns a negative the second time', () => {
    const parent = rootEnvelope(home, { budget: 1000 });
    let book = withRoot(home, agents(), parent);
    const first = admitDelegation(book, contextOf(home, agents()), asked(parent, flipping(parent, 'budget', 0, -1e15)));
    expect(first.ok).toBe(false);
    book = first.book;
    const second = admitDelegation(book, contextOf(home, agents()), asked(parent, childEnvelope(parent, { budget: 1000 })));
    expect(second.ok).toBe(true);
  });

  it('reads a getter on the context once: a binding that changes between reads cannot be half checked', () => {
    const parent = rootEnvelope(home);
    const book = withRoot(home, agents(), parent);
    const context = contextOf(home, agents());
    let reads = 0;
    const tricky = { ...context };
    Object.defineProperty(tricky, 'clock', { enumerable: true, get: () => (reads++ === 0 ? clockAt(Date.parse('2026-11-14T12:00:00.000Z')) : () => Number.NaN) });
    const result = admitDelegation(book, tricky, asked(parent, childEnvelope(parent)));
    expect(result.ok).toBe(true);
    expect(reads).toBe(1);
  });

  it('refuses a message envelope that is a getter', () => {
    const parent = rootEnvelope(home);
    const delegations = withRoot(home, bookOf(home, [{ ...LEAD, messageAllow: ['worker'] }, WORKER]), parent);
    const result = admitAgentMessage(
      bookOf(home, [{ ...LEAD, messageAllow: ['worker'] }, WORKER]),
      { binding: home, registry: committedRegistry(), clock: clockAt(Date.parse('2026-11-14T12:00:00.000Z')), delegations, ledger: emptyMessageLedger() },
      {
        messageId: 'MSG-0001',
        senderEnvelopeId: parent.envelopeId,
        toAgentId: 'worker',
        envelope: flipping(parent, 'budget', 0, 5),
        body: 'hello there, please review',
      } as never,
    );
    expect(result).toMatchObject({ ok: false, code: 'ENVELOPE_R1' });
  });
});

describe('H2: a root must be an envelope the kernel admitted', () => {
  it('refuses a hand-built root with a budget of 10^12 and a P5 class', () => {
    const real = rootEnvelope(home);
    const forged = { ...real, budget: 1e12, actionClass: 'P5', action: 'approve' } as unknown as TaskEnvelope;
    expect(registerRoot(emptyDelegationBook(), contextOf(home, agents()), { agentId: 'lead', envelope: forged })).toMatchObject({ ok: false, code: 'ROOT_NOT_ADMITTED' });
  });

  it('refuses a perfect copy of an admitted root', () => {
    const real = rootEnvelope(home);
    expect(registerRoot(emptyDelegationBook(), contextOf(home, agents()), { agentId: 'lead', envelope: { ...real } })).toMatchObject({ ok: false, code: 'ROOT_NOT_ADMITTED' });
  });

  it('registers an envelope the kernel admitted: the control', () => {
    const real = rootEnvelope(home);
    expect(registerRoot(emptyDelegationBook(), contextOf(home, agents()), { agentId: 'lead', envelope: real }).ok).toBe(true);
  });
});
