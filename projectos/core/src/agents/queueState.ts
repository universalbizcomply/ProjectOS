// SPDX-License-Identifier: MIT
// Ported-From: hermes-agent https://github.com/NousResearch/hermes-agent
// Source-Path: tools/async_delegation.py
// Source-Commit: d3e586881eacb132595edcbe4c170be8381e40c5
// Source-Copyright: Copyright (c) 2025 Nous Research
// Port-Strategy: TRANSLATE
// Modified-By: ProjectOS 2026-11-14: modified for ProjectOS. CHANGED: translated from Python to TypeScript; only the recovery rule is taken, that a delegation still running whose owner has gone is classified outcome unknown and is not re-dispatched by the rule; the SQLite ledger, the owner process liveness probe, the worker threads, the orphan sweep and the completion delivery claims are cut; the owner being gone is a lease that ends by an injected clock; a lease is whole milliseconds the rules set and no caller supplies; the states, the pause rules and the owner-form resolution of an unknown item are original to ProjectOS
// Notice: full licence text in THIRD_PARTY_NOTICES

/**
 * Queue-state rules: how one queue item may move, as pure functions the workforce dispatch can adopt in a later stage.
 *
 * THIS IS NOT A QUEUE. Nothing here stores an item, runs one, sets a timer or wakes anything. An item is a value, each
 * function takes one and returns the next, and the dispatch that owns the one real queue (`agent/src/workforce/`) decides
 * when to ask. There is no store, no loop and no dispatcher in this file, and the validator refuses one.
 *
 * AN ITEM MOVES ONLY BY THESE RULES. queued -> running by a claim; running -> completed or failed by the executor;
 * queued <-> paused; queued or paused -> cancelled; running -> unknown by crash recovery; unknown -> queued or failed by a
 * record in the owner's form. Everything else is refused as a bad transition, so a finished item never runs again.
 *
 * A RUNNING ITEM IS POSSIBLY ACTED. Crash recovery moves a running item whose lease has ended to `unknown`, never back to
 * `queued`: it may have acted before it was lost, so nothing here retries it. Only a resolution in the owner's form moves an
 * unknown item, and a requeue is refused once its attempts are used up. A running item cannot be paused either: it belongs
 * to its executor, and a pause would be a guess about what it has already done.
 *
 * THE COUNT, THE LEASE AND THE SCOPE ARE THE RULES'. The attempt count lives in the item and only a claim raises it; the
 * lease is a constant the claim sets; an item is stamped with the tenant and project of a derived binding, and every move
 * checks them again. An item read back from a store goes through `restoreQueueItem`, which holds it to the invariants these
 * rules could have produced. The clock is injected, whole and never behind the item's last change.
 *
 * A PAUSE IS A SCOPE'S AND NEVER LAPSES. `pauseScope` records a tenant and project as paused until `resumeScope`. Only a
 * derived binding can be paused, so the set is bounded by the tenant registry, and nothing is ever dropped from it, because a
 * dropped pause would be a resume nobody asked for. A control this module did not build reads as paused.
 *
 * WHAT THIS MODULE CANNOT PROVE. A resolution names a plan decision in the owner's form; whether that decision exists is for
 * the wiring to check, so the record is not an approval. A restored item is only as trustworthy as the store it came from:
 * the rules refuse an item they could not have produced, not one that was edited to a state they could. Pure: no I/O.
 */
import { isDerivedBinding, type TenantBinding } from '../tenant.js';
import { scopeKey } from './agentBook.js';
import { readClock, type Clock } from './clockGuard.js';
import { MAX_QUEUE_ATTEMPTS, QUEUE_LEASE_MS } from './delegationLimits.js';
import { snapshotOf } from './plainRecords.js';

export type QueueStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'unknown' | 'cancelled';
const STATUSES: readonly QueueStatus[] = ['queued', 'running', 'paused', 'completed', 'failed', 'unknown', 'cancelled'];

export interface QueueItem {
  readonly tenant: string;
  readonly project: string;
  readonly itemId: string;
  readonly status: QueueStatus;
  /** Raised only by a claim. */
  readonly attempts: number;
  /** Set by a claim, `null` otherwise. */
  readonly leaseExpiresAt: number | null;
  readonly updatedAt: number;
}

export interface QueueContext {
  readonly binding: TenantBinding;
  readonly clock: Clock;
}

export type QueueCode =
  | 'BINDING'
  | 'CLOCK'
  | 'ITEM_SHAPE'
  | 'ITEM_NOT_ADMITTED'
  | 'ITEM_SCOPE'
  | 'BAD_TRANSITION'
  | 'SCOPE_PAUSED'
  | 'ATTEMPTS_EXHAUSTED'
  | 'OUTCOME'
  | 'RESOLUTION'
  | 'CONTROL';

export type QueueFailure = { readonly ok: false; readonly code: QueueCode; readonly message: string };
export type QueueResult = { readonly ok: true; readonly item: QueueItem } | QueueFailure;

