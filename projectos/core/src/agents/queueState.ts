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
 * record in the owner's form that the caller's port verifies. Everything else is refused as a bad transition, so a finished
 * item never runs again.
 *
 * A RUNNING ITEM IS POSSIBLY ACTED. Crash recovery moves a running item whose lease has ended to `unknown`, never back to
 * `queued`: it may have acted before it was lost, so nothing here retries it. An item that was ever unknown remembers it, and
 * it leaves unknown only with a resolution that names its item id, its tenant and project and the revision it was unknown at,
 * so the same record cannot resolve another item or the same item twice. The resolution must be verified by an injected port
 * that answers exactly `true`; with no port it is refused. A running item cannot be paused: it belongs to its executor.
 *
 * THE COUNT, THE LEASE, THE REVISION AND THE SCOPE ARE THE RULES'. The attempt count lives in the item and only a claim
 * raises it; the lease is a constant the claim sets and a running item may renew it a bounded number of times, so a long run is
 * not lost while it renews and a stuck one still ends; every move bumps a revision, and a caller states the revision it
 * expects from its store, so a stale copy is refused instead of overwriting a newer one; an item is stamped with the tenant
 * and project of a derived binding, and every move checks them again. An item read back from a store goes through
 * `restoreQueueItem`, which holds it to the invariants these rules could have produced, and refuses a formerly unknown item
 * unless its resolution verifies. The clock is injected, whole and never behind the item's last change.
 *
 * A PAUSE IS A SCOPE'S AND NEVER LAPSES. `pauseScope` records a tenant and project as paused until `resumeScope`. Only a
 * derived binding can be paused, so the set is bounded by the tenant registry, and nothing is ever dropped from it, because a
 * dropped pause would be a resume nobody asked for. A control this module did not build reads as paused.
 *
 * WHAT THIS MODULE CANNOT PROVE. A resolution is a record in the owner's form that a port vouches for: whether the port looks
 * the decision up in the committed plan-decision records is the wiring's, so the record is not an approval by itself. A
 * restored item is only as trustworthy as the store it came from: the rules refuse an item they could not have produced, not
 * one edited to a state they could. The revision is only a compare-and-swap if the store compares it. Pure: no I/O.
 */
import { isDerivedBinding, type TenantBinding } from '../tenant.js';
import { scopeKey } from './agentBook.js';
import { readClock, type Clock } from './clockGuard.js';
import { MAX_LEASE_RENEWALS, MAX_QUEUE_ATTEMPTS, QUEUE_LEASE_MS } from './delegationLimits.js';
import { readOwnerForm, verifiedByPort, type OwnerFormVerifier } from './ownerForm.js';
import { snapshotOf } from './plainRecords.js';

export type QueueStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'unknown' | 'cancelled';
const STATUSES: readonly QueueStatus[] = ['queued', 'running', 'paused', 'completed', 'failed', 'unknown', 'cancelled'];

/** The record that moved an item out of unknown, as the item keeps it. */
export interface UnknownResolution {
  readonly decisionId: string;
  readonly decidedBy: 'owner';
  readonly planDigest: string;
  readonly outcome: 'requeue' | 'abandon';
  readonly itemId: string;
  readonly tenant: string;
  readonly project: string;
  /** The revision the item had while it was unknown. */
  readonly revision: number;
}

export interface QueueItem {
  readonly tenant: string;
  readonly project: string;
  readonly itemId: string;
  readonly status: QueueStatus;
  /** Raised only by a claim. */
  readonly attempts: number;
  /** Set by a claim or a renewal, `null` otherwise. */
  readonly leaseExpiresAt: number | null;
  readonly updatedAt: number;
  /** Raised by every move. A caller states the one it expects. */
  readonly revision: number;
  /** How many times the running lease was renewed. */
  readonly renewals: number;
  /** True from the moment the item was first unknown, for good. */
  readonly wasUnknown: boolean;
  /** The record that resolved it, once it was unknown and left that state. */
  readonly resolution: UnknownResolution | null;
}

export interface QueueContext {
  readonly binding: TenantBinding;
  readonly clock: Clock;
  /** Vouches for a resolution record. With none, an unknown item cannot be resolved or restored. */
  readonly verifyResolution?: OwnerFormVerifier;
  /** Vouches for a stored item, by the store's own authentication. Required to restore anything but an unstarted queued item. */
  readonly verifyItem?: OwnerFormVerifier;
}

export type QueueCode =
  | 'BINDING'
  | 'CLOCK'
  | 'ITEM_SHAPE'
  | 'ITEM_NOT_ADMITTED'
  | 'ITEM_SCOPE'
  | 'STALE_REVISION'
  | 'BAD_TRANSITION'
  | 'SCOPE_PAUSED'
  | 'ATTEMPTS_EXHAUSTED'
  | 'RENEWAL_REFUSED'
  | 'OUTCOME'
  | 'RESOLUTION'
  | 'RESOLUTION_UNVERIFIED'
  | 'ITEM_UNVERIFIED'
  | 'CONTROL';

