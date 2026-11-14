// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: src/mcp/tools-stdio-server.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: ADAPTED
// Modified-By: ProjectOS 2026-11-13: modified for ProjectOS. CHANGED: upstream's server lifecycle is kept for a client session: accepted work is tracked, work arriving after close has begun is refused with a closed error, close is idempotent and drains accepted work before it settles, failures are collected and thrown together, and the session can be used again once a close has fully settled; the MCP SDK Server and StdioServerTransport subclasses, the process signal and stdin handlers, the log rerouting, the plugin registry and scheduler ownership are removed, and the transport close is an injected function, because nothing here may touch a process or a stream; the async work scope and the deferred are replaced by a set of promises
// Notice: full licence text in THIRD_PARTY_NOTICES
/**
 * The lifecycle of one MCP session: what is running, what may still start, and how it ends.
 *
 * Upstream's tools server counts every request it accepts, refuses new ones the moment a close begins, and on close
 * lets the transport go and then waits for what it had already accepted, because a close that returns while a tool
 * is still running leaves that tool writing into a session nobody owns. It then collects every failure along the
 * way and reports them together, so a failed transport close does not hide a failed tool, and the reverse. The same
 * holds for a client: a session is closed once, however many callers ask, and never abandoned half closed. Pure:
 * the transport is a function, and this module holds no stream, timer or process.
 */
export class SessionClosedError extends Error {
  constructor() {
    super('Connection closed');
    this.name = 'SessionClosedError';
  }
}

export interface SessionLifecycle {
  /** Run accepted work. Refused while a close is under way, and when the signal has already aborted. */
  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  /** Close once. A second call returns the first call's promise. */
  close(): Promise<void>;
  /** How many accepted items have not yet finished. */
  inFlight(): number;
}

export function createSessionLifecycle(closeTransport: () => Promise<void>): SessionLifecycle {
  const accepted = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;

  const run = <T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (closing !== undefined) return Promise.reject(new SessionClosedError());
    try {
      signal?.throwIfAborted();
    } catch (error) {
      return Promise.reject(error);
    }
    const scope = accepted;
    const item = (async () => work())();
    scope.add(item);
    const done = () => {
      scope.delete(item);
    };
    item.then(done, done);
    return item;
  };

  const drain = async (scope: ReadonlySet<Promise<unknown>>, failures: unknown[]): Promise<void> => {
    const settled = await Promise.allSettled([...scope]);
    // Work that failed because this close ended it is the close's doing, and its caller has been told.
    for (const result of settled) if (result.status === 'rejected' && !(result.reason instanceof SessionClosedError)) failures.push(result.reason);
  };

  const close = (): Promise<void> => {
    if (closing !== undefined) return closing;
    const scope = accepted;
    const failures: unknown[] = [];
    closing = (async () => {
      try {
        // Closing the transport delivers cancellation. It does not wait for work that was already accepted.
        await closeTransport();
      } catch (error) {
        failures.push(error);
      } finally {
        await drain(scope, failures);
        // The same session can be used again once this close has fully settled.
        closing = undefined;
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, 'MCP session close failed');
    })();
    return closing;
  };

  return { run, close, inFlight: () => accepted.size };
}
