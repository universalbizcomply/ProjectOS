# ProjectOS — PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A

**Date:** 2026-08-04
**Project:** ProjectOS
**Repository:** C:\dev\ProjectOS
**Branch:** projectos-v3
**Parent commit:** 60def85194e2459eb0ea88a36c2a8f94474c5867
**Status:** CLOSED
**Gatekeeper decision:** CLOSED — ChatGPT technical closure gate, 2026-08-04

---

## 0. Closure record

**Phase:** PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A
**Status:** **CLOSED**
**Closure authority:** ChatGPT technical closure gate, 2026-08-04
**Also closes numbered:** `PROJECTOS-V3-DESKTOP-E2E-PROOF1A` — **Phase 13 of 19**

**Accepted implementation commits**

```
1fcf416ab8b08d162ee5948e338c80b81bee6841   auth-bootstrap recovery + initial native proof
fb203c6a9add2ae9b4f8de15c7bd2dccfaed8ebc   installed-host tile-overflow correction + final native proof
```

Both pushed; `local HEAD = origin/projectos-v3 = fb203c6a9add…`, reconciled **0/0**, working tree clean.

**Closure basis**

- Auth-bootstrap recovery — bounded probe deadline, rejection handling, one-shot settlement, retry, late-result suppression, unmount protection, focus management, subscription-lifetime separation.
- Focused tests and mutations — 10 auth-bootstrap tests plus a 9-mutation adversarial matrix, 8 killed; 5 installed-host tile tests; 177 frontend tests across 18 files.
- Native process and window proof — genuine Tauri release process and top-level window, correct title, ≥60s alive and responsive, single-instance refusal, no application-owned Vite process, no dependency on port 5178.
- Authenticated UI proof — owner-signed-in Owner Control and Mission Control rendered and captured on the pushed binary.
- Accessibility and keyboard proof — 133 UIA descendants with real accessible names, Tab traversal from the skip link through the navigation, no modal and no focus trap.
- Stopped host → UNAVAILABLE proof — `sc query` reported `STOPPED` while the native UI showed all seven installed-host fields `UNAVAILABLE`; fail-closed, no `READY`-while-stopped mismatch, service never started.
- Tile-overflow correction — the `UNAVAILABLE` value no longer overflows its tile at 1200×820, 900×620 or maximised 1936×1168.
- All mandatory native requirements **R1–R15 passed**.
- TypeScript check and Tauri release build green; `validate:v3plan` 8/8, `validate:secrets` PASS, `validate:reporter` 4/4.
- No protected operation, no service mutation, no secret exposure.
- Exact pushed boundaries reconciled 0/0.

**Carry-forward (recorded; none blocks this closure)**

1. No package-level ESLint configuration in the Control Centre package.
2. No client-side trace when the session probe fails.
3. The unmount guard is retained but not mutation-enforced.
4. Native scaling proof was measured at 100%.
5. Healthy host state (`READY`/`VERIFIED`) is covered by test and prior host-chain evidence rather than a live capture, because starting the service was prohibited.
6. Screenshot scratchpad cleanup.

---

## 1. Accepted prior native-window evidence

The previous native proof is accepted and not repeated for its own sake. It established a genuine
Tauri native Windows window, correct process and top-level-window identity, the ProjectOS window
title, normal/small/maximised resizing, 60-second process stability, single-instance refusal, and a
rendered sign-in UI.

## 2. False-alarm correction

The earlier eight-second process exit was **not** an application defect. The child process was being
terminated with the PowerShell host that launched it. When launched with redirected standard streams
inside a single session, the process ran the full 60 seconds and stayed responsive. The
package/build blocker is superseded.

A second false alarm from the same session is also corrected here: the Supabase project was briefly
reported as deleted on the strength of a local resolver answering `DNS name does not exist`. Public
resolvers answered the host normally and the local resolver recovered on retry. The project
`ProjectOS` is ACTIVE_HEALTHY; the owner account is confirmed and signs in successfully. That
transient DNS failure is exactly the real-world trigger for the defect corrected below.

## 3. Exact auth defect

`projectos/control-center/src/App.tsx`, initial auth bootstrap:

```tsx
getSession().then((s) => {
  if (live) { setSession(s); setAuthReady(true); }
});
```

Two failure routes had no exit:

1. **Rejection** — no `.catch()`. A rejected `getSession()` left `authReady` false forever and
   produced an unhandled rejection.
2. **Indefinite pending** — no deadline. `getSession()` performs a token refresh against the auth
   host; when that host is unreachable the promise can stay pending indefinitely.

In both cases the app rendered `<div className="booting">Loading…</div>` permanently: no error, no
retry, no route forward. This was observed live — captures at t=12s and t=30s show the frozen boot
state, reaching the sign-in card only at t=60s once the network recovered.

A `.catch()` alone is insufficient, because it does not settle a promise that never settles.

## 4. Implementation

Smallest correction that closes both routes, inside the existing state model. No second auth state
machine; `authReady`/`session` remain the auth truth.

- `SESSION_PROBE_TIMEOUT_MS = 10_000` — the probe is raced against a bounded deadline.
- One-shot `settled` flag — whichever of resolve / reject / timeout lands first owns the transition.
  A late answer after the deadline is **dropped**, never used to revive a stale boot.
- `.catch()` — rejection routes to the failure state, never to a session.
- `retryProbe()` bumps `probeAttempt`, which re-arms the probe effect with a fresh deadline.
- `SessionProbeFailed` — a retryable screen reusing the existing `login` / `login-card` /
  `login-error` / `login-foot` styles. Generic copy only; the rejection reason is never rendered.
  Focus moves to its heading on mount (mirrors the existing `#main` `tabIndex={-1}` pattern).
