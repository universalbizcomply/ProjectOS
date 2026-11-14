// Origin: original ProjectOS code
/**
 * Delegation: when one agent may hand a task to another, and what it may hand over. Rules over data; nothing here starts an
 * agent, runs a task, keeps a queue or sets a timer of its own. `runDelegated` calls a function the caller hands it, and
 * waits on a timer the caller hands it, and that is all.
 *
 * A DELEGATE NEVER GETS MORE THAN ITS PARENT. The child envelope is judged by `checkChildEnvelope` against the parent the
 * BOOK holds, not against anything the request says: its tenant, domain, project, environment and principal must equal the
 * parent's, and its scope, budget and expiry must sit inside the parent's. The grants it asks for must be a subset of the
 * parent's and of its own record's, and never a blocked one under any spelling. The class it acts at is looked up in the
 * registry and may not pass P3, so no delegate holds a P5 action, however it is labelled.
 *
 * THE DEPTH, THE COUNT AND THE BUDGET ARE THE BOOK'S. A request has no field for any of them. A delegate's depth is its
 * parent's plus one, read from the parent's node; a parent the book has never seen is refused and is never taken for a root.
 * A root is an envelope the kernel's own door admitted, a run of the agent the kernel names as its actor, registered once. A
 * child envelope is never a run, so depth cannot be reset by registering it again, and a hand-built root with a huge budget is
 * refused. A child never outlives its parent, so an expired parent has only expired children and is refused by that. Fan-out counts every child a
 * parent ever had. The budget a child asks for is reserved from what the parent has left after its own recorded spend, and
 * is not given back when the child ends: what it really spent belongs to the canonical budget adapter, not to this module.
 *
 * EVERY COUNT IS KEYED BY TENANT AND PROJECT. A node is found by tenant, project and envelope id, and the live count, the
 * per-root count, the node cap and the parent lookup all stay inside the scope of the binding. The book is the module's own:
 * a value shaped like a book is not one, and a book comes back from storage only through `restoreDelegationBook`, which
 * holds it to the invariants these rules could have produced. The clock is injected, whole and never behind the latest time
 * the book has seen.
 *
 * A LOST DELEGATE IS UNKNOWN FOR GOOD. A live delegate whose lease has ended, or whose work hit its deadline, is marked
 * unknown, and so is everything live beneath it. It keeps its slot until an owner-form record, verified by an injected port,
 * releases it, and its budget stays reserved: it may have acted. A later "completed" does not erase it, and a result that
 * arrives after the lapse is refused. Ending a parent ends its live children the same way.
 *
 * WHAT IS CHECKED IS WHAT RUNS. Everything a caller hands in is copied once into plain data before it is judged: the context,
 * the request, and the child envelope with its actor and scope, where an accessor anywhere refuses the whole envelope. The
 * goal is checked and then stored on the node, which is what the work is handed, and the grants are the copy that was judged.
 *
 * AN AGENT'S RECORD IS PINNED. A node remembers the hash of the record it started under, and a book whose record for that
 * agent has since changed cannot change what the run may do: the call is refused.
 *
 * WHAT A DELEGATE SENDS BACK IS DATA. `delegateOutput` bounds it, labels it untrusted and fences it with a marker that names
 * the hash of the text it holds, so the text cannot close its own fence.
 *
 * WHAT THIS MODULE CANNOT PROVE. That the caller is the run an envelope id names is the wiring's. That a restored book is the
 * one that was exported is the verifier port's. That an owner-form record is the owner's is the port's too. Pure: no I/O.
 */
import { createHash } from 'node:crypto';
import { classAtMost, resolveAction, type ActionRegistry } from '../actionRegistry.js';
import { checkChildEnvelope, envelopeExpired, parseEnvelope, recordExecution, type TaskEnvelope } from '../taskEnvelope.js';
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
  MAX_LIVE_DELEGATES_PER_ROOT,
  MAX_TOMBSTONES_PER_PROJECT,
} from './delegationLimits.js';
import { goalProblem } from './delegationTasks.js';
import { childGrantProblem, isBlockedGrant, type GrantRefusalCode } from './delegationToolsets.js';
import { deepSnapshot, snapshotEnvelope } from './envelopeSnapshot.js';
import { readOwnerForm, verifiedByPort, type OwnerFormVerifier } from './ownerForm.js';
import { snapshotOf } from './plainRecords.js';

/** The action the kernel's door defines for a run (`mintCrossing` in taskEnvelope.ts holds a crossing to a run of this action). */
const RUN_ACTION = 'run-start';

export type NodeState = 'live' | 'completed' | 'failed' | 'unknown';
const NODE_STATES: readonly NodeState[] = ['live', 'completed', 'failed', 'unknown'];

