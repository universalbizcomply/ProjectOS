import { describe, expect, it } from 'vitest';
import {
  MAX_AGENTS_PER_PROJECT,
  MAX_AGENT_GRANTS,
  addAgent,
  admitAgentRecord,
  emptyAgentBook,
  findAgent,
  isAdmittedAgentRecord,
} from '../src/agents/index.js';
import { PLAN_DIGEST, agency, agentOf, bookOf, polygo, projectos, rawAgent } from './agents-support.js';

const refusalCodes = (result: ReturnType<typeof admitAgentRecord>): readonly string[] => (result.ok ? [] : result.refusals.map((r) => r.code));

describe('an agent record names a plan decision and carries no tenant of its own', () => {
  it('admits a complete record that names a plan review: the positive control', () => {
    const result = admitAgentRecord(rawAgent(), polygo());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record).toMatchObject({ agentId: 'worker', tenant: 'owner-personal', project: 'polygo', domain: 'develop' });
    }
  });

  it('takes the tenant, domain and project from the derived binding, not from the record', () => {
    for (const field of ['tenant', 'domain', 'project']) {
      const result = admitAgentRecord(rawAgent({ [field]: 'agency-business' }), polygo());
      expect(refusalCodes(result)).toEqual(['AGENT_SHAPE']);
    }
  });

  it('refuses a binding that resolveTenant did not produce, even a perfect copy', () => {
    const copy = { ...polygo() };
    expect(refusalCodes(admitAgentRecord(rawAgent(), copy))).toEqual(['AGENT_BINDING']);
  });

  it('refuses a record that says an agent decided', () => {
    const result = admitAgentRecord(rawAgent({ planReview: { decisionId: 'PLANDEC-0123456789abcdef', decidedBy: 'agent', planDigest: PLAN_DIGEST } }), polygo());
    expect(refusalCodes(result)).toEqual(['AGENT_NO_PLAN_DECISION']);
  });

  it('refuses a record with no plan decision, a malformed decision id or a digest that is not a digest', () => {
    expect(refusalCodes(admitAgentRecord(rawAgent({ planReview: undefined }), polygo()))).toEqual(['AGENT_NO_PLAN_DECISION']);
    expect(refusalCodes(admitAgentRecord(rawAgent({ planReview: { decisionId: 'DEC-1', decidedBy: 'owner', planDigest: PLAN_DIGEST } }), polygo()))).toEqual([
      'AGENT_NO_PLAN_DECISION',
    ]);
    expect(refusalCodes(admitAgentRecord(rawAgent({ planReview: { decisionId: 'PLANDEC-1', decidedBy: 'owner', planDigest: 'sha256:abc' } }), polygo()))).toEqual([
      'AGENT_NO_PLAN_DECISION',
    ]);
  });

  it('is not an admitted record when it was built by hand, even if every field is right', () => {
    const real = agentOf(polygo());
    expect(isAdmittedAgentRecord(real)).toBe(true);
    expect(isAdmittedAgentRecord({ ...real })).toBe(false);
  });

  it('refuses a field it does not know, so a record cannot carry a limit of its own', () => {
    expect(refusalCodes(admitAgentRecord(rawAgent({ maxDepth: 99 }), polygo()))).toEqual(['AGENT_SHAPE']);
  });

  it('refuses a field that is a getter, so a value cannot change between the check and the record', () => {
    const raw = rawAgent();
    Object.defineProperty(raw, 'grants', { enumerable: true, get: () => ['read-repository'] });
    expect(refusalCodes(admitAgentRecord(raw, polygo()))).toEqual(['AGENT_SHAPE']);
  });

  it('refuses a delegate flag that is not exactly true or false', () => {
    for (const bad of ['true', 1, null, undefined]) {
      expect(refusalCodes(admitAgentRecord(rawAgent({ mayDelegate: bad }), polygo()))).toEqual(['AGENT_SHAPE']);
    }
    expect(admitAgentRecord(rawAgent({ mayDelegate: true }), polygo()).ok).toBe(true);
  });

  it('refuses an agent id or record id that is not one plain word', () => {
    for (const bad of ['Worker', 'a:b', 'a b', '', 'x'.repeat(40), '1abc']) {
      expect(refusalCodes(admitAgentRecord(rawAgent({ agentId: bad }), polygo()))).toEqual(['AGENT_SHAPE']);
    }
    expect(refusalCodes(admitAgentRecord(rawAgent({ recordId: 'bad id' }), polygo()))).toEqual(['AGENT_SHAPE']);
  });

  it('refuses a grant that is a wildcard, a duplicate, not a word or past the cap', () => {
    for (const grants of [['*'], ['read-*'], ['a?'], ['read-repository', 'read-repository'], ['Read'], [''], ['x:y'], [1]]) {
      expect(refusalCodes(admitAgentRecord(rawAgent({ grants }), polygo()))).toEqual(['AGENT_GRANTS']);
    }
    const many = Array.from({ length: MAX_AGENT_GRANTS + 1 }, (_unused, index) => `tool-${index}`);
    expect(refusalCodes(admitAgentRecord(rawAgent({ grants: many }), polygo()))).toEqual(['AGENT_GRANTS']);
    expect(admitAgentRecord(rawAgent({ grants: many.slice(0, MAX_AGENT_GRANTS) }), polygo()).ok).toBe(true);
  });

  it('keeps no authority a caller can add later: grants and recipients are frozen copies', () => {
    const record = agentOf(polygo(), { messageAllow: ['lead'] });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.grants)).toBe(true);
    expect(Object.isFrozen(record.messageAllow)).toBe(true);
  });

  it('hashes the grants, so another grant list is another record', () => {
    const one = agentOf(polygo());
    const other = agentOf(polygo(), { grants: ['read-repository'] });
    expect(one.recordHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(other.recordHash).not.toBe(one.recordHash);
  });

  it('sorts grants, so the order of a list does not change the record', () => {
    expect(agentOf(polygo(), { grants: ['b-tool', 'a-tool'] }).grants).toEqual(['a-tool', 'b-tool']);
  });
});

