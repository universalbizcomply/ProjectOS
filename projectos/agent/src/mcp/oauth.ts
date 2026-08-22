/**
 * The smallest OAuth an MCP client will accept, and nothing else.
 *
 * WHY THIS EXISTS. ChatGPT will not create a Tunnel connector without an authentication mode, and the
 * one it offers alongside Tunnel is OAuth. The MCP authorization spec it implements expects the
 * resource server to publish where its authorization server is, and that server to run an
 * authorization-code flow with PKCE. OpenAI's own `tunnel-client dev mcp-stub` publishes exactly that
 * on loopback, which is the shape copied here.
 *
 * IT IS NOT AN IDENTITY SYSTEM, AND MUST NEVER BECOME ONE. There are no users, no accounts, no
 * refresh tokens, no OIDC, no persistence beyond this process. What it decides is one thing: whether
 * a caller arriving over the tunnel may reach the bridge's read-only vocabulary. That is CONNECTOR
 * ACCESS. It grants no ProjectOS authority whatsoever — every owner gate, every protected action and
 * every governance decision is untouched by it and remains exactly where it was.
 *
 * THE CONSENT IS A PIN THE OPERATOR CAN ONLY HAVE READ FROM THE BRIDGE'S OWN TERMINAL.
 *
 * The first version of this reasoned that reaching 127.0.0.1 already meant "someone at the owner's
 * console", so an approval form was consent enough. That was wrong, and adversarial review caught it:
 * the form's handle is delivered to whoever asked for it, so a caller that is not a browser simply
 * reads the handle out of the page and posts it back to itself. Every part of the "consent" was
 * performed by the requester. Through a tunnel — the only reason this surface exists — that made the
 * installation's own token decorative: anyone reaching the tunnel could mint an equivalent credential
 * for themselves. The project's own end-to-end test was, in fact, the exploit.
 *
 * So approval now needs a value that is never returned over HTTP: a short PIN printed once, to the
 * terminal running the bridge, next to the port. A caller that can read that has the operator's
 * console, which is what "the owner approved it" was supposed to mean all along.
 *
 * EVERYTHING IS IN MEMORY, ON PURPOSE. Codes live for a minute, tokens for an hour, and a restart
 * invalidates both. Nothing here is worth persisting, and persistence would be one more place a
 * credential could sit.
 *
 * Written for PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A, criterion 15, under the owner ruling of
 * 2026-08-21 authorising the minimum OAuth compatibility required by the Secure MCP Tunnel.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** The one scope this surface has. Read-only governed state; nothing that acts. */
export const BRIDGE_SCOPE = 'projectos.read';

/**
 * Where ChatGPT is allowed to be sent back to.
 *
 * AN ALLOWLIST, NOT A PATTERN. An open redirect in an authorization server is how a code reaches
 * somebody else's browser, and "starts with https://chatgpt.com" is not a check — it matches
 * `https://chatgpt.com.example.invalid/` too. These two are the redirect URIs OpenAI documents; a
 * third can be added by the owner for a local test and by nobody else.
 */
export const CHATGPT_REDIRECT_URIS: readonly string[] = [
  'https://chatgpt.com/connector_platform_oauth_redirect',
  'https://chatgpt.com/oauth/callback',
];

const CODE_TTL_MS = 60_000;
const TOKEN_TTL_MS = 60 * 60_000;

/**
 * How much entropy the approval PIN carries.
 *
 * SIX BYTES, NOT FOUR. It began at four — thirty-two bits — which was defensible: the route is
 * loopback-only, and a wrong PIN spends the pending request, so every guess costs a fresh
 * authorization round trip. But it was the weakest primitive in this file by a factor of thousands
 * while everything around it uses sixteen or thirty-two bytes, and the difference costs one
 * character. Twelve hex digits is still something a person types once off a terminal.
 *
 * WHAT IT IS AND IS NOT PROTECTING. Not a local attacker with the operator's own privileges — that
 * one reads the bridge token off disk and never comes here. It stands between an authorization
 * request and a code for anything that can reach loopback but cannot read the operator's files.
 */
