# ProjectOS — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1A — Phase Evidence

**Programme:** ProjectOS Forge · **Phase:** `PROJECTOS-FORGE-REAL-E2E-ACTIVATION1A` (real-execution activation)
**Local status:** **PARTIAL — the provable real subset PASSED; two capabilities are ENVIRONMENT-BLOCKED.**
Awaiting advisor/owner review. **Not pushed.** Branch `projectos-v3`.

> This phase answers the owner's correct challenge: the prior "Forge locally complete" = **engine +
> offline-model** completion, not real product E2E. Here we ran the real chain against a REAL running app
> + REAL database — honestly, capturing what this sandbox can and cannot prove.

---

## Gate 0 — baseline freeze (done)

- HEAD `11725bd` (start); remote `origin/projectos-v3` frozen at `4c3f076`; **27 ahead / 0 behind**;
  working tree clean; `git diff --check` clean.
- `npm run validate` → **ALL PASS (61 validators)**.
- Recovery branch **`forge-baseline-2026-07-12`** created at the tip. No push.

## Environment capability matrix (the decisive finding)

| Capability | Present? | Consequence |
| --- | --- | --- |
| Node 24 / npm 11 | ✓ | — |
| **npm registry network** | ✓ (PONG) | real `npm install` (controlled install activity) |
| **local PostgreSQL 18.4** (`pg_ctl`/`psql`) | ✓ | **real DB round-trip WITHOUT Docker** |
| Docker | ✗ | Supabase-local (`supabase start`) **BLOCKED** |
| `claude` CLI | ✗ | real Claude-worker **subprocess BLOCKED** in this sandbox |
| Playwright | ✗ | used the in-app browser tools instead |

## What was PROVEN REAL (not synthetic, not fabricated)

Scratch workspace (outside the repo, gitignored temp): a real Forge-generated app materialised, installed,
built, and run against a real database.

1. **Real materialisation** — `materializeManifest` wrote the **20-file** Forge scaffold to disk (`forgetodo`).
2. **Real `npm install`** — **first attempt FAILED** with `npm error notarget: No matching version for
   typescript@5.6.0` → a genuine Forge scaffold bug (exact `.0` pins don't all exist). **Fixed** (caret
   ranges); retry **added 154 packages** successfully.
3. **Real `next build`** — compiled: routes `/` (static), `/api/task` (dynamic), `/_not-found`; **5 static
   pages generated**; real `.next` bundle (First Load JS ~103 kB). Exit 0.
4. **Real local Postgres** — a real PostgreSQL 18.4 cluster initialised with `pg_ctl` (no Docker, synthetic
   superuser `forge`, trust auth), started on `127.0.0.1:55432`, DB `forgetodo` created, real `task` table
   applied.
5. **Real server boot** — `next start` on `:3100`, "Ready in 473ms", `GET /` → **HTTP 200**.
6. **Real API → Postgres round-trip (curl)** — `POST /api/local-task` inserted a row (returned `id:1`),
   `GET` returned it, and `psql` confirmed the row is **really in Postgres**.
7. **Real browser UI round-trip** — the app rendered in a real browser (loaded existing rows from Postgres →
   "1 tasks"); adding **"buy milk (added in browser)"** through the UI inserted **row id:2** into Postgres
   (verified directly by `psql`), and the UI re-read and updated to "2 tasks". **No console errors.**
   (Screenshot capture hung on the renderer — a known in-app browser capture issue; DOM + DB + HTTP evidence
   stand; no image fabricated.)
8. **Repeatable teardown** — server and Postgres cleanly stopped (`pg_ctl stop`; connection refused after).

## Real bug found + fixed (fed back into the product)

`typescript@5.6.0` (and other exact `.0` pins) do not resolve on the registry → generated apps couldn't
`npm install`. **Only a real install caught this** (offline validators can't). Fixed in
`projectos/forge/scaffold-engine.cjs` — dependency versions are now **caret ranges** — plus a new
`validate-forge-scaffold` invariant that rejects exact `.0` pins. Committed `44c6dfa`
(`fix(projectos): use caret ranges in forge scaffold package.json (found via real npm install)`).
`validate-all` ALL PASS after the fix.

## Documented substitution (honest)

Forge's default stack is **Supabase**, whose local stack needs **Docker** — absent here. So the real DB
round-trip used a **local-Postgres adapter** hand-added on top of the Forge scaffold (`lib/pgdb.ts` +
`app/api/local-task/route.ts` + a client `app/page.tsx`). The **base app, install, and build are pure
Forge output**; the pg adapter + client page are an explicit adapter to prove the runtime round-trip in a
Docker-less environment — **not** claimed as pure Forge generation.

## ENVIRONMENT-BLOCKED (need the owner's interactive machine — not fabricated here)

- **Gate 1 — real `claude` CLI worker subprocess:** no `claude` CLI in this sandbox, so ProjectOS could not
  spawn a real local Claude Code worker to make the changes. (The generation loop's untrusted-worker
  contract is proven offline; a real subprocess round-trip needs the CLI.)
- **Gate 2/3 — Supabase-via-Docker:** no Docker, so the real DB was a plain local Postgres, not the Forge
  default Supabase stack.

Both require an interactive owner machine with Docker + the Claude Code CLI. Recorded as blockers, honestly.

## Reframed status (per owner)

"**Forge locally complete**" now means **engine + offline-model complete + a real running app with a real
DB round-trip proven**. It does **not** yet mean full real product E2E: the real Claude-worker connection
and the Supabase-on-Docker path remain owner-machine integration steps. The gate plan (Gates 1–12) stands;
Gate 0 done, and the provable parts of the activation (real materialise/install/build/DB/boot/round-trip)
pass.

## Safety / boundaries

Production: NO · Deploy: NO · Real provider access: NO · Real secrets: NO (synthetic local Postgres creds,
trust-auth, disposable cluster) · **Claude/ChatGPT/metered AI API: NO** · Push: NO. **Controlled install
activity (authorised):** `npm install` from the public registry (154 + 15 packages) and a local Postgres
cluster — recorded as controlled installation activity, not production/customer-provider operations. The
generated app + `node_modules` live in a gitignored temp workspace — the repo is unpolluted (only the F2
caret fix is committed).

## Next

`PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B` on an owner machine with **Docker + the `claude` CLI**: real local
Claude Code worker connection (Gate 1) + real Supabase provisioning (Gate 2) + the one-command reference
app (Gate 3). Then Gates 4–12.

---

**STATUS: real-execution activation — provable subset PASSED (real app + real Postgres round-trip); real
Claude-CLI worker + Supabase-on-Docker ENVIRONMENT-BLOCKED (owner machine). Not pushed.**
