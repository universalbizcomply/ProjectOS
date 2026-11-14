/**
 * The JSON-RPC client under the connector (PROJECTOS-PORT-MCP1A): replies matched by id, a server's request answered
 * only by the handler it was given, a close that fails every reply still pending, and (review round 1, M1) a timeout on
 * every request, the byte cap before any parse, and no pending entry left behind by a send that throws.
 * The transport is a fake, and so is the timer: nothing here waits.
 */
import { describe, expect, it } from 'vitest';
import {
  createRpcClient,
  MAX_RPC_MESSAGE_CHARS,
  ReplyLostError,
  RequestTimeoutError,
  RpcFailure,
  type McpTransport,
  type RpcClientOptions,
  type TimerPort,
} from '../src/mcpConnectors/index.js';

type Message = Record<string, unknown>;

class Wire implements McpTransport {
  readonly sent: Message[] = [];
  closes = 0;
  handler: (line: string) => void = () => undefined;
  onMessage(handler: (line: string) => void): void {
    this.handler = handler;
  }
  /** What the server writes: one line of text. */
  say(message: unknown): void {
    this.handler(JSON.stringify(message));
  }
  send(message: unknown): void {
    this.sent.push(message as Message);
  }
  async close(): Promise<void> {
    this.closes += 1;
  }
}

