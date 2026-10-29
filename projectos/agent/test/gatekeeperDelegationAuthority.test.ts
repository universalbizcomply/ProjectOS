/**
 * C11-W2-F1 — the gatekeeper's decider must come from a record that was actually judged.
 *
 * THE DEFECT THIS FILE EXISTS FOR. `committedDelegatedDecider` accepted the committed delegation on
 * two facts alone: `programmeScope` matched and `delegatedTo` was a non-empty string. Everything else
 * about the record — its schema, whether the owner it claims to come from is this project's owner,
 * whether the delegate is the implementer, what it actually delegates — was checked only by
 * `checkClosureDelegationRecord`, and only while a plan was being approved. So the same committed
 * bytes could be refused by the approval path and simultaneously accepted as the authority behind
 * every review decision, and whether a record was judged at all depended on the ORDER of events:
 * commit the delegation after the plan is approved and nothing ever validated it.
 *
 * It was found by the C11 degraded-mode witness, whose owner-approved delegation carried the scope
 * `gatekeeper-review-decisions` — a scope the vocabulary did not have. Plan approval refused those
 * bytes; the gatekeeper resolver accepted them.
 *
 * The tests below are the gatekeeper's own list. Each one names the property it protects.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';

import {
  resolveDelegatedDecider,
  committedDelegatedDecider,
  resolveTechnicalDelegation,
  loadGatekeeperConfig,
  GATEKEEPER_CONFIG_REL,
} from '../src/loop/gatekeeperConfig.js';
import {
  authoriseClosure,
  GATEKEEPER_REVIEW_SCOPE,
  TECHNICAL_CONTINUATION_SCOPE,
  CLOSURE_DECISION_COMMIT_SCOPE,
  CLOSURE_SCOPES,
  DELEGABLE_SCOPES,
} from '@projectos/core';
import { PLAN_APPROVAL_DELEGATION_SCHEMA_VERSION, checkClosureDelegationRecord } from '../src/planApproval.js';
import type { System } from '../src/system.js';

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

const HEAD = 'b'.repeat(40);
const OWNER = 'Ada';
const DELEGATE = 'Grace';
const PROGRAMME = 'acme-recovery';
const DELEGATION_REL = '.projectops/authority/closure-delegation.json';

interface World {
  readonly root: string;
  readonly sys: System;
  /** Put a record in the working tree AND declare it committed. */
  readonly commitDelegation: (record: Record<string, unknown> | string) => void;
  /** Put a record in the working tree only. Never committed, so git reports nothing. */
  readonly writeUncommitted: (record: Record<string, unknown>) => void;
  /** Take a path back out of HEAD, to prove what an uncommitted anchor costs. */
  readonly uncommit: (rel: string) => void;
  /** Set what git reports at HEAD for a path, independently of what is on disk. */
  readonly commitBytes: (rel: string, text: string) => void;
}

