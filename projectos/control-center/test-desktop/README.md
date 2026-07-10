# Desktop smoke (raw tauri-driver) — opt-in, local-only

Genuine desktop automation of the ProjectOS Control Center Tauri app through **raw
`tauri-driver`** + the WebDriver HTTP protocol. Zero test-framework dependencies (Node's
global `fetch`), **no** Tauri test plugin, **no** application-source changes, **no** auth
bypass. It launches the real desktop executable, drives the login wall, checks safety +
layout + keyboard, and cleans up every process it started.

Not wired into `build`, `validate`, or `install` — run it deliberately.

## Prerequisites (Windows)

1. **tauri-driver** — `cargo install tauri-driver --locked` (must be on `PATH`).
2. **msedgedriver.exe matching the installed Edge** — mismatched versions make the session
   hang. Find your version at `edge://version`, download the exact
   `edgedriver_win64.zip` from `https://msedgedriver.microsoft.com/<version>/edgedriver_win64.zip`,
   extract `msedgedriver.exe`.
3. **A built app executable from the current commit** — `npm run tauri build` →
   `src-tauri/target/release/projectos-control-center.exe`.

## Run

```sh
# from projectos/control-center
PROJECTOS_APP=src-tauri/target/release/projectos-control-center.exe \
MSEDGEDRIVER=/abs/path/to/msedgedriver.exe \
PROJECTOS_SHOT=%TEMP%/login-desktop.png \
npm run test:desktop
```

Exit `0` = genuine pass, non-zero = genuine failure. `PROJECTOS_SHOT` is optional (writes a
login-screen screenshot — the login screen carries no secrets). Keep screenshots out of the
repo.

## Scope (login smoke)

`test:desktop` automates the **login wall / disconnected initial state** only.

---

# Mission Control fixture (authenticated-state, isolated)

`test:desktop:mission-control` drives an **isolated, synthetic, authenticated-state** Mission
Control fixture in a genuine Tauri window — **no credentials, no auth bypass, no Supabase, no
live daemon/sidecar, no network**. It reuses the REAL production Mission Control components
(`src/daemon/LiveMissionControl` via the injectable `DaemonProvider`) fed by a synthetic
`FixtureTransport`, wrapped in a separate test-only Tauri shell (`fixture-shell/`, distinct
title/identifier, no sidecar). Four scenarios: connected / owner-decision / disconnected /
blocked.

## Isolation

- The fixture lives entirely under `test-desktop/`; production `src/**` never imports it.
- A separate Tauri crate (`fixture-shell/`, `com.projectos.control-center.fixture`) — the
  normal build/installer cannot activate it.
- `npm run validate:fixture-isolation` proves no fixture token reaches the production `dist/`
  and no `src` file imports the fixture.

## Build + run (Windows)

Prerequisites: `tauri-driver` on PATH + a version-matched `msedgedriver.exe` (see above).

```sh
# 1. build the synthetic fixture frontend  → test-desktop/fixture-dist/
npm run build:fixture
# 2. build the test-only fixture shell     → fixture-shell/target/release/mission-control-fixture.exe
cargo build --release --manifest-path test-desktop/fixture-shell/Cargo.toml
# 3. run the authenticated-state desktop automation
MSEDGEDRIVER=/abs/path/to/msedgedriver.exe \
PROJECTOS_FIXTURE_APP=test-desktop/fixture-shell/target/release/mission-control-fixture.exe \
PROJECTOS_SHOT_DIR=%TEMP% \
npm run test:desktop:mission-control
```

Exit `0` = genuine pass. It proves isolation markers, safety posture (production/deploy/db/
sends/payments = NO), owner-only governance (Claude cannot approve/close), all four scenarios,
responsive layout, keyboard access, **zero external network**, and clean process teardown.

## Not covered

Authenticated Mission Control against a **real** owner session is intentionally never
automated — that would need credentials or a bypass, both forbidden. Historical real-session
desktop evidence lives in OWNER-VISUAL-PROOF1A and is **not** produced by this harness.