- The `onAuthChange` subscription was split into its own `[]`-dependency effect. Subscribing
  re-emits current auth state, so retry must not churn it.

Guarantee: the boot state now always exits by exactly one of — session restored, confirmed signed
out, rejection, bounded timeout, or explicit retry. Neither timeout nor failure can produce an
authenticated session; both only ever set `probeFailed`.

## 5. Focused tests

`projectos/control-center/test/authBootstrap.test.tsx` — 10 tests, all passing.

| # | Case | Asserted |
|---|---|---|
| T1 | resolves with a session | boot completes, gate opens |
| T2 | resolves signed out | sign-in shown, no error loop |
| T3 | rejects | retryable failure screen, no unhandled rejection, raw error absent, no session |
| T4 | pending past deadline | still booting before deadline, exits after it, retry offered |
| T5 | resolves after deadline | late answer dropped, retry runs a fresh probe, no latent session |
| T6 | unmount before settlement | deadline disarmed (`getTimerCount()` 0), no post-unmount update |
| T7 | retry after failure | fresh probe recovers |
| T7b | repeated failures | stays retryable, no compounding |
| T8 | failure screen focus | focus lands on the heading |
| T9 | retry subscription churn | exactly 1 subscribe, 0 unsubscribes across 2 retries |

### Mutation / adversarial evidence

Each mutation was applied to the fixed source in isolation and the file restored byte-identical
afterwards (verified with `cmp`).

| Mutation | Result |
|---|---|
| M0 — restore the original defective bootstrap | **KILLED** (5 of 10 fail) |
| M1 — drop `.catch()` | **KILLED** (5 fail) |
| M2 — remove the deadline | **KILLED** (3 fail) |
| M3 — accept a late resolution | **KILLED** (1 fail) |
| M4a — no `clearTimeout` on cleanup | **KILLED** (1 fail) |
| M4b — no `live = false` on cleanup | **SURVIVES** — see limitations |
| M5 — retry does not re-probe | **KILLED** (3 fail) |
| M6 — timeout sets `authReady` instead of failing | **KILLED** (2 fail) |
| M7 — no focus on the failure screen | **KILLED** (1 fail) |
| M8 — subscription moved back into the probe effect | **KILLED** (1 fail) |

9 mutations, 8 killed.

## 6. Code and security review

Three independent reviews were run against the diff.

- **Independent code review — APPROVE.** 0 CRITICAL, 0 HIGH, 1 MEDIUM. All hard constraints
  confirmed respected. MEDIUM: the caught rejection reason is discarded with no logging anywhere.
  **Not fixed, deliberately** — the package has no logging or telemetry convention to match, and the
  house rule bans `console.log` in shipped code. Recorded as carry-forward.
- **Security review — CLEAN.** 0 CRITICAL, 0 HIGH. Confirmed: neither timeout nor rejection can
  grant a session (gate order checks `probeFailed` first, and neither path touches `session`); retry
  re-invokes the real `getSession()` rather than flipping a local flag; no PAT, service-role key,
  JWT, `Authorization` header or anon-key literal in either changed file; the test fixture session
  carries no token material; user-facing copy leaks no internal error, hostname or stack trace.
  One informational note: `onAuthChange` may set `session` while the failure screen shows. Not a
  bypass — `probeFailed` is checked first, and any such value came from the auth provider's own
  authoritative listener.
- **React/TypeScript review — WARNING, no blocking issues in the diff.** Two MEDIUMs were raised and
  **both were fixed** in this phase: the subscription/retry coupling (now split effects, T9) and
  focus management on the failure screen (now focuses the heading, T8). One HIGH was raised against
  the **repository**, not this diff: no ESLint or `eslint-plugin-react-hooks` is configured anywhere
  in the package, and there is no `lint` script. Fixing that requires a `package.json` and
  dependency change, which this gate prohibits. Recorded as carry-forward.

## 7. Build evidence

- `npm run typecheck` (`tsc -p tsconfig.json --noEmit`) — clean.
- `npx vitest run` — **172 passed, 17 files**, 0 failures (was 170 before this phase).
- `npm run build` — vite production build clean; bundle hash moved
  `index-CjFZ4b4X.js` → `index-CzGnFuIK.js`, confirming the corrected source is in the bundle.
- `npx tauri build --no-bundle` — `Finished release profile [optimized] in 1m 08s`, application built.
  No installer was executed. No MSI or NSIS bundle produced.
- Release executable rebuilt from corrected source: sha256 prefix `230A5E59B1DC731B7B5D96E7`,
  written 14:07:34 (pre-correction binary was `3773528247c0d452178667df`).
- `dist/` and `src-tauri/target/` are both git-ignored (`.gitignore:6`, `.gitignore:8`) and neither is
  tracked. No generated artifact is staged.
- No `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock` or `tauri.conf.json` change.

One build failure occurred mid-phase and was resolved without any change of scope: the first rebuild
could not replace the executable (`Access is denied`) because a proof instance from the earlier run
still held it open. The stale process was stopped and the build succeeded.

## 8. Native process and window evidence

Measured against the **rebuilt** binary `230A5E59B1DC731B7B5D96E7`, launched directly. The debug
binary was not used. No browser was used as primary evidence.

