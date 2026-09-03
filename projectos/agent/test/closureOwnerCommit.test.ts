/**
 * THE OWNER'S COMMIT IS THE AUTHENTICITY ANCHOR, and this file is where that is held to.
 *
 * The property under test is narrow and load-bearing: ProjectOS writes the closure decision, so
 * ProjectOS writing it proves nothing. What makes it authentic is that MURAD committed it — and, in
 * addition, that the bytes he committed are the bytes he was shown. Nothing before this phase could
 * answer the second half: the decision could be written, presented, edited, and then committed, and
 * every existing check would have passed on content the owner never read.
 *
 * Every negative here is one way that could go wrong. No git repository is used: the `System` is a
 * fake whose `git show` returns exactly what the test wants, which is how the "committed bytes differ
 * by one character" case is made exact rather than approximate. The real-git form of the same
 * property is proven in `closureEndToEnd.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  CLOSURE_WAIT_SCHEMA_VERSION,
  closureDecisionBytes,
  closureDecisionSha256,
  closureWaitProblems,
  closureWaitRelPath,
  observeOwnerCommit,
  ownerCommitIdentityProblems,
  readClosureWait,
  resolveClosureWait,
  writeClosureDecisionForOwner,
  writeClosureWait,
  type ClosureWaitRecord,
} from '../src/closureWait.js';
import { closureDecisionRelPath } from '../src/closureGate.js';
import { buildClosureBundle } from '../src/commands/closure.js';
import type { System } from '../src/system.js';
import type { ClosureDecisionRecord } from '@projectos/core';

const ROOT = '/proj';
const PROJECT = 'projectos';
const PHASE = 'PROJECTOS-AUTONOMOUS-CLOSURE-TRANSPORT1A';
const SUBJECT = 'c'.repeat(40);

const DECISION: ClosureDecisionRecord = {
  schemaVersion: '1.0.0',
  decisionId: 'CLOSURE-TRANSPORT1A-DECISION1A',
  phaseId: PHASE,
  projectId: PROJECT,
  scope: 'phase-closure',
  decidedBy: 'ChatGPT',
  decidedAt: '2026-09-02T21:31:00+01:00',
  evidenceSubjectHead: SUBJECT,
  decision: 'close',
  note: 'accepted for closure',
  ownerAcceptedFindings: [],
};

/** A `System` backed by a plain map, whose `git show` returns whatever the test committed. */
const OWNER = 'Murad';
const NUL = String.fromCharCode(0);
/** The second half of the closure bundle: the entry the paid call wrote. */
const LEDGER = '.projectops/gatekeeper-ledger.json';
/** The head the ask was made against. `observeOwnerCommit` bounds the commit to the bundle from here. */
const HEAD_AT_REQUEST = 'b'.repeat(40);
const LEDGER_BYTES = JSON.stringify({ entries: [{ requestId: 'CLREQ-1', costMicroUsd: 41 }] }, null, 2) + '\n';

/**
 * `committed` maps a repo-relative path to the bytes git holds for it. A path absent from the map is
 * absent from HEAD — which is how "the ledger was never committed" is expressed.
 */
