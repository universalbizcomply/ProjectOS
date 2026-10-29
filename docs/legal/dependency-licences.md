# ProjectOS - third-party dependency licence inventory

Prepared 2026-10-29 for legal review. **Read-only**: nothing in the repository was changed, nothing was installed, nothing was downloaded.

- Source tree: `C:\dev\ProjectOS-worktrees\host-review-path1b` (worktree, HEAD `8cbd784`, clean).
- npm: every `package-lock.json` (lockfile v3) plus the installed `node_modules/*/package.json` and licence files.
- Rust: every `Cargo.lock` under `projectos/host/*` and `projectos/control-center/**`, plus each crate's own `Cargo.toml`
  and licence files from the local cargo registry (`%USERPROFILE%\.cargo\registry`).
- Full data: `dependency-licences.csv` (one row per unique package and version) and `dependency-licences-by-component.csv` (one row per package per component).
- This is an engineering inventory, not legal advice. Licence fields are what the package authors declared; only the flagged items were checked against the licence text.

## 1. Summary

### Bottom line

- **No strong copyleft (GPL, AGPL, SSPL) in anything that ships.** The only GPL text found is one option of the dev-only `jszip` dual licence (MIT OR GPL-3.0-or-later). We take MIT.
- **Weak copyleft that ships: 5 MPL-2.0 Rust crates in the desktop app** (`cssparser`, `selectors`, `dtoa-short`, `option-ext`; `cssparser-macros` is compile-time only). All five come in through the Tauri framework, not from our own choice. See section 2.
- **The CLI (`projectos`), the core library and the bridge daemon have zero third-party runtime npm dependencies.** All their npm packages are dev-only (TypeScript, Vitest).
- **The Windows service `ProjectOSHost` has 28 third-party runtime crates, all permissive:** 25 x `MIT OR Apache-2.0`, 2 x `MIT`, 1 x `Unlicense OR MIT`. They are Microsoft's `windows-rs` bindings, RustCrypto `sha1`/`sha2`, and `serde`/`serde_json`. Compile-time only: `proc-macro2`, `quote`, `syn`, `serde_derive`, `unicode-ident` (Unicode-3.0) and others.
- **Unknown licences: none in anything compiled for Windows.** The unknowns are Rust crates that apply only to other platforms. They have never been downloaded on this machine, so their licence could not be read offline (section 2.4).
- **Attribution is required for practically everything.** MIT, BSD, ISC, Apache-2.0, Unicode-3.0 and MPL-2.0 all need the copyright and licence text shipped with the binaries. There is currently no third-party notices file in the product (section 3).

### npm - unique packages (name + version) by licence class and scope

| Class | prod | build | dev | not-windows | Total |
|---|---:|---:|---:|---:|---:|
| permissive | 16 | 0 | 703 | 0 | 719 |
| weak-copyleft | 0 | 0 | 0 | 0 | 0 |
| strong-copyleft | 0 | 0 | 0 | 0 | 0 |
| other | 0 | 0 | 3 | 0 | 3 |
| unknown | 0 | 0 | 1 | 0 | 1 |
| **Total** | **16** | **0** | **707** | **0** | **723** |

### Rust (cargo) - unique packages (name + version) by licence class and scope

| Class | prod | build | dev | not-windows | Total |
|---|---:|---:|---:|---:|---:|
| permissive | 226 | 74 | 0 | 0 | 300 |
| weak-copyleft | 4 | 1 | 0 | 0 | 5 |
| strong-copyleft | 0 | 0 | 0 | 0 | 0 |
| other | 0 | 0 | 0 | 0 | 0 |
| unknown | 0 | 0 | 0 | 197 | 197 |
| **Total** | **230** | **75** | **0** | **197** | **502** |

Scope means: **prod** = runtime dependency that ends up in a built product. **build** = compile-time only (build scripts, proc-macros and their dependencies; no code shipped, though macros generate code). **dev** = tests and tooling. **not-windows** = in the lockfile, but only reachable through target-specific dependencies that do not apply to `x86_64-pc-windows-msvc`. Each package is counted once, at its "most shipping" scope across all components.

Component-instances (the same package counted once per lockfile): npm 1454, cargo 2110. Unique packages: npm 723, cargo 502, **total 1225**.

### Per shipping product (unique third-party runtime packages)

| Product | Source | Runtime packages | Non-permissive |
|---|---|---:|---|
| Desktop app - Rust/Tauri binary | `cc-src-tauri` | 220 | cssparser 0.36.0 (MPL-2.0), dtoa-short 0.3.5 (MPL-2.0), option-ext 0.2.0 (MPL-2.0), selectors 0.36.1 (MPL-2.0) |
| Desktop app - web frontend (bundled) | `projectos/control-center` | 16 | none |
| Windows service `ProjectOSHost` | `service-host` | 28 | none |
| Installer: `projectos-register-project[-elevated]` | `elevated-installer-composition` | 27 | none |
| Packaging tools (manifest-sign, install-record) | `packaged-manifest-generator` | 23 | none |
| Service control binary | `windows-service-control` | 27 | none |
| Service identity proof runner | `windows-service-identity-proof-runner` | 27 | none |
| CLI `projectos` (agent + core) | `projectos/agent` | 0 | none |
| Bridge daemon `projectos-bridge` | `projectos/bridge/daemon` | 0 | none |

Licence mix of the shipping Rust runtime crates (desktop app + service + installer/tools, unique):

| Declared licence | Crates |
|---|---:|
| `MIT OR Apache-2.0` | 114 |
| `MIT` | 40 |
| `Apache-2.0 OR MIT` | 23 |
| `Unicode-3.0` | 15 |
| `MIT/Apache-2.0` | 9 |
| `Unlicense OR MIT` | 4 |
| `MPL-2.0` | 4 |
| `BSD-3-Clause` | 2 |
| `MIT OR Apache-2.0 OR Zlib` | 2 |
| `Unlicense/MIT` | 2 |
| `Apache-2.0` | 2 |
| `(MIT OR Apache-2.0) AND Unicode-3.0` | 1 |
| `BSD-3-Clause AND MIT` | 1 |
| `BSD-3-Clause/MIT` | 1 |
| `Apache-2.0 AND MIT` | 1 |
| `CC0-1.0 OR MIT-0 OR Apache-2.0` | 1 |
| `Apache-2.0 / MIT` | 1 |
| `Zlib` | 1 |
| `MIT AND BSD-3-Clause` | 1 |
| `Apache-2.0 OR BSL-1.0` | 1 |
| `Zlib OR Apache-2.0 OR MIT` | 1 |

