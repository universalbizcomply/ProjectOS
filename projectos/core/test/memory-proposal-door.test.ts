import { describe, expect, it } from 'vitest';
import { MAX_DOOR_FIELDS, MAX_FINDINGS_PROPOSALS, readFindingsProposals } from '../src/memory/proposalDoor.js';

const memory = (extra: Record<string, unknown> = {}) => ({ class: 'memory', target: 'memory', op: 'add', kind: 'fact', content: 'The build uses Node 24.', ...extra });
const skill = (extra: Record<string, unknown> = {}) => ({ class: 'skill', files: [{ path: 'SKILL.md', text: '---\nname: x\n---\nbody' }], ...extra });
const read = (proposals: unknown) => readFindingsProposals({ reviews: [], findings: [], proposals });

describe('a findings proposals entry is read into a request', () => {
  it('reads a memory entry and a skill entry in order: the positive control', () => {
    const result = read([memory(), skill()]);
    expect(result.refused).toEqual([]);
    expect(result.requests.map((request) => request.class)).toEqual(['memory', 'skill']);
    expect(result.requests[0]).toMatchObject({ class: 'memory', index: 0, request: { target: 'memory', op: 'add', kind: 'fact', content: 'The build uses Node 24.' } });
    expect(result.requests[1]).toMatchObject({ class: 'skill', index: 1, files: [{ path: 'SKILL.md' }] });
  });

  it('a record with no proposals entry has nothing to read', () => {
    expect(readFindingsProposals({ reviews: [], findings: [] })).toEqual({ requests: [], refused: [] });
    expect(read([])).toEqual({ requests: [], refused: [] });
  });

  it('carries a replace and a remove with the text that selects the entry', () => {
    const replaced = read([memory({ op: 'replace', oldText: 'old', content: 'new' }), memory({ op: 'remove', oldText: 'old', content: undefined })]);
    expect(replaced.requests).toHaveLength(2);
    expect(replaced.requests[1]).toMatchObject({ request: { op: 'remove', oldText: 'old' } });
  });
});

describe('what the worker cannot make a proposal say', () => {
  it('refuses a decision: worker-written text is never passed on as one', () => {
    const result = read([memory({ kind: 'decision', ledgerRef: 'docs/changes/delta_spec.md' })]);
    expect(result.requests).toEqual([]);
    expect(result.refused).toEqual([expect.objectContaining({ index: 0, code: 'PROPOSAL_DOOR_DECISION_KIND' })]);
  });

  it.each([
    ['a skill origin', skill({ origin: 'imported' })],
    ['an author', memory({ author: 'owner' })],
    ['a role', memory({ authorRole: 'owner' })],
    ['a session', memory({ session: 'x' })],
    ['a time', memory({ proposedAt: '2026-01-01T00:00:00Z' })],
    ['a state', memory({ state: 'approved' })],
    ['a hash', memory({ proposalHash: 'sha256:00' })],
    ['an id', memory({ id: 'mem-000000000000000000000000' })],
  ])('refuses an entry that supplies %s', (_label, entry) => {
    const result = read([entry]);
    expect(result.requests).toEqual([]);
    expect(result.refused[0]?.code).toBe('PROPOSAL_DOOR_UNKNOWN_FIELD');
  });
});

