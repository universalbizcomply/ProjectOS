/**
 * Approval store: persist core ApprovalRequest objects as JSON under
 * .projectops/approvals/<id>.json. Same pattern as phaseStore — plain data round-trip
 * through the System adapter.
 */
import type { System } from './system.js';
import { join, projectopsDir } from './context.js';
import type { ApprovalRequest } from '@projectos/core';

export function approvalsDir(root: string): string {
  return join(projectopsDir(root), 'approvals');
}

export function approvalPath(root: string, id: string): string {
  return join(approvalsDir(root), `${id}.json`);
}

export function loadApproval(sys: System, root: string, id: string): ApprovalRequest | null {
  const text = sys.readText(approvalPath(root, id));
  if (text === null) return null;
  try {
    return JSON.parse(text) as ApprovalRequest;
  } catch {
    return null;
  }
}

export function saveApproval(sys: System, root: string, approval: ApprovalRequest): void {
  sys.writeText(approvalPath(root, approval.id), JSON.stringify(approval, null, 2) + '\n');
}

export function listApprovalIds(sys: System, root: string): readonly string[] {
  return sys
    .listDir(approvalsDir(root))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}
