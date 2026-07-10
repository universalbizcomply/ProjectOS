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

## Scope

Automates the **login wall / disconnected initial state** only. Authenticated Mission
Control is **not** automated here — that would require credentials or an auth bypass, both
forbidden. Historical authenticated desktop evidence lives in OWNER-VISUAL-PROOF1A and is
**not** produced by this harness.
