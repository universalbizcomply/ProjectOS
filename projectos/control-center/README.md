# ProjectOS Control Center

Mission Control desktop UI for ProjectOS. A Vite + React frontend (driven by
`@projectos/core`) wrapped by a Tauri v2 desktop shell.

The app is **read-only Mission Control**: it visualises governed projects, the phase
workflow + who owns each step, the safety gates, and the integration catalog. It never
edits code and performs nothing gated — execution stays in the `projectos` CLI/core.

## Views
- **Projects** — the fleet ProjectOS governs, install status, production-freeze, open phases.
- **Workflow** — the canonical lifecycle with the assigned worker per step (owner-gated closure).
- **Safety Gates** — the eight canonical gates and their status.
- **Integrations** — the inert plugin catalog (external vs local).

## Develop (web, fully runnable)
```
npm install --legacy-peer-deps      # in projectos/control-center
npm run dev                         # Vite dev server on :5178
npm run typecheck                   # strict tsc
```
Requires `@projectos/core` to be built first: `npm install && npm run build` in `projectos/core`.

## Desktop (Tauri) — toolchain-gated
```
cargo tauri dev      # or: cargo tauri build
```
Needs the Rust toolchain **and** a C++ linker (MSVC Build Tools / Desktop C++ on Windows).
Those were not present in the build environment, so the native binary was not compiled here.
The web frontend is fully verified; the desktop shell (`src-tauri/`) is correct Tauri v2
scaffolding pending the toolchain.
