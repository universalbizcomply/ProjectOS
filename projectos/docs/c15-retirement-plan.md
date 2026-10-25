# C15 — retirement plan for the now-redundant infrastructure

**Status: PLAN ONLY. NOTHING HAS BEEN RETIRED, DELETED, REVOKED OR STOPPED.**

C15 was accepted on an owner-controlled private tunnel with service-token authentication. The public
OAuth front door built earlier is not part of that accepted path, so several pieces of live
infrastructure are now redundant. This document says exactly what could go, in what order, and what
must be checked first. Executing any of it needs separate owner authority.

## Why order matters

Two of these items are load-bearing for the *evidence*, not just the runtime. The old tunnel and the
public OAuth origin are what the negative evidence refers to; retiring them before the push is agreed
would leave records pointing at things nobody can inspect. So the sequence below retires the runtime
first and the identifiers last.

## What can be retired, in order

| # | Item | What it is | Safe to retire when | Reversible? |
|---|---|---|---|---|
| 1 | **Public OAuth authorization server** (`node projectos/scripts/c15-start-oauth-server.mjs`, `127.0.0.1:8788`, PID 25056) | A local process. Stopping it exposes nothing and breaks nothing on the accepted path. | Immediately on owner approval. Nothing in the accepted C15 channel touches it. | Yes — restart the script. A restart mints a new approval PIN and invalidates previously issued OAuth tokens, of which there are none. |
| 2 | **cloudflared runtime** (foreground process) | The local connector for the Cloudflare tunnel. | With item 1, or after it. Once the OAuth server is stopped the route serves nothing. | Yes — rerun with the same config and token file. |
| 3 | **Cloudflare public hostname route** `oauth-projectos.safw4n.com` → `http://127.0.0.1:8788` | The single published application on the `ProjectOS-C15-OAuth` tunnel. | After 1 and 2. Removing it also removes the public DNS name. | Yes, but the DNS record is recreated rather than restored. |
| 4 | **Cloudflare tunnel `ProjectOS-C15-OAuth`** and its runtime token | The tunnel object plus the credential stored locally. | After 3. Delete the tunnel in the dashboard, then delete the local token file. | No — a new tunnel means a new token and a new ingress. |
| 5 | **OAuth signing key** (`oauth-signing-key` in installation state) | The shared HMAC key for the two OAuth halves. | Only after 1–4. While any OAuth server could still be started, this is what makes its tokens verifiable. | No — deleting it invalidates every token it ever signed. Regeneration is trivial but not restoration. |
| 6 | **Old OpenAI tunnel `tunnel_6a88d18f2794819185e13479385c88b2`** | The original tunnel, bound to the other workspace. | **LAST, and only after the push is agreed.** It is the rollback path and the subject of the negative evidence. | No — deletion is final. |

## What must NOT be retired

- **`tunnel_6a8997326f108191a6f9bc9a0fce49c2`** — the accepted C15 tunnel.
- **The OpenAI runtime API key** (Tunnels Read + Use) — the accepted channel depends on it.
- **The ProjectOS bridge token** — it is what actually authenticates every connector call.
- **The `ProjectOS` ChatGPT connector** — retiring it retires C15.

## Checks to run before executing any step

1. Confirm the accepted channel still answers: `tools/list` through the connector, and one read-only call.
2. Confirm `127.0.0.1:8787` is still loopback-only and still refuses an unauthenticated call with 401.
3. Confirm `/readyz` on the tunnel-client is still `ready`.
4. Re-read this plan against the live state — tunnel IDs and ports must match before anything is deleted.

## Checks to run after each step

Repeat check 1. If the accepted channel stops working at any point, stop and restore rather than
continue: every step up to item 4 is reversible, and the cheapest recovery is always to put back the
last thing removed.

## A note on the local credentials

The Cloudflare token, the OAuth signing key and the OpenAI runtime key all live in the installation
state directory, outside every repository, and none of them has ever been committed or printed.
Retiring items 4 and 5 means deleting files there; that is a local act and needs no external
revocation beyond deleting the Cloudflare tunnel itself, which invalidates its token at source.