/** A governed project with an active owner-approved plan — the canonical source of the owner. */
function world(): World {
  const root = mkdtempSync(pjoin(tmpdir(), 'projectos-gkdel-')).replace(/\\/g, '/');
  created.push(root);
  mkdirSync(pjoin(root, '.projectops', 'authority'), { recursive: true });
  mkdirSync(pjoin(root, 'state'), { recursive: true });
  writeFileSync(
    pjoin(root, 'state', 'active.plan.json'),
    JSON.stringify({ projectId: 'acme', programmeId: PROGRAMME, governance: { owner: OWNER, implementer: 'Claude Code' } }, null, 2),
  );
  writeFileSync(
    pjoin(root, '.projectops', 'project-config.json'),
    JSON.stringify(
      {
        projectId: 'acme',
        planMemory: { planPath: 'state/active.plan.json', currentStatePath: 'state/active.current-state.json' },
      },
      null,
      2,
    ),
  );

  // HEAD IS HELD SEPARATELY FROM THE WORKING TREE, deliberately. Serving `git show` out of the files
  // on disk would make the two indistinguishable — and telling them apart is the whole point of these
  // tests, since the correction turns on reading the anchors from the committed tree rather than the
  // working copy. `head` is what git reports; `writeFileSync` changes only what is on disk.
  const head = new Map<string, string>([
    ['.projectops/project-config.json', readFileSync(pjoin(root, '.projectops', 'project-config.json'), 'utf8')],
    ['state/active.plan.json', readFileSync(pjoin(root, 'state', 'active.plan.json'), 'utf8')],
  ]);
  const sys: System = {
    cwd: () => root,
    now: () => '2026-08-22T10:00:00.000Z',
    readText: (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
    writeText: (p: string, c: string) => {
      mkdirSync(pjoin(p, '..'), { recursive: true });
      writeFileSync(p, c);
    },
    exists: (p: string) => existsSync(p),
    listDir: (p: string) => (existsSync(p) ? readdirSync(p) : []),
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: (_cmd: string, args: readonly string[]) => {
      const showAt = args.indexOf('show');
      if (showAt === -1) return { code: 1, stdout: '', stderr: '' };
      const ref = String(args[showAt + 1] ?? '');
      if (!ref.startsWith('HEAD:')) return { code: 1, stdout: '', stderr: '' };
      const rel = ref.startsWith('HEAD:./') ? ref.slice('HEAD:./'.length) : ref.slice(5);
      const at = head.get(rel.toLowerCase());
      return at === undefined
        ? { code: 1, stdout: '', stderr: `fatal: path '${rel}' does not exist in 'HEAD'` }
        : { code: 0, stdout: at, stderr: '' };
    },
  };

  return {
    root,
    sys,
    commitDelegation: (record) => {
      const text = typeof record === 'string' ? record : JSON.stringify(record, null, 2);
      writeFileSync(pjoin(root, DELEGATION_REL), text);
      head.set(DELEGATION_REL.toLowerCase(), text);
    },
    writeUncommitted: (record) => {
      writeFileSync(pjoin(root, DELEGATION_REL), JSON.stringify(record, null, 2));
    },
    uncommit: (rel) => {
      head.delete(rel.toLowerCase());
    },
    commitBytes: (rel, text) => {
      head.set(rel.toLowerCase(), text);
    },
  };
}

/** A delegation that grants review decisions and nothing else. */
function reviewDelegation(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: PLAN_APPROVAL_DELEGATION_SCHEMA_VERSION,
    delegationId: 'ACME-GATEKEEPER-DELEGATION1A',
    projectId: 'acme',
    programmeScope: PROGRAMME,
    delegatedBy: OWNER,
    delegatedTo: DELEGATE,
    delegatedScope: [GATEKEEPER_REVIEW_SCOPE],
    delegationDate: '2026-08-22',
    excludesProtectedActions: true,
    ...over,
  };
}

/** Ask the closure engine whether this delegation closes something. Same call `transitionPhase` makes. */
function closureVerdict(delegatedScope: readonly string[], scope: 'phase-closure' | 'programme-closure') {
  return authoriseClosure({
    governedProjectId: 'acme',
    planProjectId: 'acme',
    owner: OWNER,
    implementer: 'Claude Code',
    closureAuthority: DELEGATE,
    delegation: {
      delegatedBy: OWNER,
      delegatedTo: DELEGATE,
      delegationDate: '2026-08-22',
      delegatedScope,
      projectScope: 'acme',
      excludesProtectedActions: true,
    },
    actorRole: 'advisor',
    actorIdentity: DELEGATE,
    scope,
    phaseId: 'ACME-P1A',
    // A delegation is necessary and not sufficient: the closure engine also requires an established
    // G4 verdict. Supplied as PASSING so that a refusal below can only be about the delegation.
    eligibility: { eligible: true, unmet: [], satisfied: [] },
    // Likewise the gatekeeper's own decision must have been looked up and found sound. Empty means
    // "checked, nothing wrong with it" — again so a refusal can only be about the delegation.
    decisionProblems: [],
  });
}

