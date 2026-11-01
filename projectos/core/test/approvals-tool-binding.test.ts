/**
 * An approval is bound to one run, one tool and one exact set of arguments (plan v1.31, PORT-APPROVALS1A).
 *
 * Each refusal stands beside the same call passing, so the default cannot pass for the rule. A refusal is
 * asserted by its rule name: `val-projectos-port-approvals1a` removes each rule and requires the refused
 * call to go through, which is what shows the rule is the thing that refused it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseActionRegistry, type ActionRegistry } from '../src/actionRegistry.js';
import {
  canonicalArguments,
  checkToolCall,
  deriveToolEffect,
  issueToolApproval,
  recordOutsideContent,
  startRunGuard,
  type RunGuard,
  type ToolApproval,
  type ToolCall,
  type ToolCheckResult,
} from '../src/approvals/index.js';

const NOW = '2026-11-01T12:00:00.000Z';
const EXPIRY = '2026-11-01T13:00:00.000Z';
const OWNER = { approvalId: 'approval-1', decidedBy: 'owner', decidedAt: NOW, expiry: EXPIRY } as const;
const RUN = 'run-7f3a';
const TOOL = 'send_invoice';
const ARGS = { to: 'client@example.invalid', amount: 1200, lines: [{ sku: 'a', qty: 2 }] };
const CALL: ToolCall = { runId: RUN, toolName: TOOL, args: ARGS };

function registryFrom(extra: readonly Record<string, unknown>[] = []): ActionRegistry {
  const path = fileURLToPath(new URL('../../security/action-registry.json', import.meta.url));
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const parsed = parseActionRegistry({ ...raw, actions: [...(raw['actions'] as unknown[]), ...extra] });
  if (!parsed.ok) throw new Error(parsed.problems.map((problem) => problem.message).join('; '));
  return parsed.registry;
}

const REGISTRY = registryFrom();

const cleanGuard = (runId = RUN): RunGuard => startRunGuard({ runId, ownerStarted: true, attempt: 1 });

function approved(guard: RunGuard, call: ToolCall = CALL, decision: Parameters<typeof issueToolApproval>[0] = OWNER): ToolApproval {
  const issued = issueToolApproval(decision, call, guard);
  if (!issued.ok) throw new Error(issued.reasons.join('; '));
  return issued.approval;
}

const refusedBy = (result: ToolCheckResult): string | null => (result.passed ? null : result.rule);

/** Every string the same length as `text` with exactly one UTF-16 unit changed. */
const eachOneByteChange = (text: string): readonly string[] =>
  [...text].map((char, index) => `${text.slice(0, index)}${char === 'x' ? 'y' : 'x'}${text.slice(index + 1)}`);

