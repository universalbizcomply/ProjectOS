/**
 * The session lifecycle: accepted work is tracked, close is idempotent and drains, and failures are
 * collected, not lost (PROJECTOS-PORT-MCP1A). No transport is real: the close is an injected function.
 */
import { describe, expect, it } from 'vitest';
import { createSessionLifecycle, SessionClosedError } from '../src/mcpConnectors/index.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('accepted work', () => {
  it('runs work and returns its result: the positive control', async () => {
    const lifecycle = createSessionLifecycle(async () => undefined);
    await expect(lifecycle.run(async () => 42)).resolves.toBe(42);
  });

  it('refuses work once close has begun, with a closed error', async () => {
    const lifecycle = createSessionLifecycle(async () => undefined);
    const closing = lifecycle.close();
    await expect(lifecycle.run(async () => 1)).rejects.toBeInstanceOf(SessionClosedError);
    await closing;
  });

  it('refuses work whose signal is already aborted, without starting it', async () => {
    const lifecycle = createSessionLifecycle(async () => undefined);
    const controller = new AbortController();
    controller.abort();
    let started = false;
    await expect(lifecycle.run(async () => { started = true; }, controller.signal)).rejects.toBeDefined();
    expect(started).toBe(false);
  });

  it('counts work that is still running', async () => {
    const lifecycle = createSessionLifecycle(async () => undefined);
    const gate = deferred();
    const running = lifecycle.run(() => gate.promise);
    expect(lifecycle.inFlight()).toBe(1);
    gate.resolve();
    await running;
    expect(lifecycle.inFlight()).toBe(0);
  });
});

describe('close', () => {
  it('is idempotent: a second close is the first close', async () => {
    let closes = 0;
    const lifecycle = createSessionLifecycle(async () => { closes += 1; });
    const first = lifecycle.close();
    const second = lifecycle.close();
    expect(second).toBe(first);
    await first;
    expect(closes).toBe(1);
  });

  it('waits for accepted work before it settles', async () => {
    const lifecycle = createSessionLifecycle(async () => undefined);
    const gate = deferred();
    const running = lifecycle.run(() => gate.promise);
    let settled = false;
    const closing = lifecycle.close().then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve();
    await running;
    await closing;
    expect(settled).toBe(true);
  });

  it('still drains when the transport fails to close, and reports the failure', async () => {
    const lifecycle = createSessionLifecycle(async () => { throw new Error('transport down'); });
    const gate = deferred();
    const running = lifecycle.run(() => gate.promise);
    const closing = lifecycle.close();
    gate.resolve();
    await running;
    await expect(closing).rejects.toThrow(/transport down/);
  });

  it('collects the failure of work that rejects while draining, with the transport failure', async () => {
    const lifecycle = createSessionLifecycle(async () => { throw new Error('transport down'); });
    const gate = deferred();
    const running = lifecycle.run(() => gate.promise).catch(() => undefined);
    const closing = lifecycle.close();
    gate.reject(new Error('work failed'));
    await running;
    const error = await closing.then(() => null, (thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map(String).join(' ')).toContain('transport down');
  });

  it('work that fails because the close ended it is not a close failure', async () => {
    const lifecycle = createSessionLifecycle(async () => undefined);
    const gate = deferred();
    const running = lifecycle.run(() => gate.promise).catch(() => undefined);
    const closing = lifecycle.close();
    gate.reject(new SessionClosedError());
    await running;
    await expect(closing).resolves.toBeUndefined();
  });

  it('a failing work item does not stop close from settling when the transport is fine', async () => {
    const lifecycle = createSessionLifecycle(async () => undefined);
    const running = lifecycle.run(async () => { throw new Error('work failed'); }).catch(() => undefined);
    await running;
    await expect(lifecycle.close()).resolves.toBeUndefined();
  });

  it('can be used again once a close has fully settled, with a fresh scope', async () => {
    let closes = 0;
    const lifecycle = createSessionLifecycle(async () => { closes += 1; });
    await lifecycle.close();
    await expect(lifecycle.run(async () => 'again')).resolves.toBe('again');
    await lifecycle.close();
    expect(closes).toBe(2);
  });
});