describe('C11-W2-F1 — validation is a property of the record, not of when it was committed', () => {
  /**
   * [A] THE DISCOVERED DEFECT. A record the canonical validator rejects must not name the decider,
   * however late it was committed. Here the delegating identity is not this project's owner — a
   * forged provenance the old resolver never looked at.
   */
  test('A an invalid delegation committed after approval still names no decider', () => {
    const w = world();
    w.commitDelegation(reviewDelegation({ delegatedBy: 'Mallory' }));

    const r = resolveDelegatedDecider(w.sys, w.root, PROGRAMME);

    expect(r.ok).toBe(false);
    expect(committedDelegatedDecider(w.sys, w.root, PROGRAMME)).toBeNull();
    expect(r.ok ? [] : r.problems.join(' | ')).toContain("not this project's recorded owner");
  });

  /**
   * [B] ORDER-INDEPENDENCE. The same bytes, judged before anything else has happened, are refused
   * for the same reason. If A and B could ever disagree, authority would depend on sequencing.
   */
  test('B the same invalid delegation is refused for the same reason whenever it is read', () => {
    const w1 = world();
    const w2 = world();
    const bytes = reviewDelegation({ delegatedBy: 'Mallory' });
    w1.commitDelegation(bytes);
    w2.commitDelegation(bytes);

    const first = resolveDelegatedDecider(w1.sys, w1.root, PROGRAMME);
    const second = resolveDelegatedDecider(w2.sys, w2.root, PROGRAMME);

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(first.ok ? [] : first.problems).toEqual(second.ok ? [] : second.problems);
  });

  /** [B2] An UNCOMMITTED record grants nothing, which is the older guarantee and must survive. */
  test('B2 an uncommitted delegation names no decider', () => {
    const w = world();
    w.writeUncommitted(reviewDelegation());

    expect(committedDelegatedDecider(w.sys, w.root, PROGRAMME)).toBeNull();
  });

  /** [B3] Bytes git cannot parse are not a delegation, and must not crash the resolver either. */
  test('B3 a committed non-object or unparseable record names no decider', () => {
    const w = world();
    w.commitDelegation('null');
    expect(committedDelegatedDecider(w.sys, w.root, PROGRAMME)).toBeNull();

    const w2 = world();
    w2.commitDelegation('{not json');
    expect(committedDelegatedDecider(w2.sys, w2.root, PROGRAMME)).toBeNull();
  });

  /**
   * [C] THE NARROW CAPABILITY. This is what the witness actually needed: a decider, and no closure.
   * The point of the correction is that both halves are true at once.
   */
  test('C a review-only delegation resolves the decider and closes nothing', () => {
    const w = world();
    w.commitDelegation(reviewDelegation());

    expect(committedDelegatedDecider(w.sys, w.root, PROGRAMME)).toBe(DELEGATE);
    // Refused for the RIGHT reason: the scope does not cover the closure, not some unrelated gap.
    const phase = closureVerdict([GATEKEEPER_REVIEW_SCOPE], 'phase-closure');
    const programme = closureVerdict([GATEKEEPER_REVIEW_SCOPE], 'programme-closure');
    expect(phase.ok).toBe(false);
    expect(programme.ok).toBe(false);
    expect(String(phase.ok ? '' : phase.error)).toContain('DELEGATION_SCOPE_MISMATCH');
    expect(String(programme.ok ? '' : programme.error)).toContain('DELEGATION_SCOPE_MISMATCH');
  });

  /**
   * [C2] AND THE CONVERSE. A closure delegation is not a licence to decide reviews. Without this the
   * correction would only have moved the conflation to the other side.
   */
  test('C2 a closure-only delegation names no gatekeeper decider', () => {
    const w = world();
    w.commitDelegation(reviewDelegation({ delegatedScope: [...CLOSURE_SCOPES] }));

    const r = resolveDelegatedDecider(w.sys, w.root, PROGRAMME);

    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.problems.join(' | ')).toContain(GATEKEEPER_REVIEW_SCOPE);
  });

  /** [C3] A delegation may still grant both, when that is what the owner recorded. */
  test('C3 a delegation carrying both scopes grants both', () => {
    const w = world();
    w.commitDelegation(reviewDelegation({ delegatedScope: [GATEKEEPER_REVIEW_SCOPE, 'phase-closure'] }));

    expect(committedDelegatedDecider(w.sys, w.root, PROGRAMME)).toBe(DELEGATE);
    expect(closureVerdict([GATEKEEPER_REVIEW_SCOPE, 'phase-closure'], 'phase-closure').ok).toBe(true);
  });

  /** [D] Authority does not cross programme boundaries. */
  test('D a delegation for one programme names no decider for another', () => {
    const w = world();
    w.commitDelegation(reviewDelegation());

    expect(committedDelegatedDecider(w.sys, w.root, 'some-other-programme')).toBeNull();
  });

  /** [E] The implementer can never be its own gatekeeper, by any route. */
  test('E a delegation naming the implementer is refused', () => {
    const w = world();
    w.commitDelegation(reviewDelegation({ delegatedTo: 'Claude Code' }));

    const r = resolveDelegatedDecider(w.sys, w.root, PROGRAMME);

    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.problems.join(' | ')).toContain('implementer');
  });

  /** [E2] Nor may a record invent a scope that is not in the vocabulary. */
  test('E2 an unrecognised scope is refused', () => {
    const w = world();
    w.commitDelegation(reviewDelegation({ delegatedScope: ['approve-anything'] }));

    const r = resolveDelegatedDecider(w.sys, w.root, PROGRAMME);

    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.problems.join(' | ')).toContain('may not grant');
  });

  /** [E3] Protected effects never travel with a delegation, whatever it is scoped to. */
  test('E3 a delegation that does not exclude protected actions is refused', () => {
    const w = world();
    w.commitDelegation(reviewDelegation({ excludesProtectedActions: false }));

    expect(committedDelegatedDecider(w.sys, w.root, PROGRAMME)).toBeNull();
  });

  /**
   * [G] A CALLER THAT REACHES THIS TOO EARLY GETS A REFUSAL, NOT A CRASH. Judging the record needs
   * the governance engine, which an entrypoint installs; this function needed no such dependency
   * before the correction, so the failure mode had to stay a refusal rather than become a throw.
   */
  test('G a failure to judge the record refuses, and says why, instead of throwing', () => {
    const w = world();
    w.commitDelegation(reviewDelegation());
    // The plan the config declares is committed but damaged: it records no owner, so there is nothing
    // to check the delegation's provenance against.
    w.commitBytes('state/active.plan.json', JSON.stringify({ projectId: 'acme', governance: {} }));

    const r = resolveDelegatedDecider(w.sys, w.root, PROGRAMME);

    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.problems.join(' | ')).toContain('owner could not be established');
  });

  /**
   * [F] ONE VALIDATION MODEL. The consumption boundary must not be satisfiable by anything the
   * approval boundary would refuse. Rather than asserting that, this asks both about the same bytes.
   */
  test('F every record the approval validator refuses is refused at consumption too', () => {
    const cases: Record<string, unknown>[] = [
      { delegatedBy: 'Mallory' },
      { delegatedTo: 'Claude Code' },
      { projectId: 'not-acme' },
      { delegatedScope: ['approve-anything'] },
      { delegatedScope: [] },
      { excludesProtectedActions: false },
      { schemaVersion: '0.9.0' },
      { delegationId: 'x' },
      { delegationDate: '' },
    ];

    for (const over of cases) {
      const w = world();
      const record = reviewDelegation(over);
      w.commitDelegation(record);

      const atApproval = checkClosureDelegationRecord(record as never, {
        projectId: 'acme',
        recordedOwner: OWNER,
        isCommitted: true,
        programmeId: PROGRAMME,
      });
      const atConsumption = resolveDelegatedDecider(w.sys, w.root, PROGRAMME);

      expect(atApproval.length, `approval accepted ${JSON.stringify(over)}`).toBeGreaterThan(0);
      expect(atConsumption.ok, `consumption accepted ${JSON.stringify(over)}`).toBe(false);
    }
  });
});