## 2. FLAGGED items

Every item that is not plainly permissive, has no declared licence, or carries a hidden extra licence. Shipping items come first.

### 2.1 Ships in a product

| Package | Version | Licence | Scope | Component | Why it matters |
|---|---|---|---|---|---|
| `cssparser` | 0.36.0 | MPL-2.0 | prod | Desktop app (`control-center/src-tauri`; also the test fixture shell). Path: tauri-utils / wry -> dom_query -> selectors -> cssparser | MPL-2.0 is file-level weak copyleft. Pulled in by the Tauri framework, compiled into the desktop app binary. Using it unmodified is allowed in a proprietary app, but the app must tell recipients where to get the MPL-covered source and must keep the licence notices; any change to those files must be released under MPL-2.0. |
| `dtoa-short` | 0.3.5 | MPL-2.0 | prod | Desktop app (`control-center/src-tauri`; also the test fixture shell). Path: ... -> cssparser -> dtoa-short | MPL-2.0 is file-level weak copyleft. Pulled in by the Tauri framework, compiled into the desktop app binary. Using it unmodified is allowed in a proprietary app, but the app must tell recipients where to get the MPL-covered source and must keep the licence notices; any change to those files must be released under MPL-2.0. |
| `option-ext` | 0.2.0 | MPL-2.0 | prod | Desktop app (`control-center/src-tauri`; also the test fixture shell). Path: tauri / wry / tray-icon -> dirs -> dirs-sys -> option-ext | MPL-2.0 is file-level weak copyleft. Pulled in by the Tauri framework, compiled into the desktop app binary. Using it unmodified is allowed in a proprietary app, but the app must tell recipients where to get the MPL-covered source and must keep the licence notices; any change to those files must be released under MPL-2.0. |
| `selectors` | 0.36.1 | MPL-2.0 | prod | Desktop app (`control-center/src-tauri`; also the test fixture shell). Path: tauri-utils / wry -> dom_query -> selectors | MPL-2.0 is file-level weak copyleft. Pulled in by the Tauri framework, compiled into the desktop app binary. Using it unmodified is allowed in a proprietary app, but the app must tell recipients where to get the MPL-covered source and must keep the licence notices; any change to those files must be released under MPL-2.0. The crate ships no LICENSE file. |
| `cssparser-macros` | 0.6.1 | MPL-2.0 | build | Desktop app (`control-center/src-tauri`; also the test fixture shell). Path: cssparser -> cssparser-macros | Compile-time proc-macro for `cssparser`; its own code is not linked into the binary. Low risk, keep the notice anyway.  |
| `crossbeam-channel` | 0.5.16 | MIT OR Apache-2.0 (declared) + embedded CC-BY-3.0 and BSD-3-Clause portions | prod | Desktop app (`control-center/src-tauri`) | Declared MIT OR Apache-2.0, but LICENSE-THIRD-PARTY shows embedded code from Go `matching.go` under CC-BY-3.0, plus Go (BSD-3-Clause) and Rust-project portions. Attribution for those portions is required. Not copyleft, but the extra attribution is easy to miss because the declared licence does not mention it. |
| ICU4X family + `unicode-ident` (16 runtime, 4 compile-time/other: `icu_*`, `zerovec`, `yoke`, `tinystr`, `writeable`, `litemap`, `zerotrie`, `zerofrom`, `potential_utf`, ...) | 2.x / various | Unicode-3.0 (alone, or AND-ed with MIT OR Apache-2.0) | prod | Desktop app (via `url` -> `idna`). `unicode-ident` is in the desktop runtime graph and is compile-time only in the host/service crates | Permissive, but **outside the named permissive list**. It requires the Unicode copyright and permission notice to appear with the software or its documentation. |

### 2.2 Dev or build only (does not ship)

| Package | Version | Licence | Scope | Component | Why it matters |
|---|---|---|---|---|---|
| `caniuse-lite` | 1.0.30001803 | CC-BY-4.0 | dev | projectos/control-center | CC-BY is a content licence, not a software licence; it requires attribution. Dev-only (test/build tooling): it does not ship in the desktop app, the service or the CLI. |
| `@promptbook/utils` | 0.69.5 | CC-BY-4.0 | dev | projectos/control-center | CC-BY is a content licence, not a software licence; it requires attribution. Dev-only (test/build tooling): it does not ship in the desktop app, the service or the CLI. |
| `spdx-exceptions` | 2.5.0 | CC-BY-3.0 | dev | projectos/control-center | CC-BY is a content licence, not a software licence; it requires attribution. Dev-only (test/build tooling): it does not ship in the desktop app, the service or the CLI. |
| `css-value` | 0.0.1 | *(missing)* - MIT per Readme | dev | projectos/control-center (WebdriverIO E2E tooling) | No `license` field and no LICENSE file; Readme.md contains the MIT licence text (Copyright 2012 TJ Holowaychuk). Effective licence: MIT. |
| `jszip` | 3.10.1 | (MIT OR GPL-3.0-or-later) | dev | projectos/control-center, projectos/vscode | Dual licence with a GPL option. **We take MIT.** Dev-only (WebdriverIO / VS Code test tooling). |
| `argparse` | 2.0.1 | Python-2.0 | dev | projectos/control-center, projectos/vscode | PSF licence: permissive, but outside the named list. Dev-only. |
| `type-fest` | 3.13.1, 4.26.0, 4.41.0 | (MIT OR CC0-1.0) | dev | projectos/control-center | Dual licence, both options permissive; take MIT. Listed only because it is dual. |
| `pako` | 1.0.11 | (MIT AND Zlib) | dev | projectos/control-center, projectos/vscode | Conjunctive: both licences apply. Both are permissive. Dev-only. |

