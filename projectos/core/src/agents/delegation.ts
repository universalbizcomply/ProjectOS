// Origin: original ProjectOS code
/**
 * Delegation: when one agent may hand a task to another, and what it may hand over. Rules over data; nothing here starts an
 * agent, runs a task, keeps a queue or waits. `runDelegated` calls a function the caller hands it, and that is all.
 *
 * A DELEGATE NEVER GETS MORE THAN ITS PARENT. The child envelope is judged by `checkChildEnvelope` against the parent the
 * BOOK holds, not against anything the request says: its tenant, domain, project, environment and principal must equal the
 * parent's, and its scope, budget and expiry must sit inside the parent's. The grants it asks for must be a subset of the
 * parent's and of its own record's, and never a blocked one. The class it acts at is looked up in the registry and may not
 * pass P3, so no delegate holds a P5 action, however it is labelled.
 *
 * THE DEPTH, THE COUNT AND THE BUDGET ARE THE BOOK'S. A request has no field for any of them. A delegate's depth is its
 * parent's plus one, read from the parent's node; a parent the book has never seen is refused and is never taken for a root,
 * and a root is registered once from an envelope that is not a child, so depth cannot be reset by registering again. Fan-out
 * counts every child a parent ever had. The budget a child asks for is reserved from what the parent has left, and is not
 * given back when the child ends, because what it really spent is not known here.
 *
 * EVERY COUNT IS KEYED BY TENANT AND PROJECT. A node is found by tenant, project and envelope id, and the live count, the
 * node cap and the parent lookup all stay inside the scope of the binding. The book is the module's own: a value shaped like
 * a book is not one. The clock is injected, whole and never behind the latest time the book has seen.
 *
 * A LOST DELEGATE IS UNKNOWN FOR GOOD. A live delegate whose lease has ended is marked unknown and its slot is freed, but its
 * budget stays reserved and a later "completed" does not erase it: it may have acted. `runDelegated` releases the slot on
 * every path, by a `finally`, and a failure to release leaves the lease to end it.
 *
 * WHAT IS CHECKED IS WHAT RUNS. Each field of a request is read once, a grants list is copied before it is judged, and the goal
 * is checked and then stored on the node, which is what the work is handed. A request that changes between reads changes
 * nothing that was stored.
 *
 * WHAT A DELEGATE SENDS BACK IS DATA. `delegateOutput` bounds it, labels it untrusted and fences it with a marker that names
 * the hash of the text it holds, so the text cannot close its own fence.
 *
 * WHAT THIS MODULE CANNOT PROVE. That a root envelope's limits came from the kernel is the caller's: it is checked for
 * shape, scope, expiry and its class labels against the registry, and nothing more. Pure: no I/O.
 */
import { createHash } from 'node:crypto';
import { classAtMost, resolveAction, type ActionRegistry } from '../actionRegistry.js';
import { checkChildEnvelope, envelopeExpired, parseEnvelope, type TaskEnvelope } from '../taskEnvelope.js';
import { isDerivedBinding, type TenantBinding } from '../tenant.js';
import { findAgent, isAgentBook, scopeKey, type AgentBook } from './agentBook.js';
import { readClock, type Clock } from './clockGuard.js';
import {
  DELEGATED_CLASS_CEILING,
  DELEGATION_LEASE_MS,
  MAX_CHILDREN_PER_PARENT,
  MAX_DELEGATE_OUTPUT_CHARS,
  MAX_DELEGATION_DEPTH,
  MAX_DELEGATION_NODES_PER_PROJECT,
  MAX_LIVE_DELEGATES_PER_PROJECT,
} from './delegationLimits.js';
import { goalProblem } from './delegationTasks.js';
import { childGrantProblem, type GrantRefusalCode } from './delegationToolsets.js';

export type NodeState = 'live' | 'completed' | 'failed' | 'unknown';