describe('C11-W2-F1 — the facts a delegation is judged against must have passed the commit gate too', () => {
  /**
   * [H] THE SECOND HALF OF THE DEFECT. `checkClosureDelegationRecord` compares the delegation to this
   * project's id and recorded owner. If those come from the working copy, anything that can write a
   * file can choose them — so an attacker sets the owner to a name of their choosing, commits ONE
   * internally consistent delegation naming that same owner, and is resolved as the decider. The
   * record passes every check because the expectations were moved to meet it. Validating a record
   * against a forgeable anchor is not validating it.
   */
  test('H the owner is taken from the COMMITTED plan, so a working-copy owner cannot be forged', () => {
    const w = world();
    // The committed plan says the owner is Ada. The working copy is rewritten to say Eve.
    writeFileSync(
      pjoin(w.root, 'state', 'active.plan.json'),
      JSON.stringify({ projectId: 'acme', programmeId: PROGRAMME, governance: { owner: 'Eve', implementer: 'Claude Code' } }, null, 2),
    );
    w.commitDelegation(reviewDelegation({ delegatedBy: 'Eve' }));

    const r = resolveDelegatedDecider(w.sys, w.root, PROGRAMME);

    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.problems.join(' | ')).toContain("not this project's recorded owner");
  });

  /** [H2] And the project identity likewise — otherwise a foreign delegation is adopted by an edit. */
  test('H2 the project id is taken from the COMMITTED config', () => {
    const w = world();
    writeFileSync(
      pjoin(w.root, '.projectops', 'project-config.json'),
      JSON.stringify({ projectId: 'someone-elses-project', planMemory: { planPath: 'state/active.plan.json' } }, null, 2),
    );
    w.commitDelegation(reviewDelegation({ projectId: 'someone-elses-project' }));

    const r = resolveDelegatedDecider(w.sys, w.root, PROGRAMME);

    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.problems.join(' | ')).toContain('is for project');
  });

  /** [H3] An uncommitted project identity anchors nothing, and says so. */
  test('H3 an uncommitted project config refuses rather than falling back to the working copy', () => {
    const w = world();
    w.commitDelegation(reviewDelegation());
    w.uncommit('.projectops/project-config.json');

    const r = resolveDelegatedDecider(w.sys, w.root, PROGRAMME);

    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.problems.join(' | ')).toContain('not committed');
  });

  /** [H4] Likewise an uncommitted active plan: it has not passed the owner commit gate. */
  test('H4 an uncommitted active plan cannot say who the owner is', () => {
    const w = world();
    w.commitDelegation(reviewDelegation());
    w.uncommit('state/active.plan.json');

    const r = resolveDelegatedDecider(w.sys, w.root, PROGRAMME);

    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.problems.join(' | ')).toContain('owner could not be established');
  });

  /**
   * [I] TRUE ORDER-INDEPENDENCE, in ONE project's timeline. Test B proves the function is
   * deterministic across two fixtures, which any stateless reader would satisfy. This is the property
   * the defect was actually about: an authority event happening FIRST must not bless a record
   * committed AFTERWARDS, and the reasons must be identical either way.
   */
  test('I a record committed after an approval-time read is judged exactly as it would have been before', () => {
    const w = world();

    // BEFORE: nothing is committed, so nothing grants the capability.
    const before = resolveDelegatedDecider(w.sys, w.root, PROGRAMME);
    expect(before.ok).toBe(false);
    expect(before.ok ? [] : before.problems.join(' | ')).toContain('no delegation record exists');

    // An authority event happens: the same validator is exercised at the approval boundary.
    const bad = reviewDelegation({ excludesProtectedActions: false });
    const atApproval = checkClosureDelegationRecord(bad as never, {
      projectId: 'acme',
      recordedOwner: OWNER,
      isCommitted: true,
      programmeId: PROGRAMME,
      requiredScope: GATEKEEPER_REVIEW_SCOPE,
    });

    // AFTER: the bad record is committed to the SAME project, later.
    w.commitDelegation(bad);
    const after = resolveDelegatedDecider(w.sys, w.root, PROGRAMME);

    expect(after.ok).toBe(false);
    // Not merely "also refused" — refused for exactly the reasons a fresh judgment gives.
    expect(after.ok ? [] : after.problems).toEqual(atApproval);
  });

  /** [I2] And the good case is equally order-free: committed late, it still grants. */
  test('I2 a valid record committed late grants the capability, with no blessing required', () => {
    const w = world();
    expect(resolveDelegatedDecider(w.sys, w.root, PROGRAMME).ok).toBe(false);

    w.commitDelegation(reviewDelegation());

    expect(committedDelegatedDecider(w.sys, w.root, PROGRAMME)).toBe(DELEGATE);
  });

  /** [J] The vocabularies must stay disjoint; the type-level claim is only as good as the constants. */
  // The non-closure scopes stay OUT of `CLOSURE_SCOPES`, which is what stops either of them being
  // passed as a closure scope at all — the type says so, and this says so about the values. The union
  // grew when `technical-continuation` was added in PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A;
  // asserting it by NAME rather than by count is what made that growth visible here instead of silent.
  /**
   * [J2] The technical scope has a READER, and it answers about the committed record.
   *
   * A scope written into a governance record that nothing consults is worse than no scope: it reads,
   * to anyone auditing the file, as an authority in force. These prove the capability is actually
   * resolved, that a delegation granting only review does not grant it, and that a record which is
   * invalid for some unrelated reason still reports its scopes truthfully rather than being described
   * as scopeless.
   */
  test('J2 the technical-continuation scope is resolved from the committed delegation', () => {
    const w = world();
    w.commitDelegation(reviewDelegation({ delegatedScope: [GATEKEEPER_REVIEW_SCOPE, TECHNICAL_CONTINUATION_SCOPE] }));
    const granted = resolveTechnicalDelegation(w.sys, w.root, PROGRAMME);
    expect(granted.problems).toEqual([]);
    expect(granted.carriesTechnicalScope).toBe(true);
    expect(granted.delegatedTo).toBe(DELEGATE);
  });

  test('J2 a delegation that grants only review does not grant a technical continuation', () => {
    const w = world();
    w.commitDelegation(reviewDelegation({ delegatedScope: [GATEKEEPER_REVIEW_SCOPE] }));
    const state = resolveTechnicalDelegation(w.sys, w.root, PROGRAMME);
    expect(state.problems.join(' ')).toContain(TECHNICAL_CONTINUATION_SCOPE);
    expect(state.carriesTechnicalScope).toBe(false);
    expect(state.delegatedTo).toBe('');
  });

  test('J2 an uncommitted delegation grants nothing, however complete it looks', () => {
    const w = world();
    w.writeUncommitted(reviewDelegation({ delegatedScope: [TECHNICAL_CONTINUATION_SCOPE] }));
    const state = resolveTechnicalDelegation(w.sys, w.root, PROGRAMME);
    expect(state.problems.length).toBeGreaterThan(0);
    // The working-tree copy is not consulted for the scope either.
    expect(state.carriesTechnicalScope).toBe(false);
  });

  test('J the non-closure scopes are not closure scopes, and DELEGABLE_SCOPES is exactly the union', () => {
    expect(CLOSURE_SCOPES).not.toContain(GATEKEEPER_REVIEW_SCOPE);
    expect(CLOSURE_SCOPES).not.toContain(TECHNICAL_CONTINUATION_SCOPE);
    expect(CLOSURE_SCOPES).not.toContain(CLOSURE_DECISION_COMMIT_SCOPE);
    expect([...DELEGABLE_SCOPES].sort()).toEqual(
      [...CLOSURE_SCOPES, GATEKEEPER_REVIEW_SCOPE, TECHNICAL_CONTINUATION_SCOPE, CLOSURE_DECISION_COMMIT_SCOPE].sort(),
    );
  });

  /** [K] The pure validator, asked directly: an absent record grants no named capability. */
  test('K an absent record is legitimate for approval and refused when a capability is required', () => {
    const expectations = { projectId: 'acme', recordedOwner: OWNER, isCommitted: false, programmeId: PROGRAMME };

    expect(checkClosureDelegationRecord(null, expectations)).toEqual([]);
    expect(checkClosureDelegationRecord(null, { ...expectations, requiredScope: GATEKEEPER_REVIEW_SCOPE }).join(' ')).toContain(
      GATEKEEPER_REVIEW_SCOPE,
    );
  });
});

