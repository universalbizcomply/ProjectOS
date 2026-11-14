import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseActionRegistry, type ActionRegistry } from '../src/actionRegistry.js';
import {
  addAgent,
  admitAgentRecord,
  emptyAgentBook,
  emptyDelegationBook,
  registerRoot,
  type AgentBook,
  type AgentRecord,
  type DelegationBook,
  type DelegationContext,
} from '../src/agents/index.js';
import { admitEnvelope, mintEnvelope, type EnvelopeRequest, type KernelEnvelopeContext, type TaskEnvelope } from '../src/taskEnvelope.js';
import { parseTenantRegistry, resolveTenant, type TenantBinding } from '../src/tenant.js';

const securityPath = (name: string): string => fileURLToPath(new URL(`../../security/${name}`, import.meta.url));
const json = (name: string): unknown => JSON.parse(readFileSync(securityPath(name), 'utf8'));

/** The committed action registry, parsed the way the kernel parses it. */
export function committedRegistry(): ActionRegistry {
  const parsed = parseActionRegistry(json('action-registry.json'));
  if (!parsed.ok) throw new Error('the committed action registry does not parse');
  return parsed.registry;
}

function bindingOf(projectId: string, repository: string, root: string): TenantBinding {
  const parsed = parseTenantRegistry(json('tenant-registry.json'));
  if (!parsed.ok) throw new Error('the committed tenant registry does not parse');
  const resolved = resolveTenant(parsed.registry, { projectId, repository, root, worktrees: null });
  if (!resolved.ok) throw new Error(resolved.reasons.join('; '));
  return resolved.binding;
}

/** tenant `owner-personal`, project `polygo`. */
export const polygo = (): TenantBinding => bindingOf('polygo', 'github.com/polygonia-apres/polygo', 'C:/dev/Polygo/polygo');
/** tenant `owner-personal`, project `projectos`: the same tenant as `polygo`, another project. */
export const projectos = (): TenantBinding => bindingOf('projectos', 'github.com/universalbizcomply/ProjectOS', 'C:/dev/ProjectOS');
/** tenant `agency-business`, domain `business`. */
export const agency = (): TenantBinding => bindingOf('seo-agency', '127.0.0.1:47900/SEOAgency-remote/seo-agency', 'C:/dev/SEOAgency');

export const PLAN_DIGEST = `sha256:${'a'.repeat(64)}`;
export const NOW = Date.parse('2026-11-14T12:00:00.000Z');
export const LATER = '2026-11-14T18:00:00.000Z';
export const MINUTE = 60_000;
export const clockAt = (ms: number) => () => ms;

/** An agent record as a file naming a plan review would hold it. It has no tenant, project or domain: those are derived. */
export function rawAgent(change: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordId: 'AGT-worker-v1',
    agentId: 'worker',
    grants: ['read-repository', 'search-repository'],
    mayDelegate: false,
    messageAllow: [],
    planReview: { decisionId: 'PLANDEC-0123456789abcdef', decidedBy: 'owner', planDigest: PLAN_DIGEST },
    ...change,
  };
}

/** A record the reader admitted. A test that cannot get one has found a bug, so it throws. */
export function agentOf(binding: TenantBinding, change: Record<string, unknown> = {}): AgentRecord {
  const result = admitAgentRecord(rawAgent(change), binding);
  if (!result.ok) throw new Error(`the control agent was refused: ${result.refusals.map((r) => r.code).join(', ')}`);
  return result.record;
}

/** A book holding one admitted agent per spec, all in `binding`'s scope. */
export function bookOf(binding: TenantBinding, specs: readonly Record<string, unknown>[], book: AgentBook = emptyAgentBook()): AgentBook {
  return specs.reduce<AgentBook>((held, change) => {
    const added = addAgent(held, agentOf(binding, change));
    if (!added.ok) throw new Error(`the control book was refused: ${added.code}`);
    return added.book;
  }, book);
}

const envelopeId = (digit: string): string => `ENV-${digit.repeat(24)}`;
let counter = 0;
/** A fresh envelope id, 24 hex digits. */
export function nextEnvelopeId(): string {
  counter += 1;
  return `ENV-${counter.toString(16).padStart(24, '0')}`;
}

export function kernelContext(binding: TenantBinding, id: string = envelopeId('1')): KernelEnvelopeContext {
  return {
    binding,
    registry: committedRegistry(),
    principal: 'implementer',
    actor: { agent: 'claude-code-cli', provider: 'anthropic', model: 'claude-opus-5-5' },
    envelopeId: id,
  };
}

export interface EnvelopeChange {
  readonly action?: string;
  readonly budget?: number;
  readonly scope?: readonly string[];
  readonly expiry?: string;
  readonly intentScope?: string;
}

/** An admitted root envelope, the way the kernel mints one and the door admits it. */
export function rootEnvelope(binding: TenantBinding, change: EnvelopeChange = {}): TaskEnvelope {
  const request: EnvelopeRequest = {
    action: change.action ?? 'implement',
    subjectHash: 'a'.repeat(40),
    scope: change.scope ?? ['projectos/core/src/', 'docs/'],
    budget: change.budget ?? 1000,
    expiry: change.expiry ?? LATER,
    intentScope: change.intentScope ?? `RUN-${nextEnvelopeId()}`,
  };
  const minted = mintEnvelope(kernelContext(binding, nextEnvelopeId()), request);
  const admission = admitEnvelope(minted, '2026-11-14T12:00:00.000Z', () => true, () => true);
  if (!admission.admitted) throw new Error(`the control envelope was refused: ${admission.reasons.join('; ')}`);
  return admission.envelope;
}

/** A child envelope of `parent`, written as the kernel would, with whatever the test changes. */
export function childEnvelope(parent: TaskEnvelope, change: Partial<Record<keyof TaskEnvelope, unknown>> = {}): TaskEnvelope {
  return {
    ...parent,
    envelopeId: nextEnvelopeId(),
    parentEnvelopeId: parent.envelopeId,
    action: 'run_validators',
    actionClass: 'P1',
    budget: 100,
    idempotencyKey: `sha256:${'b'.repeat(64)}`,
    ...change,
  } as TaskEnvelope;
}

export function contextOf(binding: TenantBinding, agents: AgentBook, ms: number = NOW): DelegationContext {
  return { binding, registry: committedRegistry(), agents, clock: clockAt(ms) };
}

/** A delegation book with `envelope` registered as the root of `agentId`. */
export function withRoot(binding: TenantBinding, agents: AgentBook, envelope: TaskEnvelope, agentId = 'lead', ms: number = NOW): DelegationBook {
  const result = registerRoot(emptyDelegationBook(), contextOf(binding, agents, ms), { agentId, envelope });
  if (!result.ok) throw new Error(`the control root was refused: ${result.code}: ${result.message}`);
  return result.book;
}

/** The delegating lead and the workers the tests name. */
export const LEAD = { recordId: 'AGT-lead-v1', agentId: 'lead', mayDelegate: true, grants: ['read-repository', 'search-repository', 'run-sandbox-tests'] };
export const WORKER = { recordId: 'AGT-worker-v1', agentId: 'worker', grants: ['read-repository', 'search-repository', 'run-sandbox-tests', 'memory'] };
