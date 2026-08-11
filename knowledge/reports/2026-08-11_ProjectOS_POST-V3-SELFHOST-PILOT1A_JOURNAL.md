# ProjectOS — post-V3 self-hosting pilot · durable journal

**Pilot:** POST-V3-SELFHOST-PILOT1A
**Branch:** `projectos-post-v3-selfhost-pilot1a` (local only — NOT pushed)
**Baseline:** `d30dca03f4f73c1f4af41982508390bab1633430` (closed V3, 19/19, 100%)
**Owner:** Murad · **Gatekeeper:** ChatGPT · **Implementer:** Claude
**Started:** 2026-08-11 00:21 Europe/London

This file is the pilot's durable state. It is written to disk deliberately so the pilot does not
depend on conversational memory. It closes nothing and grants nothing.

---

## 1. Baseline, proven not assumed

| Check | Result |
|---|---|
| Remote | `https://github.com/universalbizcomply/ProjectOS.git` |
| Branch at start | `projectos-v3` |
| HEAD | `d30dca03f4f73c1f4af41982508390bab1633430` |
| `origin/projectos-v3` | `d30dca03…` — identical |
| Ahead / behind | 0 / 0 |
| Working tree | clean |
| GitHub account | `universalbizcomply` already active — **no `gh auth switch` performed** |
| Canonical V3 state | `COMPLETE`, 19/19, 100%, `activePhase: null`, plan v1.3 |

Pilot branch created from exactly that commit. `projectos-v3` is untouched and still at
`d30dca0`.

> The standing multi-project rule says to switch the GitHub account explicitly. It was **not**
> switched, for two reasons: the required account was already active, and the active account is
> machine-global — flipping it breaks concurrent work in other repositories. No push is authorised
> this turn, so no authenticated remote write was needed at all.

---

## 2. Phase 1 — the development Control Centre is genuinely LIVE

Built from current source, in this order, all exit 0:
`core build` → `agent build` → `control-center build:sidecar` → `control-center build`
→ `tauri build --debug`.

The debug binary was launched **from the development tree** (never copied into the installed
release directory). Result:

- window `ProjectOS · Control Center` running;
- a real sidecar child process: `node.exe C:\dev\ProjectOS\projectos\control-center\sidecar\host.mjs`,
  parented to the app;
- the daemon wrote governed state to `.projectops/bridge/dashboard-cache.json` at the moment of
  observation.

Proven programmatically against the real binary (spec `P1a`/`P1b`):

```
Live · Canonical runtime state · plan 1.3 · PLAN READY (recomputed)
  · projectos/state/projectos-v3.plan.json
19 of 19 phases accepted · 100%
```

`Not live` absent; `Local worker unavailable` absent. **Phase 1 acceptance met.**

### Why the installed RELEASE build cannot do this (verified from source)

1. `app_mode.rs:24-30` — mode is `cfg!(debug_assertions)`; a release build is `PackagedCandidate`.
2. `authority.rs:134-135` — `PackagedCandidate` ⇒ `Err(ProductionIdentityUnavailable)`, with the
   packaged variant of `DaemonLaunchAuthority` deliberately **not constructible**.
3. `lifecycle.rs:351` — that error ⇒ `DaemonStatus::Blocked` ⇒ "Local worker unavailable."

The release build therefore **fails closed, correctly**. Nothing here was weakened. A debug build
was **not** disguised as a packaged build, and no packaged→development fallback was added.

---

## 3. Findings

Severity is owner-impact, not code-aesthetics.