export interface DelegationNode {
  readonly tenant: string;
  readonly project: string;
  readonly envelopeId: string;
  readonly parentEnvelopeId: string | null;
  /** The root of the run this node belongs to. */
  readonly rootEnvelopeId: string;
  readonly agentId: string;
  /** The hash of the agent record the node started under. */
  readonly recordHash: string;
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
  /** What this node's own work has spent, as recorded by `recordDelegateSpend`. */
  readonly spent: number;
  /** Every child this node ever had, finished or not. */
  readonly children: number;
  readonly state: NodeState;
  /** An unknown delegate keeps its slot until this is true. */
  readonly released: boolean;
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
  /** The envelope object the kernel's door admitted. A copy of it is not that envelope. */
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
  | 'RECORD_CHANGED'
  | 'DEPTH_CAP'
  | 'FAN_OUT_CAP'
  | 'ROOT_CAP'
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
  | 'ROOT_NOT_ADMITTED'
  | 'ROOT_NOT_A_RUN'
  | 'ROOT_AGENT_MISMATCH'
  | 'CHILD_EXPIRED'
  | 'TOMBSTONES_FULL'
  | 'ROOT_SCOPE'
  | 'ROOT_LABEL'
  | 'ROOT_AGENT_UNKNOWN'
  | 'NODE_UNKNOWN'
  | 'ALREADY_SETTLED'
  | 'OUTCOME'
  | 'OUTPUT_SHAPE'
  | 'SPEND_SHAPE'
  | 'NOT_RELEASABLE'
  | 'RELEASE_UNVERIFIED'
  | 'NO_TIMER'
  | 'LAPSED'
  | 'WORK_FAILED'
  | 'SNAPSHOT_SHAPE'
  | 'SNAPSHOT_UNVERIFIED'
  | 'SNAPSHOT_INVARIANT'
  | GrantRefusalCode;

export interface DelegationFailure {
  readonly ok: false;
  readonly code: DelegationCode;
  readonly message: string;
  /** The book that came in, unchanged. */
  readonly book: DelegationBook;
}

export type DelegationResult = { readonly ok: true; readonly book: DelegationBook; readonly node: DelegationNode } | DelegationFailure;

/** An envelope id the book pruned, with the instant its envelope expires: it cannot be admitted again until then, and not after. */
interface Tombstone {
  readonly expiry: number;
  readonly scope: string;
}

interface BookState {
  readonly nodes: ReadonlyMap<string, DelegationNode>;
  readonly tombs: ReadonlyMap<string, Tombstone>;
}

const BOOKS = new WeakMap<DelegationBook, BookState>();
const noTombs = (): ReadonlyMap<string, Tombstone> => new Map();

function bookOf(nodes: ReadonlyMap<string, DelegationNode>, lastSeen: number, tombs: ReadonlyMap<string, Tombstone> = noTombs()): DelegationBook {
  const book: DelegationBook = Object.freeze({ size: nodes.size, lastSeen });
  BOOKS.set(book, { nodes, tombs });
  return book;
}

export const emptyDelegationBook = (): DelegationBook => bookOf(new Map(), 0);

/** Did this module build the book? */
export const isDelegationBook = (value: unknown): value is DelegationBook => typeof value === 'object' && value !== null && BOOKS.has(value as DelegationBook);

const nodeKey = (tenant: string, project: string, envelopeId: string): string => JSON.stringify([tenant, project, envelopeId]);
const inScope = (node: DelegationNode, binding: TenantBinding): boolean => node.tenant === binding.tenant && node.project === binding.projectId;
/** A node holds a slot while it is live, or unknown and not yet released. */
const holdsSlot = (node: DelegationNode): boolean => node.state === 'live' || (node.state === 'unknown' && !node.released);

const fail = (book: DelegationBook, code: DelegationCode, message: string): DelegationFailure => ({ ok: false, code, message, book });

/** Was this envelope admitted at the kernel's door? Only the kernel's own record of it can say, and a copy is not it. */
function kernelAdmitted(envelope: unknown): envelope is TaskEnvelope {
  return typeof envelope === 'object' && envelope !== null && recordExecution(envelope as TaskEnvelope, 'allowed', null, '1970-01-01T00:00:00.000Z', () => true) === true;
}

interface Prepared {
  readonly nodes: ReadonlyMap<string, DelegationNode>;
  readonly tombs: ReadonlyMap<string, Tombstone>;
  readonly now: number;
  readonly iso: string;
}

/** The context copied once, so a getter on it answers once. */
const once = <T extends object>(input: T): Readonly<T> => Object.freeze({ ...input });

/** The checks every call starts with: a derived binding, this module's books, and a clock that can be trusted. */
function prepare(book: DelegationBook, context: DelegationContext): Prepared | DelegationFailure {
  if (!isDerivedBinding(context.binding)) return fail(book, 'BINDING', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  const held = BOOKS.get(book);
  if (held === undefined) return fail(book, 'BOOK', 'the delegation book was not built by this module');
  if (!isAgentBook(context.agents)) return fail(book, 'AGENT_BOOK', 'the agent book was not built by this module');
  const now = readClock(context.clock, book.lastSeen);
  if (now === null) return fail(book, 'CLOCK', 'the clock gave no usable time, or a time before one the book has already seen');
  return { nodes: held.nodes, tombs: held.tombs, now, iso: new Date(now).toISOString() };
}

const isFailure = (value: Prepared | DelegationFailure): value is DelegationFailure => 'ok' in value;

/** Every live node beneath `node` becomes unknown, and so keeps its slot. Applied to the map in place, before it is shared. */
function endBelow(next: Map<string, DelegationNode>, node: DelegationNode): void {
  const below = [...next].filter(([, other]) => other.state === 'live' && other.tenant === node.tenant && other.project === node.project && other.parentEnvelopeId === node.envelopeId);
  for (const [key, other] of below) {
    next.set(key, Object.freeze({ ...other, state: 'unknown' as const }));
    endBelow(next, other);
  }
}

/**
 * A live delegate past its lease is unknown, and so is what is live beneath it. It keeps its slot and its budget. Roots have
 * no lease: their envelope expires.
 */
function withExpiry(nodes: ReadonlyMap<string, DelegationNode>, now: number): { readonly nodes: ReadonlyMap<string, DelegationNode>; readonly expired: number } {
  const lapsed = [...nodes].filter(([, node]) => node.state === 'live' && node.depth > 0 && now >= node.admittedAt + DELEGATION_LEASE_MS);
  if (lapsed.length === 0) return { nodes, expired: 0 };
  const next = new Map(nodes);
  for (const [key, node] of lapsed) {
    next.set(key, Object.freeze({ ...node, state: 'unknown' as const }));
    endBelow(next, node);
  }
  return { nodes: next, expired: lapsed.length };
}

function nodeCount(nodes: ReadonlyMap<string, DelegationNode>, binding: TenantBinding): number {
  return [...nodes.values()].filter((node) => inScope(node, binding)).length;
}

/**
 * Register the root of a run: the envelope the kernel's door admitted, not a child, for an agent this tenant holds. It is the
 * only way a node enters at depth 0, so a child envelope cannot be registered again to reset its depth, and nothing the
 * kernel did not admit can start a run with a budget of its own choosing.
 */
export function registerRoot(book: DelegationBook, input: DelegationContext, asked: RootRequest): DelegationResult {
  const context = once(input);
  const request = once(asked);
  const prepared = prepare(book, context);
  if (isFailure(prepared)) return prepared;
  const { binding, registry } = context;
  if (!kernelAdmitted(request.envelope)) return fail(book, 'ROOT_NOT_ADMITTED', "a root is the envelope object the kernel's door admitted; a copy or a hand-built envelope is not one");
  const snapshot = snapshotEnvelope(request.envelope);
  const parsed = snapshot === null ? null : parseEnvelope(snapshot);
  if (parsed === null || !parsed.ok) return fail(book, 'ENVELOPE_R1', parsed === null ? 'the root envelope is not plain data' : parsed.reasons.join('; '));
  const envelope = parsed.envelope;
  if (envelope.tenant !== binding.tenant || envelope.project !== binding.projectId || envelope.domain !== binding.domain) {
    return fail(book, 'ROOT_SCOPE', "the root envelope is not in the binding's tenant, domain and project");
  }
  const resolved = resolveAction(registry, envelope.action);
  if (resolved.actionClass !== envelope.actionClass || resolved.environment !== envelope.environment) {
    return fail(book, 'ROOT_LABEL', "the root envelope's class or environment is not the registry's for its action");
  }
  if (envelope.action !== RUN_ACTION) return fail(book, 'ROOT_NOT_A_RUN', `a root is the kernel's '${RUN_ACTION}' envelope, not '${envelope.action}'`);
  if (request.agentId !== envelope.actor.agent) return fail(book, 'ROOT_AGENT_MISMATCH', "the root's agent is not the agent the kernel's envelope names as its actor");
  const record = findAgent(context.agents, binding.tenant, binding.projectId, request.agentId);
  if (record === null) return fail(book, 'ROOT_AGENT_UNKNOWN', 'the root agent is not held by this tenant and project');
  if (envelopeExpired(envelope, prepared.iso)) return fail(book, 'PARENT_EXPIRED', 'the root envelope has expired');
  const key = nodeKey(binding.tenant, binding.projectId, envelope.envelopeId);
  if (prepared.nodes.has(key) || prepared.tombs.has(key)) return fail(book, 'DUPLICATE_ENVELOPE', 'this envelope is already in the book, or was pruned from it and cannot be admitted again');
  if (nodeCount(prepared.nodes, binding) >= MAX_DELEGATION_NODES_PER_PROJECT) return fail(book, 'BOOK_FULL', 'the book is full for this project; nothing is dropped to make room');
  const node: DelegationNode = Object.freeze({
    tenant: binding.tenant,
    project: binding.projectId,
    envelopeId: envelope.envelopeId,
    parentEnvelopeId: null,
    rootEnvelopeId: envelope.envelopeId,
    agentId: record.agentId,
    recordHash: record.recordHash,
    depth: 0,
    lineage: Object.freeze([record.agentId]),
    grants: record.grants,
    goal: '',
    envelope,
    reserved: 0,
    spent: 0,
    children: 0,
    state: 'live' as const,
    released: false,
    admittedAt: prepared.now,
  });
  return { ok: true, book: bookOf(new Map([...prepared.nodes, [key, node]]), prepared.now, prepared.tombs), node };
}

/** The first of these a request breaks, in this order, or `null`. Each is its own rule. */
function parentProblem(parent: DelegationNode | undefined, context: DelegationContext, prepared: Prepared): readonly [DelegationCode, string] | null {
  if (parent === undefined) return ['PARENT_UNKNOWN', 'the parent is not in the book for this tenant and project; it is not taken for a root'];
  if (parent.state !== 'live') return ['PARENT_NOT_LIVE', 'the parent has ended'];
  const record = findAgent(context.agents, parent.tenant, parent.project, parent.agentId);
  if (record === null || record.mayDelegate !== true) return ['NOT_DELEGATE_CAPABLE', "the parent's agent record does not say it may delegate"];
  if (record.recordHash !== parent.recordHash) return ['RECORD_CHANGED', "the parent's agent record is not the one the run started under"];
  return null;
}

/**
 * May this parent hand this task to this child? On success the child is a live node one level below the parent, its budget is
 * reserved from the parent, and a new book is returned. On any refusal the book that came in is returned unchanged.
 */
export function admitDelegation(book: DelegationBook, input: DelegationContext, asked: DelegationRequest): DelegationResult {
  const context = once(input);
  const request = once(asked);
  const prepared = prepare(book, context);
  if (isFailure(prepared)) return prepared;
  const { binding, registry } = context;
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
  const held = [...nodes.values()].filter((node) => inScope(node, binding) && node.depth > 0 && holdsSlot(node));
  if (held.filter((node) => node.rootEnvelopeId === parent.rootEnvelopeId).length >= MAX_LIVE_DELEGATES_PER_ROOT) {
    return fail(book, 'ROOT_CAP', `at most ${MAX_LIVE_DELEGATES_PER_ROOT} delegates hold a slot under one root`);
  }
  if (held.length >= MAX_LIVE_DELEGATES_PER_PROJECT) return fail(book, 'CONCURRENCY_CAP', `at most ${MAX_LIVE_DELEGATES_PER_PROJECT} delegates hold a slot in a project`);
  if (nodeCount(nodes, binding) >= MAX_DELEGATION_NODES_PER_PROJECT) return fail(book, 'BOOK_FULL', 'the book is full for this project; nothing is dropped to make room');
  const record = findAgent(context.agents, binding.tenant, binding.projectId, childAgentId);
  if (record === null) return fail(book, 'CHILD_AGENT_UNKNOWN', 'the child agent is not held by this tenant and project');
  if (parent.lineage.includes(record.agentId)) return fail(book, 'CYCLE', 'the child agent is already in the chain that leads here');
  const grantRefused = childGrantProblem(parent.grants, record.grants, grants);
  if (grantRefused !== null) return fail(book, grantRefused.code, grantRefused.message);
  const plain = snapshotEnvelope(childEnvelope);
  if (plain === null) return fail(book, 'ENVELOPE_R1', 'the child envelope is not plain data: an accessor, an unknown field or a symbol key refuses it');
  const checked = checkChildEnvelope(parent.envelope, plain, registry);
  if (!checked.ok) return fail(book, `ENVELOPE_${checked.rule}` as DelegationCode, checked.reasons.join('; '));
  const child = checked.envelope;
  if (envelopeExpired(child, prepared.iso)) return fail(book, 'CHILD_EXPIRED', "the child's envelope has expired");
  const key = nodeKey(binding.tenant, binding.projectId, child.envelopeId);
  if (nodes.has(key) || prepared.tombs.has(key)) return fail(book, 'DUPLICATE_ENVELOPE', 'this envelope is already in the book, or was pruned from it and cannot be admitted again');
  if (!classAtMost(resolveAction(registry, child.action).actionClass, DELEGATED_CLASS_CEILING)) {
    return fail(book, 'DELEGATED_CLASS', `a delegate may act at ${DELEGATED_CLASS_CEILING} at most: no child holds a P5 action`);
  }
  if (child.budget > parent.envelope.budget - parent.reserved - parent.spent) return fail(book, 'OVER_BUDGET', "the child's budget is more than the parent has left");
  const node: DelegationNode = Object.freeze({
    tenant: binding.tenant,
    project: binding.projectId,
    envelopeId: child.envelopeId,
    parentEnvelopeId: parent.envelopeId,
    rootEnvelopeId: parent.rootEnvelopeId,
    agentId: record.agentId,
    recordHash: record.recordHash,
    depth: parent.depth + 1,
    lineage: Object.freeze([...parent.lineage, record.agentId]),
    grants: Object.freeze([...(grants as readonly string[])].sort()),
    goal: goal as string,
    envelope: child,
    reserved: 0,
    spent: 0,
    children: 0,
    state: 'live' as const,
    released: false,
    admittedAt: prepared.now,
  });
  const updated = Object.freeze({ ...parent, children: parent.children + 1, reserved: parent.reserved + child.budget });
  const next = new Map(nodes);
  next.set(nodeKey(binding.tenant, binding.projectId, parent.envelopeId), updated);
  next.set(key, node);
  return { ok: true, book: bookOf(next, prepared.now, prepared.tombs), node };
}

export type SettleOutcome = 'completed' | 'failed' | 'unknown';
export type SettleResult = { readonly ok: true; readonly book: DelegationBook } | DelegationFailure;

/**
 * End a live node as completed, failed or unknown. An unknown node stays unknown, a node ends once, and ending a node ends
 * every live node beneath it as unknown: a parent that is gone leaves no live orphans.
 */
export function settleDelegation(book: DelegationBook, input: DelegationContext, envelopeId: string, outcome: SettleOutcome): SettleResult {
  const context = once(input);
  const prepared = prepare(book, context);
  if (isFailure(prepared)) return prepared;
  if (outcome !== 'completed' && outcome !== 'failed' && outcome !== 'unknown') return fail(book, 'OUTCOME', "a node ends as 'completed', 'failed' or 'unknown'");
  const { nodes } = withExpiry(prepared.nodes, prepared.now);
  const key = nodeKey(context.binding.tenant, context.binding.projectId, String(envelopeId));
  const node = nodes.get(key);
  if (node === undefined) return fail(book, 'NODE_UNKNOWN', 'no such node in this tenant and project');
  if (node.state !== 'live') return fail(book, 'ALREADY_SETTLED', `the node already ended as ${node.state}`);
  const next = new Map(nodes);
  next.set(key, Object.freeze({ ...node, state: outcome }));
  endBelow(next, node);
  return { ok: true, book: bookOf(next, prepared.now, prepared.tombs) };
}

export type ExpireResult = { readonly ok: true; readonly book: DelegationBook; readonly expired: number } | DelegationFailure;

/** Mark every live delegate past its lease as unknown, with what is live beneath it. */
export function expireStaleDelegations(book: DelegationBook, input: DelegationContext): ExpireResult {
  const context = once(input);
  const prepared = prepare(book, context);
  if (isFailure(prepared)) return prepared;
  const { nodes, expired } = withExpiry(prepared.nodes, prepared.now);
  return { ok: true, book: expired === 0 ? book : bookOf(nodes, prepared.now, prepared.tombs), expired };
}

/** Record spend by a live node's own work, held with what it has reserved for its children to its budget. */
export function recordDelegateSpend(book: DelegationBook, input: DelegationContext, envelopeId: string, amount: number): SettleResult {
  const context = once(input);
  const prepared = prepare(book, context);
  if (isFailure(prepared)) return prepared;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1) return fail(book, 'SPEND_SHAPE', 'spend is a whole positive amount of micro-USD');
  const { nodes } = withExpiry(prepared.nodes, prepared.now);
  const key = nodeKey(context.binding.tenant, context.binding.projectId, String(envelopeId));
  const node = nodes.get(key);
  if (node === undefined) return fail(book, 'NODE_UNKNOWN', 'no such node in this tenant and project');
  if (node.state !== 'live') return fail(book, 'ALREADY_SETTLED', `the node already ended as ${node.state}`);
  if (node.spent + amount + node.reserved > node.envelope.budget) return fail(book, 'OVER_BUDGET', 'this spend, with what is reserved for children, is past the budget');
  const next = new Map(nodes);
  next.set(key, Object.freeze({ ...node, spent: node.spent + amount }));
  return { ok: true, book: bookOf(next, prepared.now, prepared.tombs) };
}

const RELEASE_FIELDS = ['envelopeId', 'tenant', 'project'] as const;

/**
 * Release the slot of an unknown delegate, on a record in the owner's form bound to this envelope id, tenant and project and
 * verified by the injected port. Its budget stays reserved. The same record cannot release another node: it names one.
 */
export function releaseDelegation(book: DelegationBook, input: DelegationContext, envelopeId: string, record: unknown, verify: OwnerFormVerifier | undefined): SettleResult {
  const context = once(input);
  const prepared = prepare(book, context);
  if (isFailure(prepared)) return prepared;
  const { nodes } = withExpiry(prepared.nodes, prepared.now);
  const key = nodeKey(context.binding.tenant, context.binding.projectId, String(envelopeId));
  const node = nodes.get(key);
  if (node === undefined) return fail(book, 'NODE_UNKNOWN', 'no such node in this tenant and project');
  if (node.state !== 'unknown' || node.released) return fail(book, 'NOT_RELEASABLE', 'only an unknown delegate that still holds its slot can be released');
  const form = readOwnerForm(record, RELEASE_FIELDS);
  if (form === null || form['envelopeId'] !== node.envelopeId || form['tenant'] !== node.tenant || form['project'] !== node.project || !verifiedByPort(verify, form)) {
    return fail(book, 'RELEASE_UNVERIFIED', 'a release is a record in the owner form, bound to this node and verified by the injected port');
  }
  const next = new Map(nodes);
  next.set(key, Object.freeze({ ...node, released: true }));
  return { ok: true, book: bookOf(next, prepared.now, prepared.tombs) };
}

export type PruneResult = { readonly ok: true; readonly book: DelegationBook; readonly pruned: number } | DelegationFailure;

/**
 * Drop every ended node (completed or failed) whose whole subtree has ended too, roots included, so the node cap is not a
 * lifetime cap. A node with an unknown or live node beneath it is kept. A pruned parent's count and reservation stay on the
 * parent. Each pruned envelope id is remembered as a tombstone until its envelope expires, so it cannot be admitted again and
 * a spent root budget cannot be reset by registering the root again. A tombstone is dropped only once its envelope has
 * expired, when it could not be admitted anyway; if the tombstones for the project are full, nothing is pruned and nothing is
 * forgotten.
 */
export function pruneSettledDelegations(book: DelegationBook, input: DelegationContext): PruneResult {
  const context = once(input);
  const prepared = prepare(book, context);
  if (isFailure(prepared)) return prepared;
  const { nodes } = withExpiry(prepared.nodes, prepared.now);
  const mine = [...nodes].filter(([, node]) => inScope(node, context.binding));
  const childrenOf = new Map<string, DelegationNode[]>();
  for (const [, node] of mine) {
    if (node.parentEnvelopeId !== null) childrenOf.set(node.parentEnvelopeId, [...(childrenOf.get(node.parentEnvelopeId) ?? []), node]);
  }
  const memo = new Map<string, boolean>();
  const prunable = (node: DelegationNode): boolean => {
    const known = memo.get(node.envelopeId);
    if (known !== undefined) return known;
    const result = (node.state === 'completed' || node.state === 'failed') && (childrenOf.get(node.envelopeId) ?? []).every(prunable);
    memo.set(node.envelopeId, result);
    return result;
  };
  const gone = mine.filter(([, node]) => prunable(node));
  const scope = scopeKey(context.binding.tenant, context.binding.projectId);
  const tombs = new Map([...prepared.tombs].filter(([, tomb]) => tomb.expiry > prepared.now));
  const held = [...tombs.values()].filter((tomb) => tomb.scope === scope).length;
  if (gone.length === 0) return { ok: true, book: tombs.size === prepared.tombs.size ? book : bookOf(nodes, prepared.now, tombs), pruned: 0 };
  if (held + gone.length > MAX_TOMBSTONES_PER_PROJECT) return fail(book, 'TOMBSTONES_FULL', 'the pruned ids this project remembers are full; nothing is pruned and nothing is forgotten to make room');
  const next = new Map(nodes);
  for (const [key, node] of gone) {
    next.delete(key);
    tombs.set(key, { expiry: Date.parse(node.envelope.expiry), scope });
  }
  return { ok: true, book: bookOf(next, prepared.now, tombs), pruned: gone.length };
}

/**
 * The node for this envelope in exactly this tenant and project, as it stands at `now`: a live delegate past its lease reads
 * as unknown. `null` when the book is not this module's, `now` is not a whole time at or after the latest the book has seen,
 * or the book holds no such node.
 */
export function delegationNodeAt(book: DelegationBook, tenant: string, project: string, envelopeId: string, now: number): DelegationNode | null {
  const held = BOOKS.get(book);
  if (held === undefined || !Number.isSafeInteger(now) || now < book.lastSeen) return null;
  return withExpiry(held.nodes, now).nodes.get(nodeKey(tenant, project, String(envelopeId))) ?? null;
}

/** A timer the caller hands in: it calls `fire` after `ms`, and the function it returns cancels that. */
export type DelegationTimer = (ms: number, fire: () => void) => () => void;

/** What the work is told. Work that sees `aborted()` should stop, because its node has been marked unknown. */
export interface RunControl {
  readonly aborted: () => boolean;
}

export type RunResult<T> =
  | { readonly ok: true; readonly value: T; readonly envelopeId: string }
  | { readonly ok: false; readonly code: DelegationCode; readonly message: string };

/**
 * Admit a delegation, run the work the caller hands in against the caller's timer, and release the slot on every path. The
 * holder is the one mutable place: its `book` is replaced, never edited. A deadline marks the node unknown and answers
 * `LAPSED` while the work may still be running; the node keeps its slot until an owner-form release. A result that arrives
 * after the node lapsed is refused, never returned. The work's error text is not passed on: it is as untrusted as its output.
 */
export async function runDelegated<T>(
  holder: { book: DelegationBook },
  input: DelegationContext,
  asked: DelegationRequest,
  work: (node: DelegationNode, control: RunControl) => Promise<T>,
  timer: DelegationTimer | undefined,
): Promise<RunResult<T>> {
  const context = once(input);
  const noTimer = (why: string): RunResult<T> => ({ ok: false, code: 'NO_TIMER', message: `a delegated run needs a working deadline timer from the caller, and ${why}; the run is not started` });
  if (typeof timer !== 'function') return noTimer('there is none');
  const control = { aborted: false };
  let fire: () => void = () => undefined;
  const deadline = new Promise<'deadline'>((resolve) => {
    fire = () => {
      control.aborted = true;
      resolve('deadline');
    };
  });
  let cancel: unknown;
  try {
    cancel = timer(DELEGATION_LEASE_MS, fire);
  } catch {
    return noTimer('the one given threw');
  }
  if (typeof cancel !== 'function') return noTimer('the one given returned no way to cancel it');
  const stop = (): void => {
    try {
      (cancel as () => void)();
    } catch {
      // a timer that cannot be cancelled changes nothing here: the node's slot is held by the book, not by the timer
    }
  };
  const admitted = admitDelegation(holder.book, context, asked);
  if (!admitted.ok) {
    stop();
    return { ok: false, code: admitted.code, message: admitted.message };
  }
  holder.book = admitted.book;
  let outcome: SettleOutcome = 'failed';
  let answer: RunResult<T>;
  try {
    const running = Promise.resolve().then(() => work(admitted.node, { aborted: () => control.aborted }));
    void running.catch(() => undefined);
    const first = await Promise.race([running.then((value) => ({ value })), deadline]);
    if (first === 'deadline') {
      outcome = 'unknown';
      answer = { ok: false, code: 'LAPSED', message: 'the delegated work passed its deadline; its node is unknown and keeps its slot until released' };
    } else {
      outcome = 'completed';
      answer = { ok: true, value: first.value, envelopeId: admitted.node.envelopeId };
    }
  } catch (error) {
    answer = { ok: false, code: 'WORK_FAILED', message: `the delegated work did not complete (${error instanceof Error ? error.name : 'not an error'})` };
  } finally {
    stop();
    const settled = settleDelegation(holder.book, context, admitted.node.envelopeId, outcome);
    if (settled.ok) holder.book = settled.book;
    else if (outcome === 'completed') outcome = 'unknown';
  }
  if (answer.ok && outcome === 'unknown') return { ok: false, code: 'LAPSED', message: 'the delegated work finished after its node lapsed; the node is unknown and the result is refused' };
  return answer;
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

/** A cut that does not leave half of a surrogate pair at the end. */
function cutAt(text: string, limit: number): string {
  const end = limit > 0 && text.charCodeAt(limit - 1) >= 0xd800 && text.charCodeAt(limit - 1) <= 0xdbff ? limit - 1 : limit;
  return text.slice(0, end);
}

/** What a delegate sent back, bounded, labelled untrusted and fenced. It is data for the parent to read, never an instruction. */
export function delegateOutput(book: DelegationBook, input: DelegationContext, envelopeId: string, text: unknown): OutputResult {
  const context = once(input);
  const prepared = prepare(book, context);
  if (isFailure(prepared)) return prepared;
  const node = prepared.nodes.get(nodeKey(context.binding.tenant, context.binding.projectId, String(envelopeId)));
  if (node === undefined) return fail(book, 'NODE_UNKNOWN', 'no such node in this tenant and project');
  if (typeof text !== 'string') return fail(book, 'OUTPUT_SHAPE', 'a delegate answers with text');
  const truncated = text.length > MAX_DELEGATE_OUTPUT_CHARS;
  const body = truncated ? cutAt(text, MAX_DELEGATE_OUTPUT_CHARS) : text;
  const fence = `delegate-output:sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
  const label = `tenant=${node.tenant} project=${node.project} agent=${node.agentId} envelope=${node.envelopeId} trust=untrusted-data`;
  const fenced = `<<<BEGIN ${fence} ${label}>>>\n${body}\n<<<END ${fence}>>>`;
  return { ok: true, output: { trust: 'untrusted-data', tenant: node.tenant, project: node.project, agentId: node.agentId, envelopeId: node.envelopeId, text: body, truncated, fence, fenced } };
}

// ---------------------------------------------------------------------------------------------------------
// Export and restore
// ---------------------------------------------------------------------------------------------------------

/** A book's nodes for one tenant and project, as plain data a store can keep. */
export interface DelegationSnapshot {
  readonly lastSeen: number;
  readonly nodes: readonly Readonly<Record<string, unknown>>[];
  /** The pruned envelope ids of the scope, each with the instant its envelope expires. */
  readonly tombstones: readonly Readonly<{ envelopeId: string; expiry: number }>[];
}

/** The nodes of `binding`'s tenant and project as plain data, or `null` when the book is not this module's. */
export function exportDelegationBook(book: DelegationBook, binding: TenantBinding): DelegationSnapshot | null {
  const held = BOOKS.get(book);
  if (held === undefined || !isDerivedBinding(binding)) return null;
  const nodes = [...held.nodes.values()].filter((node) => inScope(node, binding)).map((node) => ({ ...node }));
  const scope = scopeKey(binding.tenant, binding.projectId);
  const tombstones = [...held.tombs].filter(([, tomb]) => tomb.scope === scope).map(([key, tomb]) => ({ envelopeId: (JSON.parse(key) as string[])[2] as string, expiry: tomb.expiry }));
  return { lastSeen: book.lastSeen, nodes, tombstones };
}

const NODE_FIELDS = [
  'tenant', 'project', 'envelopeId', 'parentEnvelopeId', 'rootEnvelopeId', 'agentId', 'recordHash', 'depth', 'lineage', 'grants', 'goal', 'envelope',
  'reserved', 'spent', 'children', 'state', 'released', 'admittedAt',
] as const;
const RECORD_HASH = /^sha256:[0-9a-f]{64}$/;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isWords = (value: unknown): value is readonly string[] => Array.isArray(value) && (value as readonly unknown[]).every((entry) => typeof entry === 'string');

function restoredNode(raw: unknown, context: DelegationContext): DelegationNode | null {
  const fields = snapshotOf(raw, NODE_FIELDS);
  if (fields === null) return null;
  const plain = snapshotEnvelope(fields['envelope']);
  const parsed = plain === null ? null : parseEnvelope(plain);
  if (parsed === null || !parsed.ok) return null;
  const { binding } = context;
  const envelope = parsed.envelope;
  const ok =
    fields['tenant'] === binding.tenant && fields['project'] === binding.projectId && envelope.tenant === binding.tenant && envelope.project === binding.projectId &&
    fields['envelopeId'] === envelope.envelopeId && (fields['parentEnvelopeId'] === null || typeof fields['parentEnvelopeId'] === 'string') &&
    fields['parentEnvelopeId'] === envelope.parentEnvelopeId && typeof fields['rootEnvelopeId'] === 'string' && typeof fields['agentId'] === 'string' &&
    typeof fields['recordHash'] === 'string' && RECORD_HASH.test(fields['recordHash']) && isCount(fields['depth']) && fields['depth'] <= MAX_DELEGATION_DEPTH &&
    isWords(fields['lineage']) && isWords(fields['grants']) && typeof fields['goal'] === 'string' && isCount(fields['reserved']) && isCount(fields['spent']) &&
    isCount(fields['children']) && NODE_STATES.includes(fields['state'] as NodeState) && typeof fields['released'] === 'boolean' && isCount(fields['admittedAt']);
  if (!ok) return null;
  const record = findAgent(context.agents, binding.tenant, binding.projectId, fields['agentId'] as string);
  if (record === null || record.recordHash !== fields['recordHash']) return null;
  return Object.freeze({
    ...(fields as unknown as DelegationNode),
    lineage: Object.freeze([...(fields['lineage'] as readonly string[])]),
    grants: Object.freeze([...(fields['grants'] as readonly string[])]),
    envelope,
  });
}

/** The tree invariants the rules could have produced: parents present, depth, lineage, counts, reservations and caps all agree. */
function restoredTreeProblem(nodes: ReadonlyMap<string, DelegationNode>, context: DelegationContext): string | null {
  const byId = new Map([...nodes.values()].map((node) => [node.envelopeId, node]));
  if (nodes.size > MAX_DELEGATION_NODES_PER_PROJECT) return 'more nodes than a project may hold';
  const slots = [...nodes.values()].filter((node) => node.depth > 0 && holdsSlot(node));
  if (slots.length > MAX_LIVE_DELEGATES_PER_PROJECT) return 'more slots held than a project allows';
  for (const node of nodes.values()) {
    const kids = [...nodes.values()].filter((other) => other.parentEnvelopeId === node.envelopeId);
    if (node.children < kids.length || node.children > MAX_CHILDREN_PER_PARENT) return `'${node.envelopeId}' has an impossible child count`;
    if (node.reserved < kids.reduce((sum, kid) => sum + kid.envelope.budget, 0) || node.reserved + node.spent > node.envelope.budget) return `'${node.envelopeId}' has an impossible reservation`;
    if (slots.filter((other) => other.rootEnvelopeId === node.rootEnvelopeId).length > MAX_LIVE_DELEGATES_PER_ROOT) return 'more slots held under one root than allowed';
    if (node.parentEnvelopeId === null) {
      if (node.depth !== 0 || node.rootEnvelopeId !== node.envelopeId || node.lineage.length !== 1 || node.lineage[0] !== node.agentId) return `'${node.envelopeId}' is not a consistent root`;
      const resolved = resolveAction(context.registry, node.envelope.action);
      if (resolved.actionClass !== node.envelope.actionClass || resolved.environment !== node.envelope.environment) return `'${node.envelopeId}' has labels the registry does not give its action`;
      if (node.envelope.action !== RUN_ACTION || node.envelope.actor.agent !== node.agentId) return `'${node.envelopeId}' is not the kernel's run envelope of its agent`;
      continue;
    }
    const parent = byId.get(node.parentEnvelopeId);
    if (parent === undefined) return `'${node.envelopeId}' has no parent in the snapshot`;
    if (node.depth !== parent.depth + 1 || node.rootEnvelopeId !== parent.rootEnvelopeId || node.lineage.join('\u0000') !== [...parent.lineage, node.agentId].join('\u0000')) {
      return `'${node.envelopeId}' does not follow from its parent`;
    }
    if (parent.lineage.includes(node.agentId)) return `'${node.envelopeId}' is a cycle`;
    if (!checkChildEnvelope(parent.envelope, node.envelope, context.registry).ok || !classAtMost(resolveAction(context.registry, node.envelope.action).actionClass, DELEGATED_CLASS_CEILING)) {
      return `'${node.envelopeId}' holds more than its parent`;
    }
    if (node.grants.some((grant) => !parent.grants.includes(grant))) return `'${node.envelopeId}' holds a grant its parent lacks`;
    if (node.grants.some(isBlockedGrant)) return `'${node.envelopeId}' holds a grant no delegate holds`;
  }
  return null;
}