### 2.3 Dual-licensed packages - which option we take

| Ecosystem | Declared expression | Option taken | Packages |
|---|---|---|---:|
| cargo | `MIT OR Apache-2.0` | `MIT` | 151 |
| cargo | `Apache-2.0 OR MIT` | `MIT` | 32 |
| npm | `Apache-2.0 OR MIT` | `MIT` | 13 |
| cargo | `MIT/Apache-2.0` | `MIT` | 12 |
| cargo | `Unlicense OR MIT` | `MIT` | 4 |
| npm | `(MIT OR CC0-1.0)` | `MIT` | 3 |
| cargo | `(MIT OR Apache-2.0) AND Unicode-3.0` | `MIT AND Unicode-3.0` | 2 |
| cargo | `MIT OR Apache-2.0 OR Zlib` | `MIT` | 2 |
| cargo | `Unlicense/MIT` | `MIT` | 2 |
| cargo | `Zlib OR Apache-2.0 OR MIT` | `MIT` | 2 |
| npm | `MIT OR Apache-2.0` | `MIT` | 1 |
| npm | `(MIT OR GPL-3.0-or-later)` | `MIT` | 1 |
| cargo | `0BSD OR MIT OR Apache-2.0` | `MIT` | 1 |
| cargo | `BSD-3-Clause/MIT` | `MIT` | 1 |
| cargo | `CC0-1.0 OR MIT-0 OR Apache-2.0` | `MIT-0` | 1 |
| cargo | `Apache-2.0 / MIT` | `MIT` | 1 |
| cargo | `MIT OR Zlib OR Apache-2.0` | `MIT` | 1 |
| cargo | `Apache-2.0 OR BSL-1.0` | `Apache-2.0` | 1 |

Default rule used: where MIT is offered we take **MIT** (shortest attribution duty, no NOTICE handling). Counsel may prefer **Apache-2.0** for the Rust `MIT OR Apache-2.0` crates because it carries an express patent licence. Both options are permissive, so the classification does not change either way. One exception: Unicode-3.0 sits inside an AND, so it applies on top of the option taken.

### 2.4 Unknown licence - 197 Rust crate versions (175 names), all `not-windows`

These crates are listed in `control-center/src-tauri/Cargo.lock`, `test-desktop/fixture-shell/Cargo.lock` and (7 per lock) in the host locks, but they are reachable **only** through target-specific dependencies for other operating systems or architectures. They have never been compiled on this Windows machine, so their sources are not in the local registry and their licence could not be read offline. They are **not** compiled into any Windows build.

Why this conclusion holds: two independent signals agree completely. (a) The graph walk with Windows cfg evaluation (Appendix B) places every one of these crates outside the Windows graph. (b) Every crate the walk places inside the Windows graph *is* in the local registry, because it has actually been compiled here, and every crate missing from the registry is one the walk calls non-Windows. Not one crate breaks this split.

Closing this gap: run `cargo metadata` online once (it writes only to `%USERPROFILE%\.cargo`, not to the repository), or use `cargo deny check licenses`. That needs network access, which was outside this read-only brief.

Some names also appear in the Windows graph at a **different version**: `base64`, `getrandom`, `heck`, `libc`, `png`, `serde_spanned`, `syn`, `toml`, `toml_datetime`, `windows-core`, `windows-result`, `windows-strings`, `windows-sys`, `windows-targets`, `windows_x86_64_msvc`, `winnow`. That version is inventoried and permissive. Only the version listed below is non-Windows.