| # | Severity | Class | Finding | Status |
|---|---|---|---|---|
| F1 | HIGH | stale fixture presented as real | Owner Control rendered a fabricated **PRODUCTION / Critical risk** approval — "Apply a database migration … against the live production database … This cannot be undone" — with live-looking **Approve this action** / **Refuse** buttons, unconditionally, in every build | **FIXED** |
| F2 | HIGH | UX / logic defect | With the programme complete, "Next safe action" read *"every remaining phase has an unmet dependency. Close the phase it depends on first."* There is no such phase | **FIXED** |
| F3 | HIGH | autonomy gap | **No objective→plan intake exists.** Post-V3 work cannot be governed at all | recorded, owner gate |
| F4 | MEDIUM | data contradiction / crossover | "Projects" lists **12 seed projects** as governed inventory, including `BizComply V2 → universalbizcomply/opsoft-ios-lab` (wrong repo) and "12 Open phases" | recorded |
| F5 | MEDIUM | duplicate truth | Three different project lists in one app: governed (1), Projects seed (12), Owner-Chat/Safety picker (2) | recorded |
| F6 | MEDIUM | stale copy | "between phases" shown for a CLOSED programme, in both the Owner Control header and the Owner Chat greeting | recorded |
| F7 | LOW | duplication | `Workflow` view is the same static 6-row table as the `projectos plan` CLI; `Safety Gates` and `Integrations` are static constants — three nav-level surfaces carrying reference content at the same weight as live operational ones | recorded |
| F8 | LOW | CLI UX | `projectos phase` with no subcommand silently runs `list` instead of showing usage | recorded |
| F9 | INFO | correct safety behaviour | Release/installed app cannot start its worker — fails closed by design | owner gate |

### F1 — detail and fix

The audit captured the home screen saying, within a few hundred pixels of each other:

> **Decisions required** — No decisions are waiting for you. Nothing is blocked on your approval.
>
> **ProjectOS needs your approval** — Apply a database migration …

The synthetic banner was present and honest. It was still the most alarming thing on the screen,
and `ProjectOS needs your approval` was an `<h2>` in the document outline, so a screen-reader user
navigating by heading landed on a fabricated production approval.

**Fix:** the fixture now sits behind explicit owner intent — a closed `<details>` labelled
*"Show an example approval screen — Example only, not a real request"*. The component and its 32
tests are untouched; only whether an owner is shown a fabricated decision they never asked for.
Test coverage was **not** deleted.

### F2 — detail and fix

Root cause: `governedProjection.ts` `deriveNextSafeAction` had no completion branch. With no active
phase and nothing startable it fell through to the dependency message, which is false for a
finished programme.

**Fix:** a completion branch judged against the **same** `complete` set that decides dependency
arithmetic, so the message can never disagree with the numbers beside it. The wording grants
nothing: *"Every phase in the approved plan is complete. There is nothing to start here. New work
needs a new owner-approved plan."* Two tests added — one for each branch — so the fix cannot have
replaced one always-true message with another.

### F3 — the autonomy gap that matters most

Probed through the real runtime:

```
$ projectos phase new --id PROJECTOS-POSTV3-SELFHOST-PILOT1A --objective "…"
REFUSED (PHASE_NOT_AUTHORISED): phase '…' is not in the approved plan
(projectos/state/projectos-v3.plan.json, 19 approved phase(s)).
Only an owner-approved phase can be started.
```

That refusal is **correct governance** and nothing was written. But it is also a dead end:

- `projectos plan` is **not** a project plan — it prints a static six-row table of which worker
  owns each workflow step. It is identical for every project.
- There is no command to create, derive, amend or approve a plan. The only way to authorise new
  work is to hand-edit `projectos-v3.plan.json` — the **closed V3 plan**.

So ProjectOS cannot currently take in a new objective and govern it. Every phase of this pilot has
therefore been driven by a Claude prompt rather than by ProjectOS, which is exactly the failure
mode the pilot exists to detect.

**Not fixed in this turn.** A plan-intake mechanism creates the authority under which future work
is authorised; building it unreviewed, inside a pilot whose stated rule is "smallest safe
correction", would be the single most dangerous thing to improvise. It is written up as an owner
gate in the report.

---

### F3 — sharpened by evidence

The gap is not that nobody built plan intake. **`projectos/validators/plan-discovery-engine.cjs`
exists** — it is the Phase-2 `PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A` deliverable, closed 2026-07-12,
and it does deterministic plan discovery, import, conflict detection and provenance.

