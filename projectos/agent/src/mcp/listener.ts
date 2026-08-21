/**
 * The socket the owner's bridge listens on, and the rules it may not break.
 *
 * OUTBOUND-ONLY MEANS NOTHING LISTENS PUBLICLY. The tunnel makes an outbound connection from this
 * machine; nothing dials in. That property is only real if the listener itself is unreachable from the
 * network, so the bind address is loopback and is not configurable — an option to change it is an
 * option somebody sets to `0.0.0.0` at 2am to make a demo work. `PROJECTOS_BRIDGE_HOST` is read only
 * so that a non-loopback value can be REFUSED out loud rather than silently ignored.
 *
 * THE TOKEN IS THE OWNER'S, AND PROJECTOS NEVER MINTS ONE. Creating a credential is an owner-protected
 * act; a bridge that generates its own bearer token has quietly created material authority and then
 * authenticated itself with it. So the token is supplied by the owner and the listener refuses to
 * start without one. A bridge with no token would be a bridge where the tunnel is the only thing
 * standing between a conversation and a governed machine.
 *
 * NOTHING ABOUT THE MACHINE GOES BACK OUT. No path, no host, no port, no stack. Errors are fixed
 * strings chosen in advance, because an error message is the classic place a local address escapes.
 *
 * Written for PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A, criterion 15.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { System } from '../system.js';
import type { JsonRpcRequest, JsonRpcResponse } from './bridge.js';

/** The only address this bridge will ever bind. */
export const BRIDGE_BIND_HOST = '127.0.0.1';
export const BRIDGE_PATH = '/mcp';
/** A request bigger than this is not an MCP message; it is someone finding out what happens. */
export const MAX_REQUEST_BYTES = 256 * 1024;
export const BRIDGE_TOKEN_FILENAME = 'bridge-token';

export interface ListenerConfig {
  readonly ready: boolean;
  readonly problems: readonly string[];
  /** Present only when ready. Never logged, never returned to a client, never put in a record. */
  readonly token: string | null;
  readonly port: number;
}

/**
 * What the owner has actually provided, and whether it is enough to listen at all.
 *
 * Pure, so the refusals can be proven without opening a socket.
 */
export function bridgeListenerConfig(
  sys: System,
  stateDir: string,
  env: NodeJS.ProcessEnv = process.env,
): ListenerConfig {
  const problems: string[] = [];

  const host = env['PROJECTOS_BRIDGE_HOST'];
  if (typeof host === 'string' && host.trim() !== '' && host.trim() !== BRIDGE_BIND_HOST) {
    problems.push(
      `this bridge binds ${BRIDGE_BIND_HOST} and nothing else; a bind address of '${host.trim()}' would ` +
        'make it reachable from the network, which is the one thing an outbound-only bridge may not be',
    );
  }

  // THE OWNER'S TOKEN, FROM THE OWNER'S OWN STATE. The environment is read first because that is how
  // a launcher supplies it without it ever touching a disk.
  const fromEnv = env['PROJECTOS_BRIDGE_TOKEN'];
  const fromFile = sys.readText(join(stateDir, BRIDGE_TOKEN_FILENAME));
  const token = (typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv : (fromFile ?? '')).trim();
  if (token === '') {
    problems.push(
      'no bridge token is configured, so this bridge will not listen. Put one in ' +
        `PROJECTOS_BRIDGE_TOKEN, or in the ${BRIDGE_TOKEN_FILENAME} file in the installation state ` +
        'directory. ProjectOS does not create one for you: minting a credential is the owner\'s act',
    );
  } else if (token.length < 32) {
    problems.push('the bridge token is too short to be a credential; use at least 32 characters');
  }

  const rawPort = env['PROJECTOS_BRIDGE_PORT'];
  let port = 0; // 0 = let the OS choose, which is right for a tunnel that is told the port
  if (typeof rawPort === 'string' && rawPort.trim() !== '') {
    const parsed = Number(rawPort);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      problems.push('PROJECTOS_BRIDGE_PORT is not a port number');
    } else {
      port = parsed;
    }
  }

  return { ready: problems.length === 0, problems, token: problems.length === 0 ? token : null, port };
}

/** Constant-time compare that does not leak length through early exit. */
function sameToken(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still do the work, so a wrong length is not measurably faster than a wrong byte.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function bearer(request: IncomingMessage): string {
  const header = request.headers['authorization'];
  const value = Array.isArray(header) ? (header[0] ?? '') : (header ?? '');
  return value.startsWith('Bearer ') ? value.slice('Bearer '.length).trim() : '';
}

/** Fixed refusals. Chosen in advance so no local detail can be improvised into one. */
const REFUSALS = {
  notFound: 'not found',
  tooLarge: 'request too large',
  badJson: 'not a JSON-RPC message',
  unauthorised: 'unauthorised',
} as const;

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  response.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'content-length': Buffer.byteLength(text),
    // A bridge is not a website. Nothing here is cacheable and nothing may be framed.
    'cache-control': 'no-store',
  });
  response.end(text);
}

export interface BridgeServer {
  /** The port actually bound. Told to the tunnel client by the operator; never sent to a client. */
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Serve the bridge on loopback until closed.
 *
 * `handle` is the pure decision function; this adapter carries bytes and nothing else. That split is
 * why the whole authority surface can be proven without a socket, and why replacing the transport
 * later cannot change what is allowed.
 */
export function serveBridge(
  config: ListenerConfig,
  handle: (request: JsonRpcRequest) => JsonRpcResponse | null,
): Promise<BridgeServer> {
  if (!config.ready || config.token === null) {
    return Promise.reject(new Error('the bridge is not configured to listen'));
  }
  const expected = config.token;

  const server = createServer((request, response) => {
    if (request.method !== 'POST' || (request.url ?? '') !== BRIDGE_PATH) {
      send(response, 404, REFUSALS.notFound);
      return;
    }
    // AUTHENTICATE BEFORE READING A BODY. An unauthenticated caller must not be able to make this
    // process buffer anything at all.
    if (!sameToken(bearer(request), expected)) {
      send(response, 401, REFUSALS.unauthorised);
      return;
    }

    let size = 0;
    const chunks: Buffer[] = [];
    let aborted = false;
    request.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        aborted = true;
        send(response, 413, REFUSALS.tooLarge);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (aborted) return;
      let parsed: JsonRpcRequest;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonRpcRequest;
      } catch {
        send(response, 400, REFUSALS.badJson);
        return;
      }
      let answer: JsonRpcResponse | null;
      try {
        answer = handle(parsed);
      } catch {
        // NOTHING ABOUT THE FAILURE TRAVELS. A stack trace names paths, and paths name this machine.
        send(response, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'internal error' } });
        return;
      }
      if (answer === null) {
        send(response, 202, '');
        return;
      }
      send(response, 200, answer);
    });
  });

  return new Promise<BridgeServer>((resolve, reject) => {
    server.on('error', reject);
    server.listen(config.port, BRIDGE_BIND_HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