Crate versions: `android_system_properties 0.1.5`, `async-broadcast 0.7.2`, `async-channel 2.5.0`, `async-executor 1.14.0`, `async-io 2.6.0`, `async-lock 3.4.2`, `async-process 2.5.0`, `async-recursion 1.1.1`, `async-signal 0.2.14`, `async-task 4.7.1`, `atk 0.18.2`, `atk-sys 0.18.2`, `base64 0.21.7`, `block2 0.6.2`, `blocking 1.6.2`, `bumpalo 3.20.3`, `bytemuck 1.25.0`, `bytemuck 1.25.1`, `cairo-rs 0.18.5`, `cairo-sys-rs 0.18.2`, `cesu8 1.1.0`, `cfg-expr 0.15.8`, `cfg-expr 0.20.8`, `combine 4.6.7`, `concurrent-queue 2.5.0`, `core-foundation 0.10.1`, `core-foundation-sys 0.8.7`, `core-graphics 0.25.0`, `core-graphics-types 0.2.0`, `dbus 0.9.12`, `dispatch2 0.3.1`, `dlopen2 0.8.2`, `dlopen2_derive 0.4.3`, `embed_plist 1.2.2`, `endi 1.1.1`, `enumflags2 0.7.12`, `enumflags2_derive 0.7.12`, `errno 0.3.14`, `event-listener 5.4.1`, `event-listener-strategy 0.5.4`, `field-offset 0.3.6`, `foreign-types 0.5.0`, `foreign-types-macros 0.2.3`, `foreign-types-shared 0.3.1`, `futures-executor 0.3.32`, `futures-lite 2.6.1`, `gdk 0.18.2`, `gdk-pixbuf 0.18.5`, `gdk-pixbuf-sys 0.18.0`, `gdk-sys 0.18.2`, `gdkwayland-sys 0.18.2`, `gdkx11 0.18.2`, `gdkx11-sys 0.18.2`, `getrandom 0.2.17`, `gio 0.18.4`, `gio-sys 0.18.1`, `gio-sys 0.21.5`, `glib 0.18.5`, `glib 0.21.5`, `glib-macros 0.18.5`, `glib-macros 0.21.5`, `glib-sys 0.18.1`, `glib-sys 0.21.5`, `gobject-sys 0.18.0`, `gobject-sys 0.21.5`, `gtk 0.18.2`, `gtk-sys 0.18.2`, `gtk3-macros 0.18.2`, `heck 0.4.1`, `hermit-abi 0.5.2`, `iana-time-zone 0.1.65`, `iana-time-zone-haiku 0.1.2`, `is-docker 0.2.0`, `is-wsl 0.4.0`, `javascriptcore-rs 1.1.2`, `javascriptcore-rs-sys 1.1.1`, `jni 0.21.1`, `jni-sys 0.3.1`, `jni-sys 0.4.1`, `jni-sys-macros 0.4.1`, `js-sys 0.3.103`, `libappindicator 0.9.0`, `libappindicator-sys 0.9.0`, `libc 0.2.188`, `libc 0.2.189`, `libdbus-sys 0.2.7`, `libloading 0.7.4`, `libredox 0.1.18`, `linux-raw-sys 0.12.1`, `memoffset 0.9.1`, `ndk 0.9.0`, `ndk-sys 0.6.0+11769913`, `num_enum 0.7.6`, `num_enum_derive 0.7.6`, `objc2 0.6.4`, `objc2-app-kit 0.3.2`, `objc2-cloud-kit 0.3.2`, `objc2-core-data 0.3.2`, `objc2-core-foundation 0.3.2`, `objc2-core-graphics 0.3.2`, `objc2-core-image 0.3.2`, `objc2-core-location 0.3.2`, `objc2-core-text 0.3.2`, `objc2-core-video 0.3.2`, `objc2-encode 4.1.0`, `objc2-exception-helper 0.1.1`, `objc2-foundation 0.3.2`, `objc2-io-surface 0.3.2`, `objc2-javascript-core 0.3.2`, `objc2-quartz-core 0.3.2`, `objc2-security 0.3.2`, `objc2-ui-kit 0.3.2`, `objc2-user-notifications 0.3.2`, `objc2-web-kit 0.3.2`, `ordered-stream 0.2.0`, `pango 0.18.3`, `pango-sys 0.18.0`, `parking 2.2.1`, `piper 0.2.5`, `pkg-config 0.3.33`, `png 0.18.1`, `polling 3.11.0`, `proc-macro-crate 1.3.1`, `proc-macro-crate 2.0.2`, `proc-macro-crate 3.5.0`, `proc-macro-error 1.0.4`, `proc-macro-error-attr 1.0.4`, `r-efi 5.3.0`, `r-efi 6.0.0`, `redox_syscall 0.5.18`, `redox_users 0.5.2`, `reqwest 0.13.4`, `rustix 1.1.4`, `rustversion 1.0.23`, `serde_spanned 0.6.9`, `signal-hook-registry 1.4.8`, `soup3 0.5.0`, `soup3-sys 0.5.0`, `swift-rs 1.0.7`, `syn 1.0.109`, `system-deps 6.2.2`, `system-deps 7.0.8`, `tao-macros 0.1.3`, `target-lexicon 0.12.16`, `target-lexicon 0.13.5`, `tokio-util 0.7.18`, `toml 0.8.2`, `toml_datetime 0.6.3`, `toml_edit 0.19.15`, `toml_edit 0.20.2`, `toml_edit 0.25.12+spec-1.1.0`, `tower-http 0.6.11`, `uds_windows 1.2.1`, `version-compare 0.2.1`, `wasi 0.11.1+wasi-snapshot-preview1`, `wasip2 1.0.4+wasi-0.2.12`, `wasm-bindgen 0.2.126`, `wasm-bindgen-futures 0.4.76`, `wasm-bindgen-macro 0.2.126`, `wasm-bindgen-macro-support 0.2.126`, `wasm-bindgen-shared 0.2.126`, `wasm-streams 0.5.0`, `web-sys 0.3.103`, `webkit2gtk 2.0.2`, `webkit2gtk-sys 2.0.2`, `winapi 0.3.9`, `winapi-i686-pc-windows-gnu 0.4.0`, `winapi-x86_64-pc-windows-gnu 0.4.0`, `windows-core 0.62.2`, `windows-result 0.4.1`, `windows-strings 0.5.1`, `windows-sys 0.45.0`, `windows-targets 0.42.2`, `windows_aarch64_gnullvm 0.42.2`, `windows_aarch64_gnullvm 0.52.6`, `windows_aarch64_msvc 0.42.2`, `windows_aarch64_msvc 0.52.6`, `windows_i686_gnu 0.42.2`, `windows_i686_gnu 0.52.6`, `windows_i686_gnullvm 0.52.6`, `windows_i686_msvc 0.42.2`, `windows_i686_msvc 0.52.6`, `windows_x86_64_gnu 0.42.2`, `windows_x86_64_gnu 0.52.6`, `windows_x86_64_gnullvm 0.42.2`, `windows_x86_64_gnullvm 0.52.6`, `windows_x86_64_msvc 0.42.2`, `winnow 0.5.40`, `wit-bindgen 0.57.1`, `x11 2.21.0`, `x11-dl 2.21.0`, `zbus 5.17.0`, `zbus_macros 5.17.0`, `zbus_names 4.3.3`, `zvariant 5.13.0`, `zvariant_derive 5.13.0`, `zvariant_utils 3.5.0`

### 2.5 Other observations for counsel