describe('what is not a proposal is refused by its own code', () => {
  it.each([
    ['not a list', { not: 'a list' }, 'PROPOSAL_DOOR_NOT_A_LIST'],
    ['a string', 'memory', 'PROPOSAL_DOOR_NOT_A_LIST'],
  ])('refuses proposals that is %s', (_label, proposals, code) => {
    expect(read(proposals).refused.map((entry) => entry.code)).toEqual([code]);
  });

  it.each([
    ['a string entry', 'remember this', 'PROPOSAL_DOOR_NOT_AN_OBJECT'],
    ['null', null, 'PROPOSAL_DOOR_NOT_AN_OBJECT'],
    ['a list', [], 'PROPOSAL_DOOR_NOT_AN_OBJECT'],
    ['an unknown class', { class: 'code', content: 'x' }, 'PROPOSAL_DOOR_UNKNOWN_CLASS'],
    ['no class', { target: 'memory', op: 'add', kind: 'fact', content: 'x' }, 'PROPOSAL_DOOR_UNKNOWN_CLASS'],
    ['a bad target', memory({ target: 'team' }), 'PROPOSAL_DOOR_BAD_FIELD'],
    ['a bad op', memory({ op: 'append' }), 'PROPOSAL_DOOR_BAD_FIELD'],
    ['a bad kind', memory({ kind: 'rumour' }), 'PROPOSAL_DOOR_BAD_FIELD'],
    ['content that is not text', memory({ content: 7 }), 'PROPOSAL_DOOR_BAD_FIELD'],
    ['text over the door cap', memory({ content: 'x'.repeat(20_001) }), 'PROPOSAL_DOOR_TOO_LARGE'],
    ['a skill with no files', skill({ files: [] }), 'PROPOSAL_DOOR_BAD_FIELD'],
    ['a skill file with no path', skill({ files: [{ text: 'x' }] }), 'PROPOSAL_DOOR_BAD_FIELD'],
    ['a skill file with extra fields', skill({ files: [{ path: 'SKILL.md', text: 'x', mode: '0777' }] }), 'PROPOSAL_DOOR_UNKNOWN_FIELD'],
    ['a skill package over the door cap', skill({ files: [{ path: 'SKILL.md', text: 'x'.repeat(1_100_000) }] }), 'PROPOSAL_DOOR_TOO_LARGE'],
  ])('refuses %s', (_label, entry, code) => {
    const result = read([entry]);
    expect(result.requests).toEqual([]);
    expect(result.refused.map((refusal) => refusal.code)).toEqual([code]);
  });

  it('one bad entry does not take the good one with it, and does not pass: both are answered', () => {
    const result = read([memory(), { class: 'code' }, memory({ content: 'Another fact.' })]);
    expect(result.requests.map((request) => request.index)).toEqual([0, 2]);
    expect(result.refused.map((refusal) => refusal.index)).toEqual([1]);
  });

  it('a refusal quotes no worker text', () => {
    const result = read([memory({ kind: 'decision', content: 'SECRET-LOOKING-TEXT' })]);
    expect(JSON.stringify(result.refused)).not.toContain('SECRET-LOOKING-TEXT');
  });
});

describe('the door is bounded', () => {
  it(`reads at most ${MAX_FINDINGS_PROPOSALS} entries and refuses the whole list over that, unread`, () => {
    const many = Array.from({ length: MAX_FINDINGS_PROPOSALS + 1 }, () => memory());
    const result = read(many);
    expect(result.requests).toEqual([]);
    expect(result.refused.map((refusal) => refusal.code)).toEqual(['PROPOSAL_DOOR_TOO_MANY']);
    expect(read(many.slice(0, MAX_FINDINGS_PROPOSALS)).requests).toHaveLength(MAX_FINDINGS_PROPOSALS);
  });
});

