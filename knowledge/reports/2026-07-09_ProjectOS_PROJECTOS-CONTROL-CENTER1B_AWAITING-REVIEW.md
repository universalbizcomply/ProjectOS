# PROJECTOS-CONTROL-CENTER1B — Native Desktop Build (Evidence Pack)

> **Scope:** Actually build the Tauri native desktop app — previously reported as
> toolchain-blocked. On the owner's machine the account auto-elevates, so the Rust + MSVC
> C++ toolchain installed without a UAC wall, and the app compiled, linked and bundled.

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-CONTROL-CENTER1B (NATIVE_BUILD) — completes CONTROL-CENTER1A's deferred native compile.
3. **Status:** BUILT / AWAITING-REVIEW. Closure owner-gated.
4. **Branch:** projectos-v2-core.
5. **Toolchain installed (this machine):**
   - **Rust** via `winget install Rustlang.Rustup` — user-level, no admin → `cargo 1.96.1`, `rustc 1.96.1`.
   - **VS Build Tools 2022** + "Desktop development with C++" (VCTools) via winget — the account auto-elevated silently → `cl.exe` at `VC\Tools\MSVC\14.44.35207`.
   - Correction to CONTROL-CENTER1A's "blocked" note: the blocker was UAC/interactivity, which did not apply here because the account elevates without a prompt.
6. **Build fixes:** removed the unused `[lib]` target from `src-tauri/Cargo.toml`; added `bundle.icon` to `tauri.conf.json`; generated the full icon set with `tauri icon` from a generated 512×512 PNG (`src-tauri/icons/` incl. `icon.ico`); added `@tauri-apps/cli` + a `tauri` script to `package.json`.
7. **Build (`npm run tauri build`):** frontend `vite build` (90 modules) → cargo release compile of Tauri 2.11.5 / wry / webview2 / tao etc. → **linked with MSVC** → bundled.
   - **Executable:** `src-tauri/target/release/projectos-control-center.exe` — **8.4 MB PE32+ x86-64 Windows GUI** (verified `MZ`/`PE32+`).
   - **MSI installer:** `bundle/msi/ProjectOS Control Center_0.1.0_x64_en-US.msi` (WiX).
   - **NSIS setup:** `bundle/nsis/ProjectOS Control Center_0.1.0_x64-setup.exe`.
   - `Finished release profile ... Finished 2 bundles`.
8. **App:** the desktop shell loads the same Vite frontend verified in CONTROL-CENTER1A/CLOUD-DASHBOARD1B — same live-Supabase dashboard, now as a native window. GUI runtime not launched here (no interactive desktop session); build+link+bundle success is the evidence.
9. **Security:** no secrets in the build config; `.env.local`/`.vercel/`/`target/` git-ignored. The bundle embeds only the public Supabase URL + publishable key.
10. **Committed:** `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/icons/**`. Build artifacts (`target/`) are git-ignored.
11. **Rollback:** revert the config edits + delete `src-tauri/icons/` + `target/`.
12. **Carry-forward:** optional code-signing of the installers; launch-test the GUI on a desktop session; wire Tauri shell commands to invoke the `projectos` CLI for live actions.
13. **Decision needed:** owner/advisor review + closure. Install via the MSI or NSIS setup to run the desktop app.

## Final status
**PROJECTOS-CONTROL-CENTER1B — BUILT / AWAITING-REVIEW.** Native desktop app compiled, linked (MSVC) and bundled: `projectos-control-center.exe` (8.4 MB) + MSI + NSIS installers. The earlier "toolchain-blocked" limit did not hold on this machine (auto-elevation). No secrets committed.