| # | Requirement | Result |
|---|---|---|
| 1 | Native process identity | PASS — pid 13476, path `…\target\release\projectos-control-center.exe` |
| 2 | Native top-level Tauri window | PASS — UIA `ClassName='Tauri Window'`, `ControlType.Window` |
| 3 | Title | PASS — `ProjectOS · Control Center` |
| 4 | Alive and responsive ≥ 60s | PASS — 63s, `HasExited=False`, `Responding=True`, stderr empty |
| 5 | No application-owned Vite node process | PASS — 0 matching `node.exe` |
| 6 | No dependency on port 5178 | PASS — 0 listeners on 5178 |
| 7 | Normal 1200×820 | PASS — client 1184×781 |
| 8 | Small 900×620 | PASS — client 884×581 |
| 9 | Maximised | PASS — 1936×1168, client 1920×1129 |
| 10 | Current 125% scaling | **DEVIATION** — `GetDpiForWindow` returns **96 (100%)**, not 125%. Reported as measured; global DPI was not changed |
| 11 | Single-instance refusal | PASS — second launch yields a `#32770` dialog: *"ProjectOS is already running. Use the existing Control Centre window."* |
| 12 | UI Automation tree | PASS — 16 descendants; named: `ProjectOS · Control Center` pane and `… - Web content` pane |
| 13 | Keyboard focusability | **PARTIAL** — window `IsEnabled=True`, `IsKeyboardFocusable=False` on the top-level element (normal for a window frame). The WebView2 content tree exposes no focusable inner controls to UIA in this run, so in-app focus order could not be walked natively. In-app focus is covered by T8 at component level |
| 14 | Loading state exits correctly | **NOT VISUALLY PROVEN this run** — see §10 |
| 15 | Rejected/timeout state usable and retryable | **NOT PROVEN LIVE** — see §10 |
| 16 | Sign-in / signed-out flow usable | **NOT PROVEN LIVE on the rebuilt binary** — see §10 |

## 9. UI/UX and accessibility evidence

Component-level, from the passing tests and the diff:

- Failure screen uses a real `<button type="button">`, keyboard-reachable by default semantics.
- Focus moves to the failure heading on mount (T8), so the transition is announced and the retry
  control is one Tab away rather than a fresh document away.
- The alert region carries `role="alert"`; the heading carries `tabIndex={-1}`, consistent with the
  existing `#main` pattern in the same file.
- Copy is plain and actionable: *"Can't reach sign-in"* / *"Check your connection, then try again."*
  / *"The sign-in service did not respond."* / *"Try again"*. No error codes, no stack traces, no
  hostnames, no jargon. The recovery path needs no training.
- Layout reuses the existing centred `login-card`, which was observed to render correctly at both
  1200×820 and 900×620 on the pre-correction binary.

Rendered-state review of the **rebuilt** binary (loading, failure, retry, sign-in, host-status,
narrow, maximised, clipping, duplicate controls) was **not completed** — see §10.

Neither UI UX Pro Max nor Flow Motion was invoked. No Figma requirement was invented.

## 10. Live ProjectOSHost status evidence — BLOCKED AT TIME OF COMMIT

> **Superseded by Addendum A.** This section records the position when `1fcf416` was committed.
> The workstation was later unlocked and the live proof was completed — see Addendum A.

**LIVE PROOF BLOCKED. OWNER INTERACTIVE SIGN-IN REQUIRED.**

Three separate obstacles, all outside the authorised boundary:

1. **The workstation is locked.** Every screen capture taken after the rebuild recorded the Windows
   lock screen, not the application. UIA and window geometry remained measurable (§8 rows 1–13 are
   valid), but no pixel evidence of the corrected binary could be obtained. The last valid UI pixels
   in this session are from the **pre-correction** binary.
2. **Mission Control sits behind sign-in.** The installed-host status surface
   (`src/daemon/LiveMissionControl.tsx` → `readInstalledHostStatus`) is only reachable with a
   session. Requesting the credential is prohibited.
3. **The service is stopped.** Read-only evidence gathered without mutation:

   ```
   sc query   ProjectOSHost  →  STATE: 1  STOPPED   WIN32_EXIT_CODE: 1077 (0x435)
   sc qc      ProjectOSHost  →  BINARY_PATH_NAME  : C:\Program Files\ProjectOS\host\ProjectOSHost.exe
                                SERVICE_START_NAME: NT SERVICE\ProjectOSHost
                                START_TYPE        : 3  DEMAND_START
   sc showsid ProjectOSHost  →  S-1-5-80-3378865708-3397408971-155286320-2096107322-2736411702  (Active)
   ```

   Displayed service identity therefore matches `NT SERVICE\ProjectOSHost`. Exit code 1077 means the
   service has not been started since boot. With the host stopped, the correct displayed state is the
   fail-closed `UNAVAILABLE` view, which `installedHostStatus.ts` produces for every parse failure.
   Confirming that on screen still requires an unlocked, signed-in session. The service was **not**
   started, restarted, reinstalled, reconfigured, or ACL-changed, and no protected operation was
   executed.

Also not proven live: the rejected/timeout failure state (row 15). Forcing it needs a network or
firewall mutation, which is outside this gate. That path is instead proven by tests T3/T4/T5/T7/T7b
plus mutations M1/M2/M3/M6.

**To unblock:** Murad unlocks the workstation and signs in locally inside the native application.
No password, token or session value is to be sent here.

## 11. Scratchpad and residue

Evidence retained in
`C:\Users\murad\AppData\Local\Temp\claude\c--dev-ProjectOS\47fc86da-4e4a-43e8-8848-61663c842392\scratchpad`.
None is committed.