const PIN_BYTES = 6;

/**
 * How many of each may be held at once.
 *
 * THE AUTHORIZE ROUTE IS UNAUTHENTICATED, BY NECESSITY — a client cannot present a token it has not
 * been issued yet. That makes it the cheapest thing on this surface to call in a loop, and every call
 * used to park an entry that lived until it expired. A bound with oldest-first eviction costs nothing
 * and turns an unbounded memory growth into a bounded one. The numbers are far above any real use: a
 * connector authorises once.
 */
const MAX_PENDING = 64;
const MAX_CODES = 64;
/**
 * How many approvals one source may have waiting at once.
 *
 * Pending approvals are evicted oldest-first once the map is full, so without this a flood of
 * anonymous `/authorize` requests would quietly discard the one approval the owner is part-way
 * through — an outage that produces no error anybody would see, on a surface that exists for a single
 * person. Capping per source does not make flooding impossible, since a caller with many addresses
 * can still fill the map; it makes it cost many addresses instead of one script, and it means the
 * flooder is refused rather than the owner.
 */
const MAX_PENDING_PER_CLIENT = 8;

/** Drop what has expired, then the oldest, until the map is within its bound. */
function prune<T extends { readonly expiresAt: number }>(map: Map<string, T>, limit: number): void {
  const now = Date.now();
  for (const [key, value] of map) {
    if (value.expiresAt < now) map.delete(key);
  }
  while (map.size >= limit) {
    const oldest = map.keys().next();
    if (oldest.done === true) break;
    map.delete(oldest.value);
  }
}

export interface OAuthConfig {
  /** The public origin this server is reached at, as the client sees it. */
  readonly issuer: string;
  /** The MCP endpoint this authorization protects. */
  readonly resource: string;
  /**
   * The key that ties the two halves together.
   *
   * ACCESS TOKENS ARE SIGNED, NOT REMEMBERED. They used to be random strings in a `Map`, which works
   * only while the authorization server and the resource server are the same process. They are not:
   * ChatGPT's discovery reaches the authorization server over the public internet while the MCP
   * endpoint stays private behind the tunnel, so the side that mints a token and the side that
   * accepts one are different machines. A signed token needs no shared storage, no lookup and no
   * network call between them — only this key, which both sides read from their own configuration
   * and neither ever transmits.
   */
  readonly signingKey: string;
  /**
   * Where a client should look for this resource's metadata, when that is not the resource's own
   * origin. RFC 9728 lets a resource server point at its metadata from a `WWW-Authenticate` header,
   * and the document may live elsewhere — which is the whole reason a private MCP endpoint can take
   * part in a discovery flow it cannot itself answer.
   */
  readonly resourceMetadataUrl?: string;
}

interface PendingCode {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly resource: string;
  readonly scope: string;
  readonly expiresAt: number;
}

/** One process's worth of state. Deliberately not written anywhere. */
export interface OAuthState {
  readonly codes: Map<string, PendingCode>;
  /** Authorization requests waiting for the operator to type the PIN. */
  readonly pending: Map<
    string,
    { readonly params: AuthorizeParams; readonly client: string; readonly expiresAt: number }
  >;
  /**
   * The approval PIN for this process.
   *
   * NEVER RETURNED OVER HTTP, in any response, on any route. It is printed once to the terminal that
   * started the bridge and exists so that approving is an act of the operator rather than of the
   * caller. A fresh one per process, so a restart invalidates whatever anyone wrote down.
   */
  readonly pin: string;
}

export function newOAuthState(): OAuthState {
  return { codes: new Map(), pending: new Map(), pin: randomBytes(PIN_BYTES).toString('hex') };
}

export interface AuthorizeParams {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
  readonly scope: string;
  readonly resource: string;
}

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string; readonly description: string };

