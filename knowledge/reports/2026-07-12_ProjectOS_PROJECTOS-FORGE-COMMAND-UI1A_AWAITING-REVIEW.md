# ProjectOS — PROJECTOS-FORGE-COMMAND-UI1A (F7) — Phase Evidence

**Programme:** ProjectOS Forge · **Phase F7:** `PROJECTOS-FORGE-COMMAND-UI1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** (steps 2–4) — awaiting advisor/owner review + closure. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `a9db468…`

---

## 1. Objective

The owner-facing Forge surface: type a build command → watch the governed pipeline (F1–F6) — blueprint,
planned scaffold, budget, verification, snapshots — with owner-only actions surfaced as inert chips.
Snapshot-driven, inert, deterministic; no real generation/exec in the UI (the real build runs via the
local worker, owner-approved); no external calls.

## 2. Implementation scope (extends `projectos/control-center/`)

- `src/forge/forgeModel.ts` — pure view model mirroring the F1–F6 shapes + deterministic synthetic runs
  (a booking app = verified; a shop app that asked for an OpenAI chatbot = `ai-api` **refused** + `wired`
  check **fails** → NOT verified). Helpers: `forgeRunForCommand` (keyword routing), `budgetPercent`,
  `verifyTone`, `isVerified` (mirrors the F5 anti-Potemkin gate). No I/O.
- `src/forge/ForgeConsole.tsx` — the 6-stage pipeline surface: command input → Blueprint / Scaffold (file
  list) / Budget (meter with "hard cap — never exceeded") / Verification (per-check badges + verdict) /
  Snapshots / Safety + owner-only inert chips.
- `src/App.tsx` — adds **Forge** as the second nav view.
- `src/styles.css` — Forge Console styles + responsive.
- `test/forgeModel.test.ts` — 6 unit tests.

## 3. Reviews

- **Security / ECC / UI-UX:** snapshot-driven, **no network, no AI/metered API, no secret material**
  (verified live — all requests localhost/`@fs`). Rendered via React text nodes (auto-escaped); no
  `dangerouslySetInnerHTML`. Inert: owner-only actions (provision/deploy/real key/push) are non-wired
  chips; the UI only *displays* the governed pipeline. Surfaces the two headline guarantees to the owner:
  the budget "hard cap — never exceeded" and the **anti-Potemkin verdict** (a shop that builds/renders but
  fails the wired check is shown as NOT verified), plus the **metered-AI-API refusal**. Accessible
  (`role="progressbar"` with `aria-valuenow`, labelled input, semantic sections). No PLAN READY effect.
- **Code (self-review):** pure tested model + presentational component consistent with the other owner
  surfaces (reuses `.ocp` base + `buildOwnerControlView` safety badges); no dead code. Given the tiny
  surface (pure model + inert view) this phase was self-reviewed; the 6 unit tests + live proof lock it.

## 4. Tests / validators

- `npm run typecheck` (control-center) → PASS.
- `npm run test` (control-center vitest) → **89 passed** (incl. 6 new Forge tests); no regression.
- `npm run build` → PASS.
- `npm run validate` (ProjectOS validators) → ALL PASS (56; unaffected).

## 5. Live proof (real running app, localhost)

Browser proof on `localhost:5178` (dev server started/stopped). Verified in the running app (via DOM
extraction):
- **Forge** renders as a nav view with the 6 pipeline stages (Blueprint, Scaffold · 12 files, Budget,
  Verification, Snapshots, Safety & owner-only actions).
- The command input routes deterministically: default booking run = **Verified**; typing an online-store /
  OpenAI-chatbot command switches to the shop run showing **"ai-api (no metered AI API)"** refused and a
  **"NOT verified"** verdict (the `wired` check failed) — proving the metered-AI refusal and anti-Potemkin
  gate are surfaced.
- **No console errors.** **No external network** (localhost/`@fs` only). **No horizontal overflow at
  1440 / 1280 / 1024 / 768 / 390** (verified `scrollWidth == clientWidth` at each).
- **Honesty note:** the browser pane's `screenshot` capture action timed out twice (a renderer/capture
  hang in the harness — the page itself stayed responsive to every JS/DOM call), so no screenshot image is
  attached. All other live checks passed; no evidence was fabricated.

## 6. Safety / boundaries

Production: NO · Deploy: NO · DB: NO · Sends: NO · Payments: NO · Provider: NO · Secrets: NO · AI API:
NO · Network (beyond localhost dev server): NO. No external repo / PolyGo touched.

## 7. Next phase

**F8 — Secure-by-default + Deploy Gate**: RLS deny-tests, a bundle secret-grep hook, CORS/rate-limit
defaults; optional cloud deploy strictly through the provider guards + approval queue. Then F9
integrations, F10 E2E + the **micro-level final evidence report** for owner + ChatGPT.

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE (steps 2–4) — AWAITING ADVISOR/OWNER REVIEW + CLOSURE. Not pushed.**