- **Our own packages are marked proprietary.** Every first-party npm package says `"license": "UNLICENSED"`, except `projectos-vscode`, which has no licence field. All 40 first-party crates say `license = "UNLICENSED"` with `publish = false`.
- **Some shipping crates contain no licence text file**, only an SPDX field. The standard text has to be supplied in the notices file for: `alloc-stdlib`, `selectors`, `unic-char-property`, `unic-char-range`, `unic-common`, `unic-ucd-ident`, `unic-ucd-version`, `webview2-com-sys`, `webview2-com`. Also `@tauri-apps/plugin-opener` (npm), which ships only `LICENSE.spdx`.
- **Microsoft code.** The `windows`, `windows-sys`, `windows-*` and `windows_x86_64_msvc` crates are published by Microsoft (microsoft/windows-rs) under MIT OR Apache-2.0, with no additional EULA in the crate. `webview2-com*` is a community crate under MIT. The Microsoft **WebView2 Runtime** is not in this inventory. If the MSI (`packaging/wix/main.wxs`) embeds or downloads the WebView2 bootstrapper, Microsoft's WebView2 distribution terms apply separately.
- **Not inventoried:** the Node.js runtime, the Rust standard library (MIT OR Apache-2.0), the MSVC C runtime linked by Rust on Windows (Microsoft Visual C++ redistributable terms), and the build tools (WiX, Tauri CLI binary). These are toolchain or platform components, not lockfile dependencies. If any of them is redistributed in the MSI, it needs its own entry.
- **Lockfile freshness.** In this worktree, `cargo metadata --locked` reports that 11 `Cargo.lock` files are out of date with their `Cargo.toml` (`canonical-installation-identity-writer`, `crypto`, `elevated-installer-composition`, `project-registry`, `shared-host-runtime`, `windows-crypto-adapter`, `windows-host-capability-preflight`, `windows-master-key-composition`, `windows-service-identity-proof-runner`, `windows-service-installation-contract`, `control-center/src-tauri`). `host/contract` and `host/plan-durable-store` have no lockfile; their dependencies are covered through the crates that depend on them. Every registry crate declared in any first-party `Cargo.toml` is present in its own lock, so no direct dependency is missing. Exact versions may move when the locks are refreshed.
- **Rust "prod" errs on the inclusive side.** The scope comes from the lockfile, which resolves all features. A crate behind a non-default feature (for example `windows` in `host-authority`) is therefore counted as runtime. The `cargo metadata` cross-check, which uses default features, found no licence differences, only these feature-gated extras.

## 3. Attribution and notice requirements

**General duty.** Almost every licence here requires the copyright notice and the licence text to accompany binary distributions: MIT, BSD-2/3, ISC, Apache-2.0, Zlib (source only), BlueOak, Unicode-3.0 and MPL-2.0. The desktop app MSI and the Windows service therefore need a **third-party notices file**, for example `THIRD-PARTY-NOTICES.txt` installed next to the binaries and linked from an About screen. No such file exists today. `git ls-files` finds no NOTICE or THIRD-PARTY file. The WiX template `projectos/control-center/packaging/wix/main.wxs` has an optional `WixUILicenseRtf` hook, but `tauri.conf.json` sets no licence for it to use.

Licences that do **not** need attribution: 0BSD, MIT-0, CC0-1.0, Unlicense. Most items under these are dual-licensed with MIT anyway.

**Apache NOTICE files** (Apache-2.0 section 4(d): NOTICE content must be reproduced):

| Package | Version | Scope | NOTICE file location |
|---|---|---|---|
| `bare-path` (npm) | 3.1.1 | dev | `projectos\control-center\node_modules\bare-path\NOTICE` |

No shipping package (npm prod or Rust prod/build) contains a NOTICE file. Of the Apache-2.0-*only* shipping crates, `tao` 0.35.3 (desktop app) and `sync_wrapper` 1.0.2 (desktop app) have no NOTICE file, but the Apache-2.0 licence text itself must still be included.

**BSD advertising clause (BSD-4-Clause, "All advertising materials mentioning ...").** None found. Every package licence text present on disk was searched. Packages that are not installed were not searched; these are the VS Code extension's dev packages and the non-Windows crates.

**Special attribution items in shipping code:**

| Item | Where | Requirement |
|---|---|---|
| Unicode-3.0: `icu_*`, `zerovec*`, `yoke*`, `tinystr`, `writeable`, `litemap`, `zerotrie`, `zerofrom*`, `potential_utf`, `unicode-ident` | Desktop app (Rust) | Include the Unicode copyright and permission notice. Text is in each crate's `LICENSE` in the cargo registry. |
| MPL-2.0: `cssparser`, `selectors`, `dtoa-short`, `option-ext`, `cssparser-macros` | Desktop app (Rust) | Keep the MPL notice. Tell recipients where the source of these files is available (crates.io / upstream repos). Release any modifications to them under MPL-2.0. |
| `crossbeam-channel` 0.5.16 `LICENSE-THIRD-PARTY` (CC-BY-3.0 `matching.go`, Go BSD-3-Clause, Rust-project portions) | Desktop app (Rust) | Reproduce that third-party file in the notices. |
| `brotli` 8.0.4 (BSD-3-Clause AND MIT), `alloc-stdlib` 0.2.4 / `alloc-no-stdlib` (BSD-3-Clause), `brotli-decompressor` 5.0.3 (BSD-3-Clause OR MIT) | Desktop app (Rust) | BSD-3-Clause notice and disclaimer. `alloc-stdlib` ships no licence file. |
| `tslib` 2.8.1 (0BSD) | Desktop app frontend | No attribution needed. Ships `CopyrightNotice.txt`. |
| React 18.3.1, `react-dom`, `scheduler`, `loose-envify`, `js-tokens`, `@supabase/*`, `iceberg-js` (MIT); `@tauri-apps/api`, `@tauri-apps/plugin-opener` (MIT OR Apache-2.0) | Desktop app frontend (Vite bundle) | MIT notices. Vite may strip licence comments when it minifies, so put them in the notices file. |

## Appendix A - every third-party package that ships (unique, runtime scope)

The full inventory of all packages, including build, dev and not-windows, is in `dependency-licences.csv` next to this file.