describe('the effect an approval is bound to', () => {
  it('derives one key from the run, the tool and the argument hash', () => {
    const effect = deriveToolEffect(CALL);
    if (!effect.ok) throw new Error(effect.reasons.join('; '));
    expect(effect.effect.effectKey).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(effect.effect.argumentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(effect.effect.runId).toBe(RUN);
    expect(effect.effect.toolName).toBe(TOOL);
  });

  it('never shows the arguments in the key: a key can go in a record', () => {
    const effect = deriveToolEffect(CALL);
    expect(JSON.stringify(effect.ok && effect.effect.effectKey)).not.toContain('client@example.invalid');
  });

  it('the same arguments in another key order are the same effect', () => {
    const first = deriveToolEffect({ runId: RUN, toolName: TOOL, args: { a: 1, b: { c: 2, d: 3 } } });
    const second = deriveToolEffect({ runId: RUN, toolName: TOOL, args: { b: { d: 3, c: 2 }, a: 1 } });
    expect(first.ok && first.effect.effectKey).toBe(second.ok && second.effect.effectKey);
  });

  it('a run and tool cannot trade characters: the upstream colon-joined key collided here', () => {
    const first = deriveToolEffect({ runId: 'a:b', toolName: 'c', args: {} });
    const second = deriveToolEffect({ runId: 'a', toolName: 'b:c', args: {} });
    expect(first.ok && second.ok).toBe(true);
    expect(first.ok && first.effect.effectKey).not.toBe(second.ok && second.effect.effectKey);
  });

  it('a blank run or tool has no effect to bind', () => {
    expect(deriveToolEffect({ runId: '  ', toolName: TOOL, args: {} }).ok).toBe(false);
    expect(deriveToolEffect({ runId: RUN, toolName: '', args: {} }).ok).toBe(false);
  });
});

describe('canonical arguments: only values with exactly one reading', () => {
  it('sorts keys, keeps null and keeps an empty array', () => {
    expect(canonicalArguments({ b: 1, a: [null, []] })).toEqual({ ok: true, canonical: '{"a":[null,[]],"b":1}' });
  });

  it('keeps an own __proto__ key: JSON can carry one, and dropping it would merge two values', () => {
    const parsed = canonicalArguments(JSON.parse('{"__proto__":1}'));
    expect(parsed).toEqual({ ok: true, canonical: '{"__proto__":1}' });
  });

  it('a null-prototype object is a plain value', () => {
    const value = Object.create(null) as Record<string, unknown>;
    value['a'] = 1;
    expect(canonicalArguments(value)).toEqual({ ok: true, canonical: '{"a":1}' });
  });

  const withGetter = Object.defineProperty({}, 'a', { get: () => 1, enumerable: true });
  const hidden = Object.defineProperty({ a: 1 }, 'b', { value: 2, enumerable: false });
  const labelled = Object.assign([1], { extra: 2 });
  const sparseAndLabelled = Object.assign(new Array(2), { 0: 1, extra: 2 });
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['undefined inside an object', { a: undefined }],
    ['undefined inside an array', [undefined]],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative zero, which JSON prints as zero', { n: -0 }],
    ['an integer past the safe range', { n: 2 ** 53 }],
    ['a sparse array', new Array(1)],
    ['a function', { f: () => 1 }],
    ['a bigint', { n: 1n }],
    ['a symbol', { s: Symbol('s') }],
    ['a Date', new Date(0)],
    ['a Map', new Map()],
    ['a class instance', new (class Thing {})()],
    ['a getter, which could answer differently when the tool runs', withGetter],
    ['a non-enumerable property', hidden],
    ['a symbol key', { [Symbol('s')]: 1 }],
    ['a labelled array', labelled],
    ['a sparse array padded with a label', sparseAndLabelled],
    ['a cycle', cyclic],
  ])('%s is refused', (_label, value) => {
    expect(canonicalArguments(value).ok).toBe(false);
  });

  it('a structure deep enough to overflow is refused, not thrown', () => {
    const deep = Array.from({ length: 100_000 }).reduce<unknown>((inner) => [inner], null);
    expect(canonicalArguments(deep).ok).toBe(false);
  });
});

