/**
 * One conversation per project, identified by something a person cannot rename.
 *
 * The set-level tests at the bottom are the ones that matter for isolation: every binding can be
 * individually valid while two of them point at the same conversation, and that is precisely how one
 * project's evidence would reach another project's review.
 */
import { describe, it, expect } from 'vitest';
import {
  checkThreadBinding,
  isolationProblems,
  THREAD_BINDING_SCHEMA_VERSION,
  type GovernanceThreadBinding,
  type ThreadExpectations,
  type IsolationBinding,
} from '../src/gatekeeperThread.js';

const THREAD = 'resp_7f3a9c2e5b81d40a';
const ROOT = 'C:/dev/ProjectOS';

function expectations(over: Partial<ThreadExpectations> = {}): ThreadExpectations {
  return { projectId: 'projectos', repositoryRoot: ROOT, transportId: 'openai-primary', ...over };
}

function binding(over: Partial<GovernanceThreadBinding> = {}): GovernanceThreadBinding {
  return {
    schemaVersion: THREAD_BINDING_SCHEMA_VERSION,
    projectId: 'projectos',
    repositoryRoot: ROOT,
    providerThreadId: THREAD,
    transportId: 'openai-primary',
    createdAt: '2026-08-17T16:00:00+01:00',
    ...over,
  };
}

describe('a valid thread binding', () => {
  it('is accepted', () => {
    expect(checkThreadBinding(binding(), expectations())).toEqual([]);
  });

  it('tolerates a trailing separator and letter case in the root', () => {
    expect(checkThreadBinding(binding({ repositoryRoot: 'c:\\dev\\ProjectOS\\' }), expectations())).toEqual([]);
  });
});

describe('an absent binding', () => {
  it('is refused rather than improvised', () => {
    const errors = checkThreadBinding(null, expectations());
    expect(errors[0]).toContain('no conversation is its own');
  });
});

describe('the identifier must be opaque', () => {
  it('refuses a conversation title', () => {
    const errors = checkThreadBinding(binding({ providerThreadId: 'ProjectOS governance' }), expectations());
    expect(errors.some((e) => e.includes('looks like a conversation title'))).toBe(true);
  });

  it('refuses punctuation-bearing display names', () => {
    for (const name of ['ProjectOS (main)', "Murad's thread", 'phase-6: review']) {
      const errors = checkThreadBinding(binding({ providerThreadId: name }), expectations());
      expect(errors.some((e) => e.includes('title') || e.includes('opaque'))).toBe(true);
    }
  });

  // A DIGIT IS WHAT SEPARATES A GENERATED ID FROM A NAME SOMEONE TYPED. Length alone accepted
  // kebab-case and snake_case titles, which are exactly how a person names a conversation.
  it.each(['projectos-governance', 'owner_main_thread', 'the-real-one-here'])(
    'refuses %s, which is a human name made only of identifier characters',
    (name) => {
      const errors = checkThreadBinding(binding({ providerThreadId: name }), expectations());
      expect(errors.some((e) => e.includes('not an opaque provider identifier'))).toBe(true);
    },
  );

  it.each(['resp_7f3a9c2e5b81d40a', 'thread_abc123def456', 'msg-0000000000001'])(
    'accepts %s, which a provider generated',
    (id) => {
      expect(checkThreadBinding(binding({ providerThreadId: id }), expectations())).toEqual([]);
    },
  );

  it('refuses something too short to be a provider id', () => {
    const errors = checkThreadBinding(binding({ providerThreadId: 'thread1' }), expectations());
    expect(errors.some((e) => e.includes('not an opaque provider identifier'))).toBe(true);
  });

  it('refuses a missing identifier', () => {
    expect(checkThreadBinding(binding({ providerThreadId: '' }), expectations())).toContain(
      'thread binding names no provider thread id',
    );
  });
});

