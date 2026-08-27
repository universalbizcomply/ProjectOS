/**
 * The governed command vocabulary — proving the Control Centre cannot become a remote shell.
 *
 * The write path lets a browser cause a durable governed mutation, so the question that matters is
 * not "does the happy path work" but "what is the worst thing a crafted message can express". These
 * tests attack the boundary: unknown verbs, injected flags, path traversal, shell metacharacters,
 * oversized fields, wrong types, extra arguments. Every one must be refused BEFORE the runtime is
 * reached, and no caller-supplied text may ever become a command name or a flag name.
 */
import { describe, test, expect } from 'vitest';
import {
  validateGovernedCommand,
  toAgentInvocation,
  GOVERNED_VERBS,
  GOVERNED_COMMAND_KIND,
  type GovernedCommandRequest,
} from '../src/governed/governedCommands';

function req(over: Record<string, unknown> = {}): unknown {
  return {
    kind: GOVERNED_COMMAND_KIND,
    verb: 'phase.advance',
    args: { phaseId: 'PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A', toStatus: 'validating' },
    correlationId: 'c1',
    ...over,
  };
}

function valid(value: unknown): GovernedCommandRequest {
  const r = validateGovernedCommand(value);
  if (!r.ok) throw new Error(`expected valid, got ${r.code}: ${r.detail}`);
  return r.request;
}

describe('W1 an allowed, well-formed command is accepted', () => {
  test('a phase advance validates and maps to the canonical argv', () => {
    const inv = toAgentInvocation(valid(req()));
    expect(inv).toEqual({
      command: 'phase',
      positionals: ['advance'],
      flags: { id: 'PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A', to: 'validating', as: 'implementer' },
    });
  });

  const VALID_ARGS: Record<string, Record<string, string>> = {
    refresh: {},
    'phase.start': { phaseId: 'P1A' },
    'phase.advance': { phaseId: 'P1A', toStatus: 'validating' },
    'phase.stop': { phaseId: 'P1A' },
    'phase.resume': { phaseId: 'P1A' },
    'phase.close': { phaseId: 'P1A' },
    'approval.request': { approvalId: 'A1', action: 'close the phase' },
    'approval.decide': { approvalId: 'A1', decision: 'approved' },
    'report.write': { phaseId: 'P1A' },
    'plan.draft': { objective: 'Make the ordering flow simple enough to need no training at all.' },
    'plan.decide': { draftId: 'draft-20260813-a1b2c3', decision: 'approve' },
    'plan.activate': { draftId: 'draft-20260813-a1b2c3', decisionId: 'PROJECTOS-DECISION1A' },
    'project.select': { projectId: 'projectos' },
    'run.start': { phaseId: 'P1A' },
    'run.resume': { phaseId: 'P1A', sessionId: 'P1A-abcdef0123456789-a1b2c3d4' },
    'run.stop': { phaseId: 'P1A' },
  };

  test('every verb maps to a canonical typed invocation, or to null for refresh', () => {
    for (const verb of GOVERNED_VERBS) {
      const r = validateGovernedCommand(req({ verb, args: VALID_ARGS[verb] }));
      expect(r.ok, verb).toBe(true);
      if (!r.ok) continue;
      const inv = toAgentInvocation(r.request);
      // `refresh` and `project.select` reach NO canonical agent command. Both are served entirely at
      // the host/daemon boundary — one re-reads state, the other decides which project is being read
      // — so neither has an argv, a flag or a positional for a value to escape through.
      //
      // `run.*` likewise reach no canonical agent command: they spawn and track a real process,
      // which the sidecar intercepts before `toAgentInvocation` is ever consulted (see host.mjs).
      if (verb === 'refresh' || verb === 'project.select' || verb === 'run.start' || verb === 'run.resume' || verb === 'run.stop') {
        expect(inv).toBeNull();
        continue;
      }
      expect(inv).not.toBeNull();
      expect(['phase', 'approve', 'report', 'plan']).toContain(inv!.command);
      // Flag NAMES are literals in the mapping; caller input only supplies VALUES.
      for (const name of Object.keys(inv!.flags)) {
        expect(['id', 'to', 'as', 'delegated', 'note', 'action', 'decision', 'phase', 'objective']).toContain(name);
      }
      expect(inv!.flags).not.toHaveProperty('force');
      expect(inv!.flags).not.toHaveProperty('override');
    }
  });

  test('stop and resume use real state-machine transitions, not invented statuses', () => {
    expect(toAgentInvocation(valid(req({ verb: 'phase.stop', args: { phaseId: 'P1A' } })))!.flags['to']).toBe('rolled_back');
    expect(toAgentInvocation(valid(req({ verb: 'phase.resume', args: { phaseId: 'P1A' } })))!.flags['to']).toBe('draft');
  });
});