export interface DelegationNode {
  readonly tenant: string;
  readonly project: string;
  readonly envelopeId: string;
  readonly parentEnvelopeId: string | null;
  readonly agentId: string;
  /** Derived from the parent's node. The root is 0. */
  readonly depth: number;
  /** The agents from the root down to this one. A delegate to an agent already here is a cycle. */
  readonly lineage: readonly string[];
  readonly grants: readonly string[];
  /** The task the delegate was given, as checked. The work reads it from here, so what ran is what was checked. */
  readonly goal: string;
  readonly envelope: TaskEnvelope;
  /** What the parent has set aside for the children asked for so far. */
  readonly reserved: number;
  /** Every child this node ever had, finished or not. */
  readonly children: number;
  readonly state: NodeState;
  readonly admittedAt: number;
}

/** An opaque book of delegation nodes. */
export interface DelegationBook {
  readonly size: number;
  readonly lastSeen: number;
}

export interface DelegationContext {
  readonly binding: TenantBinding;
  readonly registry: ActionRegistry;
  readonly agents: AgentBook;
  readonly clock: Clock;
}

export interface DelegationRequest {
  readonly parentEnvelopeId: string;
  readonly childAgentId: string;
  readonly childEnvelope: unknown;
  readonly grants: readonly string[];
  readonly goal: string;
}

export interface RootRequest {
  readonly agentId: string;
  readonly envelope: unknown;
}

export type DelegationCode =
  | 'BINDING'
  | 'BOOK'
  | 'AGENT_BOOK'
  | 'CLOCK'
  | 'GOAL'
  | 'PARENT_UNKNOWN'
  | 'PARENT_NOT_LIVE'
  | 'PARENT_EXPIRED'
  | 'NOT_DELEGATE_CAPABLE'
  | 'DEPTH_CAP'
  | 'FAN_OUT_CAP'
  | 'CONCURRENCY_CAP'
  | 'BOOK_FULL'
  | 'CHILD_AGENT_UNKNOWN'
  | 'CYCLE'
  | 'DUPLICATE_ENVELOPE'
  | 'ENVELOPE_R1'
  | 'ENVELOPE_R2'
  | 'ENVELOPE_R3'
  | 'DELEGATED_CLASS'
  | 'OVER_BUDGET'
  | 'ROOT_SCOPE'
  | 'ROOT_LABEL'
  | 'ROOT_AGENT_UNKNOWN'
  | 'ROOT_IS_A_CHILD'
  | 'NODE_UNKNOWN'
  | 'ALREADY_SETTLED'
  | 'OUTCOME'
  | 'OUTPUT_SHAPE'
  | 'WORK_FAILED'
  | GrantRefusalCode;

export interface DelegationFailure {
  readonly ok: false;
  readonly code: DelegationCode;
  readonly message: string;
  /** The book that came in, unchanged. */
  readonly book: DelegationBook;
}

export type DelegationResult = { readonly ok: true; readonly book: DelegationBook; readonly node: DelegationNode } | DelegationFailure;

const BOOKS = new WeakMap<DelegationBook, ReadonlyMap<string, DelegationNode>>();

function bookOf(nodes: ReadonlyMap<string, DelegationNode>, lastSeen: number): DelegationBook {
  const book: DelegationBook = Object.freeze({ size: nodes.size, lastSeen });
  BOOKS.set(book, nodes);
  return book;
}

export const emptyDelegationBook = (): DelegationBook => bookOf(new Map(), 0);

/** Did this module build the book? */
export const isDelegationBook = (value: unknown): value is DelegationBook => typeof value === 'object' && value !== null && BOOKS.has(value as DelegationBook);

const nodeKey = (tenant: string, project: string, envelopeId: string): string => JSON.stringify([tenant, project, envelopeId]);
const inScope = (node: DelegationNode, binding: TenantBinding): boolean => node.tenant === binding.tenant && node.project === binding.projectId;

const fail = (book: DelegationBook, code: DelegationCode, message: string): DelegationFailure => ({ ok: false, code, message, book });