describe('an approval is refused on any one-byte change', () => {
  it('the exact call passes, and hands back the bytes that were approved: the positive control', () => {
    const guard = cleanGuard();
    const result = checkToolCall(guard, CALL, REGISTRY, approved(guard), NOW);
    expect(result.passed).toBe(true);
    const effect = deriveToolEffect(CALL);
    expect(result.passed && result.canonicalArguments).toBe(effect.ok && effect.effect.canonicalArguments);
  });

  it('every one-character change to the run is refused', () => {
    for (const runId of eachOneByteChange(RUN)) {
      const approval = approved(cleanGuard());
      const guard = cleanGuard(runId);
      expect(refusedBy(checkToolCall(guard, { ...CALL, runId }, REGISTRY, approval, NOW))).toBe('APPROVAL_EFFECT_MISMATCH');
    }
  });

  it('every one-character change to the tool is refused', () => {
    for (const toolName of eachOneByteChange(TOOL)) {
      const guard = cleanGuard();
      expect(refusedBy(checkToolCall(guard, { ...CALL, toolName }, REGISTRY, approved(guard), NOW))).toBe('APPROVAL_EFFECT_MISMATCH');
    }
  });

  it('every one-character change to the arguments is refused', () => {
    const effect = deriveToolEffect(CALL);
    if (!effect.ok) throw new Error('the control has no effect');
    const changes = eachOneByteChange(effect.effect.canonicalArguments).flatMap((text) => {
      try {
        return [JSON.parse(text) as unknown];
      } catch {
        return [];
      }
    });
    expect(changes.length).toBeGreaterThan(30);
    for (const args of changes) {
      const guard = cleanGuard();
      expect(refusedBy(checkToolCall(guard, { ...CALL, args }, REGISTRY, approved(guard), NOW))).toBe('APPROVAL_EFFECT_MISMATCH');
    }
  });

  it('a second number that differs only past the safe range is refused rather than collapsed', () => {
    const guard = cleanGuard();
    const args = JSON.parse('{"account":12345678901234567891}') as unknown;
    expect(refusedBy(checkToolCall(guard, { ...CALL, args }, REGISTRY, approved(guard), NOW))).toBe('BAD_ARGUMENTS');
  });

  it('negative zero is not zero: the sign is not silently dropped', () => {
    const guard = cleanGuard();
    const approval = approved(guard, { ...CALL, args: { n: 0 } });
    expect(refusedBy(checkToolCall(guard, { ...CALL, args: { n: -0 } }, REGISTRY, approval, NOW))).toBe('BAD_ARGUMENTS');
  });
});

describe('who can approve, and for how long', () => {
  it.each(['implementer', 'advisor'] as const)('%s cannot approve, and the owner can: the same decision otherwise', (decidedBy) => {
    const guard = cleanGuard();
    const refused = issueToolApproval({ ...OWNER, decidedBy }, CALL, guard);
    expect(refused).toMatchObject({ ok: false, rule: 'NOT_THE_OWNER' });
    expect(issueToolApproval(OWNER, CALL, guard).ok).toBe(true);
  });

  it('a perfect copy of an approval is not an approval', () => {
    const guard = cleanGuard();
    const copy = { ...approved(guard) };
    expect(refusedBy(checkToolCall(guard, CALL, REGISTRY, copy, NOW))).toBe('APPROVAL_FORGED');
  });

  it('an approval is frozen', () => {
    expect(Object.isFrozen(approved(cleanGuard()))).toBe(true);
  });

  it('every approval expires, and passes up to the instant before', () => {
    const guard = cleanGuard();
    const approval = approved(guard);
    expect(refusedBy(checkToolCall(guard, CALL, REGISTRY, approval, EXPIRY))).toBe('APPROVAL_EXPIRED');
    expect(checkToolCall(guard, CALL, REGISTRY, approval, '2026-11-01T12:59:59.999Z').passed).toBe(true);
  });

  it('an unreadable clock is an expired approval', () => {
    const guard = cleanGuard();
    expect(refusedBy(checkToolCall(guard, CALL, REGISTRY, approved(guard), 'soon'))).toBe('APPROVAL_EXPIRED');
  });

  it.each<[string, Partial<typeof OWNER> | Record<string, string>]>([
    ['an expiry that is not an instant', { expiry: 'tomorrow' }],
    ['a decision time that is not an instant', { decidedAt: 'now' }],
    ['an expiry at or before the decision', { expiry: NOW }],
    ['a blank id', { approvalId: ' ' }],
  ])('%s is refused when the approval is issued', (_label, change) => {
    expect(issueToolApproval({ ...OWNER, ...change } as typeof OWNER, CALL, cleanGuard())).toMatchObject({ ok: false, rule: 'BAD_DECISION' });
  });

  it('an approval cannot be issued for arguments that have no one reading', () => {
    expect(issueToolApproval(OWNER, { ...CALL, args: { n: -0 } }, cleanGuard())).toMatchObject({ ok: false, rule: 'BAD_ARGUMENTS' });
  });

  it('an approval cannot be issued against a run state that is not live, or for another run', () => {
    const guard = cleanGuard();
    expect(issueToolApproval(OWNER, CALL, { ...guard })).toMatchObject({ ok: false, rule: 'RUN_STATE_NOT_LIVE' });
    expect(issueToolApproval(OWNER, { ...CALL, runId: 'run-other' }, guard)).toMatchObject({ ok: false, rule: 'RUN_MISMATCH' });
  });
});

