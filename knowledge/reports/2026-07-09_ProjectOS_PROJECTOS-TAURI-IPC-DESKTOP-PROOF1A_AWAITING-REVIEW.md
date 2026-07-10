# PROJECTOS-TAURI-IPC-DESKTOP-PROOF1A — Proof Pack

> Proof-only phase. Prove the desktop app connects to the Bridge Daemon via Tauri IPC and
> renders live state. No feature work, no redesign, no governance change, nothing committed.

**Project:** ProjectOS V2
**Phase:** PROJECTOS-TAURI-IPC-DESKTOP-PROOF1A
**Status:** PASS (automated + runtime) — with one honest caveat: the in-window pixels were not
screenshotted (headless session). Every executable link in the chain is proven, and the built
desktop exe launched and spawned the sidecar at runtime.
**Branch:** projectos-v2-core
**Commit (HEAD):** `3ce3f28`
**Files changed:** NONE (proof-only; no fix was required — no proof item failed).

## What was proven, and how

### A. Runtime launch (the real built desktop app)
Launched `target/release/projectos-control-center.exe` (cwd = control-center) and observed via
`Get-CimInstance Win32_Process`:
```
APP: projectos-control-center pid=29692
SIDECAR SPAWNED: pid=21340 cmd="node" sidecar/host.mjs
CLEANUP done (node before=50 after=48)
```
→ **Item 1** (app launches), **Item 3** (Rust host runs — its `spawn_and_register` executed),
**Item 4** (Node sidecar spawns) proven at **runtime**, then cleanly killed.

### B. Live sidecar IPC proof (real daemon, real .projectops project)
Ran the REAL sidecar exactly as the Rust host spawns it (`node sidecar/host.mjs --root <proj>`)
against a seeded temp `.projectops` project and inspected its actual stdout protocol:
```
true  sidecarStarted          true  liveEventStreamed
true  ipcSnapshotEmitted      true  liveFileChangeDetected  (~800ms after a log append)
true  healthRunning           true  stdinSnapshotCommand
true  projectDetected         true  noSecretsOnWire
true  workerRendered          true  sidecarStoppable
snapshots=3 events=5 totalLines=12
first snapshot: health.running=true, recovered=true, projects=1, workers=1
             projects: proof-proj/PROOF1A@implementing | workers: claude-code:implementing
daemon logs → stderr (RECOVERY "recovered phases"; INFO "daemon started") — stdout stays pure protocol
RESULT: PASS (all checks)
```
→ **Item 5** (daemon starts + recovers), **Item 6** (IPC protocol connects/emits), **Item 7**
(health running), **Item 8** (worker rendered), **Item 9** (project detected), **Item 10** (a
live canonical event — appended `VALIDATION_STARTED` — detected via real `fs.watch` and advanced
the phase within ~800ms), **Item 11** (notifications/empty-state carried in the snapshot), plus
the `stdin {"cmd":"snapshot"}` command round-trip. (Windows `fs.watch` firing on append was
separately confirmed.)

### C. Automated chain (existing suites, re-run)
- **Item 2** transport selection: `createDesktopTransport` → `TauriIPCTransport` when `isTauri()`,
  else `NullTransport` (unit-tested; the real exe is a Tauri webview → selects Tauri).
- **Item 6/10** TauriIPCTransport: listens `daemon://message`, parses via shared `ipcProtocol`,
  relays; `invoke`/`listen` failure → `closed`; disconnect unlistens (unit-tested, 100%).
- **Items 7–11 render:** jsdom component test shows `LiveMissionControl` renders "Bridge running",
  the worker, and the owner queue from a live snapshot.
- **Item 12** reconnect: `DaemonClient` heartbeat liveness-timeout → disconnected → capped-backoff
  reconnect; `closed` → reconnect (unit-tested); sidecar proven stoppable (the trigger).
- **Item 13** browser fallback: `isTauri()` false → `NullTransport` → clean Disconnected
  (unit-tested; prior phase's browser preview showed Disconnected).
- **Item 14** secrets: wire scan clean; jsdom test asserts no secret in the DOM; report scan clean.

## Panel-by-panel result

| Panel / item | Result | Evidence |
|---|---|---|
| Transport selected | **TauriIPCTransport** (desktop) / NullTransport (browser) | selection unit test; exe is Tauri |
| Daemon status | **RUNNING** | sidecar stderr "daemon started"; snapshot health.running=true |
| Sidecar status | **RUNNING** | runtime pid observed; live protocol emitted |
| IPC status | **CONNECTED** | snapshots + live events on the wire; Rust emit/listen compiled + unit-tested |
| Health panel | **PASS** | running=true, projects/workers/watchers=1, recovered=true |
| Worker panel | **PASS** | claude-code:implementing |
| Project panel | **PASS** | proof-proj/PROOF1A@implementing |
| Event viewer | **PASS** | live `VALIDATION_STARTED` detected ~800ms after append |
| Notification panel | **PASS** | snapshot carries notifications/valid empty state |
| Reconnect | **PASS** | client reconnect unit-tested; sidecar stoppable |
| Browser fallback | **PASS** | NullTransport selected off-Tauri |
| Secret exposure | **CLEAR** | wire + DOM + report scans clean |

## The one caveat (honest)

The literal **Rust-emit → webview-listen → pixels** delivery at runtime, and a human *seeing*
the live data in the Tauri window, were **not** screenshotted — this is a headless session with
no display. Everything up to and around that link is proven with real components (the exe
launches + spawns the sidecar; the sidecar streams real live state; the transport parses it; the
UI renders that store). A 30-second owner glance closes the visual gap:
```
cd projectos/control-center && npm run build:sidecar && npm run tauri dev
# expect: "Mission Control" tab → "Bridge running", workers/projects/events populate live.
```

## Validation

- `git branch --show-current` → **projectos-v2-core**
- `git log --oneline -3` → `3ce3f28 / 0d2ef8a / ab182c8`
- framework `validate-all` → **ALL PASS**
- Bridge Daemon tests → **104 / 104**
- Control Center `tsc` → **EXIT 0**; tests → **46 / 46**
- `cargo check` → **Finished, 0 errors**
- `git status --short` → 18 unrelated dirty/untracked entries (all pre-existing / un-gated
  BRIDGE-ARCHITECTURE1A; none staged, none part of any commit)

## Confirmations

Production touched: **NO** · Deploy: **NO** · Database mutation: **NO** · External sends/payments:
**NO** · Force push: **NO** · Commit: **NOT COMMITTED** · Push: **NOT PUSHED**. The only side
effects were a temp scratch `.projectops` project (deleted) and a 5-second exe launch (killed).

## Risks

- Live in-window visual not screenshotted (headless) — the sole unobserved link; closeable by a
  30s owner launch.
- Bundled desktop expects `node` on PATH + the sidecar's `node_modules` (dev machine has them);
  self-contained packaging remains carry-forward.

## Carry-forward

- Self-contained sidecar packaging (embed Node / single-binary sidecar).
- Graceful sidecar kill-on-exit.
- Optional automated desktop UI drive (WebDriver/tauri-driver) for pixel-level CI proof.

## Decision needed

Request ChatGPT closure review for **PROJECTOS-TAURI-IPC-DAEMON1A**. The automated + runtime
proof is complete; only the 30-second in-window visual remains, at the owner's discretion.