| File | Time | Supports | Private machine info |
|---|---|---|---|
| `ui-normal.png`, `ui-small.png`, `ui-max.png` | 13:17 | Pre-correction native window, chrome, resize/maximise | Desktop background edges, taskbar |
| `wait-12.png`, `wait-30.png` | 13:18–13:19 | **The defect itself** — frozen "Loading…" | Desktop background edges |
| `wait-60.png` | 13:19 | Sign-in card rendering after recovery | Desktop background edges |
| `cc-normal.png` | 12:49 | Single-instance refusal dialog | Desktop background edges |
| `auth-*.png`, `final-*.png` | 14:01, 14:08 | **VOID** — lock screen only, no application pixels | Lock-screen wallpaper, clock, date |
| `App.tsx.fixed`, `App.tsx.final` | 13:49, 14:05 | Mutation-harness baselines for byte-identical restore | None |

Safe to delete once this report is accepted: `auth-*.png` and `final-*.png` (void), and
`App.tsx.fixed` / `App.tsx.final` (harness baselines). The 13:17–13:19 captures should be kept until
the phase is closed — they are the only pixel record of the defect. `git clean` was not and must not
be used.

Process residue: one Control Centre instance (pid 13476) was left running by the proof. It holds the
release executable open and should be closed before the next rebuild.

## 12. Limitations

- **M4b survives.** Removing `live = false` from cleanup is not caught by any test. React 18 removed
  the post-unmount `setState` warning, and the effect's own timer is already disarmed by
  `clearTimeout`, so the guard has no externally observable effect. It is retained because this gate
  requires preserving the live/unmount guard, but its protection is not test-enforced.
- **Rows 14–16 of the native proof are not live-proven** on the rebuilt binary (locked workstation).
- **Row 10** deviates: measured scaling is 100%, not the 125% the gate anticipated.
- **Row 13** is partial: WebView2 exposes no inner focusable controls to UIA in this run.
- The 10-second deadline is a judgement call. A genuinely slow but successful probe now surfaces a
  retry screen instead of eventually signing in. Retry is always available, and a permanent freeze is
  eliminated, which is the trade this gate asked for.

## 13. Files changed

Exactly two executable paths and two records paths — four total, the authorised maximum.

```
projectos/control-center/src/App.tsx                  (modified)
projectos/control-center/test/authBootstrap.test.tsx  (new)
knowledge/ProjectOS Reports Index.md                  (modified — one row)
knowledge/reports/2026-08-04_ProjectOS_PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A_CLOSED.md  (new; renamed from _AWAITING-REVIEW.md at closure)
```

## 14. Scope

Narrow auth-bootstrap failure recovery, rebuild, native proof rerun, one report, one index row, one
local commit. No broadening. No boundary amendment was required.

## 15. Validators

| Validator | Result |
|---|---|
| `npm run validate:v3plan` (8 validators) | ALL PASS |
| `npm run validate:secrets` | PASS |
| `npm run validate:reporter` (4 validators) | ALL PASS |
| `git diff --check` | clean |
| `npm run typecheck` | clean |
| `npx vitest run` | 172 passed / 17 files |

No validator or existing test was weakened. No test was filtered or skipped.

## 16. Forbidden actions checked

| Action | Performed |
|---|---|
| Broad authentication redesign | NO |
| Supabase schema or policy change | NO |
| Auth-provider configuration change | NO |
| Package or lockfile change | NO |
| Tauri configuration change | NO |
| Dependency addition | NO |
| Windows service mutation (start/stop/reinstall/config/ACL) | NO |
| Elevation | NO |
| Production activity | NO |
| Installer execution (MSI/NSIS) | NO |
| Real secret input through chat | NO |
| Global DPI change | NO |
| Change to 86ae19c or a43898d | NO |
| EXECUTION_READY change | NO |
| acceptedPhaseCount change | NO |
| Push | NO |
| `git reset` / `restore` / `stash` / `clean` | NO |
| Tag | NO |
| Amend | NO |

## 17. Production touched?

No. No production system, deployment, database, or provider was contacted. The only network activity
was read-only diagnosis of an auth host's public health endpoint and DNS resolution.

## 18. External sends

None. No email, message, payment, deploy, or external write of any kind.

## 19. Security position

The Supabase PAT pasted earlier in the session is **permanently compromised and revoked** —
verified: the Management API now answers HTTP 401 for it. It is not reused, not recovered, not
printed, and appears in no changed file, no report, and no screenshot. No replacement was requested
or placed anywhere. `validate:secrets` and a direct scan of the changed paths for PAT, service-role,
JWT, `Bearer` and anon-key shapes both come back clean. A timeout grants no authentication; retry
bypasses no authority; the host-status display grants no protected-operation authority.

## 20. Frozen invariants

```
EXECUTION_READY        = false
installationAuthority  = NotAuthorised
acceptedPhaseCount     = 3
totalPhaseCount        = 19
86ae19c                = OPEN
a43898d                = OPEN
```

No windows-future dependency authority is inferred. No numbered V3 phase is closed by this report.

## 21. Residue

- One Control Centre process (pid 13476) left running by the proof.
- Void screen captures and mutation baselines in the scratchpad (§11), none committed.
- No temporary file, branch, tag, or stash was created in the repository.

## 22. Carry-forward

1. **No ESLint / `eslint-plugin-react-hooks` in the control-center package**, and no `lint` script.
   Raised HIGH against the repository by the React review. Needs a `package.json` + dependency
   change, prohibited by this gate. Recommend a dedicated narrow phase.