const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DECISION_ID = /^PLANDEC-[A-Za-z0-9-]{1,64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ITEM_FIELDS = ['tenant', 'project', 'itemId', 'status', 'attempts', 'leaseExpiresAt', 'updatedAt'] as const;
const RESOLUTION_FIELDS = ['decisionId', 'decidedBy', 'planDigest', 'outcome'] as const;

const ADMITTED = new WeakSet<object>();

const no = (code: QueueCode, message: string): QueueFailure => ({ ok: false, code, message });

function admit(item: QueueItem): QueueResult {
  const frozen: QueueItem = Object.freeze({ ...item });
  ADMITTED.add(frozen);
  return { ok: true, item: frozen };
}

/** The checks every move starts with, in this order. Returns the time to stamp, or the refusal. */
function ready(context: QueueContext, item: QueueItem | null): number | QueueFailure {
  if (!isDerivedBinding(context.binding)) return no('BINDING', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  if (item !== null && !ADMITTED.has(item)) return no('ITEM_NOT_ADMITTED', 'this item was not produced by these rules, so its attempts and lease are claims');
  const now = readClock(context.clock, item?.updatedAt ?? 0);
  if (now === null) return no('CLOCK', "the clock gave no usable time, or a time before the item's last change");
  if (item !== null && (item.tenant !== context.binding.tenant || item.project !== context.binding.projectId)) {
    return no('ITEM_SCOPE', "the item is not in the binding's tenant and project");
  }
  return now;
}

const isRefusal = (value: number | QueueFailure): value is QueueFailure => typeof value !== 'number';

/** Move an item from one of `from` to `to`, stamping the time. */
function move(context: QueueContext, item: QueueItem, from: readonly QueueStatus[], to: QueueStatus): QueueResult {
  const now = ready(context, item);
  if (isRefusal(now)) return now;
  if (!from.includes(item.status)) return no('BAD_TRANSITION', `an item that is ${item.status} cannot become ${to}`);
  return admit({ ...item, status: to, leaseExpiresAt: null, updatedAt: now });
}

/** A new item, queued, with no attempts, in the tenant and project of the binding. */
export function newQueueItem(context: QueueContext, itemId: string): QueueResult {
  const now = ready(context, null);
  if (isRefusal(now)) return now;
  if (typeof itemId !== 'string' || !ITEM_ID.test(itemId)) return no('ITEM_SHAPE', 'an item id is one plain word');
  return admit({ tenant: context.binding.tenant, project: context.binding.projectId, itemId, status: 'queued', attempts: 0, leaseExpiresAt: null, updatedAt: now });
}

/** An opaque set of paused scopes. */
export interface QueueControl {
  readonly size: number;
}

const CONTROLS = new WeakMap<QueueControl, ReadonlySet<string>>();

function controlOf(scopes: ReadonlySet<string>): QueueControl {
  const control: QueueControl = Object.freeze({ size: scopes.size });
  CONTROLS.set(control, scopes);
  return control;
}

export const emptyQueueControl = (): QueueControl => controlOf(new Set());

export type ControlResult = { readonly ok: true; readonly control: QueueControl } | QueueFailure;

/** Is this scope paused? A control this module did not build, or a binding it did not derive, reads as paused. */
export function isScopePaused(control: QueueControl, binding: TenantBinding): boolean {
  const paused = CONTROLS.get(control);
  if (paused === undefined || !isDerivedBinding(binding)) return true;
  return paused.has(scopeKey(binding.tenant, binding.projectId));
}

/** Pause the tenant and project of the binding until `resumeScope`. Pausing twice is the same pause. */
export function pauseScope(context: QueueContext, control: QueueControl): ControlResult {
  const paused = CONTROLS.get(control);
  if (paused === undefined) return no('CONTROL', 'this control was not built by this module');
  if (!isDerivedBinding(context.binding)) return no('BINDING', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  const key = scopeKey(context.binding.tenant, context.binding.projectId);
  if (paused.has(key)) return { ok: true, control };
  return { ok: true, control: controlOf(new Set([...paused, key])) };
}

/** Resume the tenant and project of the binding. */
export function resumeScope(context: QueueContext, control: QueueControl): ControlResult {
  const paused = CONTROLS.get(control);
  if (paused === undefined) return no('CONTROL', 'this control was not built by this module');
  if (!isDerivedBinding(context.binding)) return no('BINDING', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  const key = scopeKey(context.binding.tenant, context.binding.projectId);
  return { ok: true, control: controlOf(new Set([...paused].filter((entry) => entry !== key))) };
}

/** Claim a queued item: it runs, with one more attempt and a lease that ends at a time the rules set. */
export function claimItem(context: QueueContext, control: QueueControl, item: QueueItem): QueueResult {
  const now = ready(context, item);
  if (isRefusal(now)) return now;
  if (!CONTROLS.has(control)) return no('CONTROL', 'this control was not built by this module');
  if (isScopePaused(control, context.binding)) return no('SCOPE_PAUSED', 'this tenant and project are paused');
  if (item.status !== 'queued') return no('BAD_TRANSITION', `an item that is ${item.status} cannot be claimed`);
  if (item.attempts >= MAX_QUEUE_ATTEMPTS) return no('ATTEMPTS_EXHAUSTED', `an item is claimed at most ${MAX_QUEUE_ATTEMPTS} times`);
  return admit({ ...item, status: 'running', attempts: item.attempts + 1, leaseExpiresAt: now + QUEUE_LEASE_MS, updatedAt: now });
}

/** End a running item as completed or failed. */
export function completeItem(context: QueueContext, item: QueueItem, outcome: 'completed' | 'failed'): QueueResult {
  if (outcome !== 'completed' && outcome !== 'failed') return no('OUTCOME', "an item ends as 'completed' or 'failed'");
  return move(context, item, ['running'], outcome);
}

/** Pause a queued item. A running item is not paused. */
export const pauseItem = (context: QueueContext, item: QueueItem): QueueResult => move(context, item, ['queued'], 'paused');

/** Resume a paused item to queued. */
export const resumeItem = (context: QueueContext, item: QueueItem): QueueResult => move(context, item, ['paused'], 'queued');

/** Cancel a queued or paused item. */
export const cancelItem = (context: QueueContext, item: QueueItem): QueueResult => move(context, item, ['queued', 'paused'], 'cancelled');

export type RecoverResult = { readonly ok: true; readonly item: QueueItem; readonly recovered: boolean } | QueueFailure;

/**
 * Crash recovery: a running item whose lease has ended is unknown. It is not queued again, because it may have acted. Any
 * other item is returned as it is.
 */
export function recoverAbandoned(context: QueueContext, item: QueueItem): RecoverResult {
  const now = ready(context, item);
  if (isRefusal(now)) return now;
  if (item.status !== 'running' || item.leaseExpiresAt === null || now < item.leaseExpiresAt) return { ok: true, item, recovered: false };
  const moved = admit({ ...item, status: 'unknown', leaseExpiresAt: null, updatedAt: now });
  return moved.ok ? { ok: true, item: moved.item, recovered: true } : moved;
}

export interface UnknownResolution {
  readonly decisionId: string;
  readonly decidedBy: 'owner';
  readonly planDigest: string;
  readonly outcome: 'requeue' | 'abandon';
}

/**
 * Resolve an unknown item on a record in the owner's form: a requeue puts it back in the queue with its attempts kept, an
 * abandon fails it. The record names a plan decision and says the owner decided; that is a well-formed record and not an
 * approval, and whether the decision exists is the wiring's to check.
 */
export function resolveUnknown(context: QueueContext, item: QueueItem, resolution: UnknownResolution): QueueResult {
  const now = ready(context, item);
  if (isRefusal(now)) return now;
  if (item.status !== 'unknown') return no('BAD_TRANSITION', `an item that is ${item.status} is not unknown`);
  const fields = snapshotOf(resolution, RESOLUTION_FIELDS);
  const named =
    fields !== null &&
    typeof fields['decisionId'] === 'string' &&
    DECISION_ID.test(fields['decisionId']) &&
    fields['decidedBy'] === 'owner' &&
    typeof fields['planDigest'] === 'string' &&
    DIGEST.test(fields['planDigest']);
  if (fields === null || !named || (fields['outcome'] !== 'requeue' && fields['outcome'] !== 'abandon')) {
    return no('RESOLUTION', 'a resolution names a plan decision, says the owner decided and carries a plan digest and an outcome');
  }
  if (fields['outcome'] === 'abandon') return admit({ ...item, status: 'failed', leaseExpiresAt: null, updatedAt: now });
  if (item.attempts >= MAX_QUEUE_ATTEMPTS) return no('ATTEMPTS_EXHAUSTED', 'the attempts are used up; the item can only be abandoned');
  return admit({ ...item, status: 'queued', leaseExpiresAt: null, updatedAt: now });
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function shapeProblem(fields: Record<string, unknown>): boolean {
  const { itemId, status, attempts, leaseExpiresAt, updatedAt } = fields;
  if (typeof itemId !== 'string' || !ITEM_ID.test(itemId)) return true;
  if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) return true;
  if (!isCount(attempts) || attempts > MAX_QUEUE_ATTEMPTS || !isCount(updatedAt)) return true;
  if (status === 'running') return attempts < 1 || leaseExpiresAt !== updatedAt + QUEUE_LEASE_MS;
  return leaseExpiresAt !== null;
}

/** Read an item back from a store, held to the invariants these rules could have produced. It must be in the binding's scope. */
export function restoreQueueItem(context: QueueContext, raw: unknown): QueueResult {
  if (!isDerivedBinding(context.binding)) return no('BINDING', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  const fields = snapshotOf(raw, ITEM_FIELDS);
  if (fields === null || shapeProblem(fields)) return no('ITEM_SHAPE', 'the item is not one these rules could have produced');
  if (fields['tenant'] !== context.binding.tenant || fields['project'] !== context.binding.projectId) return no('ITEM_SCOPE', "the item is not in the binding's tenant and project");
  const now = readClock(context.clock, fields['updatedAt'] as number);
  if (now === null) return no('CLOCK', "the clock gave no usable time, or a time before the item's last change");
  return admit(fields as unknown as QueueItem);
}