| Eco | Package | Version | Licence | Class | Option taken | Direct | Ships in |
|---|---|---|---|---|---|---|---|
| cargo | `aho-corasick` | 1.1.4 | Unlicense OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `alloc-no-stdlib` | 2.0.4 | BSD-3-Clause | permissive |  | transitive | Desktop app |
| cargo | `alloc-stdlib` | 0.2.4 | BSD-3-Clause | permissive |  | transitive | Desktop app |
| cargo | `anyhow` | 1.0.103 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `atomic-waker` | 1.1.2 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `axum` | 0.8.9 | MIT | permissive |  | transitive | Desktop app |
| cargo | `axum-core` | 0.5.6 | MIT | permissive |  | transitive | Desktop app |
| cargo | `base64` | 0.22.1 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `bit-set` | 0.8.0 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `bit-vec` | 0.8.0 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `bitflags` | 2.13.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `block-buffer` | 0.10.4 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `brotli` | 8.0.4 | BSD-3-Clause AND MIT | permissive |  | transitive | Desktop app |
| cargo | `brotli-decompressor` | 5.0.3 | BSD-3-Clause/MIT | permissive | MIT | transitive | Desktop app |
| cargo | `bs58` | 0.5.1 | MIT/Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `byteorder` | 1.5.0 | Unlicense OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `bytes` | 1.12.1 | MIT | permissive |  | transitive | Desktop app |
| cargo | `camino` | 1.2.4 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `cargo-platform` | 0.1.9 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `cargo_metadata` | 0.19.2 | MIT | permissive |  | transitive | Desktop app |
| cargo | `cfb` | 0.7.3 | MIT | permissive |  | transitive | Desktop app |
| cargo | `cfg-if` | 1.0.4 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `cfg-if` | 1.0.5 | MIT OR Apache-2.0 | permissive | MIT | transitive | Host library crates (linked into service/installer binaries) |
| cargo | `chrono` | 0.4.45 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `cookie` | 0.18.1 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `cpufeatures` | 0.2.17 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `crossbeam-channel` | 0.5.16 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `crossbeam-utils` | 0.8.22 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `crypto-common` | 0.1.7 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `cssparser` | 0.36.0 | MPL-2.0 | weak-copyleft |  | transitive | Desktop app |
| cargo | `ctor` | 0.8.0 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `deranged` | 0.5.8 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `derive_more` | 2.1.1 | MIT | permissive |  | transitive | Desktop app |
| cargo | `digest` | 0.10.7 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `dirs` | 6.0.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `dirs-sys` | 0.5.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `dom_query` | 0.27.0 | MIT | permissive |  | transitive | Desktop app |
| cargo | `dpi` | 0.1.2 | Apache-2.0 AND MIT | permissive |  | transitive | Desktop app |
| cargo | `dtoa` | 1.0.11 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `dtoa-short` | 0.3.5 | MPL-2.0 | weak-copyleft |  | transitive | Desktop app |
| cargo | `dtor` | 0.3.0 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `dunce` | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 | permissive | MIT-0 | transitive | Desktop app |
| cargo | `dyn-clone` | 1.0.20 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `equivalent` | 1.0.2 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `erased-serde` | 0.4.10 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `fastrand` | 2.4.1 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `fnv` | 1.0.7 | Apache-2.0 / MIT | permissive | MIT | transitive | Desktop app |
| cargo | `foldhash` | 0.2.0 | Zlib | permissive |  | transitive | Desktop app |
| cargo | `form_urlencoded` | 1.2.2 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `futures-channel` | 0.3.32 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `futures-core` | 0.3.32 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `futures-io` | 0.3.32 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `futures-sink` | 0.3.32 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `futures-task` | 0.3.32 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `futures-util` | 0.3.32 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `generic-array` | 0.14.7 | MIT | permissive |  | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `getrandom` | 0.3.4 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `getrandom` | 0.4.3 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `glob` | 0.3.3 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `hashbrown` | 0.12.3 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `hashbrown` | 0.17.1 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `heck` | 0.5.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `hex` | 0.4.3 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `html5ever` | 0.38.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `http` | 1.4.2 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `http-body` | 1.0.1 | MIT | permissive |  | transitive | Desktop app |
| cargo | `http-body-util` | 0.1.3 | MIT | permissive |  | transitive | Desktop app |
| cargo | `httparse` | 1.10.1 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `httpdate` | 1.0.3 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `hyper` | 1.10.1 | MIT | permissive |  | transitive | Desktop app |
| cargo | `hyper-util` | 0.1.20 | MIT | permissive |  | transitive | Desktop app |
| cargo | `icu_collections` | 2.2.0 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `icu_locale_core` | 2.2.0 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `icu_normalizer` | 2.2.0 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `icu_normalizer_data` | 2.2.0 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `icu_properties` | 2.2.0 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `icu_properties_data` | 2.2.0 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `icu_provider` | 2.2.0 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `idna` | 1.1.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `idna_adapter` | 1.2.2 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `indexmap` | 1.9.3 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `indexmap` | 2.14.0 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `infer` | 0.19.0 | MIT | permissive |  | transitive | Desktop app |
| cargo | `ipnet` | 2.12.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `itoa` | 1.0.18 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `json-patch` | 3.0.1 | MIT/Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `jsonptr` | 0.6.3 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `keyboard-types` | 0.7.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `libc` | 0.2.186 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `litemap` | 0.8.2 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `lock_api` | 0.4.14 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `log` | 0.4.33 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `markup5ever` | 0.38.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `matchit` | 0.8.4 | MIT AND BSD-3-Clause | permissive |  | transitive | Desktop app |
| cargo | `memchr` | 2.8.3 | Unlicense OR MIT | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `mime` | 0.3.17 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `mio` | 1.2.1 | MIT | permissive |  | transitive | Desktop app |
| cargo | `muda` | 0.19.3 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `new_debug_unreachable` | 1.0.6 | MIT | permissive |  | transitive | Desktop app |
| cargo | `num-conv` | 0.2.2 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `num-traits` | 0.2.19 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `once_cell` | 1.21.4 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `open` | 5.3.6 | MIT | permissive |  | transitive | Desktop app |
| cargo | `option-ext` | 0.2.0 | MPL-2.0 | weak-copyleft |  | transitive | Desktop app |
| cargo | `parking_lot` | 0.12.5 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `parking_lot_core` | 0.9.12 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `percent-encoding` | 2.3.2 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `phf` | 0.13.1 | MIT | permissive |  | transitive | Desktop app |
| cargo | `phf_shared` | 0.13.1 | MIT | permissive |  | transitive | Desktop app |
| cargo | `pin-project-lite` | 0.2.17 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `plist` | 1.10.0 | MIT | permissive |  | transitive | Desktop app |
| cargo | `potential_utf` | 0.1.5 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `powerfmt` | 0.2.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `precomputed-hash` | 0.1.1 | MIT | permissive |  | transitive | Desktop app |
| cargo | `proc-macro2` | 1.0.106 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `quick-xml` | 0.41.0 | MIT | permissive |  | transitive | Desktop app |
| cargo | `quote` | 1.0.46 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `raw-window-handle` | 0.6.2 | MIT OR Apache-2.0 OR Zlib | permissive | MIT | transitive | Desktop app |
| cargo | `ref-cast` | 1.0.25 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `regex` | 1.12.4 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `regex-automata` | 0.4.14 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `regex-syntax` | 0.8.11 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `rustc-hash` | 2.1.3 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `ryu` | 1.0.23 | Apache-2.0 OR BSL-1.0 | permissive | Apache-2.0 | transitive | Desktop app |
| cargo | `same-file` | 1.0.6 | Unlicense/MIT | permissive | MIT | transitive | Desktop app |
| cargo | `schemars` | 0.8.22 | MIT | permissive |  | transitive | Desktop app |
| cargo | `schemars` | 0.9.0 | MIT | permissive |  | transitive | Desktop app |
| cargo | `schemars` | 1.2.1 | MIT | permissive |  | transitive | Desktop app |
| cargo | `scopeguard` | 1.2.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `selectors` | 0.36.1 | MPL-2.0 | weak-copyleft |  | transitive | Desktop app |
| cargo | `semver` | 1.0.28 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `serde` | 1.0.228 | MIT OR Apache-2.0 | permissive | MIT | direct | Desktop app |
| cargo | `serde` | 1.0.229 | MIT OR Apache-2.0 | permissive | MIT | direct | Installer/tool binaries; Windows service |
| cargo | `serde-untagged` | 0.1.9 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `serde_core` | 1.0.228 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `serde_core` | 1.0.229 | MIT OR Apache-2.0 | permissive | MIT | transitive | Installer/tool binaries; Windows service |
| cargo | `serde_json` | 1.0.150 | MIT OR Apache-2.0 | permissive | MIT | direct | Desktop app |
| cargo | `serde_json` | 1.0.151 | MIT OR Apache-2.0 | permissive | MIT | direct | Installer/tool binaries; Windows service |
| cargo | `serde_path_to_error` | 0.1.20 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `serde_spanned` | 1.1.1 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `serde_urlencoded` | 0.7.1 | MIT/Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `serde_with` | 3.21.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `serialize-to-javascript` | 0.1.2 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `servo_arc` | 0.4.3 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `sha1` | 0.10.7 | MIT OR Apache-2.0 | permissive | MIT | direct | Windows service |
| cargo | `sha2` | 0.10.9 | MIT OR Apache-2.0 | permissive | MIT | direct | Desktop app; Installer/tool binaries; Windows service |
| cargo | `siphasher` | 1.0.3 | MIT/Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `slab` | 0.4.12 | MIT | permissive |  | transitive | Desktop app |
| cargo | `smallvec` | 1.15.2 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `socket2` | 0.6.4 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `softbuffer` | 0.4.8 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `stable_deref_trait` | 1.2.1 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `string_cache` | 0.9.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `sync_wrapper` | 1.0.2 | Apache-2.0 | permissive |  | transitive | Desktop app |
| cargo | `tao` | 0.35.3 | Apache-2.0 | permissive |  | transitive | Desktop app |
| cargo | `tauri` | 2.11.5 | Apache-2.0 OR MIT | permissive | MIT | direct | Desktop app |
| cargo | `tauri-plugin-opener` | 2.5.4 | Apache-2.0 OR MIT | permissive | MIT | direct | Desktop app |
| cargo | `tauri-plugin-wdio-webdriver` | 1.3.0 | MIT | permissive |  | direct | Desktop app |
| cargo | `tauri-runtime` | 2.11.3 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `tauri-runtime-wry` | 2.11.4 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `tauri-utils` | 2.9.3 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `tempfile` | 3.27.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `tendril` | 0.5.1 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `thiserror` | 1.0.69 | MIT OR Apache-2.0 | permissive | MIT | direct | Desktop app; Installer/tool binaries; Windows service |
| cargo | `thiserror` | 2.0.18 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `time` | 0.3.53 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `time-core` | 0.1.9 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `tinystr` | 0.8.3 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `tinyvec` | 1.11.0 | Zlib OR Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `tinyvec_macros` | 0.1.1 | MIT OR Apache-2.0 OR Zlib | permissive | MIT | transitive | Desktop app |
| cargo | `tokio` | 1.52.3 | MIT | permissive |  | transitive | Desktop app |
| cargo | `toml` | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `toml_datetime` | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `toml_parser` | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `toml_writer` | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `tower` | 0.5.3 | MIT | permissive |  | transitive | Desktop app |
| cargo | `tower-layer` | 0.3.3 | MIT | permissive |  | transitive | Desktop app |
| cargo | `tower-service` | 0.3.3 | MIT | permissive |  | transitive | Desktop app |
| cargo | `tracing` | 0.1.44 | MIT | permissive |  | transitive | Desktop app |
| cargo | `tracing-core` | 0.1.36 | MIT | permissive |  | transitive | Desktop app |
| cargo | `tray-icon` | 0.24.1 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `try-lock` | 0.2.5 | MIT | permissive |  | transitive | Desktop app |
| cargo | `typeid` | 1.0.3 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `typenum` | 1.20.1 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `unic-char-property` | 0.9.0 | MIT/Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `unic-char-range` | 0.9.0 | MIT/Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `unic-common` | 0.9.0 | MIT/Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `unic-ucd-ident` | 0.9.0 | MIT/Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `unic-ucd-version` | 0.9.0 | MIT/Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `unicode-ident` | 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 | permissive | MIT AND Unicode-3.0 | transitive | Desktop app |
| cargo | `unicode-segmentation` | 1.13.3 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `url` | 2.5.8 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `urlpattern` | 0.3.0 | MIT | permissive |  | transitive | Desktop app |
| cargo | `utf8_iter` | 1.0.4 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `uuid` | 1.23.4 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `walkdir` | 2.5.0 | Unlicense/MIT | permissive | MIT | transitive | Desktop app |
| cargo | `want` | 0.3.1 | MIT | permissive |  | transitive | Desktop app |
| cargo | `web_atoms` | 0.2.5 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `webview2-com` | 0.38.2 | MIT | permissive |  | transitive | Desktop app |
| cargo | `webview2-com-sys` | 0.38.2 | MIT | permissive |  | transitive | Desktop app |
| cargo | `winapi-util` | 0.1.11 | Unlicense OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `window-vibrancy` | 0.6.0 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `windows` | 0.61.3 | MIT OR Apache-2.0 | permissive | MIT | direct | Desktop app; Installer/tool binaries; Windows service |
| cargo | `windows-collections` | 0.2.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `windows-core` | 0.61.2 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `windows-future` | 0.2.1 | MIT OR Apache-2.0 | permissive | MIT | direct | Desktop app; Installer/tool binaries; Windows service |
| cargo | `windows-link` | 0.1.3 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `windows-link` | 0.2.1 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `windows-numerics` | 0.2.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `windows-result` | 0.3.4 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `windows-strings` | 0.4.2 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `windows-sys` | 0.59.0 | MIT OR Apache-2.0 | permissive | MIT | direct | Desktop app; Installer/tool binaries; Windows service |
| cargo | `windows-sys` | 0.61.2 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `windows-targets` | 0.52.6 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `windows-threading` | 0.1.0 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `windows-version` | 0.1.7 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app |
| cargo | `windows_x86_64_msvc` | 0.52.6 | MIT OR Apache-2.0 | permissive | MIT | transitive | Desktop app; Installer/tool binaries; Windows service |
| cargo | `winnow` | 1.0.3 | MIT | permissive |  | transitive | Desktop app |
| cargo | `writeable` | 0.6.3 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `wry` | 0.55.1 | Apache-2.0 OR MIT | permissive | MIT | transitive | Desktop app |
| cargo | `yoke` | 0.8.3 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `zerofrom` | 0.1.8 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `zeroize` | 1.9.0 | Apache-2.0 OR MIT | permissive | MIT | direct | Host library crates (linked into service/installer binaries) |
| cargo | `zerotrie` | 0.2.4 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `zerovec` | 0.11.6 | Unicode-3.0 | permissive |  | transitive | Desktop app |
| cargo | `zmij` | 1.0.21 | MIT | permissive |  | transitive | Desktop app |
| cargo | `zmij` | 1.0.23 | MIT | permissive |  | transitive | Installer/tool binaries; Windows service |
| npm | `@supabase/auth-js` | 2.110.1 | MIT | permissive |  | transitive | Desktop app |
| npm | `@supabase/functions-js` | 2.110.1 | MIT | permissive |  | transitive | Desktop app |
| npm | `@supabase/phoenix` | 0.4.4 | MIT | permissive |  | transitive | Desktop app |
| npm | `@supabase/postgrest-js` | 2.110.1 | MIT | permissive |  | transitive | Desktop app |
| npm | `@supabase/realtime-js` | 2.110.1 | MIT | permissive |  | transitive | Desktop app |
| npm | `@supabase/storage-js` | 2.110.1 | MIT | permissive |  | transitive | Desktop app |
| npm | `@supabase/supabase-js` | 2.110.1 | MIT | permissive |  | direct | Desktop app |
| npm | `@tauri-apps/api` | 2.11.1 | Apache-2.0 OR MIT | permissive | MIT | direct | Desktop app |
| npm | `@tauri-apps/plugin-opener` | 2.5.4 | MIT OR Apache-2.0 | permissive | MIT | direct | Desktop app |
| npm | `iceberg-js` | 0.8.1 | MIT | permissive |  | transitive | Desktop app |
| npm | `js-tokens` | 4.0.0 | MIT | permissive |  | transitive | Desktop app |
| npm | `loose-envify` | 1.4.0 | MIT | permissive |  | transitive | Desktop app |
| npm | `react` | 18.3.1 | MIT | permissive |  | direct | Desktop app |
| npm | `react-dom` | 18.3.1 | MIT | permissive |  | direct | Desktop app |
| npm | `scheduler` | 0.23.2 | MIT | permissive |  | transitive | Desktop app |
| npm | `tslib` | 2.8.1 | 0BSD | permissive |  | transitive | Desktop app |

