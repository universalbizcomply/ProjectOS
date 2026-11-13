import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseActionRegistry, type ActionRegistry } from '../src/actionRegistry.js';
import { admitRoutineRecord, type RoutineRecord } from '../src/routines/index.js';

const registryPath = fileURLToPath(new URL('../../security/action-registry.json', import.meta.url));

/** The committed action registry, parsed the way the kernel parses it. */
export function committedRegistry(): ActionRegistry {
  const parsed = parseActionRegistry(JSON.parse(readFileSync(registryPath, 'utf8')) as unknown);
  if (!parsed.ok) throw new Error('the committed action registry does not parse');
  return parsed.registry;
}

export const PLAN_DIGEST = `sha256:${'a'.repeat(64)}`;

/** A routine record as a plan-approved file would hold it. Each test changes the one field it is about. */
export function rawRecord(change: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordId: 'RTN-weekday-summary-v1',
    routineId: 'weekday-summary',
    tenant: 'tenant-a',
    project: 'project-a',
    cron: '0 9 * * 1-5',
    timezone: 'UTC',
    prompt: "Summarise yesterday's closed phases for the owner.",
    runBudgetCents: 25,
    approval: { decisionId: 'PLANDEC-0123456789abcdef', decidedBy: 'owner', planDigest: PLAN_DIGEST },
    ...change,
  };
}

/** A record the reader admitted. A test that cannot get one has found a bug, so it throws. */
export function admitted(change: Record<string, unknown> = {}): RoutineRecord {
  const result = admitRoutineRecord(rawRecord(change));
  if (!result.ok) throw new Error(`the control record was refused: ${result.refusals.map((r) => r.code).join(', ')}`);
  return result.record;
}

export const at = (iso: string): number => Date.parse(iso);
