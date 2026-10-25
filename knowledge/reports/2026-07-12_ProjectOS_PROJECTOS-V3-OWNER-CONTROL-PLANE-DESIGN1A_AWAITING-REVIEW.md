# ProjectOS — PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A — Phase Evidence

**Project:** ProjectOS · **Programme:** ProjectOS V3 · **Phase 3:** `PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** — not accepted, not closed (formal owner/gatekeeper
acceptance happens after the full local evidence pack). **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `4ad2b3f…`

---

## 1. Objective

Design and implement the single canonical owner-facing control surface: where the owner is, plan
status, completion, decisions required, risks, blockers, the one safe next action, owner-only
restricted actions, and the live safety state — plain-language, responsive, accessible, as a **working
local UI** (not documentation). Extend the existing Control Centre; do not create a second one.

## 2. Implementation scope (extends `projectos/control-center/`)

- `src/owner/ownerModel.ts` — pure, deterministic view model (`OwnerControlModel`, `OwnerControlView`,
  `buildOwnerControlView`, `completionPercent`, `whereYouAre`, safety-badge derivation). No I/O, no
  clock, no randomness.
- `src/owner/ownerSnapshot.ts` — static snapshots (ProjectOS self seeded from the real
  `projectos-v3.current-state.json` values; one synthetic project exercising decisions/blockers). No
  backend, no network.
- `src/owner/OwnerControlPlane.tsx` — the canonical owner surface (project selector; status + completion
  meter; decisions-required region; next safe action; risks/blockers; safety badges; owner-only chips).
- `src/App.tsx` — added **Owner Control** as the first (default) nav view.
- `src/styles.css` — Owner Control Plane styles (theme tokens), responsive rules, accessible focus.
- `test/ownerModel.test.ts` — 11 unit tests.

**Files changed:** 2 modified (`App.tsx`, `styles.css`) + 4 new (`owner/*.ts[x]`, `test/ownerModel.test.ts`).
Build artefacts (`dist/`) are git-ignored.

## 3. Information architecture (no-training)

One screen answers, in order: **where you are** (project · programme · active/next phase) → **plan
status** + **completion** → **decisions required** (highest-priority region; empty-state when none) →
**next safe action** (single, accent-marked) → **risks / blockers** → **safety state** (production
frozen? provider contacted? secret used? AI API used?) → **owner-only actions** (labelled inert chips
with the explicit note that ProjectOS/Claude cannot perform them). One primary emphasis per region;
plain language; consistent status terminology.

## 4. Review — security

Owner surface is driven by a **static local snapshot**; no secret value is present or displayed; no
external/provider/network request (verified — all requests localhost/local-fs). Owner-only action
buttons are **inert** (no wired authority; the surface cannot approve/close or perform gated actions).
No untrusted document content is rendered. No `dangerouslySetInnerHTML`. No injection surface. No
`console.log`. No open HIGH/CRITICAL.

## 5. Review — code

TypeScript strict (`noUncheckedIndexedAccess`) clean; explicit prop/model interfaces; pure model
separated from the React component; immutable data; deterministic derivation; 11 unit tests covering
completion rounding, where-you-are, status tones, safety badges, decisions present/empty, and
determinism.

## 6. Review — ECC

Owner authority preserved (owner-only actions surfaced as restricted; Claude/ProjectOS cannot perform
them). No automatic PLAN READY (the surface only *displays* status). Local-only; production frozen;
no provider/secret/API. Completion accounting unchanged (Phase 3 is local-implementation-complete, not
accepted → programme completion stays **15.8%**). No open HIGH/CRITICAL.

## 7. Review — UI/UX

Single canonical surface (no second Control Centre). Clear hierarchy via scale/emphasis; decisions
region elevated; one primary action per decision. Plain-language owner terminology. Responsive:
verified at 1440, 1280, 1024, 768, 390 — **no horizontal overflow at any width** (scrollWidth ==
clientWidth); sidebar stacks on narrow. Accessible: `role="progressbar"` with `aria-valuenow`, labelled
`<select>`, semantic `<section>`/headings, focus-visible on all controls, keyboard-operable nav.

## 8. Tests / validators

- `npm run typecheck` (control-center) → PASS.
- `npm run test` (control-center vitest) → **57 passed** (incl. 11 new owner tests); no regression.
- `npm run build` (control-center `tsc` + vite) → PASS (120 modules).
- `npm run validate` (ProjectOS validators) → ALL PASS (unaffected).

## 9. Live proof (real running app, localhost)

Browser proof was used (the Tauri desktop shell wasn't driven; the same frontend was exercised via the
control-center dev server on `localhost:5178`). Verified in the running app:
- Owner Control renders as the default view; project selector switches ProjectOS-self ↔ synthetic Acme.
- ProjectOS-self: `PLAN READY`, completion meter `3 of 19 · 15.8%`, decisions empty-state, risks (R1 +
  relay), no blockers, all-green safety badges (production frozen / no provider / no secret / no AI API).
- Acme: `AWAITING OWNER APPROVAL`, `0 of 4 · 0%`, two decisions (Approve / Return for correction /
  Reject), one blocker (conflicting DoC).
- No console errors. No external network request (localhost/local-fs only). No horizontal overflow at
  1440 / 1280 / 1024 / 768 / 390. Screenshots captured (desktop 1440, 1280; mobile 390).

## 10. Safety / boundaries

Production touched: NO · Deployment: NO · Database mutation: NO · External sends: NO · Payments: NO ·
Provider access: NO · Secrets used: NO · AI API used: NO. No external repository / PolyGo touched.

## 11. Residue / risks / carry-forward

- Residue: none (build artefacts git-ignored).
- Risk: the owner surface is snapshot-driven in the browser; live desktop wiring (CLI-read state,
  daemon) is a later integration phase (Phase 12 Control-Centre integration; Phase 13 desktop E2E).
- Carry-forward: wire owner-only action buttons to the real approval queue (Phase 10) and E2E runner
  (Phase 9); Tauri desktop proof (Phase 13).

## 12. Next phase

`PROJECTOS-V3-LOCAL-SECRET-BROKER1A` (Phase 4).

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE — not accepted, not closed. Not pushed.**