## Appendix B - method

1. **npm.** For each `package-lock.json`, every entry under `packages` whose key contains `node_modules/` is a third-party package. `dev: true` or `devOptional: true` marks it dev; otherwise it is prod. Direct means a top-level entry named in the root `dependencies`, `devDependencies` or `optionalDependencies`. The licence comes from the lockfile `license` field, falling back to the installed `package.json` and then the LICENSE text. Local `file:` links (`@projectos/*`) are first-party and excluded. The `projectos/vscode` lock has no `node_modules`, so only its lockfile licence fields were used.
2. **Rust.** `rustup run 1.96.1 cargo metadata --format-version 1 --locked --offline` was attempted for all 42 crate roots. It succeeded for 12. The rest failed for two reasons: their `Cargo.lock` is stale (cargo refuses with `--locked`), or a non-Windows crate is not in the offline registry. As instructed, the fallback parsed each `Cargo.lock` and read each crate's `Cargo.toml` and licence files from `~/.cargo/registry/src` or the `.crate` archives in `~/.cargo/registry/cache` (read in memory, nothing extracted).
3. **Rust scope.** The dependency graph was walked from each root crate. Each edge kind (normal, build or dev) and its `[target.'cfg(...)']` condition come from the depending crate's `Cargo.toml`, with cfg evaluated for `x86_64-pc-windows-msvc`. Proc-macro crates and everything below a build edge count as `build`. Dev edges are followed only from the root crate, which matches how cargo resolves. For the 12 roots where `cargo metadata` worked, the result matched it exactly, apart from the feature-gated extras noted in 2.5.
4. **Classes.** permissive: MIT, MIT-0, BSD-*, ISC, Apache-2.0, 0BSD, Unlicense, Zlib, CC0-1.0, BlueOak-1.0.0, plus Unicode-3.0, BSL-1.0 and Python-2.0, which are flagged as outside the named list. weak-copyleft: MPL, LGPL, EPL, CDDL. strong-copyleft: GPL, AGPL, SSPL. other: CC-BY and anything unrecognised. unknown: no licence found. For `A OR B` the most permissive option decides the class; for `A AND B` the least permissive term does. The legacy cargo `MIT/Apache-2.0` form was read as OR.
5. **Scripts.** They are in the session scratchpad at `scripts/inventory.py` and `scripts/report.py` and can be re-run.
