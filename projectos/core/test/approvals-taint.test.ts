/**
 * Taint: once outside content enters a run, an action it could steer needs a fresh approval.
 *
 * Every refusal here has an untainted control: the same call, on the same registry, clearing because no
 * outside content entered. Without that control the refusal could be a default, and prove nothing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseActionRegistry, type ActionRegistry } from '../src/actionRegistry.js';
import type { ToolCall } from '../src/approvals/effectKey.js';
import {
  actionCouldBeSteered,
  freshApprovalNeeded,
  isRunTainted,
  recordOutsideContent,
  recordToolResult,
  RunGuardRefused,
  startRunGuard,
  toolResultTaintsRun,
  type RunGuard,
} from '../src/approvals/taint.js';
import { checkToolCall, issueToolApproval, type ToolApproval, type ToolCheckResult } from '../src/approvals/toolApproval.js';

const NOW = '2026-11-01T12:00:00.000Z';
const EXPIRY = '2026-11-01T13:00:00.000Z';
const TOKEN = 'lineage-1';
const CONFINED = 'project-selection';
const OWN_STATE = [CONFINED] as const;

function registryFrom(extra: readonly Record<string, unknown>[] = []): ActionRegistry {
  const path = fileURLToPath(new URL('../../security/action-registry.json', import.meta.url));
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const parsed = parseActionRegistry({ ...raw, actions: [...(raw['actions'] as unknown[]), ...extra] });
  if (!parsed.ok) throw new Error(parsed.problems.map((problem) => problem.message).join('; '));
  return parsed.registry;
}

const REGISTRY = registryFrom();
const OUTBOUND_READ = registryFrom([{ id: 'connector-read', governanceAction: null, ownerOnlyAction: null, class: 'P1', environment: 'production' }]);

let runs = 0;
const newRun = (): string => `run-taint-${(runs += 1)}`;
const clean = (): RunGuard => startRunGuard({ runId: newRun(), lineageToken: TOKEN, ownerStarted: true, attempt: 1 });
const tainted = (): RunGuard => recordOutsideContent(clean(), 'a web page');
const call = (guard: RunGuard, toolName: string): ToolCall => ({ runId: guard.runId, toolName, args: { to: 'someone@example.invalid' } });

function approved(guard: RunGuard, toolCall: ToolCall, approvalId = 'approval-1'): ToolApproval {
  const issued = issueToolApproval({ approvalId, decidedBy: 'owner', decidedAt: NOW, expiry: EXPIRY }, toolCall, guard, NOW);
  if (!issued.ok) throw new Error(issued.reasons.join('; '));
  return issued.approval;
}

const refusedBy = (result: ToolCheckResult): string | null => (result.taintClear ? null : result.rule);

function ruleOf(write: () => unknown): string | null {
  try {
    write();
    return null;
  } catch (error) {
    return error instanceof RunGuardRefused ? error.rule : `threw: ${String(error)}`;
  }
}

describe('what taints a run', () => {
  it('an owner-started first attempt starts clean', () => {
    expect(isRunTainted(clean())).toBe(false);
  });

  it('a run the owner did not start begins tainted', () => {
    expect(isRunTainted(startRunGuard({ runId: newRun(), lineageToken: TOKEN, ownerStarted: false, attempt: 1 }))).toBe(true);
  });

  it('a later attempt begins tainted: it can restore outside content the first attempt read', () => {
    expect(isRunTainted(startRunGuard({ runId: newRun(), lineageToken: TOKEN, ownerStarted: true, attempt: 2 }))).toBe(true);
  });

  it.each([0, 1.5, Number.NaN])('an attempt number of %s is not a first attempt', (attempt) => {
    expect(isRunTainted(startRunGuard({ runId: newRun(), lineageToken: TOKEN, ownerStarted: true, attempt }))).toBe(true);
  });

  it.each([
    ['a blank run', { runId: ' ', lineageToken: TOKEN }],
    ['a blank lineage token', { runId: 'run-blank', lineageToken: '' }],
  ])('%s refuses loudly', (_label, start) => {
    expect(ruleOf(() => startRunGuard({ ...start, ownerStarted: true, attempt: 1 }))).toBe('BAD_RUN_START');
  });

  it('a tool result taints by default, and a new tool taints', () => {
    expect(toolResultTaintsRun(REGISTRY, 'web_fetch', OWN_STATE)).toBe(true);
    expect(toolResultTaintsRun(REGISTRY, 'some_future_tool', OWN_STATE)).toBe(true);
    expect(toolResultTaintsRun(REGISTRY, CONFINED, [])).toBe(true);
  });

  it('only a registered local read the kernel names as its own state does not', () => {
    expect(toolResultTaintsRun(REGISTRY, CONFINED, OWN_STATE)).toBe(false);
  });

  it('an unregistered name on the own-state list still taints', () => {
    expect(toolResultTaintsRun(REGISTRY, 'ask_owner', ['ask_owner'])).toBe(true);
  });

  it('a local write on the own-state list still taints', () => {
    expect(toolResultTaintsRun(REGISTRY, 'commit', ['commit'])).toBe(true);
  });

  it('a read that leaves the machine on the own-state list still taints', () => {
    expect(toolResultTaintsRun(OUTBOUND_READ, 'connector-read', ['connector-read'])).toBe(true);
  });

  it('a near miss of an own-state tool taints: the match is exact', () => {
    expect(toolResultTaintsRun(REGISTRY, 'Project-Selection', ['project-selection'])).toBe(true);
    expect(toolResultTaintsRun(REGISTRY, 'project-selection ', ['project-selection'])).toBe(true);
    expect(toolResultTaintsRun(REGISTRY, CONFINED, ['project-selection '])).toBe(true);
  });

  it('a tainting result moves the run and an own-state result does not taint it', () => {
    expect(recordToolResult(clean(), CONFINED, REGISTRY, OWN_STATE).taintGeneration).toBe(0);
    expect(isRunTainted(recordToolResult(clean(), 'web_fetch', REGISTRY, OWN_STATE))).toBe(true);
  });

  it('the record says where the taint came from', () => {
    const guard = recordToolResult(clean(), 'web_fetch', REGISTRY, OWN_STATE);
    expect(guard.taintGeneration).toBe(1);
    expect(guard.taintSources).toEqual(['tool result: web_fetch']);
  });

  it('a guard is frozen, and moving one builds a new one', () => {
    const guard = clean();
    const next = recordOutsideContent(guard, 'a file');
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.taintSources)).toBe(true);
    expect(guard.taintGeneration).toBe(0);
  });
});

describe('taint never comes off', () => {
  it('a clean state kept from before the content is dead: nobody can go back to it', () => {
    const before = clean();
    const after = recordOutsideContent(before, 'a web page');
    expect(refusedBy(checkToolCall(before, call(before, 'commit'), REGISTRY, null, NOW))).toBe('RUN_STATE_NOT_LIVE');
    expect(refusedBy(checkToolCall(after, call(after, 'commit'), REGISTRY, null, NOW))).toBe('FRESH_APPROVAL_REQUIRED');
  });

  it('a dead state reads as tainted', () => {
    const before = clean();
    recordOutsideContent(before, 'a web page');
    expect(isRunTainted(before)).toBe(true);
  });

  it('a state nobody issued is not a clean state', () => {
    const forged = { runId: 'run-forged', lineageToken: TOKEN, taintGeneration: 0, taintSources: [], spentApprovals: [], pendingResult: null };
    expect(isRunTainted(forged)).toBe(true);
    expect(refusedBy(checkToolCall(forged, call(forged, 'commit'), REGISTRY, null, NOW))).toBe('RUN_STATE_NOT_LIVE');
  });

  it('no write turns a forged state into a live one', () => {
    const forged = { ...clean() };
    expect(ruleOf(() => recordOutsideContent(forged, 'a web page'))).toBe('DEAD_GUARD');
    expect(refusedBy(checkToolCall(forged, call(forged, 'commit'), REGISTRY, null, NOW))).toBe('RUN_STATE_NOT_LIVE');
  });

  it('a state for a run nobody started cannot be written to, and starts no lineage', () => {
    const forged = { runId: 'run-never', lineageToken: TOKEN, taintGeneration: 0, taintSources: [], spentApprovals: [], pendingResult: null };
    expect(ruleOf(() => recordOutsideContent(forged, 'a web page'))).toBe('DEAD_GUARD');
    expect(isRunTainted(startRunGuard({ runId: 'run-never', lineageToken: TOKEN, ownerStarted: true, attempt: 1 }))).toBe(false);
  });

  it('a perfect copy of a live clean state is refused, and the original clears', () => {
    const guard = clean();
    expect(refusedBy(checkToolCall({ ...guard }, call(guard, 'commit'), REGISTRY, null, NOW))).toBe('RUN_STATE_NOT_LIVE');
    expect(checkToolCall(guard, call(guard, 'commit'), REGISTRY, null, NOW).taintClear).toBe(true);
  });

  it('another run\'s clean state does not speak for this run', () => {
    const other = clean();
    const here = clean();
    expect(refusedBy(checkToolCall(other, call(here, 'commit'), REGISTRY, null, NOW))).toBe('RUN_MISMATCH');
  });
});

describe('a second guard for one run', () => {
  const again = (guard: RunGuard, lineageToken = TOKEN): RunGuard => startRunGuard({ runId: guard.runId, lineageToken, ownerStarted: true, attempt: 1 });

  it('does not start clean, with the same lineage token or a new one', () => {
    expect(isRunTainted(again(clean()))).toBe(true);
    expect(isRunTainted(again(clean(), 'lineage-2'))).toBe(true);
  });

  it('refuses a steerable action on the second guard, and the first guard is dead', () => {
    const first = clean();
    const second = again(first);
    expect(refusedBy(checkToolCall(second, call(second, 'commit'), REGISTRY, null, NOW))).toBe('FRESH_APPROVAL_REQUIRED');
    expect(refusedBy(checkToolCall(first, call(first, 'commit'), REGISTRY, null, NOW))).toBe('RUN_STATE_NOT_LIVE');
  });

  it('carries the taint count on the same lineage', () => {
    const first = recordOutsideContent(recordOutsideContent(clean(), 'one'), 'two');
    expect(again(first).taintGeneration).toBe(3);
  });

  it('another run is untouched: the control', () => {
    again(clean());
    expect(isRunTainted(clean())).toBe(false);
  });
});

describe('a result is never lost', () => {
  it('a result recorded on a retired guard refuses loudly', () => {
    const first = clean();
    recordOutsideContent(first, 'a web page');
    expect(ruleOf(() => recordToolResult(first, 'web_fetch', REGISTRY, OWN_STATE))).toBe('DEAD_GUARD');
  });

  it('and its taint is counted on the lineage all the same', () => {
    const first = clean();
    const live = recordOutsideContent(first, 'a web page');
    expect(ruleOf(() => recordOutsideContent(first, 'a late result'))).toBe('DEAD_GUARD');
    const resumed = startRunGuard({ runId: live.runId, lineageToken: TOKEN, ownerStarted: true, attempt: 1 });
    expect(resumed.taintGeneration).toBe(3);
    expect(resumed.taintSources).toEqual(['a web page', 'a late result', 'a second guard for a run already started']);
  });

  it('even an own-state result on a dead handle counts: a dead handle cannot vouch for anything', () => {
    const first = clean();
    const live = recordOutsideContent(first, 'a web page');
    expect(ruleOf(() => recordToolResult(first, CONFINED, REGISTRY, OWN_STATE))).toBe('DEAD_GUARD');
    expect(startRunGuard({ runId: live.runId, lineageToken: TOKEN, ownerStarted: true, attempt: 1 }).taintGeneration).toBe(3);
  });

  it('the guard a late write killed cannot be used afterwards', () => {
    const first = clean();
    const live = recordOutsideContent(first, 'a web page');
    expect(ruleOf(() => recordOutsideContent(first, 'late'))).toBe('DEAD_GUARD');
    expect(refusedBy(checkToolCall(live, call(live, CONFINED), REGISTRY, null, NOW))).toBe('RUN_STATE_NOT_LIVE');
  });

  it('after a cleared call, the next check refuses until the result is recorded', () => {
    const guard = clean();
    const first = checkToolCall(guard, call(guard, CONFINED), REGISTRY, null, NOW);
    if (!first.taintClear) throw new Error('the control was refused');
    expect(first.guard.pendingResult).toBe(CONFINED);
    expect(refusedBy(checkToolCall(first.guard, call(guard, CONFINED), REGISTRY, null, NOW))).toBe('RESULT_PENDING');
    const settled = recordToolResult(first.guard, CONFINED, REGISTRY, OWN_STATE);
    expect(settled.pendingResult).toBe(null);
    expect(checkToolCall(settled, call(guard, CONFINED), REGISTRY, null, NOW).taintClear).toBe(true);
  });

  it('a missed result cannot be stepped over with the earlier guard: that guard is dead', () => {
    const guard = clean();
    expect(checkToolCall(guard, call(guard, CONFINED), REGISTRY, null, NOW).taintClear).toBe(true);
    expect(refusedBy(checkToolCall(guard, call(guard, CONFINED), REGISTRY, null, NOW))).toBe('RUN_STATE_NOT_LIVE');
  });

  it('an approval cannot be issued while a result is pending, because the content may change the decision', () => {
    const guard = clean();
    const first = checkToolCall(guard, call(guard, CONFINED), REGISTRY, null, NOW);
    if (!first.taintClear) throw new Error('the control was refused');
    const issued = issueToolApproval({ approvalId: 'approval-1', decidedBy: 'owner', decidedAt: NOW, expiry: EXPIRY }, call(guard, 'commit'), first.guard, NOW);
    expect(issued).toMatchObject({ ok: false, rule: 'RESULT_PENDING' });
  });

  it('a different tool\'s result refuses loudly, and counts', () => {
    const guard = clean();
    const first = checkToolCall(guard, call(guard, CONFINED), REGISTRY, null, NOW);
    if (!first.taintClear) throw new Error('the control was refused');
    expect(ruleOf(() => recordToolResult(first.guard, 'web_fetch', REGISTRY, OWN_STATE))).toBe('WRONG_RESULT');
    const resumed = startRunGuard({ runId: guard.runId, lineageToken: TOKEN, ownerStarted: true, attempt: 1 });
    expect(resumed.taintSources).toContain('tool result: web_fetch');
  });

  it('a new attempt clears what is pending, because it begins tainted', () => {
    const guard = clean();
    const first = checkToolCall(guard, call(guard, CONFINED), REGISTRY, null, NOW);
    if (!first.taintClear) throw new Error('the control was refused');
    const resumed = startRunGuard({ runId: guard.runId, lineageToken: TOKEN, ownerStarted: true, attempt: 2 });
    expect(resumed.pendingResult).toBe(null);
    expect(isRunTainted(resumed)).toBe(true);
  });
});

describe('an action the content could steer needs a fresh approval', () => {
  it.each(['commit', 'push', 'implement', 'approve', 'a-tool-nobody-registered'])('%s: refused once tainted, clears on the same run untainted', (toolName) => {
    const dirty = tainted();
    expect(refusedBy(checkToolCall(dirty, call(dirty, toolName), REGISTRY, null, NOW))).toBe('FRESH_APPROVAL_REQUIRED');
    const fine = clean();
    expect(checkToolCall(fine, call(fine, toolName), REGISTRY, null, NOW).taintClear).toBe(true);
  });

  it('an approval given after the content clears', () => {
    const guard = tainted();
    expect(checkToolCall(guard, call(guard, 'commit'), REGISTRY, approved(guard, call(guard, 'commit')), NOW).taintClear).toBe(true);
  });

  it('an approval given before the content is not fresh, and the same approval clears untainted', () => {
    const before = clean();
    const approval = approved(before, call(before, 'commit'));
    const after = recordOutsideContent(before, 'a web page');
    expect(refusedBy(checkToolCall(after, call(after, 'commit'), REGISTRY, approval, NOW))).toBe('APPROVAL_NOT_FRESH');

    const untainted = clean();
    expect(checkToolCall(untainted, call(untainted, 'commit'), REGISTRY, approved(untainted, call(untainted, 'commit')), NOW).taintClear).toBe(true);
  });

  it('more content after a fresh approval makes it stale again', () => {
    const first = tainted();
    const approval = approved(first, call(first, 'commit'));
    const second = recordOutsideContent(first, 'a second page');
    expect(refusedBy(checkToolCall(second, call(second, 'commit'), REGISTRY, approval, NOW))).toBe('APPROVAL_NOT_FRESH');
  });

  it('a fresh approval is for the exact call: another tool on the tainted run is refused', () => {
    const guard = tainted();
    expect(refusedBy(checkToolCall(guard, call(guard, 'push'), REGISTRY, approved(guard, call(guard, 'commit')), NOW))).toBe('APPROVAL_EFFECT_MISMATCH');
  });

  it('spending an approval on a tainted run does not clear the taint', () => {
    const guard = tainted();
    const first = checkToolCall(guard, call(guard, CONFINED), REGISTRY, approved(guard, call(guard, CONFINED)), NOW);
    if (!first.taintClear) throw new Error('the control was refused');
    const settled = recordToolResult(first.guard, CONFINED, REGISTRY, OWN_STATE);
    expect(isRunTainted(settled)).toBe(true);
    expect(refusedBy(checkToolCall(settled, call(guard, 'commit'), REGISTRY, null, NOW))).toBe('FRESH_APPROVAL_REQUIRED');
  });
});

describe('what it could not steer', () => {
  it('a read confined to this machine stays free on a tainted run', () => {
    expect(actionCouldBeSteered(REGISTRY, CONFINED)).toBe(false);
    const guard = tainted();
    expect(checkToolCall(guard, call(guard, CONFINED), REGISTRY, null, NOW).taintClear).toBe(true);
  });

  it.each(['bridge-read', 'run_validators', 'perform_review', 'architect_phase', 'recommend_closure'])(
    '%s is P1 local in the registry and can carry content off the machine, so it needs a fresh approval',
    (toolName) => {
      expect(actionCouldBeSteered(REGISTRY, toolName)).toBe(true);
      const dirty = tainted();
      expect(refusedBy(checkToolCall(dirty, call(dirty, toolName), REGISTRY, null, NOW))).toBe('FRESH_APPROVAL_REQUIRED');
      const fine = clean();
      expect(checkToolCall(fine, call(fine, toolName), REGISTRY, null, NOW).taintClear).toBe(true);
    },
  );

  it('a read that leaves the machine carries arguments the content could choose', () => {
    expect(actionCouldBeSteered(OUTBOUND_READ, 'connector-read')).toBe(true);
    const dirty = tainted();
    expect(refusedBy(checkToolCall(dirty, call(dirty, 'connector-read'), OUTBOUND_READ, null, NOW))).toBe('FRESH_APPROVAL_REQUIRED');
    const fine = clean();
    expect(checkToolCall(fine, call(fine, 'connector-read'), OUTBOUND_READ, null, NOW).taintClear).toBe(true);
  });

  it('an unregistered action could be steered, because R5 makes it P5', () => {
    expect(actionCouldBeSteered(REGISTRY, 'web_fetch')).toBe(true);
  });

  it('a registry that was not parsed classifies nothing as safe', () => {
    expect(actionCouldBeSteered({ actions: [] }, CONFINED)).toBe(true);
  });

  it('the answer comes from the registry: a caller has no way to say a tool is safe', () => {
    expect(freshApprovalNeeded(tainted(), REGISTRY, 'commit')).toBe(true);
    expect(freshApprovalNeeded(tainted(), REGISTRY, CONFINED)).toBe(false);
    expect(freshApprovalNeeded(clean(), REGISTRY, 'commit')).toBe(false);
  });
});
