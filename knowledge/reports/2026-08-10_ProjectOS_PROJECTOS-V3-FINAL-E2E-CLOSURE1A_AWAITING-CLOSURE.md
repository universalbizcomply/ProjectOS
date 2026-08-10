**Generated 2026-08-10 20:03 (local)**

# PROJECTOS-V3-FINAL-E2E-CLOSURE1A — final V3 evidence pack

| | |
|---|---|
| **Project** | ProjectOS |
| **Programme** | ProjectOS V3 — numbered phases 0–18 |
| **Plan version** | v1.3, PLAN READY (recomputed by the engine, never read from the stored string) |
| **Phase** | PROJECTOS-V3-FINAL-E2E-CLOSURE1A — numbered Phase 18 of 19 |
| **Branch** | `projectos-v3` |
| **Evidence subject** | `<EVIDENCE_SUBJECT>` |
| **Position at this pack** | **18 / 19, 94.7%** — Phase 18 OPEN |
| **Decision required** | **FINAL OWNER / GATEKEEPER CLOSURE OF PROJECTOS V3** |

This is a reconciliation phase, not a development phase. No feature was built. Every claim below was
**recomputed from the repository** by `finalcheck` (29/29) or produced by a live run; nothing is
restated from an earlier report on trust.

---

## 1. Phase 18 was started by ProjectOS, and the dependency gate decided it

```
phase new --id PROJECTOS-V3-FINAL-E2E-CLOSURE1A  -> created (status: draft)
  objective: Final V3 end-to-end closure against the definition-of-complete. …
```

Two things this proves beyond "a phase exists". The same command was **REFUSED** at `ee11ba8` with
`DEPENDENCY_NOT_SATISFIED: depends on PROJECTOS-V3-RELIABILITY-HARDENING1A` — the gate permits it now
only because Phase 17 genuinely closed. And the objective was **derived from the approved plan**, not
supplied by me: that is the Phase-17 placeholder fix working on its first real use.

## 2. All nineteen numbered phases

| # | Phase | Status |
|---|---|---|
| 0–11 | BASELINE-RECONCILE1A · MASTER-PLAN-MEMORY1A · PLAN-DISCOVERY-IMPORT1A · OWNER-CONTROL-PLANE-DESIGN1A · LOCAL-SECRET-BROKER1A · SECRET-OPERATION-BROKER1A · OWNER-CHAT1A · PROJECT-SESSION-LAUNCHER1A · CLAUDE-DESKTOP-BRIDGE1A · E2E-RUNNER1A · APPROVAL-QUEUE1A · PROVIDER-CONTEXT-GUARDS1A | **CLOSED** (owner + gatekeeper, 2026-08-08, uniform crosswalk §5a basis) |
| 12 | CONTROL-CENTRE-INTEGRATION1A | **CLOSED** 2026-08-10 by G4, subject `7e65fe5` |
| 13 | DESKTOP-E2E-PROOF1A | **CLOSED** 2026-08-04, commits `1fcf416` + `fb203c6` |
| 14–15 | POLYGO-BASELINE-RECONCILE1A · POLYGO-INSTALL-REENTRY1A | **CLOSED** 2026-08-08 — evidence EXTERNAL to this repository |
| 16 | POLYGO-PILOT1A | **CLOSED** 2026-08-09, owner + gatekeeper |
| 17 | RELIABILITY-HARDENING1A | **CLOSED** 2026-08-10 by G4, all 17 predicates, subject `2b362eb` |
| 18 | **FINAL-E2E-CLOSURE1A** | **OPEN — awaiting the owner/gatekeeper decision** |

## 3. Definition-of-complete matrix (plan v1.3)

Every clause of `definitionOfComplete`, judged against evidence that exists now.

