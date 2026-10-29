/**
 * A fake independent reviewer for loop tests (D11, PROJECTOS-KERNEL-ROLE-REVIEW1A).
 *
 * The reviewer is a SECOND authorised worker. Fixtures that only need a run to get past
 * REVIEW_OUTSTANDING configure it with the same fake kind as the implementer and spread
 * `reviewing()` into their adapter, so the registry stays one entry. It answers with the nonce the
 * loop put in the instruction, the way a real reviewer must, and performs exactly what it was asked.
 */
import type { WorkerOutcome } from '../../src/loop/workers.js';

export const REVIEWER_ID = 'independent-reviewer';

/** The reviewer as an `execution.workers` entry, plus the field that names it. */
export function withReviewer<T extends { workers: readonly Record<string, unknown>[] }>(execution: T, kind: string) {
  return {
    ...execution,
    workers: [...execution.workers, { workerId: REVIEWER_ID, kind, command: '/usr/local/bin/test-reviewer' }],
    reviewerWorkerId: REVIEWER_ID,
  };
}

/** The reviews the loop asked for, read back out of its fixed instruction. */
export function requestedReviews(instruction: string): string[] {
  const m = /Perform these reviews the approved plan requires: (\[.*?\])\. /.exec(instruction);
  return m?.[1] === undefined ? [] : (JSON.parse(m[1]) as string[]);
}

export function nonceOf(instruction: string): string {
  return /PROJECTOS-REVIEW ([0-9a-f]+) /.exec(instruction)?.[1] ?? 'missing';
}

/** A reviewer reply in the CLI's structured shape. */
export function reviewerReply(instruction: string, verdict = 'APPROVE', findings: readonly object[] = []): WorkerOutcome {
  const body = JSON.stringify({ verdict, reviews: requestedReviews(instruction), findings });
  return {
    kind: 'completed',
    exitCode: 0,
    stdout: JSON.stringify({ result: `Reviewed.\nPROJECTOS-REVIEW ${nonceOf(instruction)} ${body}`, num_turns: 5, permission_denials: [] }),
    stderr: '',
    providerRef: null,
  };
}

/** The `review` method to spread into a fake adapter. */
export function reviewing(verdict = 'APPROVE') {
  return {
    review: (_sys: unknown, _worker: unknown, _brief: unknown, instruction: string): WorkerOutcome =>
      reviewerReply(instruction, verdict),
  };
}