describe('an approval is spent once', () => {
  it('the second use of one approval is refused, even from the guard the first use returned', () => {
    const guard = cleanGuard();
    const approval = approved(guard);
    const first = checkToolCall(guard, CALL, REGISTRY, approval, NOW);
    if (!first.passed) throw new Error('the control did not pass');
    expect(first.approvalSpent).toBe(OWNER.approvalId);
    expect(refusedBy(checkToolCall(first.guard, CALL, REGISTRY, approval, NOW))).toBe('APPROVAL_SPENT');
  });

  it('the same effect twice needs a second decision, and that decision is enough', () => {
    const guard = cleanGuard();
    const first = checkToolCall(guard, CALL, REGISTRY, approved(guard), NOW);
    if (!first.passed) throw new Error('the control did not pass');
    const second = approved(first.guard, CALL, { ...OWNER, approvalId: 'approval-2' });
    expect(checkToolCall(first.guard, CALL, REGISTRY, second, NOW).passed).toBe(true);
  });

  it('a call that passes without an approval spends nothing', () => {
    const guard = cleanGuard();
    const result = checkToolCall(guard, CALL, REGISTRY, null, NOW);
    expect(result.passed && result.approvalSpent).toBe(null);
    expect(result.passed && result.guard).toBe(guard);
  });

  it('a refused call leaves the guard as it was, so the run can still ask', () => {
    const guard = cleanGuard();
    const approval = approved(guard);
    const refused = checkToolCall(guard, { ...CALL, toolName: 'other_tool' }, REGISTRY, approval, NOW);
    expect(refused.passed).toBe(false);
    expect(refused.guard).toBe(guard);
    expect(checkToolCall(guard, CALL, REGISTRY, approval, NOW).passed).toBe(true);
  });
});

describe('what no approval can do', () => {
  const PROHIBITED = registryFrom([{ id: 'read-other-tenant', governanceAction: null, ownerOnlyAction: null, class: 'P6', environment: 'local' }]);
  const P6: ToolCall = { runId: RUN, toolName: 'read-other-tenant', args: {} };

  it('P6 is refused with an approval from the owner, and without one', () => {
    const guard = cleanGuard();
    expect(refusedBy(checkToolCall(guard, P6, PROHIBITED, approved(guard, P6), NOW))).toBe('P6_PROHIBITED');
    expect(refusedBy(checkToolCall(guard, P6, PROHIBITED, null, NOW))).toBe('P6_PROHIBITED');
  });

  it('a tainted P6 is refused the same way, and the same call on a registered P5 passes with an approval', () => {
    const guard = recordOutsideContent(cleanGuard(), 'a web page');
    expect(refusedBy(checkToolCall(guard, P6, PROHIBITED, approved(guard, P6), NOW))).toBe('P6_PROHIBITED');
    const p5 = { ...P6, toolName: 'approve' };
    expect(checkToolCall(guard, p5, PROHIBITED, approved(guard, p5), NOW).passed).toBe(true);
  });

  it('there is no approval mode to pass: the decision names a person, and nothing else', () => {
    expect(Object.keys(OWNER).sort()).toEqual(['approvalId', 'decidedAt', 'decidedBy', 'expiry']);
    const guard = cleanGuard();
    const widened = { ...OWNER, mode: 'never', skipApprovals: true, decidedBy: 'implementer' } as unknown as typeof OWNER;
    expect(issueToolApproval(widened, CALL, guard)).toMatchObject({ ok: false, rule: 'NOT_THE_OWNER' });
  });
});
