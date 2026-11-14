// Origin: original ProjectOS code
/**
 * A JSON-RPC 2.0 CLIENT OVER AN INJECTED TRANSPORT (PROJECTOS-PORT-MCP1A).
 *
 * It matches replies to requests by id, hands a request the server makes to one handler and sends back what that
 * handler decides, and ends through the session lifecycle ported from OpenClaw: work is counted, a request made after
 * a close has begun is refused, and a close fails every reply still pending, so nothing waits for a server that is
 * gone. It starts no process and opens no socket, and its only clock is an injected timer.
 *
 * WHAT A SERVER SAYS IS JUDGED BEFORE IT IS READ. A line larger than the cap, counted in bytes, is dropped before
 * `JSON.parse` sees it, and so is a line that is not JSON. A reply with no id this client issued is dropped. A
 * server's notification is handed on by its method name alone, and never its content.
 *
 * EVERY REQUEST HAS A TIMEOUT. One that is not answered in time is forgotten, its timer is gone, its caller is told the
 * reply was lost (the call may have run), and a close that was waiting on it is released. A send that fails, at once
 * or later, leaves no entry and no timer behind.
 */
import { createSessionLifecycle, SessionClosedError, type RpcError } from '@projectos/core';
import type { McpTransport, TimerPort } from './ports.js';

/** The largest line taken from a server, in bytes. */
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

/** No reply came in time. It is a lost reply: the request was sent, and the server may have acted on it. */
export class RequestTimeoutError extends ReplyLostError {
  constructor() {
    super();
    this.name = 'RequestTimeoutError';
  }
}

export interface RpcClientOptions {
  readonly timers: TimerPort;
  /** How long a request may wait for its reply. */
  readonly requestTimeoutMs: number;
  /** Told the method name of each notification a server sends, and nothing else about it. */
  readonly onNotification?: (method: string) => void;
}

export interface RpcClient {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  /** How many requests are waiting for a reply. */
  pending(): number;
  close(): Promise<void>;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;
}

/** Whether a line is within the cap, counted in bytes. Characters are checked first, because a line of more characters than the cap has more bytes. */
function withinCap(line: string): boolean {
  return line.length <= MAX_RPC_MESSAGE_CHARS && new TextEncoder().encode(line).length <= MAX_RPC_MESSAGE_CHARS;
}

export function createRpcClient(transport: McpTransport, onServerRequest: ServerRequestHandler, options: RpcClientOptions): RpcClient {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  /** A client is closed for good. Unlike the lifecycle, which may be reused, a closed connection is not reopened. */
  let closed = false;

  const failPending = (reason: unknown): void => {
    // Each entry removes itself, and its timer, when it settles.
    for (const entry of [...pending.values()]) entry.reject(reason);
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

  const receive = (record: Readonly<Record<string, unknown>>): void => {
    if (typeof record['method'] === 'string') {
      // A request has an id and wants an answer. A notification has none and gets none.
      if (record['id'] !== undefined) void lifecycle.run(() => answerServer(record)).catch(() => undefined);
      else options.onNotification?.(record['method']);
      return;
    }
    const id = record['id'];
    const entry = typeof id === 'number' ? pending.get(id) : undefined;
    if (typeof id !== 'number' || entry === undefined) return;
    const error = asRecord(record['error']);
    if (error !== null) entry.reject(new RpcFailure(typeof error['code'] === 'number' ? error['code'] : -32603, 'the server answered with an error'));
    else entry.resolve(record['result']);
  };

  const receiveLine = (line: unknown): void => {
    if (typeof line !== 'string' || !withinCap(line)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const record = asRecord(parsed);
    if (record !== null) receive(record);
  };

  transport.onMessage(receiveLine);

  const send = (message: unknown): Promise<void> => {
    try {
      return Promise.resolve(transport.send(message));
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const requestOnce = (method: string, params: unknown): Promise<unknown> =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      let cancelTimer: () => void = () => undefined;
      const settle = (run: () => void): void => {
        if (!pending.delete(id)) return;
        cancelTimer();
        run();
      };
      pending.set(id, { resolve: (value) => settle(() => resolve(value)), reject: (reason) => settle(() => reject(reason)) });
      cancelTimer = options.timers.setTimer(options.requestTimeoutMs, () => settle(() => reject(new RequestTimeoutError())));
      send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }).catch((error: unknown) => settle(() => reject(error)));
    });

  return {
    request: (method, params) => (closed ? Promise.reject(new SessionClosedError()) : lifecycle.run(() => requestOnce(method, params))),
    notify: (method, params) => (closed ? Promise.reject(new SessionClosedError()) : lifecycle.run(() => send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }))),
    pending: () => pending.size,
    close: () => {
      closed = true;
      return lifecycle.close();
    },
  };
}
