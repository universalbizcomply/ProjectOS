# 02 — App Flow

ProjectOS has two surfaces:
- the **CLI** (`projectos`), the governed runtime;
- the **Control Center** (Tauri desktop), which drives the same runtime through a closed set of verbs.

## 1. Phase lifecycle (state machine)

Defined in `projectos/core/src/phase.ts`.

```
draft ─▶ prompted ─▶ implementing ─▶ validating ─▶ evidence ─▶ awaiting_review ─▶ awaiting_closure ─▶ closed
                         ▲                │                          │                 └──────────▶ closed_as_blocked
                         └────────────────┴──────────────────────────┘ (back to implementing)
any non-terminal state ─▶ rolled_back ─▶ draft
```

- **Non-terminal moves:** any role (default `--as implementer`), inside the approved plan context.
- **`closed` / `closed_as_blocked`:** need a `ClosureGrant` from `authoriseClosure`:
  - the owner, with a committed decision; or
  - the delegate (`--delegated`), with G4 satisfied and a committed decision.
- **The implementer** can never close.

## 2. Programme routing: `projectos continue`

Defined in `commands/run.ts` (`continueRouteFor`, `closureRouteFor`, `dispatchContinueRoute`).

| Programme state | Route (command run) | Exit |
|---|---|---|
| Phase with work left (`draft` … `awaiting_review`) | `run --execute --continue` | the run's code |
| `awaiting_closure`, records not prepared | `closure prepare`; if it commits its records, `closure request` in the same call | 0 / 2 |
| `awaiting_closure`, records prepared and committed | `closure request --execute` | 0 / 2 |
| `awaiting_closure`, decision waiting for a commit | `closure resume --continue` | 0 / 2 |
| Plan complete | nothing; "complete" | 0 |
| Other owner stop, phase blocked | nothing; the true reason is printed | 0 |
| Governed context fails to load | REFUSED | 2 |
| Defect | — | 1 |

`--dry-run` names the route and runs nothing. For a phase with work left it does a real
`run --dry-run`, which writes a brief.

## 3. One phase run (`loop/runner.ts`)

1. **Refusal gates.** These run before anything starts:
   - the governed context loads; `verifyExecutionContext` passes; `selectNextPhase` picks a phase;
   - the brief is built and checked for provenance;
   - committed execution and check configuration;
   - Doctor preflight;
   - `writePathGrants` (else `REFUSED (WRITE_PATHS_REFUSED)`).
2. **Worker.** The Claude Code CLI runs with Write/Edit for exactly the granted paths. Then a scan for
   new ignored content or hooks.
3. **Checks.**
   - The pinned base copies of the required validators run, plus the configured suites.
   - The phase copy of any granted required validator runs too: 10-minute bound, and it fails on any
     checkout change.
   - Up to `MAX_CORRECTION_ATTEMPTS` correction rounds.
4. **Stop decision.** One of `OWNER_GATE`, `PROTECTED_EFFECT`, `UNRESOLVED_CRITICAL_OR_HIGH`,
   `CORRECTION_EXHAUSTED` or `CONTINUATION_READY`.
5. **Gatekeeper turn.**
   - interactive: the owner relays;
   - unattended: Host attestation, or the broker on the committed opt-in.

   Spend is admitted under a lock first.
6. **Technical continuation.** The approved commit and push of the reviewed candidate, on the plan's
   branch.
7. **Records fold.** The run's own records are committed by `ProjectOS implementer`.
8. **Hand-off.** When the phase reaches `awaiting_closure`, the closure route runs (section 2).

## 4. Closure route

| Step | Command | Writes | Main refusals |
|---|---|---|---|
| Prepare | `closure prepare --id P` | `validation/<sha>.json`, `closure/P.json`, closure report. Committed by ProjectOS when commit and push are delegated. | TREE_NOT_CLEAN, SUBJECT_NOT_PUSHED, NO_RUN_EVIDENCE, CHECK_SET_CHANGED, CHECKS_DIRTIED_TREE |
| Request | `closure request --id P --execute` | Decision `closure/decisions/P.json` (CLDEC), ledger entry, wait record. Under `closure-decision-commit` with an in-call answer, ProjectOS commits the bundle and resumes. | NO_CLOSURE_DELEGATION, G4_NOT_SATISFIED, GATEKEEPER_ROUTE_AMBIGUOUS, ANSWER_REFUSED (including a `decidedAt` outside the question window) |
| Resume | `closure resume --id P` | Phase `closed`, `consumedAt` stamped. Post-close records committed by ProjectOS under the grant. | AWAITING_OWNER_COMMIT (identity or bytes mismatch), DECISION_DIRTY, NO_CLOSURE_WAIT |
| Status | `closure status --id P` | nothing | NO_PHASE_RECORD |