export type RestoreResult =
  | { readonly ok: true; readonly book: DelegationBook }
  | { readonly ok: false; readonly code: DelegationCode; readonly message: string };

/**
 * Bring a book back from a store. The injected verifier must answer exactly `true` for the snapshot (it should compare it to
 * what the store's own record says was exported), and every node must then pass the shape and tree checks above, in the
 * binding's tenant and project, against the agent book and the clock. With no verifier the snapshot is refused.
 */
export function restoreDelegationBook(input: DelegationContext, raw: unknown, verify: ((snapshot: unknown) => boolean) | undefined): RestoreResult {
  const context = once(input);
  const no = (code: DelegationCode, message: string): RestoreResult => ({ ok: false, code, message });
  if (!isDerivedBinding(context.binding)) return no('BINDING', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  if (!isAgentBook(context.agents)) return no('AGENT_BOOK', 'the agent book was not built by this module');
  // Everything the caller handed in is copied once, deeply, into frozen plain data. The verifier is shown that copy and the book is
  // built from that copy and nothing else, so an array or an object that answers differently on a second read changes nothing.
  const copy = deepSnapshot(raw);
  const top = copy === undefined ? null : snapshotOf(copy, ['lastSeen', 'nodes', 'tombstones']);
  if (copy === undefined || top === null || !isCount(top['lastSeen']) || !Array.isArray(top['nodes']) || top['nodes'].length > MAX_DELEGATION_NODES_PER_PROJECT || !Array.isArray(top['tombstones']) || top['tombstones'].length > MAX_TOMBSTONES_PER_PROJECT) {
    return no('SNAPSHOT_SHAPE', 'a snapshot is plain data: a time, a bounded list of nodes and a bounded list of pruned ids');
  }
  let verified = false;
  try {
    verified = typeof verify === 'function' && verify(copy) === true;
  } catch {
    verified = false;
  }
  if (!verified) return no('SNAPSHOT_UNVERIFIED', 'a snapshot is restored only when the injected verifier answers exactly true for it');
  const now = readClock(context.clock, top['lastSeen']);
  if (now === null) return no('CLOCK', 'the clock gave no usable time, or a time before the snapshot was taken');
  const nodes = new Map<string, DelegationNode>();
  for (const entry of top['nodes'] as readonly unknown[]) {
    const node = restoredNode(entry, context);
    if (node === null) return no('SNAPSHOT_SHAPE', 'a node in the snapshot is not one these rules could have produced');
    const key = nodeKey(node.tenant, node.project, node.envelopeId);
    if (nodes.has(key)) return no('SNAPSHOT_INVARIANT', 'an envelope id appears twice');
    nodes.set(key, node);
  }
  const scope = scopeKey(context.binding.tenant, context.binding.projectId);
  const tombs = new Map<string, Tombstone>();
  for (const entry of top['tombstones'] as readonly unknown[]) {
    const tomb = snapshotOf(entry, ['envelopeId', 'expiry']);
    if (tomb === null || typeof tomb['envelopeId'] !== 'string' || !isCount(tomb['expiry'])) return no('SNAPSHOT_SHAPE', 'a pruned id is an envelope id and the instant its envelope expires');
    const key = nodeKey(context.binding.tenant, context.binding.projectId, tomb['envelopeId']);
    if (nodes.has(key) || tombs.has(key)) return no('SNAPSHOT_INVARIANT', 'a pruned id is also in the book, or appears twice');
    tombs.set(key, { expiry: tomb['expiry'], scope });
  }
  const problem = restoredTreeProblem(nodes, context);
  return problem === null ? { ok: true, book: bookOf(nodes, top['lastSeen'], tombs) } : no('SNAPSHOT_INVARIANT', problem);
}