A repository-wide search for its name returns **seven files: its own validator, and six documents.**
No CLI command, no script, no runtime module calls it. The canonical `@projectos/core` + agent
runtime — the stack that actually governs phases — cannot reach it.

This is the recorded TWO-STACK ARCHITECTURE split biting at the worst possible place: the capability
is built, tested and closed, and an owner still cannot use it to authorise a single new objective.

---

## 4. Evidence

| Evidence | Where |
|---|---|
| Live audit spec (read-only) | `projectos/control-center/test-desktop/e2e/p1-selfhost-pilot-audit.spec.ts` — **8 / 8 passing** against the real desktop binary |
| F1 + F2 proven fixed live | `P1d` (no fabricated approval visible, disclosure closed and labelled) and `P1d2` (completion wording) both green |
| Responsive: 5 widths × 9 surfaces | **clean** — 0px horizontal overflow, nav reachable everywhere, now **asserted** not merely collected |
| Accessibility (Owner Control) | 1 `<h1>`, skip link, `<main>` + labelled `<nav>` landmarks, **0** unlabelled buttons, **0** unlabelled inputs, every nav destination focusable, no `tabindex="-1"` in the ring |
| Control Centre suite | **239** passed / 22 files (237 before; +2 for F2) |
| Core / agent suites | **211** / **106** — both at the V3 closure baseline |
| Mutation check on the F2 fix | 2 / 2 killed (branch forced off ⇒ completion test fails; forced on ⇒ blocked test fails) |

Widths exercised: 320, 390, 768, 1280, 1600.

### Two things this pilot got wrong first, recorded because they cost real time

1. **`governedProjection.ts` is not in the React bundle.** It compiles to `node-build/` and is
   imported by `sidecar/host.mjs` — the projection runs in the *daemon*, not the renderer. The first
   attempt rebuilt the sidecar **before** editing it, so the F2 fix silently never shipped and the
   live proof failed while the unit tests passed. Anything touching `src/governed/**` needs
   `npm run build:sidecar` **after** the edit.
2. **A closed `<details>` is still in the DOM.** `textContent` and `querySelectorAll` see straight
   through it, and Chromium's `content-visibility` leaves descendants with a layout box, so
   `offsetParent` reported the hidden fixture as visible. The check now tests
   `closest('details:not([open])')` directly.

### Review outcomes

| Review | Result |
|---|---|
| ECC security-reviewer | **APPROVE** — 0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW. Confirmed no governance control weakened, the confirmation state machine byte-unchanged, the spec strictly read-only |
| ECC code-reviewer | **WARNING** — 2 HIGH, 2 MEDIUM, 3 LOW |
| Disposition | **all 7 fixed**, none carried |

The two HIGH findings were both real and both mine: an E2E test that collected responsive data and
never asserted on it (so it could not fail), and a unit test whose fixture left the root phase
*startable*, meaning it never reached the branch its name claimed to protect. Both are corrected and
the second is now mutation-proven.

### Harness limitation, stated not hidden

Synthetic `Tab` through this embedded WebDriver session does not move focus in the WebView — tried
unseeded and seeded, both left `activeElement` unchanged. That is the transport, not the app, so no
keyboard claim is made from it. What is proven instead is the structure keyboard traversal needs:
focusable stops exist in document order, the skip link is first, every primary-navigation button is
focusable, and nothing is pulled out of the tab ring. **An end-to-end keyboard walk remains
outstanding** and needs a human or a real key-event transport.

---

## 5. Boundaries honoured

No production, staging, deployment, database, send, payment, provider or credential action.
No Windows service, ACL, ProgramData or registry change. `ProjectOSHost` untouched. The stale July
executable was **not** restored and **not** launched. No security control weakened: `AppMode`,
`PackagedCandidate`, `ProductionIdentityUnavailable`, identity and launch-authority checks are all
byte-unchanged. No commit, no push, no force, no history rewrite. V3 not reopened.

---

## 6. Next safe action

Complete the review/validation sweep for the two fixes, then hand the report to ChatGPT for the
pre-push gate. The objective-intake gap (F3) needs an owner decision before any further self-hosting
is possible.
