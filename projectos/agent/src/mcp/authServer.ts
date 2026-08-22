/**
 * The OAuth routes, in one place, because there are now two processes that need them.
 *
 * WHY THIS MODULE EXISTS. ChatGPT discovers OAuth automatically — its documentation states that
 * "configuration flows entirely through automated discovery", with no way to type an authorization
 * endpoint into the interface — and discovery could not reach a loopback address behind the tunnel.
 * So the discovery surface has to stand where ChatGPT can read it while the MCP control surface stays
 * private. Two processes, one set of rules: copying these routes into a second file would be two sets
 * of rules that agree until the day they do not.
 *
 * EVERY ROUTE HERE IS UNAUTHENTICATED, BY NECESSITY. A client cannot present a token it has not been
 * issued yet. That makes this the whole of the reachable surface, and each route is written to give
 * nothing away: metadata is a fixed document, registration cannot widen the redirect allowlist,
 * authorization refuses before it echoes anything anywhere, and exchange spends the code before it
 * judges it. Approval additionally needs a PIN that is never returned over HTTP.
 *
 * NOTHING HERE TAKES A URL, HOST, PORT OR FILE NAME FROM A CALLER. There is no route that fetches,
 * forwards, reads or executes anything on a caller's behalf. This is not a gateway and must never
 * acquire a way to become one.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  approvalPage,
  approve,
  authorizationServerMetadata,
  exchangeCode,
  holdForApproval,
  protectedResourceMetadata,
  readAuthorizeParams,
  registerClient,
  type OAuthConfig,
  type OAuthState,
} from './oauth.js';

export interface AuthSurface {
  readonly state: OAuthState;
  readonly config: OAuthConfig;
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
export const OAUTH_ROUTES = [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/mcp',
  '/authorize',
  '/authorize/approve',
  '/token',
  '/register',
];

/** Fixed refusals. Chosen in advance so no local detail can be improvised into one. */
export const REFUSALS = {
  notFound: 'not found',
  tooLarge: 'request too large',
  badJson: 'not a JSON-RPC message',
  unauthorised: 'unauthorised',
} as const;

export function send(response: ServerResponse, status: number, body: unknown): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  response.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'content-length': Buffer.byteLength(text),
    // A bridge is not a website. Nothing here is cacheable and nothing may be framed.
    'cache-control': 'no-store',
  });
  response.end(text);
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
  });
  response.end(html);
}

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

/**
 * Every OAuth route, and nothing beyond them.
 *
 * The paths are matched exactly against a fixed list before this is called, so there is no routing
 * left to get wrong here and no way to reach anything that is not on it.
 */
/**
 * The host this server believes it is reached at, taken from its own issuer.
 *
 * There is no other trustworthy source for it. A `Host` header is written by whoever sent the
 * request, so it can only ever be checked against something the sender did not choose.
 */
function expectedHost(config: OAuthConfig): string {
  try {
    return new URL(config.issuer).host.toLowerCase();
  } catch {
    return '';
  }
}

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function isLoopback(host: string): boolean {
  // CHECKED WHOLE BEFORE IT IS TAKEN APART. A bare IPv6 address is not a host:port pair, and splitting
  // `::1` on a colon yields an empty first field — so stripping a port first would decide that the
  // IPv6 loopback address is not loopback. That is the form Node reports for a socket on `::1`.
  if (LOOPBACK_NAMES.has(host)) return true;
  const withoutPort = host.startsWith('[') ? (host.split(']')[0] ?? '') + ']' : (host.split(':')[0] ?? '');
  return LOOPBACK_NAMES.has(withoutPort);
}

export function handleOAuth(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  auth: AuthSurface,
): void {
  const { state, config } = auth;

  // THE BROWSER-FACING ROUTES MUST BE ADDRESSED TO THIS SERVER BY ITS OWN NAME.
  //
  // `/authorize` and its approval are the only routes a person is meant to reach, and the request has
  // to arrive addressed to the origin this server publishes as its issuer. A name that resolves here
  // but is not our name is refused, which is what takes the value out of a DNS-rebinding attempt.
  //
  // IT CANNOT SIMPLY DEMAND LOOPBACK, THOUGH AN EARLIER SINGLE-PROCESS VERSION DID. ChatGPT redirects
  // the owner's browser to the PUBLIC authorization endpoint, so the browser arrives carrying the
  // public hostname: a hardcoded loopback check would refuse the exact flow this server exists to
  // serve. Deriving the answer from the issuer is strict in both deployments and needs no switch
  // between them.
  //
  // Metadata, token and registration are machine-to-machine and are deliberately NOT restricted this
  // way, because they must answer through the tunnel whatever Host they carry.
  if (path === '/authorize' || path === '/authorize/approve') {
    const host = (request.headers.host ?? '').toLowerCase();
    const expected = expectedHost(config);
    // A loopback issuer answers to several names that all mean this machine — but ONLY for a request
    // that genuinely came from this machine. A `Host` header is written by the sender, so on its own
    // it says nothing about where a request originated; the socket does. Without this, anything able
    // to deliver a request to a local port could claim to be the console by simply saying so.
    const remote = request.socket.remoteAddress ?? '';
    const fromThisMachine = isLoopback(remote) || remote === '::ffff:127.0.0.1';
    const addressedHere = host === expected || (isLoopback(expected) && isLoopback(host) && fromThisMachine);
    if (expected === '' || !addressedHere) {
      sendHtml(
        response,
        403,
        '<!doctype html><p>This authorization page is not served under that name.</p>',
      );
      return;
    }
    // CROSS-SITE FORM POSTS. The approval is a plain form, so nothing about it would provoke a
    // preflight and a page anywhere could submit one. The PIN already makes that useless — it never
    // travels over HTTP, and a wrong one spends the pending approval rather than inviting another
    // guess — but when a browser volunteers where the post came from, it is worth reading.
    const origin = request.headers.origin;
    if (typeof origin === 'string' && origin !== '' && origin.toLowerCase() !== config.issuer.toLowerCase()) {
      sendHtml(response, 403, '<!doctype html><p>This approval did not come from this site.</p>');
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
    const handle = holdForApproval(state, read.value, request.socket.remoteAddress ?? '');
    if (handle === null) {
      sendHtml(response, 429, '<!doctype html><p>Too many authorization attempts are already waiting.</p>');
      return;
    }
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


/**
 * Serve ONLY the authorization server, for the process that has no MCP endpoint at all.
 *
 * Anything not on the route list is a 404 here — there is no other surface in that process, so there
 * is nothing else for a request to reach.
 */
export function serveAuthorizationServer(request: IncomingMessage, response: ServerResponse, auth: AuthSurface): void {
  const path = (request.url ?? '').split('?')[0] ?? '';
  if (!OAUTH_ROUTES.includes(path)) {
    send(response, 404, REFUSALS.notFound);
    return;
  }
  handleOAuth(request, response, path, auth);
}
