# ProjectOS — PROJECTOS-V3-OWNER-CHAT1A — Phase Evidence

**Project:** ProjectOS · **Programme:** ProjectOS V3 · **Phase 6:** `PROJECTOS-V3-OWNER-CHAT1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** — not accepted, not closed. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `a977f6e…`

---

## 1. Objective

Give the owner a plain-language chat surface to ask about a project and get effective answers derived
**only** from the local snapshot — plan status, progress, decisions, risks, blockers, the next safe
action, safety state, and owner-only actions. Per explicit owner directive, it must handle **natural
language** effectively (not brittle keyword matching) — while the governance constraint forbids any
AI/metered API. So the responder is a **local, deterministic NLU**, not an LLM.

## 2. Implementation scope (extends `projectos/control-center/`)

- `src/owner/ownerChatModel.ts` — pure, deterministic natural-language responder. A **scored intent
  engine**: each intent has a weighted synonym/phrase lexicon; the question is punctuation-normalised
  and tokenised; every intent is scored (phrase hits weigh more than single-word token hits); intents
  are ranked; the best answers, and a strongly co-mentioned second *content* intent is answered too
  (compound questions like "status and progress"). Exposes `answerOwnerQuestion`, `rankIntents`,
  `BASE_SUGGESTIONS`. No I/O, no clock, no randomness, no network.
- `src/owner/OwnerChat.tsx` — chat panel: project selector, conversation log (`role="log"`,
  `aria-live="polite"`), suggested-question chips, accessible labelled input + Ask. Owner turns and
  ProjectOS turns are visually distinct. Never performs owner-only actions.
- `src/App.tsx` — adds **Owner Chat** as the second nav view.
- `src/styles.css` — chat styles (theme tokens) + responsive rule.
- `test/ownerChat.test.ts` — 20 vitest tests (intents, natural-language phrasings, compound intents,
  misclassification regression, determinism, ranking, empty input).

**Files:** 3 modified (`App.tsx`, `styles.css`, and the responder) + 2 new (`OwnerChat.tsx`, test);
responder file renamed to `ownerChatModel.ts` to avoid a Windows case-collision with `OwnerChat.tsx`.

## 3. Natural-language behaviour (per owner directive)

- Synonym-rich: "where do things stand", "give me a summary", "how are things going" → status;
  "how far along", "how much is done", "milestone" → progress; "anything to worry about", "risky" →
  risks; "waiting on me", "sign off", "approve" → decisions; "what now", "what should I do" → next.
- Punctuation-robust (normalises `?,!.` so phrases still match).
- Compound: one question can ask two things and get both answered.
- Fails safe: an unrecognised question returns a helpful fallback, never invents facts.

## 4. Review — security / ECC

Snapshot-driven; **no network, no AI/metered API, no secret material** (verified live — all requests
localhost/`@fs`). Rendered via React text nodes (auto-escaped); no `dangerouslySetInnerHTML`, no
injection surface. Owner authority preserved: the responder explicitly refuses to perform owner-only
actions ("only you can authorise them"). No PLAN READY effect. Completion accounting unchanged (Phase 6
local-implementation-complete → programme stays **15.8%**). No open HIGH/CRITICAL.

## 5. Review — code (code-reviewer agent)

The reviewer flagged a **HIGH** in the initial keyword version — naive `includes` substring matching
misclassified (`'live'` inside "deliver", `'api'` inside "rapid"). **Fixed** by the scored engine with
whole-word tokenisation + phrase matching + punctuation normalisation, and a regression test asserting
"Can we deliver the next milestone?" is not classified as safety. **MEDIUM** items addressed: missing
intent coverage (added greeting/help/risks/phase + NL + compound tests, 20 total); `BASE_SUGGESTIONS`
now imported directly (removed the throwaway view computation in the component). Deferred (documented,
non-blocking): extracting the answer-builder switch into a lookup map; a dedicated RTL component test.

## 6. Review — UI/UX

Distinct owner/ProjectOS bubbles, clear hierarchy, suggested-question chips for discoverability,
accessible log/select/input with visible focus. Responsive: **no horizontal overflow at 1440 / 1280 /
1024 / 768 / 390** (verified `scrollWidth == clientWidth`); chat bubbles widen on narrow screens; the
shell stacks.

## 7. Tests / validators

- `npm run typecheck` (control-center) → PASS.
- `npm run test` (control-center vitest) → **77 passed** (incl. 20 owner-chat tests); no regression.
- `npm run build` → PASS.
- `npm run validate` (ProjectOS validators) → ALL PASS (unaffected).

## 8. Live proof (real running app, localhost)

Browser proof on `localhost:5178` (dev server started/stopped). Verified in the running app:
- Owner Chat renders; project selector switches ProjectOS-self ↔ synthetic Acme; the log resets per
  project with a project-specific greeting.
- **Natural-language, compound question** typed by the owner — *"how far along are we and anything risky
  to worry about?"* — produced BOTH the progress answer ("3 of 19 phases accepted · 15.8% …") AND the
  risks answer ("Current risks: • R1 … • Automated local relay …") in one reply. Screenshot captured.
- Owner-only request ("can you do it for me?") → refused ("only you can authorise them").
- No console errors. No external network (localhost/`@fs` only). No horizontal overflow at
  1440 / 1280 / 1024 / 768 / 390.

## 9. Safety / boundaries

Production: NO · Deploy: NO · DB: NO · Sends: NO · Payments: NO · Provider: NO · Secrets: NO · AI API:
NO · Network (beyond localhost dev server): NO. No external repo / PolyGo touched.

## 10. Residue / carry-forward

- Deferred (documented): answer-builder lookup-map refactor; RTL component test.
- Carry-forward: wire chat into the live daemon/CLI-read state (Phase 12 Control-Centre integration);
  route owner-only actions from chat to the approval queue (Phase 10). Owner directive recorded to
  memory (`owner-chat-natural-language`): keep extending the local lexicon — never add an AI/metered API.

## 11. Next phase

`PROJECTOS-V3-PROJECT-SESSION-LAUNCHER1A` (Phase 7).

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE — not accepted, not closed. Not pushed.**