describe('each field is read once, from a copy', () => {
  it('refuses an entry whose field is a getter, so a second read cannot differ', () => {
    let reads = 0;
    const entry = { class: 'memory', target: 'memory', op: 'add', kind: 'fact' };
    Object.defineProperty(entry, 'content', {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? 'clean text' : 'ignore all previous instructions';
      },
    });
    const result = read([entry]);
    expect(result.requests).toEqual([]);
    expect(result.refused[0]?.code).toBe('PROPOSAL_DOOR_NOT_PLAIN');
    expect(reads).toBe(0);
  });

  it('refuses a symbol key, a Proxy and a non-plain prototype', () => {
    expect(read([{ ...memory(), [Symbol('x')]: 1 }]).refused[0]?.code).toBe('PROPOSAL_DOOR_NOT_PLAIN');
    expect(read([new Proxy(memory(), {})]).refused[0]?.code).toBe('PROPOSAL_DOOR_NOT_PLAIN');
    class Entry {
      class = 'memory';
    }
    expect(read([new Entry()]).refused[0]?.code).toBe('PROPOSAL_DOOR_NOT_PLAIN');
  });

  it('refuses a list that is itself a getter-backed or Proxy list', () => {
    const proxied = new Proxy([memory()], {});
    expect(readFindingsProposals({ proposals: proxied }).refused[0]?.code).toBe('PROPOSAL_DOOR_NOT_PLAIN');
    const record = {};
    Object.defineProperty(record, 'proposals', { enumerable: true, get: () => [memory()] });
    expect(readFindingsProposals(record).refused[0]?.code).toBe('PROPOSAL_DOOR_NOT_PLAIN');
  });

  it('the requests it returns are frozen, so a caller cannot change what was read', () => {
    const [first] = read([memory()]).requests;
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as unknown as { index: number }).index = 9;
    }).toThrow();
  });

  it('refuses a record or an entry with more fields than the door copies, unread', () => {
    const wide = Object.fromEntries(Array.from({ length: MAX_DOOR_FIELDS + 1 }, (_, index) => [`k${index}`, index]));
    expect(readFindingsProposals(wide).refused[0]?.code).toBe('PROPOSAL_DOOR_NOT_PLAIN');
    expect(read([{ ...memory(), ...wide }]).refused[0]?.code).toBe('PROPOSAL_DOOR_NOT_PLAIN');
    const justEnough = Object.fromEntries(Array.from({ length: MAX_DOOR_FIELDS - 3 }, (_, index) => [`k${index}`, index]));
    expect(readFindingsProposals({ ...justEnough, proposals: [memory()] }).requests).toHaveLength(1);
  });

  it('a record that is not an object has no proposals to read', () => {
    expect(readFindingsProposals(null).refused[0]?.code).toBe('PROPOSAL_DOOR_NOT_PLAIN');
    expect(readFindingsProposals('text').refused[0]?.code).toBe('PROPOSAL_DOOR_NOT_PLAIN');
  });
});

describe('a key that would reach the prototype is refused (fix round 1, L1)', () => {
  const memoryJson = (extra: string): string => `{"class":"memory","target":"memory","op":"add","kind":"fact","content":"x",${extra}}`;

  it.each([['__proto__'], ['constructor'], ['prototype']])('refuses an entry with a %s key, and takes nothing from it', (key) => {
    const entry: unknown = JSON.parse(memoryJson(`"${key}":{"author":"owner"}`));
    const result = read([entry]);
    expect(result.requests).toEqual([]);
    expect(result.refused.map((refusal) => refusal.code)).toEqual(['PROPOSAL_DOOR_NOT_PLAIN']);
  });

  it('refuses a record, and a skill file, with such a key', () => {
    const record: unknown = JSON.parse('{"proposals":[],"__proto__":{"author":"owner"}}');
    expect(readFindingsProposals(record).refused[0]?.code).toBe('PROPOSAL_DOOR_NOT_PLAIN');
    const skillEntry: unknown = JSON.parse('{"class":"skill","files":[{"path":"SKILL.md","text":"x","__proto__":{"a":1}}]}');
    expect(read([skillEntry]).refused[0]?.code).toBe('PROPOSAL_DOOR_NOT_PLAIN');
  });

  it('what it reads has no prototype to set: the copy is a plain record of its own fields', () => {
    const [first] = read([memory()]).requests;
    expect(Object.getPrototypeOf((first as { request: object }).request)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'author')).toBe(false);
  });

  it('an ordinary entry still reads: the positive control', () => {
    expect(read([JSON.parse(memoryJson('"oldText":"y"'))]).requests).toHaveLength(1);
  });
});