function sys(
  files: Record<string, string> = {},
  committed: string | Record<string, string> | null = null,
  committer: readonly [string, string] = [OWNER, 'murad@example.invalid'],
): System & { files: Record<string, string> } {
  const blobs: Record<string, string> =
    committed === null
      ? {}
      : typeof committed === 'string'
        ? { [closureDecisionRelPath(PHASE)]: committed, [LEDGER]: LEDGER_BYTES }
        : committed;
  const store = { ...files };
  return {
    files: store,
    cwd: () => ROOT,
    now: () => '2026-09-02T22:00:00Z',
    readText: (p: string) => store[p.replace(/\\/g, '/')] ?? null,
    writeText: (p: string, c: string) => {
      store[p.replace(/\\/g, '/')] = c;
    },
    exists: (p: string) => p.replace(/\\/g, '/') in store,
    listDir: () => [],
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: (_cmd: string, args: readonly string[]) => {
      if (args.includes('show')) {
        const spec = args[args.length - 1] ?? '';
        const rel = spec.startsWith('HEAD:./') ? spec.slice('HEAD:./'.length) : '';
        const bytes = blobs[rel];
        return bytes === undefined
          ? { code: 128, stdout: '', stderr: 'not in HEAD' }
          : { code: 0, stdout: bytes, stderr: '' };
      }
      // Everything the owner's commit introduced. By default: exactly the bundle, so the bounding
      // check passes and the test under way is the one that decides the outcome.
      if (args.includes('merge-base')) return { code: 0, stdout: '', stderr: '' };
      if (args.includes('diff')) {
        return { code: 0, stdout: [closureDecisionRelPath(PHASE), LEDGER].join(String.fromCharCode(10)), stderr: '' };
      }
      if (args.includes('log')) {
        const [name, email] = committer;
        return { code: 0, stdout: [name, email, name, email].join(NUL), stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };
}

function wait(over: Partial<ClosureWaitRecord> = {}): ClosureWaitRecord {
  return {
    schemaVersion: CLOSURE_WAIT_SCHEMA_VERSION,
    projectId: PROJECT,
    phaseId: PHASE,
    decisionPath: closureDecisionRelPath(PHASE),
    decisionSha256: closureDecisionSha256(closureDecisionBytes(DECISION)),
    bundle: [
      { path: closureDecisionRelPath(PHASE), sha256: closureDecisionSha256(closureDecisionBytes(DECISION)) },
      { path: LEDGER, sha256: closureDecisionSha256(LEDGER_BYTES) },
    ],
    decisionId: String(DECISION.decisionId),
    decidedBy: String(DECISION.decidedBy),
    decision: 'close',
    headAtRequest: HEAD_AT_REQUEST,
    evidenceSubjectHead: SUBJECT,
    requestId: 'CLREQ-000000000000000000000000',
    requestDigest: `sha256:${'0'.repeat(64)}`,
    requestedAt: '2026-09-02T21:31:05+01:00',
    state: 'WAITING_OWNER',
    ...over,
  };
}

describe('writing the decision the owner will be asked to commit', () => {
  it('writes it once and reports the exact digest of what it wrote', () => {
    const s = sys();
    const written = writeClosureDecisionForOwner(s, ROOT, PHASE, DECISION);
    expect(written.kind).toBe('written');
    if (written.kind === 'conflict') throw new Error('unreachable');
    expect(written.sha256).toBe(closureDecisionSha256(closureDecisionBytes(DECISION)));
    expect(s.files[`${ROOT}/.projectops/closure/decisions/${PHASE}.json`]).toBe(closureDecisionBytes(DECISION));
  });

  it('is idempotent for identical bytes, so re-asking is not a second decision', () => {
    const s = sys();
    writeClosureDecisionForOwner(s, ROOT, PHASE, DECISION);
    expect(writeClosureDecisionForOwner(s, ROOT, PHASE, DECISION).kind).toBe('already-written');
  });

  it('refuses to overwrite a DIFFERENT decision rather than destroying the first answer', () => {
    const s = sys();
    writeClosureDecisionForOwner(s, ROOT, PHASE, DECISION);
    const other = writeClosureDecisionForOwner(s, ROOT, PHASE, { ...DECISION, note: 'a different answer' });
    expect(other.kind).toBe('conflict');
  });
});

describe('the wait record', () => {
  it('round-trips, and a malformed one is refused rather than read as absent', () => {
    const s = sys();
    expect(writeClosureWait(s, ROOT, wait())).toBe(true);
    const read = readClosureWait(s, ROOT, PHASE);
    expect(read.ok && read.value?.decisionSha256).toBe(wait().decisionSha256);

    s.files[`${ROOT}/.projectops/closure/waits/${PHASE}.json`] = '{ not json';
    const bad = readClosureWait(s, ROOT, PHASE);
    expect(bad.ok).toBe(false);
  });

  it('refuses a wait from a schema this runtime does not write', () => {
    const s = sys();
    writeClosureWait(s, ROOT, wait());
    s.files[`${ROOT}/.projectops/closure/waits/${PHASE}.json`] = JSON.stringify({ ...wait(), schemaVersion: '9.9.9' });
    expect(readClosureWait(s, ROOT, PHASE).ok).toBe(false);
  });

  it('refuses a phase id that could not safely become a filename', () => {
    expect(closureWaitRelPath('../../etc/passwd')).toBeNull();
    expect(writeClosureWait(sys(), ROOT, wait({ phaseId: '../../etc/passwd' }))).toBe(false);
  });

  it('refuses another project\'s wait, another phase\'s wait, and an already-resolved one', () => {
    expect(closureWaitProblems(wait({ projectId: 'polygo' }), { projectId: PROJECT, phaseId: PHASE }).join(' ')).toContain(
      'belongs to project',
    );
    expect(closureWaitProblems(wait({ phaseId: 'OTHER1A' }), { projectId: PROJECT, phaseId: PHASE }).join(' ')).toContain(
      'is for phase',
    );
    expect(
      closureWaitProblems(wait({ state: 'CLOSED', resolvedAt: 'then' }), { projectId: PROJECT, phaseId: PHASE }).join(' '),
    ).toContain('already resolved');
  });

  it('refuses an absent wait, so a decision this run never presented cannot be resumed', () => {
    expect(closureWaitProblems(null, { projectId: PROJECT, phaseId: PHASE }).join(' ')).toContain(
      'has nothing to compare a commit against',
    );
  });

  it('refuses a wait that points anywhere but the canonical decision path', () => {
    expect(
      closureWaitProblems(wait({ decisionPath: '.projectops/closure/decisions/ELSEWHERE.json' }), {
        projectId: PROJECT,
        phaseId: PHASE,
      }).join(' '),
    ).toContain('not the canonical');
  });
});

describe('observing the owner\'s commit', () => {
  it('reports NOT COMMITTED when the decision is not in a commit', () => {
    const observed = observeOwnerCommit(sys({}, null), ROOT, wait(), OWNER);
    expect(observed.committed).toBe(false);
    expect(observed.matchesPresented).toBe(false);
    expect(observed.problems.join(' ')).toContain('has not passed the owner commit gate');
  });

  it('accepts the exact presented bytes', () => {
    const observed = observeOwnerCommit(sys({}, closureDecisionBytes(DECISION)), ROOT, wait(), OWNER);
    expect(observed.committed).toBe(true);
    expect(observed.matchesPresented).toBe(true);
    expect(observed.problems).toEqual([]);
  });

  it('DETECTS A ONE-BYTE CHANGE made between presentation and commitment', () => {
    const presented = closureDecisionBytes(DECISION);
    // One character, inside the note the authority wrote.
    const tampered = presented.replace('accepted for closure', 'accepted for closurE');
    expect(tampered).not.toBe(presented);
    expect(tampered.length).toBe(presented.length);

    const observed = observeOwnerCommit(sys({}, tampered), ROOT, wait(), OWNER);
    expect(observed.committed).toBe(true);
    expect(observed.matchesPresented).toBe(false);
    expect(observed.problems.join(' ')).toContain('NOT the file that was presented');
  });

  it('detects a decision for another phase committed at this path', () => {
    const other = closureDecisionBytes({ ...DECISION, phaseId: 'SOME-OTHER-PHASE1A' });
    expect(observeOwnerCommit(sys({}, other), ROOT, wait(), OWNER).matchesPresented).toBe(false);
  });

  it('reads the committed OBJECT, never the working tree', () => {
    // The working tree holds the presented bytes; git holds something else. The working-tree copy
    // must not be able to launder the committed one.
    const s = sys({ [`${ROOT}/.projectops/closure/decisions/${PHASE}.json`]: closureDecisionBytes(DECISION) }, 'totally different');
    expect(observeOwnerCommit(s, ROOT, wait(), OWNER).matchesPresented).toBe(false);
  });

  it('treats a git failure as not committed — an unverifiable commit is not a commit', () => {
    const broken: System = { ...sys(), exec: () => ({ code: 1, stdout: '', stderr: 'git exploded' }) };
    expect(observeOwnerCommit(broken, ROOT, wait(), OWNER).committed).toBe(false);
  });

  it('ignores carriage returns, which are a platform artefact and not a change to the decision', () => {
    const crlf = closureDecisionBytes(DECISION).split('\n').join('\r\n');
    expect(observeOwnerCommit(sys({}, crlf), ROOT, wait(), OWNER).matchesPresented).toBe(true);
  });
});

describe('resolving a wait', () => {
  it('marks it CLOSED so a satisfied wait can never describe an outstanding one', () => {
    const s = sys();
    writeClosureWait(s, ROOT, wait());
    resolveClosureWait(s, ROOT, wait(), '2026-09-02T22:05:00Z');
    const read = readClosureWait(s, ROOT, PHASE);
    expect(read.ok && read.value?.state).toBe('CLOSED');
    expect(closureWaitProblems(read.ok ? read.value : null, { projectId: PROJECT, phaseId: PHASE }).length).toBeGreaterThan(0);
  });
});

describe('whose commit it was', () => {
  const bytes = closureDecisionBytes(DECISION);
  /** The committed blob for whichever bundle path `git show` was asked for. */
  const blob = (args: readonly string[]): string =>
    (args[args.length - 1] ?? '').endsWith(LEDGER) ? LEDGER_BYTES : bytes;

  it('accepts the identity the approved plan records as owner', () => {
    const observed = observeOwnerCommit(sys({}, bytes, [OWNER, 'murad@example.invalid']), ROOT, wait(), OWNER);
    expect(observed.matchesPresented).toBe(true);
    expect(observed.committedBy).toBe('Murad <murad@example.invalid>');
  });

  it('REFUSES a commit made by the implementer, by any name it goes by', () => {
    for (const name of ['Claude', 'claude-code', 'Anthropic Assistant', 'bot']) {
      const observed = observeOwnerCommit(sys({}, bytes, [name, 'agent@example.invalid']), ROOT, wait(), OWNER);
      expect(observed.committed).toBe(true);
      expect(observed.matchesPresented).toBe(false);
      expect(observed.problems.join(' ')).toContain('the implementer can never satisfy the owner');
    }
  });

  it('refuses an identity the plan does not record as owner, and names both', () => {
    const observed = observeOwnerCommit(sys({}, bytes, ['Somebody Else', 'x@y.invalid']), ROOT, wait(), OWNER);
    expect(observed.matchesPresented).toBe(false);
    expect(observed.problems.join(' ')).toContain('Somebody Else');
    expect(observed.problems.join(' ')).toContain("'Murad'");
  });

  it('refuses when the plan records no owner, rather than matching an empty name', () => {
    const observed = observeOwnerCommit(sys({}, bytes, ['', '']), ROOT, wait(), '');
    expect(observed.matchesPresented).toBe(false);
  });

  it('refuses when git will not say who committed', () => {
    const base = sys({}, bytes);
    const blind: System = {
      ...base,
      exec: (cmd: string, args: readonly string[]) =>
        args.includes('show')
          ? { code: 0, stdout: blob(args), stderr: '' }
          : args.includes('merge-base') || args.includes('diff')
            ? base.exec(cmd, args)
            : { code: 1, stdout: '', stderr: 'no log' },
    };
    const observed = observeOwnerCommit(blind, ROOT, wait(), OWNER);
    expect(observed.matchesPresented).toBe(false);
    expect(observed.problems.join(' ')).toContain('unattributable');
  });

  it('judges the COMMITTER when author and committer disagree', () => {
    // `git commit --author "Murad"` run by the implementer must not pass as the owner's commit.
    const base = sys({}, bytes);
    const split: System = {
      ...base,
      exec: (cmd: string, args: readonly string[]) =>
        args.includes('show')
          ? { code: 0, stdout: blob(args), stderr: '' }
          : args.includes('merge-base') || args.includes('diff')
            ? base.exec(cmd, args)
            : { code: 0, stdout: [OWNER, 'murad@x', 'Claude', 'claude@x'].join(NUL), stderr: '' },
    };
    const observed = observeOwnerCommit(split, ROOT, wait(), OWNER);
    expect(observed.matchesPresented).toBe(false);
    expect(observed.problems.join(' ')).toContain('implementer');
  });

  it('agrees with the decision contract about what an implementer name is', () => {
    // Two copies of one rule; this is where the drift would be caught.
    for (const name of ['Claude', 'claude', 'AI', 'llm', 'Copilot', 'implementer']) {
      expect(ownerCommitIdentityProblems({ name, email: 'x@y' }, OWNER).join(' ')).toContain('implementer');
    }
    for (const name of ['Murad', 'Alice Smith']) {
      expect(ownerCommitIdentityProblems({ name, email: 'x@y' }, name)).toEqual([]);
    }
  });
});

describe('the whole bundle is byte-bound, not just the decision', () => {
  const decisionBytes = closureDecisionBytes(DECISION);

  it('accepts a commit whose decision AND ledger are both the presented bytes', () => {
    const observed = observeOwnerCommit(sys({}, decisionBytes), ROOT, wait(), OWNER);
    expect(observed.matchesPresented).toBe(true);
    expect(observed.bundle).toHaveLength(2);
    expect(observed.bundle.every((b) => b.matches)).toBe(true);
  });

  it('REFUSES a one-byte LEDGER mutation made before the commit', () => {
    const tampered = LEDGER_BYTES.replace('41', '42');
    expect(tampered).not.toBe(LEDGER_BYTES);
    const observed = observeOwnerCommit(
      sys({}, { [closureDecisionRelPath(PHASE)]: decisionBytes, [LEDGER]: tampered }),
      ROOT,
      wait(),
      OWNER,
    );
    expect(observed.matchesPresented).toBe(false);
    expect(observed.problems.join(' ')).toContain(LEDGER);
    expect(observed.problems.join(' ')).toContain('NOT the file that was presented');
  });

  it('refuses an EXTRA ledger entry added after WAITING_OWNER', () => {
    const grown =
      JSON.stringify({ entries: [{ requestId: 'CLREQ-1', costMicroUsd: 41 }, { requestId: 'CLREQ-2', costMicroUsd: 9 }] }, null, 2) +
      String.fromCharCode(10);
    const observed = observeOwnerCommit(
      sys({}, { [closureDecisionRelPath(PHASE)]: decisionBytes, [LEDGER]: grown }),
      ROOT,
      wait(),
      OWNER,
    );
    expect(observed.matchesPresented).toBe(false);
  });

  it('refuses OLDER ledger bytes than the ones presented', () => {
    const older = JSON.stringify({ entries: [] }, null, 2) + String.fromCharCode(10);
    const observed = observeOwnerCommit(
      sys({}, { [closureDecisionRelPath(PHASE)]: decisionBytes, [LEDGER]: older }),
      ROOT,
      wait(),
      OWNER,
    );
    expect(observed.matchesPresented).toBe(false);
  });

  it('refuses a correct decision with the ledger left out of the commit entirely', () => {
    const observed = observeOwnerCommit(
      sys({}, { [closureDecisionRelPath(PHASE)]: decisionBytes }),
      ROOT,
      wait(),
      OWNER,
    );
    expect(observed.committed).toBe(true);
    expect(observed.matchesPresented).toBe(false);
    expect(observed.problems.join(' ')).toContain('is not in a commit');
  });

  it('refuses a correct ledger with a wrong decision', () => {
    const observed = observeOwnerCommit(
      sys({}, {
        [closureDecisionRelPath(PHASE)]: closureDecisionBytes({ ...DECISION, note: 'a different answer' }),
        [LEDGER]: LEDGER_BYTES,
      }),
      ROOT,
      wait(),
      OWNER,
    );
    expect(observed.matchesPresented).toBe(false);
  });

  it('a WORKING-TREE correction cannot substitute for a wrong committed blob', () => {
    // The working tree holds exactly the presented bytes for both files; git holds a wrong ledger.
    const s2 = sys(
      {
        [`${ROOT}/.projectops/closure/decisions/${PHASE}.json`]: decisionBytes,
        [`${ROOT}/${LEDGER}`]: LEDGER_BYTES,
      },
      { [closureDecisionRelPath(PHASE)]: decisionBytes, [LEDGER]: LEDGER_BYTES.replace('41', '999') },
    );
    expect(observeOwnerCommit(s2, ROOT, wait(), OWNER).matchesPresented).toBe(false);
  });

  it('does not even ask whose commit it was until every byte is right', () => {
    // A bundle mismatch under an implementer identity reports the BYTES, so the operator fixes the
    // thing that is actually wrong first.
    const observed = observeOwnerCommit(
      sys({}, { [closureDecisionRelPath(PHASE)]: decisionBytes, [LEDGER]: 'x' }, ['Claude', 'c@x']),
      ROOT,
      wait(),
      OWNER,
    );
    expect(observed.matchesPresented).toBe(false);
    expect(observed.problems.join(' ')).toContain('NOT the file that was presented');
    expect(observed.problems.join(' ')).not.toContain('the implementer can never satisfy');
  });
});

describe('a wait that cannot say what the bundle was is refused', () => {
  it('refuses a bundle that does not open with the decision', () => {
    const bad = wait({ bundle: [{ path: LEDGER, sha256: closureDecisionSha256(LEDGER_BYTES) }] });
    expect(closureWaitProblems(bad, { projectId: PROJECT, phaseId: PHASE }).join(' ')).toContain(
      'does not open with the decision',
    );
  });

  it('refuses a bundle whose decision entry disagrees with the wait', () => {
    const bad = wait({
      bundle: [
        { path: closureDecisionRelPath(PHASE), sha256: `sha256:${'0'.repeat(64)}` },
        { path: LEDGER, sha256: closureDecisionSha256(LEDGER_BYTES) },
      ],
    });
    expect(closureWaitProblems(bad, { projectId: PROJECT, phaseId: PHASE }).join(' ')).toContain(
      'disagrees with the wait about the decision bytes',
    );
  });

  it('refuses an empty bundle, a repeated path, and a path outside .projectops', () => {
    expect(closureWaitProblems(wait({ bundle: [] }), { projectId: PROJECT, phaseId: PHASE }).join(' ')).toContain(
      'names no closure bundle',
    );
    const repeated = wait({
      bundle: [
        { path: closureDecisionRelPath(PHASE), sha256: closureDecisionSha256(closureDecisionBytes(DECISION)) },
        { path: closureDecisionRelPath(PHASE), sha256: closureDecisionSha256(closureDecisionBytes(DECISION)) },
      ],
    });
    expect(closureWaitProblems(repeated, { projectId: PROJECT, phaseId: PHASE }).join(' ')).toContain('more than once');
    const outside = wait({
      bundle: [
        { path: closureDecisionRelPath(PHASE), sha256: closureDecisionSha256(closureDecisionBytes(DECISION)) },
        { path: 'src/evil.ts', sha256: `sha256:${'1'.repeat(64)}` },
      ],
    });
    expect(closureWaitProblems(outside, { projectId: PROJECT, phaseId: PHASE }).join(' ')).toContain(
      'not a governed record path',
    );
  });

  it('refuses a wait written by the previous schema, which bound only the decision', () => {
    const s3 = sys();
    writeClosureWait(s3, ROOT, wait());
    const path = `${ROOT}/.projectops/closure/waits/${PHASE}.json`;
    const old = JSON.parse(s3.files[path] as string) as Record<string, unknown>;
    delete old['bundle'];
    old['schemaVersion'] = '1.0.0';
    s3.files[path] = JSON.stringify(old, null, 2);
    const read = readClosureWait(s3, ROOT, PHASE);
    expect(read.ok).toBe(false);
  });
});

describe('the bundle presented to the owner is exhaustive', () => {
  const DECISION_REL = closureDecisionRelPath(PHASE);
  const DECISION_SHA = closureDecisionSha256(closureDecisionBytes(DECISION));

  /** A System whose `git status --porcelain -uall` reports exactly `dirty`. */
  function statusSys(dirty: readonly string[], files: Record<string, string> = {}): System {
    const base = sys(files);
    return {
      ...base,
      exec: (cmd: string, args: readonly string[]) =>
        args.includes('status')
          ? { code: 0, stdout: dirty.map((d) => `?? ${d}`).join(String.fromCharCode(10)), stderr: '' }
          : base.exec(cmd, args),
    };
  }

  it('names the decision and the ledger, each digested from the bytes now on disk', () => {
    const out = buildClosureBundle(
      statusSys([DECISION_REL, LEDGER], { [`${ROOT}/${LEDGER}`]: LEDGER_BYTES }),
      ROOT,
      DECISION_REL,
      DECISION_SHA,
    );
    expect(out.kind).toBe('bundle');
    if (out.kind !== 'bundle') throw new Error('unreachable');
    expect(out.entries.map((e) => e.path)).toEqual([DECISION_REL, LEDGER]);
    expect(out.entries[1]?.sha256).toBe(closureDecisionSha256(LEDGER_BYTES));
  });

  it('REFUSES when a governed path this route did not write is uncommitted', () => {
    // The concrete shape that matters: a governance record dirty at the moment of the ask would
    // otherwise ride into the owner's commit without ever having been named or digested.
    const out = buildClosureBundle(
      statusSys([DECISION_REL, LEDGER, '.projectops/authority/closure-delegation.json'], {
        [`${ROOT}/${LEDGER}`]: LEDGER_BYTES,
      }),
      ROOT,
      DECISION_REL,
      DECISION_SHA,
    );
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('unreachable');
    expect(out.reasons.join(' ')).toContain('.projectops/authority/closure-delegation.json');
    expect(out.reasons.join(' ')).toContain('did not write');
  });

  it('refuses when git will not say what is uncommitted, rather than presenting an empty bundle', () => {
    const blind: System = { ...sys(), exec: () => ({ code: 1, stdout: '', stderr: 'no status' }) };
    const out = buildClosureBundle(blind, ROOT, DECISION_REL, DECISION_SHA);
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('unreachable');
    expect(out.reasons.join(' ')).toContain('An unverifiable bundle is not a bundle');
  });

  it('refuses when a bundle file cannot be read, rather than digesting nothing', () => {
    const out = buildClosureBundle(statusSys([DECISION_REL, LEDGER]), ROOT, DECISION_REL, DECISION_SHA);
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('unreachable');
    expect(out.reasons.join(' ')).toContain('could not be read');
  });
});

describe('porcelain forms the bundle parser must not guess at', () => {
  const DECISION_REL = closureDecisionRelPath(PHASE);
  const DECISION_SHA = closureDecisionSha256(closureDecisionBytes(DECISION));

  /** A System whose `git status` returns exactly these raw porcelain LINES. */
  function rawStatus(lines: readonly string[], files: Record<string, string> = {}): System {
    const base = sys(files);
    return {
      ...base,
      exec: (cmd: string, args: readonly string[]) =>
        args.includes('status')
          ? { code: 0, stdout: lines.join(String.fromCharCode(10)), stderr: '' }
          : base.exec(cmd, args),
    };
  }

  it('refuses a RENAME entry rather than parsing "old -> new" as a path', () => {
    const out = buildClosureBundle(
      rawStatus([`?? ${DECISION_REL}`, `R  ${LEDGER} -> .projectops/elsewhere.json`], {
        [`${ROOT}/${LEDGER}`]: LEDGER_BYTES,
      }),
      ROOT,
      DECISION_REL,
      DECISION_SHA,
    );
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('unreachable');
    // Quoted verbatim, so the operator sees what git actually said.
    expect(out.reasons.join(' ')).toContain('-> .projectops/elsewhere.json');
  });

  it('refuses a C-QUOTED path rather than digesting a name it invented', () => {
    const out = buildClosureBundle(
      rawStatus([`?? ${DECISION_REL}`, '?? ".projectops/od d.json"']),
      ROOT,
      DECISION_REL,
      DECISION_SHA,
    );
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('unreachable');
    // The whitespace rule fires first, which is the stronger of the two refusals: the raw line is
    // quoted back verbatim so an operator sees exactly what git said.
    expect(out.reasons.join(' ')).toContain('whitespace or control characters');
    expect(out.reasons.join(' ')).toContain('od d.json');
  });

  it('refuses paths reported relative to an OUTER repository root', () => {
    // A governed checkout nested inside a larger repository reports `sub/.projectops/...`. Those are
    // not this project's governed paths, and a bundle must not silently accept them.
    const out = buildClosureBundle(
      rawStatus([`?? ${DECISION_REL}`, '?? sub/.projectops/gatekeeper-ledger.json']),
      ROOT,
      DECISION_REL,
      DECISION_SHA,
    );
    expect(out.kind).toBe('refused');
  });

  it('accepts an ordinary modified-file entry, whose status code is two characters', () => {
    const out = buildClosureBundle(
      rawStatus([`?? ${DECISION_REL}`, ` M ${LEDGER}`], { [`${ROOT}/${LEDGER}`]: LEDGER_BYTES }),
      ROOT,
      DECISION_REL,
      DECISION_SHA,
    );
    expect(out.kind).toBe('bundle');
    if (out.kind !== 'bundle') throw new Error('unreachable');
    expect(out.entries.map((e) => e.path)).toEqual([DECISION_REL, LEDGER]);
  });
});

describe('a name crafted to be mistaken for the decision cannot enter the bundle', () => {
  const DECISION_REL = closureDecisionRelPath(PHASE);
  const DECISION_SHA = closureDecisionSha256(closureDecisionBytes(DECISION));
  const NBSP = String.fromCodePoint(0x00a0);

  function rawStatus(lines: readonly string[], files: Record<string, string> = {}): System {
    const base = sys(files);
    return {
      ...base,
      exec: (cmd: string, args: readonly string[]) =>
        args.includes('status')
          ? { code: 0, stdout: lines.join(String.fromCharCode(10)), stderr: '' }
          : base.exec(cmd, args),
    };
  }

  it('REFUSES a decoy whose name is the decision plus an invisible character', () => {
    // The ECC security review proved this against real git: with core.quotepath=false the decoy is
    // emitted unquoted, and an earlier parser's .trim() collapsed it onto the decision's own path — so
    // it passed the "unexpected path" filter AS the decision, was never digested, and rode into the
    // owner's commit. Two independent things now stop it: the path is no longer trimmed, and any path
    // carrying whitespace or a control character is refused by name.
    const out = buildClosureBundle(
      rawStatus([`?? ${DECISION_REL}`, `?? ${DECISION_REL}${NBSP}`, `?? ${LEDGER}`], {
        [`${ROOT}/${LEDGER}`]: LEDGER_BYTES,
      }),
      ROOT,
      DECISION_REL,
      DECISION_SHA,
    );
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('unreachable');
    expect(out.reasons.join(' ')).toContain('whitespace or control characters');
  });

  it('refuses every invisible-character class, not just the famous one', () => {
    for (const ch of ['\u200b', '\u2000', '\u3000', '\ufeff', '\u202f', ' ']) {
      const out = buildClosureBundle(
        rawStatus([`?? ${DECISION_REL}`, `?? ${DECISION_REL}${ch}`]),
        ROOT,
        DECISION_REL,
        DECISION_SHA,
      );
      expect(out.kind).toBe('refused');
    }
  });

  it('refuses a path reported twice, so one file cannot carry two presented digests', () => {
    const out = buildClosureBundle(
      rawStatus([`?? ${DECISION_REL}`, `?? ${LEDGER}`, `?? ${LEDGER}`], {
        [`${ROOT}/${LEDGER}`]: LEDGER_BYTES,
      }),
      ROOT,
      DECISION_REL,
      DECISION_SHA,
    );
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('unreachable');
    expect(out.reasons.join(' ')).toContain('more than once');
  });
});

describe('the owner commit is bounded to the bundle, not merely matched against it', () => {
  const bytes = closureDecisionBytes(DECISION);

  /** A System whose `git diff <head>..HEAD` reports exactly `changed`. */
  function diffing(changed: readonly string[], ancestorOk = true): System {
    const base = sys({}, bytes);
    return {
      ...base,
      exec: (cmd: string, args: readonly string[]) => {
        if (args.includes('merge-base')) return { code: ancestorOk ? 0 : 1, stdout: '', stderr: '' };
        if (args.includes('diff')) return { code: 0, stdout: changed.join(String.fromCharCode(10)), stderr: '' };
        return base.exec(cmd, args);
      },
    };
  }

  it('accepts a commit that introduced exactly the bundle', () => {
    const observed = observeOwnerCommit(
      diffing([closureDecisionRelPath(PHASE), LEDGER]),
      ROOT,
      wait(),
      OWNER,
    );
    expect(observed.matchesPresented).toBe(true);
  });

  it('REFUSES a commit that also introduced a file under a closure-TAIL path', () => {
    // The exact gap the ECC security review found: the closure directory is exempt from G4-12, so a
    // file dropped there during the wait was invisible to the bundle AND waved through by the gate.
    const observed = observeOwnerCommit(
      diffing([closureDecisionRelPath(PHASE), LEDGER, '.projectops/closure/decisions/OTHER-PHASE1A.json']),
      ROOT,
      wait(),
      OWNER,
    );
    expect(observed.matchesPresented).toBe(false);
    expect(observed.problems.join(' ')).toContain('were not in the bundle they were shown');
    expect(observed.problems.join(' ')).toContain('OTHER-PHASE1A.json');
  });

  it('refuses a commit that also introduced a phase record or a report', () => {
    for (const extra of ['.projectops/phases/OTHER1A.json', 'knowledge/reports/2026-09-03_x.md']) {
      const observed = observeOwnerCommit(
        diffing([closureDecisionRelPath(PHASE), LEDGER, extra]),
        ROOT,
        wait(),
        OWNER,
      );
      expect(observed.matchesPresented).toBe(false);
    }
  });

  it('refuses when the recorded head is not an ancestor of HEAD — rewritten history is not bounded', () => {
    const observed = observeOwnerCommit(
      diffing([closureDecisionRelPath(PHASE), LEDGER], false),
      ROOT,
      wait(),
      OWNER,
    );
    expect(observed.matchesPresented).toBe(false);
    expect(observed.problems.join(' ')).toContain('is not an ancestor');
  });

  it('refuses when git will not say what changed since the ask', () => {
    const base = sys({}, bytes);
    const broken: System = {
      ...base,
      exec: (cmd: string, args: readonly string[]) =>
        args.includes('diff') ? { code: 1, stdout: '', stderr: 'no diff' } : base.exec(cmd, args),
    };
    const observed = observeOwnerCommit(broken, ROOT, wait(), OWNER);
    expect(observed.matchesPresented).toBe(false);
    expect(observed.problems.join(' ')).toContain('cannot be bounded to the bundle');
  });

  it('refuses a wait that records no head for the ask', () => {
    expect(
      closureWaitProblems(wait({ headAtRequest: 'not-a-commit' }), { projectId: PROJECT, phaseId: PHASE }).join(' '),
    ).toContain('names no valid head');
  });

  it('refuses a stored wait whose head is missing, rather than reading it as unbounded', () => {
    const s2 = sys();
    writeClosureWait(s2, ROOT, wait());
    const path = `${ROOT}/.projectops/closure/waits/${PHASE}.json`;
    const stored = JSON.parse(s2.files[path] as string) as Record<string, unknown>;
    delete stored['headAtRequest'];
    s2.files[path] = JSON.stringify(stored, null, 2);
    expect(readClosureWait(s2, ROOT, PHASE).ok).toBe(false);
  });
});