## 5. Plan flow

```
plan draft --objective "…" ─▶ objectives/<id>.json + drafts/<id>.json   (proposal; authorises nothing)
plan decide --id <draft> --decision approve|reject [--note] ─▶ plan-decisions/PLANDEC-*.json (committed)
plan activate --id <draft> --decision PLANDEC-…  ─▶ plan-<id>-<digest>.json + current-state-*.json
   (first plan only: plan approve --programme-id …, the genesis route)
```

## 6. Other CLI commands

| Command | Action | Notes |
|---|---|---|
| `phase new --id` | Create a phase record (plan-authorised) | PHASE_NOT_AUTHORISED |
| `phase advance --id --to [--as] [--delegated] [--note]` | One transition | PHASE_IS_TERMINAL, G4_NOT_SATISFIED |
| `phase sync-state` | Recompute the governed current state | — |
| `reconcile --grant --work --dry-run\|--execute` | Clear degraded-mode review debt | — |
| `approve request\|decide\|show\|list` | Approval queue | owner role |
| `close` | Always refuses (exit 2); prints the owner-closure route | by design |
| `status`, `doctor`, `validate`, `report`, `version`, `help` | Read-only and preflight | — |
| `npm run credentials -- set --ref <ref> --replace` | Store a credential (hidden TTY prompt only) | refuses `--value` and piped input |

## 7. Control Center screens and navigation

Navigation is a `useState<View>` switch in `src/App.tsx`, not a router.
- **Views:** `projects`, `execution`, `project`, `control`, `health`, `settings`, `wizard`, `plan`,
  `advanced`.
- **Rail** (`ux/MainNav.tsx`):
  - New project;
  - Projects (with a waiting-count badge), Execution, Control Center, Health;
  - Recent (up to 4);
  - appearance switch;
  - Settings.

| Screen | Purpose and actions | Empty / loading / error |
|---|---|---|
| Sign-in (only if Supabase is configured) | Sign in; change password (minimum 8 characters) | "Loading…"; after a 10 s timeout "Can't reach sign-in" + **Try again**; `.login-error` |
| First run (0 projects) | **Add a project** → wizard | — |
| Projects | **Add project**; **Open** → `project.select` | "Reading the list of projects…"; after 15 s "ProjectOS could not start its runtime"; "No projects yet"; registry and refused-folder notices |
| Project | Tabs: Execution, Overview, Plans, Activity, Files, Advanced. Overview: **Start** (objective panel), **Open the plan**, approvals inbox, **Stop** → `run.stop` | "ProjectOS is not reporting yet" + **Back to projects** |
| Execution | Progress, status headline, owner-decision panel, plan steps, live work, Direction box: **Send** → inline confirm (**Cancel** / **Yes, do it**) → governed verb | "No approved plan is active…", "Nothing is running…" |
| Plans | Active / Proposals / Blocked / Completed. **Approve & Start** (`plan.decide` → `plan.activate` → `run.start`), **Approve only**, **Reject**, **Start**, **Resume**, **Stop**. Every action asks for inline confirmation; Escape cancels | "No plans yet"; "Working…"; failure outcome box (`role=alert`) |
| Plan detail | Step list, plan actions | "There is no active plan"; "This plan has no steps recorded." |
| Control Center | Conversation; **Send** → answer, refusal, navigation, objective, or a governed verb with confirmation; 📎 and 🎙 disabled with a reason | Example prompts when empty; "No project is reporting yet" |
| Objective panel | **Make a plan** / **Propose the change** → `plan.draft {authored:'true'}` (20–4,000 characters, single line) | "Working…"; `.os-refusal.failed` |
| Health | Read-only: AI usage, connections, runtime, execution | "Not recorded" |
| Settings | Appearance, softer motion, connections (`set_credential` with confirmation), always-ask rules, change password, sign out | "ProjectOS is not reporting on a project yet…" |
| Add-project wizard | Project → Folder → Connections → Review (`pick_folder` → `inspect_folder` → `prepare_folder` → `register_project` → `set_credential`) | "Checking the folder…", "Setting it up…", `.os-refusal.failed` |
| Advanced | Mission Control, Workflow, Integrations, Forge, Connections, Safety & Providers, Safety Gates | "Waiting for the daemon…", "No workers reporting." |

**Global states:**
- A browser-only banner when there is no desktop host.
- With no host, governed commands return "No ProjectOS runtime is connected…" (30 s timeout).
- There are no modal dialogs: all confirmations are inline, Escape cancels, and focus moves to the
  confirm button.