2. **No client-side trace when the session probe fails.** The rejection reason is discarded. Needs a
   logging or telemetry convention the package does not yet have.
3. **Live proof owed** — rows 14/15/16, the rendered-state UI/UX review, and live ProjectOSHost
   status. Requires an unlocked workstation and owner interactive sign-in.
4. **M4b unobservable** — the `live` unmount guard is retained but not test-enforced.

## 23. Owner Approval Required

- Unlock the workstation and sign in locally inside the native application so the blocked live proof
  can be completed. Do not send the password, token or session value here.
- Push authorisation for the local commit.

## 24. MCP Used

`claude.ai Supabase` — `list_projects` only, read-only, during diagnosis. It returned two projects in
one organisation and did not list `ProjectOS`, which sits in a different organisation
(`jztcysvxilotqzqaietm`) that this connector cannot see. That absence was briefly and wrongly read as
deletion; corrected in §2.

## 25. External Tools Used

- Windows UI Automation (`UIAutomationClient`) — native window and tree inspection.
- Win32 `user32.dll` (`GetWindowRect`, `GetClientRect`, `MoveWindow`, `ShowWindow`,
  `GetDpiForWindow`) — native geometry and DPI measurement.
- `System.Drawing` — screen capture.
- `sc.exe` — read-only service query (`query`, `qc`, `showsid`). No mutation verb was used.
- ECC review agents — code-reviewer, security-reviewer, react-reviewer.
- Playwright was **not** used. No browser was used as native-window evidence.
- UI UX Pro Max and Flow Motion were **not** invoked.

## 26. Decision needed

Superseded by Addendum A §A.12.

---

# Addendum A — checkpoint push and completed live proof

Added 2026-08-04 after the owner approved `1fcf416` for a normal checkpoint push. No executable
source changed in this addendum; it is evidence only. The phase remains OPEN.

## A.1 Push and remote reconciliation

Pre-push gate: repository `C:\dev\ProjectOS`, branch `projectos-v3`, local HEAD `1fcf416`,
`origin/projectos-v3` `60def85`, 1 ahead / 0 behind, tree clean, 0 staged, 0 untracked, 0 tags.
Commit subject `fix(desktop): recover auth bootstrap failures`, parent `60def85`, exactly the four
authorised paths, no package/lockfile, no Tauri configuration, no generated artifact, no secret-like
material.

Re-validated immediately before push: focused auth-bootstrap tests 10/10; frontend suite
**172 passed / 17 files**; `tsc --noEmit` clean; `validate:v3plan` 8/8 PASS; `validate:secrets` PASS;
`validate:reporter` 4/4 PASS; `git diff --check 60def85..1fcf416` clean. The release binary already
present (`230A5E59B1DC731B7B5D96E7`, built 14:07:34) was produced from exactly this committed source
— the tree has been clean since — so no rebuild was performed merely to refresh evidence.

Remote access verified without touching global Git or GitHub configuration: `git remote get-url
origin` → `https://github.com/universalbizcomply/ProjectOS.git`; `git ls-remote --heads origin`
succeeded. `gh auth switch` was **not** run.

Concurrency gate immediately before push: origin still `60def85`, HEAD still `1fcf416`, tree clean.

Push: `git push origin projectos-v3` → `60def85..1fcf416  projectos-v3 -> projectos-v3`.
Normal push — no force, no tag, no amend, no new commit.

Post-push reconciliation: local HEAD = `origin/projectos-v3` = `1fcf416`, **0 ahead / 0 behind**,
tree clean, **exactly one** remote commit after `60def85`, 0 tags.

## A.2 Owner interactive sign-in confirmation

The workstation was found **unlocked** (no `LogonUI` process) and the Control Centre process from the
proof run (pid 13476, started 14:08:15, binary `230A5E59B1DC731B7B5D96E7`) was **already in an
authenticated session** — the owner had signed in personally inside the native application earlier in
the day. The authenticated dashboard is present in the UI Automation tree (sidebar navigation,
Owner Control plane, and a `Sign out` control, which only renders when a session exists).

No password, PAT, access token, refresh token, session cookie or `Authorization` header was
requested, inspected, read or recorded. No credential of any kind passed through this session.

## A.3 Native process and window evidence (post-sign-in)

Same release binary built from `1fcf416`. No debug executable, no browser, no localhost, no Vite dev
server, no installer.

| # | Requirement | Result |
|---|---|---|
| 1 | Process and native window identity | PASS — pid 13476; visible windows: `Tauri Window` (hwnd 2754058) and the `Tao Thread Event Target` helper |
| 2 | Application responsive | PASS — `Responding=True` throughout; `WindowInteractionState=ReadyForUserInteraction` |
| 3 | No application-owned node/Vite process | PASS — 0 |
| 4 | No listener on port 5178 | PASS — 0 |
| 5 | Rendered authenticated application state | PASS — Owner Control and Mission Control both rendered and captured |
| 6 | Normal 1200×820 | PASS — client 1184×781 |
| 7 | Small 900×620 | PASS — client 884×581 |
| 8 | Maximised | PASS — 1936×1168, client 1920×1129 |
| 9 | Measured DPI/scaling | 96 DPI = **100%**, reported as found; DPI not changed |
| 10 | Keyboard navigation | PASS — Tab order: `Skip to content` → `Owner Control` → `Forge` → `Owner Chat` → `Safety & Providers`; visible focus ring on the active nav item |
| 11 | Accessible names | PASS — 133 UIA descendants with real names (`Document`, `Hyperlink`, `Group Primary`, nine nav `Button`s, `ComboBox Select project`, labelled `ListItem`s) |
| 12 | Clipping / overlap / duplicate controls | **FAIL — defect found, see A.5** |
| 13 | Clear unavailable/refused messaging | PASS — see A.4 |
| 14 | No modal or focus trap | PASS — `WindowPattern.IsModal=False`; Tab moves freely through controls |

