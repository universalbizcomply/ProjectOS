# C15 — the public OAuth front door

**Status: NOT DEPLOYED. NOT AUTHORISED. This document describes a deployment that has not been performed.**

Everything below has been proven locally. Nothing has been exposed, no domain exists, no external
credential has been created, and no public listener has ever been started.

---

## Why there are two processes

ChatGPT's connector setup discovers OAuth automatically. Its documentation is explicit that
"configuration flows entirely through automated discovery" — there is no field in the interface where
an authorization endpoint can be typed. Discovery therefore has to *reach* the metadata.

The first shape put OAuth on the same loopback origin as the MCP endpoint, which is what OpenAI's own
`tunnel-client dev mcp-stub` does. ChatGPT reported `Error fetching OAuth configuration` and that the
server did not implement OAuth. That is consistent with the tunnel documentation, which says the
tunnel carries discovery to the *MCP server* but that "the authorization server itself is not
automatically tunneled" and "if it is unreachable from the public internet ... the OAuth flow can
still fail even when the MCP server is reachable."

So the authorization server has to stand where ChatGPT can reach it, and the MCP endpoint must not
follow it there.

| | Authorization server | MCP bridge |
|---|---|---|
| Process | `bin/projectos-oauth.js` | `bin/projectos-bridge.js` |
| Reachable from | the public internet | loopback only, via the OpenAI tunnel |
| Serves | `/authorize`, `/token`, `/register`, both metadata documents | `/mcp` and its protected-resource metadata, nothing else |
| Knows the bridge token | no | yes |
| Knows ProjectOS | nothing — it cannot read a file, run a command, or name a project | yes, read-only, seven operations |

The two processes never call each other. The only thing they share is a signing key that each reads
from its own environment: one mints tokens, the other verifies them. Neither transmits it.

## What the public process can do

Nothing except run an authorization-code flow. It has no MCP route, no ProjectOS command surface, no
filesystem or shell access, and no route that accepts a URL, host, port or filename from a caller.
It cannot be made into a proxy because there is nothing in it that fetches anything.

Every route on it is unauthenticated by necessity — a client cannot present a token it has not been
issued yet — so the only thing standing between an anonymous caller and a token is the approval PIN,
which is printed once to that process's own terminal, never travels over HTTP, and is spent whether
the guess is right or wrong.

## Hosting: bundled `cloudflared`

The vendored `tunnel-client` ships a pinned `cloudflared` (2026.7.2, release commit
`8679787525edc8575b2948a7c4a50b6292c6d426`, "security patch owner: tunnel-client maintainers") and a
`tunnel-client cloudflared config` command that prints a token-free configuration. Using it means the
public edge is a component OpenAI already vendors and patches for this purpose, rather than a new
dependency chosen for this task.

The ingress rule — which hostname forwards to which local port — is held in the Cloudflare dashboard
for a remotely-managed tunnel, not in the local config file. **The MCP bridge port must never appear
in that ingress.** Only the authorization server's port does.

## Established identity provider, or this implementation?

**Decision: this implementation. Reason: an IdP would solve a problem this system does not have, and
would create one it currently does not have.**

An established provider (Auth0, Entra, Okta, Clerk) is the right answer when there are users to
manage — a directory, passwords, recovery, federation, revocation across many people. There is one
user here, no directory, and no account. The entire question the front door must answer is "did the
owner, at this machine, approve this one connector?", and the answer is a PIN on a terminal that only
the owner can read.

Against that, an IdP would cost:

- a new external credential and a new account, which the owner would have to create and hold;
- tokens the private bridge could only validate by fetching a JWKS document, i.e. **outbound internet
  access from the private half** — the one property the split exists to avoid;
- a third party able to mint tokens that the private bridge accepts.

The honest counter-argument is that hand-written OAuth is a well-known way to get security wrong, and
that deserves to be stated rather than waved away. What limits it here is that the security-relevant
part is not federation or identity — it is one approval and one HMAC. The flow is authorization-code
with PKCE S256, an exact-equality redirect allowlist that registration cannot widen, audience and
scope binding, single-use codes, and a signature checked before any claim is believed. That surface is
small enough to be read in full, and it is covered by 37 tests and a 19-check two-process live proof.