export type QueueFailure = { readonly ok: false; readonly code: QueueCode; readonly message: string };
export type QueueResult = { readonly ok: true; readonly item: QueueItem } | QueueFailure;

const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ITEM_FIELDS = ['tenant', 'project', 'itemId', 'status', 'attempts', 'leaseExpiresAt', 'updatedAt', 'revision', 'renewals', 'wasUnknown', 'resolution'] as const;
const RESOLUTION_EXTRA = ['outcome', 'itemId', 'tenant', 'project', 'revision'] as const;

const ADMITTED = new WeakSet<object>();

const no = (code: QueueCode, message: string): QueueFailure => ({ ok: false, code, message });
const once = (input: QueueContext): QueueContext => Object.freeze({ ...input });

function admit(item: QueueItem): QueueResult {
  const frozen: QueueItem = Object.freeze({ ...item });
  ADMITTED.add(frozen);
  return { ok: true, item: frozen };
}

/** The checks every move starts with, in this order. Returns the time to stamp, or the refusal. */
function ready(context: QueueContext, item: QueueItem | null, expectedRevision?: number): number | QueueFailure {
  if (!isDerivedBinding(context.binding)) return no('BINDING', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  if (item !== null && !ADMITTED.has(item)) return no('ITEM_NOT_ADMITTED', 'this item was not produced by these rules, so its attempts and lease are claims');
  const now = readClock(context.clock, item?.updatedAt ?? 0);
  if (now === null) return no('CLOCK', "the clock gave no usable time, or a time before the item's last change");
  if (item !== null && (item.tenant !== context.binding.tenant || item.project !== context.binding.projectId)) {
    return no('ITEM_SCOPE', "the item is not in the binding's tenant and project");
  }
  if (item !== null && item.revision !== expectedRevision) return no('STALE_REVISION', `the item is at revision ${item.revision}, not the ${String(expectedRevision)} the caller expected`);
  return now;
}

const isRefusal = (value: number | QueueFailure): value is QueueFailure => typeof value !== 'number';

/** Move an item from one of `from` to `to`, stamping the time and the next revision. */
function move(input: QueueContext, item: QueueItem, expectedRevision: number, from: readonly QueueStatus[], to: QueueStatus): QueueResult {
  const context = once(input);
  const now = ready(context, item, expectedRevision);
  if (isRefusal(now)) return now;
  if (!from.includes(item.status)) return no('BAD_TRANSITION', `an item that is ${item.status} cannot become ${to}`);
  return admit({ ...item, status: to, leaseExpiresAt: null, updatedAt: now, revision: item.revision + 1 });
}

/** A new item, queued, with no attempts, in the tenant and project of the binding. */
export function newQueueItem(input: QueueContext, itemId: string): QueueResult {
  const context = once(input);
  const now = ready(context, null);
  if (isRefusal(now)) return now;
  if (typeof itemId !== 'string' || !ITEM_ID.test(itemId)) return no('ITEM_SHAPE', 'an item id is one plain word');
  return admit({
    tenant: context.binding.tenant, project: context.binding.projectId, itemId, status: 'queued', attempts: 0, leaseExpiresAt: null, updatedAt: now,
    revision: 0, renewals: 0, wasUnknown: false, resolution: null,
  });
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
export function pauseScope(input: QueueContext, control: QueueControl): ControlResult {
  const context = once(input);
  const paused = CONTROLS.get(control);
  if (paused === undefined) return no('CONTROL', 'this control was not built by this module');
  if (!isDerivedBinding(context.binding)) return no('BINDING', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  const key = scopeKey(context.binding.tenant, context.binding.projectId);
  if (paused.has(key)) return { ok: true, control };
  return { ok: true, control: controlOf(new Set([...paused, key])) };
}

/** Resume the tenant and project of the binding. */
export function resumeScope(input: QueueContext, control: QueueControl): ControlResult {
  const context = once(input);
  const paused = CONTROLS.get(control);
  if (paused === undefined) return no('CONTROL', 'this control was not built by this module');
  if (!isDerivedBinding(context.binding)) return no('BINDING', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  const key = scopeKey(context.binding.tenant, context.binding.projectId);
  return { ok: true, control: controlOf(new Set([...paused].filter((entry) => entry !== key))) };
}

/** Claim a queued item: it runs, with one more attempt and a lease that ends at a time the rules set. */
export function claimItem(input: QueueContext, control: QueueControl, item: QueueItem, expectedRevision: number): QueueResult {
  const context = once(input);
  const now = ready(context, item, expectedRevision);
  if (isRefusal(now)) return now;
  if (!CONTROLS.has(control)) return no('CONTROL', 'this control was not built by this module');
  if (isScopePaused(control, context.binding)) return no('SCOPE_PAUSED', 'this tenant and project are paused');
  if (item.status !== 'queued') return no('BAD_TRANSITION', `an item that is ${item.status} cannot be claimed`);
  if (item.attempts >= MAX_QUEUE_ATTEMPTS) return no('ATTEMPTS_EXHAUSTED', `an item is claimed at most ${MAX_QUEUE_ATTEMPTS} times`);
  return admit({ ...item, status: 'running', attempts: item.attempts + 1, leaseExpiresAt: now + QUEUE_LEASE_MS, updatedAt: now, revision: item.revision + 1, renewals: 0 });
}

/** Renew the lease of a running item that has not yet lost it, a bounded number of times. */
export function renewLease(input: QueueContext, item: QueueItem, expectedRevision: number): QueueResult {
  const context = once(input);
  const now = ready(context, item, expectedRevision);
  if (isRefusal(now)) return now;
  if (item.status !== 'running' || item.leaseExpiresAt === null) return no('BAD_TRANSITION', `an item that is ${item.status} has no lease to renew`);
  if (now >= item.leaseExpiresAt) return no('RENEWAL_REFUSED', 'the lease has already ended; recovery, not a renewal, decides what happens to the item');
  if (item.renewals >= MAX_LEASE_RENEWALS) return no('RENEWAL_REFUSED', `a lease is renewed at most ${MAX_LEASE_RENEWALS} times`);
  return admit({ ...item, leaseExpiresAt: now + QUEUE_LEASE_MS, updatedAt: now, revision: item.revision + 1, renewals: item.renewals + 1 });
}

/** End a running item as completed or failed. */
export function completeItem(input: QueueContext, item: QueueItem, outcome: 'completed' | 'failed', expectedRevision: number): QueueResult {
  if (outcome !== 'completed' && outcome !== 'failed') return no('OUTCOME', "an item ends as 'completed' or 'failed'");
  return move(input, item, expectedRevision, ['running'], outcome);
}

/** Pause a queued item. A running item is not paused. */
export const pauseItem = (input: QueueContext, item: QueueItem, expectedRevision: number): QueueResult => move(input, item, expectedRevision, ['queued'], 'paused');

/** Resume a paused item to queued. */
export const resumeItem = (input: QueueContext, item: QueueItem, expectedRevision: number): QueueResult => move(input, item, expectedRevision, ['paused'], 'queued');

/** Cancel a queued or paused item. */
export const cancelItem = (input: QueueContext, item: QueueItem, expectedRevision: number): QueueResult => move(input, item, expectedRevision, ['queued', 'paused'], 'cancelled');

export type RecoverResult = { readonly ok: true; readonly item: QueueItem; readonly recovered: boolean } | QueueFailure;

/**
 * Crash recovery: a running item whose lease has ended is unknown. It is not queued again, because it may have acted. Any
 * other item is returned as it is.
 */
export function recoverAbandoned(input: QueueContext, item: QueueItem, expectedRevision: number): RecoverResult {
  const context = once(input);
  const now = ready(context, item, expectedRevision);
  if (isRefusal(now)) return now;
  if (item.status !== 'running' || item.leaseExpiresAt === null || now < item.leaseExpiresAt) return { ok: true, item, recovered: false };
  const moved = admit({ ...item, status: 'unknown', leaseExpiresAt: null, updatedAt: now, revision: item.revision + 1, wasUnknown: true, resolution: null });
  return moved.ok ? { ok: true, item: moved.item, recovered: true } : moved;
}

/** Is this record bound to this item, and in the form of a resolution? The record is judged, not the decision. */
function resolutionFor(raw: unknown, item: { readonly itemId: string; readonly tenant: string; readonly project: string }): UnknownResolution | null {
  const form = readOwnerForm(raw, RESOLUTION_EXTRA);
  if (form === null || (form['outcome'] !== 'requeue' && form['outcome'] !== 'abandon') || !isCount(form['revision'])) return null;
  if (form['itemId'] !== item.itemId || form['tenant'] !== item.tenant || form['project'] !== item.project) return null;
  return form as unknown as UnknownResolution;
}

/**
 * Resolve an unknown item on a record in the owner's form bound to this item id, tenant and project and to the revision the
 * item has while unknown, and verified by the injected port. A requeue puts it back in the queue with its attempts kept, an
 * abandon fails it. A record names one item at one revision, so it cannot resolve another item or this one a second time.
 */
export function resolveUnknown(input: QueueContext, item: QueueItem, resolution: unknown, expectedRevision: number): QueueResult {
  const context = once(input);
  const now = ready(context, item, expectedRevision);
  if (isRefusal(now)) return now;
  if (item.status !== 'unknown') return no('BAD_TRANSITION', `an item that is ${item.status} is not unknown`);
  const record = resolutionFor(resolution, item);
  if (record === null || record.revision !== item.revision) {
    return no('RESOLUTION', 'a resolution names a plan decision, says the owner decided, carries a plan digest and an outcome, and is bound to this item, its tenant and project and its revision');
  }
  if (!verifiedByPort(context.verifyResolution, record as unknown as Readonly<Record<string, unknown>>)) {
    return no('RESOLUTION_UNVERIFIED', 'the injected port did not answer exactly true for this resolution, or there is none');
  }
  const kept = Object.freeze({ ...record });
  if (record.outcome === 'abandon') return admit({ ...item, status: 'failed', leaseExpiresAt: null, updatedAt: now, revision: item.revision + 1, resolution: kept });
  if (item.attempts >= MAX_QUEUE_ATTEMPTS) return no('ATTEMPTS_EXHAUSTED', 'the attempts are used up; the item can only be abandoned');
  return admit({ ...item, status: 'queued', leaseExpiresAt: null, updatedAt: now, revision: item.revision + 1, resolution: kept });
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Whether the stored fields are ones these rules could have produced. */
function shapeProblem(fields: Record<string, unknown>): boolean {
  const { itemId, status, attempts, leaseExpiresAt, updatedAt, revision, renewals, wasUnknown, resolution } = fields;
  if (typeof itemId !== 'string' || !ITEM_ID.test(itemId)) return true;
  if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) return true;
  if (!isCount(attempts) || attempts > MAX_QUEUE_ATTEMPTS || !isCount(updatedAt) || !isCount(revision) || !isCount(renewals) || renewals > MAX_LEASE_RENEWALS) return true;
  if (typeof wasUnknown !== 'boolean') return true;
  if (status === 'unknown' ? !wasUnknown || resolution !== null : wasUnknown !== (resolution !== null)) return true;
  if (status === 'running') return attempts < 1 || leaseExpiresAt !== updatedAt + QUEUE_LEASE_MS;
  return leaseExpiresAt !== null;
}

/**
 * Read an item back from a store, held to the invariants these rules could have produced. It must be in the binding's scope,
 * and an item that was ever unknown comes back only with its resolution, bound to it and verified by the injected port. Anything
 * but an unstarted queued item also needs the store verifier, because a forged copy of a finished item would otherwise restore as
 * a fresh queued one.
 */
export function restoreQueueItem(input: QueueContext, raw: unknown): QueueResult {
  const context = once(input);
  if (!isDerivedBinding(context.binding)) return no('BINDING', 'the tenant binding was not produced by resolveTenant, so the tenant is a claim');
  const fields = snapshotOf(raw, ITEM_FIELDS);
  if (fields === null || shapeProblem(fields)) return no('ITEM_SHAPE', 'the item is not one these rules could have produced');
  if (fields['tenant'] !== context.binding.tenant || fields['project'] !== context.binding.projectId) return no('ITEM_SCOPE', "the item is not in the binding's tenant and project");
  const now = readClock(context.clock, fields['updatedAt'] as number);
  if (now === null) return no('CLOCK', "the clock gave no usable time, or a time before the item's last change");
  let resolution: UnknownResolution | null = null;
  if (fields['resolution'] !== null) {
    resolution = resolutionFor(fields['resolution'], fields as unknown as QueueItem);
    if (resolution === null || resolution.revision >= (fields['revision'] as number) || (resolution.outcome === 'abandon' && fields['status'] !== 'failed')) {
      return no('RESOLUTION', 'a formerly unknown item needs the resolution that moved it, bound to it');
    }
    if (!verifiedByPort(context.verifyResolution, resolution as unknown as Readonly<Record<string, unknown>>)) {
      return no('RESOLUTION_UNVERIFIED', 'the injected port did not answer exactly true for the resolution of this item, or there is none');
    }
  }
  const restored = { ...(fields as unknown as QueueItem), resolution: resolution === null ? null : Object.freeze({ ...resolution }) };
  // A forged copy of a finished item is indistinguishable from a real unstarted one by its fields alone, so only an item that has
  // not started and never was unknown comes back without the store vouching for it. Whether the store can vouch is the wiring's.
  const unstarted = restored.status === 'queued' && restored.attempts === 0 && !restored.wasUnknown;
  if (!unstarted && !verifiedByPort(context.verifyItem, restored as unknown as Readonly<Record<string, unknown>>)) {
    return no('ITEM_UNVERIFIED', 'an item that has started, finished or been unknown is restored only when the injected store verifier answers exactly true for it');
  }
  return admit(restored);
}