## A.4 Live ProjectOSHost status — STOPPED → UNAVAILABLE correspondence PROVEN

Reached by invoking the existing `Mission Control` navigation button through UI Automation — a
read-only view change. No protected control was invoked.

Windows, read-only, queried at 14:43:38 while the view was on screen:

```
sc query ProjectOSHost → SERVICE_NAME: ProjectOSHost   STATE: 1  STOPPED
```

The native UI displayed, under **INSTALLED HOST**, all seven fields as `UNAVAILABLE` — Service,
Installation identity, Channel, Build, Release manifest, Readiness, Protected operations — with the
message *"The installed host could not be reached, so no status is shown."* The view header reads
*"Live from the Bridge Daemon · read-only · no refresh needed."*

- Windows reports the service stopped — **the application correspondingly shows the fail-closed
  unavailable state**. No `READY` was displayed. There is **no live status mismatch**.
- Displayed data is live, not fixture-backed: the same surface has previously rendered concrete
  values (`Verified` / `READY`) when the host was running, and `installedHostStatus.ts` collapses
  every failed or malformed read to exactly this `unavailableView` shape. The value tracks the host's
  actual reachability.
- Service identity is correct and was confirmed by read-only query only:
  `SERVICE_START_NAME: NT SERVICE\ProjectOSHost`, `BINARY_PATH_NAME:
  C:\Program Files\ProjectOS\host\ProjectOSHost.exe`, `START_TYPE: 3 DEMAND_START`, SID
  `S-1-5-80-3378865708-…-2736411702` Active.
- No protected action was offered or performed on this view; it is read-only by construction.
- No authority is inferred from this proof.

The service was **not** started, restarted, installed, repaired or reconfigured. Its state is
unchanged (`STOPPED`) after the proof.

## A.5 UI defect found — value text clipped in the INSTALLED HOST tiles

At every width tested, the word `UNAVAILABLE` **overflows its tile's border**. At 1936×1168 six of
the seven tiles visibly truncate it to `UNAVAILABL`; only `Protected operations` (whose two-line
label makes the tile wider) shows the full word. The same overflow is visible at 1200×820 and
900×620.

The tile grid itself reflows correctly (7 across when maximised, 4+3 at 900 wide) and the page does
not scroll horizontally, so this is a per-tile sizing bug, not a layout collapse. It is cosmetic —
the accompanying sentence states the condition in full and the UIA name of every field is the
complete string `UNAVAILABLE`, so screen-reader users are unaffected.

**Not fixed.** This addendum authorises no executable source change. Recorded as carry-forward.

## A.6 Auth failure/retry evidence

**LIVE FAILURE PIXEL PROOF NOT RUN — TEST AND MUTATION EVIDENCE ACCEPTED.**

No safe in-application control reaches the failure screen, and the state did not occur naturally
during the proof window. No network or DNS disruption was manufactured. The rejection/timeout path
rests on tests T3, T4, T5, T7, T7b and mutations M1, M2, M3, M6.

## A.7 Screenshots retained

| File | Shows | Private content |
|---|---|---|
| `live-normal.png` | Authenticated Owner Control at 1200×820 | desktop edges |
| `live-focus.png` | Keyboard focus state after Tab traversal | desktop edges |
| `live-small.png`, `live-max.png` | Owner Control at 900×620 and maximised | desktop edges |
| `live-mission-control.png` | **Host status UNAVAILABLE at 1200×820** — primary A.4 evidence | desktop edges |
| `live-mc-small.png` | Host status at 900×620, clipping visible | desktop edges |
| `live-mc-max.png` | Host status maximised, clipping across six tiles | small overlay of an unrelated window in one corner |
| `wait-12.png`, `wait-30.png`, `wait-60.png` | **The original defect** — frozen "Loading…", then recovery | desktop edges |
| `ui-normal.png`, `ui-small.png`, `ui-max.png`, `cc-normal.png` | Pre-fix window, resize, single-instance dialog | desktop edges, taskbar |

One earlier maximised capture recorded unrelated application windows because the Control Centre was
not foreground at the moment of capture. It contained another project's on-screen content and was
**deleted immediately**; the capture was repeated with an explicit foreground check before saving.

## A.8 Scratchpad cleanup recommendation

Safe to delete now: `auth-*.png` and `final-*.png` (lock-screen only, no application pixels), and the
mutation baselines `App.tsx.fixed` / `App.tsx.final`.

Keep until ChatGPT accepts closure: `wait-12/30/60.png`, `ui-*.png`, `cc-normal.png`, `live-*.png`,
`live-mc-*.png`.

`git clean` was not used and must not be used. No screenshot is committed.

## A.9 Residue after proof

- Control Centre closed cleanly via `CloseMainWindow()`; **no `projectos-control-center` process
  remains**.
- No orphaned WebView2 process from the app — the 12 `msedgewebview2` processes present belong to
  Windows `SearchHost` and `Widgets`, none referencing the application.
- 0 listeners on port 5178. 0 app-owned node/Vite processes.
- `ProjectOSHost` still `STOPPED`, unchanged.
- Repository: the working tree carries only this report amendment (and an index note if updated).
  No commit was created for the addendum.

## A.10 Remaining limitations