const fail = (error: string, description: string): Outcome<never> => ({ ok: false, error, description });
const good = <T>(value: T): Outcome<T> => ({ ok: true, value });

function constantEquals(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) {
    timingSafeEqual(y, y);
    return false;
  }
  return timingSafeEqual(x, y);
}

/** RFC 9728. Tells the client which authorization server governs this resource. */
export function protectedResourceMetadata(config: OAuthConfig): unknown {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [BRIDGE_SCOPE],
    bearer_methods_supported: ['header'],
  };
}

/**
 * RFC 8414. What this authorization server can do — and, by omission, what it cannot.
 *
 * No `refresh_token` grant, no `client_secret_*` auth method: this is a public client doing PKCE, so
 * there is no secret to store, to leak, or to rotate. Advertising less is the point.
 */
export function authorizationServerMetadata(config: OAuthConfig): unknown {
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/authorize`,
    token_endpoint: `${config.issuer}/token`,
    registration_endpoint: `${config.issuer}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [BRIDGE_SCOPE],
  };
}

function allowedRedirects(): readonly string[] {
  return CHATGPT_REDIRECT_URIS;
}

/**
 * RFC 7591, the smallest version of it.
 *
 * REGISTRATION IS AN ECHO, AND NOW SAYS SO. It used to store what it registered in a map that nothing
 * ever read — a check the comment described and the code did not perform. What actually constrains
 * where a code may be sent is the fixed allowlist below, which applies to every authorization request
 * whatever client id it carries. Keeping unread state around only invites someone to believe it is
 * doing something.
 */
export function registerClient(body: unknown): Outcome<unknown> {
  const parsed = body as { redirect_uris?: unknown; client_name?: unknown } | null;
  const requested = Array.isArray(parsed?.redirect_uris) ? (parsed?.redirect_uris as unknown[]) : [];
  const uris = requested.filter((u): u is string => typeof u === 'string');
  if (uris.length === 0) return fail('invalid_client_metadata', 'redirect_uris is required');
  const rejected = uris.filter((u) => !allowedRedirects().includes(u));
  if (rejected.length > 0) {
    return fail('invalid_redirect_uri', 'a redirect URI outside this installation\'s allowlist was requested');
  }
  const clientId = `projectos-connector-${randomBytes(8).toString('hex')}`;
  return good({
    client_id: clientId,
    redirect_uris: uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    scope: BRIDGE_SCOPE,
  });
}

/** Read an authorization request, or say exactly why it is not one. */
export function readAuthorizeParams(query: URLSearchParams, config: OAuthConfig): Outcome<AuthorizeParams> {
  const get = (k: string): string => (query.get(k) ?? '').trim();
  const responseType = get('response_type');
  if (responseType !== 'code') return fail('unsupported_response_type', 'only the authorization code flow is supported');

  const redirectUri = get('redirect_uri');
  // CHECKED BEFORE ANYTHING ELSE IS ECHOED ANYWHERE. An unvalidated redirect target is the one error
  // an authorization server must never make, so nothing is sent to it until it is known to be ours.
  if (!allowedRedirects().includes(redirectUri)) {
    return fail('invalid_request', 'redirect_uri is not one this installation allows');
  }
  const clientId = get('client_id');
  if (clientId === '') return fail('invalid_request', 'client_id is required');

  const state = get('state');
  if (state === '') return fail('invalid_request', 'state is required');

  const method = get('code_challenge_method');
  if (method !== 'S256') return fail('invalid_request', 'PKCE is required and only S256 is accepted');
  const challenge = get('code_challenge');
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(challenge)) return fail('invalid_request', 'code_challenge is malformed');

  const scope = get('scope') === '' ? BRIDGE_SCOPE : get('scope');
  if (scope.split(/\s+/).some((s) => s !== BRIDGE_SCOPE)) {
    return fail('invalid_scope', `this bridge issues only '${BRIDGE_SCOPE}'`);
  }
  // RFC 8707. The token must be for THIS resource, so it cannot be replayed at another one.
  const resource = get('resource') === '' ? config.resource : get('resource');
  if (resource !== config.resource) return fail('invalid_target', 'resource does not name this bridge');

  return good({ clientId, redirectUri, state, codeChallenge: challenge, codeChallengeMethod: method, scope, resource });
}

