// Origin: original ProjectOS code
/**
 * A JSON-RPC 2.0 CLIENT OVER AN INJECTED TRANSPORT (PROJECTOS-PORT-MCP1A).
 *
 * It matches replies to requests by id, hands a request the server makes to one handler and sends back what that
 * handler decides, and ends through the session lifecycle ported from OpenClaw: work is counted, a request made after
 * a close has begun is refused, and a close fails every reply still pending, so nothing waits for a server that is
 * gone. It starts no process, opens no socket and sets no timer.
 *
 * WHAT A SERVER SAYS IS PARSED, NOT TRUSTED. A reply with no id this client issued is dropped. A message larger than
 * the cap is dropped, and the request it answered fails. A server's notification is ignored.
 */
import { createSessionLifecycle, SessionClosedError, type RpcError } from '@projectos/core';
import type { McpTransport } from './ports.js';

/** The largest message taken from a server, in characters once written out. */
export const MAX_RPC_MESSAGE_CHARS = 1_048_576;

export type ServerRequestAnswer = { readonly result: unknown } | { readonly error: RpcError };

/** Decides a request the SERVER made. It is the only way a server's request is ever answered. */
export type ServerRequestHandler = (request: unknown) => Promise<ServerRequestAnswer>;

/** The server answered a request with an error. It carries the code and none of the server's text. */
export class RpcFailure extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'RpcFailure';
    this.code = code;
  }
}

/**
 * A request was sent and the connection ended before the reply. The call may have run. It is a kind of closed
 * session, so the lifecycle does not count it as a failure of the close, and it is its own class so a caller can tell
 * a call that never left from one whose answer was lost.
 */
export class ReplyLostError extends SessionClosedError {
  constructor() {
    super();
    this.name = 'ReplyLostError';
  }
}

export interface RpcClient {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;
}

function sizeOf(message: unknown): number {
  try {
    return JSON.stringify(message)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function createRpcClient(transport: McpTransport, onServerRequest: ServerRequestHandler): RpcClient {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  /** A client is closed for good. Unlike the lifecycle, which may be reused, a closed connection is not reopened. */
  let closed = false;

  const failPending = (reason: unknown): void => {
    for (const [id, entry] of [...pending]) {
      pending.delete(id);
      entry.reject(reason);
    }
  };

  const lifecycle = createSessionLifecycle(async () => {
    try {
      await transport.close();
    } finally {
      failPending(new ReplyLostError());
    }
  });

  const answerServer = async (request: Readonly<Record<string, unknown>>): Promise<void> => {
    const id = request['id'];
    let answer: ServerRequestAnswer;
    try {
      answer = await onServerRequest(request);
    } catch {
      answer = { error: { code: -32603, message: 'internal error' } };
    }
    await transport.send({ jsonrpc: '2.0', id, ...('result' in answer ? { result: answer.result } : { error: answer.error }) });
  };

  const receive = (message: unknown): void => {
    const record = asRecord(message);
    if (record === null || sizeOf(message) > MAX_RPC_MESSAGE_CHARS) {
      if (record !== null && typeof record['id'] === 'number') {
        const entry = pending.get(record['id']);
        pending.delete(record['id']);
        entry?.reject(new RpcFailure(-32600, 'the reply was larger than this client reads'));
      }
      return;
    }
    if (typeof record['method'] === 'string') {
      // A request has an id and wants an answer. A notification has none and gets none.
      if (record['id'] !== undefined) void lifecycle.run(() => answerServer(record)).catch(() => undefined);
      return;
    }
    const id = record['id'];
    const entry = typeof id === 'number' ? pending.get(id) : undefined;
    if (typeof id !== 'number' || entry === undefined) return;
    pending.delete(id);
    const error = asRecord(record['error']);
    if (error !== null) entry.reject(new RpcFailure(typeof error['code'] === 'number' ? error['code'] : -32603, 'the server answered with an error'));
    else entry.resolve(record['result']);
  };

  transport.onMessage(receive);

  return {
    request: (method, params) =>
      closed ? Promise.reject(new SessionClosedError()) : lifecycle.run(
        () =>
          new Promise<unknown>((resolve, reject) => {
            const id = nextId;
            nextId += 1;
            pending.set(id, { resolve, reject });
            Promise.resolve(transport.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })).catch((error: unknown) => {
              pending.delete(id);
              reject(error);
            });
          }),
      ),
    notify: (method, params) => (closed ? Promise.reject(new SessionClosedError()) : lifecycle.run(async () => transport.send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }))),
    close: () => {
      closed = true;
      return lifecycle.close();
    },
  };
}