1. **Live failure/retry pixels not captured** — by instruction, no outage was manufactured.
2. **INSTALLED HOST tile clipping** (A.5) — found, not fixed; no executable change authorised.
3. **M4b unobservable** — the `live` unmount guard is retained but not test-enforced.
4. **DPI 100%, not 125%** — reported as measured.
5. **Host READY path not exercised** — only the stopped/unavailable correspondence is proven, since
   starting the service is prohibited.
6. **No ESLint / react-hooks plugin** in the package — pre-existing, needs a prohibited
   `package.json` change.

## A.11 Frozen invariants — unchanged

```
EXECUTION_READY = false        installationAuthority = NotAuthorised
acceptedPhaseCount = 3         totalPhaseCount = 19
86ae19c = OPEN                 a43898d = OPEN
```

No phase closed. No windows-future authority inferred.

## A.12 Decision requested

Superseded by Addendum B §B.13.

---

# Addendum B — INSTALLED-HOST-STATUS-TILE-OVERFLOW1A

The one blocking criterion left open by Addendum A (§A.3 row 12, §A.5) is corrected here. Bounded
amendment: presentation only. No host-status data, contract, transport or service behaviour changed.

## B.1 The defect

At every window width the value `UNAVAILABLE` overflowed its installed-host tile border. Maximised,
six of seven tiles visually truncated it to `UNAVAILABL`. The accessible name was always the complete
string, so only sighted users were affected — but the primary status word was unreadable.

## B.2 Root cause

Two rules in `src/styles.css`, both shared by the installed-host grid and the daemon health grid:

```css
.health-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
.health-cell .hv { font-size: 20px; font-weight: 700; }   /* no overflow-wrap */
```

1. **`auto-fill`** reserves empty tracks at the 120px minimum and shares free space across *all* of
   them, including the ghosts. Maximised, the grid computed ~12 tracks for 7 tiles, so each tile was
   squeezed to ~126px even though the row had ~1620px available.
2. At **20px bold**, `UNAVAILABLE` measures **147px** (measured with GDI+ against Segoe UI Bold — the
   font actually used, since Inter is not installed on this machine). A ~126px tile has ~98px of
   content box after 14px padding each side. With no `overflow-wrap`, a single 11-character word
   cannot break, so it spilled past the border instead of wrapping.

## B.3 The fix — exact change

```css
.health-grid { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }   /* auto-fill → auto-fit */
.health-cell { padding: 12px; }                                                /* was 12px 14px */
.health-cell .hv { font-size: 15px; …; overflow-wrap: anywhere; }              /* was 20px, no wrap */
```

- **`auto-fit`** collapses empty tracks, so the seven tiles share the whole row. Maximised they are
  ~215px wide instead of ~126px — this is the structural half of the fix.
- The narrowest *designed* layout pins the rest of the arithmetic. R6 requires four columns at a
  900px window: grid area 592px, so a tile is fixed at ~140px regardless of the track minimum, giving
  ~117px of content box at 12px padding. Measured widths of `UNAVAILABLE`: 20px→147px, 16px→117px,
  **15px→110px**. Only 15px fits with real margin, so the value size is 15px — still above the app's
  13–14px body text and well above its 11px labels, so it reads as a primary value, not a shrink-to-
  fit hack.
- **`overflow-wrap: anywhere`** is retained purely as a last-resort guard: an unexpectedly long
  machine value now wraps inside its card instead of escaping it. At every designed width the value
  fits on one line, so this path stays dormant.

An intermediate attempt at 16px was built and **proven wrong on screen** — at 900×620 all seven tiles
wrapped to `UNAVAILABL` / `E`. That capture drove the correction to 15px rather than an argument.

## B.4 Files changed

```
projectos/control-center/src/styles.css                    (modified — 3 rules + explanatory comment)
projectos/control-center/test/installedHostTiles.test.tsx  (new)
```

Two executable paths of the three authorised. The rendering component was **not** touched.

## B.5 Focused tests

`test/installedHostTiles.test.tsx` — 5 tests, all passing.

| # | Case | Asserted |
|---|---|---|
| T1 | Seven tiles | every tile's value is the complete string `UNAVAILABLE` |
| T2 | Accessible names | region `Installed host` plus all seven labels intact |
| T3 | No abbreviation | `UNAVAILABL`, `UNAVAIL`, `N/A` and ellipsised forms all absent |
| T4 | Healthy host | `RUNNING`/`VERIFIED`/`STABLE`/`READY`/`REFUSED` and both digest prefixes render in full |
| T5 | Structure | seven `.health-cell`s, one `.hv` + one `.hk` each, order unchanged |

**Stated limitation:** jsdom does not lay out CSS, so these tests cannot prove geometry — they pin the
contract the fix must not break (no logic-level truncation, no lost accessible name). The geometry
claims are proven by the native three-layout window proof in §B.7, which is the primary evidence.

## B.6 Code, ECC and UI review

- **Code review — APPROVE.** 0 CRITICAL, 0 HIGH. Independently verified the `auto-fill`→`auto-fit`
  reasoning and re-derived the 900px four-column arithmetic. One MEDIUM: `.hv` is shared with the
  daemon health grid (`LiveMissionControl.tsx:148`), whose short values never overflowed, so that
  surface also gets the smaller value type. **Accepted deliberately** — scoping it with a modifier
  class would duplicate the rule for no functional gain, and one consistent value size across both
  health grids is the better outcome. Disclosed here rather than hidden.