class FakeTimers implements TimerPort {
  private readonly timers: { at: number; fn: () => void; live: boolean }[] = [];
  now = 0;
  setTimer(ms: number, fn: () => void): () => void {
    const timer = { at: this.now + ms, fn, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }
  advance(ms: number): void {
    this.now += ms;
    for (const timer of this.timers) {
      if (timer.live && timer.at <= this.now) {
        timer.live = false;
        timer.fn();
      }
    }
  }
  live(): number {
    return this.timers.filter((timer) => timer.live).length;
  }
}

const handler = async () => ({ result: { action: 'cancel' } });

function clientOf(wire: Wire, timers = new FakeTimers(), over: Partial<RpcClientOptions> = {}) {
  return { client: createRpcClient(wire, handler, { timers, requestTimeoutMs: 1_000, ...over }), timers };
}

describe('replies', () => {
  it('match a request by its id: the positive control', async () => {
    const wire = new Wire();
    const { client } = clientOf(wire);
    const pending = client.request('tools/list');
    wire.say({ jsonrpc: '2.0', id: wire.sent[0]?.['id'], result: { tools: [] } });
    await expect(pending).resolves.toEqual({ tools: [] });
  });

  it('drop a reply with an id nobody issued, and leave the real request waiting', async () => {
    const wire = new Wire();
    const { client } = clientOf(wire);
    let settled = false;
    const pending = client.request('a').then(() => { settled = true; });
    wire.say({ jsonrpc: '2.0', id: 999, result: 'not yours' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(settled).toBe(false);
    wire.say({ jsonrpc: '2.0', id: wire.sent[0]?.['id'], result: 1 });
    await pending;
  });

  it('turn a server error into a failure that carries its code and none of its text', async () => {
    const wire = new Wire();
    const { client } = clientOf(wire);
    const pending = client.request('a');
    wire.say({ jsonrpc: '2.0', id: wire.sent[0]?.['id'], error: { code: -32602, message: 'secret-text-from-server' } });
    const failure = await pending.then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(RpcFailure);
    expect((failure as RpcFailure).code).toBe(-32602);
    expect(String(failure)).not.toContain('secret-text-from-server');
  });

  it('a line that is not JSON is dropped, and the real request is still waiting', async () => {
    const wire = new Wire();
    const { client } = clientOf(wire);
    let settled = false;
    const pending = client.request('a').then(() => { settled = true; });
    wire.handler('this is not json {');
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(settled).toBe(false);
    wire.say({ jsonrpc: '2.0', id: wire.sent[0]?.['id'], result: 1 });
    await pending;
  });
});

describe('the byte cap comes before any parse (M1)', () => {
  it('drops a line larger than the cap without reading it, and the request times out instead', async () => {
    const wire = new Wire();
    const { client, timers } = clientOf(wire);
    const pending = client.request('a').then(() => 'answered', (error: unknown) => error);
    const id = wire.sent[0]?.['id'];
    const parse = JSON.parse;
    let parsed = 0;
    JSON.parse = ((text: string, reviver?: (key: string, value: unknown) => unknown) => {
      parsed += 1;
      return parse(text, reviver);
    }) as typeof JSON.parse;
    try {
      wire.handler(`{"jsonrpc":"2.0","id":${String(id)},"result":"${'x'.repeat(MAX_RPC_MESSAGE_CHARS + 1)}"}`);
    } finally {
      JSON.parse = parse;
    }
    expect(parsed).toBe(0);
    timers.advance(1_000);
    expect(await pending).toBeInstanceOf(RequestTimeoutError);
  });

  it('counts bytes and not characters: a line of multi-byte text over the cap is dropped too', async () => {
    const wire = new Wire();
    const { client, timers } = clientOf(wire);
    const pending = client.request('a').then(() => 'answered', (error: unknown) => error);
    const id = wire.sent[0]?.['id'];
    wire.handler(`{"jsonrpc":"2.0","id":${String(id)},"result":"${'€'.repeat(Math.ceil(MAX_RPC_MESSAGE_CHARS / 2))}"}`);
    timers.advance(1_000);
    expect(await pending).toBeInstanceOf(RequestTimeoutError);
  });
});

describe('every request has a timeout (M1)', () => {
  it('rejects with a timeout error, forgets the request, and cancels nothing else', async () => {
    const wire = new Wire();
    const { client, timers } = clientOf(wire);
    const pending = client.request('a').then(() => 'answered', (error: unknown) => error);
    expect(client.pending()).toBe(1);
    timers.advance(999);
    expect(client.pending()).toBe(1);
    timers.advance(1);
    expect(await pending).toBeInstanceOf(RequestTimeoutError);
    expect(client.pending()).toBe(0);
  });

  it('a timeout is a lost reply, so the caller treats the call as one that may have run', async () => {
    const wire = new Wire();
    const { client, timers } = clientOf(wire);
    const pending = client.request('a').then(() => 'answered', (error: unknown) => error);
    timers.advance(1_000);
    expect(await pending).toBeInstanceOf(ReplyLostError);
  });

  it('a reply cancels the timer, so nothing is left to fire', async () => {
    const wire = new Wire();
    const { client, timers } = clientOf(wire);
    const pending = client.request('a');
    wire.say({ jsonrpc: '2.0', id: wire.sent[0]?.['id'], result: 1 });
    await pending;
    expect(timers.live()).toBe(0);
  });

  it('a timed-out request lets close finish: the drain is not held by it', async () => {
    const wire = new Wire();
    const { client, timers } = clientOf(wire);
    const pending = client.request('a').then(() => null, () => null);
    const closing = client.close();
    timers.advance(1_000);
    await pending;
    await expect(closing).resolves.toBeUndefined();
  });

  it('a late reply after the timeout is dropped', async () => {
    const wire = new Wire();
    const { client, timers } = clientOf(wire);
    const pending = client.request('a').then(() => 'answered', (error: unknown) => error);
    const id = wire.sent[0]?.['id'];
    timers.advance(1_000);
    await pending;
    wire.say({ jsonrpc: '2.0', id, result: 'late' });
    expect(client.pending()).toBe(0);
  });
});

describe('a send that fails leaves nothing behind (M1)', () => {
  it('forgets the request and its timer when the transport throws at once', async () => {
    const wire = new Wire();
    wire.send = () => {
      throw new Error('pipe closed');
    };
    const { client, timers } = clientOf(wire);
    await expect(client.request('a')).rejects.toThrow(/pipe closed/);
    expect(client.pending()).toBe(0);
    expect(timers.live()).toBe(0);
  });

  it('forgets the request and its timer when the transport rejects later', async () => {
    const wire = new Wire();
    wire.send = async () => {
      throw new Error('pipe closed');
    };
    const { client, timers } = clientOf(wire);
    await expect(client.request('a')).rejects.toThrow(/pipe closed/);
    expect(client.pending()).toBe(0);
    expect(timers.live()).toBe(0);
  });
});

describe('a request from the server', () => {
  it('is answered by the handler, with the server\'s own id', async () => {
    const wire = new Wire();
    createRpcClient(wire, async () => ({ result: { action: 'decline' } }), { timers: new FakeTimers(), requestTimeoutMs: 1_000 });
    wire.say({ jsonrpc: '2.0', id: 'srv-1', method: 'elicitation/create', params: {} });
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(wire.sent).toEqual([{ jsonrpc: '2.0', id: 'srv-1', result: { action: 'decline' } }]);
  });

  it('is answered with an internal error when the handler throws, and never with silence', async () => {
    const wire = new Wire();
    createRpcClient(wire, async () => {
      throw new Error('boom');
    }, { timers: new FakeTimers(), requestTimeoutMs: 1_000 });
    wire.say({ jsonrpc: '2.0', id: 'srv-2', method: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(wire.sent[0]).toMatchObject({ id: 'srv-2', error: { code: -32603 } });
  });

  it('a notification gets no answer, and is handed to the notification handler by name only', async () => {
    const wire = new Wire();
    const seen: string[] = [];
    createRpcClient(wire, handler, { timers: new FakeTimers(), requestTimeoutMs: 1_000, onNotification: (method) => seen.push(method) });
    wire.say({ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: { secret: 'x' } });
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(wire.sent).toHaveLength(0);
    expect(seen).toEqual(['notifications/tools/list_changed']);
  });
});

describe('a request waiting on a handler is not timed (N6)', () => {
  it('stops every pending timer while the handler has asked for it, and starts each afresh once the answer is sent', async () => {
    const wire = new Wire();
    const timers = new FakeTimers();
    let finish: () => void = () => undefined;
    const client = createRpcClient(
      wire,
      async (_request, control) => {
        control.suspendTimeouts();
        await new Promise<void>((resolve) => { finish = resolve; });
        return { result: { action: 'decline' } };
      },
      { timers, requestTimeoutMs: 1_000 },
    );
    const pending = client.request('tools/call').then(() => 'answered', (error: unknown) => error);
    wire.say({ jsonrpc: '2.0', id: 'srv-1', method: 'elicitation/create', params: {} });
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(timers.live()).toBe(0);
    timers.advance(60_000);
    expect(client.pending()).toBe(1);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(timers.live()).toBe(1);
    timers.advance(999);
    expect(client.pending()).toBe(1);
    timers.advance(1);
    expect(await pending).toBeInstanceOf(RequestTimeoutError);
  });

  it('a request made while the timers are stopped is timed only after they start again', async () => {
    const wire = new Wire();
    const timers = new FakeTimers();
    let finish: () => void = () => undefined;
    const client = createRpcClient(
      wire,
      async (_request, control) => {
        control.suspendTimeouts();
        await new Promise<void>((resolve) => { finish = resolve; });
        return { result: {} };
      },
      { timers, requestTimeoutMs: 1_000 },
    );
    wire.say({ jsonrpc: '2.0', id: 'srv-2', method: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const late = client.request('a').then(() => 'answered', (error: unknown) => error);
    expect(timers.live()).toBe(0);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(timers.live()).toBe(1);
    timers.advance(1_000);
    expect(await late).toBeInstanceOf(RequestTimeoutError);
  });

  it('a handler that throws still lets the timers start again', async () => {
    const wire = new Wire();
    const timers = new FakeTimers();
    const client = createRpcClient(
      wire,
      async (_request, control) => {
        control.suspendTimeouts();
        throw new Error('boom');
      },
      { timers, requestTimeoutMs: 1_000 },
    );
    const pending = client.request('a').then(() => 'answered', (error: unknown) => error);
    wire.say({ jsonrpc: '2.0', id: 'srv-3', method: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(timers.live()).toBe(1);
    timers.advance(1_000);
    expect(await pending).toBeInstanceOf(RequestTimeoutError);
  });
});

describe('close', () => {
  it('fails every reply still pending with a lost-reply error, and closes the transport once', async () => {
    const wire = new Wire();
    const { client } = clientOf(wire);
    const pending = client.request('a');
    const rejected = pending.then(() => null, (error: unknown) => error);
    await Promise.all([client.close(), client.close()]);
    expect(await rejected).toBeInstanceOf(ReplyLostError);
    expect(wire.closes).toBe(1);
  });

  it('refuses a request after close, and does not send it', async () => {
    const wire = new Wire();
    const { client } = clientOf(wire);
    await client.close();
    await expect(client.request('a')).rejects.toThrow(/closed/i);
    expect(wire.sent).toHaveLength(0);
  });
});
