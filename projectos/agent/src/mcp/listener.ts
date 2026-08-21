/**
 * The socket the owner's bridge listens on, and the rules it may not break.
 *
 * OUTBOUND-ONLY MEANS NOTHING LISTENS PUBLICLY. The tunnel makes an outbound connection from this
 * machine; nothing dials in. That property is only real if the listener itself is unreachable from the
 * network, so the bind address is loopback and is not configurable — an option to change it is an
 * option somebody sets to `0.0.0.0` at 2am to make a demo work. `PROJECTOS_BRIDGE_HOST` is read only
 * so that a non-loopback value can be REFUSED out loud rather than silently ignored.
 *
 * THE TOKEN IS NEVER MINTED AS A SIDE EFFECT. Creating a credential is an owner-protected act; a
 * bridge that generates its own bearer token when it happens to need one has quietly created material
 * authority and then authenticated itself with it. So this listener creates nothing: it reads a token
 * the owner supplied, or one minted by the explicit `projectos mcp token --create` command, and
 * refuses to start without either. A bridge with no token would be a bridge where the tunnel is the
 * only thing standing between a conversation and a governed machine.
 *
 * NOTHING ABOUT THE MACHINE GOES BACK OUT, WITH ONE DECLARED EXCEPTION. No path, no stack, no
 * credential; errors are fixed strings chosen in advance, because an error message is the classic
 * place a local address escapes.
 *
 * THE EXCEPTION IS THE OAUTH SURFACE, AND IT IS UNAVOIDABLE. Discovery works by publishing where the
 * authorization endpoints are, so the metadata documents and the `WWW-Authenticate` challenge do
 * return this bridge's loopback host and port to an unauthenticated caller. That is what makes a
 * connector able to find its way in, and it is the price of OAuth working at all. What those
 * addresses reveal is that something listens on loopback here — not what it is, not where the
 * project lives, and nothing that can be reached without the flow. Recorded plainly rather than left
 * as an invariant this file no longer keeps.
 *
 * Written for PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A, criterion 15.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { System } from '../system.js';
import type { JsonRpcRequest, JsonRpcResponse } from './bridge.js';
import {
  approvalPage,
  approve,
  authorizationServerMetadata,
  exchangeCode,
  holdForApproval,
  newOAuthState,
  protectedResourceMetadata,
  readAuthorizeParams,
  registerClient,
  verifyAccessToken,
  type OAuthConfig,
  type OAuthState,
} from './oauth.js';

/** The only address this bridge will ever bind. */
export const BRIDGE_BIND_HOST = '127.0.0.1';
export const BRIDGE_PATH = '/mcp';
/** A request bigger than this is not an MCP message; it is someone finding out what happens. */
export const MAX_REQUEST_BYTES = 256 * 1024;
export const BRIDGE_TOKEN_FILENAME = 'bridge-token';
/** 32 bytes of entropy, base64url — the minimum the owner's C15 authorisation specifies. */
export const BRIDGE_TOKEN_BYTES = 32;

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
      'no bridge token is configured, so this bridge will not listen. Create one with ' +
        '`projectos mcp token --create`, or supply your own in PROJECTOS_BRIDGE_TOKEN. ProjectOS ' +
        'never mints one as a side effect of starting: it is created only by that explicit command, ' +
        'under the owner authorisation that command records',
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

/** Read a bounded body. The OAuth routes accept form posts, which are small by nature. */
function readBody(request: IncomingMessage, done: (body: string | null) => void): void {
  let size = 0;
  const chunks: Buffer[] = [];
  let aborted = false;
  request.on('data', (chunk: Buffer) => {
    if (aborted) return;
    size += chunk.length;
    if (size > 64 * 1024) {
      aborted = true;
      done(null);
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (!aborted) done(Buffer.concat(chunks).toString('utf8'));
  });
  // A HALF-SENT BODY IS STILL AN ANSWER OWED. Without this the callback never fires, the response is
  // never written, and the socket is held until Node's own request timeout — free, from anywhere.
  request.on('error', () => {
    if (!aborted) {
      aborted = true;
      done(null);
    }
  });
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
  });
  response.end(html);
}

/**
 * Every OAuth route, and nothing beyond them.
 *
 * The paths are matched exactly against a fixed list before this is called, so there is no routing
 * left to get wrong here and no way to reach anything that is not on it.
 */