- **Accessibility / UI review — conditional pass, condition now met.** Confirmed 15px bold sits above
  body text and is not a tiny-font workaround; nothing is ellipsised, abbreviated or hidden from
  sighted users; `role="region"`, `aria-label`, `aria-live` and focus order are untouched; a CSS wrap
  hint never splits the DOM text node, so screen readers still announce one word. Its one HIGH was
  precisely the risk that the wrap fallback would become the routine rendering path — it asked for
  native confirmation rather than assumption. §B.7 supplies it: the fallback never fires at any
  designed width.
- **ECC / boundary review.** Two executable paths of three authorised, five changed paths of five.
  No host-status semantics touched, no service mutated, no generated output tracked, no secret-like
  material, no package/lockfile/Cargo/Tauri change, no dependency added.

## B.7 Three-layout native proof

Release binary `B9DB74F419B7A9EDB213C193`, built 15:10:38 from the corrected source, launched
directly. No debug executable, no browser, no localhost, no Vite dev server, no installer. Foreground
and window identity verified before every capture; a capture was skipped rather than saved whenever
the target was not foreground.

| Requirement | Result |
|---|---|
| R1 complete `UNAVAILABLE` in all seven tiles | **PASS** — 7 UIA elements named exactly `UNAVAILABLE`, and legible in all three captures |
| R2 no clipping at 1200×820 | **PASS** — client 1184×781 |
| R3 no clipping at 900×620 | **PASS** — client 884×581; was the failing case at 16px |
| R4 no clipping maximised | **PASS** — 1936×1168, client 1920×1129, `IsZoomed=True` |
| R5 no horizontal page scroll | **PASS** |
| R6 grid reflow preserved | **PASS** — seven across maximised; four plus three at 900×620 |
| R7 accessible names complete | **PASS** — the only ellipsis anywhere in the tree is the `filter events…` input placeholder, which is intentional |
| R8 status semantics unchanged | **PASS** — component untouched |
| R9 normal values legible | Covered by T4; not observable live because the host is stopped |
| R10 long values cannot escape their card | **PASS** — `overflow-wrap` guard, dormant at every designed width |
| R11 no ellipsis on status words | **PASS** |
| R12 readable, consistent size | **PASS** — 15px bold vs 13–14px body, 11px labels |
| R13 no overlap with labels, borders or neighbours | **PASS** |
| R14 no duplicate control, label or status surface | **PASS** |
| R15 understandable without training | **PASS** — plain sentence retained beneath the grid |

A 2× close view (`fix2-closeup.png`) shows the complete word with clear margin inside each border at
letter level.

## B.8 Accessibility and no-training review

Screen-reader path unchanged: `role="region"` / `aria-label="Installed host"` / `aria-live="polite"`
intact, and all seven values still expose the full string as their accessible name. No text is hidden
from visual users, none is abbreviated, and no meaning is carried by colour alone — the word itself
states the condition, with the plain sentence *"The installed host could not be reached, so no status
is shown."* directly beneath. Keyboard behaviour is untouched; the change is presentational only.

## B.9 Live ProjectOSHost correspondence — still proven, still fail-closed

`sc query ProjectOSHost` → `STATE: 1 STOPPED`, checked before and after the proof. The native UI
showed all seven fields `UNAVAILABLE` throughout. No `READY` while stopped, so no live status
mismatch. The service was **not** started, stopped, restarted, installed, repaired or reconfigured,
and no protected operation was offered or performed. Navigation to Mission Control was a read-only
view change invoked through the existing navigation button.

## B.10 Build evidence

`npm run typecheck` clean · `npx vitest run` **177 passed / 18 files** (was 172/17; auth-bootstrap
tests still green) · vite production build clean · `npx tauri build --no-bundle` green, release exe
rebuilt · no installer executed · `dist/` and `target/` ignored and untracked · no package, lockfile,
Cargo or Tauri configuration change · `validate:v3plan` 8/8 PASS · `validate:secrets` PASS ·
`validate:reporter` 4/4 PASS · `git diff --check` clean.

## B.11 Scratchpad and residue

Retained: `fix2-normal.png`, `fix2-small.png`, `fix2-max.png`, `fix2-closeup.png` (corrected state);
`live-*.png` and `live-mc-*.png` (Addendum A); `wait-12/30/60.png` (the original Loading defect);
`ui-*.png`, `cc-normal.png` (pre-fix). No screenshot is committed.

Deleted locally: the lock-screen-only captures (`auth-*.png`, `final-*.png`), the superseded 16px
attempt (`fix-*.png`), and the mutation baselines (`App.tsx.fixed`, `App.tsx.final`). `git clean` was
not used.

After proof: **no** Control Centre process remains; **no** app-owned WebView2 remains (six children
lingered momentarily after close and exited on their own within seconds); no app-owned Node/Vite
process; 0 listeners on port 5178; `ProjectOSHost` unchanged and `STOPPED`.

## B.12 Accepted limitations

1. `.hv` is shared, so the daemon health grid also renders at 15px (§B.6) — accepted for consistency.
2. R9 is proven by test, not live — the host is stopped, so `READY`/`VERIFIED` cannot be observed on
   screen without starting the service, which is prohibited.
3. jsdom cannot test geometry; layout rests on the native proof.
4. Carried forward unchanged from earlier sections: no ESLint/react-hooks plugin in the package;
   no client-side trace when a session probe fails; the `live` unmount guard is not test-enforced;
   measured scaling is 100%, not 125%.

## B.13 Decision requested

**APPROVED TO PUSH** — or **NARROW AMENDMENT REQUIRED — DO NOT PUSH** — or **LIVE PROOF BLOCKED**.
