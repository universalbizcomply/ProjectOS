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
import * as approvalsBarrel from '../src/approvals/index.js';
import { canonicalArguments, deriveToolEffect, type ToolCall } from '../src/approvals/effectKey.js';
import { recordOutsideContent, recordToolResult, startRunGuard, type RunGuard } from '../src/approvals/taint.js';
import { checkToolCall, issueToolApproval, MAX_APPROVAL_LIFETIME_MS, type ToolApproval, type ToolApprovalDecision, type ToolCheckResult } from '../src/approvals/toolApproval.js';
import { admitEnvelope, mintEnvelope } from '../src/taskEnvelope.js';
import { parseTenantRegistry, resolveTenant } from '../src/tenant.js';

const NOW = '2026-11-01T12:00:00.000Z';
const EXPIRY = '2026-11-01T13:00:00.000Z';
const OWNER: ToolApprovalDecision = { approvalId: 'approval-1', decidedBy: 'owner', decidedAt: NOW, expiry: EXPIRY };
const TOOL = 'send_invoice';
const FREE_TOOL = 'project-selection';
const TOKEN = 'lineage-1';
const ARGS = { to: 'client@example.invalid', amount: 1200, lines: [{ sku: 'a', qty: 2 }] };

const json = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../security/${name}`, import.meta.url)), 'utf8')) as Record<string, unknown>;

function registryFrom(extra: readonly Record<string, unknown>[] = []): ActionRegistry {
  const raw = json('action-registry.json');
  const parsed = parseActionRegistry({ ...raw, actions: [...(raw['actions'] as unknown[]), ...extra] });
  if (!parsed.ok) throw new Error(parsed.problems.map((problem) => problem.message).join('; '));
  return parsed.registry;
}

const REGISTRY = registryFrom();

let runs = 0;
const newRun = (): string => `run-${(runs += 1)}-7f3a`;
const cleanGuard = (runId = newRun(), lineageToken = TOKEN): RunGuard => startRunGuard({ runId, lineageToken, ownerStarted: true, attempt: 1 });
const callOn = (guard: RunGuard, change: Partial<ToolCall> = {}): ToolCall => ({ runId: guard.runId, toolName: TOOL, args: ARGS, ...change });

function approved(guard: RunGuard, call: ToolCall = callOn(guard), decision: ToolApprovalDecision = OWNER): ToolApproval {
  const issued = issueToolApproval(decision, call, guard, NOW);
  if (!issued.ok) throw new Error(issued.reasons.join('; '));
  return issued.approval;
}

const refusedBy = (result: ToolCheckResult): string | null => (result.taintClear ? null : result.rule);

function clear(result: ToolCheckResult): Extract<ToolCheckResult, { taintClear: true }> {
  if (!result.taintClear) throw new Error(`the control was refused: ${result.rule}`);
  return result;
}

/** Every string the same length as `text` with exactly one UTF-16 unit changed. */
const eachOneByteChange = (text: string): readonly string[] =>
  [...text].map((char, index) => `${text.slice(0, index)}${char === 'x' ? 'y' : 'x'}${text.slice(index + 1)}`);

describe('the effect an approval is bound to', () => {
  it('derives one key from the run, the tool and the argument hash', () => {
    const effect = deriveToolEffect({ runId: 'run-a', toolName: TOOL, args: ARGS });
    if (!effect.ok) throw new Error(effect.reasons.join('; '));
    expect(effect.effect.effectKey).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(effect.effect.argumentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(effect.effect.runId).toBe('run-a');
    expect(effect.effect.toolName).toBe(TOOL);
  });

  it('never shows the arguments in the key: a key can go in a record', () => {
    const effect = deriveToolEffect({ runId: 'run-a', toolName: TOOL, args: ARGS });
    expect(JSON.stringify(effect.ok && effect.effect.effectKey)).not.toContain('client@example.invalid');
  });

  it('the same arguments in another key order are the same effect', () => {
    const first = deriveToolEffect({ runId: 'run-a', toolName: TOOL, args: { a: 1, b: { c: 2, d: 3 } } });
    const second = deriveToolEffect({ runId: 'run-a', toolName: TOOL, args: { b: { d: 3, c: 2 }, a: 1 } });
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
    expect(deriveToolEffect({ runId: 'run-a', toolName: '', args: {} }).ok).toBe(false);
  });
});

describe('canonical arguments: only values with exactly one reading', () => {
  it('sorts keys, keeps null and keeps an empty array', () => {
    expect(canonicalArguments({ b: 1, a: [null, []] })).toEqual({ ok: true, canonical: '{"a":[null,[]],"b":1}' });
  });

  it('keeps an own __proto__ key: JSON can carry one, and dropping it would merge two values', () => {
    expect(canonicalArguments(JSON.parse('{"__proto__":1}'))).toEqual({ ok: true, canonical: '{"__proto__":1}' });
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

describe('the budgets on canonical arguments', () => {
  /** Each level holds the one below it twice, so the JSON doubles while the object stays small. */
  const doubling = (depth: number): unknown => Array.from({ length: depth }).reduce<unknown>((inner) => [inner, inner], 'a');

  it('the shared-reference bomb a reviewer timed at 18 s is refused quickly', () => {
    const started = performance.now();
    expect(canonicalArguments(doubling(22)).ok).toBe(false);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('a shared reference that fits the budget is an ordinary value', () => {
    expect(canonicalArguments(doubling(8)).ok).toBe(true);
  });

  it('a string past the byte budget is refused, and one inside it passes', () => {
    expect(canonicalArguments({ body: 'a'.repeat(5 * 1024 * 1024) }).ok).toBe(false);
    expect(canonicalArguments({ body: 'a'.repeat(1024 * 1024) }).ok).toBe(true);
  });

  it('bytes are counted as UTF-8: three-byte characters are not one each', () => {
    expect(canonicalArguments({ body: '\u20ac'.repeat(2 * 1024 * 1024) }).ok).toBe(false);
  });

  it('keys are counted too', () => {
    const wide = Object.fromEntries(Array.from({ length: 3 }, (_, index) => [`${index}${'k'.repeat(2 * 1024 * 1024)}`, 1]));
    expect(canonicalArguments(wide).ok).toBe(false);
  });
});

describe('an approval is refused on any one-byte change', () => {
  it('the exact call clears, and hands back the bytes that were approved: the positive control', () => {
    const guard = cleanGuard();
    const call = callOn(guard);
    const result = clear(checkToolCall(guard, call, REGISTRY, approved(guard, call), NOW));
    const effect = deriveToolEffect(call);
    expect(result.canonicalArguments).toBe(effect.ok && effect.effect.canonicalArguments);
  });

  it('every one-character change to the run is refused', () => {
    for (const runId of eachOneByteChange(newRun())) {
      const approval = approved(cleanGuard());
      const guard = cleanGuard(runId);
      expect(refusedBy(checkToolCall(guard, callOn(guard), REGISTRY, approval, NOW))).toBe('APPROVAL_EFFECT_MISMATCH');
    }
  });

  it('every one-character change to the tool is refused', () => {
    for (const toolName of eachOneByteChange(TOOL)) {
      const guard = cleanGuard();
      expect(refusedBy(checkToolCall(guard, callOn(guard, { toolName }), REGISTRY, approved(guard), NOW))).toBe('APPROVAL_EFFECT_MISMATCH');
    }
  });

  it('every one-character change to the arguments is refused', () => {
    const effect = deriveToolEffect({ runId: 'run-a', toolName: TOOL, args: ARGS });
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
      expect(refusedBy(checkToolCall(guard, callOn(guard, { args }), REGISTRY, approved(guard), NOW))).toBe('APPROVAL_EFFECT_MISMATCH');
    }
  });

  it('a second number that differs only past the safe range is refused rather than collapsed', () => {
    const guard = cleanGuard();
    const args = JSON.parse('{"account":12345678901234567891}') as unknown;
    expect(refusedBy(checkToolCall(guard, callOn(guard, { args }), REGISTRY, approved(guard), NOW))).toBe('BAD_ARGUMENTS');
  });

  it('negative zero is not zero: the sign is not silently dropped', () => {
    const guard = cleanGuard();
    const approval = approved(guard, callOn(guard, { args: { n: 0 } }));
    expect(refusedBy(checkToolCall(guard, callOn(guard, { args: { n: -0 } }), REGISTRY, approval, NOW))).toBe('BAD_ARGUMENTS');
  });
});

describe('who can approve, and for how long', () => {
  it.each(['implementer', 'advisor'] as const)('%s cannot approve, and the owner can: the same decision otherwise', (decidedBy) => {
    const guard = cleanGuard();
    expect(issueToolApproval({ ...OWNER, decidedBy }, callOn(guard), guard, NOW)).toMatchObject({ ok: false, rule: 'NOT_THE_OWNER' });
    expect(issueToolApproval(OWNER, callOn(guard), guard, NOW).ok).toBe(true);
  });

  it('a perfect copy of an approval is not an approval', () => {
    const guard = cleanGuard();
    expect(refusedBy(checkToolCall(guard, callOn(guard), REGISTRY, { ...approved(guard) }, NOW))).toBe('APPROVAL_FORGED');
  });

  it('an approval is frozen', () => {
    expect(Object.isFrozen(approved(cleanGuard()))).toBe(true);
  });

  it('every approval expires, and clears up to the instant before', () => {
    const guard = cleanGuard();
    const approval = approved(guard);
    expect(refusedBy(checkToolCall(guard, callOn(guard), REGISTRY, approval, EXPIRY))).toBe('APPROVAL_EXPIRED');
    expect(checkToolCall(guard, callOn(guard), REGISTRY, approval, '2026-11-01T12:59:59.999Z').taintClear).toBe(true);
  });

  it('an unreadable clock is an expired approval', () => {
    const guard = cleanGuard();
    expect(refusedBy(checkToolCall(guard, callOn(guard), REGISTRY, approved(guard), 'soon'))).toBe('APPROVAL_EXPIRED');
  });

  it('a decision from the future is refused, and the same decision at its own time is not', () => {
    const guard = cleanGuard();
    const decision = { ...OWNER, decidedAt: '2026-11-01T12:30:00.000Z' };
    expect(issueToolApproval(decision, callOn(guard), guard, NOW)).toMatchObject({ ok: false, rule: 'DECIDED_IN_FUTURE' });
    expect(issueToolApproval(decision, callOn(guard), guard, decision.decidedAt).ok).toBe(true);
  });

  it('a lifetime past the cap is refused, and a lifetime at the cap is not', () => {
    const guard = cleanGuard();
    const at = Date.parse(NOW);
    const atCap = new Date(at + MAX_APPROVAL_LIFETIME_MS).toISOString();
    const pastCap = new Date(at + MAX_APPROVAL_LIFETIME_MS + 1).toISOString();
    expect(issueToolApproval({ ...OWNER, expiry: pastCap }, callOn(guard), guard, NOW)).toMatchObject({ ok: false, rule: 'LIFETIME_TOO_LONG' });
    expect(issueToolApproval({ ...OWNER, expiry: atCap }, callOn(guard), guard, NOW).ok).toBe(true);
  });

  it.each<[string, Partial<ToolApprovalDecision>]>([
    ['an expiry that is not an instant', { expiry: 'tomorrow' }],
    ['a decision time that is not an instant', { decidedAt: 'now' }],
    ['an expiry at or before the decision', { expiry: NOW }],
    ['a blank id', { approvalId: ' ' }],
  ])('%s is refused when the approval is issued', (_label, change) => {
    const guard = cleanGuard();
    expect(issueToolApproval({ ...OWNER, ...change }, callOn(guard), guard, NOW)).toMatchObject({ ok: false, rule: 'BAD_DECISION' });
  });

  it('an unreadable clock cannot issue an approval', () => {
    const guard = cleanGuard();
    expect(issueToolApproval(OWNER, callOn(guard), guard, 'soon')).toMatchObject({ ok: false, rule: 'BAD_DECISION' });
  });

  it('an approval cannot be issued for arguments that have no one reading', () => {
    const guard = cleanGuard();
    expect(issueToolApproval(OWNER, callOn(guard, { args: { n: -0 } }), guard, NOW)).toMatchObject({ ok: false, rule: 'BAD_ARGUMENTS' });
  });

  it('an approval cannot be issued against a run state that is not live, or for another run', () => {
    const guard = cleanGuard();
    expect(issueToolApproval(OWNER, callOn(guard), { ...guard }, NOW)).toMatchObject({ ok: false, rule: 'RUN_STATE_NOT_LIVE' });
    expect(issueToolApproval(OWNER, callOn(guard, { runId: 'run-other' }), guard, NOW)).toMatchObject({ ok: false, rule: 'RUN_MISMATCH' });
  });
});

describe('an approval is spent once', () => {
  const freeCall = (guard: RunGuard): ToolCall => callOn(guard, { toolName: FREE_TOOL });
  const settled = (guard: RunGuard): RunGuard => recordToolResult(guard, FREE_TOOL, REGISTRY, [FREE_TOOL]);

  it('the second use of one approval is refused, even from the guard the first use returned', () => {
    const guard = cleanGuard();
    const approval = approved(guard, freeCall(guard));
    const first = clear(checkToolCall(guard, freeCall(guard), REGISTRY, approval, NOW));
    expect(first.approvalSpent).toBe(OWNER.approvalId);
    expect(refusedBy(checkToolCall(settled(first.guard), freeCall(guard), REGISTRY, approval, NOW))).toBe('APPROVAL_SPENT');
  });

  it('the same effect twice needs a second decision, and that decision is enough', () => {
    const guard = cleanGuard();
    const first = clear(checkToolCall(guard, freeCall(guard), REGISTRY, approved(guard, freeCall(guard)), NOW));
    const next = settled(first.guard);
    const second = approved(next, freeCall(guard), { ...OWNER, approvalId: 'approval-2' });
    expect(checkToolCall(next, freeCall(guard), REGISTRY, second, NOW).taintClear).toBe(true);
  });

  it('a call that clears without an approval spends nothing', () => {
    const guard = cleanGuard();
    expect(clear(checkToolCall(guard, callOn(guard), REGISTRY, null, NOW)).approvalSpent).toBe(null);
  });

  it('a refused call leaves the guard as it was, so the run can still ask', () => {
    const guard = cleanGuard();
    const approval = approved(guard);
    const refused = checkToolCall(guard, callOn(guard, { toolName: 'other_tool' }), REGISTRY, approval, NOW);
    expect(refused.taintClear).toBe(false);
    expect(refused.guard).toBe(guard);
    expect(checkToolCall(guard, callOn(guard), REGISTRY, approval, NOW).taintClear).toBe(true);
  });
});

describe('a replay across guards of one run', () => {
  const freeCall = (guard: RunGuard): ToolCall => callOn(guard, { toolName: FREE_TOOL });

  /** An approval spent on a tainted first attempt, so a generation can line up with a later guard. */
  function spentOnTaintedRun(): { readonly runId: string; readonly approval: ToolApproval } {
    const guard = recordOutsideContent(cleanGuard(), 'a web page');
    const approval = approved(guard, freeCall(guard));
    clear(checkToolCall(guard, freeCall(guard), REGISTRY, approval, NOW));
    return { runId: guard.runId, approval };
  }

  it('the same lineage continues: the taint count carries, so the old approval is stale', () => {
    const { runId, approval } = spentOnTaintedRun();
    const second = startRunGuard({ runId, lineageToken: TOKEN, ownerStarted: true, attempt: 2 });
    expect(refusedBy(checkToolCall(second, freeCall(second), REGISTRY, approval, NOW))).toBe('APPROVAL_NOT_FRESH');
  });

  it('a new lineage at the same generation: only the token refuses it, and its spent list is empty', () => {
    const { runId, approval } = spentOnTaintedRun();
    const second = startRunGuard({ runId, lineageToken: 'lineage-2', ownerStarted: true, attempt: 1 });
    expect(second.taintGeneration).toBe(approval.taintGeneration);
    expect(second.spentApprovals).toEqual([]);
    expect(refusedBy(checkToolCall(second, freeCall(second), REGISTRY, approval, NOW))).toBe('APPROVAL_LINEAGE_MISMATCH');
  });

  it('spent state belongs to the lineage: a reissued id stays spent on the next attempt', () => {
    const { runId, approval } = spentOnTaintedRun();
    const second = startRunGuard({ runId, lineageToken: TOKEN, ownerStarted: true, attempt: 2 });
    expect(second.spentApprovals).toEqual([approval.approvalId]);
    const again = approved(second, freeCall(second));
    expect(refusedBy(checkToolCall(second, freeCall(second), REGISTRY, again, NOW))).toBe('APPROVAL_SPENT');
  });

  it('an approval carries its lineage', () => {
    const guard = cleanGuard(newRun(), 'lineage-9');
    expect(approved(guard).lineageToken).toBe('lineage-9');
  });
});

describe('what no approval can do', () => {
  const PROHIBITED = registryFrom([{ id: 'read-other-tenant', governanceAction: null, ownerOnlyAction: null, class: 'P6', environment: 'local' }]);
  const p6 = (guard: RunGuard): ToolCall => callOn(guard, { toolName: 'read-other-tenant', args: {} });

  it('P6 is refused with an approval from the owner, and without one', () => {
    const guard = cleanGuard();
    expect(refusedBy(checkToolCall(guard, p6(guard), PROHIBITED, approved(guard, p6(guard)), NOW))).toBe('P6_PROHIBITED');
    expect(refusedBy(checkToolCall(guard, p6(guard), PROHIBITED, null, NOW))).toBe('P6_PROHIBITED');
  });

  it('a tainted P6 is refused the same way, and the same call on a registered P5 clears with an approval', () => {
    const guard = recordOutsideContent(cleanGuard(), 'a web page');
    expect(refusedBy(checkToolCall(guard, p6(guard), PROHIBITED, approved(guard, p6(guard)), NOW))).toBe('P6_PROHIBITED');
    const p5 = { ...p6(guard), toolName: 'approve' };
    expect(checkToolCall(guard, p5, PROHIBITED, approved(guard, p5), NOW).taintClear).toBe(true);
  });

  it('there is no approval mode to pass: the decision names a person, and nothing else', () => {
    expect(Object.keys(OWNER).sort()).toEqual(['approvalId', 'decidedAt', 'decidedBy', 'expiry']);
    const guard = cleanGuard();
    const widened = { ...OWNER, mode: 'never', skipApprovals: true, decidedBy: 'implementer' } as unknown as ToolApprovalDecision;
    expect(issueToolApproval(widened, callOn(guard), guard, NOW)).toMatchObject({ ok: false, rule: 'NOT_THE_OWNER' });
  });
});

describe('clearing taint is not permission', () => {
  function tenantBinding() {
    const parsed = parseTenantRegistry(json('tenant-registry.json'));
    if (!parsed.ok) throw new Error('the tenant registry does not parse');
    const resolved = resolveTenant(parsed.registry, { projectId: 'polygo', repository: 'github.com/polygonia-apres/polygo', root: 'C:/dev/Polygo/polygo', worktrees: null });
    if (!resolved.ok) throw new Error(resolved.reasons.join('; '));
    return resolved.binding;
  }

  it('a clean P5 clears here and is still refused by the door, with an approval in hand', () => {
    const guard = cleanGuard();
    const call = callOn(guard, { toolName: 'approve' });
    const effect = deriveToolEffect(call);
    if (!effect.ok) throw new Error('the control has no effect');
    expect(checkToolCall(guard, call, REGISTRY, approved(guard, call), NOW).taintClear).toBe(true);

    const minted = mintEnvelope(
      { binding: tenantBinding(), registry: REGISTRY, principal: 'owner', actor: { agent: 'a', provider: 'p', model: 'm' }, envelopeId: `ENV-${'0'.repeat(24)}` },
      { action: 'approve', subjectHash: effect.effect.argumentHash, scope: [], budget: 0, expiry: EXPIRY, intentScope: guard.runId },
    );
    expect(admitEnvelope(minted, NOW, () => true, () => false)).toMatchObject({ admitted: false, rule: 'P5_NO_GRANT' });
  });

  it('the result never says allowed or passed', () => {
    const guard = cleanGuard();
    const result = checkToolCall(guard, callOn(guard), REGISTRY, null, NOW);
    expect(Object.keys(result)).toContain('taintClear');
    expect(Object.keys(result)).not.toContain('passed');
    expect(Object.keys(result)).not.toContain('allowed');
  });
});

describe('the public barrel', () => {
  it.each(['startRunGuard', 'recordOutsideContent', 'recordToolResult', 'markToolCalled', 'issueToolApproval', 'recordCheckReceipt', 'declarePlanChecks'])(
    '%s is not on it: nothing outside the kernel mints',
    (name) => {
      expect(Object.keys(approvalsBarrel)).not.toContain(name);
    },
  );

  it('the checks are on it', () => {
    expect(Object.keys(approvalsBarrel)).toEqual(expect.arrayContaining(['checkToolCall', 'claimDone', 'deriveToolEffect']));
  });
});
