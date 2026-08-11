# PROJECTOS-RECOVERY-CONTROL-CENTRE1A — Evidence Pack

> Status: IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure is delegated to ChatGPT for this programme.

1. **Project:** ProjectOS
2. **Phase:** PROJECTOS-RECOVERY-CONTROL-CENTRE1A — "Make normal ProjectOS operation possible without a terminal, through one obvious workflow the owner can follow without training."
3. **Date:** 2026-08-11
4. **Branch / HEAD:** `projectos-post-v3-selfhost-pilot1a` — `43340c69` (adopted), `c09c8e79`, `c81aa75f`, `1f965daf`
5. **Files changed:** `projectos/control-center/src/data/governedInventory.ts` (new), `projectos/control-center/src/App.tsx`, `projectos/control-center/src/styles.css`, `projectos/control-center/src/governed/governedProjection.ts`, `projectos/agent/src/governedContext.ts`, `projectos/control-center/test/governedInventory.test.ts` (new), `projectos/control-center/test/governedProjection.test.ts`, `projectos/agent/test/planAuthority.test.ts`, `projectos/control-center/test-desktop/e2e/p1-selfhost-pilot-audit.spec.ts`, `projectos/control-center/test-desktop/e2e/p2-objective-intake.spec.ts`

## 6. Summary, against each acceptance criterion

**(1) One canonical project inventory.** The Projects surface read a remote Supabase table and, when
that was absent, a thirteen-row static seed — then reported the result as "13 governed by ProjectOS",
with a KPI counting them as governed and one row whose repository mapping was simply wrong
(`BizComply V2 → opsoft-ios-lab`). Three project universes in one application. The inventory is now
derived from the governed projection and nothing else; no new source was created. An absent runtime
yields an explicit "ProjectOS cannot report its governed projects right now", carrying the runtime's
own reason — not an empty list and not a plausible one, because "governs no projects" and "cannot
tell you" are different statements. It honestly reports ONE project today. The owner's project
registry is empty and untouched; the surface says registration is owner-confirmed rather than
offering a form that wrote an ungoverned row.

**(2) Objective without a terminal.** Verified wired and gated on a live runtime: the owner types a
sentence, the canonical engine plans, and the surface renders what the runtime returned verbatim.
There is deliberately no approve control on it — turning a proposal into an executable plan is
authority-creating and belongs to the governed decision path.

**(3) Every status derived from canonical truth.** Proven live rather than argued: the headed run
recorded completion shown **33.3** against completion recorded **33.3**, and the next-action line
naming the phase that is genuinely in flight. A live untruth was found and fixed en route — see below.

**(4) The surface answers the owner's questions.** Which project, what objective, what is happening,
what passed and failed, what needs the owner, what happens next, whether production is touched,
whether the work is finished — all present on Owner Control and Projects, and all sourced from the
projection. The headed run captured all nine surfaces rendering with their controls.

**(5) One obvious workflow.** Nine equally-weighted destinations became two primary — Projects (which
project) and Owner Control (objective, plan, execution, decisions, evidence) — with the remaining
seven grouped as a labelled "Reference & support" nav landmark. Nothing was deleted and nothing
became unreachable.

**(6) Live-proven responsive, keyboard and accessible.** See section 7.

**(7) Simple, clear, truthful is the bar.** No visual redesign was attempted and none is claimed.

### The live untruth this phase found and fixed

Phases 1 and 2 were closed by the DELEGATE under the plan's recorded closure delegation, so their
history entries say `by: advisor`. Two completion rules still accepted `by: owner` alone: the
dependency gate in `governedContext`, and the owner-facing projection. The surface would have reported
two properly closed phases as incomplete — the exact stale-status defect this phase exists to remove,
sitting inside the surface meant to remove it. Worse, the dependency chain had only continued because
the declared current-state happened to record the completion as well: a rule that is right only when a
second source agrees is not the rule. Both fixed; the implementer still cannot manufacture a closure
by writing the word, and a test asserts that alongside.

## 7. Validators and proof

`validate-all` — the phase's required validator — recorded subject-bound from a clean tree. Unit:
control-centre **245**, agent **191**, core 211, typecheck clean on both packages.

**HEADED PROOF, against a real window and the real governed chain** (`tauri build --debug` into its
own `webdriver-e2e` target, then WebDriver; a release binary refuses its development sidecar and a
`cargo build --release` binary silently loads `devUrl`, so neither would prove the shipped app):

- **8 passing.**
- Live line: `Live Canonical runtime state · plan 1.0 · PLAN READY (recomputed) · projectos/state/projectos-recovery.plan.json` — the desktop application is genuinely live on the approved recovery plan.
- Completion shown **33.3** = completion recorded **33.3**.
- Next action: `PROJECTOS-RECOVERY-CONTROL-CENTRE1A is draft. Continue that phase; no other phase may start while it is open.`
- All nine surfaces render, with their controls enumerated.
- Responsive at **320, 390, 768, 1280 and 1440+**: `overflowPx: 0` and `bodyOverflowPx: 0` on every surface at every width, nav reachable throughout.
- Keyboard: 16 focusable elements, "Skip to content" first and programmatically focusable, **every** nav button focusable, zero negative tabindex.

The audit harness itself needed three corrections, each recorded rather than quietly applied: it
searched only `nav[aria-label="Primary"]` and would have reported seven surfaces as missing once they
became secondary; a primary item now carries a hint so exact `textContent` stopped matching; and it
named V3's plan version, 19/19 position and completed state, which became false the moment a second
plan was approved. A harness that raises a false alarm about the thing it exists to check is worse
than no harness.

## 8. Secrets used?

No.

## 9. Gated actions performed?

None. No production, database, external send, payment, credential, installation, service, ACL,
registry or ProgramData action. No force push, no history rewrite, no merge to a protected branch.
The desktop binary was built into its own `webdriver-e2e` target so it can never be mistaken for a
release artefact.

## 10. Risks / carry-forward

- The canonical project registry is EMPTY, so the inventory honestly shows one project. Registering
  the other configured projects is an owner-confirmed action and is NOT done here. It is the specific
  owner action required before the real external-project acceptance run (Phase 6).
- `data/projects.ts` and the Supabase read remain in the tree for the browser preview but no longer
  feed the operational surface. Removing them entirely is deferred rather than done blind.
- Accessibility is proven at the level the harness measures — focusability, skip link, no overflow,
  nav reachability. It is not a full WCAG audit and is not claimed as one.
- The nine surfaces were regrouped, not merged. Genuinely consolidating Workflow, Safety Gates and
  Integrations into progressive disclosure inside Owner Control is a larger change and is
  carry-forward.

## 11. Decision needed

Delegated closure decision by ChatGPT for `PROJECTOS-RECOVERY-CONTROL-CENTRE1A`, recorded at
`.projectops/closure/decisions/PROJECTOS-RECOVERY-CONTROL-CENTRE1A.json` and committed.

## Final status

**PROJECTOS-RECOVERY-CONTROL-CENTRE1A — AWAITING-REVIEW.**