/** Park a validated request until the operator approves it. Returns the handle the form posts back. */
export function holdForApproval(state: OAuthState, params: AuthorizeParams, client: string): string | null {
  prune(state.pending, MAX_PENDING);
  let held = 0;
  for (const pending of state.pending.values()) if (pending.client === client) held += 1;
  if (held >= MAX_PENDING_PER_CLIENT) return null;

  const handle = randomBytes(16).toString('hex');
  state.pending.set(handle, { params, client, expiresAt: Date.now() + CODE_TTL_MS });
  return handle;
}

/**
 * The operator typed the PIN. Mint the one-time code.
 *
 * THE PENDING ENTRY IS SPENT EITHER WAY. A handle that survived a failed approval would let someone
 * guess the PIN at leisure; one attempt per authorization request is the whole budget.
 */
export function approve(
  state: OAuthState,
  handle: string,
  pin: string,
): Outcome<{ redirectUri: string; code: string; state: string }> {
  const held = state.pending.get(handle);
  state.pending.delete(handle);
  if (held === undefined || held.expiresAt < Date.now()) {
    return fail('invalid_request', 'this authorization request has expired; start again');
  }
  if (!constantEquals(pin, state.pin)) {
    return fail('access_denied', 'that is not the approval PIN shown on the ProjectOS bridge terminal');
  }
  prune(state.codes, MAX_CODES);
  const code = randomBytes(32).toString('base64url');
  state.codes.set(code, {
    clientId: held.params.clientId,
    redirectUri: held.params.redirectUri,
    codeChallenge: held.params.codeChallenge,
    resource: held.params.resource,
    scope: held.params.scope,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return good({ redirectUri: held.params.redirectUri, code, state: held.params.state });
}


/**
 * Exchange a code for a token, once.
 *
 * THE CODE IS DELETED BEFORE IT IS JUDGED. Whatever happens next — a PKCE mismatch, a wrong redirect,
 * an expiry — the code is spent. A code that survives its own failed exchange is a code an attacker
 * may try again with a different verifier.
 */
export function exchangeCode(state: OAuthState, form: URLSearchParams, config: OAuthConfig): Outcome<unknown> {
  const get = (k: string): string => (form.get(k) ?? '').trim();
  if (get('grant_type') !== 'authorization_code') {
    return fail('unsupported_grant_type', 'only authorization_code is supported');
  }
  const code = get('code');
  const held = state.codes.get(code);
  state.codes.delete(code);
  if (held === undefined) return fail('invalid_grant', 'unknown or already-used authorization code');
  if (held.expiresAt < Date.now()) return fail('invalid_grant', 'the authorization code has expired');
  if (get('redirect_uri') !== held.redirectUri) return fail('invalid_grant', 'redirect_uri does not match the authorization');
  if (get('client_id') !== held.clientId) return fail('invalid_grant', 'client_id does not match the authorization');

  const verifier = get('code_verifier');
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return fail('invalid_grant', 'code_verifier is malformed');
  const derived = createHash('sha256').update(verifier).digest('base64url');
  if (!constantEquals(derived, held.codeChallenge)) return fail('invalid_grant', 'PKCE verification failed');

  const requestedResource = get('resource');
  if (requestedResource !== '' && requestedResource !== held.resource) {
    return fail('invalid_target', 'resource does not match the authorization');
  }

  const accessToken = signAccessToken(config.signingKey, {
    audience: held.resource,
    scope: held.scope,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return good({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(TOKEN_TTL_MS / 1000),
    scope: held.scope,
  });
}

/**
 * Is this bearer token one we issued, for this resource, still valid?
 *
 * `null` when it is. A reason otherwise — never returned to the caller, only used to decide.
 */
interface TokenClaims {
  readonly audience: string;
  readonly scope: string;
  readonly expiresAt: number;
}

/**
 * Mint a token that carries its own proof.
 *
 * The claims travel in the clear and the signature is what makes them true — there is nothing secret
 * in a token beyond the fact that only a holder of the key could have produced it. Anyone may read
 * what it is for; only the two halves of this system may issue one.
 */
export function signAccessToken(key: string, claims: TokenClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signature = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

/**
 * Is this bearer token one THIS system issued, for this resource, still valid?
 *
 * `null` when it is; a reason otherwise, used only to decide and never returned to the caller.
 *
 * THE SIGNATURE IS CHECKED BEFORE THE CLAIMS ARE BELIEVED. Reading the payload first and validating
 * afterwards would mean acting on numbers an attacker chose — an expiry of their liking, an audience
 * of their liking — for however long it took to reach the comparison.
 */
export function verifyAccessToken(token: string, config: OAuthConfig): string | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return 'malformed token';
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = createHmac('sha256', config.signingKey).update(payload).digest('base64url');
  if (!constantEquals(signature, expected)) return 'signature does not verify';

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return 'unreadable token claims';
  }
  // JSON.parse SUCCEEDS ON `null`, AND ON NUMBERS, STRINGS AND ARRAYS. Only an object has the
  // properties this reads, and reading a property of `null` throws — inside a request handler, which
  // would take the whole bridge down rather than refuse one token. The type assertion below is only
  // honest once this has been checked.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'unreadable token claims';
  const claims = parsed as TokenClaims;
  if (typeof claims.expiresAt !== 'number' || claims.expiresAt < Date.now()) return 'expired token';
  // AUDIENCE, NOT JUST VALIDITY. A token minted for another resource is not a token for this one.
  if (claims.audience !== config.resource) return 'token was issued for another resource';
  if (typeof claims.scope !== 'string' || !claims.scope.split(/\s+/).includes(BRIDGE_SCOPE)) {
    return 'token does not carry the required scope';
  }
  return null;
}

/**
 * The approval page.
 *
 * PLAIN, AND IT SAYS WHAT IS BEING GRANTED. No styling, no script, nothing fetched from anywhere. The
 * handle is the only thing that travels, and it is opaque.
 */
export function approvalPage(handle: string, params: AuthorizeParams): string {
  const escape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>ProjectOS bridge authorization</title></head>',
    '<body style="font-family:system-ui;max-width:40rem;margin:3rem auto;line-height:1.5">',
    '<h1>Authorise this connector?</h1>',
    '<p>A client is asking for read-only access to this ProjectOS bridge.</p>',
    '<ul>',
    `<li>client: <code>${escape(params.clientId)}</code></li>`,
    `<li>returns to: <code>${escape(params.redirectUri)}</code></li>`,
    `<li>scope: <code>${escape(params.scope)}</code> — read-only governed state</li>`,
    `<li>resource: <code>${escape(params.resource)}</code></li>`,
    '</ul>',
    '<p><strong>This grants connector access only.</strong> It grants no ProjectOS owner authority: it',
    'cannot approve a gate, close a phase, commit, push, deploy, spend, or take any protected action.</p>',
    `<form method="POST" action="/authorize/approve"><input type="hidden" name="handle" value="${escape(handle)}">`,
    '<p><label>Approval PIN, from the terminal running the ProjectOS bridge:<br>',
    '<input name="pin" autocomplete="off" style="font-size:1rem;padding:.4rem"></label></p>',
    '<button type="submit" style="font-size:1rem;padding:.5rem 1rem">Approve</button></form>',
    '<p style="color:#666">If you did not start this, close this page. Nothing is granted without the PIN,',
    'and the PIN is never sent over this connection — it is printed only on the bridge\'s own terminal.</p>',
    '</body></html>',
  ].join('\n');
}