interface Prepared {
  readonly nodes: ReadonlyMap<string, DelegationNode>;
  readonly now: number;
  readonly iso: string;
}

/** The checks every call starts with: a derived binding, this module's books, and a clock that can be trusted. */
function prepare(book: DelegationBook, context: DelegationContext): Prepared | DelegationFailure {
  if (!isDerivedBinding(context.binding)) return fail(book, 'BINDING', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  const held = BOOKS.get(book);
  if (held === undefined) return fail(book, 'BOOK', 'the delegation book was not built by this module');
  if (!isAgentBook(context.agents)) return fail(book, 'AGENT_BOOK', 'the agent book was not built by this module');
  const now = readClock(context.clock, book.lastSeen);
  if (now === null) return fail(book, 'CLOCK', 'the clock gave no usable time, or a time before one the book has already seen');
  return { nodes: held, now, iso: new Date(now).toISOString() };
}

const isFailure = (value: Prepared | DelegationFailure): value is DelegationFailure => 'ok' in value;

/** A live delegate past its lease is unknown: its slot is free and its budget is not. Roots have no lease; their envelope expires. */
function withExpiry(nodes: ReadonlyMap<string, DelegationNode>, now: number): { readonly nodes: ReadonlyMap<string, DelegationNode>; readonly expired: number } {
  const lapsed = [...nodes].filter(([, node]) => node.state === 'live' && node.depth > 0 && now >= node.admittedAt + DELEGATION_LEASE_MS);
  if (lapsed.length === 0) return { nodes, expired: 0 };
  const next = new Map(nodes);
  for (const [key, node] of lapsed) next.set(key, Object.freeze({ ...node, state: 'unknown' as const }));
  return { nodes: next, expired: lapsed.length };
}

function nodeCount(nodes: ReadonlyMap<string, DelegationNode>, binding: TenantBinding): number {
  return [...nodes.values()].filter((node) => inScope(node, binding)).length;
}

/**
 * Register the root of a run: an admitted envelope that is not a child, for an agent this tenant holds. It is the only way a
 * node enters at depth 0, so a child envelope cannot be registered again to reset its depth.
 */
export function registerRoot(book: DelegationBook, context: DelegationContext, request: RootRequest): DelegationResult {
  const prepared = prepare(book, context);
  if (isFailure(prepared)) return prepared;
  const { binding, registry } = context;
  const parsed = parseEnvelope(request.envelope);
  if (!parsed.ok) return fail(book, 'ENVELOPE_R1', parsed.reasons.join('; '));
  const envelope = parsed.envelope;
  if (envelope.tenant !== binding.tenant || envelope.project !== binding.projectId || envelope.domain !== binding.domain) {
    return fail(book, 'ROOT_SCOPE', "the root envelope is not in the binding's tenant, domain and project");
  }
  if (envelope.parentEnvelopeId !== null) return fail(book, 'ROOT_IS_A_CHILD', 'an envelope with a parent is not a root, and registering it again would reset its depth');
  const resolved = resolveAction(registry, envelope.action);
  if (resolved.actionClass !== envelope.actionClass || resolved.environment !== envelope.environment) {
    return fail(book, 'ROOT_LABEL', "the root envelope's class or environment is not the registry's for its action");
  }
  const record = findAgent(context.agents, binding.tenant, binding.projectId, request.agentId);
  if (record === null) return fail(book, 'ROOT_AGENT_UNKNOWN', 'the root agent is not held by this tenant and project');
  if (envelopeExpired(envelope, prepared.iso)) return fail(book, 'PARENT_EXPIRED', 'the root envelope has expired');
  const key = nodeKey(binding.tenant, binding.projectId, envelope.envelopeId);
  if (prepared.nodes.has(key)) return fail(book, 'DUPLICATE_ENVELOPE', 'this envelope is already in the book');
  if (nodeCount(prepared.nodes, binding) >= MAX_DELEGATION_NODES_PER_PROJECT) return fail(book, 'BOOK_FULL', 'the book is full for this project; nothing is dropped to make room');
  const node: DelegationNode = Object.freeze({
    tenant: binding.tenant,
    project: binding.projectId,
    envelopeId: envelope.envelopeId,
    parentEnvelopeId: null,
    agentId: record.agentId,
    depth: 0,
    lineage: Object.freeze([record.agentId]),
    grants: record.grants,
    goal: '',
    envelope,
    reserved: 0,
    children: 0,
    state: 'live' as const,
    admittedAt: prepared.now,
  });
  return { ok: true, book: bookOf(new Map([...prepared.nodes, [key, node]]), prepared.now), node };
}

/** The first of these a request breaks, in this order, or `null`. Each is its own rule. */
function parentProblem(parent: DelegationNode | undefined, context: DelegationContext, prepared: Prepared): readonly [DelegationCode, string] | null {
  if (parent === undefined) return ['PARENT_UNKNOWN', 'the parent is not in the book for this tenant and project; it is not taken for a root'];
  if (parent.state !== 'live') return ['PARENT_NOT_LIVE', 'the parent has ended'];
  if (envelopeExpired(parent.envelope, prepared.iso)) return ['PARENT_EXPIRED', "the parent's envelope has expired"];
  const record = findAgent(context.agents, parent.tenant, parent.project, parent.agentId);
  if (record === null || record.mayDelegate !== true) return ['NOT_DELEGATE_CAPABLE', "the parent's agent record does not say it may delegate"];
  return null;
}

/**
 * May this parent hand this task to this child? On success the child is a live node one level below the parent, its budget is
 * reserved from the parent, and a new book is returned. On any refusal the book that came in is returned unchanged.
 */
export function admitDelegation(book: DelegationBook, context: DelegationContext, request: DelegationRequest): DelegationResult {
  const prepared = prepare(book, context);
  if (isFailure(prepared)) return prepared;
  const { binding, registry } = context;
  // Each field is read once, so what is checked is what is stored.
  const { parentEnvelopeId, childAgentId, childEnvelope, goal, grants: stated } = request;
  const grants = Array.isArray(stated) ? Object.freeze([...(stated as readonly unknown[])]) : stated;
  const goalRefused = goalProblem(goal);
  if (goalRefused !== null) return fail(book, 'GOAL', goalRefused);
  const { nodes } = withExpiry(prepared.nodes, prepared.now);
  const parent = nodes.get(nodeKey(binding.tenant, binding.projectId, String(parentEnvelopeId)));
  const refused = parentProblem(parent, context, prepared);
  if (refused !== null || parent === undefined) return fail(book, refused?.[0] ?? 'PARENT_UNKNOWN', refused?.[1] ?? 'the parent is not in the book');
  if (parent.depth + 1 > MAX_DELEGATION_DEPTH) return fail(book, 'DEPTH_CAP', `a delegate would be past depth ${MAX_DELEGATION_DEPTH}`);
  if (parent.children >= MAX_CHILDREN_PER_PARENT) return fail(book, 'FAN_OUT_CAP', `a parent has at most ${MAX_CHILDREN_PER_PARENT} children`);
  const live = [...nodes.values()].filter((node) => inScope(node, binding) && node.depth > 0 && node.state === 'live').length;
  if (live >= MAX_LIVE_DELEGATES_PER_PROJECT) return fail(book, 'CONCURRENCY_CAP', `at most ${MAX_LIVE_DELEGATES_PER_PROJECT} delegates are live in a project`);
  if (nodeCount(nodes, binding) >= MAX_DELEGATION_NODES_PER_PROJECT) return fail(book, 'BOOK_FULL', 'the book is full for this project; nothing is dropped to make room');
  const record = findAgent(context.agents, binding.tenant, binding.projectId, childAgentId);
  if (record === null) return fail(book, 'CHILD_AGENT_UNKNOWN', 'the child agent is not held by this tenant and project');
  if (parent.lineage.includes(record.agentId)) return fail(book, 'CYCLE', 'the child agent is already in the chain that leads here');
  const grantRefused = childGrantProblem(parent.grants, record.grants, grants);
  if (grantRefused !== null) return fail(book, grantRefused.code, grantRefused.message);
  const checked = checkChildEnvelope(parent.envelope, childEnvelope, registry);
  if (!checked.ok) return fail(book, `ENVELOPE_${checked.rule}` as DelegationCode, checked.reasons.join('; '));
  const child = checked.envelope;
  const key = nodeKey(binding.tenant, binding.projectId, child.envelopeId);
  if (nodes.has(key)) return fail(book, 'DUPLICATE_ENVELOPE', 'this envelope is already in the book');
  if (!classAtMost(resolveAction(registry, child.action).actionClass, DELEGATED_CLASS_CEILING)) {
    return fail(book, 'DELEGATED_CLASS', `a delegate may act at ${DELEGATED_CLASS_CEILING} at most: no child holds a P5 action`);
  }
  if (child.budget > parent.envelope.budget - parent.reserved) return fail(book, 'OVER_BUDGET', "the child's budget is more than the parent has left");
  const node: DelegationNode = Object.freeze({
    tenant: binding.tenant,
    project: binding.projectId,
    envelopeId: child.envelopeId,
    parentEnvelopeId: parent.envelopeId,
    agentId: record.agentId,
    depth: parent.depth + 1,
    lineage: Object.freeze([...parent.lineage, record.agentId]),
    grants: Object.freeze([...(grants as readonly string[])].sort()),
    goal: goal as string,
    envelope: child,
    reserved: 0,
    children: 0,
    state: 'live' as const,
    admittedAt: prepared.now,
  });
  const updated = Object.freeze({ ...parent, children: parent.children + 1, reserved: parent.reserved + child.budget });
  const next = new Map(nodes);
  next.set(nodeKey(binding.tenant, binding.projectId, parent.envelopeId), updated);
  next.set(key, node);
  return { ok: true, book: bookOf(next, prepared.now), node };
}

export type SettleOutcome = 'completed' | 'failed';
export type SettleResult = { readonly ok: true; readonly book: DelegationBook } | DelegationFailure;

/** End a live node as completed or failed. An unknown node stays unknown, and a node ends once. */
export function settleDelegation(book: DelegationBook, context: DelegationContext, envelopeId: string, outcome: SettleOutcome): SettleResult {
  const prepared = prepare(book, context);
  if (isFailure(prepared)) return prepared;
  if (outcome !== 'completed' && outcome !== 'failed') return fail(book, 'OUTCOME', "a node ends as 'completed' or 'failed'");
  const { nodes } = withExpiry(prepared.nodes, prepared.now);
  const key = nodeKey(context.binding.tenant, context.binding.projectId, String(envelopeId));
  const node = nodes.get(key);
  if (node === undefined) return fail(book, 'NODE_UNKNOWN', 'no such node in this tenant and project');
  if (node.state !== 'live') return fail(book, 'ALREADY_SETTLED', `the node already ended as ${node.state}`);
  const next = new Map(nodes);
  next.set(key, Object.freeze({ ...node, state: outcome }));
  return { ok: true, book: bookOf(next, prepared.now) };
}

export type ExpireResult = { readonly ok: true; readonly book: DelegationBook; readonly expired: number } | DelegationFailure;

/** Mark every live delegate past its lease as unknown. */
export function expireStaleDelegations(book: DelegationBook, context: DelegationContext): ExpireResult {
  const prepared = prepare(book, context);
  if (isFailure(prepared)) return prepared;
  const { nodes, expired } = withExpiry(prepared.nodes, prepared.now);
  return { ok: true, book: expired === 0 ? book : bookOf(nodes, prepared.now), expired };
}

/**
 * The node for this envelope in exactly this tenant and project, as it stands at `now`: a live delegate past its lease reads
 * as unknown. `null` when the book is not this module's or holds no such node.
 */
export function delegationNodeAt(book: DelegationBook, tenant: string, project: string, envelopeId: string, now: number): DelegationNode | null {
  const held = BOOKS.get(book);
  if (held === undefined) return null;
  return withExpiry(held, now).nodes.get(nodeKey(tenant, project, String(envelopeId))) ?? null;
}

export type RunResult<T> =
  /** `settled` is false when the book could not end the node, for instance because its lease had already run out: the book then reads it as unknown. */
  | { readonly ok: true; readonly value: T; readonly envelopeId: string; readonly settled: boolean }
  | { readonly ok: false; readonly code: DelegationCode; readonly message: string };

/**
 * Admit a delegation, run the work the caller hands in, and release the slot on every path. The holder is the one mutable
 * place: its `book` is replaced, never edited. The work gets the node and nothing else, and its error text is not passed on,
 * because it is as untrusted as its output.
 */
export async function runDelegated<T>(
  holder: { book: DelegationBook },
  context: DelegationContext,
  request: DelegationRequest,
  work: (node: DelegationNode) => Promise<T>,
): Promise<RunResult<T>> {
  const admitted = admitDelegation(holder.book, context, request);
  if (!admitted.ok) return { ok: false, code: admitted.code, message: admitted.message };
  holder.book = admitted.book;
  let outcome: SettleOutcome = 'failed';
  let answer: RunResult<T>;
  let settledByBook = false;
  try {
    const value = await work(admitted.node);
    outcome = 'completed';
    answer = { ok: true, value, envelopeId: admitted.node.envelopeId, settled: false };
  } catch (error) {
    answer = { ok: false, code: 'WORK_FAILED', message: `the delegated work did not complete (${error instanceof Error ? error.name : 'not an error'})` };
  } finally {
    const settled = settleDelegation(holder.book, context, admitted.node.envelopeId, outcome);
    if (settled.ok) holder.book = settled.book;
    settledByBook = settled.ok;
  }
  return answer.ok ? { ...answer, settled: settledByBook } : answer;
}

export interface DelegateOutput {
  readonly trust: 'untrusted-data';
  readonly tenant: string;
  readonly project: string;
  readonly agentId: string;
  readonly envelopeId: string;
  readonly text: string;
  readonly truncated: boolean;
  /** Names the hash of `text`, so the text cannot contain the marker that ends it. */
  readonly fence: string;
  readonly fenced: string;
}

export type OutputResult = { readonly ok: true; readonly output: DelegateOutput } | DelegationFailure;

/** What a delegate sent back, bounded, labelled untrusted and fenced. It is data for the parent to read, never an instruction. */
export function delegateOutput(book: DelegationBook, context: DelegationContext, envelopeId: string, text: unknown): OutputResult {
  const prepared = prepare(book, context);
  if (isFailure(prepared)) return prepared;
  const node = prepared.nodes.get(nodeKey(context.binding.tenant, context.binding.projectId, String(envelopeId)));
  if (node === undefined) return fail(book, 'NODE_UNKNOWN', 'no such node in this tenant and project');
  if (typeof text !== 'string') return fail(book, 'OUTPUT_SHAPE', 'a delegate answers with text');
  const truncated = text.length > MAX_DELEGATE_OUTPUT_CHARS;
  const body = truncated ? text.slice(0, MAX_DELEGATE_OUTPUT_CHARS) : text;
  const fence = `delegate-output:sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
  const label = `tenant=${node.tenant} project=${node.project} agent=${node.agentId} envelope=${node.envelopeId} trust=untrusted-data`;
  const fenced = `<<<BEGIN ${fence} ${label}>>>\n${body}\n<<<END ${fence}>>>`;
  return { ok: true, output: { trust: 'untrusted-data', tenant: node.tenant, project: node.project, agentId: node.agentId, envelopeId: node.envelopeId, text: body, truncated, fence, fenced } };
}