| # | DoC requirement | Accepted evidence | Source | Status |
|---|---|---|---|---|
| 1 | Vision, plan, execution plan and DoC are recorded and approved | Plan v1.3 approved by Murad, bound to the canonical committed BLOB `4d35bc34…`; activation proof 28/28; v1.0–v1.2 retained byte-identically | `projectos/state/projectos-v3.plan.json`, `state/versions/` | **PROVEN** |
| 2 | ProjectOS drives a phased roadmap under deterministic governance | The runtime created, advanced and closed phases 12, 17 and 18 itself; membership + dependency enforced before any write; Phase 18 refused before Phase 17 closed and permitted after | `.projectops/phases/`, `governedContext.ts` | **PROVEN** |
| 3 | Every phase validated, reviewed and evidenced before closure | G4's 17 predicates, now including **G4-17**: plan-declared `requiredValidators` proven BY NAME against a runner-written, subject-bound record. It refused a real closure before the aggregate could be named | `closureEligibility.ts`, `.projectops/validation/` | **PROVEN** |
| 4 | Production / database / external-send / payment actions are owner-gated | 12 forbidden actions in the plan; all six durable protected-effect flags false; a protected action was ATTEMPTED post-handoff and refused | plan `governance`, session record, continuity ledger | **PROVEN** |
| 5 | No external AI-agent API is required | `noApiPolicy: true`; `use-openai-api` and `use-anthropic-api` forbidden; the zero-relay worker is a local Node process reading durable state; only `SyntheticExecutionProvider` exists | plan, `projectos/worker/`, `core/src/execution/` | **PROVEN** |
| 6 | The owner can start, pause, gate and close autonomous execution from a single control surface | Phase-12 governed matrix (T2–T21) plus the fresh **T22 8/8** smoke proof below: one Control Centre, live canonical state, plan v1.3, PLAN READY, 18/19, Phase 18 governed, Stop offered, Refresh traverses the runtime | T22 log, Phase-12 closure evidence | **PROVEN WITH DISCLOSED LIMITATION** — see §9 R17-6: approval-before-closure is procedural, not mechanically required |

**Success standard** — "approve a plan once, then supervise controlled, evidenced, gated delivery … with a complete audit trail, while retaining single-click authority to start, pause, gate and close": **PROVEN for the governed local/synthetic scope that plan v1.3 defines.** It is NOT a claim about production delivery; the plan excludes that and this pack does not widen it.

## 4. Fresh desktop smoke proof — T22, 8/8, 3m 48s

Run against the REAL Tauri Control Centre built from current source
(`src-tauri/target/webdriver-e2e/debug/projectos-control-center.exe`), through the app's own embedded
WebDriver server. Not a rerun of the Phase-12 matrix; a different question — *does the surface still
tell the truth at the moment of closure?*

- **T22a** genuine application: `tauri://` origin, not `data:`, not a Vite dev server, app process running, real shell.
- **T22b** **Live** canonical runtime state; `Not live` absent — no false live claim.
- **T22c** plan **1.3** and **PLAN READY (recomputed)** — the word *recomputed* is load-bearing.
- **T22d** progress meter `aria-valuenow` = **94.7**, equal to the durable counter, and **< 100**.
- **T22e** Phase 17 `closed`, Phase 18 `prompted`, and the surface offers exactly `Begin implementation` — the one action matching Phase 18's real status, which it could only do by having read Phase 18. *The proof was taken while Phase 18 was at `prompted`; the phase has since been advanced through its governed lifecycle to `awaiting_closure`, so re-running T22e today would correctly fail on that assertion. The proof is a statement about the moment it was taken, and this discloses that moment.*
- **T22f** owner **Stop** offered; `Resume` correctly absent. Offered, deliberately **not exercised**: `phase.stop` maps to `rolled_back`, which leads only back to `draft`, so clicking it would destroy Phase 18's progression to demonstrate a control that is already visible.
- **T22g** Refresh traverses the real chain and repaints identical canonical facts.
- **T22h** shell and governed panel rendered, no error boundary.

*Disclosure:* the WDIO reporter labels the session `msedge 151` — a cosmetic capability label. T22a
asserts the substance (app process, `tauri://` origin, real navigation), which an Edge session could
not satisfy. Native `minWidth` was not changed for the proof.

## 5. Phase-12 reconciliation — accepted outcomes still hold

Exactly **one** Control Centre directory; governed commands reach the canonical `@projectos/core` +
`@projectos/agent`; **no third governance runtime** — the core/agent entry points import no `.cjs`
chain module; Phase-12 closure evidence retained. Refusal honesty, disconnect honesty and the
responsive/accessibility evidence are accepted Phase-12 evidence and were not re-run; nothing in this
phase changed the surfaces they cover.

