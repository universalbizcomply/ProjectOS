import { describe, expect, it } from 'vitest';
import {
  MAX_QUEUE_ATTEMPTS,
  QUEUE_LEASE_MS,
  cancelItem,
  claimItem,
  completeItem,
  emptyQueueControl,
  isScopePaused,
  newQueueItem,
  pauseItem,
  pauseScope,
  recoverAbandoned,
  restoreQueueItem,
  resumeItem,
  resumeScope,
  resolveUnknown,
  type QueueContext,
  type QueueControl,
  type QueueItem,
} from '../src/agents/index.js';
import type { TenantBinding } from '../src/tenant.js';
import { MINUTE, NOW, PLAN_DIGEST, agency, clockAt, polygo, projectos } from './agents-support.js';

const home = polygo();
const at = (ms: number, binding: TenantBinding = home): QueueContext => ({ binding, clock: clockAt(ms) });
const OWNER = { decisionId: 'PLANDEC-0123456789abcdef', decidedBy: 'owner' as const, planDigest: PLAN_DIGEST };

function must<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`a control call was refused: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

const fresh = (id = 'ITEM-1', ms = NOW): QueueItem => must(newQueueItem(at(ms), id)).item;
const running = (id = 'ITEM-1', ms = NOW): QueueItem => must(claimItem(at(ms), emptyQueueControl(), fresh(id, ms))).item;
const status = (result: { ok: boolean } & Record<string, unknown>): string => (result.ok ? String((result['item'] as QueueItem).status) : String(result['code']));

describe('an item moves through the queue by rules, never by a field written by hand', () => {
  it('starts queued, with no attempts and no lease, stamped with the scope of the binding', () => {
    expect(fresh()).toMatchObject({ tenant: 'owner-personal', project: 'polygo', itemId: 'ITEM-1', status: 'queued', attempts: 0, leaseExpiresAt: null });
  });

  it('claims a queued item: it runs, with one attempt and a lease that ends at a stated time', () => {
    const item = running();
    expect(item).toMatchObject({ status: 'running', attempts: 1, leaseExpiresAt: NOW + QUEUE_LEASE_MS });
  });

  it('completes or fails a running item, and no other', () => {
    expect(status(completeItem(at(NOW + MINUTE), running(), 'completed'))).toBe('completed');
    expect(status(completeItem(at(NOW + MINUTE), running(), 'failed'))).toBe('failed');
    expect(status(completeItem(at(NOW), fresh(), 'completed'))).toBe('BAD_TRANSITION');
    expect(status(completeItem(at(NOW + MINUTE), running(), 'done' as never))).toBe('OUTCOME');
  });

  it('refuses to move a finished item again', () => {
    const done = must(completeItem(at(NOW + MINUTE), running(), 'completed')).item;
    for (const result of [claimItem(at(NOW + 2 * MINUTE), emptyQueueControl(), done), completeItem(at(NOW + 2 * MINUTE), done, 'failed'), pauseItem(at(NOW + 2 * MINUTE), done), cancelItem(at(NOW + 2 * MINUTE), done)]) {
      expect(status(result)).toBe('BAD_TRANSITION');
    }
  });

  it('is not an item when it was built by hand, even if every field is right', () => {
    const forged = { ...fresh(), attempts: 0 };
    expect(status(claimItem(at(NOW), emptyQueueControl(), forged))).toBe('ITEM_NOT_ADMITTED');
  });

  it('refuses an item id that is not one plain word', () => {
    for (const bad of ['', 'a b', 'x'.repeat(100), 7]) {
      expect(status(newQueueItem(at(NOW), bad as never))).toBe('ITEM_SHAPE');
    }
  });

  it('refuses a binding that resolveTenant did not produce', () => {
    expect(status(newQueueItem(at(NOW, { ...home }), 'ITEM-1'))).toBe('BINDING');
  });
});

describe('attempts are the module\'s count, and capped', () => {
  it('claims up to the cap and refuses the next claim, after each failure of the item\'s own run', () => {
    let item = fresh();
    for (let attempt = 1; attempt <= MAX_QUEUE_ATTEMPTS; attempt += 1) {
      item = must(claimItem(at(NOW + attempt * MINUTE * 40), emptyQueueControl(), item)).item;
      expect(item.attempts).toBe(attempt);
      const recovered = must(recoverAbandoned(at(NOW + attempt * MINUTE * 40 + QUEUE_LEASE_MS), item));
      item = must(resolveUnknown(at(NOW + attempt * MINUTE * 40 + QUEUE_LEASE_MS + 1), recovered.item, { ...OWNER, outcome: attempt < MAX_QUEUE_ATTEMPTS ? 'requeue' : 'abandon' })).item;
    }
    expect(item.status).toBe('failed');
  });

  it('refuses to requeue an unknown item whose attempts are used up, and offers abandoning it', () => {
    let item = fresh();
    let ms = NOW;
    for (let attempt = 1; attempt <= MAX_QUEUE_ATTEMPTS; attempt += 1) {
      item = must(claimItem(at(ms), emptyQueueControl(), item)).item;
      ms += QUEUE_LEASE_MS;
      item = must(recoverAbandoned(at(ms), item)).item;
      if (attempt < MAX_QUEUE_ATTEMPTS) {
        ms += 1;
        item = must(resolveUnknown(at(ms), item, { ...OWNER, outcome: 'requeue' })).item;
      }
    }
    expect(status(resolveUnknown(at(ms + 1), item, { ...OWNER, outcome: 'requeue' }))).toBe('ATTEMPTS_EXHAUSTED');
    expect(status(resolveUnknown(at(ms + 1), item, { ...OWNER, outcome: 'abandon' }))).toBe('failed');
  });

  it('cannot reset the count by restoring an item with fewer attempts than the cap allows', () => {
    expect(status(restoreQueueItem(at(NOW), { tenant: 'owner-personal', project: 'polygo', itemId: 'I', status: 'queued', attempts: MAX_QUEUE_ATTEMPTS + 1, leaseExpiresAt: null, updatedAt: NOW }))).toBe('ITEM_SHAPE');
  });
});

describe('pause and resume', () => {
  it('pauses a queued item and resumes it to queued', () => {
    const paused = must(pauseItem(at(NOW), fresh())).item;
    expect(paused.status).toBe('paused');
    expect(status(claimItem(at(NOW + 1), emptyQueueControl(), paused))).toBe('BAD_TRANSITION');
    expect(status(resumeItem(at(NOW + 2), paused))).toBe('queued');
  });

  it('refuses to pause a running item: it belongs to its executor, and a pause would be a guess', () => {
    expect(status(pauseItem(at(NOW + 1), running()))).toBe('BAD_TRANSITION');
  });

  it('refuses to resume an item that is not paused', () => {
    expect(status(resumeItem(at(NOW), fresh()))).toBe('BAD_TRANSITION');
    expect(status(resumeItem(at(NOW + 1), running()))).toBe('BAD_TRANSITION');
  });

  it('cancels a queued or a paused item, and not a running one', () => {
    expect(status(cancelItem(at(NOW), fresh()))).toBe('cancelled');
    expect(status(cancelItem(at(NOW + 1), must(pauseItem(at(NOW), fresh())).item))).toBe('cancelled');
    expect(status(cancelItem(at(NOW + 1), running()))).toBe('BAD_TRANSITION');
  });

  it('pauses a scope: nothing in it is claimed until it is resumed', () => {
    const paused = must(pauseScope(at(NOW), emptyQueueControl())).control;
    expect(isScopePaused(paused, home)).toBe(true);
    expect(status(claimItem(at(NOW + 1), paused, fresh()))).toBe('SCOPE_PAUSED');
    const resumed = must(resumeScope(at(NOW + 2), paused)).control;
    expect(isScopePaused(resumed, home)).toBe(false);
    expect(status(claimItem(at(NOW + 3), resumed, fresh()))).toBe('running');
  });

  it('keeps a pause to its own tenant and project', () => {
    const paused = must(pauseScope(at(NOW), emptyQueueControl())).control;
    expect(isScopePaused(paused, projectos())).toBe(false);
    expect(isScopePaused(paused, agency())).toBe(false);
    expect(status(claimItem(at(NOW + 1, agency()), paused, must(newQueueItem(at(NOW, agency()), 'ITEM-1')).item))).toBe('running');
  });

  it('does not let a pause run out on its own: it ends only by a resume', () => {
    const paused = must(pauseScope(at(NOW), emptyQueueControl())).control;
    expect(isScopePaused(paused, home)).toBe(true);
    expect(status(claimItem(at(NOW + 1000 * QUEUE_LEASE_MS), paused, fresh()))).toBe('SCOPE_PAUSED');
  });

  it('keeps every pause it was given: a later pause in another scope forgets none', () => {
    let control: QueueControl = emptyQueueControl();
    for (const binding of [polygo(), projectos(), agency()]) control = must(pauseScope(at(NOW, binding), control)).control;
    expect(isScopePaused(control, home)).toBe(true);
    expect(isScopePaused(control, projectos())).toBe(true);
    expect(isScopePaused(control, agency())).toBe(true);
  });

  it('pauses a scope twice as one pause, and one resume ends it', () => {
    const once = must(pauseScope(at(NOW), emptyQueueControl())).control;
    const twice = must(pauseScope(at(NOW), once)).control;
    expect(isScopePaused(must(resumeScope(at(NOW), twice)).control, home)).toBe(false);
  });

  it('refuses a control that this module did not build', () => {
    expect(status(claimItem(at(NOW), { size: 0 } as unknown as QueueControl, fresh()))).toBe('CONTROL');
    expect(isScopePaused({ size: 0 } as unknown as QueueControl, home)).toBe(true);
  });
});

describe('crash recovery never hands a possibly-acted item back to the queue', () => {
  it('leaves a running item alone while its lease runs', () => {
    expect(must(recoverAbandoned(at(NOW + QUEUE_LEASE_MS - 1), running()))).toMatchObject({ recovered: false, item: { status: 'running' } });
  });

  it('marks a running item unknown once its lease has ended, and never queued', () => {
    const recovered = must(recoverAbandoned(at(NOW + QUEUE_LEASE_MS), running()));
    expect(recovered).toMatchObject({ recovered: true, item: { status: 'unknown', leaseExpiresAt: null } });
  });

  it('does not recover a queued, paused or finished item', () => {
    const later = at(NOW + 10 * QUEUE_LEASE_MS);
    expect(must(recoverAbandoned(later, fresh()))).toMatchObject({ recovered: false });
    expect(must(recoverAbandoned(later, must(pauseItem(at(NOW), fresh())).item))).toMatchObject({ recovered: false });
    expect(must(recoverAbandoned(later, must(completeItem(at(NOW + 1), running(), 'failed')).item))).toMatchObject({ recovered: false });
  });

  it('refuses every move of an unknown item except an owner-form resolution', () => {
    const unknown = must(recoverAbandoned(at(NOW + QUEUE_LEASE_MS), running())).item;
    const later = at(NOW + QUEUE_LEASE_MS + 1);
    for (const result of [claimItem(later, emptyQueueControl(), unknown), completeItem(later, unknown, 'completed'), pauseItem(later, unknown), resumeItem(later, unknown), cancelItem(later, unknown)]) {
      expect(status(result)).toBe('BAD_TRANSITION');
    }
  });

  it('resolves an unknown item to queued or failed on a record that names a plan decision, and not otherwise', () => {
    const unknown = must(recoverAbandoned(at(NOW + QUEUE_LEASE_MS), running())).item;
    const later = at(NOW + QUEUE_LEASE_MS + 1);
    expect(status(resolveUnknown(later, unknown, { ...OWNER, outcome: 'requeue' }))).toBe('queued');
    expect(status(resolveUnknown(later, unknown, { ...OWNER, outcome: 'abandon' }))).toBe('failed');
    expect(status(resolveUnknown(later, unknown, { ...OWNER, decidedBy: 'agent' as never, outcome: 'requeue' }))).toBe('RESOLUTION');
    expect(status(resolveUnknown(later, unknown, { ...OWNER, decisionId: 'x', outcome: 'requeue' }))).toBe('RESOLUTION');
    expect(status(resolveUnknown(later, unknown, { ...OWNER, outcome: 'forget' as never }))).toBe('RESOLUTION');
  });

  it('refuses to resolve an item that is not unknown', () => {
    expect(status(resolveUnknown(at(NOW), fresh(), { ...OWNER, outcome: 'requeue' }))).toBe('BAD_TRANSITION');
  });

  it('cannot be fooled by a lease the item states about itself: a restored item carries the lease the rules give', () => {
    const live = running();
    const forged = { ...live, leaseExpiresAt: NOW + 1000 * QUEUE_LEASE_MS };
    expect(status(restoreQueueItem(at(NOW + 1), forged))).toBe('ITEM_SHAPE');
  });
});

describe('the clock is injected, finite and does not run backwards', () => {
  it('refuses a clock that gives no time, for every move', () => {
    const bad = (ms: number): QueueContext => ({ binding: home, clock: () => ms });
    for (const ms of [Number.NaN, -1, Number.POSITIVE_INFINITY, 2.5]) {
      expect(status(newQueueItem(bad(ms), 'ITEM-1'))).toBe('CLOCK');
      expect(status(claimItem(bad(ms), emptyQueueControl(), fresh()))).toBe('CLOCK');
      expect(status(recoverAbandoned(bad(ms), running()))).toBe('CLOCK');
    }
    expect(status(claimItem({ binding: home, clock: () => { throw new Error('no clock'); } }, emptyQueueControl(), fresh()))).toBe('CLOCK');
  });

  it('refuses a clock that reads earlier than the item\'s last change', () => {
    const item = running('ITEM-1', NOW + 10 * MINUTE);
    expect(status(completeItem(at(NOW), item, 'completed'))).toBe('CLOCK');
    expect(status(recoverAbandoned(at(NOW), item))).toBe('CLOCK');
  });

  it('leaves a running item alone just after the claim: a lease is measured only against its own end', () => {
    const item = running();
    expect(must(recoverAbandoned(at(NOW + 1), item))).toMatchObject({ recovered: false });
  });
});

describe('an item is read back only for its own tenant and project', () => {
  const stored = () => ({ ...running() });

  it('restores an item the rules could have produced: the control', () => {
    expect(status(restoreQueueItem(at(NOW + 1), stored()))).toBe('running');
  });

  it('refuses an item stored for another tenant or project', () => {
    expect(status(restoreQueueItem(at(NOW + 1, agency()), stored()))).toBe('ITEM_SCOPE');
    expect(status(restoreQueueItem(at(NOW + 1, projectos()), stored()))).toBe('ITEM_SCOPE');
  });

  it('refuses a status the rules do not have, a negative or fractional count, a lease on an item that is not running', () => {
    expect(status(restoreQueueItem(at(NOW + 1), { ...stored(), status: 'done' }))).toBe('ITEM_SHAPE');
    expect(status(restoreQueueItem(at(NOW + 1), { ...stored(), attempts: -1 }))).toBe('ITEM_SHAPE');
    expect(status(restoreQueueItem(at(NOW + 1), { ...stored(), attempts: 1.5 }))).toBe('ITEM_SHAPE');
    expect(status(restoreQueueItem(at(NOW + 1), { ...fresh(), status: 'queued', leaseExpiresAt: NOW + QUEUE_LEASE_MS }))).toBe('ITEM_SHAPE');
    expect(status(restoreQueueItem(at(NOW + 1), { ...stored(), leaseExpiresAt: null }))).toBe('ITEM_SHAPE');
  });

  it('refuses a field it does not know, and a getter', () => {
    expect(status(restoreQueueItem(at(NOW + 1), { ...stored(), retries: 0 }))).toBe('ITEM_SHAPE');
    const raw = stored();
    Object.defineProperty(raw, 'attempts', { enumerable: true, get: () => 0 });
    expect(status(restoreQueueItem(at(NOW + 1), raw))).toBe('ITEM_SHAPE');
  });

  it('refuses an item whose last change is in the future of the clock', () => {
    expect(status(restoreQueueItem(at(NOW - 1), stored()))).toBe('CLOCK');
  });
});

describe('a move in another tenant\'s scope is refused', () => {
  it('refuses an item of one tenant presented under the binding of another', () => {
    const mine = fresh();
    expect(status(claimItem(at(NOW, agency()), emptyQueueControl(), mine))).toBe('ITEM_SCOPE');
    expect(status(pauseItem(at(NOW, agency()), mine))).toBe('ITEM_SCOPE');
    expect(status(cancelItem(at(NOW, projectos()), mine))).toBe('ITEM_SCOPE');
  });
});