describe('deliberately mismatched bindings', () => {
  it('refuses a binding belonging to another project', () => {
    const errors = checkThreadBinding(binding({ projectId: 'polygo' }), expectations());
    expect(errors.some((e) => e.includes('is for project'))).toBe(true);
  });

  it('refuses the same project id in a different checkout', () => {
    const errors = checkThreadBinding(binding({ repositoryRoot: 'C:/dev/ProjectOS-copy' }), expectations());
    expect(errors.some((e) => e.includes('a different world'))).toBe(true);
  });

  it('refuses a thread moved to another transport', () => {
    const errors = checkThreadBinding(binding({ transportId: 'codex-secondary' }), expectations());
    expect(errors.some((e) => e.includes('does not survive being moved'))).toBe(true);
  });

  it('refuses a wrong schema version', () => {
    expect(
      checkThreadBinding(binding({ schemaVersion: '0.1.0' }), expectations()).some((e) => e.includes('schemaVersion')),
    ).toBe(true);
  });

  it('refuses a binding with no creation time', () => {
    expect(checkThreadBinding(binding({ createdAt: undefined }), expectations())).toContain(
      'thread binding records no createdAt',
    );
  });
});

describe('isolation across projects', () => {
  const isolated: IsolationBinding[] = [
    { projectId: 'projectos', repositoryRoot: 'C:/dev/ProjectOS', providerThreadId: 'resp_aaaaaaaaaaaa' },
    { projectId: 'polygo', repositoryRoot: 'C:/dev/Polygo', providerThreadId: 'resp_bbbbbbbbbbbb' },
    { projectId: 'dead-aisle', repositoryRoot: 'C:/dev/DeadAisle', providerThreadId: 'resp_cccccccccccc' },
  ];

  it('accepts distinct projects, roots and threads', () => {
    expect(isolationProblems(isolated)).toEqual([]);
  });

  it('accepts an empty set', () => {
    expect(isolationProblems([])).toEqual([]);
  });

  // EACH OF THESE BINDINGS IS INDIVIDUALLY VALID. The breach only exists across the set.
  it('detects two projects sharing one conversation', () => {
    const shared = [isolated[0]!, { ...isolated[1]!, providerThreadId: isolated[0]!.providerThreadId }];
    const problems = isolationProblems(shared);
    expect(problems.some((p) => p.includes('shared by projectos, polygo'))).toBe(true);
    expect(problems.some((p) => p.includes('would reach another project'))).toBe(true);
  });

  it('detects two projects claiming one checkout', () => {
    const shared = [isolated[0]!, { ...isolated[1]!, repositoryRoot: 'C:\\dev\\ProjectOS' }];
    expect(isolationProblems(shared).some((p) => p.includes('cannot govern one checkout'))).toBe(true);
  });

  it('detects one project with two bindings, where authority would be undefined', () => {
    const doubled = [isolated[0]!, { ...isolated[0]!, providerThreadId: 'resp_dddddddddddd', repositoryRoot: 'C:/dev/Other' }];
    expect(isolationProblems(doubled).some((p) => p.includes('more than one governance thread binding'))).toBe(true);
  });

  // THE TWO CHECKS MUST NORMALISE IDENTICALLY. checkThreadBinding compares through a trim; the
  // set-level check used to key its map on the raw value, so ids differing only by surrounding
  // whitespace were the SAME thread to one check and two DIFFERENT threads to the other — and two
  // projects could share one conversation with everything green.
  it('detects a shared conversation even when the ids differ only by whitespace', () => {
    const shared = [
      isolated[0]!,
      { ...isolated[1]!, providerThreadId: `  ${isolated[0]!.providerThreadId}  ` },
    ];
    expect(isolationProblems(shared).some((p) => p.includes('shared by'))).toBe(true);
  });

  it('detects a shared checkout even when the roots differ only by whitespace', () => {
    const shared = [isolated[0]!, { ...isolated[1]!, repositoryRoot: `  ${isolated[0]!.repositoryRoot} ` }];
    expect(isolationProblems(shared).some((p) => p.includes('cannot govern one checkout'))).toBe(true);
  });

  it('detects one project appearing twice even when its id differs only by whitespace', () => {
    const doubled = [
      isolated[0]!,
      { ...isolated[1]!, projectId: `${isolated[0]!.projectId} ` },
    ];
    expect(isolationProblems(doubled).some((p) => p.includes('more than one governance thread binding'))).toBe(true);
  });

  it('reports every leak rather than the first', () => {
    const bad = [
      isolated[0]!,
      { projectId: 'polygo', repositoryRoot: 'C:/dev/ProjectOS', providerThreadId: isolated[0]!.providerThreadId },
    ];
    expect(isolationProblems(bad).length).toBeGreaterThanOrEqual(2);
  });
});