## 6. Phase-16 PolyGo reconciliation — intact, and untouched

Real PolyGo repository, owner-approved plan at genuine PLAN READY, canonical runtime, bounded task,
self-approval and self-closure both refused, approval recorded BEFORE closure, no protected effect.
Evidence is **EXTERNAL** to this repository (`b6e6993`, `e788d3c`, `db82e129`, `aa2718cf`) and is not
resolvable in this git history — stated, not hidden. **No PolyGo path was modified by this branch**,
verified across every path changed since the V3 baseline `b848171`.

## 7. Phase-17 reconciliation — 7 zero-relay facts recomputed from the ledger

Worker A released and its post-release write was **REFUSED** (`may no longer write`) · the executor
spawned Worker B and **B's parent process IS the executor** (11812 → 45760) · instruction provenance
`durable-state`, argv identifiers only, no task text · Worker B verified independently with **zero
mismatches** · a protected action was **attempted and refused** (`deploy-production`, PROHIBITED) ·
**zero** owner/user-authored events in the handoff window · an owner stop was honoured **immediately
before spawn** in a separate ledger where **nothing was started**.

## 8. Canonical runtime reliability

Failure matrix **26/26** against a real disposable repository with real processes — the 21 directive
cases plus five added from review findings, including six **genuinely concurrent** processes racing
one lock where exactly one wins. Review findings from Phase 17: **1 CRITICAL** (git spawned by bare
name — on Windows that resolves against the cwd first, and the cwd is the governed checkout, so a
planted `git.exe` could have answered "clean" to the closure gate) and **2 HIGH** (non-atomic lock
acquisition; a governed refusal escaping as a stack trace), all fixed, each with a matrix case.

## 9. Final risk register