describe('W3 the boundary refuses anything that is not a governed verb', () => {
  test('an unknown verb is refused', () => {
    for (const verb of ['shell', 'exec', 'git.push', 'phase.delete', '', null, 42, {}]) {
      const r = validateGovernedCommand(req({ verb }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(['UNKNOWN_VERB', 'MALFORMED_REQUEST']).toContain(r.code);
    }
  });

  test('a non-governed message shape is refused', () => {
    for (const bad of [null, undefined, 'string', 42, [], { kind: 'snapshot' }, {}]) {
      expect(validateGovernedCommand(bad).ok).toBe(false);
    }
  });

  test('an unknown argument name is refused rather than ignored', () => {
    const r = validateGovernedCommand(req({ args: { phaseId: 'P1A', toStatus: 'validating', cmd: 'rm -rf /' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('INVALID_ARGUMENT');
      expect(r.detail).toContain('cmd');
    }
  });

  test('a required argument cannot be defaulted away', () => {
    const r = validateGovernedCommand(req({ args: { phaseId: 'P1A' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('MISSING_ARGUMENT');
  });
});

describe('injection attempts are refused at the boundary', () => {
  const hostile = [
    // A leading '-' turns an "identifier" into a flag at the argv boundary. These two are here
    // because an earlier revision of the pattern accepted them.
    '--force',
    '-f',
    '--as owner',
    'P1A --to closed',
    'P1A; rm -rf /',
    'P1A && git push --force',
    'P1A | cat /etc/passwd',
    '$(whoami)',
    '`whoami`',
    '../../../etc/passwd',
    'C:/Windows/System32/cmd.exe',
    '\\\\server\\share\\evil',
    'P1A\nphase advance --to closed',
    'P1A\u0000',
  ];

  test('a hostile phase id never reaches the runtime', () => {
    for (const phaseId of hostile) {
      const r = validateGovernedCommand(req({ args: { phaseId, toStatus: 'validating' } }));
      expect(r.ok, `expected refusal for ${JSON.stringify(phaseId)}`).toBe(false);
      if (!r.ok) expect(r.code).toBe('INVALID_ARGUMENT');
    }
  });

  test('a hostile role or identity never reaches the runtime', () => {
    for (const bad of ['owner --identity ChatGPT', 'owner\nadvisor', 'owner;whoami']) {
      expect(validateGovernedCommand(req({ verb: 'phase.close', args: { phaseId: 'P1A', role: bad } })).ok).toBe(false);
      expect(validateGovernedCommand(req({ verb: 'phase.close', args: { phaseId: 'P1A', role: 'advisor', identity: bad } })).ok).toBe(false);
    }
  });

  test('notes allow prose but never control characters', () => {
    expect(validateGovernedCommand(req({ args: { phaseId: 'P1A', toStatus: 'validating', note: 'Reviewed; looks good (2026-08-09).' } })).ok).toBe(true);
    for (const bad of ['line\nbreak', 'null\u0000byte', 'tab\there']) {
      expect(validateGovernedCommand(req({ args: { phaseId: 'P1A', toStatus: 'validating', note: bad } })).ok).toBe(false);
    }
  });

  test('oversized fields are refused', () => {
    expect(validateGovernedCommand(req({ args: { phaseId: 'P'.repeat(201), toStatus: 'validating' } })).ok).toBe(false);
    expect(validateGovernedCommand(req({ args: { phaseId: 'P1A', toStatus: 'validating', note: 'x'.repeat(501) } })).ok).toBe(false);
    expect(validateGovernedCommand(req({ correlationId: 'c'.repeat(65) })).ok).toBe(false);
  });

  test('a non-string argument is refused', () => {
    for (const v of [42, true, null, {}, ['a']]) {
      expect(validateGovernedCommand(req({ args: { phaseId: v, toStatus: 'validating' } })).ok).toBe(false);
    }
  });

  test('a malformed correlationId is refused', () => {
    for (const c of ['', 'a b', 'a/b', undefined, 7]) {
      expect(validateGovernedCommand(req({ correlationId: c })).ok).toBe(false);
    }
  });
});

describe('CRITICAL regression: a value can never become a flag', () => {
  test('a note that looks like a flag is refused outright', () => {
    for (const note of ['--force', '--override', '-f', '--as owner']) {
      const r = validateGovernedCommand(req({ args: { phaseId: 'P1A', toStatus: 'validating', note } }));
      expect(r.ok, note).toBe(false);
    }
  });

  test('even if a value survived validation it lands as a VALUE in a typed flags object', () => {
    // The structural guarantee: the mapping writes flag names itself, so a value is only ever data.
    const inv = toAgentInvocation(valid(req({ args: { phaseId: 'P1A', toStatus: 'validating', note: 'ordinary prose' } })));
    expect(inv!.flags['note']).toBe('ordinary prose');
    expect(Object.keys(inv!.flags).sort()).toEqual(['as', 'id', 'note', 'to']);
  });

  test('a verb refuses an argument it has no use for', () => {
    // 'note' reaching phase.start was the vehicle for the flag-injection defect.
    const r = validateGovernedCommand(req({ verb: 'phase.start', args: { phaseId: 'P1A', note: 'x' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('does not accept');
  });

  test('the renderer cannot claim the owner role on any verb', () => {
    for (const verb of GOVERNED_VERBS) {
      if (verb === 'refresh') continue;
      const r = validateGovernedCommand(req({ verb, args: { phaseId: 'P1A', toStatus: 'validating', role: 'owner' } }));
      expect(r.ok, verb).toBe(false);
    }
  });

  test('closure is not reachable as an ordinary advance', () => {
    for (const toStatus of ['closed', 'closed_as_blocked']) {
      const r = validateGovernedCommand(req({ args: { phaseId: 'P1A', toStatus } }));
      expect(r.ok, toStatus).toBe(false);
      if (!r.ok) expect(r.detail).toContain('closure has its own verb');
    }
  });

  test('the renderer cannot name or authenticate the gatekeeper', () => {
    // The last place a caller could supply the string that confers the power. Closure now takes
    // NO role and NO identity: the runtime resolves the delegate from the active approved plan.
    for (const args of [
      { phaseId: 'P1A', identity: 'ChatGPT' },
      { phaseId: 'P1A', role: 'advisor', identity: 'ChatGPT' },
      { phaseId: 'P1A', role: 'advisor' },
      { phaseId: 'P1A', role: 'owner' },
      { phaseId: 'P1A', identity: 'Murad' },
    ]) {
      const r = validateGovernedCommand(req({ verb: 'phase.close', args }));
      expect(r.ok, JSON.stringify(args)).toBe(false);
    }
    // A bare closure REQUEST is accepted, and carries no authority claim at all.
    const ok = validateGovernedCommand(req({ verb: 'phase.close', args: { phaseId: 'P1A' } }));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const inv = toAgentInvocation(ok.request)!;
      expect(inv.flags).not.toHaveProperty('as');
      expect(inv.flags).not.toHaveProperty('identity');
      expect(inv.flags['delegated']).toBe('true');
    }
  });
});

describe('W17 protected actions are unreachable through this path', () => {
  test('no verb exists for deploy, database, send, payment, credential or push', () => {
    const forbidden = ['deploy', 'database', 'db', 'send', 'email', 'payment', 'charge', 'secret', 'credential', 'push', 'install'];
    for (const word of forbidden) {
      expect(GOVERNED_VERBS.some((v) => v.toLowerCase().includes(word))).toBe(false);
    }
  });

  test('no verb can produce an escalating flag, and none targets a protected command', () => {
    const args: Record<string, Record<string, string>> = {
      refresh: {}, 'phase.start': { phaseId: 'P1A' },
      'phase.advance': { phaseId: 'P1A', toStatus: 'validating' },
      'phase.stop': { phaseId: 'P1A' }, 'phase.resume': { phaseId: 'P1A' },
      'phase.close': { phaseId: 'P1A' },
      'approval.request': { approvalId: 'A1', action: 'close the phase' },
      'approval.decide': { approvalId: 'A1', decision: 'approved' },
      'report.write': { phaseId: 'P1A' },
      'plan.draft': { objective: 'Make the ordering flow simple enough to need no training at all.' },
      'plan.decide': { draftId: 'draft-20260813-a1b2c3', decision: 'approve' },
    'plan.activate': { draftId: 'draft-20260813-a1b2c3', decisionId: 'PROJECTOS-DECISION1A' },
      'project.select': { projectId: 'projectos' },
      'run.start': { phaseId: 'P1A' },
      'run.resume': { phaseId: 'P1A', sessionId: 'P1A-abcdef0123456789-a1b2c3d4' },
      'run.stop': { phaseId: 'P1A' },
    };
    for (const verb of GOVERNED_VERBS) {
      const inv = toAgentInvocation(valid(req({ verb, args: args[verb] })));
      if (inv === null) continue;
      expect(['phase', 'approve', 'report', 'plan']).toContain(inv.command);
      expect(Object.keys(inv.flags)).not.toContain('force');
      expect(Object.keys(inv.flags)).not.toContain('override');
    }
  });
});

/**
 * PLAN ACTIVATION — the boundary half.
 *
 * These prove what the CHANNEL refuses. What a valid-looking request then has to survive is a
 * different and stronger set of checks in `approvePlan`, covered by the agent's own suite: committed
 * delegation, committed decision, unconsumed decision, matching project, repository, branch, draft
 * and plan digest, expected decider, implementer-cannot-approve, and an independently recomputed
 * PLAN READY. Nothing here can substitute for that, and nothing here tries to.
 */
describe('plan.activate cannot be turned into an approval by the caller', () => {
  const good = { draftId: 'draft-20260813-a1b2c3', decisionId: 'PROJECTOS-DECISION1A' };

  test('[L] the renderer cannot supply an approver, a role or an authority identity', () => {
    for (const extra of [
      { role: 'owner' },
      { role: 'advisor' },
      { role: 'implementer' },
      { decision: 'approved' },
      { approvalId: 'A1' },
      { note: 'approved by the owner' },
    ]) {
      const r = validateGovernedCommand(req({ verb: 'plan.activate', args: { ...good, ...extra } }));
      expect(r.ok, JSON.stringify(extra)).toBe(false);
    }
  });

  test('[L] no argument can carry a path, a delegation or a command line', () => {
    for (const bad of [
      { draftId: '../../.projectops/authority/plan-approval-delegation.json' },
      { decisionId: '../plan-decisions/other' },
      // Built from a char code so no source-processing step can quietly strip the separator.
      { draftId: `C:${String.fromCharCode(92)}dev${String.fromCharCode(92)}evil` },
      { decisionId: 'x --force' },
      { draftId: 'a b' },
      { decisionId: '' },
    ]) {
      const r = validateGovernedCommand(req({ verb: 'plan.activate', args: { ...good, ...bad } }));
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  test('[L] both identifiers are REQUIRED — a draft alone cannot activate anything', () => {
    for (const partial of [{ draftId: good.draftId }, { decisionId: good.decisionId }, {}]) {
      const r = validateGovernedCommand(req({ verb: 'plan.activate', args: partial }));
      expect(r.ok, JSON.stringify(partial)).toBe(false);
      if (!r.ok) expect(r.code).toBe('MISSING_ARGUMENT');
    }
  });

  test('[N] activation maps to the CANONICAL plan activate operation, not a copy', () => {
    const inv = toAgentInvocation(valid(req({ verb: 'plan.activate', args: good })));
    expect(inv).toEqual({
      command: 'plan',
      positionals: ['activate'],
      flags: { id: good.draftId, decision: good.decisionId },
    });
  });

  test('[O] plan.draft remains non-authoritative and cannot reach approve', () => {
    const inv = toAgentInvocation(
      valid(req({ verb: 'plan.draft', args: { objective: 'Ship the thing that makes invoices simple.' } })),
    );
    expect(inv!.positionals).toEqual(['draft']);
    expect(Object.keys(inv!.flags)).toEqual(['objective']);
    // And drafting cannot borrow activation's arguments.
    const sneak = validateGovernedCommand(
      req({ verb: 'plan.draft', args: { objective: 'x'.repeat(20), decisionId: 'PROJECTOS-DECISION1A' } }),
    );
    expect(sneak.ok).toBe(false);
  });

  test('flag NAMES are literals: caller input only ever becomes a flag VALUE', () => {
    const inv = toAgentInvocation(
      valid(req({ verb: 'plan.activate', args: { draftId: 'draft-1a2b3c4d', decisionId: 'DECISION-1A2B' } })),
    );
    expect(Object.keys(inv!.flags).sort()).toEqual(['decision', 'id']);
    for (const v of Object.values(inv!.flags)) expect(String(v).startsWith('-')).toBe(false);
  });
});

/**
 * PROJECT SELECTION — the boundary half (PROJECTOS-PHASE6-SECTION-C).
 *
 * The verb exists so the owner can choose WHICH installed project the surface reads. What these
 * prove is that it can carry nothing else: no path, no root, no role, no note. What a valid-looking
 * id then has to survive is `decideSelection`, which resolves it against the inventory the installed
 * host supplied — covered in `projectInventory.test.ts`.
 */
describe('project.select carries an id and nothing else', () => {
  test('it requires a projectId and accepts no other argument', () => {
    const missing = validateGovernedCommand(req({ verb: 'project.select', args: {} }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('MISSING_ARGUMENT');

    for (const extra of [
      { projectId: 'projectos', repositoryRoot: 'C:\\dev\\ProjectOS' },
      { projectId: 'projectos', root: 'C:\\dev\\ProjectOS' },
      { projectId: 'projectos', path: 'C:\\dev\\ProjectOS' },
      { projectId: 'projectos', role: 'owner' },
      { projectId: 'projectos', note: 'please' },
      { projectId: 'projectos', phaseId: 'P1A' },
    ]) {
      const r = validateGovernedCommand(req({ verb: 'project.select', args: extra }));
      expect(r.ok, JSON.stringify(extra)).toBe(false);
      if (!r.ok) expect(r.code).toBe('INVALID_ARGUMENT');
    }
  });

  /**
   * A PATH IS NOT AN IDENTIFIER. The identifier pattern refuses a value carrying a separator, a
   * leading dash or whitespace, so the path shapes an attacker would reach for are rejected at the
   * channel — before the inventory lookup that would refuse them again.
   */
  test('it refuses path-shaped and flag-shaped values', () => {
    for (const projectId of [
      'C:\\dev\\ProjectOS',
      'C:/dev/ProjectOS',
      '../ProjectOS',
      '\\\\server\\share',
      '/etc/passwd',
      '--force',
      '-f',
      'project os',
      '',
    ]) {
      const r = validateGovernedCommand(req({ verb: 'project.select', args: { projectId } }));
      expect(r.ok, projectId).toBe(false);
    }
  });

  test('a well-formed id validates and reaches no canonical command', () => {
    const r = validateGovernedCommand(req({ verb: 'project.select', args: { projectId: 'projectos' } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(toAgentInvocation(r.request)).toBeNull();
  });
});

/**
 * `plan.decide` — the only verb in this vocabulary that records an authority.
 *
 * WHAT MAKES IT SAFE IS NOT THAT IT IS SMALL. It is that everything carrying authority is DERIVED by
 * the runtime and cannot be supplied here: a caller who could name `decidedBy` would be naming the
 * party whose name confers the power, which is a filter on a string rather than a control over
 * anything. The same shape was refused for `phase.close`, and these tests hold that line for the one
 * verb where getting it wrong would let a web page approve a plan.
 *
 * Added in PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A.
 */
/**
 * `plan.draft` must be able to ASK FOR AUTHORING.
 *
 * THE DEFECT THIS PINS. The verb accepted only `objective`, and the canonical command authors only
 * when it is told to — so every objective submitted from the Control Centre took the corpus-import
 * route. "Start Something New" reached the surface and never reached the author: the runtime had the
 * capability, the surface had no way to ask for it, and no provider call could be made from the
 * product at all. Found during the dev-tree live proof, before any paid dispatch.
 */
describe('W8b plan.draft carries which operation answers the objective', () => {
  const draft = (args: Record<string, unknown>): unknown => req({ verb: 'plan.draft', args });
  const OBJ = 'Make the ordering flow simple enough to need no training at all.';

  test('authored:true reaches the canonical command as the authoring flag', () => {
    const inv = toAgentInvocation(valid(draft({ objective: OBJ, authored: 'true' })));
    expect(inv).toEqual({ command: 'plan', positionals: ['draft'], flags: { objective: OBJ, authored: 'true' } });
  });

  test('absent means import, which is what every earlier caller meant', () => {
    const inv = toAgentInvocation(valid(draft({ objective: OBJ })));
    expect(inv).toEqual({ command: 'plan', positionals: ['draft'], flags: { objective: OBJ } });
    expect(inv!.flags).not.toHaveProperty('authored');
  });

  test('authored:false is import, stated rather than assumed', () => {
    const inv = toAgentInvocation(valid(draft({ objective: OBJ, authored: 'false' })));
    expect(inv!.flags).not.toHaveProperty('authored');
  });

  test('anything but true or false is refused', () => {
    for (const bad of ['yes', '1', 'TRUE', '', 'authored', '--authored']) {
      const r = validateGovernedCommand(draft({ objective: OBJ, authored: bad }));
      expect(r.ok, bad).toBe(false);
    }
  });

  test('asking for authoring grants nothing — it selects an operation', () => {
    // The flag says WHICH operation answers the objective. Whether it CAN run is decided downstream
    // by the installation allowlist, the project's committed authoring permission and the spend
    // ceiling, none of which this channel can reach.
    const inv = toAgentInvocation(valid(draft({ objective: OBJ, authored: 'true' })));
    expect(Object.keys(inv!.flags).sort()).toEqual(['authored', 'objective']);
  });
});

describe('W9 plan.decide records a decision and asserts no authority', () => {
  const decide = (args: Record<string, unknown>): unknown => req({ verb: 'plan.decide', args });

  test('approve and reject both validate and map to the canonical command', () => {
    for (const verdict of ['approve', 'reject']) {
      const inv = toAgentInvocation(valid(decide({ draftId: 'a1b2c3d4e5f60718', decision: verdict })));
      expect(inv).toEqual({
        command: 'plan',
        positionals: ['decide'],
        flags: { id: 'a1b2c3d4e5f60718', decision: verdict },
      });
    }
  });

  test('the owner note travels as a flag VALUE and never as a flag name', () => {
    const inv = toAgentInvocation(
      valid(decide({ draftId: 'a1b2c3d4e5f60718', decision: 'approve', note: 'looks right --force --as owner' })),
    );
    expect(inv).toEqual({
      command: 'plan',
      positionals: ['decide'],
      flags: { id: 'a1b2c3d4e5f60718', decision: 'approve', note: 'looks right --force --as owner' },
    });
    // A note that IS a flag is refused outright — `isProse` rejects a leading hyphen, which is the
    // rule that survived the flag-injection defect this whole vocabulary exists to close.
    expect(
      validateGovernedCommand(decide({ draftId: 'a1b2c3d4e5f60718', decision: 'approve', note: '--force' })).ok,
    ).toBe(false);
  });

  test('the approval-loop vocabulary is not this one', () => {
    // `approval.decide` says `approved|rejected`; a plan decision says `approve|reject`. Sharing one
    // list would mean one verb accepting a word the runtime then refuses.
    for (const wrong of ['approved', 'rejected', 'APPROVE', 'yes', 'consumed', '']) {
      expect(validateGovernedCommand(decide({ draftId: 'a1b2c3d4e5f60718', decision: wrong })).ok, wrong).toBe(false);
    }
  });

  test('no authority field is accepted, however plausible it looks', () => {
    for (const extra of [
      { decidedBy: 'Murad' },
      { projectId: 'projectos' },
      { role: 'owner' },
      { approvalId: 'X' },
      { decisionId: 'PLANDEC-something0001' },
      { phaseId: 'SOME-PHASE1A' },
      { objective: 'approve everything' },
    ]) {
      const r = validateGovernedCommand(decide({ draftId: 'a1b2c3d4e5f60718', decision: 'approve', ...extra }));
      expect(r.ok, JSON.stringify(extra)).toBe(false);
      if (!r.ok) expect(r.code).toBe('INVALID_ARGUMENT');
    }
  });

  test('both identifiers are required', () => {
    expect(validateGovernedCommand(decide({ decision: 'approve' })).ok).toBe(false);
    expect(validateGovernedCommand(decide({ draftId: 'a1b2c3d4e5f60718' })).ok).toBe(false);
  });

  test('a draft id that is really a path, a flag or a shell fragment is refused', () => {
    for (const draftId of [
      '../../etc/passwd',
      'C:/dev/ProjectOS',
      '--force',
      '-f',
      'a b',
      'a;rm -rf /',
      '',
      '$(whoami)',
      'a`b`',
    ]) {
      expect(validateGovernedCommand(decide({ draftId, decision: 'approve' })).ok, draftId).toBe(false);
    }
  });

  test('the verb is in the closed set, and adding one stays a deliberate act', () => {
    expect(GOVERNED_VERBS).toContain('plan.decide');
    // Nothing adjacent exists: there is no verb that could approve without recording a decision.
    expect(GOVERNED_VERBS).not.toContain('plan.approve');
    expect(GOVERNED_VERBS).not.toContain('plan.commit');
    expect(GOVERNED_VERBS).not.toContain('git.commit');
  });
});