If the answer ever becomes "many users", this decision should be revisited; it is right for one.

## Configuration

Both processes read the same three values. **ProjectOS does not create the signing key — that is an
owner act, and it is the one new secret this design needs.**

| Variable | Set on | Meaning |
|---|---|---|
| `PROJECTOS_OAUTH_ISSUER` | both | the public `https://` origin, no trailing slash |
| `PROJECTOS_OAUTH_RESOURCE` | both | the MCP resource identifier as ChatGPT sees it through the tunnel; the audience every token is bound to |
| `PROJECTOS_OAUTH_SIGNING_KEY` | both | ≥32 characters, identical on both sides, never transmitted |
| `PROJECTOS_OAUTH_PORT` | authorization server | defaults to 8788 |
| `PROJECTOS_BRIDGE_PORT` | bridge | defaults to 8787 |

Both refuse to start if the issuer is not `https://`, if it has a trailing slash, if the key is short,
or if the resource is missing. A misconfiguration fails loudly at startup rather than as an
unexplained 403 later.

If `PROJECTOS_OAUTH_ISSUER` is unset, the bridge behaves exactly as it does today: everything on
loopback, with a signing key invented at startup. Nothing about the local shape has been taken away.

## The commands — NONE OF WHICH ARE AUTHORISED

```sh
# 1. the authorization server, bound to loopback and reached only through the edge
PROJECTOS_OAUTH_ISSUER=https://<hostname> \
PROJECTOS_OAUTH_RESOURCE=<tunnel MCP URL> \
PROJECTOS_OAUTH_SIGNING_KEY=<owner-created, >=32 chars> \
node projectos/agent/bin/projectos-oauth.js

# 2. the private bridge, pointing discovery at that issuer
PROJECTOS_BRIDGE_PORT=8787 \
PROJECTOS_OAUTH_ISSUER=https://<hostname> \
PROJECTOS_OAUTH_RESOURCE=<tunnel MCP URL> \
PROJECTOS_OAUTH_SIGNING_KEY=<the same value> \
node projectos/agent/bin/projectos-bridge.js

# 3. the public edge — REQUIRES A CLOUDFLARE ACCOUNT, A HOSTNAME AND A TUNNEL TOKEN,
#    none of which exist, and none of which ProjectOS may create.
tunnel-client cloudflared config --token-file <path> > cloudflared-config.yml
cloudflared tunnel --config cloudflared-config.yml run
```

Ingress in the Cloudflare dashboard: `<hostname>` → `http://127.0.0.1:8788`. Nothing else.

## What is proven, and what is not

Proven locally, in `projectos/scripts/c15-split-oauth-local-proof.mjs` (19/19) and
`test/mcpOAuth.test.ts` (37 tests): discovery metadata on both halves, the authorization flow, PKCE
S256, redirect validation, state round-trip, token exchange, single-use codes, audience and scope
binding, expiry, signature verification before claims, refusal of a token signed with another key or
edited after signing, refusal of a malformed token, the public half having no MCP route even for a
valid token, the public half refusing to be addressed as loopback, the private half serving no
authorization flow of its own, no secret in any response, and the owner's pending approval surviving
a flood of anonymous authorization requests.

**Not proven, and not provable without a deployment:** that ChatGPT can reach the public origin,
complete discovery, and connect. That is the one remaining live question, and it needs owner
authority this document does not have.

## Residual risks, accepted and stated

- **Flooding from many source addresses** can still fill the pending-approval map. The per-source cap
  makes it cost many addresses rather than one script; it does not make it impossible. Availability
  only, self-healing, on a surface used by one person.
- **Signing-key strength is checked by length, not entropy.** A 32-character weak value would pass.
  The key is owner-created and never transmitted, so this is a procedural control, not a code one.
- **`constantEquals` compares a value to itself on a length mismatch**, so a wrong-length guess is not
  perfectly time-equivalent to a wrong-content one. PIN and signature lengths are fixed and public, so
  there is nothing secret for that to leak.
