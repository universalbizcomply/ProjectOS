/**
 * Taint: once outside content enters a run, an action it could steer needs a fresh approval.
 *
 * Every refusal here has an untainted control: the same call, on the same registry, passing because no
 * outside content entered. Without that control the refusal could be a default, and prove nothing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseActionRegistry, type ActionRegistry } from '../src/actionRegistry.js';
import {
  actionCouldBeSteered,
  checkToolCall,
  freshApprovalNeeded,
  isRunTainted,
  issueToolApproval,
  recordOutsideContent,
  recordToolResult,
  spendApproval,
  startRunGuard,
  toolResultTaintsRun,
  type RunGuard,
  type ToolApproval,
  type ToolCall,
  type ToolCheckResult,
} from '../src/approvals/index.js';

const NOW = '2026-11-01T12:00:00.000Z';
const EXPIRY = '2026-11-01T13:00:00.000Z';
const RUN = 'run-taint';
const OWN_STATE = ['ask_owner'] as const;

function registryFrom(extra: readonly Record<string, unknown>[] = []): ActionRegistry {
  const path = fileURLToPath(new URL('../../security/action-registry.json', import.meta.url));
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const parsed = parseActionRegistry({ ...raw, actions: [...(raw['actions'] as unknown[]), ...extra] });
  if (!parsed.ok) throw new Error(parsed.problems.map((problem) => problem.message).join('; '));
  return parsed.registry;
}

const REGISTRY = registryFrom();
const OUTBOUND_READ = registryFrom([{ id: 'connector-read', governanceAction: null, ownerOnlyAction: null, class: 'P1', environment: 'production' }]);

const clean = (): RunGuard => startRunGuard({ runId: RUN, ownerStarted: true, attempt: 1 });
const tainted = (): RunGuard => recordOutsideContent(clean(), 'a web page');
const call = (toolName: string): ToolCall => ({ runId: RUN, toolName, args: { to: 'someone@example.invalid' } });

function approved(guard: RunGuard, toolCall: ToolCall, approvalId = 'approval-1'): ToolApproval {
  const issued = issueToolApproval({ approvalId, decidedBy: 'owner', decidedAt: NOW, expiry: EXPIRY }, toolCall, guard);
  if (!issued.ok) throw new Error(issued.reasons.join('; '));
  return issued.approval;
}

const refusedBy = (result: ToolCheckResult): string | null => (result.passed ? null : result.rule);

describe('what taints a run', () => {
  it('an owner-started first attempt starts clean', () => {
    expect(isRunTainted(clean())).toBe(false);
  });

  it('a run the owner did not start begins tainted', () => {
    expect(isRunTainted(startRunGuard({ runId: RUN, ownerStarted: false, attempt: 1 }))).toBe(true);
  });

  it('a later attempt begins tainted: it can restore outside content the first attempt read', () => {
    expect(isRunTainted(startRunGuard({ runId: RUN, ownerStarted: true, attempt: 2 }))).toBe(true);
  });

  it.each([0, 1.5, Number.NaN])('an attempt number of %s is not a first attempt', (attempt) => {
    expect(isRunTainted(startRunGuard({ runId: RUN, ownerStarted: true, attempt }))).toBe(true);
  });

  it('a tool result taints by default, and a new tool taints', () => {
    expect(toolResultTaintsRun('web_fetch', OWN_STATE)).toBe(true);
    expect(toolResultTaintsRun('some_future_tool', OWN_STATE)).toBe(true);
    expect(toolResultTaintsRun('some_future_tool', [])).toBe(true);
  });

  it('only a tool the kernel names as its own state does not', () => {
    expect(toolResultTaintsRun('ask_owner', OWN_STATE)).toBe(false);
    expect(toolResultTaintsRun('ask_owner', [])).toBe(true);
  });

  it('a near miss of an own-state tool taints: the match is exact', () => {
    expect(toolResultTaintsRun('Ask_Owner', OWN_STATE)).toBe(true);
    expect(toolResultTaintsRun('ask_owner ', OWN_STATE)).toBe(true);
  });

  it('a tainting result moves the run and an own-state result leaves it alone', () => {
    const guard = clean();
    expect(recordToolResult(guard, 'ask_owner', OWN_STATE)).toBe(guard);
    expect(isRunTainted(recordToolResult(guard, 'web_fetch', OWN_STATE))).toBe(true);
  });

  it('the record says where the taint came from', () => {
    const guard = recordToolResult(clean(), 'web_fetch', OWN_STATE);
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
    expect(refusedBy(checkToolCall(before, call('commit'), REGISTRY, null, NOW))).toBe('RUN_STATE_NOT_LIVE');
    expect(refusedBy(checkToolCall(after, call('commit'), REGISTRY, null, NOW))).toBe('FRESH_APPROVAL_REQUIRED');
  });

  it('a dead state reads as tainted and cannot be moved on into a live one', () => {
    const before = clean();
    recordOutsideContent(before, 'a web page');
    expect(isRunTainted(before)).toBe(true);
    const moved = recordOutsideContent(before, 'another page');
    expect(moved).toBe(before);
    expect(refusedBy(checkToolCall(moved, call('commit'), REGISTRY, null, NOW))).toBe('RUN_STATE_NOT_LIVE');
  });

  it('a state nobody issued is not a clean state', () => {
    const forged = { runId: RUN, taintGeneration: 0, taintSources: [], spentApprovals: [] };
    expect(isRunTainted(forged)).toBe(true);
    expect(refusedBy(checkToolCall(forged, call('commit'), REGISTRY, null, NOW))).toBe('RUN_STATE_NOT_LIVE');
  });

  it('no move turns a forged state into a live one', () => {
    const forged = { ...clean() };
    expect(spendApproval(forged, 'approval-1')).toBe(forged);
    expect(recordOutsideContent(forged, 'a web page')).toBe(forged);
    expect(refusedBy(checkToolCall(spendApproval(forged, 'approval-1'), call('commit'), REGISTRY, null, NOW))).toBe('RUN_STATE_NOT_LIVE');
  });

  it('a perfect copy of a live clean state is refused, and the original passes', () => {
    const guard = clean();
    expect(refusedBy(checkToolCall({ ...guard }, call('commit'), REGISTRY, null, NOW))).toBe('RUN_STATE_NOT_LIVE');
    expect(checkToolCall(guard, call('commit'), REGISTRY, null, NOW).passed).toBe(true);
  });

  it('another run\'s clean state does not speak for this run', () => {
    const other = startRunGuard({ runId: 'run-clean', ownerStarted: true, attempt: 1 });
    expect(refusedBy(checkToolCall(other, call('commit'), REGISTRY, null, NOW))).toBe('RUN_MISMATCH');
  });
});

describe('an action the content could steer needs a fresh approval', () => {
  it.each(['commit', 'push', 'implement', 'approve', 'a-tool-nobody-registered'])('%s: refused once tainted, passes on the same run untainted', (toolName) => {
    expect(refusedBy(checkToolCall(tainted(), call(toolName), REGISTRY, null, NOW))).toBe('FRESH_APPROVAL_REQUIRED');
    expect(checkToolCall(clean(), call(toolName), REGISTRY, null, NOW).passed).toBe(true);
  });

  it('an approval given after the content passes', () => {
    const guard = tainted();
    expect(checkToolCall(guard, call('commit'), REGISTRY, approved(guard, call('commit')), NOW).passed).toBe(true);
  });

  it('an approval given before the content is not fresh, and the same approval passes untainted', () => {
    const before = clean();
    const approval = approved(before, call('commit'));
    const after = recordOutsideContent(before, 'a web page');
    expect(refusedBy(checkToolCall(after, call('commit'), REGISTRY, approval, NOW))).toBe('APPROVAL_NOT_FRESH');

    const untainted = clean();
    expect(checkToolCall(untainted, call('commit'), REGISTRY, approved(untainted, call('commit')), NOW).passed).toBe(true);
  });

  it('more content after a fresh approval makes it stale again', () => {
    const first = tainted();
    const approval = approved(first, call('commit'));
    const second = recordOutsideContent(first, 'a second page');
    expect(refusedBy(checkToolCall(second, call('commit'), REGISTRY, approval, NOW))).toBe('APPROVAL_NOT_FRESH');
  });

  it('a fresh approval is for the exact call: another tool on the tainted run is refused', () => {
    const guard = tainted();
    expect(refusedBy(checkToolCall(guard, call('push'), REGISTRY, approved(guard, call('commit')), NOW))).toBe('APPROVAL_EFFECT_MISMATCH');
  });

  it('spending an approval on a tainted run does not clear the taint', () => {
    const guard = tainted();
    const first = checkToolCall(guard, call('commit'), REGISTRY, approved(guard, call('commit')), NOW);
    if (!first.passed) throw new Error('the control did not pass');
    expect(isRunTainted(first.guard)).toBe(true);
    expect(refusedBy(checkToolCall(first.guard, call('commit'), REGISTRY, null, NOW))).toBe('FRESH_APPROVAL_REQUIRED');
  });
});

describe('what it could not steer', () => {
  it('a registered local read stays free on a tainted run', () => {
    expect(actionCouldBeSteered(REGISTRY, 'run_validators')).toBe(false);
    expect(checkToolCall(tainted(), call('run_validators'), REGISTRY, null, NOW).passed).toBe(true);
  });

  it('a read that leaves the machine carries arguments the content could choose', () => {
    expect(actionCouldBeSteered(OUTBOUND_READ, 'connector-read')).toBe(true);
    expect(refusedBy(checkToolCall(tainted(), call('connector-read'), OUTBOUND_READ, null, NOW))).toBe('FRESH_APPROVAL_REQUIRED');
    expect(checkToolCall(clean(), call('connector-read'), OUTBOUND_READ, null, NOW).passed).toBe(true);
  });

  it('an unregistered action could be steered, because R5 makes it P5', () => {
    expect(actionCouldBeSteered(REGISTRY, 'web_fetch')).toBe(true);
  });

  it('a registry that was not parsed classifies nothing as safe', () => {
    expect(actionCouldBeSteered({ actions: [] }, 'run_validators')).toBe(true);
  });

  it('the answer comes from the registry: a caller has no way to say a tool is safe', () => {
    expect(freshApprovalNeeded(tainted(), REGISTRY, 'commit')).toBe(true);
    expect(freshApprovalNeeded(tainted(), REGISTRY, 'run_validators')).toBe(false);
    expect(freshApprovalNeeded(clean(), REGISTRY, 'commit')).toBe(false);
  });
});