/**
 * The production entry point. Everything above tests the resolver directly; this is the function the
 * loop actually calls, and the place the correction changed what an operator is told. A refusal that
 * says only "no delegation names a decider" is the same sentence for an absent record, a forged one
 * and a wrongly-scoped one — three different problems with three different fixes.
 */
describe('loadGatekeeperConfig — the programme is committed, and refusals name the real reason', () => {
  function gatekeeperConfig(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schemaVersion: '1.0.0',
      enabled: true,
      programmeId: PROGRAMME,
      transport: {
        transportId: 'test-primary',
        kind: 'openai-responses',
        model: 'test-model',
        capabilities: ['submit-request', 'receive-decision'],
        credentialRef: 'TEST_GATEKEEPER_KEY',
        commercialApproval: true,
        decidedBy: DELEGATE,
      },
      modelPolicy: { routineModel: 'test-model', strongModel: 'test-model' },
      rateCards: {
        'test-model': {
          model: 'test-model',
          inputMicroUsdPerMillion: 100000,
          cachedInputMicroUsdPerMillion: 10000,
          outputMicroUsdPerMillion: 400000,
        },
      },
      budget: { initialCreditMicroUsd: 5000000, warnAtMicroUsd: 2000000, hardStopAtMicroUsd: 5000000, phaseHardStopAtMicroUsd: 5000000, dayHardStopAtMicroUsd: 5000000, autoRecharge: false },
      budgetRaiseAuthorities: [],
      threadBinding: { schemaVersion: '1.0.0', projectId: 'acme', repositoryRoot: 'acme', providerThreadId: 't-1' },
      ...over,
    };
  }

  /** Write the config to disk AND to HEAD, which is the ordinary committed case. */
  function withConfig(w: ReturnType<typeof world>, over: Record<string, unknown> = {}): void {
    const text = JSON.stringify(gatekeeperConfig(over), null, 2);
    writeFileSync(pjoin(w.root, '.projectops', 'gatekeeper.json'), text);
    w.commitBytes(GATEKEEPER_CONFIG_REL, text);
  }

  /** PROJECTOS-KERNEL-COST-CAP1A: spending limits come from the COMMITTED file, and all must exist. */
  test('[COST-CAP] a cap raised in the working copy alone is refused; limits are read from the committed file', () => {
    const w = world();
    withConfig(w);
    w.commitDelegation(reviewDelegation());
    const raised = gatekeeperConfig({ budget: { initialCreditMicroUsd: 5000000, warnAtMicroUsd: 2000000, hardStopAtMicroUsd: 5000000, phaseHardStopAtMicroUsd: 4000000, dayHardStopAtMicroUsd: 5000000, autoRecharge: false } });
    writeFileSync(pjoin(w.root, '.projectops', 'gatekeeper.json'), JSON.stringify(raised, null, 2));
    const r = loadGatekeeperConfig(w.sys, w.root);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reasons.join(' | ')).toContain('differ from the committed .projectops/gatekeeper.json (phaseHardStopAtMicroUsd)');
  });

  test('[COST-CAP] a committed budget with no per-day cap is a refusal, not unlimited', () => {
    const w = world();
    withConfig(w, { budget: { initialCreditMicroUsd: 5000000, warnAtMicroUsd: 2000000, hardStopAtMicroUsd: 5000000, phaseHardStopAtMicroUsd: 1000000, autoRecharge: false } });
    w.commitDelegation(reviewDelegation());
    const r = loadGatekeeperConfig(w.sys, w.root);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reasons.join(' | ')).toContain('no usable per-day cap');
  });

  test('[COST-CAP] the committed caps are the policy the loop is handed', () => {
    const w = world();
    withConfig(w, { budget: { initialCreditMicroUsd: 5000000, warnAtMicroUsd: 2000000, hardStopAtMicroUsd: 5000000, phaseHardStopAtMicroUsd: 1000000, dayHardStopAtMicroUsd: 2000000, autoRecharge: false } });
    w.commitDelegation(reviewDelegation());
    const r = loadGatekeeperConfig(w.sys, w.root);
    expect(r.ok ? '' : r.reasons.join(' | ')).toBe('');
    expect(r.ok && r.config.budget).toEqual({ warnAtMicroUsd: 2000000, hardStopAtMicroUsd: 5000000, phaseHardStopAtMicroUsd: 1000000, dayHardStopAtMicroUsd: 2000000 });
  });

  test('a valid review-scoped delegation makes the decider available to the loop', () => {
    const w = world();
    withConfig(w);
    w.commitDelegation(reviewDelegation());

    const r = loadGatekeeperConfig(w.sys, w.root);

    expect(r.ok ? '' : r.reasons.join(' | ')).toBe('');
    expect(r.ok && r.config.expectedDecider).toBe(DELEGATE);
  });

  test('with no delegation at all, the refusal says nothing grants the capability', () => {
    const w = world();
    withConfig(w);

    const r = loadGatekeeperConfig(w.sys, w.root);

    expect(r.ok).toBe(false);
    const said = r.ok ? '' : r.reasons.join(' | ');
    expect(said).toContain(GATEKEEPER_REVIEW_SCOPE);
    expect(said).toContain('no delegation record exists');
  });

  /** The improvement this correction is FOR: the specific problem reaches the operator. */
  test('an invalid delegation is refused with the specific problem, not a generic line', () => {
    const w = world();
    withConfig(w);
    w.commitDelegation(reviewDelegation({ delegatedBy: 'Mallory' }));

    const r = loadGatekeeperConfig(w.sys, w.root);

    expect(r.ok).toBe(false);
    const said = r.ok ? '' : r.reasons.join(' | ');
    expect(said).toContain("not this project's recorded owner");
    expect(said).toContain('Mallory');
  });

  /** A closure delegation is not a licence to decide reviews, at the entry point too. */
  test('a closure-only delegation leaves the loop without a decider', () => {
    const w = world();
    withConfig(w);
    w.commitDelegation(reviewDelegation({ delegatedScope: [...CLOSURE_SCOPES] }));

    const r = loadGatekeeperConfig(w.sys, w.root);

    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reasons.join(' | ')).toContain('does not cover');
  });

  /**
   * C11-W2-F2. A delegation record has no expiry: it stops applying only because the programme moved
   * on. If the programme could be re-pointed in the working copy alone, an edit nobody reviewed would
   * revive a retired programme's delegation, and with it a decider who should no longer hold it.
   */
  test('re-pointing the programme in the working copy alone is refused', () => {
    const w = world();
    withConfig(w);
    w.commitDelegation(reviewDelegation());
    // HEAD still says PROGRAMME; the working copy is edited to name a different one.
    writeFileSync(
      pjoin(w.root, '.projectops', 'gatekeeper.json'),
      JSON.stringify(gatekeeperConfig({ programmeId: 'a-retired-programme' }), null, 2),
    );

    const r = loadGatekeeperConfig(w.sys, w.root);

    expect(r.ok).toBe(false);
    const said = r.ok ? '' : r.reasons.join(' | ');
    expect(said).toContain('a-retired-programme');
    expect(said).toContain(PROGRAMME);
  });

  test('an uncommitted gatekeeper configuration names no programme that can be relied on', () => {
    const w = world();
    withConfig(w);
    w.commitDelegation(reviewDelegation());
    w.uncommit(GATEKEEPER_CONFIG_REL);

    const r = loadGatekeeperConfig(w.sys, w.root);

    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reasons.join(' | ')).toContain('has not passed the owner commit gate');
  });

  /**
   * A CALLER THAT TAKES NO DECISION NEEDS NO DECIDER — and asking for one refused the wrong thing.
   *
   * Plan authoring is priced by this same configuration, because authoring and review spend the same
   * credential out of the same budget. It resolves no verdict, so there is no delegate to be entitled
   * to make one. Observed against a real project: a valid committed authoring permission and correct
   * pricing, refused with "no valid committed delegation grants 'gatekeeper-review-decisions'". True,
   * fail-closed, and about something the owner was not doing — a missing capability wearing the
   * costume of a governance refusal.
   */
  test("'not-needed' omits the review delegation and NOTHING else", () => {
    const w = world();
    withConfig(w);
    // No delegation committed at all — the exact state that used to refuse.
    const required = loadGatekeeperConfig(w.sys, w.root, 'required');
    expect(required.ok).toBe(false);

    const r = loadGatekeeperConfig(w.sys, w.root, 'not-needed');
    expect(r.ok ? '' : r.reasons.join(' | ')).toBe('');
    // The pricing a caller actually came for is present and unchanged…
    expect(r.ok && r.config.rateCards).toBeTruthy();
    expect(r.ok && r.config.budget.hardStopAtMicroUsd).toBeGreaterThan(0);
    expect(r.ok && r.config.transport.credentialRef).toBeTruthy();
    // …and the authority it did NOT ask for is empty rather than invented, so a caller that tried to
    // honour a verdict against it would compare against '' and refuse everything.
    expect(r.ok && r.config.expectedDecider).toBe('');
  });

  test("'not-needed' still refuses a configuration that is broken for any other reason", () => {
    const w = world();
    // The owner's budget ceiling is not a review question, so omitting the decider must not omit it.
    withConfig(w, { budget: { initialCreditMicroUsd: 5000000, warnAtMicroUsd: 2000000, hardStopAtMicroUsd: 99000000, phaseHardStopAtMicroUsd: 99000000, dayHardStopAtMicroUsd: 99000000, autoRecharge: false } });
    const r = loadGatekeeperConfig(w.sys, w.root, 'not-needed');
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reasons.join(' | ')).toContain('above the approved pilot figure');
  });

  test("'required' is the default, so nothing loses a check by forgetting the argument", () => {
    const w = world();
    withConfig(w);
    const explicit = loadGatekeeperConfig(w.sys, w.root, 'required');
    const implicit = loadGatekeeperConfig(w.sys, w.root);
    expect(implicit.ok).toBe(explicit.ok);
    expect(implicit.ok ? '' : implicit.reasons.join(' | ')).toBe(explicit.ok ? '' : explicit.reasons.join(' | '));
  });
});