function handleOAuth(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  auth: { readonly state: OAuthState; readonly config: OAuthConfig },
): void {
  const { state, config } = auth;

  // THE BROWSER-FACING ROUTES ARE FOR THIS MACHINE'S OWN BROWSER.
  //
  // `/authorize` and its approval are the only routes a person is meant to reach, and the person is
  // meant to be at this console. Requiring the request to be addressed to loopback keeps a page on
  // some other site from submitting the approval form across origins — it is a simple form post, so
  // no preflight would ever stop it — and takes away the value of a DNS-rebinding attempt. Metadata,
  // token and registration are machine-to-machine and are deliberately NOT restricted this way,
  // because they must answer through the tunnel.
  if (path === '/authorize' || path === '/authorize/approve') {
    const host = (request.headers.host ?? '').toLowerCase();
    const hostname = host.split(':')[0] ?? '';
    if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
      sendHtml(
        response,
        403,
        '<!doctype html><p>This authorization page can only be opened on the machine running the ' +
          'ProjectOS bridge.</p>',
      );
      return;
    }
  }

  if (request.method === 'GET' && path.startsWith('/.well-known/oauth-protected-resource')) {
    send(response, 200, protectedResourceMetadata(config));
    return;
  }
  if (request.method === 'GET' && path.startsWith('/.well-known/oauth-authorization-server')) {
    send(response, 200, authorizationServerMetadata(config));
    return;
  }

  if (request.method === 'GET' && path === '/authorize') {
    const query = new URLSearchParams((request.url ?? '').split('?')[1] ?? '');
    const read = readAuthorizeParams(query, config);
    if (!read.ok) {
      // NOT REDIRECTED. A request whose redirect_uri was not accepted must never be answered with a
      // redirect, and one that failed any other check is shown to the operator, not bounced onward.
      sendHtml(response, 400, `<!doctype html><p>Refused: ${read.error} — ${read.description}</p>`);
      return;
    }
    const handle = holdForApproval(state, read.value);
    sendHtml(response, 200, approvalPage(handle, read.value));
    return;
  }

  if (request.method === 'POST' && path === '/authorize/approve') {
    readBody(request, (body) => {
      if (body === null) {
        send(response, 413, REFUSALS.tooLarge);
        return;
      }
      const form = new URLSearchParams(body);
      const granted = approve(state, (form.get('handle') ?? '').trim(), (form.get('pin') ?? '').trim());
      if (!granted.ok) {
        sendHtml(response, 400, `<!doctype html><p>Refused: ${granted.error} — ${granted.description}</p>`);
        return;
      }
      const target = new URL(granted.value.redirectUri);
      target.searchParams.set('code', granted.value.code);
      target.searchParams.set('state', granted.value.state);
      response.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' });
      response.end();
    });
    return;
  }

  if (request.method === 'POST' && path === '/token') {
    readBody(request, (body) => {
      if (body === null) {
        send(response, 413, REFUSALS.tooLarge);
        return;
      }
      const result = exchangeCode(state, new URLSearchParams(body), config);
      if (!result.ok) {
        send(response, 400, { error: result.error, error_description: result.description });
        return;
      }
      send(response, 200, result.value);
    });
    return;
  }

  if (request.method === 'POST' && path === '/register') {
    readBody(request, (body) => {
      if (body === null) {
        send(response, 413, REFUSALS.tooLarge);
        return;
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        send(response, 400, { error: 'invalid_client_metadata', error_description: 'body is not JSON' });
        return;
      }
      const result = registerClient(parsed);
      if (!result.ok) {
        send(response, 400, { error: result.error, error_description: result.description });
        return;
      }
      send(response, 201, result.value);
    });
    return;
  }

  send(response, 404, REFUSALS.notFound);
}

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

/**
 * The OAuth routes, which are necessarily unauthenticated.
 *
 * A CLIENT CANNOT PRESENT A TOKEN IT HAS NOT BEEN ABLE TO OBTAIN YET, so metadata, authorization,
 * registration and exchange all answer without one. That makes them the whole of the new reachable
 * surface, and each is written to give nothing away: metadata is a fixed document, registration
 * cannot widen the redirect allowlist, authorization refuses before it echoes anything anywhere, and
 * exchange spends the code before it judges it.
 */
const OAUTH_ROUTES = [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/mcp',
  '/authorize',
  '/authorize/approve',
  '/token',
  '/register',
];

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
  /**
   * The OAuth surface, if this bridge is to have one.
   *
   * `issuerFor` RATHER THAN A FIXED CONFIG, because the origin is not knowable until the socket is
   * bound. Composing it beforehand from an optional port variable meant the default deployment — the
   * one that lets the OS choose a port, which the tunnel is then told — published
   * `http://127.0.0.1:0` as its issuer, authorization endpoint and token endpoint, and compared the
   * RFC 8707 audience against that same constant. Unusable metadata, and a binding that checked
   * nothing. It is resolved here, once, from the port actually bound.
   */
  oauth?: { readonly state: OAuthState; readonly issuerFor: (port: number) => OAuthConfig },
): Promise<BridgeServer> {
  if (!config.ready || config.token === null) {
    return Promise.reject(new Error('the bridge is not configured to listen'));
  }
  const expected = config.token;
  let auth: { readonly state: OAuthState; readonly config: OAuthConfig } | null = null;

  const server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    if (auth !== null && OAUTH_ROUTES.includes(path)) {
      handleOAuth(request, response, path, auth);
      return;
    }
    if (request.method !== 'POST' || (request.url ?? '') !== BRIDGE_PATH) {
      send(response, 404, REFUSALS.notFound);
      return;
    }
    // AUTHENTICATE BEFORE READING A BODY. An unauthenticated caller must not be able to make this
    // process buffer anything at all.
    //
    // TWO CREDENTIALS ARE ACCEPTED AND THEY ARE NOT EQUAL IN ORIGIN. The installation's own token is
    // what a local operator and the tunnel-client use. An OAuth access token is what a connector
    // presents after the operator approved it at this machine's own console. Both authenticate the
    // CALLER; neither confers any ProjectOS authority, which lives entirely on the other side of
    // `checkBridgeRequest`.
    const presented = bearer(request);
    const localOk = sameToken(presented, expected);
    const oauthOk = !localOk && auth !== null && presented !== '' && verifyAccessToken(auth.state, presented, auth.config) === null;
    if (!localOk && !oauthOk) {
      // RFC 9728: tell an unauthenticated MCP client where to go and get a token.
      if (auth !== null) {
        response.setHeader(
          'WWW-Authenticate',
          `Bearer resource_metadata="${auth.config.issuer}/.well-known/oauth-protected-resource/mcp"`,
        );
      }
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
      // NOW the origin is a fact rather than a guess.
      if (oauth !== undefined) auth = { state: oauth.state, config: oauth.issuerFor(port) };
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
