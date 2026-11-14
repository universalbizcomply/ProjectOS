import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseActionRegistry, type ActionRegistry } from '../src/actionRegistry.js';
import { admitRoutineRecord, type OwnerQueueEscalation, type RoutineRecord, type RunPorts } from '../src/routines/index.js';

const registryPath = fileURLToPath(new URL('../../security/action-registry.json', import.meta.url));

/** The committed action registry, parsed the way the kernel parses it. */
export function committedRegistry(): ActionRegistry {
  return registryWith({});
}

/** The committed registry with one action's entry changed, for a test that needs the registry to say something else. */
export function registryWith(change: Record<string, Record<string, unknown>>): ActionRegistry {
  const raw = JSON.parse(readFileSync(registryPath, 'utf8')) as { actions: Record<string, unknown>[] };
  const actions = raw.actions.map((entry) => ({ ...entry, ...(change[String(entry['id'])] ?? {}) }));
  const parsed = parseActionRegistry({ ...raw, actions });
  if (!parsed.ok) throw new Error('the action registry does not parse');
  return parsed.registry;
}

export const PLAN_DIGEST = `sha256:${'a'.repeat(64)}`;

/** A routine record as a file naming a plan decision would hold it. Each test changes the one field it is about. */
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

export interface FakePorts {
  readonly ports: RunPorts;
  readonly claimed: Set<string>;
  readonly open: Set<string>;
  readonly sent: OwnerQueueEscalation[];
}

/** Ports with a memory, the way the ledger will be: a claim answers true once, a routine opens once until released. */
export function fakePorts(now: number, over: Partial<RunPorts> = {}): FakePorts {
  const claimed = new Set<string>();
  const open = new Set<string>();
  const sent: OwnerQueueEscalation[] = [];
  const ports: RunPorts = {
    now: () => now,
    claim: (key) => (claimed.has(key) ? false : (claimed.add(key), true)),
    tryOpen: (routineId) => (open.has(routineId) ? false : (open.add(routineId), true)),
    release: (routineId) => {
      open.delete(routineId);
    },
    lastClaimed: () => null,
    spentSince: () => 0,
    escalate: (escalation) => {
      sent.push(escalation);
      return true;
    },
    ...over,
  };
  return { ports, claimed, open, sent };
}