describe('the agent book is keyed by tenant and project, and never evicts', () => {
  it('finds an agent in its own scope and in no other', () => {
    const book = bookOf(polygo(), [rawAgent()]);
    expect(findAgent(book, 'owner-personal', 'polygo', 'worker')?.agentId).toBe('worker');
    expect(findAgent(book, 'owner-personal', 'projectos', 'worker')).toBeNull();
    expect(findAgent(book, 'agency-business', 'seo-agency', 'worker')).toBeNull();
  });

  it('holds the same agent id in two tenants without one seeing the other', () => {
    const held = bookOf(agency(), [rawAgent({ grants: ['draft-proposal'] })], bookOf(polygo(), [rawAgent()]));
    expect(findAgent(held, 'owner-personal', 'polygo', 'worker')?.grants).toEqual(['read-repository', 'search-repository']);
    expect(findAgent(held, 'agency-business', 'seo-agency', 'worker')?.grants).toEqual(['draft-proposal']);
  });

  it('holds the same agent id in two projects of one tenant', () => {
    const held = bookOf(projectos(), [rawAgent()], bookOf(polygo(), [rawAgent()]));
    expect(findAgent(held, 'owner-personal', 'projectos', 'worker')).not.toBeNull();
    expect(findAgent(held, 'owner-personal', 'polygo', 'worker')).not.toBeNull();
  });

  it('refuses a second record for the same agent in the same scope: the first is not overwritten', () => {
    const first = bookOf(polygo(), [rawAgent()]);
    const again = addAgent(first, agentOf(polygo(), { recordId: 'AGT-worker-v2', grants: ['draft-proposal'] }));
    expect(again).toMatchObject({ ok: false, code: 'AGENT_DUPLICATE' });
    expect(findAgent(first, 'owner-personal', 'polygo', 'worker')?.grants).toEqual(['read-repository', 'search-repository']);
  });

  it('refuses a record that the reader did not admit', () => {
    const forged = { ...agentOf(polygo()) };
    expect(addAgent(emptyAgentBook(), forged)).toMatchObject({ ok: false, code: 'AGENT_NOT_ADMITTED' });
  });

  it('refuses the agent past the cap for a project, and keeps every earlier one', () => {
    let book = emptyAgentBook();
    for (let index = 0; index < MAX_AGENTS_PER_PROJECT; index += 1) {
      const added = addAgent(book, agentOf(polygo(), { recordId: `AGT-a${index}`, agentId: `agent-${index}` }));
      if (!added.ok) throw new Error('the control agent was refused');
      book = added.book;
    }
    expect(addAgent(book, agentOf(polygo(), { recordId: 'AGT-over', agentId: 'over' }))).toMatchObject({ ok: false, code: 'BOOK_FULL' });
    expect(findAgent(book, 'owner-personal', 'polygo', 'agent-0')).not.toBeNull();
    expect(addAgent(book, agentOf(agency(), { recordId: 'AGT-other', agentId: 'other' })).ok).toBe(true);
  });

  it('answers an agent id that is a prototype name with nothing', () => {
    const book = bookOf(polygo(), [rawAgent()]);
    expect(findAgent(book, 'owner-personal', 'polygo', 'constructor')).toBeNull();
    expect(findAgent(book, 'owner-personal', 'polygo', '__proto__')).toBeNull();
  });
});
