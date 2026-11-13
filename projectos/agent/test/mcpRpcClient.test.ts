/**
 * The JSON-RPC client under the connector (PROJECTOS-PORT-MCP1A): replies matched by id, a server's request answered
 * only by the handler it was given, and a close that fails every reply still pending. The transport is a fake.
 */
import { describe, expect, it } from 'vitest';
import { createRpcClient, MAX_RPC_MESSAGE_CHARS, ReplyLostError, RpcFailure, type McpTransport } from '../src/mcpConnectors/index.js';

type Message = Record<string, unknown>;

class Wire implements McpTransport {
  readonly sent: Message[] = [];
  closes = 0;
  handler: (message: unknown) => void = () => undefined;
  onMessage(handler: (message: unknown) => void): void {
    this.handler = handler;
  }
  send(message: unknown): void {
    this.sent.push(message as Message);
  }
  async close(): Promise<void> {
    this.closes += 1;
  }
}

const handler = async () => ({ result: { action: 'cancel' } });

describe('replies', () => {
  it('match a request by its id: the positive control', async () => {
    const wire = new Wire();
    const client = createRpcClient(wire, handler);
    const pending = client.request('tools/list');
    wire.handler({ jsonrpc: '2.0', id: wire.sent[0]?.['id'], result: { tools: [] } });
    await expect(pending).resolves.toEqual({ tools: [] });
  });

  it('drop a reply with an id nobody issued, and leave the real request waiting', async () => {
    const wire = new Wire();
    const client = createRpcClient(wire, handler);
    let settled = false;
    const pending = client.request('a').then(() => { settled = true; });
    wire.handler({ jsonrpc: '2.0', id: 999, result: 'not yours' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(settled).toBe(false);
    wire.handler({ jsonrpc: '2.0', id: wire.sent[0]?.['id'], result: 1 });
    await pending;
  });

  it('turn a server error into a failure that carries its code and none of its text', async () => {
    const wire = new Wire();
    const client = createRpcClient(wire, handler);
    const pending = client.request('a');
    wire.handler({ jsonrpc: '2.0', id: wire.sent[0]?.['id'], error: { code: -32602, message: 'secret-text-from-server' } });
    const failure = await pending.then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(RpcFailure);
    expect((failure as RpcFailure).code).toBe(-32602);
    expect(String(failure)).not.toContain('secret-text-from-server');
  });

  it('fail the request when the reply is larger than the cap', async () => {
    const wire = new Wire();
    const client = createRpcClient(wire, handler);
    const pending = client.request('a');
    wire.handler({ jsonrpc: '2.0', id: wire.sent[0]?.['id'], result: 'x'.repeat(MAX_RPC_MESSAGE_CHARS + 1) });
    await expect(pending).rejects.toBeInstanceOf(RpcFailure);
  });

  it('fail when the transport cannot send', async () => {
    const wire = new Wire();
    wire.send = () => {
      throw new Error('pipe closed');
    };
    const client = createRpcClient(wire, handler);
    await expect(client.request('a')).rejects.toThrow(/pipe closed/);
  });
});

describe('a request from the server', () => {
  it('is answered by the handler, with the server\'s own id', async () => {
    const wire = new Wire();
    createRpcClient(wire, async () => ({ result: { action: 'decline' } }));
    wire.handler({ jsonrpc: '2.0', id: 'srv-1', method: 'elicitation/create', params: {} });
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(wire.sent).toEqual([{ jsonrpc: '2.0', id: 'srv-1', result: { action: 'decline' } }]);
  });

  it('is answered with an internal error when the handler throws, and never with silence', async () => {
    const wire = new Wire();
    createRpcClient(wire, async () => {
      throw new Error('boom');
    });
    wire.handler({ jsonrpc: '2.0', id: 'srv-2', method: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(wire.sent[0]).toMatchObject({ id: 'srv-2', error: { code: -32603 } });
  });

  it('a notification gets no answer', async () => {
    const wire = new Wire();
    createRpcClient(wire, handler);
    wire.handler({ jsonrpc: '2.0', method: 'notifications/message', params: {} });
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(wire.sent).toHaveLength(0);
  });
});

describe('close', () => {
  it('fails every reply still pending with a lost-reply error, and closes the transport once', async () => {
    const wire = new Wire();
    const client = createRpcClient(wire, handler);
    const pending = client.request('a');
    const rejected = pending.then(() => null, (error: unknown) => error);
    await Promise.all([client.close(), client.close()]);
    expect(await rejected).toBeInstanceOf(ReplyLostError);
    expect(wire.closes).toBe(1);
  });

  it('refuses a request after close, and does not send it', async () => {
    const wire = new Wire();
    const client = createRpcClient(wire, handler);
    await client.close();
    await expect(client.request('a')).rejects.toThrow(/closed/i);
    expect(wire.sent).toHaveLength(0);
  });
});
