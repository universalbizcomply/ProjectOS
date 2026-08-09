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
  };

  test('every verb maps to a canonical typed invocation, or to null for refresh', () => {
    for (const verb of GOVERNED_VERBS) {
      const r = validateGovernedCommand(req({ verb, args: VALID_ARGS[verb] }));
      expect(r.ok, verb).toBe(true);
      if (!r.ok) continue;
      const inv = toAgentInvocation(r.request);
      if (verb === 'refresh') {
        expect(inv).toBeNull();
        continue;
      }
      expect(inv).not.toBeNull();
      expect(['phase', 'approve', 'report']).toContain(inv!.command);
      // Flag NAMES are literals in the mapping; caller input only supplies VALUES.
      for (const name of Object.keys(inv!.flags)) {
        expect(['id', 'to', 'as', 'delegated', 'note', 'action', 'decision', 'phase']).toContain(name);
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
    };
    for (const verb of GOVERNED_VERBS) {
      const inv = toAgentInvocation(valid(req({ verb, args: args[verb] })));
      if (inv === null) continue;
      expect(['phase', 'approve', 'report']).toContain(inv.command);
      expect(Object.keys(inv.flags)).not.toContain('force');
      expect(Object.keys(inv.flags)).not.toContain('override');
    }
  });
});
