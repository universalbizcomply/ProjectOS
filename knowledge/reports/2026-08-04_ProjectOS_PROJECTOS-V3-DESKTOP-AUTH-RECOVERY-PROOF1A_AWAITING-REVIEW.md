# ProjectOS — PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A

**Date:** 2026-08-04
**Project:** ProjectOS
**Repository:** C:\dev\ProjectOS
**Branch:** projectos-v3
**Parent commit:** 60def85194e2459eb0ea88a36c2a8f94474c5867
**Status:** AWAITING-REVIEW
**Decision requested:** APPROVED TO PUSH — or NARROW AMENDMENT REQUIRED — DO NOT PUSH

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

## 10. Live ProjectOSHost status evidence — BLOCKED

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
knowledge/reports/2026-08-04_ProjectOS_PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A_AWAITING-REVIEW.md  (new)
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

**APPROVED TO PUSH** — or **NARROW AMENDMENT REQUIRED — DO NOT PUSH** — or **LIVE PROOF BLOCKED**
(acknowledging §10 and scheduling the owner-interactive follow-up).