| Item | Classification | Statement |
|---|---|---|
| **MANUAL_GOVERNANCE_APPROVAL / `tamperProof: false`** | **ACCEPTED NON-BLOCKING LIMITATION** | Owner approval and every governance record are **human** governance, **NOT cryptographically bound**. Anything able to write a record can write a plausible one; the backstop is the owner commit/push gate, where a forgery is a visible diff. This is stated in the plan, in every closure record, and here — it is never claimed as tamper-proofing. |
| R17-1 packaging coupling (`governedContext` resolves engines by repo-relative path) | POST-V3 WORK | Not a correctness or authority defect; the alternative that removes the coupling badly (resolving from the caller's cwd) is what the current code exists to prevent. |
| R17-3 `report` hardcodes `knowledge/reports`, ignores `evidenceRequirements` | POST-V3 WORK | Misplaces evidence for an external project; mis-authorises nothing. Fixing it needs a plan-shaped decision about where a project declares its evidence location. |
| R17-4 plan-import conflict noise | ACCEPTED NON-BLOCKING LIMITATION | Supersession is already reconciled rather than raised. The residual is the price of a control that must not silently discard competing evidence. |
| R17-5 PolyGo `origin/main` pre-existing validator failures | NOT ACTIONABLE — EXTERNAL | This programme has no authority over that repository; excluded scope forbids modifying it. |
| **R17-6 approval-before-closure is PROCEDURAL** | **ACCEPTED NON-BLOCKING LIMITATION** | `transitionPhase` does not mechanically require a matching approved closure record. It was followed and evidenced at Phases 16, 12 and 17. G4-17 established the exact shape a mechanical predicate would take, so this is now cheap to close post-V3. |
| R17-7 validators asserting global tree cleanliness | RESOLVED (pattern) / EXTERNAL (instances) | Pattern fixed: cleanliness is scoped to exclude the handoff's own records. Remaining instances are PolyGo's. |
| **R17-8 plan-path containment is LEXICAL, not realpath** | **ACCEPTED NON-BLOCKING LIMITATION** | A symlink planted **inside** the project could resolve outside it. Planting it already requires local write access, and the pre-existing default `.projectops/plan.json` has carried the identical exposure since it was introduced. Closing it means adding a realpath capability to `System`, widening the runtime's impure surface — its own decision. |
| R17-9 dependency evidence forgery residual | NOT A DEFECT | Consistent with the tamperProof:false model above; never claimed as tamper-proofing. |
| Native-Windows foreground acquisition from a background worker | ACCEPTED NON-BLOCKING LIMITATION | HARNESS limitation, not a ProjectOS defect. Carried from Phase 12. |
| CD-B4 `86ae19c` and `a43898d` | OUT OF NUMBERED SCOPE, STILL OPEN | Not numbered V3 phases; neither is closed by this pack and no windows-future dependency authority is inferred. |
| Forge / HARDEN track | OUT OF NUMBERED SCOPE | IMPLEMENTED AND PUSHED, **FORMAL PROGRAMME CLOSURE NOT VERIFIED**; native Windows worker proof NOT RUN. |

**No item is classified V3 CLOSURE BLOCKER.** No remaining risk contradicts the v1.3 definition of complete.

## 10. No-secret proof

`validate-no-secrets` PASS · `validate-plan-no-secrets` PASS. A targeted scan of `.projectops`
(continuity ledgers, checkpoints, validation records, closure evidence), `knowledge/reports`,
`projectos/state` and `docs` for `service_role`, Supabase/GitHub/Vercel tokens, JWT-shaped values,
AWS keys and PEM blocks returned **no secret VALUE**. Every hit was a secret *name* in prose or inside
a denylist regex — including, in the validation records, the validator names `validate-no-secrets` and
`validate-plan-no-secrets` themselves. Public project refs and URLs are not secrets.

## 11. No-unauthorised-production proof

Durable effect records, not silence: all six session flags (`productionTouched`,
`deploymentOccurred`, `databaseMutationOccurred`, `externalSendOccurred`, `paymentOccurred`,
`rawSecretStored`) are **false**. The plan forbids 12 protected actions including production deploy,
production DB mutation, real email/SMS/WhatsApp, payment, and storing a real secret. No real
`ExecutionProvider` exists — only `SyntheticExecutionProvider`. `installationAuthority` remains
**NotAuthorised** and no Windows service, ACL, ProgramData or registry mutation was performed.
Corroborating positive evidence: a protected action was **attempted** across the zero-relay handoff and
**refused**.

## 12. Records and counters

`acceptedPhaseCount` 18 · `totalPhaseCount` 19 · `completionPercentage` 94.7 (DERIVED) · Phase 18
active, in `pendingPhases`, absent from `completedPhases`. Current-state, phase records, crosswalk
v1.9, Reports Index, session and the active plan all agree. **No 19/19 anywhere.**

## 13. Validation

`node projectos/validators/validate-all.cjs` — **<VALIDATE_ALL>**. Registered module count and the
aggregate command are reported as distinct numbers.

## 14. Review

Security and code review were run on the substantive Phase-17 change set: 1 CRITICAL, 2 HIGH, 2
MEDIUM and 1 LOW, **all fixed**, each with a regression case. Phase 18 introduces **no runtime code** —
its delta is one WebDriver spec, documentation and governance records — and was self-reviewed:
<REVIEW_NOTE>

**0 unresolved CRITICAL · 0 unresolved HIGH.** MEDIUM/LOW are classified in §9.

## 15. Protected effects and residue

**Protected effects: NONE.** Residue: none — working tree clean, 0/0 with origin. Transient runtime
state (ownership lock, owner control file, per-run briefs) is gitignored by design; ledgers,
checkpoints, continuation records and validation records are tracked because they are evidence.

## 16. Post-V3 carry-forward — recorded, NOT implemented

The next Control Centre product-design cycle will consider Lovable-like simplicity with an explicit
Plan-vs-Execute split and visual workflow, and Genspark-like persistent project context and worker
orchestration — with ProjectOS's governance, evidence and owner authority remaining stronger than
either. **Nothing of this was built here and none of it affects Phase-18 closure scope.**

---

## FINAL DECISION REQUIRED

Phase 18 is at **`awaiting_closure`**. Every DoC clause is PROVEN or PROVEN WITH DISCLOSED
LIMITATION; no blocker remains.

**ProjectOS V3 is NOT declared complete by this pack.** The programme stands at **18 / 19, 94.7%**.
Closing Phase 18 closes the programme, and that decision belongs to the owner and the gatekeeper.

**STATUS: AWAITING FINAL OWNER / GATEKEEPER CLOSURE.**
